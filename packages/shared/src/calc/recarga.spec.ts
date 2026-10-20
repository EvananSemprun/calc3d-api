import {
  OPCIONES_DE_RECARGA,
  etiquetaDeRecarga,
  recargaDesdeValor,
  valorDeRecarga,
} from './recarga';

describe('etiquetaDeRecarga', () => {
  it('una recarga lo dice, y aclara que va sin carrete', () => {
    expect(etiquetaDeRecarga(true)).toBe('Recarga (sin carrete)');
  });

  it('un rollo con carrete lo dice', () => {
    expect(etiquetaDeRecarga(false)).toBe('Con carrete');
  });

  /**
   * ⚠️ El test central: sin dato NO se escribe "Con carrete". Las 95 compras
   * anteriores al campo valen `null`, y etiquetarlas sería ponerles una
   * afirmación que nadie hizo — la trampa del `DEFAULT 'BUSINESS'` de `paidBy`.
   */
  it('sin dato no inventa la etiqueta: devuelve null', () => {
    expect(etiquetaDeRecarga(null)).toBeNull();
    expect(etiquetaDeRecarga(undefined)).toBeNull();
  });
});

describe('valorDeRecarga / recargaDesdeValor — la ida y la vuelta del desplegable', () => {
  it('los tres estados dan vueltas enteras sin perderse', () => {
    for (const guardado of [true, false, null] as const) {
      expect(recargaDesdeValor(valorDeRecarga(guardado))).toBe(guardado);
    }
  });

  it('sin dato el desplegable queda vacío, no en "Con carrete"', () => {
    expect(valorDeRecarga(null)).toBe('');
    expect(valorDeRecarga(undefined)).toBe('');
  });

  /**
   * ⚠️ Borrar el dato tiene que poder hacerse: una elección equivocada que no
   * se puede desandar obliga al dueño a sostener algo que ya sabe falso.
   */
  it('volver a vacío BORRA el dato (null), no lo deja en false', () => {
    expect(recargaDesdeValor('')).toBeNull();
  });

  it('un valor desconocido no se adivina: cae en null', () => {
    expect(recargaDesdeValor('marciano')).toBeNull();
  });

  it('las dos opciones del desplegable cubren los dos hechos, sin una tercera', () => {
    expect(OPCIONES_DE_RECARGA.map((o) => o.isRefill)).toEqual([true, false]);
  });
});
