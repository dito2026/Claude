import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, MessageCircle } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { CashMovement, CashSession, Invoice, Product, Purchase, RepairOrder, Seller, Technician } from '../lib/types';
import { whatsappLink } from '../lib/format';
import { buildAlerts } from '../services/automation';
import { useSettings } from '../services/settings';
import type { CashState } from '../services/cash';
import { Badge } from './ui';

export const BACKUP_KEY = 'dcpro:lastBackup';
const lastBackup = () => {
  try { return localStorage.getItem(BACKUP_KEY); } catch { return null; }
};

/** «Pendientes de hoy»: alertas que se arman solas con los datos del negocio. */
export function AlertsCenter({ admin }: { admin: boolean }) {
  const settings = useSettings();
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const products = useCollection<Product>('products').rows;
  const sessions = useCollection<CashSession>('cashSessions').rows;
  const technicians = useCollection<Technician>('technicians').rows;
  const sellers = useCollection<Seller>('sellers').rows;
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const [all, setAll] = useState(false);

  const alerts = useMemo(() => buildAlerts({
    orders, purchases, products, sessions, openSessionId: cash?.openSessionId ?? null, technicians, sellers, invoices, movements,
    businessName: settings.name, lastBackupAt: admin ? lastBackup() : undefined,
  }), [orders, purchases, products, sessions, cash, technicians, sellers, invoices, movements, settings.name, admin]);

  if (alerts.length === 0) {
    return <div className="card card-pad row mt"><BellRing size={18} className="faint" /><span className="muted">Todo al día: no hay pendientes urgentes.</span></div>;
  }
  const shown = all ? alerts : alerts.slice(0, 6);
  return (
    <div className="card mt">
      <div className="card-head">
        <h3><BellRing size={15} className="red" style={{ verticalAlign: -2 }} /> Pendientes de hoy · {alerts.length}</h3>
        {alerts.length > 6 && <button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? 'Ver menos' : 'Ver todos'}</button>}
      </div>
      {shown.map((a) => (
        <div key={a.id} className="list-row">
          <Badge tone={a.level === 'red' ? 'red' : a.level === 'warn' ? 'warn' : 'info'}>{a.level === 'red' ? 'Urgente' : a.level === 'warn' ? 'Atención' : 'Aviso'}</Badge>
          <div className="grow">
            {a.link ? <Link to={a.link} className="strong">{a.title}</Link> : <span className="strong">{a.title}</span>}
            <div className="faint" style={{ fontSize: 12 }}>{a.detail}</div>
          </div>
          {a.whatsapp && (
            <a className="btn sm" href={whatsappLink(a.whatsapp.phone, a.whatsapp.text)} target="_blank" rel="noreferrer"><MessageCircle size={14} />Avisar</a>
          )}
        </div>
      ))}
    </div>
  );
}
