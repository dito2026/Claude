// Marcas comerciales de celulares y sus modelos.
// Las marcas vienen de una lista fija (las que se venden en Colombia) más las que ya existan en los datos;
// los modelos se arman solos con lo que ya se ha registrado (órdenes, productos y celulares por IMEI).
import { normalize } from './format';

export const BRANDS = [
  'Samsung', 'Apple', 'Xiaomi', 'Redmi', 'Motorola', 'Huawei', 'Honor', 'Oppo', 'Vivo', 'Realme', 'Tecno', 'Infinix',
  'ZTE', 'Nokia', 'Alcatel', 'OnePlus', 'Google', 'Sony', 'LG', 'Itel', 'Blu', 'Lenovo', 'Asus', 'TCL', 'Nothing',
];

/** Sub-marcas que se agrupan bajo la marca comercial. */
const ALIASES: Record<string, string> = {
  iphone: 'Apple', ipad: 'Apple', poco: 'Xiaomi', mi: 'Xiaomi', galaxy: 'Samsung',
  moto: 'Motorola', 'motorola moto': 'Motorola', huwei: 'Huawei', 'one plus': 'OnePlus', pixel: 'Google',
};

/** Escribe la marca siempre igual: «samsung», «SAMSUNG» o «Poco» → «Samsung» / «Xiaomi». */
export function canonicalBrand(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const n = normalize(s);
  const hit = BRANDS.find((b) => normalize(b) === n);
  if (hit) return hit;
  if (ALIASES[n]) return ALIASES[n];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Saca la marca del texto de un nombre, por ejemplo «iPhone 14 Pro Max 128GB» → «Apple». */
export function brandFromText(text: string | undefined): string {
  const words = normalize(text ?? '').split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words.slice(0, 3)) {
    const b = BRANDS.find((x) => normalize(x) === w);
    if (b) return b;
    if (ALIASES[w]) return ALIASES[w];
  }
  return '';
}

/** Modelo escrito de forma uniforme (espacios y mayúscula inicial). */
export function canonicalModel(raw: string | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // «iPhone», «iPad»: la i minúscula es parte del nombre comercial
  if (/^i(phone|pad)/i.test(s)) return 'i' + s.charAt(1).toUpperCase() + s.slice(2);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type BrandModels = Map<string, string[]>;

/** Construye marca → modelos a partir de pares (marca, modelo) ya registrados. */
export function buildBrandModels(pairs: { brand?: string; model?: string }[]): BrandModels {
  const m = new Map<string, Map<string, string>>();
  for (const b of BRANDS) m.set(b, new Map());
  for (const p of pairs) {
    const b = canonicalBrand(p.brand);
    if (!b) continue;
    const models = m.get(b) ?? new Map<string, string>();
    const model = canonicalModel(p.model);
    if (model && !models.has(normalize(model))) models.set(normalize(model), model);
    m.set(b, models);
  }
  return new Map([...m].map(([b, models]) => [b, [...models.values()].sort((x, y) => x.localeCompare(y, 'es', { numeric: true }))]));
}

/** ¿Coincide con el filtro? Vacío = cualquiera. */
export const matchesBrand = (filter: string, brand: string | undefined) => !filter || canonicalBrand(brand) === filter;
export const matchesModel = (filter: string, model: string | undefined) => !filter || normalize(canonicalModel(model)) === normalize(filter);
