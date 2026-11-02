import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Customer, Priority, RepairOrder, Ticket, TicketStatus, TicketType, UserProfile } from '../lib/types';
import { dateTime, matches, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, SearchBox, Seg, useAction } from '../components/ui';
import { CustomerPicker } from '../components/CustomerPicker';
import { PRIORITIES, priorityTone, ticketTone } from '../components/status';
import { createTicket, TICKET_STATUSES, TICKET_TYPES, updateTicket } from '../services/tickets';

type Filter = 'activos' | 'resueltos' | 'todos';

export function Tickets() {
  const { rows, loading } = useCollection<Ticket>('tickets');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('activos');
  const [open, setOpen] = useState<string | null>(null);
  const creating = params.get('nuevo') === '1';

  const list = rows
    .filter((t) => filter === 'todos' || (filter === 'activos' ? !['resuelto', 'cerrado'].includes(t.status) : ['resuelto', 'cerrado'].includes(t.status)))
    .filter((t) => matches(q, t.number, t.subject, t.customerName, t.imei, t.repairOrderNumber))
    .sort((a, b) => b.number - a.number);
  const current = rows.find((t) => t.id === open);

  return (
    <>
      <PageHead eyebrow="Servicio técnico" title="Tickets de soporte"
        subtitle="Garantías, reclamos, consultas y seguimiento posventa."
        actions={<>
          <SearchBox value={q} onChange={setQ} placeholder="N.º, asunto, cliente o IMEI" />
          <button className="btn primary" onClick={() => setParams({ nuevo: '1' })}><Plus size={16} />Nuevo ticket</button>
        </>} />
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'activos', label: 'Activos' }, { value: 'resueltos', label: 'Resueltos' }, { value: 'todos', label: 'Todos' }]} />
      </div>
      <div className="card">
        {loading ? <Empty>Cargando…</Empty> : list.length === 0 ? <Empty>No hay tickets en esta vista.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Asunto</th><th>Tipo</th><th>Cliente</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Actualizado</th></tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className="click" onClick={() => setOpen(t.id)}>
                    <td className="mono strong">T-{pad(t.number, 4)}</td>
                    <td><span className="strong">{t.subject}</span>{t.repairOrderNumber && <small className="mono">OT {pad(t.repairOrderNumber)}</small>}</td>
                    <td>{TICKET_TYPES[t.type]}</td>
                    <td>{t.customerName}</td>
                    <td><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></td>
                    <td><Badge tone={ticketTone(t.status)}>{TICKET_STATUSES[t.status]}</Badge></td>
                    <td>{t.assignedTo || <span className="faint">—</span>}</td>
                    <td className="nowrap">{dateTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewTicketModal orderId={params.get('ot') ?? undefined} onClose={() => setParams({})} />}
      {current && <TicketModal t={current} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewTicketModal({ orderId, onClose }: { orderId?: string; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const customers = useCollection<Customer>('customers').rows;
  const users = useCollection<UserProfile>('users').rows;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [type, setType] = useState<TicketType>(orderId ? 'garantia' : 'consulta');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [assignedTo, setAssigned] = useState('');
  const [otId, setOtId] = useState(orderId ?? '');
  const ot = orders.find((o) => o.id === otId);

  useEffect(() => {
    if (ot && !customer) setCustomer(customers.find((c) => c.id === ot.customerId) ?? null);
  }, [ot, customers, customer]);

  const submit = () => run(() => createTicket(actor, {
    type, subject, description, priority, assignedTo,
    customerId: customer?.id ?? '', customerName: customer?.name ?? ot?.customer.name ?? '',
    repairOrderId: ot?.id, repairOrderNumber: ot?.number, imei: ot?.device.imei || undefined,
  }), 'Ticket creado').then((ok) => ok && onClose());

  return (
    <Modal title="Nuevo ticket" wide onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={submit}>Crear ticket</button></>}>
      <div className="form-grid">
        <Field label="Tipo">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as TicketType)}>
            {Object.entries(TICKET_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Prioridad">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Orden relacionada (opcional)">
          <select className="input" value={otId} onChange={(e) => setOtId(e.target.value)}>
            <option value="">Ninguna</option>
            {[...orders].sort((a, b) => b.number - a.number).slice(0, 200).map((o) => (
              <option key={o.id} value={o.id}>OT {pad(o.number)} · {o.device.brand} {o.device.model} · {o.customer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Responsable">
          <select className="input" value={assignedTo} onChange={(e) => setAssigned(e.target.value)}>
            <option value="">Sin asignar</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Cliente" className="full"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <Field label="Asunto" required className="full"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej.: pantalla instalada presenta líneas" /></Field>
        <Field label="Descripción" className="full"><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function TicketModal({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<TicketStatus>(t.status);
  const save = () => run(() => updateTicket(actor, t.id, { status }, comment), 'Ticket actualizado').then((ok) => ok && setComment(''));
  return (
    <Modal wide title={<><span className="mono">T-{pad(t.number, 4)}</span> · {t.subject}</>} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cerrar</button>
        <button className="btn primary" disabled={busy || (status === t.status && !comment.trim())} onClick={save}>Guardar</button></>}>
      <div className="grid g-main">
        <div className="stack">
          <div className="row gap-sm">
            <Badge tone={ticketTone(t.status)}>{TICKET_STATUSES[t.status]}</Badge>
            <Badge tone={priorityTone(t.priority)}>Prioridad {t.priority}</Badge>
            <Badge>{TICKET_TYPES[t.type]}</Badge>
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{t.description || <span className="faint">Sin descripción.</span>}</p>
          <h3 style={{ fontSize: 14 }}>Seguimiento</h3>
          {t.comments.length === 0 ? <div className="faint">Sin comentarios.</div> : (
            <ul className="timeline">
              {[...t.comments].reverse().map((c, i) => (
                <li key={i}><div>{c.text}</div><small className="faint">{dateTime(c.at)} · {c.by}</small></li>
              ))}
            </ul>
          )}
          <Field label="Agregar comentario"><textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
        <div className="stack">
          <Field label="Estado">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
              {Object.entries(TICKET_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <dl className="kv" style={{ gridTemplateColumns: '100px 1fr' }}>
            <dt>Cliente</dt><dd>{t.customerName || '—'}</dd>
            <dt>Responsable</dt><dd>{t.assignedTo || '—'}</dd>
            {t.repairOrderId && <><dt>Orden</dt><dd><Link className="red mono" to={`/taller/${t.repairOrderId}`}>OT {pad(t.repairOrderNumber)}</Link></dd></>}
            {t.imei && <><dt>IMEI</dt><dd className="mono">{t.imei}</dd></>}
            <dt>Creado</dt><dd>{dateTime(t.createdAt)}</dd>
          </dl>
        </div>
      </div>
    </Modal>
  );
}
