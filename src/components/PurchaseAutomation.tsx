import { useMemo, useState } from 'react';
import { FileUp, ShoppingCart, Sparkles } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Product, Purchase, PurchaseItem, StockMovement, Supplier } from '../lib/types';
import { money } from '../lib/format';
import { restockSuggestions } from '../services/automation';
import { aiErrorMessage, aiReadSupplierInvoice, fileToBase64, type InvoiceRead } from '../services/ai';
import { normalize } from '../lib/format';
import { Badge, Empty, Modal } from './ui';

export interface PurchasePrefill {
  supplierId?: string;
  items?: PurchaseItem[];
  paymentType?: 'credito' | 'contado';
  invoiceRef?: string;
  note?: string;
  /** IMEI por producto (celulares), una línea por equipo */
  imeiText?: Record<string, string>;
}

/** Pestaña «Reposición sugerida»: qué comprar y a quién, calculado con las ventas de 30 días. */
export function RestockTab({ onBuy }: { onBuy: (p: PurchasePrefill) => void }) {
  const products = useCollection<Product>('products').rows;
  const movements = useCollection<StockMovement>('stockMovements').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const lines = useMemo(() => restockSuggestions(products, movements, purchases, suppliers), [products, movements, purchases, suppliers]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof lines>();
    for (const l of lines) {
      const k = l.supplierId ?? '';
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m];
  }, [lines]);

  if (lines.length === 0) return <div className="card"><Empty>Todo el inventario está cubierto. No hay nada urgente por comprar.</Empty></div>;
  return (
    <div className="stack">
      <div className="faint" style={{ fontSize: 13 }}>
        Se calcula solo: lo que vendió o usó en reparaciones en los últimos 30 días, para cubrir ~15 días más el stock mínimo.
        El proveedor sugerido es el de la última compra de cada producto.
      </div>
      {groups.map(([sid, ls]) => {
        const name = ls[0].supplierName ?? 'Sin proveedor anterior';
        const total = ls.reduce((a, l) => a + l.suggested * l.lastCost, 0);
        return (
          <div key={sid || 'none'} className="card">
            <div className="card-head">
              <h3>{name} <span className="faint">· {ls.length} producto(s) · aprox. {money(total)}</span></h3>
              <button className="btn sm primary" onClick={() => onBuy({
                supplierId: sid || undefined,
                items: ls.map((l) => ({ productId: l.product.id, name: l.product.name, qty: l.suggested, unitCost: l.lastCost })),
                note: 'Reposición sugerida automáticamente',
              })}><ShoppingCart size={15} />Crear compra</button>
            </div>
            <table className="table">
              <thead><tr><th>Producto</th><th className="num">Stock</th><th className="num">Mínimo</th><th className="num">Usados 30 días</th><th className="num">Comprar</th><th className="num">Costo aprox.</th></tr></thead>
              <tbody>
                {ls.map((l) => (
                  <tr key={l.product.id}>
                    <td className="strong">{l.product.name}</td>
                    <td className="num"><Badge tone={l.product.stock <= 0 ? 'red' : 'warn'}>{l.product.stock}</Badge></td>
                    <td className="num">{l.product.minStock}</td>
                    <td className="num">{l.soldLast30}</td>
                    <td className="num strong">{l.suggested}</td>
                    <td className="num">{money(l.suggested * l.lastCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** Lee la foto o el PDF de la factura del proveedor con IA y arma la compra. */
export function AiInvoiceModal({ suppliers, onClose, onReady }: { suppliers: Supplier[]; onClose: () => void; onReady: (p: PurchasePrefill) => void }) {
  const products = useCollection<Product>('products').rows;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InvoiceRead | null>(null);
  const [preview, setPreview] = useState('');

  const read = async (f?: File) => {
    if (!f) return;
    setError(''); setResult(null);
    if (f.size > 15 * 1024 * 1024) return setError('El archivo es muy grande (máximo 15 MB).');
    if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(f.type)) return setError('Use una foto (JPG, PNG) o un PDF.');
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
    setBusy(true);
    try {
      const file = await fileToBase64(f);
      setResult(await aiReadSupplierInvoice(file, products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, sku: p.sku })), suppliers.map((s) => s.name)));
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const supplier = result?.proveedor
    ? suppliers.find((s) => normalize(s.name) === normalize(result.proveedor)) ??
      suppliers.find((s) => normalize(result.proveedor).includes(normalize(s.name)) || normalize(s.name).includes(normalize(result.proveedor)))
    : undefined;
  const byId = new Map(products.map((p) => [p.id, p]));

  const use = () => {
    if (!result) return;
    const items: PurchaseItem[] = [];
    const imeiText: Record<string, string> = {};
    for (const it of result.items) {
      const p = it.producto_id ? byId.get(it.producto_id) : undefined;
      if (p?.type === 'EQUIPO') {
        imeiText[p.id] = [imeiText[p.id], ...it.imeis].filter(Boolean).join('\n');
        if (!items.some((x) => x.productId === p.id)) items.push({ productId: p.id, name: p.name, qty: it.cantidad, unitCost: Math.round(it.costo_unitario) });
      } else {
        items.push({ productId: p?.id ?? '', name: p?.name ?? it.descripcion, qty: Math.max(1, Math.round(it.cantidad)), unitCost: Math.round(it.costo_unitario) });
      }
    }
    onReady({
      supplierId: supplier?.id,
      items,
      paymentType: result.forma_pago === 'contado' ? 'contado' : 'credito',
      invoiceRef: result.numero_factura,
      note: `Leída con IA${result.proveedor && !supplier ? ` · proveedor en la factura: ${result.proveedor}` : ''}${result.observaciones ? ` · ${result.observaciones}` : ''}`,
      imeiText,
    });
  };

  return (
    <Modal wide title={<><Sparkles size={16} className="red" /> Leer factura de proveedor con IA</>} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!result || busy} onClick={use}>Revisar y registrar compra</button></>}>
      <div className="stack">
        <label className="card card-pad row" style={{ cursor: 'pointer', borderStyle: 'dashed', justifyContent: 'center' }}>
          <FileUp size={20} />
          <span>{busy ? 'Leyendo la factura… (puede tardar unos segundos)' : 'Tome una foto de la factura o elija la imagen / PDF'}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" hidden disabled={busy} onChange={(e) => void read(e.target.files?.[0])} />
        </label>
        {error && <div className="alert error">{error}</div>}
        {result && (
          <div className="grid g-main">
            <div className="card">
              <div className="card-head">
                <h3>{result.proveedor || 'Proveedor no identificado'} {result.numero_factura && <span className="faint">· Fact. {result.numero_factura}</span>}</h3>
                {supplier ? <Badge tone="ok">Proveedor: {supplier.name}</Badge> : <Badge tone="warn">Elíjalo al registrar</Badge>}
              </div>
              <table className="table">
                <thead><tr><th>Ítem en la factura</th><th>En el inventario</th><th className="num">Cant.</th><th className="num">Costo unit.</th></tr></thead>
                <tbody>
                  {result.items.map((it, i) => {
                    const p = it.producto_id ? byId.get(it.producto_id) : undefined;
                    return (
                      <tr key={i}>
                        <td>{it.descripcion}{it.imeis.length > 0 && <small className="mono">{it.imeis.join(', ')}</small>}</td>
                        <td>{p ? <Badge tone="ok">{p.name}</Badge> : <Badge tone="info">Artículo libre</Badge>}</td>
                        <td className="num">{it.cantidad}</td>
                        <td className="num">{money(it.costo_unitario)}</td>
                      </tr>
                    );
                  })}
                  <tr><td colSpan={3} className="strong right">Total leído</td><td className="num strong">{money(result.total)}</td></tr>
                </tbody>
              </table>
              <div className="card-pad faint" style={{ fontSize: 12 }}>Revise siempre los valores: en el siguiente paso puede corregir todo antes de registrar.</div>
            </div>
            {preview && <img src={preview} alt="Factura" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />}
          </div>
        )}
      </div>
    </Modal>
  );
}
