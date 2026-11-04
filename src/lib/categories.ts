// Categorías del catálogo de venta. Cada producto puede tener la suya; si no tiene,
// se adivina por el nombre y el tipo (así el catálogo queda organizado sin trabajo extra).
import type { Product } from './types';
import { normalize } from './format';

export const CELULARES = 'Celulares';
export const SERVICIOS = 'Servicios';
export const REPUESTOS = 'Repuestos';

/** Categorías sugeridas, en el orden en que se muestran en Facturación. */
export const DEFAULT_CATEGORIES = [
  CELULARES, 'Cargadores', 'Cables', 'Forros y estuches', 'Vidrios y protectores', 'Audífonos y parlantes',
  'Memorias y USB', 'Relojes y bandas', 'Soportes y holders', 'Sim cards y recargas', 'Accesorios varios', REPUESTOS, SERVICIOS,
];

const RULES: [RegExp, string][] = [
  [/\b(cargador|cargadores|adaptador|power ?bank|bateria externa)\b/, 'Cargadores'],
  [/\b(cable|cables|usb ?c|tipo c|lightning|micro ?usb)\b/, 'Cables'],
  [/\b(forro|forros|estuche|silicona|case|funda|cover|carcasa)\b/, 'Forros y estuches'],
  [/\b(vidrio|vidrios|blindado|protector|templado|lente|lentes|hidrogel|mica)\b/, 'Vidrios y protectores'],
  [/\b(audifono|audifonos|buds|airpods|manos libres|diadema|parlante|parlantes|bafle|speaker)\b/, 'Audífonos y parlantes'],
  [/\b(memoria|micro ?sd|sd|usb|pendrive)\b/, 'Memorias y USB'],
  [/\b(reloj|smartwatch|watch|banda|manilla|pulsera)\b/, 'Relojes y bandas'],
  [/\b(soporte|holder|base|tripode|selfie)\b/, 'Soportes y holders'],
  [/\b(sim|simcard|recarga|chip)\b/, 'Sim cards y recargas'],
];

/** Categoría que se le asigna a un producto según su nombre y tipo. */
export function guessCategory(p: Pick<Product, 'name' | 'type'>): string {
  if (p.type === 'EQUIPO') return CELULARES;
  if (p.type === 'REPUESTO') return REPUESTOS;
  const n = normalize(p.name ?? '');
  // pantallas, baterías y demás piezas vendidas como servicio de taller → Servicios
  if (p.type === 'SERVICIO') {
    for (const [re, cat] of RULES) if (re.test(n)) return cat;
    return SERVICIOS;
  }
  for (const [re, cat] of RULES) if (re.test(n)) return cat;
  return 'Accesorios varios';
}

export const categoryOf = (p: Pick<Product, 'name' | 'type' | 'category'>) => (p.category?.trim() ? p.category.trim() : guessCategory(p));

/** Ordena categorías: primero las sugeridas en su orden, luego las propias en orden alfabético. */
export function sortCategories(cats: Iterable<string>): string[] {
  const order = new Map(DEFAULT_CATEGORIES.map((c, i) => [c, i]));
  return [...new Set(cats)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b));
}
