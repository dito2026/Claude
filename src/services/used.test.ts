import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { CashMovement, PhoneUnit, Product, UsedPurchase } from '../lib/types';
import { openSession } from './cash';
import { saveProduct } from './inventory';
import { createInvoice } from './billing';
import { buyUsedPhone, numberToWords, pesosInWords, type UsedDraft } from './used';
import type { Actor } from './common';

const actor: Actor = { uid: 'u1', name: 'Tester' };
beforeEach(() => (backend as LocalBackend).reset());

// IMEI válidos (dígito de Luhn correcto)
const IMEI = '490154203237518';
const IMEI2 = '356938035643809';

const draft = (over: Partial<UsedDraft> = {}): UsedDraft => ({
  date: '2026-11-06', city: 'Pereira',
  seller: { name: 'Pedro Pérez', document: '1088000000', documentCity: 'Pereira', address: 'Cra 7 # 17-21', phone: '3001234567', landline: '' },
  buyer: { name: 'Dueño Tienda', document: '123', documentCity: 'Pereira' },
  device: { brand: 'samsung', model: 'Galaxy A15 128GB', color: 'Negro', imei: IMEI, imei2: IMEI2 },
  price: 250000, method: 'Efectivo', salePrice: 380000, imeiVerified: true, ...over,
});

describe('compraventa de usados', () => {
  it('contrato numerado, equipo USADO al inventario por IMEI, kardex y egreso de caja', async () => {
    await openSession(actor, 500000);
    const c = await buyUsedPhone(actor, draft(), []);
    expect(c.number).toBe(1);
    expect((await backend.list<UsedPurchase>('usedPurchases'))).toHaveLength(1);
    const p = (await backend.list<Product>('products'))[0];
    expect(p).toMatchObject({ type: 'EQUIPO', name: 'Samsung Galaxy A15 128GB', stock: 1 });
    const u = (await backend.get<PhoneUnit>('phoneUnits', IMEI))!;
    expect(u).toMatchObject({ condition: 'USADO', status: 'disponible', cost: 250000, price: 380000, supplierName: 'Pedro Pérez', usedPurchaseNumber: 1 });
    expect(await backend.get('imeiIndex', IMEI2)).toBeTruthy();
    const [m] = await backend.list<CashMovement>('cashMovements');
    expect(m).toMatchObject({ direction: 'egreso', category: 'pago_proveedor', amount: 250000, method: 'Efectivo', refType: 'usedPurchase' });
    // el mismo IMEI no puede entrar dos veces
    await expect(buyUsedPhone(actor, draft({ device: { ...draft().device, imei2: '' } }), [])).rejects.toThrow(/ya está registrado/);
  });

  it('usa el producto existente del modelo y se vende con su propio precio', async () => {
    await openSession(actor, 0);
    const pid = await saveProduct(actor, { sku: 'CEL-0001', type: 'EQUIPO', name: 'Samsung Galaxy A15 128GB', brand: 'Samsung', model: 'Galaxy A15 128GB', color: '', cost: 400000, price: 520000, stock: 0, minStock: 0, warrantyMonths: 6, line: 'Equipos', active: true });
    const products = await backend.list<Product>('products');
    await buyUsedPhone(actor, draft({ device: { ...draft().device, brand: 'Samsung' } }), products);
    expect(await backend.list('products')).toHaveLength(1);
    expect((await backend.get<Product>('products', pid))!.stock).toBe(1);
    await createInvoice(actor, {
      customer: { name: 'CF', phone: '', document: '' },
      items: [{ productId: pid, description: 'Samsung Galaxy A15 (usado)', kind: 'producto', qty: 1, unitPrice: 380000, unitCost: 250000, imei: IMEI, unitId: IMEI }],
      discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 380000 }], cashierName: 'T',
    });
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.status).toBe('vendido');
  });

  it('valida datos, IMEI, medio de pago, verificación y caja abierta', async () => {
    await expect(buyUsedPhone(actor, draft(), [])).rejects.toThrow(/caja/);
    await openSession(actor, 0);
    await expect(buyUsedPhone(actor, draft({ seller: { ...draft().seller, document: '' } }), [])).rejects.toThrow(/documento del vendedor/);
    await expect(buyUsedPhone(actor, draft({ imeiVerified: false }), [])).rejects.toThrow(/verificó/);
    await expect(buyUsedPhone(actor, draft({ method: '' }), [])).rejects.toThrow(/medio/);
    await expect(buyUsedPhone(actor, draft({ device: { ...draft().device, imei: '490154203237519' } }), [])).rejects.toThrow();
    expect(await backend.list('usedPurchases')).toHaveLength(0);
  });

  it('valor en letras', () => {
    expect(numberToWords(250000)).toBe('doscientos cincuenta mil');
    expect(numberToWords(1250000)).toBe('un millón doscientos cincuenta mil');
    expect(numberToWords(21000)).toBe('veintiún mil');
    expect(numberToWords(101500)).toBe('ciento un mil quinientos');
    expect(numberToWords(2000000)).toBe('dos millones');
    expect(pesosInWords(1000000)).toBe('un millón de pesos m/cte');
    expect(pesosInWords(380000)).toBe('trescientos ochenta mil pesos m/cte');
  });
});

describe('anular ingreso manual de un celular', () => {
  it('saca el equipo del stock, libera el IMEI y luego entra bien por compraventa', async () => {
    const { registerUnits, voidUnitEntry } = await import('./phones');
    await openSession(actor, 0);
    const pid = await saveProduct(actor, { sku: 'CEL-0001', type: 'EQUIPO', name: 'Samsung A07 128GB', brand: 'Samsung', model: 'A07 128GB', color: '', cost: 0, price: 0, stock: 0, minStock: 0, warrantyMonths: 0, line: 'Equipos', active: true });
    await registerUnits(actor, pid, [{ imei: IMEI, condition: 'USADO' }], { cost: 250000, supplierName: '', note: '', alreadyInStock: false });
    expect((await backend.get<Product>('products', pid))!.stock).toBe(1);
    await expect(voidUnitEntry(actor, IMEI, '')).rejects.toThrow(/motivo/);
    await voidUnitEntry(actor, IMEI, 'Lo registro como compraventa');
    expect((await backend.get<Product>('products', pid))!.stock).toBe(0);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.status).toBe('anulado');
    const products = await backend.list<Product>('products');
    await buyUsedPhone(actor, draft({ device: { brand: 'Samsung', model: 'A07 128GB', color: '', imei: IMEI, imei2: '' } }), products);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!).toMatchObject({ status: 'disponible', usedPurchaseNumber: 1 });
    expect((await backend.get<Product>('products', pid))!.stock).toBe(1);
    // los que entraron por contrato o compra no se anulan aquí
    await expect(voidUnitEntry(actor, IMEI, 'x')).rejects.toThrow(/contrato/);
  });
});

describe('compraventa pagada por fuera de la caja', () => {
  it('no exige caja abierta ni registra egreso; el equipo entra igual', async () => {
    const c = await buyUsedPhone(actor, draft({ outsideCash: true }), []);
    expect(c.outsideCash).toBe(true);
    expect(await backend.list('cashMovements')).toHaveLength(0);
    expect((await backend.get<PhoneUnit>('phoneUnits', IMEI))!.status).toBe('disponible');
    expect((await backend.list<Product>('products'))[0].stock).toBe(1);
  });
});
