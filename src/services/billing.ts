import { backend } from '../data';
import type { CustomerRef, Invoice, InvoiceItem, Payment, Product, RepairOrder } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { addDays } from '../lib/format';
import { BusinessError, created, readNext, sum, touched, writeCounter, type Actor } from './common';
import { requireOpenSession, writeMovement } from './cash';
import { moveStock } from './inventory';
import { depositsTotal } from './orders';

export interface InvoiceDraft {
  customerId?: string;
  customer: CustomerRef;
  items: InvoiceItem[];
  discount: number;
  taxRate: number;
  payments: Payment[];
  repairOrderId?: string;
  cashierName: string;
}

export function computeTotals(items: InvoiceItem[], discount: number, taxRate: number) {
  const subtotal = sum(items.map((i) => i.qty * i.unitPrice));
  const disc = Math.min(Math.max(0, discount || 0), subtotal);
  const tax = Math.round(((subtotal - disc) * (taxRate || 0)) / 100);
  return { subtotal, discount: disc, tax, total: subtotal - disc + tax };
}

export const invoiceCost = (inv: Pick<Invoice, 'items'>) => sum(inv.items.map((i) => i.qty * i.unitCost));

/** Líneas de factura a partir de una OT: mano de obra + repuestos (ya descontados del stock). */
export function itemsFromOrder(o: RepairOrder): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  if (o.laborPrice > 0) {
    items.push({
      description: `Mano de obra OT ${o.number} · ${o.device.brand} ${o.device.model}`,
      kind: 'mano_obra',
      qty: 1,
      unitPrice: o.laborPrice,
      unitCost: o.technicianPay || 0,
      imei: o.device.imei || undefined,
    });
  }
  for (const p of o.parts) {
    items.push({
      productId: p.productId || undefined,
      description: p.name,
      kind: 'repuesto',
      qty: p.qty,
      unitPrice: p.unitPrice,
      unitCost: p.unitCost,
      stockAlreadyMoved: true,
    });
  }
  return items;
}

export async function createInvoice(actor: Actor, draft: InvoiceDraft) {
  const items = draft.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new BusinessError('Agregue al menos un producto o servicio.');
  if (items.some((i) => i.unitPrice < 0)) throw new BusinessError('Hay precios negativos.');
  const totals = computeTotals(items, draft.discount, draft.taxRate);
  const payments = draft.payments.filter((p) => p.amount > 0);
  const usesCredit = payments.some((p) => p.method === CREDIT_METHOD);
  if (usesCredit && !draft.customerId) {
    throw new BusinessError('Para vender a crédito seleccione un cliente registrado.');
  }

  return backend.transaction(async (tx) => {
    // ---------- LECTURAS ----------
    const number = await readNext(tx, 'invoices');
    const sessionId = await requireOpenSession(tx);
    let order: RepairOrder | null = null;
    if (draft.repairOrderId) {
      order = await tx.get<RepairOrder>('repairOrders', draft.repairOrderId);
      if (!order) throw new BusinessError('Orden no encontrada.');
      if (order.invoiceId) throw new BusinessError(`La OT ${order.number} ya fue facturada.`);
    }
    const depositsApplied = order ? Math.min(depositsTotal(order), totals.total) : 0;
    const due = totals.total - depositsApplied;
    const paid = sum(payments.map((p) => p.amount));
    if (paid !== due) {
      throw new BusinessError(
        `Los pagos (${paid.toLocaleString('es-CO')}) no coinciden con el saldo a pagar (${due.toLocaleString('es-CO')}).`,
      );
    }
    const products = new Map<string, Product>();
    for (const it of items) {
      if (it.productId && !it.stockAlreadyMoved && !products.has(it.productId)) {
        const p = await tx.get<Product>('products', it.productId);
        if (!p) throw new BusinessError(`Producto no encontrado: ${it.description}`);
        products.set(p.id, p);
      }
    }

    // ---------- ESCRITURAS ----------
    writeCounter(tx, 'invoices', number);
    const now = new Date().toISOString();
    const invoice: Omit<Invoice, 'id'> = {
      number,
      customerId: draft.customerId,
      customer: draft.customer,
      items,
      ...totals,
      depositsApplied,
      payments,
      repairOrderId: order?.id,
      repairOrderNumber: order?.number,
      status: usesCredit ? 'credito' : 'pagada',
      cashSessionId: sessionId,
      cashierName: draft.cashierName,
      ...created(actor),
    };
    const invoiceId = tx.create('invoices', invoice as unknown as Record<string, unknown>);

    for (const it of items) {
      const p = it.productId ? products.get(it.productId) : undefined;
      if (p && p.type !== 'SERVICIO') {
        moveStock(tx, actor, p, -it.qty, 'venta', {
          refType: 'invoice',
          refId: invoiceId,
          refNumber: number,
        });
      }
    }

    for (const pay of payments) {
      writeMovement(tx, actor, sessionId, {
        direction: 'ingreso',
        category: 'venta',
        method: pay.method,
        amount: pay.amount,
        description: `Factura ${number} · ${draft.customer.name || 'Consumidor final'}`,
        refType: 'invoice',
        refId: invoiceId,
      });
    }

    if (order) {
      tx.update('repairOrders', order.id, {
        status: 'Entregado',
        deliveredAt: now,
        warrantyUntil: order.warrantyDays > 0 ? addDays(now, order.warrantyDays) : null,
        invoiceId,
        invoiceNumber: number,
        timeline: [
          ...order.timeline,
          { at: now, by: actor.name, status: 'Entregado', note: `Facturada (N.º ${number}) y entregada` },
        ],
        ...touched(),
      });
    }
    return { id: invoiceId, number };
  });
}

/** Anula una factura: devuelve stock, registra egreso en caja y reabre la OT. Nunca borra. */
export async function voidInvoice(actor: Actor, invoiceId: string, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la anulación.');
  return backend.transaction(async (tx) => {
    const inv = await tx.get<Invoice>('invoices', invoiceId);
    if (!inv) throw new BusinessError('Factura no encontrada.');
    if (inv.status === 'anulada') throw new BusinessError('La factura ya está anulada.');
    const sessionId = await requireOpenSession(tx);
    const products = new Map<string, Product>();
    for (const it of inv.items) {
      if (it.productId && !it.stockAlreadyMoved && !products.has(it.productId)) {
        const p = await tx.get<Product>('products', it.productId);
        if (p) products.set(p.id, p);
      }
    }
    const order = inv.repairOrderId ? await tx.get<RepairOrder>('repairOrders', inv.repairOrderId) : null;

    // ---------- ESCRITURAS ----------
    const now = new Date().toISOString();
    tx.update('invoices', inv.id, {
      status: 'anulada',
      voidReason: reason.trim(),
      voidedAt: now,
      voidedBy: actor.name,
      ...touched(),
    });
    for (const it of inv.items) {
      const p = it.productId ? products.get(it.productId) : undefined;
      if (p && p.type !== 'SERVICIO') {
        moveStock(tx, actor, p, it.qty, 'anulacion', { refType: 'invoice', refId: inv.id, refNumber: inv.number });
      }
    }
    for (const pay of inv.payments) {
      writeMovement(tx, actor, sessionId, {
        direction: 'egreso',
        category: 'anulacion',
        method: pay.method,
        amount: pay.amount,
        description: `Anulación factura ${inv.number}: ${reason.trim()}`,
        refType: 'invoice',
        refId: inv.id,
      });
    }
    if (order) {
      tx.update('repairOrders', order.id, {
        status: 'Reparado / Listo',
        invoiceId: null,
        invoiceNumber: null,
        deliveredAt: null,
        warrantyUntil: null,
        timeline: [
          ...order.timeline,
          { at: now, by: actor.name, status: 'Reparado / Listo', note: `Factura ${inv.number} anulada: ${reason}` },
        ],
        ...touched(),
      });
    }
  });
}
