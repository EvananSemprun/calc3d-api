/**
 * LAS FORMAS DEL VOSEO, UNA SOLA VEZ PARA LOS DOS REPOS.
 *
 * Los guardianes de idioma (`apps/api/src/common/idioma.spec.ts` y
 * `calc3d-web/apps/web/src/idioma.spec.ts`) declaraban los dos que esta lista
 * «es IDÉNTICA en los dos repos (copiada, no importada)», y **nada lo
 * comprobaba**. El día que una sumara una forma y la otra no, el repo que se
 * quedó corto pierde cobertura con todo en verde — que es exactamente el
 * incidente que creó estos guardianes (una lista fija dejó 19 formas sin
 * corregir).
 *
 * La lista es del IDIOMA, no del corpus: una forma que es voseo en la API lo es
 * en el panel. Así que vive acá, en el único artefacto que `pnpm sync:shared`
 * ya mantiene idéntico entre los dos repos, y los dos guardianes la importan.
 *
 * ⚠️ Se edita en `calc3d-api` y se sincroniza al panel, como todo `shared`.
 *
 * ⚠️ **`PALABRAS_PERMITIDAS` NO se mueve acá**, y la distinción es el punto:
 * esa depende del CORPUS de cada repo (qué palabras legítimas usa su código),
 * es distinta en cada uno y cada entrada tiene que seguir apareciendo en ESE
 * código. Tratar las dos como «del idioma» —o las dos como «del corpus»— es lo
 * que dejó al panel con la lista corta.
 *
 * ⚠️ **Este archivo está EXENTO del barrido de los dos guardianes** (es el
 * único, y los dos tienen un test que lo fija): si no, la lista se denunciaría
 * a sí misma.
 *
 * Los imperativos van CON ACENTO y se buscan como palabra completa. Sin el
 * acento, `hace`/`toca`/`mira`/`registra` son tercera persona del indicativo
 * («el motor hace la cuenta») y dan cientos de falsos positivos: un guardián
 * que grita por todo lo apaga alguien a la semana. El PRESENTE de voseo
 * (`-ás`/`-és`/`-ís`) no se enumera: cada guardián lo caza por patrón.
 */
export const IMPERATIVOS_DE_VOSEO = [
  'abonás', 'tenés', 'podés', 'tocá', 'mirá', 'dejalo', 'registrá', 'elegí',
  'hacé', 'ingresá', 'avisá', 'sacá', 'pasá', 'verificá', 'poné', 'cargá',
  'borrá', 'revisá', 'usá', 'sumá', 'decí', 'fijate', 'acordate', 'escribí',
  'mandá', 'corregí', 'volvé', 'cargala', 'contá', 'llená', 'cerrá', 'anotá',
  'publicá', 'cambiá', 'marcá', 'recargá',
  // Medidas en los dos corpus:
  'deshacé', 'generá', 'indicá', 'apuntá', 'bajá', 'probá', 'pedí', 'agregá',
  // Con pronombre pegado (el acento se pierde: borrá + la = borrala):
  'cargalo', 'borrala', 'borralas', 'desactivala', 'activala', 'anulala',
  'descontinuala', 'corregila', 'reabrilo', 'anotalo', 'abonalo', 'elegilo',
  'agregalo', 'agregale', 'cambiale', 'movelas', 'ponele', 'contanos',
  'hacelo', 'anotala', 'contalo', 'revisalas', 'usalo', 'atribuilo', 'cambiala',
  'cambialo', 'publicala', 'sacale', 'renombrala',
  // El pronombre mismo:
  'vos',
] as const;
