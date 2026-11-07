// Recordatorios del negocio: una nota con fecha y hora opcional que se marca como hecha o se elimina.
import { backend } from '../data';
import type { Reminder } from '../lib/types';
import { BusinessError, created, touched, type Actor } from './common';

export async function addReminder(actor: Actor, text: string, dueAt?: string) {
  const t = text.trim();
  if (!t) throw new BusinessError('Escriba el recordatorio.');
  const r: Omit<Reminder, 'id'> = { text: t, done: false, createdByName: actor.name, ...(dueAt ? { dueAt } : {}), ...created(actor) };
  return backend.create('reminders', r as unknown as Record<string, unknown>);
}

export const setReminderDone = (actor: Actor, id: string, done: boolean) =>
  backend.update('reminders', id, done ? { done, doneAt: new Date().toISOString(), doneBy: actor.name, ...touched() } : { done, doneAt: null, doneBy: null, ...touched() });

export const deleteReminder = (id: string) => backend.remove('reminders', id);

/** vencido · hoy · próximo · sin fecha */
export function reminderState(r: Pick<Reminder, 'dueAt' | 'done'>, now = new Date()): 'vencido' | 'hoy' | 'proximo' | 'sin_fecha' | 'hecho' {
  if (r.done) return 'hecho';
  if (!r.dueAt) return 'sin_fecha';
  const due = new Date(r.dueAt);
  if (due.getTime() <= now.getTime()) return 'vencido';
  const sameDay = due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  return sameDay ? 'hoy' : 'proximo';
}

/** Pendientes primero: vencidos, luego por fecha; los sin fecha al final. */
export function sortReminders<T extends Pick<Reminder, 'dueAt' | 'done' | 'createdAt'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
}
