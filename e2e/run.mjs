// Pruebas en el navegador de DIGITAL CELL PRO (modo demo, datos locales).
// Uso: npm run e2e   — compila la versión demo, la sirve y recorre los flujos principales.
// Requiere el paquete «playwright» con Chromium (en GitHub Actions se instala solo).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'e2e', '.dist');
const PORT = Number(process.env.E2E_PORT || 4321);
const BASE = `http://localhost:${PORT}`;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta playwright. Instálelo con: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

process.env.VITE_DEMO = '1';
const vite = await import('vite');
await vite.build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await vite.preview({ root, logLevel: 'warn', preview: { port: PORT, strictPort: true }, build: { outDir } });

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([false, name, e.message.split('\n')[0]]);
    console.log(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 3).join(' · ')}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const ROUTES = ['/', '/celulares', '/accesorios', '/servicio', '/taller', '/tickets', '/clientes', '/inventario', '/facturacion',
  '/caja', '/remisiones', '/compras', '/usados', '/contabilidad', '/vendedores', '/configuracion'];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function login(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/');
  await page.fill('input[type=email]', 'admin@digitalcell.demo');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button:has-text("Entrar")');
  await page.waitForSelector('.sidebar');
  return { ctx, page, errors };
}

try {
  for (const [label, opts] of [['computador', { viewport: { width: 1366, height: 900 } }], ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    await check(`todas las pantallas abren sin errores ni desbordes (${label})`, async () => {
      const { ctx, page, errors } = await login(opts);
      const bad = [];
      for (const r of ROUTES) {
        await page.goto(BASE + r);
        await page.waitForTimeout(350);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 0) bad.push(`${r} se sale ${over}px`);
      }
      await ctx.close();
      assert(errors.length === 0, `errores: ${errors.join(' | ')}`);
      assert(bad.length === 0, bad.join(', '));
    });
  }

  const { ctx, page, errors } = await login({ viewport: { width: 1366, height: 900 } });

  await check('vender exige elegir el medio de pago', async () => {
    await page.goto(BASE + '/facturacion');
    await page.locator('.product-grid > *', { hasText: 'Cargador' }).first().click();
    const cobrar = page.locator('button:has-text("Cobrar")');
    assert(await cobrar.isDisabled(), 'Cobrar debía estar bloqueado sin medio de pago');
    await page.click('.pay-methods button:has-text("Efectivo")');
    assert(await cobrar.isEnabled(), 'Cobrar no se habilitó al elegir Efectivo');
    await cobrar.click();
    await page.waitForSelector('.toast:has-text("Venta registrada")');
    await page.keyboard.press('Escape');
  });

  await check('venta sin costo: avisa, se escribe el costo ahí y luego se corrigen las ventas en $0', async () => {
    await page.goto(BASE + '/inventario');
    await page.click('button:has-text("Nuevo producto")');
    await page.fill('.modal label.field:has-text("Nombre") input', 'Forro prueba sin costo');
    await page.fill('.modal label.field:has-text("Precio de venta") input', '15000');
    await page.fill('.modal label.field:has-text("¿Cuántos tiene?") input', '5');
    await page.click('.modal button:has-text("Guardar")');
    await page.waitForSelector('.toast:has-text("Producto guardado")');
    // 1) al venderlo sin costo aparece el aviso con la casilla de costo
    await page.goto(BASE + '/facturacion');
    const search = page.locator('input[placeholder^="Buscar, escanear"]');
    await search.fill('Forro prueba sin costo');
    await search.press('Enter');
    await page.waitForSelector('.cost-missing');
    // 2) se vende sin escribir el costo (queda en $0)
    await page.click('.pay-methods button:has-text("Efectivo")');
    await page.click('button:has-text("Cobrar")');
    await page.waitForSelector('.toast:has-text("Venta registrada")');
    await page.keyboard.press('Escape');
    // 3) al ponerle el costo al producto, ofrece corregir esa venta
    await page.goto(BASE + '/inventario');
    await page.fill('input[placeholder^="SKU, nombre"]', 'Forro prueba sin costo');
    await page.locator('tr:has-text("Forro prueba sin costo") button[title*="ditar"]').first().click();
    await page.fill('.modal label.field:has-text("Costo") input', '6000');
    await page.click('.modal button:has-text("Guardar")');
    await page.waitForSelector('.modal:has-text("Ventas que quedaron sin costo")');
    await page.click('.modal button:has-text("Poner el costo a 1 venta")');
    await page.waitForSelector('.toast:has-text("Costo puesto en 1 venta")');
  });

  await check('la caja muestra la venta con su ganancia', async () => {
    await page.goto(BASE + '/caja');
    const row = page.locator('.card:has-text("Movimientos del turno") tbody tr').filter({ hasText: 'Cargador' }).first();
    await row.waitFor();
    assert(/\$\s?[\d.]+\s*\$\s?[\d.]+/.test(await row.innerText()), 'no se ve valor y ganancia');
    await page.waitForSelector('.stat:has-text("Ganancia del turno")');
  });

  await check('un gasto exige elegir el medio', async () => {
    await page.click('.page-head button:has-text("Gasto")');
    await page.locator('.modal input.input').first().fill('15000');
    await page.locator('.modal input.input').last().fill('Prueba e2e');
    const reg = page.locator('.modal button:has-text("Registrar")');
    assert(await reg.isDisabled(), 'Registrar debía estar bloqueado sin medio');
    await page.click('.modal .pay-methods button:has-text("Nequi")');
    await reg.click();
    await page.waitForSelector('.toast:has-text("Movimiento registrado")');
  });

  await check('venta a crédito y cobro parcial', async () => {
    await page.goto(BASE + '/facturacion');
    await page.fill('input[placeholder^="Buscar cliente"]', 'Laura');
    await page.locator('input[placeholder^="Buscar cliente"]').press('Enter');
    await page.locator('.product-grid > *', { hasText: 'Cargador' }).first().click();
    await page.click('.pay-methods button:has-text("Crédito tienda")');
    await page.click('button:has-text("Cobrar")');
    await page.waitForSelector('.toast:has-text("Venta registrada")');
    await page.keyboard.press('Escape');
    await page.click('.page-head .seg button:has-text("Historial")');
    await page.click('.seg button:has-text("Por cobrar")');
    await page.locator('tbody button:has-text("Cobrar")').first().click();
    await page.locator('.modal input').first().fill('5000');
    await page.click('.modal .pay-methods button:has-text("Efectivo")');
    await page.click('.modal button:has-text("Cobrar $")');
    await page.waitForSelector('.toast:has-text("Abono registrado")');
  });

  await check('compraventa de usado: contrato, inventario y anulación', async () => {
    await page.goto(BASE + '/usados');
    await page.click('button:has-text("Nuevo contrato")');
    const f = (label, v) => page.locator(`.modal label.field:has(span:text-is("${label}")), .modal label.field:has(span:text-is("${label} *"))`).locator('input').first().fill(v);
    await f('Nombres y apellidos', 'Prueba E2E');
    await f('Documento de identidad', '123456');
    await f('Dirección de residencia', 'Calle 1');
    await f('Celular', '3000000000');
    await f('Nombre', 'Dueño');
    await f('Cédula', '999');
    await f('Marca', 'Samsung');
    await f('Modelo', 'Galaxy A15 128GB');
    await f('IMEI 1', '490154203237518');
    await page.locator('.modal label.field:has-text("Precio que paga") input').fill('100000');
    await page.click('.modal .pay-methods button:has-text("Efectivo")');
    await page.check('.modal label.checkbox:has-text("Verifiqué") input');
    await page.click('.modal button:has-text("Guardar, cargar")');
    await page.waitForSelector('.modal .contract');
    await page.click('.modal button:has-text("Anular")');
    await page.fill('.modal input[placeholder^="Motivo"]', 'prueba');
    await page.click('.modal button:has-text("Confirmar anulación")');
    await page.waitForSelector('.modal .alert.error:has-text("Contrato anulado")');
    await page.keyboard.press('Escape');
  });

  await check('inventario inicial de celulares avisa que no es una compra', async () => {
    await page.goto(BASE + '/inventario');
    await page.locator('button:has-text("Inventario inicial")').first().click();
    await page.waitForSelector('.modal .alert:has-text("Solo para celulares que ya tenía")');
    await page.keyboard.press('Escape');
  });

  await check('abono a proveedor exige elegir el medio', async () => {
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.click('button:has-text("Nuevo proveedor")');
    await page.locator('.modal input').first().fill('Proveedor E2E');
    await page.locator('.modal label.field:has-text("Saldo anterior") input').fill('50000');
    await page.click('.modal .modal-foot button.primary');
    await page.locator('tr:has-text("Proveedor E2E") button:has-text("Abonar")').click();
    const reg = page.locator('.modal button:has-text("Registrar abono")');
    assert(await reg.isDisabled(), 'Registrar abono debía estar bloqueado sin medio');
    await page.click('.modal .pay-methods button:has-text("Transferencia")');
    await reg.click();
    await page.waitForSelector('.toast:has-text("Abono registrado")');
  });

  await check('estado de cuenta del proveedor muestra cuánto se le debe', async () => {
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.click('button:has-text("Nuevo proveedor")');
    await page.locator('.modal input').first().fill('Cuenta E2E');
    await page.locator('.modal label.field:has-text("Saldo anterior") input').fill('120000');
    await page.click('.modal .modal-foot button.primary');
    await page.locator('tr:has-text("Cuenta E2E") button:has-text("Estado de cuenta")').click();
    await page.waitForSelector('.modal .stat:has-text("Le debe")');
    const txt = await page.locator('.modal').innerText();
    assert(txt.includes('Total que le debe') && txt.includes('120.000'), 'no muestra la deuda de 120.000');
    await page.keyboard.press('Escape');
  });

  await check('Caja → Pago a proveedor pide el proveedor y baja su deuda', async () => {
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.click('button:has-text("Nuevo proveedor")');
    await page.locator('.modal input').first().fill('Pepe E2E');
    await page.locator('.modal label.field:has-text("Saldo anterior") input').fill('80000');
    await page.click('.modal .modal-foot button.primary');
    await page.waitForSelector('tr:has-text("Pepe E2E")');
    await page.goto(BASE + '/caja');
    await page.click('button:has-text("Pago a proveedor")');
    const sel = page.locator('.modal label.field:has-text("Proveedor") select');
    await sel.waitFor();
    const reg = page.locator('.modal button:has-text("Registrar abono")');
    assert(await reg.isDisabled(), 'sin proveedor no se debía poder registrar');
    const opt = await page.locator('.modal select option', { hasText: 'Pepe E2E' }).first().getAttribute('value');
    await sel.selectOption(opt);
    await page.click('.modal button:has-text("Pagar todo")');
    await page.click('.modal .pay-methods button:has-text("Efectivo")');
    await reg.click();
    await page.waitForSelector('.toast:has-text("Abono registrado · Pepe E2E")');
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.waitForSelector('tr:has-text("Pepe E2E")');
    assert(await page.locator('tr:has-text("Pepe E2E") button:has-text("Abonar")').count() === 0, 'la deuda debía quedar en 0');
  });

  await check('nueva orden con abono inicial exige el medio', async () => {
    await page.goto(BASE + '/taller?nueva=1');
    await page.waitForSelector('.modal');
    await page.fill('.modal input[placeholder^="Buscar cliente"]', 'Laura');
    await page.locator('.modal input[placeholder^="Buscar cliente"]').press('Enter');
    await page.locator('.modal label.field:has-text("Abono inicial") input').fill('20000');
    assert(await page.locator('.modal .pay-methods').count() === 1, 'no aparecen los botones de medio del abono');
    assert(await page.locator('.modal button:has-text("Crear orden")').isDisabled(), 'Crear orden debía estar bloqueado sin medio del abono');
    await page.keyboard.press('Escape');
  });

  await check('encimar vidrio: viene con 1.500 y Maxel, obsequio en $0, deuda al proveedor y resumen', async () => {
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.click('button:has-text("Nuevo proveedor")');
    await page.locator('.modal input').first().fill('Maxel');
    await page.click('.modal .modal-foot button.primary');
    await page.waitForSelector('tr:has-text("Maxel")');
    await page.goto(BASE + '/facturacion');
    await page.locator('.product-grid > *', { hasText: 'Cargador' }).first().click();
    await page.click('button:has-text("Encimar vidrio")');
    await page.waitForSelector('.modal:has-text("Encimar vidrio")');
    const price = await page.locator('.modal label.field:has-text("Precio que le cobra") input').inputValue();
    assert(price === '1.500', `el precio por defecto debía ser 1.500 y es ${price}`);
    const sup = await page.locator('.modal label.field:has-text("Proveedor") select option:checked').innerText();
    assert(sup.trim() === 'Maxel', `el proveedor por defecto debía ser Maxel y es ${sup}`);
    await page.locator('.modal button:has-text("Encimar")').last().click();
    await page.waitForSelector('.gift-note:has-text("se le debe a Maxel")');
    await page.click('.pay-methods button:has-text("Efectivo")');
    await page.click('button:has-text("Cobrar")');
    await page.waitForSelector('.toast:has-text("Venta registrada")');
    await page.keyboard.press('Escape');
    await page.goto(BASE + '/contabilidad');
    await page.click('.tabs button:has-text("Encimados")');
    await page.waitForSelector('.stat:has-text("Gasto en encimados"):has-text("1.500")');
    await page.waitForSelector('td:has-text("Maxel")');
    await page.goto(BASE + '/compras');
    await page.click('.tabs button:has-text("Proveedores")');
    await page.waitForSelector('tr:has-text("Maxel") button:has-text("Abonar")');
  });

  await check('sin internet: la app abre y cambia de pantalla (pantallas guardadas)', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => {
      const keys = await (await caches.open('dcpro-app-v1')).keys();
      return keys.filter((k) => k.url.includes('/assets/')).length > 20;
    }, null, { timeout: 15000 });
    await ctx.setOffline(true);
    try {
      for (const r of ['/compras', '/contabilidad', '/configuracion']) {
        await page.goto(BASE + r);
        await page.waitForSelector('.sidebar');
        await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('Cargando…'), null, { timeout: 8000 });
      }
    } finally {
      await ctx.setOffline(false);
    }
  });

  await check('cambiar de usuario: el técnico entra con sus permisos y sin datos del anterior', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('.sidebar');
    await page.click('button[title="Cerrar sesión"]');
    await page.fill('input[type=email]', 'tecnico@digitalcell.demo');
    await page.fill('input[type=password]', 'demo1234');
    await page.click('button:has-text("Entrar")');
    await page.waitForSelector('.sidebar');
    assert(await page.locator('.sidebar a[href="/caja"]').count() === 0, 'el técnico no debía ver Caja');
    await page.goto(BASE + '/taller');
    await page.waitForSelector('.sidebar');
    await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('Cargando…'), null, { timeout: 8000 });
    await page.goto(BASE + '/caja');
    await page.waitForSelector('main:has-text("No tiene permiso")');
  });

  await check('sin errores de la página durante los flujos', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });
  await ctx.close();
} finally {
  await browser.close();
  server.httpServer.close();
}

const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} pruebas en el navegador pasaron.`);
process.exit(failed.length ? 1 : 0);
