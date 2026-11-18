import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Purchase, Supplier } from '../lib/types';
import { addMovement, expectedByMethod, openSession } from './cash';
import { createPurchase, editSupplierPayment, guessSupplier, linkCashPayment, paySupplier, saveSupplier, supplierPayments, supplierSummary, unlinkedCashPayments, voidPurchase } from './purchases';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());

async function setup() {
  await openSession(actor, 1000000);
  const id = String(await saveSupplier(actor, { name: 'Pepe', nit: '', phone: '', termDays: 30, notes: '', active: true }));
  const pepe = { ...(await backend.get<Supplier>('suppliers', id))!, id };
  const otherId = String(await saveSupplier(actor, { name: 'Distribuidora Pepe Celulares', nit: '', phone: '', termDays: 30, notes: '', active: true }));
  const c1 = await createPurchase(actor, { supplier: pepe, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false,
    items: [{ productId: '', name: 'Pantallas', qty: 1, unitCost: 300000 }] });
  const c2 = await createPurchase(actor, { supplier: pepe, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false,
    items: [{ productId: '', name: 'Baterías', qty: 1, unitCost: 200000 }] });
  return { pepe, otherId, c1: c1.id, c2: c2.id };
}
const cash = async () => expectedByMethod({ openingCash: 1000000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);

describe('pagos a proveedor hechos desde Caja con texto', () => {
  it('se descuentan de la deuda sin volver a sacar plata de la caja', async () => {
    const { pepe, c1, c2 } = await setup();
    await addMovement(actor, { direction: 'egreso', category: 'pago_proveedor', method: 'Efectivo', amount: 350000, description: 'Abono a pepe', refType: 'manual' });
    let movs = await backend.list<CashMovement>('cashMovements');
    const [m] = unlinkedCashPayments(movs);
    expect(m.amount).toBe(350000);
    expect(await cash()).toMatchObject({ Efectivo: 650000 });
    expect(supplierSummary(pepe, await backend.list<Purchase>('purchases')).owed).toBe(500000);

    const r = await linkCashPayment(actor, m.id, pepe.id);
    expect(r.applied).toHaveLength(2);
    const p1 = (await backend.get<Purchase>('purchases', c1))!;
    const p2 = (await backend.get<Purchase>('purchases', c2))!;
    expect(p1).toMatchObject({ paid: 300000, status: 'pagada' });
    expect(p2).toMatchObject({ paid: 50000, status: 'parcial' });
    expect(p1.payments[0]).toMatchObject({ amount: 300000, method: 'Efectivo', cashMovementId: m.id, at: m.createdAt });
    expect(supplierSummary(pepe, await backend.list<Purchase>('purchases')).owed).toBe(150000);
    expect(await cash()).toMatchObject({ Efectivo: 650000 }); // la caja no cambia
    movs = await backend.list<CashMovement>('cashMovements');
    expect(unlinkedCashPayments(movs)).toHaveLength(0);
    await expect(linkCashPayment(actor, m.id, pepe.id)).rejects.toThrow(/ya está aplicado/);
  });

  it('no deja descontar más de lo que se debe', async () => {
    const { pepe } = await setup();
    await addMovement(actor, { direction: 'egreso', category: 'pago_proveedor', method: 'Nequi', amount: 600000, description: 'pepe', refType: 'manual' });
    const [m] = unlinkedCashPayments(await backend.list<CashMovement>('cashMovements'));
    await expect(linkCashPayment(actor, m.id, pepe.id)).rejects.toThrow(/la deuda con Pepe es de 500/);
  });

  it('adivina el proveedor por el nombre escrito (el más largo que coincida)', async () => {
    const { pepe, otherId } = await setup();
    const suppliers = await backend.list<Supplier>('suppliers');
    expect(guessSupplier({ description: 'Abono a PEPE' }, suppliers)?.id).toBe(pepe.id);
    expect(guessSupplier({ description: 'pago distribuidora pepe celulares factura 9' }, suppliers)?.id).toBe(otherId);
    expect(guessSupplier({ description: 'arriendo' }, suppliers)).toBeUndefined();
  });

  it('el pago de Caja se aplica a la compra escogida (no a la más antigua)', async () => {
    const { pepe, c1, c2 } = await setup();
    await addMovement(actor, { direction: 'egreso', category: 'pago_proveedor', method: 'Efectivo', amount: 200000, description: 'pepe edge', refType: 'manual' });
    const [m] = unlinkedCashPayments(await backend.list<CashMovement>('cashMovements'));
    await linkCashPayment(actor, m.id, pepe.id, c2);
    expect((await backend.get<Purchase>('purchases', c2))!).toMatchObject({ paid: 200000, status: 'pagada' });
    expect((await backend.get<Purchase>('purchases', c1))!.paid || 0).toBe(0);
  });
});

describe('abonar a una compra escogida y pagos por fuera de la caja', () => {
  it('abono a la compra escogida; «fuera de la caja» baja la deuda sin mover la caja, se corrige y se anula sin tocar la caja', async () => {
    const { pepe, c1, c2 } = await setup();
    await paySupplier(actor, pepe, [c1, c2], 200000, 'Efectivo', { first: c2 });
    expect((await backend.get<Purchase>('purchases', c2))!.status).toBe('pagada');
    expect(await cash()).toMatchObject({ Efectivo: 800000 });

    await paySupplier(actor, pepe, [c1], 100000, 'Nequi', { outsideCash: true });
    expect(await cash()).toMatchObject({ Efectivo: 800000, Nequi: 0 });
    let p1 = (await backend.get<Purchase>('purchases', c1))!;
    expect(p1).toMatchObject({ paid: 100000, status: 'parcial' });
    expect(p1.payments[0]).toMatchObject({ outsideCash: true, amount: 100000 });
    expect(supplierPayments(await backend.list<Purchase>('purchases'), pepe.id).map((r) => r.source).sort()).toEqual(['caja', 'fuera']);

    await editSupplierPayment(actor, c1, 0, { amount: 120000, method: 'Nequi' }, 'era más');
    expect(await cash()).toMatchObject({ Efectivo: 800000, Nequi: 0 });
    p1 = (await backend.get<Purchase>('purchases', c1))!;
    expect(p1.paid).toBe(120000);

    await voidPurchase(actor, c1, 'error');
    expect(await cash()).toMatchObject({ Efectivo: 800000, Nequi: 0 });
  });
});
