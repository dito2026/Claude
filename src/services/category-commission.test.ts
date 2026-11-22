import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Invoice, Product, Seller } from '../lib/types';
import { createInvoice, fixInvoiceCosts } from './billing';
import { openSession } from './cash';
import { saveProduct } from './inventory';
import { registerUnits } from './phones';
import { commissionLabel, computeCommission, saveSeller, sellerSalesDetail } from './sellers';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, active: true };

describe('comisión de vendedores por categoría', () => {
  it('cada categoría con su % y base; las demás con la general; 0 = no gana', async () => {
    await openSession(actor, 0);
    const sid = String(await saveSeller(actor, {
      name: 'Guillermo Villa', phone: '', active: true, commissionPct: 2, commissionBase: 'venta', lines: [],
      categoryRates: { Celulares: { pct: 1, base: 'utilidad' }, Cargadores: { pct: 10, base: 'venta' }, 'Vidrios y protectores': { pct: 0, base: 'venta' }, '': { pct: 5, base: 'venta' } },
    }));
    const seller = { ...(await backend.get<Seller>('sellers', sid))!, id: sid };
    expect(Object.keys(seller.categoryRates!)).toEqual(['Celulares', 'Cargadores', 'Vidrios y protectores']); // la vacía se descarta
    expect(commissionLabel(seller)).toBe('2% sobre la venta · con % por categoría');

    const cel = String(await saveProduct(actor, { ...base, sku: 'C-1', type: 'EQUIPO', name: 'Redmi 13C', cost: 0, price: 500000, stock: 0, line: 'Equipos' }));
    await registerUnits(actor, cel, [{ imei: '490154203237518', condition: 'NUEVO' }], { cost: 400000, supplierName: '', note: '', alreadyInStock: false });
    const car = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Cargador tipo C', cost: 8000, price: 20000, stock: 5, line: 'Accesorios' }));
    const vid = String(await saveProduct(actor, { ...base, sku: 'A-2', type: 'ACCESORIO', name: 'Vidrio templado', cost: 1500, price: 10000, stock: 5, line: 'Accesorios' }));
    const cab = String(await saveProduct(actor, { ...base, sku: 'A-3', type: 'ACCESORIO', name: 'Cable USB tipo C', cost: 5000, price: 15000, stock: 5, line: 'Accesorios' }));
    const items = [
      { productId: cel, description: 'Redmi 13C', kind: 'producto' as const, qty: 1, unitPrice: 500000, unitCost: 400000, unitId: '490154203237518', imei: '490154203237518' },
      { productId: car, description: 'Cargador tipo C', kind: 'producto' as const, qty: 1, unitPrice: 20000, unitCost: 8000 },
      { productId: vid, description: 'Vidrio templado', kind: 'producto' as const, qty: 1, unitPrice: 10000, unitCost: 1500 },
      { productId: cab, description: 'Cable USB tipo C', kind: 'producto' as const, qty: 1, unitPrice: 15000, unitCost: 5000 },
    ];
    const products = new Map((await backend.list<Product>('products')).map((p) => [p.id, p]));
    // celular 1% de la ganancia 100.000 = 1.000 · cargador 10% de 20.000 = 2.000 · vidrio 0 · cable (general) 2% de 15.000 = 300
    expect(computeCommission(seller, items, 0, products)).toBe(3300);

    const r = await createInvoice(actor, { customer: { name: 'CF', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T', sellerId: sid,
      payments: [{ method: 'Efectivo', amount: 545000 }], items });
    let inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.commission).toBe(3300);
    expect(inv.commissionRates).toEqual(seller.categoryRates);
    expect(sellerSalesDetail(sid, [inv], undefined, products).sort((a, b) => a.description.localeCompare(b.description)).map((l) => [l.description, l.commission]))
      .toEqual([['Cable USB tipo C', 300], ['Cargador tipo C', 2000], ['Redmi 13C', 1000], ['Vidrio templado', 0]]);

    // si se corrige el costo del celular, la comisión sobre la ganancia se recalcula con el % de la categoría
    await fixInvoiceCosts(actor, r.id, { 0: 350000 }, 'costo real');
    inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.commission).toBe(1500 + 2000 + 300);
  });

  it('sin % por categoría sigue igual que antes', () => {
    const items = [{ description: 'x', kind: 'producto' as const, qty: 1, unitPrice: 100000, unitCost: 60000 }];
    expect(computeCommission({ commissionPct: 10, commissionBase: 'utilidad' }, items, 0, new Map())).toBe(4000);
    expect(computeCommission({ commissionPct: 5, commissionBase: 'venta' }, items, 10000, new Map())).toBe(4500);
  });
});
