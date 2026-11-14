// Vendedores: comisión por venta. Se calcula al facturar (queda fija en la factura),
// se anula con la factura y se paga desde Caja → «Pago a vendedor».
import { backend } from '../data';
import type { CashMovement, CommissionBase, Invoice, InvoiceItem, Product, Seller } from '../lib/types';
import { BusinessError, created, sum, touched, type Actor } from './common';
import { inPeriod, lineOf, type Line, type Period } from './accounting';

export type SellerInput = Omit<Seller, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export const BASE_LABEL: Record<CommissionBase, string> = {
  venta: 'sobre la venta',
  utilidad: 'sobre la ganancia',
};

export async function saveSeller(actor: Actor, s: SellerInput, id?: string) {
  const data = { ...s, name: s.name.trim(), commissionPct: Math.max(0, Math.min(100, Number(s.commissionPct) || 0)) };
  if (!data.name) throw new BusinessError('El nombre es obligatorio.');
  if (id) return backend.update('sellers', id, { ...data, ...touched() });
  return backend.create('sellers', { ...data, ...created(actor) });
}

/**
 * Comisión de una venta. Solo cuentan las líneas de negocio elegidas para el vendedor
 * (vacío = todas). El descuento de la factura se reparte entre las líneas.
 */
export function computeCommission(
  seller: Pick<Seller, 'commissionPct' | 'commissionBase' | 'lines'>,
  items: InvoiceItem[],
  discount: number,
  products: Map<string, Product>,
): number {
  const subtotal = sum(items.map((i) => i.qty * i.unitPrice));
  if (subtotal <= 0 || !(seller.commissionPct > 0)) return 0;
  const factor = (subtotal - Math.min(discount || 0, subtotal)) / subtotal;
  const allowed = seller.lines?.length ? new Set(seller.lines) : null;
  let sales = 0;
  let cost = 0;
  for (const it of items) {
    if (allowed && !allowed.has(lineOf(it, products) as Line)) continue;
    sales += it.qty * it.unitPrice * factor;
    cost += it.qty * it.unitCost;
  }
  const base = seller.commissionBase === 'utilidad' ? Math.max(0, sales - cost) : sales;
  return Math.round((base * seller.commissionPct) / 100);
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
export function sellerSalesDetail(sellerId: string, invoices: Invoice[], period?: Period): SellerSaleLine[] {
  const out: SellerSaleLine[] = [];
  for (const inv of invoices) {
    if (inv.sellerId !== sellerId || !valid(inv)) continue;
    if (period && !inPeriod(inv.createdAt, period)) continue;
    const factor = inv.subtotal > 0 ? (inv.subtotal - (inv.discount || 0)) / inv.subtotal : 1;
    const values = inv.items.map((it) => it.qty * it.unitPrice * factor);
    const total = sum(values);
    inv.items.forEach((it, k) => {
      const sales = Math.round(values[k]);
      const cost = Math.round(it.qty * (it.unitCost || 0));
      out.push({
        invoiceId: inv.id, invoiceNumber: inv.number, at: inv.createdAt ?? '', customer: inv.customer?.name || 'Consumidor final',
        description: it.description, imei: it.imei, qty: it.qty, sales, cost, profit: sales - cost,
        commission: total > 0 ? Math.round(((inv.commission || 0) * values[k]) / total) : 0,
      });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.invoiceNumber - b.invoiceNumber);
}
