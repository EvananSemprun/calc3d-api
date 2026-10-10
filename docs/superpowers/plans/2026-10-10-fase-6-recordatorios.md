# Fase 6 — Que la app te recuerde

**Spec:** `docs/superpowers/specs/2026-10-09-compras-y-visibilidad.md`, Fase 6.
**Decisiones del dueño:** 2026-10-10 (cuestionario).

**Objetivo:** tres avisos. No son features nuevas: son datos que la app ya tiene
y que hoy no te dice a tiempo.

> ⚠️ **El riesgo de esta fase es el ruido.** Un aviso que aparece siempre deja
> de verse, y cuando eso pasa también deja de verse el que importaba. Cada uno
> tiene que poder **callarse**, y ninguno puede aparecer si no hay nada que
> hacer.
> ⚠️ **Un `git push` ES un despliegue.** Commit por tarea; el push lo pide el dueño.
> ⚠️ Mutaciones: **copia con `cp`, nunca `git checkout --`**.
> ⚠️ `shared` arranca esta fase en la versión que haya dejado la tanda anterior:
> **miralo antes de subirlo** y seguí con la siguiente menor.

---

## Tarea 1 — Contar el stock al cerrar el mes (6.1)

El último conteo del dueño es de **septiembre**. Nadie le avisa.

**Decisión del dueño: el aviso va en el DASHBOARD**, no en Stock del mes. Su
razón, que es la correcta: el mes pasado no contó porque **no entró** a esa
pantalla, así que un aviso que vive ahí llega tarde por definición.

- [ ] Aviso en el Dashboard cuando **empezó un mes nuevo y el anterior quedó sin
      cerrar**, con enlace a Stock del mes. Seguí el patrón de los tres que ya
      están (`ProfitabilityAlert`, `CampaignAlert`, `AtrasoDeCompraAlert`): no
      inventes un cuarto estilo.
- [ ] ⚠️ **Se puede descartar**, y el descarte **dura hasta que el mes cambie**
      (si vuelve al recargar, es ruido; si no vuelve nunca, es un aviso perdido).
- [ ] ⚠️ El "hoy" entra como **parámetro** de la función pura, no se lee del
      reloj adentro: un test que dependa de la fecha de la máquina pasa hoy y
      falla solo algún día. Convención ya usada por `cashChainCuts`,
      `facturasAtrasadas`, `preciosPorTipo` y `campaignLifecycle`.
- [ ] ⚠️ Casos en los que **NO** aparece, cada uno con su test y su hermano
      alcanzable: el mes anterior ya está cerrado; **no hay ningún mes cerrado
      todavía** (un negocio que arranca no tiene nada que contar); el aviso ya
      se descartó para ese mes.

---

## Tarea 2 — La recepción sugiere el conteo (6.2)

**Decisión del dueño: sugiere SOLO lo que se recibió ese mes.** Descartó
explícitamente "el cierre anterior más lo recibido".

> La razón importa y va escrita en el código: si la app completa el conteo con
> el cierre anterior, el dueño termina **confirmando un número en vez de mirando
> el estante**, y el conteo deja de medir nada. Lo que ahorra tipeo ahorra
> también la verificación, que es justo lo único que el conteo aporta.

- [ ] Al contar, los rollos **recibidos ese mes** (los que entraron por una
      factura) aparecen como punto de partida.
- [ ] ⚠️ **SUGERIR, NO ESCRIBIR.** La casilla no queda rellenada: se ofrece el
      número y el dueño decide. Tiene que ser visible que es una sugerencia y
      de dónde sale.
- [ ] ⚠️ Una ficha **sin recepciones ese mes** no sugiere nada (no sugiere 0:
      "no sé" y "cero" no son lo mismo, y 0 es un conteo válido).
- [ ] Función pura en `shared` con sus tests de números a mano.

---

## Tarea 3 — Recordar las lecturas de impresora (6.3)

Hay **dos lecturas** desde que existe la pantalla. El spec decía que si seguía
sin usarse, la conversación era sacarla del menú.

**Decisión del dueño: va el recordatorio, la pantalla se queda.** Preguntado
derecho, dijo que sí quiere llevar el control de horas y que lo que faltó fue
acordarse. O sea: no era una pantalla de más, era una pantalla sin aviso.

- [ ] Aviso cuando pasó mucho desde la última lectura. ⚠️ **"Mucho" es un
      número que hay que elegir y justificar en el código**, no un valor suelto
      en medio de un `if`. Mirá cada cuánto se cargaron las dos que hay antes de
      decidirlo.
- [ ] ⚠️ Si **nunca** hubo una lectura, el aviso no puede decir "pasaron N días
      desde la última": o no aparece, o dice otra cosa. Su test.
- [ ] Se puede descartar, igual que el de stock.

---

## Cierre de la fase

- [ ] `pnpm -r test` y `pnpm -r lint` en los dos repos, **leyendo la salida**.
      Si el total baja sin que falle nada, una suite no compiló.
- [ ] ⚠️ **Tests de cableado, no solo de función pura.** Hoy una mutación que
      hacía que una pantalla **dejara de filtrar** no tumbó ni un test, con las
      nueve ramas de la función probadas. `apps/web` tiene jsdom: los avisos van
      con su `.spec.tsx`.
- [ ] Pasada visual con datos de prueba, **borrándolos al terminar**.
- [ ] ⚠️ Al verificar números en el Dashboard, **traer la pestaña al frente**:
      los KPIs usan `NumberTicker` y, sin compositar, la animación se congela a
      mitad y los cuatro números se leen bajos en la misma proporción.
- [ ] ⚠️ **Mirar el Dashboard con los cuatro avisos a la vez.** Cada uno se
      diseñó solo; juntos pueden tapar la pantalla. Si no entran, la
      conversación es cuál se va, no achicar la letra.
- [ ] Avisar al dueño. **El push lo decide él.**
