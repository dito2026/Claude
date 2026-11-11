import { backend } from '../data';
import { useDocument } from '../data/hooks';
import type { BusinessSettings } from '../lib/types';
import { touched } from './common';

// Valores por defecto tomados de la hoja «Configuración» de Digital Cell POS.
export const DEFAULT_SETTINGS: BusinessSettings = {
  name: 'Digital Cell',
  slogan: 'Celulares · Accesorios · Taller',
  nit: '',
  address: '',
  city: 'Pereira',
  phone: '',
  email: '',
  ticketFooter: 'Gracias por su compra',
  warrantyTerms: 'CONSERVE SU FACTURA PARA SU GARANTÍA. NO TIENEN GARANTÍA EQUIPOS APAGADOS, CON GOLPES, MOJADOS, SULFATADOS, INDICIOS DE CAÍDAS, BATERÍAS SOPLADAS, MANIPULACIÓN Y/O ALTERACIÓN Y/O USO INDEBIDO (SOFTWARE, ACTUALIZACIÓN, APLICACIONES MAL DESCARGADAS Y PARÁMETROS DE CONFIGURACIÓN BÁSICOS). GARANTÍA POR SOFTWARE 2 MESES (60 DÍAS).',
  paymentMethods: ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Tarjeta', 'Crédito tienda'],
  expenseCategories: [
    'Arriendo',
    'Servicios públicos',
    'Internet y teléfono',
    'Nómina y pagos a empleados',
    'Transporte y domicilios',
    'Publicidad',
    'Papelería e insumos',
    'Comisiones bancarias y datáfono',
    'Impuestos y trámites',
    'Otros',
  ],
  defaultWarrantyDays: 30,
  taxRate: 0,
  uvtValue: 52374,
  ivaCapUvt: 3500,
  suggestedMarginPct: 80,
};

export function useSettings(): BusinessSettings {
  const { doc } = useDocument<BusinessSettings & { id: string }>('settings', 'business');
  return { ...DEFAULT_SETTINGS, ...(doc ?? {}) };
}

export const saveSettings = (s: BusinessSettings) =>
  backend.set('settings', 'business', { ...s, ...touched() } as unknown as Record<string, unknown>);
