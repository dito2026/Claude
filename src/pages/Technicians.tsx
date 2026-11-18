import { useState } from 'react';
import { History, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCollection } from '../data/hooks';
import type { CashMovement, RepairOrder, Technician } from '../lib/types';
import { dateOnly, dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, Stat, useAction, useToast } from '../components/ui';
import { linkTechnicianPayment, saveTechnician, technicianBalance, technicianStatement, type TechnicianInput } from '../services/staff';

const EMPTY: TechnicianInput = { name: '', phone: '', specialty: '', active: true, commissionPct: 0 };

export function Technicians() {
  const { rows } = useCollection<Technician>('technicians');
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const [edit, setEdit] = useState<{ id?: string; data: TechnicianInput } | null>(null);
  const [statement, setStatement] = useState<Technician | null>(null);
  const totalOwed = rows.reduce((a, t) => a + technicianBalance(t, orders, movements).owed, 0);

  return (
    <>
      <PageHead eyebrow="Administración" title="Técnicos"
        subtitle={`Total por pagar a técnicos: ${money(totalOwed)}`}
        actions={<button className="btn primary" onClick={() => setEdit({ data: { ...EMPTY } })}><Plus size={16} />Nuevo técnico</button>} />
      <div className="card">
        {rows.length === 0 ? <Empty>No hay técnicos registrados.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Técnico</th><th>Especialidad</th><th>Estado</th><th>Usuario</th><th className="num">OT abiertas</th><th className="num">Trabajos entregados</th><th className="num">Ganado</th><th className="num">Pagado</th><th className="num">Por pagarle</th><th /></tr></thead>
              <tbody>
                {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
                  const b = technicianBalance(t, orders, movements);
                  return (
                    <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                      <td><span className="strong">{t.name}</span><small>{t.phone}</small></td>
                      <td>{t.specialty || '—'}</td>
                      <td><Badge tone={t.active ? 'ok' : ''}>{t.active ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td>{t.userId ? <Badge tone="info">Con acceso</Badge> : <span className="faint">Externo</span>}</td>
                      <td className="num">{b.open}</td>
                      <td className="num">{b.jobs}</td>
                      <td className="num">{money(b.earned)}</td>
                      <td className="num">{money(b.paid)}</td>
                      <td className={`num strong ${b.owed > 0 ? 'red' : ''}`}>{money(b.owed)}</td>
                      <td className="right nowrap">
                        <button className="btn sm ghost" title="Trabajos, pagos y lo que se le debe" onClick={() => setStatement(t)}><History size={15} />Estado de cuenta</button>
                        <button className="btn sm ghost" title="Editar" onClick={() => setEdit({ id: t.id, data: { ...EMPTY, ...t } })}><Pencil size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="faint" style={{ fontSize: 12 }}>Cada OT entregada suma su «pago al técnico». Los pagos se registran en Caja → «Pago a técnico».</p>
      {edit && <TechModal edit={edit} onClose={() => setEdit(null)} />}
      {statement && <TechStatementModal t={statement} orders={orders} movements={movements} onClose={() => setStatement(null)} />}
    </>
  );
}

function TechModal({ edit, onClose }: { edit: { id?: string; data: TechnicianInput }; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [d, setD] = useState(edit.data);
  return (
    <Modal title={edit.id ? 'Editar técnico' : 'Nuevo técnico'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => saveTechnician(actor, d, edit.id), 'Técnico guardado').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Nombre" required className="full"><input className="input" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Celular"><input className="input" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label="Especialidad"><input className="input" value={d.specialty} onChange={(e) => setD({ ...d, specialty: e.target.value })} placeholder="Visores, software, microelectrónica…" /></Field>
        <label className="checkbox full"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />Activo</label>
      </div>
    </Modal>
  );
}

const CAT_LABEL: Record<string, string> = { gasto: 'Gasto', retiro: 'Retiro', pago_vendedor: 'Pago a vendedor', pago_proveedor: 'Pago a proveedor' };
const deviceOf = (o: RepairOrder) => [o.device.brand, o.device.model].filter(Boolean).join(' ') || 'Equipo';

/** Estado de cuenta del técnico: lo que ganó (OT entregadas), lo que se le pagó y lo que se le debe. */
function TechStatementModal({ t, orders, movements, onClose }: { t: Technician; orders: RepairOrder[]; movements: CashMovement[]; onClose: () => void }) {
  const { actor, can } = useAuth();
  const { run, busy } = useAction();
  const toast = useToast();
  const st = technicianStatement(t, orders, movements);
  const admin = can('settings');
  const link = (m: CashMovement) => run(async () => {
    await linkTechnicianPayment(actor, m.id, t.id);
    toast(`Ahora cuenta como pago a ${t.name}: ${money(m.amount)}`);
  });
  return (
    <Modal wide title={`Estado de cuenta · ${t.name}`} onClose={onClose}>
      <div className="stack">
        <div className="grid g3">
          <Stat accent label="Por pagarle" value={<span className={st.owed > 0 ? 'red' : ''}>{money(st.owed)}</span>} sub="ganado − pagado" />
          <Stat label="Ganado" value={money(st.earned)} sub={`${st.jobs} trabajo(s) entregado(s)`} />
          <Stat label="Pagado" value={money(st.paid)} sub={`${st.payments.length} pago(s)`} />
        </div>

        {st.suspects.length > 0 && (
          <div className="card">
            <div className="card-pad stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>Pagos que mencionan a {t.name} pero no cuentan</h3>
              <div className="faint" style={{ fontSize: 13 }}>
                Se registraron en Caja con otro botón (gasto, retiro…) escribiendo su nombre. Si fueron pagos a {t.name}, tóquelos en «Contar como pago»:
                no se mueve plata (ya salió de la caja), solo bajan lo que se le debe y dejan de contar como gasto.
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Registrado como</th><th>Descripción</th><th>Medio</th><th className="num">Valor</th><th /></tr></thead>
                <tbody>{st.suspects.map((m) => (
                  <tr key={m.id}>
                    <td>{dateTime(m.createdAt)}</td><td>{CAT_LABEL[m.category] ?? m.category}</td><td>{m.description}</td><td>{m.method}</td>
                    <td className="num strong">{money(m.amount)}</td>
                    <td>{admin ? <button className="btn sm primary" disabled={busy} onClick={() => link(m)}>Contar como pago</button> : <small className="faint">Solo el administrador</small>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h3 style={{ margin: '4px 0 6px' }}>Trabajos entregados · suman {money(st.earned)}</h3>
          {st.noPay > 0 && <div className="alert warn" style={{ marginBottom: 8 }}><div>{st.noPay} trabajo(s) entregado(s) sin «pago al técnico»: no le suman nada. Ábralos y escriba cuánto se le paga.</div></div>}
          {st.delivered.length === 0 ? <Empty>Aún no tiene trabajos entregados.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>OT</th><th>Entregada</th><th>Cliente</th><th>Equipo</th><th className="num">Pago al técnico</th></tr></thead>
                <tbody>{st.delivered.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="mono red" to={`/taller/${o.id}`}>OT {pad(o.number)}</Link></td>
                    <td>{dateOnly(o.deliveredAt ?? o.updatedAt)}</td>
                    <td>{o.customer.name}</td>
                    <td>{deviceOf(o)}</td>
                    <td className="num strong">{o.technicianPay > 0 ? money(o.technicianPay) : <span className="red">Sin pago</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {st.pending.length > 0 && (
          <div>
            <h3 style={{ margin: '4px 0 6px' }}>En proceso (aún no suman) · {money(st.pendingPay)}</h3>
            <div className="faint" style={{ fontSize: 13, marginBottom: 6 }}>Se le suman cuando la orden quede «Entregado» (al facturarla o entregarla).</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>OT</th><th>Estado</th><th>Cliente</th><th>Equipo</th><th className="num">Pago al técnico</th></tr></thead>
                <tbody>{st.pending.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="mono red" to={`/taller/${o.id}`}>OT {pad(o.number)}</Link></td>
                    <td><Badge>{o.status}</Badge></td><td>{o.customer.name}</td><td>{deviceOf(o)}</td>
                    <td className="num">{money(o.technicianPay || 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h3 style={{ margin: '4px 0 6px' }}>Pagos · {money(st.paid)}</h3>
          {st.payments.length === 0 ? <Empty>No hay pagos registrados con «Pago a técnico».</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Descripción</th><th>Medio</th><th className="num">Valor</th></tr></thead>
                <tbody>{st.payments.map((m) => (
                  <tr key={m.id}>
                    <td>{dateTime(m.createdAt)}</td>
                    <td>{m.description}{m.previousCategory && <small className="faint">registrado como {CAT_LABEL[m.previousCategory] ?? m.previousCategory}, pasado a pago por {m.linkedBy}</small>}</td>
                    <td>{m.method}</td>
                    <td className="num strong">{m.direction === 'egreso' ? money(m.amount) : `−${money(m.amount)}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Para pagarle: Caja → «Pago a técnico». Si un trabajo tiene mal el pago, ábralo y corrija «Pago al técnico».</div>
      </div>
    </Modal>
  );
}
