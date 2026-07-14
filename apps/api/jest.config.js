/** Jest para el API: ts-jest, entorno node, tests *.spec.ts dentro de src.
 *  Los servicios usan `import type` de @calc3d/shared (se borra en compilación),
 *  así que no hace falta mapear ese paquete. Prisma se mockea, no se conecta. */

// La suite se corre en una zona al oeste de UTC (UTC-4, como Venezuela) para que
// los filtros de fecha date-only se prueben contra el escenario que rompe: si un
// límite se parsea en hora local en vez de UTC, el rango se corre un día. Se
// fija aquí (proceso padre, antes de crear los workers) porque cambiar `TZ`
// dentro del spec no siempre reconfigura el motor de fechas ya inicializado.
process.env.TZ = process.env.TZ || 'America/Caracas';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
};
