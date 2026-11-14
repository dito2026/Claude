import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, Invoice } from '../lib/types';
import { openSession, expectedByMethod } from './cash';
import { collectCredit, createInvoice, creditBalance, voidInvoice } from './billing';
import { balanceToday, fiscalBook } from './accounting';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());
const cash = async () => expectedByMethod({ openingCash: 0 }, await backend.list<CashMovement>('cashMovements'), ['Efectivo', 'Nequi']);

describe('cobrar ventas a crédito tienda', () => {
  it('abono parcial, pago del resto, factura pagada; caja, cuentas por cobrar y anulación cuadran', async () => {
    await openSession(actor, 0);
    const cid = await backend.create('customers', { name: 'Guillermo Villa', document: '1', phone: '', email: '', address: '', notes: '' });
    const r = await createInvoice(actor, {
      customerId: cid, customer: { name: 'Guillermo Villa', phone: '', document: '1' }, discount: 0, taxRate: 0, cashierName: 'T',
      items: [{ description: 'Forro', kind: 'producto', qty: 1, unitPrice: 100000, unitCost: 40000 }],
      payments: [{ method: 'Efectivo', amount: 20000 }, { method: 'Crédito tienda', amount: 80000 }],
    });
    let inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.status).toBe('credito');
    expect(creditBalance(inv)).toBe(80000);
    expect(await cash()).toMatchObject({ Efectivo: 20000 });

    await expect(collectCredit(actor, r.id, 90000, 'Nequi')).rejects.toThrow(/solo debe/);
    await expect(collectCredit(actor, r.id, 30000, '')).rejects.toThrow(/Elija/);
    await collectCredit(actor, r.id, 30000, 'Nequi');
    inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.status).toBe('credito');
    expect(creditBalance(inv)).toBe(50000);
    expect(await cash()).toMatchObject({ Efectivo: 20000, Nequi: 30000 });
    expect(balanceToday({ products: [], units: [], purchases: [], invoices: [inv] }).receivables).toBe(50000);

    await collectCredit(actor, r.id, 50000, 'Efectivo');
    inv = (await backend.get<Invoice>('invoices', r.id))!;
    expect(inv.status).toBe('pagada');
    expect(creditBalance(inv)).toBe(0);
    await expect(collectCredit(actor, r.id, 1000, 'Efectivo')).rejects.toThrow(/no tiene saldo/);
    const now = new Date();
    const f = fiscalBook({ from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) }, await backend.list<CashMovement>('cashMovements'));
    expect(f.income).toBe(100000);

    await voidInvoice(actor, r.id, 'devolución');
    expect(await cash()).toMatchObject({ Efectivo: 0, Nequi: 0 });
  });
});
