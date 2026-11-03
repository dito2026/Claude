import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { CashMovement, CommissionBase, Invoice, Seller } from '../lib/types';
import { dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, PageHead, Seg, Stat, useAction } from '../components/ui';
import { LINES } from '../services/accounting';
import { BASE_LABEL, saveSeller, sellerBalance, type SellerInput } from '../services/sellers';

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

function SellerDetail({ seller, invoices, onClose }: { seller: Seller; invoices: Invoice[]; onClose: () => void }) {
  const mine = invoices.filter((i) => i.sellerId === seller.id).sort((a, b) => b.number - a.number).slice(0, 200);
  return (
    <Modal wide title={`Ventas de ${seller.name}`} onClose={onClose}>
      <div className="card">
        {mine.length === 0 ? <Empty>Aún no tiene ventas.</Empty> : (
          <table className="table">
            <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th className="num">Venta</th><th className="num">Comisión</th></tr></thead>
            <tbody>
              {mine.map((i) => (
                <tr key={i.id} style={{ opacity: i.status === 'anulada' ? 0.5 : 1 }}>
                  <td className="mono">{pad(i.number, 6)}</td>
                  <td className="nowrap">{dateTime(i.createdAt)}</td>
                  <td>{i.customer.name || 'Consumidor final'}</td>
                  <td><Badge tone={i.status === 'anulada' ? 'red' : i.status === 'credito' ? 'warn' : 'ok'}>{i.status}</Badge></td>
                  <td className="num">{money(i.total)}</td>
                  <td className="num">{i.status === 'anulada' ? <s>{money(i.commission)}</s> : money(i.commission)}<small>{i.commissionPct}% {i.commissionBase ? BASE_LABEL[i.commissionBase] : ''}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
