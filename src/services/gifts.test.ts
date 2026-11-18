import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Invoice, Purchase, Supplier } from '../lib/types';
import { createInvoice, invoiceCost } from './billing';
import { openSession } from './cash';
import { giftReport, periodRange } from './accounting';
import { saveSupplier, supplierSummary } from './purchases';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const customer = { name: 'Ana', phone: '', document: '' };

describe('encimar vidrio (obsequio comprado a un proveedor)', () => {
  it('la venta lo da en $0, su costo baja la ganancia y queda la deuda con el proveedor', async () => {
    await openSession(actor, 0);
    const sid = String(await saveSupplier(actor, { name: 'Vidrios Pepe', nit: '', phone: '', termDays: 15, notes: '', active: true }));
    const r = await createInvoice(actor, { customer, discount: 0, taxRate: 0, cashierName: 'T', payments: [{ method: 'Efectivo', amount: 80000 }],
      items: [
        { description: 'Cambio de pantalla', kind: 'mano_obra', qty: 1, unitPrice: 80000, unitCost: 30000 },
        { description: 'Vidrio templado (obsequio)', kind: 'producto', qty: 1, unitPrice: 0, unitCost: 3000, gift: { supplierId: sid, supplierName: 'Vidrios Pepe' } },
        { description: 'Hidrogel (obsequio)', kind: 'producto', qty: 2, unitPrice: 0, unitCost: 2500, gift: { supplierId: sid, supplierName: 'Vidrios Pepe' } },
      ] });
    const inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.total).toBe(80000);
    expect(invoiceCost(inv)).toBe(30000 + 3000 + 5000);
    const g = inv.items[1].gift!;
    expect(g.purchaseNumber).toBe(1);
    expect(g.line).toBe('Servicio técnico'); // acompañó una reparación
    const p = (await backend.get<Purchase>('purchases', g.purchaseId!))!;
    expect(p).toMatchObject({ paymentType: 'credito', status: 'pendiente', total: 8000, supplierName: 'Vidrios Pepe', paid: 0 });
    expect(p.items).toHaveLength(2);
    expect(p.note).toContain(`factura ${inv.number}`);
    const s = { ...(await backend.get<Supplier>('suppliers', sid))!, id: sid };
    expect(supplierSummary(s, await backend.list<Purchase>('purchases')).owed).toBe(8000);

    const rep = giftReport(periodRange('mes'), await backend.list<Invoice>('invoices'), await backend.list<Purchase>('purchases'));
    expect(rep).toMatchObject({ qty: 3, cost: 8000, sales: 1, owed: 8000 });
    expect(rep.suppliers[0]).toMatchObject({ name: 'Vidrios Pepe', qty: 3, cost: 8000, owed: 8000 });
  });

  it('exige precio y proveedor, y que no se le cobre al cliente', async () => {
    await openSession(actor, 0);
    const base = { customer, discount: 0, taxRate: 0, cashierName: 'T', payments: [] };
    await expect(createInvoice(actor, { ...base, items: [{ description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 0, unitCost: 0, gift: { supplierId: 'x', supplierName: 'x' } }] }))
      .rejects.toThrow(/precio y el proveedor/);
    await expect(createInvoice(actor, { ...base, items: [{ description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 5000, unitCost: 3000, gift: { supplierId: 'x', supplierName: 'x' } }] }))
      .rejects.toThrow(/sin cobro/);
    await expect(createInvoice(actor, { ...base, items: [{ description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 0, unitCost: 3000, gift: { supplierId: 'no-existe', supplierName: 'x' } }] }))
      .rejects.toThrow(/Proveedor no encontrado/);
  });
});
