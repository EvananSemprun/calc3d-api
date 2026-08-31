/** Formateo común de los documentos del negocio (número, fechas, validez). */

/** Días que una cotización sigue siendo válida desde su emisión. */
export const QUOTE_VALIDITY_DAYS = 15;

/**
 * N.º de documento: correlativo de 3 dígitos + año, como en la plantilla
 * ("001-2026"). Sin correlativo (presupuestos anteriores a la columna `code`)
 * cae a "S/N-{año}" en vez de inventar un número.
 */
export function documentNumber(code: number | null | undefined, at: Date): string {
  const year = new Date(at).getUTCFullYear();
  if (code == null) return `S/N-${year}`;
  return `${String(code).padStart(3, '0')}-${year}`;
}

/**
 * Fecha corta venezolana (dd/mm/aaaa) leída en **UTC**, igual que el calendario
 * de pedidos. `deliveryDate` se guarda como fecha sin hora (medianoche UTC): si
 * se formateara en la zona local, en Venezuela (UTC−4) el documento imprimiría
 * el día ANTERIOR al pactado.
 */
export function formatDate(at: Date | string): string {
  return new Date(at).toLocaleDateString('es-VE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Fecha de vencimiento de una cotización emitida en `at` (en UTC, ver arriba). */
export function validUntil(at: Date | string, days = QUOTE_VALIDITY_DAYS): Date {
  const d = new Date(at);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
