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
 */
import {
  CashBalanceQuerySchema,
  CashReconciliationUpsertSchema,
  OwnerMovementCreateSchema,
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
});
