# Conector MCP: Calc3D como asistente de Claude — Design

> Estado: **spec aprobado en alcance, sin implementar.** Decisiones de alcance
> cerradas con el dueño el 2026-10-17 (cuestionario). Pendiente: elegir el
> camino de autenticación (A vs B) mirando la UI de Claude, y construir por fases
> en local. Antecedente: la propuesta original es de la sesión del 2026-10-02
> ("Actualizar datos bananolab").

## Objetivo

Que el dueño le hable al **chat de Claude** (desde la PC o el celular) y Claude
**haga el trabajo de carga** en Calc3D —anotar una venta, un gasto, un abono,
armar una campaña— mientras el dueño **solo revisa y aprueba**. "Vamos a hacer
esta campaña, anotá esto, anotá lo otro; yo reviso."

## Decisión de fondo: conector MCP sobre la suscripción Max (no API por token)

El dueño tiene **Claude Max**. Un **conector personalizado (MCP remoto)** se agrega
a la cuenta y **usa los modelos del plan**: el costo del razonamiento lo cubre la
suscripción, **no se paga API de Anthropic por mensaje**. Es, literalmente,
"conectarlo al chat".

- ⚠️ **El "no vía API" tiene un matiz honesto:** igual hace falta un **endpoint
  HTTP propio** (`/api/mcp`) en el backend — es el único modo de que el chat toque
  los datos; sin él, Claude no tiene manos. Eso **no cuesta nada extra**: vive en
  el mismo servicio de Render que ya existe. Lo que NO se paga es Anthropic por
  token.
- **La aprobación "yo reviso" ya viene hecha:** Claude pide permiso antes de cada
  acción del conector, salvo que el dueño marque "Permitir siempre". Lo que en un
  bot casero habría que construir, acá ya existe.
- **Las herramientas sirven después** para un asistente dentro del panel o para
  Claude Code, sin rehacerlas.

Evaluado contra Gemini gratis (sesión 2026-10-02): mejores modelos, confirmación
incluida, sin costo extra y sin entregar los datos al plan gratis de Google.

## Arquitectura

- **Módulo nuevo `mcp/` dentro de `calc3d-api`**, en el mismo servicio de Render.
  Endpoint público: `https://calc3d-api.onrender.com/api/mcp`.
- **Dependencia nueva: `@modelcontextprotocol/sdk`** (SDK oficial de MCP para
  TypeScript). Justificación: implementar el protocolo a mano es reinventarlo y
  es fácil equivocarse en el transporte (Streamable HTTP) y en las anotaciones.
  Es la única dep nueva.
- **Transporte:** Streamable HTTP, montado sobre el Express que ya usa Nest. El
  handler del SDK se expone en una ruta dedicada; no se mezcla con el resto de
  los controllers.
- ⚠️ **Las herramientas NO tienen lógica propia: llaman a los servicios que ya
  existen**, con sus mismas validaciones Zod de `shared`. Nada de SQL nuevo ni
  reglas duplicadas. Todos los servicios ya reciben `(organizationId, dto)`:
  - `SalesService.create(org, dto)`
  - `ExpensesService.create(org, dto)`
  - `OrdersService.list(org)` / `OrdersService.addPayment(org, orderId, dto)`
  - `CashService.summary(org)`
  - `CampaignsService.create(org, dto)` — ya soporta `paidUsd` (lo que se pagó →
    gasto de Publicidad gestionado, cuenta como invertido; shared 0.58.0).
  - `ExchangeRatesService.latest(org)` — tasas vigentes.

## Autenticación

⚠️ **La organización SIEMPRE sale del token, NUNCA de lo que mande la IA.** Es la
regla que sostiene todo: un `organizationId` en el cuerpo de una herramienta se
rechaza (el esquema estricto no lo acepta). El token resuelve a la misma forma que
hoy entrega el JWT: `AuthUser { userId, organizationId }`.

Dos caminos, se elige **mirando la UI de Claude** (Personalizar → Conectores →
Agregar conector personalizado):

- **Camino A — token de conector (si aparece "Request headers"/"Encabezados").**
  - Se genera en el panel (Configuración → Conectores). Se muestra **una sola
    vez** y se guarda **solo como hash** (sha256) en una tabla nueva
    `ConnectorToken` (usuario, organización, último uso, `revokedAt`). Mismo
    patrón que los refresh tokens actuales.
  - Claude lo manda como `Authorization: Bearer …` en cada pedido. Un guard lo
    resuelve a `AuthUser`.
  - Revocable desde el panel.
  - Esfuerzo: ~1 día.
- **Camino B — OAuth 2.1 (si NO aparece "Request headers").**
  - Reusa el login actual (correo + contraseña) más el registro automático de
    clientes (DCR) que usa Claude. Es lo estándar de los conectores remotos.
  - Esfuerzo: +1–2 días.

⚠️ **La decisión A vs B se toma al construir**, no antes: depende de si al dueño le
aparece "Request headers" en su cuenta (está en beta y solo para algunas cuentas).
Lo que **no** se hace nunca es el atajo "sin autenticación con URL secreta":
cualquiera que vea esa URL podría registrar ventas en el negocio.

## Herramientas v1 (alcance cerrado: campañas + anotar)

**Lectura** (anotadas como solo-lectura → Claude no pide permiso innecesario):

| Herramienta | Qué hace |
|---|---|
| `resumen_periodo` | Ventas, abonos y gastos de hoy / la semana / el mes |
| `ver_caja` | Saldo del negocio y lo que se le debe al propietario y al prestamista |
| `buscar_encargos` | Por cliente o estado, con saldo pendiente |
| `tasas_vigentes` | Binance y BCV del día |

**Escritura** (anotadas como acciones que **piden aprobación**):

| Herramienta | Qué hace | Servicio |
|---|---|---|
| `crear_campaña` | Nombre, plataforma, objetivo, fecha **y lo que pagaste** (→ gasto de Publicidad gestionado, cuenta como invertido) | `CampaignsService.create` |
| `registrar_venta_mostrador` | Monto en USD **o en Bs con la tasa del día**, fecha y nota | `SalesService.create` |
| `registrar_gasto` | Monto, categoría, descripción y quién lo pagó | `ExpensesService.create` |
| `registrar_abono` | A un encargo por su número, con monto y fecha | `OrdersService.addPayment` |

- ⚠️ **Sin herramientas de borrar ni editar en la v1.** Las correcciones se hacen
  en el panel. Así un malentendido del asistente **nunca destruye datos**.
- **El número de encargo → id** lo resuelve el servidor (buscar por `code` dentro
  de la organización del token); la IA nunca manda un id de base.
- **Bs → USD:** `registrar_venta_mostrador` acepta Bs + tasa del día y guarda
  `amount` en USD base (la base del costeo es SIEMPRE USD), como ya hace el panel.

## Seguridad (TDD anti-exploit — los tests van PRIMERO)

Esta superficie **crea escritura sin sesión de panel**, así que es superficie
sensible: dinero + un actor nuevo (la IA). Los tests de regresión se escriben
antes del fix y quedan permanentes:

- **Sin token o token revocado → 401.** (Guard del conector.)
- **`organizationId` mandado por la IA se rechaza** — el esquema estricto no lo
  acepta; la org sale del token. Test con el objeto real, no un mock.
- **No se pueden crear ventas tipo ENCARGO** (la regla del 2026-09-14 sigue
  valiendo: una venta ENCARGO además del pedido cuenta el dinero dos veces).
- **Montos > 0, fechas no futuras** (reusa `FECHA` de los schemas), y **un abono
  no puede superar el saldo** del encargo.
- **Anti-duplicado:** la misma venta (mismo monto y día) dentro de 2 minutos se
  rechaza, por si Claude reintenta una acción que ya se guardó.
- **Rate limit** por IP real con el `ProxyThrottlerGuard` que ya existe.
- **IDOR:** cualquier recurso que la IA nombre (un encargo por número) se busca
  **filtrando por la organización del token**; nunca por id directo.

## Fases (local primero; producción al final)

Decisión del dueño (2026-10-17): **construir y probar entero en local**; el push a
producción lo aprueba el dueño **al final**, cuando esté sólido y quiera usarlo en
el celular.

1. **Fase 0 — plumbing + auth (camino elegido) con sus tests de seguridad.**
   Tabla `ConnectorToken` (o OAuth), guard, `/api/mcp` responde el handshake MCP.
   Una herramienta de lectura trivial (`tasas_vigentes`) para probar punta a punta.
2. **Fase 1 — lecturas.** `resumen_periodo`, `ver_caja`, `buscar_encargos`.
3. **Fase 2 — escrituras + sus tests anti-exploit.** `registrar_venta_mostrador`,
   `registrar_gasto`, `registrar_abono`, `crear_campaña`. Cada una con anotación
   de aprobación.
4. **Fase 3 — panel: Configuración → Conectores** (si es camino A): generar y
   revocar el token, mostrarlo una sola vez.
5. **Fase 4 — despliegue (toca producción, aditivo).** Push a `main` → Render
   levanta `/api/mcp`. En claude.ai: Personalizar → Conectores → Agregar conector
   personalizado con la URL y el token → listo, también en el celular (el conector
   se **agrega** desde la PC/web —en el celular está en beta— y se **usa** desde el
   celular).

⚠️ **Probar el MCP en local contra el chat de Claude** necesita una URL pública
(la nube de Claude no alcanza `localhost`): se puede con un túnel temporal
(p. ej. durante el desarrollo) o probando el handler con el inspector de MCP /
Claude Code apuntando al local. El uso real desde el celular es recién la Fase 4.

## Esfuerzo estimado

v1 completa: ~1 día con camino A (token) + 1–2 días si toca camino B (OAuth), más
las fases de herramientas. No hay lógica de negocio nueva, así que el grueso es el
transporte MCP, la auth y los tests de seguridad.

## Lo que falta decidir / confirmar

1. **A vs B (auth):** mirar si aparece "Request headers" en Conectores de la
   cuenta del dueño. Se resuelve al empezar la Fase 0.
2. (Cerrado) Alcance v1 = campañas + anotar, sin borrar/editar.
3. (Cerrado) Local primero, desplegar al final.

## Fuentes

- Add a connector that isn't in the directory — Claude docs: https://claude.com/docs/connectors/custom/remote-mcp
- Build an MCP server for Claude — Claude docs: https://claude.com/docs/connectors/building
- Get started with custom connectors using remote MCP: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Connect to remote MCP Servers — Model Context Protocol: https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-remote-servers
