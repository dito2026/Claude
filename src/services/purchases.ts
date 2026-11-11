// Compras a proveedores (contado o crédito) y cuentas por pagar.
// Igual que las hojas «Compras» y «Proveedores» de Digital Cell POS:
// lo comprado a crédito no sale de caja hasta el día en que se abona.
import { backend } from '../data';
import type { PhoneUnit, Product, Purchase, PurchaseItem, Supplier } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { addDays } from '../lib/format';
import { BusinessError, created, readNext, sum, touched, writeCounter, type Actor } from './common';
import { requireOpenSession, writeMovement } from './cash';
import { moveStock } from './inventory';
import { assertImeisFree, cleanUnits, isPhone, writeUnits } from './phones';

export type SupplierInput = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export const purchaseBalance = (p: Pick<Purchase, 'total' | 'paid'> & { status?: Purchase['status'] }) =>
  p.status === 'anulada' ? 0 : Math.max(0, p.total - (p.paid || 0));

export const isOverduePurchase = (p: Purchase) =>
  p.status !== 'pagada' && !!p.dueDate && new Date(p.dueDate).getTime() < Date.now();

/** Resumen por proveedor (como la hoja «Proveedores»). */
export function supplierSummary(s: Supplier, purchases: Purchase[]) {
  const mine = purchases.filter((p) => p.supplierId === s.id && p.status !== 'anulada');
  const credit = sum(mine.filter((p) => p.paymentType === 'credito').map((p) => p.total));
  const cash = sum(mine.filter((p) => p.paymentType === 'contado').map((p) => p.total));
  const paidOnCredit = sum(mine.filter((p) => p.paymentType === 'credito').map((p) => p.paid || 0));
  const owed = sum(mine.map(purchaseBalance));
  const overdue = mine.filter(isOverduePurchase).length;
  return { credit, cash, paidOnCredit, owed, overdue, count: mine.length };
}

const statusFor = (total: number, paid: number): Purchase['status'] =>
  paid >= total ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente';

/** Crea o edita un proveedor. Al crearlo puede registrar un saldo anterior por pagar. */
export async function saveSupplier(actor: Actor, s: SupplierInput, id?: string, openingBalance = 0) {
  const data = { ...s, name: s.name.trim(), nit: s.nit.trim(), phone: s.phone.trim() };
  if (!data.name) throw new BusinessError('El nombre del proveedor es obligatorio.');
  if (id) {
    await backend.update('suppliers', id, { ...data, ...touched() });
    return id;
  }
  return backend.transaction(async (tx) => {
    const number = openingBalance > 0 ? await readNext(tx, 'purchases') : 0;
    const sid = tx.create('suppliers', { ...data, ...created(actor) });
    if (openingBalance > 0) {
      writeCounter(tx, 'purchases', number);
      const p: Omit<Purchase, 'id'> = {
        number,
        kind: 'saldo_inicial',
        supplierId: sid,
        supplierName: data.name,
        items: [],
        total: openingBalance,
        paymentType: 'credito',
        invoiceRef: '',
        dueDate: addDays(new Date().toISOString(), data.termDays || 30),
        paid: 0,
        payments: [],
        status: 'pendiente',
        note: 'Saldo anterior por pagar',
        ...created(actor),
      };
      tx.create('purchases', p as unknown as Record<string, unknown>);
    }
    return sid;
  });
}

export interface PurchaseDraft {
  supplier: Supplier;
  items: PurchaseItem[];
  paymentType: 'contado' | 'credito';
  /** medio con que se paga (solo contado) */
  method: string;
  invoiceRef: string;
  dueDate?: string;
  note: string;
  /** actualizar el costo del producto con el de esta compra */
  updateCost: boolean;
}

/**
 * Registra una compra: suma stock (kardex «compra»), actualiza costos y,
 * si es de contado, saca el dinero de la caja abierta. A crédito queda por pagar.
 */
export async function createPurchase(actor: Actor, d: PurchaseDraft) {
  // Celulares: un IMEI por unidad; la cantidad la dan los IMEI
  const items = d.items
    .map((i) => (i.units ? { ...i, units: cleanUnits(i.units), qty: i.units.length } : i))
    .filter((i) => i.qty > 0);
  const allUnits = items.flatMap((i) => i.units ?? []);
  cleanUnits(allUnits); // IMEI repetidos entre líneas
  if (!d.supplier?.id) throw new BusinessError('Seleccione el proveedor.');
  if (items.length === 0) throw new BusinessError('Agregue al menos un producto a la compra.');
  if (items.some((i) => !i.productId && !i.name.trim())) throw new BusinessError('Escriba la descripción del artículo libre.');
  if (items.some((i) => !Number.isInteger(i.qty) || i.unitCost < 0)) throw new BusinessError('Revise cantidades y costos.');
  if (d.paymentType === 'contado' && d.method === CREDIT_METHOD) throw new BusinessError('Elija con qué medio paga de contado.');
  const total = sum(items.map((i) => i.qty * i.unitCost));

  return backend.transaction(async (tx) => {
    // ---------- LECTURAS ----------
    const number = await readNext(tx, 'purchases');
    const sessionId = d.paymentType === 'contado' && total > 0 ? await requireOpenSession(tx) : null;
    const products = new Map<string, Product>();
    for (const it of items) {
      if (!it.productId) continue; // artículo libre: no está en el inventario
      if (!products.has(it.productId)) {
        const p = await tx.get<Product>('products', it.productId);
        if (!p) throw new BusinessError(`Producto no encontrado: ${it.name}`);
        if (p.type === 'SERVICIO') throw new BusinessError(`«${p.name}» es un servicio: no maneja inventario.`);
        products.set(p.id, p);
      }
      const p = products.get(it.productId)!;
      if (isPhone(p) && !(it.units && it.units.length === it.qty)) {
        throw new BusinessError(`«${p.name}»: escriba el IMEI de cada celular comprado.`);
      }
    }
    await assertImeisFree(tx, allUnits);

    // ---------- ESCRITURAS ----------
    writeCounter(tx, 'purchases', number);
    const now = new Date().toISOString();
    const paid = d.paymentType === 'contado' ? total : 0;
    const purchase: Omit<Purchase, 'id'> = {
      number,
      kind: 'compra',
      supplierId: d.supplier.id,
      supplierName: d.supplier.name,
      items,
      total,
      paymentType: d.paymentType,
      invoiceRef: d.invoiceRef.trim(),
      dueDate: d.paymentType === 'credito' ? d.dueDate || addDays(now, d.supplier.termDays || 30) : undefined,
      paid,
      payments: paid > 0 ? [{ at: now, amount: paid, method: d.method, by: actor.name }] : [],
      status: statusFor(total, paid),
      note: d.note.trim(),
      ...created(actor),
    };
    const pid = tx.create('purchases', purchase as unknown as Record<string, unknown>);

    for (const it of items) {
      const p = it.productId ? products.get(it.productId) : undefined;
      if (!p) continue; // artículo libre: solo queda la deuda/pago, sin inventario
      if (d.updateCost && it.unitCost > 0 && it.unitCost !== p.cost) {
        p.cost = it.unitCost;
        tx.update('products', p.id, { cost: it.unitCost });
      }
      if (it.units?.length) {
        writeUnits(tx, actor, p, it.units, { cost: it.unitCost, supplierName: d.supplier.name, purchaseId: pid, purchaseNumber: number });
      }
      moveStock(tx, actor, p, it.qty, 'compra', {
        refType: 'purchase',
        refId: pid,
        refNumber: number,
        note: `Compra ${number} · ${d.supplier.name}`,
      });
    }

    if (sessionId) {
      writeMovement(tx, actor, sessionId, {
        direction: 'egreso',
        category: 'pago_proveedor',
        method: d.method,
        amount: total,
        description: `Compra de contado ${number} · ${d.supplier.name}`,
        refType: 'purchase',
        refId: pid,
      });
    }
    return { id: pid, number, total };
  });
}

/**
 * Abono a proveedor. Se aplica a las compras indicadas, de la más antigua a la más reciente,
 * y sale de la caja abierta como «Pago a proveedor».
 */
export async function paySupplier(actor: Actor, supplier: Supplier, purchaseIds: string[], amount: number, method: string) {
  if (!(amount > 0)) throw new BusinessError('El abono debe ser mayor que cero.');
  if (method === CREDIT_METHOD) throw new BusinessError('Elija un medio de pago real (efectivo, transferencia…).');
  return backend.transaction(async (tx) => {
    const sid = await requireOpenSession(tx);
    const list: Purchase[] = [];
    for (const id of purchaseIds) {
      const p = await tx.get<Purchase>('purchases', id);
      if (p && p.supplierId === supplier.id && purchaseBalance(p) > 0) list.push(p);
    }
    list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const owed = sum(list.map(purchaseBalance));
    if (owed <= 0) throw new BusinessError('Este proveedor no tiene saldo pendiente.');
    if (amount > owed) throw new BusinessError(`El abono supera la deuda (${owed.toLocaleString('es-CO')}).`);

    // ---------- ESCRITURAS ----------
    const at = new Date().toISOString();
    let left = amount;
    const applied: number[] = [];
    for (const p of list) {
      if (left <= 0) break;
      const part = Math.min(left, purchaseBalance(p));
      left -= part;
      const paid = (p.paid || 0) + part;
      applied.push(p.number);
      tx.update('purchases', p.id, {
        paid,
        payments: [...(p.payments ?? []), { at, amount: part, method, by: actor.name }],
        status: statusFor(p.total, paid),
        ...touched(),
      });
    }
    writeMovement(tx, actor, sid, {
      direction: 'egreso',
      category: 'pago_proveedor',
      method,
      amount,
      description: `Abono a ${supplier.name} (compras ${applied.join(', ')})`,
      refType: 'purchase',
      refId: supplier.id,
    });
    return { applied };
  });
}

/** Compra rápida de un artículo libre (sin inventario) a un proveedor, desde una OT o una venta. */
export async function buyFreeItem(
  actor: Actor,
  supplier: Supplier,
  item: { name: string; qty: number; unitCost: number },
  pay: { paymentType: 'contado' | 'credito'; method: string; note: string },
) {
  if (!(item.unitCost > 0)) throw new BusinessError('Escriba el costo que le cobró el proveedor.');
  return createPurchase(actor, {
    supplier,
    items: [{ productId: '', name: item.name.trim(), qty: item.qty, unitCost: item.unitCost }],
    paymentType: pay.paymentType,
    method: pay.method,
    invoiceRef: '',
    note: pay.note,
    updateCost: false,
  });
}

/** Corrige el proveedor de una compra. La deuda y los abonos pasan con ella al proveedor correcto. */
export async function changePurchaseSupplier(actor: Actor, purchaseId: string, supplierId: string) {
  return backend.transaction(async (tx) => {
    const p = await tx.get<Purchase>('purchases', purchaseId);
    const s = await tx.get<Supplier>('suppliers', supplierId);
    if (!p) throw new BusinessError('Compra no encontrada.');
    if (!s) throw new BusinessError('Proveedor no encontrado.');
    if (p.status === 'anulada') throw new BusinessError('La compra está anulada.');
    if (p.supplierId === s.id) throw new BusinessError('Ese ya es el proveedor de la compra.');
    const units: PhoneUnit[] = [];
    for (const it of p.items) for (const u of it.units ?? []) {
      const unit = await tx.get<PhoneUnit>('phoneUnits', u.imei);
      if (unit && unit.purchaseId === p.id) units.push(unit);
    }
    // ---- escrituras ----
    tx.update('purchases', p.id, {
      supplierId: s.id,
      supplierName: s.name,
      note: [p.note, `Proveedor corregido de ${p.supplierName} a ${s.name} por ${actor.name}`].filter(Boolean).join(' · '),
      ...touched(),
    });
    for (const u of units) tx.update('phoneUnits', u.id, { supplierName: s.name, ...touched() });
  });
}

/**
 * Anula una compra registrada por error: saca del inventario lo que entró (si todavía está),
 * deja los IMEI libres para volver a ingresarlos, quita la deuda y, si se le había pagado algo
 * al proveedor, lo devuelve a la caja abierta. La compra no se borra: queda «Anulada».
 */
export async function voidPurchase(actor: Actor, purchaseId: string, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la anulación.');
  return backend.transaction(async (tx) => {
    const p = await tx.get<Purchase>('purchases', purchaseId);
    if (!p) throw new BusinessError('Compra no encontrada.');
    if (p.status === 'anulada') throw new BusinessError('La compra ya está anulada.');
    const sessionId = (p.paid || 0) > 0 ? await requireOpenSession(tx) : null;
    const products = new Map<string, Product>();
    for (const it of p.items) {
      if (it.productId && !products.has(it.productId)) {
        const prod = await tx.get<Product>('products', it.productId);
        if (prod) products.set(prod.id, prod);
      }
    }
    const units: PhoneUnit[] = [];
    for (const it of p.items) for (const u of it.units ?? []) {
      const unit = await tx.get<PhoneUnit>('phoneUnits', u.imei);
      if (!unit || unit.purchaseId !== p.id) continue;
      if (unit.status === 'vendido') {
        throw new BusinessError(`El celular IMEI ${unit.imei} ya se vendió (factura ${unit.invoiceNumber}). Anule primero esa venta.`);
      }
      units.push(unit);
    }

    // ---------- ESCRITURAS ----------
    const at = new Date().toISOString();
    for (const it of p.items) {
      const prod = it.productId ? products.get(it.productId) : undefined;
      if (!prod) continue; // artículo libre: no tocó inventario
      try {
        moveStock(tx, actor, prod, -it.qty, 'anulacion_compra', { refType: 'purchase', refId: p.id, refNumber: p.number, note: `Anulación compra ${p.number}` });
      } catch {
        throw new BusinessError(`No hay suficiente «${prod.name}» en inventario para devolver (${it.qty}). Puede que ya se haya vendido o usado.`);
      }
    }
    for (const u of units) tx.update('phoneUnits', u.id, { status: 'anulado', ...touched() });
    if (sessionId) {
      // Reintegro: lo pagado vuelve a la caja por el mismo medio
      const byMethod = new Map<string, number>();
      for (const pay of p.payments ?? []) byMethod.set(pay.method, (byMethod.get(pay.method) ?? 0) + pay.amount);
      for (const [method, amount] of byMethod) {
        writeMovement(tx, actor, sessionId, {
          direction: 'ingreso', category: 'pago_proveedor', method, amount,
          description: `Reintegro por anulación de compra C-${String(p.number).padStart(4, '0')} · ${p.supplierName}`,
          refType: 'purchase', refId: p.id,
        });
      }
    }
    tx.update('purchases', p.id, { status: 'anulada', voidReason: reason.trim(), voidedAt: at, voidedBy: actor.name, ...touched() });
  });
}

/**
 * Corrige (o elimina, con valor 0) un pago hecho a un proveedor en una compra.
 * La caja abierta se cuadra sola: si el pago baja o cambia de medio, el dinero vuelve a la caja
 * (reintegro de «Pago a proveedor», resta de los egresos); si sube, sale la diferencia.
 * El saldo y el estado de la compra se recalculan, y queda el historial.
 */
export async function editSupplierPayment(actor: Actor, purchaseId: string, index: number, next: { amount: number; method: string }, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la corrección.');
  if (next.amount < 0) throw new BusinessError('El valor no puede ser negativo.');
  if (next.amount > 0 && (!next.method || next.method === CREDIT_METHOD)) throw new BusinessError('Elija el medio de pago.');
  return backend.transaction(async (tx) => {
    const p = await tx.get<Purchase>('purchases', purchaseId);
    if (!p) throw new BusinessError('Compra no encontrada.');
    if (p.status === 'anulada') throw new BusinessError('La compra está anulada.');
    const pay = (p.payments ?? [])[index];
    if (!pay) throw new BusinessError('Pago no encontrado.');
    if (pay.amount === next.amount && pay.method === next.method) throw new BusinessError('No hay cambios para guardar.');
    const paid = (p.paid || 0) - pay.amount + next.amount;
    if (paid > p.total) throw new BusinessError(`Con ese valor se le pagaría más que el total de la compra (${p.total.toLocaleString('es-CO')}).`);
    const sid = await requireOpenSession(tx);
    // ---------- ESCRITURAS ----------
    const why = reason.trim();
    const desc = `Corrección pago compra ${p.number} · ${p.supplierName}: ${why}`;
    const back = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'ingreso', category: 'pago_proveedor', method, amount, description: desc, refType: 'purchase', refId: p.id });
    const out = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'egreso', category: 'pago_proveedor', method, amount, description: desc, refType: 'purchase', refId: p.id });
    if (pay.method === next.method) {
      const diff = next.amount - pay.amount;
      if (diff > 0) out(diff, pay.method); else back(-diff, pay.method);
    } else {
      back(pay.amount, pay.method);
      if (next.amount > 0) out(next.amount, next.method);
    }
    const at = new Date().toISOString();
    const payments = next.amount === 0
      ? p.payments.filter((_, i) => i !== index)
      : p.payments.map((x, i) => (i === index
        ? { ...x, amount: next.amount, method: next.method, editedAt: at, editedBy: actor.name, editReason: why, previous: { amount: pay.amount, method: pay.method } }
        : x));
    tx.update('purchases', p.id, { paid, payments, status: statusFor(p.total, paid), ...touched() });
  });
}
