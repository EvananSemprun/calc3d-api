# Calculadora en una sola pantalla — alineada al Excel de Banano Lab

Fecha: 2026-09-06 · Repos afectados: `calc3d-api` (motor + API), `calc3d-web` (pantalla).
La landing/tienda no se toca, pero su flujo de pedidos se verifica al final.

## Objetivo

Reemplazar el wizard de 5 pasos por **una sola pantalla** que replique la hoja
**"Costeo"** del Excel del dueño (`bananolab.xlsx`), y **podar** del motor y del
contrato todo lo que esa hoja no usa. No es solo un cambio de UI: el contrato
`CalcInput`/`CalcResult` de `packages/shared` cambia, y con él el motor y sus tests.

El Excel es la **referencia de verdad** para éste y los próximos cambios.

## Decisiones tomadas

Todas confirmadas con el dueño el 2026-09-06.

1. **Layout:** formulario a la izquierda en el orden del Excel; panel de resultados
   pegajoso a la derecha. En móvil se apila con el resultado arriba.
2. **Poda real** (no "ocultar en avanzado"): los campos se eliminan de la UI **y**
   del contrato.
3. **Filamento:** uno solo (`materials[]` → `filament`). Se pierde mezclar dos
   filamentos en una pieza.
4. **Insumos:** una sola tabla `supplies[] {name, qty, unitCost}` que fusiona
   `components[]` y `packaging[]`. **Muere el prorrateo por paquete**
   (`USED` / `FULL_PACKAGE`): el costo unitario lo escribe el usuario o lo trae
   el catálogo.
5. **Mano de obra:** una sola línea (`labor[]` → `labor {minutes, hourlyRate}`).
6. **Recargos:** se eliminan los cuatro (`setupCost`, `designFee`, `rushPct`,
   `minOrderPrice`). Los reemplaza `extras {packagingPerPiece, otherPerOrder}`,
   equivalente a "Empaque ($)" y "Otros ($)" del Excel.
7. **Merma:** un solo campo `waste.pct`, aplicado **siempre** a filamento, desgaste
   y luz. Se elimina el selector `appliesTo`.
8. **Margen:** uno solo (`markups[]` → `markup`). Se van Económico / Recomendado /
   Premium.
9. **Precio final escribible a mano** (`manualPrice`) con semáforo de estado, y
   **comparador de los 5 redondeos** con el margen de cada uno.
10. **Mayoreo por DESCUENTO** sobre el precio final (`marginPct` → `discountPct`),
    como el Excel. Deroga la regla del CLAUDE.md que dice que el mayoreo es siempre
    markup: hay que actualizar esa línea en `calc3d-api/CLAUDE.md` y en el CLAUDE.md
    de la carpeta contenedora.
11. **Mantenimiento por hora** (`maintPerHour`): **se queda**, aunque el Excel no lo
    tenga. Es un costo real que la vida útil sola no captura.
12. **Impresoras en paralelo:** se agrega `parallelPrinters`, que **no afecta el
    costo** y solo divide las horas-máquina para estimar la entrega.
13. **Catálogo:** se conserva el selector (filamentos, impresoras, insumos guardados)
    como equivalente del LOOKUP a la hoja "Materiales".
14. **Sin compatibilidad hacia atrás:** la base de producción es descartable. No se
    escribe migración de datos para los `CalcInput` guardados. Eso NO significa que
    la app pueda romperse: un documento viejo muestra un aviso, no una pantalla en
    blanco.
15. **El precio que se cobra manda** (agregado el 2026-09-06 tras la fase 3): si el
    pedido alcanza un tramo de mayoreo, ese es el precio — en el panel, en la
    cotización del cliente y en la venta registrada. `order` lo resuelve una sola
    vez. La cotización lo muestra **desglosado** (precio de lista, descuento por
    cantidad, total y precio unitario final): mandar el precio rebajado pelado
    pierde el argumento de venta.
16. **Piso de margen configurable con aviso, sin bloqueo:** `margins.minMarginPct`
    (default 60 %) ⇄ `Settings.minMarginPct`. Bajo el piso, rojo y aviso explícito;
    la venta se puede hacer igual. Aplica al precio manual y a los tramos.

## Fuera de alcance

- Las otras 13 hojas del Excel (Ventas, Encargos, Inventario, Gastos, Metas…).
  Este spec cubre **solo "Costeo"**.
- El cobro en bolívares: `computeChargeEquivalents` ya implementa el punto 9 del
  Excel (tres bases, colchón de reposición, diferencia por redondeo). Se **reubica**
  en el panel, no se reescribe.
- La tienda pública y su bandeja de pedidos.

---

## Contrato nuevo (`packages/shared/src/schemas/calc.ts`)

```ts
CalcInput = {
  // 1. LA PIEZA
  quantity: int >= 1,           // unidades del pedido (B6)
  piecesPerBatch: int >= 1,     // piezas que salen en una impresion (B7); sube de `batch`
  // 2. FILAMENTO
  filament: { name?, rollPrice, rollGrams, grams },  // grams = los de UNA tanda
  waste: { pct },               // sin `appliesTo`
  // 3. INSUMOS
  supplies: [{ name?, qty, unitCost }],              // qty = por PIEZA
  // 4. MAQUINA Y ENERGIA
  printer?: { name?, price, lifetimeHours, hours, powerKw, maintPerHour },
  electricity: { enabled, kwhPrice },
  parallelPrinters: int >= 1,   // solo entrega, NO entra en el costo
  // 5. TU TIEMPO
  labor: { minutes, hourlyRate },                    // minutos por PIEZA
  // 6. EMPAQUE Y OTROS
  extras: { packagingPerPiece, otherPerOrder },
  // 7-8. PRECIO
  margins: { markup, rounding: { mode, increment } },
  manualPrice?: number | null,  // precio final por pieza escrito a mano
  // 11. MAYOREO
  wholesale: { tiers: [{ minQty, discountPct }] },
  currency, locale,
}
```

Desaparecen: `materials[]`, `components[]`, `packaging[]`, `labor[]`, `batch`,
`surcharges`, `margins.markups[]`, `margins.mode`, `waste.appliesTo`.

### Resultado (`CalcResult`)

Se conservan `breakdown`, `costPerUnit`, `costBatch` y `production`. Cambian:

```ts
price: {
  suggested,        // costo unitario x (1 + markup)          (B49)
  rounded,          // suggested con la regla de redondeo     (B53)
  final,            // manualPrice ?? rounded                 (B54)
  marginReal,       // final / costoUnitario - 1              (B55)
  profitPerUnit,    // final - costoUnitario                  (B56)
  diffVsSuggested,  // final - suggested                      (B57)
  status,           // 'LOSS' | 'LOW' | 'BELOW_TARGET' | 'OK' (B58)
}
roundingOptions: [{ mode, increment, price, marginReal }]     // D52:F57 - las 5 opciones
wholesale: {
  tiers: [{ minQty, discountPct, unitPrice, marginReal, profitPerUnit, applies, status }],
  appliedTier, orderTotal, orderProfit,                       // B88:B92
}
production: { piecesPerBatch, batches, totalGrams, machineHours, deliveryHours, ... }
```

**Umbrales del semáforo** (copiados de la fórmula B58, en este orden):
`final < costoUnitario` → `LOSS`; `marginReal < minMarginPct` → `LOW`;
`marginReal < markup x 0.9` → `BELOW_TARGET`; si no → `OK`.
El piso sale de `margins.minMarginPct` (decisión 16), cuyo default es la
constante `LOW_MARGIN_THRESHOLD` = 0.60 de la hoja. Es **inclusivo**: quedar
justo en el piso es `BELOW_TARGET`, no `LOW`.

**Qué son "las 5 opciones" de `roundingOptions`:** las mismas de la hoja, expresadas
con el `mode`/`increment` que ya existe — `NEAREST 1` (al entero más cercano),
`NEAREST 0.5`, `UP 1` (hacia arriba al entero), `UP 0.5` y `NONE` (sin redondeo).
El modo `DOWN` se conserva en el contrato (se puede elegir en Configuración) pero
**no aparece en el comparador**: redondear un precio hacia abajo por defecto es
regalar margen, y la hoja tampoco lo ofrece.

**El redondeo se aplica también a los precios de mayoreo**, como en la hoja (C82:C86
repite la misma fórmula): cada tramo calcula `final x (1 - discountPct)` y **después**
redondea con la regla elegida. No se redondea el descuento, se redondea el precio.

### Tres correcciones deliberadas al Excel

No son fidelidad literal; son ambigüedades de la hoja que se corrigen con el rótulo:

1. **B12 "Gramos que pesa la pieza" son en realidad los de la tanda.** La hoja divide
   el costo total entre las piezas por tanda sin multiplicar los gramos. Rótulo nuevo:
   **"Gramos de la tanda (lo que dice el laminador)"**.
2. **Postprocesado por pieza, no por tanda.** En la hoja, 30 min con 4 piezas por
   tanda dan 7,5 min por pieza. El campo pide **minutos por pieza** y el motor
   multiplica por la cantidad.
3. **"Empaque" por pieza y "Otros" por pedido.** La hoja mete ambos en la tanda. Con
   la distinción, un cargo de diseño de $30 cae en "Otros" y se reparte entre las
   unidades — que es como se comportaba el `designFee` que se elimina.

---

## La pantalla (`calc3d-web`)

Un componente `CalculatorScreen` reemplaza a `Wizard.tsx` y a los 5 `steps/`.

**Columna izquierda** — 7 secciones en el orden del Excel, cada una con su subtotal
al pie del bloque: La pieza · Filamento · Insumos · Máquina y energía · Tu tiempo ·
Empaque y otros · Margen y redondeo.

**Columna derecha (pegajosa)** — precio final editable, semáforo, costo y ganancia
por pieza, `ChargeEquivalentsCard` (cobro en bolívares) y total del pedido.

**Ancho completo, debajo** — comparador de redondeos, tabla de mayoreo (con margen
real y estado por tramo) y resumen de producción: tandas, horas-máquina y entrega
estimada.

Se conservan `SaveQuoteModal` y `SaveProductModal` tal como están.

## Migración de base (`calc3d-api`)

`Settings` se simplifica en la misma dirección:

| Columna | Cambio |
|---|---|
| `defaultMargins Float[]` | → `defaultMarkup Float` (default 1.0) |
| `wasteAppliesTo String[]` | se elimina |
| `componentProrationMode` | se elimina |
| `marginMode` | se elimina (siempre markup sobre el costo) |

Una migración Prisma, sin backfill: la base de producción es descartable.

## Riesgos

1. **`calculateQuote.spec.ts` son 386 líneas escritas contra el contrato viejo.**
   Reescribirlas es la mitad del trabajo real. No es opcional: es lo único que
   garantiza que el precio cobrado a un cliente no cambie por accidente.
2. **`products.module.ts` recalcula productos guardados** con `rebuildWithCurrentPrices`
   + `calculateQuote` (líneas 145, 181, 214). Con el contrato nuevo, Zod descarta lo
   desconocido y aplica defaults: un producto guardado con el contrato viejo cambia de
   precio en silencio. En local la tabla `Product` está vacía; hay que verificarlo
   igual antes de dar el cambio por terminado.
3. **Presupuestos guardados:** `QuoteDetail` pinta el snapshot `totals` guardado y no
   recalcula, así que los documentos históricos se siguen viendo bien. Lo que se
   pierde es **re-editarlos con fidelidad**: al abrir uno viejo, los campos eliminados
   desaparecen sin aviso. Se acepta (decisión 14).
4. **`shared` está duplicado.** Todo se edita en `calc3d-api`; `calc3d-web` lo trae con
   `pnpm sync:shared`. Hay que subir `SHARED_VERSION` y el `version` del `package.json`
   en los dos repos a la par.

---

## Plan de ejecución

Enfoque **B: el motor primero**. Cada fase queda verde antes de pasar a la siguiente.

### Fase 1 — Contrato y motor (`calc3d-api/packages/shared`)

TDD: primero los tests del comportamiento nuevo, después el motor.

1. Reescribir `schemas/calc.ts` con el `CalcInput` de arriba.
2. Reescribir `calc/calculateQuote.ts`: filamento único, insumos sin prorrateo, mano
   de obra única, merma fija a las tres categorías, `extras`, margen único.
3. Agregar: `price` con semáforo, `roundingOptions`, mayoreo por descuento,
   `production.deliveryHours`.
4. Reescribir `calc/calculateQuote.spec.ts`. **Caso de referencia obligatorio:** el
   ejemplo cargado en la hoja — rollo $20/1000 g, 144,13 g, merma 5 %, máquina
   $1.532 (`Inversion!B10`) / 4.800 h, 4 h 45 min, 100 W a $0/kWh, 0 min de
   postprocesado, empaque $1, **margen 100 %** (`B48 = 1`), redondeo hacia arriba a
   $0,50 — debe dar **precio final $11,50**. Ese test es el contrato con el dueño.

   **El costo NO coincide con la hoja, y es a propósito.** Por la decisión 7 la
   merma se aplica también al desgaste, que la hoja deja fuera:

   | | Excel | Motor nuevo |
   |---|---|---|
   | Filamento (con merma) | $3,026730 | $2,882600 crudo |
   | Desgaste (4,75 h × $1.532/4.800) | $1,516042 | $1,516042 |
   | Merma 5 % (material + desgaste) | — | $0,219932 |
   | Empaque | $1,00 | $1,00 |
   | **Costo por pieza** | **$5,542772** | **$5,618574** |
   | Precio sugerido (×2) | $11,085543 | $11,237147 |
   | **Precio final (arriba a $0,50)** | **$11,50** | **$11,50** |

   La diferencia de $0,0758 es el costo de una impresión fallida que la hoja no
   cuenta. El redondeo la absorbe en este caso, pero no siempre lo hará: el test
   fija ambos números para que la divergencia quede documentada y no se descubra
   sola más adelante.
5. Subir `SHARED_VERSION` y `package.json`.

Verificación: `pnpm test:shared` en verde.

### Fase 2 — API (`calc3d-api/apps/api`)

Alcance **medido** al terminar la fase 1 (`tsc --noEmit` sobre `apps/api`):
**46 errores en 5 archivos**. La lista que había estimado antes era incorrecta —
`quotes.service.ts` y `store-requests.service.ts` no rompen, y en cambio aparece
`export.service.ts`, que es el más golpeado:

| Archivo | Errores | Por qué |
|---|---|---|
| `export/export.service.ts` | 33 | Imprime el desglose interno (materials, components, packaging, `prices[]`) en PDF y CSV |
| `products/products.module.ts` | 5 | `rebuildWithCurrentPrices` re-resuelve componentes y empaque por separado; ahora hay `supplies` |
| `store/store.service.ts` | 3 | Toma el precio sugerido del snapshot para armar la ficha |
| `documents/quote-note.service.ts` | 3 | Imprime diseño/urgencia/mínimo como renglones propios de la cotización |
| `sales/sales.service.ts` | 2 | `/sales/from-quote` registra `jobTotal`, que ya no existe → pasa a `order.total` |

Orden sugerido: `sales` y `store` (cambios de una línea), después `products`,
`quote-note` y por último `export`, que es el que más superficie tiene.

Además: migración Prisma de `Settings` (ver arriba) + su DTO en
`shared/schemas/api.ts` (`defaultMargins`, `marginMode`, `wasteAppliesTo` y
`componentProrationMode` siguen declarados ahí) + los specs que construyan un
`CalcInput` a mano.

Verificación: `pnpm -r build` y `pnpm -r test` en verde; la API arranca.

### Fase 3 — Pantalla (`calc3d-web`)

1. `pnpm sync:shared` + `pnpm test:shared` (confirmar que la copia quedó igual).
2. Reescribir `CalculatorProvider` con el estado nuevo.
3. Crear `CalculatorScreen` con las 7 secciones y el panel pegajoso.
4. Adaptar `ResultPanel` a un solo precio + semáforo + comparador de redondeos.
5. Borrar `Wizard.tsx` y `steps/` (5 archivos).
6. Ajustar `QuoteDetail` y `features/products/api.ts` al tipo nuevo.

Verificación: `pnpm -r build` y `pnpm -r lint`; la pantalla se revisa renderizada
(API en 3001 + web en 5180), incluido el modo móvil.

### Fase 4 — Cierre

1. Actualizar `calc3d-api/CLAUDE.md` y el CLAUDE.md de la carpeta contenedora: el
   mayoreo pasa a ser por descuento, y `shared` cambió de contrato.
2. Verificar a mano: crear un presupuesto, guardarlo, abrirlo, guardarlo como
   producto, y comprobar que la tienda sigue sirviendo su catálogo.

## Sobre subagentes

**Las fases 1 y 2 no se paralelizan.** El motor es un archivo de 360 líneas donde todo
depende de todo (el costo unitario alimenta precio, mayoreo, redondeo y semáforo), y
la fase 2 no puede empezar hasta que el contrato exista. Dos agentes escribiendo ahí
se pisan y el resultado es peor que el de uno solo. Es además la parte donde un error
se traduce en dinero mal cobrado, así que conviene revisarla de cerca.

**Dentro de la fase 3 sí hay trabajo paralelizable**, una vez que el contrato está
congelado y `CalculatorScreen` tiene su esqueleto: las secciones del formulario son
independientes entre sí (Filamento, Insumos, Máquina, Tu tiempo, Empaque). Cada una
lee y escribe su propio trozo del estado y no comparte nada con las demás. Se pueden
repartir en 2-3 agentes con el contrato y el patrón de una sección ya hecha como
referencia.

**Lo que conviene dejar a un solo agente en la fase 3:** el `CalculatorProvider` (es
el estado compartido) y el `ResultPanel` (concentra la lógica de presentación del
precio).

Recomendación: hacer las fases 1, 2 y el esqueleto de la 3 en secuencia; recién ahí
evaluar si el volumen restante justifica repartir las secciones. Si no lo justifica,
no vale la pena el costo de coordinación.
