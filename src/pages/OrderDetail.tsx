import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, PackagePlus, Printer, Receipt, Trash2 } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { OrderStatus, Product, RepairOrder, Technician } from '../lib/types';
import { ORDER_STATUSES } from '../lib/types';
import { dateTime, matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, CommitMoney, Empty, Field, Modal, MoneyInput, useAction } from '../components/ui';
import { orderTone, priorityTone } from '../components/status';
import { OrderReceiptModal } from '../components/Receipts';
import {
  addDeposit, addPart, depositsTotal, isOverdue, orderTotal, partsTotal, removePart, setStatus, updateOrder,
} from '../services/orders';
import { useSettings } from '../services/settings';

export function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { doc: o, loading } = useDocument<RepairOrder>('repairOrders', id);
  const { actor, can, profile } = useAuth();
  const settings = useSettings();
  const techs = useCollection<Technician>('technicians').rows;
  const { run, busy } = useAction();
  const [modal, setModal] = useState<'part' | 'deposit' | 'status' | 'receipt' | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (loading) return <Empty>Cargando…</Empty>;
  if (!o) return <Empty>La orden no existe.</Empty>;

  const closed = o.status === 'Entregado' || o.status === 'No reparado';
  const isMine = !!profile?.technicianId && o.technicianId === profile.technicianId;
  const canWork = !closed && (can('orders.create') || isMine);
  const canMoney = !closed && can('orders.billing');
  const total = orderTotal(o);
  const deposits = depositsTotal(o);

  const saveField = (patch: Parameters<typeof updateOrder>[2], msg = 'Orden actualizada') =>
    run(() => updateOrder(actor, o.id, patch), msg);

  return (
    <>
      <div className="row between" style={{ marginBottom: 18 }}>
        <div className="row">
          <button className="btn ghost" onClick={() => nav('/taller')}><ArrowLeft size={16} /></button>
          <div>
            <div className="eyebrow">Orden de trabajo</div>
            <h1 style={{ fontSize: 24 }}>
              <span className="mono">OT {pad(o.number)}</span> · {o.device.brand} {o.device.model}
            </h1>
          </div>
          <Badge tone={orderTone(o.status)}>{o.status}</Badge>
          {isOverdue(o) && <Badge tone="red">Atrasada</Badge>}
          <Badge tone={priorityTone(o.priority)}>Prioridad {o.priority}</Badge>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setModal('receipt')}><Printer size={16} />Recibo</button>
          <Link className="btn" to={`/tickets?nuevo=1&ot=${o.id}`}><LifeBuoy size={16} />Ticket</Link>
          {canWork && <button className="btn dark" onClick={() => setModal('status')}>Cambiar estado</button>}
          {canMoney && (
            <Link className="btn primary" to={`/facturacion?ot=${o.id}`}><Receipt size={16} />Facturar y entregar</Link>
          )}
          {o.invoiceNumber && <Badge tone="ok">Factura N.º {pad(o.invoiceNumber, 6)}</Badge>}
        </div>
      </div>

      <div className="grid g-main">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Equipo y falla</h3></div>
            <div className="card-pad">
              <dl className="kv">
                <dt>Equipo</dt><dd className="strong">{o.device.brand} {o.device.model} {o.device.color && `· ${o.device.color}`}</dd>
                <dt>IMEI / serial</dt><dd className="mono">{o.device.imei || '—'}</dd>
                <dt>Desbloqueo</dt><dd className="mono">{o.device.unlockCode || '—'}</dd>
                <dt>Accesorios</dt><dd>{o.device.accessories || '—'}</dd>
                <dt>Estado físico</dt><dd>{o.device.condition || '—'}</dd>
                <dt>Falla reportada</dt><dd>{o.reportedIssue}</dd>
              </dl>
              <Field label="Diagnóstico y notas técnicas" className="mt">
                <textarea
                  className="input"
                  disabled={!canWork}
                  value={diagnosis ?? o.diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Qué encontró el técnico, pruebas realizadas…"
                />
              </Field>
              {diagnosis !== null && diagnosis !== o.diagnosis && (
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn ghost sm" onClick={() => setDiagnosis(null)}>Descartar</button>
                  <button className="btn dark sm" disabled={busy} onClick={() => saveField({ diagnosis }).then(() => setDiagnosis(null))}>Guardar diagnóstico</button>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Repuestos utilizados <span className="faint">· descontados del inventario</span></h3>
              {canWork && <button className="btn sm" onClick={() => setModal('part')}><PackagePlus size={15} />Agregar repuesto</button>}
            </div>
            {o.parts.length === 0 ? <Empty>Sin repuestos todavía.</Empty> : (
              <table className="table">
                <thead><tr><th>Repuesto</th><th className="num">Cant.</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Subtotal</th><th /></tr></thead>
                <tbody>
                  {o.parts.map((p) => (
                    <tr key={p.lineId}>
                      <td className="strong">{p.name}</td>
                      <td className="num">{p.qty}</td>
                      <td className="num faint">{money(p.unitCost)}</td>
                      <td className="num">{money(p.unitPrice)}</td>
                      <td className="num">{money(p.qty * p.unitPrice)}</td>
                      <td className="right">
                        {canWork && (
                          <button className="btn sm ghost" title="Quitar y devolver al inventario" disabled={busy}
                            onClick={() => confirm(`¿Quitar ${p.name}? Se devolverá al inventario.`) && run(() => removePart(actor, o.id, p.lineId), 'Repuesto devuelto al inventario')}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Cobro</h3></div>
            <div className="card-pad grid g2">
              <div className="form-grid">
                <Field label="Presupuesto al cliente"><CommitMoney value={o.budget} disabled={!canMoney} onCommit={(v) => void saveField({ budget: v })} /></Field>
                <Field label="Mano de obra (cobro)"><CommitMoney value={o.laborPrice} disabled={!canMoney} onCommit={(v) => void saveField({ laborPrice: v })} /></Field>
                <Field label="Pago al técnico"><CommitMoney value={o.technicianPay} disabled={!canMoney} onCommit={(v) => void saveField({ technicianPay: v })} /></Field>
                <Field label="Garantía (días)"><input className="input num" type="number" min={0} disabled={!canMoney} defaultValue={o.warrantyDays} key={o.warrantyDays} onBlur={(e) => Number(e.target.value) !== o.warrantyDays && void saveField({ warrantyDays: Number(e.target.value) })} /></Field>
              </div>
              <div className="totals">
                <div><span className="muted">Mano de obra</span><span>{money(o.laborPrice)}</span></div>
                <div><span className="muted">Repuestos</span><span>{money(partsTotal(o))}</span></div>
                <div className="grand"><span>Total</span><span>{money(total)}</span></div>
                <div><span className="muted">Abonos</span><span>-{money(deposits)}</span></div>
                <div style={{ fontWeight: 600 }}><span>Saldo pendiente</span><span className="red">{money(Math.max(0, total - deposits))}</span></div>
                {canMoney && <button className="btn sm mt" onClick={() => setModal('deposit')}>Registrar abono</button>}
                {o.deposits.map((d, i) => (
                  <div key={i} className="faint" style={{ fontSize: 12 }}><span>{dateTime(d.at)} · {d.method}</span><span>{money(d.amount)}</span></div>
                ))}
                {o.warrantyUntil && <div className="mt"><Badge tone="ok">Garantía hasta {dateTime(o.warrantyUntil)}</Badge></div>}
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card card-pad">
            <div className="eyebrow">Cliente</div>
            <div className="strong" style={{ fontSize: 16 }}>{o.customer.name}</div>
            <div className="muted">{[o.customer.document, o.customer.phone].filter(Boolean).join(' · ')}</div>
            <div className="eyebrow mt">Técnico asignado</div>
            <select className="input" disabled={!can('orders.create') || closed} value={o.technicianId}
              onChange={(e) => {
                const t = techs.find((x) => x.id === e.target.value);
                void run(() => updateOrder(actor, o.id, { technicianId: t?.id ?? '', technicianName: t?.name ?? '', technicianUserId: t?.userId ?? '' }, `Asignada a ${t?.name ?? 'nadie'}`), 'Técnico asignado');
              }}>
              <option value="">Sin asignar</option>
              {techs.filter((t) => t.active || t.id === o.technicianId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <dl className="kv mt">
              <dt>Ingreso</dt><dd>{dateTime(o.createdAt)}</dd>
              <dt>Prometida</dt><dd className={isOverdue(o) ? 'red' : ''}>{dateTime(o.promisedAt)}</dd>
              {o.deliveredAt && <><dt>Cerrada</dt><dd>{dateTime(o.deliveredAt)}</dd></>}
            </dl>
          </div>

          <div className="card">
            <div className="card-head"><h3>Historial</h3></div>
            <div className="card-pad">
              {!closed && (
                <div className="row gap-sm" style={{ marginBottom: 16 }}>
                  <input className="input grow" placeholder="Agregar nota…" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn sm dark" disabled={!note.trim() || busy}
                    onClick={() => run(() => updateOrder(actor, o.id, {}, note.trim()), 'Nota agregada').then((ok) => ok && setNote(''))}>Agregar</button>
                </div>
              )}
              <ul className="timeline">
                {[...o.timeline].reverse().map((t, i) => (
                  <li key={i} className={t.status ? 'status' : ''}>
                    <div style={{ fontWeight: t.status ? 600 : 400 }}>{t.note}</div>
                    <small className="faint">{dateTime(t.at)} · {t.by}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {modal === 'part' && <AddPartModal order={o} onClose={() => setModal(null)} />}
      {modal === 'deposit' && <DepositModal order={o} methods={settings.paymentMethods} onClose={() => setModal(null)} />}
      {modal === 'status' && <StatusModal order={o} onClose={() => setModal(null)} />}
      {modal === 'receipt' && <OrderReceiptModal o={o} s={settings} onClose={() => setModal(null)} />}
    </>
  );
}

function AddPartModal({ order, onClose }: { order: RepairOrder; onClose: () => void }) {
  const { actor } = useAuth();
  const products = useCollection<Product>('products').rows;
  const { run, busy } = useAction();
  const [q, setQ] = useState(order.device.model);
  const [sel, setSel] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);

  const list = useMemo(
    () => products
      .filter((p) => p.active && p.type !== 'SERVICIO')
      .filter((p) => matches(q, p.name, p.sku, p.brand, p.model))
      .sort((a, b) => (a.type === 'REPUESTO' ? -1 : 1) - (b.type === 'REPUESTO' ? -1 : 1) || a.name.localeCompare(b.name))
      .slice(0, 30),
    [products, q],
  );

  return (
    <Modal
      title={`Agregar repuesto a OT ${pad(order.number)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!sel || busy}
            onClick={() => run(() => addPart(actor, order.id, sel!.id, qty, price), 'Repuesto agregado y descontado del inventario').then((ok) => ok && onClose())}>
            Agregar y descontar stock
          </button>
        </>
      }
    >
      {!sel ? (
        <div className="stack">
          <input className="input" autoFocus placeholder="Buscar repuesto por nombre, SKU o modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="card" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {list.length === 0 ? <Empty>Sin resultados. Borre el texto para ver todo.</Empty> : list.map((p) => (
              <div key={p.id} className="list-row" style={{ cursor: p.stock > 0 ? 'pointer' : 'not-allowed', opacity: p.stock > 0 ? 1 : 0.5 }}
                onClick={() => p.stock > 0 && (setSel(p), setPrice(p.price || p.cost))}>
                <div className="grow">{p.name}<small className="faint mono" style={{ display: 'block' }}>{p.sku} · {p.type}</small></div>
                <Badge tone={p.stock > p.minStock ? 'ok' : p.stock > 0 ? 'warn' : 'red'}>Stock {p.stock}</Badge>
                <span className="mono">{money(p.price || p.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="row card" style={{ padding: '10px 14px' }}>
            <div className="grow"><b>{sel.name}</b><div className="faint">Disponible: {sel.stock} · costo {money(sel.cost)}</div></div>
            <button className="btn sm ghost" onClick={() => setSel(null)}>Cambiar</button>
          </div>
          <div className="form-grid">
            <Field label="Cantidad"><input className="input num" type="number" min={1} max={sel.stock} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value))))} /></Field>
            <Field label="Precio al cliente (unitario)"><MoneyInput value={price} onChange={setPrice} /></Field>
          </div>
          {qty > sel.stock && <div className="alert error">No hay stock suficiente.</div>}
        </div>
      )}
    </Modal>
  );
}

function DepositModal({ order, methods, onClose }: { order: RepairOrder; methods: string[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('Efectivo');
  return (
    <Modal title="Registrar abono" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount} onClick={() => run(() => addDeposit(actor, order.id, amount, method), 'Abono registrado en caja').then((ok) => ok && onClose())}>Registrar</button></>}>
      <div className="form-grid">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Medio de pago">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.filter((m) => m !== 'Crédito tienda').map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function StatusModal({ order, onClose }: { order: RepairOrder; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [status, setSt] = useState<OrderStatus>(order.status);
  const [note, setNote] = useState('');
  return (
    <Modal title="Cambiar estado" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || status === order.status} onClick={() => run(() => setStatus(actor, order.id, status, note), 'Estado actualizado').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="stack">
        <div className="row gap-sm">
          {ORDER_STATUSES.filter((s) => s !== 'Entregado').map((s) => (
            <button key={s} type="button" className={`btn sm ${status === s ? 'dark' : ''}`} onClick={() => setSt(s)}>{s}</button>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>«Entregado» se asigna al facturar la orden.</div>
        <Field label="Nota (opcional)"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
