// Analítica del Panel: agregaciones puras (sin datos ficticios) para los gráficos.
// Todo sale de facturas, caja, órdenes de reparación e inventario reales, y usa las
// mismas reglas que Contabilidad (lineOf, comisiones, gastos de caja).
import type { CashMovement, Invoice, Product, RepairOrder } from '../lib/types';
import { OPEN_STATUSES } from '../lib/types';
import { categoryOf } from '../lib/categories';
import { lineOf } from './accounting';
import { tracksStock } from './inventory';

export type Grain = 'dia' | 'semana' | 'mes' | 'anio';

export interface Bucket {
  from: Date;
  to: Date;
  /** etiqueta corta para el eje */
  label: string;
  /** etiqueta larga para el tooltip y la tabla */
  long: string;
  /** contiene el momento actual */
  current: boolean;
}

export interface Range {
  grain: Grain;
  from: Date;
  to: Date;
  label: string;
  buckets: Bucket[];
  /** el periodo incluye hoy (offset 0) */
  isCurrent: boolean;
}

const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('es-CO', o).replace('.', '');

/** Lunes de la semana de `d` (en Colombia la semana empieza el lunes). */
export const startOfWeek = (d: Date) => addDays(sod(d), -((d.getDay() + 6) % 7));

/**
 * Periodo a consultar: `offset` 0 = el actual, -1 = el anterior, etc.
 * Día → 24 horas · Semana → 7 días · Mes → días del mes · Año → 12 meses.
 */
export function analyticsRange(grain: Grain, offset = 0, now = new Date()): Range {
  const t = now.getTime();
  const mk = (from: Date, to: Date, label: string, long: string): Bucket => ({ from, to, label, long, current: t >= from.getTime() && t < to.getTime() });
  let from: Date;
  let to: Date;
  let label: string;
  const buckets: Bucket[] = [];
  if (grain === 'dia') {
    from = addDays(sod(now), offset);
    to = addDays(from, 1);
    label = cap(fmt(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    for (let h = 0; h < 24; h++) {
      const f = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h);
      buckets.push(mk(f, new Date(f.getFullYear(), f.getMonth(), f.getDate(), h + 1), `${h}h`, `${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00`));
    }
  } else if (grain === 'semana') {
    from = addDays(startOfWeek(now), offset * 7);
    to = addDays(from, 7);
    const last = addDays(to, -1);
    label = `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    for (let k = 0; k < 7; k++) {
      const f = addDays(from, k);
      buckets.push(mk(f, addDays(f, 1), cap(fmt(f, { weekday: 'short' })), cap(fmt(f, { weekday: 'long', day: 'numeric', month: 'short' }))));
    }
  } else if (grain === 'mes') {
    from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    label = cap(fmt(from, { month: 'long', year: 'numeric' }));
    for (let f = from; f < to; f = addDays(f, 1)) {
      buckets.push(mk(f, addDays(f, 1), String(f.getDate()), cap(fmt(f, { weekday: 'short', day: 'numeric', month: 'short' }))));
    }
  } else {
    from = new Date(now.getFullYear() + offset, 0, 1);
    to = new Date(from.getFullYear() + 1, 0, 1);
    label = String(from.getFullYear());
    for (let m = 0; m < 12; m++) {
      const f = new Date(from.getFullYear(), m, 1);
      buckets.push(mk(f, new Date(from.getFullYear(), m + 1, 1), cap(fmt(f, { month: 'short' })), cap(fmt(f, { month: 'long', year: 'numeric' }))));
    }
  }
  return { grain, from, to, label, buckets, isCurrent: t >= from.getTime() && t < to.getTime() };
}

/** Índice del bucket que contiene `iso`, o -1. Buckets contiguos y ordenados → búsqueda binaria. */
export function bucketIndex(buckets: Bucket[], iso: string | undefined): number {
  if (!iso || !buckets.length) return -1;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t < buckets[0].from.getTime() || t >= buckets[buckets.length - 1].to.getTime()) return -1;
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (buckets[mid].from.getTime() <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface BucketStats {
  /** ventas netas (subtotal − descuento), igual que «Ingresos» en Contabilidad */
  income: number;
  /** costo de lo vendido + gastos de caja + comisiones */
  expenses: number;
  cost: number;
  operating: number;
  commissions: number;
  /** ingresos − gastos (= ganancia neta de Contabilidad) */
  net: number;
  invoices: number;
  phones: number;
  accessories: number;
  received: number;
  finished: number;
}

const empty = (): BucketStats => ({ income: 0, expenses: 0, cost: 0, operating: 0, commissions: 0, net: 0, invoices: 0, phones: 0, accessories: 0, received: 0, finished: 0 });

const FINISHED = new Set(['Reparado / Listo', 'Entregado']);

/** Momento en que una orden quedó terminada (reparada o entregada), si lo está. */
export function finishedAt(o: Pick<RepairOrder, 'status' | 'timeline' | 'deliveredAt' | 'updatedAt'>): string | undefined {
  if (!FINISHED.has(o.status)) return undefined;
  const hit = (o.timeline ?? []).find((e) => e.status && FINISHED.has(e.status));
  return hit?.at ?? o.deliveredAt ?? o.updatedAt;
}

export interface AnalyticsData {
  invoices: Invoice[];
  movements: CashMovement[];
  products: Product[];
  orders: RepairOrder[];
}

/** Una sola pasada por cada colección para llenar todos los buckets del periodo. */
export function seriesFor(buckets: Bucket[], data: AnalyticsData, productMap = new Map(data.products.map((p) => [p.id, p]))): BucketStats[] {
  const out = buckets.map(empty);
  for (const inv of data.invoices) {
    if (inv.status === 'anulada') continue;
    const i = bucketIndex(buckets, inv.createdAt);
    if (i < 0) continue;
    const b = out[i];
    b.invoices++;
    b.income += (inv.subtotal || 0) - (inv.discount || 0);
    b.commissions += inv.commission || 0;
    for (const it of inv.items ?? []) {
      b.cost += it.qty * (it.unitCost || 0);
      const line = lineOf(it, productMap);
      if (line === 'Equipos') b.phones += it.qty;
      else if (line === 'Accesorios') b.accessories += it.qty;
    }
  }
  for (const m of data.movements) {
    if (m.direction !== 'egreso' || m.category !== 'gasto') continue;
    const i = bucketIndex(buckets, m.createdAt);
    if (i >= 0) out[i].operating += m.amount;
  }
  for (const o of data.orders) {
    const r = bucketIndex(buckets, o.createdAt);
    if (r >= 0) out[r].received++;
    const f = bucketIndex(buckets, finishedAt(o));
    if (f >= 0) out[f].finished++;
  }
  for (const b of out) {
    b.income = Math.round(b.income);
    b.expenses = Math.round(b.cost + b.operating + b.commissions);
    b.net = b.income - b.expenses;
  }
  return out;
}

export const sumStats = (rows: BucketStats[]): BucketStats =>
  rows.reduce((a, b) => {
    for (const k of Object.keys(a) as (keyof BucketStats)[]) a[k] += b[k];
    return a;
  }, empty());

/** Totales entre dos fechas (from inclusive, to exclusive). */
export const totalsBetween = (from: Date, to: Date, data: AnalyticsData, productMap?: Map<string, Product>) =>
  seriesFor([{ from, to, label: '', long: '', current: false }], data, productMap)[0];

/** Ventas por mes de un año y del anterior, para el comparativo. */
export function yearComparison(year: number, data: AnalyticsData, now = new Date()) {
  const ref = new Date(year, 0, 1);
  const cur = analyticsRange('anio', year - now.getFullYear(), now);
  const prev = analyticsRange('anio', year - 1 - now.getFullYear(), now);
  const pm = new Map(data.products.map((p) => [p.id, p]));
  const lite = { ...data, orders: [], movements: [] };
  const a = seriesFor(cur.buckets, lite, pm);
  const b = seriesFor(prev.buckets, lite, pm);
  const futureFrom = now.getFullYear() === ref.getFullYear() ? now.getMonth() + 1 : 12;
  return cur.buckets.map((bk, m) => ({
    label: bk.label,
    long: bk.label,
    current: a[m].income,
    previous: b[m].income,
    /** meses que aún no llegan (no se dibujan para el año en curso) */
    future: m >= futureFrom,
  }));
}

export interface InventoryRow {
  category: string;
  units: number;
  value: number;
  refs: number;
}

/** Inventario disponible por categoría (solo productos activos que controlan stock). */
export function inventoryByCategory(products: Product[]): { rows: InventoryRow[]; units: number; value: number; refs: number } {
  const map = new Map<string, InventoryRow>();
  for (const p of products) {
    if (!p.active || !tracksStock(p) || (p.stock || 0) <= 0) continue;
    const c = categoryOf(p);
    const r = map.get(c) ?? { category: c, units: 0, value: 0, refs: 0 };
    r.units += p.stock;
    r.value += p.stock * (p.cost || 0);
    r.refs++;
    map.set(c, r);
  }
  const rows = [...map.values()].sort((a, b) => b.units - a.units);
  return { rows, units: rows.reduce((a, r) => a + r.units, 0), value: rows.reduce((a, r) => a + r.value, 0), refs: rows.reduce((a, r) => a + r.refs, 0) };
}

export const pendingOrders = (orders: RepairOrder[]) => orders.filter((o) => OPEN_STATUSES.includes(o.status));

/** Variación porcentual redondeada; null si no hay base para comparar. */
export const pctChange = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
