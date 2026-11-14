import { useMemo, useState } from 'react';
import { Download, Pencil, Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, CommissionBase, Invoice, Seller } from '../lib/types';
import { dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, Seg, Stat, useAction } from '../components/ui';
import { LINES, downloadCsv, periodRange, type PeriodKind } from '../services/accounting';
import { BASE_LABEL, saveSeller, sellerBalance, sellerSalesDetail, type SellerInput } from '../services/sellers';

const EMPTY: SellerInput = { name: '', phone: '', active: true, commissionPct: 2, commissionBase: 'venta', lines: [] };

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export function Sellers() {
  const { rows } = useCollection<Seller>('sellers');
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const [edit, setEdit] = useState<{ id?: string; data: SellerInput } | null>(null);
  const [detail, setDetail] = useState<Seller | null>(null);
  const from = useMemo(monthStart, []);

  const list = [...rows]
    .map((s) => ({ s, b: sellerBalance(s, invoices, movements, from) }))
    .sort((a, b) => Number(b.s.active) - Number(a.s.active) || b.b.sales - a.b.sales);
  const totalOwed = list.reduce((a, x) => a + x.b.owed, 0);
  const monthCommission = list.reduce((a, x) => a + x.b.periodCommission, 0);
  const monthSales = list.reduce((a, x) => a + x.b.sales, 0);

  return (
    <>
      <PageHead eyebrow="Administración" title="Vendedores y comisiones"
        subtitle="Cada venta se asigna a un vendedor; su comisión se calcula sola al facturar."
        actions={<button className="btn primary" onClick={() => setEdit({ data: { ...EMPTY } })}><Plus size={16} />Nuevo vendedor</button>} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat accent label="Comisiones por pagar" value={money(totalOwed)} sub="Se pagan en Caja → Pago a vendedor" />
        <Stat label="Comisiones del mes" value={money(monthCommission)} />
        <Stat label="Ventas del mes con vendedor" value={money(monthSales)} />
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>No hay vendedores. Cree el primero con «Nuevo vendedor».</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vendedor</th><th>Comisión</th><th>Aplica a</th><th>Usuario</th><th className="num">Ventas del mes</th><th className="num">Comisión del mes</th><th className="num">Ganado total</th><th className="num">Pagado</th><th className="num">Por pagarle</th><th /></tr></thead>
              <tbody>
                {list.map(({ s, b }) => (
                  <tr key={s.id} className="click" style={{ opacity: s.active ? 1 : 0.5 }} onClick={() => setDetail(s)}>
                    <td><span className="strong">{s.name}</span><small>{s.phone}{!s.active && ' · Inactivo'}</small></td>
                    <td><b>{s.commissionPct}%</b><small>{BASE_LABEL[s.commissionBase]}</small></td>
                    <td>{s.lines?.length ? s.lines.join(', ') : 'Todas las ventas'}</td>
                    <td>{s.userId ? <Badge tone="info">Con acceso</Badge> : <span className="faint">—</span>}</td>
                    <td className="num">{money(b.sales)}<small>{b.count} ventas</small></td>
                    <td className="num">{money(b.periodCommission)}</td>
                    <td className="num">{money(b.earned)}</td>
                    <td className="num">{money(b.paid)}</td>
                    <td className={`num strong ${b.owed > 0 ? 'red' : ''}`}>{money(b.owed)}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>
                      <button className="btn sm ghost" title="Editar" onClick={() => setEdit({ id: s.id, data: { ...EMPTY, ...s } })}><Pencil size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        Si anula una factura, su comisión desaparece. Cambiar el porcentaje no modifica las ventas ya hechas.
        Para que un vendedor entre a la app, cree su usuario (rol Cajero) en «Usuarios y roles» y vincúlelo: sus ventas le quedan asignadas solas.
      </p>
      {edit && <SellerModal edit={edit} onClose={() => setEdit(null)} />}
      {detail && <SellerDetail seller={detail} invoices={invoices} onClose={() => setDetail(null)} />}
    </>
  );
}

function SellerModal({ edit, onClose }: { edit: { id?: string; data: SellerInput }; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const [d, setD] = useState(edit.data);
  const lines = d.lines ?? [];
  const toggleLine = (l: string) => setD({ ...d, lines: lines.includes(l) ? lines.filter((x) => x !== l) : [...lines, l] });
  return (
    <Modal title={edit.id ? 'Editar vendedor' : 'Nuevo vendedor'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => run(() => saveSeller(actor, d, edit.id), 'Vendedor guardado').then((ok) => ok && onClose())}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Nombre" required className="full"><input className="input" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Celular"><input className="input" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label="Comisión (%)"><input className="input num" type="number" min={0} max={100} step={0.5} value={d.commissionPct} onChange={(e) => setD({ ...d, commissionPct: Number(e.target.value) })} /></Field>
        <Field label="Se calcula" className="full">
          <Seg<CommissionBase> value={d.commissionBase} onChange={(v) => setD({ ...d, commissionBase: v })}
            options={[{ value: 'venta', label: 'Sobre la venta' }, { value: 'utilidad', label: 'Sobre la ganancia' }]} />
        </Field>
        <Field label="Gana comisión en" className="full">
          <div className="row gap-sm">
            {LINES.map((l) => (
              <label key={l} className="checkbox"><input type="checkbox" checked={lines.includes(l)} onChange={() => toggleLine(l)} />{l}</label>
            ))}
          </div>
          <small className="faint">{lines.length === 0 ? 'Sin marcar ninguna: gana comisión en todas las ventas.' : 'Solo en las líneas marcadas.'}</small>
        </Field>
        <div className="alert info full" style={{ fontSize: 12 }}>
          Ejemplo: venta de $1.000.000 con costo $800.000 → {d.commissionBase === 'venta'
            ? `${d.commissionPct}% de $1.000.000 = ${money(1000000 * d.commissionPct / 100)}`
            : `${d.commissionPct}% de la ganancia $200.000 = ${money(200000 * d.commissionPct / 100)}`}.
        </div>
        <label className="checkbox full"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />Activo (aparece en Facturación)</label>
      </div>
    </Modal>
  );
}

const PERIODS: { value: PeriodKind | 'todo'; label: string }[] = [
  { value: 'hoy', label: 'Hoy' }, { value: '7dias', label: '7 días' }, { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' }, { value: 'anio', label: 'Este año' }, { value: 'todo', label: 'Todo' }, { value: 'rango', label: 'Rango' },
];

function SellerDetail({ seller, invoices, onClose }: { seller: Seller; invoices: Invoice[]; onClose: () => void }) {
  const [kind, setKind] = useState<PeriodKind | 'todo'>('mes');
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const period = kind === 'todo' ? undefined : periodRange(kind, new Date(), from, to);
  const rows = useMemo(() => sellerSalesDetail(seller.id, invoices, period), [seller.id, invoices, kind, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = rows.reduce((a, r) => ({ sales: a.sales + r.sales, cost: a.cost + r.cost, profit: a.profit + r.profit, commission: a.commission + r.commission, units: a.units + r.qty }), { sales: 0, cost: 0, profit: 0, commission: 0, units: 0 });
  const invoicesCount = new Set(rows.map((r) => r.invoiceId)).size;
  const label = PERIODS.find((p) => p.value === kind)!.label;
  const exportXls = () => downloadCsv(`ventas-${seller.name.replace(/\s+/g, '-')}_${kind}.csv`, [
    [`Ventas de ${seller.name}`, kind === 'rango' ? `${from} a ${to}` : label],
    [],
    ['Fecha', 'Factura', 'Cliente', 'Producto', 'IMEI', 'Cantidad', 'Venta', 'Costo', 'Ganancia', 'Comisión'],
    ...rows.map((r) => [dateTime(r.at), pad(r.invoiceNumber, 6), r.customer, r.description, r.imei ?? '', r.qty, r.sales, r.cost, r.profit, r.commission]),
    ['Total', '', '', '', '', t.units, t.sales, t.cost, t.profit, t.commission],
  ]);
  return (
    <Modal wide title={`Ventas de ${seller.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={exportXls} disabled={rows.length === 0}><Download size={15} />Excel</button><button className="btn ghost" onClick={onClose}>Cerrar</button></>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <Seg value={kind} onChange={setKind} options={PERIODS} />
        {kind === 'rango' && <>
          <Field label="Desde"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </>}
      </div>
      <div className="kpis" style={{ marginBottom: 14 }}>
        <Stat accent label="Vendido" value={money(t.sales)} sub={`${invoicesCount} factura(s) · ${t.units} unidad(es)`} />
        <Stat label="Costo" value={money(t.cost)} />
        <Stat label="Ganancia" value={<span className={t.profit < 0 ? 'red' : ''}>{money(t.profit)}</span>} sub={t.sales > 0 ? `${Math.round((t.profit / t.sales) * 100)}% de margen` : 'Sin ventas'} />
        <Stat label="Comisión" value={money(t.commission)} sub={`${seller.commissionPct}% ${BASE_LABEL[seller.commissionBase]}`} />
      </div>
      <div className="card">
        {rows.length === 0 ? <Empty>No tiene ventas en este periodo.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Producto</th><th className="num">Venta</th><th className="num">Costo</th><th className="num">Ganancia</th><th className="num">Comisión</th></tr></thead>
              <tbody>
                {rows.map((r, k) => (
                  <tr key={k}>
                    <td className="nowrap">{dateTime(r.at)}</td>
                    <td className="mono">{pad(r.invoiceNumber, 6)}</td>
                    <td>{r.customer}</td>
                    <td>{r.qty > 1 && <b>{r.qty}× </b>}{r.description}{r.imei && <small className="mono">IMEI {r.imei}</small>}</td>
                    <td className="num">{money(r.sales)}</td>
                    <td className="num faint">{money(r.cost)}</td>
                    <td className={`num strong ${r.profit < 0 ? 'red' : ''}`}>{money(r.profit)}</td>
                    <td className="num">{money(r.commission)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td className="strong" colSpan={4}>Total · {label.toLowerCase()}</td>
                  <td className="num strong">{money(t.sales)}</td><td className="num">{money(t.cost)}</td>
                  <td className="num strong">{money(t.profit)}</td><td className="num strong">{money(t.commission)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Ganancia = venta − costo de lo vendido (antes de la comisión). Las facturas anuladas no se cuentan. Si vendió algo sin costo registrado, la ganancia sale igual a la venta.</div>
    </Modal>
  );
}
