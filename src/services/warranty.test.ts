import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Invoice, PhoneUnit } from '../lib/types';
import { openSession } from './cash';
import { saveProduct } from './inventory';
import { registerUnits } from './phones';
import { createInvoice } from './billing';
import { warrantyLine } from '../components/Receipts';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const IMEI = '490154203237518';
const IMEI2 = '356938035643809';

async function setup() {
  await openSession(actor, 0);
  const pid = await saveProduct(actor, { sku: 'CEL-1', type: 'EQUIPO', name: 'Samsung A15', brand: 'Samsung', model: 'A15', color: '', cost: 400000, price: 520000, stock: 0, minStock: 0, warrantyMonths: 6, line: 'Equipos', active: true });
  await registerUnits(actor, String(pid), [{ imei: IMEI, condition: 'NUEVO' }, { imei: IMEI2, condition: 'USADO' }], { cost: 400000, supplierName: '', note: '', alreadyInStock: false });
  return String(pid);
}
const sell = (pid: string, imei: string, warrantyMonths?: number) => createInvoice(actor, {
  customer: { name: 'Laura', phone: '', document: '' }, discount: 0, taxRate: 0, cashierName: 'T',
  items: [{ productId: pid, description: 'Samsung A15', kind: 'producto', qty: 1, unitPrice: 520000, unitCost: 400000, imei, unitId: imei, ...(warrantyMonths != null ? { warrantyMonths } : {}) }],
  payments: [{ method: 'Efectivo', amount: 520000 }],
});

describe('garantía de celulares en la factura', () => {
  it('usa la garantía del producto y la escribe en la línea con su vencimiento', async () => {
    const pid = await setup();
    const r = await sell(pid, IMEI);
    const inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.items[0].warrantyMonths).toBe(6);
    const until = new Date(inv.items[0].warrantyUntil!);
    const sold = new Date(inv.createdAt!);
    expect(until.getMonth()).toBe((sold.getMonth() + 6) % 12);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!).toMatchObject({ warrantyMonths: 6, warrantyUntil: inv.items[0].warrantyUntil });
    expect(warrantyLine(inv.items[0])).toMatch(/^Garantía 6 meses · hasta \d{2}\/\d{2}\/\d{4}$/);
  });

  it('se puede cambiar al vender (usado con 1 mes, o sin garantía)', async () => {
    const pid = await setup();
    const r1 = await sell(pid, IMEI2, 1);
    const i1 = (await backend.get<Invoice>('invoices', r1.id))!;
    expect(warrantyLine(i1.items[0])).toMatch(/^Garantía 1 mes · hasta/);
    const r2 = await sell(pid, IMEI, 0);
    const i2 = (await backend.get<Invoice>('invoices', r2.id))!;
    expect(i2.items[0].warrantyUntil).toBeUndefined();
    expect(warrantyLine(i2.items[0])).toBe('Sin garantía');
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.warrantyUntil).toBeNull();
  });
});
