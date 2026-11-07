import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, CircleCheckBig, Clock, Coins, LifeBuoy, MessageCircle,
  Receipt, Smartphone, TrendingDown, TrendingUp, Wallet, Wrench,
} from 'lucide-react';
import { AlertsCenter } from '../components/AlertsCenter';
import { RemindersCard } from '../components/Reminders';
import { DailyProfitCard } from '../components/DailyProfit';
import { ChartCard, ColumnChart, HBarChart, Legend, LineChart, compactMoney, plain, type ChartTable } from '../components/charts';
import { dailySummaryText } from '../services/automation';
import { useSettings } from '../services/settings';
import { whatsappLink } from '../lib/format';
import { useCollection, useDocument } from '../data/hooks';
import type { CashMovement, CashSession, Invoice, Product, RepairOrder, Seller, Ticket } from '../lib/types';
import { sellerBalance } from '../services/sellers';
import { OPEN_STATUSES } from '../lib/types';
import { money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Delta, Empty, PageHead, Seg, Stat } from '../components/ui';
import { orderTone } from '../components/status';
import { isOverdue } from '../services/orders';
import { isLowStock } from '../services/inventory';
import { CASH_METHOD, expectedByMethod, type CashState } from '../services/cash';
import {
  analyticsRange, inventoryByCategory, pctChange, seriesFor, sumStats, totalsBetween, yearComparison, type Grain,
} from '../services/analytics';

const GRAINS: { value: Grain; label: string }[] = [
  { value: 'dia', label: 'Día' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
  { value: 'anio', label: 'Año' },
];
const GRAIN_KEY = 'dcpro:dashGrain';
const PREV_LABEL: Record<Grain, string> = { dia: 'el día anterior', semana: 'la semana anterior', mes: 'el mes anterior', anio: 'el año anterior' };

const readGrain = (): Grain => {
  try {
    const g = localStorage.getItem(GRAIN_KEY) as Grain | null;
    return g && GRAINS.some((x) => x.value === g) ? g : 'mes';
  } catch {
    return 'mes';
  }
};

const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shortMonth = (d: Date) => d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');

function Pair({ items }: { items: [string | number, string][] }) {
  return <span className="pair">{items.map(([v, l]) => <span key={l} className="pv">{v}<small>{l}</small></span>)}</span>;
}

export function Dashboard() {
  const { profile, can } = useAuth();
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const invoices = useCollection<Invoice>('invoices').rows;
  const products = useCollection<Product>('products').rows;
  const tickets = useCollection<Ticket>('tickets').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const sellers = useCollection<Seller>('sellers').rows;
  const mySeller = sellers.find((s) => s.id === profile?.sellerId);
  const myMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const myComm = mySeller ? sellerBalance(mySeller, invoices, movements, myMonth) : null;
  const cashState = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const session = useDocument<CashSession>('cashSessions', cashState?.openSessionId ?? undefined).doc;
  const finance = can('dashboard.finance');
  const settings = useSettings();
  const nav = useNavigate();

  const [grain, setGrainState] = useState<Grain>(readGrain);
  const [offset, setOffset] = useState(0);
  const setGrain = (g: Grain) => {
    setGrainState(g);
    setOffset(0);
    try { localStorage.setItem(GRAIN_KEY, g); } catch { /* sin almacenamiento */ }
  };

  const techId = profile?.role === 'tecnico' ? profile.technicianId : null;
  const mine = useMemo(() => (techId != null ? orders.filter((o) => o.technicianId === techId) : orders), [orders, techId]);
  const open = mine.filter((o) => OPEN_STATUSES.includes(o.status));
  const overdue = open.filter(isOverdue);
  const ready = mine.filter((o) => o.status === 'Reparado / Listo');
  const low = products.filter(isLowStock);
  const openTickets = tickets.filter((t) => t.status !== 'cerrado' && t.status !== 'resuelto');

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const data = useMemo(() => ({ invoices, movements, products, orders: mine }), [invoices, movements, products, mine]);

  // KPIs fijos: hoy y mes en curso, comparados con el mismo corte del periodo anterior
  const kpi = useMemo(() => {
    const now = new Date();
    const today = sod(now);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    const prevCut = new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(today.getDate(), prevDays) + 1);
    return {
      today: totalsBetween(today, tomorrow, data, productMap),
      yesterday: totalsBetween(yesterday, new Date(now.getTime() - 86400000), data, productMap),
      month: totalsBetween(monthStart, tomorrow, data, productMap),
      prevMonth: totalsBetween(prevStart, prevCut, data, productMap),
      prevLabel: shortMonth(prevStart),
    };
  }, [data, productMap]);

  const inventory = useMemo(() => inventoryByCategory(products), [products]);

  // Periodo de los gráficos (filtros Día / Semana / Mes / Año con navegación a periodos anteriores)
  const view = useMemo(() => {
    const now = new Date();
    const range = analyticsRange(grain, offset, now);
    const rows = seriesFor(range.buckets, data, productMap);
    const total = sumStats(rows);
    const prev = analyticsRange(grain, offset - 1, now);
    // periodo en curso: se compara con el mismo tramo transcurrido del anterior
    const prevTo = range.isCurrent ? new Date(prev.from.getTime() + (now.getTime() - range.from.getTime())) : prev.to;
    const before = totalsBetween(prev.from, prevTo, data, productMap);
    const year = yearComparison(range.from.getFullYear(), data, now);
    return { range, rows, total, before, year };
  }, [grain, offset, data, productMap]);

  const cashNow = session
    ? expectedByMethod(session, movements.filter((m) => m.sessionId === session.id), [CASH_METHOD])[CASH_METHOD]
    : 0;

  const recent = [...open].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 7);

  const { range, rows, total, before, year } = view;
  const labels = range.buckets.map((b) => b.label);
  const longLabels = range.buckets.map((b) => b.long);
  const animKey = `${grain}:${offset}`;
  const hasCurrent = range.buckets.some((b) => b.current);
  const prevLabel = PREV_LABEL[grain];
  const margin = (net: number, income: number) => (income > 0 ? `${Math.round((net / income) * 100)}% de margen` : 'Sin ventas');
  const table = (cols: string[], pick: (i: number) => (string | number)[], tot: (string | number)[]): ChartTable => ({
    columns: cols,
    rows: range.buckets.map((_, i) => [longLabels[i], ...pick(i)]),
    total: ['Total', ...tot],
  });
  const yearNow = range.from.getFullYear();

  return (
    <>
      <PageHead
        eyebrow={new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Hola, ${profile?.name?.split(' ')[0] ?? ''}`}
        subtitle="Resumen del negocio en tiempo real."
        actions={
          <>
            {can('orders.create') && <Link className="btn" to="/taller?nueva=1"><Wrench size={16} />Nueva orden</Link>}
            {finance && settings.phone && (
              <a className="btn" title="Resumen de ventas, utilidad y órdenes de hoy al WhatsApp del negocio"
                href={whatsappLink(settings.phone, dailySummaryText({ invoices, movements, products, orders, businessName: settings.name }))} target="_blank" rel="noreferrer">
                <MessageCircle size={16} />Resumen del día
              </a>
            )}
            {can('billing') && <Link className="btn primary" to="/facturacion"><TrendingUp size={16} />Vender</Link>}
          </>
        }
      />

      {finance && <AlertsCenter admin={can('settings')} />}
      <RemindersCard />

      {finance && (
        <div className="kpis mt">
          <Stat accent label="Ventas del día" value={money(kpi.today.income)} icon={<TrendingUp size={15} />}
            delta={<Delta pct={pctChange(kpi.today.income, kpi.yesterday.income)} label="ayer a esta hora" />}
            sub={<>{kpi.today.invoices} comprobantes · ganancia <span className={kpi.today.net < 0 ? 'red' : ''}>{money(kpi.today.net)}</span></>} />
          <Stat label="Ingresos del mes" value={money(kpi.month.income)} icon={<Coins size={15} />}
            delta={<Delta pct={pctChange(kpi.month.income, kpi.prevMonth.income)} label={`${kpi.prevLabel} al mismo día`} />}
            sub={`${kpi.month.invoices} comprobantes`} />
          <Stat label="Gastos del mes" value={money(kpi.month.expenses)} icon={<TrendingDown size={15} />}
            delta={<Delta invert pct={pctChange(kpi.month.expenses, kpi.prevMonth.expenses)} label={`${kpi.prevLabel} al mismo día`} />}
            sub={`Costo ${money(kpi.month.cost)} · gastos ${money(kpi.month.operating)}${kpi.month.commissions ? ` · comisiones ${money(kpi.month.commissions)}` : ''}`} />
          <Stat label="Ganancia neta del mes" value={<span className={kpi.month.net < 0 ? 'red' : ''}>{money(kpi.month.net)}</span>} icon={<Receipt size={15} />}
            delta={<Delta pct={pctChange(kpi.month.net, kpi.prevMonth.net)} label={`${kpi.prevLabel} al mismo día`} />}
            sub={margin(kpi.month.net, kpi.month.income)} />
          <Stat label="Efectivo en caja" value={session ? money(cashNow) : '—'} icon={<Wallet size={15} />}
            sub={session ? `Caja abierta por ${session.openedBy}` : 'Caja cerrada'} />
          <Stat label="Productos disponibles" value={plain(inventory.units)} icon={<Boxes size={15} />}
            sub={<>{inventory.refs} referencias{low.length ? <> · <span className="red">{low.length} con stock bajo</span></> : ''}</>} />
          <Stat label="Servicios pendientes" value={open.length} icon={<Clock size={15} />}
            sub={<><span className={overdue.length ? 'red' : ''}>{overdue.length} atrasadas</span> · {openTickets.length} tickets abiertos</>} />
          <Stat label="Servicios terminados" value={kpi.month.finished} icon={<CircleCheckBig size={15} />}
            sub={`Este mes · ${ready.length} listos para entregar`} />
        </div>
      )}

      {myComm && (
        <div className="grid g3 mt">
          <Stat accent label="Mis ventas del mes" value={money(myComm.sales)} sub={`${myComm.count} ventas como ${mySeller!.name}`} />
          <Stat label="Mi comisión del mes" value={money(myComm.periodCommission)} sub={`${mySeller!.commissionPct}% ${mySeller!.commissionBase === 'venta' ? 'sobre la venta' : 'sobre la ganancia'}`} />
          <Stat label="Comisión por cobrar" value={money(myComm.owed)} sub={`Pagado: ${money(myComm.paid)}`} />
        </div>
      )}

      {!finance && (
        <div className="kpis mt">
          <Stat label="Órdenes abiertas" value={open.length} icon={<Wrench size={15} />} />
          <Stat label="Atrasadas" value={<span className={overdue.length ? 'red' : ''}>{overdue.length}</span>} icon={<Clock size={15} />} />
          <Stat label="Listas para entregar" value={ready.length} icon={<CheckCircle2 size={15} />} />
          <Stat label="Tickets abiertos" value={openTickets.length} icon={<LifeBuoy size={15} />} />
        </div>
      )}

      {finance && (
        <>
          <div className="section-head">
            <div>
              <h2>Análisis del negocio</h2>
              <p>Datos reales de facturación, caja, taller e inventario. Toca un gráfico para ver el detalle.</p>
            </div>
          </div>
          <div className="period-bar">
            <Seg value={grain} onChange={setGrain} options={GRAINS} />
            <div className="period-nav">
              <button type="button" className="btn sm icon-only" onClick={() => setOffset((o) => o - 1)} aria-label="Periodo anterior" title="Periodo anterior"><ChevronLeft size={16} /></button>
              <span className="period-label">{range.label}</span>
              <button type="button" className="btn sm icon-only" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} aria-label="Periodo siguiente" title="Periodo siguiente"><ChevronRight size={16} /></button>
              {offset !== 0 && <button type="button" className="btn sm ghost" onClick={() => setOffset(0)}>Volver al actual</button>}
            </div>
          </div>

          <div className="charts">
            <ChartCard className="span-2" title="Ventas" icon={<TrendingUp size={15} />}
              value={money(total.income)}
              sub={<><Delta pct={pctChange(total.income, before.income)} label={prevLabel} /> <span>{total.invoices} comprobantes</span></>}
              table={table(['Periodo', 'Ventas', 'Comprobantes'], (i) => [money(rows[i].income), rows[i].invoices], [money(total.income), total.invoices])}>
              <ColumnChart labels={labels} longLabels={longLabels} animKey={animKey} format={money} axisFormat={compactMoney}
                series={[{ key: 'ventas', label: 'Ventas', color: 'var(--s-ink)', values: rows.map((r) => r.income) }]}
                barColors={hasCurrent ? range.buckets.map((b) => (b.current ? 'var(--s-accent)' : 'var(--s-context)')) : undefined} />
            </ChartCard>

            <ChartCard title="Ingresos vs gastos" icon={<Coins size={15} />}
              value={<Pair items={[[money(total.income), 'ingresos'], [money(total.expenses), 'gastos']]} />}
              sub="Gastos = costo de lo vendido + gastos de caja + comisiones"
              legend={<Legend items={[{ label: 'Ingresos', color: 'var(--s1)' }, { label: 'Gastos', color: 'var(--s2)' }]} />}
              table={table(['Periodo', 'Ingresos', 'Costo', 'Gastos de caja', 'Comisiones', 'Total gastos'],
                (i) => [money(rows[i].income), money(rows[i].cost), money(rows[i].operating), money(rows[i].commissions), money(rows[i].expenses)],
                [money(total.income), money(total.cost), money(total.operating), money(total.commissions), money(total.expenses)])}>
              <ColumnChart labels={labels} longLabels={longLabels} animKey={animKey} format={money} axisFormat={compactMoney}
                series={[
                  { key: 'ing', label: 'Ingresos', color: 'var(--s1)', values: rows.map((r) => r.income) },
                  { key: 'gas', label: 'Gastos', color: 'var(--s2)', values: rows.map((r) => r.expenses) },
                ]} />
            </ChartCard>

            <ChartCard title="Ganancia neta" icon={<Receipt size={15} />}
              value={<span className={total.net < 0 ? 'red' : ''}>{money(total.net)}</span>}
              sub={<><Delta pct={pctChange(total.net, before.net)} label={prevLabel} /> <span>{margin(total.net, total.income)}</span></>}
              table={table(['Periodo', 'Ingresos', 'Gastos', 'Ganancia neta'], (i) => [money(rows[i].income), money(rows[i].expenses), money(rows[i].net)], [money(total.income), money(total.expenses), money(total.net)])}>
              <LineChart labels={labels} longLabels={longLabels} animKey={animKey} format={money} axisFormat={compactMoney} area
                series={[{ key: 'net', label: 'Ganancia neta', color: 'var(--s-ink)', values: rows.map((r, i) => (range.buckets[i].from.getTime() > Date.now() ? null : r.net)) }]} />
            </ChartCard>

            <ChartCard title="Servicios técnicos" icon={<Wrench size={15} />}
              value={<Pair items={[[total.received, 'recibidos'], [total.finished, 'terminados']]} />}
              sub={`${open.length} pendientes hoy`}
              legend={<Legend items={[{ label: 'Recibidos', color: 'var(--s1)' }, { label: 'Terminados', color: 'var(--s2)' }]} />}
              table={table(['Periodo', 'Recibidos', 'Terminados'], (i) => [rows[i].received, rows[i].finished], [total.received, total.finished])}>
              <ColumnChart labels={labels} longLabels={longLabels} animKey={animKey} format={plain} empty="Sin órdenes en este periodo"
                series={[
                  { key: 'rec', label: 'Recibidos', color: 'var(--s1)', values: rows.map((r) => r.received) },
                  { key: 'ter', label: 'Terminados', color: 'var(--s2)', values: rows.map((r) => r.finished) },
                ]} />
            </ChartCard>

            <ChartCard title="Celulares y accesorios vendidos" icon={<Smartphone size={15} />}
              value={<Pair items={[[plain(total.phones), 'celulares'], [plain(total.accessories), 'accesorios']]} />}
              sub="Unidades vendidas"
              legend={<Legend items={[{ label: 'Celulares', color: 'var(--s1)' }, { label: 'Accesorios', color: 'var(--s2)' }]} />}
              table={table(['Periodo', 'Celulares', 'Accesorios'], (i) => [plain(rows[i].phones), plain(rows[i].accessories)], [plain(total.phones), plain(total.accessories)])}>
              <ColumnChart labels={labels} longLabels={longLabels} animKey={animKey} format={plain} empty="Sin unidades vendidas en este periodo"
                series={[
                  { key: 'cel', label: 'Celulares', color: 'var(--s1)', values: rows.map((r) => r.phones) },
                  { key: 'acc', label: 'Accesorios', color: 'var(--s2)', values: rows.map((r) => r.accessories) },
                ]} />
            </ChartCard>

            <ChartCard title={`Comparativo mensual de ventas · ${yearNow} vs ${yearNow - 1}`} icon={<TrendingUp size={15} />}
              value={money(year.reduce((a, m) => a + (m.future ? 0 : m.current), 0))}
              sub={<><Delta pct={pctChange(year.reduce((a, m) => a + (m.future ? 0 : m.current), 0), year.reduce((a, m) => a + (m.future ? 0 : m.previous), 0))} label={`${yearNow - 1} al mismo mes`} /> <span>acumulado del año</span></>}
              legend={<Legend items={[{ label: String(yearNow), color: 'var(--s-accent)' }, { label: String(yearNow - 1), color: 'var(--s-context)', dashed: true }]} />}
              table={{
                columns: ['Mes', String(yearNow), String(yearNow - 1), 'Variación'],
                rows: year.map((m) => [m.label, m.future ? '—' : money(m.current), money(m.previous), m.future ? '—' : (() => { const p = pctChange(m.current, m.previous); return p == null ? '—' : `${p > 0 ? '+' : ''}${p}%`; })()]),
              }}>
              <LineChart labels={year.map((m) => m.label)} animKey={`y${yearNow}`} format={money} axisFormat={compactMoney}
                series={[
                  { key: 'cur', label: String(yearNow), color: 'var(--s-accent)', values: year.map((m) => (m.future ? null : m.current)) },
                  { key: 'prev', label: String(yearNow - 1), color: 'var(--s-context)', values: year.map((m) => m.previous), dashed: true },
                ]} />
            </ChartCard>
            <ChartCard title="Inventario disponible" icon={<Boxes size={15} />} value={`${plain(inventory.units)} unidades`}
              sub={`Existencias actuales · costo ${money(inventory.value)}`}
              table={{ columns: ['Categoría', 'Unidades', 'Referencias', 'Costo'], rows: inventory.rows.map((r) => [r.category, plain(r.units), r.refs, money(r.value)]), total: ['Total', plain(inventory.units), inventory.refs, money(inventory.value)] }}>
              {inventory.rows.length === 0 ? (
                <Empty icon={<Boxes size={30} />}>No hay productos con existencias.</Empty>
              ) : (
                <HBarChart rows={inventory.rows.map((r) => ({ label: r.category, value: r.units, sub: `${r.refs} ref.` }))} format={plain} sub={(r) => r.sub} />
              )}
            </ChartCard>

          </div>

          <DailyProfitCard />
        </>
      )}

      <div className="grid g-main mt">
        <div className="card">
          <div className="card-head">
            <h3>Órdenes en curso</h3>
            <Link to="/taller" className="btn sm ghost">Ver todas</Link>
          </div>
          {recent.length === 0 ? (
            <Empty>No hay órdenes abiertas.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/taller/${o.id}`)}>
                      <td className="mono">OT {pad(o.number)}</td>
                      <td><span className="strong">{o.device.brand} {o.device.model}</span><small>{o.customer.name}</small></td>
                      <td className="hide-sm">{o.technicianName || <span className="faint">Sin asignar</span>}</td>
                      <td>{isOverdue(o) ? <Badge tone="red">Atrasada</Badge> : <Badge tone={orderTone(o.status)}>{o.status}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Alertas de inventario</h3>
            <Link to="/inventario" className="btn sm ghost">Inventario</Link>
          </div>
          {low.length === 0 ? (
            <Empty icon={<CheckCircle2 size={30} />}>Todo el stock está sobre el mínimo.</Empty>
          ) : (
            low.slice(0, 6).map((p) => (
              <div key={p.id} className="list-row">
                <AlertTriangle size={16} className="red" />
                <div className="grow min0">{p.name}<small className="faint" style={{ display: 'block' }}>{p.sku}</small></div>
                <span className="mono">{p.stock} / {p.minStock}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
