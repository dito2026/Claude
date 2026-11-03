import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, LifeBuoy, Package, TrendingUp, Wallet, Wrench } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { CashMovement, CashSession, Invoice, Product, RepairOrder, Seller, Ticket } from '../lib/types';
import { sellerBalance } from '../services/sellers';
import { OPEN_STATUSES } from '../lib/types';
import { daysAgo, money, pad, sameDay } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, PageHead, Stat } from '../components/ui';
import { orderTone } from '../components/status';
import { isOverdue } from '../services/orders';
import { invoiceCost } from '../services/billing';
import { isLowStock } from '../services/inventory';
import { CASH_METHOD, expectedByMethod, type CashState } from '../services/cash';

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
  const nav = useNavigate();

  const mine = profile?.role === 'tecnico' ? orders.filter((o) => o.technicianId === profile.technicianId) : orders;
  const open = mine.filter((o) => OPEN_STATUSES.includes(o.status));
  const overdue = open.filter(isOverdue);
  const ready = mine.filter((o) => o.status === 'Reparado / Listo');
  const low = products.filter(isLowStock);
  const openTickets = tickets.filter((t) => t.status !== 'cerrado' && t.status !== 'resuelto');

  const stats = useMemo(() => {
    const valid = invoices.filter((i) => i.status !== 'anulada');
    const today = valid.filter((i) => sameDay(i.createdAt));
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const month = valid.filter((i) => new Date(i.createdAt ?? 0) >= monthStart);
    const salesMonth = month.reduce((a, i) => a + i.total, 0);
    const profitMonth = month.reduce((a, i) => a + i.total - invoiceCost(i), 0);
    const days = Array.from({ length: 7 }, (_, k) => {
      const d = daysAgo(6 - k);
      const total = valid.filter((i) => sameDay(i.createdAt, d)).reduce((a, i) => a + i.total, 0);
      return { label: d.toLocaleDateString('es-CO', { weekday: 'short' }), total, today: k === 6 };
    });
    return {
      salesToday: today.reduce((a, i) => a + i.total, 0),
      countToday: today.length,
      salesMonth,
      profitMonth,
      margin: salesMonth ? Math.round((profitMonth / salesMonth) * 100) : 0,
      days,
      max: Math.max(1, ...days.map((d) => d.total)),
    };
  }, [invoices]);

  const cashNow = session
    ? expectedByMethod(session, movements.filter((m) => m.sessionId === session.id), [CASH_METHOD])[CASH_METHOD]
    : 0;

  const recent = [...open].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 7);

  return (
    <>
      <PageHead
        eyebrow={new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Hola, ${profile?.name?.split(' ')[0] ?? ''}`}
        subtitle="Resumen del negocio en tiempo real."
        actions={
          <>
            {can('orders.create') && <Link className="btn" to="/taller?nueva=1"><Wrench size={16} />Nueva orden</Link>}
            {can('billing') && <Link className="btn primary" to="/facturacion"><TrendingUp size={16} />Vender</Link>}
          </>
        }
      />

      {finance && (
        <div className="grid g4">
          <Stat accent label="Ventas de hoy" value={money(stats.salesToday)} sub={`${stats.countToday} comprobantes`} icon={<TrendingUp size={14} />} />
          <Stat label="Ventas del mes" value={money(stats.salesMonth)} sub={`Utilidad bruta ${money(stats.profitMonth)} · ${stats.margin}%`} />
          <Stat label="Efectivo en caja" value={session ? money(cashNow) : '—'} sub={session ? `Caja abierta por ${session.openedBy}` : 'Caja cerrada'} icon={<Wallet size={14} />} />
          <Stat label="Stock bajo" value={low.length} sub="productos en o bajo el mínimo" icon={<Package size={14} />} />
        </div>
      )}

      {myComm && (
        <div className="grid g3 mt">
          <Stat accent label="Mis ventas del mes" value={money(myComm.sales)} sub={`${myComm.count} ventas como ${mySeller!.name}`} />
          <Stat label="Mi comisión del mes" value={money(myComm.periodCommission)} sub={`${mySeller!.commissionPct}% ${mySeller!.commissionBase === 'venta' ? 'sobre la venta' : 'sobre la ganancia'}`} />
          <Stat label="Comisión por cobrar" value={money(myComm.owed)} sub={`Pagado: ${money(myComm.paid)}`} />
        </div>
      )}

      <div className="grid g4 mt">
        <Stat label="Órdenes abiertas" value={open.length} icon={<Wrench size={14} />} />
        <Stat label="Atrasadas" value={<span className={overdue.length ? 'red' : ''}>{overdue.length}</span>} icon={<Clock size={14} />} />
        <Stat label="Listas para entregar" value={ready.length} icon={<CheckCircle2 size={14} />} />
        <Stat label="Tickets abiertos" value={openTickets.length} icon={<LifeBuoy size={14} />} />
      </div>

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
                      <td>{o.technicianName || <span className="faint">Sin asignar</span>}</td>
                      <td>{isOverdue(o) ? <Badge tone="red">Atrasada</Badge> : <Badge tone={orderTone(o.status)}>{o.status}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="stack">
          {finance && (
            <div className="card">
              <div className="card-head"><h3>Ventas · últimos 7 días</h3></div>
              <div className="card-pad">
                <div className="chart">
                  {stats.days.map((d) => (
                    <div key={d.label + d.today} className={`col ${d.today ? 'today' : ''}`} title={money(d.total)}>
                      <i style={{ height: `${(d.total / stats.max) * 100}%` }} />
                      <small>{d.label}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
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
                  <div className="grow">{p.name}<small className="faint" style={{ display: 'block' }}>{p.sku}</small></div>
                  <span className="mono">{p.stock} / {p.minStock}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
