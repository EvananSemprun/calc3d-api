import { SlugSchema, StoreBannerCreateSchema, StoreProductCreateSchema, slugify } from './store';

/**
 * El destino del banner es superficie de seguridad: un `javascript:` en el href
 * o un destino incoherente no deben pasar el contrato.
 */
describe('StoreBannerCreateSchema', () => {
  const base = { title: 'Promo', imageKey: 'org/store/banners/x.png' };

  it('acepta un banner sin enlace', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'NONE' }).success).toBe(true);
  });

  it('acepta una URL http(s)', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'URL', linkValue: 'https://wa.me/58412' }).success).toBe(true);
  });

  it('rechaza una URL con protocolo javascript:', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'URL', linkValue: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rechaza una URL sin protocolo', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'URL', linkValue: 'wa.me/x' }).success).toBe(false);
  });

  it('exige destino cuando el tipo no es NONE', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'CATEGORY' }).success).toBe(false);
  });

  it('rechaza destino cuando el tipo es NONE', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, linkType: 'NONE', linkValue: 'algo' }).success).toBe(false);
  });

  it('exige título e imagen', () => {
    expect(StoreBannerCreateSchema.safeParse({ ...base, title: '', linkType: 'NONE' }).success).toBe(false);
    expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: '', linkType: 'NONE' }).success).toBe(false);
  });
});

/**
 * El slug es la URL pública de un producto: si `slugify` y `SlugSchema` no
 * coinciden, el panel mostraría un enlace que el backend rechaza.
 */
describe('slugify', () => {
  it('pasa un nombre normal a enlace', () => {
    expect(slugify('Llaveros de Copa del Mundial')).toBe('llaveros-de-copa-del-mundial');
  });

  it('quita tildes sin partir la palabra', () => {
    // Sin normalizar, "canción" terminaría como "cancio-n".
    expect(slugify('Canción de cuna')).toBe('cancion-de-cuna');
    expect(slugify('Diseño 3D a medida')).toBe('diseno-3d-a-medida');
    expect(slugify('ÁÉÍÓÚ Ñ')).toBe('aeiou-n');
  });

  it('colapsa separadores y no deja guiones sueltos en los bordes', () => {
    expect(slugify('  ¡Figura // Articulada!  ')).toBe('figura-articulada');
    expect(slugify('---')).toBe('');
  });

  it('lo que genera SIEMPRE pasa la validación del contrato', () => {
    const nombres = [
      'Llaveros de Copa del Mundial',
      'Soporte para móvil (PETG)',
      'Impresión 3D — servicio express',
      'Ñandú & Co.',
    ];
    for (const n of nombres) {
      expect(SlugSchema.safeParse(slugify(n)).success).toBe(true);
    }
  });

  it('rechaza enlaces con mayúsculas, espacios o símbolos', () => {
    for (const malo of ['Llaveros', 'con espacio', 'con_guion_bajo', 'acentuado-canción', '-borde']) {
      expect(SlugSchema.safeParse(malo).success).toBe(false);
    }
  });
});

describe('StoreProductCreateSchema', () => {
  it('acepta lo mínimo y aplica los valores por defecto', () => {
    const out = StoreProductCreateSchema.parse({ name: 'Llavero', priceUsd: 3 });
    expect(out).toMatchObject({
      kind: 'PHYSICAL',
      minQty: 1,
      visible: false, // nace como borrador: publicar es un acto explícito
      optionGroups: [],
    });
  });

  it('no acepta precios negativos', () => {
    expect(StoreProductCreateSchema.safeParse({ name: 'X', priceUsd: -1 }).success).toBe(false);
  });

  it('no acepta el costo: el precio de costo lo pone el servidor', () => {
    // Si `costAtPublish` entrara por el DTO, cualquiera podría escribir el costo
    // interno de un producto publicado.
    const out = StoreProductCreateSchema.parse({
      name: 'Llavero',
      priceUsd: 3,
      costAtPublish: 999,
    } as never);
    expect(out).not.toHaveProperty('costAtPublish');
  });

  it('exige al menos una opción dentro de un grupo', () => {
    const out = StoreProductCreateSchema.safeParse({
      name: 'Llavero',
      priceUsd: 3,
      optionGroups: [{ name: 'Color', options: [] }],
    });
    expect(out.success).toBe(false);
  });

  it('valida la muestra de color en formato #RRGGBB', () => {
    const conColor = (swatchHex: string) =>
      StoreProductCreateSchema.safeParse({
        name: 'Llavero',
        priceUsd: 3,
        optionGroups: [{ name: 'Color', options: [{ value: 'Rojo', swatchHex }] }],
      }).success;
    expect(conColor('#FF0000')).toBe(true);
    expect(conColor('rojo')).toBe(false);
    expect(conColor('#F00')).toBe(false);
  });
});
