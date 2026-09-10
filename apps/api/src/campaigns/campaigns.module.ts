import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CampaignCreateSchema,
  CampaignUpdateSchema,
  campaignHealth,
  campaignRecommendation,
  formatMoney,
  netAfterAds,
  orderTotal,
  roas,
  roi,
  type CampaignCreateDto,
  type CampaignMetricsInput,
  type CampaignUpdateDto,
  type OrderLine,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { writeToString } from 'fast-csv';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Etiquetas de presentación (español), alineadas con el front. */
const PLATFORM_ES: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  GOOGLE: 'Google',
  WHATSAPP: 'WhatsApp',
  OTHER: 'Otra',
};
const STATUS_ES: Record<string, string> = {
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  FINISHED: 'Finalizada',
};
const OBJECTIVE_ES: Record<string, string> = {
  SALES: 'Ventas',
  MESSAGES: 'Mensajes',
  VISITS: 'Visitas',
  FOLLOWERS: 'Seguidores',
  AWARENESS: 'Reconocimiento de marca',
};
const HEALTH_ES: Record<string, string> = {
  PROFITABLE: 'Rentable',
  AT_RISK: 'En riesgo',
  LOSS: 'Pérdida',
  NO_DATA: 'Sin datos',
};

/** Métricas derivadas de una campaña (todo en USD base). */
interface CampaignStats {
  invested: number;
  revenue: number;
  profit: number;
  hasCost: boolean;
  sales: number;
  orders: number;
  ordersTotal: number;
}

const emptyStats = (): CampaignStats => ({
  invested: 0,
  revenue: 0,
  profit: 0,
  hasCost: false,
  sales: 0,
  orders: 0,
  ordersTotal: 0,
});


@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Métricas por campaña (mapa campaignId → stats) para toda la organización. */
  private async statsByCampaign(organizationId: string): Promise<Map<string, CampaignStats>> {
    const [expenses, sales, orders] = await Promise.all([
      this.prisma.expense.findMany({
        where: { organizationId, campaignId: { not: null } },
        select: { campaignId: true, amount: true },
      }),
      this.prisma.sale.findMany({
        where: { organizationId, campaignId: { not: null } },
        select: { campaignId: true, amount: true },
      }),
      this.prisma.order.findMany({
        where: { organizationId, campaignId: { not: null } },
        select: { campaignId: true, lines: true },
      }),
    ]);

    const map = new Map<string, CampaignStats>();
    const at = (id: string) => {
      let s = map.get(id);
      if (!s) {
        s = emptyStats();
        map.set(id, s);
      }
      return s;
    };

    for (const e of expenses) at(e.campaignId!).invested += Number(e.amount);
    for (const s of sales) {
      const st = at(s.campaignId!);
      const amount = Number(s.amount);
      st.sales += 1;
      st.revenue += amount;
      // ⚠️ La GANANCIA por campaña quedó sin fuente al eliminarse los
      // presupuestos (2026-09-07): era lo único que ataba una venta a su costo.
      // El ROI se apaga y la salud de la campaña se juzga por ROAS, que es lo
      // que el helper ya prioriza. Inventar un costo sería peor que no tenerlo.
    }
    for (const o of orders) {
      const st = at(o.campaignId!);
      st.orders += 1;
      st.ordersTotal += orderTotal((o.lines as unknown as OrderLine[]) ?? []);
    }

    // Redondeo de presentación (2 dp) para dinero.
    for (const s of map.values()) {
      s.invested = round(s.invested);
      s.revenue = round(s.revenue);
      s.profit = round(s.profit);
      s.ordersTotal = round(s.ordersTotal);
    }
    return map;
  }

  async list(organizationId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const stats = await this.statsByCampaign(organizationId);
    return campaigns.map((c) => ({ ...serialize(c), stats: stats.get(c.id) ?? emptyStats() }));
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, organizationId } });
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    const stats = await this.statsByCampaign(organizationId);
    const period = await this.periodStats(organizationId, campaign.startDate, campaign.endDate);
    return { ...serialize(campaign), stats: stats.get(id) ?? emptyStats(), period };
  }

  /**
   * Vista POR PERÍODO (estimación de arrastre): todas las ventas de la org dentro
   * de la ventana [inicio, fin] de la campaña, SIN importar la atribución explícita.
   * Sirve para estimar el efecto total mientras la campaña estuvo activa. Es una
   * referencia, no la fuente de verdad (esa es la atribución explícita).
   */
  private async periodStats(organizationId: string, start: Date, end: Date | null) {
    const lte = end ?? new Date();
    const sales = await this.prisma.sale.findMany({
      where: { organizationId, date: { gte: start, lte } },
      select: { amount: true },
    });
    const revenue = sales.reduce((s, x) => s + Number(x.amount), 0);
    return { sales: sales.length, revenue: round(revenue) };
  }

  /** Formateador de dinero con la moneda/locale de la organización (base USD). */
  private async money(organizationId: string) {
    const s = await this.prisma.settings.findUnique({
      where: { organizationId },
      select: { currency: true, locale: true },
    });
    const currency = s?.currency ?? 'USD';
    const locale = s?.locale ?? 'en-US';
    return { fmt: (n: number) => formatMoney(n, currency, locale), locale };
  }

  /** CSV con TODAS las campañas + sus métricas (Excel-compatible). */
  async exportCsv(organizationId: string): Promise<string> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const statsMap = await this.statsByCampaign(organizationId);
    const rows = campaigns.map((c) => {
      const st = statsMap.get(c.id) ?? emptyStats();
      const r = roas(st.revenue, st.invested);
      const ri = st.hasCost ? roi(st.profit, st.invested) : null;
      return {
        campana: c.name,
        plataforma: PLATFORM_ES[c.platform] ?? c.platform,
        estado: STATUS_ES[c.status] ?? c.status,
        objetivo: c.objective ? OBJECTIVE_ES[c.objective] ?? c.objective : '',
        inicio: c.startDate.toISOString().slice(0, 10),
        fin: c.endDate ? c.endDate.toISOString().slice(0, 10) : '',
        presupuesto_usd: c.budget != null ? Number(c.budget) : '',
        invertido_usd: st.invested,
        vendido_usd: st.revenue,
        ganancia_usd: st.hasCost ? st.profit : '',
        roas: r != null ? r : '',
        roi_pct: ri != null ? Math.round(ri * 100) : '',
        salud: HEALTH_ES[campaignHealth(st)] ?? '',
        recomendacion: campaignRecommendation(st).title,
        ventas: st.sales,
        pedidos: st.orders,
      };
    });
    if (rows.length === 0) return '';
    return writeToString(rows, { headers: true });
  }

  /** Informe PDF de UNA campaña (KPIs + salud + recomendación). */
  async report(organizationId: string, id: string): Promise<Buffer> {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, organizationId } });
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    const statsMap = await this.statsByCampaign(organizationId);
    const st = statsMap.get(id) ?? emptyStats();
    const metrics: CampaignMetricsInput = st;
    const { fmt, locale } = await this.money(organizationId);
    const rec = campaignRecommendation(metrics);
    const r = roas(st.revenue, st.invested);
    const ri = st.hasCost ? roi(st.profit, st.invested) : null;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(20).text('Informe de campaña', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(14).fillColor('#444').text(campaign.name);
    doc
      .fontSize(10)
      .fillColor('#666')
      .text(`Plataforma: ${PLATFORM_ES[campaign.platform] ?? campaign.platform}`)
      .text(`Estado: ${STATUS_ES[campaign.status] ?? campaign.status}`)
      .text(
        `Período: ${campaign.startDate.toLocaleDateString(locale)}` +
          (campaign.endDate ? ` → ${campaign.endDate.toLocaleDateString(locale)}` : ' → en curso'),
      );
    doc.moveDown();

    doc.fillColor('#000').fontSize(14).text('Salud y recomendación');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Estado de rentabilidad', HEALTH_ES[campaignHealth(metrics)] ?? '—');
    this.row(doc, 'Acción sugerida', rec.title);
    doc.moveDown(0.2);
    doc.fillColor('#666').fontSize(9).text(rec.reason, 50, doc.y, { width: 500 });
    doc.fillColor('#000').fontSize(10);
    doc.moveDown();

    doc.fontSize(14).text('Métricas (USD)');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Invertido en publicidad', fmt(st.invested));
    if (campaign.budget != null) this.row(doc, 'Presupuesto estimado', fmt(Number(campaign.budget)));
    this.row(doc, 'Vendido (atribuido)', fmt(st.revenue));
    this.row(doc, 'Ganancia atribuida', st.hasCost ? fmt(st.profit) : '— (sin costo conocido)');
    this.row(doc, 'ROAS (retorno sobre inversión)', r != null ? `${r.toLocaleString(locale, { maximumFractionDigits: 2 })}×` : '—');
    this.row(doc, 'ROI', ri != null ? `${(ri * 100).toLocaleString(locale, { maximumFractionDigits: 0 })}%` : '—');
    this.row(doc, 'Margen neto después de publicidad', st.hasCost ? fmt(netAfterAds(st.profit, st.invested)) : '—');
    doc.moveDown();

    doc.fontSize(14).text('Volumen');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Ventas atribuidas', String(st.sales));
    this.row(doc, 'Ticket promedio', st.sales > 0 ? fmt(st.revenue / st.sales) : '—');
    this.row(doc, 'Pedidos atribuidos', `${st.orders} (${fmt(st.ordersTotal)})`);

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#999')
      .text(
        'La ganancia y el ROI solo se calculan con ventas que traen costo (ligadas a una cotización/producto). ' +
          'Las ventas de mostrador cuentan para ingresos y ROAS, pero no para ganancia. Montos en USD (base).',
        50,
        doc.y,
        { width: 500 },
      );

    doc.end();
    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private row(doc: PDFKit.PDFDocument, label: string, value: string) {
    const y = doc.y;
    doc.text(label, 50, y, { width: 300 });
    doc.text(value, 350, y, { width: 200, align: 'right' });
    doc.moveDown(0.2);
  }

  create(organizationId: string, dto: CampaignCreateDto) {
    return this.prisma.campaign.create({
      data: {
        organizationId,
        name: dto.name,
        platform: dto.platform,
        objective: dto.objective ?? null,
        status: dto.status,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        budget: dto.budget ?? null,
        notes: dto.notes ?? null,
        reach: dto.reach ?? null,
        conversations: dto.conversations ?? null,
        profileVisits: dto.profileVisits ?? null,
      },
    });
  }

  async update(organizationId: string, id: string, dto: CampaignUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.platform !== undefined && { platform: dto.platform }),
        ...(dto.objective !== undefined && { objective: dto.objective ?? null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.budget !== undefined && { budget: dto.budget ?? null }),
        ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
        ...(dto.reach !== undefined && { reach: dto.reach ?? null }),
        ...(dto.conversations !== undefined && { conversations: dto.conversations ?? null }),
        ...(dto.profileVisits !== undefined && { profileVisits: dto.profileVisits ?? null }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    // onDelete: SetNull en los documentos → no se borran ventas/gastos, solo se desatribuyen.
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.campaign.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Campaña no encontrada');
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Serializa la campaña (Decimal → number). */
function serialize(c: {
  id: string;
  name: string;
  platform: string;
  objective: string | null;
  status: string;
  startDate: Date;
  endDate: Date | null;
  budget: Prisma.Decimal | null;
  notes: string | null;
  reach: number | null;
  conversations: number | null;
  profileVisits: number | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    platform: c.platform,
    objective: c.objective,
    status: c.status,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate ? c.endDate.toISOString() : null,
    budget: c.budget != null ? Number(c.budget) : null,
    notes: c.notes,
    // Lo que reporta la plataforma de anuncios: sin esto, una campaña que
    // todavía no vendió solo se puede juzgar por ROAS, que da cero.
    reach: c.reach,
    conversations: c.conversations,
    profileVisits: c.profileVisits,
    createdAt: c.createdAt.toISOString(),
  };
}

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  // Ruta literal ANTES de `:id` para que no la capture el parámetro.
  @Get('export.csv')
  async exportCsv(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const csv = await this.service.exportCsv(user.organizationId);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="calc3d-campanas.csv"',
    });
    res.end(csv);
  }

  @Get(':id/report.pdf')
  async report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.service.report(user.organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="calc3d-campana.pdf"',
    });
    res.end(pdf);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CampaignCreateSchema)) dto: CampaignCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CampaignUpdateSchema)) dto: CampaignUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
