import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useCollection } from '../data/hooks';
import type { Customer, Product, Supplier, Technician } from '../lib/types';
import { importData, parseImportFile, type ImportFile, type ImportResult } from '../services/importer';
import { useSettings } from '../services/settings';
import { useAction } from './ui';

/** Carga datos base desde un archivo JSON (clientes, inventario, técnicos y configuración). */
export function ImportCard() {
  const { actor } = useAuth();
  const settings = useSettings();
  const customers = useCollection<Customer>('customers').rows;
  const products = useCollection<Product>('products').rows;
  const technicians = useCollection<Technician>('technicians').rows;
  const suppliers = useCollection<Supplier>('suppliers').rows;
  const { run, busy } = useAction();
  const [file, setFile] = useState<ImportFile | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const onPick = async (f: File | undefined) => {
    setError('');
    setResult(null);
    setFile(null);
    if (!f) return;
    try {
      setFile(parseImportFile(await f.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const go = () =>
    file &&
    run(async () => {
      setResult(await importData(actor, file, { customers, products, technicians, settings, suppliers }));
      setFile(null);
    }, 'Datos importados');

  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 8 }}>Importar datos anteriores</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Cargue el archivo <span className="mono">.json</span> con clientes, inventario, técnicos y datos del negocio.
        Lo que ya existe (mismo documento, SKU o nombre) se omite, así que puede repetirse sin duplicar.
      </p>
      <label className="btn">
        <Upload size={16} />Elegir archivo
        <input type="file" accept=".json,application/json" hidden onChange={(e) => void onPick(e.target.files?.[0])} />
      </label>
      {error && <div className="alert error mt">{error}</div>}
      {file && (
        <div className="stack mt">
          <div className="alert info">
            {file.source && <>Origen: <b>{file.source}</b> · </>}
            {file.customers?.length ?? 0} clientes · {file.products?.length ?? 0} productos ·{' '}
            {file.technicians?.length ?? 0} técnicos · {file.suppliers?.length ?? 0} proveedores{file.settings ? ' · datos del negocio' : ''}
          </div>
          <button className="btn primary" disabled={busy} onClick={go}>Importar ahora</button>
        </div>
      )}
      {result && (
        <div className="alert info mt">
          Importado: {result.customers.added} clientes, {result.products.added} productos, {result.technicians.added} técnicos, {result.suppliers.added} proveedores
          {result.settings ? ' y datos del negocio' : ''}. Omitidos por ya existir: {result.customers.skipped + result.products.skipped + result.technicians.skipped + result.suppliers.skipped}.
        </div>
      )}
    </div>
  );
}
