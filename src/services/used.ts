// Compraventa de celulares usados: el cliente le vende un equipo a la tienda.
// En una sola transacción: contrato numerado, equipo al inventario por IMEI (USADO),
// kardex «compra» y egreso de la caja abierta.
import { backend } from '../data';
import type { CashMovement, PhoneUnit, Product, UsedPurchase, UsedSeller } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { normalize } from '../lib/format';
import { canonicalBrand } from '../lib/brands';
import { BusinessError, created, readNext, touched, writeCounter, type Actor } from './common';
import { moveStock, nextSku } from './inventory';
import { assertImeisFree, cleanUnits, writeUnits } from './phones';
import { requireOpenSession, writeMovement, type CashState } from './cash';

export interface UsedDraft {
  date: string;
  city: string;
  seller: UsedSeller;
  buyer: UsedPurchase['buyer'];
  device: UsedPurchase['device'];
  price: number;
  method: string;
  salePrice: number;
  imeiVerified: boolean;
  /** se pagó con dinero que no está en la caja: no se descuenta de la caja */
  outsideCash?: boolean;
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

/** Producto EQUIPO de esa marca y modelo (los usados comparten producto con los nuevos; el IMEI dice si es usado). */
export function findPhoneProduct(products: Product[], brand: string, model: string): Product | undefined {
  const full = normalize(`${brand} ${model}`);
  const m = normalize(model);
  const b = normalize(canonicalBrand(brand));
  return products.find((p) => p.type === 'EQUIPO' && p.active !== false
    && (normalize(p.name) === full || normalize(p.name) === m || (normalize(canonicalBrand(p.brand || '')) === b && normalize(p.model || '') === m)));
}

export function validateUsed(d: UsedDraft) {
  const need: [string, string][] = [
    [d.seller.name, 'el nombre del vendedor'], [d.seller.document, 'el documento del vendedor'],
    [d.seller.address, 'la dirección del vendedor'], [d.seller.phone, 'el celular del vendedor'],
    [d.buyer.name, 'el nombre del comprador'], [d.buyer.document, 'la cédula del comprador'],
    [d.device.brand, 'la marca del equipo'], [d.device.model, 'el modelo del equipo'], [d.device.imei, 'el IMEI 1'],
  ];
  const miss = need.find(([v]) => !clean(v));
  if (miss) throw new BusinessError(`Falta ${miss[1]}.`);
  if (!(d.price > 0)) throw new BusinessError('Escriba el precio que paga.');
  if (!d.method || d.method === CREDIT_METHOD) throw new BusinessError('Elija con qué medio paga (efectivo, transferencia…).');
  if (!d.imeiVerified) throw new BusinessError('Confirme que verificó que el IMEI no está reportado como hurtado o perdido.');
}

export async function buyUsedPhone(actor: Actor, d: UsedDraft, products: Product[]) {
  validateUsed(d);
  const [unit] = cleanUnits([{ imei: d.device.imei, imei2: d.device.imei2, condition: 'USADO', color: d.device.color }]);
  const brand = canonicalBrand(clean(d.device.brand));
  const model = clean(d.device.model);
  const existing = findPhoneProduct(products, brand, model);
  const sku = existing ? '' : nextSku('EQUIPO', products);

  return backend.transaction(async (tx) => {
    // ---------- LECTURAS ----------
    const number = await readNext(tx, 'usedPurchases');
    const sessionId = d.outsideCash ? null : await requireOpenSession(tx);
    await assertImeisFree(tx, [unit]);
    let product = existing ? await tx.get<Product>('products', existing.id) : null;

    // ---------- ESCRITURAS ----------
    writeCounter(tx, 'usedPurchases', number);
    if (!product) {
      const data: Omit<Product, 'id'> = {
        sku, type: 'EQUIPO', name: `${brand} ${model}`.trim(), brand, model, color: '',
        cost: d.price, price: d.salePrice || 0, stock: 0, minStock: 0, warrantyMonths: 0,
        line: 'Equipos', active: true, category: 'Celulares', ...created(actor),
      };
      const id = tx.create('products', data as unknown as Record<string, unknown>);
      product = { ...data, id } as Product;
    }
    const contract: Omit<UsedPurchase, 'id'> = {
      number,
      date: d.date || new Date().toISOString().slice(0, 10),
      city: clean(d.city),
      seller: {
        name: clean(d.seller.name), document: clean(d.seller.document), documentCity: clean(d.seller.documentCity),
        address: clean(d.seller.address), phone: clean(d.seller.phone), landline: clean(d.seller.landline),
      },
      buyer: { name: clean(d.buyer.name), document: clean(d.buyer.document), documentCity: clean(d.buyer.documentCity) },
      device: { brand, model, color: unit.color ?? '', imei: unit.imei, imei2: unit.imei2 ?? '' },
      price: d.price,
      method: d.method,
      salePrice: d.salePrice || 0,
      imeiVerified: true,
      ...(d.outsideCash ? { outsideCash: true } : {}),
      productId: product.id,
      productName: product.name,
      createdByName: actor.name,
      ...created(actor),
    };
    const cid = tx.create('usedPurchases', contract as unknown as Record<string, unknown>);
    writeUnits(tx, actor, product, [{ ...unit, notes: `Compraventa N.º ${number}` }], {
      cost: d.price, supplierName: contract.seller.name, price: d.salePrice || undefined, usedPurchaseId: cid, usedPurchaseNumber: number,
    });
    moveStock(tx, actor, product, 1, 'compra', {
      refType: 'usedPurchase', refId: cid, refNumber: number, note: `Compraventa usado N.º ${number} · ${contract.seller.name}`,
    });
    if (sessionId) writeMovement(tx, actor, sessionId, {
      direction: 'egreso',
      category: 'pago_proveedor',
      method: d.method,
      amount: d.price,
      description: `Compraventa usado N.º ${number} · ${contract.seller.name} · ${product.name} IMEI ${unit.imei}`,
      refType: 'usedPurchase',
      refId: cid,
    });
    return { ...contract, id: cid } as UsedPurchase;
  });
}

/**
 * El contrato descontó de la caja, pero se pagó con dinero de afuera: devuelve ese valor a la caja
 * (reintegro «Pago a proveedor») y deja el contrato como «Fuera de caja».
 * Solo mientras siga abierto el turno en que se registró; si ya se cerró, la diferencia quedó en ese arqueo.
 */
export async function moveUsedOutsideCash(actor: Actor, contractId: string, movementId: string) {
  return backend.transaction(async (tx) => {
    const c = await tx.get<UsedPurchase>('usedPurchases', contractId);
    if (!c) throw new BusinessError('Contrato no encontrado.');
    if (c.outsideCash) throw new BusinessError('Este contrato ya está como «Fuera de caja».');
    const m = await tx.get<CashMovement>('cashMovements', movementId);
    if (!m || m.refId !== contractId || m.direction !== 'egreso') throw new BusinessError('No se encontró el pago de este contrato en la caja.');
    const st = await tx.get<CashState>('meta', 'cash');
    if (st?.openSessionId !== m.sessionId) {
      throw new BusinessError('Ese pago es de un turno que ya se cerró: la diferencia quedó en ese arqueo y ya no se puede devolver aquí.');
    }
    // ---- escrituras ----
    writeMovement(tx, actor, m.sessionId, {
      direction: 'ingreso',
      category: 'pago_proveedor',
      method: m.method,
      amount: m.amount,
      description: `Reintegro: compraventa N.º ${c.number} pagada por fuera de la caja`,
      refType: 'usedPurchase',
      refId: contractId,
    });
    const now = new Date().toISOString();
    tx.update('usedPurchases', contractId, { outsideCash: true, cashReversedAt: now, cashReversedBy: actor.name, ...touched() });
  });
}

// ---------------- Corregir y anular contratos ----------------
export interface UsedFix {
  date: string;
  city: string;
  seller: UsedSeller;
  buyer: UsedPurchase['buyer'];
  color: string;
  price: number;
  method: string;
  salePrice: number;
}

/**
 * Corrige un contrato (solo administrador). La marca, el modelo y el IMEI no se cambian aquí: para eso se anula.
 * - Precio pagado o medio: si se pagó desde la caja, la diferencia se ajusta en la caja abierta
 *   (vuelve como reintegro de «Pago a proveedor» o sale como egreso). El costo del equipo se actualiza si sigue en el local.
 * - Precio de venta, color y nombre del vendedor pasan al equipo.
 */
export async function editUsedPurchase(actor: Actor, id: string, fix: UsedFix, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la corrección.');
  if (!fix.seller.name.trim() || !fix.seller.document.trim()) throw new BusinessError('Falta el nombre o el documento del vendedor.');
  if (!(fix.price > 0)) throw new BusinessError('El precio pagado debe ser mayor que cero.');
  if (!fix.method || fix.method === CREDIT_METHOD) throw new BusinessError('Elija el medio de pago.');
  return backend.transaction(async (tx) => {
    const c = await tx.get<UsedPurchase>('usedPurchases', id);
    if (!c) throw new BusinessError('Contrato no encontrado.');
    if (c.status === 'anulado') throw new BusinessError('El contrato está anulado.');
    const unit = await tx.get<PhoneUnit>('phoneUnits', c.device.imei);
    const moneyChanged = fix.price !== c.price || fix.method !== c.method;
    const sid = moneyChanged && !c.outsideCash ? await requireOpenSession(tx) : null;
    // ---- escrituras ----
    const why = reason.trim();
    if (sid) {
      const desc = `Corrección compraventa N.º ${c.number} · ${fix.seller.name.trim()}: ${why}`;
      const back = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'ingreso', category: 'pago_proveedor', method, amount, description: desc, refType: 'usedPurchase', refId: c.id });
      const out = (amount: number, method: string) => writeMovement(tx, actor, sid, { direction: 'egreso', category: 'pago_proveedor', method, amount, description: desc, refType: 'usedPurchase', refId: c.id });
      if (fix.method === c.method) {
        const diff = fix.price - c.price;
        if (diff > 0) out(diff, c.method); else if (diff < 0) back(-diff, c.method);
      } else {
        back(c.price, c.method);
        out(fix.price, fix.method);
      }
    }
    if (unit && unit.usedPurchaseId === c.id) {
      const inStore = unit.status === 'disponible' || unit.status === 'remisionado';
      tx.update('phoneUnits', unit.id, {
        supplierName: fix.seller.name.trim(),
        color: fix.color.trim(),
        ...(inStore ? { cost: fix.price, ...(fix.salePrice ? { price: fix.salePrice } : {}) } : {}),
        ...touched(),
      });
    }
    const before = { date: c.date, city: c.city, seller: c.seller, buyer: c.buyer, device: c.device, price: c.price, method: c.method, salePrice: c.salePrice };
    tx.update('usedPurchases', c.id, {
      date: fix.date || c.date,
      city: fix.city.trim(),
      seller: { ...fix.seller, name: fix.seller.name.trim(), document: fix.seller.document.trim() },
      buyer: fix.buyer,
      device: { ...c.device, color: fix.color.trim() },
      price: fix.price,
      method: fix.method,
      salePrice: fix.salePrice || 0,
      edits: [...(c.edits ?? []), { at: new Date().toISOString(), by: actor.name, reason: why, before }],
      ...touched(),
    });
  });
}

/**
 * Anula un contrato hecho con error (solo administrador): el equipo sale del inventario (kardex «anulación de compra»),
 * queda «anulado» y su IMEI libre para registrarlo bien. Si se pagó desde la caja, el dinero vuelve a la caja abierta.
 * Solo si el equipo sigue en el local (no vendido ni en remisión).
 */
export async function voidUsedPurchase(actor: Actor, id: string, reason: string) {
  if (!reason.trim()) throw new BusinessError('Escriba el motivo de la anulación.');
  return backend.transaction(async (tx) => {
    const c = await tx.get<UsedPurchase>('usedPurchases', id);
    if (!c) throw new BusinessError('Contrato no encontrado.');
    if (c.status === 'anulado') throw new BusinessError('El contrato ya está anulado.');
    const unit = await tx.get<PhoneUnit>('phoneUnits', c.device.imei);
    if (unit && unit.usedPurchaseId === c.id && unit.status !== 'disponible') {
      throw new BusinessError(unit.status === 'vendido' ? `El equipo ya se vendió (factura ${unit.invoiceNumber}): anule primero la venta.` : 'El equipo está en una remisión: primero regístrelo como devuelto.');
    }
    const product = await tx.get<Product>('products', c.productId);
    const sid = !c.outsideCash ? await requireOpenSession(tx) : null;
    // ---- escrituras ----
    const why = reason.trim();
    if (unit && unit.usedPurchaseId === c.id) {
      if (product) moveStock(tx, actor, product, -1, 'anulacion_compra', { refType: 'usedPurchase', refId: c.id, refNumber: c.number, note: `Anulación compraventa N.º ${c.number}: ${why}` });
      tx.update('phoneUnits', unit.id, { status: 'anulado', voidReason: `Compraventa N.º ${c.number} anulada: ${why}`, voidedAt: new Date().toISOString(), voidedBy: actor.name, ...touched() });
    }
    if (sid) {
      writeMovement(tx, actor, sid, {
        direction: 'ingreso', category: 'pago_proveedor', method: c.method, amount: c.price,
        description: `Anulación compraventa N.º ${c.number} · ${c.seller.name}: ${why}`, refType: 'usedPurchase', refId: c.id,
      });
    }
    tx.update('usedPurchases', c.id, { status: 'anulado', voidReason: why, voidedAt: new Date().toISOString(), voidedBy: actor.name, ...touched() });
  });
}

// ---------------- Valor en letras (para el contrato) ----------------
const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 30 ? U[r] : `${D[Math.floor(r / 10)]}${r % 10 ? ` y ${U[r % 10]}` : ''}`;
  return [C[c], rest].filter(Boolean).join(' ');
}

/** 1.250.000 → «un millón doscientos cincuenta mil». */
export function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'cero';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  n %= 1_000_000;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const apocope = (s: string) => (s.endsWith('veintiuno') ? s.replace(/veintiuno$/, 'veintiún') : s.replace(/uno$/, 'un'));
  if (millions) parts.push(millions === 1 ? 'un millón' : `${apocope(numberToWords(millions))} millones`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(under1000(thousands))} mil`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

/** «doscientos cincuenta mil pesos» / «un millón de pesos». */
export const pesosInWords = (n: number) => {
  const w = numberToWords(n);
  return `${w}${/(millón|millones)$/.test(w) ? ' de' : ''} pesos m/cte`;
};
