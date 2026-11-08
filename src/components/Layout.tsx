import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Wrench, LifeBuoy, Package, HardHat, ShieldCheck, Receipt, Wallet,
  Settings, LogOut, Menu, Moon, Sun, Smartphone, Truck, Calculator, BadgePercent, Sparkles,
  Handshake,
  FileOutput,
  Headphones,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { Permission } from '../auth/permissions';
import { APP_VERSION } from '../version';
import { backend } from '../data';
import { ROLE_LABEL } from '../services/staff';
import { useOnline } from './ui';
import { useAiEnabled } from '../services/ai';

interface NavItem { to: string; label: string; icon: ReactNode; perm?: Permission; ai?: boolean }

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'General',
    items: [
      { to: '/', label: 'Panel', icon: <LayoutDashboard size={18} /> },
      { to: '/asistente', label: 'Asistente IA', icon: <Sparkles size={18} />, perm: 'dashboard.finance', ai: true },
    ],
  },
  {
    label: 'Celulares',
    items: [
      { to: '/celulares', label: 'Celulares', icon: <Smartphone size={18} />, perm: 'billing' },
      { to: '/usados', label: 'Compraventa usados', icon: <Handshake size={18} />, perm: 'purchases' },
    ],
  },
  {
    label: 'Accesorios',
    items: [
      { to: '/accesorios', label: 'Accesorios', icon: <Headphones size={18} />, perm: 'billing' },
      { to: '/remisiones', label: 'Remisiones', icon: <FileOutput size={18} />, perm: 'billing' },
    ],
  },
  {
    label: 'Servicio técnico',
    items: [
      { to: '/servicio', label: 'Servicio técnico', icon: <Wrench size={18} /> },
      { to: '/taller', label: 'Órdenes de reparación', icon: <ClipboardList size={18} /> },
      { to: '/tickets', label: 'Tickets de soporte', icon: <LifeBuoy size={18} /> },
    ],
  },
  {
    label: 'Ventas e inventario',
    items: [
      { to: '/facturacion', label: 'Facturación', icon: <Receipt size={18} />, perm: 'billing' },
      { to: '/caja', label: 'Caja', icon: <Wallet size={18} />, perm: 'cash' },
      { to: '/clientes', label: 'Clientes', icon: <Users size={18} /> },
      { to: '/inventario', label: 'Inventario', icon: <Package size={18} /> },
      { to: '/compras', label: 'Compras y proveedores', icon: <Truck size={18} />, perm: 'purchases' },
      { to: '/contabilidad', label: 'Contabilidad', icon: <Calculator size={18} />, perm: 'dashboard.finance' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/vendedores', label: 'Vendedores y comisiones', icon: <BadgePercent size={18} />, perm: 'staff.manage' },
      { to: '/tecnicos', label: 'Técnicos', icon: <HardHat size={18} />, perm: 'staff.manage' },
      { to: '/usuarios', label: 'Usuarios y roles', icon: <ShieldCheck size={18} />, perm: 'staff.manage' },
      { to: '/configuracion', label: 'Configuración', icon: <Settings size={18} />, perm: 'settings' },
    ],
  },
];

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('dcpro:theme') as 'light' | 'dark') || (document.documentElement.dataset.theme as 'light' | 'dark') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  // Solo se guarda cuando la persona elige; si no, sigue el tema del sistema
  const toggle = () => setTheme((t) => {
    const next = t === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('dcpro:theme', next); } catch { /* sin almacenamiento */ }
    return next;
  });
  return [theme, toggle] as const;
}

// Tamaño de letra por equipo: Normal · Grande · Muy grande
export const FONT_SCALES = [
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Grande' },
  { value: 1.3, label: 'Muy grande' },
] as const;
function useFontScale() {
  const [scale, setScale] = useState<number>(() => {
    try { return Number(localStorage.getItem('dcpro:fontScale')) || 1; } catch { return 1; }
  });
  useEffect(() => {
    document.documentElement.style.setProperty('--fs-scale', String(scale));
  }, [scale]);
  const next = () => setScale((s) => {
    const i = FONT_SCALES.findIndex((f) => f.value === s);
    const n = FONT_SCALES[(i + 1) % FONT_SCALES.length].value;
    try { localStorage.setItem('dcpro:fontScale', String(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  return [scale, next] as const;
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const [fontScale, nextFontScale] = useFontScale();
  const fontLabel = FONT_SCALES.find((f) => f.value === fontScale)?.label ?? 'Normal';
  const online = useOnline();
  const aiOn = useAiEnabled();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const initials = (profile?.name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`shell ${open ? 'open' : ''}`} onClick={(e) => open && e.target === e.currentTarget && setOpen(false)}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Smartphone size={18} /></div>
          <div className="brand-name">DIGITAL CELL<span>PRO</span></div>
        </div>
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter((i) => (!i.perm || can(i.perm)) && (!i.ai || aiOn));
            if (!items.length) return null;
            return (
              <div key={s.label}>
                <div className="nav-label">{s.label}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'}>
                    {i.icon}{i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="avatar">{initials}</div>
          <div className="who">
            {profile?.name}
            <small>{profile ? ROLE_LABEL[profile.role] : ''}</small>
            <small className="app-version" title="Versión publicada">v {APP_VERSION}</small>
          </div>
          <button className="icon-btn" title="Cerrar sesión" onClick={() => void signOut()}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menú"><Menu size={20} /></button>
          <div className="grow" />
          {!online ? (
            <span className="pill offline" title="Puede consultar la información ya cargada. Para facturar, crear órdenes o mover caja e inventario se necesita internet.">
              <span className="dot" />Sin conexión · solo consulta
            </span>
          ) : backend.mode === 'local' ? (
            <span className="pill demo" title="Los datos se guardan solo en este navegador. Configure Firebase para usar la nube.">
              <span className="dot" />Modo demo · datos locales
            </span>
          ) : (
            <span className="pill cloud"><span className="dot" />Nube conectada</span>
          )}
          <button className={`font-btn ${fontScale > 1 ? 'on' : ''}`} onClick={nextFontScale}
            title={`Tamaño de letra: ${fontLabel} (toque para cambiar)`} aria-label={`Tamaño de letra: ${fontLabel}. Cambiar`}>
            <span style={{ fontSize: 11 }}>A</span><span style={{ fontSize: 16 }}>A</span>
            <small>{fontLabel}</small>
          </button>
          <button className="icon-btn" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
