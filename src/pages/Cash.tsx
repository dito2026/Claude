import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { CashCategory, CashMovement, CashSession, RepairOrder, Technician } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateTime, money } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, Stat, useAction } from '../components/ui';
import { addMovement, closeSession, expectedByMethod, openSession, type CashState } from '../services/cash';
import { technicianBalance } from '../services/staff';
import { useSettings } from '../services/settings';

const CAT: Record<CashCategory, string> = {
  venta: 'Venta', abono_cliente: 'Abono de cliente', gasto: 'Gasto', pago_proveedor: 'Pago a proveedor',
  pago_tecnico: 'Pago a técnico', retiro: 'Retiro / consignación', ingreso_otro: 'Otro ingreso', anulacion: 'Anulación',
};

type MovKind = 'gasto' | 'pago_tecnico' | 'pago_proveedor' | 'retiro' | 'ingreso_otro';

export function Cash() {
  const settings = useSettings();
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const sessionId = cash?.openSessionId ?? undefined;
  const { doc: session } = useDocument<CashSession>('cashSessions', sessionId);
  const allMovements = useCollection<CashMovement>('cashMovements').rows;
  const sessions = useCollection<CashSession>('cashSessions').rows;
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [opening, setOpening] = useState(0);
  const [mov, setMov] = useState<MovKind | null>(null);
  const [closing, setClosing] = useState(false);

  const methods = settings.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const movements = useMemo(
    () => allMovements.filter((m) => m.sessionId === sessionId).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [allMovements, sessionId],
  );
  const expected = session ? expectedByMethod(session, movements, methods) : {};
  const ins = movements.filter((m) => m.direction === 'ingreso').reduce((a, m) => a + m.amount, 0);
  const outs = movements.filter((m) => m.direction === 'egreso').reduce((a, m) => a + m.amount, 0);
  const closed = sessions.filter((s) => s.status === 'cerrada').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '')).slice(0, 20);

  return (
    <>
      <PageHead eyebrow="Finanzas" title="Caja"
        subtitle={session ? `Abierta el ${dateTime(session.openedAt)} por ${session.openedBy}` : 'La caja está cerrada.'}
        actions={session && (
          <>
            <button className="btn" onClick={() => setMov('ingreso_otro')}><ArrowDownLeft size={16} />Ingreso</button>
            <button className="btn" onClick={() => setMov('gasto')}><ArrowUpRight size={16} />Gasto</button>
            <button className="btn" onClick={() => setMov('pago_tecnico')}>Pago a técnico</button>
            <button className="btn" onClick={() => setMov('pago_proveedor')}>Pago a proveedor</button>
            <button className="btn" onClick={() => setMov('retiro')}>Retiro</button>
            <button className="btn primary" onClick={() => setClosing(true)}><Lock size={16} />Cerrar caja</button>
          </>
        )}
      />

      {!session ? (
        <div className="card card-pad" style={{ maxWidth: 480 }}>
          <h3 style={{ marginBottom: 6 }}>Abrir caja</h3>
          <p className="muted" style={{ marginTop: 0 }}>Escriba el efectivo con el que inicia el turno (base).</p>
          <Field label="Base de caja (efectivo)"><MoneyInput value={opening} onChange={setOpening} autoFocus /></Field>
          <button className="btn primary mt" disabled={busy} onClick={() => run(() => openSession(actor, opening), 'Caja abierta')}><Unlock size={16} />Abrir caja</button>
        </div>
      ) : (
        <>
          <div className="grid g4">
            <Stat accent label="Efectivo esperado" value={money(expected['Efectivo'])} sub={`Base ${money(session.openingCash)}`} />
            <Stat label="Entradas del turno" value={money(ins)} sub={`${movements.filter((m) => m.direction === 'ingreso').length} movimientos`} />
            <Stat label="Salidas del turno" value={money(outs)} sub={`${movements.filter((m) => m.direction === 'egreso').length} movimientos`} />
            <Stat label="Neto" value={money(ins - outs)} />
          </div>
          <div className="grid g-main mt">
            <div className="card">
              <div className="card-head"><h3>Movimientos del turno</h3></div>
              {movements.length === 0 ? <Empty>Sin movimientos todavía.</Empty> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Hora</th><th>Concepto</th><th>Categoría</th><th>Medio</th><th className="num">Valor</th></tr></thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td className="nowrap">{dateTime(m.createdAt)}</td>
                          <td>{m.description}{m.expenseCategory && <small>{m.expenseCategory}</small>}</td>
                          <td><Badge tone={m.direction === 'ingreso' ? 'ok' : 'red'}>{CAT[m.category]}</Badge></td>
                          <td>{m.method}</td>
                          <td className={`num ${m.direction === 'egreso' ? 'red' : ''}`}>{m.direction === 'egreso' ? '-' : ''}{money(m.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h3>Esperado por medio de pago</h3></div>
              {methods.map((m) => (
                <div key={m} className="list-row"><span className="grow">{m}</span><span className="mono">{money(expected[m] ?? 0)}</span></div>
              ))}
              <div className="list-row" style={{ fontWeight: 700 }}><span className="grow">Total</span><span className="mono">{money(Object.values(expected).reduce((a, b) => a + b, 0))}</span></div>
              <div className="card-pad faint" style={{ fontSize: 12 }}>El efectivo incluye la base y descuenta lo que salió en efectivo. Las ventas a «Crédito tienda» no entran en caja.</div>
            </div>
          </div>
        </>
      )}

      <div className="card mt">
        <div className="card-head"><h3>Cierres anteriores</h3></div>
        {closed.length === 0 ? <Empty>Aún no hay cierres.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Apertura</th><th>Cierre</th><th>Responsable</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th><th>Justificación</th></tr></thead>
              <tbody>
                {closed.map((s) => {
                  const e = Object.values(s.expected ?? {}).reduce((a, b) => a + b, 0);
                  const c = Object.values(s.counted ?? {}).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={s.id}>
                      <td className="nowrap">{dateTime(s.openedAt)}</td>
                      <td className="nowrap">{dateTime(s.closedAt)}</td>
                      <td>{s.closedBy}</td>
                      <td className="num">{money(e)}</td>
                      <td className="num">{money(c)}</td>
                      <td className={`num ${s.difference ? 'red' : ''}`}>{money(s.difference)}</td>
                      <td>{s.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mov && <MovementModal kind={mov} methods={methods} categories={settings.expenseCategories} onClose={() => setMov(null)} />}
      {closing && session && (
        <CloseModal session={session} expected={expected} methods={methods} onClose={() => setClosing(false)} />
      )}
    </>
  );
}

function MovementModal({ kind, methods, categories, onClose }: { kind: MovKind; methods: string[]; categories: string[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const techs = useCollection<Technician>('technicians').rows;
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('Efectivo');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'Otros');
  const [techId, setTechId] = useState('');
  const tech = techs.find((t) => t.id === techId);
  const owed = tech ? technicianBalance(tech, orders, movements).owed : 0;

  const title = { gasto: 'Registrar gasto', pago_tecnico: 'Pago a técnico', pago_proveedor: 'Pago a proveedor', retiro: 'Retiro de caja', ingreso_otro: 'Otro ingreso' }[kind];
  const submit = () => run(() => addMovement(actor, {
    direction: kind === 'ingreso_otro' ? 'ingreso' : 'egreso',
    category: kind,
    expenseCategory: kind === 'gasto' ? category : kind === 'pago_tecnico' ? 'Pago a técnicos' : undefined,
    method,
    amount,
    description: kind === 'pago_tecnico' ? `Pago a ${tech?.name ?? ''}${desc ? ` · ${desc}` : ''}` : desc,
    refType: kind === 'pago_tecnico' ? 'technician' : 'manual',
    refId: kind === 'pago_tecnico' ? techId : undefined,
  }), 'Movimiento registrado').then((ok) => ok && onClose());

  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || (kind === 'pago_tecnico' ? !techId : !desc.trim())} onClick={submit}>Registrar</button></>}>
      <div className="form-grid">
        {kind === 'pago_tecnico' && (
          <Field label="Técnico" required className="full">
            <select className="input" value={techId} onChange={(e) => setTechId(e.target.value)}>
              <option value="">Seleccione…</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tech && <small className="muted">Por pagarle: <b>{money(owed)}</b></small>}
          </Field>
        )}
        {kind === 'gasto' && (
          <Field label="Categoría">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        <Field label="Valor" required><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Medio">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={kind === 'pago_proveedor' ? 'Proveedor y concepto' : 'Descripción'} required={kind !== 'pago_tecnico'} className="full">
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CloseModal({ session, expected, methods, onClose }: { session: CashSession; expected: Record<string, number>; methods: string[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [counted, setCounted] = useState<Record<string, number>>(() => Object.fromEntries(methods.map((m) => [m, 0])));
  const [notes, setNotes] = useState('');
  const te = Object.values(expected).reduce((a, b) => a + b, 0);
  const tc = Object.values(counted).reduce((a, b) => a + b, 0);
  return (
    <Modal title="Cierre de caja · arqueo" onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => closeSession(actor, session.id, expected, counted, notes), 'Caja cerrada').then((ok) => ok && onClose())}>Cerrar caja</button></>}>
      <table className="table">
        <thead><tr><th>Medio</th><th className="num">Esperado</th><th className="num" style={{ width: 200 }}>Contado</th><th className="num">Diferencia</th></tr></thead>
        <tbody>
          {methods.map((m) => {
            const d = (counted[m] ?? 0) - (expected[m] ?? 0);
            return (
              <tr key={m}>
                <td className="strong">{m}</td>
                <td className="num">{money(expected[m] ?? 0)}</td>
                <td><MoneyInput value={counted[m] ?? 0} onChange={(v) => setCounted({ ...counted, [m]: v })} /></td>
                <td className={`num ${d ? 'red' : ''}`}>{money(d)}</td>
              </tr>
            );
          })}
          <tr><td className="strong">Total</td><td className="num strong">{money(te)}</td><td className="num strong">{money(tc)}</td><td className={`num strong ${tc - te ? 'red' : ''}`}>{money(tc - te)}</td></tr>
        </tbody>
      </table>
      <Field label={`Justificación ${tc !== te ? '(obligatoria: hay diferencia)' : ''}`} className="mt">
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
