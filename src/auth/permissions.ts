import type { Role } from '../lib/types';

export type Permission =
  | 'dashboard.finance'
  | 'customers.edit'
  | 'orders.create'
  | 'orders.billing'
  | 'inventory.edit'
  | 'inventory.receive'
  | 'billing'
  | 'billing.void'
  | 'cash'
  | 'purchases'
  | 'staff.manage'
  | 'settings';

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    'dashboard.finance', 'customers.edit', 'orders.create', 'orders.billing', 'inventory.edit',
    'inventory.receive', 'billing', 'billing.void', 'cash', 'purchases', 'staff.manage', 'settings',
  ],
  cajero: ['dashboard.finance', 'customers.edit', 'orders.create', 'orders.billing', 'inventory.receive', 'billing', 'cash', 'purchases'],
  tecnico: [],
};

export const can = (role: Role | undefined, p: Permission) => !!role && MATRIX[role].includes(p);
