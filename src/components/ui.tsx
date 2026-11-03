import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Inbox, Search, X } from 'lucide-react';

// ---------------- Toasts ----------------
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Ejecuta una acción mostrando éxito/error y bloqueando doble clic. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    /** Devuelve true si la acción terminó bien. */
    async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      try {
        await fn();
        if (ok) toast(ok);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        toast(
          offline || /offline|unavailable|network/i.test(msg)
            ? 'Sin internet: esta operación necesita conexión para guardarse en la nube. Intente de nuevo cuando vuelva el internet.'
            : msg,
          'error',
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, toast],
  );
  return { run, busy };
}

// ---------------- Modal ----------------
export function Modal({
  title, onClose, children, footer, wide,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Inputs ----------------
export function Field({ label, required, children, className = '' }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label} {required && <em>*</em>}</span>
      {children}
    </label>
  );
}

export function MoneyInput({ value, onChange, ...rest }: { value: number; onChange: (n: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      {...rest}
      className="input num"
      inputMode="numeric"
      value={value ? value.toLocaleString('es-CO') : ''}
      placeholder="$ 0"
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  );
}

export function SearchBox({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Search size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ---------------- Display ----------------
export type Tone = 'red' | 'ok' | 'warn' | 'info' | 'dark' | '';
export const Badge = ({ tone = '', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`badge ${tone}`}>{children}</span>
);

export function Stat({ label, value, sub, icon, accent }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: boolean }) {
  return (
    <div className={`card stat ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={36} />}<div>{children}</div></div>;
}

export function PageHead({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Imprime solo el contenido del modal abierto. */
export function printNow() {
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Campo de dinero que guarda al salir del campo (no en cada tecla). */
export function CommitMoney({ value, onCommit, disabled }: { value: number; onCommit: (n: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <MoneyInput
      value={v}
      disabled={disabled}
      onChange={setV}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** true mientras el equipo tenga conexión a internet. */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
