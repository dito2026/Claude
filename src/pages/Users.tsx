import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Role, Technician, UserProfile } from '../lib/types';
import { dateOnly } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, useAction } from '../components/ui';
import { createStaffUser, ROLE_LABEL, updateUser, type NewUser } from '../services/staff';

export function Users() {
  const { rows } = useCollection<UserProfile>('users');
  const techs = useCollection<Technician>('technicians').rows;
  const { user } = useAuth();
  const { run } = useAction();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHead eyebrow="Administración" title="Usuarios y roles"
        subtitle="Quién entra al sistema y qué puede hacer."
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Nuevo usuario</button>} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        {(['admin', 'cajero', 'tecnico'] as Role[]).map((r) => (
          <div key={r} className="card card-pad">
            <div className="strong">{ROLE_LABEL[r]}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {r === 'admin' && 'Acceso total: finanzas, anulaciones, inventario, usuarios y configuración.'}
              {r === 'cajero' && 'Clientes, órdenes, facturación, caja y entradas de inventario.'}
              {r === 'tecnico' && 'Sus órdenes asignadas: diagnóstico, estados y repuestos. Tickets.'}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        {rows.length === 0 ? <Empty>Sin usuarios.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Técnico vinculado</th><th>Estado</th><th>Creado</th></tr></thead>
              <tbody>
                {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
                  const self = u.id === user?.uid;
                  return (
                    <tr key={u.id}>
                      <td className="strong">{u.name}{self && <small>Usted</small>}</td>
                      <td className="mono">{u.email}</td>
                      <td>
                        <select className="input" style={{ height: 32 }} value={u.role} disabled={self}
                          onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as Role }), 'Rol actualizado')}>
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="input" style={{ height: 32 }} value={u.technicianId ?? ''}
                          onChange={(e) => run(() => updateUser(u.id, { technicianId: e.target.value }), 'Vínculo actualizado')}>
                          <option value="">—</option>
                          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn sm ghost" disabled={self} onClick={() => run(() => updateUser(u.id, { active: !u.active }), u.active ? 'Usuario desactivado' : 'Usuario activado')}>
                          <Badge tone={u.active ? 'ok' : 'red'}>{u.active ? 'Activo' : 'Inactivo'}</Badge>
                        </button>
                      </td>
                      <td>{dateOnly(u.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewUserModal techs={techs} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewUserModal({ techs, onClose }: { techs: Technician[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [d, setD] = useState<NewUser>({ name: '', email: '', password: '', role: 'cajero', technicianId: '' });
  return (
    <Modal title="Nuevo usuario" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => createStaffUser(actor, d), 'Usuario creado').then((ok) => ok && onClose())}>Crear usuario</button></>}>
      <div className="form-grid">
        <Field label="Nombre" required className="full"><input className="input" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Correo" required><input className="input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
        <Field label="Contraseña inicial" required><input className="input" type="text" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} placeholder="Mínimo 6 caracteres" /></Field>
        <Field label="Rol">
          <select className="input" value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="Técnico vinculado">
          <select className="input" value={d.technicianId} onChange={(e) => setD({ ...d, technicianId: e.target.value })}>
            <option value="">Ninguno</option>
            {techs.filter((t) => !t.userId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
