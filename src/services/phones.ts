// Celulares controlados por IMEI. Cada unidad es un documento phoneUnits/{IMEI}
// y cada IMEI (principal y secundario) reserva imeiIndex/{IMEI}: así un IMEI
// nunca se puede registrar dos veces, ni siquiera desde dos equipos a la vez.
import { backend, type Tx } from '../data';
import type { PhoneUnit, PhoneUnitInput, Product } from '../lib/types';
import { BusinessError, created, touched, type Actor } from './common';
import { moveStock } from './inventory';

export const isPhone = (p: Pick<Product, 'type'>) => p.type === 'EQUIPO';

export const normalizeImei = (s: string) => (s ?? '').toUpperCase().replace(/[\s.-]/g, '');

/** Dígito de control (Luhn) de un IMEI de 15 dígitos. */
export function luhnOk(digits: string): boolean {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

/** null si es válido; si no, el motivo. Acepta IMEI (15 dígitos) o serial alfanumérico (iPad, etc.). */
export function imeiError(code: string): string | null {
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return `«${code || '(vacío)'}» no es un IMEI o serial válido.`;
  if (/^\d+$/.test(code) && code.length !== 15) return `El IMEI ${code} debe tener 15 dígitos.`;
  if (/^\d{15}$/.test(code) && !luhnOk(code)) return `El IMEI ${code} no es válido (revise los dígitos).`;
  return null;
}

/** Normaliza y valida una lista de unidades: formato y que no se repitan entre sí. */
export function cleanUnits(units: PhoneUnitInput[]): PhoneUnitInput[] {
  const seen = new Set<string>();
  return units.map((u) => {
    const imei = normalizeImei(u.imei);
    const imei2 = normalizeImei(u.imei2 ?? '');
    for (const code of [imei, imei2].filter(Boolean)) {
      const err = imeiError(code);
      if (err) throw new BusinessError(err);
      if (seen.has(code)) throw new BusinessError(`El IMEI ${code} está repetido en la lista.`);
      seen.add(code);
    }
    return { ...u, imei, imei2, condition: u.condition || 'NUEVO', color: (u.color ?? '').trim(), notes: (u.notes ?? '').trim() };
  });
}

/** Fase de lecturas: falla si algún IMEI ya existe. */
export async function assertImeisFree(tx: Tx, units: PhoneUnitInput[]) {
  for (const u of units) {
    for (const code of [u.imei, u.imei2].filter(Boolean) as string[]) {
      const hit = await tx.get<{ unitId: string }>('imeiIndex', code);
      if (hit) {
        // Un IMEI de una compra anulada se puede volver a ingresar
        const prev = await tx.get<PhoneUnit>('phoneUnits', hit.unitId);
        if (prev?.status !== 'anulado') throw new BusinessError(`El IMEI ${code} ya está registrado en el inventario.`);
      }
    }
  }
}

export interface UnitOrigin {
  cost: number;
  supplierName: string;
  purchaseId?: string;
  purchaseNumber?: number;
  /** precio de venta propio (usados) */
  price?: number;
  usedPurchaseId?: string;
  usedPurchaseNumber?: number;
}

/** Fase de escrituras: crea las unidades y reserva sus IMEI. No mueve stock. */
export function writeUnits(tx: Tx, actor: Actor, product: Product, units: PhoneUnitInput[], origin: UnitOrigin) {
  for (const u of units) {
    const unit: Omit<PhoneUnit, 'id'> = {
      imei: u.imei,
      imei2: u.imei2 ?? '',
      productId: product.id,
      productName: product.name,
      condition: u.condition,
      color: u.color ?? '',
      cost: origin.cost,
      supplierName: origin.supplierName,
      purchaseId: origin.purchaseId,
      purchaseNumber: origin.purchaseNumber,
      status: 'disponible',
      warrantyMonths: product.warrantyMonths || 0,
      notes: u.notes ?? '',
      ...(origin.price ? { price: origin.price } : {}),
      ...(origin.usedPurchaseId ? { usedPurchaseId: origin.usedPurchaseId, usedPurchaseNumber: origin.usedPurchaseNumber } : {}),
      ...created(actor),
    };
    tx.set('phoneUnits', u.imei, unit as unknown as Record<string, unknown>);
    tx.set('imeiIndex', u.imei, { unitId: u.imei });
    if (u.imei2) tx.set('imeiIndex', u.imei2, { unitId: u.imei });
  }
}

/**
 * Ingresa celulares con IMEI directamente (sin compra a proveedor).
 * `alreadyInStock`: el stock ya los contaba (p. ej. importados sin IMEI); solo se registran los IMEI.
 */
export async function registerUnits(
  actor: Actor,
  productId: string,
  rawUnits: PhoneUnitInput[],
  opts: { cost: number; supplierName: string; note: string; alreadyInStock: boolean; unregistered?: number },
) {
  const units = cleanUnits(rawUnits);
  if (units.length === 0) throw new BusinessError('Escriba al menos un IMEI.');
  if (opts.alreadyInStock && units.length > (opts.unregistered ?? 0)) {
    throw new BusinessError(`Solo hay ${opts.unregistered ?? 0} equipo(s) en stock sin IMEI registrado.`);
  }
  return backend.transaction(async (tx) => {
    const p = await tx.get<Product>('products', productId);
    if (!p) throw new BusinessError('Producto no encontrado.');
    if (!isPhone(p)) throw new BusinessError('Solo los productos tipo EQUIPO se controlan por IMEI.');
    await assertImeisFree(tx, units);
    // ---- escrituras ----
    const cost = opts.cost > 0 ? opts.cost : p.cost;
    writeUnits(tx, actor, p, units, { cost, supplierName: opts.supplierName.trim() });
    if (!opts.alreadyInStock) {
      moveStock(tx, actor, p, units.length, 'compra', { refType: 'manual', note: opts.note || `Ingreso de ${units.length} equipo(s) con IMEI` });
    }
    return units.length;
  });
}

const addMonths = (iso: string, months: number) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

/** Escrituras al vender una unidad (la lectura y validación las hace la factura). */
export function markSold(
  tx: Tx,
  unit: PhoneUnit,
  sale: { invoiceId: string; invoiceNumber: number; at: string; price: number; customerName: string },
) {
  tx.update('phoneUnits', unit.id, {
    status: 'vendido',
    invoiceId: sale.invoiceId,
    invoiceNumber: sale.invoiceNumber,
    soldAt: sale.at,
    salePrice: sale.price,
    customerName: sale.customerName,
    warrantyUntil: unit.warrantyMonths > 0 ? addMonths(sale.at, unit.warrantyMonths) : null,
    ...touched(),
  });
}

/** Escrituras al anular la venta: el equipo vuelve a estar disponible. */
export function markAvailable(tx: Tx, unit: PhoneUnit) {
  tx.update('phoneUnits', unit.id, {
    status: 'disponible',
    invoiceId: null,
    invoiceNumber: null,
    soldAt: null,
    salePrice: null,
    customerName: null,
    warrantyUntil: null,
    ...touched(),
  });
}

export const warrantyActive = (u: PhoneUnit) => !!u.warrantyUntil && new Date(u.warrantyUntil).getTime() > Date.now();
