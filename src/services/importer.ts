// Importación de datos base (clientes, inventario, técnicos y configuración) desde un archivo JSON.
// Es segura de repetir: lo que ya existe (mismo documento, SKU o nombre) se omite.
import { backend } from '../data';
import type { BusinessSettings, Customer, Product, Technician } from '../lib/types';
import { normalize } from '../lib/format';
import { BusinessError, type Actor } from './common';
import type { CustomerInput } from './customers';
import { saveProduct, type ProductInput } from './inventory';
import { saveTechnician, type TechnicianInput } from './staff';
import { DEFAULT_SETTINGS, saveSettings } from './settings';

export interface ImportFile {
  version: 1;
  source?: string;
  settings?: Partial<BusinessSettings>;
  customers?: Partial<CustomerInput>[];
  products?: Partial<ProductInput>[];
  technicians?: Partial<TechnicianInput>[];
}

export interface ImportResult {
  settings: boolean;
  customers: { added: number; skipped: number };
  products: { added: number; skipped: number };
  technicians: { added: number; skipped: number };
}

const key = (s: string | undefined) => normalize((s ?? '').trim());
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0);

export function parseImportFile(text: string): ImportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BusinessError('El archivo no es un JSON válido.');
  }
  const f = data as ImportFile;
  if (!f || f.version !== 1) throw new BusinessError('Formato no reconocido (se esperaba "version": 1).');
  return f;
}

export async function importData(
  actor: Actor,
  file: ImportFile,
  existing: { customers: Customer[]; products: Product[]; technicians: Technician[]; settings: BusinessSettings },
): Promise<ImportResult> {
  const result: ImportResult = {
    settings: false,
    customers: { added: 0, skipped: 0 },
    products: { added: 0, skipped: 0 },
    technicians: { added: 0, skipped: 0 },
  };

  // Configuración: solo se completan los campos que vienen con valor.
  if (file.settings) {
    const merged = { ...DEFAULT_SETTINGS, ...existing.settings };
    for (const [k, v] of Object.entries(file.settings)) {
      if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
    await saveSettings(merged);
    result.settings = true;
  }

  // Técnicos (por nombre)
  const techNames = new Set(existing.technicians.map((t) => key(t.name)));
  for (const t of file.technicians ?? []) {
    const name = (t.name ?? '').trim();
    if (!name || techNames.has(key(name))) {
      result.technicians.skipped++;
      continue;
    }
    await saveTechnician(actor, {
      name,
      phone: t.phone ?? '',
      specialty: t.specialty ?? '',
      active: t.active ?? true,
      commissionPct: num(t.commissionPct),
    });
    techNames.add(key(name));
    result.technicians.added++;
  }

  // Clientes (por documento o, si no tiene, por nombre)
  const docs = new Set(existing.customers.map((c) => key(c.document)).filter(Boolean));
  const names = new Set(existing.customers.map((c) => key(c.name)));
  for (const c of file.customers ?? []) {
    const name = (c.name ?? '').trim();
    const document = (c.document ?? '').trim();
    if (!name || (document && docs.has(key(document))) || names.has(key(name))) {
      result.customers.skipped++;
      continue;
    }
    await backend.create('customers', {
      document,
      name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: actor.uid,
    });
    if (document) docs.add(key(document));
    names.add(key(name));
    result.customers.added++;
  }

  // Inventario (por SKU o nombre). El stock inicial queda registrado en el kardex.
  const skus = new Set(existing.products.map((p) => key(p.sku)).filter(Boolean));
  const pnames = new Set(existing.products.map((p) => key(p.name)));
  for (const p of file.products ?? []) {
    const name = (p.name ?? '').trim();
    const sku = (p.sku ?? '').trim();
    if (!name || (sku && skus.has(key(sku))) || pnames.has(key(name))) {
      result.products.skipped++;
      continue;
    }
    const type = p.type ?? 'ACCESORIO';
    await saveProduct(actor, {
      sku,
      type,
      name,
      brand: p.brand ?? '',
      model: p.model ?? '',
      color: p.color ?? '',
      cost: num(p.cost),
      price: num(p.price),
      stock: type === 'SERVICIO' ? 0 : Math.max(0, num(p.stock)),
      minStock: num(p.minStock),
      warrantyMonths: num(p.warrantyMonths),
      line: p.line ?? '',
      active: p.active ?? true,
    });
    if (sku) skus.add(key(sku));
    pnames.add(key(name));
    result.products.added++;
  }

  return result;
}
