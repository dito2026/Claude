import { Component, lazy, type ComponentType, type ReactNode } from 'react';

type Page = ComponentType<any> & { preload: () => Promise<unknown> };
const RELOAD_KEY = 'dcpro:chunkReload';

/**
 * Carga una pantalla solo cuando se necesita.
 * Si la descarga falla porque se publicó una versión nueva (el archivo viejo ya no existe),
 * recarga la página una vez para tomar la versión nueva en vez de quedarse en blanco.
 */
export function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string): Page {
  let pending: Promise<M> | null = null;
  const get = () => (pending ??= load().catch((e) => { pending = null; throw e; }));
  const C = lazy(async () => {
    try {
      const m = await get();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* sin almacenamiento */ }
      return { default: m[name] as ComponentType<any> };
    } catch (e) {
      if (reloadOnce()) return new Promise<never>(() => {});
      throw e;
    }
  }) as unknown as Page;
  C.preload = get;
  return C;
}

/** Recarga la app una sola vez por minuto (evita un ciclo si el problema es la conexión). */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Baja el resto de pantallas cuando el equipo está libre, para que abrirlas sea instantáneo y funcionen sin internet. */
export function preloadPages(pages: Page[]) {
  const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb) : setTimeout(cb, 1500));
  let cancelled = false;
  const t = window.setTimeout(() => idle(async () => {
    for (const p of pages) {
      if (cancelled) return;
      await p.preload().catch(() => {});
    }
  }), 1200);
  return () => { cancelled = true; window.clearTimeout(t); };
}

/** Si una pantalla no se pudo descargar (sin internet), muestra un aviso en vez de dejar la app en blanco. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" style={{ paddingTop: 60 }}>
        <p>No se pudo abrir esta pantalla. Revise la conexión a internet.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reintentar</button>
      </div>
    );
  }
}
