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

describe('comisión de vendedores por línea (Equipos, Accesorios, Servicio técnico)', () => {
  it('cada línea con su % y base; las demás con la general; 0 = no gana', async () => {
    await openSession(actor, 0);
    const sid = String(await saveSeller(actor, {
      name: 'Guillermo Villa', phone: '', active: true, commissionPct: 2, commissionBase: 'venta', lines: [],
      categoryRates: { Equipos: { pct: 1, base: 'utilidad' }, Accesorios: { pct: 10, base: 'venta' }, Cargadores: { pct: 50, base: 'venta' } },
    }));
    const seller = { ...(await backend.get<Seller>('sellers', sid))!, id: sid };
    expect(Object.keys(seller.categoryRates!)).toEqual(['Equipos', 'Accesorios']); // solo las 3 líneas
    expect(commissionLabel(seller)).toBe('2% sobre la venta · con % por línea');

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
    // celular (Equipos) 1% de la ganancia 100.000 = 1.000 · accesorios 10% de 45.000 = 4.500
    expect(computeCommission(seller, items, 0, products)).toBe(5500);
    // mano de obra (Servicio técnico) sin % propio usa la general: 2% de 50.000 = 1.000
    expect(computeCommission(seller, [...items, { description: 'Mano de obra', kind: 'mano_obra', qty: 1, unitPrice: 50000, unitCost: 20000 }], 0, products)).toBe(6500);

    const r = await createInvoice(actor, { customer: { name: 'CF', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T', sellerId: sid,
      payments: [{ method: 'Efectivo', amount: 545000 }], items });
    let inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.commission).toBe(5500);
    expect(inv.commissionRates).toEqual(seller.categoryRates);
    expect(sellerSalesDetail(sid, [inv], undefined, products).sort((a, b) => a.description.localeCompare(b.description)).map((l) => [l.description, l.commission]))
      .toEqual([['Cable USB tipo C', 1500], ['Cargador tipo C', 2000], ['Redmi 13C', 1000], ['Vidrio templado', 1000]]);

    // si se corrige el costo del celular, la comisión sobre la ganancia se recalcula con el % de la categoría
    await fixInvoiceCosts(actor, r.id, { 0: 350000 }, 'costo real');
    inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.commission).toBe(1500 + 4500);
  });

  it('sin % por categoría sigue igual que antes', () => {
    const items = [{ description: 'x', kind: 'producto' as const, qty: 1, unitPrice: 100000, unitCost: 60000 }];
    expect(computeCommission({ commissionPct: 10, commissionBase: 'utilidad' }, items, 0, new Map())).toBe(4000);
    expect(computeCommission({ commissionPct: 5, commissionBase: 'venta' }, items, 10000, new Map())).toBe(4500);
  });

  it('«Gana comisión en» de antes pasa a 0% en las líneas no marcadas; facturas con % por categoría siguen calculando', async () => {
    const sid = String(await saveSeller(actor, { name: 'Ana', phone: '', active: true, commissionPct: 3, commissionBase: 'venta', lines: ['Equipos'] }));
    const s = (await backend.get<Seller>('sellers', sid))!;
    expect(s.lines).toEqual([]);
    expect(s.categoryRates).toEqual({ Accesorios: { pct: 0, base: 'venta' }, 'Servicio técnico': { pct: 0, base: 'venta' } });
    const items = [{ description: 'Cargador tipo C', kind: 'producto' as const, qty: 1, unitPrice: 20000, unitCost: 8000 }];
    expect(computeCommission({ commissionPct: 2, commissionBase: 'venta', categoryRates: { Cargadores: { pct: 10, base: 'venta' } } }, items, 0, new Map())).toBe(2000);
  });
});

describe('recalcular comisiones del mes con la configuración actual', () => {
  it('vista previa, aplica solo las que cambian, guarda la anterior y cambia lo que se le debe', async () => {
    const { commissionRecalcPreview, recalcCommissions, sellerBalance } = await import('./sellers');
    const { periodRange } = await import('./accounting');
    await openSession(actor, 0);
    const sid = String(await saveSeller(actor, { name: 'Guillermo Villa', phone: '', active: true, commissionPct: 2, commissionBase: 'venta', lines: [] }));
    const car = String(await saveProduct(actor, { ...base, sku: 'A-1', type: 'ACCESORIO', name: 'Cargador tipo C', cost: 8000, price: 20000, stock: 9, line: 'Accesorios' }));
    const sell = (it: object) => createInvoice(actor, { customer: { name: 'CF', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T', sellerId: sid,
      payments: [{ method: 'Efectivo', amount: 20000 }], items: [{ productId: car, description: 'Cargador tipo C', kind: 'producto', qty: 1, unitPrice: 20000, unitCost: 8000, ...it }] });
    const a = await sell({});
    await sell({});
    // venta de mano de obra (servicio técnico): no cambia con el % nuevo de accesorios
    await createInvoice(actor, { customer: { name: 'CF', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T', sellerId: sid,
      payments: [{ method: 'Efectivo', amount: 50000 }], items: [{ description: 'Mano de obra', kind: 'mano_obra', qty: 1, unitPrice: 50000, unitCost: 20000 }] });
    let invs = await backend.list<Invoice>('invoices');
    expect(invs.map((i) => i.commission).sort()).toEqual([1000, 400, 400]);

    // nueva configuración: accesorios 10% sobre la venta
    await saveSeller(actor, { name: 'Guillermo Villa', phone: '', active: true, commissionPct: 2, commissionBase: 'venta', lines: [], categoryRates: { Accesorios: { pct: 10, base: 'venta' } } }, sid);
    const seller = { ...(await backend.get<Seller>('sellers', sid))!, id: sid };
    const products = new Map((await backend.list<Product>('products')).map((p) => [p.id, p]));
    const rows = commissionRecalcPreview(seller, invs, products, periodRange('mes'));
    expect(rows.map((r) => [r.before, r.after]).sort()).toEqual([[1000, 1000], [400, 2000], [400, 2000]]);
    const r = await recalcCommissions(actor, sid, rows.filter((x) => x.after !== x.before).map((x) => x.invoice.id));
    expect(r).toEqual({ changed: 2, diff: 3200 });
    invs = await backend.list<Invoice>('invoices');
    const ia = invs.find((i) => i.id === a.id)!;
    expect(ia).toMatchObject({ commission: 2000, commissionRates: { Accesorios: { pct: 10, base: 'venta' } } });
    expect(ia.commissionEdits![0]).toMatchObject({ by: 'Jairo', commission: 400, pct: 2, base: 'venta' });
    expect(sellerBalance(seller, invs, []).owed).toBe(5000);
  });
});
