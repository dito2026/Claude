import { backend } from '../data';
import type { CashMovement, RepairOrder, Role, Technician, UserProfile } from '../lib/types';
import { BusinessError, created, sum, touched, type Actor } from './common';
import { DEFAULT_SETTINGS } from './settings';
import { normalize } from '../lib/format';

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
  sellerId?: string;
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
    sellerId: u.sellerId || undefined,
    ...created(actor),
  };
  await backend.set('users', newUid, profile);
  if (u.technicianId) await backend.update('technicians', u.technicianId, { userId: newUid });
  if (u.sellerId) await backend.update('sellers', u.sellerId, { userId: newUid });
  return newUid;
}

export const updateUser = (id: string, patch: Partial<Pick<UserProfile, 'name' | 'role' | 'active' | 'technicianId' | 'sellerId'>>) =>
  backend.update('users', id, { ...patch, ...touched() });

/** Vincula (o desvincula) un usuario con un vendedor. */
export async function linkSeller(userId: string, sellerId: string, previous?: string) {
  await backend.update('users', userId, { sellerId: sellerId || null, ...touched() });
  if (previous && previous !== sellerId) await backend.update('sellers', previous, { userId: null });
  if (sellerId) await backend.update('sellers', sellerId, { userId });
}

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

/**
 * Estado de cuenta de un técnico: trabajos entregados (lo que ganó), trabajos sin entregar (aún no suman),
 * pagos de «Pago a técnico» y movimientos de caja que lo mencionan pero no cuentan como pago.
 */
export function technicianStatement(t: Technician, orders: RepairOrder[], movements: CashMovement[]) {
  const mine = orders.filter((o) => o.technicianId === t.id);
  const delivered = mine.filter((o) => o.status === 'Entregado')
    .sort((a, b) => (b.deliveredAt ?? b.updatedAt ?? '').localeCompare(a.deliveredAt ?? a.updatedAt ?? ''));
  const pending = mine.filter((o) => o.status !== 'Entregado' && o.status !== 'No reparado')
    .sort((a, b) => b.number - a.number);
  const payments = movements.filter((m) => m.category === 'pago_tecnico' && m.refId === t.id)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const name = normalize(t.name).trim();
  const firstName = name.split(/\s+/)[0] ?? '';
  const key = firstName.length >= 4 ? firstName : name;
  const suspects = key.length >= 3 ? movements.filter((m) => m.direction === 'egreso' && m.category !== 'pago_tecnico'
    && ['gasto', 'retiro', 'pago_vendedor', 'pago_proveedor'].includes(m.category) && (!m.refType || m.refType === 'manual')
    && normalize(m.description).includes(key))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) : [];
  return {
    ...technicianBalance(t, orders, movements),
    delivered,
    noPay: delivered.filter((o) => !(o.technicianPay > 0)).length,
    pending,
    pendingPay: sum(pending.map((o) => o.technicianPay || 0)),
    payments,
    suspects,
  };
}

/**
 * Pasa a «Pago a técnico» un egreso de caja que se registró como gasto (u otro) escribiendo el nombre del técnico.
 * No mueve plata: el dinero ya salió; solo deja de contar como gasto y pasa a descontar lo que se le debe.
 */
export async function linkTechnicianPayment(actor: Actor, movementId: string, technicianId: string) {
  return backend.transaction(async (tx) => {
    const m = await tx.get<CashMovement>('cashMovements', movementId);
    if (!m) throw new BusinessError('Movimiento no encontrado.');
    const t = await tx.get<Technician>('technicians', technicianId);
    if (!t) throw new BusinessError('Técnico no encontrado.');
    if (m.direction !== 'egreso' || m.category === 'pago_tecnico' || !['gasto', 'retiro', 'pago_vendedor', 'pago_proveedor'].includes(m.category)
      || (m.refType && m.refType !== 'manual')) {
      throw new BusinessError('Ese movimiento no se puede pasar a pago de técnico.');
    }
    tx.update('cashMovements', m.id, {
      category: 'pago_tecnico', expenseCategory: 'Pago a técnicos', refType: 'technician', refId: technicianId,
      previousCategory: m.category, linkedAt: new Date().toISOString(), linkedBy: actor.name, ...touched(),
    });
    return { name: t.name };
  });
}
