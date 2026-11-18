import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Invoice, PhoneUnit, Product, Purchase, Supplier } from '../lib/types';
import { createInvoice, invoiceCost } from './billing';
import { saveSeller } from './sellers';
import { createPurchase, editPurchase, paySupplier, saveSupplier } from './purchases';
import { openSession } from './cash';
import { saveProduct } from './inventory';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, active: true, price: 0 };

async function setup() {
  await openSession(actor, 0);
  const sid = String(await saveSupplier(actor, { name: 'Nano', nit: '', phone: '', termDays: 30, notes: '', active: true }));
  const supplier = { ...(await backend.get<Supplier>('suppliers', sid))!, id: sid };
  const vid = String(await saveProduct(actor, { ...base, sku: 'ACC-1', type: 'ACCESORIO', name: 'Vidrio', cost: 2000, stock: 0, line: 'Accesorios' }));
  const cel = String(await saveProduct(actor, { ...base, sku: 'CEL-1', type: 'EQUIPO', name: 'A15', cost: 0, stock: 0, line: 'Equipos' }));
  const { id } = await createPurchase(actor, {
    supplier, paymentType: 'credito', method: '', invoiceRef: 'F-1', note: '', updateCost: false,
    items: [
      { productId: vid, name: 'Vidrio', qty: 10, unitCost: 2000 },
      { productId: cel, name: 'A15', qty: 1, unitCost: 400000, units: [{ imei: '490154203237518', condition: 'NUEVO' }] },
      { productId: '', name: 'Display libre', qty: 1, unitCost: 50000 },
    ],
  });
  return { id, vid, cel, supplier };
}
const lines = (p: Purchase) => p.items.map((it, index) => ({ index, name: it.name, qty: it.qty, unitCost: it.unitCost }));

describe('editar una compra', () => {
  it('corrige cantidad (stock), costo, nombre y quita líneas; recalcula total y guarda historial', async () => {
    const { id, vid, cel } = await setup();
    let p = (await backend.get<Purchase>('purchases', id))!;
    expect(p.total).toBe(470000);
    const l = lines(p);
    l[0] = { ...l[0], qty: 12, unitCost: 2500 };       // 2 más al stock y otro costo
    l[1] = { ...l[1], unitCost: 380000 };               // celular: solo costo
    l[2] = { ...l[2], qty: 0 };                         // quitar el artículo libre
    await expect(editPurchase(actor, id, { lines: l, invoiceRef: 'F-1', note: '', updateCost: true }, '')).rejects.toThrow(/motivo/);
    await editPurchase(actor, id, { lines: l, invoiceRef: 'F-2', note: 'ok', updateCost: true }, 'factura real');
    p = (await backend.get<Purchase>('purchases', id))!;
    expect(p.total).toBe(12 * 2500 + 380000);
    expect(p.items).toHaveLength(2);
    expect(p.invoiceRef).toBe('F-2');
    expect(p.edits![0]).toMatchObject({ by: 'Jairo', reason: 'factura real', total: 470000 });
    expect((await backend.get<Product>('products', vid))!).toMatchObject({ stock: 12, cost: 2500 });
    expect((await backend.get<PhoneUnit>('phoneUnits', '490154203237518'))!.cost).toBe(380000);
    expect((await backend.get<Product>('products', cel))!.stock).toBe(1);
  });

  it('no deja cambiar cantidad de celulares, ni quitar stock que no hay, ni quedar pagado de más', async () => {
    const { id, vid, supplier } = await setup();
    const p = (await backend.get<Purchase>('purchases', id))!;
    const bad = lines(p); bad[1] = { ...bad[1], qty: 2 };
    await expect(editPurchase(actor, id, { lines: bad, invoiceRef: '', note: '', updateCost: false }, 'x')).rejects.toThrow(/IMEI/);
    await backend.update('products', vid, { stock: 3 }); // se vendieron 7
    const less = lines(p); less[0] = { ...less[0], qty: 2 };
    await expect(editPurchase(actor, id, { lines: less, invoiceRef: '', note: '', updateCost: false }, 'x')).rejects.toThrow(/solo hay 3/);
    await paySupplier(actor, supplier, [id], 450000, 'Efectivo');
    const cheap = lines(p); cheap[1] = { ...cheap[1], unitCost: 100000 };
    await expect(editPurchase(actor, id, { lines: cheap, invoiceRef: '', note: '', updateCost: false }, 'x')).rejects.toThrow(/Corrija primero el pago/);
  });

  it('al corregir el costo, las ventas ya hechas recalculan ganancia y comisión sobre utilidad', async () => {
    const { id, vid, cel, supplier } = await setup();
    const sellerId = String(await saveSeller(actor, { name: 'Guillermo', phone: '', active: true, commissionPct: 10, commissionBase: 'utilidad', lines: [] }));
    const sale = await createInvoice(actor, {
      customer: { name: 'Cliente', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T', sellerId,
      items: [
        { productId: cel, description: 'A15', kind: 'producto', qty: 1, unitPrice: 600000, unitCost: 400000, unitId: '490154203237518', imei: '490154203237518' },
        { productId: vid, description: 'Vidrio', kind: 'producto', qty: 3, unitPrice: 10000, unitCost: 2000 },
      ],
      payments: [{ method: 'Efectivo', amount: 630000 }],
    });
    let inv = (await backend.get<Invoice>('invoices', sale.id))!;
    expect(inv.commission).toBe(Math.round((630000 - 406000) * 0.1));
    // Una compra posterior del vidrio: sus ventas no deben tocarse
    await createPurchase(actor, { supplier, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false,
      items: [{ productId: vid, name: 'Vidrio', qty: 5, unitCost: 2000 }] });
    const later = await createInvoice(actor, {
      customer: { name: 'Otro', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T',
      items: [{ productId: vid, description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 10000, unitCost: 2000 }],
      payments: [{ method: 'Efectivo', amount: 10000 }],
    });

    const p = (await backend.get<Purchase>('purchases', id))!;
    const l = lines(p);
    l[0] = { ...l[0], unitCost: 1500 };
    l[1] = { ...l[1], unitCost: 350000 };
    const r = await editPurchase(actor, id, { lines: l, invoiceRef: '', note: '', updateCost: false }, 'costo real');
    expect(r.salesFixed).toBe(1);
    inv = (await backend.get<Invoice>('invoices', sale.id))!;
    expect(inv.items.map((i) => i.unitCost)).toEqual([350000, 1500]);
    expect(invoiceCost(inv)).toBe(354500);
    expect(inv.commission).toBe(Math.round((630000 - 354500) * 0.1));
    expect(inv.costEdits![0]).toMatchObject({ by: 'Jairo', items: [{ index: 0, unitCost: 400000 }, { index: 1, unitCost: 2000 }] });
    expect((await backend.get<PhoneUnit>('phoneUnits', '490154203237518'))!.cost).toBe(350000);
    expect((await backend.get<Invoice>('invoices', later.id))!.items[0].unitCost).toBe(2000);

    // Si una venta quedó con el costo viejo (corrección hecha antes), guardar la compra sin cambios lo arregla
    await backend.update('invoices', sale.id, { items: inv.items.map((i) => ({ ...i, unitCost: i.unitId ? 400000 : 2000 })) });
    const again = await editPurchase(actor, id, { lines: lines((await backend.get<Purchase>('purchases', id))!), invoiceRef: '', note: '', updateCost: false }, 'recalcular');
    expect(again.salesFixed).toBe(1);
    expect((await backend.get<Invoice>('invoices', sale.id))!.items.map((i) => i.unitCost)).toEqual([350000, 1500]);
  });
});
