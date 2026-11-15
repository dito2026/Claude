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
  tx.create('cashMovements', { ...m, sessionId, ...created(actor) });
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
    const id = tx.create('cashSessions', session);
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

export interface ExpenseFix {
  amount: number;
  method: string;
  description: string;
  expenseCategory: string;
  reason: string;
}

/**
 * Corrige un gasto ya registrado (valor, medio, descripción o categoría).
 * No borra nada: guarda los valores anteriores en `edits` con quién y por qué.
 * El cajero solo corrige gastos del turno abierto; el administrador, cualquiera.
 */
export async function editExpense(actor: Actor, movementId: string, fix: ExpenseFix, isAdmin: boolean) {
  if (!(fix.amount > 0)) throw new BusinessError('El valor debe ser mayor que cero.');
  if (!fix.description.trim()) throw new BusinessError('Escriba una descripción.');
  if (!fix.method || fix.method === CREDIT_METHOD) throw new BusinessError('Elija un medio de pago válido.');
  if (!fix.reason.trim()) throw new BusinessError('Escriba el motivo de la corrección.');
  return backend.transaction(async (tx) => {
    const m = await tx.get<CashMovement>('cashMovements', movementId);
    if (!m) throw new BusinessError('Movimiento no encontrado.');
    if (m.direction !== 'egreso' || m.category !== 'gasto') throw new BusinessError('Solo se pueden corregir gastos.');
    const st = await tx.get<CashState>('meta', 'cash');
    if (!isAdmin && st?.openSessionId !== m.sessionId) {
      throw new BusinessError('Ese gasto es de un turno ya cerrado: solo el administrador puede corregirlo.');
    }
    const same = m.amount === fix.amount && m.method === fix.method && m.description === fix.description.trim()
      && (m.expenseCategory ?? '') === fix.expenseCategory;
    if (same) throw new BusinessError('No hay cambios para guardar.');
    const prev = {
      at: new Date().toISOString(), by: actor.name, reason: fix.reason.trim(),
      amount: m.amount, method: m.method, description: m.description, ...(m.expenseCategory ? { expenseCategory: m.expenseCategory } : {}),
    };
    tx.update('cashMovements', movementId, {
      amount: fix.amount,
      method: fix.method,
      description: fix.description.trim(),
      expenseCategory: fix.expenseCategory,
      edits: [...(m.edits ?? []), prev],
      ...touched(),
    });
  });
}

/**
 * Cuadra la caja abierta cuando se corrige un pago ya registrado (valor o medio).
 * - `flow: 'out'` (dinero que salió, p. ej. pago a proveedor): si baja o cambia de medio, el dinero vuelve
 *   (reintegro de la misma categoría); si sube, sale la diferencia.
 * - `flow: 'in'` (dinero que entró, p. ej. abono de cliente): si baja o cambia de medio, sale como «Anulación»;
 *   si sube, entra la diferencia en la misma categoría.
 */
export function adjustCash(
  tx: Tx, actor: Actor, sessionId: string, flow: 'in' | 'out',
  base: Pick<MovementInput, 'category' | 'description' | 'refType' | 'refId'>,
  before: { amount: number; method: string }, after: { amount: number; method: string },
) {
  const forward = (amount: number, method: string) => writeMovement(tx, actor, sessionId, {
    ...base, direction: flow === 'out' ? 'egreso' : 'ingreso', method, amount,
  });
  const reverse = (amount: number, method: string) => writeMovement(tx, actor, sessionId, {
    ...base, ...(flow === 'in' ? { category: 'anulacion' as const } : {}), direction: flow === 'out' ? 'ingreso' : 'egreso', method, amount,
  });
  if (before.method === after.method) {
    const diff = after.amount - before.amount;
    if (diff > 0) forward(diff, after.method);
    else if (diff < 0) reverse(-diff, before.method);
  } else {
    if (before.amount > 0) reverse(before.amount, before.method);
    if (after.amount > 0) forward(after.amount, after.method);
  }
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
