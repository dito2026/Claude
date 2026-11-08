import { describe, expect, it } from 'vitest';
import { guessType, looksMisclassifiedAccessory } from './inventory';
import { guessCategory } from '../lib/categories';
import type { Product } from '../lib/types';

describe('accesorios por nombre', () => {
  const acc: [string, string][] = [
    ['Simcard Claro', 'Sim cards y recargas'], ['Sim card Movistar', 'Sim cards y recargas'], ['Recarga 5000', 'Sim cards y recargas'],
    ['Audífonos', 'Audífonos y parlantes'], ['Audífonos inalámbricos', 'Audífonos y parlantes'], ['Audífono Samsung', 'Audífonos y parlantes'],
    ['Vidrio templado A15', 'Vidrios y protectores'], ['Vidrios 9D', 'Vidrios y protectores'], ['Blindado antiespía iPhone 13', 'Vidrios y protectores'],
    ['Lentes cámara iPhone 13', 'Vidrios y protectores'], ['Protector de pantalla', 'Vidrios y protectores'], ['Vidrio pantalla Samsung', 'Vidrios y protectores'],
    ['Estuche', 'Forros y estuches'], ['Estuches billetera', 'Forros y estuches'], ['Silicona iPhone 13', 'Forros y estuches'],
    ['Gomas', 'Forros y estuches'], ['Goma A05', 'Forros y estuches'], ['Forros', 'Forros y estuches'], ['Forro Redmi 13C', 'Forros y estuches'],
  ];
  it.each(acc)('«%s» es accesorio (%s)', (name, cat) => {
    expect(guessType(name)).toBe('ACCESORIO');
    expect(guessCategory({ name, type: 'ACCESORIO' })).toBe(cat);
  });
  it('lo demás sigue igual', () => {
    expect(guessType('Pantalla Redmi Note 9')).toBe('REPUESTO');
    expect(guessType('Batería iPhone 11')).toBe('REPUESTO');
    expect(guessType('Puerto de carga USB tipo C')).toBe('REPUESTO');
    expect(guessType('Cambio de pantalla')).toBe('SERVICIO');
    expect(guessType('iPhone 13 128GB')).toBe('EQUIPO');
    expect(guessType('Cable USB tipo C')).toBe('ACCESORIO');
  });
  it('detecta productos guardados con tipo equivocado', () => {
    const p = (o: Partial<Product>) => ({ id: 'x', name: '', type: 'REPUESTO', stock: 0, ...o }) as Product;
    expect(looksMisclassifiedAccessory(p({ name: 'Simcard Claro' }))).toBe(true);
    expect(looksMisclassifiedAccessory(p({ name: 'Silicona iPhone 13', type: 'EQUIPO' }))).toBe(true);
    expect(looksMisclassifiedAccessory(p({ name: 'Silicona iPhone 13', type: 'EQUIPO', stock: 1 }))).toBe(false);
    expect(looksMisclassifiedAccessory(p({ name: 'Pantalla A15' }))).toBe(false);
    expect(looksMisclassifiedAccessory(p({ name: 'Forro', type: 'ACCESORIO' }))).toBe(false);
  });
});
