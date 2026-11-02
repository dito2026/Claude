import { useState, type FormEvent } from 'react';
import { ArrowRight, Smartphone } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { backend } from '../data';
import { DEMO_ACCOUNTS } from '../services/seed';
import { bootstrapAdmin } from '../services/staff';
import { Field } from '../components/ui';

export function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email, password);
      else await bootstrapAdmin(name, email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/auth\/(invalid-credential|wrong-password|user-not-found)/.test(msg) ? 'Correo o contraseña incorrectos.' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark"><Smartphone size={18} /></div>
          <div className="brand-name">DIGITAL CELL<span>PRO</span></div>
        </div>
        <div>
          <h1>Taller, inventario y caja en <span>un solo lugar.</span></h1>
          <p>Órdenes de reparación con repuestos conectados al inventario, facturación POS, arqueo de caja y control por roles, todo sincronizado en la nube.</p>
        </div>
        <small style={{ color: '#525252', position: 'relative', zIndex: 1 }}>© {new Date().getFullYear()} Digital Cell</small>
      </section>
      <section className="login-form">
        <form className="stack" onSubmit={submit}>
          <div>
            <div className="eyebrow">{mode === 'login' ? 'Bienvenido' : 'Configuración inicial'}</div>
            <h2 style={{ fontSize: 26 }}>{mode === 'login' ? 'Iniciar sesión' : 'Crear administrador'}</h2>
            <p className="muted" style={{ marginTop: 4 }}>
              {mode === 'login' ? 'Ingrese con su cuenta de usuario.' : 'Solo funciona la primera vez, cuando la base de datos está vacía.'}
            </p>
          </div>
          {mode === 'bootstrap' && (
            <Field label="Nombre" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          )}
          <Field label="Correo" required><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Contraseña" required><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>
          {error && <div className="alert error">{error}</div>}
          <button className="btn primary block" disabled={busy} style={{ height: 42 }}>
            {mode === 'login' ? 'Entrar' : 'Crear y entrar'} <ArrowRight size={16} />
          </button>
          {backend.mode === 'firebase' && (
            <button type="button" className="btn ghost block" onClick={() => setMode(mode === 'login' ? 'bootstrap' : 'login')}>
              {mode === 'login' ? '¿Primera instalación? Crear administrador' : 'Volver a iniciar sesión'}
            </button>
          )}
          {backend.mode === 'local' && (
            <div className="card card-pad" style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Modo demo · cuentas de prueba</div>
              {DEMO_ACCOUNTS.map((a) => (
                <button type="button" key={a.email} className="btn ghost block" style={{ justifyContent: 'space-between' }}
                  onClick={() => { setEmail(a.email); setPassword(a.password); }}>
                  <span>{a.name}</span><span className="mono faint">{a.email}</span>
                </button>
              ))}
              <div className="faint" style={{ marginTop: 6 }}>Contraseña: <span className="mono">demo1234</span></div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
