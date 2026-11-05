import { describe, expect, it, vi } from 'vitest';
import { backend } from '../data';
import { collectBackup } from '../components/AiSettingsCard';

describe('respaldo de datos', () => {
  it('no lista «meta» entera (Firestore lo prohíbe) y lee sus documentos uno por uno', async () => {
    await backend.set('meta', 'cash', { openSessionId: 'abc' });
    const list = backend.list.bind(backend);
    const spy = vi.spyOn(backend, 'list').mockImplementation(((col: string) => {
      if (col === 'meta') return Promise.reject(new Error('Missing or insufficient permissions.'));
      return list(col);
    }) as typeof backend.list);
    const { data, failed } = await collectBackup();
    expect(spy).not.toHaveBeenCalledWith('meta');
    expect(failed).toEqual([]);
    expect(data.meta).toContainEqual(expect.objectContaining({ id: 'cash', openSessionId: 'abc' }));
    expect(data.invoices).toBeDefined();
    spy.mockRestore();
  });

  it('si una colección falla, el resto se respalda igual', async () => {
    const list = backend.list.bind(backend);
    const spy = vi.spyOn(backend, 'list').mockImplementation(((col: string) =>
      col === 'users' ? Promise.reject(new Error('denied')) : list(col)) as typeof backend.list);
    const { data, failed } = await collectBackup();
    expect(failed).toEqual(['users']);
    expect(data.products).toBeDefined();
    spy.mockRestore();
  });
});
