// Vendedores: comisión por venta. Se calcula al facturar (queda fija en la factura),
// se anula con la factura y se paga desde Caja → «Pago a vendedor».
import { backend } from '../data';
import type { CashMovement, CategoryRates, CommissionBase, Invoice, InvoiceItem, Product, Seller } from '../lib/types';
import { itemCategory } from '../lib/categories';
import { BusinessError, created, sum, touched, type Actor } from './common';
import { LINES, inPeriod, lineOf, type Line, type Period } from './accounting';

export type SellerInput = Omit<Seller, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export const BASE_LABEL: Record<CommissionBase, string> = {
  venta: 'sobre la venta',
  utilidad: 'sobre la ganancia',
};

const clampPct = (n: unknown) => Math.max(0, Math.min(100, Number(n) || 0));

export async function saveSeller(actor: Actor, s: SellerInput, id?: string) {
  const rates: CategoryRates = {};
  for (const line of LINES) {
    const r = s.categoryRates?.[line];
    if (r && r.pct !== undefined && r.pct !== null && !Number.isNaN(Number(r.pct))) {
      rates[line] = { pct: clampPct(r.pct), base: r.base === 'utilidad' ? 'utilidad' : 'venta' };
    } else if (s.lines?.length && !s.lines.includes(line)) {
      rates[line] = { pct: 0, base: s.commissionBase }; // antes: «no gana comisión en esta línea»
    }
  }
  const data = { ...s, name: s.name.trim(), commissionPct: clampPct(s.commissionPct), categoryRates: rates, lines: [] };
  if (!data.name) throw new BusinessError('El nombre es obligatorio.');
  if (id) return backend.update('sellers', id, { ...data, ...touched() });
  return backend.create('sellers', { ...data, ...created(actor) });
}

export type CommissionRule = Pick<Seller, 'commissionPct' | 'commissionBase' | 'lines' | 'categoryRates'>;

/**
 * % y base de comisión de un artículo: el de su línea de negocio (Equipos, Accesorios, Servicio técnico) si el
 * vendedor tiene uno propio; si no, la comisión general. (Facturas de antes pueden traer % por categoría de producto.)
 */
export function rateFor(rule: CommissionRule, it: InvoiceItem, products: Map<string, Product>) {
  const r = rule.categoryRates;
  return r?.[lineOf(it, products)] ?? r?.[itemCategory(it, products)] ?? { pct: rule.commissionPct || 0, base: rule.commissionBase };
}

/** ¿Tiene alguna categoría con comisión propia? */
export const hasCategoryRates = (rule: Pick<Seller, 'categoryRates'>) => Object.keys(rule.categoryRates ?? {}).length > 0;

/**
 * Comisión por línea de la factura. Cada artículo toma el % de su categoría (o el general).
 * Las líneas con el mismo % y base se suman; si es «sobre la ganancia», la ganancia del grupo no baja de 0.
 * Solo cuentan las líneas de negocio elegidas para el vendedor (vacío = todas). El descuento se reparte.
 */
export function commissionByItem(rule: CommissionRule, items: InvoiceItem[], discount: number, products: Map<string, Product>): number[] {
  const out = items.map(() => 0);
  const subtotal = sum(items.map((i) => i.qty * i.unitPrice));
  if (subtotal <= 0) return out;
  const factor = (subtotal - Math.min(discount || 0, subtotal)) / subtotal;
  const allowed = rule.lines?.length ? new Set(rule.lines) : null;
  const groups = new Map<string, { pct: number; base: CommissionBase; sales: number; cost: number; idx: number[] }>();
  items.forEach((it, k) => {
    if (allowed && !allowed.has(lineOf(it, products) as Line)) return;
    const r = rateFor(rule, it, products);
    if (!(r.pct > 0)) return;
    const key = `${r.base}|${r.pct}`;
    const g = groups.get(key) ?? { pct: r.pct, base: r.base, sales: 0, cost: 0, idx: [] };
    g.sales += it.qty * it.unitPrice * factor;
    g.cost += it.qty * (it.unitCost || 0);
    g.idx.push(k);
    groups.set(key, g);
  });
  for (const g of groups.values()) {
    const amount = Math.round(((g.base === 'utilidad' ? Math.max(0, g.sales - g.cost) : g.sales) * g.pct) / 100);
    // se reparte entre los artículos del grupo según lo que aporta cada uno
    const weight = (k: number) => {
      const it = items[k];
      const s = it.qty * it.unitPrice * factor;
      return g.base === 'utilidad' ? Math.max(0, s - it.qty * (it.unitCost || 0)) : s;
    };
    const total = sum(g.idx.map(weight));
    let left = amount;
    g.idx.forEach((k, n) => {
      const part = n === g.idx.length - 1 ? left : total > 0 ? Math.round((amount * weight(k)) / total) : 0;
      out[k] += part;
      left -= part;
    });
  }
  return out;
}

/** Comisión de una venta (suma de sus líneas). */
export function computeCommission(rule: CommissionRule, items: InvoiceItem[], discount: number, products: Map<string, Product>): number {
  return sum(commissionByItem(rule, items, discount, products));
}

/** Texto corto de la comisión de un vendedor: «5% sobre la venta · con % por línea». */
export function commissionLabel(s: CommissionRule) {
  return `${s.commissionPct}% ${BASE_LABEL[s.commissionBase]}${hasCategoryRates(s) ? ' · con % por línea' : ''}`;
}

const valid = (i: Invoice) => i.status !== 'anulada';

/** Comisiones ganadas, pagadas y por pagar de un vendedor. */
export function sellerBalance(s: Seller, invoices: Invoice[], movements: CashMovement[], from?: Date) {
  const mine = invoices.filter((i) => i.sellerId === s.id && valid(i));
  const inRange = from ? mine.filter((i) => new Date(i.createdAt ?? 0) >= from) : mine;
  const earned = sum(mine.map((i) => i.commission || 0));
  const paid = sum(
    movements
      .filter((m) => m.category === 'pago_vendedor' && m.refId === s.id)
      .map((m) => (m.direction === 'egreso' ? m.amount : -m.amount)),
  );
  return {
    sales: sum(inRange.map((i) => i.total - (i.tax || 0))),
    count: inRange.length,
    periodCommission: sum(inRange.map((i) => i.commission || 0)),
    earned,
    paid,
    owed: earned - paid,
  };
}

export interface SellerSaleLine {
  invoiceId: string;
  invoiceNumber: number;
  at: string;
  customer: string;
  description: string;
  imei?: string;
  qty: number;
  /** valor vendido de la línea (con el descuento de la factura repartido) */
  sales: number;
  cost: number;
  profit: number;
  /** comisión de la factura repartida según el valor de cada línea */
  commission: number;
}

/** Detalle de ventas de un vendedor por producto, con costo, ganancia y comisión (sin facturas anuladas). */
export function sellerSalesDetail(sellerId: string, invoices: Invoice[], period?: Period, products?: Map<string, Product>): SellerSaleLine[] {
  const out: SellerSaleLine[] = [];
  for (const inv of invoices) {
    if (inv.sellerId !== sellerId || !valid(inv)) continue;
    if (period && !inPeriod(inv.createdAt, period)) continue;
    const factor = inv.subtotal > 0 ? (inv.subtotal - (inv.discount || 0)) / inv.subtotal : 1;
    const values = inv.items.map((it) => it.qty * it.unitPrice * factor);
    const total = sum(values);
    // por categoría: cada línea con su propia comisión (la factura guardó los % que tenía el vendedor)
    const byItem = inv.commissionRates && products
      ? commissionByItem({ commissionPct: inv.commissionPct ?? 0, commissionBase: inv.commissionBase ?? 'venta', categoryRates: inv.commissionRates }, inv.items, inv.discount, products)
      : null;
    const exact = byItem && sum(byItem) === (inv.commission || 0);
    inv.items.forEach((it, k) => {
      const sales = Math.round(values[k]);
      const cost = Math.round(it.qty * (it.unitCost || 0));
      out.push({
        invoiceId: inv.id, invoiceNumber: inv.number, at: inv.createdAt ?? '', customer: inv.customer?.name || 'Consumidor final',
        description: it.description, imei: it.imei, qty: it.qty, sales, cost, profit: sales - cost,
        commission: exact ? byItem![k] : total > 0 ? Math.round(((inv.commission || 0) * values[k]) / total) : 0,
      });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.invoiceNumber - b.invoiceNumber);
}

export interface CommissionRecalcRow { invoice: Invoice; before: number; after: number }

/** Cómo quedaría la comisión de las ventas del vendedor (en el período) con su configuración ACTUAL. */
export function commissionRecalcPreview(seller: Seller, invoices: Invoice[], products: Map<string, Product>, period?: Period): CommissionRecalcRow[] {
  return invoices
    .filter((i) => i.sellerId === seller.id && valid(i) && (!period || inPeriod(i.createdAt, period)))
    .map((invoice) => ({ invoice, before: invoice.commission || 0, after: computeCommission(seller, invoice.items, invoice.discount, products) }))
    .sort((a, b) => (b.invoice.createdAt ?? '').localeCompare(a.invoice.createdAt ?? ''));
}

/**
 * Recalcula (solo administrador) la comisión de esas ventas con la configuración ACTUAL del vendedor
 * (% general y % por línea). Guarda en cada factura la comisión anterior (`commissionEdits`).
 * No mueve la caja: cambia lo que se le debe al vendedor (lo ya pagado se conserva).
 */
export async function recalcCommissions(actor: Actor, sellerId: string, invoiceIds: string[]) {
  let changed = 0;
  let diff = 0;
  for (let i = 0; i < invoiceIds.length; i += 100) {
    const chunk = invoiceIds.slice(i, i + 100);
    const r = await backend.transaction(async (tx) => {
      const seller = await tx.get<Seller>('sellers', sellerId);
      if (!seller) throw new BusinessError('Vendedor no encontrado.');
      const invs: Invoice[] = [];
      for (const id of chunk) {
        const inv = await tx.get<Invoice>('invoices', id);
        if (inv && inv.sellerId === sellerId && valid(inv)) invs.push(inv);
      }
      const products = new Map<string, Product>();
      for (const inv of invs) for (const it of inv.items) {
        if (it.productId && !products.has(it.productId)) {
          const p = await tx.get<Product>('products', it.productId);
          if (p) products.set(p.id, p);
        }
      }
      // ---------- ESCRITURAS ----------
      const at = new Date().toISOString();
      let n = 0;
      let d = 0;
      for (const inv of invs) {
        const after = computeCommission(seller, inv.items, inv.discount, products);
        if (after === (inv.commission || 0)) continue;
        n += 1;
        d += after - (inv.commission || 0);
        tx.update('invoices', inv.id, {
          commission: after,
          commissionPct: seller.commissionPct,
          commissionBase: seller.commissionBase,
          commissionRates: seller.categoryRates ?? {},
          commissionEdits: [...(inv.commissionEdits ?? []), {
            at, by: actor.name, commission: inv.commission || 0,
            ...(inv.commissionPct !== undefined ? { pct: inv.commissionPct } : {}),
            ...(inv.commissionBase ? { base: inv.commissionBase } : {}),
            ...(inv.commissionRates ? { rates: inv.commissionRates } : {}),
          }],
          ...touched(),
        });
      }
      return { n, d };
    });
    changed += r.n;
    diff += r.d;
  }
  return { changed, diff };
}
