// Backend de MODO DEMO: guarda todo en localStorage del navegador.
// No es seguro ni compartido: solo sirve para probar la app sin Firebase.
import type { AuthUser, Backend, Doc, NewAccount, Tx } from './backend';
import { uid } from './backend';

type Store = Record<string, Record<string, Doc>>;

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const DB_KEY = 'dcpro:db:v1';
const SESSION_KEY = 'dcpro:session:v1';
const ACCOUNTS = '_accounts';

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Hash no criptográfico, suficiente para el modo demo local. */
function demoHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export class LocalBackend implements Backend {
  readonly mode = 'local' as const;
  private store: Store;
  private listeners = new Map<string, Set<() => void>>();
  private authListeners = new Set<(u: AuthUser | null) => void>();
  private kv: KV;

  constructor(kv?: KV) {
    this.kv = kv ?? (typeof localStorage !== 'undefined' ? localStorage : memoryKV());
    this.store = this.load();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === DB_KEY) {
          this.store = this.load();
          for (const col of Object.keys(this.store)) this.emit(col);
        }
      });
    }
  }

  private load(): Store {
    try {
      const raw = this.kv.getItem(DB_KEY);
      return raw ? (JSON.parse(raw) as Store) : {};
    } catch {
      return {};
    }
  }

  private persist() {
    try {
      this.kv.setItem(DB_KEY, JSON.stringify(this.store));
    } catch {
      /* almacenamiento lleno o bloqueado: se mantiene en memoria */
    }
  }

  private emit(col: string) {
    this.listeners.get(col)?.forEach((fn) => fn());
  }

  private colMap(col: string) {
    return (this.store[col] ??= {});
  }

  /** Borra todo (usado por las pruebas y por «Reiniciar datos demo»). */
  reset() {
    this.store = {};
    this.persist();
    this.kv.setItem(SESSION_KEY, '');
  }

  isEmpty(): boolean {
    return Object.keys(this.store).filter((k) => k !== ACCOUNTS).length === 0;
  }

  async list<T>(col: string): Promise<T[]> {
    return Object.values(this.colMap(col)).map((d) => clone(d)) as T[];
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const d = this.colMap(col)[id];
    return d ? (clone(d) as T) : null;
  }

  async create(col: string, data: Record<string, unknown>): Promise<string> {
    const id = uid();
    await this.set(col, id, data);
    return id;
  }

  async set(col: string, id: string, data: Record<string, unknown>) {
    this.colMap(col)[id] = { ...clone(data), id };
    this.persist();
    this.emit(col);
  }

  async update(col: string, id: string, data: Record<string, unknown>) {
    const cur = this.colMap(col)[id];
    if (!cur) throw new Error(`No existe ${col}/${id}`);
    this.colMap(col)[id] = { ...cur, ...clone(data), id };
    this.persist();
    this.emit(col);
  }

  async remove(col: string, id: string) {
    delete this.colMap(col)[id];
    this.persist();
    this.emit(col);
  }

  subscribe<T>(col: string, cb: (rows: T[]) => void) {
    const fn = () => void this.list<T>(col).then(cb);
    const set = this.listeners.get(col) ?? new Set();
    set.add(fn);
    this.listeners.set(col, set);
    fn();
    return () => void set.delete(fn);
  }

  subscribeDoc<T>(col: string, id: string, cb: (row: T | null) => void) {
    const fn = () => void this.get<T>(col, id).then(cb);
    const set = this.listeners.get(col) ?? new Set();
    set.add(fn);
    this.listeners.set(col, set);
    fn();
    return () => void set.delete(fn);
  }

  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    const staged: Store = {};
    const touched = new Set<string>();
    const read = (col: string, id: string): Doc | undefined =>
      staged[col]?.[id] ?? this.colMap(col)[id];

    const tx: Tx = {
      get: async <T>(col: string, id: string) => {
        const d = read(col, id);
        return d ? (clone(d) as T) : null;
      },
      set: (col, id, data) => {
        (staged[col] ??= {})[id] = { ...clone(data), id };
        touched.add(col);
      },
      update: (col, id, data) => {
        const cur = read(col, id);
        if (!cur) throw new Error(`No existe ${col}/${id}`);
        (staged[col] ??= {})[id] = { ...cur, ...clone(data), id };
        touched.add(col);
      },
      create: (col, data) => {
        const id = uid();
        tx.set(col, id, data);
        return id;
      },
    };

    const result = await fn(tx); // si lanza, nada se aplica
    for (const col of Object.keys(staged)) Object.assign(this.colMap(col), staged[col]);
    this.persist();
    touched.forEach((c) => this.emit(c));
    return result;
  }

  // ---------------- Autenticación demo ----------------
  private currentUser(): AuthUser | null {
    try {
      const raw = this.kv.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }

  private setSession(u: AuthUser | null) {
    this.kv.setItem(SESSION_KEY, u ? JSON.stringify(u) : '');
    this.authListeners.forEach((fn) => fn(u));
  }

  auth = {
    onChange: (cb: (u: AuthUser | null) => void) => {
      this.authListeners.add(cb);
      cb(this.currentUser());
      return () => void this.authListeners.delete(cb);
    },
    signIn: async (email: string, password: string) => {
      const acc = Object.values(this.colMap(ACCOUNTS)).find(
        (a) => String(a.email).toLowerCase() === email.trim().toLowerCase(),
      );
      if (!acc || acc.hash !== demoHash(password)) throw new Error('Correo o contraseña incorrectos.');
      this.setSession({ uid: acc.id, email: String(acc.email) });
    },
    signUp: async (email: string, password: string) => {
      const id = await this.auth.createAccount({ email, password });
      const u = { uid: id, email: email.trim().toLowerCase() };
      this.setSession(u);
      return u;
    },
    signOut: async () => this.setSession(null),
    createAccount: async ({ email, password }: NewAccount) => {
      const e = email.trim().toLowerCase();
      if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      const exists = Object.values(this.colMap(ACCOUNTS)).some((a) => a.email === e);
      if (exists) throw new Error('Ya existe una cuenta con ese correo.');
      return this.create(ACCOUNTS, { email: e, hash: demoHash(password) });
    },
  };
}
