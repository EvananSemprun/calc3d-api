/**
 * Base en memoria para probar la UNIÓN de fichas (13/11).
 *
 * Un mock con `jest.fn()` que devuelve lo que el test quiere no puede probar lo
 * que importa de una unión: que ningún monto ni fecha cambie, que la ficha de
 * origen se borre DESPUÉS de repuntar todo, y que una falla a mitad de camino no
 * deje nada a medias. Esto imita lo justo de Prisma para poder afirmarlo:
 * - las claves foráneas reales: borrar una ficha con líneas de factura es
 *   `Restrict` (falla), borrarla con conteos los borra (`Cascade`) y con
 *   compras las deja huérfanas (`SetNull`);
 * - la única `(materialId, month)` de los conteos;
 * - `$transaction`: el callback escribe en un BORRADOR que solo se confirma si no
 *   lanza. Quien escribiera con el cliente de afuera durante la transacción
 *   escaparía del rollback, y el test lo vería.
 */
type Fila = Record<string, unknown> & { id: string };
export interface Estado {
  material: Fila[];
  component: Fila[];
  expense: Fila[];
  purchaseInvoice: Fila[];
  purchaseInvoiceLine: Fila[];
  stockCount: Fila[];
  storeProduct: Fila[];
}

const clonar = (e: Estado): Estado => JSON.parse(JSON.stringify(e, reemplazoFecha), revivirFecha) as Estado;
const reemplazoFecha = function (this: Record<string, unknown>, k: string, v: unknown) {
  const crudo = this[k];
  return crudo instanceof Date ? { __fecha: crudo.getTime() } : v;
};
const revivirFecha = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '__fecha' in v ? new Date((v as { __fecha: number }).__fecha) : v;

const esFecha = (v: unknown): v is Date => v instanceof Date;
const igual = (a: unknown, b: unknown) => (esFecha(a) && esFecha(b) ? a.getTime() === b.getTime() : a === b);

type Donde = Record<string, unknown>;

function coincide(estado: Estado, tabla: keyof Estado, fila: Fila, where: Donde = {}): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'invoice' && tabla === 'purchaseInvoiceLine') {
      const factura = estado.purchaseInvoice.find((f) => f.id === fila.invoiceId);
      return !!factura && coincide(estado, 'purchaseInvoice', factura, cond as Donde);
    }
    const v = fila[campo];
    if (cond && typeof cond === 'object' && !esFecha(cond)) {
      const c = cond as { in?: unknown[]; gt?: number; not?: unknown };
      if (c.in) return c.in.some((x) => igual(x, v));
      if (c.gt !== undefined) return typeof v === 'number' && v > c.gt;
      if ('not' in c) return !igual(v, c.not);
    }
    return igual(v, cond);
  });
}

function delegado(
  leer: () => Estado,
  tabla: keyof Estado,
  alEscribir: (t: keyof Estado, op: string) => void,
  lecturaAflojada: () => Set<string>,
) {
  const filas = () => leer()[tabla];
  return {
    findMany: async ({ where }: { where?: Donde } = {}) => {
      // Simula que alguien aflojó la LECTURA (le quitó la organización): sirve para
      // probar que la ESCRITURA sigue cerrada por su cuenta.
      const w = lecturaAflojada().has(tabla) && where ? Object.fromEntries(Object.entries(where).filter(([k]) => k !== 'organizationId')) : where;
      return filas().filter((f) => coincide(leer(), tabla, f, w));
    },
    findFirst: async ({ where, orderBy }: { where?: Donde; orderBy?: Record<string, 'asc' | 'desc'>[] } = {}) => {
      const hallados = filas().filter((f) => coincide(leer(), tabla, f, where));
      for (const o of [...(orderBy ?? [])].reverse()) {
        const [campo, sentido] = Object.entries(o)[0];
        hallados.sort((a, b) => {
          const x = esFecha(a[campo]) ? (a[campo] as Date).getTime() : Number(a[campo]);
          const y = esFecha(b[campo]) ? (b[campo] as Date).getTime() : Number(b[campo]);
          return sentido === 'desc' ? y - x : x - y;
        });
      }
      return hallados[0] ?? null;
    },
    count: async ({ where }: { where?: Donde } = {}) => filas().filter((f) => coincide(leer(), tabla, f, where)).length,
    update: async ({ where, data }: { where: { id: string }; data: Donde }) => {
      alEscribir(tabla, 'update');
      const fila = filas().find((f) => f.id === where.id);
      if (!fila) throw new Error('Registro no encontrado');
      if (tabla === 'stockCount' && ('materialId' in data || 'month' in data)) {
        const candidato = { ...fila, ...data };
        const choca = filas().some(
          (o) => o.id !== fila.id && o.materialId === candidato.materialId && igual(o.month, candidato.month),
        );
        if (choca) throw new Error('Unique constraint failed on (materialId, month)');
      }
      Object.assign(fila, data);
      return fila;
    },
    updateMany: async ({ where, data }: { where: Donde; data: Donde }) => {
      alEscribir(tabla, 'updateMany');
      const hallados = filas().filter((f) => coincide(leer(), tabla, f, where));
      for (const f of hallados) {
        if (tabla === 'stockCount' && ('materialId' in data || 'month' in data)) {
          const candidato = { ...f, ...data };
          const choca = filas().some(
            (o) => o.id !== f.id && o.materialId === candidato.materialId && igual(o.month, candidato.month),
          );
          if (choca) throw new Error('Unique constraint failed on (materialId, month)');
        }
        Object.assign(f, data);
      }
      return { count: hallados.length };
    },
    /** Como Prisma: NO lanza si no encuentra nada, devuelve count: 0. */
    deleteMany: async ({ where }: { where: Donde }) => {
      alEscribir(tabla, 'deleteMany');
      const e = leer();
      const ids = e[tabla].filter((f) => coincide(e, tabla, f, where)).map((f) => f.id);
      for (const id of ids) borrar(e, tabla, id);
      return { count: ids.length };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      alEscribir(tabla, 'delete');
      borrar(leer(), tabla, where.id);
      return { id: where.id };
    },
  };
}

/** Borra con las claves foráneas reales (Restrict / SetNull / Cascade). */
function borrar(e: Estado, tabla: keyof Estado, id: string) {
  const i = e[tabla].findIndex((f) => f.id === id);
  if (i < 0) throw new Error('Registro no encontrado');
  if (tabla === 'material' || tabla === 'component') {
    const campo = tabla === 'material' ? 'materialId' : 'componentId';
    if (e.purchaseInvoiceLine.some((l) => l[campo] === id)) {
      throw new Error('Foreign key constraint failed: la ficha tiene líneas de factura (Restrict)');
    }
    for (const x of e.expense) if (x[campo] === id) x[campo] = null; // SetNull
    if (tabla === 'material') e.stockCount = e.stockCount.filter((c) => c.materialId !== id); // Cascade
  }
  e[tabla].splice(i, 1);
}

export interface BaseFalsa {
  prisma: Record<string, unknown>;
  estado: () => Estado;
  /** Registro de escrituras, en orden: `"expense.updateMany"`, `"material.delete"`… */
  escrituras: string[];
  /** Hace fallar la próxima escritura que coincida (p. ej. `"stockCount.update"`). */
  fallarEn: (op: string | null) => void;
  /** Hace que la lectura (findMany) de esa tabla ignore la organización. */
  aflojarLectura: (tabla: keyof Estado) => void;
}

export function baseFalsa(inicial: Partial<Estado>): BaseFalsa {
  let estado: Estado = {
    material: [],
    component: [],
    expense: [],
    purchaseInvoice: [],
    purchaseInvoiceLine: [],
    stockCount: [],
    storeProduct: [],
    ...inicial,
  };
  const escrituras: string[] = [];
  const aflojadas = new Set<string>();
  let falla: string | null = null;
  const alEscribir = (t: keyof Estado, op: string) => {
    escrituras.push(`${t}.${op}`);
    if (falla === `${t}.${op}`) throw new Error(`Falla inyectada en ${t}.${op}`);
  };
  const tablas = (leer: () => Estado) =>
    Object.fromEntries(
      (['material', 'component', 'expense', 'purchaseInvoice', 'purchaseInvoiceLine', 'stockCount', 'storeProduct'] as const).map((t) => [
        t,
        delegado(leer, t, alEscribir, () => aflojadas),
      ]),
    );
  const prisma: Record<string, unknown> = {
    ...tablas(() => estado),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const borrador = clonar(estado);
      const resultado = await fn(tablas(() => borrador));
      estado = borrador;
      return resultado;
    },
  };
  return { prisma, estado: () => estado, escrituras, fallarEn: (op) => (falla = op), aflojarLectura: (t) => void aflojadas.add(t) };
}
