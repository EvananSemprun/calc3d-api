/**
 * Formateo de presentación (no afecta cálculos). Usa Intl con la moneda y
 * locale del usuario.
 */
export function formatMoney(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

/** Formatea una fracción como porcentaje: 0.3 -> "30%". */
export function formatPercent(fraction: number, locale = 'en-US', maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits,
  }).format(fraction);
}
