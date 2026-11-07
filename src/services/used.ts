// Compraventa de celulares usados: el cliente le vende un equipo a la tienda.
// En una sola transacción: contrato numerado, equipo al inventario por IMEI (USADO),
// kardex «compra» y egreso de la caja abierta.
import { backend } from '../data';
import type { Product, UsedPurchase, UsedSeller } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { normalize } from '../lib/format';
import { canonicalBrand } from '../lib/brands';
import { BusinessError, created, readNext, writeCounter, type Actor } from './common';
import { moveStock, nextSku } from './inventory';
import { assertImeisFree, cleanUnits, writeUnits } from './phones';
import { requireOpenSession, writeMovement } from './cash';

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
