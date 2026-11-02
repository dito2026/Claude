import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Customer, Invoice, RepairOrder } from '../lib/types';
import { dateOnly, matches, money, pad, whatsappLink } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, SearchBox, useAction } from '../components/ui';
import { orderTone } from '../components/status';
import { deleteCustomer, saveCustomer, type CustomerInput } from '../services/customers';

const EMPTY: CustomerInput = { document: '', name: '', phone: '', email: '', address: '', notes: '' };

export function Customers() {
  const { rows: customers, loading } = useCollection<Customer>('customers');
  const invoices = useCollection<Invoice>('invoices').rows;
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const { can, actor } = useAuth();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id?: string; data: CustomerInput } | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; tickets: number; orders: number; credit: number; last?: string }>();
    for (const c of customers) m.set(c.id, { total: 0, tickets: 0, orders: 0, credit: 0 });
    for (const i of invoices) {
      if (!i.customerId || i.status === 'anulada') continue;
      const s = m.get(i.customerId);
      if (!s) continue;
      s.total += i.total;
      s.tickets += 1;
      if (i.status === 'credito') s.credit += i.payments.filter((p) => p.method === 'Crédito tienda').reduce((a, p) => a + p.amount, 0);
      if (!s.last || (i.createdAt ?? '') > s.last) s.last = i.createdAt;
    }
    for (const o of orders) {
      const s = m.get(o.customerId);
      if (s) s.orders += 1;
    }
    return m;
  }, [customers, invoices, orders]);

  const list = customers
    .filter((c) => matches(q, c.name, c.document, c.phone, c.email))
    .sort((a, b) => a.name.localeCompare(b.name));

  const save = () =>
    editing &&
    run(async () => {
      await saveCustomer(actor, editing.data, editing.id, customers);
      setEditing(null);
    }, 'Cliente guardado');

  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) =>
    editing && setEditing({ ...editing, data: { ...editing.data, [k]: e.target.value } });

  return (
    <>
      <PageHead
        eyebrow="Relación con clientes"
        title="Clientes"
        subtitle={`${customers.length} clientes registrados`}
        actions={
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Nombre, documento o celular" />
            {can('customers.edit') && (
              <button className="btn primary" onClick={() => setEditing({ data: { ...EMPTY, name: q } })}><Plus size={16} />Nuevo cliente</button>
            )}
          </>
        }
      />
      <div className="card">
        {loading ? <Empty>Cargando…</Empty> : list.length === 0 ? <Empty>No hay clientes que coincidan.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Cliente</th><th>Contacto</th><th className="num">Comprobantes</th><th className="num">Total comprado</th><th className="num">Órdenes</th><th>Última compra</th><th className="num">Le debe</th><th /></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const s = stats.get(c.id)!;
                  return (
                    <tr key={c.id} className="click" onClick={() => setDetail(c)}>
                      <td><span className="strong">{c.name}</span><small className="mono">{c.document || 'Sin documento'}</small></td>
                      <td>{c.phone || '—'}<small>{c.email}</small></td>
                      <td className="num">{s.tickets}</td>
                      <td className="num">{money(s.total)}</td>
                      <td className="num">{s.orders}</td>
                      <td>{dateOnly(s.last)}</td>
                      <td className="num">{s.credit ? <span className="red">{money(s.credit)}</span> : '—'}</td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        {c.phone && <a className="btn sm ghost" href={whatsappLink(c.phone, `Hola ${c.name}`)} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={15} /></a>}
                        {can('customers.edit') && <button className="btn sm ghost" title="Editar" onClick={() => setEditing({ id: c.id, data: { ...EMPTY, ...c } })}><Pencil size={15} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Editar cliente' : 'Nuevo cliente'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && can('settings') && (
                <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy}
                  onClick={() => confirm('¿Eliminar este cliente? Sus facturas y órdenes se conservan.') &&
                    run(async () => { await deleteCustomer(editing.id!); setEditing(null); }, 'Cliente eliminado')}>
                  <Trash2 size={15} />Eliminar
                </button>
              )}
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn primary" disabled={busy} onClick={save}>Guardar</button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Nombre completo" required className="full"><input className="input" autoFocus value={editing.data.name} onChange={set('name')} /></Field>
            <Field label="Documento (CC / NIT)"><input className="input" value={editing.data.document} onChange={set('document')} /></Field>
            <Field label="Celular"><input className="input" value={editing.data.phone} onChange={set('phone')} /></Field>
            <Field label="Correo"><input className="input" type="email" value={editing.data.email} onChange={set('email')} /></Field>
            <Field label="Dirección"><input className="input" value={editing.data.address} onChange={set('address')} /></Field>
            <Field label="Notas" className="full"><textarea className="input" value={editing.data.notes} onChange={set('notes')} /></Field>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={detail.name} wide onClose={() => setDetail(null)}>
          <dl className="kv">
            <dt>Documento</dt><dd className="mono">{detail.document || '—'}</dd>
            <dt>Celular</dt><dd>{detail.phone || '—'}</dd>
            <dt>Correo</dt><dd>{detail.email || '—'}</dd>
            <dt>Dirección</dt><dd>{detail.address || '—'}</dd>
            {detail.notes && <><dt>Notas</dt><dd>{detail.notes}</dd></>}
          </dl>
          <h3 className="mt" style={{ fontSize: 14, marginBottom: 8 }}>Órdenes de reparación</h3>
          <div className="card">
            {orders.filter((o) => o.customerId === detail.id).length === 0 ? <Empty>Sin órdenes.</Empty> : (
              <table className="table"><tbody>
                {orders.filter((o) => o.customerId === detail.id).sort((a, b) => b.number - a.number).map((o) => (
                  <tr key={o.id}>
                    <td className="mono"><Link to={`/taller/${o.id}`} className="red">OT {pad(o.number)}</Link></td>
                    <td>{o.device.brand} {o.device.model}<small>{o.reportedIssue}</small></td>
                    <td>{dateOnly(o.createdAt)}</td>
                    <td><Badge tone={orderTone(o.status)}>{o.status}</Badge></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          <h3 className="mt" style={{ fontSize: 14, marginBottom: 8 }}>Compras</h3>
          <div className="card">
            {invoices.filter((i) => i.customerId === detail.id).length === 0 ? <Empty>Sin compras.</Empty> : (
              <table className="table"><tbody>
                {invoices.filter((i) => i.customerId === detail.id).sort((a, b) => b.number - a.number).map((i) => (
                  <tr key={i.id}>
                    <td className="mono">N.º {pad(i.number, 6)}</td>
                    <td>{dateOnly(i.createdAt)}</td>
                    <td>{i.items.length} ítems</td>
                    <td><Badge tone={i.status === 'anulada' ? 'red' : i.status === 'credito' ? 'warn' : 'ok'}>{i.status}</Badge></td>
                    <td className="num">{money(i.total)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
