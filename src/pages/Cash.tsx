import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, History, Lock, Pencil, Unlock } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { CashCategory, CashMovement, CashSession, Invoice, RepairOrder, Seller, Technician } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateTime, money } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, Stat, useAction } from '../components/ui';
import { addMovement, closeSession, editExpense, expectedByMethod, openSession, type CashState } from '../services/cash';
import { technicianBalance } from '../services/staff';
import { sellerBalance } from '../services/sellers';
import { useSettings } from '../services/settings';
import { invoiceCost } from '../services/billing';

const CAT: Record<CashCategory, string> = {
  venta: 'Venta', abono_cliente: 'Abono de cliente', gasto: 'Gasto', pago_proveedor: 'Pago a proveedor',
  pago_tecnico: 'Pago a técnico', pago_vendedor: 'Pago a vendedor', retiro: 'Retiro / consignación', ingreso_otro: 'Otro ingreso', anulacion: 'Anulación',
};

/**
 * Ganancia que corresponde a un movimiento de caja: la de su factura (venta − costo, sin IVA),
 * repartida según lo que se pagó con ese movimiento (una venta pagada con dos medios se reparte).
 * Las anulaciones restan. Abonos, gastos y pagos no son ganancia (null).
 */
export function movementProfit(m: CashMovement, inv: Invoice | undefined): number | null {
  if (!inv || m.refType !== 'invoice') return null;
  if (m.category !== 'venta' && m.category !== 'anulacion') return null;
  const profit = inv.total - (inv.tax || 0) - invoiceCost(inv);
  const paid = (inv.payments ?? []).reduce((a, x) => a + x.amount, 0);
  if (paid <= 0) return null;
  const share = Math.round((profit * m.amount) / paid);
  return m.direction === 'egreso' ? -share : share;
}

/** Productos de una factura en una línea: «2× Cable USB C · Vidrio templado A15». */
export const itemsText = (inv: Pick<Invoice, 'items'>) =>
  (inv.items ?? []).map((it) => `${it.qty > 1 ? `${it.qty}× ` : ''}${it.description}${it.imei ? ` (IMEI ${it.imei})` : ''}`).join(' · ');

type MovKind = 'gasto' | 'pago_tecnico' | 'pago_vendedor' | 'pago_proveedor' | 'retiro' | 'ingreso_otro';

export function Cash() {
  const settings = useSettings();
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const sessionId = cash?.openSessionId ?? undefined;
  const { doc: session } = useDocument<CashSession>('cashSessions', sessionId);
  const allMovements = useCollection<CashMovement>('cashMovements').rows;
  const sessions = useCollection<CashSession>('cashSessions').rows;
  const invoices = useCollection<Invoice>('invoices').rows;
  const invById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);
  const { actor, can } = useAuth();
  const finance = can('dashboard.finance');
  const isAdmin = can('settings');
  const { run, busy } = useAction();
  const [opening, setOpening] = useState(0);
  const [editing, setEditing] = useState<CashMovement | null>(null);
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
  const turnProfit = movements.reduce((a, m) => a + (movementProfit(m, m.refId ? invById.get(m.refId) : undefined) ?? 0), 0);
  const pastExpenses = useMemo(() => {
    const since = Date.now() - 60 * 86400000;
    return allMovements
      .filter((m) => isExpense(m) && m.sessionId !== sessionId && new Date(m.createdAt ?? 0).getTime() >= since)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 100);
  }, [allMovements, sessionId]);
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
            <button className="btn" onClick={() => setMov('pago_vendedor')}>Pago a vendedor</button>
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
          <div className="grid cash-kpis">
            <Stat accent label="Efectivo esperado" value={money(expected['Efectivo'])} sub={`Base ${money(session.openingCash)}`} />
            <Stat label="Entradas del turno" value={money(ins)} sub={`${movements.filter((m) => m.direction === 'ingreso').length} movimientos`} />
            <Stat label="Salidas del turno" value={money(outs)} sub={`${movements.filter((m) => m.direction === 'egreso').length} movimientos`} />
            <Stat label="Neto" value={money(ins - outs)} />
            {finance && <Stat label="Ganancia del turno" value={<span className={turnProfit < 0 ? 'red' : ''}>{money(turnProfit)}</span>} sub="Ventas − costo de lo vendido" />}
          </div>
          <div className="grid g-main mt">
            <div className="card">
              <div className="card-head"><h3>Movimientos del turno</h3></div>
              {movements.length === 0 ? <Empty>Sin movimientos todavía.</Empty> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Hora</th><th>Concepto</th><th>Tipo · medio</th><th className="num">Valor</th>{finance && <th className="num">Ganancia</th>}<th /></tr></thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td className="nowrap" title={dateTime(m.createdAt)}>{m.createdAt ? new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                          <td style={{ minWidth: 180 }}>{m.description}{m.expenseCategory && <small>{m.expenseCategory}</small>}{m.edits?.length ? <EditedNote m={m} /> : null}{m.refType === 'invoice' && m.refId && invById.get(m.refId) && <small className="mov-items">{itemsText(invById.get(m.refId)!)}</small>}</td>
                          <td><Badge tone={m.direction === 'ingreso' ? 'ok' : 'red'}>{CAT[m.category]}</Badge><small>{m.method}</small></td>
                          <td className={`num ${m.direction === 'egreso' ? 'red' : ''}`}>{m.direction === 'egreso' ? '-' : ''}{money(m.amount)}</td>
                          {finance && (() => {
                            const g = movementProfit(m, m.refId ? invById.get(m.refId) : undefined);
                            return <td className={`num ${g != null && g < 0 ? 'red' : 'strong'}`}>{g == null ? <span className="faint">—</span> : money(g)}</td>;
                          })()}
                          <td className="nowrap">{isExpense(m) && <button className="btn sm ghost" title="Corregir gasto" onClick={() => setEditing(m)}><Pencil size={14} />Corregir</button>}</td>
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

      {isAdmin && pastExpenses.length > 0 && (
        <div className="card mt">
          <div className="card-head"><h3>Gastos de turnos anteriores</h3><span className="faint" style={{ fontSize: 12 }}>Últimos 60 días · solo el administrador puede corregirlos</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th className="num">Valor</th><th /></tr></thead>
              <tbody>
                {pastExpenses.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{dateTime(m.createdAt)}</td>
                    <td style={{ minWidth: 200 }}>{m.description}{m.expenseCategory && <small>{m.expenseCategory}</small>}{m.edits?.length ? <EditedNote m={m} /> : null}</td>
                    <td>{m.method}</td>
                    <td className="num red">-{money(m.amount)}</td>
                    <td className="nowrap"><button className="btn sm ghost" onClick={() => setEditing(m)}><Pencil size={14} />Corregir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

      {editing && <EditExpenseModal m={editing} methods={methods} categories={settings.expenseCategories} isAdmin={isAdmin} onClose={() => setEditing(null)} />}
      {mov && <MovementModal kind={mov} methods={methods} categories={settings.expenseCategories} onClose={() => setMov(null)} />}
      {closing && session && (
        <CloseModal session={session} expected={expected} methods={methods} onClose={() => setClosing(false)} />
      )}
    </>
  );
}

const isExpense = (m: CashMovement) => m.direction === 'egreso' && m.category === 'gasto';

/** «Corregido»: muestra el valor anterior; al pasar el mouse, todo el historial. */
function EditedNote({ m }: { m: CashMovement }) {
  const last = m.edits![m.edits!.length - 1];
  const hist = m.edits!.map((e) => `${dateTime(e.at)} · ${e.by}: antes ${money(e.amount)} (${e.method}) «${e.description}» — ${e.reason}`).join('\n');
  return (
    <small className="faint" title={hist} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <History size={12} />Corregido por {last.by} · antes {money(last.amount)}
    </small>
  );
}

function EditExpenseModal({ m, methods, categories, isAdmin, onClose }: { m: CashMovement; methods: string[]; categories: string[]; isAdmin: boolean; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [amount, setAmount] = useState(m.amount);
  const [method, setMethod] = useState(m.method);
  const [description, setDescription] = useState(m.description);
  const [category, setCategory] = useState(m.expenseCategory || categories[0] || 'Otros');
  const [reason, setReason] = useState('');
  const cats = categories.includes(category) ? categories : [category, ...categories];
  const meths = methods.includes(method) ? methods : [method, ...methods];
  const submit = () => run(() => editExpense(actor, m.id, { amount, method, description, expenseCategory: category, reason }, isAdmin), 'Gasto corregido').then((ok) => ok && onClose());
  return (
    <Modal title="Corregir gasto" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || !description.trim() || !reason.trim()} onClick={submit}>Guardar corrección</button></>}>
      <div className="alert info" style={{ marginBottom: 14 }}>
        Registrado el {dateTime(m.createdAt)}: {money(m.amount)} en {m.method}. El valor anterior queda guardado en el historial.
      </div>
      <div className="form-grid">
        <Field label="Categoría">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Valor" required><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Medio">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {meths.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Descripción" required><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Motivo de la corrección" required className="full">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: digité mal el valor" />
        </Field>
      </div>
    </Modal>
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
  const sellers = useCollection<Seller>('sellers').rows;
  const invoices = useCollection<Invoice>('invoices').rows;
  const seller = sellers.find((s) => s.id === techId);
  const isPerson = kind === 'pago_tecnico' || kind === 'pago_vendedor';
  const owed = kind === 'pago_vendedor'
    ? (seller ? sellerBalance(seller, invoices, movements).owed : 0)
    : (tech ? technicianBalance(tech, orders, movements).owed : 0);
  const person = kind === 'pago_vendedor' ? seller : tech;

  const title = { gasto: 'Registrar gasto', pago_tecnico: 'Pago a técnico', pago_vendedor: 'Pago de comisión a vendedor', pago_proveedor: 'Pago a proveedor', retiro: 'Retiro de caja', ingreso_otro: 'Otro ingreso' }[kind];
  const submit = () => run(() => addMovement(actor, {
    direction: kind === 'ingreso_otro' ? 'ingreso' : 'egreso',
    category: kind,
    expenseCategory: kind === 'gasto' ? category : kind === 'pago_tecnico' ? 'Pago a técnicos' : kind === 'pago_vendedor' ? 'Comisiones de vendedores' : undefined,
    method,
    amount,
    description: isPerson ? `${kind === 'pago_vendedor' ? 'Comisión a' : 'Pago a'} ${person?.name ?? ''}${desc ? ` · ${desc}` : ''}` : desc,
    refType: kind === 'pago_tecnico' ? 'technician' : kind === 'pago_vendedor' ? 'seller' : 'manual',
    refId: isPerson ? techId : undefined,
  }), 'Movimiento registrado').then((ok) => ok && onClose());

  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || (isPerson ? !techId : !desc.trim())} onClick={submit}>Registrar</button></>}>
      <div className="form-grid">
        {isPerson && (
          <Field label={kind === 'pago_vendedor' ? 'Vendedor' : 'Técnico'} required className="full">
            <select className="input" value={techId} onChange={(e) => { setTechId(e.target.value); setAmount(0); }}>
              <option value="">Seleccione…</option>
              {(kind === 'pago_vendedor' ? sellers : techs).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {person && (
              <small className="muted">Por pagarle: <b>{money(owed)}</b>{owed > 0 && <> · <button type="button" className="btn sm ghost" onClick={() => setAmount(owed)}>Pagar todo</button></>}</small>
            )}
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
        <Field label={kind === 'pago_proveedor' ? 'Proveedor y concepto' : 'Descripción'} required={!isPerson} className="full">
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CloseModal({ session, expected, methods, onClose }: { session: CashSession; expected: Record<string, number>; methods: string[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  // Solo el efectivo se cuenta a mano. Transferencias, Nequi, tarjeta… vienen con lo esperado;
  // se cambian solo si en la cuenta no aparece lo que dice la app.
  const [counted, setCounted] = useState<Record<string, number>>(() => Object.fromEntries(methods.map((m) => [m, m === 'Efectivo' ? 0 : expected[m] ?? 0])));
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const te = Object.values(expected).reduce((a, b) => a + b, 0);
  const tc = methods.reduce((a, m) => a + (counted[m] ?? 0), 0);
  const cashDiff = (counted['Efectivo'] ?? 0) - (expected['Efectivo'] ?? 0);
  return (
    <Modal title="Cierre de caja · arqueo" onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => closeSession(actor, session.id, expected, counted, notes), 'Caja cerrada').then((ok) => ok && onClose())}>Cerrar caja</button></>}>
      <div className="alert info" style={{ marginBottom: 12 }}><div>
        <b>Cuente solo el efectivo</b> que hay en el cajón (incluida la base) y escríbalo. Transferencia, Nequi y los demás medios ya vienen llenos con lo que registró la app;
        toque «Cambiar» solo si en la cuenta o en la app del banco no aparece ese valor.
      </div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Medio</th><th className="num">Esperado</th><th className="num" style={{ width: 210 }}>Contado / confirmado</th><th className="num">Diferencia</th></tr></thead>
          <tbody>
            {methods.map((m) => {
              const d = (counted[m] ?? 0) - (expected[m] ?? 0);
              const cash = m === 'Efectivo';
              const neg = (expected[m] ?? 0) < 0;
              return (
                <tr key={m}>
                  <td className="strong">{m}{!cash && neg && <small className="faint">Salió más de lo que entró en este turno</small>}</td>
                  <td className="num">{money(expected[m] ?? 0)}</td>
                  <td>
                    {cash || editing[m]
                      ? <MoneyInput value={counted[m] ?? 0} onChange={(v) => setCounted({ ...counted, [m]: v })} autoFocus={cash} />
                      : <div className="row gap-sm" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <span className="mono">{money(counted[m] ?? 0)}</span>
                          {!neg && <button type="button" className="btn sm ghost" onClick={() => setEditing({ ...editing, [m]: true })}>Cambiar</button>}
                        </div>}
                  </td>
                  <td className={`num ${d ? 'red strong' : ''}`}>{d > 0 ? '+' : ''}{money(d)}</td>
                </tr>
              );
            })}
            <tr><td className="strong">Total</td><td className="num strong">{money(te)}</td><td className="num strong">{money(tc)}</td><td className={`num strong ${tc - te ? 'red' : ''}`}>{tc - te > 0 ? '+' : ''}{money(tc - te)}</td></tr>
          </tbody>
        </table>
      </div>
      {cashDiff !== 0 && (counted['Efectivo'] ?? 0) > 0 && (
        <div className={`alert ${cashDiff < 0 ? 'error' : 'warn'} mt`}><div>
          {cashDiff < 0
            ? <>En efectivo <b>faltan {money(-cashDiff)}</b>. Antes de cerrar revise: ¿un gasto, pago o retiro que no se registró en Caja? ¿una venta cobrada por Nequi o transferencia que quedó como efectivo? ¿un cambio mal dado? Si encuentra el error, cancele, regístrelo o corríjalo, y vuelva a cerrar.</>
            : <>En efectivo <b>sobran {money(cashDiff)}</b>. Revise si una venta o abono no se registró, o si un pago quedó como efectivo y fue por otro medio.</>}
        </div></div>
      )}
      <Field label={`Justificación ${tc !== te ? '(obligatoria: hay diferencia)' : ''}`} className="mt">
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tc !== te ? 'Ej.: faltante de $20.500 por cambio mal dado' : ''} />
      </Field>
    </Modal>
  );
}
