// Módulos del negocio: Celulares · Accesorios · Servicio técnico.
// Cada uno muestra sus ventas y ganancia (misma regla que Contabilidad: lineOf), su inventario y accesos rápidos.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ClipboardList, FileOutput, Handshake, Headphones, LifeBuoy, PackagePlus, Receipt, Smartphone, Truck, Wrench,
} from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, Invoice, PhoneUnit, Product, RepairOrder, Ticket, UsedPurchase } from '../lib/types';
import { OPEN_STATUSES } from '../lib/types';
import { dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { buildReport, inPeriod, lineOf, periodRange, type Line, type PeriodKind } from '../services/accounting';
import { finishedAt, inventoryByCategory } from '../services/analytics';
import { isLowStock } from '../services/inventory';
import { isOverdue } from '../services/orders';
import { orderTone } from '../components/status';
import { HBarChart, plain } from '../components/charts';
import { Badge, Empty, PageHead, Seg, Stat } from '../components/ui';

export type ModuleKey = 'celulares' | 'accesorios' | 'servicio';

const META: Record<ModuleKey, { line: Line; title: string; eyebrow: string; subtitle: string; icon: ReactNode }> = {
  celulares: { line: 'Equipos', title: 'Celulares', eyebrow: 'Módulo', icon: <Smartphone size={15} />, subtitle: 'Equipos nuevos y usados controlados por IMEI: inventario, ventas y ganancia.' },
  accesorios: { line: 'Accesorios', title: 'Accesorios', eyebrow: 'Módulo', icon: <Headphones size={15} />, subtitle: 'Sim cards, audífonos, vidrios, forros, cargadores y demás: inventario, ventas y ganancia.' },
  servicio: { line: 'Servicio técnico', title: 'Servicio técnico', eyebrow: 'Módulo', icon: <Wrench size={15} />, subtitle: 'Órdenes de reparación, repuestos y mano de obra.' },
};

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'hoy', label: 'Hoy' }, { value: '7dias', label: '7 días' }, { value: 'mes', label: 'Mes' }, { value: 'anio', label: 'Año' },
];

export function LineModule({ module }: { module: ModuleKey }) {
  const meta = META[module];
  const { profile, can } = useAuth();
  const finance = can('dashboard.finance');
  const nav = useNavigate();
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const products = useCollection<Product>('products').rows;
  const units = useCollection<PhoneUnit>('phoneUnits').rows;
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const tickets = useCollection<Ticket>('tickets').rows;
  const used = useCollection<UsedPurchase>('usedPurchases').rows;
  const [period, setPeriod] = useState<PeriodKind>('mes');
  const range = useMemo(() => periodRange(period), [period]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Ventas de la línea en el periodo (con la misma regla de Contabilidad)
  const report = useMemo(() => buildReport(range, { invoices, movements, products }), [range, invoices, movements, products]);
  const line = report.byLine.find((l) => l.line === meta.line)!;
  const sold = useMemo(() => {
    const rows: { at: string; invoice: number; customer: string; name: string; qty: number; total: number; imei?: string }[] = [];
    for (const inv of invoices) {
      if (inv.status === 'anulada' || !inPeriod(inv.createdAt, range)) continue;
      for (const it of inv.items) {
        if (lineOf(it, productMap) !== meta.line) continue;
        rows.push({ at: inv.createdAt ?? '', invoice: inv.number, customer: inv.customer.name || 'Consumidor final', name: it.description, qty: it.qty, total: it.qty * it.unitPrice, imei: it.imei });
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [invoices, range, productMap, meta.line]);
  const unitsSold = sold.reduce((a, r) => a + r.qty, 0);

  const actions: ReactNode = {
    celulares: <>
      {can('purchases') && <Link className="btn" to="/usados"><Handshake size={16} />Comprar usado</Link>}
      {can('purchases') && <Link className="btn" to="/compras"><Truck size={16} />Comprar a proveedor</Link>}
      {can('billing') && <Link className="btn primary" to="/facturacion"><Receipt size={16} />Vender</Link>}
    </>,
    accesorios: <>
      {can('billing') && <Link className="btn" to="/remisiones"><FileOutput size={16} />Remisión</Link>}
      {can('purchases') && <Link className="btn" to="/compras"><Truck size={16} />Comprar</Link>}
      {can('billing') && <Link className="btn primary" to="/facturacion"><Receipt size={16} />Vender</Link>}
    </>,
    servicio: <>
      <Link className="btn" to="/tickets"><LifeBuoy size={16} />Tickets</Link>
      <Link className="btn" to="/taller"><ClipboardList size={16} />Ver órdenes</Link>
      {can('orders.create') && <Link className="btn primary" to="/taller?nueva=1"><Wrench size={16} />Nueva orden</Link>}
    </>,
  }[module];

  return (
    <>
      <PageHead eyebrow={meta.eyebrow} title={meta.title} subtitle={meta.subtitle} actions={actions} />

      {finance && (
        <>
          <div className="period-bar" style={{ position: 'static' }}>
            <Seg value={period} onChange={setPeriod} options={PERIODS} />
          </div>
          <div className="kpis">
            <Stat accent label="Ventas" value={money(line.sales)} icon={meta.icon} sub={`${unitsSold} ${module === 'servicio' ? 'líneas facturadas' : 'unidades vendidas'}`} />
            <Stat label="Costo" value={money(line.cost)} sub={module === 'servicio' ? 'Repuestos + pago al técnico' : 'Lo que costó lo vendido'} />
            <Stat label="Ganancia bruta" value={<span className={line.profit < 0 ? 'red' : ''}>{money(line.profit)}</span>} sub={line.margin == null ? 'Sin ventas' : `${Math.round(line.margin * 100)}% de margen`} />
            {module === 'celulares' && <Stat label="Comprados usados" value={used.filter((u) => inPeriod(u.createdAt, range)).length} sub="Contratos de compraventa en el periodo" icon={<Handshake size={15} />} />}
            {module === 'accesorios' && <Stat label="Participación" value={report.income > 0 ? `${Math.round((line.sales / report.income) * 100)}%` : '—'} sub="De las ventas totales del periodo" />}
            {module === 'servicio' && <Stat label="Reparaciones terminadas" value={orders.filter((o) => inPeriod(finishedAt(o), range)).length} sub={`${orders.filter((o) => inPeriod(o.createdAt, range)).length} recibidas en el periodo`} icon={<Wrench size={15} />} />}
          </div>
        </>
      )}

      <div className="grid g-main mt">
        {module === 'celulares' && <PhonesStock units={units} />}
        {module === 'accesorios' && <AccessoriesStock products={products} />}
        {module === 'servicio' && <ServiceBoard orders={profile?.role === 'tecnico' ? orders.filter((o) => o.technicianId === profile.technicianId) : orders} tickets={tickets} products={products} onOpen={(id) => nav(`/taller/${id}`)} />}

        {finance ? (
          <div className="card">
            <div className="card-head"><h3>Últimas ventas · {PERIODS.find((p) => p.value === period)!.label.toLowerCase()}</h3><Link to="/facturacion" className="btn sm ghost">Facturación</Link></div>
            {sold.length === 0 ? <Empty icon={<Receipt size={30} />}>Sin ventas de {meta.title.toLowerCase()} en este periodo.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {sold.slice(0, 12).map((r, k) => (
                      <tr key={k}>
                        <td><span className="strong">{r.qty > 1 ? `${r.qty}× ` : ''}{r.name}</span><small>{r.imei ? `IMEI ${r.imei} · ` : ''}{r.customer} · Fact. {pad(r.invoice, 6)} · {dateTime(r.at)}</small></td>
                        <td className="num">{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : <div />}
      </div>
    </>
  );
}

function PhonesStock({ units }: { units: PhoneUnit[] }) {
  const available = units.filter((u) => u.status === 'disponible');
  const remitted = units.filter((u) => u.status === 'remisionado');
  const byModel = useMemo(() => {
    const m = new Map<string, { n: number; nuevos: number; usados: number; cost: number }>();
    for (const u of available) {
      const r = m.get(u.productName) ?? { n: 0, nuevos: 0, usados: 0, cost: 0 };
      r.n++; r.cost += u.cost || 0;
      if (u.condition === 'USADO') r.usados++; else r.nuevos++;
      m.set(u.productName, r);
    }
    return [...m].sort((a, b) => b[1].n - a[1].n);
  }, [available]);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Celulares en el local · {available.length}{remitted.length ? <span className="faint" style={{ fontWeight: 400 }}> · {remitted.length} en remisión</span> : null}</h3>
        <Link to="/inventario" className="btn sm ghost">Inventario</Link>
      </div>
      {byModel.length === 0 ? <Empty icon={<Smartphone size={30} />}>No hay celulares disponibles.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Modelo</th><th className="num">Nuevos</th><th className="num">Usados</th><th className="num">Costo</th></tr></thead>
            <tbody>
              {byModel.map(([name, r]) => (
                <tr key={name}><td className="strong">{name}</td><td className="num">{r.nuevos || '—'}</td><td className="num">{r.usados || '—'}</td><td className="num">{money(r.cost)}</td></tr>
              ))}
              <tr><td className="strong">Total</td><td className="num strong">{available.filter((u) => u.condition !== 'USADO').length}</td><td className="num strong">{available.filter((u) => u.condition === 'USADO').length}</td><td className="num strong">{money(available.reduce((a, u) => a + (u.cost || 0), 0))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccessoriesStock({ products }: { products: Product[] }) {
  const acc = products.filter((p) => p.type === 'ACCESORIO');
  const inv = inventoryByCategory(acc);
  const low = acc.filter(isLowStock);
  return (
    <div className="card">
      <div className="card-head"><h3>Accesorios en el local · {plain(inv.units)} unidades</h3><Link to="/inventario" className="btn sm ghost"><PackagePlus size={14} />Inventario</Link></div>
      <div className="card-pad" style={{ paddingTop: 8 }}>
        {inv.rows.length === 0 ? <Empty>No hay accesorios con existencias.</Empty>
          : <HBarChart rows={inv.rows.map((r) => ({ label: r.category, value: r.units, sub: `${r.refs} ref.` }))} format={plain} sub={(r) => r.sub} max={10} />}
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>{inv.refs} referencias · costo {money(inv.value)}</div>
      </div>
      {low.length > 0 && (
        <>
          <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}><h3>Por pedir · {low.length}</h3></div>
          {low.slice(0, 8).map((p) => (
            <div key={p.id} className="list-row"><AlertTriangle size={16} className="red" /><div className="grow min0">{p.name}</div><span className="mono">{p.stock} / {p.minStock}</span></div>
          ))}
        </>
      )}
    </div>
  );
}

function ServiceBoard({ orders, tickets, products, onOpen }: { orders: RepairOrder[]; tickets: Ticket[]; products: Product[]; onOpen: (id: string) => void }) {
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const overdue = open.filter(isOverdue);
  const byStatus = OPEN_STATUSES.map((s) => ({ s, n: open.filter((o) => o.status === s).length })).filter((x) => x.n);
  const lowParts = products.filter((p) => p.type === 'REPUESTO' && isLowStock(p));
  const openTickets = tickets.filter((t) => t.status !== 'cerrado' && t.status !== 'resuelto').length;
  const recent = [...open].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 8);
  return (
    <div className="stack">
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <Stat label="En taller" value={open.length} icon={<Wrench size={15} />} />
        <Stat label="Atrasadas" value={<span className={overdue.length ? 'red' : ''}>{overdue.length}</span>} />
        <Stat label="Tickets abiertos" value={openTickets} icon={<LifeBuoy size={15} />} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Órdenes en curso</h3><div className="row gap-sm">{byStatus.map((x) => <Badge key={x.s} tone={orderTone(x.s)}>{x.s} · {x.n}</Badge>)}</div></div>
        {recent.length === 0 ? <Empty>No hay órdenes abiertas.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="click" onClick={() => onOpen(o.id)}>
                    <td className="mono">OT {pad(o.number)}</td>
                    <td><span className="strong">{o.device.brand} {o.device.model}</span><small>{o.customer.name}</small></td>
                    <td>{isOverdue(o) ? <Badge tone="red">Atrasada</Badge> : <Badge tone={orderTone(o.status)}>{o.status}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {lowParts.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Repuestos por pedir · {lowParts.length}</h3><Link to="/compras" className="btn sm ghost">Comprar</Link></div>
          {lowParts.slice(0, 8).map((p) => (
            <div key={p.id} className="list-row"><AlertTriangle size={16} className="red" /><div className="grow min0">{p.name}</div><span className="mono">{p.stock} / {p.minStock}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
