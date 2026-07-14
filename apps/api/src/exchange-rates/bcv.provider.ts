/**
 * Tasas oficiales BCV vía DolarApi (https://ve.dolarapi.com) — pública, sin API key.
 * Respuesta de cada endpoint: { promedio: number, ... } (Bs por 1 unidad).
 * La base del sistema es USD, así que las tasas se expresan como "destino por 1 USD".
 */
const BCV_USD_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
const BCV_EUR_URL = 'https://ve.dolarapi.com/v1/dolares/oficial_euro';

async function fetchPromedio(url: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Proveedor BCV respondió HTTP ${res.status}`);
  const data = (await res.json()) as { promedio?: number };
  const rate = Number(data?.promedio);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Proveedor BCV: tasa inválida');
  return rate;
}

export type BcvFetcher = () => Promise<{ rate: number }>;

/** Dólar BCV: Bs por 1 USD (destino VES). */
export const fetchBcvRate: BcvFetcher = async () => ({ rate: await fetchPromedio(BCV_USD_URL) });

/**
 * Euro BCV como € por 1 USD (destino EUR). Se deriva del cruce Bs/USD ÷ Bs/EUR.
 * Best-effort: si el endpoint del euro no está disponible, lanza y el caller lo
 * degrada a manual (nunca bloquea).
 */
export const fetchBcvEuroRate: BcvFetcher = async () => {
  const [usdBs, eurBs] = await Promise.all([fetchPromedio(BCV_USD_URL), fetchPromedio(BCV_EUR_URL)]);
  const eurPerUsd = usdBs / eurBs; // 1 USD = (Bs/USD) / (Bs/EUR) euros
  if (!Number.isFinite(eurPerUsd) || eurPerUsd <= 0) throw new Error('Cruce EUR inválido');
  return { rate: eurPerUsd };
};
