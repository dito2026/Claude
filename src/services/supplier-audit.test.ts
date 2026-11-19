import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Purchase, Supplier } from '../lib/types';
import { addMovement, expectedByMethod, openSession } from './cash';
import {
  createPurchase, editOpeningBalance, editPurchase, editSupplierPayment, linkCashPayment, movePayment, paySupplier, saveSupplier, supplierSummary, unlinkedCashPayments,
} from './purchases';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const cash = async () => expectedByMethod({ openingCash: 1000000 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo']);
const sup = async (name: string, opening = 0) => {
  const id = String(await saveSupplier(actor, { name, nit: '', phone: '', termDays: 30, notes: '', active: true }, undefined, opening));
  return { ...(await backend.get<Supplier>('suppliers', id))!, id };
};
const buy = (s: Supplier, cost: number, paymentType: 'contado' | 'credito' = 'credito') => createPurchase(actor, {
  supplier: s, paymentType, method: paymentType === 'contado' ? 'Efectivo' : '', invoiceRef: '', note: '', updateCost: false,
  items: [{ productId: '', name: 'Pantalla', qty: 1, unitCost: cost }],
});
const all = () => backend.list<Purchase>('purchases');

describe('revisión de abonos a proveedores', () => {
  it('una compra de contado que quedó con saldo cuenta como crédito: las columnas cuadran con lo que se debe', async () => {
    await openSession(actor, 1000000);
    const s = await sup('Pepe');
    const c = await buy(s, 50000, 'contado');
    await editPurchase(actor, c.id, { lines: [{ index: 0, name: 'Pantalla', qty: 1, unitCost: 60000 }], invoiceRef: '', note: '', updateCost: false }, 'costo real');
    const r = supplierSummary(s, await all());
    expect(r).toMatchObject({ owed: 10000, credit: 60000, paidOnCredit: 50000, cash: 0 });
    expect(r.credit - r.paidOnCredit).toBe(r.owed);
  });

  it('el saldo anterior se corrige sin anularlo: conserva los abonos y no toca la caja', async () => {
    await openSession(actor, 1000000);
    const s = await sup('Pepe', 500000);
    const [p] = await all();
    await paySupplier(actor, s, [p.id], 100000, 'Efectivo');
    await expect(editOpeningBalance(actor, p.id, 50000, 'x')).rejects.toThrow(/no puede quedar por debajo/);
    await editOpeningBalance(actor, p.id, 300000, 'el saldo era 300.000');
    const after = (await backend.get<Purchase>('purchases', p.id))!;
    expect(after).toMatchObject({ total: 300000, paid: 100000, status: 'parcial' });
    expect(after.edits![0]).toMatchObject({ total: 500000, reason: 'el saldo era 300.000' });
    expect(supplierSummary(s, await all()).owed).toBe(200000);
    expect(await cash()).toMatchObject({ Efectivo: 900000 });
  });

  it('un pago de Caja descontado después no se borra devolviendo plata a la caja; se pasa a la compra correcta', async () => {
    await openSession(actor, 1000000);
    const s = await sup('Pepe');
    const a = await buy(s, 300000);
    await new Promise((r) => setTimeout(r, 5));
    const b = await buy(s, 140000);
    await addMovement(actor, { direction: 'egreso', category: 'pago_proveedor', method: 'Efectivo', amount: 140000, description: 'pepe edge', refType: 'manual' });
    const [m] = unlinkedCashPayments(await backend.list<CashMovement>('cashMovements'));
    await linkCashPayment(actor, m.id, s.id); // quedó en la más antigua (la equivocada)
    expect((await backend.get<Purchase>('purchases', a.id))!.paid).toBe(140000);
    await expect(editSupplierPayment(actor, a.id, 0, { amount: 0, method: 'Efectivo' }, 'x')).rejects.toThrow(/Pasar a otra compra/);
    await movePayment(actor, a.id, 0, b.id, 'era del Edge');
    const pa = (await backend.get<Purchase>('purchases', a.id))!;
    const pb = (await backend.get<Purchase>('purchases', b.id))!;
    expect(pa).toMatchObject({ paid: 0, status: 'pendiente', payments: [] });
    expect(pb).toMatchObject({ paid: 140000, status: 'pagada' });
    expect(pb.payments[0]).toMatchObject({ cashMovementId: m.id, movedFrom: { number: a.number, by: 'Jairo', reason: 'era del Edge' } });
    expect(await cash()).toMatchObject({ Efectivo: 860000 }); // la caja no cambia
  });

  it('pasar un pago: no a otra compra de otro proveedor ni a una que no tenga saldo suficiente', async () => {
    await openSession(actor, 1000000);
    const s = await sup('Pepe');
    const o = await sup('Otro');
    const a = await buy(s, 100000);
    const b = await buy(s, 20000);
    const x = await buy(o, 500000);
    await paySupplier(actor, s, [a.id], 50000, 'Efectivo', { first: a.id });
    await expect(movePayment(actor, a.id, 0, x.id, 'x')).rejects.toThrow(/mismo proveedor/);
    await expect(movePayment(actor, a.id, 0, b.id, 'x')).rejects.toThrow(/solo le faltan 20.000/);
    await expect(movePayment(actor, a.id, 0, b.id, '')).rejects.toThrow(/motivo/);
  });

  it('corregir un pago hecho por fuera de la caja no mueve la caja', async () => {
    await openSession(actor, 1000000);
    const s = await sup('Pepe');
    const a = await buy(s, 100000);
    await paySupplier(actor, s, [a.id], 60000, 'Efectivo', { outsideCash: true });
    await editSupplierPayment(actor, a.id, 0, { amount: 0, method: 'Efectivo' }, 'no era');
    expect(await cash()).toMatchObject({ Efectivo: 1000000 });
    expect((await backend.get<Purchase>('purchases', a.id))!.paid).toBe(0);
  });
});
