import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, RepairOrder, Technician } from '../lib/types';
import { money } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, useAction } from '../components/ui';
import { saveTechnician, technicianBalance, type TechnicianInput } from '../services/staff';

const EMPTY: TechnicianInput = { name: '', phone: '', specialty: '', active: true, commissionPct: 0 };

export function Technicians() {
  const { rows } = useCollection<Technician>('technicians');
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const [edit, setEdit] = useState<{ id?: string; data: TechnicianInput } | null>(null);
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
                      <td className="right"><button className="btn sm ghost" onClick={() => setEdit({ id: t.id, data: { ...EMPTY, ...t } })}><Pencil size={15} /></button></td>
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
