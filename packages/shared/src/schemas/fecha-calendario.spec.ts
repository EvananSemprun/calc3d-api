/**
 * EL 30 DE FEBRERO NO ENTRA POR NINGUNA PUERTA DE ESCRITURA.
 *
 * `FECHA` validaba la FORMA (`AAAA-MM-DD`) y no el calendario: `'2026-02-30'`
 * pasaba, y `new Date('2026-02-30')` lo **corre al 2 de marzo** sin avisar. El
 * dueño registra un movimiento de caja el 30 de febrero, la app lo guarda en
 * marzo y el saldo "hasta el 28 de febrero" no lo cuenta: una diferencia que
 * después aparece como faltante en una conciliación, sin causa visible.
 *
 * ⚠️ Es DINERO y entra por un DTO del cliente, así que esto es regresión de
 * seguridad: el test ejecuta el ataque (mandar el día inventado) y tiene que
 * verlo rechazado. Va contra el schema que usa el pipe, y por cada rechazo hay
 * un **hermano alcanzable** —el día real que sí tiene que pasar—, o una guarda
 * que rechazara todo pasaría igual.
 *
 * Acá se cubren TODOS los usos de `FECHA`: si aparece uno nuevo, se suma a
 * `PUERTAS`. Una puerta cerrada con su gemela abierta al lado no cierra nada.
 *
 * ⚠️ **Y eso fue exactamente lo que pasó el 2026-10-10.** El `refine` se mudó a
 * la constante, pero las OTRAS OCHO puertas de dinero ni siquiera usaban
 * `FECHA`: eran `z.string().min(1)` y aceptaban cualquier texto. Ventas,
 * gastos, abonos de pedido, cuotas de préstamo, facturas de compra, sus abonos
 * y sus recepciones. Todas pasan por `new Date(dto.date)` en su servicio, así
 * que el 30 de febrero quedaba guardado el 2 de marzo. Por eso esta tabla las
 * lista TODAS y no solo las de caja.
 */
import type { ZodTypeAny } from 'zod';
import * as API from './api';
import {
  CampaignCreateSchema,
  CampaignUpdateSchema,
  CashBalanceQuerySchema,
  CashReconciliationUpsertSchema,
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  ExpenseWithDefinitionSchema,
  LoanCreateSchema,
  LoanPaymentCreateSchema,
  LoanUpdateSchema,
  OrderCreateSchema,
  OrderUpdateSchema,
  OwnerMovementCreateSchema,
  PaymentCreateSchema,
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseReceiveSchema,
  RangoQuerySchema,
  SaleCreateSchema,
  SaleUpdateSchema,
} from './api';

/** Días que NO existen: mes 13, mes 0, día 0, 31 de un mes de 30, 29/02 no bisiesto. */
const DIAS_INVENTADOS = [
  '2026-02-30',
  '2026-02-29',
  '2026-13-01',
  '2026-00-10',
  '2026-10-32',
  '2026-11-31',
  '2026-04-31',
  '2026-10-00',
];

/** Días reales, incluido el 29 de febrero de un año bisiesto. */
const DIAS_REALES = ['2026-10-10', '2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01'];

/** Cada puerta que usa `FECHA`, con el resto del cuerpo ya válido. */
const PUERTAS: { nombre: string; parse: (date: string) => unknown }[] = [
  {
    nombre: 'POST /cash/movements (OwnerMovementCreateSchema)',
    parse: (date) =>
      OwnerMovementCreateSchema.parse({
        date,
        kind: 'CONTRIBUTION',
        amount: 50,
        concept: 'Puso plata de su bolsillo',
      }),
  },
  {
    nombre: 'PUT /cash/reconciliations (CashReconciliationUpsertSchema)',
    parse: (date) =>
      CashReconciliationUpsertSchema.parse({
        accountId: 'acc-1',
        date,
        totalAmount: 120,
      }),
  },
  {
    nombre: 'GET /cash/balance (CashBalanceQuerySchema)',
    parse: (date) => CashBalanceQuerySchema.parse({ at: date }),
  },
  // --- Las otras ocho puertas: las que ni siquiera usaban `FECHA` ---
  {
    nombre: 'POST /sales (SaleCreateSchema)',
    parse: (date) => SaleCreateSchema.parse({ date, amount: 10 }),
  },
  {
    nombre: 'POST /expenses (ExpenseCreateSchema)',
    parse: (date) =>
      ExpenseCreateSchema.parse({ date, description: 'Cinta de embalaje', amount: 3.5 }),
  },
  {
    nombre: 'POST /expenses/with-definition (ExpenseWithDefinitionSchema)',
    parse: (date) =>
      ExpenseWithDefinitionSchema.parse({
        expense: {
          date,
          amount: 20,
          category: 'CONSUMABLE',
          description: 'Rollo de PLA',
        },
        link: { kind: 'material', mode: 'existing', id: 'mat-1' },
      }),
  },
  {
    nombre: 'POST /orders/:id/payments (PaymentCreateSchema)',
    parse: (date) => PaymentCreateSchema.parse({ date, amount: 25 }),
  },
  {
    nombre: 'POST /loans/:id/payments (LoanPaymentCreateSchema)',
    parse: (date) => LoanPaymentCreateSchema.parse({ date, amount: 40 }),
  },
  {
    nombre: 'POST/PUT /purchase-invoices (PurchaseInvoiceUpsertSchema)',
    parse: (date) =>
      PurchaseInvoiceUpsertSchema.parse({
        date,
        lines: [{ materialId: 'mat-1', quantity: 2, unitPrice: 19 }],
      }),
  },
  {
    nombre: 'POST /purchase-invoices/:id/payments (PurchaseInvoicePaymentSchema)',
    parse: (date) => PurchaseInvoicePaymentSchema.parse({ date, amount: 19 }),
  },
  // La octava puerta, la recepción, es de fecha OPCIONAL (sin fecha = hoy) y
  // por eso vive en `PUERTAS_OPCIONALES`: exigirle una fecha rompería al
  // cliente en vez de cerrar un agujero.
  // --- Y las gemelas de edición, que heredan por `.partial()` ---
  {
    nombre: 'PATCH /sales/:id (SaleUpdateSchema)',
    parse: (date) => SaleUpdateSchema.parse({ date }),
  },
  {
    nombre: 'PATCH /expenses/:id (ExpenseUpdateSchema)',
    parse: (date) => ExpenseUpdateSchema.parse({ date }),
  },
  // --- Las TRES familias que quedaron afuera el 2026-10-10 ---
  // No mueven plata del ledger, y por eso se habían dejado para después. Pero
  // el día corrido se guarda igual: una campaña arrancada el 2 de marzo cuando
  // se escribió el 30 de febrero mide su rendimiento sobre la ventana
  // equivocada, y las otras dos son peores (ver abajo).
  {
    nombre: 'POST /campaigns · startDate (CampaignCreateSchema)',
    parse: (startDate) =>
      CampaignCreateSchema.parse({ name: 'Promo llaveros', startDate }),
  },
  {
    /**
     * Va acá y no en `PUERTAS_OPCIONALES` porque `.partial()` la vuelve
     * `.optional()` pero **no nullable**: ausente sí, `null` no — igual que
     * antes de cerrarla. El panel manda siempre un día (`form.startDate`).
     */
    nombre: 'PATCH /campaigns/:id · startDate (hereda por .partial())',
    parse: (startDate) => CampaignUpdateSchema.parse({ startDate }),
  },
];

/**
 * Las fechas OPCIONALES que cuelgan de esas mismas puertas. Un día inventado
 * tiene que morir igual, pero acá **"sin fecha" es un valor legítimo**: el
 * panel manda `endDate: endDate || null` y la recepción sin fecha significa
 * "hoy". Por eso van en su propia tabla: exigirles una fecha sería romper al
 * cliente, no cerrar un agujero.
 */
const PUERTAS_OPCIONALES: { nombre: string; parse: (date: unknown) => unknown }[] = [
  {
    nombre: 'POST /expenses · endDate (fin de período, p. ej. publicidad)',
    parse: (endDate) =>
      ExpenseCreateSchema.parse({
        date: '2026-10-10',
        description: 'Pauta de octubre',
        amount: 30,
        endDate,
      }),
  },
  {
    nombre: 'POST/PUT /purchase-invoices · expectedAt (cuándo se espera que llegue)',
    parse: (expectedAt) =>
      PurchaseInvoiceUpsertSchema.parse({
        date: '2026-10-10',
        expectedAt,
        lines: [{ materialId: 'mat-1', quantity: 2, unitPrice: 19 }],
      }),
  },
  {
    nombre: 'POST /purchase-invoices/:id/lines/:lineId/receive · date (por defecto, hoy)',
    parse: (date) => PurchaseReceiveSchema.parse({ quantity: 1, date }),
  },
  // --- Las tres familias nuevas, en su variante OPCIONAL ---
  // Las seis siguen siendo `.optional().nullable()` a propósito: el panel manda
  // `endDate: form.endDate || null`, `deliveryDate: deliveryDate || null` y
  // `nextDueDate: nextDueDate || null` y, desde que Deuda cierra préstamos,
  // `closedAt: todayKey()` al cerrar y `closedAt: null` al reabrir — las dos
  // formas tienen que seguir pasando.
  // Volverlas obligatorias rompería la pantalla sin cerrar nada; lo que se
  // cierra es el día inventado.
  {
    nombre: 'POST /campaigns · endDate (null = en curso)',
    parse: (endDate) =>
      CampaignCreateSchema.parse({ name: 'Promo llaveros', startDate: '2026-10-10', endDate }),
  },
  {
    nombre: 'PATCH /campaigns/:id · endDate (hereda por .partial())',
    parse: (endDate) => CampaignUpdateSchema.parse({ endDate }),
  },
  {
    nombre: 'POST /loans · startDate (desde cuándo corre la deuda)',
    parse: (startDate) =>
      LoanCreateSchema.parse({ name: 'Deuda impresora', principal: 400, startDate }),
  },
  {
    // Un vencimiento corrido al mes siguiente es un compromiso MAL FECHADO: el
    // dueño cree que paga el 30 de febrero y la app lo muestra en marzo.
    nombre: 'POST /loans · nextDueDate (el compromiso pactado)',
    parse: (nextDueDate) =>
      LoanCreateSchema.parse({ name: 'Deuda impresora', principal: 400, nextDueDate }),
  },
  {
    nombre: 'POST /loans · closedAt (cuándo se terminó de pagar)',
    parse: (closedAt) =>
      LoanCreateSchema.parse({ name: 'Deuda impresora', principal: 400, closedAt }),
  },
  {
    nombre: 'PATCH /loans/:id · nextDueDate (hereda por .partial())',
    parse: (nextDueDate) => LoanUpdateSchema.parse({ nextDueDate }),
  },
  {
    // SALE IMPRESO en la nota de entrega: una fecha inventada se la mostrás al
    // cliente, corrida al día que el calendario sí tiene.
    nombre: 'POST /orders · deliveryDate (sale en la nota de entrega)',
    parse: (deliveryDate) =>
      OrderCreateSchema.parse({ clientId: 'cli-1', deliveryDate }),
  },
  {
    nombre: 'PATCH /orders/:id · deliveryDate (hereda por .partial())',
    parse: (deliveryDate) => OrderUpdateSchema.parse({ deliveryDate }),
  },
];

describe('FECHA: la forma no alcanza, el día tiene que existir', () => {
  for (const puerta of PUERTAS) {
    describe(puerta.nombre, () => {
      it('un día que no existe en el calendario se RECHAZA', () => {
        for (const basura of DIAS_INVENTADOS) {
          expect(() => puerta.parse(basura)).toThrow();
        }
      });

      it('el hermano alcanzable: un día real sigue pasando', () => {
        for (const bueno of DIAS_REALES) {
          expect(() => puerta.parse(bueno)).not.toThrow();
        }
      });

      it('lo que no tiene la forma AAAA-MM-DD también se rechaza', () => {
        for (const basura of ['', 'hoy', '2026-10', '2026/10/10', '10-10-2026', '2026-10-10T00:00:00Z']) {
          expect(() => puerta.parse(basura)).toThrow();
        }
      });
    });
  }

  for (const puerta of PUERTAS_OPCIONALES) {
    describe(puerta.nombre, () => {
      it('un día que no existe en el calendario se RECHAZA', () => {
        for (const basura of DIAS_INVENTADOS) {
          expect(() => puerta.parse(basura)).toThrow();
        }
      });

      it('el hermano alcanzable: un día real sigue pasando', () => {
        for (const bueno of DIAS_REALES) {
          expect(() => puerta.parse(bueno)).not.toThrow();
        }
      });

      /**
       * El OTRO hermano alcanzable, el que hace que apretar esto no rompa el
       * panel: estos campos se mandan vacíos todos los días.
       */
      it('el otro hermano: sin fecha sigue siendo válido (null, vacío o ausente)', () => {
        for (const vacio of [null, '', undefined]) {
          expect(() => puerta.parse(vacio)).not.toThrow();
        }
      });

      it('lo que no tiene la forma AAAA-MM-DD también se rechaza', () => {
        for (const basura of ['hoy', '2026-10', '2026/10/10', '10-10-2026', '2026-10-10T00:00:00Z']) {
          expect(() => puerta.parse(basura)).toThrow();
        }
      });
    });
  }

  /**
   * El mensaje importa: "La fecha va como AAAA-MM-DD" sobre un `'2026-02-30'`
   * manda a revisar la forma, que está bien, y el dueño no encuentra qué
   * corregir.
   */
  it('el error dice que el día no existe, no que el formato esté mal', () => {
    const r = OwnerMovementCreateSchema.safeParse({
      date: '2026-02-30',
      kind: 'CONTRIBUTION',
      amount: 50,
      concept: 'x',
    });

    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(/calendario/i);
    }
  });

  /**
   * El mismo mensaje en las ocho puertas nuevas. Si una dijera solo "La fecha
   * es obligatoria" sobre un `'2026-02-30'` —el mensaje que tenían antes— la
   * validación estaría puesta pero el dueño seguiría sin saber qué corregir.
   */
  it('las ocho puertas nuevas hablan del calendario, no del formato', () => {
    const errores = [
      SaleCreateSchema.safeParse({ date: '2026-02-30', amount: 10 }),
      ExpenseCreateSchema.safeParse({ date: '2026-02-30', description: 'x', amount: 1 }),
      ExpenseWithDefinitionSchema.safeParse({
        expense: { date: '2026-02-30', amount: 1, category: 'OTHER', description: 'x' },
        link: { kind: 'material', mode: 'existing', id: 'm1' },
      }),
      PaymentCreateSchema.safeParse({ date: '2026-02-30', amount: 1 }),
      LoanPaymentCreateSchema.safeParse({ date: '2026-02-30', amount: 1 }),
      PurchaseInvoiceUpsertSchema.safeParse({
        date: '2026-02-30',
        lines: [{ materialId: 'm1', quantity: 1, unitPrice: 1 }],
      }),
      PurchaseInvoicePaymentSchema.safeParse({ date: '2026-02-30', amount: 1 }),
      PurchaseReceiveSchema.safeParse({ quantity: 1, date: '2026-02-30' }),
    ];

    expect(errores).toHaveLength(8);
    for (const r of errores) {
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(/calendario/i);
      }
    }
  });

  /**
   * Y las TRES familias que quedaron afuera ese día. Mismo mensaje: el dueño
   * tiene que leer que el día no existe, no que el formato esté mal.
   */
  it('las tres familias nuevas (campaña, préstamo, entrega) hablan del calendario', () => {
    const errores = [
      CampaignCreateSchema.safeParse({ name: 'x', startDate: '2026-02-30' }),
      CampaignCreateSchema.safeParse({ name: 'x', startDate: '2026-10-10', endDate: '2026-02-30' }),
      LoanCreateSchema.safeParse({ name: 'x', principal: 1, startDate: '2026-02-30' }),
      LoanCreateSchema.safeParse({ name: 'x', principal: 1, nextDueDate: '2026-02-30' }),
      LoanCreateSchema.safeParse({ name: 'x', principal: 1, closedAt: '2026-02-30' }),
      OrderCreateSchema.safeParse({ clientId: 'c1', deliveryDate: '2026-02-30' }),
    ];

    expect(errores).toHaveLength(6);
    for (const r of errores) {
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(/calendario/i);
      }
    }
  });

  /**
   * LOS FILTROS DE LECTURA, que hasta hoy estaban **afuera a propósito**
   * (`@Query('from') from?: string`, sin DTO ni pipe).
   *
   * No persisten nada, y por eso se habían dejado para después. Pero mienten
   * de la peor manera: `from=2026-02-30` se corre al **2 de marzo** y la lista
   * sale recortada **sin avisar** —ves menos ventas de las que hay y no te
   * enterás—, mientras `to=2026-02-31` se corre al **3 de marzo** y te muestra
   * días que no pediste. Un `?from&to` no escribe, pero es con lo que el dueño
   * mira su plata.
   *
   * ⚠️ **El "sin fecha" tiene que seguir pasando**, en sus tres formas: el
   * panel OMITE el parámetro cuando el preset es "Todo" (los cuatro
   * constructores de params filtran por verdad), y un `''` o un `null` tienen
   * que caer en "sin límite" igual que siempre — es lo que ya hacen los
   * servicios (`if (!from && !to) return {}`).
   */
  describe('RangoQuerySchema — los filtros ?from&to de las listas', () => {
    for (const dia of DIAS_INVENTADOS) {
      it(`el ataque: from=${dia} se rechaza`, () => {
        const r = RangoQuerySchema.safeParse({ from: dia });
        expect(r.success).toBe(false);
      });

      it(`el ataque: to=${dia} se rechaza`, () => {
        expect(RangoQuerySchema.safeParse({ to: dia }).success).toBe(false);
      });
    }

    it('el mensaje habla del calendario, no del formato', () => {
      const r = RangoQuerySchema.safeParse({ from: '2026-02-30' });

      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(/calendario/i);
      }
    });

    it('el hermano alcanzable: un rango REAL pasa y llega entero', () => {
      const r = RangoQuerySchema.safeParse({ from: '2026-02-01', to: '2026-02-28' });

      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    });

    /**
     * ⚠️ El 31 de un mes de 30 es el caso que de verdad mordía: el Dashboard
     * armaba el rango del mes a mano como `${mes}-01` .. `${mes}-31`, así que
     * en febrero el límite superior se corría al **3 de marzo** y la tarjeta
     * del equilibrio contaba hasta tres días del mes siguiente.
     */
    it('el 31 de febrero se rechaza: era el bug REAL del rango del mes', () => {
      expect(RangoQuerySchema.safeParse({ from: '2026-02-01', to: '2026-02-31' }).success).toBe(
        false,
      );
      // Y el 28 del mismo febrero sí: lo que se cierra es el día inventado.
      expect(RangoQuerySchema.safeParse({ from: '2026-02-01', to: '2026-02-28' }).success).toBe(
        true,
      );
    });

    it('el otro hermano: sin rango sigue pasando, en sus tres formas', () => {
      for (const vacio of [{}, { from: '', to: '' }, { from: null, to: null }]) {
        expect(RangoQuerySchema.safeParse(vacio).success).toBe(true);
      }
    });

    it('un ISO con hora NO pasa: el panel manda el día pelado y nada más', () => {
      expect(RangoQuerySchema.safeParse({ from: '2026-02-01T00:00:00.000Z' }).success).toBe(false);
    });

    /** Un parámetro de más no es un error: Zod lo descarta, como en los cuerpos. */
    it('un parámetro que no es del rango se descarta, no rompe', () => {
      const r = RangoQuerySchema.safeParse({ from: '2026-02-01', pagina: '2' });

      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toEqual({ from: '2026-02-01' });
    });
  });

  /**
   * ⚠️ EL INVENTARIO, para que no vuelva a quedar una gemela abierta. Recorre
   * TODOS los schemas de entrada exportados y exige que ningún campo con
   * pinta de fecha (`*Date`, `date`, `closedAt`, `expectedAt`, `at`) acepte un
   * día que no existe. Un campo nuevo que se declare `z.string()` a secas
   * aparece acá y no en la lista de arriba, que hay que acordarse de ampliar.
   */
  it('NINGÚN campo de fecha de NINGÚN schema de entrada acepta el 30 de febrero', () => {
    // ⚠️ `from`, `to` y `month` se SUMARON el 2026-10-10 al cerrar los filtros
    // de lectura: con el patrón viejo (`*date`/`*at`) el inventario **no los
    // miraba**, así que `RangoQuerySchema` podía nacer flojo y el inventario
    // habría dado verde. Van anclados a nombre COMPLETO: con `[a-z]to$`,
    // `photo` entraría como si fuera una fecha.
    const PARECE_FECHA = /^(from|to|month)$|(^|[a-z])(date|at)$/i;
    const abiertos: string[] = [];

    for (const [nombre, schema] of Object.entries(API as Record<string, unknown>)) {
      if (!nombre.endsWith('Schema')) continue;
      // Un `*View`/`*Response` describe lo que SALE, no lo que entra: nadie
      // valida con él un cuerpo del cliente, y su `updatedAt` es un instante
      // real con hora, no un día de negocio.
      if (nombre.endsWith('ViewSchema') || nombre.endsWith('ResponseSchema')) continue;
      const def = (schema as { _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> } })
        ._def;
      if (def?.typeName !== 'ZodObject' || typeof def.shape !== 'function') continue;

      for (const [campo, tipo] of Object.entries(def.shape())) {
        if (!PARECE_FECHA.test(campo)) continue;
        if (tipo.safeParse('2026-02-30').success) abiertos.push(`${nombre}.${campo}`);
      }
    }

    expect(abiertos).toEqual([]);
  });
});
