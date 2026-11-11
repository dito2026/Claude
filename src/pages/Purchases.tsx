import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HandCoins, PackagePlus, PenLine, Pencil, Plus, Sparkles, Trash2, Truck } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { PhoneCondition, Product, Purchase, PurchaseItem, Supplier } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateOnly, dateTime, fromLocalInput, matches, money, pad, toLocalInput, addDays, whatsappLink } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, Stat, useAction } from '../components/ui';
import {
  changePurchaseSupplier, createPurchase, editSupplierPayment, isOverduePurchase, voidPurchase, paySupplier, purchaseBalance, saveSupplier, supplierSummary, type SupplierInput,
} from '../services/purchases';
import { useSettings } from '../services/settings';
import type { CashState } from '../services/cash';
import { EMPTY_PRODUCT, ProductModal } from './Inventory';
import { ImeiTextarea, parseImeiLines } from '../components/PhoneUnits';
import { AiInvoiceModal, RestockTab, type PurchasePrefill } from '../components/PurchaseAutomation';
import { useAiEnabled } from '../services/ai';

const EMPTY_SUPPLIER: SupplierInput = { name: '', nit: '', phone: '', termDays: 30, notes: '', active: true };

const statusTone = (p: Purchase) =>
  p.status === 'anulada' ? '' : p.status === 'pagada' ? 'ok' : isOverduePurchase(p) ? 'red' : p.status === 'parcial' ? 'warn' : 'info';
const statusLabel = (p: Purchase) =>
  p.status === 'anulada' ? 'Anulada' : p.status === 'pagada' ? 'Pagada' : isOverduePurchase(p) ? 'Vencida' : p.status === 'parcial' ? 'Abono parcial' : 'Por pagar';

export function Purchases() {
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const [tab, setTab] = useState<'compras' | 'proveedores' | 'reposicion'>('compras');
  const [buying, setBuying] = useState<PurchasePrefill | false>(false);
  const [readingAi, setReadingAi] = useState(false);
  const aiOn = useAiEnabled();

  const owed = purchases.reduce((a, p) => a + purchaseBalance(p), 0);
  const overdue = purchases.filter(isOverduePurchase);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const month = purchases.filter((p) => p.kind === 'compra' && new Date(p.createdAt ?? 0) >= monthStart);

  return (
    <>
      <PageHead
        eyebrow="Finanzas"
        title="Compras y proveedores"
        subtitle="Repuestos y accesorios comprados de contado o a crédito, con su saldo por pagar."
        actions={<>
          {aiOn && <button className="btn" onClick={() => setReadingAi(true)}><Sparkles size={16} />Leer factura con IA</button>}
          <button className="btn primary" onClick={() => setBuying({})}><Plus size={16} />Nueva compra</button>
        </>}
      />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat accent label="Deuda con proveedores" value={money(owed)} sub={`${suppliers.filter((s) => supplierSummary(s, purchases).owed > 0).length} proveedores con saldo`} />
        <Stat label="Compras vencidas" value={<span className={overdue.length ? 'red' : ''}>{overdue.length}</span>} sub={money(overdue.reduce((a, p) => a + purchaseBalance(p), 0))} />
        <Stat label="Comprado este mes" value={money(month.reduce((a, p) => a + p.total, 0))} sub={`${month.length} compras`} />
        <Stat label="Proveedores" value={suppliers.filter((s) => s.active).length} />
      </div>
      <div className="tabs">
        <button className={tab === 'compras' ? 'active' : ''} onClick={() => setTab('compras')}>Compras</button>
        <button className={tab === 'proveedores' ? 'active' : ''} onClick={() => setTab('proveedores')}>Proveedores y saldos</button>
        <button className={tab === 'reposicion' ? 'active' : ''} onClick={() => setTab('reposicion')}>Reposición sugerida</button>
      </div>
      {tab === 'compras' && <PurchaseList purchases={purchases} />}
      {tab === 'proveedores' && <SupplierList suppliers={suppliers} purchases={purchases} />}
      {tab === 'reposicion' && <RestockTab onBuy={(p) => setBuying(p)} />}
      {buying && <NewPurchaseModal suppliers={suppliers} prefill={buying} onClose={() => setBuying(false)} />}
      {readingAi && <AiInvoiceModal suppliers={suppliers} onClose={() => setReadingAi(false)} onReady={(p) => { setReadingAi(false); setBuying(p); }} />}
    </>
  );
}

// ---------------- Lista de compras ----------------
function PurchaseList({ purchases }: { purchases: Purchase[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'pendientes' | 'todas'>('todas');
  const [params, setParams] = useSearchParams();
  // Abrir una compra directo (p. ej. desde Inventario → Celulares: «Compra C-0047»)
  const linked = params.get('compra');
  const [view, setView] = useState<Purchase | null>(null);
  const shown = view ?? (linked ? purchases.find((x) => x.id === linked) ?? null : null);
  const close = () => { setView(null); if (linked) setParams({}); };
  const list = purchases
    // al buscar se busca en todas, también las ya pagadas
    .filter((p) => filter === 'todas' || q.trim() !== '' || (p.status !== 'pagada' && p.status !== 'anulada'))
    .filter((p) => matches(q, p.number, p.supplierName, p.invoiceRef, ...p.items.map((i) => i.name)))
    .sort((a, b) => b.number - a.number);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'todas', label: 'Todas' }, { value: 'pendientes', label: 'Por pagar' }]} />
        <SearchBox value={q} onChange={setQ} placeholder="N.º, proveedor, factura o producto" />
      </div>
      <div className="card">
        {list.length === 0 ? <Empty icon={<Truck size={36} />}>{filter === 'pendientes' ? 'No hay compras pendientes de pago.' : 'Aún no hay compras.'}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th>Detalle</th><th>Forma</th><th>Vence</th><th>Estado</th><th className="num">Total</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setView(p)}>
                    <td className="mono strong">C-{pad(p.number, 4)}</td>
                    <td className="nowrap">{dateOnly(p.createdAt)}</td>
                    <td className="strong">{p.supplierName}</td>
                    <td>{p.kind === 'saldo_inicial' ? <span className="muted">Saldo anterior</span> : `${p.items.length} producto${p.items.length === 1 ? '' : 's'}`}{p.invoiceRef && <small>Fact. {p.invoiceRef}</small>}</td>
                    <td><Badge tone={p.paymentType === 'credito' ? 'warn' : ''}>{p.paymentType === 'credito' ? 'Crédito' : 'Contado'}</Badge></td>
                    <td className={`nowrap ${isOverduePurchase(p) ? 'red' : ''}`}>{p.paymentType === 'credito' ? dateOnly(p.dueDate) : '—'}</td>
                    <td><Badge tone={statusTone(p)}>{statusLabel(p)}</Badge></td>
                    <td className="num">{money(p.total)}</td>
                    <td className={`num strong ${purchaseBalance(p) ? 'red' : ''}`}>{money(purchaseBalance(p))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {shown && <PurchaseModal p={purchases.find((x) => x.id === shown.id) ?? shown} onClose={close} />}
    </>
  );
}

function PurchaseModal({ p, onClose }: { p: Purchase; onClose: () => void }) {
  const { actor, can } = useAuth();
  const { run, busy } = useAction();
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const [mode, setMode] = useState<'' | 'proveedor' | 'anular'>('');
  const [newSupplier, setNewSupplier] = useState('');
  const [reason, setReason] = useState('');
  const voided = p.status === 'anulada';
  const [editingPay, setEditingPay] = useState<number | null>(null);
  return (
    <Modal title={<><span className="mono">C-{pad(p.number, 4)}</span> · {p.supplierName}</>} wide onClose={onClose}
      footer={voided ? undefined : (
        <>
          {can('settings') && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setMode(mode === 'anular' ? '' : 'anular')}>Anular compra</button>}
          <button className="btn" onClick={() => setMode(mode === 'proveedor' ? '' : 'proveedor')}>Cambiar proveedor</button>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </>
      )}>
      {voided && <div className="alert warn" style={{ marginBottom: 14 }}>Compra anulada el {dateTime(p.voidedAt)} por {p.voidedBy}: {p.voidReason}</div>}
      {mode === 'proveedor' && (
        <div className="card card-pad stack" style={{ marginBottom: 14 }}>
          <b>¿Cuál es el proveedor correcto?</b>
          <div className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
            <select className="input" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} autoFocus>
              <option value="">Seleccione…</option>
              {suppliers.filter((s) => s.active && s.id !== p.supplierId).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn primary" disabled={busy || !newSupplier}
              onClick={() => run(() => changePurchaseSupplier(actor, p.id, newSupplier), 'Proveedor corregido').then((ok) => ok && setMode(''))}>Guardar</button>
          </div>
          <small className="faint">La deuda, los abonos y los celulares de esta compra pasan al proveedor correcto. No cambia el inventario ni la caja.</small>
        </div>
      )}
      {mode === 'anular' && (
        <div className="card card-pad stack" style={{ marginBottom: 14, borderColor: 'var(--red-line)' }}>
          <b className="red">Anular la compra completa</b>
          <div className="faint" style={{ fontSize: 13 }}>
            Se saca del inventario lo que entró con esta compra, se quita la deuda con {p.supplierName}
            {(p.paid || 0) > 0 ? ` y los ${money(p.paid)} que se le pagaron vuelven a la caja abierta` : ''}. La compra no se borra: queda como «Anulada».
            Si solo se equivocó de proveedor, use mejor «Cambiar proveedor».
          </div>
          <input className="input" placeholder="Motivo (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row gap-sm">
            <button className="btn primary" disabled={busy || !reason.trim()}
              onClick={() => run(() => voidPurchase(actor, p.id, reason), 'Compra anulada').then((ok) => ok && setMode(''))}>Confirmar anulación</button>
            <button className="btn ghost" onClick={() => setMode('')}>Cancelar</button>
          </div>
        </div>
      )}
      <div className="row gap-sm" style={{ marginBottom: 14 }}>
        <Badge tone={statusTone(p)}>{statusLabel(p)}</Badge>
        <Badge tone={p.paymentType === 'credito' ? 'warn' : ''}>{p.paymentType === 'credito' ? 'Crédito' : 'Contado'}</Badge>
        <span className="muted">{dateTime(p.createdAt)}</span>
        {p.invoiceRef && <span className="muted">· Factura {p.invoiceRef}</span>}
        {p.dueDate && <span className="muted">· Vence {dateOnly(p.dueDate)}</span>}
      </div>
      {p.items.length > 0 && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Costo unit.</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {p.items.map((i, k) => (
                <tr key={k}><td><span className="strong">{i.name}</span>{!i.productId && <small>Artículo libre · sin inventario</small>}</td><td className="num">{i.qty}</td><td className="num">{money(i.unitCost)}</td><td className="num">{money(i.qty * i.unitCost)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.note && <p className="muted">{p.note}</p>}
      <div className="grid g2 mt">
        <div className="totals">
          <div className="grand"><span>Total</span><span>{money(p.total)}</span></div>
          <div><span className="muted">Pagado</span><span>{money(p.paid)}</span></div>
          <div style={{ fontWeight: 600 }}><span>Saldo</span><span className={purchaseBalance(p) ? 'red' : ''}>{money(purchaseBalance(p))}</span></div>
        </div>
        <div>
          <div className="eyebrow">Pagos</div>
          {(p.payments ?? []).length === 0 ? <div className="faint">Sin pagos todavía.</div> : p.payments.map((x, i) => (
            <div key={i} className="row between" style={{ fontSize: 13, flexWrap: 'nowrap' }}>
              <span>{dateTime(x.at)} · {x.method} · {x.by}
                {x.editedAt && <small className="faint" style={{ display: 'block' }} title={x.editReason}>Corregido por {x.editedBy} · antes {money(x.previous?.amount)} {x.previous?.method}</small>}
              </span>
              <span className="row gap-sm" style={{ flexWrap: 'nowrap' }}><b>{money(x.amount)}</b>
                {!voided && <button type="button" className="btn sm ghost" style={{ height: 24, padding: '0 6px' }} title="Corregir o eliminar este pago" onClick={() => setEditingPay(i)}><Pencil size={13} /></button>}
              </span>
            </div>
          ))}
        </div>
      </div>
      {editingPay !== null && p.payments[editingPay] && <EditSupplierPaymentModal p={p} index={editingPay} onClose={() => setEditingPay(null)} />}
    </Modal>
  );
}

function EditSupplierPaymentModal({ p, index, onClose }: { p: Purchase; index: number; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const settings = useSettings();
  const pay = p.payments[index];
  const [amount, setAmount] = useState(pay.amount);
  const [method, setMethod] = useState(pay.method);
  const [reason, setReason] = useState('');
  const methods = settings.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const diff = amount - pay.amount;
  const save = (value: number) => run(() => editSupplierPayment(actor, p.id, index, { amount: value, method }, reason),
    value === 0 ? 'Pago eliminado · el dinero volvió a la caja' : 'Pago corregido · caja ajustada').then((ok) => ok && onClose());
  return (
    <Modal title={`Corregir pago · compra C-${pad(p.number, 4)}`} onClose={onClose}
      footer={<>
        <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy || !reason.trim()} onClick={() => { if (confirm(`¿Eliminar el pago de ${money(pay.amount)} a ${p.supplierName}? Ese dinero vuelve a la caja.`)) void save(0); }}><Trash2 size={15} />Eliminar pago</button>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || !method || !reason.trim() || (amount === pay.amount && method === pay.method)} onClick={() => void save(amount)}>Guardar corrección</button>
      </>}>
      <div className="stack">
        <div className="alert info"><div>Pago del {dateTime(pay.at)} a <b>{p.supplierName}</b>: <b>{money(pay.amount)}</b> en {pay.method}. Total de la compra {money(p.total)}. La caja abierta se ajusta sola.</div></div>
        <Field label="Valor correcto"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <div className="field">
          <span>Medio de pago <em>*</em></span>
          <div className="pay-methods">
            {methods.map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m}</button>)}
          </div>
        </div>
        {(diff !== 0 || method !== pay.method) && (
          <div className="faint" style={{ fontSize: 13 }}>
            {method !== pay.method
              ? <>En caja: vuelven {money(pay.amount)} a {pay.method} y salen {money(amount)} de {method}.</>
              : diff > 0 ? <>En caja: salen {money(diff)} más de {method}.</> : <>En caja: vuelven {money(-diff)} a {method}.</>}
            {' '}Saldo de la compra: {money(Math.max(0, p.total - ((p.paid || 0) - pay.amount + amount)))}.
          </div>
        )}
        <Field label="Motivo" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: digité mal el valor · fue por transferencia" /></Field>
      </div>
    </Modal>
  );
}

// ---------------- Proveedores ----------------
function SupplierList({ suppliers, purchases }: { suppliers: Supplier[]; purchases: Purchase[] }) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ id?: string; data: SupplierInput } | null>(null);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const list = suppliers
    .filter((s) => matches(q, s.name, s.nit, s.phone))
    .map((s) => ({ s, sum: supplierSummary(s, purchases) }))
    .sort((a, b) => b.sum.owed - a.sum.owed || a.s.name.localeCompare(b.s.name));
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Proveedor, NIT o celular" />
        <button className="btn" onClick={() => setEdit({ data: { ...EMPTY_SUPPLIER, name: q } })}><Plus size={16} />Nuevo proveedor</button>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>No hay proveedores registrados.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Proveedor</th><th>Contacto</th><th className="num">Plazo</th><th className="num">Compras a crédito</th><th className="num">De contado</th><th className="num">Abonado</th><th className="num">Saldo por pagar</th><th /></tr></thead>
              <tbody>
                {list.map(({ s, sum }) => (
                  <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                    <td><span className="strong">{s.name}</span>{s.nit && <small className="mono">NIT {s.nit}</small>}</td>
                    <td>{s.phone ? <a className="red" href={whatsappLink(s.phone, `Hola ${s.name}`)} target="_blank" rel="noreferrer">{s.phone}</a> : '—'}</td>
                    <td className="num">{s.termDays} días</td>
                    <td className="num">{money(sum.credit)}</td>
                    <td className="num">{money(sum.cash)}</td>
                    <td className="num">{money(sum.paidOnCredit)}</td>
                    <td className="num">{sum.owed ? <span className="red strong">{money(sum.owed)}</span> : <Badge tone="ok">Al día</Badge>}{sum.overdue > 0 && <small className="red">{sum.overdue} vencida(s)</small>}</td>
                    <td className="right nowrap">
                      {sum.owed > 0 && <button className="btn sm" onClick={() => setPaying(s)}><HandCoins size={15} />Abonar</button>}
                      <button className="btn sm ghost" title="Editar" onClick={() => setEdit({ id: s.id, data: { ...EMPTY_SUPPLIER, ...s } })}><Pencil size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <SupplierModal edit={edit} onClose={() => setEdit(null)} />}
      {paying && <PayModal supplier={paying} purchases={purchases} onClose={() => setPaying(null)} />}
    </>
  );
}

function SupplierModal({ edit, onClose, onSaved }: { edit: { id?: string; data: SupplierInput }; onClose: () => void; onSaved?: (id: string) => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [d, setD] = useState(edit.data);
  const [opening, setOpening] = useState(0);
  return (
    <Modal title={edit.id ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { const id = await saveSupplier(actor, d, edit.id, opening); onSaved?.(String(id)); }, 'Proveedor guardado').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Nombre" required className="full"><input className="input" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="NIT / cédula"><input className="input mono" value={d.nit} onChange={(e) => setD({ ...d, nit: e.target.value })} /></Field>
        <Field label="Celular"><input className="input" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label="Plazo de pago (días)"><input className="input num" type="number" min={0} value={d.termDays} onChange={(e) => setD({ ...d, termDays: Number(e.target.value) })} /></Field>
        {!edit.id && <Field label="Saldo anterior que le debe (opcional)"><MoneyInput value={opening} onChange={setOpening} /></Field>}
        <Field label="Notas" className="full"><input className="input" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Qué le compra, horarios, cuenta bancaria…" /></Field>
        <label className="checkbox full"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />Activo</label>
      </div>
    </Modal>
  );
}

function PayModal({ supplier, purchases, onClose }: { supplier: Supplier; purchases: Purchase[]; onClose: () => void }) {
  const { actor } = useAuth();
  const settings = useSettings();
  const { run, busy } = useAction();
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const pending = purchases
    .filter((p) => p.supplierId === supplier.id && purchaseBalance(p) > 0)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const owed = pending.reduce((a, p) => a + purchaseBalance(p), 0);
  const [amount, setAmount] = useState(owed);
  const [method, setMethod] = useState('Efectivo');
  return (
    <Modal title={`Abonar a ${supplier.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || !cash?.openSessionId}
          onClick={() => run(() => paySupplier(actor, supplier, pending.map((p) => p.id), amount, method), 'Abono registrado').then((ok) => ok && onClose())}>Registrar abono</button></>}>
      <div className="stack">
        {!cash?.openSessionId && <div className="alert warn">La caja está cerrada. El abono sale de caja: <Link className="red" to="/caja">abra la caja</Link> primero.</div>}
        <div className="totals"><div className="grand"><span>Deuda total</span><span className="red">{money(owed)}</span></div></div>
        <div className="form-grid">
          <Field label="Valor del abono"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Medio de pago">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {settings.paymentMethods.filter((m) => m !== CREDIT_METHOD).map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Se aplica primero a la compra más antigua:</div>
        {pending.map((p) => (
          <div key={p.id} className="row between" style={{ fontSize: 13 }}>
            <span className="mono">C-{pad(p.number, 4)} · {dateOnly(p.createdAt)}{isOverduePurchase(p) && <span className="red"> · vencida</span>}</span>
            <b>{money(purchaseBalance(p))}</b>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------- Nueva compra ----------------
function NewPurchaseModal({ suppliers, prefill = {}, onClose }: { suppliers: Supplier[]; prefill?: PurchasePrefill; onClose: () => void }) {
  const { actor, can } = useAuth();
  const settings = useSettings();
  const products = useCollection<Product>('products').rows;
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const { run, busy } = useAction();
  const [supplierId, setSupplierId] = useState(prefill.supplierId ?? '');
  const [newSupplier, setNewSupplier] = useState(false);
  const [pendingSupplier, setPendingSupplier] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>(prefill.items ?? []);
  const [q, setQ] = useState('');
  const [paymentType, setPaymentType] = useState<'credito' | 'contado'>(prefill.paymentType ?? 'credito');
  const [method, setMethod] = useState('Efectivo');
  const [invoiceRef, setInvoiceRef] = useState(prefill.invoiceRef ?? '');
  const [due, setDue] = useState('');
  const [note, setNote] = useState(prefill.note ?? '');
  const [updateCost, setUpdateCost] = useState(true);
  const [newProduct, setNewProduct] = useState(false);
  const [pendingProduct, setPendingProduct] = useState('');
  // Celulares: IMEI por línea de compra
  const [imeiText, setImeiText] = useState<Record<string, string>>(prefill.imeiText ?? {});
  const [imeiCond, setImeiCond] = useState<Record<string, PhoneCondition>>({});
  const isPhoneLine = (it: PurchaseItem) => products.find((p) => p.id === it.productId)?.type === 'EQUIPO';
  const lineUnits = (it: PurchaseItem) => parseImeiLines(imeiText[it.productId] ?? '', imeiCond[it.productId] ?? 'NUEVO');
  const effectiveItems = items.map((it) => (isPhoneLine(it) ? { ...it, units: lineUnits(it), qty: lineUnits(it).length } : it));

  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
  useEffect(() => {
    if (supplier && paymentType === 'credito') setDue(toLocalInput(addDays(new Date().toISOString(), supplier.termDays || 30)));
  }, [supplier?.id, paymentType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecciona automáticamente lo recién creado cuando llega de la base de datos
  useEffect(() => {
    if (pendingSupplier && suppliers.some((s) => s.id === pendingSupplier)) { setSupplierId(pendingSupplier); setPendingSupplier(''); }
  }, [suppliers, pendingSupplier]);
  const add = (p: Product) => setItems((xs) => xs.some((x) => x.productId === p.id)
    ? xs.map((x) => (x.productId === p.id ? { ...x, qty: x.qty + 1 } : x))
    : [...xs, { productId: p.id, name: p.name, qty: 1, unitCost: p.cost }]);
  useEffect(() => {
    const p = pendingProduct && products.find((x) => x.id === pendingProduct);
    if (p) { add(p); setPendingProduct(''); }
  }, [products, pendingProduct]);

  const catalog = useMemo(
    () => products.filter((p) => p.active && p.type !== 'SERVICIO' && matches(q, p.name, p.sku, p.brand, p.model))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12),
    [products, q],
  );
  const total = effectiveItems.reduce((a, i) => a + i.qty * i.unitCost, 0);
  const setItem = (k: number, patch: Partial<PurchaseItem>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const needsCash = paymentType === 'contado' && !cash?.openSessionId;

  const submit = () => run(() => createPurchase(actor, {
    supplier: supplier!, items: effectiveItems, paymentType, method, invoiceRef, note, updateCost,
    dueDate: paymentType === 'credito' && due ? fromLocalInput(due) : undefined,
  }), paymentType === 'credito' ? 'Compra a crédito registrada · stock actualizado' : 'Compra de contado registrada · stock actualizado')
    .then((ok) => ok && onClose());

  return (
    <Modal wide title="Nueva compra a proveedor" onClose={onClose}
      footer={<>
        <span className="grow faint">{items.length} producto(s)</span>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !supplier || items.length === 0 || needsCash} onClick={submit}>
          Registrar compra {money(total)}
        </button>
      </>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Proveedor" required>
            <div className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Seleccione…</option>
                {suppliers.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => setNewSupplier(true)}><Plus size={15} />Nuevo</button>
            </div>
          </Field>
          <Field label="Forma de pago">
            <Seg value={paymentType} onChange={setPaymentType} options={[{ value: 'credito', label: 'A crédito' }, { value: 'contado', label: 'De contado' }]} />
          </Field>
          {paymentType === 'credito' ? (
            <Field label="Fecha límite de pago"><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          ) : (
            <Field label="Paga con">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {settings.paymentMethods.filter((m) => m !== CREDIT_METHOD).map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          )}
          <Field label="Factura o nota del proveedor"><input className="input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Opcional" /></Field>
        </div>
        {needsCash && <div className="alert warn">Para comprar de contado la caja debe estar abierta, porque el dinero sale de caja. <Link className="red" to="/caja">Abrir caja</Link> o regístrela a crédito.</div>}

        <div className="row gap-sm">
          <input className="input grow" placeholder="Buscar repuesto o accesorio por nombre, SKU o modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn" title="Algo que no está en el inventario" onClick={() => setItems((xs) => [...xs, { productId: '', name: q.trim(), qty: 1, unitCost: 0 }])}><PenLine size={15} />Artículo libre</button>
          {can('inventory.edit') && <button type="button" className="btn" onClick={() => setNewProduct(true)}><PackagePlus size={15} />Producto nuevo</button>}
        </div>
        <div className="product-grid">
          {catalog.map((p) => (
            <button key={p.id} type="button" className="product-tile" onClick={() => add(p)}>
              <small className="faint mono">{p.sku || p.type}</small>
              <span style={{ fontWeight: 500 }}>{p.name}</span>
              <span className="faint" style={{ fontSize: 12 }}>Stock {p.stock} · costo {money(p.cost)}</span>
            </button>
          ))}
        </div>
        {catalog.length === 0 && <div className="faint">Sin resultados. {can('inventory.edit') ? 'Use «Producto nuevo» para crearlo.' : 'Pida al administrador crear el producto en Inventario.'}</div>}

        <div className="card">
          {items.length === 0 ? <Empty>Toque los productos de arriba para agregarlos a la compra.</Empty> : (
            <table className="table">
              <thead><tr><th>Producto</th><th className="num" style={{ width: 110 }}>Cantidad</th><th className="num" style={{ width: 160 }}>Costo unitario</th><th className="num">Subtotal</th><th /></tr></thead>
              <tbody>
                {items.map((it, k) => (
                  <tr key={it.productId || `libre-${k}`}>
                    <td>
                      {it.productId ? <span className="strong">{it.name}</span> : (
                        <>
                          <input className="input" placeholder="Descripción del artículo libre" value={it.name} onChange={(e) => setItem(k, { name: e.target.value })} />
                          <small className="faint">Sin inventario: solo registra la compra y la deuda</small>
                        </>
                      )}
                      {isPhoneLine(it) && (
                        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                          <ImeiTextarea value={imeiText[it.productId] ?? ''} onChange={(v) => setImeiText({ ...imeiText, [it.productId]: v })} />
                          <Seg value={imeiCond[it.productId] ?? 'NUEVO'} onChange={(v) => setImeiCond({ ...imeiCond, [it.productId]: v })}
                            options={[{ value: 'NUEVO', label: 'Nuevos' }, { value: 'USADO', label: 'Usados' }]} />
                        </div>
                      )}
                    </td>
                    <td>{isPhoneLine(it)
                      ? <div className="num strong" title="Un celular por IMEI">{lineUnits(it).length}</div>
                      : <input className="input num" type="number" min={1} value={it.qty} onChange={(e) => setItem(k, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />}</td>
                    <td><MoneyInput value={it.unitCost} onChange={(v) => setItem(k, { unitCost: v })} /></td>
                    <td className="num">{money((isPhoneLine(it) ? lineUnits(it).length : it.qty) * it.unitCost)}</td>
                    <td className="right"><button className="btn sm ghost" onClick={() => setItems(items.filter((_, i) => i !== k))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="strong right">Total</td><td className="num strong">{money(total)}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="form-grid">
          <Field label="Nota"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" /></Field>
          <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />Actualizar el costo de los productos con el de esta compra
          </label>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {paymentType === 'credito'
            ? 'A crédito: el stock entra ya, el dinero no sale de caja y la compra queda en «Por pagar» hasta que registre los abonos.'
            : 'De contado: el stock entra ya y el total sale de la caja abierta como «Pago a proveedor».'}
        </div>
      </div>
      {newSupplier && <SupplierModal edit={{ data: { ...EMPTY_SUPPLIER } }} onClose={() => setNewSupplier(false)} onSaved={setPendingSupplier} />}
      {newProduct && (
        <ProductModal edit={{ data: { ...EMPTY_PRODUCT, type: 'REPUESTO', name: q, stock: 0 } }} onClose={() => setNewProduct(false)} onSaved={setPendingProduct} />
      )}
    </Modal>
  );
}
