import { useEffect, useState } from 'react';
import { backend } from './index';

/** Suscripción en tiempo real a una colección completa. */
export function useCollection<T>(col: string): { rows: T[]; loading: boolean; error?: string } {
  const [state, setState] = useState<{ rows: T[]; loading: boolean; error?: string }>({
    rows: [],
    loading: true,
  });
  useEffect(() => {
    return backend.subscribe<T>(
      col,
      (rows) => setState({ rows, loading: false }),
      (e) => setState({ rows: [], loading: false, error: e.message }),
    );
  }, [col]);
  return state;
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
