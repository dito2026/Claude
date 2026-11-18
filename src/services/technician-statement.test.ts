import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, RepairOrder, Technician } from '../lib/types';
import { addMovement, openSession } from './cash';
import { linkTechnicianPayment, technicianStatement } from './staff';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const tech = { id: 't1', name: 'Cristian', phone: '', specialty: '', active: true, commissionPct: 0 } as Technician;
const ot = (n: number, status: RepairOrder['status'], pay: number, techId = 't1') => ({
  id: `o${n}`, number: n, status, technicianId: techId, technicianPay: pay, deliveredAt: `2026-11-1${n}T10:00:00Z`,
  customer: { name: `Cliente ${n}`, phone: '', document: '' }, device: { brand: 'Samsung', model: 'A10' },
}) as unknown as RepairOrder;

describe('estado de cuenta del técnico', () => {
  it('ganado (entregadas), en proceso, sin pago, pagos y pagos que lo mencionan pero no cuentan', async () => {
    await openSession(actor, 500000);
    await backend.set('technicians', 't1', { name: 'Cristian', phone: '', specialty: '', active: true, commissionPct: 0 });
    await addMovement(actor, { direction: 'egreso', category: 'pago_tecnico', method: 'Efectivo', amount: 20000, description: 'Pago a Cristian', refType: 'technician', refId: 't1' });
    await addMovement(actor, { direction: 'egreso', category: 'gasto', expenseCategory: 'Otros', method: 'Nequi', amount: 15000, description: 'pago cristian pantalla', refType: 'manual' });
    await addMovement(actor, { direction: 'egreso', category: 'gasto', expenseCategory: 'Otros', method: 'Efectivo', amount: 9000, description: 'almuerzo', refType: 'manual' });
    const orders = [ot(1, 'Entregado', 30000), ot(2, 'Entregado', 0), ot(3, 'Reparado / Listo', 25000), ot(4, 'No reparado', 10000), ot(5, 'Entregado', 50000, 'otro')];
    let st = technicianStatement(tech, orders, await backend.list<CashMovement>('cashMovements'));
    expect(st).toMatchObject({ earned: 30000, paid: 20000, owed: 10000, jobs: 2, noPay: 1, pendingPay: 25000 });
    expect(st.pending.map((o) => o.number)).toEqual([3]);
    expect(st.suspects.map((m) => m.amount)).toEqual([15000]);

    await linkTechnicianPayment(actor, st.suspects[0].id, 't1');
    st = technicianStatement(tech, orders, await backend.list<CashMovement>('cashMovements'));
    expect(st).toMatchObject({ paid: 35000, owed: -5000 });
    expect(st.suspects).toHaveLength(0);
    const moved = st.payments.find((m) => m.amount === 15000)!;
    expect(moved).toMatchObject({ category: 'pago_tecnico', refType: 'technician', refId: 't1', previousCategory: 'gasto', linkedBy: 'Jairo', method: 'Nequi' });
    await expect(linkTechnicianPayment(actor, moved.id, 't1')).rejects.toThrow(/no se puede/);
  });
});
