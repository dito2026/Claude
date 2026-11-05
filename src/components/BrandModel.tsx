import { useId, useMemo } from 'react';
import { X } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { PhoneUnit, Product, RepairOrder } from '../lib/types';
import { brandFromText, buildBrandModels, canonicalBrand, type BrandModels } from '../lib/brands';

/** Marca → modelos con lo que ya hay en órdenes, productos y celulares. */
export function useBrandModels(): BrandModels {
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const products = useCollection<Product>('products').rows;
  return useMemo(() => buildBrandModels([
    ...orders.map((o) => ({ brand: o.device.brand, model: o.device.model })),
    ...products.filter((p) => p.type === 'EQUIPO').map((p) => ({ brand: p.brand || brandFromText(p.name), model: p.name })),
    ...products.filter((p) => p.type !== 'EQUIPO').map((p) => ({ brand: p.brand, model: p.model })),
  ]), [orders, products]);
}

export interface BrandModelValue { brand: string; model: string }

/** Filtro de marca y modelo (el modelo depende de la marca). Muestra solo marcas con datos. */
export function BrandModelFilter({ value, onChange, brands }: {
  value: BrandModelValue;
  onChange: (v: BrandModelValue) => void;
  /** marca → modelos presentes en la lista que se filtra */
  brands: BrandModels;
}) {
  const list = [...brands.keys()];
  const models = value.brand ? brands.get(value.brand) ?? [] : [];
  return (
    <div className="row gap-sm brand-filter" style={{ flexWrap: 'nowrap' }}>
      <select className="input" style={{ width: 170, minWidth: 0, flexShrink: 1 }} value={value.brand} onChange={(e) => onChange({ brand: e.target.value, model: '' })} aria-label="Marca">
        <option value="">Todas las marcas</option>
        {list.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select className="input" style={{ width: 210, minWidth: 0, flexShrink: 1 }} value={value.model} disabled={!value.brand} onChange={(e) => onChange({ ...value, model: e.target.value })} aria-label="Modelo">
        <option value="">{value.brand ? 'Todos los modelos' : 'Modelo (elija marca)'}</option>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {(value.brand || value.model) && (
        <button type="button" className="btn sm ghost" title="Quitar filtro" onClick={() => onChange({ brand: '', model: '' })}><X size={15} /></button>
      )}
    </div>
  );
}

/** Campo de marca con sugerencias; al salir del campo la escribe en forma estándar. */
export function BrandInput({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = useId();
  const brands = useBrandModels();
  return (
    <>
      <input className="input" list={id} value={value} required={required} placeholder="Samsung, Apple, Xiaomi…"
        onChange={(e) => onChange(e.target.value)} onBlur={() => onChange(canonicalBrand(value))} />
      <datalist id={id}>{[...brands.keys()].map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

/** Campo de modelo con sugerencias de los modelos ya registrados de esa marca. */
export function ModelInput({ brand, value, onChange, placeholder }: { brand: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  const brands = useBrandModels();
  const models = brands.get(canonicalBrand(brand)) ?? [];
  return (
    <>
      <input className="input" list={id} value={value} placeholder={placeholder ?? (models.length ? `Ej.: ${models[0]}` : '')} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{models.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
}

/** Marcas/modelos presentes en una lista concreta (para que el filtro solo muestre lo que hay). */
export function brandModelsOf(pairs: { brand?: string; model?: string }[]): BrandModels {
  const present = new Set(pairs.map((p) => canonicalBrand(p.brand)).filter(Boolean));
  const all = buildBrandModels(pairs);
  return new Map([...all].filter(([b]) => present.has(b)).sort(([a], [b]) => a.localeCompare(b)));
}
export { canonicalBrand };
export type { PhoneUnit };
