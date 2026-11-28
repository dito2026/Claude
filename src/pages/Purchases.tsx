import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, HandCoins, History, PackagePlus, PenLine, Pencil, Plus, Sparkles, Trash2, Truck } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { PhoneCondition, Product, Purchase, PurchaseItem, Supplier } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateOnly, dateTime, fromLocalInput, matches, money, pad, toLocalInput, addDays, whatsappLink } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, Stat, useAction, useToast } from '../components/ui';
import { PayMethods } from '../components/PayMethods';
import { useSettings } from '../services/settings';
import { downloadExcel } from '../services/accounting';
import {
  changePurchaseSupplier, createPurchase, supplierItems, editOpeningBalance, editPurchase, editSupplierPayment, movePayment, supplierPayments, isOverduePurchase, voidPurchase, purchaseBalance, saveSupplier, supplierSummary, type SupplierInput,
} from '../services/purchases';
import type { CashState } from '../services/cash';
import { EMPTY_PRODUCT, ProductModal } from './Inventory';
import { ImeiTextarea, parseImeiLines } from '../components/PhoneUnits';
import { AiInvoiceModal, RestockTab, type PurchasePrefill } from '../components/PurchaseAutomation';
import { useAiEnabled } from '../services/aiConfig';
import { ZeroCostSalesModal, useZeroCostSales, type CostFix } from '../components/ZeroCostSales';
import { SupplierPayModal, UnlinkedCashPayments, useUnlinkedCashPayments } from '../components/SupplierPay';

const EMPTY_SUPPLIER: SupplierInput = { name: '', nit: '', phone: '', termDays: 30, notes: '', active: true };

const statusTone = (p: Purchase) =>
  p.status === 'anulada' ? '' : p.status === 'pagada' ? 'ok' : isOverduePurchase(p) ? 'red' : p.status === 'parcial' ? 'warn' : 'info';
const statusLabel = (p: Purchase) =>
  p.status === 'anulada' ? 'Anulada' : p.status === 'pagada' ? 'Pagada' : isOverduePurchase(p) ? 'Vencida' : p.status === 'parcial' ? 'Abono parcial' : 'Por pagar';

export function Purchases() {
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const [tab, setTab] = useState<'compras' | 'proveedores' | 'pagos' | 'reposicion'>('compras');
  const unlinked = useUnlinkedCashPayments();
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
      {unlinked.length > 0 && tab !== 'pagos' && (
        <div className="alert warn" style={{ marginBottom: 12 }}><div>
          Hay <b>{unlinked.length}</b> pago{unlinked.length === 1 ? '' : 's'} a proveedores hecho{unlinked.length === 1 ? '' : 's'} desde Caja que no descontaron la deuda.{' '}
          <button className="btn sm" onClick={() => setTab('pagos')}>Revisar y descontar</button>
        </div></div>
      )}
      <div className="tabs">
        <button className={tab === 'compras' ? 'active' : ''} onClick={() => setTab('compras')}>Compras</button>
        <button className={tab === 'proveedores' ? 'active' : ''} onClick={() => setTab('proveedores')}>Proveedores y saldos</button>
        <button className={tab === 'pagos' ? 'active' : ''} onClick={() => setTab('pagos')}>Pagos a proveedores</button>
        <button className={tab === 'reposicion' ? 'active' : ''} onClick={() => setTab('reposicion')}>Reposición sugerida</button>
      </div>
      {tab === 'compras' && <PurchaseList purchases={purchases} />}
      {tab === 'proveedores' && <SupplierList suppliers={suppliers} purchases={purchases} />}
      {tab === 'pagos' && <PaymentsTab suppliers={suppliers} purchases={purchases} />}
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
    .filter((p) => matches(q, p.number, p.supplierName, p.invoiceRef, ...p.items.map((i) => i.name), ...p.items.flatMap((i) => (i.units ?? []).map((u) => u.imei))))
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
                    <td className="sold-items" title={p.items.map((it) => `${it.qty}× ${it.name} · ${money(it.qty * it.unitCost)}`).join('\n')}>
                      {p.kind === 'saldo_inicial' ? <span className="muted">Saldo anterior</span> : (
                        <>
                          {p.items.slice(0, 3).map((it, k) => (
                            <div key={k}>{it.qty > 1 && <b>{it.qty}× </b>}{it.name}{it.units?.length ? <small className="mono">IMEI {it.units.map((u) => u.imei).join(', ')}</small> : null}</div>
                          ))}
                          {p.items.length > 3 && <small>y {p.items.length - 3} más…</small>}
                        </>
                      )}
                      {p.invoiceRef && <small>Fact. {p.invoiceRef}</small>}
                    </td>
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
  const [editing, setEditing] = useState(false);
  const [openingFix, setOpeningFix] = useState(false);
  const refundable = (p.payments ?? []).filter((x) => !x.outsideCash).reduce((a, x) => a + x.amount, 0);
  return (
    <Modal title={<><span className="mono">C-{pad(p.number, 4)}</span> · {p.supplierName}</>} wide onClose={onClose}
      footer={voided ? undefined : (
        <>
          {can('settings') && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setMode(mode === 'anular' ? '' : 'anular')}>Anular compra</button>}
          {can('settings') && p.kind !== 'saldo_inicial' && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Editar compra</button>}
          {can('settings') && p.kind === 'saldo_inicial' && <button className="btn" onClick={() => setOpeningFix(true)}><Pencil size={15} />Corregir saldo</button>}
          <button className="btn" onClick={() => setMode(mode === 'proveedor' ? '' : 'proveedor')}>Cambiar proveedor</button>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
        </>
      )}>
      {voided && <div className="alert warn" style={{ marginBottom: 14 }}>Compra anulada el {dateTime(p.voidedAt)} por {p.voidedBy}: {p.voidReason}</div>}
      {(p.edits ?? []).length > 0 && (
        <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
          {p.edits!.map((e, k) => <div key={k}>Corregida el {dateTime(e.at)} por {e.by} · antes {money(e.total)} · {e.reason}</div>)}
        </div>
      )}
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
            {refundable > 0 ? ` y los ${money(refundable)} que se le pagaron desde la caja vuelven a la caja abierta` : ''}
            {(p.paid || 0) > refundable ? ` (lo pagado por fuera de la caja, ${money((p.paid || 0) - refundable)}, no vuelve a la caja)` : ''}. La compra no se borra: queda como «Anulada».
            {p.kind === 'saldo_inicial' && (p.paid || 0) > 0 && <b> Si solo quiere cambiar el valor del saldo anterior, use mejor «Corregir saldo».</b>}
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
                {x.outsideCash && <small className="faint" style={{ display: 'block' }}>Pagado por fuera de la caja</small>}
                {x.cashMovementId && <small className="faint" style={{ display: 'block' }}>Pago de Caja descontado después</small>}
                {x.movedFrom && <small className="faint" style={{ display: 'block' }} title={x.movedFrom.reason}>Pasado desde C-{pad(x.movedFrom.number, 4)} por {x.movedFrom.by}</small>}
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
      {editing && <EditPurchaseModal p={p} onClose={() => setEditing(false)} />}
      {openingFix && <OpeningBalanceModal p={p} onClose={() => setOpeningFix(false)} />}
    </Modal>
  );
}

function EditPurchaseModal({ p, onClose }: { p: Purchase; onClose: () => void }) {
  const { actor } = useAuth();
  const toast = useToast();
  const { run, busy } = useAction();
  const [lines, setLines] = useState(() => p.items.map((it, index) => ({ index, name: it.name, qty: it.qty, unitCost: it.unitCost })));
  const [invoiceRef, setInvoiceRef] = useState(p.invoiceRef ?? '');
  const [note, setNote] = useState(p.note ?? '');
  const [due, setDue] = useState(p.dueDate ? toLocalInput(p.dueDate) : '');
  const [updateCost, setUpdateCost] = useState(true);
  const [reason, setReason] = useState('');
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((xs) => xs.map((x) => (x.index === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const paid = p.paid || 0;
  const save = () => run(async () => {
    const r = await editPurchase(actor, p.id, { lines, invoiceRef, note, dueDate: due ? fromLocalInput(due) : undefined, updateCost }, reason);
    toast(r.salesFixed ? `Compra corregida · ganancia recalculada en ${r.salesFixed} venta${r.salesFixed === 1 ? '' : 's'}` : 'Compra corregida');
  }).then((ok) => ok && onClose());
  return (
    <Modal wide title={`Editar compra C-${pad(p.number, 4)} · ${p.supplierName}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !reason.trim() || total < paid} onClick={save}>Guardar cambios</button></>}>
      <div className="stack">
        <div className="alert info"><div>
          Corrija nombre, cantidad o costo. Si cambia la cantidad de un producto con inventario, la diferencia entra o sale del stock.
          Ponga <b>0</b> para quitar una línea. En los celulares la cantidad la dan los IMEI.
          Si ya vendió algo de esta compra, la ganancia de esas ventas se recalcula con el costo corregido.
        </div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Producto</th><th className="num" style={{ width: 100 }}>Cantidad</th><th className="num" style={{ width: 160 }}>Costo unitario</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const old = p.items[l.index];
                return (
                  <tr key={l.index} style={{ opacity: l.qty === 0 ? 0.5 : 1 }}>
                    <td><input className="input" value={l.name} onChange={(e) => set(l.index, { name: e.target.value })} />
                      {old.units?.length ? <small className="mono">IMEI {old.units.map((u) => u.imei).join(', ')}</small> : !old.productId ? <small>Artículo libre (sin inventario)</small> : null}</td>
                    <td>{old.units?.length ? <div className="num">{l.qty}</div>
                      : <input className="input num" type="number" min={0} value={l.qty} onChange={(e) => set(l.index, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />}</td>
                    <td><MoneyInput value={l.unitCost} onChange={(v) => set(l.index, { unitCost: v })} /></td>
                    <td className="num">{money(l.qty * l.unitCost)}{l.qty !== old.qty && <small className={l.qty < old.qty ? 'red' : ''}>{l.qty > old.qty ? '+' : ''}{l.qty - old.qty} al stock</small>}</td>
                  </tr>
                );
              })}
              <tr><td className="strong">Total</td><td /><td className="num faint">antes {money(p.total)}</td><td className="num strong">{money(total)}</td></tr>
            </tbody>
          </table>
        </div>
        {total < paid
          ? <div className="alert error"><div>Ya se le pagaron {money(paid)} a {p.supplierName} y el nuevo total sería {money(total)}. Corrija primero el pago (lápiz en «Pagos») y luego la compra.</div></div>
          : <div className="faint" style={{ fontSize: 13 }}>Pagado {money(paid)} · saldo después del cambio: <b>{money(total - paid)}</b></div>}
        <div className="form-grid">
          <Field label="Factura o nota del proveedor"><input className="input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></Field>
          {p.paymentType === 'credito' && <Field label="Fecha límite de pago"><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
          <Field label="Nota" className="full"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <label className="checkbox"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />Actualizar el costo de los productos con el corregido</label>
        <Field label="Motivo" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: el costo era otro · eran 5 y no 3" /></Field>
      </div>
    </Modal>
  );
}

function EditSupplierPaymentModal({ p, index, onClose }: { p: Purchase; index: number; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const purchases = useCollection<Purchase>('purchases').rows;
  const pay = p.payments[index];
  const [amount, setAmount] = useState(pay.amount);
  const [method, setMethod] = useState(pay.method);
  const [reason, setReason] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const diff = amount - pay.amount;
  const touchesCash = !pay.outsideCash && !pay.cashMovementId;
  const others = purchases
    .filter((x) => x.id !== p.id && x.supplierId === p.supplierId && x.status !== 'anulada' && purchaseBalance(x) >= pay.amount)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const save = (value: number) => run(() => editSupplierPayment(actor, p.id, index, { amount: value, method }, reason),
    value === 0 ? (touchesCash ? 'Pago eliminado · el dinero volvió a la caja' : 'Pago eliminado') : (touchesCash ? 'Pago corregido · caja ajustada' : 'Pago corregido')).then((ok) => ok && onClose());
  const move = () => run(() => movePayment(actor, p.id, index, moveTo, reason), 'Pago pasado a la otra compra · la caja no cambia').then((ok) => ok && onClose());
  return (
    <Modal title={`Corregir pago · compra C-${pad(p.number, 4)}`} onClose={onClose}
      footer={<>
        {!pay.cashMovementId && <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy || !reason.trim()}
          onClick={() => { if (confirm(`¿Eliminar el pago de ${money(pay.amount)} a ${p.supplierName}?${touchesCash ? ' Ese dinero vuelve a la caja.' : ''}`)) void save(0); }}><Trash2 size={15} />Eliminar pago</button>}
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        {moveTo
          ? <button className="btn primary" disabled={busy || !reason.trim()} onClick={move}>Pasar el pago</button>
          : !pay.cashMovementId && <button className="btn primary" disabled={busy || !amount || !method || !reason.trim() || (amount === pay.amount && method === pay.method)} onClick={() => void save(amount)}>Guardar corrección</button>}
      </>}>
      <div className="stack">
        <div className="alert info"><div>
          Pago del {dateTime(pay.at)} a <b>{p.supplierName}</b>: <b>{money(pay.amount)}</b> en {pay.method}. Total de la compra {money(p.total)}.{' '}
          {pay.outsideCash ? 'Se pagó por fuera de la caja: corregirlo no mueve la caja.'
            : pay.cashMovementId ? 'Salió de un «Pago a proveedor» de Caja descontado después: no se cambia su valor; si quedó en la compra equivocada, páselo a la correcta.'
              : 'La caja abierta se ajusta sola.'}
        </div></div>
        {!pay.cashMovementId && !moveTo && <>
          <Field label="Valor correcto"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <PayMethods value={method} onChange={setMethod} />
          {(diff !== 0 || method !== pay.method) && (
            <div className="faint" style={{ fontSize: 13 }}>
              {!touchesCash ? 'No mueve la caja.'
                : method !== pay.method
                  ? <>En caja: vuelven {money(pay.amount)} a {pay.method} y salen {money(amount)} de {method}.</>
                  : diff > 0 ? <>En caja: salen {money(diff)} más de {method}.</> : <>En caja: vuelven {money(-diff)} a {method}.</>}
              {' '}Saldo de la compra: {money(Math.max(0, p.total - ((p.paid || 0) - pay.amount + amount)))}.
            </div>
          )}
        </>}
        <Field label="¿Este pago era de otra compra de este proveedor?">
          <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">No, es de esta compra</option>
            {others.map((x) => <option key={x.id} value={x.id}>C-{pad(x.number, 4)} · {x.kind === 'saldo_inicial' ? 'Saldo anterior' : x.items.map((i) => i.name).join(', ').slice(0, 40)} · le faltan {money(purchaseBalance(x))}</option>)}
          </select>
          {moveTo && <small className="muted">El pago completo ({money(pay.amount)}) pasa a esa compra. La caja no cambia.</small>}
          {others.length === 0 && <small className="faint">No hay otra compra de {p.supplierName} con saldo suficiente para este pago.</small>}
        </Field>
        <Field label="Motivo" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: digité mal el valor · era de la otra compra" /></Field>
      </div>
    </Modal>
  );
}

/** Corrige el valor de un «Saldo anterior» sin anularlo (los abonos se conservan). */
function OpeningBalanceModal({ p, onClose }: { p: Purchase; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [total, setTotal] = useState(p.total);
  const [reason, setReason] = useState('');
  const paid = p.paid || 0;
  return (
    <Modal title={`Corregir saldo anterior · ${p.supplierName}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !reason.trim() || total < paid || !total || total === p.total}
          onClick={() => run(() => editOpeningBalance(actor, p.id, total, reason), 'Saldo anterior corregido').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="stack">
        <div className="alert info"><div>Hoy dice {money(p.total)}{paid > 0 ? <>, con {money(paid)} ya abonados</> : null}. Los abonos se conservan y la caja no cambia.</div></div>
        <Field label="Saldo anterior correcto"><MoneyInput value={total} onChange={setTotal} autoFocus /></Field>
        {total < paid && <div className="alert error"><div>Ya se le abonaron {money(paid)}: el saldo no puede quedar por debajo.</div></div>}
        <div className="faint" style={{ fontSize: 13 }}>Queda por pagar: <b>{money(Math.max(0, total - paid))}</b></div>
        <Field label="Motivo" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: el saldo que me pasó era 300.000" /></Field>
      </div>
    </Modal>
  );
}

// ---------------- Estado de cuenta de un proveedor ----------------
/** Cuánto se le debe y en qué compras (la más antigua primero). */
function SupplierStatement({ supplier, purchases, onPay }: { supplier: Supplier; purchases: Purchase[]; onPay: () => void }) {
  const sum = supplierSummary(supplier, purchases);
  const pending = purchases
    .filter((p) => p.supplierId === supplier.id && purchaseBalance(p) > 0)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return (
    <div className="stack">
      <div className="grid g4">
        <Stat accent label="Le debe" value={<span className={sum.owed ? 'red' : ''}>{money(sum.owed)}</span>} sub={sum.overdue ? `${sum.overdue} compra(s) vencida(s)` : pending.length ? `${pending.length} compra(s) por pagar` : 'Al día'} />
        <Stat label="Compras a crédito" value={money(sum.credit)} sub="incluye saldo anterior y compras que quedaron con saldo" />
        <Stat label="Abonado a crédito" value={money(sum.paidOnCredit)} />
        <Stat label="De contado" value={money(sum.cash)} sub="pagadas completas al comprar" />
      </div>
      <div className="faint" style={{ fontSize: 13 }}>Le debe = compras a crédito − abonado ({money(sum.credit)} − {money(sum.paidOnCredit)}). Las compras anuladas no cuentan.</div>
      {pending.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Compra</th><th>Fecha</th><th>Detalle</th><th>Vence</th><th className="num">Total</th><th className="num">Abonado</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td className="mono strong">C-{pad(p.number, 4)}</td>
                  <td>{dateOnly(p.createdAt)}</td>
                  <td>{p.kind === 'saldo_inicial' ? 'Saldo anterior' : p.items.map((i) => i.name).join(', ')}</td>
                  <td>{p.dueDate ? <span className={isOverduePurchase(p) ? 'red' : ''}>{dateOnly(p.dueDate)}</span> : '—'}</td>
                  <td className="num">{money(p.total)}</td>
                  <td className="num">{money(p.paid || 0)}</td>
                  <td className="num strong red">{money(purchaseBalance(p))}</td>
                </tr>
              ))}
              <tr><td className="strong" colSpan={6}>Total que le debe</td><td className="num strong red">{money(sum.owed)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {sum.owed > 0 && <div><button className="btn primary" onClick={onPay}><HandCoins size={15} />Abonar a {supplier.name}</button></div>}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { REPUESTO: 'Repuesto', ACCESORIO: 'Accesorio', EQUIPO: 'Celular', SERVICIO: 'Servicio', libre: 'Sin inventario' };

/** Todo lo que se le ha comprado al proveedor (o solo repuestos): cuántas veces, cuánto y a qué costo. */
function SupplierItems({ supplier, purchases }: { supplier: Supplier; purchases: Purchase[] }) {
  const products = useCollection<Product>('products').rows;
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [onlyParts, setOnlyParts] = useState<'todo' | 'repuestos'>('repuestos');
  const [q, setQ] = useState('');
  const all = useMemo(() => supplierItems(supplier.id, purchases, productMap), [supplier.id, purchases, productMap]);
  const rows = all.filter((r) => (onlyParts === 'todo' || r.isPart) && matches(q, r.name));
  const exportXls = () => downloadExcel(`compras-${supplier.name.replace(/\s+/g, '-')}_${onlyParts}.csv`, [
    [`Lo que se le ha comprado a ${supplier.name}`, onlyParts === 'repuestos' ? 'Solo repuestos' : 'Todo'],
    [],
    ['Artículo', 'Tipo', 'Veces', 'Cantidad', 'Total comprado', 'Último costo', 'Última compra', 'Compra N.º', 'Costo más bajo', 'Costo más alto'],
    ...rows.map((r) => [r.name, TYPE_LABEL[r.type] ?? r.type, r.times, r.qty, r.total, r.lastCost, dateOnly(r.lastAt), `C-${pad(r.lastNumber, 4)}`, r.minCost, r.maxCost]),
  ]);
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Lo que le ha comprado</h3>
        <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
          <Seg value={onlyParts} onChange={setOnlyParts} options={[{ value: 'repuestos', label: 'Solo repuestos' }, { value: 'todo', label: 'Todo' }]} />
          <SearchBox value={q} onChange={setQ} placeholder="Buscar repuesto" />
          <button className="btn sm" onClick={exportXls} disabled={rows.length === 0}><Download size={15} />Excel</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty>{all.length === 0 ? 'Aún no hay compras a este proveedor.' : onlyParts === 'repuestos' ? 'No le ha comprado repuestos. Toque «Todo» para ver lo demás.' : 'Sin resultados.'}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Artículo</th><th>Tipo</th><th className="num">Veces</th><th className="num">Cantidad</th><th className="num">Último costo</th><th>Última compra</th><th className="num">Costo más bajo / alto</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}>
                <td className="strong">{r.name}</td>
                <td><Badge tone={r.isPart ? 'info' : ''}>{TYPE_LABEL[r.type] ?? r.type}{r.type === 'libre' && r.isPart ? ' · para OT' : ''}</Badge></td>
                <td className="num">{r.times}</td>
                <td className="num">{r.qty}</td>
                <td className="num strong">{money(r.lastCost)}</td>
                <td>{dateOnly(r.lastAt)} <small className="mono faint">C-{pad(r.lastNumber, 4)}</small></td>
                <td className="num faint">{r.minCost === r.maxCost ? money(r.lastCost) : `${money(r.minCost)} – ${money(r.maxCost)}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Pagos a proveedores ----------------
function PaymentsTab({ suppliers, purchases }: { suppliers: Supplier[]; purchases: Purchase[] }) {
  const [sid, setSid] = useState('');
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <select className="input" style={{ maxWidth: 320 }} value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Proveedor">
          <option value="">Todos los proveedores</option>
          {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <UnlinkedCashPayments suppliers={suppliers} />
      <div className="card"><PaymentsList purchases={purchases} supplierId={sid || undefined} showSupplier={!sid} /></div>
    </>
  );
}

/** Lista de pagos y abonos a proveedores; tocando una compra se abre para verla o corregir el pago. */
function PaymentsList({ purchases, supplierId, showSupplier }: { purchases: Purchase[]; supplierId?: string; showSupplier?: boolean }) {
  const rows = useMemo(() => supplierPayments(purchases, supplierId), [purchases, supplierId]);
  const [open, setOpen] = useState<string | null>(null);
  const valid = rows.filter((r) => !r.voided);
  const total = valid.reduce((a, r) => a + r.amount, 0);
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const thisMonth = valid.filter((r) => new Date(r.at).getTime() >= month).reduce((a, r) => a + r.amount, 0);
  const openP = open ? purchases.find((p) => p.id === open) : undefined;
  return (
    <>
      <div className="row" style={{ padding: '12px 16px', gap: 24 }}>
        <span className="muted">{valid.length} pago(s) · total <b>{money(total)}</b></span>
        <span className="muted">Este mes: <b>{money(thisMonth)}</b></span>
      </div>
      {rows.length === 0 ? <Empty icon={<HandCoins size={30} />}>No hay pagos a proveedores todavía.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th>{showSupplier && <th>Proveedor</th>}<th>Compras</th><th>Medio</th><th>Registró</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ opacity: r.voided ? 0.5 : 1 }}>
                  <td className="nowrap">{dateTime(r.at)}{r.edited && <small className="faint">Corregido</small>}{r.voided && <small className="red">Compra anulada</small>}</td>
                  {showSupplier && <td className="strong">{r.supplierName}</td>}
                  <td>
                    <div className="row gap-sm" style={{ gap: 4 }}>
                      {r.parts.map((x) => (
                        <button key={x.purchaseId + x.index} type="button" className="badge plain" style={{ cursor: 'pointer' }} title="Abrir la compra (ver o corregir este pago)" onClick={() => setOpen(x.purchaseId)}>
                          C-{pad(x.number, 4)}{r.parts.length > 1 ? ` · ${money(x.amount)}` : ''}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>{r.method}{r.source === 'fuera' && <small className="faint">fuera de la caja</small>}{r.source === 'caja_aplicado' && <small className="faint">desde Caja, aplicado después</small>}</td>
                  <td>{r.by}</td>
                  <td className="num strong">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openP && <PurchaseModal p={openP} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------------- Proveedores ----------------
function SupplierList({ suppliers, purchases }: { suppliers: Supplier[]; purchases: Purchase[] }) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ id?: string; data: SupplierInput } | null>(null);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
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
                      <button className="btn sm ghost" title="Estado de cuenta: cuánto le debe, en qué compras y los pagos hechos" onClick={() => setHistory(s)}><History size={15} />Estado de cuenta</button>
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
      {paying && <SupplierPayModal supplier={paying} onClose={() => setPaying(null)} />}
      {history && (
        <Modal wide title={`Estado de cuenta · ${history.name}`} onClose={() => setHistory(null)}>
          <SupplierStatement supplier={history} purchases={purchases} onPay={() => { setPaying(history); setHistory(null); }} />
          <SupplierItems supplier={history} purchases={purchases} />
          <h3 style={{ margin: '18px 0 6px' }}>Pagos y abonos</h3>
          <PaymentsList purchases={purchases} supplierId={history.id} />
        </Modal>
      )}
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


// ---------------- Nueva compra ----------------
function NewPurchaseModal({ suppliers, prefill = {}, onClose }: { suppliers: Supplier[]; prefill?: PurchasePrefill; onClose: () => void }) {
  const { actor, can } = useAuth();
  const products = useCollection<Product>('products').rows;
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const { run, busy } = useAction();
  const [supplierId, setSupplierId] = useState(prefill.supplierId ?? '');
  const [newSupplier, setNewSupplier] = useState(false);
  const [pendingSupplier, setPendingSupplier] = useState('');
  const [items, setItems] = useState<(PurchaseItem & { key: string })[]>(() => (prefill.items ?? []).map((it, i) => ({ ...it, key: it.productId || `l${i}` })));
  const [q, setQ] = useState('');
  const [paymentType, setPaymentType] = useState<'credito' | 'contado'>(prefill.paymentType ?? 'credito');
  const [method, setMethod] = useState('');
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
  const lineUnits = (it: { key: string }) => parseImeiLines(imeiText[it.key] ?? '', imeiCond[it.key] ?? 'NUEVO');
  const effectiveItems: PurchaseItem[] = items.map(({ key, ...it }) => (isPhoneLine(it) ? { ...it, units: lineUnits({ key }), qty: lineUnits({ key }).length } : it));
  const newKey = () => Math.random().toString(36).slice(2, 9);
  // Mismo producto a otro precio: otra línea debajo con el mismo producto
  const otherPrice = (k: number) => setItems((xs) => [...xs.slice(0, k + 1), { productId: xs[k].productId, name: xs[k].name, qty: 1, unitCost: xs[k].unitCost, key: newKey() }, ...xs.slice(k + 1)]);

  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
  useEffect(() => {
    if (supplier && paymentType === 'credito') setDue(toLocalInput(addDays(new Date().toISOString(), supplier.termDays || 30)));
  }, [supplier?.id, paymentType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecciona automáticamente lo recién creado cuando llega de la base de datos
  useEffect(() => {
    if (pendingSupplier && suppliers.some((s) => s.id === pendingSupplier)) { setSupplierId(pendingSupplier); setPendingSupplier(''); }
  }, [suppliers, pendingSupplier]);
  const add = (p: Product) => setItems((xs) => {
    const last = xs.map((x) => x.productId).lastIndexOf(p.id);
    return last >= 0
      ? xs.map((x, i) => (i === last ? { ...x, qty: x.qty + 1 } : x))
      : [...xs, { productId: p.id, name: p.name, qty: 1, unitCost: p.cost, key: newKey() }];
  });
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
  // De contado con varios medios
  const settings = useSettings();
  const payMethodsList = settings.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const [split, setSplit] = useState<{ method: string; amount: number }[] | null>(null);
  const splitSum = (split ?? []).reduce((a, x) => a + (x.amount || 0), 0);
  const splitOk = !split || (splitSum === total && split.every((x) => !(x.amount > 0) || x.method));
  const needsCash = paymentType === 'contado' && !cash?.openSessionId;

  const fixes = useMemo<CostFix[]>(() => (can('settings') ? effectiveItems
    .filter((it) => it.productId && it.unitCost > 0)
    .map((it) => ({ productId: it.productId, name: it.name, cost: it.unitCost })) : []), [effectiveItems, can]);
  const zeroSales = useZeroCostSales(fixes);
  const [askZero, setAskZero] = useState<CostFix[] | null>(null);
  const submit = () => run(() => createPurchase(actor, {
    supplier: supplier!, items: effectiveItems, paymentType, method: split ? (split.find((x) => x.amount > 0)?.method ?? '') : method, invoiceRef, note, updateCost,
    ...(paymentType === 'contado' && split ? { payments: split } : {}),
    dueDate: paymentType === 'credito' && due ? fromLocalInput(due) : undefined,
  }), paymentType === 'credito' ? 'Compra a crédito registrada · stock actualizado' : 'Compra de contado registrada · stock actualizado')
    .then((ok) => {
      if (!ok) return;
      if (zeroSales.length) setAskZero(fixes);
      else onClose();
    });
  if (askZero) return <ZeroCostSalesModal fixes={askZero} onClose={onClose} />;

  return (
    <Modal wide title="Nueva compra a proveedor" onClose={onClose}
      footer={<>
        <span className="grow faint">{items.length} producto(s)</span>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !supplier || items.length === 0 || needsCash || (paymentType === 'contado' && (split ? !splitOk : !method))} onClick={submit}>
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
          ) : !split ? (
            <div className="field">
              <PayMethods label="Paga con" value={method} onChange={setMethod} missing={!method} />
              <button type="button" className="btn sm ghost" style={{ justifyContent: 'flex-start', paddingLeft: 0 }}
                onClick={() => setSplit([{ method: method || payMethodsList[0] || '', amount: total }, { method: '', amount: 0 }])}>+ Pagar con varios medios</button>
            </div>
          ) : (
            <div className="field full">
              <span>Paga con varios medios <em>*</em></span>
              <div className="stack" style={{ gap: 6 }}>
                {split.map((x, k) => (
                  <div key={k} className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
                    <select className="input" value={x.method} aria-label={`Medio ${k + 1}`} onChange={(e) => setSplit(split.map((y, i) => (i === k ? { ...y, method: e.target.value } : y)))}>
                      <option value="">Medio…</option>
                      {payMethodsList.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div style={{ width: 150 }}><MoneyInput value={x.amount} aria-label={`Valor ${k + 1}`} onChange={(v) => setSplit(split.map((y, i) => (i === k ? { ...y, amount: v } : y)))} /></div>
                    <button type="button" className="btn sm ghost" title="Quitar" onClick={() => { const next = split.filter((_, i) => i !== k); setSplit(next.length ? next : null); }}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div className="row gap-sm">
                  <button type="button" className="btn sm" onClick={() => setSplit([...split, { method: '', amount: Math.max(0, total - splitSum) }])}><Plus size={14} />Otro medio</button>
                  <button type="button" className="btn sm ghost" onClick={() => setSplit(null)}>Un solo medio</button>
                  <span className={splitSum === total ? 'faint' : 'red'} style={{ fontSize: 13 }}>
                    {splitSum === total ? `Suma ${money(splitSum)} · completo` : splitSum < total ? `Faltan ${money(total - splitSum)}` : `Sobran ${money(splitSum - total)}`}
                  </span>
                </div>
              </div>
            </div>
          )}
          <Field label="Factura o nota del proveedor"><input className="input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Opcional" /></Field>
        </div>
        {needsCash && <div className="alert warn">Para comprar de contado la caja debe estar abierta, porque el dinero sale de caja. <Link className="red" to="/caja">Abrir caja</Link> o regístrela a crédito.</div>}

        <div className="row gap-sm">
          <input className="input grow" placeholder="Buscar repuesto o accesorio por nombre, SKU o modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn" title="Algo que no está en el inventario" onClick={() => setItems((xs) => [...xs, { productId: '', name: q.trim(), qty: 1, unitCost: 0, key: newKey() }])}><PenLine size={15} />Artículo libre</button>
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
            <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Producto</th><th className="num" style={{ width: 110 }}>Cantidad</th><th className="num" style={{ width: 160 }}>Costo unitario</th><th className="num">Subtotal</th><th /></tr></thead>
              <tbody>
                {items.map((it, k) => (
                  <tr key={it.key}>
                    <td>
                      {it.productId ? <span className="strong">{it.name}{items.filter((x) => x.productId === it.productId).length > 1 && <small className="faint"> · a {money(it.unitCost)}</small>}</span> : (
                        <>
                          <input className="input" placeholder="Descripción del artículo libre" value={it.name} onChange={(e) => setItem(k, { name: e.target.value })} />
                          <small className="faint">Sin inventario: solo registra la compra y la deuda</small>
                        </>
                      )}
                      {isPhoneLine(it) && (
                        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                          <ImeiTextarea value={imeiText[it.key] ?? ''} onChange={(v) => setImeiText({ ...imeiText, [it.key]: v })} />
                          <Seg value={imeiCond[it.key] ?? 'NUEVO'} onChange={(v) => setImeiCond({ ...imeiCond, [it.key]: v })}
                            options={[{ value: 'NUEVO', label: 'Nuevos' }, { value: 'USADO', label: 'Usados' }]} />
                        </div>
                      )}
                    </td>
                    <td>{isPhoneLine(it)
                      ? <div className="num strong" title="Un celular por IMEI">{lineUnits(it).length}</div>
                      : <input className="input num" type="number" min={1} value={it.qty} onChange={(e) => setItem(k, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />}</td>
                    <td><MoneyInput value={it.unitCost} onChange={(v) => setItem(k, { unitCost: v })} /></td>
                    <td className="num">{money((isPhoneLine(it) ? lineUnits(it).length : it.qty) * it.unitCost)}</td>
                    <td className="right nowrap">
                      {it.productId && <button type="button" className="btn sm ghost" title="Agregar el mismo producto con otro costo (ej.: 3 a $10.000 y 2 a $12.000)" onClick={() => otherPrice(k)}><Plus size={14} />Otro precio</button>}
                      <button className="btn sm ghost" title="Quitar" onClick={() => setItems(items.filter((_, i) => i !== k))}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="strong right">Total</td><td className="num strong">{money(total)}</td><td /></tr>
              </tbody>
            </table>
            </div>
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
