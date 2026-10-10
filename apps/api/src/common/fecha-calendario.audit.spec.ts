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
  ExpenseCreateSchema,
  ExpenseWithDefinitionSchema,
  LoanPaymentCreateSchema,
  PaymentCreateSchema,
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseReceiveSchema,
  SaleCreateSchema,
} from '@calc3d/shared';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { SalesController } from '../sales/sales.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { OrdersController } from '../orders/orders.module';
import { LoansController } from '../loans/loans.module';
import { PurchaseInvoicesController } from '../purchase-invoices/purchase-invoices.module';

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
