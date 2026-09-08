# Un solo catálogo: la ficha de tienda absorbe el costeo

Fecha: 2026-09-07 · Decisión del dueño · **Revierte** una decisión de diseño
anterior (ver §2).

## 1. Qué cambia

La calculadora **deja de guardar presupuestos**. Pasa a ser una herramienta
referencial y el lugar desde donde se registra un producto — y ese producto es
directamente **la ficha de la tienda**, no una entidad aparte.

| Antes | Ahora |
|---|---|
| Calculadora → Presupuesto → (a mano) Producto → (a mano) Ficha de tienda | Calculadora → **Ficha de tienda** (con su costeo adentro) |
| `Product` y `StoreProduct` separados, unidos por "Publicar en la tienda" | Un solo modelo: `StoreProduct` |
| Cotización al cliente desde el presupuesto | Cotización al cliente **desde el pedido** en estado Cotizado |

## 2. Por qué se revierte la separación

El `CLAUDE.md` decía, y con un argumento razonable:

> **`StoreProduct` NO es `Product`.** Fusionarlos haría que editar una foto
> tocara el costeo — y un **servicio** no tiene `CalcInput`, así que ni entraría
> en `Product`, que exige `input` y `costAtSave`.

Lo que ese argumento no vio es que **la fusión puede ir en la otra dirección**.
El problema del servicio aparece solo si el catálogo único es `Product`, que
EXIGE costeo. Si el catálogo único es la ficha de tienda, donde el costeo es
**opcional**, el servicio entra sin forzar nada.

Y los datos del negocio al 2026-09-07 lo confirman:

- **`Product` tiene 0 filas.** La pantalla existió dos meses y nunca se usó: el
  dueño cargaba la ficha directo en la tienda.
- **`Quote` tiene 4 filas, todas borrador**, ninguna enviada ni convertida en
  venta. Todas de prueba.
- De las 3 fichas de tienda, **una es un SERVICIO** — el caso que supuestamente
  no entraba — y vive ahí sin problema desde siempre.

O sea: no hay migración de datos. Hay una tabla vacía que sobra y una feature de
la que nadie tiraba.

## 3. El modelo que queda

`StoreProduct` gana **`input Json?`**: el snapshot del `CalcInput` con el que se
costeó. Es lo ÚNICO que `Product` aportaba y la ficha no tenía, y habilita el
recosteo (recalcular con los precios de hoy y avisar si el margen cayó).

- `input` **null** = ficha sin costeo (un servicio, o algo cargado a mano). No es
  un error: es la mitad del catálogo.
- `costAtPublish` ya existía y sigue siendo **el costo que calculó el servidor**,
  nunca uno que mande el cliente.

## 4. La cotización al cliente

El PDF con el logo, precios y sin costos no se pierde: pasa a colgar del
**pedido**. Un pedido en estado `QUOTED` ES una cotización — ya tiene cliente,
líneas, moneda y su propio documento. Cotizar deja de ser una entidad separada y
pasa a ser el primer estado del pedido, que es como el negocio funciona de
verdad: le pasás un precio a alguien y, si dice que sí, ese mismo registro sigue
adelante.

## 5. Fases (la app funciona entre una y otra)

1. **La ficha absorbe el costeo.** `StoreProduct.input`, recosteo sobre la
   ficha, y la calculadora guarda ahí. Nada se borra.
2. **Muere `Product`.** Módulo, pantalla, entrada del menú y la tabla (vacía).
3. **Muere `Quote`.** El PDF de cotización pasa al pedido; se van el módulo, las
   pantallas, `/sales/from-quote` y el ciclo de cotización del Dashboard.

## 6. Lo que NO cambia

- El motor de cálculo (`calculateQuote`) es el mismo. Esto es dónde se guarda el
  resultado, no cómo se calcula.
- Los pedidos, la bandeja de la tienda y el catálogo público siguen igual: la
  ficha ya era lo que el cliente veía.
- `costAtPublish` lo sigue poniendo el servidor.
