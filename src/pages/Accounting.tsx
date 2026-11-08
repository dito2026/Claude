import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, Invoice, PhoneUnit, Product, Purchase } from '../lib/types';
import { dateOnly, dateTime, money } from '../lib/format';
import { Badge, Empty, Field, PageHead, Seg, Stat } from '../components/ui';
import { useSettings } from '../services/settings';
import {
  balanceToday, buildReport, dayKey, moduleReport, downloadCsv, fiscalBook, fiscalSign, inPeriod, periodRange, yearSales, type PeriodKind,
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

type Tab = 'resultados' | 'modulos' | 'fiscal' | 'caja' | 'balance';

const MODULE_NAME: Record<string, string> = { Equipos: 'Celulares', Accesorios: 'Accesorios', 'Servicio técnico': 'Servicio técnico' };

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
  const modules = useMemo(() => moduleReport(period, { invoices, movements, products }).lines, [period, invoices, movements, products]);
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

  const MODULE_ROWS: [string, (m: (typeof modules)[number]) => number | string, number | string][] = [
    ['Ventas', (m) => m.sales, report.income],
    ['(−) Costo de lo vendido', (m) => -m.cost, -report.cost],
    ['Utilidad bruta', (m) => m.gross, report.grossProfit],
    ['(−) Comisiones de vendedores', (m) => -m.commissions, -report.commissions],
    ['(−) Gastos generales repartidos', (m) => -m.expenses, -report.expenses],
    ['Utilidad neta', (m) => m.net, report.netProfit],
  ];
  const exportModules = () => downloadCsv(`contabilidad-por-modulo_${fileTag}.csv`, [
    ['Digital Cell · Contabilidad por módulo', label],
    [],
    ['Concepto', ...modules.map((m) => MODULE_NAME[m.line]), 'Total'],
    ...MODULE_ROWS.map(([name, f, total]) => [name, ...modules.map(f), total]),
    ['Margen neto', ...modules.map((m) => pct(m.net, m.sales)), pct(report.netProfit, report.income)],
    ['Unidades vendidas', ...modules.map((m) => m.units), modules.reduce((a, m) => a + m.units, 0)],
    [],
    ...modules.flatMap((m) => [[`Más vendidos · ${MODULE_NAME[m.line]}`, 'Cantidad', 'Ventas', 'Ganancia'], ...m.top.map((t) => [t.name, t.qty, t.sales, t.profit]), []]),
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
        <button className={tab === 'modulos' ? 'active' : ''} onClick={() => setTab('modulos')}>Por módulo</button>
        <button className={tab === 'fiscal' ? 'active' : ''} onClick={() => setTab('fiscal')}>Libro fiscal diario</button>
        <button className={tab === 'caja' ? 'active' : ''} onClick={() => setTab('caja')}>Libro de caja</button>
        <button className={tab === 'balance' ? 'active' : ''} onClick={() => setTab('balance')}>Resumen del negocio</button>
      </div>

      {tab === 'resultados' && (
        <div className="grid g2">
          <div className="card">
            <div className="card-head"><h3>Estado de resultados (P&amp;G)</h3><button className="btn sm" onClick={exportResults}><Download size={15} />Excel</button></div>
            <div className="table-wrap">
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
            </div>
            <div className="card-pad faint" style={{ fontSize: 12 }}>
              El costo de la mano de obra es el «pago al técnico» de cada orden; las comisiones se cuentan cuando se vende.
              Por eso los pagos a técnicos ({money(report.technicianPayments)}) y a vendedores en caja no se restan otra vez como gasto.
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-head"><h3>Margen por línea de negocio</h3></div>
              <div className="table-wrap">
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
              </div>
              <div className="card-pad faint" style={{ fontSize: 12 }}>Si vende algo sin escribir su costo, aparece con 100 % de margen. Escriba el costo para que la ganancia sea real.</div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Gastos por categoría</h3></div>
              {report.expensesByCategory.length === 0 ? <Empty>Sin gastos en el período. Se registran en Caja → Gasto.</Empty> : (
                <div className="table-wrap">
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'modulos' && (
        <>
          <div className="grid g3">
            {modules.map((m) => (
              <Stat key={m.line} label={MODULE_NAME[m.line]} value={<span className={m.net < 0 ? 'red' : ''}>{money(m.net)}</span>}
                sub={`Utilidad neta · ventas ${money(m.sales)} · ${pct(m.net, m.sales)} de margen`} />
            ))}
          </div>
          <div className="card mt">
            <div className="card-head"><h3>Estado de resultados por módulo</h3><button className="btn sm" onClick={exportModules}><Download size={15} />Excel</button></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Concepto</th>{modules.map((m) => <th key={m.line} className="num">{MODULE_NAME[m.line]}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {MODULE_ROWS.map(([name, f, total]) => {
                    const strong = name.startsWith('Utilidad');
                    return (
                      <tr key={name}>
                        <td className={strong ? 'strong' : ''}>{name}</td>
                        {modules.map((m) => { const v = f(m) as number; return <td key={m.line} className={`num ${strong ? 'strong' : ''} ${v < 0 ? 'red' : ''}`}>{v < 0 ? `−${money(-v)}` : money(v)}</td>; })}
                        <td className={`num strong ${(total as number) < 0 ? 'red' : ''}`}>{(total as number) < 0 ? `−${money(-(total as number))}` : money(total as number)}</td>
                      </tr>
                    );
                  })}
                  <tr><td>Margen neto</td>{modules.map((m) => <td key={m.line} className="num">{pct(m.net, m.sales)}</td>)}<td className="num">{pct(report.netProfit, report.income)}</td></tr>
                  <tr><td>Participación en ventas</td>{modules.map((m) => <td key={m.line} className="num faint">{pct(m.sales, report.income)}</td>)}<td className="num faint">100%</td></tr>
                  <tr><td>Unidades vendidas</td>{modules.map((m) => <td key={m.line} className="num">{m.units}</td>)}<td className="num">{modules.reduce((a, m) => a + m.units, 0)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card-pad faint" style={{ fontSize: 12 }}>
              Las comisiones se reparten según lo que vendió cada módulo en cada factura. Los gastos generales (arriendo, servicios…) se reparten según la participación de cada módulo en las ventas. La suma de los tres módulos da el total de Contabilidad.
            </div>
          </div>
          <div className="grid g3 mt">
            {modules.map((m) => (
              <div key={m.line} className="card">
                <div className="card-head"><h3>Más vendidos · {MODULE_NAME[m.line]}</h3></div>
                {m.top.length === 0 ? <Empty>Sin ventas en el período.</Empty> : (
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {m.top.map((t) => (
                          <tr key={t.name}><td>{t.qty > 1 ? <b>{t.qty}× </b> : null}{t.name}<small>Ganancia {money(t.profit)}</small></td><td className="num">{money(t.sales)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
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
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Día</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Neto</th></tr></thead>
                <tbody>
                  <tr><td className="strong">Total del período</td><td className="num strong">{money(fiscal.income)}</td><td className="num strong">{money(fiscal.outflow)}</td><td className={`num strong ${fiscal.net < 0 ? 'red' : ''}`}>{money(fiscal.net)}</td></tr>
                  {fiscal.days.map((d) => (
                    <tr key={d.day}><td>{fmtDay(d.day)}</td><td className="num">{money(d.income)}</td><td className="num">{money(d.outflow)}</td><td className={`num ${d.net < 0 ? 'red' : ''}`}>{money(d.net)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr><td>Inventario de celulares (a costo)</td><td className="num">{money(balance.phones)}</td></tr>
                  <tr><td>Inventario de repuestos y accesorios controlados (a costo)</td><td className="num">{money(balance.stock)}</td></tr>
                  <tr><td>Le deben clientes (ventas a crédito tienda)</td><td className="num">{money(balance.receivables)}</td></tr>
                  <tr><td>Debe a proveedores (cuentas por pagar)</td><td className="num red">−{money(balance.payables)}</td></tr>
                  <tr style={{ fontSize: 16 }}><td className="strong">Valor neto aproximado</td><td className={`num strong ${balance.net < 0 ? 'red' : ''}`}>{money(balance.net)}</td></tr>
                </tbody>
              </table>
            </div>
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
