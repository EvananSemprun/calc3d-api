# Tienda, colección principal y filamentos descontinuados · Diseño

> **Estado:** aprobado en alcance y orden (2026-11-10). **NO se implementa** hasta que el
> dueño lo indique. La fase (b) de [compras y pagos](2026-11-10-compras-y-pagos-design.md)
> **va primero** y está a mitad (4 de 10).

**Origen:** 13 cambios pedidos por el dueño el 2026-11-10, con prioridad en el orden escrito.
Son **adicionales** a lo que ya estaba en desarrollo (mayoreo por precio, voseo → tú, precio
total, «$ BCV» + Bs, días por opción, aviso al agregar, carrito con variante y subtotal, home
menos vacía).

---

## 1. Lo que verifiqué antes de opinar

Tres de los 13 puntos descansaban en suposiciones. Las medí:

| Suposición | Medido |
|---|---|
| «"Colección Navidad 2026" parece estar en el código: confirmarlo» | ✅ **Confirmado y es UNA línea**: `calc3d-landing/src/pages/index.astro:51` → `const TITULO_TEMPORADA = 'Colección Navidad 2026'`. |
| «Los cambios deben verse en la tienda sin redeploy manual» = arquitectura nueva | ❌ **No.** La tienda **ya tiene islas que leen en vivo de la API** (`CategoriasEnVivo.tsx`, `DestacadosEnVivo.tsx`). Leer la colección en vivo es el patrón que ya existe, no un cambio de fondo. **Iba a decir lo contrario y me habría equivocado.** |
| «Descontinuar filamentos: hoy existe pero escondido» | ✅ **Confirmado**, y el dato ya está en el modelo: `discontinued` vive en materiales, en el motor de reposición (`restock-order.ts`, `stock.ts`) y en los selectores del calculador. El punto 13 es casi todo UI, salvo el tercer estado. |

### 1.1 ⚠️ El punto 10 no se puede «confirmar»: mi guardián de voseo tiene un agujero

El pedido dice «confirmar que el cambio a tú cubre también `coordiná`, `Elegís`, `Traé tu
archivo`, `¿Querés…?` y `Cotizá`». **No los cubre**, y el motivo es estructural:

El guardián que escribí en la fase (a) detecta las formas de **presente** (`-ás/-és/-ís`) por
**patrón**, pero los imperativos que terminan en una sola vocal acentuada —`cotizá`,
`coordiná`— solo los caza una **lista explícita de 12 palabras**
(`packages/shared/src/idioma.ts`). Cualquier verbo fuera de esa lista pasa en verde, y el
español tiene cientos.

**Dos están vivos hoy:**

- `calc3d-landing/src/components/Header.astro:25` → «coordiná tu pieza por WhatsApp»
- `calc3d-landing/src/pages/index.astro:96` →
  `description="…Cotizá por WhatsApp."` — **la meta description, el texto que Google muestra**

La suite de la tienda está **verde** con esos dos adentro. Es el mismo modo de falla que esta
sesión ya catalogó dos veces (un test cuyo **alcance** recorta sin que su aserción falle),
ahora en el guardián que yo declaré cerrado.

**El arreglo es del mismo tipo que ya funciona para el presente:** patrón sobre `-á`
**excluyendo los futuros** (`-ará`/`-erá`/`-irá`) más una lista blanca chica y enumerable
(`está`, `acá`, `allá`, `ojalá`, `quizá`, `papá`, `mamá`, `sofá`). No es una lista de verbos,
es un patrón con excepciones. `-é` y `-í` quedan **fuera** del patrón a propósito: colisionan
con el pretérito de «yo» (`compré`, `pagué`, `escribí`), que es legítimo y frecuente.

---

## 2. Las cuatro decisiones del dueño (2026-11-10)

| Pregunta | Respuesta | Nota |
|---|---|---|
| ¿Dónde entran el bug del árbol y el voseo respecto de la fase (b)? | **Terminar la fase (b) primero** | ⚠️ Va contra mi recomendación, y la consecuencia está en §5. |
| ¿Cuánto del punto 12 (colección principal)? | **Completo de una** | Incluye varias colecciones guardadas, ventana de fechas y vista previa. |
| ¿El tercer estado «Solo pedido especial» del punto 13? | **Sí, con el tercer estado** | |
| ¿Cómo se verifica el punto 11 (fotos en Safari iOS / Chrome Android)? | **Solo con emulación** | Se entrega **declarado como no verificado en dispositivo real**. |

---

## 3. Veredicto por punto

### Tienda

| # | Qué es | Veredicto |
|---|---|---|
| 1 | Árbol: con 7+ nombres se puede elegir 12 cm y queda en $9,50 | **El más urgente de la lista.** Está cobrando mal en una tienda viva. La instrucción de validarlo también en el servidor es correcta y no negociable: si la única guarda está en el navegador, es un formulario, no una regla. |
| 2 | Campo obligatorio «Escribe los nombres, uno por línea» | **Va junto con el 1**: mismo producto, mismo formulario, misma validación. Separarlos es tocar dos veces lo mismo. |
| 3 | Cantidad editable en producto y carrito | Chico y claro. **El campo NO usa el patrón que mapea vacío a 0** — este repo ya se quemó con eso: vacío significa «volvé al mínimo», no «cero». |
| 4 | Botón «Quitar» descuadrado | Bug de CSS, chico. **El «Deshacer» es otra cosa**: agrega estado temporal y una ventana de tiempo. Queda fuera de esta tanda (§6). |
| 5 | Carrusel de la home | **El ítem más grande del frente.** Se hace una vez y bien. **Sin librería nueva**: `scroll-snap` + CSS alcanza, y una dependencia por esto no se justifica. |
| 6 | Espaciado de la colección en escritorio | Va con el 5 y el 7: los tres son la misma pantalla. |
| 7 | Hero en móvil (375 px): los botones caen fuera de la pantalla | Idem. Se mide en píxeles, no a ojo. |
| 8 | Botón flotante de WhatsApp | Chico, pero **compite por la esquina con el carrito**: hay que decidir dónde va antes de ponerlo, no después. |
| 9 | Contraste 3,9:1 → 4,5:1 y áreas táctiles de 44 px | **La parte del contraste toca el MISMO archivo que el 5** (la etiqueta de categoría vive en la tarjeta). Se une a esa fase; el resto (áreas táctiles del pie y «Ver todo») va aparte. |
| 10 | Voseo restante | Ver §1.1. **No es confirmar: es arreglar el guardián.** |
| 11 | Fotos de tarjetas en Safari iOS / Chrome Android | **No lo puedo verificar yo.** La emulación prueba el layout, no el decodificado real de Safari. Decisión del dueño: solo emulación, declarado como tal. |

### Panel

| # | Qué es | Veredicto |
|---|---|---|
| 12 | Colección principal configurable | **Más barato de lo que parecía** (§1): el título es una línea y el patrón de lectura en vivo ya existe. El trabajo real está en el admin (qué entra, orden, exclusiones, varias colecciones, fechas, vista previa), no en la tienda. Los servicios hermanos ya existen (`store-categorias.service.ts`, `store-banners.service.ts`): la forma del dato es conocida. |
| 13 | Descontinuar filamentos | El dato ya existe; esto es UI más el tercer estado. ⚠️ **El tercer estado es el costo real**: obliga a que **cada** selector y **cada** conteo distinga tres casos en vez de dos. Son varios lugares (reposición, conteo mensual, calculador, compras) y el modo de falla es que uno quede con la regla vieja y nadie lo note. Por eso su fase cierra con un test de regresión del histórico. |

---

## 4. Distribución en fases

Respeta el orden escrito del dueño, agrupando por **archivo compartido** cuando coincide.

| Fase | Qué | Puntos |
|---|---|---|
| **(b)** | El pago, los anticipos y el origen en Caja · **en curso, 4 de 10** | — |
| **(c)** | El árbol que cobra mal, con su regla en el servidor | 1, 2 |
| **(d)** | Cantidad editable y el botón «Quitar» | 3, 4 |
| **(e)** | Carrusel, tarjetas y home | 5, 6, 7 + el contraste del 9 |
| **(f)** | Los chicos: WhatsApp, áreas táctiles, voseo y fotos | 8, 9 (resto), 10, 11 |
| **(g)** | Colección principal, completa | 12 |
| **(h)** | Descontinuar filamentos, con el tercer estado | 13 |

### Qué se une, y por qué

- **1 + 2** → mismo producto, mismo formulario, misma validación de servidor.
- **3 + 4** → los dos son el selector de cantidad y su fila en el carrito.
- **5 + 6 + 7** → la misma pantalla (la home) y el mismo layout.
- **El contraste del 9 entra en (e)**, no en (f): la etiqueta de categoría cuyo contraste hay
  que subir es **la misma que el punto 5 pide ocultar** cuando la colección es de una sola
  categoría. Hacerlo en dos fases es abrir el mismo archivo dos veces.
- **El resto del 9 (áreas táctiles) se queda en (f)**: son el pie y «Ver todo», otro archivo.

### Qué NO se une

- **10 no se mezcla con (c)** aunque los dos sean urgentes: el guardián de voseo es
  infraestructura de tests y el árbol es dinero. Un commit que toca las dos cosas no se puede
  revertir por mitades.
- **12 no se parte** aunque sea grande: el dueño pidió completo, y una colección a medias
  (sin fechas ni varias guardadas) obliga a rediseñar el modelo cuando lleguen.

---

## 5. ⚠️ Riesgo aceptado: el árbol sigue cobrando mal unos días

El dueño eligió terminar la fase (b) antes de tocar la tienda, conociendo el número: **un
árbol de 7+ nombres se vende en $9,50 cuando debería costar más**, y la meta description que
Google muestra tiene un «Cotizá». Las dos cosas siguen vivas hasta la fase (c) y la (f).

Queda escrito, no discutido: es su decisión y hay razones para ella (la fase (b) tiene 11
commits sin desplegar y dejarla a medias es su propio riesgo). Lo que **no** se hace es
olvidarlo: si en algún momento quiere adelantar solo el punto 1, son cuatro subtareas y no
depende de nada de la fase (b).

---

## 6. Fuera de alcance

- **El «Deshacer» del punto 4.** Agrega estado temporal y una ventana de tiempo; es una
  feature, no un arreglo de CSS.
- **Reclasificar los insumos comprados directo** (deuda que la fase (b) dejó anotada).
- **Verificación en dispositivo real del punto 11** (decisión del dueño: solo emulación).
- **Tocar el histórico de compras, análisis o costos** al descontinuar (punto 13 lo pide
  explícitamente: no cambia).

---

## 7. Restricciones que aplican a todas las fases

- **El monto y las reglas se validan en el SERVIDOR.** Vale para el punto 1 y para cualquier
  precio: el navegador propone, el servidor decide.
- **Tests anti-exploit en la misma entrega** cuando la fase toca una puerta de escritura
  pública (la (c) la toca: el pedido de la tienda lo crea un visitante).
- **Sin dependencias nuevas** sin avisar y justificar. El carrusel no las necesita.
- **jsdom no aplica CSS ni hace layout**: nada de `getComputedStyle` ni geometría en un
  `.spec.tsx`. Lo que se mide en píxeles se mide en un navegador real.
- **Español, tratamiento de «tú»**, y los guardianes de idioma en verde — con el agujero de
  §1.1 cerrado, no antes.
- **Un commit por subtarea. Nunca `git push`**: un push a `main` despliega.
