import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Product, StockMovement } from '../lib/types';
import { archiveProduct, isLowStock, restoreProduct, saveProduct } from './inventory';
import { registerUnits } from './phones';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 5, warrantyMonths: 0, line: 'Accesorios', active: true, cost: 2000, price: 10000 };

describe('eliminar productos del inventario', () => {
  it('da de baja el stock con ajuste, lo oculta y se puede recuperar', async () => {
    const id = await saveProduct(actor, { ...base, sku: 'ACC-1', type: 'ACCESORIO', name: 'Forro viejo', stock: 4 });
    await expect(archiveProduct(actor, id, ' ')).rejects.toThrow(/motivo/);
    await archiveProduct(actor, id, 'ya no se vende');
    const p = (await backend.get<Product>('products', id))!;
    expect(p).toMatchObject({ archived: true, active: false, stock: 0, archivedBy: 'Jairo', archiveReason: 'ya no se vende' });
    expect(isLowStock(p)).toBe(false);
    const k = (await backend.list<StockMovement>('stockMovements')).filter((m) => m.productId === id);
    expect(k[k.length - 1]).toMatchObject({ qty: -4, reason: 'ajuste' });
    await expect(archiveProduct(actor, id, 'otra vez')).rejects.toThrow(/ya está/);
    await restoreProduct(id);
    expect((await backend.get<Product>('products', id))!).toMatchObject({ archived: false, active: true, stock: 0 });
  });

  it('no deja eliminar un celular con IMEI en inventario', async () => {
    const id = await saveProduct(actor, { ...base, sku: 'CEL-1', type: 'EQUIPO', name: 'A15', stock: 0, line: 'Equipos' });
    await registerUnits(actor, id, [{ imei: '490154203237518', condition: 'NUEVO' }], { cost: 1, supplierName: '', note: '', alreadyInStock: false });
    await expect(archiveProduct(actor, id, 'x')).rejects.toThrow(/celular/);
  });
});
