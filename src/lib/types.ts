// Modelos de dominio de DIGITAL CELL PRO. Ver docs/ARQUITECTURA.md §4.

export type Role = 'admin' | 'cajero' | 'tecnico';

export interface BaseDoc {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface UserProfile extends BaseDoc {
  name: string;
  email: string;
  role: Role;
  active: boolean;
  technicianId?: string;
  /** vendedor vinculado: la venta se le asigna por defecto */
  sellerId?: string;
}

export interface BusinessSettings {
  name: string;
  slogan: string;
  nit: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  ticketFooter: string;
  paymentMethods: string[];
  expenseCategories: string[];
  defaultWarrantyDays: number;
  taxRate: number; // 0 = no responsable de IVA
  /** valor de la UVT del año (DIAN) */
  uvtValue?: number;
  /** tope de ingresos para no responsable de IVA, en UVT */
  ivaCapUvt?: number;
  /** margen para el precio sugerido de productos nuevos (%) */
  suggestedMarginPct?: number;
  /** condiciones de garantía de celulares que salen en el comprobante */
  phoneWarrantyTerms?: string;
  /** comprador que firma los contratos de compraventa de usados */
  ownerName?: string;
  ownerDocument?: string;
  ownerDocumentCity?: string;
}

export interface Technician extends BaseDoc {
  name: string;
  phone: string;
  specialty: string;
  active: boolean;
  commissionPct: number;
  userId?: string;
}

export interface Customer extends BaseDoc {
  document: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface CustomerRef {
  name: string;
  phone: string;
  document: string;
  email?: string;
}

export type ProductType = 'ACCESORIO' | 'REPUESTO' | 'EQUIPO' | 'SERVICIO';

export interface Product extends BaseDoc {
  sku: string;
  type: ProductType;
  name: string;
  brand: string;
  model: string;
  color: string;
  cost: number;
  price: number;
  stock: number;
  minStock: number;
  warrantyMonths: number;
  line: string;
  active: boolean;
  /** false = se vende sin controlar ni descontar inventario (por defecto true) */
  trackStock?: boolean;
  /** categoría de venta (Cargadores, Forros…). Vacía = se adivina por el nombre */
  category?: string;
  /** eliminado del inventario (se conserva por el historial; se puede recuperar) */
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export type StockReason =
  | 'compra'
  | 'venta'
  | 'reparacion'
  | 'devolucion_reparacion'
  | 'ajuste'
  | 'anulacion'
  | 'anulacion_compra'
  | 'remision'
  | 'devolucion_remision'
  | 'inicial';

export interface StockMovement extends BaseDoc {
  productId: string;
  productName: string;
  kind: 'entrada' | 'salida' | 'ajuste';
  qty: number; // con signo
  reason: StockReason;
  refType?: 'repairOrder' | 'invoice' | 'purchase' | 'usedPurchase' | 'remission' | 'manual';
  refId?: string;
  refNumber?: number;
  unitCost: number;
  stockAfter: number;
  note?: string;
}

export const ORDER_STATUSES = [
  'Recibido',
  'En diagnóstico',
  'Esperando aprobación',
  'Esperando repuesto',
  'En reparación',
  'Reparado / Listo',
  'Entregado',
  'No reparado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const OPEN_STATUSES: OrderStatus[] = ORDER_STATUSES.filter(
  (s) => s !== 'Entregado' && s !== 'No reparado',
) as OrderStatus[];

export type Priority = 'baja' | 'normal' | 'alta' | 'urgente';

export interface OrderPart {
  lineId: string;
  /** vacío = artículo libre, sin inventario */
  productId: string;
  name: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  /** compra al proveedor de este repuesto libre (si se registró) */
  purchaseNumber?: number;
  supplierName?: string;
}

export interface Deposit {
  amount: number;
  method: string;
  at: string;
  /** corrección: quién, cuándo, por qué y los valores anteriores */
  editedAt?: string;
  editedBy?: string;
  editReason?: string;
  previous?: { amount: number; method: string };
}

export interface TimelineEntry {
  at: string;
  by: string;
  status?: OrderStatus;
  note: string;
}

export interface Device {
  brand: string;
  model: string;
  imei: string;
  color: string;
  unlockCode: string;
  accessories: string;
  condition: string;
}

export interface RepairOrder extends BaseDoc {
  number: number;
  customerId: string;
  customer: CustomerRef;
  device: Device;
  reportedIssue: string;
  diagnosis: string;
  technicianId: string;
  technicianName: string;
  technicianUserId: string;
  status: OrderStatus;
  priority: Priority;
  promisedAt: string;
  budget: number;
  laborPrice: number;
  technicianPay: number;
  parts: OrderPart[];
  deposits: Deposit[];
  warrantyDays: number;
  warrantyUntil?: string;
  deliveredAt?: string;
  invoiceId?: string;
  invoiceNumber?: number;
  timeline: TimelineEntry[];
}

export type TicketType = 'garantia' | 'reclamo' | 'consulta' | 'seguimiento';
export type TicketStatus = 'abierto' | 'en_proceso' | 'esperando_cliente' | 'resuelto' | 'cerrado';

export interface TicketComment {
  at: string;
  by: string;
  text: string;
}

export interface Ticket extends BaseDoc {
  number: number;
  type: TicketType;
  subject: string;
  description: string;
  customerId: string;
  customerName: string;
  repairOrderId?: string;
  repairOrderNumber?: number;
  imei?: string;
  priority: Priority;
  status: TicketStatus;
  assignedTo: string;
  comments: TicketComment[];
}

export type InvoiceItemKind = 'producto' | 'repuesto' | 'mano_obra' | 'servicio';

export interface InvoiceItem {
  productId?: string;
  description: string;
  kind: InvoiceItemKind;
  qty: number;
  unitPrice: number;
  unitCost: number;
  imei?: string;
  /** celular vendido (colección phoneUnits, id = IMEI) */
  unitId?: string;
  /** true si el stock ya fue descontado (repuestos de una OT, mercancía remisionada) */
  stockAlreadyMoved?: boolean;
  /** línea de la remisión de la que sale esta venta */
  remissionLineId?: string;
  /** celulares: meses de garantía dados en esta venta y fecha en que vence */
  warrantyMonths?: number;
  warrantyUntil?: string;
}

export interface Payment {
  method: string;
  amount: number;
}

export interface Invoice extends BaseDoc {
  number: number;
  /** venta de mercancía en consignación (remisión) */
  remissionId?: string;
  remissionNumber?: number;
  customerId?: string;
  customer: CustomerRef;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** abonos previos de la OT aplicados a esta factura */
  depositsApplied: number;
  payments: Payment[];
  repairOrderId?: string;
  repairOrderNumber?: number;
  status: 'pagada' | 'credito' | 'anulada';
  cashSessionId: string;
  cashierName: string;
  /** vendedor que hizo la venta y su comisión (calculada al facturar) */
  sellerId?: string;
  sellerName?: string;
  commission?: number;
  commissionPct?: number;
  commissionBase?: CommissionBase;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
}

export interface CashSession extends BaseDoc {
  status: 'abierta' | 'cerrada';
  openedAt: string;
  openedBy: string;
  openingCash: number;
  closedAt?: string;
  closedBy?: string;
  expected?: Record<string, number>;
  counted?: Record<string, number>;
  difference?: number;
  notes?: string;
}

export type CashCategory =
  | 'venta'
  | 'abono_cliente'
  | 'gasto'
  | 'pago_proveedor'
  | 'pago_tecnico'
  | 'pago_vendedor'
  | 'retiro'
  | 'ingreso_otro'
  | 'anulacion';

export interface CashMovement extends BaseDoc {
  sessionId: string;
  direction: 'ingreso' | 'egreso';
  category: CashCategory;
  expenseCategory?: string;
  method: string;
  amount: number;
  description: string;
  refType?: 'invoice' | 'repairOrder' | 'technician' | 'seller' | 'purchase' | 'usedPurchase' | 'manual';
  refId?: string;
  /** correcciones de un gasto: cada entrada guarda los valores ANTERIORES */
  edits?: MovementEdit[];
}

export interface MovementEdit {
  at: string;
  by: string;
  reason: string;
  amount: number;
  method: string;
  description: string;
  expenseCategory?: string;
}

export const CREDIT_METHOD = 'Crédito tienda';

// ---------------- Compras y proveedores ----------------
export interface Supplier extends BaseDoc {
  name: string;
  nit: string;
  phone: string;
  termDays: number; // plazo de pago por defecto
  notes: string;
  active: boolean;
}

export interface PurchaseItem {
  /** vacío = artículo libre (no está en el inventario; no mueve stock) */
  productId: string;
  name: string;
  qty: number;
  unitCost: number;
  /** celulares: un IMEI por unidad (qty = units.length) */
  units?: PhoneUnitInput[];
}

export interface SupplierPayment {
  at: string;
  amount: number;
  method: string;
  by: string;
  /** corrección: quién, cuándo, por qué y los valores anteriores */
  editedAt?: string;
  editedBy?: string;
  editReason?: string;
  previous?: { amount: number; method: string };
}

export interface Purchase extends BaseDoc {
  number: number;
  kind: 'compra' | 'saldo_inicial';
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  total: number;
  paymentType: 'contado' | 'credito';
  invoiceRef: string;
  dueDate?: string;
  paid: number;
  payments: SupplierPayment[];
  status: 'pagada' | 'pendiente' | 'parcial' | 'anulada';
  note: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
}

// ---------------- Celulares por IMEI ----------------
export type PhoneCondition = 'NUEVO' | 'USADO';

export interface PhoneUnitInput {
  imei: string;
  imei2?: string;
  condition: PhoneCondition;
  color?: string;
  notes?: string;
}

/** Un celular físico. El id del documento es el IMEI (así no se puede repetir). */
export interface PhoneUnit extends BaseDoc {
  imei: string;
  imei2: string;
  productId: string;
  productName: string;
  condition: PhoneCondition;
  color: string;
  cost: number;
  supplierName: string;
  purchaseId?: string;
  purchaseNumber?: number;
  /** anulado = entró por una compra que se anuló; el IMEI se puede volver a ingresar */
  status: 'disponible' | 'vendido' | 'anulado' | 'remisionado';
  invoiceId?: string;
  invoiceNumber?: number;
  soldAt?: string;
  salePrice?: number;
  customerName?: string;
  warrantyMonths: number;
  warrantyUntil?: string;
  notes: string;
  /** precio de venta propio de este equipo (usados); si no hay, se usa el del producto */
  price?: number;
  /** contrato de compraventa con el que entró (usados) */
  usedPurchaseId?: string;
  usedPurchaseNumber?: number;
  /** remisión con la que está por fuera (consignación) */
  remissionId?: string;
  remissionNumber?: number;
  remissionTo?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
}

// ---------------- Compraventa de celulares usados ----------------
export interface UsedSeller {
  name: string;
  document: string;
  documentCity: string;
  address: string;
  phone: string;
  landline: string;
}

export interface UsedPurchase extends BaseDoc {
  number: number;
  /** fecha del contrato (AAAA-MM-DD) */
  date: string;
  city: string;
  seller: UsedSeller;
  buyer: { name: string; document: string; documentCity: string };
  device: { brand: string; model: string; color: string; imei: string; imei2: string };
  price: number;
  method: string;
  /** precio al que se venderá (opcional) */
  salePrice: number;
  imeiVerified: boolean;
  /** pagado con dinero que no está en la caja (no se registró egreso) */
  outsideCash?: boolean;
  /** se había descontado de la caja por error y luego se devolvió */
  cashReversedAt?: string;
  cashReversedBy?: string;
  productId: string;
  productName: string;
  createdByName: string;
}

// ---------------- Vendedores y comisiones ----------------
/** venta = % sobre lo vendido (sin IVA, con descuento); utilidad = % sobre la ganancia (venta − costo) */
export type CommissionBase = 'venta' | 'utilidad';

export interface Seller extends BaseDoc {
  name: string;
  phone: string;
  active: boolean;
  commissionPct: number;
  commissionBase: CommissionBase;
  /** líneas sobre las que gana comisión; vacío = todas */
  lines?: string[];
  userId?: string;
}

// ---------------- Recordatorios ----------------
export interface Reminder extends BaseDoc {
  text: string;
  /** fecha y hora del recordatorio (ISO); vacío = sin fecha */
  dueAt?: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
  createdByName: string;
}

// ---------------- Remisiones (mercancía en consignación) ----------------
export interface RemissionItem {
  lineId: string;
  productId: string;
  name: string;
  qty: number;
  /** precio pactado de venta */
  unitPrice: number;
  unitCost: number;
  unitId?: string;
  imei?: string;
  sold: number;
  returned: number;
}

export interface Remission extends BaseDoc {
  number: number;
  customerId?: string;
  recipient: CustomerRef & { address?: string };
  items: RemissionItem[];
  status: 'abierta' | 'liquidada';
  note: string;
  /** fecha acordada para liquidar (opcional) */
  dueDate?: string;
  createdByName: string;
  invoices: { id: string; number: number; at: string; total: number }[];
  returns: { at: string; by: string; lines: { lineId: string; qty: number }[] }[];
}
