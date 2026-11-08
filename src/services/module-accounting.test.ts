import { describe, expect, it } from 'vitest';
import type { CashMovement, Invoice, Product } from '../lib/types';
import { moduleReport } from './accounting';

const products = [
  { id: 'cel', type: 'EQUIPO', name: 'A15' }, { id: 'vid', type: 'ACCESORIO', name: 'Vidrio' }, { id: 'pan', type: 'REPUESTO', name: 'Pantalla' },
] as Product[];
const at = new Date(2026, 10, 5, 12).toISOString();
const inv = (o: Partial<Invoice>) => ({ status: 'pagada', createdAt: at, discount: 0, ...o }) as Invoice;
const invoices = [
  inv({ id: 'i1', subtotal: 600000, commission: 12000, items: [
    { productId: 'cel', description: 'A15', kind: 'producto', qty: 1, unitPrice: 500000, unitCost: 400000, unitId: 'x' },
    { productId: 'vid', description: 'Vidrio', kind: 'producto', qty: 2, unitPrice: 50000, unitCost: 5000 },
  ] }),
  inv({ id: 'i2', subtotal: 200000, discount: 20000, items: [
    { productId: 'pan', description: 'Pantalla', kind: 'repuesto', qty: 1, unitPrice: 150000, unitCost: 90000 },
    { description: 'Mano de obra', kind: 'mano_obra', qty: 1, unitPrice: 50000, unitCost: 20000 },
  ] }),
  inv({ id: 'i3', status: 'anulada', subtotal: 50000, items: [{ productId: 'vid', description: 'Vidrio', kind: 'producto', qty: 1, unitPrice: 50000, unitCost: 5000 }] }),
];
const movements = [{ direction: 'egreso', category: 'gasto', amount: 78000, createdAt: at }] as CashMovement[];
const period = { from: new Date(2026, 10, 1), to: new Date(2026, 11, 1) };

describe('contabilidad por módulo', () => {
  it('reparte comisiones por factura y gastos por participación; las líneas suman el total', () => {
    const { lines, report } = moduleReport(period, { invoices, movements, products });
    const get = (l: string) => lines.find((x) => x.line === l)!;
    expect(get('Equipos')).toMatchObject({ sales: 500000, cost: 400000, gross: 100000, commissions: 10000, units: 1, invoices: 1 });
    expect(get('Accesorios')).toMatchObject({ sales: 100000, cost: 10000, gross: 90000, commissions: 2000, units: 2 });
    expect(get('Servicio técnico')).toMatchObject({ sales: 180000, cost: 110000, gross: 70000, commissions: 0, units: 2 });
    // gastos 78.000 repartidos por ventas (500/780, 100/780, 180/780)
    expect(get('Equipos').expenses).toBe(50000);
    expect(get('Accesorios').expenses).toBe(10000);
    expect(get('Servicio técnico').expenses).toBe(18000);
    const sum = (k: 'sales' | 'net' | 'commissions' | 'expenses') => lines.reduce((a, l) => a + l[k], 0);
    expect(sum('sales')).toBe(report.income);
    expect(sum('commissions')).toBe(report.commissions);
    expect(sum('expenses')).toBe(report.expenses);
    expect(sum('net')).toBe(report.netProfit);
    expect(get('Accesorios').top[0]).toMatchObject({ name: 'Vidrio', qty: 2, sales: 100000, profit: 90000 });
  });
});
