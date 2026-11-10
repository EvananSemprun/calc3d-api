# Fase (a) — Textos y accesibilidad · Plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`. Los pasos van con `- [ ]` para marcarlos.

**Objetivo:** unificar el tratamiento en «tú», darle nombre accesible a los combobox y
arreglar el Escape que cierra el diálogo entero.

**Arquitectura:** tres defectos independientes entre sí y del resto del rediseño. Cada uno
se cierra con un guardián que lo mantiene cerrado. No toca dinero, ni el modelo de datos, ni
ninguna pantalla de Caja o Deuda.

**Stack:** React + Vite + TS (`calc3d-web/apps/web`), NestJS (`calc3d-api/apps/api`),
`packages/shared`. Tests con **vitest** en web (dos proyectos: `.spec.ts` → node,
`.spec.tsx` → jsdom) y **Jest** en `shared`.

**Spec:** [`../specs/2026-11-10-compras-y-pagos-design.md`](../specs/2026-11-10-compras-y-pagos-design.md), §5.10 y §7(a).

## Global Constraints

- **Esta fase NO toca dinero.** Ni un cálculo, ni un schema de escritura, ni una pantalla de
  Caja/Deuda/Compras más allá de sus textos y sus `aria-label`.
- **`packages/shared` se edita SOLO en `calc3d-api`.** Después, en `calc3d-web`:
  `pnpm sync:shared`. Editarlo en web lo sobrescribe la próxima sincronización.
- **jsdom no aplica CSS ni hace layout.** Nada de `getComputedStyle` ni geometría en un
  `.spec.tsx`.
- **Un commit por tarea. NUNCA `git push`** — un push a `main` despliega. Sin `--no-verify`.
- Comentarios y mensajes en español.

## Review Focus

Cinco modos de falla que el spec implica y que ninguna tarea prueba sola:

1. **El guardián de voseo se infla con falsos positivos.** Sin exigir el acento,
   `hace`/`toca`/`mira`/`registra` son tercera persona y dan **133** coincidencias en el
   panel: el guardián pasa a ser ruido y alguien lo apaga. → Tarea 1, paso 1.
2. **El guardián cubre solo las diez formas del pedido.** Con esas diez son 27 ocurrencias;
   con la lista real son **116 en 60 archivos**. Un guardián que cubre un cuarto del
   problema deja el resto con luz verde. → Tarea 1, paso 1.
3. **Un `aria-label` arreglado a mano en nueve controles deja el décimo roto.** La causa es
   que el `<label>` de `Field` no tiene `htmlFor` y los `Select` son `<button>`. → Tarea 3.
4. **Un test de Escape que no usa el `Dialog` real es verde falso.** El actual monta un
   `<div role="dialog">` con handler de React en burbuja, que es lo único que
   `stopPropagation` sí bloquea. → Tarea 4, paso 1.
5. **`shared` editado en el repo equivocado.** Un arreglo hecho en `calc3d-web/packages/shared`
   desaparece en la próxima sincronización, sin error. → Tarea 2, paso 4.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `calc3d-web/apps/web/src/idioma.spec.ts` | **Crear.** Guardián de voseo del panel (proyecto `node`: lee texto de los fuentes) |
| `calc3d-api/apps/api/src/common/idioma.spec.ts` | **Crear.** El mismo guardián para la API y `shared` |
| `calc3d-web/apps/web/src/components/ui.tsx` | `Field`, `Label`, `Select`, `SelectBuscable` — la causa raíz del nombre accesible y del Escape |
| `calc3d-web/apps/web/src/components/Combobox.tsx` | El otro combobox propio, sin mitigación de Escape |
| `calc3d-web/apps/web/src/components/overlays.tsx` | El `Dialog` de Radix: acá va `onEscapeKeyDown` |
| `calc3d-web/apps/web/src/components/Escape.spec.tsx` | **Crear.** El test contra el `Dialog` REAL |

---

## Task 1: El guardián de voseo, y el panel en «tú»

**Files:**
- Create: `calc3d-web/apps/web/src/idioma.spec.ts`
- Modify: los archivos del panel que el guardián marque (~29 según el inventario)

**Interfaces:**
- Consumes: nada.
- Produces: `FORMAS_DE_VOSEO`, exportada desde el spec, para que la Tarea 2 use **la misma
  lista** en la API.

- [ ] **Paso 1: Escribir el guardián**

```ts
// Las formas van CON ACENTO y como palabra completa. Sin el acento,
// `hace`/`toca`/`mira`/`registra` son tercera persona: 133 falsos positivos.
export const FORMAS_DE_VOSEO = [
  'abonás', 'tenés', 'podés', 'tocá', 'mirá', 'dejalo', 'registrá', 'elegí',
  'hacé', 'ingresá', 'avisá', 'sacá', 'pasá', 'verificá', 'poné', 'cargá',
  'borrá', 'revisá', 'usá', 'sumá', 'decí', 'fijate', 'acordate', 'escribí',
  'mandá',
] as const;

it('ningún archivo del panel usa voseo', () => { /* el mensaje nombra archivo y forma */ });
it('la lista cubre más que las diez formas del pedido original', () => {
  expect(FORMAS_DE_VOSEO.length).toBeGreaterThan(10);
});
```

⚠️ **La segunda aserción no es un adorno:** el pedido nombraba diez formas y con ésas el
inventario da **27 ocurrencias en 17 archivos**; con la lista real da **116 en 60**. Sin ese
test, alguien «simplifica» la lista a las diez del pedido y el guardián queda cubriendo un
cuarto del problema, en verde.

- [ ] **Paso 2: Correr para verificar que falla** → FAIL, con ~68 ocurrencias en ~29 archivos.

- [ ] **Paso 3: Corregir el panel.** Solo el texto: no se renombra ninguna variable ni
  función que contenga una de esas formas por casualidad.

- [ ] **Paso 4: Correr** → PASS. Y `pnpm test` completo en verde, porque hay specs que
  afirman sobre textos de pantalla.

- [ ] **Paso 5: Commit**

```bash
git add src/idioma.spec.ts src/
git commit -m "fix(panel): el panel habla de tú, y un guardián lo mantiene así"
```

---

## Task 2: La API y `shared` en «tú»

**Files:**
- Create: `calc3d-api/apps/api/src/common/idioma.spec.ts`
- Modify: `calc3d-api/apps/api/src/**` y `calc3d-api/packages/shared/src/**` (~31 archivos)

**Interfaces:**
- Consumes: la lista `FORMAS_DE_VOSEO` de la Tarea 1 (copiada, no importada: son repos
  distintos).

- [ ] **Paso 1: El guardián, igual que el de la Tarea 1**, barriendo `apps/api/src` y
  `packages/shared/src`.

- [ ] **Paso 2: Correr para verificar que falla** → FAIL (~48 ocurrencias en ~31 archivos).

- [ ] **Paso 3: Corregir.** ⚠️ **Los mensajes de error de la API SON texto de cara al
  usuario**: salen en los avisos del panel. Los comentarios también se corrigen, para que el
  repo tenga un solo registro.

- [ ] **Paso 4: Sincronizar a web y verificar**

```bash
cd ../calc3d-web && pnpm sync:shared && pnpm test
```

⚠️ **Sin este paso el panel sigue con el `shared` viejo** y su guardián de la Tarea 1 pasa a
fallar por archivos que ya se arreglaron en el otro repo. Si falla algo acá, el arreglo va
**en `calc3d-api`** y se vuelve a sincronizar.

- [ ] **Paso 5: Commit en los dos repos** (uno cada uno; el de web solo lleva `shared`).

---

## Task 3: Nombre accesible en los combobox, atacando la causa

**Files:**
- Modify: `calc3d-web/apps/web/src/components/ui.tsx` (`Field`, `Label`, `Select`)
- Modify: `calc3d-web/apps/web/src/components/Combobox.tsx`
- Modify: `features/filament/PurchasesTab.tsx`, `features/finance/ExpenseModal.tsx`,
  `features/filament/EditarCompra.tsx`, `features/finance/DateRange.tsx`
- Create: `calc3d-web/apps/web/src/components/nombre-accesible.spec.tsx`

**Interfaces:**
- Produces: `Field` pasa a dar nombre accesible a su control sin que cada llamada lo repita.

- [ ] **Paso 1: Escribir el test**

```tsx
it('un Select dentro de un Field toma el nombre de su etiqueta', …);
it('un Combobox sin placeholder NO se llama «Elegir o escribir…»', …);
it.each(CONTROLES_DE_FILAMENTO)('%s tiene nombre accesible', …);
```

El `it.each` recorre los controles de `/filament/compras`; hoy **nueve** no tienen nombre y
**tres más** (Marca, Tipo, Color) comparten el default genérico, así que tres controles
distintos se llaman igual.

- [ ] **Paso 2: Correr para verificar que falla** → FAIL en 12.

- [ ] **Paso 3: Arreglar la causa, no los doce casos.** El `<label>` de `Field` no tiene
  `htmlFor` y un `<button role="combobox">` no es etiquetable por un `<label>`. `Field`
  genera un id, se lo pasa al control y usa `aria-labelledby` (o `aria-label` con el texto
  de la etiqueta). El patrón correcto ya existe en `pages/Purchases.tsx:1297-1313`.

⚠️ **Arreglar los nueve a mano deja el décimo roto**, y el próximo `Select` nace sin nombre.

- [ ] **Paso 4: Correr** → PASS, y comprobar con una mutación: **agregar un `Select` nuevo
  sin `aria-label` dentro de un `Field`** tiene que quedar **verde** (porque ahora lo hereda)
  — si queda rojo, el arreglo no es la causa raíz sino otro parche.

- [ ] **Paso 5: Commit**

---

## Task 4: El Escape cierra el popover, no el diálogo

**Files:**
- Modify: `calc3d-web/apps/web/src/components/overlays.tsx` (el `Dialog`)
- Modify: `calc3d-web/apps/web/src/components/Combobox.tsx`, `ui.tsx` (`SelectBuscable`)
- Create: `calc3d-web/apps/web/src/components/Escape.spec.tsx`
- Modify: `calc3d-web/apps/web/src/components/Select.spec.tsx` (el test que hoy es verde falso)

- [ ] **Paso 1: Escribir el test contra el `Dialog` REAL**

```tsx
it('Escape con el popover abierto cierra SOLO el popover', …);
it('Escape con el popover cerrado sí cierra el diálogo', …);
```

⚠️ **Tiene que montar `<Dialog>` de `components/overlays.tsx`**, no un `<div role="dialog">`.
El test actual (`Select.spec.tsx:134-150`) monta un div con `onKeyDown` de React —en
burbuja—, que es justo lo único que `stopPropagation` sí bloquea: **por eso está verde
mientras el bug existe**.

- [ ] **Paso 2: Correr para verificar que falla** → FAIL: el diálogo se cierra igual.

- [ ] **Paso 3: Arreglarlo donde Radix escucha.** `DismissableLayer` escucha en `document`
  **en fase de captura**, así que un `stopPropagation` en burbuja no puede cancelarlo: ya
  corrió. Lo único que Radix respeta es `event.defaultPrevented` **después** de llamar a
  `onEscapeKeyDown`. El `Dialog` pasa un `onEscapeKeyDown` que hace `preventDefault()` cuando
  hay un popover abierto adentro; los dos combobox registran que están abiertos.

- [ ] **Paso 4: Correr** → PASS.

- [ ] **Paso 5: Arreglar el test viejo.** `Select.spec.tsx:134-150` se reapunta al `Dialog`
  real o se borra. ⚠️ **Dejarlo como está es peor que no tenerlo**: afirma que la regla se
  cumple usando el único montaje donde el bug no se reproduce.

- [ ] **Paso 6: Commit**
