// Interfaz de persistencia. Las páginas y los servicios dependen solo de esto,
// nunca de Firestore o localStorage directamente.

export type Doc = Record<string, unknown> & { id: string };

/**
 * Transacción atómica. Regla (igual que Firestore): hacer TODAS las lecturas
 * antes de la primera escritura.
 */
export interface Tx {
  get<T = Doc>(col: string, id: string): Promise<T | null>;
  set(col: string, id: string, data: Record<string, unknown>): void;
  update(col: string, id: string, data: Record<string, unknown>): void;
  /** Crea un documento con id generado y devuelve el id. */
  create(col: string, data: Record<string, unknown>): string;
}

export interface AuthUser {
  uid: string;
  email: string;
}

export interface NewAccount {
  email: string;
  password: string;
}

export interface Backend {
  readonly mode: 'firebase' | 'local';
  list<T = Doc>(col: string): Promise<T[]>;
  get<T = Doc>(col: string, id: string): Promise<T | null>;
  create(col: string, data: Record<string, unknown>): Promise<string>;
  set(col: string, id: string, data: Record<string, unknown>): Promise<void>;
  update(col: string, id: string, data: Record<string, unknown>): Promise<void>;
  remove(col: string, id: string): Promise<void>;
  subscribe<T = Doc>(col: string, cb: (rows: T[]) => void, onError?: (e: Error) => void): () => void;
  subscribeDoc<T = Doc>(col: string, id: string, cb: (row: T | null) => void): () => void;
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;

  auth: {
    onChange(cb: (u: AuthUser | null) => void): () => void;
    signIn(email: string, password: string): Promise<void>;
    signUp(email: string, password: string): Promise<AuthUser>;
    signOut(): Promise<void>;
    /** Crea una cuenta sin cerrar la sesión actual (usado por el admin). */
    createAccount(acc: NewAccount): Promise<string>;
  };
}

export const nowIso = () => new Date().toISOString();

export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}
