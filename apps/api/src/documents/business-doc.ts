import PDFDocument from 'pdfkit';

/**
 * Motor de dibujo del FORMATO DE DOCUMENTO del negocio (la nota de entrega y la
 * cotización comparten layout). Las medidas salen de la plantilla real de Word
 * (`nota_entrega_*.docx`): página Carta, márgenes de 0,55" arriba/abajo y 0,7" a
 * los lados, tabla de cabecera de 4 columnas iguales, tabla de ítems con
 * encabezado negro y caja de total en la mitad derecha, y bloque de doble firma.
 *
 * Word mide en twips (1/20 pt); acá todo está ya convertido a puntos.
 */

/** Paleta calcada de la plantilla (mismos hex que el .docx). */
export const DOC_COLORS = {
  /** texto normal */
  ink: '#111827',
  /** títulos y encabezado de la tabla de ítems */
  inkStrong: '#111111',
  /** etiquetas secundarias ("Nombre y firma", "C.I. / RIF") */
  muted: '#4B5563',
  /** pie de página y líneas de escritura */
  faint: '#6B7280',
  /** bordes suaves de tabla */
  grid: '#D1D5DB',
  /** relleno de celdas-etiqueta y de la caja de total */
  fillSoft: '#F3F4F6',
  onDark: '#FFFFFF',
} as const;

/** Cuerpos de letra en puntos (el .docx los guarda en medios puntos). */
export const DOC_SIZES = {
  title: 13,
  section: 10,
  body: 11,
  row: 10,
  small: 9.5,
  total: 11,
  footer: 9,
} as const;

const PAGE = { width: 612, height: 792 } as const; // Carta (12240 × 15840 twips)
const MARGIN = { top: 39.6, bottom: 39.6, left: 50.4, right: 50.4 } as const; // 792/1008 twips
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right; // 511,2 pt
const CELL_PADDING = 4;
const MIN_ROW_HEIGHT = 18;
/** Alto máximo del logo; el ancho se limita al ancho útil de la página. En la
 *  plantilla el logo mide ~256 × 67 pt, pero un PNG con márgenes en blanco se
 *  ve más chico a igual alto: 85 pt deja ambos casos con presencia parecida. */
const LOGO_BOX = { height: 85 } as const;

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

export type CellAlign = 'left' | 'center' | 'right';

export interface DocCell {
  text: string;
  width: number;
  align?: CellAlign;
  bold?: boolean;
  size?: number;
  color?: string;
  /** relleno de fondo; `undefined` = sin relleno */
  fill?: string;
  /** color del borde; `null` = sin borde */
  border?: string | null;
  borderWidth?: number;
}

export interface ItemsColumn {
  label: string;
  /** ancho en puntos; la suma debe dar el ancho útil de la página */
  width: number;
  align?: CellAlign;
}

export interface BusinessDocOptions {
  /** Nombre del negocio emisor (va en el pie y en el bloque de firma). */
  emisor: string;
  /** Logo ya validado (PNG/JPEG). `null` = encabezado solo con texto. */
  logo?: { data: Buffer; mime: string } | null;
  /** Texto del pie: "{emisor} | {footerNote}". */
  footerNote: string;
}

/**
 * Documento en construcción. Mantiene el cursor vertical, corta páginas cuando
 * hace falta y repinta el pie en cada página nueva.
 */
export class BusinessDoc {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly options: BusinessDocOptions;

  constructor(options: BusinessDocOptions) {
    this.options = options;
    this.doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margins: { ...MARGIN },
      autoFirstPage: false,
      info: { Title: options.footerNote, Author: options.emisor },
    });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    // El pie va en TODAS las páginas; se dibuja al crearlas para no depender de
    // acordarse al final (y sin mover el cursor de contenido).
    this.doc.on('pageAdded', () => this.drawFooter());
    this.doc.addPage();
  }

  /** Ancho útil de la página, en puntos. */
  get contentWidth(): number {
    return CONTENT_WIDTH;
  }

  get left(): number {
    return MARGIN.left;
  }

  /** Última coordenada Y utilizable antes de cortar página. */
  private get bottomLimit(): number {
    return PAGE.height - MARGIN.bottom - 24; // 24 pt reservados para el pie
  }

  /** Corta página si el bloque de alto `height` no entra en lo que queda. */
  ensureSpace(height: number): void {
    if (this.doc.y + height > this.bottomLimit) this.doc.addPage();
  }

  /** Espacio vertical explícito (la plantilla usa `w:spacing` en twips). */
  gap(points: number): void {
    this.doc.y += points;
  }

  // ----- Bloques del formato -----

  /** Logo centrado arriba. Sin logo, el nombre del negocio en grande. */
  header(): void {
    const logo = this.options.logo;
    if (logo?.data?.length) {
      try {
        // La caja de encaje ocupa todo el ancho útil para que `align: center`
        // centre el logo en la PÁGINA; el alto es el que manda el tamaño.
        this.doc.image(logo.data, MARGIN.left, this.doc.y, {
          fit: [CONTENT_WIDTH, LOGO_BOX.height],
          align: 'center',
        });
        this.doc.y += LOGO_BOX.height;
      } catch {
        // Imagen ilegible (archivo corrupto): no se rompe el documento, se cae
        // al encabezado de texto.
        this.textHeader();
      }
    } else {
      this.textHeader();
    }
    this.gap(14);
  }

  private textHeader(): void {
    this.doc
      .font(FONT_BOLD)
      .fontSize(20)
      .fillColor(DOC_COLORS.inkStrong)
      .text(this.options.emisor, MARGIN.left, this.doc.y, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
  }

  /**
   * Tabla de cabecera: 4 columnas iguales, etiquetas con fondo gris claro y
   * valores en blanco (N.º de documento / Fecha / Emisor / Receptor / RIF /
   * Teléfono).
   */
  keyValueTable(rows: Array<[string, string, string, string]>): void {
    const col = CONTENT_WIDTH / 4;
    for (const [k1, v1, k2, v2] of rows) {
      const cells: DocCell[] = [
        { text: k1, width: col, bold: true, fill: DOC_COLORS.fillSoft },
        { text: v1, width: col },
        { text: k2, width: col, bold: true, fill: DOC_COLORS.fillSoft },
        { text: v2, width: col },
      ].map((c) => ({
        size: DOC_SIZES.small,
        color: DOC_COLORS.ink,
        border: DOC_COLORS.grid,
        ...c,
      }));
      this.row(cells);
    }
  }

  /** Título principal del documento (centrado, en mayúsculas). */
  title(text: string): void {
    this.gap(14);
    this.doc
      .font(FONT_BOLD)
      .fontSize(DOC_SIZES.title)
      .fillColor(DOC_COLORS.inkStrong)
      .text(text, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH, align: 'center' });
    this.gap(6);
  }

  /** Encabezado de sección ("DETALLE DE ENTREGA:"). */
  sectionTitle(text: string): void {
    this.gap(14);
    this.doc
      .font(FONT_BOLD)
      .fontSize(DOC_SIZES.section)
      .fillColor(DOC_COLORS.inkStrong)
      .text(text, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH });
    this.gap(6);
  }

  /** Párrafo justificado del cuerpo. */
  paragraph(text: string): void {
    this.doc
      .font(FONT)
      .fontSize(DOC_SIZES.body)
      .fillColor(DOC_COLORS.ink)
      .text(text, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH, align: 'justify' });
  }

  /** Línea suelta de detalle bajo una tabla (notas, validez, equivalencias). */
  note(text: string, opts: { bold?: boolean; color?: string; size?: number } = {}): void {
    this.doc
      .font(opts.bold ? FONT_BOLD : FONT)
      .fontSize(opts.size ?? DOC_SIZES.small)
      .fillColor(opts.color ?? DOC_COLORS.muted)
      .text(text, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH });
  }

  /** Etiqueta en negrita seguida de líneas en blanco para escribir a mano. */
  ruledLines(label: string, count = 3): void {
    this.gap(14);
    this.doc
      .font(FONT_BOLD)
      .fontSize(DOC_SIZES.body)
      .fillColor(DOC_COLORS.ink)
      .text(label, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH });
    this.gap(8);
    for (let i = 0; i < count; i += 1) {
      this.ensureSpace(16);
      const y = this.doc.y + 10;
      this.doc
        .lineWidth(0.5)
        .strokeColor(DOC_COLORS.faint)
        .moveTo(MARGIN.left, y)
        .lineTo(MARGIN.left + CONTENT_WIDTH, y)
        .stroke();
      this.doc.y = y + 6;
    }
  }

  /**
   * Tabla de ítems: encabezado negro con texto blanco, filas con borde suave y
   * caja de total ocupando la mitad derecha.
   */
  itemsTable(columns: ItemsColumn[], rows: string[][], total?: string): void {
    const headerCells = (): DocCell[] =>
      columns.map((c) => ({
        text: c.label,
        width: c.width,
        align: 'center' as CellAlign,
        bold: true,
        size: DOC_SIZES.small,
        color: DOC_COLORS.onDark,
        fill: DOC_COLORS.inkStrong,
        border: DOC_COLORS.inkStrong,
        borderWidth: 1,
      }));

    this.ensureSpace(56);
    this.row(headerCells());

    for (const values of rows) {
      const cells: DocCell[] = columns.map((c, i) => ({
        text: values[i] ?? '',
        width: c.width,
        align: c.align ?? 'left',
        size: DOC_SIZES.row,
        color: DOC_COLORS.ink,
        border: DOC_COLORS.grid,
      }));
      // Si la fila no entra, se corta página y se repite el encabezado.
      if (this.doc.y + this.rowHeight(cells) > this.bottomLimit) {
        this.doc.addPage();
        this.row(headerCells());
      }
      this.row(cells);
    }

    if (total !== undefined) {
      const half = CONTENT_WIDTH / 2;
      this.ensureSpace(26);
      this.row([
        { text: '', width: half, border: null },
        {
          text: total,
          width: half,
          align: 'center',
          bold: true,
          size: DOC_SIZES.total,
          color: DOC_COLORS.ink,
          fill: DOC_COLORS.fillSoft,
          border: DOC_COLORS.inkStrong,
        },
      ]);
    }
  }

  /**
   * Bloque de doble firma: quien entrega/emite (nombre y RIF del negocio, ya
   * autorrellenados) y quien recibe/acepta (en blanco, para firmar a mano).
   */
  signatures(opts: {
    heading: string;
    leftTitle: string;
    rightTitle: string;
    leftName: string;
    leftRif: string;
  }): void {
    this.ensureSpace(130);
    this.gap(18);
    this.doc
      .font(FONT_BOLD)
      .fontSize(DOC_SIZES.total)
      .fillColor(DOC_COLORS.ink)
      .text(opts.heading, MARGIN.left, this.doc.y, { width: CONTENT_WIDTH });
    this.gap(8);

    const half = CONTENT_WIDTH / 2;
    const blank = '_'.repeat(34);
    const cell = (text: string, extra: Partial<DocCell> = {}): DocCell => ({
      text,
      width: half,
      align: 'center',
      size: DOC_SIZES.body,
      color: DOC_COLORS.ink,
      border: null,
      ...extra,
    });

    this.row([cell(opts.leftTitle, { bold: true }), cell(opts.rightTitle, { bold: true })]);
    this.gap(26);
    this.row([
      cell(opts.leftName || blank, { size: DOC_SIZES.row }),
      cell(blank, { size: DOC_SIZES.row }),
    ]);
    this.row([
      cell('Nombre y firma', { size: DOC_SIZES.small, color: DOC_COLORS.muted }),
      cell('Nombre y firma', { size: DOC_SIZES.small, color: DOC_COLORS.muted }),
    ]);
    const rifBlank = '_'.repeat(22);
    this.row([
      cell(`C.I. / RIF: ${opts.leftRif ? `___${opts.leftRif}___________` : rifBlank}`, {
        size: DOC_SIZES.small,
        color: DOC_COLORS.muted,
      }),
      cell(`C.I. / RIF: ${rifBlank}`, {
        size: DOC_SIZES.small,
        color: DOC_COLORS.muted,
      }),
    ]);
  }

  // ----- Primitivas de tabla -----

  /** Alto que ocuparía la fila (el mayor de sus celdas, con un mínimo). */
  private rowHeight(cells: DocCell[]): number {
    let content = 0;
    for (const c of cells) {
      this.doc.font(c.bold ? FONT_BOLD : FONT).fontSize(c.size ?? DOC_SIZES.row);
      const h = this.doc.heightOfString(c.text || ' ', {
        width: c.width - CELL_PADDING * 2,
        align: c.align ?? 'left',
      });
      content = Math.max(content, h);
    }
    return Math.max(MIN_ROW_HEIGHT, content + CELL_PADDING * 2);
  }

  /** Dibuja una fila completa (relleno, borde y texto centrado verticalmente). */
  private row(cells: DocCell[]): void {
    const height = this.rowHeight(cells);
    this.ensureSpace(height);
    const top = this.doc.y;
    let x = MARGIN.left;

    for (const c of cells) {
      if (c.fill) {
        this.doc.rect(x, top, c.width, height).fillColor(c.fill).fill();
      }
      if (c.border !== null) {
        this.doc
          .lineWidth(c.borderWidth ?? 0.75)
          .strokeColor(c.border ?? DOC_COLORS.grid)
          .rect(x, top, c.width, height)
          .stroke();
      }
      const size = c.size ?? DOC_SIZES.row;
      this.doc
        .font(c.bold ? FONT_BOLD : FONT)
        .fontSize(size)
        .fillColor(c.color ?? DOC_COLORS.ink);
      const textHeight = this.doc.heightOfString(c.text || ' ', {
        width: c.width - CELL_PADDING * 2,
        align: c.align ?? 'left',
      });
      this.doc.text(c.text, x + CELL_PADDING, top + (height - textHeight) / 2, {
        width: c.width - CELL_PADDING * 2,
        align: c.align ?? 'left',
      });
      x += c.width;
    }

    this.doc.x = MARGIN.left;
    this.doc.y = top + height;
  }

  /** Pie centrado. No toca el cursor de contenido. */
  private drawFooter(): void {
    const { x, y } = this.doc;
    this.doc
      .font(FONT)
      .fontSize(DOC_SIZES.footer)
      .fillColor(DOC_COLORS.faint)
      .text(
        `${this.options.emisor} | ${this.options.footerNote}`,
        MARGIN.left,
        PAGE.height - MARGIN.bottom - 12,
        { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
      );
    this.doc.x = x;
    this.doc.y = y;
  }

  /** Cierra el documento y devuelve el PDF completo. */
  finish(): Promise<Buffer> {
    return new Promise<Buffer>((resolve) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.end();
    });
  }
}
