import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Customer, RepairOrder } from '../lib/types';
import { quickIntake } from './orders';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const base = { name: 'Daily Hidalgo', phone: '313 783 8929', unlockCode: '1234', brand: 'Redmi', model: '13C', issue: 'No carga', warrantyDays: 30 };

describe('recepción rápida de equipos', () => {
  it('crea el cliente si no existe y la orden con clave, marca, modelo y falla', async () => {
    const r = await quickIntake(actor, base);
    const o = (await backend.get<RepairOrder>('repairOrders', r.id))!;
    expect(o).toMatchObject({ number: 1, status: 'Recibido', reportedIssue: 'No carga', device: { brand: 'Redmi', model: '13C', unlockCode: '1234' }, customer: { name: 'Daily Hidalgo', phone: '313 783 8929' } });
    expect(new Date(o.promisedAt).getTime()).toBeGreaterThan(Date.now() + 86400000);
    expect(await backend.list<Customer>('customers')).toHaveLength(1);
    expect(o).toMatchObject({ budget: 0, laborPrice: 0 }); // sin precio: se pone después
  });

  it('con precio: queda como presupuesto y cobro al cliente', async () => {
    const r = await quickIntake(actor, { ...base, price: 120000 });
    expect((await backend.get<RepairOrder>('repairOrders', r.id))!).toMatchObject({ budget: 120000, laborPrice: 120000 });
  });

  it('si el teléfono ya es de un cliente, usa ese cliente (aunque esté escrito distinto)', async () => {
    const id = await backend.create('customers', { name: 'Daily H.', phone: '+57 3137838929', document: '1', email: '', address: '', notes: '' });
    const r = await quickIntake(actor, { ...base, phone: '3137838929' });
    expect((await backend.get<RepairOrder>('repairOrders', r.id))!.customerId).toBe(id);
    expect(await backend.list<Customer>('customers')).toHaveLength(1);
  });

  it('pide nombre, teléfono, marca, modelo y falla', async () => {
    await expect(quickIntake(actor, { ...base, name: ' ' })).rejects.toThrow(/nombre/);
    await expect(quickIntake(actor, { ...base, phone: '123' })).rejects.toThrow(/teléfono/);
    await expect(quickIntake(actor, { ...base, model: '' })).rejects.toThrow(/marca y el modelo/);
    await expect(quickIntake(actor, { ...base, issue: '' })).rejects.toThrow(/falla/);
  });
});
