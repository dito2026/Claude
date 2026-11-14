import { useState } from 'react';
import type { Invoice } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../services/settings';
import { collectCredit, creditAmount, creditBalance } from '../services/billing';
import { Field, Modal, MoneyInput, useAction } from './ui';

/** Cobrar (total o parcial) una venta hecha a «Crédito tienda». */
export function CollectCreditModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const settings = useSettings();
  const balance = creditBalance(inv);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState('');
  const methods = settings.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const pay = () => run(() => collectCredit(actor, inv.id, amount, method),
    amount === balance ? 'Crédito pagado completo · la factura quedó pagada' : `Abono registrado · saldo ${money(balance - amount)}`).then((ok) => ok && onClose());
  return (
    <Modal title={`Cobrar crédito · factura ${pad(inv.number, 6)}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !amount || amount > balance || !method} onClick={pay}>Cobrar {money(amount)}</button></>}>
      <div className="stack">
        <div className="totals">
          <div><span className="muted">Cliente</span><span className="strong">{inv.customer.name || 'Cliente'}</span></div>
          <div><span className="muted">Vendido a crédito el {dateTime(inv.createdAt)}</span><span>{money(creditAmount(inv))}</span></div>
          {(inv.creditPayments ?? []).map((p, i) => (
            <div key={i} className="faint"><span>Abono {dateTime(p.at)} · {p.method}</span><span>-{money(p.amount)}</span></div>
          ))}
          <div className="grand"><span>Saldo por cobrar</span><span className="red">{money(balance)}</span></div>
        </div>
        <Field label="Valor que paga">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="row gap-sm">
          <button type="button" className="btn sm" onClick={() => setAmount(balance)}>Todo ({money(balance)})</button>
          {balance >= 2000 && <button type="button" className="btn sm ghost" onClick={() => setAmount(Math.round(balance / 2))}>La mitad</button>}
        </div>
        {amount > balance && <div className="alert error"><div>El cliente solo debe {money(balance)}.</div></div>}
        <div className="field">
          <span>Medio de pago <em>*</em></span>
          <div className={`pay-methods ${amount > 0 && !method ? 'missing' : ''}`}>
            {methods.map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m}</button>)}
          </div>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>El dinero entra a la caja abierta como «Abono de cliente». Cuando el saldo llega a $0, la factura queda «pagada».</div>
      </div>
    </Modal>
  );
}
