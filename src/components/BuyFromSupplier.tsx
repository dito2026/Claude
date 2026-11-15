import { useCollection } from '../data/hooks';
import type { Supplier } from '../lib/types';
import { Field, Seg } from './ui';
import { PayMethods } from './PayMethods';

export interface BuyFromSupplierValue {
  enabled: boolean;
  supplierId: string;
  paymentType: 'credito' | 'contado';
  method: string;
}

export const EMPTY_BUY: BuyFromSupplierValue = { enabled: false, supplierId: '', paymentType: 'credito', method: '' };

/** Bloque «Lo compré a un proveedor»: registra la compra (crédito = deuda) del artículo libre. */
export function BuyFromSupplierFields({ value, onChange }: { value: BuyFromSupplierValue; onChange: (v: BuyFromSupplierValue) => void }) {
  const suppliers = useCollection<Supplier>('suppliers').rows.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const set = (patch: Partial<BuyFromSupplierValue>) => onChange({ ...value, ...patch });
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <label className="checkbox">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <b>Lo compré a un proveedor</b> <span className="faint">(registra la compra y, si es a crédito, la deuda)</span>
      </label>
      {value.enabled && (
        <div className="form-grid">
          <Field label="Proveedor" required>
            <select className="input" value={value.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">Seleccione…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Forma de pago">
            <Seg value={value.paymentType} onChange={(v) => set({ paymentType: v })} options={[{ value: 'credito', label: 'A crédito (le debo)' }, { value: 'contado', label: 'De contado' }]} />
          </Field>
          {value.paymentType === 'contado' && (
            <PayMethods label="Pagué con" value={value.method} onChange={(m) => set({ method: m })} missing={!value.method} />
          )}
          {suppliers.length === 0 && <div className="faint full" style={{ fontSize: 12 }}>No hay proveedores: créelos en «Compras y proveedores».</div>}
        </div>
      )}
    </div>
  );
}

export const useSuppliers = () => useCollection<Supplier>('suppliers').rows;
