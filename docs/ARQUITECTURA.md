# DIGITAL CELL PRO — Arquitectura del proyecto

Documento de referencia, escrito antes de programar. Explica de dónde sale cada módulo, cómo se
guardan los datos y qué reglas de negocio se respetan.

## 1. Material revisado (fuentes)

| Fuente | Qué aporta |
| --- | --- |
| **Digital Cell POS** (Google Sheets, versión del 01/11/2026) | Es el sistema que se usa hoy. Tiene 20 hojas: Panel, Métricas, Punto de venta, Ventas, Taller, Inventario, Equipos (IMEI), Compras, Proveedores, Garantías, Reclamos, Historial IMEI, Clientes, Gastos y pagos, Cierre de caja, Contabilidad, Técnicos, Libro de caja, Configuración y Cómo usar. Los modelos de datos de esta app salen de sus columnas. |
| **Digital_Cell_PRO_MVP_v2_factura_whatsapp_correo.zip** | Un MVP anterior hecho en HTML/JS con Firebase (Hosting y Firestore), con envío de factura por WhatsApp y por correo. De ahí salen la elección de Firebase como nube y el envío de comprobantes por WhatsApp y correo. |
| CAJA_EMPRESARIAL_PRO_v2.xlsx y otras versiones de caja | El panel gerencial (ingresos, egresos, utilidad, cartera con proveedores, valor del inventario) y el arqueo de caja por medio de pago. |
| RUT y Cámara de Comercio | Los datos fiscales del encabezado de la factura. **No se copian al código**: se escriben en *Configuración* dentro de la app. |

Ningún archivo existente se modifica ni se borra. La app es un proyecto nuevo y la hoja de cálculo
sigue funcionando como hasta ahora. De ella se copian **solo los datos base** (configuración del
negocio, clientes, inventario y técnicos) con el importador de *Configuración* (ver §10). El
historial (ventas, órdenes y movimientos de caja) no se migra.

## 2. Stack tecnológico

| Capa | Tecnología | Motivo |
| --- | --- | --- |
| Interfaz | **React 18 + TypeScript + Vite** | Es una SPA rápida y tipada, y la compilación sale como archivos estáticos para Firebase Hosting. |
| Navegación | React Router 6 | Rutas por módulo y protegidas por rol. |
| Estilos | CSS propio con *design tokens* (negro, blanco, rojo) | Sin dependencias de UI pesadas. Tema claro y oscuro. |
| Iconos | lucide-react | Iconos lineales y minimalistas. |
| Base de datos en la nube | **Cloud Firestore** | Es la misma nube del MVP anterior. Funciona en tiempo real y sin conexión, con transacciones atómicas para el stock y los consecutivos. |
| Autenticación | **Firebase Authentication** (correo y contraseña) | Roles guardados en `users/{uid}`. |
| Hosting | Firebase Hosting | `npm run deploy`. |
| Modo demo | Adaptador `localStorage` | La app funciona sin credenciales de Firebase, para probarla o hacer una demostración. |

### Capa de datos intercambiable

```
 Páginas (React) ──► Servicios de dominio (src/services) ──► Backend (interfaz)
                                                               ├─ FirestoreBackend  (nube, producción)
                                                               └─ LocalBackend      (demo, navegador)
```

Las páginas **nunca** escriben directamente en la base de datos. Todo pasa por los servicios
(`orders.ts`, `inventory.ts`, `billing.ts`, `cash.ts`…). Los servicios ejecutan la regla de negocio
dentro de una **transacción** (`backend.transaction`). Así, descontar stock, crear el movimiento de
kardex y asignar el consecutivo ocurre todo junto o no ocurre.

Si existen las variables `VITE_FIREBASE_*`, se usa Firestore. Si no, la app arranca en **modo demo**
con datos de ejemplo y lo indica en la barra superior.

## 3. Módulos

| # | Módulo | Ruta | Equivalente en la hoja actual |
| --- | --- | --- | --- |
| 1 | Panel administrativo | `/` | Panel, Métricas |
| 2 | Clientes | `/clientes` | Clientes |
| 3 | Servicio técnico: órdenes de reparación | `/taller` | Taller |
| 3 | Servicio técnico: tickets de soporte (garantías, reclamos, consultas) | `/tickets` | Garantías, Reclamos |
| 4 | Inventario con kardex | `/inventario` | Inventario, Compras (entradas) |
| 5 | Técnicos | `/tecnicos` | Técnicos |
| 5 | Usuarios y roles | `/usuarios` | — (nuevo) |
| 6 | Facturación (POS) | `/facturacion` | Punto de venta, Ventas |
| 6 | Caja: apertura, movimientos y arqueo | `/caja` | Gastos y pagos, Cierre de caja, Libro de caja |
| — | Configuración del negocio | `/configuracion` | Configuración |

## 4. Modelo de datos (colecciones de Firestore)

Todos los documentos llevan `createdAt` y `updatedAt` (ISO 8601) y `createdBy` (uid).

### `settings/business`
`name`, `slogan`, `nit`, `address`, `city`, `phone`, `email`, `ticketFooter`,
`paymentMethods[]` (Efectivo, Transferencia, Nequi, Daviplata, Tarjeta, Crédito tienda),
`expenseCategories[]`, `defaultWarrantyDays`, `taxRate` (0 por defecto, porque el negocio es *no
responsable de IVA*), `partsDiscountStock` (bool).

### `counters/{orders|invoices|tickets}`
`{ value }`: consecutivos de OT, factura y ticket. Se incrementan en transacción, así que no se repiten.

### `users/{uid}`
`name`, `email`, `role` (`admin` · `cajero` · `tecnico`), `active`, `technicianId?`.

### `technicians`
`name`, `phone`, `specialty`, `active`, `commissionPct`, `userId?`. Un técnico puede ser externo y
no tener usuario (por ejemplo, «Técnico Juan visores»).

### `customers`
`document`, `name`, `phone`, `email`, `address`, `notes`. Las estadísticas (tickets, total comprado,
órdenes) se calculan a partir de facturas y órdenes, no se guardan duplicadas.

### `products`
`sku`, `type` (`ACCESORIO` · `REPUESTO` · `EQUIPO` · `SERVICIO`), `name`, `brand`, `model`, `color`,
`cost`, `price`, `stock`, `minStock`, `warrantyMonths`, `line` (Accesorios · Servicio técnico ·
Equipos), `active`.

### `stockMovements` (kardex, solo se agregan registros)
`productId`, `productName`, `kind` (`entrada` · `salida` · `ajuste`), `qty` (con signo), `reason`
(`compra` · `venta` · `reparacion` · `devolucion_reparacion` · `ajuste` · `anulacion`), `refType`,
`refId`, `refNumber`, `unitCost`, `stockAfter`.

### `repairOrders` (órdenes de trabajo, OT)
`number`, `customerId`, `customer{name,phone,document}` (copia del cliente), `device{brand, model,
imei, color, unlockCode, accessories, condition}`, `reportedIssue`, `diagnosis`, `technicianId`,
`technicianName`, `status`, `priority`, `promisedAt`, `budget`, `laborPrice`, `technicianPay`,
`parts[]{productId, name, qty, unitCost, unitPrice}`, `deposits[]{amount, method, at}`,
`warrantyDays`, `deliveredAt`, `invoiceId`, `timeline[]{at, by, status, note}`.

Estados (tomados de *Configuración*): `Recibido → En diagnóstico → Esperando aprobación →
Esperando repuesto → En reparación → Reparado / Listo → Entregado`, más `No reparado`.

### `tickets` (soporte y posventa)
`number`, `type` (`garantia` · `reclamo` · `consulta` · `seguimiento`), `subject`, `description`,
`customerId`, `customerName`, `repairOrderId?`, `imei?`, `priority`, `status` (`abierto` ·
`en_proceso` · `esperando_cliente` · `resuelto` · `cerrado`), `assignedTo`, `comments[]`.

### `invoices` (facturas o comprobantes POS)
`number`, `customerId?`, `customer{...}`, `items[]{productId?, description, kind (producto ·
repuesto · mano_obra · servicio), qty, unitPrice, unitCost, imei?}`, `subtotal`, `discount`, `tax`,
`total`, `payments[]{method, amount}`, `repairOrderId?`, `status` (`pagada` · `credito` ·
`anulada`), `cashSessionId`.

### `cashSessions` (turnos de caja)
`status` (`abierta` · `cerrada`), `openedAt`, `openedBy`, `openingCash`, `closedAt`, `closedBy`,
`expected{metodo: valor}`, `counted{metodo: valor}`, `difference`, `notes`.

### `cashMovements` (libro de caja, solo se agregan registros)
`sessionId`, `direction` (`ingreso` · `egreso`), `category` (`venta` · `abono_cliente` · `gasto` ·
`pago_proveedor` · `pago_tecnico` · `retiro` · `anulacion`), `method`, `amount`, `description`,
`refType`, `refId`.

## 5. Reglas de negocio clave

1. **Repuestos conectados al inventario.** Al agregar un repuesto a una OT, la misma transacción
   descuenta el stock y registra la salida en el kardex con el motivo `reparacion` y la referencia a
   la OT. Si se quita el repuesto, el stock se devuelve con el motivo `devolucion_reparacion`. No se
   permite dejar el stock en negativo.
2. **Cobro de la OT.** «Facturar orden» toma la mano de obra y los repuestos de la OT como líneas
   de factura. Los repuestos **no** vuelven a descontar stock, porque ya salieron. Se restan los
   abonos recibidos, la orden pasa a *Entregado* con la garantía calculada y el pago queda en la caja.
3. **Venta directa.** Los productos vendidos en el POS descuentan stock y registran la salida en el
   kardex con el motivo `venta`. Los servicios no manejan stock.
4. **Caja.** Para facturar o registrar abonos y gastos se necesita una caja abierta. Cada pago de una
   factura crea un `cashMovement` por cada medio de pago. En el arqueo, el efectivo esperado es la
   base más los ingresos en efectivo menos los egresos en efectivo. En los demás medios solo cuenta
   lo que entró. El *Crédito tienda* no entra en caja: queda como cuenta por cobrar del cliente.
   Esto replica la lógica de la hoja *Cierre de caja*.
5. **Anulación.** Una factura nunca se borra: se marca como `anulada`. El stock se devuelve y la
   caja registra un egreso de anulación. Solo puede hacerlo un administrador.
6. **Pago a técnicos.** Cada OT entregada suma el `technicianPay` al saldo del técnico. Los pagos
   se registran como egreso de caja de categoría `pago_tecnico`, igual que en la hoja *Técnicos*.
7. **Consecutivos.** Los números de OT, factura y ticket salen de `counters` dentro de una
   transacción.

## 6. Roles y permisos

| Permiso | admin | cajero | tecnico |
| --- | :-: | :-: | :-: |
| Panel completo y finanzas | ✔ | ✔ | — |
| Clientes | ✔ | ✔ | ver |
| Órdenes de reparación | ✔ | ✔ | las asignadas: diagnóstico, estado y repuestos |
| Tickets | ✔ | ✔ | ✔ |
| Inventario: ver | ✔ | ✔ | ✔ |
| Inventario: crear, editar y ajustar | ✔ | entradas | — |
| Facturación y caja | ✔ | ✔ | — |
| Anular facturas | ✔ | — | — |
| Técnicos, usuarios y configuración | ✔ | — | — |

Los permisos se aplican dos veces: en la interfaz (`src/auth/permissions.ts`) y en la nube
(`firestore.rules`), donde no se pueden saltar.

**Primer administrador:** el primer usuario que se registra en una base vacía queda como `admin`.
La regla usa el documento `meta/bootstrap`, que solo se puede crear una vez.

## 7. Estructura de carpetas

```
├── docs/ARQUITECTURA.md      este documento
├── firebase.json             Hosting y Firestore
├── firestore.rules           seguridad por rol
├── firestore.indexes.json
├── .env.example              variables VITE_FIREBASE_*
└── src/
    ├── data/                 interfaz Backend y adaptadores Firestore y Local, hooks
    ├── services/             reglas de negocio (transacciones)
    ├── auth/                 sesión, roles y permisos
    ├── lib/                  tipos, formato COP y fechas, utilidades
    ├── components/           layout, tablas, modales, documentos imprimibles
    └── pages/                un archivo por módulo
```

## 8. Diseño visual

- La paleta es negro `#0A0A0A`, blanco `#FFFFFF` y rojo `#E10600` como acento único para acciones
  primarias, alertas y estado activo. Los grises neutros sirven de soporte.
- La barra lateral es negra con un indicador rojo. El contenido va sobre fondo claro, y hay tema
  oscuro completo.
- La tipografía es *Inter* para la interfaz y *JetBrains Mono* para números, IMEI y consecutivos.
- Las tarjetas son planas, con bordes de 1 px, sin sombras pesadas, con densidad de información
  alta y espacio amplio.
- El comprobante de venta se imprime en formato tirilla de 80 mm y la OT como recibo de ingreso. También se
  pueden enviar por WhatsApp y por correo, como en el MVP anterior.

## 9. Hoja de ruta (siguientes fases)

**Fuera del alcance:**
- Facturación electrónica DIAN. La app emite comprobantes POS internos (tirilla, WhatsApp y
  correo) y no se integrará con un proveedor de facturación electrónica.
- Migración del historial. Las ventas, órdenes de taller y movimientos de caja anteriores se
  quedan en las hojas de cálculo; la app solo recibe los datos base (ver §10).

1. Métricas avanzadas y libro fiscal de operaciones diarias (DIAN).
2. Portal del cliente para consultar el estado de su OT con el número y el teléfono.

## 10. Importación de datos base

*Configuración → Importar datos anteriores* (solo administrador) carga un archivo JSON:

```json
{
  "version": 1,
  "source": "Digital Cell POS",
  "settings":    { "name": "...", "nit": "...", "address": "...", "phone": "..." },
  "customers":   [{ "document": "", "name": "", "phone": "", "email": "", "address": "", "notes": "" }],
  "technicians": [{ "name": "", "phone": "", "specialty": "", "active": true }],
  "products":    [{ "sku": "", "type": "ACCESORIO", "name": "", "cost": 0, "price": 0, "stock": 0, "minStock": 0 }]
}
```

- Se omite lo que ya existe: clientes por documento o nombre, productos por SKU o nombre y técnicos
  por nombre. Por eso se puede repetir sin duplicar.
- El stock de cada producto entra como movimiento *Stock inicial* en el kardex.
- En la configuración solo se reemplazan los campos que vienen con valor.
- El archivo con los datos reales **no se guarda en el repositorio**, porque contiene datos personales
  de clientes.

## 11. Compras y proveedores

Colecciones `suppliers` (nombre, NIT, celular, plazo en días) y `purchases` (consecutivo C-0001,
proveedor, ítems, total, `paymentType` contado/crédito, vencimiento, `paid`, `payments[]`, estado).

- **Compra a crédito:** el stock entra de inmediato (kardex `compra` con referencia a la compra), el
  dinero no sale de caja y queda en *Por pagar* con fecha de vencimiento según el plazo del proveedor.
- **Compra de contado:** exige caja abierta y registra un egreso `pago_proveedor` por el total.
- **Abono:** sale de la caja abierta y se aplica a las compras pendientes, de la más antigua a la más
  reciente (pendiente → parcial → pagada).
- **Saldo anterior:** al crear un proveedor se puede registrar lo que ya se le debía; queda como una
  compra a crédito de tipo `saldo_inicial`, sin movimiento de inventario.
- Las compras no se borran; en Firestore solo se pueden actualizar sus campos de pago.

## 12. Venta sin inventario

- **Producto sin control de stock** (`products.trackStock = false`): se vende y se usa en
  reparaciones sin límite de cantidad; no mueve stock, no genera kardex ni alertas de reposición.
  Equivale a «¿Los accesorios descuentan inventario? NO» de la hoja anterior. Los servicios nunca
  llevan stock.
- **Artículo libre**: en el POS se puede vender una línea que no está en el catálogo (descripción,
  precio y costo); en una OT, un *repuesto libre* (`parts[].productId` vacío). No tocan inventario,
  pero el precio, el costo y la utilidad quedan en la factura y en la caja.

## 13. Celulares por IMEI

Los productos tipo `EQUIPO` siempre controlan inventario y se manejan **unidad por unidad**:

- `phoneUnits/{IMEI}`: un documento por celular (IMEI 1 y 2, modelo, condición nuevo/usado, costo,
  proveedor, compra, estado `disponible`/`vendido`, factura, cliente, precio y garantía).
- `imeiIndex/{IMEI}`: reserva cada IMEI (principal y secundario). Como el id del documento es el
  IMEI y la regla solo permite crearlo si no existe, **un IMEI no puede registrarse dos veces**.
- Validación: IMEI de 15 dígitos con dígito de control (Luhn), o serial alfanumérico (iPad, etc.).
- **Entrada:** solo con IMEI, en *Inventario → Ingresar* o en una compra a proveedor (un IMEI por
  unidad). El stock suelto (stock inicial, entradas o ajustes al alza) está bloqueado para celulares.
- **Venta:** en el POS se escoge el IMEI exacto (o se escribe o escanea en el buscador); la factura
  rechaza celulares sin IMEI, IMEI vendidos o de otro modelo. Al vender se calcula la garantía con
  los meses del producto. Anular la factura devuelve el equipo a *disponible*.
- Los celulares no se pueden usar como repuesto de una orden de reparación.

## 14. App instalable y apertura sin internet (PWA)

- `public/manifest.webmanifest` e íconos: la app se instala en Windows, Android e iPhone como
  aplicación independiente («Instalar Digital Cell» en Chrome / «Agregar a pantalla de inicio»).
- `public/sw.js` (service worker): al instalarse guarda `index.html` y los archivos JS/CSS que usa.
  Navegación: red primero y, sin internet, la copia guardada. Archivos con hash: caché primero.
  Firestore no pasa por el service worker: usa su propia caché persistente.
- Sin internet se puede **abrir la app y consultar** lo ya sincronizado. Las operaciones con
  transacción (facturar, órdenes, caja, inventario, compras, IMEI) necesitan conexión; si se
  intentan sin internet se muestra un mensaje claro y aparece el aviso «Sin conexión · solo consulta».
- `firebase.json` marca `sw.js`, `index.html` y el manifiesto como `no-cache` para que cada
  publicación llegue de inmediato.

## 15. Compras a crédito sin inventario

- Una compra puede tener **líneas libres** (`items[].productId` vacío): registran el costo y la deuda
  con el proveedor, sin mover stock ni kardex.
- Los productos marcados «sin inventario» también se compran a crédito: actualizan el costo y crean
  la deuda, pero no suman stock.
- Atajo «Lo compré a un proveedor» al agregar un **repuesto libre a una OT** o un **artículo libre
  en el POS**: crea en el mismo paso la compra (crédito = deuda; contado = egreso de caja). El
  repuesto de la OT queda con el número de compra y el proveedor.

## 16. Contabilidad

Módulo `/contabilidad` (admin y cajero). Todo se calcula en vivo a partir de facturas, caja, compras
e inventario (`src/services/accounting.ts`); no hay datos contables que digitar aparte.

- **Período:** hoy, 7 días, este mes, mes anterior, este año o rango de fechas.
- **Estado de resultados (P&G):** ingresos por línea (Equipos, Accesorios, Servicio técnico; el tipo
  del producto decide la línea), descuentos, costo de lo vendido, utilidad bruta, gastos (caja,
  categoría «gasto») y utilidad neta. El costo de la mano de obra es el pago al técnico de la OT;
  por eso los pagos a técnicos en caja no se restan de nuevo como gasto.
- **Libro fiscal de operaciones diarias** (no responsables de IVA): ingresos de dinero (ventas,
  abonos, otros ingresos; las anulaciones restan) y egresos (gastos, proveedores, técnicos) por día.
  Los retiros del dueño no cuentan.
- **Libro de caja:** todos los movimientos del período.
- **Resumen del negocio hoy:** inventario a costo (celulares y productos controlados), cuentas por
  cobrar (crédito tienda), cuentas por pagar y valor neto aproximado.
- **Tope de no responsable de IVA:** ventas del año contra `uvtValue × ivaCapUvt` (Configuración).
- **Exportar a Excel:** CSV con BOM y punto y coma, para que Excel en español lo abra bien.

## 17. Vendedores y comisiones

- Colección `sellers`: nombre, celular, `commissionPct`, `commissionBase` (`venta` = % sobre lo
  vendido sin IVA y con descuento; `utilidad` = % sobre venta − costo), `lines` (líneas de negocio
  donde gana comisión; vacío = todas) y `userId` si tiene acceso a la app.
- En el POS se elige el vendedor (por defecto el vinculado al usuario). La factura guarda
  `sellerId`, `sellerName`, `commissionPct`, `commissionBase` y `commission` calculada al vender:
  cambiar el porcentaje después no altera ventas ya hechas, y anular la factura elimina la comisión.
- Pago: Caja → «Pago a vendedor» (`pago_vendedor`, `refId` = vendedor). Por pagar = comisiones de
  facturas no anuladas − pagos.
- Contabilidad: las comisiones se restan en el P&G cuando se vende (por eso el pago en caja no se
  resta otra vez); en el libro fiscal el pago es un egreso.
- Reglas: `sellers` lectura para el personal, escritura solo administrador.

## 18. Automatizaciones

Se calculan solas con los datos existentes (`src/services/automation.ts`); no necesitan servidor.

- **Pendientes de hoy** (Panel): órdenes atrasadas, listas sin recoger ≥ 3 días (con botón de
  WhatsApp al cliente), órdenes sin técnico, deudas con proveedores vencidas o que vencen en ≤ 3 días,
  stock bajo, caja de un día anterior sin cerrar, saldos por pagar a técnicos y vendedores, y
  recordatorio semanal de respaldo. Ordenadas por urgencia.
- **Aviso al cliente:** al pasar una OT a «Reparado / Listo» se ofrece el mensaje de WhatsApp listo.
- **Resumen del día** (Panel): ventas por línea, utilidad, gastos y órdenes al WhatsApp del negocio.
- **Reposición sugerida** (Compras): uso de 30 días → cantidad para ~15 días + mínimo, agrupada por
  el último proveedor; «Crear compra» deja la compra prellenada.
- **Respaldo:** descarga de todas las colecciones en JSON (Configuración).

## 19. Inteligencia artificial (Claude)

`src/services/ai.ts`, SDK oficial `@anthropic-ai/sdk` desde el navegador, modelo `claude-opus-5-5`,
con `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): si el modelo declina por políticas,
el servidor reintenta con su modelo de respaldo.

- **Diagnóstico con IA** (orden de reparación): causas probables, pruebas, repuestos del inventario,
  dificultad y mensaje para el cliente (salida estructurada con Zod).
- **Leer factura con IA** (Compras): foto o PDF → proveedor, número, forma de pago e ítems relacionados
  con los productos del inventario (o artículos libres) e IMEI → compra prellenada para revisar.
- **Asistente del negocio** (`/asistente`): chat que responde con un resumen JSON de ventas, P&G por
  período, más vendidos, órdenes, stock, reposición, deudas, técnicos y vendedores.
- **Desactivada por defecto:** mientras no haya una clave activa, la app oculta el menú «Asistente IA»
  y los botones «Diagnóstico con IA» y «Leer factura con IA» (`useAiEnabled`). No genera ningún costo.
- **Clave de API:** la guarda el administrador en Configuración (`secrets/ai`, lectura solo para el
  personal con sesión). Como la llamada sale del navegador, la clave es visible para el personal:
  usar una clave exclusiva con límite de gasto en console.anthropic.com. Para ocultarla del todo,
  mover estas llamadas a una Cloud Function (requiere el plan Blaze de Firebase).

## 20. Marcas y modelos de celulares

- `src/lib/brands.ts`: lista de marcas comerciales (Samsung, Apple, Xiaomi, Motorola, Huawei, Honor,
  Oppo, Vivo, Realme, Tecno, Infinix…) y sub-marcas que se agrupan (Redmi/Poco → Xiaomi,
  iPhone → Apple, Galaxy → Samsung). La marca se escribe siempre igual al salir del campo.
- Los **modelos** no son una lista fija: se arman solos con lo ya registrado en órdenes y productos,
  sin duplicados por mayúsculas o espacios, ordenados de forma natural (Note 9 antes de Note 13).
- **Filtro Marca → Modelo** en Órdenes de reparación, Inventario (productos y celulares por IMEI) y
  Facturación. Solo muestra las marcas que existen en esa lista.
- En «Nueva orden» y en los productos, los campos Marca y Modelo sugieren lo ya registrado.

## 21. Categorías del catálogo

- `products.category` (opcional). Si está vacía, la categoría se **adivina** por tipo y nombre
  (`src/lib/categories.ts`): Celulares, Cargadores, Cables, Forros y estuches, Vidrios y protectores,
  Audífonos y parlantes, Memorias y USB, Relojes y bandas, Soportes y holders, Sim cards y recargas,
  Accesorios varios, Repuestos y Servicios. Se puede escribir una propia (por ejemplo «Ofertas»).
- **Facturación:** barra de categorías con conteo y catálogo agrupado por categoría; combina con la
  búsqueda y el filtro de marca y modelo.
- **Inventario:** filtro por categoría y categoría visible en la lista.

## 22. Ingreso rápido de datos

- **Enter = botón principal** en todas las ventanas (Guardar, Crear, Registrar…), salvo en textos
  largos, listas y botones.
- **Valores rápidos** en todos los campos de dinero: `120k`/`120 mil` = 120.000, `2m` = 2.000.000,
  `1,5m` = 1.500.000 (`parseMoney`).
- **Producto nuevo:** solo nombre y costo. El tipo y la marca se adivinan por el nombre, el código se
  genera solo (ACC-0012, REP-0005…), el precio se sugiere con el margen de Configuración (80 % por
  defecto, redondeado a miles) y la categoría es automática. El resto queda en «Más detalles».
- **Nueva orden:** botones rápidos para la falla, los accesorios y el estado físico; fecha de entrega
  con Hoy / Mañana / 2 días / 1 semana; recuerda el último técnico elegido; Enter en el buscador de
  cliente elige el primero.
- **Facturación:** el buscador queda listo al abrir; con lector de código de barras (o escribiendo) el
  SKU o el IMEI + Enter agrega el producto directo.

## 23. Corregir o anular compras

- **Cambiar proveedor** (cajero o admin): corrige `supplierId`/`supplierName` de la compra (y el
  proveedor de sus celulares). La deuda y los abonos pasan solos al proveedor correcto; no toca
  inventario ni caja. Queda anotado en la nota de la compra.
- **Anular compra** (solo admin, con motivo): saca del inventario lo que entró (kardex
  `anulacion_compra`; se niega si ya se vendió o usó), marca sus celulares como `anulado` para que el
  IMEI se pueda volver a ingresar, deja el saldo en 0 y, si se había pagado algo, lo devuelve a la caja
  abierta por el mismo medio (ingreso `pago_proveedor`, que en el libro fiscal resta de los egresos).
  Las compras nunca se borran: quedan «Anuladas».

## 24. Historial por categoría y ganancias diarias

- **Facturación → Historial:** cada comprobante muestra sus categorías (`itemCategory`: la del
  producto; en líneas libres u órdenes se adivina: mano de obra → Servicios, repuesto → Repuestos,
  celular por IMEI → Celulares). Filtro por categoría con el total vendido de esa categoría; el
  buscador también encuentra por producto o categoría.
- **Panel → Ganancias diarias:** por día (7, 15 o 30 días) ventas, costo, utilidad bruta, gastos y
  comisiones, y ganancia neta, con el mismo cálculo de Contabilidad (`buildReport` por día). La tarjeta
  «Ganancia de hoy» reemplaza a «Stock bajo», que ya aparece en Pendientes de hoy.

## 25. Panel empresarial: KPIs y gráficos

- **KPIs fijos** (hoy y mes en curso): Ventas del día, Ingresos del mes, Gastos del mes, Ganancia neta del mes, Efectivo en caja, Productos disponibles, Servicios pendientes y Servicios terminados. Cada uno se compara con el mismo corte del periodo anterior (ayer a esta hora; el mes anterior al mismo día).
- **Definiciones** (iguales a Contabilidad): Ingresos = ventas netas de facturas no anuladas; Gastos = costo de lo vendido + gastos de caja + comisiones; Ganancia neta = Ingresos − Gastos. Retiros del dueño no son gasto. Una orden cuenta como terminada el día en que quedó «Reparado / Listo» (o «Entregado»).
- **Filtros**: Día (24 horas), Semana (lunes a domingo), Mes (cada día) y Año (12 meses), con ‹ › para consultar periodos anteriores. La elección se recuerda en el equipo.
- **Gráficos** (`src/components/charts.tsx`, SVG propio sin librerías): Ventas (la barra del periodo actual en rojo), Ingresos vs gastos, Ganancia neta (línea con área), Servicios técnicos (recibidos vs terminados), Celulares y accesorios vendidos, Comparativo mensual (año vs año anterior) e Inventario disponible por categoría. Todos tienen tooltip y vista de tabla.
- **Cálculo** (`src/services/analytics.ts`): una sola pasada por colección y búsqueda binaria del bucket; todo memorizado. Sin datos ficticios: un periodo vacío muestra «Sin movimientos».
- **Colores de series** validados (tono, croma, daltonismo y contraste) en claro (`#1f5fae`, `#e10600`) y oscuro (`#3d85dc`, `#f2453d`), como tokens `--s1`, `--s2`, `--s-accent`, `--s-ink` y `--s-context`.
- **Adaptación a pantallas**: se corrigieron desbordes horizontales en iPhone (Panel, Taller, Inventario, Facturación, Caja y Contabilidad). Las animaciones respetan «reducir movimiento».

## 26. Medio de pago obligatorio y productos en la caja

- **Facturación:** el medio de pago ya no viene marcado como «Efectivo». Hay que tocar uno (Efectivo, Transferencia, Nequi…) antes de cobrar; mientras falte, el botón Cobrar queda bloqueado y se resalta la elección. El servicio `createInvoice` también rechaza pagos sin medio.
- **Caja → Movimientos del turno:** cada venta muestra debajo los productos de la factura (cantidad, nombre e IMEI si es celular), también para ventas anteriores.

## 27. Respaldo de datos (corrección)

- El respaldo listaba la colección `meta` completa, y las reglas de Firestore solo permiten leer `meta/bootstrap` y `meta/cash`. Por eso Firebase rechazaba el respaldo con «permisos insuficientes». Ahora esos documentos se leen uno por uno.
- Si alguna colección falla, el resto se respalda igual. El archivo trae `incompleto: [...]` y se muestra un aviso.
- En celular se usa «Compartir» (guardar en Archivos o Drive, o enviar por WhatsApp) porque la descarga directa no siempre funciona en iPhone con la app instalada.

## 28. Corregir un gasto

- **Caja → Movimientos del turno → Corregir**, en las filas de gasto. Se puede cambiar el valor, el medio, la descripción y la categoría. El motivo es obligatorio.
- **No se borra nada:** el gasto guarda en `edits` los valores anteriores con fecha, usuario y motivo. En la lista aparece «Corregido por … · antes $X».
- **Permisos:** el cajero corrige solo gastos del turno abierto. El administrador también corrige gastos de turnos cerrados, en la tarjeta «Gastos de turnos anteriores» (últimos 60 días). El arqueo de un turno ya cerrado no cambia, porque guarda sus cifras; Contabilidad y el Panel usan el valor corregido.
- **Reglas de Firestore:** `cashMovements` sigue siendo de solo agregar, salvo esta actualización limitada a gastos, a esos campos, con `edits` creciendo en uno y valor mayor que 0.

## 29. Compraventa de celulares usados

- **Menú → Compraventa usados (`/usados`):** sirve cuando un cliente le vende un celular a la tienda. El formulario pide los datos del vendedor (nombre, documento, expedición, dirección, celular, fijo), del comprador (sale de Configuración → «Comprador en contratos») y del equipo (marca, modelo, color, IMEI 1 y 2), además del precio que se paga, el medio de pago (obligatorio), el precio de venta (opcional) y la casilla «IMEI verificado» (obligatoria).
- **Una sola transacción (`buyUsedPhone`):** asigna el consecutivo `usedPurchases` y guarda el contrato (`usedPurchases`, solo se agregan). El equipo entra por IMEI como **USADO** (`phoneUnits` + `imeiIndex`, el IMEI no se puede repetir). Suma +1 al stock con el kardex «compra» y registra el egreso de la caja abierta como «Pago a proveedor».
- **Producto:** se usa el EQUIPO existente de esa marca y modelo. Si no existe, se crea en Celulares; el cajero puede crearlo porque nace con stock 0. El precio de venta propio queda en la unidad (`price`) y Facturación lo usa al escanear ese IMEI.
- **Contrato imprimible:** tamaño carta, con el valor en letras, cláusulas de propiedad y procedencia lícita, verificación del IMEI y datos personales (Ley 1581 de 2012), y firmas con recuadro de huella. «Imprimir / PDF» → «Guardar como PDF»; el archivo se llama `Contrato-compraventa-0001-Nombre`.
- **Impresión:** al imprimir se oculta `#root`, así ya no sale una primera hoja en blanco (también en los comprobantes).

## 30. Origen de cada celular y anulación de ingresos manuales

- **Inventario → Celulares (IMEI)** muestra de dónde entró cada equipo: «Compra C-0011», «Contrato compraventa N.º 0001» o «Ingreso manual (sin compra)».
- **Ingreso manual:** el botón «Ingresar» solo registra IMEI, sin compra ni caja. Por eso esos equipos no aparecen en Compras, y un aviso lo explica.
- **Anular ingreso** (solo administrador, `voidUnitEntry`): solo aplica a ingresos manuales disponibles. Resta 1 al stock (kardex «ajuste»), deja la unidad `anulado` con motivo y libera el IMEI para registrarlo bien, con Nueva compra o con Compraventa usados. Los equipos que entraron por compra o contrato se anulan desde su origen.

## 31. Comprar sin mover la caja

- **Proveedor:** Nueva compra → «A crédito». No sale dinero de la caja y queda como deuda, que se paga luego con «Abonar».
- **Compraventa usados:** casilla «No descontar de la caja» (`outsideCash`). Es para cuando el pago se hizo con dinero que no está en la caja (del dueño o de la cuenta). No exige caja abierta ni registra egreso, y el equipo entra igual al inventario con su costo. En la lista aparece «Fuera de caja».
- Al vender el equipo, el dinero entra a la caja normalmente y la ganancia se calcula con el costo de compra.
- **Contrato que descontó de la caja por error:** al abrir el contrato aparece «No era de la caja» (`moveUsedOutsideCash`). Registra un reintegro de «Pago a proveedor» por el mismo valor y medio, que anula el egreso, y marca el contrato «Fuera de caja». Solo funciona mientras siga abierto el turno del pago: si ya se cerró, la diferencia quedó en ese arqueo. La regla de Firestore solo permite ese cambio (`outsideCash` de false a true).

## 32. Encontrar una compra

- **Compras → lista:** ahora arranca en «Todas». Antes arrancaba en «Por pagar» y escondía las compras de contado ya pagadas. Al buscar se revisan todas, sin importar el filtro.
- **Inventario → Celulares (IMEI):** «Compra C-0047» es un enlace que abre esa compra (`/compras?compra=<id>`), para verla o anularla. «Contrato compraventa N.º …» lleva a Compraventa usados.

## 33. Redmi como marca y recordatorios

- **Redmi** es ahora una marca propia en la lista de marcas, los filtros y la detección por nombre («Redmi Note 13» → Redmi). Antes se agrupaba en Xiaomi. Los registros viejos que ya decían «Xiaomi» siguen igual. Poco y Mi siguen bajo Xiaomi.
- **Recordatorios** (`reminders`, tarjeta en el Panel para todo el personal): texto con fecha y hora opcional, y atajos «En 1 hora», «Hoy 5 p. m.» y «Mañana 9 a. m.». Se marcan como hechos (y se pueden volver a pendientes) y se eliminan uno por uno o todos los hechos a la vez. Los vencidos se resaltan en rojo y se cuentan en el título. Entran en el respaldo. Regla: cualquier usuario activo los lee, crea, marca y elimina.

## 34. Remisiones (mercancía en consignación)

- **Menú Finanzas → Remisiones (`/remisiones`, permiso de facturación):** registra la mercancía que se entrega a otro local o vendedor. Se escribe el destinatario (nombre, NIT/C.C., celular, dirección), los productos con su precio pactado, los celulares escogiendo el IMEI, una fecha para liquidar (opcional) y una nota.
- **Al remisionar** (`createRemission`): consecutivo `remissions` (R-0001). El stock baja con el kardex «Remisión (consignación)» y los celulares quedan `remisionado` (R-0001 · destinatario). No se pueden vender en una venta normal.
- **Registrar devolución** (`returnRemission`): lo devuelto vuelve al inventario («Devolución de remisión») y los celulares quedan disponibles.
- **Facturar lo vendido:** se escoge qué vendió y el medio de pago (obligatorio). Se crea una factura normal (`createInvoice` con `remissionId`) que entra a la caja, sin descontar stock otra vez (`stockAlreadyMoved`). En la misma transacción la remisión suma lo vendido y guarda la factura. Si esa factura se anula, lo vendido vuelve a quedar pendiente con el destinatario y el celular vuelve a `remisionado`.
- Cuando no queda nada pendiente, la remisión pasa a **Liquidada**. Las remisiones nunca se borran.
- **Documento imprimible / PDF:** tamaño carta, con los datos, los productos y su estado (vendidas, devueltas, pendientes), la cláusula de consignación y las firmas de quien entrega y quien recibe.

## 35. Eliminar productos del inventario

- **Inventario → Productos → papelera** (solo administrador, `archiveProduct`): pide un motivo. El producto queda `archived` e inactivo, y deja de verse en inventario, ventas, compras, remisiones y alertas. No se borra, porque facturas, órdenes y kardex lo nombran.
- Si tenía stock, se da de baja con un **ajuste** en el kardex («Eliminado del inventario: motivo»). Un celular (EQUIPO) con IMEI en inventario no se puede eliminar: primero hay que venderlo o anular su ingreso.
- **Eliminados (n):** lista los productos eliminados con quién y por qué, y tiene el botón **Recuperar** (`restoreProduct`, queda activo con stock 0).

## 36. Productos en el historial de facturación

- **Facturación → Historial:** la columna «Categorías» pasó a ser **«Productos»**. Muestra las primeras 3 líneas de cada comprobante (cantidad, nombre e IMEI) y «y N más…». Al pasar el mouse se ve el detalle completo con valores. El filtro por categoría y su total se mantienen.

## 37. Catálogo de modelos comerciales

- `src/lib/phoneModels.ts` tiene unos 400 modelos de celulares de las marcas que se venden en Colombia: Samsung, Apple, Xiaomi/Poco, Redmi, Motorola, Honor, Huawei, Oppo, Vivo, Realme, Tecno, Infinix, ZTE, Nokia, Google y OnePlus.
- Se suman a las **sugerencias** de marca y modelo (`useBrandModels`) en órdenes, productos, compras y compraventa, junto con los modelos ya registrados (sin repetir). No crean productos. Los **filtros** siguen mostrando solo lo que hay en los datos.
- `canonicalModel` respeta «iPhone» e «iPad» (con i minúscula).
- Para agregar modelos nuevos, se editan las listas del archivo. Cualquier modelo escrito a mano también queda como sugerencia.

## 38. Tamaño de letra

- **Botón «Aa»** en la barra superior: cambia entre **Normal (100 %)**, **Grande (115 %)** y **Muy grande (130 %)**. Se guarda en cada equipo (`dcpro:fontScale`) y se aplica antes de pintar la app (`main.tsx`).
- Todas las medidas de letra de `styles.css` y `design-system.css` usan `calc(Npx * var(--fs-scale))`. Solo crece el texto, no el diseño. Los comprobantes y contratos impresos (`.receipt`, `.contract`) no cambian.
- Se revisaron Panel, Inventario, Facturación, Caja, Taller, Remisiones y Compraventa en computador y celular con los tres tamaños: no se sale nada de la pantalla.

## 39. Accesorios bien clasificados

- `guessType` revisa en este orden: servicio («cambio de…») → **accesorio** → repuesto (pantalla, batería, puerto…) → celular → cable/USB/memoria. Se aceptan plurales y tildes.
- Son accesorios: sim card/simcard/chip/recarga, audífonos (también inalámbricos), buds/airpods/manos libres, vidrio/templado/blindado/antiespía/hidrogel/mica/protector/lentes, forro/funda/estuche/silicona/goma/case, cargador/adaptador/power bank, soporte/holder/popsocket, reloj/correa/manilla.
- Antes «Silicona iPhone 13» quedaba como Celular, y «Lentes», «Protector de pantalla» o «Vidrio pantalla» como Repuesto. Simcard, audífonos, gomas, forros, recargas y antiespía no se reconocían y quedaban como Repuesto (el tipo por defecto).
- **Inventario → aviso «parecen accesorios» → Revisar y corregir** (`looksMisclassifiedAccessory`, `convertToAccessory`): pasa los productos marcados a ACCESORIO (línea Accesorios) sin tocar el stock. Como Contabilidad y el Panel clasifican por el tipo actual del producto, las ventas viejas también pasan a contarse como accesorios.
- Las categorías (Sim cards y recargas, Audífonos y parlantes, Vidrios y protectores, Forros y estuches) reconocen las mismas palabras.

## 40. Tres módulos: Celulares · Accesorios · Servicio técnico

- **Menú** organizado por línea de negocio:
  - General: Panel.
  - **Celulares**: Celulares y Compraventa usados.
  - **Accesorios**: Accesorios y Remisiones.
  - **Servicio técnico**: Servicio técnico, Órdenes y Tickets.
  - **Ventas e inventario**: Facturación, Caja, Clientes, Inventario, Compras y Contabilidad.
  - Administración.
- **Pantalla de cada módulo** (`/celulares`, `/accesorios`, `/servicio`, `LineModule.tsx`):
  - Filtro Hoy / 7 días / Mes / Año.
  - Ventas, costo, ganancia y margen de esa línea, con la misma regla de Contabilidad (`lineOf`). Solo con permiso de finanzas.
  - Últimas ventas de la línea.
  - **Celulares**: equipos en el local por modelo (nuevos y usados, costo), cuántos hay en remisión y compraventas del periodo.
  - **Accesorios**: existencias por categoría, «por pedir» y participación en las ventas.
  - **Servicio técnico**: órdenes por estado, atrasadas, tickets abiertos, repuestos por pedir y reparaciones terminadas. El técnico solo ve sus órdenes.
  - Accesos rápidos: Vender, Comprar, Comprar usado, Remisión, Nueva orden.
- Ninguna pantalla se quitó. Todas siguen en el menú.

## 41. Contabilidad por módulo

- **Contabilidad → pestaña «Por módulo»** (`moduleReport`): estado de resultados de Celulares, Accesorios y Servicio técnico lado a lado, más el total. Muestra ventas, costo, utilidad bruta, comisiones, gastos generales repartidos, utilidad neta, margen neto, participación en ventas y unidades vendidas. Abajo, los más vendidos de cada módulo con su ganancia.
- Ventas y costo usan la misma regla que el resto de Contabilidad (`lineOf`, descuentos repartidos en proporción).
- **Comisiones:** se reparten dentro de cada factura según lo que vendió cada módulo.
- **Gastos generales:** se reparten según la participación en ventas. La última línea absorbe el redondeo, así los tres módulos suman exactamente el total.
- **Exportar a Excel** (CSV) con la tabla y los más vendidos. Respeta el periodo elegido (hoy, 7 días, mes, mes anterior, año o rango).

## 42. Corregir o eliminar un abono de orden

- **Orden de reparación → Abonos → lápiz** (`editDeposit`): se cambia el valor, el medio, o ambos, o se **elimina** el abono. El motivo es obligatorio. Solo se puede mientras la orden no esté facturada (si ya lo está, primero se anula la factura).
- **La caja se cuadra sola en el turno abierto:** si baja el valor, sale la diferencia como «Anulación»; si sube, entra la diferencia como «Abono de cliente»; si cambia el medio, sale el valor viejo del medio viejo y entra el nuevo en el medio nuevo. El libro fiscal queda correcto, porque una anulación de egreso resta ingreso.
- **Historial:** el abono guarda `previous`, `editedBy`, `editedAt` y `editReason`, se muestra «corregido por …» y queda una nota en la línea de tiempo de la orden.
- **Registrar abono:** el medio de pago ahora es obligatorio, con botones (antes venía Efectivo por defecto).

## 43. Corregir o eliminar un pago a proveedor

- **Compras → abrir la compra → Pagos → lápiz** (`editSupplierPayment`): se cambia el valor o el medio de un pago (abono o pago de contado), o se **elimina**. El motivo es obligatorio y no se puede pagar más que el total de la compra.
- **La caja abierta se cuadra sola.** Si el pago baja o cambia de medio, el dinero vuelve a la caja como reintegro de «Pago a proveedor» (resta de los egresos en el libro fiscal). Si sube, sale la diferencia.
- **Saldo y estado** de la compra (pendiente, parcial o pagada) se recalculan, y por eso la deuda con el proveedor queda al día.
- **Historial:** el pago guarda `previous`, `editedBy`, `editedAt` y `editReason`, y se muestra «Corregido por … · antes $X».
- Si un abono se repartió entre varias compras, cada compra guarda su parte y se corrige en cada una.

## 44. Garantía de celulares en la factura

- **Al vender un celular** (Facturación), cada línea con IMEI tiene un selector **Garantía**: Sin garantía, o 1, 2, 3, 6, 12, 18 o 24 meses. Viene con los meses del producto (Inventario → editar → garantía), y se puede bajar o subir en esa venta. Por ejemplo, un usado con 1 mes.
- `createInvoice` guarda en la línea `warrantyMonths` y `warrantyUntil` (fecha de la venta + meses). La unidad (`phoneUnits`) guarda lo mismo, así se ve en Inventario → Celulares si la garantía sigue vigente.
- **Comprobante** (impreso, PDF, WhatsApp y correo): debajo del IMEI sale «Garantía 6 meses · hasta dd/mm/aaaa» o «Sin garantía». Si algún celular tiene garantía, sale también el texto de **condiciones**, editable en Configuración → «Condiciones de garantía de celulares».
- Las facturas anteriores a este cambio no tienen esos datos guardados y no muestran la línea.
