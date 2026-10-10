# Fechas, el promedio de la calculadora y la deuda técnica

**De dónde sale:** los pendientes que quedaron al cerrar las fases 1, 4 y 5 el
2026-10-10, más una decisión nueva del dueño sobre la calculadora.

**Stack:** TypeScript, Zod, NestJS, Prisma + PostgreSQL, Jest, React + Vite +
React Query + Tailwind. Dos repos hermanos: `calc3d-api` y `calc3d-web`.

> ⚠️ **Un `git push` ES un despliegue.** Commit por tarea; el push lo pide el
> dueño al cerrar la tanda.
> ⚠️ Al restaurar una mutación, **copia con `cp`, nunca `git checkout --`**.
> ⚠️ `shared` arranca esta tanda en **0.40.0**. Quien lo toque sube
> `SHARED_VERSION` **y** el `version` del `package.json` a la par en los DOS
> repos y corre `pnpm sync:shared` en la web.

---

## Tarea 1 — Las otras ocho puertas del 30 de febrero

La Tarea 8 de la fase 1 cerró el calendario en tres campos (`FECHA` + el helper
`isCalendarDay`). **Quedan ocho que ni siquiera usan `FECHA`**: son
`z.string().min(1)` y aceptan cualquier texto. Todos mueven plata.

`SaleCreateSchema`, `ExpenseCreateSchema`, `ExpenseWithDefinitionSchema`,
`PaymentCreateSchema`, `LoanPaymentCreateSchema`, `PurchaseInvoiceUpsertSchema`,
`PurchaseInvoicePaymentSchema`, `PurchaseReceiveSchema` (y los `endDate` /
`expectedAt` opcionales que cuelgan de ellos).

- [x] ⚠️ **Primero medí qué manda cada cliente.** Esos campos hoy admiten
      también un ISO con hora, así que apretarlos a `AAAA-MM-DD` a secas puede
      romper el panel o los scripts de importación. Revisá el panel campo por
      campo y decilo en el reporte **antes** de elegir la forma.
- [x] La validación acepta lo que ya se manda y **rechaza el día que no existe**
      (`2026-02-30`, `2026-04-31`, `2026-13-01`). Si hace falta un validador
      nuevo que admita las dos formas, que viva **al lado de `FECHA`** y no
      duplicado en ocho lugares: el agujero de la Tarea 8 fue exactamente que el
      `refine` colgaba de uno solo.
- [x] ⚠️ **Superficie sensible** (DTOs de entrada + dinero): el test de ataque
      va **por cada puerta**, primero en rojo, y la suite de seguridad verde
      antes de dar la tarea por terminada.
- [x] Mutación por puerta: sacarle la validación a una tiene que tumbar su test.
      Si una mutación tumba menos de lo esperado, sospechá del código.
- [x] `git commit`.

---

## Tarea 2 — Cablear vitest y, con él, las dos deudas de Gastos

`apps/web` **no tiene runner de tests**: `vitest` figura en `devDependencies`,
instalado y sin configurar, y por eso toda la lógica de las doce tareas
anteriores tuvo que mudarse a `shared` para poder probarse. Lo pagamos en cada
pantalla.

- [ ] Cablear **vitest** en `apps/web`: script `test`, configuración mínima
      (entorno jsdom solo si hace falta) y que `pnpm -r test` lo levante.
      ⚠️ **No agregues dependencias nuevas sin avisar**: vitest ya está.
- [ ] El primer test real: `totalesGastos` (ya es pura y exportada, la dejó así
      la Tarea 7 de la fase 1 esperando este momento).
- [ ] **Vista de tarjetas en Gastos** para el teléfono: `hidden md:block` para
      la tabla + `md:hidden divide-y` para las tarjetas, el patrón que ya usan
      Caja, Ventas y Compras de filamento. ⚠️ **Un solo array de filas ya
      resueltas mapeado dos veces**, no dos árboles escritos a mano: si no, el
      día que cambie una columna se arregla uno y se olvida el otro.
      Medido el 2026-10-10: hoy la tabla mide **884 px dentro de 341**.
- [ ] **Persistir los dos filtros** (tipo y proveedor) con `usePersistentState`,
      como el resto del panel. ⚠️ **El de tipo no tiene valor seguro**: hoy da
      igual porque la lista es fija, pero persistido, un valor viejo dejaría la
      tabla vacía sin explicación. El de proveedor ya lo tiene.
- [ ] `git commit`.

---

## Tarea 3 — La calculadora cotiza por tipo, no por color

**Decisión del dueño, 2026-10-10.** Hoy la calculadora te hace elegir una ficha
concreta. Medido en producción:

| Tipo | Fichas | Rango | Promedio |
|---|---|---|---|
| PLA | 47 | 0,00 – 25,94 | **20,26** |
| PETG | 3 | 18,00 – 20,00 | 18,67 |
| PLA PURE | 2 | 13,00 | 13,00 |
| PLA SILK | 2 | 21,67 – 24,00 | 22,84 |
| PLA TOUGH+ | 1 | 20,00 | 20,00 |

Dentro del PLA la precisión por color no compra nada: casi todos los rollos
cuestan 20. **Entre tipos sí**: PLA PURE 13 contra SILK 22,84 es 75 % de
diferencia, y cotizar los dos a 20 deja el primero 54 % caro y el segundo 12 %
barato.

- [ ] La calculadora arranca en **el promedio del tipo** ("PLA — promedio
      $20.26") y se puede cambiar de tipo. **La ficha puntual sigue
      disponible** para cuando importe.
- [ ] ⚠️ **El rollo regalado no entra en el promedio.** `PLA Creality Azul
      oscuro` costó $0 porque se lo regalaron: es un dato verdadero y se queda
      como gasto, pero **no es una señal de precio** y hundiría el promedio del
      PLA. Su test, con el número a mano.
- [ ] El promedio se **pondera por rollos comprados**, no por ficha: un color
      que compraste una vez no puede pesar lo mismo que uno que comprás siempre.
      Hoy casi todas las fichas tienen una compra, así que los dos números
      coinciden — por eso hay que fijarlo con un test ahora, mientras no se
      nota, y no después cuando empiece a importar.
- [ ] ⚠️ Un tipo **sin ninguna compra con precio** no tiene promedio: no se
      ofrece, en vez de ofrecer $0.
- [ ] El cálculo es una **función pura en `shared`** con sus tests de números a
      mano. El JSX solo elige.
- [ ] Mutación: incluir el regalo en el promedio tiene que tumbar un test.
- [ ] `git commit`.

---

## Tarea 4 — `/api/health` dice qué versión está sirviendo

Hoy devuelve `{ ok, ts }`. **No hay forma de saber qué versión está arriba**, y
por eso el despliegue del 2026-10-10 se verificó esperando por reloj: ocho
minutos de suponer con buena cara. Es justo el tipo de comprobación falsa que
esta app viene corrigiendo.

- [ ] `/api/health` devuelve además `SHARED_VERSION` y, si se puede, el commit.
- [ ] ⚠️ Sigue siendo **público y sin tocar la base** (lo usa Render para saber
      si la app vive sin despertar el cómputo). No metas una consulta ahí.
- [ ] ⚠️ **Nada sensible**: ni variables de entorno, ni rutas, ni nombres de
      base. Una versión y un hash, nada más.
- [ ] Su test.
- [ ] `git commit`.

---

## Tarea 5 — Fase 2: que la factura refleje lo que te cobraron

La fase 2 del spec `2026-10-09-compras-y-visibilidad.md`, tal cual está escrita
ahí. Pediste 10 a $7 y te facturan $7.50: la línea guarda **lo que pediste** y
cada recepción guarda **lo que costó**.

Va **última** porque toca el mismo módulo que media app y conviene que entre con
el resto ya estable.

---

## Orden y choques

`shared` es el cuello de botella: las tareas 1, 3 y 5 lo tocan y **no pueden ir
juntas**. La 2 es solo web y la 4 es solo API.

1. **Tarea 1** (shared + API) ‖ **Tarea 2** (solo web)
2. **Tarea 3** (shared + web + API) ‖ **Tarea 4** (solo API, chica)
3. **Tarea 5**

## Cierre

- [ ] `pnpm -r test` y `pnpm -r lint` en los dos repos, leyendo la salida.
- [ ] Suite de seguridad verde: la Tarea 1 toca DTOs de entrada.
- [ ] Pasada visual, con datos de prueba creados **y borrados**.
- [ ] ⚠️ Al verificar números en el Dashboard, **traer la pestaña al frente**:
      los KPIs usan `NumberTicker` y, sin compositar, la animación se congela a
      mitad y los cuatro números se leen bajos en la misma proporción.
- [ ] Avisar al dueño. **El push lo decide él.**

## Pendiente del dueño, fuera de código

Descontinuar las fichas que no va a reponer. Los 9 colores que hoy figuran sin
rollos: PLA Negro · PLA SILK Dorado · PLA Amarillo girasol · PLA Arándano ·
PLA Arcoíris · PLA Arena · PLA Aurora morado · PLA Azul oscuro · PLA Cyan.
⚠️ **"Una sola compra" NO sirve como criterio**: 52 de 55 fichas tienen una
sola, porque entraron con el import del Excel del 31/08.
