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
import {
  CashBalanceQuerySchema,
  CashReconciliationUpsertSchema,
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  ExpenseWithDefinitionSchema,
  LoanPaymentCreateSchema,
  OwnerMovementCreateSchema,
  PaymentCreateSchema,
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseReceiveSchema,
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
});
