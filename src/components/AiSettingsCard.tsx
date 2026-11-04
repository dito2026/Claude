import { useEffect, useState } from 'react';
import { Download, Sparkles } from 'lucide-react';
import { backend } from '../data';
import { AI_MODEL, aiAskBusiness, aiErrorMessage, saveAiConfig, type AiConfig } from '../services/ai';
import { BACKUP_KEY } from './AlertsCenter';
import { Field, useAction, useToast } from './ui';

/** Activar la IA con la clave de API de Anthropic (solo administrador). */
export function AiSettingsCard() {
  const { run, busy } = useAction();
  const toast = useToast();
  const [cfg, setCfg] = useState<AiConfig>({ apiKey: '', enabled: false });
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    backend.get<AiConfig & { id: string }>('secrets', 'ai')
      .then((c) => c && setCfg({ apiKey: c.apiKey ?? '', enabled: !!c.enabled }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);
  const test = async () => {
    setTesting(true);
    try {
      await aiAskBusiness([{ role: 'user', text: 'Responde solo: "Conexión correcta".' }], '{}');
      toast('La IA respondió correctamente.');
    } catch (e) {
      toast(aiErrorMessage(e), 'error');
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 8 }}><Sparkles size={16} className="red" style={{ verticalAlign: -2 }} /> Inteligencia artificial (Claude)</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Activa: diagnóstico de fallas en las órdenes, lectura de facturas de proveedor con foto y el asistente del negocio.
        Necesita una clave de API de Anthropic (console.anthropic.com). Se cobra por uso a esa cuenta; ponga un límite de gasto allí.
      </p>
      {!loaded ? <div className="faint">Cargando…</div> : (
        <div className="stack">
          <Field label="Clave de API (empieza por sk-ant-)">
            <input className="input mono" type="password" autoComplete="off" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="sk-ant-…" />
          </Field>
          <label className="checkbox"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />IA activada</label>
          <div className="row gap-sm">
            <button className="btn primary" disabled={busy} onClick={() => run(() => saveAiConfig(cfg), 'Configuración de IA guardada')}>Guardar</button>
            <button className="btn" disabled={testing || !cfg.enabled || !cfg.apiKey} onClick={() => void test()}>{testing ? 'Probando…' : 'Probar conexión'}</button>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            Modelo: <span className="mono">{AI_MODEL}</span>. La clave queda en la nube y solo la usa el personal con sesión iniciada en la app.
            Use una clave exclusiva para esta app y puede revocarla cuando quiera.
          </div>
        </div>
      )}
    </div>
  );
}

const BACKUP_COLLECTIONS = [
  'settings', 'meta', 'counters', 'users', 'technicians', 'sellers', 'customers', 'products', 'stockMovements', 'phoneUnits',
  'imeiIndex', 'repairOrders', 'tickets', 'invoices', 'cashSessions', 'cashMovements', 'suppliers', 'purchases',
];

/** Descarga todos los datos en un archivo JSON (no incluye la clave de IA). */
export function BackupCard() {
  const { run, busy } = useAction();
  const download = () => run(async () => {
    const data: Record<string, unknown[]> = {};
    for (const c of BACKUP_COLLECTIONS) data[c] = await backend.list(c);
    const blob = new Blob([JSON.stringify({ app: 'DIGITAL CELL PRO', exportedAt: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-digital-cell_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch { /* sin almacenamiento */ }
  }, 'Respaldo descargado');
  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 8 }}>Respaldo de los datos</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Descarga un archivo con todos los clientes, órdenes, ventas, caja, inventario, compras y configuración.
        Guárdelo en Google Drive o una memoria. El Panel le recuerda hacerlo cada semana.
      </p>
      <button className="btn" disabled={busy} onClick={download}><Download size={16} />Descargar respaldo completo</button>
    </div>
  );
}
