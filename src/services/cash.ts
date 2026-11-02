import { backend, type Tx } from '../data';
import type { CashMovement, CashSession } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { BusinessError, created, touched, type Actor } from './common';

export const CASH_METHOD = 'Efectivo';

export interface CashState {
  openSessionId: string | null;
}

/** Lee la caja abierta dentro de una transacción. Lanza si no hay. */
export async function requireOpenSession(tx: Tx): Promise<string> {
  const st = await tx.get<CashState>('meta', 'cash');
  if (!st?.openSessionId) throw new BusinessError('No hay una caja abierta. Abra la caja en el módulo Caja.');
  return st.openSessionId;
}

export type MovementInput = Omit<CashMovement, 'id' | 'sessionId' | 'createdAt' | 'updatedAt' | 'createdBy'>;

/** Registra un movimiento (fase de escrituras). Los créditos de tienda no tocan caja. */
export function writeMovement(tx: Tx, actor: Actor, sessionId: string, m: MovementInput) {
  if (m.method === CREDIT_METHOD || !(m.amount > 0)) return;
  tx.create('cashMovements', { ...m, sessionId, ...created(actor) } as unknown as Record<string, unknown>);
}

export async function openSession(actor: Actor, openingCash: number) {
  return backend.transaction(async (tx) => {
    const st = await tx.get<CashState>('meta', 'cash');
    if (st?.openSessionId) throw new BusinessError('Ya hay una caja abierta.');
    const session: Omit<CashSession, 'id'> = {
      status: 'abierta',
      openedAt: new Date().toISOString(),
      openedBy: actor.name,
      openingCash: Math.max(0, openingCash || 0),
      ...created(actor),
    };
    const id = tx.create('cashSessions', session as unknown as Record<string, unknown>);
    tx.set('meta', 'cash', { openSessionId: id });
    return id;
  });
}

export async function addMovement(actor: Actor, m: MovementInput) {
  if (!(m.amount > 0)) throw new BusinessError('El valor debe ser mayor que cero.');
  if (!m.description.trim()) throw new BusinessError('Escriba una descripción.');
  return backend.transaction(async (tx) => {
    const sid = await requireOpenSession(tx);
    writeMovement(tx, actor, sid, m);
  });
}

/** Esperado por medio de pago: igual que la hoja «Cierre de caja». */
export function expectedByMethod(
  session: Pick<CashSession, 'openingCash'>,
  movements: CashMovement[],
  methods: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of methods) if (m !== CREDIT_METHOD) out[m] = 0;
  out[CASH_METHOD] = (out[CASH_METHOD] ?? 0) + (session.openingCash || 0);
  for (const mv of movements) {
    const sign = mv.direction === 'ingreso' ? 1 : -1;
    out[mv.method] = (out[mv.method] ?? 0) + sign * mv.amount;
  }
  return out;
}

export async function closeSession(
  actor: Actor,
  sessionId: string,
  expected: Record<string, number>,
  counted: Record<string, number>,
  notes: string,
) {
  const totalExp = Object.values(expected).reduce((a, b) => a + b, 0);
  const totalCnt = Object.values(counted).reduce((a, b) => a + (b || 0), 0);
  const difference = totalCnt - totalExp;
  if (difference !== 0 && !notes.trim()) {
    throw new BusinessError('Hay diferencia en el arqueo: escriba la justificación.');
  }
  return backend.transaction(async (tx) => {
    const st = await tx.get<CashState>('meta', 'cash');
    if (st?.openSessionId !== sessionId) throw new BusinessError('Esta caja ya no está abierta.');
    tx.update('cashSessions', sessionId, {
      status: 'cerrada',
      closedAt: new Date().toISOString(),
      closedBy: actor.name,
      expected,
      counted,
      difference,
      notes,
      ...touched(),
    });
    tx.set('meta', 'cash', { openSessionId: null });
  });
}
