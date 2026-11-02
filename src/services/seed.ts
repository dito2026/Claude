// Datos de ejemplo para el MODO DEMO (se crean solo si el navegador no tiene datos).
// Se generan a través de los mismos servicios, así respetan todas las reglas de negocio.
import { backend } from '../data';
import type { LocalBackend } from '../data/local';
import type { Customer, Product, Technician } from '../lib/types';
import { DEFAULT_SETTINGS } from './settings';
import { created, type Actor } from './common';
import { saveProduct } from './inventory';
import { registerUnits } from './phones';
import { addPart, createOrder, setStatus } from './orders';
import { openSession } from './cash';
import { createInvoice } from './billing';

export const DEMO_ACCOUNTS = [
  { email: 'admin@digitalcell.demo', password: 'demo1234', name: 'Administrador', role: 'admin' as const },
  { email: 'caja@digitalcell.demo', password: 'demo1234', name: 'Asesor de caja', role: 'cajero' as const },
  { email: 'tecnico@digitalcell.demo', password: 'demo1234', name: 'Técnico Juan', role: 'tecnico' as const },
];

export async function seedDemo() {
  const local = backend as LocalBackend;
  if (backend.mode !== 'local' || !local.isEmpty()) return;

  await backend.set('settings', 'business', { ...DEFAULT_SETTINGS });

  // Técnicos (de la hoja «Técnicos»)
  const techNames = ['Técnico Juan visores', 'Cristian', 'Caballo'];
  const techs: Technician[] = [];
  for (const name of techNames) {
    const t = { name, phone: '', specialty: 'Celulares', active: true, commissionPct: 0 };
    const id = await backend.create('technicians', { ...t, ...created({ uid: 'seed', name: 'seed' }) });
    techs.push({ ...t, id });
  }

  // Cuentas demo
  const uids: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) {
    const id = await backend.auth.createAccount({ email: a.email, password: a.password });
    uids[a.role] = id;
    await backend.set('users', id, {
      name: a.name,
      email: a.email,
      role: a.role,
      active: true,
      technicianId: a.role === 'tecnico' ? techs[0].id : undefined,
      ...created({ uid: 'seed', name: 'seed' }),
    });
  }
  await backend.update('technicians', techs[0].id, { userId: uids.tecnico });
  const admin: Actor = { uid: uids.admin, name: 'Administrador' };

  // Clientes
  const customers: Customer[] = [];
  for (const c of [
    { document: '1020456789', name: 'Laura Gómez (ejemplo)', phone: '3001234567', email: '', address: '', notes: '' },
    { document: '1088123456', name: 'Andrés Restrepo (ejemplo)', phone: '3109876543', email: '', address: '', notes: 'Cliente frecuente' },
    { document: '', name: 'Consumidor final', phone: '', email: '', address: '', notes: '' },
  ]) {
    const id = await backend.create('customers', { ...c, ...created(admin) });
    customers.push({ ...c, id });
  }

  // Inventario
  const base = { brand: '', model: '', color: '', warrantyMonths: 0, active: true };
  const items: Omit<Product, 'id'>[] = [
    { ...base, sku: 'ACC-0007', type: 'ACCESORIO', name: 'Cargador tipo C', cost: 10000, price: 20000, stock: 25, minStock: 2, line: 'Accesorios' },
    { ...base, sku: 'ACC-0002', type: 'ACCESORIO', name: 'Cable tipo C', brand: 'Xiaomi', color: 'Negro', cost: 2500, price: 15000, stock: 10, minStock: 2, line: 'Accesorios' },
    { ...base, sku: 'ACC-0010', type: 'ACCESORIO', name: 'Vidrio templado (blindado)', cost: 1500, price: 20000, stock: 40, minStock: 10, line: 'Accesorios' },
    { ...base, sku: 'REP-0001', type: 'REPUESTO', name: 'Pantalla Huawei Y70', brand: 'Huawei', model: 'Y70', cost: 65000, price: 0, stock: 3, minStock: 1, line: 'Servicio técnico' },
    { ...base, sku: 'REP-0002', type: 'REPUESTO', name: 'Batería Vivo Y33S', brand: 'Vivo', model: 'Y33S', cost: 28000, price: 0, stock: 2, minStock: 1, line: 'Servicio técnico' },
    { ...base, sku: 'REP-0003', type: 'REPUESTO', name: 'Puerto de carga Samsung A35', brand: 'Samsung', model: 'Galaxy A35', cost: 18000, price: 0, stock: 1, minStock: 2, line: 'Servicio técnico' },
    { ...base, sku: 'REP-0004', type: 'REPUESTO', name: 'Visor iPhone 11', brand: 'Apple', model: 'iPhone 11', cost: 95000, price: 0, stock: 4, minStock: 1, line: 'Servicio técnico' },
    { ...base, sku: 'SRV-0001', type: 'SERVICIO', name: 'Revisión / diagnóstico', cost: 0, price: 15000, stock: 0, minStock: 0, line: 'Servicio técnico' },
    { ...base, sku: 'SRV-0002', type: 'SERVICIO', name: 'Actualización de software', cost: 0, price: 30000, stock: 0, minStock: 0, line: 'Servicio técnico' },
    { ...base, sku: 'EQ-0001', type: 'EQUIPO', name: 'Samsung Galaxy A15 128GB', brand: 'Samsung', cost: 520000, price: 680000, stock: 2, minStock: 1, warrantyMonths: 6, line: 'Equipos' },
  ];
  const pid: Record<string, string> = {};
  for (const p of items) pid[p.sku] = await saveProduct(admin, p);
  await registerUnits(admin, pid['EQ-0001'], [
    { imei: '351234567890124', condition: 'NUEVO', color: 'Negro' },
    { imei: '351234567890132', condition: 'NUEVO', color: 'Azul' },
  ], { cost: 520000, supplierName: 'Nano', note: 'Ejemplo', alreadyInStock: false });

  // Caja y operación de ejemplo
  await openSession(admin, 200000);
  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const device = (brand: string, model: string) => ({
    brand, model, imei: '', color: '', unlockCode: '', accessories: 'Sin accesorios', condition: 'Rayones leves',
  });

  const o1 = await createOrder(admin, {
    customer: customers[0], device: device('Huawei', 'Y70'), reportedIssue: 'Pantalla rota, no da imagen',
    technicianId: techs[1].id, technicianName: techs[1].name, technicianUserId: '', priority: 'normal',
    promisedAt: inTwoDays, budget: 120000, laborPrice: 55000, technicianPay: 30000, warrantyDays: 30,
    intakeDeposit: { amount: 50000, method: 'Nequi' },
  });
  await addPart(admin, o1.id, pid['REP-0001'], 1, 65000);
  await setStatus(admin, o1.id, 'Reparado / Listo', 'Pantalla instalada y probada');

  const o2 = await createOrder(admin, {
    customer: customers[1], device: device('Vivo', 'Y33S'), reportedIssue: 'La batería se descarga rápido',
    technicianId: techs[0].id, technicianName: techs[0].name, technicianUserId: uids.tecnico, priority: 'alta',
    promisedAt: yesterday, budget: 70000, laborPrice: 30000, technicianPay: 15000, warrantyDays: 30,
  });
  await addPart(admin, o2.id, pid['REP-0002'], 1, 40000);
  await setStatus(admin, o2.id, 'En reparación');

  await createOrder(admin, {
    customer: customers[1], device: device('Samsung', 'Galaxy A35'), reportedIssue: 'No carga, puerto flojo',
    technicianId: techs[2].id, technicianName: techs[2].name, technicianUserId: '', priority: 'normal',
    promisedAt: inTwoDays, budget: 84000, laborPrice: 0, technicianPay: 0, warrantyDays: 30,
  });

  await createInvoice(admin, {
    customer: { name: 'Consumidor final', phone: '', document: '' },
    items: [
      { productId: pid['ACC-0010'], description: 'Vidrio templado (blindado)', kind: 'producto', qty: 2, unitPrice: 20000, unitCost: 1500 },
      { productId: pid['ACC-0007'], description: 'Cargador tipo C', kind: 'producto', qty: 1, unitPrice: 20000, unitCost: 10000 },
    ],
    discount: 0, taxRate: 0, payments: [{ method: 'Efectivo', amount: 60000 }], cashierName: 'Administrador',
  });
}
