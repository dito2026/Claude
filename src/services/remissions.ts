// Remisiones: mercancía entregada en consignación a otro local o vendedor.
// Al remisionar sale del inventario («remisión»). Después, por cada línea:
//  - lo devuelto vuelve al inventario («devolución de remisión»);
//  - lo vendido se factura (la factura no vuelve a descontar stock: stockAlreadyMoved).
import { backend, type Tx } from '../data';
import type { CustomerRef, Invoice, InvoiceItem, PhoneUnit, Product, Remission, RemissionItem } from '../lib/types';
import { BusinessError, created, readNext, sum, touched, writeCounter, type Actor } from './common';
import { moveStock, tracksStock } from './inventory';
import { isPhone } from './phones';

export const pendingQty = (it: Pick<RemissionItem, 'qty' | 'sold' | 'returned'>) => it.qty - it.sold - it.returned;
export const remissionPending = (r: Pick<Remission, 'items'>) => sum(r.items.map(pendingQty));
export const remissionPendingValue = (r: Pick<Remission, 'items'>) => sum(r.items.map((i) => pendingQty(i) * i.unitPrice));
export const remissionSoldValue = (r: Pick<Remission, 'items'>) => sum(r.items.map((i) => i.sold * i.unitPrice));

export interface RemissionLineDraft {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  unitId?: string;
}

export interface RemissionDraft {
  customerId?: string;
  recipient: CustomerRef & { address?: string };
  items: RemissionLineDraft[];
  note: string;
  dueDate?: string;
}

const newLineId = () => Math.random().toString(36).slice(2, 10);

export async function createRemission(actor: Actor, d: RemissionDraft) {
  if (!d.recipient.name.trim()) throw new BusinessError('Escriba a quién se le entrega la mercancía.');
  const lines = d.items.filter((i) => i.qty > 0);
  if (lines.length === 0) throw new BusinessError('Agregue al menos un producto.');
  if (lines.some((i) => !Number.isInteger(i.qty) || i.unitPrice < 0)) throw new BusinessError('Revise cantidades y precios.');
  const ids = lines.filter((i) => i.unitId).map((i) => i.unitId!);
  if (new Set(ids).size !== ids.length) throw new BusinessError('Hay un IMEI repetido en la remisión.');

  return backend.transaction(async (tx) => {
    // ---------- LECTURAS ----------
    const number = await readNext(tx, 'remissions');
    const products = new Map<string, Product>();
    for (const it of lines) {
      if (products.has(it.productId)) continue;
      const p = await tx.get<Product>('products', it.productId);
      if (!p) throw new BusinessError(`Producto no encontrado: ${it.name}`);
      if (!tracksStock(p)) throw new BusinessError(`«${p.name}» no controla inventario: no se puede remisionar.`);
      products.set(p.id, p);
    }
    const units = new Map<string, PhoneUnit>();
    for (const it of lines) {
      const p = products.get(it.productId)!;
      if (isPhone(p) && !it.unitId) throw new BusinessError(`«${p.name}»: escoja el IMEI de cada celular.`);
      if (!it.unitId) continue;
      if (it.qty !== 1) throw new BusinessError('Cada celular (IMEI) va en una línea con cantidad 1.');
      const u = await tx.get<PhoneUnit>('phoneUnits', it.unitId);
      if (!u || u.productId !== p.id) throw new BusinessError(`El IMEI ${it.unitId} no corresponde a «${p.name}».`);
      if (u.status !== 'disponible') throw new BusinessError(`El IMEI ${u.imei} no está disponible (${u.status}).`);
      units.set(u.id, u);
    }
    // stock suficiente por producto (sumando líneas)
    const need = new Map<string, number>();
    for (const it of lines) need.set(it.productId, (need.get(it.productId) ?? 0) + it.qty);
    for (const [pid, q] of need) {
      const p = products.get(pid)!;
      if ((Number(p.stock) || 0) < q) throw new BusinessError(`Stock insuficiente de «${p.name}»: hay ${p.stock}, se remisionan ${q}.`);
    }

    // ---------- ESCRITURAS ----------
    writeCounter(tx, 'remissions', number);
    const items: RemissionItem[] = lines.map((it) => {
      const p = products.get(it.productId)!;
      const u = it.unitId ? units.get(it.unitId) : undefined;
      return {
        lineId: newLineId(), productId: p.id, name: it.name.trim() || p.name, qty: it.qty, unitPrice: it.unitPrice,
        unitCost: u ? u.cost : p.cost || 0, ...(u ? { unitId: u.id, imei: u.imei } : {}), sold: 0, returned: 0,
      };
    });
    const doc: Omit<Remission, 'id'> = {
      number,
      ...(d.customerId ? { customerId: d.customerId } : {}),
      recipient: { name: d.recipient.name.trim(), phone: d.recipient.phone.trim(), document: d.recipient.document.trim(), address: (d.recipient.address ?? '').trim() },
      items,
      status: 'abierta',
      note: d.note.trim(),
      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
      createdByName: actor.name,
      invoices: [],
      returns: [],
      ...created(actor),
    };
    const id = tx.create('remissions', doc as unknown as Record<string, unknown>);
    for (const it of items) {
      moveStock(tx, actor, products.get(it.productId)!, -it.qty, 'remision', {
        refType: 'remission', refId: id, refNumber: number, note: `Remisión R-${number} · ${doc.recipient.name}`,
      });
      if (it.unitId) {
        tx.update('phoneUnits', it.unitId, { status: 'remisionado', remissionId: id, remissionNumber: number, remissionTo: doc.recipient.name, ...touched() });
      }
    }
    return { ...doc, id } as Remission;
  });
}

/** Registra lo que devolvieron: vuelve al inventario y los celulares quedan disponibles. */
export async function returnRemission(actor: Actor, remissionId: string, lines: { lineId: string; qty: number }[]) {
  const ret = lines.filter((l) => l.qty > 0);
  if (ret.length === 0) throw new BusinessError('Indique qué devolvieron.');
  return backend.transaction(async (tx) => {
    const r = await tx.get<Remission>('remissions', remissionId);
    if (!r) throw new BusinessError('Remisión no encontrada.');
    const products = new Map<string, Product>();
    for (const l of ret) {
      const it = r.items.find((x) => x.lineId === l.lineId);
      if (!it) throw new BusinessError('Línea de remisión no encontrada.');
      if (!Number.isInteger(l.qty) || l.qty > pendingQty(it)) throw new BusinessError(`«${it.name}»: solo quedan ${pendingQty(it)} por liquidar.`);
      if (!products.has(it.productId)) {
        const p = await tx.get<Product>('products', it.productId);
        if (!p) throw new BusinessError(`Producto no encontrado: ${it.name}`);
        products.set(p.id, p);
      }
    }
    // ---------- ESCRITURAS ----------
    const items = r.items.map((it) => {
      const l = ret.find((x) => x.lineId === it.lineId);
      return l ? { ...it, returned: it.returned + l.qty } : it;
    });
    for (const l of ret) {
      const it = r.items.find((x) => x.lineId === l.lineId)!;
      moveStock(tx, actor, products.get(it.productId)!, l.qty, 'devolucion_remision', {
        refType: 'remission', refId: r.id, refNumber: r.number, note: `Devolución remisión R-${r.number} · ${r.recipient.name}`,
      });
      if (it.unitId) tx.update('phoneUnits', it.unitId, { status: 'disponible', remissionId: null, remissionNumber: null, remissionTo: null, ...touched() });
    }
    const now = new Date().toISOString();
    tx.update('remissions', r.id, {
      items,
      returns: [...(r.returns ?? []), { at: now, by: actor.name, lines: ret }],
      status: items.every((i) => pendingQty(i) === 0) ? 'liquidada' : 'abierta',
      ...touched(),
    });
  });
}

/** Líneas de factura para lo vendido de una remisión (el stock ya salió al remisionar). */
export function invoiceItemsFromRemission(r: Remission, sold: { lineId: string; qty: number }[]): InvoiceItem[] {
  return sold.filter((s) => s.qty > 0).map((s) => {
    const it = r.items.find((x) => x.lineId === s.lineId)!;
    return {
      productId: it.productId, description: it.name, kind: 'producto', qty: s.qty, unitPrice: it.unitPrice, unitCost: it.unitCost,
      ...(it.unitId ? { unitId: it.unitId, imei: it.imei } : {}), stockAlreadyMoved: true, remissionLineId: it.lineId,
    } as InvoiceItem;
  });
}

/** Lecturas y validación dentro de la factura: la remisión, que cada línea tenga pendiente y sus celulares. */
export async function readRemissionForInvoice(
  tx: Tx,
  remissionId: string,
  items: InvoiceItem[],
) {
  const r = await tx.get<Remission>('remissions', remissionId);
  if (!r) throw new BusinessError('Remisión no encontrada.');
  for (const it of items) {
    const line = r.items.find((x) => x.lineId === it.remissionLineId);
    if (!line) throw new BusinessError(`«${it.description}» no está en la remisión R-${r.number}.`);
    if (it.qty > pendingQty(line)) throw new BusinessError(`«${line.name}»: solo quedan ${pendingQty(line)} por liquidar.`);
  }
  return r;
}

/** Escrituras dentro de la factura: suma lo vendido y guarda la factura en la remisión. */
export function writeRemissionSale(tx: Tx, r: Remission, items: InvoiceItem[], inv: Pick<Invoice, 'number' | 'total'> & { id: string }) {
  const updated = r.items.map((line) => {
    const q = sum(items.filter((i) => i.remissionLineId === line.lineId).map((i) => i.qty));
    return q ? { ...line, sold: line.sold + q } : line;
  });
  tx.update('remissions', r.id, {
    items: updated,
    invoices: [...(r.invoices ?? []), { id: inv.id, number: inv.number, at: new Date().toISOString(), total: inv.total }],
    status: updated.every((i) => pendingQty(i) === 0) ? 'liquidada' : 'abierta',
    ...touched(),
  });
}

/** Al anular una factura de remisión: lo vendido vuelve a quedar pendiente con el destinatario. */
export function revertRemissionSale(tx: Tx, r: Remission, inv: Invoice) {
  const updated = r.items.map((line) => {
    const q = sum(inv.items.filter((i) => i.remissionLineId === line.lineId).map((i) => i.qty));
    return q ? { ...line, sold: Math.max(0, line.sold - q) } : line;
  });
  tx.update('remissions', r.id, { items: updated, status: 'abierta', ...touched() });
}
