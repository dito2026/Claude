import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Minus, PenLine, Plus, Trash2, Wrench, X } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { Customer, Invoice, InvoiceItem, InvoiceItemKind, Payment, PhoneUnit, Product, RepairOrder } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateTime, matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, useAction } from '../components/ui';
import { CustomerPicker } from '../components/CustomerPicker';
import { InvoiceModal } from '../components/Receipts';
import { computeTotals, createInvoice, itemsFromOrder, voidInvoice } from '../services/billing';
import { depositsTotal } from '../services/orders';
import { customerRef } from '../services/orders';
import { useSettings } from '../services/settings';
import { tracksStock } from '../services/inventory';
import { isPhone, normalizeImei } from '../services/phones';
import { UnitPickerModal } from '../components/PhoneUnits';
import { BuyFromSupplierFields, EMPTY_BUY, useSuppliers, type BuyFromSupplierValue } from '../components/BuyFromSupplier';
import { buyFreeItem } from '../services/purchases';
import type { CashState } from '../services/cash';

export function Billing() {
  const [tab, setTab] = useState<'pos' | 'historial'>('pos');
  return (
    <>
      <PageHead eyebrow="Facturación" title={tab === 'pos' ? 'Punto de venta' : 'Comprobantes emitidos'}
        actions={<Seg value={tab} onChange={setTab} options={[{ value: 'pos', label: 'Vender' }, { value: 'historial', label: 'Historial' }]} />} />
      {tab === 'pos' ? <Pos /> : <History />}
    </>
  );
}

function Pos() {
  const { actor, profile } = useAuth();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const orderId = params.get('ot') ?? undefined;
  const { doc: order } = useDocument<RepairOrder>('repairOrders', orderId);
  const products = useCollection<Product>('products').rows;
  const customers = useCollection<Customer>('customers').rows;
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const { run, busy } = useAction();

  const [q, setQ] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState(0);
  const [payments, setPayments] = useState<Payment[]>([{ method: 'Efectivo', amount: 0 }]);
  const [received, setReceived] = useState(0);
  const [done, setDone] = useState<Invoice | null>(null);
  const [freeItem, setFreeItem] = useState(false);

  // Cargar la OT a facturar
  useEffect(() => {
    if (!order) return;
    setItems(itemsFromOrder(order));
    const c = customers.find((x) => x.id === order.customerId);
    setCustomer(c ?? null);
  }, [order, customers]);

  const totals = computeTotals(items, discount, settings.taxRate);
  const deposits = order ? Math.min(depositsTotal(order), totals.total) : 0;
  const due = totals.total - deposits;
  const paid = payments.reduce((a, p) => a + p.amount, 0);

  // Un solo medio: el monto sigue al total automáticamente
  useEffect(() => {
    if (payments.length === 1) setPayments([{ ...payments[0], amount: due }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, payments.length]);

  const catalog = useMemo(
    () => products.filter((p) => p.active && matches(q, p.name, p.sku, p.brand, p.model))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40),
    [products, q],
  );

  const phoneUnits = useCollection<PhoneUnit>('phoneUnits').rows;
  const [picker, setPicker] = useState<Product | null>(null);
  const addUnit = (u: PhoneUnit) => {
    const p = products.find((x) => x.id === u.productId);
    setItems((xs) => xs.some((x) => x.unitId === u.id) ? xs : [...xs, {
      productId: u.productId, description: `${u.productName}${u.condition === 'USADO' ? ' (usado)' : ''}`, kind: 'producto',
      qty: 1, unitPrice: p?.price ?? 0, unitCost: u.cost, imei: u.imei, unitId: u.id,
    }]);
  };
  const imeiQuery = normalizeImei(q);
  const imeiHits = imeiQuery.length >= 5
    ? phoneUnits.filter((u) => u.status === 'disponible' && (u.imei.includes(imeiQuery) || (u.imei2 ?? '').includes(imeiQuery))
      && !items.some((x) => x.unitId === u.id)).slice(0, 6)
    : [];

  const add = (p: Product) => {
    if (isPhone(p)) return setPicker(p); // los celulares se venden escogiendo el IMEI
    setItems((xs) => {
      const i = xs.findIndex((x) => x.productId === p.id && !x.stockAlreadyMoved);
      if (i >= 0) return xs.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x));
      return [...xs, { productId: p.id, description: p.name, kind: p.type === 'SERVICIO' ? 'servicio' : 'producto', qty: 1, unitPrice: p.price, unitCost: p.cost }];
    });
  };
  const setQty = (i: number, qty: number) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, qty: Math.max(1, qty) } : x)));
  const setPrice = (i: number, unitPrice: number) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, unitPrice } : x)));
  const removeAt = (i: number) => setItems((xs) => xs.filter((_, k) => k !== i));
  const stockOf = (id?: string) => products.find((p) => p.id === id);

  const reset = () => {
    setItems([]); setCustomer(null); setDiscount(0); setPayments([{ method: 'Efectivo', amount: 0 }]); setReceived(0);
    if (orderId) setParams({});
  };

  const charge = () =>
    run(async () => {
      const r = await createInvoice(actor, {
        customerId: customer?.id,
        customer: customer ? customerRef(customer) : { name: 'Consumidor final', phone: '', document: '' },
        items,
        discount,
        taxRate: settings.taxRate,
        payments,
        repairOrderId: order?.id,
        cashierName: profile?.name ?? actor.name,
      });
      const inv: Invoice = {
        id: r.id, number: r.number, customerId: customer?.id, customer: customer ? customerRef(customer) : { name: 'Consumidor final', phone: '', document: '' },
        items, ...totals, depositsApplied: deposits, payments: payments.filter((p) => p.amount > 0), repairOrderId: order?.id,
        repairOrderNumber: order?.number, status: payments.some((p) => p.method === CREDIT_METHOD && p.amount > 0) ? 'credito' : 'pagada',
        cashSessionId: '', cashierName: profile?.name ?? '', createdAt: new Date().toISOString(),
      };
      setDone(inv);
      reset();
    }, 'Venta registrada');

  const cashPart = payments.find((p) => p.method === 'Efectivo')?.amount ?? 0;
  const change = received > cashPart && cashPart > 0 ? received - cashPart : 0;

  if (!cash?.openSessionId) {
    return (
      <div className="card card-pad">
        <div className="alert warn">La caja está cerrada. Para facturar abra la caja primero.</div>
        <Link to="/caja" className="btn primary mt">Ir a Caja</Link>
      </div>
    );
  }

  return (
    <div className="pos">
      <div className="stack">
        {order ? (
          <div className="card card-pad row">
            <Wrench size={18} className="red" />
            <div className="grow">
              <b>Facturando OT {pad(order.number)}</b> · {order.device.brand} {order.device.model}
              <div className="faint">Los repuestos ya fueron descontados del inventario al usarlos en la reparación.</div>
            </div>
            <button className="btn sm ghost" onClick={reset}><X size={15} />Quitar</button>
          </div>
        ) : null}
        <div className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
          <div className="grow"><SearchBox value={q} onChange={setQ} placeholder="Buscar producto o servicio por nombre o SKU…" /></div>
          <button className="btn" onClick={() => setFreeItem(true)} title="Vender algo que no está en el inventario"><PenLine size={16} />Artículo libre</button>
        </div>
        <div className="product-grid">
          {catalog.map((p) => {
            const out = tracksStock(p) && p.stock <= 0;
            return (
              <button key={p.id} className="product-tile" disabled={out || (!p.price && !isPhone(p))} onClick={() => add(p)}>
                <small className="faint mono">{p.sku} · {p.type}</small>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span className="faint" style={{ fontSize: 12 }}>{p.type === 'SERVICIO' ? 'Servicio' : tracksStock(p) ? `Stock ${p.stock}` : 'Sin inventario'}</span>
                <span className="price">{p.price ? money(p.price) : 'Sin precio'}</span>
              </button>
            );
          })}
        </div>
        {imeiHits.length > 0 && (
          <div className="product-grid">
            {imeiHits.map((u) => (
              <button key={u.id} className="product-tile" style={{ borderColor: 'var(--red)' }} onClick={() => { addUnit(u); setQ(''); }}>
                <small className="red mono">IMEI {u.imei}</small>
                <span style={{ fontWeight: 500 }}>{u.productName}</span>
                <span className="faint" style={{ fontSize: 12 }}>{u.condition}{u.color ? ` · ${u.color}` : ''}</span>
              </button>
            ))}
          </div>
        )}
        {catalog.length === 0 && imeiHits.length === 0 && <Empty>No hay productos que coincidan.</Empty>}
      </div>

      <div className="card" style={{ position: 'sticky', top: 76 }}>
        <div className="card-head"><h3>Venta actual</h3>{items.length > 0 && <button className="btn sm ghost" onClick={reset}>Limpiar</button>}</div>
        <div className="card-pad stack">
          <Field label="Cliente (opcional)"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
          {items.length === 0 ? <Empty>Agregue productos desde el catálogo.</Empty> : (
            <div>
              {items.map((it, i) => {
                const p = stockOf(it.productId);
                const over = !it.stockAlreadyMoved && p && tracksStock(p) && it.qty > p.stock;
                return (
                  <div key={i} className="list-row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
                    <div className="grow">
                      <div style={{ fontWeight: 500 }}>{it.description}</div>
                      {it.imei && <small className="mono red" style={{ display: 'block' }}>IMEI {it.imei}</small>}
                      <small className="faint">{it.kind === 'repuesto' ? 'Repuesto de la OT' : it.kind === 'mano_obra' ? 'Mano de obra' : money(it.unitPrice) + ' c/u'}</small>
                      {over && <div className="red" style={{ fontSize: 12 }}>Solo hay {p!.stock} en stock</div>}
                    </div>
                    {it.stockAlreadyMoved || it.kind === 'mano_obra' || it.unitId ? (
                      <span className="mono">{it.qty}</span>
                    ) : (
                      <div className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn sm ghost" onClick={() => setQty(i, it.qty - 1)}><Minus size={13} /></button>
                        <span className="mono">{it.qty}</span>
                        <button className="btn sm ghost" onClick={() => setQty(i, it.qty + 1)}><Plus size={13} /></button>
                      </div>
                    )}
                    <div style={{ width: 110 }}><MoneyInput value={it.unitPrice} onChange={(v) => setPrice(i, v)} /></div>
                    {(!order || (!it.stockAlreadyMoved && it.kind !== 'mano_obra')) && <button className="btn sm ghost" onClick={() => removeAt(i)}><Trash2 size={14} /></button>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="totals">
            <div><span className="muted">Subtotal</span><span>{money(totals.subtotal)}</span></div>
            <div className="row between"><span className="muted">Descuento</span><div style={{ width: 130 }}><MoneyInput value={discount} onChange={setDiscount} /></div></div>
            {totals.tax > 0 && <div><span className="muted">IVA {settings.taxRate}%</span><span>{money(totals.tax)}</span></div>}
            <div className="grand"><span>Total</span><span>{money(totals.total)}</span></div>
            {deposits > 0 && <div><span className="muted">Abonos de la OT</span><span>-{money(deposits)}</span></div>}
            {deposits > 0 && <div style={{ fontWeight: 600 }}><span>A pagar</span><span>{money(due)}</span></div>}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="row between"><b style={{ fontSize: 13 }}>Pagos</b>
              <button className="btn sm ghost" onClick={() => setPayments([...payments, { method: 'Transferencia', amount: Math.max(0, due - paid) }])}><Plus size={13} />Otro medio</button>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
                <select className="input" value={p.method} onChange={(e) => setPayments(payments.map((x, k) => (k === i ? { ...x, method: e.target.value } : x)))}>
                  {settings.paymentMethods.map((m) => <option key={m}>{m}</option>)}
                </select>
                <div style={{ width: 150, flexShrink: 0 }}>
                  <MoneyInput value={p.amount} onChange={(v) => setPayments(payments.map((x, k) => (k === i ? { ...x, amount: v } : x)))} />
                </div>
                {payments.length > 1 && <button className="btn sm ghost" onClick={() => setPayments(payments.filter((_, k) => k !== i))}><X size={14} /></button>}
              </div>
            ))}
            {paid !== due && <div className="alert error">Los pagos suman {money(paid)}; faltan {money(due - paid)}.</div>}
            {cashPart > 0 && (
              <div className="row between">
                <span className="muted">Efectivo recibido</span>
                <div style={{ width: 150 }}><MoneyInput value={received} onChange={setReceived} /></div>
              </div>
            )}
            {change > 0 && <div className="row between"><b>Cambio</b><b className="red">{money(change)}</b></div>}
          </div>

          <button className="btn primary block" style={{ height: 46, fontSize: 15 }} disabled={busy || items.length === 0 || paid !== due} onClick={charge}>
            Cobrar {money(due)}
          </button>
        </div>
      </div>

      {done && <InvoiceModal inv={done} s={settings} onClose={() => setDone(null)} />}
 {picker && <UnitPickerModal product={picker} exclude={items.map((x) => x.unitId ?? '')} onPick={addUnit} onClose={() => setPicker(null)} />}
      {freeItem && <FreeItemModal onClose={() => setFreeItem(false)} onAdd={(it) => setItems((xs) => [...xs, it])} />}
    </div>
  );
}

function History() {
  const { rows } = useCollection<Invoice>('invoices');
  const settings = useSettings();
  const { can, actor } = useAuth();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [view, setView] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [reason, setReason] = useState('');

  const list = rows
    .filter((i) => matches(q, i.number, i.customer.name, i.customer.document, i.repairOrderNumber))
    .sort((a, b) => b.number - a.number);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><SearchBox value={q} onChange={setQ} placeholder="N.º, cliente u OT" /></div>
      <div className="card">
        {list.length === 0 ? <Empty>Sin comprobantes.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Origen</th><th>Medios</th><th>Estado</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setView(i)}>
                    <td className="mono strong">{pad(i.number, 6)}</td>
                    <td className="nowrap">{dateTime(i.createdAt)}</td>
                    <td>{i.customer.name || 'Consumidor final'}</td>
                    <td>{i.repairOrderNumber ? <span className="mono">OT {pad(i.repairOrderNumber)}</span> : 'Venta directa'}</td>
                    <td>{i.payments.map((p) => p.method).join(', ') || (i.depositsApplied ? 'Abonos' : '—')}</td>
                    <td><Badge tone={i.status === 'anulada' ? 'red' : i.status === 'credito' ? 'warn' : 'ok'}>{i.status}</Badge></td>
                    <td className="num">{money(i.total)}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>
                      {can('billing.void') && i.status !== 'anulada' && (
                        <button className="btn sm ghost" title="Anular" onClick={() => { setVoiding(i); setReason(''); }}><Ban size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {view && <InvoiceModal inv={view} s={settings} onClose={() => setView(null)} />}
      {voiding && (
        <Modal title={`Anular comprobante N.º ${pad(voiding.number, 6)}`} onClose={() => setVoiding(null)}
          footer={<><button className="btn ghost" onClick={() => setVoiding(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => run(() => voidInvoice(actor, voiding.id, reason), 'Comprobante anulado').then((ok) => ok && setVoiding(null))}>Anular</button></>}>
          <div className="stack">
            <div className="alert warn">Se devolverá el stock de los productos vendidos y se registrará un egreso en la caja abierta por {money(voiding.payments.filter((p) => p.method !== CREDIT_METHOD).reduce((a, p) => a + p.amount, 0))}. Si viene de una OT, la orden vuelve a «Reparado / Listo».</div>
            <Field label="Motivo" required><textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

const FREE_KINDS: { value: InvoiceItemKind; label: string }[] = [
  { value: 'producto', label: 'Accesorio / producto' },
  { value: 'repuesto', label: 'Repuesto' },
  { value: 'servicio', label: 'Servicio' },
];

/** Línea de venta que no está en el catálogo: no toca inventario. */
function FreeItemModal({ onClose, onAdd }: { onClose: () => void; onAdd: (it: InvoiceItem) => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const suppliers = useSuppliers();
  const [buy, setBuy] = useState<BuyFromSupplierValue>(EMPTY_BUY);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<InvoiceItemKind>('producto');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const ok = description.trim() && qty > 0 && price > 0;
  return (
    <Modal title="Artículo libre (sin inventario)" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!ok || busy} onClick={() => run(async () => {
          if (buy.enabled) {
            const sp = suppliers.find((x) => x.id === buy.supplierId);
            if (!sp) throw new Error('Seleccione el proveedor al que le compró el artículo.');
            await buyFreeItem(actor, sp, { name: description, qty, unitCost: cost }, { paymentType: buy.paymentType, method: buy.method, note: 'Artículo libre vendido en el POS' });
          }
          onAdd({ description: description.trim(), kind, qty, unitPrice: price, unitCost: cost });
        }, buy.enabled ? (buy.paymentType === 'credito' ? 'Agregado · deuda registrada al proveedor' : 'Agregado · compra registrada') : undefined).then((ok2) => ok2 && onClose())}>Agregar a la venta</button></>}>
      <div className="form-grid">
        <Field label="Descripción" required className="full"><input className="input" autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: Forro iPhone 13 transparente" /></Field>
        <Field label="Tipo">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as InvoiceItemKind)}>
            {FREE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Cantidad"><input className="input num" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></Field>
        <Field label="Precio de venta (unitario)" required><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Costo (unitario, para la utilidad)"><MoneyInput value={cost} onChange={setCost} /></Field>
      </div>
      <div className="mt"><BuyFromSupplierFields value={buy} onChange={setBuy} /></div>
      <div className="faint mt" style={{ fontSize: 12 }}>No descuenta inventario. La venta, el costo y la utilidad sí quedan registrados en la factura y en la caja.</div>
    </Modal>
  );
}
