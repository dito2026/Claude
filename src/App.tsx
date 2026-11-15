import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import type { Permission } from './auth/permissions';
import { Layout } from './components/Layout';
import { Empty, ToastProvider } from './components/ui';
import { Login } from './pages/Login';
import { seedDemo } from './services/seed';
import { lazyPage, PageErrorBoundary, preloadPages } from './lazyPage';

// Cada pantalla se descarga cuando se abre; las demás se bajan en segundo plano al entrar.
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'Dashboard');
const Customers = lazyPage(() => import('./pages/Customers'), 'Customers');
const Orders = lazyPage(() => import('./pages/Orders'), 'Orders');
const OrderDetail = lazyPage(() => import('./pages/OrderDetail'), 'OrderDetail');
const Tickets = lazyPage(() => import('./pages/Tickets'), 'Tickets');
const Inventory = lazyPage(() => import('./pages/Inventory'), 'Inventory');
const Billing = lazyPage(() => import('./pages/Billing'), 'Billing');
const Cash = lazyPage(() => import('./pages/Cash'), 'Cash');
const Purchases = lazyPage(() => import('./pages/Purchases'), 'Purchases');
const UsedPhones = lazyPage(() => import('./pages/UsedPhones'), 'UsedPhones');
const Remissions = lazyPage(() => import('./pages/Remissions'), 'Remissions');
const LineModule = lazyPage(() => import('./pages/LineModule'), 'LineModule');
const Accounting = lazyPage(() => import('./pages/Accounting'), 'Accounting');
const Sellers = lazyPage(() => import('./pages/Sellers'), 'Sellers');
const Assistant = lazyPage(() => import('./pages/Assistant'), 'Assistant');
const Technicians = lazyPage(() => import('./pages/Technicians'), 'Technicians');
const Users = lazyPage(() => import('./pages/Users'), 'Users');
const SettingsPage = lazyPage(() => import('./pages/Settings'), 'SettingsPage');
const ALL_PAGES = [Dashboard, Customers, Orders, OrderDetail, Tickets, Inventory, Billing, Cash, Purchases, UsedPhones, Remissions, LineModule, Accounting, Sellers, Assistant, Technicians, Users, SettingsPage];

function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Empty>No tiene permiso para ver este módulo.</Empty>;
  return <>{children}</>;
}

function Preload() {
  useEffect(() => preloadPages(ALL_PAGES), []);
  return null;
}

function Shell() {
  const { user, profile, loading, signOut } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="empty" style={{ paddingTop: 120 }}>Cargando DIGITAL CELL PRO…</div>;
  if (!user) return <Login />;
  if (!profile || !profile.active) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <p>{profile ? 'Su usuario está desactivado.' : 'Su cuenta no tiene un perfil asignado.'} Contacte al administrador.</p>
        <button className="btn" onClick={() => void signOut()}>Cerrar sesión</button>
      </div>
    );
  }
  return (
    <Layout>
      <Preload />
      <PageErrorBoundary resetKey={pathname}>
      <Suspense fallback={<div className="empty" style={{ paddingTop: 60 }}>Cargando…</div>}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clientes" element={<Customers />} />
        <Route path="/taller" element={<Orders />} />
        <Route path="/taller/:id" element={<OrderDetail />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/inventario" element={<Inventory />} />
        <Route path="/facturacion" element={<Guard perm="billing"><Billing /></Guard>} />
        <Route path="/caja" element={<Guard perm="cash"><Cash /></Guard>} />
        <Route path="/celulares" element={<Guard perm="billing"><LineModule key="celulares" module="celulares" /></Guard>} />
        <Route path="/accesorios" element={<Guard perm="billing"><LineModule key="accesorios" module="accesorios" /></Guard>} />
        <Route path="/servicio" element={<LineModule key="servicio" module="servicio" />} />
        <Route path="/remisiones" element={<Guard perm="billing"><Remissions /></Guard>} />
        <Route path="/compras" element={<Guard perm="purchases"><Purchases /></Guard>} />
        <Route path="/usados" element={<Guard perm="purchases"><UsedPhones /></Guard>} />
        <Route path="/contabilidad" element={<Guard perm="dashboard.finance"><Accounting /></Guard>} />
        <Route path="/asistente" element={<Guard perm="dashboard.finance"><Assistant /></Guard>} />
        <Route path="/vendedores" element={<Guard perm="staff.manage"><Sellers /></Guard>} />
        <Route path="/tecnicos" element={<Guard perm="staff.manage"><Technicians /></Guard>} />
        <Route path="/usuarios" element={<Guard perm="staff.manage"><Users /></Guard>} />
        <Route path="/configuracion" element={<Guard perm="settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </PageErrorBoundary>
    </Layout>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    seedDemo().catch((e) => console.error('No se pudieron crear los datos demo', e)).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
