import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, Invoice, PhoneUnit, Product, Purchase } from '../lib/types';
import { dateOnly, dateTime, money } from '../lib/format';
import { Badge, Empty, Field, PageHead, Seg, Stat } from '../components/ui';
import { useSettings } from '../services/settings';
import {
  balanceToday, buildReport, dayKey, downloadCsv, fiscalBook, fiscalSign, inPeriod, periodRange, yearSales, type PeriodKind,
} from '../services/accounting';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7dias', label: '7 días' },
  { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' },
  { value: 'anio', label: 'Este año' },
  { value: 'rango', label: 'Rango' },
];

const CATEGORY_LABEL: Record<string, string> = {
  venta: 'Venta', abono_cliente: 'Abono de cliente', gasto: 'Gasto', pago_proveedor: 'Pago a proveedor',
  pago_tecnico: 'Pago a técnico', pago_vendedor: 'Pago a vendedor', retiro: 'Retiro', ingreso_otro: 'Otro ingreso', anulacion: 'Anulación',
};

const pct = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 1000) / 10}%` : '—');
const fmtDay = (k: string) => k.split('-').reverse().join('/');
const isoDate = (d: Date) => dayKey(d.toISOString());

type Tab = 'resultados' | 'fiscal' | 'caja' | 'balance';

export function Accounting() {
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const products = useCollection<Product>('products').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const units = useCollection<PhoneUnit>('phoneUnits').rows;
  const settings = useSettings();

  const [kind, setKind] = useState<PeriodKind>('mes');
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [tab, setTab] = useState<Tab>('resultados');

  const period = useMemo(() => periodRange(kind, new Date(), from, to), [kind, from, to]);
  const toInclusive = new Date(period.to.getTime() - 1);
  const label = `${dateOnly(period.from.toISOString())} al ${dateOnly(toInclusive.toISOString())}`;
  const fileTag = `${isoDate(period.from)}_a_${isoDate(toInclusive)}`;

  const report = useMemo(() => buildReport(period, { invoices, movements, products }), [period, invoices, movements, products]);
  const fiscal = useMemo(() => fiscalBook(period, movements), [period, movements]);
  const book = useMemo(
    () => movements.filter((m) => inPeriod(m.createdAt, period)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [movements, period],
  );
  const balance = useMemo(() => balanceToday({ products, units, purchases, invoices }), [products, units, purchases, invoices]);

  const uvt = settings.uvtValue || 52374;
  const cap = uvt * (settings.ivaCapUvt || 3500);
  const yearIncome = yearSales(invoices);
  const capPct = cap > 0 ? yearIncome / cap : 0;

  const exportResults = () => downloadCsv(`estado-resultados_${fileTag}.csv`, [
    ['Digital Cell · Estado de resultados', label],
    [],
    ['Concepto', 'Valor', '% de ingresos'],
    ...report.byLine.map((l) => [`Ventas ${l.line.toLowerCase()}`, l.sales, pct(l.sales, report.income)]),
    ['Total ingresos', report.income, '100%'],
    ['(−) Costo de lo vendido', -report.cost, pct(report.cost, report.income)],
    ['Utilidad bruta', report.grossProfit, pct(report.grossProfit, report.income)],
    ['(−) Gastos del período', -report.expenses, pct(report.expenses, report.income)],
    ['(−) Comisiones de vendedores', -report.commissions, pct(report.commissions, report.income)],
    ['Utilidad neta', report.netProfit, pct(report.netProfit, report.income)],
    [],
    ['Margen por línea', 'Ventas', 'Costo', 'Ganancia', 'Margen'],
    ...report.byLine.map((l) => [l.line, l.sales, l.cost, l.profit, l.margin === null ? '—' : `${Math.round(l.margin * 100)}%`]),
    [],
    ['Gastos por categoría', 'Valor', '% del total'],
    ...report.expensesByCategory.map((g) => [g.category, g.amount, pct(g.amount, report.expenses)]),
    ['Total gastos', report.expenses, '100%'],
  ]);

  const exportFiscal = () => downloadCsv(`libro-fiscal_${fileTag}.csv`, [
    ['Digital Cell · Libro fiscal de operaciones diarias', settings.nit ? `NIT ${settings.nit}` : '', label],
    [],
    ['Día', 'Ingresos', 'Egresos', 'Neto'],
    ...[...fiscal.days].reverse().map((d) => [fmtDay(d.day), d.income, d.outflow, d.net]),
    ['Total', fiscal.income, fiscal.outflow, fiscal.net],
  ]);

  const exportBook = () => downloadCsv(`libro-caja_${fileTag}.csv`, [
    ['Fecha y hora', 'Tipo', 'Categoría', 'Concepto', 'Medio', 'Ingreso', 'Egreso'],
    ...[...book].reverse().map((m) => [
      dateTime(m.createdAt), m.direction === 'ingreso' ? 'Ingreso' : 'Egreso',
      m.expenseCategory ? `${CATEGORY_LABEL[m.category]} · ${m.expenseCategory}` : CATEGORY_LABEL[m.category] ?? m.category,
      m.description, m.method, m.direction === 'ingreso' ? m.amount : '', m.direction === 'egreso' ? m.amount : '',
    ]),
  ]);

  return (
    <>
      <PageHead eyebrow="Finanzas" title="Contabilidad" subtitle={`Período: ${label}`} />
      <div className="row" style={{ marginBottom: 16 }}>
        <Seg value={kind} onChange={setKind} options={PERIODS} />
        {kind === 'rango' && (
          <>
            <Field label="Desde"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Hasta"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        )}
      </div>

      <div className="grid g4">
        <Stat accent label="Ingresos" value={money(report.income)} sub={`${report.invoices} ventas`} />
        <Stat label="Utilidad bruta" value={money(report.grossProfit)} sub={`Margen ${pct(report.grossProfit, report.income)}`} />
        <Stat label="Gastos" value={money(report.expenses)} sub={`${report.expenseCount} gasto(s)`} />
        <Stat label="Utilidad neta" value={<span className={report.netProfit < 0 ? 'red' : ''}>{money(report.netProfit)}</span>} sub={`Margen ${pct(report.netProfit, report.income)}`} />
      </div>

      <div className="tabs mt">
        <button className={tab === 'resultados' ? 'active' : ''} onClick={() => setTab('resultados')}>Estado de resultados</button>
        <button className={tab === 'fiscal' ? 'active' : ''} onClick={() => setTab('fiscal')}>Libro fiscal diario</button>
        <button className={tab === 'caja' ? 'active' : ''} onClick={() => setTab('caja')}>Libro de caja</button>
        <button className={tab === 'balance' ? 'active' : ''} onClick={() => setTab('balance')}>Resumen del negocio</button>
      </div>

      {tab === 'resultados' && (
        <div className="grid g2">
          <div className="card">
            <div className="card-head"><h3>Estado de resultados (P&amp;G)</h3><button className="btn sm" onClick={exportResults}><Download size={15} />Excel</button></div>
            <table className="table">
              <thead><tr><th>Concepto</th><th className="num">Valor</th><th className="num">% ingresos</th></tr></thead>
              <tbody>
                {report.byLine.map((l) => (
                  <tr key={l.line}><td>Ventas {l.line.toLowerCase()}</td><td className="num">{money(l.sales)}</td><td className="num faint">{pct(l.sales, report.income)}</td></tr>
                ))}
                {report.discounts > 0 && <tr><td className="faint">Descuentos ya aplicados</td><td className="num faint">{money(report.discounts)}</td><td /></tr>}
                <tr><td className="strong">Total ingresos</td><td className="num strong">{money(report.income)}</td><td className="num">100%</td></tr>
                <tr><td>(−) Costo de lo vendido</td><td className="num red">−{money(report.cost)}</td><td className="num faint">{pct(report.cost, report.income)}</td></tr>
                <tr><td className="strong">Utilidad bruta</td><td className="num strong">{money(report.grossProfit)}</td><td className="num">{pct(report.grossProfit, report.income)}</td></tr>
                <tr><td>(−) Gastos del período</td><td className="num red">−{money(report.expenses)}</td><td className="num faint">{pct(report.expenses, report.income)}</td></tr>
                {report.commissions > 0 && <tr><td>(−) Comisiones de vendedores</td><td className="num red">−{money(report.commissions)}</td><td className="num faint">{pct(report.commissions, report.income)}</td></tr>}
                <tr style={{ fontSize: 16 }}><td className="strong">Utilidad neta</td><td className={`num strong ${report.netProfit < 0 ? 'red' : ''}`}>{money(report.netProfit)}</td><td className="num strong">{pct(report.netProfit, report.income)}</td></tr>
                {report.tax > 0 && <tr><td className="faint">IVA cobrado (no es ingreso, se paga a la DIAN)</td><td className="num faint">{money(report.tax)}</td><td /></tr>}
              </tbody>
            </table>
            <div className="card-pad faint" style={{ fontSize: 12 }}>
              El costo de la mano de obra es el «pago al técnico» de cada orden; las comisiones se cuentan cuando se vende.
              Por eso los pagos a técnicos ({money(report.technicianPayments)}) y a vendedores en caja no se restan otra vez como gasto.
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-head"><h3>Margen por línea de negocio</h3></div>
              <table className="table">
                <thead><tr><th>Línea</th><th className="num">Ventas</th><th className="num">Costo</th><th className="num">Ganancia</th><th className="num">Margen</th></tr></thead>
                <tbody>
                  {report.byLine.map((l) => (
                    <tr key={l.line}>
                      <td className="strong">{l.line}</td><td className="num">{money(l.sales)}</td><td className="num">{money(l.cost)}</td>
                      <td className="num">{money(l.profit)}</td><td className="num">{l.margin === null ? '—' : `${Math.round(l.margin * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="card-pad faint" style={{ fontSize: 12 }}>Si vende algo sin escribir su costo, aparece con 100 % de margen. Escriba el costo para que la ganancia sea real.</div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Gastos por categoría</h3></div>
              {report.expensesByCategory.length === 0 ? <Empty>Sin gastos en el período. Se registran en Caja → Gasto.</Empty> : (
                <table className="table">
                  <tbody>
                    {report.expensesByCategory.map((g) => (
                      <tr key={g.category}>
                        <td>{g.category}<div className="bar red" style={{ marginTop: 6 }}><i style={{ width: `${(g.amount / report.expenses) * 100}%` }} /></div></td>
                        <td className="num">{money(g.amount)}</td><td className="num faint">{pct(g.amount, report.expenses)}</td>
                      </tr>
                    ))}
                    <tr><td className="strong">Total gastos</td><td className="num strong">{money(report.expenses)}</td><td className="num">100%</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'fiscal' && (
        <div className="card">
          <div className="card-head">
            <h3>Libro fiscal de operaciones diarias</h3>
            <button className="btn sm" onClick={exportFiscal}><Download size={15} />Excel</button>
          </div>
          <div className="card-pad faint" style={{ fontSize: 13, paddingBottom: 0 }}>
            Lo exige la DIAN a los no responsables de IVA. <b>Ingresos</b>: dinero que entró (ventas, abonos de clientes, otros ingresos; las anulaciones restan).
            <b> Egresos</b>: gastos y pagos a proveedores, técnicos y vendedores. Los retiros del dueño no cuentan. Las ventas a crédito tienda no son ingreso hasta que se cobran.
          </div>
          {fiscal.days.length === 0 ? <Empty>Sin operaciones en el período.</Empty> : (
            <table className="table">
              <thead><tr><th>Día</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Neto</th></tr></thead>
              <tbody>
                <tr><td className="strong">Total del período</td><td className="num strong">{money(fiscal.income)}</td><td className="num strong">{money(fiscal.outflow)}</td><td className={`num strong ${fiscal.net < 0 ? 'red' : ''}`}>{money(fiscal.net)}</td></tr>
                {fiscal.days.map((d) => (
                  <tr key={d.day}><td>{fmtDay(d.day)}</td><td className="num">{money(d.income)}</td><td className="num">{money(d.outflow)}</td><td className={`num ${d.net < 0 ? 'red' : ''}`}>{money(d.net)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'caja' && (
        <div className="card">
          <div className="card-head">
            <h3>Libro de caja · {book.length} movimientos</h3>
            <button className="btn sm" onClick={exportBook}><Download size={15} />Excel</button>
          </div>
          {book.length === 0 ? <Empty>Sin movimientos en el período.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Medio</th><th className="num">Ingreso</th><th className="num">Egreso</th></tr></thead>
                <tbody>
                  {book.map((m) => {
                    const f = fiscalSign(m);
                    return (
                      <tr key={m.id}>
                        <td className="nowrap">{dateTime(m.createdAt)}</td>
                        <td>{m.description}{m.expenseCategory && <small>{m.expenseCategory}</small>}</td>
                        <td><Badge tone={m.direction === 'ingreso' ? 'ok' : 'red'}>{CATEGORY_LABEL[m.category] ?? m.category}</Badge>{!f.income && !f.outflow && <small>No cuenta en el libro fiscal</small>}</td>
                        <td>{m.method}</td>
                        <td className="num">{m.direction === 'ingreso' ? money(m.amount) : ''}</td>
                        <td className="num red">{m.direction === 'egreso' ? money(m.amount) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'balance' && (
        <div className="grid g2">
          <div className="card">
            <div className="card-head"><h3>Resumen del negocio hoy</h3></div>
            <table className="table">
              <tbody>
                <tr><td>Inventario de celulares (a costo)</td><td className="num">{money(balance.phones)}</td></tr>
                <tr><td>Inventario de repuestos y accesorios controlados (a costo)</td><td className="num">{money(balance.stock)}</td></tr>
                <tr><td>Le deben clientes (ventas a crédito tienda)</td><td className="num">{money(balance.receivables)}</td></tr>
                <tr><td>Debe a proveedores (cuentas por pagar)</td><td className="num red">−{money(balance.payables)}</td></tr>
                <tr style={{ fontSize: 16 }}><td className="strong">Valor neto aproximado</td><td className={`num strong ${balance.net < 0 ? 'red' : ''}`}>{money(balance.net)}</td></tr>
              </tbody>
            </table>
            <div className="card-pad faint" style={{ fontSize: 12 }}>No incluye el efectivo en caja ni los saldos en bancos o billeteras (Nequi, Daviplata).</div>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 10 }}>Tope de no responsable de IVA · {new Date().getFullYear()}</h3>
            <div className="row between"><span className="muted">Ventas del año registradas</span><b>{money(yearIncome)}</b></div>
            <div className="row between"><span className="muted">Tope ({(settings.ivaCapUvt || 3500).toLocaleString('es-CO')} UVT × {money(uvt)})</span><b>{money(cap)}</b></div>
            <div className={`bar ${capPct > 0.8 ? 'red' : ''} mt`}><i style={{ width: `${Math.min(100, capPct * 100)}%` }} /></div>
            <div className="row between mt"><span className="muted">Avance</span><b className={capPct > 0.8 ? 'red' : ''}>{(capPct * 100).toFixed(1)}%</b></div>
            {capPct > 0.8 && <div className="alert warn mt">Se está acercando al tope. Hable con su contador: al superarlo tendría que cobrar IVA.</div>}
            <div className="faint mt" style={{ fontSize: 12 }}>El valor de la UVT y el tope se cambian en Configuración cuando la DIAN los actualice cada año.</div>
          </div>
        </div>
      )}
    </>
  );
}
