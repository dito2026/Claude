// Pruebas de las reglas de negocio sobre el backend local (mismo código que usa Firestore).
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Customer, Invoice, InvoiceItem, Product, RepairOrder, StockMovement } from '../lib/types';
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

describe('compras y proveedores', () => {
  const supplierBase = { nit: '', phone: '', termDays: 30, notes: '', active: true };

  it('compra a crédito: suma stock, no toca caja y queda por pagar; abono parcial y total', async () => {
    const { saveSupplier, createPurchase, paySupplier, purchaseBalance, supplierSummary } = await import('./purchases');
    const pid = await saveProduct(actor, product({ stock: 2, cost: 50000 }));
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Maxel' });
    const supplier = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    const r = await createPurchase(actor, {
      supplier, items: [{ productId: pid, name: 'Pantalla X', qty: 3, unitCost: 45000 }],
      paymentType: 'credito', method: 'Efectivo', invoiceRef: 'F-12', note: '', updateCost: true,
    });
    expect(r.total).toBe(135000);
    expect(await stockOf(pid)).toBe(5);
    expect((await backend.get<Product>('products', pid))!.cost).toBe(45000);
    const k = (await kardex(pid)).find((m) => m.reason === 'compra')!;
    expect(k).toMatchObject({ qty: 3, refType: 'purchase', refNumber: 1 });
    expect(await backend.list('cashMovements')).toHaveLength(0);

    type P = import('../lib/types').Purchase;
    let purchases = await backend.list<P>('purchases');
    expect(supplierSummary(supplier, purchases).owed).toBe(135000);

    await expect(paySupplier(actor, supplier, purchases.map((p) => p.id), 10000, 'Efectivo')).rejects.toThrow(/caja abierta/);
    await openSession(actor, 200000);
    await expect(paySupplier(actor, supplier, purchases.map((p) => p.id), 999999, 'Efectivo')).rejects.toThrow(/supera la deuda/);
    await paySupplier(actor, supplier, purchases.map((p) => p.id), 35000, 'Efectivo');
    purchases = await backend.list<P>('purchases');
    expect(purchases[0]).toMatchObject({ paid: 35000, status: 'parcial' });
    expect(purchaseBalance(purchases[0])).toBe(100000);
    await paySupplier(actor, supplier, purchases.map((p) => p.id), 100000, 'Nequi');
    purchases = await backend.list<P>('purchases');
    expect(purchases[0].status).toBe('pagada');
    const exp = expectedByMethod({ openingCash: 200000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);
    expect(exp).toMatchObject({ Efectivo: 165000, Nequi: -100000 });
  });

  it('compra de contado exige caja abierta y sale de caja', async () => {
    const { saveSupplier, createPurchase } = await import('./purchases');
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', stock: 0, cost: 2000 }));
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Claro' });
    const supplier = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    const draft = {
      supplier, items: [{ productId: pid, name: 'Sim card', qty: 10, unitCost: 1000 }],
      paymentType: 'contado' as const, method: 'Efectivo', invoiceRef: '', note: '', updateCost: false,
    };
    await expect(createPurchase(actor, draft)).rejects.toThrow(/caja abierta/);
    expect(await stockOf(pid)).toBe(0);
    await openSession(actor, 50000);
    await createPurchase(actor, draft);
    expect(await stockOf(pid)).toBe(10);
    expect((await backend.get<Product>('products', pid))!.cost).toBe(2000);
    const exp = expectedByMethod({ openingCash: 50000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo']);
    expect(exp.Efectivo).toBe(40000);
  });

  it('proveedor con saldo anterior queda debiendo', async () => {
    const { saveSupplier, supplierSummary } = await import('./purchases');
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Nano' }, undefined, 2370000);
    const s = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    const ps = await backend.list<import('../lib/types').Purchase>('purchases');
    expect(ps[0]).toMatchObject({ kind: 'saldo_inicial', total: 2370000, paymentType: 'credito' });
    expect(supplierSummary(s, ps).owed).toBe(2370000);
  });
});

describe('venta sin inventario', () => {
  it('producto sin control de stock se vende y se usa en reparaciones sin límite ni kardex', async () => {
    const { addFreePart } = await import('./orders');
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Forro', stock: 5, price: 15000, cost: 6000, trackStock: false }));
    expect(await stockOf(pid)).toBe(0);
    expect(await kardex(pid)).toHaveLength(0);
    await openSession(actor, 0);
    await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Forro', kind: 'producto', qty: 7, unitPrice: 15000, unitCost: 6000 }],
      discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 105000 }], cashierName: 'T',
    });
    expect(await stockOf(pid)).toBe(0);
    expect(await kardex(pid)).toHaveLength(0);
    await expect(adjustStock(actor, pid, 3, 'x')).rejects.toThrow(/no controla inventario/);

    const c = await newCustomer();
    const o = await newOrder(c);
    await addPart(actor, o.id, pid, 4);
    await addFreePart(actor, o.id, { name: 'Flex de carga', qty: 1, unitCost: 20000, unitPrice: 45000 });
    let order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(order.parts.map((p) => p.productId)).toEqual([pid, '']);
    expect(orderTotal(order)).toBe(40000 + 4 * 15000 + 45000);
    await removePart(actor, o.id, order.parts[1].lineId);
    order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(order.parts).toHaveLength(1);
    expect(await stockOf(pid)).toBe(0);
  });

  it('artículo libre en una factura no toca inventario', async () => {
    await openSession(actor, 0);
    const r = await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ description: 'Audífonos genéricos', kind: 'producto', qty: 2, unitPrice: 25000, unitCost: 9000 }],
      discount: 0, taxRate: 0, payments: [{ method: 'Nequi', amount: 50000 }], cashierName: 'T',
    });
    expect(r.number).toBe(1);
    expect(await backend.list('stockMovements')).toHaveLength(0);
  });
});

describe('celulares por IMEI', () => {
  type Unit = import('../lib/types').PhoneUnit;
  const phone = () => product({ sku: 'CEL-1', type: 'EQUIPO', name: 'iPhone 14 Pro Max 128GB', cost: 1350000, price: 1650000, stock: 5, warrantyMonths: 6 });
  const IMEI_A = '358497893736757';
  const IMEI_B = '359253622999425';

  it('valida IMEI: 15 dígitos con dígito de control, o serial alfanumérico', async () => {
    const { imeiError } = await import('./phones');
    expect(imeiError(IMEI_A)).toBeNull();
    expect(imeiError('SM57C36HGJT')).toBeNull();
    expect(imeiError('358497893736758')).toMatch(/no es válido/);
    expect(imeiError('123')).toMatch(/no es un IMEI|15 dígitos/);
  });

  it('el celular no entra con stock suelto: solo con IMEI, y el IMEI es único', async () => {
    const { registerUnits } = await import('./phones');
    const pid = await saveProduct(actor, phone());
    expect(await stockOf(pid)).toBe(0); // el stock inicial se ignora
    await expect(receiveStock(actor, pid, 1)).rejects.toThrow(/IMEI/);
    await registerUnits(actor, pid, [{ imei: IMEI_A, condition: 'USADO' }], { cost: 0, supplierName: '', note: '', alreadyInStock: false });
    expect(await stockOf(pid)).toBe(1);
    await expect(
      registerUnits(actor, pid, [{ imei: '358 4978 9373 6757', condition: 'NUEVO' }], { cost: 0, supplierName: '', note: '', alreadyInStock: false }),
    ).rejects.toThrow(/ya está registrado/);
    await expect(
      registerUnits(actor, pid, [{ imei: IMEI_B, condition: 'NUEVO' }, { imei: IMEI_B, condition: 'NUEVO' }], { cost: 0, supplierName: '', note: '', alreadyInStock: false }),
    ).rejects.toThrow(/repetido/);
    expect(await stockOf(pid)).toBe(1);
  });

  it('se vende solo escogiendo un IMEI disponible; anular lo devuelve', async () => {
    const { registerUnits } = await import('./phones');
    const pid = await saveProduct(actor, phone());
    await registerUnits(actor, pid, [{ imei: IMEI_A, condition: 'USADO' }], { cost: 1300000, supplierName: 'Nano', note: '', alreadyInStock: false });
    await openSession(actor, 0);
    const line = { productId: pid, description: 'iPhone 14 Pro Max 128GB', kind: 'producto' as const, qty: 1, unitPrice: 1650000, unitCost: 1300000 };
    const sale = (items: InvoiceItem[]) => createInvoice(actor, {
      customer: { name: 'Edwin', phone: '', document: '' }, items, discount: 0, taxRate: 0,
      payments: [{ method: 'Efectivo', amount: 1650000 * items.length }], cashierName: 'T',
    });
    await expect(sale([line])).rejects.toThrow(/escogiendo el IMEI/);
    const r = await sale([{ ...line, unitId: IMEI_A, imei: IMEI_A }]);
    expect(await stockOf(pid)).toBe(0);
    let u = (await backend.get<Unit>('phoneUnits', IMEI_A))!;
    expect(u).toMatchObject({ status: 'vendido', invoiceNumber: 1, customerName: 'Edwin', salePrice: 1650000 });
    expect(u.warrantyUntil).toBeTruthy();
    await expect(sale([{ ...line, unitId: IMEI_A, imei: IMEI_A }])).rejects.toThrow(/ya fue vendido/);

    await voidInvoice(actor, r.id, 'Devolución');
    u = (await backend.get<Unit>('phoneUnits', IMEI_A))!;
    expect(u.status).toBe('disponible');
    expect(u.invoiceId).toBeFalsy();
    expect(await stockOf(pid)).toBe(1);
  });

  it('compra de celulares exige un IMEI por unidad y los registra', async () => {
    const { saveSupplier, createPurchase } = await import('./purchases');
    const pid = await saveProduct(actor, phone());
    const sid = await saveSupplier(actor, { name: 'Nano', nit: '', phone: '', termDays: 30, notes: '', active: true });
    const supplier = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    const base = { supplier, paymentType: 'credito' as const, method: 'Efectivo', invoiceRef: '', note: '', updateCost: true };
    await expect(createPurchase(actor, { ...base, items: [{ productId: pid, name: 'iPhone', qty: 2, unitCost: 1300000 }] }))
      .rejects.toThrow(/IMEI de cada celular/);
    await createPurchase(actor, {
      ...base,
      items: [{ productId: pid, name: 'iPhone', qty: 0, unitCost: 1300000, units: [{ imei: IMEI_A, condition: 'NUEVO' }, { imei: IMEI_B, condition: 'NUEVO' }] }],
    });
    expect(await stockOf(pid)).toBe(2);
    const units = await backend.list<Unit>('phoneUnits');
    expect(units.map((u) => u.imei).sort()).toEqual([IMEI_A, IMEI_B].sort());
    expect(units[0]).toMatchObject({ supplierName: 'Nano', purchaseNumber: 1, cost: 1300000, status: 'disponible' });
  });

  it('los celulares no se usan como repuesto de una OT', async () => {
    const pid = await saveProduct(actor, phone());
    const c = await newCustomer();
    const o = await newOrder(c);
    await expect(addPart(actor, o.id, pid, 1)).rejects.toThrow(/IMEI en Facturación/);
  });
});

describe('compras a crédito sin inventario', () => {
  const supplierBase = { nit: '', phone: '', termDays: 30, notes: '', active: true };
  type Sup = import('../lib/types').Supplier;
  type P = import('../lib/types').Purchase;

  it('artículo libre a crédito: deuda al proveedor sin movimiento de inventario', async () => {
    const { saveSupplier, createPurchase, supplierSummary } = await import('./purchases');
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Pepe' });
    const s = (await backend.get<Sup>('suppliers', sid))!;
    await createPurchase(actor, {
      supplier: s, items: [{ productId: '', name: 'Display Redmi Note 9', qty: 1, unitCost: 40000 }],
      paymentType: 'credito', method: 'Efectivo', invoiceRef: '', note: '', updateCost: true,
    });
    expect(await backend.list('stockMovements')).toHaveLength(0);
    expect(await backend.list('cashMovements')).toHaveLength(0);
    expect(supplierSummary(s, await backend.list<P>('purchases')).owed).toBe(40000);
    await expect(createPurchase(actor, {
      supplier: s, items: [{ productId: '', name: '  ', qty: 1, unitCost: 1000 }],
      paymentType: 'credito', method: 'Efectivo', invoiceRef: '', note: '', updateCost: false,
    })).rejects.toThrow(/descripción/);
  });

  it('producto marcado «sin inventario» comprado a crédito: deuda y no toca stock', async () => {
    const { saveSupplier, createPurchase, supplierSummary } = await import('./purchases');
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Forro', cost: 5000, trackStock: false }));
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Maxel' });
    const s = (await backend.get<Sup>('suppliers', sid))!;
    await createPurchase(actor, {
      supplier: s, items: [{ productId: pid, name: 'Forro', qty: 20, unitCost: 4500 }],
      paymentType: 'credito', method: 'Efectivo', invoiceRef: '', note: '', updateCost: true,
    });
    expect(await stockOf(pid)).toBe(0);
    expect(await kardex(pid)).toHaveLength(0);
    expect((await backend.get<Product>('products', pid))!.cost).toBe(4500);
    expect(supplierSummary(s, await backend.list<P>('purchases')).owed).toBe(90000);
  });

  it('repuesto libre de una OT comprado a crédito queda ligado a la compra', async () => {
    const { saveSupplier, buyFreeItem } = await import('./purchases');
    const { addFreePart } = await import('./orders');
    const sid = await saveSupplier(actor, { ...supplierBase, name: 'Conco' });
    const s = (await backend.get<Sup>('suppliers', sid))!;
    const c = await newCustomer();
    const o = await newOrder(c);
    const r = await buyFreeItem(actor, s, { name: 'Display Note 9', qty: 1, unitCost: 40000 }, { paymentType: 'credito', method: 'Efectivo', note: 'OT' });
    await addFreePart(actor, o.id, { name: 'Display Note 9', qty: 1, unitCost: 40000, unitPrice: 90000, purchaseNumber: r.number, supplierName: s.name });
    const order = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    expect(order.parts[0]).toMatchObject({ productId: '', purchaseNumber: 1, supplierName: 'Conco', unitPrice: 90000 });
    const ps = await backend.list<P>('purchases');
    expect(ps[0]).toMatchObject({ paymentType: 'credito', total: 40000, status: 'pendiente' });
  });
});

describe('contabilidad', () => {
  it('estado de resultados, libro fiscal y resumen del negocio cuadran', async () => {
    const acc = await import('./accounting');
    const { saveSupplier, createPurchase } = await import('./purchases');
    const acc_pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Cargador', price: 20000, cost: 10000, stock: 10 }));
    await openSession(actor, 100000);
    // venta de accesorios: 2 × 20.000 con descuento de 4.000
    await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: acc_pid, description: 'Cargador', kind: 'producto', qty: 2, unitPrice: 20000, unitCost: 10000 }],
      discount: 4000, taxRate: 0, payments: [{ method: 'Efectivo', amount: 36000 }], cashierName: 'T',
    });
    // reparación: mano de obra 60.000 (pago técnico 10.000) + repuesto libre 40.000
    const c = await newCustomer();
    const o = await newOrder(c);
    await backend.update('repairOrders', o.id, { laborPrice: 60000, technicianPay: 10000 });
    const { addFreePart } = await import('./orders');
    await addFreePart(actor, o.id, { name: 'Pantalla', qty: 1, unitCost: 40000, unitPrice: 40000 });
    const ord = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    await createInvoice(actor, {
      customerId: c.id, customer: { name: c.name, phone: '', document: '' }, items: itemsFromOrder(ord),
      discount: 0, taxRate: 0, payments: [{ method: 'Nequi', amount: 100000 }], repairOrderId: o.id, cashierName: 'T',
    });
    // gasto, pago a técnico, retiro y compra de contado
    await addMovement(actor, { direction: 'egreso', category: 'gasto', expenseCategory: 'Arriendo', method: 'Efectivo', amount: 30000, description: 'Arriendo' });
    await addMovement(actor, { direction: 'egreso', category: 'pago_tecnico', method: 'Efectivo', amount: 10000, description: 'Técnico', refId: 't1' });
    await addMovement(actor, { direction: 'egreso', category: 'retiro', method: 'Efectivo', amount: 5000, description: 'Retiro' });
    const sid = await saveSupplier(actor, { name: 'Maxel', nit: '', phone: '', termDays: 30, notes: '', active: true });
    const s = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    await createPurchase(actor, { supplier: s, items: [{ productId: acc_pid, name: 'Cargador', qty: 5, unitCost: 10000 }], paymentType: 'credito', method: 'Efectivo', invoiceRef: '', note: '', updateCost: false });

    const data = {
      invoices: await backend.list<Invoice>('invoices'),
      movements: await backend.list<CashMovement>('cashMovements'),
      products: await backend.list<Product>('products'),
    };
    const p = acc.periodRange('hoy');
    const r = acc.buildReport(p, data);
    expect(r.income).toBe(136000);
    expect(r.discounts).toBe(4000);
    expect(r.byLine.find((l) => l.line === 'Accesorios')).toMatchObject({ sales: 36000, cost: 20000 });
    expect(r.byLine.find((l) => l.line === 'Servicio técnico')).toMatchObject({ sales: 100000, cost: 50000 });
    expect(r.cost).toBe(70000);
    expect(r.grossProfit).toBe(66000);
    expect(r.expenses).toBe(30000); // el pago al técnico ya está en el costo
    expect(r.netProfit).toBe(36000);
    expect(r.expensesByCategory).toEqual([{ category: 'Arriendo', amount: 30000 }]);

    const f = acc.fiscalBook(p, data.movements);
    expect(f.income).toBe(136000);
    expect(f.outflow).toBe(40000); // gasto + técnico; el retiro no cuenta
    expect(f.days).toHaveLength(1);

    const b = acc.balanceToday({
      products: data.products, units: [], invoices: data.invoices,
      purchases: await backend.list<import('../lib/types').Purchase>('purchases'),
    });
    expect(b.stock).toBe(13 * 10000); // 10 − 2 vendidos + 5 comprados
    expect(b.payables).toBe(50000);

    expect(acc.toCsv([['a;b', 1.6], ['x"y', '']])).toBe('﻿"a;b";2\r\n"x""y";');
  });
});

describe('contabilidad: línea de negocio', () => {
  it('clasifica por tipo de producto y línea de los servicios', async () => {
    const { lineOf } = await import('./accounting');
    const mk = (type: Product['type'], line: string) => ({ ...product({ type, line }), id: type + line }) as Product;
    const ps = new Map([mk('SERVICIO', 'Accesorios'), mk('SERVICIO', 'Servicio técnico'), mk('ACCESORIO', 'Servicio técnico'), mk('EQUIPO', '')].map((p) => [p.id, p]));
    const it = (productId: string | undefined, kind: InvoiceItem['kind']) => ({ productId, kind, description: '', qty: 1, unitPrice: 1, unitCost: 0 });
    expect(lineOf(it('SERVICIOAccesorios', 'servicio'), ps)).toBe('Accesorios');
    expect(lineOf(it('SERVICIOServicio técnico', 'servicio'), ps)).toBe('Servicio técnico');
    expect(lineOf(it('ACCESORIOServicio técnico', 'producto'), ps)).toBe('Accesorios');
    expect(lineOf(it('EQUIPO', 'producto'), ps)).toBe('Equipos');
    expect(lineOf(it(undefined, 'servicio'), ps)).toBe('Servicio técnico');
    expect(lineOf(it(undefined, 'producto'), ps)).toBe('Accesorios');
    expect(lineOf(it(undefined, 'mano_obra'), ps)).toBe('Servicio técnico');
  });
});

describe('vendedores y comisiones', () => {
  type Sel = import('../lib/types').Seller;
  it('calcula la comisión al vender (venta o ganancia), se anula con la factura y se paga en caja', async () => {
    const { saveSeller, sellerBalance } = await import('./sellers');
    const acc = await import('./accounting');
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Audífonos', price: 100000, cost: 60000, stock: 10 }));
    const s1 = await saveSeller(actor, { name: 'Ana', phone: '', active: true, commissionPct: 5, commissionBase: 'venta', lines: [] });
    const s2 = await saveSeller(actor, { name: 'Luis', phone: '', active: true, commissionPct: 10, commissionBase: 'utilidad', lines: [] });
    await openSession(actor, 0);
    const sale = (sellerId: string) => createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Audífonos', kind: 'producto', qty: 2, unitPrice: 100000, unitCost: 60000 }],
      discount: 20000, taxRate: 0, payments: [{ method: 'Efectivo', amount: 180000 }], cashierName: 'T', sellerId,
    });
    const a = await sale(String(s1));
    await sale(String(s2));
    const invs = await backend.list<Invoice>('invoices');
    expect(invs.find((i) => i.id === a.id)).toMatchObject({ sellerName: 'Ana', commission: 9000 }); // 5% de 180.000
    expect(invs.find((i) => i.sellerName === 'Luis')!.commission).toBe(6000); // 10% de (180.000 − 120.000)

    const ana = (await backend.get<Sel>('sellers', String(s1)))!;
    await addMovement(actor, { direction: 'egreso', category: 'pago_vendedor', method: 'Efectivo', amount: 4000, description: 'Comisión Ana', refType: 'seller', refId: ana.id });
    let b = sellerBalance(ana, await backend.list<Invoice>('invoices'), await backend.list<CashMovement>('cashMovements'));
    expect(b).toMatchObject({ earned: 9000, paid: 4000, owed: 5000, count: 1 });

    const r = acc.buildReport(acc.periodRange('hoy'), {
      invoices: await backend.list<Invoice>('invoices'), movements: await backend.list<CashMovement>('cashMovements'), products: await backend.list<Product>('products'),
    });
    expect(r.commissions).toBe(15000);
    expect(r.netProfit).toBe(360000 - 240000 - 15000);
    expect(acc.fiscalBook(acc.periodRange('hoy'), await backend.list<CashMovement>('cashMovements')).outflow).toBe(4000);

    await voidInvoice(actor, a.id, 'Devolución');
    b = sellerBalance(ana, await backend.list<Invoice>('invoices'), await backend.list<CashMovement>('cashMovements'));
    expect(b.earned).toBe(0);
    expect(b.owed).toBe(-4000); // se le pagó de más: queda a favor del negocio
  });

  it('solo gana comisión en las líneas elegidas y no acepta vendedores inactivos', async () => {
    const { saveSeller, computeCommission } = await import('./sellers');
    const items: InvoiceItem[] = [
      { description: 'Mano de obra', kind: 'mano_obra', qty: 1, unitPrice: 50000, unitCost: 10000 },
      { description: 'Forro', kind: 'producto', qty: 1, unitPrice: 50000, unitCost: 20000 },
    ];
    expect(computeCommission({ commissionPct: 10, commissionBase: 'venta', lines: ['Accesorios'] }, items, 0, new Map())).toBe(5000);
    expect(computeCommission({ commissionPct: 10, commissionBase: 'venta', lines: [] }, items, 0, new Map())).toBe(10000);
    const off = await saveSeller(actor, { name: 'X', phone: '', active: false, commissionPct: 5, commissionBase: 'venta', lines: [] });
    await openSession(actor, 0);
    await expect(createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' }, items: [items[1]], discount: 0, taxRate: 0,
      payments: [{ method: 'Efectivo', amount: 50000 }], cashierName: 'T', sellerId: String(off),
    })).rejects.toThrow(/inactivo/);
  });
});

describe('automatizaciones', () => {
  it('alertas, reposición sugerida, resumen del día y datos para el asistente', async () => {
    const auto = await import('./automation');
    const { saveSupplier, createPurchase } = await import('./purchases');
    const { setStatus } = await import('./orders');
    const pid = await saveProduct(actor, product({ type: 'ACCESORIO', name: 'Cargador', price: 20000, cost: 10000, stock: 6, minStock: 2 }));
    const sid = await saveSupplier(actor, { name: 'Maxel', nit: '', phone: '', termDays: 2, notes: '', active: true });
    const sup = (await backend.get<import('../lib/types').Supplier>('suppliers', sid))!;
    await createPurchase(actor, { supplier: sup, items: [{ productId: pid, name: 'Cargador', qty: 4, unitCost: 9000 }], paymentType: 'credito', method: 'Efectivo', invoiceRef: '', note: '', updateCost: false });
    await openSession(actor, 0);
    await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Cargador', kind: 'producto', qty: 9, unitPrice: 20000, unitCost: 10000 }],
      discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 180000 }], cashierName: 'T',
    });
    const c = await newCustomer();
    const o = await newOrder(c);
    await setStatus(actor, o.id, 'Reparado / Listo');
    // la orden lleva 5 días lista
    const ord = (await backend.get<RepairOrder>('repairOrders', o.id))!;
    const old = new Date(Date.now() - 5 * 86400000).toISOString();
    await backend.update('repairOrders', o.id, { timeline: ord.timeline.map((t) => (t.status === 'Reparado / Listo' ? { ...t, at: old } : t)) });

    const L = <T,>(c2: string) => backend.list<T>(c2);
    const alerts = auto.buildAlerts({
      orders: await L<RepairOrder>('repairOrders'), purchases: await L('purchases'), products: await L<Product>('products'),
      sessions: await L('cashSessions'), openSessionId: (await backend.get<{ openSessionId: string }>('meta', 'cash'))!.openSessionId,
      technicians: [], sellers: [], invoices: await L<Invoice>('invoices'), movements: await L<CashMovement>('cashMovements'),
      businessName: 'Digital Cell', lastBackupAt: null,
    });
    const ids = alerts.map((a) => a.id);
    expect(ids).toContain(`pickup-${o.id}`);
    expect(alerts.find((a) => a.id === `pickup-${o.id}`)!.whatsapp!.text).toMatch(/ya está listo para recoger/);
    expect(ids.some((i) => i.startsWith('psoon-'))).toBe(true); // vence en 2 días
    expect(ids).toContain('lowstock'); // quedó 1 (mínimo 2)
    expect(ids).toContain('backup');
    expect(alerts[0].level).not.toBe('info'); // ordenadas por urgencia

    const restock = auto.restockSuggestions(await L<Product>('products'), await L('stockMovements'), await L('purchases'), [sup]);
    expect(restock[0]).toMatchObject({ supplierName: 'Maxel', soldLast30: 9, lastCost: 9000 });
    expect(restock[0].suggested).toBe(Math.ceil((9 / 30) * 15) + 2 - 1);

    const txt = auto.dailySummaryText({ invoices: await L('invoices'), movements: await L('cashMovements'), products: await L('products'), orders: await L('repairOrders'), businessName: 'Digital Cell' });
    expect(txt).toMatch(/Ventas: \$ 180\.000/);

    const snap = JSON.parse(auto.businessSnapshot({
      invoices: await L('invoices'), movements: await L('cashMovements'), products: await L('products'), orders: await L('repairOrders'),
      purchases: await L('purchases'), units: [], technicians: [], sellers: [], stockMovements: await L('stockMovements'), suppliers: [sup],
    }));
    expect(snap.hoy.ingresos).toBe(180000);
    expect(snap.mas_vendidos_30_dias[0]).toMatchObject({ nombre: 'Cargador', unidades: 9 });
    expect(snap.deudas_proveedores[0]).toMatchObject({ proveedor: 'Maxel', saldo: 36000 });
  });
});

describe('IA (con respuesta simulada de la API)', () => {
  it('envía la solicitud correcta y devuelve el diagnóstico estructurado', async () => {
    const { vi } = await import('vitest');
    const ai = await import('./ai');
    await expect(ai.aiDiagnose({ brand: 'X', model: 'Y', issue: 'z', condition: '', notes: '', catalogParts: [] })).rejects.toThrow(/no está configurada/);
    await ai.saveAiConfig({ apiKey: 'sk-ant-prueba', enabled: true });
    const diag = {
      resumen: 'Pantalla dañada', causas: [{ causa: 'Display roto', probabilidad: 'alta', porque: 'golpe' }],
      pruebas: ['Conectar pantalla de prueba'], repuestos: ['Pantalla Redmi Note 9'], dificultad: 'baja',
      tiempo_estimado: '1 hora', advertencias: [], mensaje_cliente: 'Su equipo necesita cambio de pantalla.',
    };
    let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      sent = { url: String(url), headers: Object.fromEntries(h.entries()), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(diag) }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const d = await ai.aiDiagnose({ brand: 'Xiaomi', model: 'Redmi Note 9', issue: 'no da imagen', condition: 'golpe', notes: '', catalogParts: ['Pantalla Redmi Note 9'] });
      expect(d.resumen).toBe('Pantalla dañada');
      expect(sent!.url).toMatch(/\/v1\/messages/);
      expect(sent!.headers['x-api-key'] ?? sent!.headers['authorization']).toContain('sk-ant-prueba');
      expect(sent!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(sent!.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
      expect(sent!.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
      expect((sent!.body.output_config as { format: { type: string } }).format.type).toBe('json_schema');

      fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
      const err = await ai.aiDiagnose({ brand: 'a', model: 'b', issue: 'c', condition: '', notes: '', catalogParts: [] }).catch((e) => e);
      expect(ai.aiErrorMessage(err)).toMatch(/clave de API de Claude no es válida/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('marcas y modelos', () => {
  it('normaliza marcas, reconoce sub-marcas y agrupa modelos sin repetir', async () => {
    const b = await import('../lib/brands');
    expect(b.canonicalBrand('samsung')).toBe('Samsung');
    expect(b.canonicalBrand('SAMSUNG ')).toBe('Samsung');
    expect(b.canonicalBrand('Redmi')).toBe('Xiaomi');
    expect(b.canonicalBrand('iphone')).toBe('Apple');
    expect(b.canonicalBrand('marca rara')).toBe('Marca rara');
    expect(b.brandFromText('iPhone 14 Pro Max 128GB')).toBe('Apple');
    expect(b.brandFromText('Samsung Galaxy S25 Ultra')).toBe('Samsung');
    expect(b.brandFromText('Cargador tipo C')).toBe('');
    const m = b.buildBrandModels([
      { brand: 'samsung', model: 'galaxy A35' }, { brand: 'Samsung', model: 'Galaxy  A35' }, { brand: 'SAMSUNG', model: 'Galaxy A05' },
      { brand: 'redmi', model: 'Note 9' }, { brand: 'Xiaomi', model: 'Note 13' },
    ]);
    expect(m.get('Samsung')).toEqual(['Galaxy A05', 'Galaxy A35']);
    expect(m.get('Xiaomi')).toEqual(['Note 9', 'Note 13']); // orden numérico
    expect(b.matchesBrand('Samsung', 'samsung')).toBe(true);
    expect(b.matchesModel('Galaxy A35', 'galaxy  a35')).toBe(true);
    expect(b.matchesBrand('', 'cualquiera')).toBe(true);
  });
});
