// Pruebas de las reglas de seguridad contra el emulador de Firestore (requiere Java).
// npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, runTransaction, collection } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
const rulesPath = new URL('../firestore.rules', import.meta.url).pathname;
let failed = 0;
const check = async (name, p) => { try { await p; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '-', e.message.split('\n')[0]); } };

{
  const which = 'proyecto';
  console.log('Reglas de Firestore (emulador):');
  const env = await initializeTestEnvironment({ projectId: `demo-${which}`, firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/admin1'), { role: 'admin', active: true, name: 'Admin' });
    await setDoc(doc(db, 'users/caja1'), { role: 'cajero', active: true, name: 'Caja' });
    await setDoc(doc(db, 'counters/invoices'), { value: 10 });
    await setDoc(doc(db, 'counters/purchases'), { value: 5 });
    await setDoc(doc(db, 'suppliers/maxel'), { name: 'maxel', termDays: 30 });
    await setDoc(doc(db, 'suppliers/pavatec'), { name: 'PAVATEC', termDays: 30 });
    await setDoc(doc(db, 'invoices/old'), { number: 3, status: 'pagada', items: [{ description: 'x', unitCost: 0, qty: 1, unitPrice: 1000, kind: 'producto' }] });
    await setDoc(doc(db, 'cashMovements/m1'), { direction: 'egreso', category: 'pago_proveedor', refType: 'manual', amount: 1000, method: 'Efectivo' });
    await setDoc(doc(db, 'purchases/pa'), { number: 1, kind: 'compra', supplierId: 'maxel', total: 300000, paid: 140000, status: 'parcial', payments: [{ at: 'x', amount: 140000, method: 'Efectivo', by: 'a' }] });
    await setDoc(doc(db, 'purchases/pb'), { number: 2, kind: 'compra', supplierId: 'maxel', total: 140000, paid: 0, status: 'pendiente', payments: [] });
    await setDoc(doc(db, 'purchases/si'), { number: 3, kind: 'saldo_inicial', supplierId: 'maxel', total: 500000, paid: 100000, status: 'parcial', payments: [], items: [] });
    await setDoc(doc(db, 'cashMovements/g1'), { direction: 'egreso', category: 'gasto', refType: 'manual', amount: 15000, method: 'Nequi', expenseCategory: 'Otros' });
    await setDoc(doc(db, 'cashMovements/v1'), { direction: 'ingreso', category: 'venta', refType: 'invoice', amount: 15000, method: 'Nequi' });
  });
  for (const uid of ['caja1', 'admin1']) {
    const db = env.authenticatedContext(uid).firestore();
    // venta con encimados de dos proveedores: el consecutivo de compras sube 2
    await check(`${uid}: venta con encimados de 2 proveedores`, assertSucceeds(runTransaction(db, async (t) => {
      const inv = (await t.get(doc(db, 'counters/invoices'))).data().value + 1;
      const pur = (await t.get(doc(db, 'counters/purchases'))).data().value;
      await t.get(doc(db, 'suppliers/maxel')); await t.get(doc(db, 'suppliers/pavatec'));
      t.set(doc(db, 'counters/invoices'), { value: inv });
      t.set(doc(collection(db, 'purchases')), { number: pur + 1, supplierId: 'maxel', total: 4500, paid: 0, status: 'pendiente' });
      t.set(doc(collection(db, 'purchases')), { number: pur + 2, supplierId: 'pavatec', total: 12000, paid: 0, status: 'pendiente' });
      t.set(doc(db, 'counters/purchases'), { value: pur + 2 });
      t.set(doc(collection(db, 'invoices')), { number: inv, status: 'pagada', items: [] });
    })));
  }
  const cdb = env.authenticatedContext('caja1').firestore();
  await check('consecutivo no puede bajar', assertFails(setDoc(doc(cdb, 'counters/purchases'), { value: 1 })));
  await check('consecutivo no puede saltar más de 10', assertFails(updateDoc(doc(cdb, 'counters/purchases'), { value: 999 })));
  const adb = env.authenticatedContext('admin1').firestore();
  await check('admin corrige costo de una venta (costEdits)', assertSucceeds(updateDoc(doc(adb, 'invoices/old'), {
    items: [{ description: 'x', unitCost: 500, qty: 1, unitPrice: 1000, kind: 'producto' }], costEdits: [{ at: 'x', by: 'a', reason: 'r', items: [{ index: 0, unitCost: 0 }] }], updatedAt: 'x' })));
  await check('admin descuenta pago viejo de Caja', assertSucceeds(updateDoc(doc(adb, 'cashMovements/m1'), {
    refType: 'purchase', refId: 'maxel', linkedAt: 'x', linkedBy: 'a', linkedPurchases: [1], updatedAt: 'x' })));
  await check('cajero no puede descontar pago viejo', assertFails(updateDoc(doc(cdb, 'cashMovements/m1'), { refType: 'purchase' })));
  await check('cajero pasa un pago a otra compra (las dos se actualizan)', assertSucceeds(runTransaction(cdb, async (t) => {
    await t.get(doc(cdb, 'purchases/pa')); await t.get(doc(cdb, 'purchases/pb'));
    t.update(doc(cdb, 'purchases/pa'), { paid: 0, payments: [], status: 'pendiente', updatedAt: 'x' });
    t.update(doc(cdb, 'purchases/pb'), { paid: 140000, payments: [{ at: 'x', amount: 140000, method: 'Efectivo', by: 'a', movedFrom: { number: 1, at: 'y', by: 'c', reason: 'r' } }], status: 'pagada', updatedAt: 'x' });
  })));
  await check('admin corrige un saldo anterior', assertSucceeds(updateDoc(doc(adb, 'purchases/si'), { total: 300000, status: 'parcial', edits: [{ at: 'x', by: 'a', reason: 'r', total: 500000, items: [] }], updatedAt: 'x' })));
  await check('cajero no puede corregir un saldo anterior', assertFails(updateDoc(doc(cdb, 'purchases/si'), { total: 100000, edits: [{ at: 'x' }, { at: 'y' }], updatedAt: 'x' })));
  await check('cajero no puede pasar un gasto a pago de técnico', assertFails(updateDoc(doc(cdb, 'cashMovements/g1'), { category: 'pago_tecnico', expenseCategory: 'Pago a técnicos', refType: 'technician', refId: 't1', previousCategory: 'gasto', linkedAt: 'x', linkedBy: 'a', updatedAt: 'x' })));
  await check('admin pasa un gasto a pago de técnico', assertSucceeds(updateDoc(doc(adb, 'cashMovements/g1'), { category: 'pago_tecnico', expenseCategory: 'Pago a técnicos', refType: 'technician', refId: 't1', previousCategory: 'gasto', linkedAt: 'x', linkedBy: 'a', updatedAt: 'x' })));
  await check('…y no lo puede volver a cambiar', assertFails(updateDoc(doc(adb, 'cashMovements/g1'), { refId: 't2', updatedAt: 'y' })));
  await check('una venta no se puede pasar a pago de técnico', assertFails(updateDoc(doc(adb, 'cashMovements/v1'), { category: 'pago_tecnico', expenseCategory: 'Pago a técnicos', refType: 'technician', refId: 't1', previousCategory: 'gasto', linkedAt: 'x', linkedBy: 'a', updatedAt: 'x' })));
  await env.cleanup();
}
console.log(failed ? `\n${failed} revisiones de reglas fallaron` : '\nReglas OK');
process.exit(failed ? 1 : 0);
