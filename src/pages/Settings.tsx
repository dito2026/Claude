import { useEffect, useState } from 'react';
import type { BusinessSettings } from '../lib/types';
import { backend, cloudConfigured } from '../data';
import { Field, PageHead, useAction } from '../components/ui';
import { saveSettings, useSettings } from '../services/settings';
import { ImportCard } from '../components/ImportCard';

export function SettingsPage() {
  const current = useSettings();
  const { run, busy } = useAction();
  const [d, setD] = useState<BusinessSettings>(current);
  useEffect(() => setD(current), [JSON.stringify(current)]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setD({ ...d, [k]: v });
  const list = (k: 'paymentMethods' | 'expenseCategories') => (
    <textarea className="input" rows={6} value={d[k].join('\n')} onChange={(e) => set(k, e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
  );

  return (
    <>
      <PageHead eyebrow="Administración" title="Configuración" subtitle="Datos del negocio que aparecen en comprobantes y reglas del sistema."
        actions={<button className="btn primary" disabled={busy} onClick={() => run(() => saveSettings(d), 'Configuración guardada')}>Guardar cambios</button>} />
      <div className="grid g2">
        <div className="card card-pad">
          <h3 style={{ marginBottom: 14 }}>Datos del negocio</h3>
          <div className="form-grid">
            <Field label="Nombre comercial" className="full"><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Lema" className="full"><input className="input" value={d.slogan} onChange={(e) => set('slogan', e.target.value)} /></Field>
            <Field label="NIT"><input className="input mono" value={d.nit} onChange={(e) => set('nit', e.target.value)} /></Field>
            <Field label="Teléfono"><input className="input" value={d.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Dirección"><input className="input" value={d.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Ciudad"><input className="input" value={d.city} onChange={(e) => set('city', e.target.value)} /></Field>
            <Field label="Correo" className="full"><input className="input" value={d.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Pie del comprobante" className="full"><input className="input" value={d.ticketFooter} onChange={(e) => set('ticketFooter', e.target.value)} /></Field>
          </div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 14 }}>Reglas</h3>
          <div className="form-grid">
            <Field label="Garantía por defecto en reparaciones (días)"><input className="input num" type="number" min={0} value={d.defaultWarrantyDays} onChange={(e) => set('defaultWarrantyDays', Number(e.target.value))} /></Field>
            <Field label="IVA (%) · 0 = no responsable"><input className="input num" type="number" min={0} max={19} value={d.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))} /></Field>
            <Field label="Medios de pago (uno por línea)">{list('paymentMethods')}</Field>
            <Field label="Categorías de gasto (una por línea)">{list('expenseCategories')}</Field>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>«Efectivo» y «Crédito tienda» tienen tratamiento especial en caja; no los renombre.</div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 8 }}>Base de datos</h3>
          {cloudConfigured ? (
            <p className="muted" style={{ margin: 0 }}>Conectado a <b>Cloud Firestore</b> (proyecto <span className="mono">{import.meta.env.VITE_FIREBASE_PROJECT_ID}</span>). Los datos se sincronizan en tiempo real entre todos los equipos y funcionan sin conexión.</p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Modo <b>demo</b>: los datos viven solo en este navegador. Para usar la nube, configure las variables <span className="mono">VITE_FIREBASE_*</span> (ver README) y vuelva a compilar.</p>
          )}
          {backend.mode === 'local' && (
            <button className="btn danger mt" onClick={() => { if (confirm('¿Borrar todos los datos de demostración de este navegador?')) { localStorage.removeItem('dcpro:db:v1'); localStorage.removeItem('dcpro:session:v1'); location.reload(); } }}>
              Reiniciar datos demo
            </button>
          )}
        </div>
        <ImportCard />
      </div>
    </>
  );
}
