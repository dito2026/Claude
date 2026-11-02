import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Wrench, LifeBuoy, Package, HardHat, ShieldCheck, Receipt, Wallet,
  Settings, LogOut, Menu, Moon, Sun, Smartphone, Truck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { Permission } from '../auth/permissions';
import { backend } from '../data';
import { ROLE_LABEL } from '../services/staff';

interface NavItem { to: string; label: string; icon: ReactNode; perm?: Permission }

const SECTIONS: { label: string; items: NavItem[] }[] = [
  { label: 'General', items: [{ to: '/', label: 'Panel', icon: <LayoutDashboard size={18} /> }] },
  {
    label: 'Operación',
    items: [
      { to: '/taller', label: 'Órdenes de reparación', icon: <Wrench size={18} /> },
      { to: '/tickets', label: 'Tickets de soporte', icon: <LifeBuoy size={18} /> },
      { to: '/clientes', label: 'Clientes', icon: <Users size={18} /> },
      { to: '/inventario', label: 'Inventario', icon: <Package size={18} /> },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/facturacion', label: 'Facturación', icon: <Receipt size={18} />, perm: 'billing' },
      { to: '/caja', label: 'Caja', icon: <Wallet size={18} />, perm: 'cash' },
      { to: '/compras', label: 'Compras y proveedores', icon: <Truck size={18} />, perm: 'purchases' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/tecnicos', label: 'Técnicos', icon: <HardHat size={18} />, perm: 'staff.manage' },
      { to: '/usuarios', label: 'Usuarios y roles', icon: <ShieldCheck size={18} />, perm: 'staff.manage' },
      { to: '/configuracion', label: 'Configuración', icon: <Settings size={18} />, perm: 'settings' },
    ],
  },
];

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('dcpro:theme') as 'light' | 'dark') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('dcpro:theme', theme); } catch { /* sin almacenamiento */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))] as const;
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
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
            const items = s.items.filter((i) => !i.perm || can(i.perm));
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
          </div>
          <button className="icon-btn" title="Cerrar sesión" onClick={() => void signOut()}><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menú"><Menu size={20} /></button>
          <div className="grow" />
          {backend.mode === 'local' ? (
            <span className="pill demo" title="Los datos se guardan solo en este navegador. Configure Firebase para usar la nube.">
              <span className="dot" />Modo demo · datos locales
            </span>
          ) : (
            <span className="pill cloud"><span className="dot" />Nube conectada</span>
          )}
          <button className="icon-btn" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
