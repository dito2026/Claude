import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, Pencil, Plus, SlidersHorizontal, Smartphone } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { PhoneUnit, Product, ProductType, StockMovement } from '../lib/types';
import { dateTime, matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, useAction } from '../components/ui';
import { RegisterUnitsModal, UnitsTab } from '../components/PhoneUnits';
import { adjustStock, isLowStock, receiveStock, saveProduct, tracksStock, type ProductInput } from '../services/inventory';

const TYPES: ProductType[] = ['REPUESTO', 'ACCESORIO', 'EQUIPO', 'SERVICIO'];
const LINE_BY_TYPE: Record<ProductType, string> = {
  REPUESTO: 'Servicio técnico', ACCESORIO: 'Accesorios', EQUIPO: 'Equipos', SERVICIO: 'Servicio técnico',
};
const REASON: Record<StockMovement['reason'], string> = {
  compra: 'Compra / entrada', venta: 'Venta', reparacion: 'Usado en reparación', devolucion_reparacion: 'Devuelto de reparación',
  ajuste: 'Ajuste de conteo', anulacion: 'Anulación de venta', inicial: 'Stock inicial',
};

export const EMPTY_PRODUCT: ProductInput = {
  sku: '', type: 'REPUESTO', name: '', brand: '', model: '', color: '', cost: 0, price: 0, stock: 0,
  minStock: 1, warrantyMonths: 0, line: 'Servicio técnico', active: true, trackStock: true,
};

export function Inventory() {
  const { rows: products, loading } = useCollection<Product>('products');
  const movements = useCollection<StockMovement>('stockMovements').rows;
  const phoneUnits = useCollection<PhoneUnit>('phoneUnits').rows;
  const [registering, setRegistering] = useState<Product | null>(null);
  const availableUnits = (pid: string) => phoneUnits.filter((u) => u.productId === pid && u.status === 'disponible').length;
  const { can } = useAuth();
  const [tab, setTab] = useState<'productos' | 'celulares' | 'kardex'>('productos');
  const [q, setQ] = useState('');
  const [type, setType] = useState<ProductType | 'TODOS' | 'BAJO'>('TODOS');
  const [edit, setEdit] = useState<{ id?: string; data: ProductInput } | null>(null);
  const [stockOp, setStockOp] = useState<{ p: Product; kind: 'entrada' | 'ajuste' } | null>(null);
  const [kardexFor, setKardexFor] = useState('');

  const list = products
    .filter((p) => (type === 'TODOS' ? true : type === 'BAJO' ? isLowStock(p) : p.type === type))
    .filter((p) => matches(q, p.sku, p.name, p.brand, p.model))
    .sort((a, b) => a.name.localeCompare(b.name));

  const value = products.filter(tracksStock).reduce((a, p) => a + p.stock * p.cost, 0);
  const kardex = movements
    .filter((m) => !kardexFor || m.productId === kardexFor)
    .filter((m) => matches(q, m.productName, m.note, m.refNumber))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 300);

  return (
    <>
      <PageHead
        eyebrow="Inventario"
        title="Productos y repuestos"
        subtitle={`${products.length} referencias · valor a costo ${money(value)}`}
        actions={
          <>
            <SearchBox value={q} onChange={setQ} placeholder="SKU, nombre, marca o modelo" />
            {can('inventory.edit') && <button className="btn primary" onClick={() => setEdit({ data: { ...EMPTY_PRODUCT } })}><Plus size={16} />Nuevo producto</button>}
          </>
        }
      />
      <div className="tabs">
        <button className={tab === 'productos' ? 'active' : ''} onClick={() => setTab('productos')}>Productos</button>
        <button className={tab === 'celulares' ? 'active' : ''} onClick={() => setTab('celulares')}>Celulares (IMEI)</button>
        <button className={tab === 'kardex' ? 'active' : ''} onClick={() => setTab('kardex')}>Kardex (movimientos)</button>
      </div>

      {tab === 'productos' && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <Seg value={type} onChange={setType} options={[
              { value: 'TODOS', label: 'Todos' }, { value: 'REPUESTO', label: 'Repuestos' }, { value: 'ACCESORIO', label: 'Accesorios' },
              { value: 'EQUIPO', label: 'Equipos' }, { value: 'SERVICIO', label: 'Servicios' }, { value: 'BAJO', label: 'Stock bajo' },
            ]} />
          </div>
          <div className="card">
            {loading ? <Empty>Cargando…</Empty> : list.length === 0 ? <Empty>No hay productos.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>SKU</th><th>Producto</th><th>Tipo</th><th className="num">Stock</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Margen</th><th /></tr></thead>
                  <tbody>
                    {list.map((p) => {
                      const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : null;
                      return (
                        <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                          <td className="mono">{p.sku || '—'}</td>
                          <td><span className="strong">{p.name}</span><small>{[p.brand, p.model, p.color].filter(Boolean).join(' · ')}</small></td>
                          <td><Badge tone="" >{p.type}</Badge></td>
                          <td className="num">{p.type === 'SERVICIO' ? <span className="faint">—</span> : !tracksStock(p) ? <Badge tone="info">Sin inventario</Badge> : (
                            <><Badge tone={p.stock <= 0 ? 'red' : isLowStock(p) ? 'warn' : 'ok'}>{p.stock}</Badge>
                              {p.type === 'EQUIPO' && p.stock > availableUnits(p.id) && <small className="red">{p.stock - availableUnits(p.id)} sin IMEI</small>}</>
                          )}</td>
                          <td className="num">{money(p.cost)}</td>
                          <td className="num">{p.price ? money(p.price) : <span className="faint">según OT</span>}</td>
                          <td className="num">{margin === null ? '—' : `${margin}%`}</td>
                          <td className="right nowrap">
                            {p.type === 'EQUIPO' && can('inventory.receive') && (
                              <button className="btn sm" title="Ingresar celulares con IMEI" onClick={() => setRegistering(p)}><Smartphone size={15} />Ingresar</button>
                            )}
                            {tracksStock(p) && p.type !== 'EQUIPO' && can('inventory.receive') && (
                              <button className="btn sm ghost" title="Entrada (compra)" onClick={() => setStockOp({ p, kind: 'entrada' })}><ArrowDownToLine size={15} /></button>
                            )}
                            {tracksStock(p) && can('inventory.edit') && (
                              <button className="btn sm ghost" title="Ajuste por conteo" onClick={() => setStockOp({ p, kind: 'ajuste' })}><SlidersHorizontal size={15} /></button>
                            )}
                            {can('inventory.edit') && <button className="btn sm ghost" title="Editar" onClick={() => setEdit({ id: p.id, data: { ...EMPTY_PRODUCT, ...p } })}><Pencil size={15} /></button>}
                            <button className="btn sm ghost" onClick={() => { setKardexFor(p.id); setTab('kardex'); }}>Kardex</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'celulares' && <UnitsTab />}

      {tab === 'kardex' && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <select className="input" style={{ maxWidth: 360 }} value={kardexFor} onChange={(e) => setKardexFor(e.target.value)}>
              <option value="">Todos los productos</option>
              {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="card">
            {kardex.length === 0 ? <Empty>Sin movimientos.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Fecha</th><th>Producto</th><th>Motivo</th><th>Referencia</th><th className="num">Cantidad</th><th className="num">Stock después</th></tr></thead>
                  <tbody>
                    {kardex.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{dateTime(m.createdAt)}</td>
                        <td className="strong">{m.productName}</td>
                        <td>{REASON[m.reason]}{m.note && <small>{m.note}</small>}</td>
                        <td className="mono">
                          {m.refType === 'repairOrder' && m.refId ? <Link className="red" to={`/taller/${m.refId}`}>OT {pad(m.refNumber)}</Link>
                            : m.refType === 'invoice' ? `Factura ${pad(m.refNumber, 6)}`
                            : m.refType === 'purchase' ? <Link className="red" to="/compras">Compra C-{pad(m.refNumber, 4)}</Link> : '—'}
                        </td>
                        <td className={`num ${m.qty < 0 ? 'red' : ''}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                        <td className="num">{m.stockAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {edit && <ProductModal edit={edit} onClose={() => setEdit(null)} />}
      {stockOp && <StockModal {...stockOp} onClose={() => setStockOp(null)} />}
      {registering && <RegisterUnitsModal product={registering} unregistered={Math.max(0, registering.stock - availableUnits(registering.id))} onClose={() => setRegistering(null)} />}
    </>
  );
}

export function ProductModal({ edit, onClose, onSaved }: { edit: { id?: string; data: ProductInput }; onClose: () => void; onSaved?: (id: string) => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [d, setD] = useState(edit.data);
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setD({ ...d, [k]: v });
  return (
    <Modal title={edit.id ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { const id = await saveProduct(actor, d, edit.id); onSaved?.(String(id)); }, 'Producto guardado').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Tipo">
          <select className="input" value={d.type} onChange={(e) => { const t = e.target.value as ProductType; setD({ ...d, type: t, line: LINE_BY_TYPE[t] }); }}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="SKU / código"><input className="input mono" value={d.sku} onChange={(e) => set('sku', e.target.value)} placeholder="REP-0001" /></Field>
        <Field label="Nombre" required className="full"><input className="input" autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Marca"><input className="input" value={d.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label="Modelo compatible"><input className="input" value={d.model} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Costo unitario"><MoneyInput value={d.cost} onChange={(v) => set('cost', v)} /></Field>
        <Field label={d.type === 'REPUESTO' ? 'Precio de venta (opcional)' : 'Precio de venta'}><MoneyInput value={d.price} onChange={(v) => set('price', v)} /></Field>
        {d.type === 'EQUIPO' && (
          <div className="alert info full">Celulares: se controlan uno por uno con su IMEI. El stock sube al ingresarlos («Ingresar» en la lista o una compra) y baja al venderlos escogiendo el IMEI.</div>
        )}
        {d.type !== 'SERVICIO' && d.type !== 'EQUIPO' && (
          <label className="checkbox full">
            <input type="checkbox" checked={d.trackStock !== false} onChange={(e) => set('trackStock', e.target.checked)} />
            Controlar inventario (descontar stock al vender o usar en reparación)
          </label>
        )}
        {d.type !== 'SERVICIO' && d.trackStock === false && (
          <div className="alert info full">Sin inventario: se puede vender y usar en reparaciones sin límite de cantidad. No lleva stock ni alertas de reposición; las ventas y la utilidad sí quedan registradas.</div>
        )}
        {tracksStock(d) && (
          <>
            {!edit.id && d.type !== 'EQUIPO' && <Field label="Stock inicial"><input className="input num" type="number" min={0} value={d.stock} onChange={(e) => set('stock', Number(e.target.value))} /></Field>}
            <Field label="Stock mínimo (alerta)"><input className="input num" type="number" min={0} value={d.minStock} onChange={(e) => set('minStock', Number(e.target.value))} /></Field>
          </>
        )}
        <Field label="Garantía (meses)"><input className="input num" type="number" min={0} value={d.warrantyMonths} onChange={(e) => set('warrantyMonths', Number(e.target.value))} /></Field>
        <Field label="Color"><input className="input" value={d.color} onChange={(e) => set('color', e.target.value)} /></Field>
        <label className="checkbox full"><input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} />Activo (visible en ventas y órdenes)</label>
        {edit.id && <div className="faint full" style={{ fontSize: 12 }}>El stock se modifica con «Entrada» o «Ajuste» para que quede registrado en el kardex.</div>}
      </div>
    </Modal>
  );
}

function StockModal({ p, kind, onClose }: { p: Product; kind: 'entrada' | 'ajuste'; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [qty, setQty] = useState(kind === 'ajuste' ? p.stock : 1);
  const [cost, setCost] = useState(p.cost);
  const [note, setNote] = useState('');
  const go = () => run(
    () => (kind === 'entrada' ? receiveStock(actor, p.id, qty, cost, note) : adjustStock(actor, p.id, qty, note)),
    kind === 'entrada' ? 'Entrada registrada' : 'Ajuste registrado',
  ).then((ok) => ok && onClose());
  return (
    <Modal title={`${kind === 'entrada' ? 'Entrada de mercancía' : 'Ajuste por conteo'} · ${p.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={go}>Registrar</button></>}>
      <div className="form-grid">
        <Field label={kind === 'entrada' ? 'Cantidad que entra' : 'Stock contado (real)'}>
          <input className="input num" type="number" min={0} autoFocus value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        {kind === 'entrada' ? <Field label="Costo unitario"><MoneyInput value={cost} onChange={setCost} /></Field>
          : <Field label="Stock en sistema"><input className="input num" disabled value={p.stock} /></Field>}
        <Field label={kind === 'entrada' ? 'Proveedor / factura (nota)' : 'Motivo del ajuste'} required={kind === 'ajuste'} className="full">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
