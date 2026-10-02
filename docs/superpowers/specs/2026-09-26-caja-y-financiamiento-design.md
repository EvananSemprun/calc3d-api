# Caja, financiamiento y mantenimiento derivado

Fecha: 2026-09-26 · shared 0.17.0 · Origen: el Excel `bananolab.xlsx` volvió a
editarse a mano y agregó la hoja **Caja**, reescribió **Inversion** ("quién puso
la plata") y sumó "Pagado por" en **Deuda** y el mantenimiento por hora en
**Costeo**.

## Decisiones (del dueño, 2026-09-26)

1. **"Pagado por" en vez de copiar la hoja Caja.** `Expense.paidBy` y
   `LoanPayment.paidBy` (`BUSINESS` / `OWNER` / `LOAN`). Los aportes de Vanan se
   DERIVAN de los gastos que pagó; solo la plata pura va en `OwnerMovement`. La
   hoja anotaba cada compra dos veces (Gastos y Caja).
2. **El precio del rollo sigue siendo el de la última compra de cada ficha.** La
   hoja pasó a usar el promedio del mes; se descartó porque mezcla marcas de
   $18 y $30.
3. **Mantenimiento por hora derivado**, global: repuestos ÷ horas leídas.
4. Alcance completo: migración, API, pantalla Finanzas → Caja, tarjetas en el
   Dashboard, hojas en el reporte y datos 1:1.

## Modelo

- `PaidBy`, `OwnerMovementKind`, `ExpenseCategory.DESIGN`.
- `OwnerMovement` (fecha, tipo, monto, concepto, nota).
- `CashCount` (fecha única por org, total en Binance, nota). Lo del negocio se
  deriva a la fecha del conteo; la diferencia es lo personal. Negativo = alerta.

## Cuentas (puras, `shared/calc/cash.ts`)

- `businessCash(ledger, until?)`: las líneas de la hoja Caja (B13:B19).
- `cashCountCheck(total, negocio)`.
- `ownerFinancing(...)`: filas 14-19 de Inversion, con la cascada de retiros
  diseñador → compras → cuotas → equipo.

## Verificado contra el Excel (26/09)

Gastos generales $1.159,41 · filamento $1.398,91 · repuestos $122 · diseñador
$685 · compras de Vanan $56 · cuotas de Vanan $250 · pagos a Vanan $475,14 ·
préstamo $750 · le debe a Vanan $1.130,86. El saldo del negocio al 21/09 difiere
de la hoja en $23,50: el descuadre conocido de la fila 11 de Ventas.
