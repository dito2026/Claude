import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { PhoneCondition, PhoneUnit, PhoneUnitInput, Product } from '../lib/types';
import { dateOnly, matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { registerUnits, voidUnitEntry, warrantyActive } from '../services/phones';
import { Badge, Empty, Field, Modal, MoneyInput, SearchBox, Seg, useAction } from './ui';
import { BrandModelFilter, brandModelsOf, type BrandModelValue } from './BrandModel';
import { brandFromText, matchesBrand, matchesModel } from '../lib/brands';

/** Texto con un IMEI por línea → unidades. Acepta «IMEI1 / IMEI2» o «IMEI1, IMEI2» para doble SIM. */
export function parseImeiLines(text: string, condition: PhoneCondition, color = ''): PhoneUnitInput[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [imei, imei2] = l.split(/[/,;|]/).map((x) => x.trim());
      return { imei, imei2: imei2 || '', condition, color };
    });
}

export function ImeiTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      className="input mono"
      rows={4}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={'Un celular por línea. Doble SIM: IMEI1 / IMEI2\n358497893736757\n359253622999425 / 359253622999433'}
    />
  );
}

/** Ingresar celulares con IMEI a un producto tipo EQUIPO (sin compra a proveedor). */
export function RegisterUnitsModal({ product, unregistered, onClose }: { product: Product; unregistered: number; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [condition, setCondition] = useState<PhoneCondition>('NUEVO');
  const [color, setColor] = useState(product.color || '');
  const [cost, setCost] = useState(product.cost);
  const [supplierName, setSupplierName] = useState('');
  const [already, setAlready] = useState(unregistered > 0);
  const units = parseImeiLines(text, condition, color);
  return (
    <Modal title={`Ingresar equipos · ${product.name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || units.length === 0}
          onClick={() => run(() => registerUnits(actor, product.id, units, { cost, supplierName, note: '', alreadyInStock: already, unregistered }),
            `${units.length} equipo(s) registrados`).then((ok) => ok && onClose())}>
          Registrar {units.length || ''} equipo{units.length === 1 ? '' : 's'}
        </button></>}>
      <div className="stack">
        {unregistered > 0 && (
          <label className="alert warn" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={already} onChange={(e) => setAlready(e.target.checked)} style={{ accentColor: 'var(--red)' }} />
            <span>Hay <b>{unregistered}</b> equipo(s) de este modelo en stock sin IMEI registrado. Marque esta casilla para solo registrar sus IMEI (no suma stock).</span>
          </label>
        )}
        <Field label="IMEI (uno por línea)" required><ImeiTextarea value={text} onChange={setText} /></Field>
        <div className="form-grid">
          <Field label="Condición">
            <Seg value={condition} onChange={setCondition} options={[{ value: 'NUEVO', label: 'Nuevo' }, { value: 'USADO', label: 'Usado' }]} />
          </Field>
          <Field label="Color"><input className="input" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
          <Field label="Costo por equipo"><MoneyInput value={cost} onChange={setCost} /></Field>
          <Field label="Proveedor (opcional)"><input className="input" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></Field>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          Para compras a un proveedor (contado o crédito) use mejor <b>Compras y proveedores → Nueva compra</b>: ahí también se escriben los IMEI y queda la cuenta por pagar.
        </div>
      </div>
    </Modal>
  );
}

/** Elegir el IMEI exacto que se vende. */
export function UnitPickerModal({ product, exclude, onPick, onClose }: {
  product: Product; exclude: string[]; onPick: (u: PhoneUnit) => void; onClose: () => void;
}) {
  const all = useCollection<PhoneUnit>('phoneUnits').rows;
  const [q, setQ] = useState('');
  const list = all
    .filter((u) => u.productId === product.id && u.status === 'disponible' && !exclude.includes(u.id))
    .filter((u) => matches(q, u.imei, u.imei2, u.color, u.condition))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return (
    <Modal title={`¿Qué ${product.name} vende?`} onClose={onClose}>
      <div className="stack">
        <SearchBox value={q} onChange={setQ} placeholder="Escriba o escanee el IMEI" />
        <div className="card" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {list.length === 0 ? <Empty icon={<Smartphone size={34} />}>No hay equipos disponibles de este modelo{q ? ' con ese IMEI' : ''}.</Empty> : list.map((u) => (
            <div key={u.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => { onPick(u); onClose(); }}>
              <div className="grow">
                <div className="mono strong">{u.imei}</div>
                <small className="faint">{[u.imei2 && `IMEI 2: ${u.imei2}`, u.color, u.supplierName && `Prov. ${u.supplierName}`, `Ingresó ${dateOnly(u.createdAt)}`].filter(Boolean).join(' · ')}</small>
              </div>
              <Badge tone={u.condition === 'NUEVO' ? 'ok' : 'warn'}>{u.condition}</Badge>
              <span className="mono" title={u.price ? 'Precio de venta de este equipo' : 'Costo'}>{money(u.price || u.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Pestaña de Inventario: todos los celulares por IMEI (historial y garantía). */
export function UnitsTab() {
  const { rows } = useCollection<PhoneUnit>('phoneUnits');
  const products = useCollection<Product>('products').rows;
  const [bm, setBm] = useState<BrandModelValue>({ brand: '', model: '' });
  const brandOf = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.brand || brandFromText(p.name)]));
    return (u: PhoneUnit) => m.get(u.productId) || brandFromText(u.productName);
  }, [products]);
  const brandOptions = useMemo(() => brandModelsOf(rows.map((u) => ({ brand: brandOf(u), model: u.productName }))), [rows, brandOf]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'disponible' | 'vendido' | 'todos'>('disponible');
  const list = useMemo(
    () => rows
      .filter((u) => status === 'todos' || u.status === status)
      .filter((u) => matchesBrand(bm.brand, brandOf(u)) && matchesModel(bm.model, u.productName))
      .filter((u) => matches(q, u.imei, u.imei2, u.productName, u.customerName, u.supplierName, u.invoiceNumber))
      .sort((a, b) => (b.soldAt ?? b.createdAt ?? '').localeCompare(a.soldAt ?? a.createdAt ?? '')),
    [rows, q, status, bm, brandOf],
  );
  const available = rows.filter((u) => u.status === 'disponible');
  const isAdmin = useAuth().can('settings');
  const [voiding, setVoiding] = useState<PhoneUnit | null>(null);
  const manual = available.filter((u) => !u.purchaseId && !u.usedPurchaseId).length;
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={status} onChange={setStatus} options={[
          { value: 'disponible', label: `Disponibles (${available.length})` },
          { value: 'vendido', label: 'Vendidos' },
          { value: 'todos', label: 'Todos' },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder="IMEI, modelo, cliente o factura" />
        <BrandModelFilter value={bm} onChange={setBm} brands={brandOptions} />
        <span className="faint">Valor disponible a costo: {money(available.reduce((a, u) => a + u.cost, 0))}</span>
      </div>
      {manual > 0 && (
        <div className="alert info" style={{ marginBottom: 14 }}><div>
          {manual} celular(es) disponibles entraron con «Ingresar» (sin compra): por eso no aparecen en Compras ni descontaron dinero de la caja.
          Lo que se compra a un proveedor va en <b>Compras → Nueva compra</b>, y lo que se le compra a un cliente, en <b>Compraventa usados</b>.
        </div></div>
      )}
      <div className="card">
        {list.length === 0 ? <Empty icon={<Smartphone size={36} />}>No hay celulares en esta vista. Ingréselos desde «Productos» (botón del celular) o con una compra.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>IMEI</th><th>Equipo</th><th>Condición</th><th>Ingreso</th><th className="num">Costo</th><th>Estado</th><th>Venta</th><th>Garantía</th><th /></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td><span className="mono strong">{u.imei}</span>{u.imei2 && <small className="mono">{u.imei2}</small>}</td>
                    <td>{u.productName}<small>{[u.color, u.supplierName && `Prov. ${u.supplierName}`].filter(Boolean).join(' · ')}{(u.color || u.supplierName) ? ' · ' : ''}{u.purchaseId
                      ? <Link className="red" to={`/compras?compra=${u.purchaseId}`} title="Abrir esta compra (para verla o anularla)">{origin(u)}</Link>
                      : u.usedPurchaseId ? <Link className="red" to="/usados">{origin(u)}</Link> : origin(u)}</small></td>
                    <td><Badge tone={u.condition === 'NUEVO' ? 'ok' : 'warn'}>{u.condition}</Badge></td>
                    <td className="nowrap">{dateOnly(u.createdAt)}</td>
                    <td className="num">{money(u.cost)}</td>
                    <td>{u.status === 'anulado' ? <Badge tone="red">Anulado</Badge> : <Badge tone={u.status === 'disponible' ? 'info' : ''}>{u.status === 'disponible' ? 'Disponible' : 'Vendido'}</Badge>}{u.status === 'anulado' && u.voidReason && <small>{u.voidReason}</small>}</td>
                    <td>{u.status === 'vendido' ? <>{u.customerName}<small>Fact. {pad(u.invoiceNumber, 6)} · {dateOnly(u.soldAt)} · {money(u.salePrice)}</small></> : <span className="faint">—</span>}</td>
                    <td>{u.status !== 'vendido' ? <span className="faint">{u.warrantyMonths} meses</span>
                      : u.warrantyUntil ? <Badge tone={warrantyActive(u) ? 'ok' : ''}>{warrantyActive(u) ? 'Vigente' : 'Vencida'} · {dateOnly(u.warrantyUntil)}</Badge>
                      : <span className="faint">Sin garantía</span>}</td>
                    <td className="nowrap">{isAdmin && u.status === 'disponible' && !u.purchaseId && !u.usedPurchaseId && (
                      <button className="btn sm danger" title="Entró con «Ingresar», sin compra: anule el ingreso para registrarlo bien" onClick={() => setVoiding(u)}>Anular ingreso</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {voiding && <VoidEntryModal u={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

const origin = (u: PhoneUnit) =>
  u.purchaseNumber ? `Compra C-${pad(u.purchaseNumber, 4)}` : u.usedPurchaseNumber ? `Contrato compraventa N.º ${pad(u.usedPurchaseNumber, 4)}` : 'Ingreso manual (sin compra)';

function VoidEntryModal({ u, onClose }: { u: PhoneUnit; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Anular ingreso · ${u.productName}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => run(() => voidUnitEntry(actor, u.imei, reason), 'Ingreso anulado · el IMEI quedó libre').then((ok) => ok && onClose())}>Anular ingreso</button></>}>
      <div className="stack">
        <div className="alert warn"><div>
          El equipo IMEI <b className="mono">{u.imei}</b> sale del inventario (1 unidad menos) y el IMEI queda libre.
          Así lo puede registrar bien: con <b>Compras → Nueva compra</b> si es de un proveedor, o con <b>Compraventa usados</b> si se lo compró a un cliente.
          No mueve dinero de la caja, porque este ingreso tampoco lo movió.
        </div></div>
        <Field label="Motivo" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ej.: lo registro como compraventa" /></Field>
      </div>
    </Modal>
  );
}
