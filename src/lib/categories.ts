// Categorías del catálogo de venta. Cada producto puede tener la suya; si no tiene,
// se adivina por el nombre y el tipo (así el catálogo queda organizado sin trabajo extra).
import type { InvoiceItem, Product } from './types';
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
  [/\b(cargador(es)?|adaptador(es)?|power ?banks?|baterias? externas?)\b/, 'Cargadores'],
  [/\b(cables?|usb ?c|tipo c|lightning|micro ?usb)\b/, 'Cables'],
  [/\b(forros?|estuches?|silicon(a|as)?|gomas?|cases?|fundas?|covers?|bumpers?|carcasas?)\b/, 'Forros y estuches'],
  [/\b(vidrios?|blindados?|anti ?espias?|privacidad|protector(es)?|templados?|lentes?|hidrogel|micas?)\b/, 'Vidrios y protectores'],
  [/\b(audifonos?|auriculares? inalambricos?|inalambricos?|buds|earbuds|airpods|manos libres|diademas?|parlantes?|bafles?|speakers?)\b/, 'Audífonos y parlantes'],
  [/\b(memorias?|micro ?sd|sd|usb|pendrives?)\b/, 'Memorias y USB'],
  [/\b(relojes|reloj|smartwatch|watch|bandas?|manillas?|pulseras?|correas?)\b/, 'Relojes y bandas'],
  [/\b(soportes?|holders?|base|tripodes?|selfie|popsockets?)\b/, 'Soportes y holders'],
  [/\b(sim ?cards?|sims?|recargas?|chips?)\b/, 'Sim cards y recargas'],
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

/** Categoría de una línea de factura: la del producto; si es libre, se adivina por el texto. */
export function itemCategory(it: Pick<InvoiceItem, 'productId' | 'description' | 'kind' | 'unitId'>, products: Map<string, Pick<Product, 'name' | 'type' | 'category'>>): string {
  const p = it.productId ? products.get(it.productId) : undefined;
  if (p) return categoryOf(p);
  if (it.unitId) return CELULARES;
  if (it.kind === 'mano_obra') return SERVICIOS;
  if (it.kind === 'repuesto') return REPUESTOS;
  return guessCategory({ name: it.description, type: it.kind === 'servicio' ? 'SERVICIO' : 'ACCESORIO' });
}
