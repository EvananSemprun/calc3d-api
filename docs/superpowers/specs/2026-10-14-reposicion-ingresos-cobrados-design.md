# Reposición de equipos: el ingreso es lo COBRADO, no lo facturado — Diseño

**Fecha:** 2026-10-14
**Repo:** `calc3d-api` (`apps/api/src/printers/printers.module.ts`, `recovery()`)
**Estado:** aprobado por el dueño (decisión tomada en chat); pendiente de implementar.

## El problema (reportado por el dueño)

En el Dashboard, con el filtro en "Todo", dos tarjetas que dicen lo mismo daban
números distintos:

- **Resultado de la operación**: **−$168.17** (cobrado − gastos operativos).
- **Reposición de equipos → ganancia acumulada**: **−$153.17** (ingresos
  $2,606.98 − gastos operativos $2,760.15).

Difieren en **exactamente $15**, y las dos pretenden ser "ingresos − gastos
operativos de toda la historia". Es el patrón que el proyecto persigue: **dos
definiciones del mismo número**.

## Causa

Los **gastos operativos coinciden** en las dos (Σ `Expense` con
`isInvestment = false`). La diferencia está **toda en el ingreso**:

- **Resultado de la operación** (Dashboard, `agg.ingresos`): `Σ Sale.amount +
  Σ Payment.amount` (ventas + **abonos cobrados**).
- **Reposición** (`recovery()`, hoy): `Σ Sale.amount + Σ (líneas de TODOS los
  pedidos)` — el **total facturado de cada pedido**, sin filtrar estado.

Dos problemas en la definición de Reposición:
1. Cuenta el total **facturado**, no lo cobrado: un pedido con saldo pendiente
   suma al ingreso plata que todavía no entró. Esos son los $15.
2. `order.findMany` **no filtra estado**: un pedido **COTIZADO** (una cotización
   que el cliente ni aceptó) o **CANCELADO** suma su total como si fuera ingreso.

## Decisión

**Unificar Reposición a COBRADO**: `recovery()` calcula
`income = Σ Sale.amount + Σ Payment.amount`, la MISMA definición que
`agg.ingresos` del Dashboard (`calc3d-web/apps/web/src/pages/Dashboard.tsx`).

Por qué cobrado y no facturado:
- La pregunta de Reposición es "¿tengo ganancia para **reponer** equipos?", y se
  repone con **plata que entró**, no con pedidos facturados sin cobrar.
- De paso desaparece el bug de contar cotizaciones/cancelados como ingreso: los
  abonos solo existen sobre pedidos reales que cobraron algo.
- Los dos números del Dashboard pasan a **coincidir** (es el objetivo del dueño).

El `Payment` tiene `organizationId` y `amount`, no se anula (se borra), así que
`Σ Payment.amount` por organización ES el total de abonos, idéntico al que suma
el endpoint `GET /orders/payments` que alimenta el Dashboard.

## Alcance

- Cambiar SOLO el cálculo de `income` en `recovery()`: la consulta de pedidos
  (`order.findMany` + `total(lines)`) se reemplaza por
  `payment.findMany({ where: { organizationId }, select: { amount: true } })`.
- `operatingExpenses`, la cascada de reposición (`equipmentRecovery`) y todo lo
  demás **no cambian**.
- No hay migración ni cambio de contrato (la respuesta mantiene su forma:
  `income`, `operatingExpenses`, `accumulatedProfit`, …).

## Tests (regresión de dinero)

- **Número clavado + contrafáctico** en `printers.service.spec.ts`: con ventas
  $100, un pedido facturado $50 con solo $35 abonados, un pedido COTIZADO $20 sin
  abonos, gastos operativos $40 → `income = 135` (100 + 35), `accumulatedProfit =
  95`. La forma vieja (totales de pedidos) habría dado `income = 170` y
  `accumulatedProfit = 130`: el test cae si alguien vuelve a sumar los pedidos.
- Verificación por mutación: volver a `order.findMany` + totales tumba el test.

## Fuera de alcance

- Cambiar el Dashboard (su `agg.ingresos` ya es la definición buena).
- Pasar la app a base devengada (ya se evaluó y descartó; sería un alcance
  mucho mayor: Dashboard, Encargos, Caja, Por cobrar, equilibrio, Metas).
