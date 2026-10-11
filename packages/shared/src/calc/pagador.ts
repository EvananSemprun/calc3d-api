/**
 * QUIÉN PUSO LA PLATA (2026-10-11).
 *
 * Dos lecturas del MISMO hecho y una sola definición: la línea chica de cada
 * compra en Filamento → Compras (`notaDePagador`) y el pie del KPI de Gastos
 * del Dashboard (`repartoDePagadores` + `textoDeReparto`), que es ese mismo
 * hecho sumado. Viven juntos a propósito: dos lugares calculando "cuánto de
 * esto pagó la caja" es exactamente el bug que produjo este lío — el Dashboard
 * mostraba «Resultado de caja −$61.20» al lado de «Saldo en caja $102.83»,
 * calculados por caminos distintos, y el dueño leyó el primero como un saldo.
 *
 * La pantalla de Compras listaba $202 en octubre de 2026 y la caja del negocio
 * solo había soltado $142. Los $60 de diferencia estaban todos a la vista en la
 * base y en ninguna parte en la tabla: dos rollos los pagó el dueño de su
 * bolsillo (el negocio se los debe) y un tercero entró por una factura que se
 * abonó a medias. Mirando la tabla era imposible saberlo, así que la caja
 * parecía mentir.
 *
 * ⚠️ **EL SILENCIO ES EL CASO NORMAL.** Una compra que pagó la caja y está
 * saldada no dice nada. Si todas las filas llevaran etiqueta, ninguna se vería
 * y el aviso no avisaría de nada: hablan solo las excepciones.
 *
 * ⚠️ **NO SE REPARTE EL SALDO DE UNA FACTURA ENTRE SUS LÍNEAS.** Un rollo que
 * entró por factura **no tiene pagador propio**: lo que se paga es la factura.
 * Si una factura de $100 con cuatro líneas tiene $60 abonados, decir "a este
 * rollo le faltan $10" es una convención inventada escrita como si fuera un
 * hecho — y de esas sale alguien cuadrando una caja con un número que nadie
 * calculó. Por eso el texto nombra a la FACTURA como sujeto, y cuando tiene más
 * de una línea lo dice de frente.
 */
import type { FilamentPurchase, FilamentPurchaseInvoice } from '../schemas/stock';
import { D, toCents } from './money';

/** Lo único que hace falta saber de una compra para contar quién la pagó. */
export type CompraParaPagador = Pick<
  FilamentPurchase,
  'counterpartyId' | 'counterpartyName' | 'counterpartyKind' | 'invoice'
>;

/**
 * DE DÓNDE SALIÓ LA PLATA DE LOS ABONOS DE UNA FACTURA, en texto corto, o
 * `null` cuando salió toda de la caja.
 *
 * ⚠️ **Con más de un origen se dice el total y no el detalle.** Esta frase vive
 * en una celda de tabla, debajo del nombre del proveedor: el detalle completo
 * la parte en tres renglones y deja de leerse. Cuando hay un solo origen —lo
 * normal— se nombra; cuando hay varios, lo que importa en esta pantalla es que
 * esa plata **no salió de la caja**, y el desglose se mira en Compras, que es
 * adonde ibas a ir igual.
 *
 * "No salió de la caja" es cierto para los tres: el bolsillo de alguien, el
 * saldo a favor (esa plata salió antes) y el prestamista.
 */
function origenDeLosAbonos(f: FilamentPurchaseInvoice, money: FormatoDeMonto): string | null {
  const { bolsillo, saldoAFavor, prestamista } = f.abonado;
  const fuera = bolsillo + saldoAFavor + prestamista;
  if (fuera <= 0) return null;

  const origenes = [bolsillo, saldoAFavor, prestamista].filter((x) => x > 0).length;
  if (origenes > 1) return `${money(fuera)} no salió de la caja`;

  if (bolsillo > 0) {
    return f.bolsillos.length === 1
      ? `${money(bolsillo)} lo puso ${f.bolsillos[0]}`
      : `${money(bolsillo)} de bolsillo`;
  }
  if (saldoAFavor > 0) return `${money(saldoAFavor)} con saldo a favor`;
  return `${money(prestamista)} lo puso el prestamista`;
}

/** Cómo se escribe un monto: lo pone quien llama (el panel formatea con la moneda del dueño). */
export type FormatoDeMonto = (n: number) => string;

/** Cuando no se sabe el nombre de quien puso la plata, pero sí que no fue la caja. */
const ALGUIEN = 'otra persona';

/**
 * La línea chica que va debajo del proveedor, o `null` si no hay nada que decir.
 *
 * Los cuatro casos, en este orden:
 * 1. **Entró por una factura con saldo** → el estado de la FACTURA:
 *    `"Faltan $10.00 de esta factura"`. Con varias líneas, `"Faltan $40.00 de
 *    la factura entera (4 líneas)"`: el monto cubre más que este rollo y el
 *    texto no puede dejar que se lea de otra manera.
 * 2. **Entró por una factura saldada** → `null`. Ya no falta plata, y decirlo
 *    sería justo el ruido que esconde a las filas que sí tienen algo que contar.
 * 3. **Compra directa que puso una persona** → `"Lo puso Evanan · el negocio se
 *    lo debe"`. Acá sí hay pagador propio: es `Expense.counterpartyId`.
 * 4. **Compra directa de la caja** → `null`, el caso normal.
 *
 * ⚠️ **La factura gana sobre la contraparte** si por algún camino llegaran las
 * dos: la plata de una compra nacida de una factura la movieron los abonos de
 * esa factura, así que es su estado el que explica la caja. (Hoy no puede
 * pasar: el gasto que nace al recibir una línea no lleva contraparte.)
 */
export function notaDePagador(c: CompraParaPagador, money: FormatoDeMonto): string | null {
  if (c.invoice) {
    const partes: string[] = [];

    // ⚠️ `saldo` NO se recalcula acá: viene de `invoiceTotals`, que es la única
    // definición de "lo que falta pagar" en el proyecto.
    if (c.invoice.saldo > 0) {
      // ⚠️ **No se repite el nombre del proveedor**: la nota va justo DEBAJO de
      // ese nombre, en la misma celda, y repetirlo triplicaba el alto de la fila
      // (medido: 3 renglones en el caso de varias líneas). Lo que no puede
      // faltar es el SUJETO, que es la factura.
      partes.push(
        c.invoice.lineas > 1
          ? `Faltan ${money(c.invoice.saldo)} de la factura entera (${c.invoice.lineas} líneas)`
          : `Faltan ${money(c.invoice.saldo)} de esta factura`,
      );
    }

    // ⚠️ **Una factura SALDADA puede igual tener algo que decir**: si la abonó
    // alguien de su bolsillo, la plata no salió de la caja y el negocio se la
    // debe. Hasta shared 0.50.0 ese caso devolvía `null` y la fila se callaba
    // justo cuando más tenía para contar.
    const origen = origenDeLosAbonos(c.invoice, money);
    if (origen) partes.push(origen);

    return partes.length > 0 ? partes.join(' · ') : null;
  }

  if (c.counterpartyId == null) return null;
  // ⚠️ Lo del prestamista NO lleva "el negocio se lo debe": esa deuda ya vive
  // en el saldo del préstamo, y prometerla también acá la cuenta dos veces.
  if (c.counterpartyKind === 'EXTERNAL_LENDER') return 'Lo puso el prestamista';
  return `Lo puso ${c.counterpartyName ?? ALGUIEN} · el negocio se lo debe`;
}

// ----- El mismo hecho, SUMADO: el pie del KPI de Gastos -----
//
// El dueño leyó «GASTOS $202.00» en el Dashboard y creyó que la caja había
// soltado $202. Soltó $142: $50 los puso él de su bolsillo y $10 todavía no se
// pagaron. El KPI no mentía — decía cuánto se gastó, que es otra pregunta—,
// pero sin el desglose al lado no hay manera de leerlo bien.

/** Un gasto del periodo, visto por la única pregunta de acá: ¿de dónde salió la plata? */
export interface GastoParaPagador extends CompraParaPagador {
  amount: number;
}

/** El total del periodo, partido en de dónde salió cada parte. */
export interface RepartoDePagadores {
  /** Σ de todo lo que entró: **es el mismo número que muestra el KPI**. */
  total: number;
  /** Lo que de verdad salió de la caja del negocio. Es el RESIDUO: ver abajo. */
  caja: number;
  /** Lo que puso alguien de su bolsillo. El negocio se lo debe. */
  deBolsillo: number;
  /**
   * Lo abonado con **saldo a favor** del proveedor. No movió plata en este
   * periodo: ya había salido el día que se pagó de más.
   */
  conSaldoAFavor: number;
  /**
   * Lo que puso el **prestamista**. No toca la caja y no se le debe por acá:
   * esa deuda ya vive en el saldo del préstamo.
   */
  delPrestamista: number;
  /** Lo que todavía no se pagó: la parte sin abonar de las facturas. */
  sinPagar: number;
  /** Quiénes pusieron plata de su bolsillo, sin repetir y en orden. Vacío = nadie. */
  nombres: string[];
}

/**
 * CÓMO SE REPARTE EL TOTAL DEL PERIODO.
 *
 * ⚠️ **`caja` es el RESIDUO, no una cuarta suma.** `total − deBolsillo −
 * sinPagar` cierra contra el total por construcción, y eso es lo que hace
 * creíble al pie: parado al lado del KPI, un desglose que no suma destruye la
 * confianza en los dos números. Sumando las tres por separado, un redondeo las
 * dejaría peleadas.
 *
 * ⚠️ **EL SALDO DE UNA FACTURA SE PRORRATEA, Y ESO ES UNA CONVENCIÓN, NO UN
 * HECHO** — la misma de `filamentShare` en `cash.ts`. Un abono de $60 contra
 * una factura de cuatro líneas no "fue" a una línea concreta: para poder decir
 * qué parte de los gastos de ESTE periodo quedó sin pagar, a cada factura se le
 * imputa `lo suyo en el periodo × (saldo ÷ total de la factura)`. Con facturas
 * de una sola cosa —lo normal en este negocio— el reparto es exacto. La
 * pantalla de Compras **no prorratea nada**: ahí el saldo se dice entero y de
 * la factura, que es el hecho.
 *
 * Como `saldo ≤ total`, lo imputado nunca pasa de lo que esa factura aportó al
 * periodo, así que las tres partes siempre son ≥ 0.
 *
 * ⚠️ **Una factura de varias líneas no cuenta su saldo una vez por línea**:
 * cada gasto lleva solo SU parte, que es lo que hace el prorrateo. Sumar
 * `invoice.saldo` fila por fila daría $160 sin pagar de un total de $100.
 *
 * ⚠️ **Con factura y contraparte a la vez gana la factura**, igual que en
 * `notaDePagador`: la plata de un gasto nacido de una factura la movieron los
 * abonos de esa factura. (Hoy no puede pasar: el gasto que nace al recibir una
 * línea no lleva contraparte.)
 */
export function repartoDePagadores(gastos: GastoParaPagador[]): RepartoDePagadores {
  let total = D(0);
  let deBolsillo = D(0);
  let conSaldoAFavor = D(0);
  let delPrestamista = D(0);
  let sinPagar = D(0);
  const nombres: string[] = [];
  const sumarNombre = (n: string) => {
    if (!nombres.includes(n)) nombres.push(n);
  };

  for (const g of gastos) {
    const monto = D(g.amount);
    total = total.plus(monto);

    if (g.invoice) {
      // ⚠️ **Cada gasto lleva SOLO su parte del saldo**, que es lo que impide
      // que una factura de cuatro líneas cuente su saldo cuatro veces ($160
      // sin pagar de un total de $100). Por eso no hace falta agrupar por
      // factura: la fracción ya reparte. Se escribió con un `Map` por id y la
      // verificación por mutación lo destapó —desarmar la agrupación no
      // tumbaba un solo test, porque `Σ monto × (saldo ÷ total)` da lo mismo
      // agrupado que suelto—. Código muerto donde se decide un número que el
      // dueño va a leer como plata es peor que no tenerlo: parece una guarda.
      //
      // Una factura sin total (o con el total en cero) no tiene fracción
      // posible: no se inventa una. Con `saldo` en 0 no hay nada que imputar.
      if (g.invoice.total <= 0) continue;

      const f = g.invoice;
      const fraccionSinPagar = Math.min(f.saldo / f.total, 1);
      if (fraccionSinPagar > 0) sinPagar = sinPagar.plus(monto.times(fraccionSinPagar));

      // ⚠️ **DE DÓNDE SALIÓ LO QUE SÍ SE ABONÓ** (2026-10-11). Hasta acá todo
      // lo pagado caía en `caja` por residuo, y el diálogo de Abonar deja
      // elegir otra cosa: bastaba un abono de bolsillo para que el pie dijera
      // que esa plata salió del negocio. Un número de plata que miente sin
      // avisar es peor que uno que falta.
      //
      // La parte pagada de este gasto es `monto × (1 − fracciónSinPagar)`, y
      // se reparte entre los orígenes a prorrata de lo que cada uno abonó.
      // `abonado.total` es el denominador correcto y NO `f.total`: si se pagó
      // de más, el excedente es `aFavor` y no corresponde a esta factura, pero
      // los orígenes siguen estando en la misma proporción entre sí.
      if (f.abonado.total > 0) {
        const porAbono = monto.times(1 - fraccionSinPagar).div(f.abonado.total);
        if (f.abonado.bolsillo > 0) {
          deBolsillo = deBolsillo.plus(porAbono.times(f.abonado.bolsillo));
          for (const n of f.bolsillos) sumarNombre(n);
        }
        if (f.abonado.saldoAFavor > 0) {
          conSaldoAFavor = conSaldoAFavor.plus(porAbono.times(f.abonado.saldoAFavor));
        }
        if (f.abonado.prestamista > 0) {
          delPrestamista = delPrestamista.plus(porAbono.times(f.abonado.prestamista));
        }
      }
      continue;
    }

    if (g.counterpartyId != null) {
      // ⚠️ Lo del prestamista NO es bolsillo: no toca la caja y su deuda ya
      // vive en el saldo del préstamo. Es la misma distinción que hace
      // `generaObligacion` en `cash.ts`, y meterlos juntos contaría esa deuda
      // dos veces. Tampoco entra en `nombres`: el pie lo nombra aparte.
      if (g.counterpartyKind === 'EXTERNAL_LENDER') {
        delPrestamista = delPrestamista.plus(monto);
      } else {
        deBolsillo = deBolsillo.plus(monto);
        sumarNombre(g.counterpartyName ?? ALGUIEN);
      }
    }
  }

  const totalC = toCents(total);
  // ⚠️ Los pedazos son subconjuntos DISJUNTOS del total, así que sin redondear
  // nunca lo pasan. Redondeando cada uno por su cuenta sí pueden, por un
  // centavo, y ahí `caja` saldría en −$0.01: un número imposible en el pie de
  // un KPI. Los topes son contra el redondeo y solo se activan por debajo del
  // centavo — no esconden ningún faltante.
  //
  // El orden del recorte importa y es deliberado: primero se respetan los
  // orígenes, que son HECHOS (alguien abonó tanto), y el centavo se le quita a
  // `sinPagar`, que es el único que sale de una CONVENCIÓN (el prorrateo).
  //
  // ⚠️ El recorte modifica **lo que se devuelve**, no solo una suma interna.
  // Devolver los pedazos sin recortar y restar aparte dejaría un pie cuyos
  // números no suman su propio total: el defecto exacto que este desglose vino
  // a arreglar, reintroducido por la puerta del redondeo.
  const pedazos = [
    { clave: 'sinPagar', cents: toCents(sinPagar) },
    { clave: 'deBolsillo', cents: toCents(deBolsillo) },
    { clave: 'conSaldoAFavor', cents: toCents(conSaldoAFavor) },
    { clave: 'delPrestamista', cents: toCents(delPrestamista) },
  ];
  let exceso = D(pedazos.reduce((s, p) => s + p.cents, 0)).minus(totalC);
  for (const p of pedazos) {
    if (exceso.lte(0)) break;
    const quita = Math.min(exceso.toNumber(), p.cents);
    p.cents = toCents(D(p.cents).minus(quita));
    exceso = exceso.minus(quita);
  }
  const [sinPagarC, deBolsilloC, conSaldoAFavorC, delPrestamistaC] = pedazos.map((p) => p.cents);

  return {
    total: totalC,
    // El RESIDUO, para que las cinco partes sumen el total exacto.
    caja: toCents(
      D(totalC).minus(deBolsilloC).minus(conSaldoAFavorC).minus(delPrestamistaC).minus(sinPagarC),
    ),
    deBolsillo: deBolsilloC,
    conSaldoAFavor: conSaldoAFavorC,
    delPrestamista: delPrestamistaC,
    sinPagar: sinPagarC,
    nombres,
  };
}

/**
 * El pie del KPI, o `null` cuando **la caja pagó todo** y no hay nada que
 * agregar: ahí el renglón se queda como estaba.
 *
 * Los tres pedazos se escriben para que se pueda verificar de un vistazo que
 * suman el total —esa propiedad es la que hace que el dueño le crea—, y **el
 * que sea cero no se escribe**: "$0.00 los puso nadie" es ruido.
 *
 * Con un solo bolsillo se dice su nombre; con varios, "de bolsillo" a secas:
 * tres nombres en el pie de un KPI no entran y no es ahí donde se leen.
 */
export function textoDeReparto(r: RepartoDePagadores, money: FormatoDeMonto): string | null {
  if (r.deBolsillo <= 0 && r.conSaldoAFavor <= 0 && r.delPrestamista <= 0 && r.sinPagar <= 0) {
    return null;
  }

  // El orden va de lo más común a lo más raro, y **lo que falta pagar va
  // último** porque es lo único que todavía no ocurrió.
  const partes: string[] = [];
  // ⚠️ La caja también se omite si es cero: "$0.00 de la caja" es la misma
  // clase de ruido que los otros ceros, y el mes que el dueño no haya puesto
  // un peso del negocio esa frase sería lo primero que se lee.
  if (r.caja > 0) partes.push(`${money(r.caja)} de la caja`);
  if (r.deBolsillo > 0) {
    partes.push(
      r.nombres.length === 1
        ? `${money(r.deBolsillo)} lo puso ${r.nombres[0]}`
        : `${money(r.deBolsillo)} de bolsillo`,
    );
  }
  if (r.conSaldoAFavor > 0) partes.push(`${money(r.conSaldoAFavor)} con saldo a favor`);
  if (r.delPrestamista > 0) partes.push(`${money(r.delPrestamista)} lo puso el prestamista`);
  if (r.sinPagar > 0) partes.push(`${money(r.sinPagar)} sin pagar`);
  return partes.join(' · ');
}
