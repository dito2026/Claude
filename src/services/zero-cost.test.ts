import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Invoice, PhoneUnit, Product } from '../lib/types';
import { applyCostToZeroSales, createInvoice, invoiceCost, zeroCostSales } from './billing';
import { openSession } from './cash';
import { receiveStock, saveProduct } from './inventory';
import { registerUnits } from './phones';
import { saveSeller } from './sellers';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, active: true };
const customer = { name: 'CF', phone: '', document: '' };

describe('ventas sin costo', () => {
  it('el costo escrito en la venta queda en la factura y en el producto', async () => {
    await openSession(actor, 0);
    const pid = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Forro', cost: 0, price: 20000, stock: 5, line: 'Accesorios' }));
    const r = await createInvoice(actor, { customer, discount: 0, taxRate: 0, cashierName: 'T', payments: [{ method: 'Efectivo', amount: 20000 }],
      items: [{ productId: pid, description: 'Forro', kind: 'producto', qty: 1, unitPrice: 20000, unitCost: 7000 }] });
    expect(invoiceCost((await backend.get<Invoice>('invoices', r.id))!)).toBe(7000);
    expect((await backend.get<Product>('products', pid))!.cost).toBe(7000);
    // un producto que ya tenía costo no se cambia desde la venta
    await createInvoice(actor, { customer, discount: 0, taxRate: 0, cashierName: 'T', payments: [{ method: 'Efectivo', amount: 20000 }],
      items: [{ productId: pid, description: 'Forro', kind: 'producto', qty: 1, unitPrice: 20000, unitCost: 9000 }] });
    expect((await backend.get<Product>('products', pid))!.cost).toBe(7000);
  });

  it('las ventas que quedaron en $0 se corrigen después (ganancia, comisión y equipo vendido)', async () => {
    await openSession(actor, 0);
    const sellerId = String(await saveSeller(actor, { name: 'Ana', phone: '', active: true, commissionPct: 10, commissionBase: 'utilidad', lines: [] }));
    const pid = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Vidrio', cost: 0, price: 10000, stock: 5, line: 'Accesorios' }));
    const cel = String(await saveProduct(actor, { ...base, sku: 'C-1', type: 'EQUIPO', name: 'A15', cost: 0, price: 500000, stock: 0, line: 'Equipos' }));
    await registerUnits(actor, cel, [{ imei: '490154203237518', condition: 'NUEVO' }], { cost: 0, supplierName: '', note: '', alreadyInStock: false });
    const a = await createInvoice(actor, { customer, discount: 0, taxRate: 0, cashierName: 'T', sellerId, payments: [{ method: 'Efectivo', amount: 520000 }],
      items: [
        { productId: pid, description: 'Vidrio', kind: 'producto', qty: 2, unitPrice: 10000, unitCost: 0 },
        { productId: cel, description: 'A15', kind: 'producto', qty: 1, unitPrice: 500000, unitCost: 0, unitId: '490154203237518', imei: '490154203237518' },
      ] });
    const voided = await createInvoice(actor, { customer, discount: 0, taxRate: 0, cashierName: 'T', payments: [{ method: 'Efectivo', amount: 10000 }],
      items: [{ productId: pid, description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 10000, unitCost: 0 }] });
    await backend.update('invoices', voided.id, { status: 'anulada' });
    let inv = (await backend.get<Invoice>('invoices', a.id))!;
    expect(inv.commission).toBe(52000);
    const all = await backend.list<Invoice>('invoices');
    expect(zeroCostSales(all, pid).map((i) => i.id)).toEqual([a.id]);
    expect(zeroCostSales(all, cel).map((i) => i.id)).toEqual([a.id]);

    await receiveStock(actor, pid, 10, 3000, 'proveedor');
    const n = await applyCostToZeroSales(actor, [{ productId: pid, cost: 3000 }, { productId: cel, cost: 400000 }], [a.id]);
    expect(n).toBe(1);
    inv = (await backend.get<Invoice>('invoices', a.id))!;
    expect(inv.items.map((i) => i.unitCost)).toEqual([3000, 400000]);
    expect(inv.commission).toBe(Math.round((520000 - 406000) * 0.1));
    expect(inv.costEdits![0]).toMatchObject({ commission: 52000, items: [{ index: 0, unitCost: 0 }, { index: 1, unitCost: 0 }] });
    expect((await backend.get<PhoneUnit>('phoneUnits', '490154203237518'))!.cost).toBe(400000);
    expect(zeroCostSales(await backend.list<Invoice>('invoices'), pid)).toHaveLength(0);
  });
});
