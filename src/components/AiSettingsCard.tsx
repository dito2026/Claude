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
  'settings', 'counters', 'users', 'technicians', 'sellers', 'customers', 'products', 'stockMovements', 'phoneUnits',
  'imeiIndex', 'repairOrders', 'tickets', 'invoices', 'cashSessions', 'cashMovements', 'suppliers', 'purchases', 'usedPurchases', 'reminders',
];
/** «meta» no se puede listar entera (reglas de Firestore): se leen sus documentos uno por uno. */
const META_DOCS = ['bootstrap', 'cash'];

/** Lee todos los datos. Una colección que falle no detiene el respaldo: queda anotada en `failed`. */
export async function collectBackup() {
  const data: Record<string, unknown[]> = {};
  const failed: string[] = [];
  const results = await Promise.allSettled(BACKUP_COLLECTIONS.map((c) => backend.list(c)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') data[BACKUP_COLLECTIONS[i]] = r.value;
    else failed.push(BACKUP_COLLECTIONS[i]);
  });
  data.meta = [];
  for (const id of META_DOCS) {
    try {
      const d = await backend.get('meta', id);
      if (d) data.meta.push({ ...(d as object), id });
    } catch {
      failed.push(`meta/${id}`);
    }
  }
  return { data, failed };
}

/** Descarga todos los datos en un archivo JSON (no incluye la clave de IA). */
export function BackupCard() {
  const { run, busy } = useAction();
  const toast = useToast();
  const download = () => run(async () => {
    const { data, failed } = await collectBackup();
    if (failed.length === BACKUP_COLLECTIONS.length) throw new Error('No se pudo leer ningún dato. Revise la conexión a internet e intente de nuevo.');
    const name = `respaldo-digital-cell_${new Date().toISOString().slice(0, 10)}.json`;
    const json = JSON.stringify({ app: 'DIGITAL CELL PRO', exportedAt: new Date().toISOString(), data, ...(failed.length ? { incompleto: failed } : {}) }, null, 1);
    const blob = new Blob([json], { type: 'application/json' });
    // En celular (sobre todo iPhone con la app instalada) descargar no siempre funciona: se usa «Compartir»
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/json' }) : null;
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    let shared = false;
    if (touch && file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Respaldo Digital Cell' });
        shared = true;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // el usuario canceló
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch { /* sin almacenamiento */ }
    if (failed.length) toast(`Respaldo descargado, pero sin: ${failed.join(', ')} (sin permiso).`, 'error');
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
