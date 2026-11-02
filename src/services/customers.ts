import { backend } from '../data';
import type { Customer } from '../lib/types';
import { BusinessError, created, touched, type Actor } from './common';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export async function saveCustomer(actor: Actor, c: CustomerInput, id?: string, existing: Customer[] = []) {
  const data = { ...c, name: c.name.trim(), document: c.document.trim(), phone: c.phone.trim() };
  if (!data.name) throw new BusinessError('El nombre es obligatorio.');
  if (data.document) {
    const dup = existing.find((x) => x.document === data.document && x.id !== id);
    if (dup) throw new BusinessError(`Ya existe un cliente con el documento ${data.document}: ${dup.name}.`);
  }
  if (id) {
    await backend.update('customers', id, { ...data, ...touched() });
    return id;
  }
  return backend.create('customers', { ...data, ...created(actor) });
}

export const deleteCustomer = (id: string) => backend.remove('customers', id);
