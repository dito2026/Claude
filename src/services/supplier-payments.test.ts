import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Purchase, Supplier } from '../lib/types';
import { createPurchase, editSupplierPayment, paySupplier, purchaseBalance, saveSupplier } from './purchases';
import { expectedByMethod, openSession } from './cash';
import { fiscalBook } from './accounting';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const cash = async () => expectedByMethod({ openingCash: 500000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);

describe('corregir abonos a proveedores', () => {
  it('baja, sube, cambia el medio y elimina; saldo, estado y caja cuadran', async () => {
    await openSession(actor, 500000);
    const sid = await saveSupplier(actor, { name: 'Nano', nit: '', phone: '', termDays: 30, notes: '', active: true });
    const supplier = (await backend.get<Supplier>('suppliers', String(sid)))!;
    const { id } = await createPurchase(actor, {
      supplier: { ...supplier, id: String(sid) }, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false,
      items: [{ productId: '', name: 'Display A15', qty: 1, unitCost: 200000 }],
    });
    await paySupplier(actor, { ...supplier, id: String(sid) }, [id], 150000, 'Efectivo');
    expect(await cash()).toMatchObject({ Efectivo: 350000 });

    await expect(editSupplierPayment(actor, id, 0, { amount: 100000, method: 'Efectivo' }, '')).rejects.toThrow(/motivo/);
    await expect(editSupplierPayment(actor, id, 0, { amount: 250000, method: 'Efectivo' }, 'x')).rejects.toThrow(/más que el total/);

    await editSupplierPayment(actor, id, 0, { amount: 100000, method: 'Efectivo' }, 'digité mal');
    let p = (await backend.get<Purchase>('purchases', id))!;
    expect(p).toMatchObject({ paid: 100000, status: 'parcial' });
    expect(purchaseBalance(p)).toBe(100000);
    expect(p.payments[0]).toMatchObject({ amount: 100000, previous: { amount: 150000, method: 'Efectivo' }, editedBy: 'Jairo' });
    expect(await cash()).toMatchObject({ Efectivo: 400000 });

    await editSupplierPayment(actor, id, 0, { amount: 200000, method: 'Efectivo' }, 'era todo');
    p = (await backend.get<Purchase>('purchases', id))!;
    expect(p).toMatchObject({ paid: 200000, status: 'pagada' });
    expect(await cash()).toMatchObject({ Efectivo: 300000 });

    await editSupplierPayment(actor, id, 0, { amount: 200000, method: 'Nequi' }, 'fue por Nequi');
    expect(await cash()).toMatchObject({ Efectivo: 500000, Nequi: -200000 });

    await editSupplierPayment(actor, id, 0, { amount: 0, method: 'Nequi' }, 'no se pagó');
    p = (await backend.get<Purchase>('purchases', id))!;
    expect(p).toMatchObject({ paid: 0, status: 'pendiente' });
    expect(p.payments).toHaveLength(0);
    expect(await cash()).toMatchObject({ Efectivo: 500000, Nequi: 0 });

    const now = new Date();
    const f = fiscalBook({ from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) }, await backend.list<CashMovement>('cashMovements'));
    expect(f.outflow).toBe(0);
  });
});

describe('historial de pagos a proveedores', () => {
  it('un abono repartido en dos compras sale como un solo pago con sus partes', async () => {
    const { supplierPayments } = await import('./purchases');
    await openSession(actor, 500000);
    const sid = String(await saveSupplier(actor, { name: 'Nano', nit: '', phone: '', termDays: 30, notes: '', active: true }));
    const supplier = { ...(await backend.get<Supplier>('suppliers', sid))!, id: sid };
    const mk = (cost: number) => createPurchase(actor, { supplier, paymentType: 'credito', method: '', invoiceRef: '', note: '', updateCost: false, items: [{ productId: '', name: 'X', qty: 1, unitCost: cost }] });
    const a = await mk(100000);
    const b = await mk(80000);
    await paySupplier(actor, supplier, [a.id, b.id], 150000, 'Efectivo');
    const rows = supplierPayments(await backend.list<Purchase>('purchases'), sid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 150000, method: 'Efectivo', supplierName: 'Nano' });
    expect(rows[0].parts.map((x) => x.amount).sort((x, y) => x - y)).toEqual([50000, 100000]);
    expect(supplierPayments(await backend.list<Purchase>('purchases'), 'otro')).toHaveLength(0);
  });
});
