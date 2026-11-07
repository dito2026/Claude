import { useMemo, useState } from 'react';
import { BellRing, CalendarClock, Check, Plus, Trash2 } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Reminder } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { addReminder, deleteReminder, reminderState, setReminderDone, sortReminders } from '../services/reminders';
import { useAction } from './ui';

const pad2 = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Atajos de fecha: en 1 hora, hoy en la tarde, mañana temprano. */
const QUICK: { label: string; at: () => Date }[] = [
  { label: 'En 1 hora', at: () => new Date(Date.now() + 3600_000) },
  { label: 'Hoy 5 p. m.', at: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; } },
  { label: 'Mañana 9 a. m.', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
];

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Hoy ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Mañana ${time}`;
  return `${d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** Tarjeta de recordatorios del Panel: crear, marcar como hecho y eliminar. */
export function RemindersCard() {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const rows = useCollection<Reminder>('reminders').rows;
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const sorted = useMemo(() => sortReminders(rows), [rows]);
  const pending = sorted.filter((r) => !r.done);
  const done = sorted.filter((r) => r.done);
  const overdue = pending.filter((r) => reminderState(r) === 'vencido').length;

  const add = () => run(async () => {
    await addReminder(actor, text, due ? new Date(due).toISOString() : undefined);
    setText('');
    setDue('');
  }, 'Recordatorio agregado');

  const remove = (r: Reminder) => {
    if (!confirm(`¿Eliminar el recordatorio «${r.text}»?`)) return;
    run(() => deleteReminder(r.id), 'Recordatorio eliminado');
  };
  const clearDone = () => {
    if (!confirm(`¿Eliminar los ${done.length} recordatorios hechos?`)) return;
    run(async () => { for (const r of done) await deleteReminder(r.id); }, 'Recordatorios hechos eliminados');
  };

  const item = (r: Reminder) => {
    const st = reminderState(r);
    return (
      <div key={r.id} className={`reminder ${st}`}>
        <button type="button" className={`rem-check ${r.done ? 'on' : ''}`} title={r.done ? 'Marcar como pendiente' : 'Marcar como hecho'}
          aria-label={r.done ? 'Marcar como pendiente' : 'Marcar como hecho'}
          onClick={() => run(() => setReminderDone(actor, r.id, !r.done))}>{r.done && <Check size={13} />}</button>
        <div className="grow min0">
          <div className="rem-text">{r.text}</div>
          <small className="rem-meta">
            {r.dueAt && <span className={st === 'vencido' ? 'red' : ''}><CalendarClock size={12} />{st === 'vencido' ? 'Vencido · ' : ''}{when(r.dueAt)}</span>}
            <span>{r.done ? `Hecho por ${r.doneBy ?? '—'}` : `Por ${r.createdByName}`}</span>
          </small>
        </div>
        <button type="button" className="btn sm ghost icon-only" title="Eliminar" aria-label="Eliminar recordatorio" onClick={() => remove(r)}><Trash2 size={15} /></button>
      </div>
    );
  };

  return (
    <div className="card mt reminders">
      <div className="card-head">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BellRing size={16} className="red" />Recordatorios
          {pending.length > 0 && <span className="faint" style={{ fontWeight: 400 }}>· {pending.length} pendiente{pending.length === 1 ? '' : 's'}</span>}
          {overdue > 0 && <span className="badge red">{overdue} vencido{overdue === 1 ? '' : 's'}</span>}
        </h3>
      </div>
      <form className="rem-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add(); }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Llamar a Laura para entregar el A15 · Pagarle a Nano" />
        <input className="input rem-date" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha y hora (opcional)" title="Fecha y hora (opcional)" />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}><Plus size={16} />Agregar</button>
      </form>
      <div className="rem-quick">
        {QUICK.map((q) => (
          <button key={q.label} type="button" className={`cat-chip ${due === localInput(q.at()) ? 'active' : ''}`} onClick={() => setDue(localInput(q.at()))}>{q.label}</button>
        ))}
        {due && <button type="button" className="cat-chip" onClick={() => setDue('')}>Sin fecha</button>}
      </div>
      {pending.length === 0 && <div className="faint" style={{ padding: '6px 20px 16px', fontSize: 13 }}>No hay recordatorios pendientes.</div>}
      {pending.map(item)}
      {done.length > 0 && (
        <div className="rem-done-bar">
          <button type="button" className="btn sm ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Ocultar' : 'Ver'} hechos ({done.length})</button>
          <button type="button" className="btn sm ghost red" onClick={clearDone}><Trash2 size={14} />Eliminar hechos</button>
        </div>
      )}
      {showDone && done.map(item)}
    </div>
  );
}
