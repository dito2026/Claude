// Backend de producción: Cloud Firestore + Firebase Authentication.
import { initializeApp, deleteApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import type { AuthUser, Backend, NewAccount, Tx } from './backend';

const withId = <T>(id: string, data: unknown) => ({ ...(data as object), id }) as T;

/** Firestore no acepta `undefined`: se eliminan esas claves. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clean(data: Record<string, unknown>): Record<string, any> {
  return JSON.parse(JSON.stringify(data));
}

export class FirestoreBackend implements Backend {
  readonly mode = 'firebase' as const;
  private app: FirebaseApp;
  private db: Firestore;
  private config: FirebaseOptions;

  constructor(config: FirebaseOptions) {
    this.config = config;
    this.app = initializeApp(config);
    // Caché persistente: la app sigue funcionando sin internet y sincroniza al volver.
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }

  async list<T>(col: string) {
    const snap = await getDocs(collection(this.db, col));
    return snap.docs.map((d) => withId<T>(d.id, d.data()));
  }

  async get<T>(col: string, id: string) {
    const d = await getDoc(doc(this.db, col, id));
    return d.exists() ? withId<T>(d.id, d.data()) : null;
  }

  async create(col: string, data: Record<string, unknown>) {
    const ref = await addDoc(collection(this.db, col), clean(data));
    return ref.id;
  }

  async set(col: string, id: string, data: Record<string, unknown>) {
    await setDoc(doc(this.db, col, id), clean(data));
  }

  async update(col: string, id: string, data: Record<string, unknown>) {
    await updateDoc(doc(this.db, col, id), clean(data));
  }

  async remove(col: string, id: string) {
    await deleteDoc(doc(this.db, col, id));
  }

  subscribe<T>(col: string, cb: (rows: T[]) => void, onError?: (e: Error) => void) {
    return onSnapshot(
      collection(this.db, col),
      (snap) => cb(snap.docs.map((d) => withId<T>(d.id, d.data()))),
      (e) => onError?.(e),
    );
  }

  subscribeDoc<T>(col: string, id: string, cb: (row: T | null) => void) {
    return onSnapshot(doc(this.db, col, id), (d) => cb(d.exists() ? withId<T>(d.id, d.data()) : null));
  }

  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return runTransaction(this.db, async (t) => {
      const tx: Tx = {
        get: async <T>(col: string, id: string) => {
          const d = await t.get(doc(this.db, col, id));
          return d.exists() ? withId<T>(d.id, d.data()) : null;
        },
        set: (col, id, data) => void t.set(doc(this.db, col, id), clean(data)),
        update: (col, id, data) => void t.update(doc(this.db, col, id), clean(data)),
        create: (col, data) => {
          const ref = doc(collection(this.db, col));
          t.set(ref, clean(data));
          return ref.id;
        },
      };
      return fn(tx);
    });
  }

  auth = {
    onChange: (cb: (u: AuthUser | null) => void) =>
      onAuthStateChanged(getAuth(this.app), (u) => cb(u ? { uid: u.uid, email: u.email ?? '' } : null)),
    signIn: async (email: string, password: string) => {
      await signInWithEmailAndPassword(getAuth(this.app), email.trim(), password);
    },
    signUp: async (email: string, password: string) => {
      const c = await createUserWithEmailAndPassword(getAuth(this.app), email.trim(), password);
      return { uid: c.user.uid, email: c.user.email ?? email };
    },
    signOut: () => signOut(getAuth(this.app)),
    /** Usa una instancia secundaria para no cerrar la sesión del administrador. */
    createAccount: async ({ email, password }: NewAccount) => {
      const secondary = initializeApp(this.config, `secondary-${Date.now()}`);
      try {
        const auth = getAuth(secondary);
        const c = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await signOut(auth);
        return c.user.uid;
      } finally {
        await deleteApp(secondary);
      }
    },
  };
}
