import { backend, type Tx } from '../data';
import type { CustomerRef, Invoice, InvoiceItem, Payment, PhoneUnit, Product, Purchase, RepairOrder, Seller, Supplier } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { addDays } from '../lib/format';
import { BusinessError, created, readNext, sum, touched, writeCounter, type Actor } from './common';
import { requireOpenSession, writeMovement } from './cash';
import { moveStock } from './inventory';
import { depositsTotal } from './orders';
import { addMonths, isPhone, markAvailable, markSold } from './phones';
import { computeCommission, hasCategoryRates } from './sellers';
import { lineOf, type Line } from './accounting';
import { readRemissionForInvoice, revertRemissionSale, writeRemissionSale } from './remissions';
import type { Remission } from '../lib/types';

export interface InvoiceDraft {
  customerId?: string;
  customer: CustomerRef;
  items: InvoiceItem[];
  discount: number;
  taxRate: number;
  payments: Payment[];
  repairOrderId?: string;
  cashierName: string;
  /** vendedor que gana comisión por esta venta */
  sellerId?: string;
  /** venta de mercancía remisionada (consignación) */
  remissionId?: string;
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
  const gifts = items.filter((i) => i.gift);
  if (gifts.some((i) => !(i.unitCost > 0) || !i.gift!.supplierId)) throw new BusinessError('En lo encimado escriba el precio y el proveedor.');
  if (gifts.some((i) => i.unitPrice !== 0)) throw new BusinessError('Lo encimado va sin cobro al cliente (precio $0).');
  const totals = computeTotals(items, draft.discount, draft.taxRate);
  const payments = draft.payments.filter((p) => p.amount > 0);
  if (payments.some((p) => !p.method?.trim())) throw new BusinessError('Elija el medio de pago (efectivo, transferencia, Nequi…).');
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
    let seller: Seller | null = null;
    if (draft.sellerId) {
      seller = await tx.get<Seller>('sellers', draft.sellerId);
      if (!seller || !seller.active) throw new BusinessError('El vendedor seleccionado no existe o está inactivo.');
      // para clasificar líneas de negocio se necesitan todos los productos de la venta
      for (const it of items) {
        if (it.productId && !products.has(it.productId)) {
          const p = await tx.get<Product>('products', it.productId);
          if (p) products.set(p.id, p);
        }
      }
    }
    // Remisión: cada línea debe salir de la remisión y tener pendiente
    let remission: Remission | null = null;
    if (draft.remissionId) {
      const fromRemission = items.filter((i) => !i.gift);
      if (fromRemission.some((i) => !i.remissionLineId || !i.stockAlreadyMoved)) throw new BusinessError('Todas las líneas deben salir de la remisión.');
      remission = await readRemissionForInvoice(tx, draft.remissionId, fromRemission);
    } else if (items.some((i) => i.remissionLineId)) {
      throw new BusinessError('Línea de remisión sin remisión.');
    }
    // Celulares: solo con IMEI de inventario, una unidad por línea, disponible y del mismo modelo
    const units = new Map<string, PhoneUnit>();
    for (const it of items) {
      const p = it.productId ? products.get(it.productId) : undefined;
      if (p && isPhone(p) && !it.unitId) {
        throw new BusinessError(`«${p.name}»: los celulares se venden escogiendo el IMEI del inventario.`);
      }
      if (!it.unitId) continue;
      if (units.has(it.unitId)) throw new BusinessError(`El IMEI ${it.unitId} está dos veces en la venta.`);
      if (it.qty !== 1) throw new BusinessError('Cada celular (IMEI) se vende en una línea con cantidad 1.');
      const u = await tx.get<PhoneUnit>('phoneUnits', it.unitId);
      if (!u) throw new BusinessError(`El IMEI ${it.unitId} no está en el inventario.`);
      const fromRemission = !!remission && u.status === 'remisionado' && u.remissionId === remission.id;
      if (u.status !== 'disponible' && !fromRemission) {
        throw new BusinessError(u.status === 'remisionado' ? `El IMEI ${u.imei} está remisionado (R-${u.remissionNumber}): véndalo desde la remisión.` : `El IMEI ${u.imei} ya fue vendido (factura ${u.invoiceNumber}).`);
      }
      if (u.productId !== it.productId) throw new BusinessError(`El IMEI ${u.imei} no corresponde a «${it.description}».`);
      units.set(u.id, u);
    }

    // Encimados: proveedor y consecutivo de compras (una compra a crédito por proveedor)
    const giftSuppliers = new Map<string, Supplier>();
    for (const it of gifts) {
      const sid = it.gift!.supplierId;
      if (giftSuppliers.has(sid)) continue;
      const s = await tx.get<Supplier>('suppliers', sid);
      if (!s) throw new BusinessError(`Proveedor no encontrado para «${it.description}».`);
      giftSuppliers.set(sid, { ...s, id: sid });
    }
    let purchaseNumber = giftSuppliers.size ? await readNext(tx, 'purchases') - 1 : 0;

    // ---------- ESCRITURAS ----------
    writeCounter(tx, 'invoices', number);
    const now = new Date().toISOString();
    const giftPurchase = new Map<string, { id: string; number: number }>();
    for (const [sid, s] of giftSuppliers) {
      const lines = gifts.filter((i) => i.gift!.supplierId === sid);
      const total = sum(lines.map((i) => i.qty * i.unitCost));
      purchaseNumber += 1;
      const doc: Omit<Purchase, 'id'> = {
        number: purchaseNumber, kind: 'compra', supplierId: sid, supplierName: s.name,
        items: lines.map((i) => ({ productId: '', name: i.description, qty: i.qty, unitCost: i.unitCost })),
        total, paymentType: 'credito', invoiceRef: '', dueDate: addDays(now, s.termDays || 30),
        paid: 0, payments: [], status: 'pendiente',
        note: `Encimado en la factura ${number} · ${draft.customer.name || 'Consumidor final'}`,
        ...created(actor),
      };
      giftPurchase.set(sid, { id: tx.create('purchases', doc), number: purchaseNumber });
    }
    if (giftSuppliers.size) writeCounter(tx, 'purchases', purchaseNumber);
    // Celulares: la garantía (meses y vencimiento) queda escrita en la línea del comprobante
    // Línea de negocio de lo encimado: la de la venta que acompaña (la que más vendió en esta factura)
    let giftLine: Line = 'Accesorios';
    if (gifts.length) {
      const byLine = new Map<Line, number>();
      for (const it of items) if (!it.gift) { const l = lineOf(it, products); byLine.set(l, (byLine.get(l) ?? 0) + it.qty * it.unitPrice); }
      giftLine = [...byLine.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Accesorios';
    }
    const saleItems = items.map((it) => {
      if (it.gift) {
        const s = giftSuppliers.get(it.gift.supplierId)!;
        const gp = giftPurchase.get(it.gift.supplierId)!;
        return { ...it, gift: { supplierId: s.id, supplierName: s.name, purchaseId: gp.id, purchaseNumber: gp.number, line: giftLine } };
      }
      const u = it.unitId ? units.get(it.unitId) : undefined;
      if (!u) return it;
      const months = Math.max(0, Math.round(it.warrantyMonths ?? u.warrantyMonths ?? 0));
      return { ...it, warrantyMonths: months, ...(months > 0 ? { warrantyUntil: addMonths(now, months) } : {}) };
    });
    const invoice: Omit<Invoice, 'id'> = {
      number,
      customerId: draft.customerId,
      customer: draft.customer,
      items: saleItems,
      ...totals,
      depositsApplied,
      payments,
      repairOrderId: order?.id,
      repairOrderNumber: order?.number,
      ...(remission ? { remissionId: remission.id, remissionNumber: remission.number } : {}),
      status: usesCredit ? 'credito' : 'pagada',
      cashSessionId: sessionId,
      cashierName: draft.cashierName,
      ...(seller
        ? {
            sellerId: seller.id,
            sellerName: seller.name,
            commissionPct: seller.commissionPct,
            commissionBase: seller.commissionBase,
            ...(hasCategoryRates(seller) ? { commissionRates: seller.categoryRates } : {}),
            commission: computeCommission(seller, items, totals.discount, products),
          }
        : {}),
      ...created(actor),
    };
    const invoiceId = tx.create('invoices', invoice);
    if (remission) writeRemissionSale(tx, remission, items, { id: invoiceId, number, total: totals.total });

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

    // Producto o celular sin costo al que se le escribió el costo en la venta: queda guardado para las próximas
    const costSet = new Set<string>();
    for (const it of items) {
      if (it.unitCost <= 0) continue;
      const u = it.unitId ? units.get(it.unitId) : undefined;
      if (u) {
        if (!(u.cost > 0)) tx.update('phoneUnits', u.id, { cost: it.unitCost, ...touched() });
        continue;
      }
      const p = it.productId ? products.get(it.productId) : undefined;
      if (p && !(p.cost > 0) && !it.stockAlreadyMoved && !costSet.has(p.id)) {
        costSet.add(p.id);
        tx.update('products', p.id, { cost: it.unitCost, ...touched() });
      }
    }

    for (const it of items) {
      const u = it.unitId ? units.get(it.unitId) : undefined;
      if (u) {
        markSold(tx, u, {
          invoiceId, invoiceNumber: number, at: now,
          price: it.unitPrice, customerName: draft.customer.name || 'Consumidor final',
          warrantyMonths: saleItems.find((x) => x.unitId === u.id)?.warrantyMonths,
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
    const remission = inv.remissionId ? await tx.get<Remission>('remissions', inv.remissionId) : null;
    const soldUnits: PhoneUnit[] = [];
    for (const it of inv.items) {
      if (!it.unitId) continue;
      const u = await tx.get<PhoneUnit>('phoneUnits', it.unitId);
      if (u && u.invoiceId === inv.id) soldUnits.push(u);
    }

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
    for (const u of soldUnits) {
      // vendido desde una remisión: vuelve a quedar remisionado con el destinatario
      if (remission && u.remissionId === remission.id) {
        tx.update('phoneUnits', u.id, { status: 'remisionado', invoiceId: null, invoiceNumber: null, soldAt: null, salePrice: null, customerName: null, warrantyUntil: null, ...touched() });
      } else markAvailable(tx, u);
    }
    if (remission) revertRemissionSale(tx, remission, inv);
    for (const pay of [...inv.payments, ...(inv.creditPayments ?? [])]) {
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

// ---------------- Ventas a crédito tienda: saldo y cobro ----------------
/** Valor que quedó a «Crédito tienda» en la venta. */
export const creditAmount = (inv: Pick<Invoice, 'payments'>) =>
  sum((inv.payments ?? []).filter((p) => p.method === CREDIT_METHOD).map((p) => p.amount));
/** Lo que ya abonó el cliente a ese crédito. */
export const creditPaid = (inv: Pick<Invoice, 'creditPayments'>) => sum((inv.creditPayments ?? []).map((p) => p.amount));
/** Lo que todavía debe (0 si está pagada o anulada). */
export const creditBalance = (inv: Pick<Invoice, 'payments' | 'creditPayments' | 'status'>) =>
  inv.status === 'anulada' ? 0 : Math.max(0, creditAmount(inv) - creditPaid(inv));

/**
 * Cobra (total o parcial) una venta a crédito tienda: el dinero entra a la caja abierta como «Abono de cliente»
 * (ingreso del libro fiscal) y, cuando el saldo llega a 0, la factura pasa a «pagada».
 */
export async function collectCredit(actor: Actor, invoiceId: string, amount: number, method: string) {
  if (!(amount > 0)) throw new BusinessError('Escriba el valor que paga el cliente.');
  if (!method || method === CREDIT_METHOD) throw new BusinessError('Elija con qué paga (efectivo, transferencia, Nequi…).');
  return backend.transaction(async (tx) => {
    const inv = await tx.get<Invoice>('invoices', invoiceId);
    if (!inv) throw new BusinessError('Factura no encontrada.');
    if (inv.status === 'anulada') throw new BusinessError('La factura está anulada.');
    const balance = creditBalance(inv);
    if (balance <= 0) throw new BusinessError('Esta venta no tiene saldo por cobrar.');
    if (amount > balance) throw new BusinessError(`El cliente solo debe ${balance.toLocaleString('es-CO')}.`);
    const sid = await requireOpenSession(tx);
    // ---- escrituras ----
    const at = new Date().toISOString();
    writeMovement(tx, actor, sid, {
      direction: 'ingreso', category: 'abono_cliente', method, amount,
      description: `Abono crédito factura ${inv.number} · ${inv.customer.name || 'Cliente'}`, refType: 'invoice', refId: inv.id,
    });
    const creditPayments = [...(inv.creditPayments ?? []), { at, amount, method, by: actor.name }];
    tx.update('invoices', inv.id, { creditPayments, status: amount === balance ? 'pagada' : 'credito', ...touched() });
    return { balance: balance - amount };
  });
}

/**
 * Corrige el costo de líneas de una venta ya hecha (cuando se corrige el valor de la compra).
 * Así la ganancia de la factura, de la caja, de los informes y la comisión «sobre utilidad» quedan bien.
 * Hace solo LECTURAS y devuelve la escritura para llamarla después (regla de las transacciones).
 * `newCost` devuelve el costo nuevo de la línea, o undefined si esa línea no cambia.
 */
export async function prepareInvoiceCostFix(
  tx: Tx, actor: Actor, invoiceId: string, newCost: (it: InvoiceItem, index: number) => number | undefined, reason: string,
): Promise<(() => void) | null> {
  const inv = await tx.get<Invoice>('invoices', invoiceId);
  if (!inv || inv.status === 'anulada') return null;
  const before: { index: number; unitCost: number }[] = [];
  const items = inv.items.map((it, index) => {
    const c = newCost(it, index);
    if (c === undefined || c === it.unitCost) return it;
    before.push({ index, unitCost: it.unitCost });
    return { ...it, unitCost: c };
  });
  if (before.length === 0) return null;
  let commission = inv.commission;
  const usesProfit = inv.commissionBase === 'utilidad' || Object.values(inv.commissionRates ?? {}).some((r) => r.base === 'utilidad');
  if (inv.sellerId && usesProfit) {
    const seller = await tx.get<Seller>('sellers', inv.sellerId);
    const products = new Map<string, Product>();
    for (const it of items) {
      if (!it.productId || products.has(it.productId)) continue;
      const p = await tx.get<Product>('products', it.productId);
      if (p) products.set(p.id, p);
    }
    commission = computeCommission({ commissionPct: inv.commissionPct ?? 0, commissionBase: inv.commissionBase ?? 'venta', lines: seller?.lines, categoryRates: inv.commissionRates }, items, inv.discount, products);
  }
  return () => tx.update('invoices', inv.id, {
    items,
    ...(commission !== inv.commission ? { commission } : {}),
    costEdits: [...(inv.costEdits ?? []), {
      at: new Date().toISOString(), by: actor.name, reason, items: before,
      ...(commission !== inv.commission && inv.commission !== undefined ? { commission: inv.commission } : {}),
    }],
    ...touched(),
  });
}

/** Líneas de venta que se cuentan como «sin costo» (productos y repuestos; no mano de obra ni servicios). */
export const lacksCost = (it: InvoiceItem) => (it.kind === 'producto' || it.kind === 'repuesto') && !(it.unitCost > 0);

/** Ventas (no anuladas) de un producto que quedaron con costo $0. */
export function zeroCostSales(invoices: Invoice[], productId: string) {
  return invoices
    .filter((i) => i.status !== 'anulada' && i.items.some((it) => it.productId === productId && lacksCost(it)))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Pone el costo a ventas que quedaron en $0 (al registrarle el costo al producto o su compra).
 * Corrige ganancia y comisión sobre utilidad; si es un celular, también el costo del equipo vendido.
 */
export async function applyCostToZeroSales(actor: Actor, fixes: { productId: string; cost: number }[], invoiceIds: string[]) {
  const costs = new Map(fixes.filter((f) => f.cost > 0).map((f) => [f.productId, f.cost]));
  if (costs.size === 0 || invoiceIds.length === 0) throw new BusinessError('No hay ventas para corregir.');
  return backend.transaction(async (tx) => {
    const writes: (() => void)[] = [];
    const unitIds = new Map<string, number>();
    for (const id of invoiceIds) {
      const w = await prepareInvoiceCostFix(tx, actor, id, (it) => {
        const c = it.productId && lacksCost(it) ? costs.get(it.productId) : undefined;
        if (c && it.unitId) unitIds.set(it.unitId, c);
        return c;
      }, 'Costo registrado después de la venta');
      if (w) writes.push(w);
    }
    const units: PhoneUnit[] = [];
    for (const uid of unitIds.keys()) {
      const u = await tx.get<PhoneUnit>('phoneUnits', uid);
      if (u && !(u.cost > 0)) units.push(u);
    }
    writes.forEach((w) => w());
    for (const u of units) tx.update('phoneUnits', u.id, { cost: unitIds.get(u.id)!, ...touched() });
    return writes.length;
  });
}

/** Líneas de una venta a las que se les puede corregir el costo a mano (no mano de obra ni encimados). */
export const costEditable = (it: InvoiceItem) => (it.kind === 'producto' || it.kind === 'repuesto') && !it.gift;

/**
 * Corrige a mano el costo de líneas de una venta ya hecha (solo administrador): p. ej. un celular que se vendió
 * sin costo o con el costo mal escrito. Recalcula ganancia y comisión sobre utilidad; si es un celular, también
 * el costo del equipo vendido. Si el producto no tenía costo, se le guarda para las próximas ventas.
 */
export async function fixInvoiceCosts(actor: Actor, invoiceId: string, costs: Record<number, number>, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la corrección.');
  if (Object.values(costs).some((c) => !(c >= 0))) throw new BusinessError('Revise los costos.');
  return backend.transaction(async (tx) => {
    const inv = await tx.get<Invoice>('invoices', invoiceId);
    if (!inv) throw new BusinessError('Venta no encontrada.');
    if (inv.status === 'anulada') throw new BusinessError('La venta está anulada.');
    for (const k of Object.keys(costs)) {
      const it = inv.items[Number(k)];
      if (!it || !costEditable(it)) throw new BusinessError('Esa línea no se puede corregir aquí.');
    }
    const write = await prepareInvoiceCostFix(tx, actor, invoiceId, (_it, index) => costs[index], reason.trim());
    if (!write) throw new BusinessError('No hay cambios para guardar.');
    const units: PhoneUnit[] = [];
    const prods: Product[] = [];
    for (const [k, c] of Object.entries(costs)) {
      const it = inv.items[Number(k)];
      if (it.unitId) {
        const u = await tx.get<PhoneUnit>('phoneUnits', it.unitId);
        if (u && u.cost !== c) units.push({ ...u, cost: c });
      } else if (it.productId && c > 0 && !prods.some((p) => p.id === it.productId)) {
        const p = await tx.get<Product>('products', it.productId);
        if (p && !(p.cost > 0)) prods.push({ ...p, cost: c });
      }
    }
    write();
    for (const u of units) tx.update('phoneUnits', u.id, { cost: u.cost, ...touched() });
    for (const p of prods) tx.update('products', p.id, { cost: p.cost, ...touched() });
  });
}
