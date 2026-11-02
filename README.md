# DIGITAL CELL PRO

Aplicación empresarial para **Digital Cell** (celulares, accesorios y servicio técnico). Reemplaza
y amplía la hoja *Digital Cell POS* con:

1. **Panel administrativo**: ventas, utilidad, efectivo en caja, órdenes atrasadas y alertas de stock.
2. **Clientes**: historial de compras, órdenes y saldo a crédito.
3. **Servicio técnico**: órdenes de reparación (OT) con estados, historial, abonos y recibo
   imprimible, más **tickets de soporte** para garantías, reclamos y seguimiento.
4. **Inventario conectado a las reparaciones**: cada repuesto usado en una OT se descuenta del
   stock y queda en el **kardex** con la referencia a la orden.
5. **Técnicos y usuarios** con roles (Administrador, Cajero y Técnico) y saldo por pagar a cada técnico.
6. **Facturación POS y caja**: pagos mixtos, comprobante en tirilla de 80 mm, envío por WhatsApp
   y correo, anulaciones, apertura de caja, gastos y arqueo por medio de pago.
7. **Base de datos en la nube**: Cloud Firestore con reglas de seguridad por rol. Funciona sin
   conexión y sincroniza en tiempo real.

La arquitectura completa y las reglas de negocio están en **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

## Probar en 1 minuto (modo demo)

```bash
npm install
npm run dev
```

Si no se configura Firebase, la app arranca en **modo demo** con datos de ejemplo guardados solo
en el navegador. Cuentas de prueba (contraseña `demo1234`):

| Rol | Correo |
| --- | --- |
| Administrador | admin@digitalcell.demo |
| Cajero | caja@digitalcell.demo |
| Técnico | tecnico@digitalcell.demo |

## Conectar la nube (Firebase)

1. Cree un proyecto en <https://console.firebase.google.com> y active **Authentication → Correo y
   contraseña** y **Firestore Database**.
2. Registre una app web y copie su configuración en `.env.local`, usando `.env.example` como guía.
3. Publique las reglas de seguridad:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add            # elija su proyecto
   firebase deploy --only firestore:rules
   ```
4. Ejecute `npm run dev`, entre en **«¿Primera instalación? Crear administrador»** y cree el primer
   usuario. Solo funciona una vez, con la base vacía. Los demás usuarios se crean desde
   *Usuarios y roles*.
5. Para publicar en internet, ejecute `npm run deploy` (Firebase Hosting).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Revisión de tipos y compilación de producción en `dist/` |
| `npm test` | Pruebas de las reglas de negocio (stock, caja, facturación y anulaciones) |
| `npm run deploy` | Compila y publica en Firebase (Hosting y reglas) |

## Tecnología

React 18, TypeScript, Vite, React Router, Firebase (Auth y Firestore), lucide-react y CSS propio
con la paleta negro, blanco y rojo, en tema claro y oscuro.
