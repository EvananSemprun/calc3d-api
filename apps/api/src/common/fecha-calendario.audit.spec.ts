/**
 * LAS OCHO PUERTAS DEL 30 DE FEBRERO, CONTRA EL PIPE REAL.
 *
 * El 2026-10-10 se cerró el calendario en las tres puertas de caja, pero las
 * otras ocho —las que mueven el resto de la plata— eran `z.string().min(1)` y
 * aceptaban cualquier texto. `'2026-02-30'` pasaba, su servicio lo metía por
 * `new Date(dto.date)` y Prisma lo guardaba **corrido al 2 de marzo**: la venta
 * o el gasto quedaban en otro mes, el saldo "hasta el 28 de febrero" no los
 * contaba y después aparecían como un descuadre sin causa visible.
 *
 * ⚠️ El schema a secas ya está fijado en `shared` (`fecha-calendario.spec.ts`).
 * Lo que se prueba ACÁ es otra cosa, y es la que de verdad falta: que la
 * validación esté **ENCHUFADA A LA RUTA**. Un schema cerrado con la ruta
 * validando otro —o sin pipe— no cierra nada, y los tipos no lo notan. Por eso
 * va contra el `ZodValidationPipe` REAL y contra la metadata REAL de Nest: un
 * mock probaría el mock.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  CampaignCreateSchema,
  ExpenseCreateSchema,
  ExpenseWithDefinitionSchema,
  LoanCreateSchema,
  LoanPaymentCreateSchema,
  OrderCreateSchema,
  PaymentCreateSchema,
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseReceiveSchema,
  RangoQuerySchema,
  SaleCreateSchema,
} from '@calc3d/shared';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { SalesController } from '../sales/sales.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { OrdersController } from '../orders/orders.module';
import { LoansController } from '../loans/loans.module';
import { PurchaseInvoicesController } from '../purchase-invoices/purchase-invoices.module';
import { CampaignsController } from '../campaigns/campaigns.module';
import { FilamentController } from '../filament/filament.controller';
import { GoalsController } from '../goals/goals.module';
import { PrintersController } from '../printers/printers.module';

/** El 30 de febrero no existe; el 28 sí. Un cuerpo por puerta, igual salvo la fecha. */
const INVENTADO = '2026-02-30';
const REAL = '2026-02-28';

type Puerta = {
  ruta: string;
  /** El controlador y el método, para leer la metadata REAL de Nest. */
  controller: new (...args: never[]) => unknown;
  metodo: string;
  schema: ZodSchema<unknown>;
  /** El cuerpo completo y válido salvo la fecha, que entra por parámetro. */
  cuerpo: (date: string) => unknown;
};

const PUERTAS: Puerta[] = [
  {
    ruta: 'POST /sales',
    controller: SalesController,
    metodo: 'create',
    schema: SaleCreateSchema,
    cuerpo: (date) => ({ date, amount: 10 }),
  },
  {
    ruta: 'POST /expenses',
    controller: ExpensesController,
    metodo: 'create',
    schema: ExpenseCreateSchema,
    cuerpo: (date) => ({ date, description: 'Cinta de embalaje', amount: 3.5 }),
  },
  {
    ruta: 'POST /expenses/with-definition',
    controller: ExpensesController,
    metodo: 'createWithDefinition',
    schema: ExpenseWithDefinitionSchema,
    cuerpo: (date) => ({
      expense: { date, amount: 20, category: 'CONSUMABLE', description: 'Rollo de PLA' },
      link: { kind: 'material', mode: 'existing', id: 'mat-1' },
    }),
  },
  {
    ruta: 'POST /orders/:id/payments',
    controller: OrdersController,
    metodo: 'addPayment',
    schema: PaymentCreateSchema,
    cuerpo: (date) => ({ date, amount: 25 }),
  },
  {
    ruta: 'POST /loans/:id/payments',
    controller: LoansController,
    metodo: 'addPayment',
    schema: LoanPaymentCreateSchema,
    cuerpo: (date) => ({ date, amount: 40 }),
  },
  {
    ruta: 'POST /purchase-invoices',
    controller: PurchaseInvoicesController,
    metodo: 'create',
    schema: PurchaseInvoiceUpsertSchema,
    cuerpo: (date) => ({ date, lines: [{ materialId: 'mat-1', quantity: 2, unitPrice: 19 }] }),
  },
  {
    ruta: 'POST /purchase-invoices/:id/payments',
    controller: PurchaseInvoicesController,
    metodo: 'addPayment',
    schema: PurchaseInvoicePaymentSchema,
    cuerpo: (date) => ({ date, amount: 19 }),
  },
  {
    ruta: 'POST /purchase-invoices/:id/lines/:lineId/receive',
    controller: PurchaseInvoicesController,
    metodo: 'receive',
    schema: PurchaseReceiveSchema,
    cuerpo: (date) => ({ quantity: 1, date }),
  },
];

/** El `@Body` de un método, leído de la metadata de Nest (paramtype 3 = BODY). */
function bodyDeLaRuta(controller: Puerta['controller'], metodo: string) {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, metodo) as
    | Record<string, { index: number; data?: string; pipes: unknown[] }>
    | undefined;
  return Object.entries(meta ?? {}).find(([clave]) => clave.startsWith('3:'))?.[1];
}

/**
 * LAS TRES FAMILIAS QUE NO MUEVEN PLATA DEL LEDGER, y que por eso habían
 * quedado afuera. El día corrido se guarda igual, y dos de las tres duelen:
 * un `nextDueDate` en marzo cuando se escribió el 30 de febrero es un
 * compromiso MAL FECHADO, y un `deliveryDate` inventado **sale impreso en la
 * nota de entrega**: la fecha corrida se la mostrás al cliente.
 *
 * ⚠️ Van en su propia tabla porque su fecha es OPCIONAL (salvo el inicio de
 * campaña): el hermano alcanzable no es solo el día real, es también el "sin
 * fecha", que el panel manda todos los días (`deliveryDate || null`).
 */
const PUERTAS_SIN_DINERO: (Puerta & { campo: string; opcional: boolean })[] = [
  {
    ruta: 'POST /campaigns · startDate',
    controller: CampaignsController,
    metodo: 'create',
    schema: CampaignCreateSchema,
    campo: 'startDate',
    opcional: false,
    cuerpo: (date) => ({ name: 'Promo llaveros', startDate: date }),
  },
  {
    ruta: 'POST /campaigns · endDate',
    controller: CampaignsController,
    metodo: 'create',
    schema: CampaignCreateSchema,
    campo: 'endDate',
    opcional: true,
    cuerpo: (date) => ({ name: 'Promo llaveros', startDate: REAL, endDate: date }),
  },
  {
    ruta: 'POST /loans · startDate',
    controller: LoansController,
    metodo: 'create',
    schema: LoanCreateSchema,
    campo: 'startDate',
    opcional: true,
    cuerpo: (date) => ({ name: 'Deuda impresora', principal: 400, startDate: date }),
  },
  {
    ruta: 'POST /loans · nextDueDate',
    controller: LoansController,
    metodo: 'create',
    schema: LoanCreateSchema,
    campo: 'nextDueDate',
    opcional: true,
    cuerpo: (date) => ({ name: 'Deuda impresora', principal: 400, nextDueDate: date }),
  },
  {
    ruta: 'POST /loans · closedAt',
    controller: LoansController,
    metodo: 'create',
    schema: LoanCreateSchema,
    campo: 'closedAt',
    opcional: true,
    cuerpo: (date) => ({ name: 'Deuda impresora', principal: 400, closedAt: date }),
  },
  {
    ruta: 'POST /orders · deliveryDate',
    controller: OrdersController,
    metodo: 'create',
    schema: OrderCreateSchema,
    campo: 'deliveryDate',
    opcional: true,
    cuerpo: (date) => ({ clientId: 'cli-1', deliveryDate: date }),
  },
];

describe('El día que no existe muere en el pipe de las ocho puertas de dinero', () => {
  it('son ocho, no siete: si se suma una puerta de dinero, se suma acá', () => {
    expect(PUERTAS).toHaveLength(8);
  });

  for (const puerta of PUERTAS) {
    describe(puerta.ruta, () => {
      const pipe = new ZodValidationPipe(puerta.schema);

      it('el ataque: el 30 de febrero se rechaza con 400', () => {
        expect(() => pipe.transform(puerta.cuerpo(INVENTADO))).toThrow(BadRequestException);
      });

      it('el hermano alcanzable: el 28 de febrero pasa', () => {
        expect(() => pipe.transform(puerta.cuerpo(REAL))).not.toThrow();
      });

      /**
       * El pipe suelto no detecta a quien lo saque de la ruta, ni a quien lo
       * deje apuntando a otro schema. Esto sí.
       */
      it('la ruta valida el cuerpo con ZodValidationPipe (metadata real de Nest)', () => {
        const body = bodyDeLaRuta(puerta.controller, puerta.metodo);

        if (!body) throw new Error(`falta @Body(new ZodValidationPipe(...)) en ${puerta.ruta}`);
        expect(body.pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
      });

      /**
       * Y que el pipe de la ruta sea el que acabamos de probar: el mismo
       * ataque, pero por el camino de verdad.
       */
      it('el pipe que la ruta tiene puesto también rechaza el día inventado', () => {
        const body = bodyDeLaRuta(puerta.controller, puerta.metodo);
        const real = body?.pipes.find((p) => p instanceof ZodValidationPipe) as
          | ZodValidationPipe<unknown>
          | undefined;

        if (!real) throw new Error(`falta @Body(new ZodValidationPipe(...)) en ${puerta.ruta}`);
        expect(() => real.transform(puerta.cuerpo(INVENTADO))).toThrow(BadRequestException);
        expect(() => real.transform(puerta.cuerpo(REAL))).not.toThrow();
      });
    });
  }

  /**
   * Las fechas que CUELGAN de esas mismas puertas: el fin de período de un
   * gasto y el "cuándo llega" de una factura. Van aparte porque su hermano
   * alcanzable es otro: **sin fecha tiene que seguir pasando**, y el panel las
   * manda vacías todos los días. Apretarlas a "obligatoria" habría roto la
   * pantalla sin cerrar nada.
   */
  describe('las fechas opcionales que cuelgan de las mismas puertas', () => {
    const gasto = new ZodValidationPipe(ExpenseCreateSchema);
    const factura = new ZodValidationPipe(PurchaseInvoiceUpsertSchema);
    const conEndDate = (endDate: unknown) => ({
      date: '2026-10-10',
      description: 'Pauta de octubre',
      amount: 30,
      endDate,
    });
    const conExpectedAt = (expectedAt: unknown) => ({
      date: '2026-10-10',
      expectedAt,
      lines: [{ materialId: 'mat-1', quantity: 2, unitPrice: 19 }],
    });

    it('POST /expenses · un endDate que no existe es 400', () => {
      expect(() => gasto.transform(conEndDate(INVENTADO))).toThrow(BadRequestException);
    });

    it('POST /expenses · los hermanos: el día real y el "sin fecha" pasan', () => {
      for (const bueno of [REAL, null, '', undefined]) {
        expect(() => gasto.transform(conEndDate(bueno))).not.toThrow();
      }
    });

    it('POST /purchase-invoices · un expectedAt que no existe es 400', () => {
      expect(() => factura.transform(conExpectedAt(INVENTADO))).toThrow(BadRequestException);
    });

    it('POST /purchase-invoices · los hermanos: el día real y el "sin fecha" pasan', () => {
      for (const bueno of [REAL, null, '', undefined]) {
        expect(() => factura.transform(conExpectedAt(bueno))).not.toThrow();
      }
    });
  });
});

describe('Y las tres familias que no mueven plata, por el mismo camino real', () => {
  it('son seis campos en tres familias: campaña, préstamo y entrega', () => {
    expect(PUERTAS_SIN_DINERO).toHaveLength(6);
  });

  for (const puerta of PUERTAS_SIN_DINERO) {
    describe(puerta.ruta, () => {
      const pipe = new ZodValidationPipe(puerta.schema);

      it('el ataque: el 30 de febrero se rechaza con 400', () => {
        expect(() => pipe.transform(puerta.cuerpo(INVENTADO))).toThrow(BadRequestException);
      });

      it('el hermano alcanzable: el 28 de febrero pasa', () => {
        expect(() => pipe.transform(puerta.cuerpo(REAL))).not.toThrow();
      });

      if (puerta.opcional) {
        it('el otro hermano: sin fecha sigue pasando (es lo que manda el panel)', () => {
          for (const vacio of [null, '', undefined]) {
            expect(() =>
              pipe.transform(puerta.cuerpo(vacio as unknown as string)),
            ).not.toThrow();
          }
        });
      }

      it('la ruta valida el cuerpo con ZodValidationPipe (metadata real de Nest)', () => {
        const body = bodyDeLaRuta(puerta.controller, puerta.metodo);

        if (!body) throw new Error(`falta @Body(new ZodValidationPipe(...)) en ${puerta.ruta}`);
        expect(body.pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
      });

      it('el pipe que la ruta tiene puesto también rechaza el día inventado', () => {
        const body = bodyDeLaRuta(puerta.controller, puerta.metodo);
        const real = body?.pipes.find((p) => p instanceof ZodValidationPipe) as
          | ZodValidationPipe<unknown>
          | undefined;

        if (!real) throw new Error(`falta @Body(new ZodValidationPipe(...)) en ${puerta.ruta}`);
        expect(() => real.transform(puerta.cuerpo(INVENTADO))).toThrow(BadRequestException);
        expect(() => real.transform(puerta.cuerpo(REAL))).not.toThrow();
      });
    });
  }
});

/**
 * LOS FILTROS DE LECTURA `?from&to`, que estaban AFUERA a proposito.
 *
 * Eran `@Query('from') from?: string` sin DTO ni pipe en los cuatro
 * controladores. No persisten nada --por eso se habian dejado para despues--
 * pero mienten en las DOS direcciones: `from=2026-02-30` arranca el 2 de marzo
 * y la lista sale recortada **sin avisar**, y `to=2026-02-31` termina el 3 de
 * marzo y muestra dias que nadie pidio.
 *
 * ⚠️ Lo que se prueba aca NO es el schema (eso ya esta en `shared`), es que
 * el pipe este **ENCHUFADO A LA RUTA**: un `RangoQuerySchema` impecable con
 * `@Query('from')` al lado no cierra nada, y los tipos no lo notan. Por eso se
 * lee la metadata REAL de Nest, y con el paramtype de QUERY (4) y no el de
 * BODY (3): un pipe puesto en el cuerpo de una ruta que lee de la query
 * pasaria la mitad de las comprobaciones.
 *
 * ⚠️ **Y LOS QUINTOS.** El barrido encontro dos filtros de lectura mas con
 * el mismo defecto y su gemela YA cerrada al lado: `GET /goals?month=`
 * (mientras `GET /goals/actuals` si valida con un schema) y
 * `GET /printers/readings` (mientras `GET /filament/stock|status|summary` usan
 * `MonthSchema`). El de lecturas compara `r.month < month` como TEXTO, asi que
 * un `2026-13` deja entrar todo 2026 y la "lectura anterior" sale de otro mes
 * -- el mismo error de comparar texto que ya habia mordido en
 * `CashBalanceQuerySchema`.
 */
const FILTROS_DE_RANGO = [
  { ruta: 'GET /sales', controller: SalesController, metodo: 'list' },
  { ruta: 'GET /expenses', controller: ExpensesController, metodo: 'list' },
  { ruta: 'GET /orders/payments', controller: OrdersController, metodo: 'listPayments' },
  { ruta: 'GET /filament/purchases', controller: FilamentController, metodo: 'purchases' },
] as const;

/** Los filtros por MES, con el mismo defecto y su propia forma (`AAAA-MM`). */
const FILTROS_DE_MES = [
  { ruta: 'GET /goals', controller: GoalsController, metodo: 'list' },
  { ruta: 'GET /printers/readings', controller: PrintersController, metodo: 'readings' },
] as const;

/** El `@Query` de un metodo, leido de la metadata de Nest (paramtype 4 = QUERY). */
function queryDeLaRuta(controller: new (...args: never[]) => unknown, metodo: string) {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, metodo) as
    | Record<string, { index: number; data?: string; pipes: unknown[] }>
    | undefined;
  return Object.entries(meta ?? {})
    .filter(([clave]) => clave.startsWith('4:'))
    .map(([, valor]) => valor);
}

/** El ZodValidationPipe que la ruta tiene puesto en su `@Query`. */
function pipeDeLaQuery(controller: new (...args: never[]) => unknown, metodo: string) {
  return queryDeLaRuta(controller, metodo)[0]?.pipes.find((p) => p instanceof ZodValidationPipe) as
    | ZodValidationPipe<unknown>
    | undefined;
}

describe('Los filtros de lectura ?from&to validan el calendario en la ruta', () => {
  it('son cuatro: si aparece una lista con rango de fechas, se suma aca', () => {
    expect(FILTROS_DE_RANGO).toHaveLength(4);
  });

  const pipe = new ZodValidationPipe(RangoQuerySchema);

  it('el ataque: un from que no existe se rechaza con 400', () => {
    expect(() => pipe.transform({ from: INVENTADO })).toThrow(BadRequestException);
  });

  it('el ataque por el otro extremo: el 31 de febrero tampoco pasa', () => {
    expect(() => pipe.transform({ from: '2026-02-01', to: '2026-02-31' })).toThrow(
      BadRequestException,
    );
  });

  it('el hermano alcanzable: un rango real pasa', () => {
    expect(() => pipe.transform({ from: '2026-02-01', to: REAL })).not.toThrow();
  });

  it('el otro hermano: sin rango sigue pasando (es el preset "Todo")', () => {
    for (const vacio of [{}, { from: '', to: '' }, { from: null, to: null }]) {
      expect(() => pipe.transform(vacio)).not.toThrow();
    }
  });

  for (const filtro of FILTROS_DE_RANGO) {
    describe(filtro.ruta, () => {
      it('la ruta valida la QUERY con ZodValidationPipe (metadata real de Nest)', () => {
        const queries = queryDeLaRuta(filtro.controller, filtro.metodo);

        if (queries.length === 0) throw new Error(`${filtro.ruta} no lee nada de la query`);
        // ⚠️ Un `@Query('from')` suelto NO puede quedar: con el pipe al lado
        // de un parametro sin validar, el otro extremo del rango sigue abierto.
        expect(queries).toHaveLength(1);
        expect(queries[0].data).toBeUndefined();
        expect(queries[0].pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
      });

      it('el pipe que la ruta tiene puesto rechaza el dia inventado y deja pasar el real', () => {
        const real = pipeDeLaQuery(filtro.controller, filtro.metodo);

        if (!real) throw new Error(`falta @Query(new ZodValidationPipe(...)) en ${filtro.ruta}`);
        expect(() => real.transform({ from: INVENTADO })).toThrow(BadRequestException);
        expect(() => real.transform({ to: INVENTADO })).toThrow(BadRequestException);
        expect(() => real.transform({ from: REAL, to: REAL })).not.toThrow();
        expect(() => real.transform({})).not.toThrow();
      });
    });
  }
});

describe('Y los QUINTOS: los filtros por mes que tenian su gemela ya cerrada', () => {
  it('son dos: metas y lecturas de impresora', () => {
    expect(FILTROS_DE_MES).toHaveLength(2);
  });

  for (const filtro of FILTROS_DE_MES) {
    describe(filtro.ruta, () => {
      it('la ruta valida el mes con ZodValidationPipe (metadata real de Nest)', () => {
        const queries = queryDeLaRuta(filtro.controller, filtro.metodo);

        if (queries.length === 0) throw new Error(`${filtro.ruta} no lee nada de la query`);
        expect(queries[0].pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
      });

      it('el pipe de la ruta rechaza un mes imposible y deja pasar el real', () => {
        const real = pipeDeLaQuery(filtro.controller, filtro.metodo);

        if (!real) throw new Error(`falta el pipe en ${filtro.ruta}`);
        // `2026-13` es el que de verdad miente: la comparacion por TEXTO
        // (`r.month < month`) lo deja entrar y arrastra todo 2026.
        for (const malo of ['2026-13', '2026-00', '2026-1', 'hola']) {
          expect(() => real.transform(malo)).toThrow(BadRequestException);
        }
      });

      it('el hermano alcanzable: un mes real pasa', () => {
        const real = pipeDeLaQuery(filtro.controller, filtro.metodo);

        if (!real) throw new Error(`falta el pipe en ${filtro.ruta}`);
        expect(() => real.transform('2026-02')).not.toThrow();
      });
    });
  }
});
