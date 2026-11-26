import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Product, Purchase, Supplier } from '../lib/types';
import { openSession } from './cash';
import { saveProduct } from './inventory';
import { buyFreeItem, createPurchase, saveSupplier, supplierItems, voidPurchase } from './purchases';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, active: true, price: 0 };
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('lo que se le ha comprado a un proveedor', () => {
  it('agrupa por artículo; repuestos = tipo REPUESTO o libre comprado para una OT; sin anuladas', async () => {
    await openSession(actor, 0);
    const sid = String(await saveSupplier(actor, { name: 'Pepe', nit: '', phone: '', termDays: 30, notes: '', active: true }, undefined, 100000));
    const s = { ...(await backend.get<Supplier>('suppliers', sid))!, id: sid };
    const pant = String(await saveProduct(actor, { ...base, sku: 'R-1', type: 'REPUESTO', name: 'Pantalla A12', cost: 0, stock: 0, line: 'Servicio técnico' }));
    const forro = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Forro A12', cost: 0, stock: 0, line: 'Accesorios' }));
    const buy = (items: { productId: string; name: string; qty: number; unitCost: number }[]) =>
      createPurchase(actor, { supplier: s, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false, items });
    await buy([{ productId: pant, name: 'Pantalla A12', qty: 2, unitCost: 45000 }, { productId: forro, name: 'Forro A12', qty: 5, unitCost: 3000 }]);
    await tick();
    await buy([{ productId: pant, name: 'Pantalla A12', qty: 1, unitCost: 48000 }]);
    await tick();
    await buyFreeItem(actor, s, { name: 'Flex de carga Moto G9', qty: 1, unitCost: 20000 }, { paymentType: 'credito', method: '', note: 'Repuesto para OT 12' });
    await tick();
    await buy([{ productId: '', name: 'bateria y9 2019', qty: 1, unitCost: 25000 }, { productId: '', name: 'Cargador iPhone', qty: 1, unitCost: 12000 }]);
    const x = await buy([{ productId: pant, name: 'Pantalla A12', qty: 9, unitCost: 1 }]);
    await voidPurchase(actor, x.id, 'error');

    const products = new Map((await backend.list<Product>('products')).map((p) => [p.id, p]));
    const rows = supplierItems(sid, await backend.list<Purchase>('purchases'), products);
    expect(rows.map((r) => r.name)).toEqual(['bateria y9 2019', 'Cargador iPhone', 'Flex de carga Moto G9', 'Pantalla A12', 'Forro A12']);
    // sin inventario y sin OT: es repuesto por el nombre (batería sí, cargador no)
    expect(rows.find((r) => r.name === 'bateria y9 2019')).toMatchObject({ type: 'libre', isPart: true });
    expect(rows.find((r) => r.name === 'Cargador iPhone')).toMatchObject({ type: 'libre', isPart: false });
    expect(rows.find((r) => r.name === 'Pantalla A12')).toMatchObject({ type: 'REPUESTO', isPart: true, times: 2, qty: 3, total: 138000, lastCost: 48000, minCost: 45000, maxCost: 48000 });
    expect(rows.find((r) => r.name === 'Flex de carga Moto G9')).toMatchObject({ type: 'libre', isPart: true, qty: 1, lastCost: 20000 });
    expect(rows.find((r) => r.name === 'Forro A12')).toMatchObject({ type: 'ACCESORIO', isPart: false, qty: 5 });
  });
});
