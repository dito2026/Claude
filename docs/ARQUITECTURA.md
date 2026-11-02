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
sigue funcionando como hasta ahora. Más adelante puede servir como fuente para migrar los datos (ver §9).

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

**Fuera del alcance:** facturación electrónica DIAN. La app emite comprobantes POS internos
(tirilla, WhatsApp y correo) y no se integrará con un proveedor de facturación electrónica.

1. Importar los datos desde *Digital Cell POS* (clientes, inventario, técnicos y órdenes abiertas).
2. Equipos por IMEI: compra, venta, garantía y el *historial clínico por IMEI*.
3. Proveedores, compras a crédito y cuentas por pagar.
4. Métricas avanzadas y libro fiscal de operaciones diarias (DIAN).
5. Portal del cliente para consultar el estado de su OT con el número y el teléfono.
