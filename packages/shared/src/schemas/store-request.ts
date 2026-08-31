import { z } from 'zod';

/**
 * Contratos de la BANDEJA DE TIENDA: lo que un visitante sin sesión puede
 * mandar desde la tienda pública.
 *
 * Esta es la **primera superficie de ESCRITURA sin sesión** de todo el sistema
 * (hasta acá `/public/store/*` era solo lectura). Todo lo que sigue está escrito
 * asumiendo que quien manda el cuerpo es hostil:
 *
 * 1. **El precio NO viaja en el cuerpo.** El cliente manda qué producto y qué
 *    opciones quiere; el servidor busca la ficha, suma los recargos y calcula el
 *    total. Si el precio llegara de afuera, cualquiera compraría a $0.01 — y
 *    llegaría al panel como una venta legítima.
 * 2. **No se acepta ningún campo de estado.** Nada de `status`, `code`,
 *    `clientId` ni `orderId`: esos los fija el backend al confirmar.
 * 3. **Nada de esto crea un pedido.** Entra a una bandeja que el dueño revisa.
 *    Un desconocido no escribe en la operación ni en el CRM.
 */

/** Tope de renglones por pedido. Un carrito real no pasa de unos pocos. */
export const STORE_REQUEST_MAX_ITEMS = 20;
/** Tope de unidades por renglón. Corta pedidos absurdos sin estorbar a nadie. */
export const STORE_REQUEST_MAX_QTY = 999;

/**
 * Teléfono de contacto. Se pide laxo a propósito: la gente escribe
 * "0412-1234567", "+58 412 1234567" o "04121234567", y rechazar por formato
 * pierde pedidos reales. Solo se exige que tenga dígitos suficientes para ser
 * un teléfono; la normalización a formato internacional la hace el backend.
 */
export const StorePhoneSchema = z
  .string()
  .trim()
  .min(7, 'El teléfono es demasiado corto')
  .max(30, 'El teléfono es demasiado largo')
  .refine((v) => (v.match(/\d/g) ?? []).length >= 7, 'Escribí un teléfono válido');

/** Datos de contacto de quien pide. Se pide lo mínimo: pedido como INVITADO,
 *  sin cuenta ni contraseña (ver la decisión en el CLAUDE.md de la tienda). */
export const StoreCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Escribí tu nombre').max(80, 'El nombre es demasiado largo'),
  phone: StorePhoneSchema,
  note: z.string().trim().max(500, 'La nota no puede pasar de 500 caracteres').optional(),
});
export type StoreCustomerDto = z.infer<typeof StoreCustomerSchema>;

/**
 * Un renglón del carrito **tal como lo manda el cliente**: qué y cuánto, nunca
 * a qué precio. `options` es { "Color": "Rojo" }; el servidor verifica que el
 * grupo y la opción existan en la ficha antes de sumar su recargo.
 */
export const StoreRequestItemSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  qty: z.number().int().positive().max(STORE_REQUEST_MAX_QTY, 'Cantidad demasiado alta'),
  options: z.record(z.string().max(40), z.string().max(60)).default({}),
});
export type StoreRequestItemDto = z.infer<typeof StoreRequestItemSchema>;

/** Pedido desde el carrito de la tienda. */
export const StoreOrderRequestSchema = z.object({
  customer: StoreCustomerSchema,
  items: z
    .array(StoreRequestItemSchema)
    .min(1, 'El pedido está vacío')
    .max(STORE_REQUEST_MAX_ITEMS, 'Demasiados renglones en un solo pedido'),
});
export type StoreOrderRequestDto = z.infer<typeof StoreOrderRequestSchema>;

/**
 * Solicitud de pieza a medida. NO es un pedido: no hay producto ni precio, solo
 * una descripción. Tampoco puede ser un `Quote`, porque un presupuesto exige el
 * snapshot completo del `CalcInput` y el motor no puede correr sobre "quiero un
 * llavero con mi logo". El dueño la cotiza y recién ahí existe un número.
 */
export const StoreCustomRequestSchema = z.object({
  customer: StoreCustomerSchema,
  description: z
    .string()
    .trim()
    .min(10, 'Contanos un poco más de lo que necesitás')
    .max(2000, 'La descripción no puede pasar de 2000 caracteres'),
});
export type StoreCustomRequestDto = z.infer<typeof StoreCustomRequestSchema>;

// ----- Lado del panel -----

export const StoreRequestKindSchema = z.enum(['ORDER', 'CUSTOM']);
export type StoreRequestKind = z.infer<typeof StoreRequestKindSchema>;

export const StoreRequestStatusSchema = z.enum(['NEW', 'CONFIRMED', 'DISCARDED']);
export type StoreRequestStatus = z.infer<typeof StoreRequestStatusSchema>;

/**
 * Normaliza un teléfono para BUSCAR al contacto: solo dígitos, con el 0 inicial
 * venezolano convertido a código de país. Es la misma regla que ya usan la
 * tienda y el panel para armar el enlace de WhatsApp — vive acá para que el
 * enlace por teléfono no dependa de cómo lo escribió cada uno.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `58${digits.slice(1)}`;
  return digits;
}
