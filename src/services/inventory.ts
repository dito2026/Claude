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

const SKU_PREFIX: Record<Product['type'], string> = { ACCESORIO: 'ACC', REPUESTO: 'REP', EQUIPO: 'CEL', SERVICIO: 'SRV' };

/** Siguiente código libre para el tipo: ACC-0012, REP-0005… */
export function nextSku(type: Product['type'], products: Pick<Product, 'sku'>[]): string {
  const prefix = SKU_PREFIX[type];
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const max = products.reduce((m, p) => Math.max(m, Number(re.exec(p.sku ?? '')?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Tipo probable según el nombre (solo para sugerir al crear). */
export function guessType(name: string): Product['type'] | null {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(pantalla|display|bateria|flex|puerto|pin de carga|tapa|camara|visor|tactil|boton|altavoz|auricular)\b/.test(n) && !/\b(cambio|instalacion|servicio)\b/.test(n)) return 'REPUESTO';
  if (/\b(iphone|galaxy|redmi|poco|moto g|moto e|honor|realme|celular|telefono)\b/.test(n) && /\b(\d+ ?gb|pro|max|ultra|plus|lite|\d{2,3})\b/.test(n)) return 'EQUIPO';
  if (/\b(revision|diagnostico|software|desbloqueo|instalacion|cambio de|mano de obra|actualizacion|limpieza)\b/.test(n)) return 'SERVICIO';
  if (/\b(cargador|cable|forro|estuche|vidrio|protector|audifono|parlante|memoria|soporte|reloj|sim)\b/.test(n)) return 'ACCESORIO';
  return null;
}

/** Precio sugerido: costo + margen, redondeado hacia arriba a miles. */
export const suggestedPrice = (cost: number, marginPct: number) =>
  cost > 0 ? Math.ceil((cost * (1 + marginPct / 100)) / 1000) * 1000 : 0;

/**
 * «Eliminar» un producto: sale del inventario y de las ventas, pero no se borra
 * (facturas, órdenes y kardex lo siguen nombrando). Si tenía stock, se da de baja con un ajuste en el kardex.
 * Los celulares con IMEI en el local deben venderse o anularse primero.
 */
export async function archiveProduct(actor: Actor, productId: string, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo.');
  return backend.transaction(async (tx) => {
    const p = await tx.get<Product>('products', productId);
    if (!p) throw new BusinessError('Producto no encontrado.');
    if (p.archived) throw new BusinessError('El producto ya está eliminado.');
    const stock = Number(p.stock) || 0;
    if (p.type === 'EQUIPO' && stock > 0) {
      throw new BusinessError(`«${p.name}» tiene ${stock} celular(es) en inventario. Véndalos o anule su ingreso (Inventario → Celulares) antes de eliminarlo.`);
    }
    // ---- escrituras ----
    if (tracksStock(p) && stock > 0) {
      moveStock(tx, actor, p, -stock, 'ajuste', { refType: 'manual', note: `Eliminado del inventario: ${reason.trim()}` });
    }
    tx.update('products', p.id, {
      active: false, archived: true, archivedAt: new Date().toISOString(), archivedBy: actor.name, archiveReason: reason.trim(), ...touched(),
    });
  });
}

/** Recupera un producto eliminado (queda activo con stock 0). */
export async function restoreProduct(productId: string) {
  await backend.update('products', productId, { active: true, archived: false, archivedAt: null, archivedBy: null, archiveReason: null, ...touched() });
}
