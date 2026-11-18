import { useMemo, useState } from 'react';
import type { Invoice } from '../lib/types';
import { useCollection } from '../data/hooks';
import { dateTime, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { applyCostToZeroSales, lacksCost, zeroCostSales } from '../services/billing';
import { Modal, useAction } from './ui';

export interface CostFix { productId: string; name: string; cost: number }

/** Ventas de estos productos que quedaron con costo $0 (solo el administrador puede corregirlas). */
export function useZeroCostSales(fixes: CostFix[]) {
  const invoices = useCollection<Invoice>('invoices').rows;
  const key = fixes.map((f) => `${f.productId}:${f.cost}`).join('|');
  return useMemo(() => {
    const ids = new Set<string>();
    for (const f of fixes) if (f.cost > 0) zeroCostSales(invoices, f.productId).forEach((i) => ids.add(i.id));
    return invoices.filter((i) => ids.has(i.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, key]);
}

/** Ofrece poner el costo nuevo a las ventas que se hicieron sin costo. */
export function ZeroCostSalesModal({ fixes, onClose }: { fixes: CostFix[]; onClose: () => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const sales = useZeroCostSales(fixes);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const costOf = new Map(fixes.map((f) => [f.productId, f.cost]));
  const lines = (inv: Invoice) => inv.items.filter((it) => it.productId && costOf.has(it.productId) && lacksCost(it));
  const chosen = sales.filter((s) => !skip.has(s.id));
  const extra = (inv: Invoice) => lines(inv).reduce((a, it) => a + it.qty * (costOf.get(it.productId!) ?? 0), 0);
  const apply = () => run(() => applyCostToZeroSales(actor, fixes, chosen.map((s) => s.id)),
    `Costo puesto en ${chosen.length} venta${chosen.length === 1 ? '' : 's'} · ganancia corregida`).then((ok) => ok && onClose());
  if (sales.length === 0) return null;
  return (
    <Modal title="Ventas que quedaron sin costo" wide onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>No, dejarlas así</button>
        <button className="btn primary" disabled={busy || chosen.length === 0} onClick={apply}>Poner el costo a {chosen.length} venta{chosen.length === 1 ? '' : 's'}</button></>}>
      <div className="stack">
        <div className="alert warn"><div>
          {fixes.length === 1 ? <>«{fixes[0].name}» se vendió antes de tener costo.</> : <>Estos productos se vendieron antes de tener costo.</>}{' '}
          En esas ventas la ganancia salió igual a la venta. ¿Les pone el costo de {fixes.length === 1 ? <b>{money(fixes[0].cost)}</b> : 'cada producto'}?
          Se corrigen la ganancia, los informes y la comisión de vendedores sobre utilidad. La factura guarda el valor anterior.
        </div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 36 }} /><th>Factura</th><th>Fecha</th><th>Producto</th><th className="num">Costo que se pone</th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} style={{ opacity: skip.has(s.id) ? 0.5 : 1 }}>
                  <td><input type="checkbox" aria-label={`Corregir factura ${s.number}`} checked={!skip.has(s.id)}
                    onChange={() => setSkip((x) => { const n = new Set(x); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} /></td>
                  <td className="mono">{pad(s.number, 6)}</td>
                  <td>{dateTime(s.createdAt)}</td>
                  <td>{lines(s).map((it) => `${it.qty}× ${it.description}`).join(', ')}</td>
                  <td className="num">{money(extra(s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
