// Automatizaciones: alertas del día, reposición sugerida y resumen para el asistente.
// Todo se calcula solo, a partir de los datos que ya existen.
import type {
  CashMovement, CashSession, Invoice, PhoneUnit, Product, Purchase, RepairOrder, Seller, StockMovement, Supplier, Technician,
} from '../lib/types';
import { OPEN_STATUSES } from '../lib/types';
import { isOverdue, orderBalance } from './orders';
import { isOverduePurchase, purchaseBalance } from './purchases';
import { isLowStock, tracksStock } from './inventory';
import { technicianBalance } from './staff';
import { sellerBalance } from './sellers';
import { balanceToday, buildReport, periodRange } from './accounting';
import { warrantyActive } from './phones';

const DAY = 86400000;
const daysSince = (iso?: string) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : 0);

export type AlertLevel = 'red' | 'warn' | 'info';
export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  link?: string;
  /** mensaje de WhatsApp sugerido para el cliente */
  whatsapp?: { phone: string; text: string };
}

export interface AlertData {
  orders: RepairOrder[];
  purchases: Purchase[];
  products: Product[];
  sessions: CashSession[];
  openSessionId: string | null;
  technicians: Technician[];
  sellers: Seller[];
  invoices: Invoice[];
  movements: CashMovement[];
  businessName: string;
  lastBackupAt?: string | null;
}

export function readyMessage(o: RepairOrder, businessName: string) {
  const bal = orderBalance(o);
  return (
    `Hola ${o.customer.name.split(' ')[0]}, le saluda ${businessName}. Su ${o.device.brand} ${o.device.model} ` +
    `(orden OT ${String(o.number).padStart(5, '0')}) ya está listo para recoger.` +
    (bal > 0 ? ` Saldo pendiente: $ ${bal.toLocaleString('es-CO')}.` : '') +
    ' ¡Lo esperamos!'
  );
}

/** Centro de alertas: lo que hay que atender hoy. */
export function buildAlerts(d: AlertData): Alert[] {
  const out: Alert[] = [];
  for (const o of d.orders) {
    if (isOverdue(o)) {
      out.push({ id: `late-${o.id}`, level: 'red', title: `OT ${o.number} atrasada`, detail: `${o.device.brand} ${o.device.model} · ${o.customer.name} · prometida hace ${Math.ceil(daysSince(o.promisedAt))} día(s)`, link: `/taller/${o.id}` });
    }
    if (o.status === 'Reparado / Listo') {
      const since = [...o.timeline].reverse().find((t) => t.status === 'Reparado / Listo')?.at ?? o.updatedAt;
      const days = Math.floor(daysSince(since));
      if (days >= 3 && o.customer.phone) {
        out.push({
          id: `pickup-${o.id}`, level: days >= 15 ? 'red' : 'warn', title: `OT ${o.number} lista hace ${days} días sin recoger`,
          detail: `${o.customer.name} · ${o.device.brand} ${o.device.model}`, link: `/taller/${o.id}`,
          whatsapp: { phone: o.customer.phone, text: readyMessage(o, d.businessName) },
        });
      }
    }
    if (OPEN_STATUSES.includes(o.status) && !o.technicianId) {
      out.push({ id: `notech-${o.id}`, level: 'info', title: `OT ${o.number} sin técnico asignado`, detail: `${o.device.brand} ${o.device.model}`, link: `/taller/${o.id}` });
    }
  }
  for (const p of d.purchases) {
    const bal = purchaseBalance(p);
    if (!bal || !p.dueDate) continue;
    const left = (new Date(p.dueDate).getTime() - Date.now()) / DAY;
    if (isOverduePurchase(p)) {
      out.push({ id: `pdue-${p.id}`, level: 'red', title: `Deuda vencida con ${p.supplierName}`, detail: `Compra C-${String(p.number).padStart(4, '0')} · $ ${bal.toLocaleString('es-CO')}`, link: '/compras' });
    } else if (left <= 3) {
      out.push({ id: `psoon-${p.id}`, level: 'warn', title: `Pago a ${p.supplierName} vence en ${Math.max(0, Math.ceil(left))} día(s)`, detail: `Compra C-${String(p.number).padStart(4, '0')} · $ ${bal.toLocaleString('es-CO')}`, link: '/compras' });
    }
  }
  const low = d.products.filter(isLowStock);
  if (low.length) {
    out.push({ id: 'lowstock', level: 'warn', title: `${low.length} producto(s) con stock bajo`, detail: low.slice(0, 4).map((p) => `${p.name} (${p.stock})`).join(', ') + (low.length > 4 ? '…' : ''), link: '/inventario' });
  }
  const open = d.sessions.find((s) => s.id === d.openSessionId);
  if (open && new Date(open.openedAt).toDateString() !== new Date().toDateString()) {
    out.push({ id: 'cash-old', level: 'red', title: 'La caja de un día anterior sigue abierta', detail: `Abierta el ${new Date(open.openedAt).toLocaleDateString('es-CO')} por ${open.openedBy}. Haga el cierre y arqueo.`, link: '/caja' });
  }
  const techOwed = d.technicians.reduce((a, t) => a + Math.max(0, technicianBalance(t, d.orders, d.movements).owed), 0);
  if (techOwed > 0) out.push({ id: 'tech', level: 'info', title: `Por pagar a técnicos: $ ${techOwed.toLocaleString('es-CO')}`, detail: 'Caja → Pago a técnico', link: '/tecnicos' });
  const sellOwed = d.sellers.reduce((a, s) => a + Math.max(0, sellerBalance(s, d.invoices, d.movements).owed), 0);
  if (sellOwed > 0) out.push({ id: 'sell', level: 'info', title: `Comisiones por pagar: $ ${sellOwed.toLocaleString('es-CO')}`, detail: 'Caja → Pago a vendedor', link: '/vendedores' });
  if (d.lastBackupAt !== undefined && (!d.lastBackupAt || daysSince(d.lastBackupAt) > 7)) {
    out.push({ id: 'backup', level: 'info', title: 'Descargue un respaldo de sus datos', detail: d.lastBackupAt ? `El último fue hace ${Math.floor(daysSince(d.lastBackupAt))} días.` : 'Nunca se ha descargado uno en este equipo.', link: '/configuracion' });
  }
  const rank: Record<AlertLevel, number> = { red: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------------- Reposición sugerida ----------------
export interface RestockLine {
  product: Product;
  soldLast30: number;
  suggested: number;
  supplierId?: string;
  supplierName?: string;
  lastCost: number;
}

/**
 * Cuánto comprar: lo que se vendió/usó en 30 días alcanza para ~15 días más el mínimo,
 * menos lo que hay. El proveedor sugerido es el de la última compra del producto.
 */
export function restockSuggestions(products: Product[], movements: StockMovement[], purchases: Purchase[], suppliers: Supplier[]): RestockLine[] {
  const since = Date.now() - 30 * DAY;
  const out: RestockLine[] = [];
  for (const p of products) {
    if (!p.active || !tracksStock(p) || p.type === 'EQUIPO') continue;
    const used = movements
      .filter((m) => m.productId === p.id && (m.reason === 'venta' || m.reason === 'reparacion') && new Date(m.createdAt ?? 0).getTime() >= since)
      .reduce((a, m) => a - m.qty, 0);
    const target = Math.max(p.minStock * 2, Math.ceil((used / 30) * 15) + p.minStock);
    const suggested = target - p.stock;
    if (suggested <= 0 || (p.stock > p.minStock && used === 0)) continue;
    const last = purchases
      .filter((x) => x.status !== 'anulada' && x.items.some((i) => i.productId === p.id))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
    const sup = last ? suppliers.find((s) => s.id === last.supplierId) : undefined;
    out.push({ product: p, soldLast30: used, suggested, supplierId: sup?.id, supplierName: sup?.name ?? last?.supplierName, lastCost: last?.items.find((i) => i.productId === p.id)?.unitCost ?? p.cost });
  }
  return out.sort((a, b) => (a.supplierName ?? '~').localeCompare(b.supplierName ?? '~') || b.soldLast30 - a.soldLast30);
}

// ---------------- Resumen del día (WhatsApp al dueño) ----------------
export function dailySummaryText(d: { invoices: Invoice[]; movements: CashMovement[]; products: Product[]; orders: RepairOrder[]; businessName: string }) {
  const r = buildReport(periodRange('hoy'), d);
  const opened = d.orders.filter((o) => new Date(o.createdAt ?? 0).toDateString() === new Date().toDateString()).length;
  const delivered = d.orders.filter((o) => o.deliveredAt && new Date(o.deliveredAt).toDateString() === new Date().toDateString()).length;
  const f = (n: number) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
  return [
    `*${d.businessName} · Resumen ${new Date().toLocaleDateString('es-CO')}*`,
    `Ventas: ${f(r.income)} (${r.invoices})`,
    ...r.byLine.filter((l) => l.sales).map((l) => `• ${l.line}: ${f(l.sales)}`),
    `Utilidad bruta: ${f(r.grossProfit)}`,
    `Gastos: ${f(r.expenses)}`,
    `*Utilidad neta: ${f(r.netProfit)}*`,
    `Órdenes recibidas: ${opened} · entregadas: ${delivered}`,
    `Órdenes abiertas: ${d.orders.filter((o) => OPEN_STATUSES.includes(o.status)).length}`,
  ].join('\n');
}

// ---------------- Datos para el asistente de IA ----------------
export function businessSnapshot(d: {
  invoices: Invoice[]; movements: CashMovement[]; products: Product[]; orders: RepairOrder[]; purchases: Purchase[];
  units: PhoneUnit[]; technicians: Technician[]; sellers: Seller[]; stockMovements: StockMovement[]; suppliers: Supplier[];
}): string {
  const report = (k: Parameters<typeof periodRange>[0]) => {
    const r = buildReport(periodRange(k), d);
    return { ingresos: r.income, costo: r.cost, utilidad_bruta: r.grossProfit, gastos: r.expenses, comisiones: r.commissions, utilidad_neta: r.netProfit, ventas: r.invoices, por_linea: r.byLine.map((l) => ({ linea: l.line, ventas: l.sales, ganancia: l.profit })), gastos_por_categoria: r.expensesByCategory };
  };
  const last30 = Date.now() - 30 * DAY;
  const sold = new Map<string, { nombre: string; unidades: number; ventas: number }>();
  for (const i of d.invoices) {
    if (i.status === 'anulada' || new Date(i.createdAt ?? 0).getTime() < last30) continue;
    for (const it of i.items) {
      const k = it.description;
      const s = sold.get(k) ?? { nombre: k, unidades: 0, ventas: 0 };
      s.unidades += it.qty; s.ventas += it.qty * it.unitPrice; sold.set(k, s);
    }
  }
  const perDay = new Map<string, number>();
  for (const i of d.invoices) {
    if (i.status === 'anulada' || new Date(i.createdAt ?? 0).getTime() < last30) continue;
    const k = new Date(i.createdAt!).toISOString().slice(0, 10);
    perDay.set(k, (perDay.get(k) ?? 0) + i.total);
  }
  const snap = {
    fecha_actual: new Date().toISOString().slice(0, 10),
    hoy: report('hoy'),
    ultimos_7_dias: report('7dias'),
    este_mes: report('mes'),
    mes_anterior: report('mes_anterior'),
    este_anio: report('anio'),
    ventas_por_dia_30_dias: Object.fromEntries([...perDay].sort()),
    mas_vendidos_30_dias: [...sold.values()].sort((a, b) => b.ventas - a.ventas).slice(0, 15),
    balance: balanceToday({ products: d.products, units: d.units, purchases: d.purchases, invoices: d.invoices }),
    ordenes_abiertas: d.orders.filter((o) => OPEN_STATUSES.includes(o.status)).map((o) => ({ ot: o.number, equipo: `${o.device.brand} ${o.device.model}`, falla: o.reportedIssue, estado: o.status, tecnico: o.technicianName, atrasada: isOverdue(o), dias_abierta: Math.floor(daysSince(o.createdAt)) })).slice(0, 60),
    stock_bajo: d.products.filter(isLowStock).map((p) => ({ nombre: p.name, stock: p.stock, minimo: p.minStock })),
    reposicion_sugerida: restockSuggestions(d.products, d.stockMovements, d.purchases, d.suppliers).map((r) => ({ producto: r.product.name, comprar: r.suggested, usados_30_dias: r.soldLast30, proveedor: r.supplierName })).slice(0, 40),
    celulares_disponibles: d.units.filter((u) => u.status === 'disponible').map((u) => ({ equipo: u.productName, condicion: u.condition, costo: u.cost, dias_en_inventario: Math.floor(daysSince(u.createdAt)) })),
    garantias_vigentes: d.units.filter(warrantyActive).length,
    deudas_proveedores: d.purchases.filter((p) => purchaseBalance(p) > 0).map((p) => ({ proveedor: p.supplierName, saldo: purchaseBalance(p), vence: p.dueDate?.slice(0, 10), vencida: isOverduePurchase(p) })),
    tecnicos: d.technicians.map((t) => ({ nombre: t.name, ...technicianBalance(t, d.orders, d.movements) })),
    vendedores: d.sellers.map((s) => ({ nombre: s.name, comision: `${s.commissionPct}% ${s.commissionBase}`, ...sellerBalance(s, d.invoices, d.movements, new Date(new Date().getFullYear(), new Date().getMonth(), 1)) })),
  };
  return JSON.stringify(snap);
}
