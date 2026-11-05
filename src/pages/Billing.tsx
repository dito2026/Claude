import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Minus, PenLine, Plus, Trash2, Wrench, X } from 'lucide-react';
import { useCollection, useDocument } from '../data/hooks';
import type { Customer, Invoice, InvoiceItem, InvoiceItemKind, Payment, PhoneUnit, Product, RepairOrder, Seller } from '../lib/types';
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
import { categoryOf, itemCategory, sortCategories } from '../lib/categories';
import { isPhone, normalizeImei } from '../services/phones';
import { UnitPickerModal } from '../components/PhoneUnits';
import { BrandModelFilter, brandModelsOf, type BrandModelValue } from '../components/BrandModel';
import { brandFromText, matchesBrand, matchesModel } from '../lib/brands';

import { BuyFromSupplierFields, EMPTY_BUY, useSuppliers, type BuyFromSupplierValue } from '../components/BuyFromSupplier';
import { buyFreeItem } from '../services/purchases';
import { BASE_LABEL, computeCommission } from '../services/sellers';
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
  const sellers = useCollection<Seller>('sellers').rows.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const [sellerId, setSellerId] = useState<string>('');
  // Por defecto, el vendedor vinculado al usuario que está facturando
  useEffect(() => {
    if (!sellerId && profile?.sellerId && sellers.some((s) => s.id === profile.sellerId)) setSellerId(profile.sellerId);
  }, [profile?.sellerId, sellers.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const seller = sellers.find((s) => s.id === sellerId);
  const [payments, setPayments] = useState<Payment[]>([{ method: '', amount: 0 }]);
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

  const [bm, setBm] = useState<BrandModelValue>({ brand: '', model: '' });
  const [cat, setCat] = useState('');
  const pBrand = (p: Product) => p.brand || brandFromText(p.name);
  const pModel = (p: Product) => (p.type === 'EQUIPO' ? p.name : p.model);
  const brandOptions = useMemo(() => brandModelsOf(products.filter((p) => p.active).map((p) => ({ brand: pBrand(p), model: pModel(p) }))), [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useMemo(
    () => products.filter((p) => p.active && matchesBrand(bm.brand, pBrand(p)) && matchesModel(bm.model, pModel(p)) && matches(q, p.name, p.sku, p.brand, p.model, categoryOf(p)))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 400),
    [products, q, bm],
  );
  // Categorías con conteo (según búsqueda y marca), y catálogo agrupado
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of catalog) m.set(categoryOf(p), (m.get(categoryOf(p)) ?? 0) + 1);
    return m;
  }, [catalog]);
  const categories = sortCategories(catCounts.keys());
  const shown = cat ? catalog.filter((p) => categoryOf(p) === cat) : catalog;
  const groups = useMemo(
    () => sortCategories(shown.map(categoryOf)).map((c) => ({ cat: c, items: shown.filter((p) => categoryOf(p) === c) })),
    [shown],
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

  /** Enter en el buscador (o lector de código de barras): agrega directo si hay un solo resultado claro. */
  const quickAdd = () => {
    const code = q.trim();
    if (!code) return;
    const n = normalizeImei(code);
    const unit = phoneUnits.find((u) => u.status === 'disponible' && (u.imei === n || u.imei2 === n));
    if (unit) { addUnit(unit); setQ(''); return; }
    const bySku = products.find((p) => p.active && p.sku && p.sku.toUpperCase() === code.toUpperCase());
    const only = catalog.length === 1 ? catalog[0] : undefined;
    const p = bySku ?? only;
    if (p) {
      const out = tracksStock(p) && p.stock <= 0;
      if (!out && (p.price || isPhone(p))) { add(p); setQ(''); }
    }
  };

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
    setItems([]); setCustomer(null); setDiscount(0); setPayments([{ method: '', amount: 0 }]); setReceived(0);
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
        payments: payments.filter((p) => p.amount > 0),
        repairOrderId: order?.id,
        cashierName: profile?.name ?? actor.name,
        sellerId: seller?.id,
      });
      const inv: Invoice = {
        id: r.id, number: r.number, customerId: customer?.id, customer: customer ? customerRef(customer) : { name: 'Consumidor final', phone: '', document: '' },
        items, ...totals, depositsApplied: deposits, payments: payments.filter((p) => p.amount > 0), repairOrderId: order?.id,
        repairOrderNumber: order?.number, status: payments.some((p) => p.method === CREDIT_METHOD && p.amount > 0) ? 'credito' : 'pagada',
        cashSessionId: '', cashierName: profile?.name ?? '', createdAt: new Date().toISOString(),
        sellerName: seller?.name,
      };
      setDone(inv);
      reset();
    }, 'Venta registrada');

  const missingMethod = payments.some((p) => p.amount > 0 && !p.method);
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
          <div className="grow"><SearchBox value={q} onChange={setQ} onEnter={quickAdd} autoFocus placeholder="Buscar, escanear código o IMEI y Enter…" /></div>
          <button className="btn" onClick={() => setFreeItem(true)} title="Vender algo que no está en el inventario"><PenLine size={16} />Artículo libre</button>
        </div>
        <BrandModelFilter value={bm} onChange={setBm} brands={brandOptions} />
        <div className="cat-bar">
          <button type="button" className={`cat-chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>Todas <span>{catalog.length}</span></button>
          {categories.map((c) => (
            <button type="button" key={c} className={`cat-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
              {c} <span>{catCounts.get(c)}</span>
            </button>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.cat}>
            {!cat && <div className="cat-title">{g.cat} <span className="faint">· {g.items.length}</span></div>}
            <div className="product-grid">
              {g.items.map((p) => {
                const out = tracksStock(p) && p.stock <= 0;
                return (
                  <button key={p.id} className="product-tile" disabled={out || (!p.price && !isPhone(p))} onClick={() => add(p)}>
                    <small className="faint mono">{p.sku || p.type}</small>
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                    <span className="faint" style={{ fontSize: 12 }}>{p.type === 'SERVICIO' ? 'Servicio' : tracksStock(p) ? `Stock ${p.stock}` : 'Sin inventario'}</span>
                    <span className="price">{p.price ? money(p.price) : isPhone(p) ? 'Elegir IMEI' : 'Sin precio'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
          {sellers.length > 0 && (
            <Field label="Vendedor (comisión)">
              <select className="input" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                <option value="">Sin vendedor</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.commissionPct}% {BASE_LABEL[s.commissionBase]}</option>)}
              </select>
              {seller && items.length > 0 && (
                <small className="muted">Comisión estimada: <b>{money(computeCommission(seller, items, discount, new Map(products.map((p) => [p.id, p]))))}</b></small>
              )}
            </Field>
          )}
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
            <div className="row between"><b style={{ fontSize: 13 }}>Medio de pago <span className="red">*</span></b>
              <button className="btn sm ghost" onClick={() => setPayments([...payments, { method: '', amount: Math.max(0, due - paid) }])}><Plus size={13} />Otro medio</button>
            </div>
            {payments.length === 1 && due > 0 && (
              <div className={`pay-methods ${missingMethod ? 'missing' : ''}`} role="radiogroup" aria-label="Medio de pago">
                {settings.paymentMethods.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={payments[0].method === m}
                    className={`cat-chip ${payments[0].method === m ? 'active' : ''}`}
                    onClick={() => setPayments([{ ...payments[0], method: m }])}>{m}</button>
                ))}
              </div>
            )}
            {!(payments.length === 1 && due > 0) && payments.map((p, i) => (
              <div key={i} className="row gap-sm" style={{ flexWrap: 'nowrap' }}>
                <select className={`input ${p.amount > 0 && !p.method ? 'invalid' : ''}`} value={p.method} onChange={(e) => setPayments(payments.map((x, k) => (k === i ? { ...x, method: e.target.value } : x)))}>
                  <option value="" disabled>Elija el medio de pago…</option>
                  {settings.paymentMethods.map((m) => <option key={m}>{m}</option>)}
                </select>
                <div style={{ width: 150, flexShrink: 0 }}>
                  <MoneyInput value={p.amount} onChange={(v) => setPayments(payments.map((x, k) => (k === i ? { ...x, amount: v } : x)))} />
                </div>
                {payments.length > 1 && <button className="btn sm ghost" onClick={() => setPayments(payments.filter((_, k) => k !== i))}><X size={14} /></button>}
              </div>
            ))}
            {missingMethod && <div className="alert warn">Elija el medio de pago: ¿efectivo, transferencia, Nequi…?</div>}
            {paid !== due && <div className="alert error">Los pagos suman {money(paid)}; faltan {money(due - paid)}.</div>}
            {cashPart > 0 && (
              <div className="row between">
                <span className="muted">Efectivo recibido</span>
                <div style={{ width: 150 }}><MoneyInput value={received} onChange={setReceived} /></div>
              </div>
            )}
            {change > 0 && <div className="row between"><b>Cambio</b><b className="red">{money(change)}</b></div>}
          </div>

          <button className="btn primary block" style={{ height: 46, fontSize: 15 }} disabled={busy || items.length === 0 || paid !== due || missingMethod} onClick={charge}>
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
  const [cat, setCat] = useState('');
  const products = useCollection<Product>('products').rows;
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Valor de cada categoría dentro de cada comprobante
  const byCat = useMemo(() => new Map(rows.map((inv) => {
    const m = new Map<string, number>();
    for (const it of inv.items) {
      const c = itemCategory(it, productMap);
      m.set(c, (m.get(c) ?? 0) + it.qty * it.unitPrice);
    }
    return [inv.id, m];
  })), [rows, productMap]);
  const allCats = useMemo(() => sortCategories([...byCat.values()].flatMap((m) => [...m.keys()])), [byCat]);

  const list = rows
    .filter((i) => !cat || byCat.get(i.id)?.has(cat))
    .filter((i) => matches(q, i.number, i.customer.name, i.customer.document, i.repairOrderNumber, ...i.items.map((it) => it.description), ...[...(byCat.get(i.id)?.keys() ?? [])]))
    .sort((a, b) => b.number - a.number);
  const valid = list.filter((i) => i.status !== 'anulada');
  const catTotal = cat ? valid.reduce((a, i) => a + (byCat.get(i.id)?.get(cat) ?? 0), 0) : valid.reduce((a, i) => a + i.total, 0);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="N.º, cliente, OT o producto" />
        <select className="input" style={{ width: 220 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted">{valid.length} comprobantes · {cat ? `vendido en ${cat}` : 'total'}: <b>{money(catTotal)}</b></span>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>Sin comprobantes.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Origen</th><th>Categorías</th><th>Medios</th><th>Vendedor</th><th>Estado</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="click" onClick={() => setView(i)}>
                    <td className="mono strong">{pad(i.number, 6)}</td>
                    <td className="nowrap">{dateTime(i.createdAt)}</td>
                    <td>{i.customer.name || 'Consumidor final'}</td>
                    <td>{i.repairOrderNumber ? <span className="mono">OT {pad(i.repairOrderNumber)}</span> : 'Venta directa'}</td>
                    <td>
                      <div className="row gap-sm" style={{ gap: 4 }}>
                        {sortCategories(byCat.get(i.id)?.keys() ?? []).map((c) => (
                          <span key={c} className={`badge plain ${c === cat ? 'dark' : ''}`} title={money(byCat.get(i.id)!.get(c))}>{c}</span>
                        ))}
                      </div>
                    </td>
                    <td>{i.payments.map((p) => p.method).join(', ') || (i.depositsApplied ? 'Abonos' : '—')}</td>
                    <td>{i.sellerName ? <>{i.sellerName}<small>Comisión {money(i.commission)}</small></> : <span className="faint">—</span>}</td>
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
