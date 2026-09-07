/**
 * Versión del motor de cálculo compartido. Es la IDENTIDAD del contrato entre
 * back y front. Al separar en repos, cada copia de `shared` lleva este número;
 * el test `version.spec.ts` lo ancla al package.json para que un bump manual no
 * pase desapercibido. Subir SIEMPRE junto con el `version` del package.json.
 */
export const SHARED_VERSION = '0.7.3';
