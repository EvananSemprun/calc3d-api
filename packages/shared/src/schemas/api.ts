import { z } from 'zod';
import { CalcInputSchema } from './calc';

/**
 * Si un componente del CATÁLOGO se usa por pieza o una sola vez por pedido.
 * Vive acá y ya no en el motor: desde que los insumos del cálculo son siempre
 * por pieza, este dato solo describe la ficha guardada del componente.
 */
const CatalogScopeSchema = z.enum(['PER_PIECE', 'PER_ORDER']);

/**
 * Contratos de API compartidos entre el backend (validación de DTOs) y el
 * frontend (formularios con React Hook Form + Zod). Mensajes en español.
 */

export const LoginSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});
export type LoginDto = z.infer<typeof LoginSchema>;

// ----- Sesión: refresh y recuperación de contraseña -----

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Falta el refresh token'),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Correo inválido'),
});
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Falta el token'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

/** Respuesta de login/refresh: par de tokens + datos del usuario. */
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    organizationId: string;
    role: 'OWNER' | 'COLLABORATOR';
  };
}

export const RoleSchema = z.enum(['OWNER', 'COLLABORATOR']);
export type RoleDto = z.infer<typeof RoleSchema>;

/** Editar mi propio perfil. La contraseña es opcional (solo si se cambia). */
export const UpdateMeSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').optional(),
  email: z.string().email('Correo inválido').optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
});
export type UpdateMeDto = z.infer<typeof UpdateMeSchema>;

/** Crear un usuario (lo hace el dueño). */
export const UserCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  email: z.string().email('Correo inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  role: RoleSchema.default('COLLABORATOR'),
});
export type UserCreateDto = z.infer<typeof UserCreateSchema>;

/** Editar un usuario (lo hace el dueño). Contraseña opcional. */
export const UserUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email('Correo inválido').optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
  role: RoleSchema.optional(),
});
export type UserUpdateDto = z.infer<typeof UserUpdateSchema>;

/** Un costo fijo mensual del negocio (alquiler, internet, luz base…). */
export const FixedCostSchema = z.object({
  concept: z.string().min(1, 'El concepto es obligatorio'),
  monthlyAmount: z.number().min(0, 'El monto no puede ser negativo'),
});
export type FixedCost = z.infer<typeof FixedCostSchema>;

export const SettingsUpdateSchema = z.object({
  currency: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  secondaryCurrency: z
    .string()
    .length(3, 'Código de moneda de 3 letras (ISO 4217)')
    .transform((s) => s.toUpperCase())
    .nullable()
    .optional(),
  /** Tasa con nombre usada por defecto en la vista ambiental (null = solo USD). */
  defaultRateLabel: z.string().nullable().optional(),
  /** Tasa con nombre de referencia para proteger el margen al cobrar en Bs
   *  (null = usar el default de la app, Binance/USDT). */
  protectionRateLabel: z.string().nullable().optional(),
  kwhPrice: z.number().min(0).optional(),
  defaultWastePct: z.number().min(0).optional(),
  /** Margen objetivo por defecto (markup sobre el costo, fracción: 1.0 = 100 %). */
  defaultMarkup: z.number().min(0).optional(),
  /** Piso de margen real bajo el cual la calculadora avisa (fracción). */
  minMarginPct: z.number().min(0).optional(),
  roundingMode: z.enum(['NONE', 'NEAREST', 'UP', 'DOWN']).optional(),
  roundingIncrement: z.number().positive().optional(),
  taxPercent: z.number().min(0).nullable().optional(),
  fixedCosts: z.array(FixedCostSchema).optional(),
  /** Margen de contribución para el punto de equilibrio (fracción, 0.4 = 40 %). */
  breakEvenMarginPct: z.number().min(0).max(1).optional(),
  /** Nivel 3 del equilibrio: lo que se aparta cada mes para reponer equipos. */
  equipmentReserve: z.number().min(0).optional(),
  /** Nombre del negocio: vive en `Organization.name` (es el emisor de los
   *  documentos), pero se edita desde Ajustes → Negocio como un campo más. */
  businessName: z.string().min(1, 'El nombre del negocio es obligatorio').max(80).optional(),
  businessRif: z.string().optional().nullable(),
  businessPhone: z.string().optional().nullable(),
  businessAddress: z.string().optional().nullable(),
  businessSigner: z.string().optional().nullable(),
  /** Piso de margen (markup, fracción) bajo el cual un producto dispara alerta. */
  productAlertMinMarginPct: z.number().min(0).optional(),
});
export type SettingsUpdateDto = z.infer<typeof SettingsUpdateSchema>;

/** Tipos de imagen aceptados para el logo: pdfkit solo dibuja PNG y JPEG, y
 *  dejar fuera al SVG evita servir markup ejecutable en la vista previa. */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** Tope del archivo original en bytes (1 MB). El data URL en base64 pesa ~4/3. */
export const LOGO_MAX_BYTES = 1024 * 1024;

/** Subida del logo del negocio como data URL (lo que devuelve FileReader).
 *  El backend ADEMÁS verifica los bytes mágicos: el mime declarado no basta. */
export const LogoUploadSchema = z.object({
  dataUrl: z
    .string()
    .regex(
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/,
      'El logo debe ser un PNG o JPEG',
    )
    .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64, 'El logo no puede pesar más de 1 MB'),
});
export type LogoUploadDto = z.infer<typeof LogoUploadSchema>;

// ----- Tasas de cambio (moneda dual) -----

export const ExchangeRateSourceSchema = z.enum(['AUTO', 'MANUAL']);
export type ExchangeRateSource = z.infer<typeof ExchangeRateSourceSchema>;

/** Alta/edición de una tasa con NOMBRE: la etiqueta es su identidad; la moneda es
 *  el destino de formateo; la tasa = unidades de esa moneda por 1 USD (base). */
export const ExchangeRateSetSchema = z.object({
  label: z.string().min(1, 'El nombre de la tasa es obligatorio').max(40),
  currencyCode: z
    .string()
    .length(3, 'Código de moneda de 3 letras (ISO 4217)')
    .transform((s) => s.toUpperCase()),
  rate: z.number().positive('La tasa debe ser mayor que 0'),
});
export type ExchangeRateSetDto = z.infer<typeof ExchangeRateSetSchema>;

/** Snapshot congelado en un documento: { <moneda>: { rate, source, at, label? } }.
 *  Se guarda SOLO la tasa elegida. `label` es opcional (snapshots viejos no lo traen). */
export const ExchangeRateSnapshotSchema = z.record(
  z.object({
    rate: z.number().positive(),
    source: ExchangeRateSourceSchema,
    at: z.string(),
    label: z.string().optional(),
  }),
);
export type ExchangeRateSnapshot = z.infer<typeof ExchangeRateSnapshotSchema>;

/** Tasa con nombre vigente (respuesta de GET /exchange-rates). */
export const ExchangeRateViewSchema = z.object({
  label: z.string(),
  currencyCode: z.string(),
  rate: z.number(),
  source: ExchangeRateSourceSchema,
  updatedAt: z.string(),
});
export type ExchangeRateView = z.infer<typeof ExchangeRateViewSchema>;

export const ExchangeRatesResponseSchema = z.object({
  rates: z.array(ExchangeRateViewSchema),
  /** Presente si la actualización automática falló (se sirve la última tasa conocida). */
  refreshError: z.string().optional(),
});
export type ExchangeRatesResponse = z.infer<typeof ExchangeRatesResponseSchema>;

// ----- Opciones de catálogo (listas administradas: marca/tipo/color) -----

/** Tipo de lista de opciones. Cada campo con combobox creatable usa un kind. */
export const CatalogOptionKindSchema = z.enum([
  'MATERIAL_BRAND',
  'MATERIAL_TYPE',
  'MATERIAL_COLOR',
]);
export type CatalogOptionKind = z.infer<typeof CatalogOptionKindSchema>;

export const CatalogOptionCreateSchema = z.object({
  kind: CatalogOptionKindSchema,
  value: z.string().trim().min(1, 'El valor es obligatorio').max(60),
});
export type CatalogOptionCreateDto = z.infer<typeof CatalogOptionCreateSchema>;

/** Renombrar una opción existente (edición de la lista). */
export const CatalogOptionUpdateSchema = z.object({
  value: z.string().trim().min(1, 'El valor es obligatorio').max(60),
});
export type CatalogOptionUpdateDto = z.infer<typeof CatalogOptionUpdateSchema>;

export interface CatalogOptionView {
  id: string;
  kind: CatalogOptionKind;
  value: string;
}

// ----- Publicidad / ROI (Fase 1) -----

export const CampaignPlatformSchema = z.enum([
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'GOOGLE',
  'WHATSAPP',
  'OTHER',
]);
export type CampaignPlatform = z.infer<typeof CampaignPlatformSchema>;

export const CampaignObjectiveSchema = z.enum([
  'SALES',
  'MESSAGES',
  'VISITS',
  'FOLLOWERS',
  'AWARENESS',
]);
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;

export const CampaignStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'FINISHED']);
export type CampaignStatusDto = z.infer<typeof CampaignStatusSchema>;

/** Canal de origen para atribuir un documento a publicidad (null = sin atribuir). */
export const AttributionChannelSchema = z.enum([
  'ORGANIC',
  'INSTAGRAM_ADS',
  'FACEBOOK_ADS',
  'TIKTOK_ADS',
  'GOOGLE_ADS',
  'WHATSAPP',
  'REFERRAL',
  'OTHER',
]);
export type AttributionChannel = z.infer<typeof AttributionChannelSchema>;

export const CampaignCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(120),
  platform: CampaignPlatformSchema.default('OTHER'),
  objective: CampaignObjectiveSchema.optional().nullable(),
  status: CampaignStatusSchema.default('ACTIVE'),
  startDate: z.string().min(1, 'La fecha de inicio es obligatoria'),
  endDate: z.string().optional().nullable(),
  budget: z.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Lo que reporta la plataforma; con esto sale el costo por conversación. */
  reach: z.number().int().min(0).optional().nullable(),
  conversations: z.number().int().min(0).optional().nullable(),
  profileVisits: z.number().int().min(0).optional().nullable(),
});
export type CampaignCreateDto = z.infer<typeof CampaignCreateSchema>;

export const CampaignUpdateSchema = CampaignCreateSchema.partial();
export type CampaignUpdateDto = z.infer<typeof CampaignUpdateSchema>;

/** Atribución opcional para cotización/pedido/venta. */
export const AttributionSchema = z.object({
  originChannel: AttributionChannelSchema.optional().nullable(),
  campaignId: z.string().optional().nullable(),
});

// ----- Catálogos -----

export const MaterialSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  type: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  rollPrice: z.number().min(0),
  rollGrams: z.number().int().positive('Los gramos del rollo deben ser mayores a 0'),
  color: z.string().optional().nullable(),
});
export type MaterialDto = z.infer<typeof MaterialSchema>;

export const PrinterSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  price: z.number().min(0),
  lifetimeHours: z.number().int().positive('La vida útil debe ser mayor a 0'),
  powerKw: z.number().min(0).default(0),
  maintPerHour: z.number().min(0).default(0),
});
export type PrinterDto = z.infer<typeof PrinterSchema>;

export const ComponentSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  packagePrice: z.number().min(0),
  unitsPerPackage: z.number().int().positive('Las unidades por paquete deben ser mayores a 0'),
  scope: CatalogScopeSchema.default('PER_PIECE'),
});
export type ComponentDto = z.infer<typeof ComponentSchema>;

/** Tipo de contacto en el directorio/CRM (Fase 5). */
export const ContactTypeSchema = z.enum(['CLIENT', 'SUPPLIER', 'ALLY', 'COMPETITOR']);
export type ContactTypeDto = z.infer<typeof ContactTypeSchema>;

export const ClientSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  contact: z.string().optional().nullable(),
  type: ContactTypeSchema.default('CLIENT'),
  phone: z.string().optional().nullable(),
  rif: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  municipality: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Coordenadas del mapa (rango válido lat [-90,90], lng [-180,180]).
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
});
export type ClientDto = z.infer<typeof ClientSchema>;

/** Edición parcial de contacto (p. ej. solo fijar coordenadas desde el mapa). */
export const ClientUpdateSchema = ClientSchema.partial();
export type ClientUpdateDto = z.infer<typeof ClientUpdateSchema>;

// ----- Pedidos (encargos) -----

export const OrderStatusSchema = z.enum([
  'QUOTED',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'DELIVERED',
  'CANCELLED',
]);
export type OrderStatusDto = z.infer<typeof OrderStatusSchema>;

export const OrderLineSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria'),
  quantity: z.number().positive('La cantidad debe ser mayor que 0'),
  unit: z.string().optional().nullable(),
  unitPrice: z.number().min(0, 'El precio no puede ser negativo'),
});
export type OrderLineDto = z.infer<typeof OrderLineSchema>;

export const OrderCreateSchema = z.object({
  clientId: z.string().min(1, 'El cliente es obligatorio'),
  deliveryDate: z.string().optional().nullable(),
  status: OrderStatusSchema.default('QUOTED'),
  notes: z.string().optional().nullable(),
  lines: z.array(OrderLineSchema).default([]),
  /** Moneda de presentación elegida (etiqueta de la tasa; null = solo USD). */
  currencyLabel: z.string().optional().nullable(),
  /** Atribución de publicidad (null = sin atribuir). */
  originChannel: AttributionChannelSchema.optional().nullable(),
  campaignId: z.string().optional().nullable(),
});
export type OrderCreateDto = z.infer<typeof OrderCreateSchema>;

export const OrderUpdateSchema = OrderCreateSchema.partial();
export type OrderUpdateDto = z.infer<typeof OrderUpdateSchema>;

export const PaymentCreateSchema = z.object({
  date: z.string().min(1, 'La fecha es obligatoria'),
  amount: z.number().positive('El abono debe ser mayor que 0'),
  note: z.string().optional().nullable(),
});
export type PaymentCreateDto = z.infer<typeof PaymentCreateSchema>;

export const ProviderSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  contact: z.string().optional().nullable(),
});
export type ProviderDto = z.infer<typeof ProviderSchema>;

// ----- Productos (piezas costeadas reutilizables, Fase 4) -----

/** URL de imagen opcional: solo http(s) (evita esquemas peligrosos en <img>). */
const imageUrl = z
  .string()
  .trim()
  .url('URL de imagen inválida')
  .refine((u) => /^https?:\/\//i.test(u), 'La URL debe empezar por http:// o https://')
  .optional()
  .nullable();

export const ProductCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  imageUrl,
  notes: z.string().optional().nullable(),
  /** Snapshot del CalcInput con el que se costeó la pieza. */
  input: CalcInputSchema,
  /** Precio de venta por unidad que fijó el dueño (su decisión, no se recalcula). */
  priceSet: z.number().min(0, 'El precio no puede ser negativo'),
  /** Moneda de presentación elegida (etiqueta de la tasa; null = solo USD). */
  currencyLabel: z.string().optional().nullable(),
});
export type ProductCreateDto = z.infer<typeof ProductCreateSchema>;

export const ProductUpdateSchema = ProductCreateSchema.partial();
export type ProductUpdateDto = z.infer<typeof ProductUpdateSchema>;

/** Re-fijar el precio de venta (el dueño acepta el nuevo costo y re-ancla el margen). */
export const ProductRepriceSchema = z.object({
  priceSet: z.number().min(0, 'El precio no puede ser negativo'),
});
export type ProductRepriceDto = z.infer<typeof ProductRepriceSchema>;

// ----- Presupuestos -----

export const QuoteStatusSchema = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']);
export type QuoteStatusDto = z.infer<typeof QuoteStatusSchema>;

export const QuoteCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  clientId: z.string().optional().nullable(),
  status: QuoteStatusSchema.optional(),
  input: CalcInputSchema,
  /** Moneda de presentación elegida (etiqueta de la tasa; null = solo USD). */
  currencyLabel: z.string().optional().nullable(),
  /** Atribución de publicidad (null = sin atribuir). */
  originChannel: AttributionChannelSchema.optional().nullable(),
  campaignId: z.string().optional().nullable(),
});
export type QuoteCreateDto = z.infer<typeof QuoteCreateSchema>;

export const QuoteUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  clientId: z.string().optional().nullable(),
  status: QuoteStatusSchema.optional(),
  input: CalcInputSchema.optional(),
  currencyLabel: z.string().optional().nullable(),
  originChannel: AttributionChannelSchema.optional().nullable(),
  campaignId: z.string().optional().nullable(),
});
export type QuoteUpdateDto = z.infer<typeof QuoteUpdateSchema>;

// ----- Finanzas: ventas, gastos, compras de filamento -----

/** COUNTER = mostrador/venta directa, ENCARGO = pedido personalizado. */
export const SaleKindSchema = z.enum(['COUNTER', 'ENCARGO']);
export type SaleKindDto = z.infer<typeof SaleKindSchema>;

export const SaleCreateSchema = z.object({
  date: z.string().min(1, 'La fecha es obligatoria'),
  amount: z.number().min(0, 'El monto no puede ser negativo'),
  kind: SaleKindSchema.default('COUNTER'),
  clientId: z.string().optional().nullable(),
  quoteId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  /** Atribución de publicidad (null = sin atribuir). */
  originChannel: AttributionChannelSchema.optional().nullable(),
  campaignId: z.string().optional().nullable(),
});
export type SaleCreateDto = z.infer<typeof SaleCreateSchema>;

export const SaleUpdateSchema = SaleCreateSchema.partial();
export type SaleUpdateDto = z.infer<typeof SaleUpdateSchema>;

/** Convertir un presupuesto en venta (el monto se toma de sus totales). */
export const SaleFromQuoteSchema = z.object({
  quoteId: z.string().min(1),
  date: z.string().optional(),
  kind: SaleKindSchema.default('ENCARGO'),
  note: z.string().optional().nullable(),
});
export type SaleFromQuoteDto = z.infer<typeof SaleFromQuoteSchema>;

export const ExpenseCategorySchema = z.enum([
  'EQUIPMENT',
  'CONSUMABLE',
  'MAINTENANCE',
  'SHIPPING',
  'OTHER',
  'ADVERTISING',
]);
export type ExpenseCategoryDto = z.infer<typeof ExpenseCategorySchema>;

export const ExpenseCreateSchema = z.object({
  date: z.string().min(1, 'La fecha es obligatoria'),
  category: ExpenseCategorySchema.default('OTHER'),
  description: z.string().min(1, 'La descripción es obligatoria'),
  amount: z.number().min(0, 'El monto no puede ser negativo'),
  isInvestment: z.boolean().default(false),
  quantity: z.number().int().positive().optional().nullable(),
  endDate: z.string().optional().nullable(),
  providerId: z.string().optional().nullable(),
  // Enlace opcional al catálogo (solo uno debería venir).
  materialId: z.string().optional().nullable(),
  printerId: z.string().optional().nullable(),
  componentId: z.string().optional().nullable(),
  // Publicidad: enlazar el gasto a una campaña (categoría ADVERTISING).
  campaignId: z.string().optional().nullable(),
  // Bs congelado: si el gasto se pagó en otra moneda, se guarda la tasa y el
  // código con los que se registró (el `amount` SIEMPRE queda en USD base).
  rate: z.number().positive().optional().nullable(),
  currencyCode: z.string().length(3).optional().nullable(),
});
export type ExpenseCreateDto = z.infer<typeof ExpenseCreateSchema>;

export const ExpenseUpdateSchema = ExpenseCreateSchema.partial();
export type ExpenseUpdateDto = z.infer<typeof ExpenseUpdateSchema>;

/** Registrar un gasto que crea/actualiza su definición de catálogo en una sola
 *  operación atómica (server-side $transaction). `data` se re-valida en el
 *  servidor con el schema del `kind`. */
export const ExpenseLinkKindSchema = z.enum(['material', 'printer', 'component']);
export type ExpenseLinkKind = z.infer<typeof ExpenseLinkKindSchema>;

export const ExpenseWithDefinitionSchema = z.object({
  expense: z.object({
    date: z.string().min(1, 'La fecha es obligatoria'),
    amount: z.number().min(0, 'El monto no puede ser negativo'),
    category: ExpenseCategorySchema,
    description: z.string().min(1, 'La descripción es obligatoria'),
    isInvestment: z.boolean().default(false),
    quantity: z.number().int().positive().nullable().optional(),
    providerId: z.string().nullable().optional(),
  }),
  link: z.object({
    kind: ExpenseLinkKindSchema,
    mode: z.enum(['new', 'existing']),
    id: z.string().nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
    referenceField: z.string().nullable().optional(),
    referenceValue: z.number().nullable().optional(),
  }),
});
export type ExpenseWithDefinitionDto = z.infer<typeof ExpenseWithDefinitionSchema>;

// ---------- Deuda (préstamos) ----------

export const LoanCreateSchema = z.object({
  name: z.string().min(1, 'Ponele un nombre al préstamo'),
  principal: z.number().positive('El capital tiene que ser mayor que cero'),
  monthlyPayment: z.number().min(0).default(0),
  startDate: z.string().optional().nullable(),
  /** Fecha en que se terminó de pagar; null = abierto. */
  closedAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** El equipo que se compró con el préstamo, si fue para uno. */
  printerId: z.string().optional().nullable(),
});
export type LoanCreateDto = z.infer<typeof LoanCreateSchema>;

export const LoanUpdateSchema = LoanCreateSchema.partial();
export type LoanUpdateDto = z.infer<typeof LoanUpdateSchema>;

export const LoanPaymentCreateSchema = z.object({
  date: z.string().min(1, 'Falta la fecha del pago'),
  amount: z.number().positive('El pago tiene que ser mayor que cero'),
  /** Referencia bancaria o lo que sirva para reconciliar después. */
  reference: z.string().optional().nullable(),
});
export type LoanPaymentCreateDto = z.infer<typeof LoanPaymentCreateSchema>;

// ---------- Metas mensuales ----------

export const GoalUpsertSchema = z.object({
  /** El mes, como `AAAA-MM`. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes va como AAAA-MM (ej. 2026-09)'),
  salesTarget: z.number().min(0).default(0),
  ordersTarget: z.number().int().min(0).default(0),
  newClientsTarget: z.number().int().min(0).default(0),
  notes: z.string().optional().nullable(),
});
export type GoalUpsertDto = z.infer<typeof GoalUpsertSchema>;
