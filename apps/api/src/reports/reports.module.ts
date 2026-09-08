import { Controller, Get, Injectable, Module, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import {
  breakEvenLevels,
  fixedCostsTotal,
  groupPurchases,
  loanBalance,
  loanPaid,
  monthKey,
  monthlyLoanPayments,
  orderBalance,
  orderPaid,
  orderTotal,
  stockTotal,
  type FixedCost,
  type OrderLine,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { FilamentModule } from '../filament/filament.module';
import { FilamentService } from '../filament/filament.service';
import { GoalsModule, GoalsService } from '../goals/goals.module';
import { LoansModule, LoansService } from '../loans/loans.module';
import { PrintersModule, PrintersService } from '../printers/printers.module';

/**
 * REPORTE EN EXCEL — el libro que reemplaza a `bananolab.xlsx`.
 *
 * Decisión del dueño (2026-09-07): la app y el Excel **conviven, pero el Excel
 * deja de ser un lugar donde cargar datos** y pasa a ser una salida. Se descarga
 * cuando hace falta y siempre sale de la app, así que no hay dos sistemas que
 * puedan discrepar.
 *
 * Por eso las hojas se arman **reusando los servicios de cada pantalla**
 * (metas, préstamos, filamento, producción) en vez de repetir las consultas: si
 * el reporte hiciera sus propias cuentas, tarde o temprano diría algo distinto
 * de lo que muestra la app, que es exactamente el problema que esto resuelve.
 */
@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private filament: FilamentService,
    private goals: GoalsService,
    private loans: LoansService,
    private printers: PrintersService,
  ) {}

  async workbook(organizationId: string): Promise<ExcelJS.Workbook> {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId } });
    const wb = new ExcelJS.Workbook();
    wb.creator = org?.name ?? 'Calc3D';
    wb.created = new Date();

    const [
      settings,
      ventas,
      pedidos,
      gastos,
      clientes,
      campanas,
      compras,
      prestamos,
      metas,
      recuperacion,
      produccion,
    ] = await Promise.all([
      this.prisma.settings.findFirst({ where: { organizationId } }),
      this.prisma.sale.findMany({
        where: { organizationId },
        include: { client: { select: { name: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { organizationId },
        include: { client: { select: { name: true } }, payments: true, printer: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: { organizationId },
        include: { material: true, printer: true, component: true, campaign: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.client.findMany({
        where: { organizationId },
        include: { orders: { select: { deliveryDate: true, lines: true } }, sales: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.campaign.findMany({ where: { organizationId }, orderBy: { startDate: 'asc' } }),
      this.filament.purchases(organizationId),
      this.loans.list(organizationId),
      this.goals.list(organizationId),
      this.printers.recovery(organizationId),
      this.printers.usage(organizationId),
    ]);

    const mesActual = monthKey(new Date());
    const stock = await this.filament.stock(organizationId, mesActual);

    const ingresoVentas = suma(ventas.map((v) => Number(v.amount)));
    const ingresoPedidos = suma(pedidos.map((p) => orderTotal(p.lines as unknown as OrderLine[])));
    const gastoOperativo = suma(gastos.filter((g) => !g.isInvestment).map((g) => Number(g.amount)));
    const inversion = suma(gastos.filter((g) => g.isInvestment).map((g) => Number(g.amount)));

    // ---------- Resumen ----------
    const resumen = hoja(wb, 'Resumen', [{ header: 'Concepto', width: 44 }, { header: '', width: 18 }]);
    titulo(resumen, org?.name ?? 'Calc3D');
    resumen.addRow([`Generado el ${new Date().toLocaleString('es-VE')}`]).font = { italic: true, size: 9 };
    resumen.addRow([]);

    bloque(resumen, 'Resultado acumulado');
    dinero(resumen, 'Ventas de mostrador y encargos sueltos', ingresoVentas);
    dinero(resumen, 'Pedidos con cliente', ingresoPedidos);
    dinero(resumen, 'INGRESOS', ingresoVentas + ingresoPedidos, true);
    dinero(resumen, 'Gastos operativos', -gastoOperativo);
    dinero(resumen, 'RESULTADO', ingresoVentas + ingresoPedidos - gastoOperativo, true);
    dinero(resumen, 'Inversión en equipos (aparte)', inversion);
    resumen.addRow([]);

    bloque(resumen, 'Punto de equilibrio (mensual)');
    const fijos = fixedCostsTotal((settings?.fixedCosts as unknown as FixedCost[]) ?? []);
    const cuota = monthlyLoanPayments(prestamos);
    const niveles = breakEvenLevels({
      fixedMonthly: fijos,
      marginPct: settings?.breakEvenMarginPct ?? 0,
      loanPayment: cuota,
      equipmentReserve: settings?.equipmentReserve ?? 0,
    });
    dinero(resumen, 'Costos fijos al mes', fijos);
    resumen.addRow(['Margen de contribución', settings?.breakEvenMarginPct ?? 0]).getCell(2).numFmt = '0%';
    dinero(resumen, 'Cuota de préstamos al mes', cuota);
    dinero(resumen, 'Reserva para equipos al mes', settings?.equipmentReserve ?? 0);
    dinero(resumen, '1. No perder dinero', niveles.survive ?? 0, true);
    dinero(resumen, '2. Además pagar la cuota', niveles.withDebt ?? 0, true);
    dinero(resumen, '3. Además reservar para equipos', niveles.withReserve ?? 0, true);
    resumen.addRow([]);

    bloque(resumen, 'Reposición de equipos');
    dinero(resumen, 'Ganancia acumulada', recuperacion.accumulatedProfit);
    for (const e of recuperacion.rows) {
      dinero(resumen, `${e.name} — repuesto de ${moneda(e.cost)}`, e.recovered);
    }
    dinero(resumen, 'Capital libre', recuperacion.freeCapital, true);
    resumen.addRow([]);

    bloque(resumen, 'Filamento por marca');
    for (const m of groupPurchases(compras, 'brand')) {
      resumen.addRow([`${m.key} — ${m.rolls} rollos`, m.invested]).getCell(2).numFmt = FORMATO;
    }
    resumen.addRow([]);
    bloque(resumen, 'Filamento por color');
    for (const c of groupPurchases(compras, 'color').slice(0, 10)) {
      resumen.addRow([`${c.key} — ${c.rolls} rollos`, c.invested]).getCell(2).numFmt = FORMATO;
    }

    // ---------- Ventas ----------
    const hVentas = hoja(wb, 'Ventas', [
      { header: 'Fecha', width: 12 },
      { header: 'Tipo', width: 12 },
      { header: 'Cliente', width: 24 },
      { header: 'Monto', width: 14 },
      { header: 'Nota', width: 60 },
    ]);
    for (const v of ventas) {
      hVentas.addRow([
        fecha(v.date),
        v.kind === 'COUNTER' ? 'Mostrador' : 'Encargo',
        v.client?.name ?? '',
        Number(v.amount),
        v.note ?? '',
      ]);
    }
    totalizar(hVentas, 4);

    // ---------- Encargos (pedidos) ----------
    const hPedidos = hoja(wb, 'Encargos', [
      { header: 'N°', width: 7 },
      { header: 'Entrega', width: 12 },
      { header: 'Cliente', width: 24 },
      { header: 'Estado', width: 14 },
      { header: 'Canal', width: 12 },
      { header: 'Total', width: 12 },
      { header: 'Abonado', width: 12 },
      { header: 'Saldo', width: 12 },
      { header: 'Impresora', width: 20 },
      { header: 'Reimpresas', width: 11 },
      { header: 'Detalle', width: 50 },
    ]);
    for (const p of pedidos) {
      const lines = p.lines as unknown as OrderLine[];
      hPedidos.addRow([
        p.code,
        fecha(p.deliveryDate),
        p.client?.name ?? '',
        p.status,
        p.originChannel ?? '',
        orderTotal(lines),
        orderPaid(p.payments.map((x) => Number(x.amount))),
        orderBalance(lines, p.payments.map((x) => Number(x.amount))),
        p.printer?.name ?? '',
        p.reprints ?? '',
        lines.map((l) => `${l.quantity}× ${l.description}`).join(' · '),
      ]);
    }
    totalizar(hPedidos, 6, 7, 8);

    // ---------- Gastos ----------
    const hGastos = hoja(wb, 'Gastos', [
      { header: 'Fecha', width: 12 },
      { header: 'Categoría', width: 14 },
      { header: 'Descripción', width: 46 },
      { header: 'Monto', width: 12 },
      { header: 'Cantidad', width: 10 },
      { header: 'Inversión', width: 10 },
      { header: 'Enlazado a', width: 28 },
    ]);
    for (const g of gastos) {
      hGastos.addRow([
        fecha(g.date),
        g.category,
        g.description ?? '',
        Number(g.amount),
        g.quantity ?? '',
        g.isInvestment ? 'Sí' : '',
        g.material?.name ?? g.printer?.name ?? g.component?.name ?? g.campaign?.name ?? '',
      ]);
    }
    totalizar(hGastos, 4);

    // ---------- Inventario (compras de filamento) ----------
    const hInv = hoja(wb, 'Inventario', [
      { header: 'Fecha', width: 12 },
      { header: 'Filamento', width: 30 },
      { header: 'Marca', width: 14 },
      { header: 'Tipo', width: 10 },
      { header: 'Color', width: 14 },
      { header: 'Rollos', width: 8 },
      { header: 'Total', width: 12 },
      { header: 'Por rollo', width: 12 },
      { header: 'Por gramo', width: 12 },
      { header: 'Proveedor', width: 20 },
    ]);
    for (const c of compras) {
      const fila = hInv.addRow([
        fecha(new Date(c.date)),
        c.materialName ?? '',
        c.brand ?? '',
        c.type ?? '',
        c.color ?? '',
        c.quantity,
        c.amount,
        c.costPerRoll,
        c.costPerGram,
        c.providerName ?? '',
      ]);
      // Son centavos: con dos decimales todo se vería como "$0,02".
      fila.getCell(9).numFmt = '"$"#,##0.00000';
    }
    totalizar(hInv, 6, 7);

    // ---------- Stock del mes ----------
    const hStock = hoja(wb, 'Stock mensual', [
      { header: 'Tipo', width: 10 },
      { header: 'Color', width: 16 },
      { header: 'Marca', width: 16 },
      { header: 'Estado', width: 14 },
      { header: 'Sin abrir', width: 10 },
      { header: 'En uso', width: 10 },
      { header: 'Por acabarse', width: 12 },
      { header: 'Total', width: 10 },
    ]);
    hStock.addRow([`Conteo de ${mesActual}`]).font = { italic: true, size: 9 };
    for (const r of stock) {
      hStock.addRow([
        r.type ?? '',
        r.color ?? '',
        r.brand ?? '',
        r.status === 'ACTIVE' ? 'Activo' : 'Descontinuado',
        r.counted ? r.sealed : '',
        r.counted ? r.inUse : '',
        r.counted ? r.running : '',
        // Sin conteo va vacío: "no contado" no es "cero rollos".
        r.counted ? stockTotal(r) : 'sin contar',
      ]);
    }

    // ---------- Clientes ----------
    const hClientes = hoja(wb, 'Clientes', [
      { header: 'Nombre', width: 26 },
      { header: 'Tipo', width: 12 },
      { header: 'Teléfono', width: 16 },
      { header: 'Ciudad', width: 18 },
      { header: 'Compras', width: 9 },
      { header: 'Total gastado', width: 14 },
      { header: 'Primera compra', width: 14 },
    ]);
    for (const c of clientes) {
      const montos = [
        ...c.sales.map((s) => Number(s.amount)),
        ...c.orders.map((o) => orderTotal(o.lines as unknown as OrderLine[])),
      ];
      const fechas = [
        ...c.sales.map((s) => s.date),
        ...c.orders.map((o) => o.deliveryDate),
      ].filter((f): f is Date => !!f);
      hClientes.addRow([
        c.name,
        c.type,
        c.phone ?? '',
        [c.municipality, c.city].filter(Boolean).join(' · '),
        montos.length,
        suma(montos),
        fechas.length ? fecha(new Date(Math.min(...fechas.map((f) => f.getTime())))) : '',
      ]);
    }
    totalizar(hClientes, 6);

    // ---------- Publicidad ----------
    const hPub = hoja(wb, 'Publicidad', [
      { header: 'Campaña', width: 34 },
      { header: 'Desde', width: 12 },
      { header: 'Estado', width: 12 },
      { header: 'Invertido', width: 12 },
      { header: 'Alcance', width: 12 },
      { header: 'Conversaciones', width: 14 },
      { header: 'Visitas al perfil', width: 14 },
      { header: 'Costo por conversación', width: 20 },
    ]);
    for (const c of campanas) {
      const gasto = suma(
        gastos.filter((g) => g.campaignId === c.id).map((g) => Number(g.amount)),
      );
      hPub.addRow([
        c.name,
        fecha(c.startDate),
        c.status,
        gasto,
        c.reach ?? '',
        c.conversations ?? '',
        c.profileVisits ?? '',
        c.conversations ? gasto / c.conversations : '',
      ]);
    }
    totalizar(hPub, 4);

    // ---------- Deuda ----------
    const hDeuda = hoja(wb, 'Deuda', [
      { header: 'Préstamo / Pago', width: 34 },
      { header: 'Fecha', width: 12 },
      { header: 'Monto', width: 14 },
      { header: 'Referencia', width: 30 },
    ]);
    for (const l of prestamos) {
      const cab = hDeuda.addRow([l.name, '', l.principal, `Cuota ${moneda(l.monthlyPayment)}/mes`]);
      cab.font = { bold: true };
      for (const p of l.payments) {
        hDeuda.addRow([`   pago`, fecha(new Date(p.date)), p.amount, p.reference ?? '']);
      }
      const pagos = l.payments.map((p) => ({ amount: p.amount }));
      hDeuda.addRow([
        '   Saldo pendiente',
        '',
        loanBalance(l.principal, pagos),
        `Pagado ${moneda(loanPaid(pagos))}`,
      ]).font = { bold: true };
      hDeuda.addRow([]);
    }
    formatoDinero(hDeuda, 3);

    // ---------- Metas ----------
    const hMetas = hoja(wb, 'Metas', [
      { header: 'Mes', width: 12 },
      { header: 'Meta ventas', width: 13 },
      { header: 'Ventas reales', width: 13 },
      { header: '% cumplido', width: 11 },
      { header: 'Meta encargos', width: 13 },
      { header: 'Encargos', width: 10 },
      { header: 'Meta clientes', width: 13 },
      { header: 'Clientes nuevos', width: 14 },
    ]);
    for (const m of metas.months) {
      const fila = hMetas.addRow([
        m.month,
        m.salesTarget,
        m.sales,
        m.salesProgress ?? '',
        m.ordersTarget,
        m.orders,
        m.newClientsTarget,
        m.newClients,
      ]);
      fila.getCell(4).numFmt = '0%';
    }
    formatoDinero(hMetas, 2, 3);

    // ---------- Producción ----------
    const hProd = hoja(wb, 'Producción', [
      { header: 'Impresora', width: 26 },
      { header: 'Trabajos', width: 10 },
      { header: 'Horas (contador)', width: 16 },
      { header: 'Vida útil', width: 11 },
      { header: '% usado', width: 10 },
      { header: 'Piezas medidas', width: 14 },
      { header: 'Reimpresas', width: 11 },
      { header: 'Tasa de fallos', width: 13 },
      { header: 'Repuestos', width: 12 },
      { header: 'Mant. cobrado', width: 14 },
    ]);
    for (const p of produccion.printers) {
      const fila = hProd.addRow([
        p.name,
        p.jobs,
        p.hours,
        p.lifetimeHours,
        p.lifeUsed ?? '',
        p.pieces,
        p.reprints,
        // Sin trabajos medidos NO se escribe 0: es "sin datos".
        p.failureRate ?? 'sin datos',
        p.maintenance.spent,
        p.maintenance.charged,
      ]);
      fila.getCell(5).numFmt = '0.0%';
      if (typeof p.failureRate === 'number') fila.getCell(8).numFmt = '0.0%';
    }
    formatoDinero(hProd, 9, 10);
    hProd.addRow([]);
    hProd.addRow([
      `${produccion.total.jobs - produccion.total.unmeasuredJobs} de ${produccion.total.jobs} pedidos tienen los fallos anotados.`,
    ]).font = { italic: true, size: 9 };
    hProd.addRow([
      produccion.total.printersWithoutReading > 0
        ? `${produccion.total.printersWithoutReading} impresora(s) sin ninguna lectura del contador: sus horas figuran en cero porque no se sabe.`
        : 'Las horas salen del contador de cada máquina, no de la suma de los pedidos.',
    ]).font = { italic: true, size: 9 };

    return wb;
  }
}

// ---------- Herramientas de armado ----------

const FORMATO = '"$"#,##0.00';
const suma = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;
const moneda = (n: number) => `$${n.toFixed(2)}`;
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** Una hoja con su encabezado en los colores del documento. */
function hoja(wb: ExcelJS.Workbook, nombre: string, cols: { header: string; width: number }[]) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001D3D' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

function titulo(ws: ExcelJS.Worksheet, texto: string) {
  ws.addRow([texto]).font = { bold: true, size: 14 };
}

function bloque(ws: ExcelJS.Worksheet, texto: string) {
  const fila = ws.addRow([texto]);
  fila.font = { bold: true, color: { argb: 'FF003566' } };
}

function dinero(ws: ExcelJS.Worksheet, etiqueta: string, valor: number, fuerte = false) {
  // Redondeado al centavo: el formato de celda lo mostraría bien igual, pero el
  // valor crudo con ruido de coma flotante se arrastra al operar sobre él.
  const fila = ws.addRow([etiqueta, Math.round(valor * 100) / 100]);
  fila.getCell(2).numFmt = FORMATO;
  if (fuerte) fila.font = { bold: true };
}

/** Formatea como dinero columnas enteras (sin el encabezado). */
function formatoDinero(ws: ExcelJS.Worksheet, ...columnas: number[]) {
  for (const c of columnas) {
    ws.getColumn(c).numFmt = FORMATO;
    ws.getCell(1, c).numFmt = 'General';
  }
}

/** Formato de dinero + una fila TOTAL al pie, que es lo que se mira primero. */
function totalizar(ws: ExcelJS.Worksheet, ...columnas: number[]) {
  formatoDinero(ws, ...columnas);
  const ultima = ws.rowCount;
  if (ultima < 2) return;
  const fila = ws.addRow([]);
  fila.getCell(1).value = 'TOTAL';
  for (const c of columnas) {
    fila.getCell(c).value = { formula: `SUM(${letra(c)}2:${letra(c)}${ultima})` };
    fila.getCell(c).numFmt = FORMATO;
  }
  fila.font = { bold: true };
}

/** Número de columna → letra de Excel (1 = A, 27 = AA). */
function letra(n: number): string {
  let s = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('excel.xlsx')
  async excel(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const wb = await this.service.workbook(user.organizationId);
    const nombre = `reporte-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    await wb.xlsx.write(res);
    res.end();
  }
}

@Module({
  imports: [FilamentModule, GoalsModule, LoansModule, PrintersModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
