import { describe, expect, it } from 'vitest';
import type { CashMovement, Invoice, Product, RepairOrder } from '../lib/types';
import { analyticsRange, bucketIndex, finishedAt, inventoryByCategory, pctChange, seriesFor, sumStats, yearComparison } from './analytics';
import { niceTicks } from '../components/charts';

const now = new Date(2026, 10, 5, 15, 30); // jueves 5 nov 2026
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

const products = [
  { id: 'cel', type: 'EQUIPO', name: 'Galaxy A15', stock: 2, cost: 500000, active: true },
  { id: 'cab', type: 'ACCESORIO', name: 'Cable USB C', stock: 10, cost: 3000, active: true },
  { id: 'off', type: 'ACCESORIO', name: 'Cargador viejo', stock: 5, cost: 1000, active: false },
  { id: 'srv', type: 'SERVICIO', name: 'Cambio de pantalla', stock: 0, cost: 0, active: true },
] as Product[];

const inv = (createdAt: string, items: Partial<Invoice['items'][number]>[], extra: Partial<Invoice> = {}) =>
  ({ status: 'pagada', createdAt, subtotal: items.reduce((a, i) => a + (i.qty ?? 1) * (i.unitPrice ?? 0), 0), discount: 0, items, ...extra }) as Invoice;

const invoices = [
  inv(at(2026, 10, 5, 10), [{ productId: 'cel', qty: 1, unitPrice: 700000, unitCost: 500000, unitId: 'u1' }, { productId: 'cab', qty: 2, unitPrice: 10000, unitCost: 3000 }], { commission: 7000 }),
  inv(at(2026, 10, 3), [{ productId: 'cab', qty: 1, unitPrice: 10000, unitCost: 3000 }]),
  inv(at(2026, 10, 3), [{ productId: 'cab', qty: 5, unitPrice: 10000, unitCost: 3000 }], { status: 'anulada' }),
  inv(at(2025, 10, 10), [{ productId: 'cab', qty: 1, unitPrice: 50000, unitCost: 3000 }]),
];
const movements = [
  { direction: 'egreso', category: 'gasto', amount: 20000, createdAt: at(2026, 10, 5, 9) },
  { direction: 'egreso', category: 'retiro', amount: 99999, createdAt: at(2026, 10, 5, 9) },
] as CashMovement[];
const orders = [
  { status: 'Entregado', createdAt: at(2026, 10, 1), timeline: [{ at: at(2026, 10, 4), status: 'Reparado / Listo' }, { at: at(2026, 10, 5), status: 'Entregado' }] },
  { status: 'En reparación', createdAt: at(2026, 10, 5), timeline: [] },
  { status: 'No reparado', createdAt: at(2026, 9, 20), timeline: [] },
] as unknown as RepairOrder[];
const data = { invoices, movements, products, orders };

describe('analítica del panel', () => {
  it('arma los periodos y navega hacia atrás', () => {
    const w = analyticsRange('semana', 0, now);
    expect(w.buckets).toHaveLength(7);
    expect(w.from.getDay()).toBe(1); // lunes
    expect(w.buckets.findIndex((b) => b.current)).toBe(3); // jueves
    expect(analyticsRange('mes', 0, now).buckets).toHaveLength(30);
    expect(analyticsRange('mes', -1, now).label).toMatch(/octubre/i);
    expect(analyticsRange('dia', 0, now).buckets).toHaveLength(24);
    const y = analyticsRange('anio', -1, now);
    expect(y.label).toBe('2025');
    expect(y.isCurrent).toBe(false);
  });

  it('ubica cada fecha en su bucket', () => {
    const m = analyticsRange('mes', 0, now);
    expect(bucketIndex(m.buckets, at(2026, 10, 1, 0))).toBe(0);
    expect(bucketIndex(m.buckets, at(2026, 10, 30, 23))).toBe(29);
    expect(bucketIndex(m.buckets, at(2026, 11, 1))).toBe(-1);
    expect(bucketIndex(m.buckets, undefined)).toBe(-1);
  });

  it('suma ingresos, gastos, ganancia, unidades y servicios con datos reales', () => {
    const m = analyticsRange('mes', 0, now);
    const rows = seriesFor(m.buckets, data);
    const t = sumStats(rows);
    expect(t.income).toBe(730000); // la factura anulada no cuenta
    expect(t.cost).toBe(509000);
    expect(t.operating).toBe(20000); // los retiros no son gasto
    expect(t.commissions).toBe(7000);
    expect(t.expenses).toBe(536000);
    expect(t.net).toBe(194000);
    expect(t.phones).toBe(1);
    expect(t.accessories).toBe(3);
    expect(t.received).toBe(2);
    expect(t.finished).toBe(1);
    expect(rows[3].finished).toBe(1); // terminada el día que quedó lista (4 nov)
    expect(rows[4].income).toBe(720000);
  });

  it('fecha de terminación: solo reparadas o entregadas', () => {
    expect(finishedAt(orders[0])).toBe(at(2026, 10, 4));
    expect(finishedAt(orders[1])).toBeUndefined();
    expect(finishedAt(orders[2])).toBeUndefined();
  });

  it('comparativo de ventas por mes contra el año anterior', () => {
    const y = yearComparison(2026, data, now);
    expect(y[10].current).toBe(730000);
    expect(y[10].previous).toBe(50000);
    expect(y[11].future).toBe(true);
    expect(y[9].future).toBe(false);
  });

  it('inventario disponible por categoría (activos y con stock)', () => {
    const r = inventoryByCategory(products);
    expect(r.units).toBe(12);
    expect(r.rows.map((x) => x.category)).toEqual(['Cables', 'Celulares']);
    expect(r.value).toBe(1030000);
  });

  it('variación y escala del eje', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(10, 0)).toBeNull();
    expect(niceTicks(0, 730000)).toEqual([0, 200000, 400000, 600000, 800000]);
    expect(niceTicks(-30, 90)[0]).toBeLessThan(0);
  });
});
