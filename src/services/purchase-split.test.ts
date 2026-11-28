import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Product, Purchase, Supplier } from '../lib/types';
import { expectedByMethod, openSession } from './cash';
import { saveProduct } from './inventory';
import { createPurchase, saveSupplier, voidPurchase } from './purchases';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, active: true, price: 0 };
const cash = async () => expectedByMethod({ openingCash: 500000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);

async function setup() {
  await openSession(actor, 500000);
  const sid = String(await saveSupplier(actor, { name: 'Maxel', nit: '', phone: '', termDays: 30, notes: '', active: true }));
  const s = { ...(await backend.get<Supplier>('suppliers', sid))!, id: sid };
  const car = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Cargador tipo C', cost: 9000, stock: 1, line: 'Accesorios' }));
  return { s, car };
}

describe('compras: varios medios de pago y el mismo producto a distinto precio', () => {
  it('el mismo producto en dos líneas con distinto costo suma todo al stock', async () => {
    const { s, car } = await setup();
    const r = await createPurchase(actor, { supplier: s, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: true,
      items: [{ productId: car, name: 'Cargador tipo C', qty: 3, unitCost: 10000 }, { productId: car, name: 'Cargador tipo C', qty: 2, unitCost: 12000 }] });
    expect(r.total).toBe(54000);
    expect((await backend.get<Product>('products', car))!.stock).toBe(6);
    const p = (await backend.get<Purchase>('purchases', r.id))!;
    expect(p.items.map((i) => [i.qty, i.unitCost])).toEqual([[3, 10000], [2, 12000]]);
    await voidPurchase(actor, r.id, 'prueba');
    expect((await backend.get<Product>('products', car))!.stock).toBe(1);
  });

  it('de contado con varios medios: cada medio sale de la caja y deben sumar el total', async () => {
    const { s, car } = await setup();
    const draft = { supplier: s, paymentType: 'contado' as const, method: 'Efectivo', invoiceRef: '', note: '', updateCost: false,
      items: [{ productId: car, name: 'Cargador tipo C', qty: 5, unitCost: 10000 }] };
    await expect(createPurchase(actor, { ...draft, payments: [{ method: 'Efectivo', amount: 30000 }, { method: 'Nequi', amount: 10000 }] })).rejects.toThrow(/no suman el total/);
    await expect(createPurchase(actor, { ...draft, payments: [{ method: 'Efectivo', amount: 30000 }, { method: '', amount: 20000 }] })).rejects.toThrow(/medio/);
    const r = await createPurchase(actor, { ...draft, payments: [{ method: 'Efectivo', amount: 30000 }, { method: 'Nequi', amount: 20000 }, { method: '', amount: 0 }] });
    const p = (await backend.get<Purchase>('purchases', r.id))!;
    expect(p).toMatchObject({ status: 'pagada', paid: 50000 });
    expect(p.payments.map((x) => [x.method, x.amount])).toEqual([['Efectivo', 30000], ['Nequi', 20000]]);
    expect(await cash()).toMatchObject({ Efectivo: 470000, Nequi: -20000 });
    // al anular vuelve a la caja por cada medio
    await voidPurchase(actor, r.id, 'error');
    expect(await cash()).toMatchObject({ Efectivo: 500000, Nequi: 0 });
  });

  it('de contado con un solo medio sigue igual', async () => {
    const { s, car } = await setup();
    await createPurchase(actor, { supplier: s, paymentType: 'contado', method: 'Nequi', invoiceRef: '', note: '', updateCost: false,
      items: [{ productId: car, name: 'Cargador tipo C', qty: 1, unitCost: 10000 }] });
    expect(await cash()).toMatchObject({ Efectivo: 500000, Nequi: -10000 });
  });
});
