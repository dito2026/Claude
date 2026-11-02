import type { Tx } from '../data/backend';
import { nowIso } from '../data/backend';

/** Quién ejecuta la operación (para auditoría). */
export interface Actor {
  uid: string;
  name: string;
}

export const SYSTEM: Actor = { uid: 'system', name: 'Sistema' };

export const created = (actor: Actor) => {
  const t = nowIso();
  return { createdAt: t, updatedAt: t, createdBy: actor.uid };
};

export const touched = () => ({ updatedAt: nowIso() });

export type CounterName = 'orders' | 'invoices' | 'tickets' | 'purchases';

/** Lectura del siguiente consecutivo (fase de lecturas de la transacción). */
export async function readNext(tx: Tx, name: CounterName): Promise<number> {
  const c = await tx.get<{ value: number }>('counters', name);
  return (c?.value ?? 0) + 1;
}

/** Escritura del consecutivo ya leído (fase de escrituras). */
export function writeCounter(tx: Tx, name: CounterName, value: number) {
  tx.set('counters', name, { value });
}

export class BusinessError extends Error {}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
