import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Customer, RepairOrder } from '../lib/types';
import { addDeposit, createOrder, editDeposit } from './orders';
import { expectedByMethod, openSession } from './cash';
import { fiscalBook } from './accounting';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());

async function order() {
  const c = { document: '1', name: 'Ana', phone: '300', email: '', address: '', notes: '' };
  const cid = await backend.create('customers', c);
  const r = await createOrder(actor, {
    customer: { ...c, id: cid } as Customer,
    device: { brand: 'Samsung', model: 'A10', imei: '', color: '', unlockCode: '', accessories: '', condition: '' },
    reportedIssue: 'Pantalla', technicianId: '', technicianName: '', technicianUserId: '',
    priority: 'normal', promisedAt: '', budget: 0, laborPrice: 100000, technicianPay: 0, warrantyDays: 30,
  });
  return typeof r === 'string' ? r : (r as { id: string }).id;
}
const cash = async () => expectedByMethod({ openingCash: 0 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);

describe('corregir abonos de una orden', () => {
  it('sube, baja, cambia de medio y elimina; la caja y el libro fiscal cuadran', async () => {
    await openSession(actor, 0);
    const id = await order();
    await addDeposit(actor, id, 50000, 'Efectivo');
    await expect(editDeposit(actor, id, 0, { amount: 30000, method: 'Efectivo' }, ' ')).rejects.toThrow(/motivo/);

    await editDeposit(actor, id, 0, { amount: 30000, method: 'Efectivo' }, 'digité mal');
    expect(await cash()).toMatchObject({ Efectivo: 30000 });
    let o = (await backend.get<RepairOrder>('repairOrders', id))!;
    expect(o.deposits[0]).toMatchObject({ amount: 30000, method: 'Efectivo', previous: { amount: 50000, method: 'Efectivo' }, editedBy: 'Jairo' });

    await editDeposit(actor, id, 0, { amount: 40000, method: 'Efectivo' }, 'faltaban 10');
    expect(await cash()).toMatchObject({ Efectivo: 40000 });

    await editDeposit(actor, id, 0, { amount: 40000, method: 'Nequi' }, 'era Nequi');
    expect(await cash()).toMatchObject({ Efectivo: 0, Nequi: 40000 });

    await expect(editDeposit(actor, id, 0, { amount: 40000, method: 'Nequi' }, 'x')).rejects.toThrow(/No hay cambios/);

    await editDeposit(actor, id, 0, { amount: 0, method: 'Nequi' }, 'no pagó');
    expect(await cash()).toMatchObject({ Efectivo: 0, Nequi: 0 });
    o = (await backend.get<RepairOrder>('repairOrders', id))!;
    expect(o.deposits).toHaveLength(0);
    expect(o.timeline[o.timeline.length - 1].note).toMatch(/Abono eliminado/);

    const now = new Date();
    const f = fiscalBook({ from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) }, await backend.list<CashMovement>('cashMovements'));
    expect(f.income).toBe(0);
  });
});
