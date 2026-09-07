# Control de filamento: compras y stock mensual

Fecha: 2026-09-07 · Repos afectados: `calc3d-api`, `calc3d-web`.
Referencia: hojas **`Inventario`** y **`Stock mensual`** de `bananolab.xlsx`.

## Objetivo

Llevar a la app los **dos** controles de filamento que hoy viven en el Excel:

1. **Compras** (`Inventario`): qué se compró, cuándo, a quién y cuánto costó de
   verdad — incluyendo el pago en bolívares.
2. **Stock mensual** (`Stock mensual`): cuántos rollos hay al cierre de cada mes,
   cuáles están por acabarse y cuánto se consumió.

## Punto de partida (medido, no supuesto)

| | Excel | App hoy |
|---|---|---|
| Compras | 48 filas en `Inventario` | **El dato ya existe**: `Expense` con `materialId`, `quantity`, `date`, `providerId`, `rate`/`currencyCode`. **52 compras cargadas.** Falta la pantalla. |
| Stock | 33 filas en `Stock mensual` | **No existe nada.** |
| Catálogo | Material + Color (sin marca) | 39 `Material` con marca, color, tipo, `rollPrice`, `rollGrams` |
| Costo por gramo | `costo por rollo ÷ 1000` **fijo** | `rollGrams` real por material |

Detalles de los datos del dueño: **ninguna** de las 48 compras tiene fecha —la
nota 6 de `Inventario` dice que son el histórico anterior a septiembre 2026— y
**ninguna** usó todavía las columnas de bolívares, aunque la hoja las contempla.
Del stock, **solo AGO 2026 está contado** (33 filas, 28 rollos); septiembre en
adelante está vacío.

## Decisiones tomadas

Confirmadas con el dueño el 2026-09-07.

1. **El conteo es por MATERIAL del catálogo** (con marca: PLA Amarillo Creality ≠
   PLA Amarillo Bambu), y la **pantalla los agrupa por color** para que se lea
   como la hoja. El stock cuelga del material que ya se usa al cotizar; no se
   inventa una entidad "color".
2. **Conteo MANUAL al cierre de mes**, como el Excel. No se descuenta del stock
   lo que consumen los presupuestos: no todo lo cotizado se imprime, no todo lo
   impreso sale bien y la purga del AMS no está en ningún presupuesto. El
   conteo físico es lo único que no miente.
3. **La última compra manda**: registrar una compra de filamento actualiza
   `Material.rollPrice` = `amount ÷ quantity`. Hoy eso depende de una casilla
   opcional en el front (`priceField: 'rollPrice', perUnit: true`); pasa a ser el
   comportamiento por defecto **y se resuelve en el backend**, para que valga sin
   importar desde dónde se registre la compra.
4. **Alcance: los dos controles completos** en esta tanda.
5. **Los datos verdaderos están en el Excel.** Lo que hay hoy en la app (39
   materiales, 52 compras) se **borra y se recrea** desde `Inventario`. Los
   presupuestos guardados no se rompen (el snapshot lleva los precios adentro),
   pero el recosteo de productos dejará de encontrar esos materiales por nombre
   y los reportará en `unmatched`.
6. **Las 48 compras entran fechadas 31/08/2026**, con una nota que dice que la
   fecha real no está registrada. `Expense.date` es obligatorio porque alimenta
   el dashboard; falsearla en silencio sería peor que decirlo.
7. **El conteo de agosto se importa completo**, asignando marca SOLO donde es un
   hecho comprobable — ver "Las 9 filas ambiguas".
8. **`Material` gana `status`** (`ACTIVE` / `DISCONTINUED`), como el Estado del
   Excel.

### Decisiones de diseño que tomé yo (revisables)

9. **Un conteo por material y por mes**, identificado por el primer día del mes
   en UTC (mismo criterio que `deliveryDate`). No hay conteos parciales ni dos
   conteos del mismo mes.
10. **El total NO se almacena**: `sinAbrir + enUso + porAcabarse` se deriva, igual
    que el saldo de un pedido. Guardar un total que puede contradecir sus partes
    es pedir que se desincronicen.
11. **Ubicación**: una página nueva **Filamento** con dos pestañas — *Compras* y
    *Stock del mes* — en el grupo Definiciones del menú. No se mezcla con
    Catálogos (que es alta de fichas) ni con Gastos (que es dinero que sale).

## Las 9 filas ambiguas del conteo de agosto

El conteo del Excel es por color SIN marca; el de la app es por material CON
marca. De las 33 filas, **24 se resuelven solas**:

| Caso | Filas | Cómo se asigna |
|---|---|---|
| El color se compró a UNA sola marca | 17 | Esa marca. Es un hecho, no una suposición |
| El total del color es CERO | 7 | Cero en todas las marcas de ese color |
| **Ambiguas** | **9** | **Marca "Sin especificar" + pendiente de identificar** |

Las 9 ambiguas son **un rollo cada una**: PLA Amarillo, Azul, Blanco, Celeste,
Dorado, Gris, Rojo, Verde y PETG Negro.

**Por qué "Sin especificar" y no la última marca comprada:** que quede un rollo
de blanco por acabarse es un hecho; de qué marca es, no se sabe. Asignarlo a la
última marca fabrica un dato indistinguible de uno real — dentro de tres meses
nadie sabría cuál se inventó. Repartirlo entre marcas es peor: deja media fila
cierta en ninguna parte. Y no importar el conteo tira 24 filas ciertas por 9
dudosas.

Implementación: se crea el material con `brand = 'Sin especificar'` y el
`StockCount` importado lleva `needsBrandCheck = true`. La pantalla los lista
aparte ("9 rollos por identificar") y el flag se apaga al moverlos al material
correcto. Se corrige mirando el estante.

## Fuera de alcance

- Descontar stock automáticamente (decisión 2).
- Stock de insumos que no sean filamento (argollas, bolsitas). El Excel tampoco
  los cuenta: su hoja `Materiales` es un catálogo de costos, no un inventario.
- **Migrar el resto del Excel** (Ventas, Encargos, Clientes, Gastos, Publicidad,
  Inversión, Deuda, Metas). El dueño quiere hacerlo, pero va en su propio spec:
  ver "El resto del Excel" al final.

---

## Modelo de datos

```prisma
enum MaterialStatus {
  ACTIVE
  DISCONTINUED
}

model Material {
  // …campos actuales…
  status      MaterialStatus @default(ACTIVE)
  stockCounts StockCount[]
}

/// Conteo FÍSICO de rollos al cierre de mes (hoja "Stock mensual").
/// El total no se guarda: se deriva de las tres partes.
model StockCount {
  id             String   @id @default(cuid())
  organizationId String
  materialId     String
  /// Mes contado, como primer día del mes en UTC.
  month          DateTime
  sealed         Int      @default(0) // sin abrir
  inUse          Int      @default(0) // abierto, con material
  running        Int      @default(0) // por acabarse (menos de un cuarto)
  /// El conteo se importó sin saber la marca del rollo (ver "Las 9 filas
  /// ambiguas"). Se apaga al moverlo al material correcto.
  needsBrandCheck Boolean @default(false)
  countedAt      DateTime @default(now())

  @@unique([materialId, month])
  @@index([organizationId, month])
}
```

## Cálculos (en `packages/shared`, puros y con tests)

```ts
stockTotal(c)                    // sealed + inUse + running
monthConsumption(prev, curr)     // total(prev) − total(curr); null si falta un mes
purchaseCostPerRoll(amount, qty) // amount ÷ qty  (amount ya está en USD base)
purchaseCostPerGram(perRoll, rollGrams) // ÷ rollGrams REAL, no ÷1000
restockStatus(material, count)   // 'OUT' | 'LOW' | 'OK' | 'IGNORED' (descontinuado)
```

⚠️ **Los números NO van a coincidir con tu hoja para rollos que no sean de 1 kg**,
y es a propósito: el Excel divide entre 1000 fijo. Para los rollos de 1 kg —todos
los actuales— da igual.

## API

| Endpoint | Qué hace |
|---|---|
| `GET /filament/purchases` | Compras de filamento (los `Expense` con `materialId`) con costo por rollo y por gramo derivados, y el pago en Bs si lo hubo |
| `GET /filament/stock?month=AAAA-MM` | El conteo de ese mes, con TODOS los materiales activos (los no contados vienen en cero) |
| `PUT /filament/stock` | Guarda/actualiza el conteo de un material en un mes (upsert por `materialId + month`) |
| `GET /filament/summary?month=AAAA-MM` | Total de rollos, cuántos por acabarse, consumo del mes (contra el mes anterior) y lista de reposición |

Y en `expenses`: al crear un gasto con `materialId` + `quantity`, el servicio
actualiza `Material.rollPrice`. **El cliente no manda ese precio** — lo calcula el
servidor, igual que `costAtSave` en productos.

## Pantalla (`calc3d-web`)

**Página `Filamento`**, dos pestañas:

- **Compras** — tabla: fecha · material · cantidad · costo total · **costo por
  rollo** · **costo por gramo** · proveedor. Filtro por rango de fechas
  (`useDateRange`, ya existe) y totales al pie. El alta reusa el modal de gastos
  que ya distingue el tipo "Filamento".
- **Stock del mes** — selector de mes; filas **agrupadas por color** con tres
  campos por material (Sin abrir / En uso / Por acabarse) y su total. Al pie:
  total de rollos, por acabarse y consumo del mes. Arriba, la **lista de
  reposición**: activos en cero (rojo) y por acabarse (ámbar). Los
  descontinuados quedan fuera, como en la hoja.

Se reusan `useDateRange`, `SearchInput`, `usePersistentState`, `NumberInput` y el
patrón tabla↔tarjetas para móvil.

## Riesgos

1. **"La última compra manda" cambia el comportamiento actual.** Hoy el precio
   solo se actualiza si se marca la casilla. Desde el cambio, cada compra pisa el
   precio del catálogo. Las 52 compras ya cargadas **no se recalculan**: aplica de
   ahí en adelante.
2. **El conteo mensual es trabajo manual del dueño.** Si un mes no se cuenta, el
   consumo de ese mes y del siguiente quedan sin calcular (no se inventa: se
   muestra "sin dato"). Es la misma limitación que tiene la hoja.
3. **39 materiales para contar a mano cada mes** es más filas que las 33 del
   Excel. Por eso la pantalla agrupa por color y recuerda el conteo del mes
   anterior como punto de partida.

---

## Plan de ejecución

### Fase 1 — Cálculos (`packages/shared`)
TDD: helpers puros con sus tests (`stockTotal`, `monthConsumption`,
`purchaseCostPerRoll`, `purchaseCostPerGram`, `restockStatus`) + los schemas Zod
del conteo. Verificación: `pnpm test:shared` verde.

### Fase 2 — Datos y API (`calc3d-api`)
Migración (`Material.status`, tabla `StockCount`), módulo `stock`, endpoint de
compras y la actualización del precio en `expenses`. Con tests de servicio,
incluido que **el precio lo fija el servidor** y que el conteo respeta la
organización. Verificación: `pnpm -r test` y `pnpm -r build`.

### Fase 3 — Pantalla de compras (`calc3d-web`)
Pestaña *Compras* con sus derivados y el filtro por fechas.

### Fase 4 — Pantalla de stock mensual (`calc3d-web`)
Pestaña *Stock del mes*, agrupación por color, totales, consumo y reposición.
Verificación renderizada, incluido móvil.

### Fase 5 — Importación desde el Excel (`calc3d-api`)
Script de importación **idempotente y con reporte**, corrido a mano (no un
endpoint: es un evento único, no una función del producto).

1. Borra los 39 materiales y sus 52 compras.
2. Crea los materiales desde `Inventario`: una ficha por **material + color +
   marca**, con `rollPrice` = costo de la compra más reciente de esa ficha, y
   `status` desde el Estado de `Stock mensual`.
3. Crea las 48 compras como `Expense` con `materialId`, `quantity`, proveedor,
   `date = 2026-08-31` y la nota "compra histórica (fecha real no registrada)".
4. Crea el conteo de AGO 2026 con la regla de las tres vías, marcando las 9
   ambiguas con `needsBrandCheck`.
5. Imprime un reporte: cuántas fichas, cuántas compras, cuántos rollos contados,
   cuántos pendientes de identificar. **Si los totales no cuadran con el Excel,
   falla y no escribe nada.**

Verificación: los 28 rollos del Excel están en la app, el total invertido en
filamento coincide con `Inventario!D114`, y las 9 filas pendientes son las nueve
esperadas.

**Resultado real (2026-09-07):** 57 fichas de material (48 del Excel + 9 "Sin
especificar"), 48 compras con 66 rollos y $1290, 28 rollos contados en 36 filas
de agosto, 2 colores descontinuados y 9 rollos por identificar. Todo verificado
contra el Excel por el propio script, antes y después de escribir.

⚠️ **La lista de reposición muestra más filas que la hoja** (18 contra 15): la
hoja cuenta colores y la app cuenta fichas con marca, así que un color en cero
comprado a dos marcas son dos fichas a reponer. Es la consecuencia buscada de la
decisión 1 — al reponer te dice de qué marca comprar.

### Fase 6 — Cierre
CLAUDE.md de los tres repos + prueba de punta a punta.

**Lo que encontró la prueba (2026-09-07):**

1. **Las fichas "Sin especificar" pedían reposición.** Al identificar un rollo,
   la ficha temporal quedaba en cero y entraba en la lista como un color a
   comprar. Ahora nacen `DISCONTINUED`. Efecto lateral bueno: la reposición pasó
   de 18 a **15**, que es exactamente lo que cuenta la hoja.
2. **Un conteo parcial se tomaba como completo.** Contar 1 ficha de 57 daba
   "consumiste 28 rollos". El resumen ahora expone `countedMaterials`,
   `totalMaterials` y `complete`, y la pantalla avisa: *"Llevás 1 de 57 fichas
   contadas este mes. Hasta terminar el conteo, el total y el consumo no son de
   fiar."*

**Lo verificado de punta a punta:** registrar una compra actualiza el precio del
rollo desde el servidor ($20 → $25 con 2 rollos a $50); identificar un rollo
ambiguo baja el contador de 9 a 8 y mueve el rollo sin cambiar el total del mes;
el consumo se calcula entre dos meses. Todo se revirtió al terminar: el estado
quedó idéntico al de la importación (57 fichas, 48 compras, 36 conteos, 9
pendientes).

---

## El resto del Excel (spec aparte)

El dueño quiere migrar todo el archivo. Son ~85 filas fuera del filamento: poco
volumen, pero **no es un solo trabajo**, y por eso no entra acá. Se dividen en
tres grupos, y conviene tratarlos por separado:

| Hoja | Filas | A dónde va | Dificultad real |
|---|---|---|---|
| `Encargos` | 7 | `Order` / `Sale` | Directa: fecha, cliente, producto, canal, monto, costo |
| `Publicidad` | 7 | `Campaign` | Directa |
| `Gastos` | 19 | `Expense` | **Sin fecha ni categoría de la app**: hay que mapear Insumos/Repuestos/Empaque/Diseño y fechar |
| `Inversion` | 2 equipos | `Printer` + `Expense` (inversión) | Directa; ya existe el concepto |
| `Clientes` | 5 | `Client` | Solo **nombre y tipo** son datos: el resto son fórmulas que la app ya deriva sola |
| `Ventas` | ~20 semanas | `Sale` | ⚠️ **La más difícil**: no es una tabla, es una grilla semanal con los montos DENTRO del texto (`"Martes 3: 10$"`). Hay que parsear texto libre, y las columnas no dicen el año |
| `Deuda` | 8 | **no existe en la app** | Es una feature nueva (préstamo y sus pagos), no una importación |
| `Metas` | 11 | **no existe en la app** | Idem: metas mensuales de ventas y encargos |
| `Resumen` | — | — | Es un dashboard de las demás hojas; la app ya lo calcula |

Recomendación: **primero el filamento** (este spec, ya definido y verificado);
después un spec de importación para las hojas directas (Encargos, Publicidad,
Inversión, Clientes, Gastos); y `Ventas`, `Deuda` y `Metas` aparte, porque las
tres necesitan decisiones que todavía no se tomaron.

## Sobre subagentes

Las fases 1 y 2 van en secuencia y de a un agente: el contrato tiene que existir
antes que la API, y ahí es donde un error se traduce en un costo mal calculado.

La fase 5 (importación) va DESPUÉS de la 2: necesita las tablas creadas.

**Las fases 3 y 4 sí son paralelizables entre sí**: son dos pestañas
independientes, cada una con su endpoint ya cerrado y sin estado compartido más
allá del layout de la página. Se pueden repartir en dos agentes una vez que la
fase 2 esté verde y el esqueleto de la página exista.

Lo que conviene dejar a un solo agente: el esqueleto de `Filamento` (las
pestañas) y los tipos compartidos del front.
