import { useMemo, useState } from 'react';
import { FileOutput, Plus, Printer, ReceiptText, Trash2, Undo2 } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { BusinessSettings, Invoice, PhoneUnit, Product, Remission } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateOnly, matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../services/settings';
import { tracksStock } from '../services/inventory';
import { isPhone } from '../services/phones';
import { createInvoice } from '../services/billing';
import {
  createRemission, invoiceItemsFromRemission, pendingQty, remissionPending, remissionPendingValue, remissionSoldValue, returnRemission,
  type RemissionLineDraft,
} from '../services/remissions';
import { UnitPickerModal } from '../components/PhoneUnits';
import { InvoiceModal } from '../components/Receipts';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, Stat, printNow, useAction } from '../components/ui';

const rn = (n: number) => `R-${pad(n, 4)}`;

export function Remissions() {
  const rows = useCollection<Remission>('remissions').rows;
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'abierta' | 'todas'>('abierta');
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const list = useMemo(() => rows
    .filter((r) => filter === 'todas' || q.trim() !== '' || r.status === 'abierta')
    .filter((r) => matches(q, r.number, r.recipient.name, r.recipient.document, ...r.items.map((i) => i.name), ...r.items.map((i) => i.imei)))
    .sort((a, b) => b.number - a.number), [rows, q, filter]);
  const open = rows.filter((r) => r.status === 'abierta');
  const view = rows.find((r) => r.id === viewId) ?? null;

  return (
    <>
      <PageHead eyebrow="Finanzas" title="Remisiones"
        subtitle="Mercancía en consignación: sale del inventario al remisionarla; lo que devuelven vuelve, y lo que vendieron se factura."
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Nueva remisión</button>} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat accent label="Mercancía afuera" value={money(open.reduce((a, r) => a + remissionPendingValue(r), 0))} sub={`${open.reduce((a, r) => a + remissionPending(r), 0)} unidades por liquidar`} icon={<FileOutput size={15} />} />
        <Stat label="Remisiones abiertas" value={open.length} sub={`${new Set(open.map((r) => r.recipient.name)).size} destinatarios`} />
        <Stat label="Vendido por remisión" value={money(rows.reduce((a, r) => a + remissionSoldValue(r), 0))} sub="ya facturado" />
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={filter} onChange={setFilter} options={[{ value: 'abierta', label: 'Abiertas' }, { value: 'todas', label: 'Todas' }]} />
        <SearchBox value={q} onChange={setQ} placeholder="N.º, destinatario, producto o IMEI" />
      </div>
      <div className="card">
        {list.length === 0 ? <Empty icon={<FileOutput size={34} />}>{rows.length ? 'No hay remisiones en esta vista.' : 'Aún no hay remisiones. Toque «Nueva remisión» para entregar mercancía en consignación.'}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Fecha</th><th>Destinatario</th><th>Detalle</th><th className="num">Pendiente</th><th className="num">Vendido</th><th>Estado</th></tr></thead>
              <tbody>
                {list.map((r) => {
                  const pend = remissionPending(r);
                  const total = r.items.reduce((a, i) => a + i.qty, 0);
                  return (
                    <tr key={r.id} className="click" onClick={() => setViewId(r.id)}>
                      <td className="mono strong">{rn(r.number)}</td>
                      <td className="nowrap">{dateOnly(r.createdAt)}{r.dueDate && <small>Liquidar: {dateOnly(`${r.dueDate}T12:00:00`)}</small>}</td>
                      <td><span className="strong">{r.recipient.name}</span>{r.recipient.phone && <small>{r.recipient.phone}</small>}</td>
                      <td>{total} unidad{total === 1 ? '' : 'es'} · {r.items.length} línea{r.items.length === 1 ? '' : 's'}<small>{pend} por liquidar</small></td>
                      <td className="num strong">{money(remissionPendingValue(r))}</td>
                      <td className="num">{money(remissionSoldValue(r))}</td>
                      <td>{r.status === 'liquidada' ? <Badge tone="ok">Liquidada</Badge> : <Badge tone="warn">Abierta</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewRemissionModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setViewId(id); }} />}
      {view && <RemissionModal r={view} s={settings} onClose={() => setViewId(null)} />}
    </>
  );
}

// ---------------- Nueva remisión ----------------
function NewRemissionModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const products = useCollection<Product>('products').rows;
  const [recipient, setRecipient] = useState({ name: '', document: '', phone: '', address: '' });
  const [lines, setLines] = useState<(RemissionLineDraft & { key: string; imei?: string })[]>([]);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState<Product | null>(null);
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const results = useMemo(() => (q.trim().length < 1 ? [] : products
    .filter((p) => p.active && tracksStock(p) && (p.stock || 0) > 0 && matches(q, p.name, p.sku, p.brand, p.model))
    .slice(0, 8)), [products, q]);
  const used = (pid: string) => lines.filter((l) => l.productId === pid).reduce((a, l) => a + l.qty, 0);
  const add = (p: Product) => {
    if (isPhone(p)) { setPicker(p); return; }
    setLines((xs) => (xs.some((x) => x.productId === p.id)
      ? xs.map((x) => (x.productId === p.id ? { ...x, qty: Math.min(p.stock, x.qty + 1) } : x))
      : [...xs, { key: p.id, productId: p.id, name: p.name, qty: 1, unitPrice: p.price }]));
    setQ('');
  };
  const addUnit = (u: PhoneUnit) => {
    const p = products.find((x) => x.id === u.productId);
    setLines((xs) => [...xs, { key: u.id, productId: u.productId, name: `${u.productName}${u.condition === 'USADO' ? ' (usado)' : ''}`, qty: 1, unitPrice: u.price || p?.price || 0, unitId: u.id, imei: u.imei }]);
    setQ('');
  };
  const set = (key: string, patch: Partial<RemissionLineDraft>) => setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const total = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const save = () => run(async () => {
    const r = await createRemission(actor, { recipient, items: lines, note, dueDate: dueDate || undefined });
    onSaved(r.id);
  }, 'Remisión creada · mercancía descontada del inventario');

  return (
    <Modal wide title="Nueva remisión (consignación)" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !recipient.name.trim() || lines.length === 0} onClick={save}><FileOutput size={16} />Remisionar {money(total)}</button></>}>
      <h4 className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>¿A quién se le entrega?</h4>
      <div className="form-grid">
        <Field label="Local o persona" required><input className="input" autoFocus value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} placeholder="Ej.: Celulares El Centro · Carlos" /></Field>
        <Field label="NIT / cédula"><input className="input" value={recipient.document} onChange={(e) => setRecipient({ ...recipient, document: e.target.value })} /></Field>
        <Field label="Celular"><input className="input" inputMode="tel" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} /></Field>
        <Field label="Dirección"><input className="input" value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} /></Field>
      </div>

      <h4 className="form-section">Mercancía</h4>
      <SearchBox value={q} onChange={setQ} placeholder="Buscar producto o celular con stock…" />
      {results.length > 0 && (
        <div className="card mt" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {results.map((p) => (
            <div key={p.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => add(p)}>
              <div className="grow min0">{p.name}<small className="faint" style={{ display: 'block' }}>{p.sku} · stock {p.stock - used(p.id)}{isPhone(p) ? ' · escoger IMEI' : ''}</small></div>
              <span className="mono">{money(p.price)}</span>
            </div>
          ))}
        </div>
      )}
      {lines.length === 0 ? <div className="faint" style={{ fontSize: 13, padding: '12px 0' }}>Busque y toque los productos que entrega.</div> : (
        <div className="table-wrap mt">
          <table className="table">
            <thead><tr><th>Producto</th><th className="num" style={{ width: 90 }}>Cant.</th><th className="num" style={{ width: 150 }}>Precio pactado</th><th className="num">Subtotal</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const p = products.find((x) => x.id === l.productId);
                return (
                  <tr key={l.key}>
                    <td>{l.name}{l.imei && <small className="mono">IMEI {l.imei}</small>}</td>
                    <td>{l.unitId ? <div className="num">1</div> : (
                      <input className="input num" type="number" min={1} max={p?.stock ?? 1} value={l.qty} onChange={(e) => set(l.key, { qty: Math.max(1, Math.min(p?.stock ?? 1, Math.floor(Number(e.target.value) || 1))) })} />
                    )}</td>
                    <td><MoneyInput value={l.unitPrice} onChange={(v) => set(l.key, { unitPrice: v })} /></td>
                    <td className="num">{money(l.qty * l.unitPrice)}</td>
                    <td><button className="btn sm ghost icon-only" aria-label="Quitar" onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
              <tr><td className="strong">Total</td><td className="num strong">{lines.reduce((a, l) => a + l.qty, 0)}</td><td /><td className="num strong">{money(total)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="form-grid mt">
        <Field label="Fecha para liquidar (opcional)"><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="Nota (opcional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {picker && <UnitPickerModal product={picker} exclude={lines.map((l) => l.unitId ?? '')} onPick={addUnit} onClose={() => setPicker(null)} />}
    </Modal>
  );
}

// ---------------- Detalle: devolver, facturar lo vendido e imprimir ----------------
function RemissionModal({ r, s, onClose }: { r: Remission; s: BusinessSettings; onClose: () => void }) {
  const { actor, can } = useAuth();
  const { run, busy } = useAction();
  const invoices = useCollection<Invoice>('invoices').rows;
  const [mode, setMode] = useState<'' | 'devolver' | 'vender'>('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const receipt = invoices.find((i) => i.id === receiptId);
  const methods = s.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const pick = Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, qty: n }));
  const saleTotal = pick.reduce((a, p) => a + p.qty * (r.items.find((i) => i.lineId === p.lineId)?.unitPrice ?? 0), 0);
  const start = (m: 'devolver' | 'vender') => { setMode(mode === m ? '' : m); setQty({}); setMethod(''); };
  const all = () => setQty(Object.fromEntries(r.items.filter((i) => pendingQty(i) > 0).map((i) => [i.lineId, pendingQty(i)])));

  const doReturn = () => run(() => returnRemission(actor, r.id, pick), 'Devolución registrada · volvió al inventario').then((ok) => ok && setMode(''));
  const doSell = () => run(async () => {
    const res = await createInvoice(actor, {
      customerId: r.customerId, customer: { name: r.recipient.name, phone: r.recipient.phone, document: r.recipient.document },
      items: invoiceItemsFromRemission(r, pick), discount: 0, taxRate: s.taxRate, cashierName: actor.name, remissionId: r.id,
      payments: [{ method, amount: saleTotal }],
    });
    setReceiptId(res.id);
    setMode('');
  }, 'Venta facturada');

  return (
    <Modal wide title={`Remisión ${rn(r.number)} · ${r.recipient.name}`} onClose={onClose}
      footer={<>
        {r.status === 'abierta' && can('billing') && <>
          <button className={`btn ${mode === 'devolver' ? 'dark' : ''}`} onClick={() => start('devolver')}><Undo2 size={16} />Registrar devolución</button>
          <button className={`btn ${mode === 'vender' ? 'dark' : ''}`} onClick={() => start('vender')}><ReceiptText size={16} />Facturar lo vendido</button>
        </>}
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => printDoc(r)}><Printer size={16} />Imprimir / PDF</button>
      </>}>
      {mode && (
        <div className="card card-pad stack no-print" style={{ marginBottom: 14, borderColor: 'var(--red-line)' }}>
          <div className="row between">
            <b>{mode === 'devolver' ? '¿Qué le devolvieron? Vuelve al inventario.' : '¿Qué vendió? Se factura al precio pactado y entra a la caja.'}</b>
            <button className="btn sm ghost" onClick={all}>Todo lo pendiente</button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Producto</th><th className="num">Pendiente</th><th className="num" style={{ width: 110 }}>{mode === 'devolver' ? 'Devuelve' : 'Vendió'}</th></tr></thead>
              <tbody>
                {r.items.filter((i) => pendingQty(i) > 0).map((i) => (
                  <tr key={i.lineId}>
                    <td>{i.name}{i.imei && <small className="mono">IMEI {i.imei}</small>}</td>
                    <td className="num">{pendingQty(i)}</td>
                    <td>{i.unitId
                      ? <label className="checkbox" style={{ justifyContent: 'flex-end' }}><input type="checkbox" checked={(qty[i.lineId] ?? 0) === 1} onChange={(e) => setQty({ ...qty, [i.lineId]: e.target.checked ? 1 : 0 })} /></label>
                      : <input className="input num" type="number" min={0} max={pendingQty(i)} value={qty[i.lineId] ?? 0} onChange={(e) => setQty({ ...qty, [i.lineId]: Math.max(0, Math.min(pendingQty(i), Math.floor(Number(e.target.value) || 0))) })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === 'vender' && (
            <>
              <div className="field">
                <span>Medio de pago <em>*</em></span>
                <div className={`pay-methods ${saleTotal > 0 && !method ? 'missing' : ''}`}>
                  {methods.map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m}</button>)}
                </div>
              </div>
              <button className="btn primary" disabled={busy || pick.length === 0 || !method} onClick={doSell}>Facturar {money(saleTotal)}</button>
            </>
          )}
          {mode === 'devolver' && <button className="btn primary" disabled={busy || pick.length === 0} onClick={doReturn}>Registrar devolución de {pick.reduce((a, p) => a + p.qty, 0)} unidad(es)</button>}
        </div>
      )}
      {(r.invoices?.length > 0 || r.returns?.length > 0) && (
        <div className="faint no-print" style={{ fontSize: 12, marginBottom: 10 }}>
          {r.invoices.map((i) => <div key={i.id}>Factura {pad(i.number, 6)} · {dateOnly(i.at)} · {money(i.total)}{invoices.find((x) => x.id === i.id)?.status === 'anulada' ? ' · ANULADA' : ''}</div>)}
          {r.returns.map((d, k) => <div key={k}>Devolución {dateOnly(d.at)} · {d.lines.reduce((a, l) => a + l.qty, 0)} unidad(es) · {d.by}</div>)}
        </div>
      )}
      <RemissionDoc r={r} s={s} />
      {receipt && <InvoiceModal inv={receipt} s={s} onClose={() => setReceiptId(null)} />}
    </Modal>
  );
}

function printDoc(r: Remission) {
  const prev = document.title;
  document.title = `Remision-${rn(r.number)}-${r.recipient.name.replace(/\s+/g, '-')}`;
  document.body.classList.add('print-letter');
  const done = () => { document.title = prev; document.body.classList.remove('print-letter'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  printNow();
}

/** Documento de remisión (carta / PDF). */
function RemissionDoc({ r, s }: { r: Remission; s: BusinessSettings }) {
  const total = r.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  return (
    <div className="contract">
      <header className="contract-head">
        <div>
          <b>{s.name.toUpperCase()}</b>
          <div>{[s.nit && `NIT ${s.nit}`, s.address, s.city, s.phone && `Tel. ${s.phone}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="contract-no">Remisión <b>{rn(r.number)}</b><div>{dateOnly(r.createdAt)}</div></div>
      </header>
      <h1>Remisión de mercancía en consignación</h1>
      <table className="contract-table">
        <tbody>
          <tr><th>Recibe</th><td>{r.recipient.name}</td><th>NIT / C.C.</th><td>{r.recipient.document || '—'}</td></tr>
          <tr><th>Celular</th><td>{r.recipient.phone || '—'}</td><th>Dirección</th><td>{r.recipient.address || '—'}</td></tr>
          {r.dueDate && <tr><th>Liquidar el</th><td colSpan={3}>{dateOnly(`${r.dueDate}T12:00:00`)}</td></tr>}
        </tbody>
      </table>
      <table className="contract-table">
        <thead><tr><th style={{ width: '38%' }}>Producto</th><th style={{ width: '8%' }}>Cant.</th><th style={{ width: '14%' }}>Precio</th><th style={{ width: '14%' }}>Subtotal</th><th style={{ width: '26%' }}>Estado</th></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.lineId}>
              <td>{i.name}{i.imei && <div className="mono" style={{ fontSize: 11 }}>IMEI {i.imei}</div>}</td>
              <td>{i.qty}</td>
              <td>{money(i.unitPrice)}</td>
              <td>{money(i.qty * i.unitPrice)}</td>
              <td style={{ fontSize: 11 }}>{[i.sold && `${i.sold} vendida(s)`, i.returned && `${i.returned} devuelta(s)`, pendingQty(i) && `${pendingQty(i)} pendiente(s)`].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
          <tr><th>Total</th><td>{r.items.reduce((a, i) => a + i.qty, 0)}</td><td /><td><b>{money(total)}</b></td><td /></tr>
        </tbody>
      </table>
      {r.note && <p><b>Nota:</b> {r.note}</p>}
      <p>
        El destinatario recibe la mercancía relacionada <b>en consignación</b>, en buen estado, y se compromete a pagar lo que venda al precio indicado y a
        devolver lo que no venda{r.dueDate ? ` a más tardar el ${dateOnly(`${r.dueDate}T12:00:00`)}` : ''}. La mercancía sigue siendo propiedad de {s.name} hasta que sea pagada.
      </p>
      <div className="contract-signs">
        <div className="sign" style={{ alignSelf: 'start' }}><div className="sign-line" /><b>ENTREGA</b><div>{s.name}</div></div>
        <div className="sign" style={{ alignSelf: 'start' }}><div className="sign-line" /><b>RECIBE</b><div>{r.recipient.name}</div><div>{r.recipient.document ? `NIT / C.C. ${r.recipient.document}` : 'C.C.'}</div></div>
      </div>
      <footer className="contract-foot">Remisión {rn(r.number)} · registrada por {r.createdByName}</footer>
    </div>
  );
}
