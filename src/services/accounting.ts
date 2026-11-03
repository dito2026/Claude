// Contabilidad: cálculos puros a partir de facturas, caja, compras e inventario.
// Igual que las hojas «Contabilidad» y «Libro de caja» de Digital Cell POS.
import type { CashMovement, Invoice, InvoiceItem, PhoneUnit, Product, Purchase } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { purchaseBalance } from './purchases';
import { tracksStock } from './inventory';

export type PeriodKind = 'hoy' | '7dias' | 'mes' | 'mes_anterior' | 'anio' | 'rango';

export interface Period {
  from: Date; // inclusive
  to: Date; // exclusive
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function periodRange(kind: PeriodKind, now = new Date(), fromStr = '', toStr = ''): Period {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  switch (kind) {
    case 'hoy':
      return { from: today, to: tomorrow };
    case '7dias': {
      const f = new Date(today);
      f.setDate(f.getDate() - 6);
      return { from: f, to: tomorrow };
    }
    case 'mes':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow };
    case 'mes_anterior':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
    case 'anio':
      return { from: new Date(today.getFullYear(), 0, 1), to: tomorrow };
    case 'rango': {
      const f = fromStr ? new Date(`${fromStr}T00:00:00`) : today;
      const t = toStr ? new Date(`${toStr}T00:00:00`) : today;
      t.setDate(t.getDate() + 1);
      return { from: f, to: t };
    }
  }
}

export const inPeriod = (iso: string | undefined, p: Period) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
};

/** Clave de día local AAAA-MM-DD. */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type Line = 'Equipos' | 'Accesorios' | 'Servicio técnico';
export const LINES: Line[] = ['Equipos', 'Accesorios', 'Servicio técnico'];

export function lineOf(it: InvoiceItem, products: Map<string, Product>): Line {
  if (it.unitId) return 'Equipos';
  if (it.kind === 'mano_obra' || it.kind === 'repuesto') return 'Servicio técnico';
  const p = it.productId ? products.get(it.productId) : undefined;
  if (!p && it.kind === 'servicio') return 'Servicio técnico';
  // El tipo del producto manda; la «línea» solo desempata servicios.
  if (p?.type === 'EQUIPO') return 'Equipos';
  if (p?.type === 'ACCESORIO') return 'Accesorios';
  if (p?.type === 'REPUESTO') return 'Servicio técnico';
  if (p?.type === 'SERVICIO') return p.line === 'Accesorios' ? 'Accesorios' : 'Servicio técnico';
  return 'Accesorios';
}

export interface LineResult {
  line: Line;
  sales: number;
  cost: number;
  profit: number;
  margin: number | null;
}

export interface Report {
  invoices: number;
  grossSales: number; // antes de descuentos
  discounts: number;
  income: number; // ventas netas (sin IVA)
  tax: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  expenseCount: number;
  /** comisiones de vendedores causadas en el período (de las facturas) */
  commissions: number;
  netProfit: number;
  byLine: LineResult[];
  expensesByCategory: { category: string; amount: number }[];
  technicianPayments: number;
}

/**
 * Estado de resultados del período.
 * - Ingresos y costo salen de las facturas no anuladas (el costo de la mano de obra es el pago al técnico).
 * - Gastos: egresos de caja de categoría «gasto». Los pagos a técnicos NO se suman como gasto porque
 *   ya están en el costo de la mano de obra; se muestran aparte como informativo.
 */
export function buildReport(
  p: Period,
  data: { invoices: Invoice[]; movements: CashMovement[]; products: Product[] },
): Report {
  const products = new Map(data.products.map((x) => [x.id, x]));
  const invs = data.invoices.filter((i) => i.status !== 'anulada' && inPeriod(i.createdAt, p));
  const lines = new Map<Line, { sales: number; cost: number }>(LINES.map((l) => [l, { sales: 0, cost: 0 }]));
  let grossSales = 0;
  let discounts = 0;
  let tax = 0;
  for (const inv of invs) {
    grossSales += inv.subtotal;
    discounts += inv.discount || 0;
    tax += inv.tax || 0;
    // el descuento se reparte entre las líneas en proporción a su valor
    const factor = inv.subtotal > 0 ? (inv.subtotal - (inv.discount || 0)) / inv.subtotal : 1;
    for (const it of inv.items) {
      const l = lines.get(lineOf(it, products))!;
      l.sales += it.qty * it.unitPrice * factor;
      l.cost += it.qty * it.unitCost;
    }
  }
  const byLine: LineResult[] = LINES.map((line) => {
    const { sales, cost } = lines.get(line)!;
    const s = Math.round(sales);
    return { line, sales: s, cost, profit: s - cost, margin: s > 0 ? (s - cost) / s : null };
  });
  const income = grossSales - discounts;
  const cost = byLine.reduce((a, l) => a + l.cost, 0);

  const exp = data.movements.filter((m) => m.direction === 'egreso' && m.category === 'gasto' && inPeriod(m.createdAt, p));
  const cats = new Map<string, number>();
  for (const m of exp) cats.set(m.expenseCategory || 'Otros', (cats.get(m.expenseCategory || 'Otros') ?? 0) + m.amount);
  const expenses = exp.reduce((a, m) => a + m.amount, 0);
  const technicianPayments = data.movements
    .filter((m) => m.category === 'pago_tecnico' && inPeriod(m.createdAt, p))
    .reduce((a, m) => a + (m.direction === 'egreso' ? m.amount : -m.amount), 0);

  const commissions = invs.reduce((a, i) => a + (i.commission || 0), 0);
  return {
    invoices: invs.length,
    commissions,
    grossSales,
    discounts,
    income,
    tax,
    cost,
    grossProfit: income - cost,
    expenses,
    expenseCount: exp.length,
    netProfit: income - cost - expenses - commissions,
    byLine,
    expensesByCategory: [...cats].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    technicianPayments,
  };
}

// ---------------- Libro fiscal y libro de caja ----------------
const INCOME = new Set(['venta', 'abono_cliente', 'ingreso_otro']);
const OUTFLOW = new Set(['gasto', 'pago_proveedor', 'pago_tecnico', 'pago_vendedor']);

/** Tipo de operación para el libro fiscal. Retiros del dueño no son ingreso ni egreso. */
export function fiscalSign(m: CashMovement): { income: number; outflow: number } {
  if (m.category === 'anulacion') return { income: m.direction === 'egreso' ? -m.amount : m.amount, outflow: 0 };
  if (m.direction === 'ingreso' && INCOME.has(m.category)) return { income: m.amount, outflow: 0 };
  if (m.direction === 'egreso' && OUTFLOW.has(m.category)) return { income: 0, outflow: m.amount };
  return { income: 0, outflow: 0 };
}

export interface FiscalDay {
  day: string;
  income: number;
  outflow: number;
  net: number;
}

/** Libro fiscal de operaciones diarias (no responsables de IVA): ingresos y egresos de dinero por día. */
export function fiscalBook(p: Period, movements: CashMovement[]): { days: FiscalDay[]; income: number; outflow: number; net: number } {
  const map = new Map<string, FiscalDay>();
  for (const m of movements) {
    if (!inPeriod(m.createdAt, p)) continue;
    const { income, outflow } = fiscalSign(m);
    if (!income && !outflow) continue;
    const k = dayKey(m.createdAt!);
    const d = map.get(k) ?? { day: k, income: 0, outflow: 0, net: 0 };
    d.income += income;
    d.outflow += outflow;
    d.net = d.income - d.outflow;
    map.set(k, d);
  }
  const days = [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
  const income = days.reduce((a, d) => a + d.income, 0);
  const outflow = days.reduce((a, d) => a + d.outflow, 0);
  return { days, income, outflow, net: income - outflow };
}

// ---------------- Resumen del negocio hoy ----------------
export interface BalanceToday {
  phones: number;
  stock: number;
  receivables: number;
  payables: number;
  net: number;
}

export function balanceToday(data: { products: Product[]; units: PhoneUnit[]; purchases: Purchase[]; invoices: Invoice[] }): BalanceToday {
  const phones = data.units.filter((u) => u.status === 'disponible').reduce((a, u) => a + (u.cost || 0), 0);
  const stock = data.products
    .filter((p) => tracksStock(p) && p.type !== 'EQUIPO')
    .reduce((a, p) => a + Math.max(0, p.stock) * (p.cost || 0), 0);
  const receivables = data.invoices
    .filter((i) => i.status === 'credito')
    .reduce((a, i) => a + i.payments.filter((x) => x.method === CREDIT_METHOD).reduce((b, x) => b + x.amount, 0), 0);
  const payables = data.purchases.reduce((a, p) => a + purchaseBalance(p), 0);
  return { phones, stock, receivables, payables, net: phones + stock + receivables - payables };
}

/** Ventas del año (para el tope de no responsable de IVA). */
export function yearSales(invoices: Invoice[], now = new Date()) {
  const y = now.getFullYear();
  return invoices
    .filter((i) => i.status !== 'anulada' && i.createdAt && new Date(i.createdAt).getFullYear() === y)
    .reduce((a, i) => a + i.total, 0);
}

// ---------------- Exportar a Excel (CSV) ----------------
export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? String(Math.round(v)) : v ?? '';
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM + punto y coma: Excel en español lo abre con columnas y tildes correctas
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
