/** Ventana de Flash Sale vigente, lista para publicar. */
export interface SaleWindow {
  title: string | null;
  startsAt: string;
  endsAt: string;
}

/**
 * Decide si la ventana de oferta está vigente AHORA. Es la ÚNICA definición de
 * "oferta activa": la usa el endpoint público. Bordes inclusivos.
 */
export function activeSale(
  settings: { saleTitle: string | null; saleStartsAt: Date | null; saleEndsAt: Date | null },
  now: Date,
): SaleWindow | null {
  const { saleTitle, saleStartsAt, saleEndsAt } = settings;
  if (!saleStartsAt || !saleEndsAt) return null;
  if (now < saleStartsAt || now > saleEndsAt) return null;
  return { title: saleTitle, startsAt: saleStartsAt.toISOString(), endsAt: saleEndsAt.toISOString() };
}
