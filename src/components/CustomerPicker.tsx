import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { Customer } from '../lib/types';
import { matches } from '../lib/format';
import { useCollection } from '../data/hooks';
import { useAuth } from '../auth/AuthContext';
import { saveCustomer } from '../services/customers';
import { Field, useAction } from './ui';

/** Buscador de clientes con creación rápida. */
export function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const { rows } = useCollection<Customer>('customers');
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', document: '' });

  const found = useMemo(
    () => rows.filter((c) => matches(q, c.name, c.phone, c.document)).slice(0, 8),
    [rows, q],
  );

  if (value) {
    return (
      <div className="row card" style={{ padding: '8px 12px' }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{value.name}</div>
          <small className="muted">{[value.document, value.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small>
        </div>
        <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>Cambiar</button>
      </div>
    );
  }

  if (creating) {
    const create = () =>
      run(async () => {
        const data = { ...draft, email: '', address: '', notes: '' };
        const id = await saveCustomer(actor, data, undefined, rows);
        onChange({ ...data, id: String(id) });
        setCreating(false);
      }, 'Cliente creado');
    return (
      <div className="card card-pad stack">
        <div className="form-grid three">
          <Field label="Nombre" required><input className="input" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Celular"><input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
          <Field label="Documento"><input className="input" value={draft.document} onChange={(e) => setDraft({ ...draft, document: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
          <button type="button" className="btn dark" disabled={busy} onClick={create}>Guardar cliente</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="row gap-sm">
        <input
          className="input grow"
          placeholder="Buscar cliente por nombre, celular o documento…"
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found.length > 0 && q.trim()) { e.preventDefault(); e.stopPropagation(); onChange(found[0]); }
          }}
        />
        <button type="button" className="btn" onClick={() => { setCreating(true); setDraft({ name: q, phone: '', document: '' }); }}>
          <UserPlus size={16} />Nuevo
        </button>
      </div>
      {open && found.length > 0 && (
        <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 42, zIndex: 10, maxHeight: 280, overflowY: 'auto' }}>
          {found.map((c) => (
            <div key={c.id} className="list-row" style={{ cursor: 'pointer', padding: '9px 14px' }} onMouseDown={() => onChange(c)}>
              <div className="grow">
                <div>{c.name}</div>
                <small className="faint">{[c.document, c.phone].filter(Boolean).join(' · ')}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
