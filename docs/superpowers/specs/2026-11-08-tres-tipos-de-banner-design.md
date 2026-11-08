# Tres tipos de banner — diseño

**Fecha:** 2026-11-08 · **Repos:** `calc3d-api`, `calc3d-web`, `calc3d-landing`

## El problema

Hoy existe **un** solo banner y su único lugar es el arte del hero de la portada: se usa
el primero que tenga imagen y el resto se ignoran. El título y el subtítulo que el dueño
escribe **no se ven** (el título se recicla como `alt`). El dueño pidió tres cosas que
hoy no existen:

1. un **carrusel** en la portada, con varias piezas rotando;
2. poder editar **la franja de texto de arriba**, que hoy está escrita a mano en
   `Header.astro` y solo se cambia tocando código y desplegando;
3. un **banner por categoría**, que se vea al entrar a esa categoría y en las fichas de
   sus productos.

## Lo que se decidió (del dueño, 2026-11-08)

| Decisión | Elegido | Nota |
|---|---|---|
| Qué rota en el carrusel | **La diapositiva entera** (imagen + título + subtítulo) | Ver «El riesgo aceptado» |
| Franja de texto sin banner cargado | **Queda el texto de hoy** | Nunca un hueco |
| Dónde se ve el de categoría | **En la categoría Y en las fichas de sus productos** | |
| Vigencia por fechas | **No**: se prende y apaga a mano | La tienda es estática; una fecha no lo encendería sola |

### El riesgo aceptado

El carrusel de tres slides **existió y se quitó a propósito** en la migración a Astro. La
razón está escrita en `Hero.astro`: con el hero estático, el `h1`, el subtítulo y los dos
botones quedan en el HTML del build, así que se leen **sin JS**, no hay salto de layout y
Google los ve. Rotar la diapositiva entera devuelve ese problema.

**Mitigación obligatoria:** la **primera** diapositiva se renderiza en el build, con su
`h1` real; solo la rotación se hidrata. Sin JS se ve la primera y es correcta. Si una
implementación futura pasa a construir todas las slides en el cliente, este spec queda
violado.

## El modelo

`StoreBanner` gana `kind` y `categoryId`, y `imageKey` pasa a ser **opcional**.

```prisma
enum StoreBannerKind { HERO TEXTO CATEGORIA }

model StoreBanner {
  kind       StoreBannerKind @default(HERO)
  imageKey   String?         // obligatoria en HERO y CATEGORIA; prohibida en TEXTO
  categoryId String?         // obligatoria en CATEGORIA; prohibida en los otros dos
  // title, subtitle, linkType, linkValue, position, visible: sin cambios
}
```

**Reglas del contrato (Zod), las tres con su test:**

- `HERO`: exige `imageKey`. `title` se usa de verdad (se dibuja en la slide).
- `TEXTO`: exige `title`, **prohíbe** `imageKey` y `categoryId`. `subtitle` se ignora.
- `CATEGORIA`: exige `imageKey` y `categoryId`.

⚠️ Las prohibiciones son tan importantes como las exigencias: un campo que el tipo no usa,
guardado porque el formulario lo ofrecía, después alguien lo lee como información.

## Qué devuelve la API

`GET /public/store/banners` sigue siendo **un** endpoint y devuelve los visibles con su
`kind` y, en los de categoría, el **slug** de su categoría. La tienda reparte en el build.

Dos degradaciones, por el mismo criterio que ya existe para un destino colgado:

- un `CATEGORIA` cuya categoría se borró **no se devuelve** (no hay página donde mostrarlo);
- un destino (`linkType`/`linkValue`) que ya no resuelve degrada a `NONE`, como hoy.

## Qué dibuja la tienda

| Tipo | Dónde | Sin ninguno cargado |
|---|---|---|
| `HERO` | Portada, en lugar del arte del hero | El arte de marca de hoy |
| `TEXTO` | La franja de arriba, en todas las páginas | El texto de hoy, escrito a mano |
| `CATEGORIA` | `/tienda/<cat>/` y `/producto/<slug>/` de esa categoría | No se dibuja nada |

Con **un solo** banner de hero no hay carrusel: se dibuja la slide y punto (ni controles ni
JS). Un carrusel de uno es un carrusel roto.

## No-objetivos

- **Fechas de vigencia.** Decidido que no.
- **Que el banner se publique solo.** La tienda se arma en el build: cargar un banner no lo
  muestra hasta reconstruir el sitio. Vale para los tres tipos y hay que decirlo en el panel.
- **Subir la imagen desde la API.** Sigue el mismo doble paso que las fotos de producto.

## Orden de despliegue

Cambia la forma de la respuesta de la API, así que **la API va primero** y se espera a que
Railway la levante; después el panel y la tienda. Al revés, la tienda nueva le pregunta a
la API vieja por un campo que no existe.

La migración es **aditiva** (una columna nueva con default y dos que se vuelven opcionales),
así que los banners que ya existen quedan como `HERO` sin tocar nada.
