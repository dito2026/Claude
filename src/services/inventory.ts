import { backend, type Tx } from '../data';
import type { Product, StockMovement, StockReason } from '../lib/types';
import { BusinessError, created, touched, type Actor } from './common';

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export interface StockRef {
  refType?: StockMovement['refType'];
  refId?: string;
  refNumber?: number;
  note?: string;
}

/**
 * Mueve stock de un producto YA LEÍDO en la transacción y registra el kardex.
 * qty > 0 entra, qty < 0 sale. No permite stock negativo.
 */
/** ¿Este producto lleva control de stock? (servicios y productos marcados «sin inventario» no) */
export const tracksStock = (p: Pick<Product, 'type' | 'trackStock'>) =>
  p.type === 'EQUIPO' || (p.type !== 'SERVICIO' && p.trackStock !== false); // los celulares siempre

export function moveStock(
  tx: Tx,
  actor: Actor,
  product: Product,
  qty: number,
  reason: StockReason,
  ref: StockRef = {},
): number {
  if (!tracksStock(product)) return Number(product.stock) || 0; // sin control de inventario
  const stockAfter = (Number(product.stock) || 0) + qty;
  if (stockAfter < 0) {
    throw new BusinessError(
      `Stock insuficiente de «${product.name}»: hay ${product.stock}, se necesitan ${Math.abs(qty)}.`,
    );
  }
  tx.update('products', product.id, { stock: stockAfter, ...touched() });
  const mv: Omit<StockMovement, 'id'> = {
    productId: product.id,
    productName: product.name,
    kind: reason === 'ajuste' ? 'ajuste' : qty >= 0 ? 'entrada' : 'salida',
    qty,
    reason,
    unitCost: product.cost,
    stockAfter,
    ...ref,
    ...created(actor),
  };
  tx.create('stockMovements', mv as unknown as Record<string, unknown>);
  product.stock = stockAfter; // por si se mueve dos veces en la misma transacción
  return stockAfter;
}

export async function saveProduct(actor: Actor, input: ProductInput, id?: string) {
  const data = { ...input, sku: input.sku.trim().toUpperCase(), name: input.name.trim() };
  if (!data.name) throw new BusinessError('El nombre es obligatorio.');
  if (id) {
    // El stock no se edita aquí: se usa «Entrada» o «Ajuste» para que quede en el kardex.
    const { stock: _ignored, ...rest } = data;
    void _ignored;
    await backend.update('products', id, { ...rest, ...touched() });
    return id;
  }
  return backend.transaction(async (tx) => {
    // Los celulares entran por IMEI (Ingresar equipos o compras), nunca como número suelto.
    const initial = tracksStock(data) && data.type !== 'EQUIPO' ? Math.max(0, Number(data.stock) || 0) : 0;
    const newId = tx.create('products', { ...data, stock: 0, ...created(actor) });
    if (initial > 0) {
      moveStock(tx, actor, { ...(data as Product), id: newId, stock: 0 }, initial, 'inicial', {
        refType: 'manual',
        note: 'Stock inicial',
      });
    }
    return newId;
  });
}

/** Entrada por compra: suma stock y actualiza el costo unitario si se indica. */
export async function receiveStock(actor: Actor, productId: string, qty: number, unitCost?: number, note = '') {
  if (!(qty > 0)) throw new BusinessError('La cantidad debe ser mayor que cero.');
  return backend.transaction(async (tx) => {
    const p = await tx.get<Product>('products', productId);
    if (!p) throw new BusinessError('Producto no encontrado.');
    if (!tracksStock(p)) throw new BusinessError('Este producto no controla inventario.');
    if (p.type === 'EQUIPO') throw new BusinessError('Los celulares se ingresan con su IMEI («Ingresar equipos» o una compra).');
    if (unitCost !== undefined && unitCost > 0) {
      p.cost = unitCost;
      tx.update('products', p.id, { cost: unitCost });
    }
    return moveStock(tx, actor, p, qty, 'compra', { refType: 'manual', note });
  });
}

/** Ajuste por conteo físico: deja el stock en `newStock`. */
export async function adjustStock(actor: Actor, productId: string, newStock: number, note: string) {
  if (newStock < 0) throw new BusinessError('El stock no puede ser negativo.');
  if (!note.trim()) throw new BusinessError('Escriba el motivo del ajuste.');
  return backend.transaction(async (tx) => {
    const p = await tx.get<Product>('products', productId);
    if (!p) throw new BusinessError('Producto no encontrado.');
    if (!tracksStock(p)) throw new BusinessError('Este producto no controla inventario.');
    if (p.type === 'EQUIPO' && newStock > (Number(p.stock) || 0)) {
      throw new BusinessError('Para subir el stock de celulares ingréselos con su IMEI.');
    }
    const delta = newStock - (Number(p.stock) || 0);
    if (delta === 0) return p.stock;
    return moveStock(tx, actor, p, delta, 'ajuste', { refType: 'manual', note });
  });
}

export const isLowStock = (p: Product) => tracksStock(p) && p.active && p.stock <= p.minStock;
