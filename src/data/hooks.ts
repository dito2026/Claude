import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { backend } from './index';

interface CollectionState<T> {
  rows: T[];
  loading: boolean;
  error?: string;
}

interface Entry {
  state: CollectionState<unknown>;
  listeners: Set<() => void>;
  unsub?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  failed: boolean;
}

/**
 * Datos compartidos: una sola suscripción por colección para toda la app.
 * Varias pantallas y tarjetas que piden lo mismo reciben las mismas filas, y al cambiar de pantalla
 * la suscripción sigue viva unos minutos: volver es inmediato y no se vuelven a leer los documentos.
 */
const store = new Map<string, Entry>();
const KEEP_ALIVE_MS = 5 * 60_000;
const LOADING: CollectionState<unknown> = { rows: [], loading: true };

function stop(col: string, e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.unsub?.();
  if (store.get(col) === e) store.delete(col);
}

function scheduleStop(col: string, e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    if (e.listeners.size === 0) stop(col, e);
  }, e.failed ? 0 : KEEP_ALIVE_MS);
}

function start(col: string, e: Entry) {
  e.failed = false;
  e.state = LOADING;
  const emit = (state: CollectionState<unknown>) => {
    e.state = state;
    e.listeners.forEach((l) => l());
  };
  const unsub = backend.subscribe<unknown>(
    col,
    (rows) => emit({ rows, loading: false }),
    (err) => {
      e.failed = true;
      emit({ rows: [], loading: false, error: err.message });
    },
  );
  e.unsub = unsub;
}

function entryFor(col: string): Entry {
  let e = store.get(col);
  if (e) return e;
  e = { state: LOADING, listeners: new Set(), failed: false };
  store.set(col, e);
  start(col, e);
  // Si nadie llega a escucharla (render descartado), se cierra sola.
  scheduleStop(col, e);
  return e;
}

/**
 * Al cambiar de usuario o de rol los permisos cambian: se descartan los datos guardados
 * y las pantallas abiertas los vuelven a pedir.
 */
export function resetCollections() {
  for (const [col, e] of [...store]) {
    if (e.listeners.size === 0) {
      stop(col, e);
      continue;
    }
    e.unsub?.();
    start(col, e);
    e.listeners.forEach((l) => l());
  }
}

/** Suscripción en tiempo real a una colección completa (compartida entre pantallas). */
export function useCollection<T>(col: string): CollectionState<T> {
  const subscribe = useCallback((cb: () => void) => {
    const e = entryFor(col);
    if (e.timer) clearTimeout(e.timer);
    e.listeners.add(cb);
    return () => {
      e.listeners.delete(cb);
      if (e.listeners.size === 0) scheduleStop(col, e);
    };
  }, [col]);
  const get = useCallback(() => entryFor(col).state as CollectionState<T>, [col]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useDocument<T>(col: string, id: string | undefined): { doc: T | null; loading: boolean } {
  const [state, setState] = useState<{ doc: T | null; loading: boolean }>({ doc: null, loading: true });
  useEffect(() => {
    if (!id) {
      setState({ doc: null, loading: false });
      return;
    }
    return backend.subscribeDoc<T>(col, id, (doc) => setState({ doc, loading: false }));
  }, [col, id]);
  return state;
}
