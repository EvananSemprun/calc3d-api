# Descontinuar filamentos, unir duplicados y borrar con historial · Plan

> **Para quien ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`. Los pasos van con `- [ ]` para marcarlos.

**Objetivo:** poder sacar de circulación un filamento o un insumo **sin perder su historial**,
con un tercer estado «solo pedido especial», y poder **unir dos fichas duplicadas** en vez de
quedarse con las dos porque borrar da miedo.

**Arquitectura:** el estado ya existe (`MaterialStatus`); lo nuevo es **un tercer valor y los
PREDICADOS que obligan a decidir qué hace cada pantalla con él**. Los predicados viven en
`packages/shared` como `switch` exhaustivos con `const nunca: never`, así que agregar el valor
**no compila** hasta que los cuatro consumidores deciden. Unir fichas es una transacción que
repunta compras, costeos y productos y recalcula el precio desde el historial unido.

**Stack:** NestJS + Prisma (`calc3d-api/apps/api`, tests **Jest**), motor puro
(`calc3d-api/packages/shared`, **Jest**), panel React (`calc3d-web/apps/web`, **vitest**).

**Spec:** [`../specs/2026-11-10-tienda-coleccion-y-filamentos-design.md`](../specs/2026-11-10-tienda-coleccion-y-filamentos-design.md)
(punto 13) + los puntos 2.1 y 2.2 del pedido del dueño del 12/11, que él decidió juntar acá.

## Global Constraints

- **`packages/shared` se edita SOLO en `calc3d-api`**; después `pnpm sync:shared` en web.
- **Un commit por tarea. NUNCA `git push`.** Sin `--no-verify` ni flags interactivos.
- Español; **tuteo, nunca voseo** (hay test guardián). Comentarios que digan **por qué**.
- **La mutación tiene que COMPILAR.** Si jest no imprime conteo, no se midió nada.
- Al mutar `shared` y correr un test de `apps/api`: **recompilar `dist/cjs`** entre mutar y
  correr, y otra vez al restaurar.
- Restaurar con copia `cp`, **nunca `git checkout --`**.

## Review Focus

Cinco modos de falla que el spec implica y que ninguna tarea prueba sola:

1. **Un lugar se queda con la regla de dos estados y nadie lo nota.** Es el costo real que el
   spec señala: hay **9 sitios** que hoy comparan contra `DISCONTINUED`. → Tarea 1, paso 3 (que
   el compilador lo impida, no un comentario).
2. **Unir dos fichas cambia un costo histórico.** Repuntar compras no puede reescribir lo que
   una compra costó. → Tarea 6, paso 1.
3. **Borrar una ficha con compras deja gastos huérfanos** y el precio de cotización colgado.
   → Tarea 7, paso 1.
4. **El conteo mensual de un mes YA CERRADO cambia** al descontinuar. Un cierre es un
   documento. → Tarea 8, paso 1.
5. **Una ficha «solo pedido especial» desaparece del calculador**, que es justo donde el dueño
   la necesita para cotizar ese pedido especial. → Tarea 1, paso 1.

---

### Task 1: El tercer estado y los predicados que obligan a decidir

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (valor nuevo del enum) + migración
- Create: `packages/shared/src/calc/estado-de-ficha.ts` + su spec

**Interfaces:**
- Produces: `entraEnReposicion(s)`, `entraEnConteo(s)`, `entraEnCalculadora(s)`,
  `entraEnCompras(s)` — todas `(s: MaterialStatus) => boolean`.

⚠️ **ESTA ES LA DECISIÓN CENTRAL DEL PLAN.** Hoy hay **9 lugares** que hacen
`status === 'DISCONTINUED'` o `!== 'DISCONTINUED'` (3 en la API, 6 en el panel). Con un tercer
valor, el modo de falla es que **uno quede con la regla vieja y nadie lo note**. Un comentario
no es una guarda: cada predicado es un **`switch` exhaustivo con `const nunca: never`**, así
que el valor nuevo **no compila** hasta que los cuatro deciden. Es el mismo patrón que ya se
validó dos veces en este repo (`categoriaDeLinea`, `columnasDeObligacion`).

- [ ] **Paso 1: Escribir los tests**

```ts
it('ACTIVE entra en las cuatro', …);
it('DISCONTINUED no entra en ninguna', …);
it('SOLO_PEDIDO_ESPECIAL: fuera de reposición y conteo, DENTRO de calculadora y compras', …);
```

⚠️ El tercer test **es el punto del tercer estado**: si quedara fuera del calculador, el dueño
no podría cotizar justamente el pedido especial para el que la ficha existe.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar** los cuatro predicados y la migración.
- [ ] **Paso 4: Correr** → PASS. Subir `SHARED_VERSION` + `package.json`, `pnpm sync:shared`.
- [ ] **Paso 5: Commit.**

---

### Task 2: Los predicados, aplicados en la API

**Files:**
- Modify: `apps/api/src/filament/filament.service.ts` (2 lugares)
- Modify: `apps/api/src/materials/materials.service.ts`
- Modify: `apps/api/src/expenses/expenses.service.ts:222` y `:282`

⚠️ **`expenses.service.ts` pone `status: 'ACTIVE'` al comprar.** Hay que decidir: comprar una
ficha «solo pedido especial» **no la reactiva sola** — si el dueño la marcó así, comprar un
rollo para un encargo no debería cambiarlo. Reactivar es un acto explícito (Tarea 5).

- [ ] **Paso 1: Escribir los tests** de que reposición y conteo **excluyen** el tercer estado
  y compras/calculador **lo incluyen**, cada uno con su hermano alcanzable.
- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Reemplazar las comparaciones sueltas por los
  predicados.** **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 3: Los predicados, aplicados en el panel

**Files:**
- Modify: `features/calculator/materialOptions.ts:184`
- Modify: `features/filament/FichaDialog.tsx:38,79`
- Modify: `features/filament/StockTab.tsx:487,599,716`
- Modify: `features/finance/ExpenseModal.tsx:157,372`

- [ ] **Paso 1: Escribir los tests de cableado** de que cada pantalla muestra el tercer estado
  donde corresponde y lo esconde donde no.
- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** `ESTADOS` pasa a tres valores y la
  insignia distingue los tres. **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 4: Descontinuar en lote y por marca

**Files:**
- Modify: `apps/api/src/materials/materials.service.ts` + su spec
- Modify: `features/filament/StockTab.tsx` + su spec

- [ ] **Paso 1: Escribir los tests**

```ts
it('descontinuar en lote cambia solo las fichas elegidas', …);
it('«descontinuar toda la marca» lista CUÁLES antes de confirmar', …);
it('una ficha de otra organización no se toca', …);   // IDOR + hermano
```

⚠️ **La confirmación de «toda la marca» tiene que ENUMERAR las fichas**, no decir «se van a
descontinuar 14». Un número no deja ver que entró una que no correspondía.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar**, botón visible en Stock del mes y en
  el catálogo. **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 5: Ver descontinuados y reactivar

**Files:**
- Modify: `features/filament/StockTab.tsx` + su spec

- [ ] **Paso 1: Escribir los tests** del filtro de tres estados y del botón «Reactivar» (que
  vuelve a `ACTIVE` desde cualquiera de los otros dos).
- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** **Paso 4: Correr** → PASS.
- [ ] **Paso 5: Commit.**

---

### Task 6: Unir dos fichas duplicadas

**Files:**
- Modify: `apps/api/src/materials/materials.service.ts` + su spec
- Modify: `apps/api/src/catalogs/` (el servicio de insumos) + su spec
- Modify: `features/filament/StockTab.tsx` y la tabla de Insumos

**Interfaces:**
- Produces: `POST /materials/:id/unir` y su gemelo de insumos, con `{ destinoId }`.

⚠️ **DECISIÓN YA TOMADA: el precio de referencia se RECALCULA desde el historial unido**, no se
elige el de una de las dos fichas. Razón: `recalcularPrecioDelRollo` ya define que «el precio
sigue a la última compra por fecha»; después de unir, la última compra del conjunto **es** esa
respuesta, y quedarse con el precio guardado de una ficha contradiría una regla que ya existe.
- **Consecuencia medida en producción, para que no sorprenda:** «Argollas» tiene 1 compra
  ($7,27 × 25 = **$0,29** cada una) y «Argolla llavero» tiene **0 compras** y un precio
  guardado de $50 × 100 (**$0,50**). Al unir «Argollas» dentro de «Argolla llavero», la única
  compra del conjunto es la de $7,27, así que el costo pasa a **$0,29**. Es el número real, y
  el que hoy está guardado no viene de ninguna compra.

- [ ] **Paso 1: Escribir los tests**

```ts
it('unir repunta compras, costeos y productos a la ficha destino', …);
it('unir NO cambia el monto ni la fecha de ninguna compra', …);   // modo de falla 2
it('el precio de referencia queda en el de la ÚLTIMA compra del conjunto', …);
it('la ficha de origen se borra, y solo DESPUÉS de repuntar todo', …);
it('unir con una ficha de otra organización se rechaza', …);      // IDOR + hermano
it('unir una ficha consigo misma se rechaza', …);
```

⚠️ **Todo en UNA transacción.** Una unión a medias deja compras apuntando a una ficha borrada.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** **Paso 4: Correr** → PASS.
- [ ] **Paso 5: Commit.**

---

### Task 7: Borrar con historial, y los nombres accesibles

**Files:**
- Modify: el servicio de insumos y el de materiales + sus specs
- Modify: la tabla de Insumos del panel + su spec

- [ ] **Paso 1: Escribir los tests**

```ts
it('borrar una ficha CON compras se rechaza y dice cuántas', …);
it('borrar una ficha que usa un producto se rechaza y dice cuáles', …);
it('borrar una ficha sin nada asociado SÍ se permite', …);        // hermano alcanzable
it('los botones de editar y borrar tienen nombre accesible', …);
```

⚠️ **El mensaje tiene que ofrecer la SALIDA** («Descontinuar» o «Unir con…»), no solo negarse.
Este repo ya aprendió que un mensaje que manda a una puerta cerrada es peor que no tener
mensaje (ver «deshacer una recepción» en el `CLAUDE.md`).

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** **Paso 4: Correr** → PASS.
- [ ] **Paso 5: Commit.**

---

### Task 8: El test de regresión del histórico, y cierre

**Files:**
- Create: `apps/api/src/filament/historico-no-cambia.spec.ts`

⚠️ **Es la tarea que el spec exige para cerrar la fase**, y la razón es el modo de falla 4: un
cierre mensual es un documento, y descontinuar no puede reescribirlo.

- [ ] **Paso 1: Escribir el test** con **números clavados a mano**

```ts
it('descontinuar NO cambia el conteo de un mes ya cerrado', …);
it('descontinuar NO cambia el costo de ninguna compra pasada', …);
it('descontinuar NO cambia el análisis de compras por marca/tipo/color', …);
it('unir dos fichas NO cambia el total comprado del histórico', …);
```

- [ ] **Paso 2: Correr, arreglar lo que aparezca, volver a correr** → PASS.
- [ ] **Paso 3: Verificar en el navegador** el filtro de tres estados y la unión, con una ficha
  de prueba que se borra al terminar.
- [ ] **Paso 4: Actualizar el `CLAUDE.md`** con los predicados y la regla del precio al unir.
- [ ] **Paso 5: Commit.** **Acá termina la fase (h).**
