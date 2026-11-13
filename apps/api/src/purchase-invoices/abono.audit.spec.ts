/**
 * EL ABONO SIN MONTO MUERE EN EL PIPE, NO EN PRISMA.
 *
 * `addPayment` trata `amount` como obligatorio cuando no hay par foráneo, pero
 * el tipo lo declara opcional (en otra moneda no viaja). Lo único que impide
 * que un `amount` ausente llegue a Prisma como `undefined` es el `superRefine`
 * del schema, **enchufado a la ruta**. Un schema cerrado con la ruta sin pipe
 * no cierra nada, y los tipos no lo notan: por eso se prueba contra el
 * `ZodValidationPipe` REAL y la metadata REAL de Nest, como
 * `common/fecha-calendario.audit.spec.ts`.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PurchaseInvoicesController } from './purchase-invoices.module';

function pipeDeLaRuta(): ZodValidationPipe<unknown> {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, PurchaseInvoicesController, 'addPayment') as
    | Record<string, { pipes: unknown[] }>
    | undefined;
  // paramtype 3 = BODY
  const body = Object.entries(meta ?? {}).find(([k]) => k.startsWith('3:'))?.[1];
  const pipe = body?.pipes.find((p) => p instanceof ZodValidationPipe);
  if (!pipe) throw new Error('falta @Body(new ZodValidationPipe(...)) en POST /purchase-invoices/:id/payments');
  return pipe as ZodValidationPipe<unknown>;
}

describe('POST /purchase-invoices/:id/payments — el monto, en el pipe real de la ruta', () => {
  it('sin monto y sin par foráneo → 400 (no llega a Prisma como undefined)', () => {
    expect(() => pipeDeLaRuta().transform({ date: '2026-11-12' })).toThrow(BadRequestException);
  });

  it('hermano: con monto en USD pasa', () => {
    expect(() => pipeDeLaRuta().transform({ date: '2026-11-12', amount: 10 })).not.toThrow();
  });

  it('hermano: sin monto pero con el par foráneo completo también pasa', () => {
    expect(() =>
      pipeDeLaRuta().transform({ date: '2026-11-12', currencyLabel: 'Binance / USDT', amountForeign: 1900 }),
    ).not.toThrow();
  });
});
