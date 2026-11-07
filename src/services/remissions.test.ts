import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Invoice, PhoneUnit, Product, Remission } from '../lib/types';
import { openSession } from './cash';
import { saveProduct } from './inventory';
import { registerUnits } from './phones';
import { createInvoice, voidInvoice } from './billing';
import { createRemission, invoiceItemsFromRemission, pendingQty, remissionPendingValue, returnRemission } from './remissions';

const actor = { uid: 'u1', name: 'Jairo' };
const IMEI = '490154203237518';
beforeEach(() => (backend as LocalBackend).reset());

const base = { brand: '', model: '', color: '', minStock: 0, warrantyMonths: 0, line: 'Accesorios', active: true };
async function setup() {
  const vidrio = await saveProduct(actor, { ...base, sku: 'ACC-0001', type: 'ACCESORIO', name: 'Vidrio templado', cost: 2000, price: 10000, stock: 20 });
  const cel = await saveProduct(actor, { ...base, sku: 'CEL-0001', type: 'EQUIPO', name: 'Samsung A15', cost: 400000, price: 520000, stock: 0, line: 'Equipos' });
  await registerUnits(actor, cel, [{ imei: IMEI, condition: 'NUEVO' }], { cost: 400000, supplierName: 'Nano', note: '', alreadyInStock: false });
  return { vidrio, cel };
}
const stock = async (id: string) => (await backend.get<Product>('products', id))!.stock;
const recipient = { name: 'Local El Centro', phone: '300', document: '900', address: 'Cra 8' };

describe('remisiones (consignación)', () => {
  it('remisionar saca del inventario; devolver regresa; vender factura sin descontar otra vez', async () => {
    const { vidrio, cel } = await setup();
    const r = await createRemission(actor, { recipient, note: '', items: [
      { productId: vidrio, name: 'Vidrio templado', qty: 10, unitPrice: 9000 },
      { productId: cel, name: 'Samsung A15', qty: 1, unitPrice: 500000, unitId: IMEI },
    ] });
    expect(r.number).toBe(1);
    expect(await stock(vidrio)).toBe(10);
    expect(await stock(cel)).toBe(0);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!).toMatchObject({ status: 'remisionado', remissionNumber: 1, remissionTo: 'Local El Centro' });
    expect(remissionPendingValue(r)).toBe(590000);

    // no se puede vender el celular remisionado en una venta normal
    await openSession(actor, 0);
    await expect(createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T',
      items: [{ productId: cel, description: 'Samsung A15', kind: 'producto', qty: 1, unitPrice: 520000, unitCost: 400000, unitId: IMEI }],
      payments: [{ method: 'Efectivo', amount: 520000 }],
    })).rejects.toThrow(/remisionado/);

    // devuelven 3 vidrios
    const vLine = r.items.find((i) => i.productId === vidrio)!;
    await returnRemission(actor, r.id, [{ lineId: vLine.lineId, qty: 3 }]);
    expect(await stock(vidrio)).toBe(13);
    await expect(returnRemission(actor, r.id, [{ lineId: vLine.lineId, qty: 8 }])).rejects.toThrow(/quedan 7/);

    // vendieron 7 vidrios y el celular → factura
    let rem = (await backend.get<Remission>('remissions', r.id))!;
    const cLine = rem.items.find((i) => i.unitId)!;
    const items = invoiceItemsFromRemission(rem, [{ lineId: vLine.lineId, qty: 7 }, { lineId: cLine.lineId, qty: 1 }]);
    const inv = await createInvoice(actor, {
      customerId: undefined, customer: recipient, items, discount: 0, taxRate: 0, cashierName: 'T', remissionId: r.id,
      payments: [{ method: 'Transferencia', amount: 563000 }],
    });
    expect(await stock(vidrio)).toBe(13); // no descuenta otra vez
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.status).toBe('vendido');
    rem = (await backend.get<Remission>('remissions', r.id))!;
    expect(rem.status).toBe('liquidada');
    expect(rem.items.every((i) => pendingQty(i) === 0)).toBe(true);
    expect(rem.invoices[0]).toMatchObject({ number: inv.number, total: 563000 });
    const income = (await backend.list<CashMovement>('cashMovements')).filter((m) => m.category === 'venta');
    expect(income[0]).toMatchObject({ amount: 563000, method: 'Transferencia' });

    // anular la factura: lo vendido vuelve a quedar pendiente en la remisión, sin tocar el stock
    await voidInvoice(actor, inv.id, 'error');
    rem = (await backend.get<Remission>('remissions', r.id))!;
    expect(rem.status).toBe('abierta');
    expect(rem.items.find((i) => i.lineId === vLine.lineId)!.sold).toBe(0);
    expect(await stock(vidrio)).toBe(13);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.status).toBe('remisionado');
    expect((await backend.get<Invoice>('invoices', inv.id))!.status).toBe('anulada');
  });

  it('valida destinatario, stock e IMEI', async () => {
    const { vidrio, cel } = await setup();
    await expect(createRemission(actor, { recipient: { ...recipient, name: '' }, note: '', items: [{ productId: vidrio, name: 'V', qty: 1, unitPrice: 1 }] })).rejects.toThrow(/quién/);
    await expect(createRemission(actor, { recipient, note: '', items: [{ productId: vidrio, name: 'V', qty: 25, unitPrice: 1 }] })).rejects.toThrow(/insuficiente/);
    await expect(createRemission(actor, { recipient, note: '', items: [{ productId: cel, name: 'C', qty: 1, unitPrice: 1 }] })).rejects.toThrow(/IMEI/);
    expect(await backend.list('remissions')).toHaveLength(0);
  });
});
