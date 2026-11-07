import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import type { Permission } from './auth/permissions';
import { Layout } from './components/Layout';
import { Empty, ToastProvider } from './components/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { Orders } from './pages/Orders';
import { OrderDetail } from './pages/OrderDetail';
import { Tickets } from './pages/Tickets';
import { Inventory } from './pages/Inventory';
import { Billing } from './pages/Billing';
import { Cash } from './pages/Cash';
import { Purchases } from './pages/Purchases';
import { UsedPhones } from './pages/UsedPhones';
import { Remissions } from './pages/Remissions';
import { Accounting } from './pages/Accounting';
import { Sellers } from './pages/Sellers';
import { Assistant } from './pages/Assistant';
import { Technicians } from './pages/Technicians';
import { Users } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { seedDemo } from './services/seed';

function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Empty>No tiene permiso para ver este módulo.</Empty>;
  return <>{children}</>;
}

function Shell() {
  const { user, profile, loading, signOut } = useAuth();
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
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clientes" element={<Customers />} />
        <Route path="/taller" element={<Orders />} />
        <Route path="/taller/:id" element={<OrderDetail />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/inventario" element={<Inventory />} />
        <Route path="/facturacion" element={<Guard perm="billing"><Billing /></Guard>} />
        <Route path="/caja" element={<Guard perm="cash"><Cash /></Guard>} />
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
