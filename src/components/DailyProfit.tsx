import { useMemo, useState } from 'react';
import { useCollection } from '../data/hooks';
import type { CashMovement, Invoice, Product } from '../lib/types';
import { money } from '../lib/format';
import { buildReport } from '../services/accounting';
import { Seg } from './ui';

export interface DayProfit {
  date: Date;
  sales: number;
  cost: number;
  gross: number;
  expenses: number;
  net: number;
  count: number;
}

/** Ganancia por día: ventas − costo − gastos − comisiones (igual que Contabilidad). */
export function dailyProfits(days: number, data: { invoices: Invoice[]; movements: CashMovement[]; products: Product[] }, now = new Date()): DayProfit[] {
  const out: DayProfit[] = [];
  for (let k = 0; k < days; k++) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    const r = buildReport({ from, to }, data);
    out.push({ date: from, sales: r.income, cost: r.cost, gross: r.grossProfit, expenses: r.expenses + r.commissions, net: r.netProfit, count: r.invoices });
  }
  return out;
}

export function useDailyProfits(days: number) {
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const products = useCollection<Product>('products').rows;
  return useMemo(() => dailyProfits(days, { invoices, movements, products }), [days, invoices, movements, products]);
}

/** Tarjeta del Panel con la ganancia de cada día. */
export function DailyProfitCard() {
  const [days, setDays] = useState<'7' | '15' | '30'>('7');
  const rows = useDailyProfits(Number(days));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const total = rows.reduce((a, r) => ({ sales: a.sales + r.sales, gross: a.gross + r.gross, expenses: a.expenses + r.expenses, net: a.net + r.net }), { sales: 0, gross: 0, expenses: 0, net: 0 });
  const label = (d: Date, i: number) => (i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Ganancias diarias</h3>
        <Seg value={days} onChange={setDays} options={[{ value: '7', label: '7 días' }, { value: '15', label: '15 días' }, { value: '30', label: '30 días' }]} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Día</th><th className="num">Ventas</th><th className="num">Costo</th><th className="num">Utilidad bruta</th><th className="num">Gastos y comisiones</th><th className="num">Ganancia neta</th><th style={{ width: '22%' }} /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date.toISOString()} style={i === 0 ? { background: 'var(--red-soft)' } : undefined}>
                <td className="strong nowrap">{label(r.date, i)}<small>{r.count} ventas</small></td>
                <td className="num">{money(r.sales)}</td>
                <td className="num faint">{money(r.cost)}</td>
                <td className="num">{money(r.gross)}</td>
                <td className="num faint">{r.expenses ? `−${money(r.expenses)}` : money(0)}</td>
                <td className={`num strong ${r.net < 0 ? 'red' : ''}`}>{money(r.net)}</td>
                <td><div className={`bar ${r.net < 0 ? 'red' : ''}`}><i style={{ width: `${(Math.abs(r.net) / max) * 100}%`, background: r.net < 0 ? 'var(--red)' : i === 0 ? 'var(--red)' : undefined }} /></div></td>
              </tr>
            ))}
            <tr>
              <td className="strong">Total {days} días</td>
              <td className="num strong">{money(total.sales)}</td>
              <td />
              <td className="num strong">{money(total.gross)}</td>
              <td className="num">{total.expenses ? `−${money(total.expenses)}` : money(0)}</td>
              <td className={`num strong ${total.net < 0 ? 'red' : ''}`}>{money(total.net)}</td>
              <td className="faint" style={{ fontSize: 12 }}>Promedio diario {money(total.net / rows.length)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card-pad faint" style={{ fontSize: 12, paddingTop: 10 }}>
        Ganancia neta = ventas − costo de lo vendido − gastos del día − comisiones. El pago al técnico ya va dentro del costo de cada reparación.
      </div>
    </div>
  );
}
