// Pruebas de las reglas de negocio sobre el backend local (mismo código que usa Firestore).
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Customer, Invoice, Product, RepairOrder, StockMovement } from '../lib/types';
import { saveProduct, adjustStock, receiveStock } from './inventory';
import { addDeposit, addPart, createOrder, removePart, orderTotal } from './orders';
import { closeSession, expectedByMethod, openSession, addMovement } from './cash';
import { createInvoice, itemsFromOrder, voidInvoice } from './billing';
import { createTicket } from './tickets';
import { seedDemo } from './seed';
import type { Actor } from './common';

const actor: Actor = { uid: 'u1', name: 'Tester' };
const local = backend as LocalBackend;

const product = (over: Partial<Product> = {}) => ({
  sku: 'REP-1', type: 'REPUESTO' as const, name: 'Pantalla X', brand: '', model: '', color: '',
  cost: 50000, price: 90000, stock: 3, minStock: 1, warrantyMonths: 0, line: 'Servicio técnico', active: true, ...over,
});

async function newCustomer(): Promise<Customer> {
  const c = { document: '1', name: 'Ana', phone: '3000000000', email: '', address: '', notes: '' };
  const id = await backend.create('customers', c);
  return { ...c, id };
}

async function newOrder(customer: Customer) {
  return createOrder(actor, {
    customer,
    device: { brand: 'Samsung', model: 'A10', imei: '', color: '', unlockCode: '', accessories: '', condition: '' },
    reportedIssue: 'Pantalla rota', technicianId: '', technicianName: '', technicianUserId: '',
    priority: 'normal', promisedAt: '', budget: 0, laborPrice: 40000, technicianPay: 20000, warrantyDays: 30,
  });
}

const stockOf = async (id: string) => (await backend.get<Product>('products', id))!.stock;
const kardex = async (id: string) => (await backend.list<StockMovement>('stockMovements')).filter((m) => m.productId === id);

beforeEach(() => local.reset());

describe('inventario', () => {
  it('registra el stock inicial en el kardex', async () => {
    const id = await saveProduct(actor, product());
    expect(await stockOf(id)).toBe(3);
    const k = await kardex(id);
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ reason: 'inicial', qty: 3, stockAfter: 3 });
  });

  it('entradas y ajustes quedan en el kardex', async () => {
    const id = await saveProduct(actor, product());
    await receiveStock(actor, id, 5, 48000, 'Compra proveedor');
    expect(await stockOf(id)).toBe(8);
    expect((await backend.get<Product>('products', id))!.cost).toBe(48000);
    await adjustStock(actor, id, 6, 'Conteo físico');
    expect(await stockOf(id)).toBe(6);
    expect((await kardex(id)).map((m) => m.qty).sort()).toEqual([-2, 3, 5].sort());
  });
});

describe('órdenes de reparación conectadas al inventario', () => {
  it('numera las OT de forma consecutiva', async () => {
    const c = await newCustomer();
    const a = await newOrder(c);
    const b = await newOrder(c);
    expect([a.number, b.number]).toEqual([1, 2]);
  });

  it('agregar un repuesto descuenta stock y quitarlo lo devuelve', async () => {
    const c = await newCustomer();
    const pid = await saveProduct(actor, product());
    const o = await newOrder(c);
    await addPart(actor, o.id, pid, 2);
    expect(await stockOf(pid)).toBe(1);
    let order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(order.parts).toHaveLength(1);
    expect(orderTotal(order)).toBe(40000 + 2 * 90000);
    const out = (await kardex(pid)).find((m) => m.reason === 'reparacion')!;
    expect(out).toMatchObject({ qty: -2, refType: 'repairOrder', refId: o.id, refNumber: o.number });

    await removePart(actor, o.id, order.parts[0].lineId);
    expect(await stockOf(pid)).toBe(3);
    order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(order.parts).toHaveLength(0);
  });

  it('no permite usar más repuestos de los que hay (y no deja cambios a medias)', async () => {
    const c = await newCustomer();
    const pid = await saveProduct(actor, product({ stock: 1 }));
    const o = await newOrder(c);
    await expect(addPart(actor, o.id, pid, 2)).rejects.toThrow(/Stock insuficiente/);
    expect(await stockOf(pid)).toBe(1);
    expect((await backend.get<RepairOrder>('repairOrders', o.id))!.parts).toHaveLength(0);
    expect((await kardex(pid)).filter((m) => m.reason === 'reparacion')).toHaveLength(0);
  });
});

describe('facturación y caja', () => {
  it('exige caja abierta para facturar', async () => {
    await expect(
      createInvoice(actor, {
        customer: { name: '', phone: '', document: '' }, items: [{ description: 'x', kind: 'servicio', qty: 1, unitPrice: 1000, unitCost: 0 }],
        discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 1000 }], cashierName: 'T',
      }),
    ).rejects.toThrow(/caja abierta/);
  });

  it('venta directa: descuenta stock, registra caja y cuadra el arqueo', async () => {
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Cargador', price: 20000, cost: 10000, stock: 5 }));
    const sid = await openSession(actor, 100000);
    const inv = await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Cargador', kind: 'producto', qty: 2, unitPrice: 20000, unitCost: 10000 }],
      discount: 5000, taxRate: 0,
      payments: [{ method: 'Efectivo', amount: 20000 }, { method: 'Nequi', amount: 15000 }], cashierName: 'T',
    });
    expect(inv.number).toBe(1);
    expect(await stockOf(pid)).toBe(3);
    const movs = await backend.list<CashMovement>('cashMovements');
    expect(movs).toHaveLength(2);
    const exp = expectedByMethod({ openingCash: 100000 }, movs, ['Efectivo', 'Nequi']);
    expect(exp).toMatchObject({ Efectivo: 120000, Nequi: 15000 });

    await addMovement(actor, { direction: 'egreso', category: 'gasto', method: 'Efectivo', amount: 30000, description: 'Almuerzo' });
    const exp2 = expectedByMethod({ openingCash: 100000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo']);
    expect(exp2.Efectivo).toBe(90000);

    await expect(closeSession(actor, sid, exp2, { Efectivo: 80000 }, '')).rejects.toThrow(/justificación/);
    await closeSession(actor, sid, exp2, { Efectivo: 80000 }, 'Faltante');
    expect((await backend.get<{ openSessionId: string | null }>('meta', 'cash'))!.openSessionId).toBeNull();
  });

  it('rechaza pagos que no cuadran con el total', async () => {
    await openSession(actor, 0);
    await expect(
      createInvoice(actor, {
        customer: { name: '', phone: '', document: '' }, items: [{ description: 'x', kind: 'servicio', qty: 1, unitPrice: 10000, unitCost: 0 }],
        discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 9000 }], cashierName: 'T',
      }),
    ).rejects.toThrow(/no coinciden/);
    expect(await backend.list('invoices')).toHaveLength(0);
  });

  it('facturar una OT no vuelve a descontar repuestos, aplica abonos y la entrega', async () => {
    const c = await newCustomer();
    const pid = await saveProduct(actor, product());
    await openSession(actor, 0);
    const o = await newOrder(c);
    await addPart(actor, o.id, pid, 1);
    await addDeposit(actor, o.id, 50000, 'Efectivo');
    const order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    const items = itemsFromOrder(order);
    expect(items.map((i) => i.kind)).toEqual(['mano_obra', 'repuesto']);

    const total = 40000 + 90000;
    await createInvoice(actor, {
      customerId: c.id, customer: { name: c.name, phone: c.phone, document: c.document }, items,
      discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: total - 50000 }], repairOrderId: o.id, cashierName: 'T',
    });
    expect(await stockOf(pid)).toBe(2); // solo la salida por reparación
    const delivered = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(delivered.status).toBe('Entregado');
    expect(delivered.invoiceNumber).toBe(1);
    expect(delivered.warrantyUntil).toBeTruthy();
    const inv = (await backend.list<Invoice>('invoices'))[0];
    expect(inv).toMatchObject({ total, depositsApplied: 50000 });

    await expect(createInvoice(actor, {
      customerId: c.id, customer: inv.customer, items, discount: 0, taxRate: 0,
      payments: [{ method: 'Efectivo', amount: 80000 }], repairOrderId: o.id, cashierName: 'T',
    })).rejects.toThrow(/ya fue facturada/);
  });

  it('anular devuelve stock, registra egreso y reabre la OT', async () => {
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', stock: 4, price: 10000 }));
    await openSession(actor, 0);
    const r = await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Acc', kind: 'producto', qty: 3, unitPrice: 10000, unitCost: 5000 }],
      discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 30000 }], cashierName: 'T',
    });
    expect(await stockOf(pid)).toBe(1);
    await voidInvoice(actor, r.id, 'Error de digitación');
    expect(await stockOf(pid)).toBe(4);
    const inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.status).toBe('anulada');
    const exp = expectedByMethod({ openingCash: 0 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo']);
    expect(exp.Efectivo).toBe(0);
    await expect(voidInvoice(actor, r.id, 'otra vez')).rejects.toThrow(/ya está anulada/);
  });

  it('la venta a crédito no entra en caja y exige cliente', async () => {
    await openSession(actor, 0);
    const item = { description: 'Servicio', kind: 'servicio' as const, qty: 1, unitPrice: 20000, unitCost: 0 };
    await expect(createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' }, items: [item], discount: 0, taxRate: 0,
      payments: [{ method: 'Crédito tienda', amount: 20000 }], cashierName: 'T',
    })).rejects.toThrow(/cliente registrado/);
    const c = await newCustomer();
    await createInvoice(actor, {
      customerId: c.id, customer: { name: c.name, phone: '', document: '' }, items: [item], discount: 0, taxRate: 0,
      payments: [{ method: 'Crédito tienda', amount: 20000 }], cashierName: 'T',
    });
    expect(await backend.list('cashMovements')).toHaveLength(0);
    expect((await backend.list<Invoice>('invoices'))[0].status).toBe('credito');
  });
});

describe('tickets y datos demo', () => {
  it('numera los tickets', async () => {
    const a = await createTicket(actor, { type: 'garantia', subject: 'Falla', description: '', customerId: '', customerName: '', priority: 'alta', assignedTo: '' });
    const b = await createTicket(actor, { type: 'consulta', subject: 'Precio', description: '', customerId: '', customerName: '', priority: 'baja', assignedTo: '' });
    expect([a.number, b.number]).toEqual([1, 2]);
  });

  it('los datos demo se generan respetando las reglas', async () => {
    await seedDemo();
    const orders = await backend.list<RepairOrder>('repairOrders');
    expect(orders).toHaveLength(3);
    const pantalla = (await backend.list<Product>('products')).find((p) => p.sku === 'REP-0001')!;
    expect(pantalla.stock).toBe(2);
    expect(await backend.list('invoices')).toHaveLength(1);
    await backend.auth.signIn('admin@digitalcell.demo', 'demo1234');
  });
});

describe('importación de datos anteriores', () => {
  it('importa datos base, registra el stock en el kardex y no duplica al repetir', async () => {
    const { importData } = await import('./importer');
    const { DEFAULT_SETTINGS } = await import('./settings');
    const file = {
      version: 1 as const,
      settings: { nit: '123', phone: '' },
      customers: [{ name: 'Gloria', document: '42', phone: '300' }, { name: 'Edwin', document: '' }],
      products: [
        { sku: 'ACC-1', type: 'ACCESORIO' as const, name: 'Cargador', cost: 10000, price: 20000, stock: 25 },
        { sku: '', type: 'SERVICIO' as const, name: 'Virus', cost: 10000, price: 30000, stock: 9 },
      ],
      technicians: [{ name: 'Caballo' }, { name: 'Andres' }],
    };
    const state = async () => ({
      customers: await backend.list<Customer>('customers'),
      products: await backend.list<Product>('products'),
      technicians: await backend.list('technicians') as never[],
      settings: DEFAULT_SETTINGS,
    });
    const r = await importData(actor, file, await state());
    expect(r.customers.added).toBe(2);
    expect(r.products.added).toBe(2);
    expect(r.technicians.added).toBe(2);
    const cargador = (await backend.list<Product>('products')).find((p) => p.sku === 'ACC-1')!;
    expect(cargador.stock).toBe(25);
    expect((await kardex(cargador.id))[0]).toMatchObject({ reason: 'inicial', qty: 25 });
    const virus = (await backend.list<Product>('products')).find((p) => p.name === 'Virus')!;
    expect(virus.stock).toBe(0);
    const s = (await backend.get<{ nit: string; name: string }>('settings', 'business'))!;
    expect(s).toMatchObject({ nit: '123', name: 'Digital Cell' });

    const again = await importData(actor, file, await state());
    expect(again.customers).toEqual({ added: 0, skipped: 2 });
    expect(again.products).toEqual({ added: 0, skipped: 2 });
    expect(again.technicians).toEqual({ added: 0, skipped: 2 });
  });
});
