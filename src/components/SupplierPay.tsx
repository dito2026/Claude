import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CashMovement, Purchase, Supplier } from '../lib/types';
import { useCollection, useDocument } from '../data/hooks';
import { dateOnly, dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import type { CashState } from '../services/cash';
import { guessSupplier, isOverduePurchase, linkCashPayment, paySupplier, purchaseBalance, supplierSummary, unlinkedCashPayments } from '../services/purchases';
import { Field, Modal, MoneyInput, useAction, useToast } from './ui';
import { PayMethods } from './PayMethods';

/**
 * Abono a un proveedor: sale de la caja y descuenta de su deuda (la compra más antigua primero).
 * Desde Compras llega con el proveedor; desde Caja se escoge aquí.
 */
export function SupplierPayModal({ supplier: fixed, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const cash = useDocument<CashState & { id: string }>('meta', 'cash').doc;
  const [sid, setSid] = useState(fixed?.id ?? '');
  const supplier = fixed ?? suppliers.find((s) => s.id === sid);
  const withDebt = useMemo(() => suppliers
    .map((s) => ({ s, owed: supplierSummary(s, purchases).owed }))
    .filter((x) => x.owed > 0)
    .sort((a, b) => a.s.name.localeCompare(b.s.name)), [suppliers, purchases]);
  const pending = supplier ? purchases
    .filter((p) => p.supplierId === supplier.id && purchaseBalance(p) > 0)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')) : [];
  const owed = pending.reduce((a, p) => a + purchaseBalance(p), 0);
  const [amount, setAmount] = useState(() => (fixed ? owed : 0));
  const [method, setMethod] = useState('');
  return (
    <Modal title={supplier && fixed ? `Abonar a ${supplier.name}` : 'Pago a proveedor'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !supplier || !amount || amount > owed || !method || !cash?.openSessionId}
          onClick={() => run(() => paySupplier(actor, supplier!, pending.map((p) => p.id), amount, method), `Abono registrado · ${supplier?.name}`).then((ok) => ok && onClose())}>Registrar abono</button></>}>
      <div className="stack">
        {!cash?.openSessionId && <div className="alert warn">La caja está cerrada. El abono sale de caja: <Link className="red" to="/caja">abra la caja</Link> primero.</div>}
        {!fixed && (
          <Field label="Proveedor" required>
            <select className="input" value={sid} autoFocus onChange={(e) => { setSid(e.target.value); setAmount(0); }}>
              <option value="">Seleccione…</option>
              {withDebt.map(({ s, owed: o }) => <option key={s.id} value={s.id}>{s.name} · debe {money(o)}</option>)}
            </select>
            {withDebt.length === 0 && <small className="muted">No hay proveedores con deuda. Si va a pagar algo nuevo, regístrelo en <Link to="/compras">Compras</Link> (de contado sale de la caja ahí mismo).</small>}
          </Field>
        )}
        {supplier && <>
          <div className="totals"><div className="grand"><span>Deuda con {supplier.name}</span><span className="red">{money(owed)}</span></div></div>
          <div className="form-grid">
            <Field label="Valor del abono">
              <MoneyInput value={amount} onChange={setAmount} autoFocus={!!fixed} />
              {owed > 0 && amount !== owed && <button type="button" className="btn sm ghost" style={{ justifyContent: 'flex-start', paddingLeft: 0 }} onClick={() => setAmount(owed)}>Pagar todo ({money(owed)})</button>}
            </Field>
            <PayMethods value={method} onChange={setMethod} missing={amount > 0 && !method} />
          </div>
          {amount > owed && <div className="alert error"><div>Solo le debe {money(owed)} a {supplier.name}.</div></div>}
          <div className="faint" style={{ fontSize: 12 }}>Sale de la caja y se descuenta de la deuda, primero de la compra más antigua:</div>
          {pending.map((p) => (
            <div key={p.id} className="row between" style={{ fontSize: 13 }}>
              <span className="mono">C-{pad(p.number, 4)} · {dateOnly(p.createdAt)}{isOverduePurchase(p) && <span className="red"> · vencida</span>}</span>
              <b>{money(purchaseBalance(p))}</b>
            </div>
          ))}
        </>}
      </div>
    </Modal>
  );
}

/** Pagos de Caja que no descontaron deuda (solo el administrador los aplica). */
export function useUnlinkedCashPayments() {
  const { can } = useAuth();
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const admin = can('settings');
  return useMemo(() => (admin ? unlinkedCashPayments(movements) : []), [movements, admin]);
}

export function UnlinkedCashPayments({ suppliers }: { suppliers: Supplier[] }) {
  const rows = useUnlinkedCashPayments();
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-pad stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Pagos desde Caja que no descontaron la deuda</h3>
        <div className="faint" style={{ fontSize: 13 }}>
          Se registraron con «Pago a proveedor» en Caja escribiendo el nombre. El dinero ya salió de la caja, pero el saldo del proveedor no bajó.
          Escoja el proveedor y toque <b>Descontar</b>: se aplica a sus compras (la más antigua primero) sin volver a sacar plata de la caja.
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Medio</th><th className="num">Valor</th><th>Proveedor</th><th /></tr></thead>
          <tbody>{rows.map((m) => <UnlinkedRow key={m.id} m={m} suppliers={suppliers} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

function UnlinkedRow({ m, suppliers }: { m: CashMovement; suppliers: Supplier[] }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const toast = useToast();
  const [sid, setSid] = useState(() => guessSupplier(m, suppliers)?.id ?? '');
  const sorted = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const link = () => run(async () => {
    const r = await linkCashPayment(actor, m.id, sid);
    toast(`Descontado de la deuda de ${r.supplierName} · compra${r.applied.length === 1 ? '' : 's'} ${r.applied.map((n) => `C-${pad(n, 4)}`).join(', ')}`);
  });
  return (
    <tr>
      <td>{dateTime(m.createdAt)}</td>
      <td>{m.description}</td>
      <td>{m.method}</td>
      <td className="num strong">{money(m.amount)}</td>
      <td>
        <select className="input" style={{ minWidth: 160 }} value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Proveedor del pago">
          <option value="">Seleccione…</option>
          {sorted.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td><button className="btn sm primary" disabled={busy || !sid} onClick={link}>Descontar</button></td>
    </tr>
  );
}
