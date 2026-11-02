import { backend } from '../data';
import type { CashMovement, RepairOrder, Role, Technician, UserProfile } from '../lib/types';
import { BusinessError, created, sum, touched, type Actor } from './common';
import { DEFAULT_SETTINGS } from './settings';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  cajero: 'Cajero / Asesor',
  tecnico: 'Técnico',
};

export type TechnicianInput = Omit<Technician, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export async function saveTechnician(actor: Actor, t: TechnicianInput, id?: string) {
  if (!t.name.trim()) throw new BusinessError('El nombre es obligatorio.');
  if (id) return backend.update('technicians', id, { ...t, ...touched() });
  return backend.create('technicians', { ...t, ...created(actor) });
}

/** Lo que se le debe a cada técnico: mano de obra de OT entregadas − pagos registrados. */
export function technicianBalance(t: Technician, orders: RepairOrder[], movements: CashMovement[]) {
  const done = orders.filter((o) => o.technicianId === t.id && o.status === 'Entregado');
  const earned = sum(done.map((o) => o.technicianPay || 0));
  const paid = sum(
    movements
      .filter((m) => m.category === 'pago_tecnico' && m.refId === t.id)
      .map((m) => (m.direction === 'egreso' ? m.amount : -m.amount)),
  );
  const open = orders.filter((o) => o.technicianId === t.id && o.status !== 'Entregado' && o.status !== 'No reparado');
  return { jobs: done.length, earned, paid, owed: earned - paid, open: open.length };
}

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: Role;
  technicianId?: string;
}

export async function createStaffUser(actor: Actor, u: NewUser) {
  if (!u.name.trim() || !u.email.trim()) throw new BusinessError('Nombre y correo son obligatorios.');
  if (u.password.length < 6) throw new BusinessError('La contraseña debe tener al menos 6 caracteres.');
  const newUid = await backend.auth.createAccount({ email: u.email, password: u.password });
  const profile: Omit<UserProfile, 'id'> = {
    name: u.name.trim(),
    email: u.email.trim().toLowerCase(),
    role: u.role,
    active: true,
    technicianId: u.technicianId || undefined,
    ...created(actor),
  };
  await backend.set('users', newUid, profile as unknown as Record<string, unknown>);
  if (u.technicianId) await backend.update('technicians', u.technicianId, { userId: newUid });
  return newUid;
}

export const updateUser = (id: string, patch: Partial<Pick<UserProfile, 'name' | 'role' | 'active' | 'technicianId'>>) =>
  backend.update('users', id, { ...patch, ...touched() });

/** Primer administrador en una base vacía (regla meta/bootstrap en firestore.rules). */
export async function bootstrapAdmin(name: string, email: string, password: string) {
  const user = await backend.auth.signUp(email, password);
  try {
    await backend.transaction(async (tx) => {
      const b = await tx.get('meta', 'bootstrap');
      if (b) throw new BusinessError('El sistema ya tiene administrador. Pídale que le cree una cuenta.');
      const actor = { uid: user.uid, name };
      tx.set('users', user.uid, {
        name: name.trim(),
        email: user.email.toLowerCase(),
        role: 'admin',
        active: true,
        ...created(actor),
      });
      tx.set('meta', 'bootstrap', { uid: user.uid, at: new Date().toISOString() });
    });
    // Ya con perfil admin, se guarda la configuración base del negocio.
    const existing = await backend.get('settings', 'business');
    if (!existing) await backend.set('settings', 'business', { ...DEFAULT_SETTINGS });
  } catch (e) {
    await backend.auth.signOut();
    throw e;
  }
}
