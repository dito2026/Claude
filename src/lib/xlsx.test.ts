import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildXlsx, zipStore } from './xlsx';

describe('Excel real (.xlsx)', () => {
  it('arma un ZIP válido con la hoja, textos con tildes y números', () => {
    const data = buildXlsx([
      ['Fecha', 'Factura', 'Cliente', 'Producto', 'Venta', 'Ganancia'],
      ['14/11/2026', '000002', 'Laura Gómez & Cía <x>', 'Vidrio templado', 20000, 18500],
      ['Total', '', '', '', 20000, 18500],
    ], 'ventas Guillermo Villa');
    expect(data[0]).toBe(0x50); // "PK"
    expect(data[1]).toBe(0x4b);
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, data);
    expect(zipStore([{ name: 'a.txt', data: new Uint8Array([1, 2, 3]) }]).length).toBeGreaterThan(100);
  });
});
