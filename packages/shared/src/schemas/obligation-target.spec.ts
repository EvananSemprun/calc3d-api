import { OBLIGATION_SOURCES, type ObligationSource } from '../calc/obligations';
import {
  CashReconciliationConfirmSchema,
  CashShortfallPlanQuerySchema,
  ObligationSourceSchema,
  type ObligationSourceDto,
} from './api';

/**
 * LA DEUDA DESTINO DEL FALTANTE.
 *
 * El dueño puede decir contra qué deuda va el faltante de una conciliación.
 * Es plata: lo que llega por la red tiene que estar cerrado en tiempo de
 * ejecución, no solo por tipos (que se borran al compilar).
 */
describe('ObligationSourceSchema', () => {
  it('declara exactamente los orígenes del motor, en el mismo orden', () => {
    expect(ObligationSourceSchema.options).toEqual([...OBLIGATION_SOURCES]);
  });

  it('un origen inventado no pasa', () => {
    for (const basura of ['SALE', '', 'expense', 'EXPENSE ', 'MOVEMENT;--', null, 7]) {
      expect(ObligationSourceSchema.safeParse(basura).success).toBe(false);
    }
  });

  it('los dos tipos son intercambiables', () => {
    const delMotor: ObligationSource = 'LOAN_PAYMENT';
    const delContrato: ObligationSourceDto = delMotor;
    const vuelta: ObligationSource = delContrato;

    expect(vuelta).toBe('LOAN_PAYMENT');
  });
});

describe('CashReconciliationConfirmSchema — la deuda destino', () => {
  const base = { attributeShortfall: true };

  it('sin destino sigue siendo válido y no agrega nada', () => {
    const r = CashReconciliationConfirmSchema.safeParse({});

    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ attributeShortfall: true });
  });

  it('acepta un destino completo', () => {
    const r = CashReconciliationConfirmSchema.safeParse({
      ...base,
      targetSource: 'EXPENSE',
      targetSourceId: 'g2',
    });

    expect(r.success && r.data).toMatchObject({ targetSource: 'EXPENSE', targetSourceId: 'g2' });
  });

  it('un origen fuera del enum es 400, no un destino ignorado', () => {
    for (const malo of ['SALE', 'expense', '', 'DROP TABLE']) {
      expect(
        CashReconciliationConfirmSchema.safeParse({ ...base, targetSource: malo, targetSourceId: 'g2' })
          .success,
      ).toBe(false);
    }
  });

  it('medio destino no identifica nada: se rechaza', () => {
    expect(
      CashReconciliationConfirmSchema.safeParse({ ...base, targetSource: 'EXPENSE' }).success,
    ).toBe(false);
    expect(
      CashReconciliationConfirmSchema.safeParse({ ...base, targetSourceId: 'g2' }).success,
    ).toBe(false);
    expect(
      CashReconciliationConfirmSchema.safeParse({ ...base, targetSource: 'EXPENSE', targetSourceId: '  ' })
        .success,
    ).toBe(false);
  });

  it('elegir una deuda y a la vez NO atribuir es contradictorio: se rechaza', () => {
    const r = CashReconciliationConfirmSchema.safeParse({
      attributeShortfall: false,
      targetSource: 'EXPENSE',
      targetSourceId: 'g2',
    });

    expect(r.success).toBe(false);
  });

  it('los campos que calcula el servidor siguen sin viajar en el body', () => {
    const r = CashReconciliationConfirmSchema.safeParse({
      ...base,
      targetSource: 'EXPENSE',
      targetSourceId: 'g2',
      organizationId: 'org-ajena',
      expectedUsd: 0,
      differenceUsd: 0,
      status: 'CONFIRMED',
    });

    expect(r.success).toBe(true);
    expect(Object.keys(r.success ? r.data : {}).sort()).toEqual([
      'attributeShortfall',
      'targetSource',
      'targetSourceId',
    ]);
  });
});

describe('CashShortfallPlanQuerySchema', () => {
  it('sin destino es válido: previsualiza el reparto por el orden configurado', () => {
    expect(CashShortfallPlanQuerySchema.safeParse({}).success).toBe(true);
  });

  it('exige los dos campos del destino, o ninguno', () => {
    expect(CashShortfallPlanQuerySchema.safeParse({ targetSourceId: 'g2' }).success).toBe(false);
    expect(
      CashShortfallPlanQuerySchema.safeParse({ targetSource: 'MOVEMENT', targetSourceId: 'mv1' })
        .success,
    ).toBe(true);
  });

  it('un origen inventado en la query es 400', () => {
    expect(
      CashShortfallPlanQuerySchema.safeParse({ targetSource: 'SALE', targetSourceId: 'g2' }).success,
    ).toBe(false);
  });
});
