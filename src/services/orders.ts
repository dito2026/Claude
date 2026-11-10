import { backend, uid } from '../data';
import type {
  Customer,
  CustomerRef,
  Device,
  OrderStatus,
  Priority,
  Product,
  RepairOrder,
} from '../lib/types';
import { BusinessError, created, readNext, sum, touched, writeCounter, type Actor } from './common';
import { requireOpenSession, writeMovement } from './cash';
import { CREDIT_METHOD } from '../lib/types';
import { moveStock } from './inventory';

export const partsTotal = (o: Pick<RepairOrder, 'parts'>) => sum(o.parts.map((p) => p.qty * p.unitPrice));
export const orderTotal = (o: Pick<RepairOrder, 'parts' | 'laborPrice'>) => (o.laborPrice || 0) + partsTotal(o);
export const depositsTotal = (o: Pick<RepairOrder, 'deposits'>) => sum(o.deposits.map((d) => d.amount));
export const orderBalance = (o: RepairOrder) => orderTotal(o) - depositsTotal(o);

export const isOverdue = (o: RepairOrder) =>
  !!o.promisedAt &&
  o.status !== 'Entregado' &&
  o.status !== 'No reparado' &&
  new Date(o.promisedAt).getTime() < Date.now();

export const customerRef = (c: Customer): CustomerRef => ({
  name: c.name,
  phone: c.phone,
  document: c.document,
  email: c.email,
});

export interface NewOrderInput {
  customer: Customer;
  device: Device;
  reportedIssue: string;
  technicianId: string;
  technicianName: string;
  technicianUserId: string;
  priority: Priority;
  promisedAt: string;
  budget: number;
  laborPrice: number;
  technicianPay: number;
  warrantyDays: number;
  intakeDeposit?: { amount: number; method: string };
}

export async function createOrder(actor: Actor, input: NewOrderInput) {
  if (!input.customer?.id) throw new BusinessError('Seleccione el cliente.');
  if (!input.device.brand.trim() || !input.device.model.trim()) {
    throw new BusinessError('Marca y modelo del equipo son obligatorios.');
  }
  if (!input.reportedIssue.trim()) throw new BusinessError('Describa la falla reportada.');

  return backend.transaction(async (tx) => {
    const number = await readNext(tx, 'orders');
    const dep = input.intakeDeposit;
    const sessionId = dep && dep.amount > 0 ? await requireOpenSession(tx) : null;
    // ---- escrituras ----
    writeCounter(tx, 'orders', number);
    const at = new Date().toISOString();
    const order: Omit<RepairOrder, 'id'> = {
      number,
      customerId: input.customer.id,
      customer: customerRef(input.customer),
      device: input.device,
      reportedIssue: input.reportedIssue.trim(),
      diagnosis: '',
      technicianId: input.technicianId,
      technicianName: input.technicianName,
      technicianUserId: input.technicianUserId,
      status: 'Recibido',
      priority: input.priority,
      promisedAt: input.promisedAt,
      budget: input.budget || 0,
      laborPrice: input.laborPrice || 0,
      technicianPay: input.technicianPay || 0,
      parts: [],
      deposits: dep && dep.amount > 0 ? [{ amount: dep.amount, method: dep.method, at }] : [],
      warrantyDays: input.warrantyDays,
      timeline: [{ at, by: actor.name, status: 'Recibido', note: 'Equipo recibido en el taller' }],
      ...created(actor),
    };
    const id = tx.create('repairOrders', order as unknown as Record<string, unknown>);
    if (sessionId && dep) {
      writeMovement(tx, actor, sessionId, {
        direction: 'ingreso',
        category: 'abono_cliente',
        method: dep.method,
        amount: dep.amount,
        description: `Abono OT ${number} · ${input.customer.name}`,
        refType: 'repairOrder',
        refId: id,
      });
    }
    return { id, number };
  });
}

export type OrderPatch = Partial<
  Pick<
    RepairOrder,
    | 'device'
    | 'reportedIssue'
    | 'diagnosis'
    | 'technicianId'
    | 'technicianName'
    | 'technicianUserId'
    | 'priority'
    | 'promisedAt'
    | 'budget'
    | 'laborPrice'
    | 'technicianPay'
    | 'warrantyDays'
  >
>;

export async function updateOrder(actor: Actor, id: string, patch: OrderPatch, note?: string) {
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', id);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (o.status === 'Entregado') throw new BusinessError('La orden ya fue entregada y facturada.');
    const timeline = note ? [...o.timeline, { at: new Date().toISOString(), by: actor.name, note }] : o.timeline;
    tx.update('repairOrders', id, { ...patch, timeline, ...touched() });
  });
}

export async function setStatus(actor: Actor, id: string, status: OrderStatus, note = '') {
  if (status === 'Entregado') {
    throw new BusinessError('Para entregar, use «Facturar y entregar» (cobra y aplica la garantía).');
  }
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', id);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (o.status === 'Entregado') throw new BusinessError('La orden ya fue entregada.');
    const entry = { at: new Date().toISOString(), by: actor.name, status, note: note || `Estado: ${status}` };
    const extra = status === 'No reparado' ? { deliveredAt: entry.at } : {};
    tx.update('repairOrders', id, { status, timeline: [...o.timeline, entry], ...extra, ...touched() });
  });
}

/** Agrega un repuesto: descuenta inventario y registra kardex en la MISMA transacción. */
export async function addPart(actor: Actor, orderId: string, productId: string, qty: number, unitPrice?: number) {
  if (!(qty > 0) || !Number.isInteger(qty)) throw new BusinessError('Cantidad inválida.');
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', orderId);
    const p = await tx.get<Product>('products', productId);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (!p) throw new BusinessError('Producto no encontrado.');
    if (o.status === 'Entregado' || o.status === 'No reparado') {
      throw new BusinessError('La orden está cerrada.');
    }
    if (p.type === 'SERVICIO') throw new BusinessError('Los servicios no se agregan como repuesto.');
    if (p.type === 'EQUIPO') throw new BusinessError('Los celulares se venden por IMEI en Facturación, no como repuesto.');
    // ---- escrituras ----
    moveStock(tx, actor, p, -qty, 'reparacion', {
      refType: 'repairOrder',
      refId: o.id,
      refNumber: o.number,
      note: `OT ${o.number}`,
    });
    const part = {
      lineId: uid('pt'),
      productId: p.id,
      name: p.name,
      qty,
      unitCost: p.cost,
      unitPrice: unitPrice ?? p.price,
    };
    const timeline = [
      ...o.timeline,
      { at: new Date().toISOString(), by: actor.name, note: `Repuesto agregado: ${qty} × ${p.name}` },
    ];
    tx.update('repairOrders', o.id, { parts: [...o.parts, part], timeline, ...touched() });
  });
}

/** Repuesto o accesorio libre (no está en el catálogo): no toca inventario. */
export async function addFreePart(
  actor: Actor,
  orderId: string,
  item: { name: string; qty: number; unitCost: number; unitPrice: number; purchaseNumber?: number; supplierName?: string },
) {
  if (!item.name.trim()) throw new BusinessError('Escriba la descripción del repuesto.');
  if (!(item.qty > 0) || !Number.isInteger(item.qty)) throw new BusinessError('Cantidad inválida.');
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', orderId);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (o.status === 'Entregado' || o.status === 'No reparado') throw new BusinessError('La orden está cerrada.');
    const part = {
      lineId: uid('pt'),
      productId: '',
      name: item.name.trim(),
      qty: item.qty,
      unitCost: Math.max(0, item.unitCost || 0),
      unitPrice: Math.max(0, item.unitPrice || 0),
      purchaseNumber: item.purchaseNumber,
      supplierName: item.supplierName,
    };
    const timeline = [
      ...o.timeline,
      { at: new Date().toISOString(), by: actor.name, note: `Repuesto sin inventario: ${item.qty} × ${part.name}` },
    ];
    tx.update('repairOrders', o.id, { parts: [...o.parts, part], timeline, ...touched() });
  });
}

/** Quita un repuesto de la OT y lo devuelve al inventario. */
export async function removePart(actor: Actor, orderId: string, lineId: string) {
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', orderId);
    if (!o) throw new BusinessError('Orden no encontrada.');
    const part = o.parts.find((x) => x.lineId === lineId);
    if (!part) throw new BusinessError('Repuesto no encontrado en la orden.');
    if (o.status === 'Entregado') throw new BusinessError('La orden ya fue facturada.');
    const p = part.productId ? await tx.get<Product>('products', part.productId) : null;
    // ---- escrituras ----
    if (p) {
      moveStock(tx, actor, p, part.qty, 'devolucion_reparacion', {
        refType: 'repairOrder',
        refId: o.id,
        refNumber: o.number,
        note: `Devuelto de OT ${o.number}`,
      });
    }
    const timeline = [
      ...o.timeline,
      { at: new Date().toISOString(), by: actor.name, note: `Repuesto retirado: ${part.qty} × ${part.name}` },
    ];
    tx.update('repairOrders', o.id, {
      parts: o.parts.filter((x) => x.lineId !== lineId),
      timeline,
      ...touched(),
    });
  });
}

export async function addDeposit(actor: Actor, orderId: string, amount: number, method: string) {
  if (!(amount > 0)) throw new BusinessError('El abono debe ser mayor que cero.');
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', orderId);
    const sid = await requireOpenSession(tx);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (o.status === 'Entregado') throw new BusinessError('La orden ya fue facturada.');
    const at = new Date().toISOString();
    tx.update('repairOrders', o.id, {
      deposits: [...o.deposits, { amount, method, at }],
      timeline: [...o.timeline, { at, by: actor.name, note: `Abono recibido (${method})` }],
      ...touched(),
    });
    writeMovement(tx, actor, sid, {
      direction: 'ingreso',
      category: 'abono_cliente',
      method,
      amount,
      description: `Abono OT ${o.number} · ${o.customer.name}`,
      refType: 'repairOrder',
      refId: o.id,
    });
  });
}

/**
 * Corrige (o elimina, con valor 0) un abono de una orden. La caja se cuadra sola en el turno abierto:
 * si baja el valor o cambia el medio, sale como «Anulación» (resta del ingreso);
 * si sube, entra la diferencia como «Abono de cliente». Queda el historial en la orden.
 */
export async function editDeposit(actor: Actor, orderId: string, index: number, next: { amount: number; method: string }, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la corrección.');
  if (next.amount < 0) throw new BusinessError('El valor no puede ser negativo.');
  if (next.amount > 0 && (!next.method || next.method === CREDIT_METHOD)) throw new BusinessError('Elija el medio de pago.');
  return backend.transaction(async (tx) => {
    const o = await tx.get<RepairOrder>('repairOrders', orderId);
    if (!o) throw new BusinessError('Orden no encontrada.');
    if (o.status === 'Entregado' || o.invoiceId) throw new BusinessError('La orden ya fue facturada: anule primero la factura para corregir sus abonos.');
    const d = o.deposits[index];
    if (!d) throw new BusinessError('Abono no encontrado.');
    if (d.amount === next.amount && d.method === next.method) throw new BusinessError('No hay cambios para guardar.');
    const sid = await requireOpenSession(tx);
    // ---- escrituras ----
    const why = reason.trim();
    const desc = `Corrección abono OT ${o.number} · ${o.customer.name}: ${why}`;
    const out = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'egreso', category: 'anulacion', method, amount, description: desc, refType: 'repairOrder', refId: o.id });
    const inn = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'ingreso', category: 'abono_cliente', method, amount, description: desc, refType: 'repairOrder', refId: o.id });
    if (d.method === next.method) {
      const diff = next.amount - d.amount;
      if (diff > 0) inn(diff, d.method); else out(-diff, d.method);
    } else {
      out(d.amount, d.method);
      if (next.amount > 0) inn(next.amount, next.method);
    }
    const at = new Date().toISOString();
    const deposits = next.amount === 0
      ? o.deposits.filter((_, i) => i !== index)
      : o.deposits.map((x, i) => (i === index ? { amount: next.amount, method: next.method, at: x.at, editedAt: at, editedBy: actor.name, editReason: why, previous: { amount: d.amount, method: d.method } } : x));
    const fmt = (n: number) => `$${n.toLocaleString('es-CO')}`;
    tx.update('repairOrders', o.id, {
      deposits,
      timeline: [...o.timeline, { at, by: actor.name, note: next.amount === 0
        ? `Abono eliminado (${fmt(d.amount)} ${d.method}): ${why}`
        : `Abono corregido de ${fmt(d.amount)} ${d.method} a ${fmt(next.amount)} ${next.method}: ${why}` }],
      ...touched(),
    });
  });
}
