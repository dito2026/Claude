import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Reminder } from '../lib/types';
import { addReminder, deleteReminder, reminderState, setReminderDone, sortReminders } from './reminders';

const actor = { uid: 'u1', name: 'Jairo' };
beforeEach(() => (backend as LocalBackend).reset());

describe('recordatorios', () => {
  it('crea, marca como hecho, vuelve a pendiente y elimina', async () => {
    await expect(addReminder(actor, '  ')).rejects.toThrow(/Escriba/);
    const id = await addReminder(actor, 'Llamar a Laura', new Date(Date.now() + 3600_000).toISOString());
    let r = (await backend.get<Reminder>('reminders', id))!;
    expect(r).toMatchObject({ text: 'Llamar a Laura', done: false, createdByName: 'Jairo' });
    await setReminderDone(actor, id, true);
    r = (await backend.get<Reminder>('reminders', id))!;
    expect(r).toMatchObject({ done: true, doneBy: 'Jairo' });
    await setReminderDone(actor, id, false);
    expect((await backend.get<Reminder>('reminders', id))!.done).toBe(false);
    await deleteReminder(id);
    expect(await backend.get('reminders', id)).toBeNull();
  });

  it('estado y orden: vencidos primero, luego por fecha, sin fecha y hechos al final', () => {
    const now = new Date(2026, 10, 7, 12, 0);
    const at = (h: number, d = 7) => new Date(2026, 10, d, h).toISOString();
    expect(reminderState({ dueAt: at(9), done: false }, now)).toBe('vencido');
    expect(reminderState({ dueAt: at(17), done: false }, now)).toBe('hoy');
    expect(reminderState({ dueAt: at(9, 8), done: false }, now)).toBe('proximo');
    expect(reminderState({ done: false }, now)).toBe('sin_fecha');
    expect(reminderState({ dueAt: at(9), done: true }, now)).toBe('hecho');
    const list = sortReminders([
      { id: 'hecho', dueAt: at(8), done: true }, { id: 'sin', done: false, createdAt: 'x' },
      { id: 'tarde', dueAt: at(17), done: false }, { id: 'manana', dueAt: at(9), done: false },
    ]);
    expect(list.map((x) => x.id)).toEqual(['manana', 'tarde', 'sin', 'hecho']);
  });
});
