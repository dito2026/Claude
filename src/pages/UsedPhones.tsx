import { useMemo, useState } from 'react';
import { FileText, Plus, Printer, ShieldCheck, Smartphone } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { BusinessSettings, PhoneUnit, Product, UsedPurchase, UsedSeller } from '../lib/types';
import { CREDIT_METHOD } from '../lib/types';
import { matches, money, pad } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../services/settings';
import { buyUsedPhone, findPhoneProduct, pesosInWords, type UsedDraft } from '../services/used';
import { imeiError, normalizeImei } from '../services/phones';
import { BrandInput, ModelInput } from '../components/BrandModel';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Stat, printNow, useAction } from '../components/ui';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

export function UsedPhones() {
  const contracts = useCollection<UsedPurchase>('usedPurchases').rows;
  const units = useCollection<PhoneUnit>('phoneUnits').rows;
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<UsedPurchase | null>(null);

  const unitOf = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const list = useMemo(
    () => [...contracts]
      .filter((c) => matches(q, c.number, c.seller.name, c.seller.document, c.device.brand, c.device.model, c.device.imei, c.device.imei2))
      .sort((a, b) => b.number - a.number),
    [contracts, q],
  );
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const month = contracts.filter((c) => new Date(c.createdAt ?? 0).getTime() >= monthStart);
  const inStock = contracts.filter((c) => unitOf.get(c.device.imei)?.status === 'disponible');

  return (
    <>
      <PageHead eyebrow="Operación" title="Compraventa de usados"
        subtitle="Cuando le compra un celular a un cliente: contrato firmado, el equipo entra al inventario por IMEI como USADO y el pago sale de caja (o por fuera, si lo indica)."
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Nuevo contrato</button>} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat accent label="Comprados este mes" value={month.length} sub={`Pagado ${money(month.reduce((a, c) => a + c.price, 0))}`} icon={<Smartphone size={15} />} />
        <Stat label="Usados en inventario" value={inStock.length} sub={`Costo ${money(inStock.reduce((a, c) => a + c.price, 0))}`} />
        <Stat label="Contratos" value={contracts.length} />
      </div>
      <div className="card">
        <div className="card-head">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar por N.º, vendedor, cédula, modelo o IMEI" />
        </div>
        {list.length === 0 ? <Empty icon={<FileText size={34} />}>{contracts.length ? 'Sin resultados.' : 'Aún no hay contratos. Toque «Nuevo contrato» cuando le compre un celular a un cliente.'}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>N.º</th><th>Fecha</th><th>Vendedor</th><th>Equipo</th><th>IMEI</th><th className="num">Precio</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {list.map((c) => {
                  const u = unitOf.get(c.device.imei);
                  return (
                    <tr key={c.id} className="click" onClick={() => setViewing(c)}>
                      <td className="mono">{pad(c.number, 4)}</td>
                      <td className="nowrap">{longDate(c.date)}</td>
                      <td><span className="strong">{c.seller.name}</span><small>C.C. {c.seller.document}</small></td>
                      <td>{c.device.brand} {c.device.model}{c.device.color && <small>{c.device.color}</small>}</td>
                      <td className="mono">{c.device.imei}</td>
                      <td className="num">{money(c.price)}<small>{c.outsideCash ? 'Fuera de caja' : c.method}</small></td>
                      <td>{u?.status === 'vendido' ? <Badge tone="info">Vendido{u.salePrice ? ` · ${money(u.salePrice)}` : ''}</Badge> : u?.status === 'disponible' ? <Badge tone="ok">En inventario</Badge> : <Badge>—</Badge>}</td>
                      <td><button className="btn sm" onClick={(e) => { e.stopPropagation(); setViewing(c); }}><Printer size={14} />Ver / imprimir</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <UsedPurchaseModal s={settings} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); setViewing(c); }} />}
      {viewing && <ContractModal c={viewing} s={settings} onClose={() => setViewing(null)} />}
    </>
  );
}

const EMPTY_SELLER: UsedSeller = { name: '', document: '', documentCity: '', address: '', phone: '', landline: '' };

function UsedPurchaseModal({ s, onClose, onSaved }: { s: BusinessSettings; onClose: () => void; onSaved: (c: UsedPurchase) => void }) {
  const { actor } = useAuth();
  const { run, busy } = useAction();
  const products = useCollection<Product>('products').rows;
  const [date, setDate] = useState(today());
  const [city, setCity] = useState(s.city || '');
  const [seller, setSeller] = useState<UsedSeller>(EMPTY_SELLER);
  const [buyer, setBuyer] = useState({ name: s.ownerName ?? '', document: s.ownerDocument ?? '', documentCity: s.ownerDocumentCity ?? s.city ?? '' });
  const [device, setDevice] = useState({ brand: '', model: '', color: '', imei: '', imei2: '' });
  const [price, setPrice] = useState(0);
  const [method, setMethod] = useState('');
  const [salePrice, setSalePrice] = useState(0);
  const [verified, setVerified] = useState(false);
  const [outsideCash, setOutsideCash] = useState(false);
  const methods = s.paymentMethods.filter((m) => m !== CREDIT_METHOD);
  const ss = (k: keyof UsedSeller, v: string) => setSeller({ ...seller, [k]: v });
  const imeiMsg = (v: string) => (normalizeImei(v).length >= 14 ? imeiError(normalizeImei(v)) : null);
  const match = device.brand && device.model ? findPhoneProduct(products, device.brand, device.model) : undefined;

  const draft: UsedDraft = { date, city, seller, buyer, device, price, method, salePrice, imeiVerified: verified, outsideCash };
  const ready = seller.name.trim() && seller.document.trim() && seller.address.trim() && seller.phone.trim()
    && buyer.name.trim() && buyer.document.trim() && device.brand.trim() && device.model.trim() && device.imei.trim()
    && !imeiMsg(device.imei) && !(device.imei2 && imeiMsg(device.imei2)) && price > 0 && method && verified;

  const save = () => run(async () => {
    const c = await buyUsedPhone(actor, draft, products);
    onSaved(c);
  }, 'Contrato guardado y equipo cargado al inventario');

  return (
    <Modal wide title="Contrato de compraventa" onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !ready} onClick={save}><Printer size={16} />Guardar, cargar al inventario e imprimir</button></>}>
      <div className="form-grid three">
        <Field label="N.º de contrato"><input className="input" value="Automático" disabled /></Field>
        <Field label="Fecha"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Ciudad"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
      </div>

      <h4 className="form-section">El vendedor (el cliente que vende el celular)</h4>
      <div className="form-grid three">
        <Field label="Nombres y apellidos" required><input className="input" value={seller.name} onChange={(e) => ss('name', e.target.value)} autoFocus /></Field>
        <Field label="Documento de identidad" required><input className="input" inputMode="numeric" value={seller.document} onChange={(e) => ss('document', e.target.value)} /></Field>
        <Field label="Lugar de expedición"><input className="input" value={seller.documentCity} onChange={(e) => ss('documentCity', e.target.value)} /></Field>
        <Field label="Dirección de residencia" required><input className="input" value={seller.address} onChange={(e) => ss('address', e.target.value)} /></Field>
        <Field label="Celular" required><input className="input" inputMode="tel" value={seller.phone} onChange={(e) => ss('phone', e.target.value)} /></Field>
        <Field label="Teléfono fijo (opcional)"><input className="input" inputMode="tel" value={seller.landline} onChange={(e) => ss('landline', e.target.value)} /></Field>
      </div>

      <h4 className="form-section">El comprador</h4>
      <div className="form-grid three">
        <Field label="Nombre" required><input className="input" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></Field>
        <Field label="Cédula" required><input className="input" value={buyer.document} onChange={(e) => setBuyer({ ...buyer, document: e.target.value })} /></Field>
        <Field label="Expedida en"><input className="input" value={buyer.documentCity} onChange={(e) => setBuyer({ ...buyer, documentCity: e.target.value })} /></Field>
      </div>
      {!s.ownerName && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Consejo: guarde estos datos en Configuración → «Comprador en contratos» para que salgan solos.</div>}

      <h4 className="form-section">El equipo</h4>
      <div className="form-grid three">
        <Field label="Marca" required><BrandInput value={device.brand} onChange={(v) => setDevice({ ...device, brand: v })} required /></Field>
        <Field label="Modelo" required><ModelInput brand={device.brand} value={device.model} onChange={(v) => setDevice({ ...device, model: v })} placeholder="Ej.: Galaxy A15 128GB" /></Field>
        <Field label="Color (opcional)"><input className="input" value={device.color} onChange={(e) => setDevice({ ...device, color: e.target.value })} /></Field>
      </div>
      <div className="form-grid mt">
        <Field label="IMEI 1" required>
          <input className={`input mono ${imeiMsg(device.imei) ? 'invalid' : ''}`} inputMode="numeric" value={device.imei} onChange={(e) => setDevice({ ...device, imei: e.target.value })} placeholder="Marque *#06# en el celular" />
          {imeiMsg(device.imei) && <small className="red">{imeiMsg(device.imei)}</small>}
        </Field>
        <Field label="IMEI 2 (opcional)">
          <input className={`input mono ${device.imei2 && imeiMsg(device.imei2) ? 'invalid' : ''}`} inputMode="numeric" value={device.imei2} onChange={(e) => setDevice({ ...device, imei2: e.target.value })} />
          {device.imei2 && imeiMsg(device.imei2) && <small className="red">{imeiMsg(device.imei2)}</small>}
        </Field>
      </div>
      {device.brand && device.model && (
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
          {match ? <>Entra al inventario en «{match.name}» como <b>USADO</b>.</> : <>Se creará el producto «{device.brand} {device.model}» en Celulares.</>}
        </div>
      )}

      <h4 className="form-section">Precio y pago</h4>
      <div className="form-grid">
        <Field label="Precio que paga" required><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Precio de venta (opcional)"><MoneyInput value={salePrice} onChange={setSalePrice} /></Field>
      </div>
      <div className="field mt">
        <span>Pagado con <em>*</em></span>
        <div className={`pay-methods ${price > 0 && !method ? 'missing' : ''}`} role="radiogroup" aria-label="Pagado con">
          {methods.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} className={`cat-chip ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m}</button>
          ))}
        </div>
      </div>
      <label className="checkbox mt" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={outsideCash} onChange={(e) => setOutsideCash(e.target.checked)} />
        <span><b>No descontar de la caja</b>: lo pagué con dinero que no está en la caja (del dueño o de la cuenta). La caja no cambia; cuando lo venda, la plata de la venta entra normal.</span>
      </label>
      <label className="checkbox mt" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span>Verifiqué que el IMEI <b>no está reportado</b> como hurtado o perdido, y revisé el documento original del vendedor.</span>
      </label>
    </Modal>
  );
}

// ---------------- Contrato imprimible (carta, o «Guardar como PDF») ----------------
export function UsedContract({ c, s }: { c: UsedPurchase; s: BusinessSettings }) {
  const d = new Date(`${c.date}T12:00:00`);
  const month = d.toLocaleDateString('es-CO', { month: 'long' });
  const sellerDoc = `${c.seller.document}${c.seller.documentCity ? ` expedido en ${c.seller.documentCity}` : ''}`;
  const buyerDoc = `${c.buyer.document}${c.buyer.documentCity ? ` expedida en ${c.buyer.documentCity}` : ''}`;
  return (
    <div className="contract">
      <header className="contract-head">
        <div>
          <b>{s.name.toUpperCase()}</b>
          <div>{[s.nit && `NIT ${s.nit}`, s.address, s.city, s.phone && `Tel. ${s.phone}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="contract-no">Contrato N.º <b>{pad(c.number, 4)}</b></div>
      </header>
      <h1>Contrato de compraventa de equipo celular usado</h1>

      <p>
        En {c.city || s.city || '________'}, a los {d.getDate()} días del mes de {month} de {d.getFullYear()}, entre <b>{c.seller.name.toUpperCase()}</b>,
        mayor de edad, identificado(a) con documento N.º <b>{sellerDoc}</b>, domiciliado(a) en {c.seller.address}, celular {c.seller.phone}
        {c.seller.landline ? `, teléfono fijo ${c.seller.landline}` : ''}, quien en adelante se denomina <b>EL VENDEDOR</b>; y <b>{c.buyer.name.toUpperCase()}</b>,
        identificado(a) con cédula N.º <b>{buyerDoc}</b>, en nombre del establecimiento {s.name}{s.nit ? ` (NIT ${s.nit})` : ''}, quien en adelante
        se denomina <b>EL COMPRADOR</b>, se celebra el presente contrato de compraventa, que se rige por las siguientes cláusulas:
      </p>

      <p><b>PRIMERA. OBJETO.</b> EL VENDEDOR transfiere a título de venta a EL COMPRADOR, y este adquiere, el derecho de dominio y la posesión del siguiente equipo:</p>
      <table className="contract-table">
        <tbody>
          <tr><th>Marca</th><td>{c.device.brand}</td><th>Modelo</th><td>{c.device.model}</td></tr>
          <tr><th>IMEI 1</th><td className="mono">{c.device.imei}</td><th>IMEI 2</th><td className="mono">{c.device.imei2 || '—'}</td></tr>
          <tr><th>Color</th><td>{c.device.color || '—'}</td><th>Estado</th><td>Usado</td></tr>
        </tbody>
      </table>

      <p>
        <b>SEGUNDA. PRECIO Y FORMA DE PAGO.</b> El precio es de <b>{money(c.price)}</b> ({pesosInWords(c.price)}), pagado por EL COMPRADOR en {c.method.toLowerCase()} a la
        firma de este contrato. EL VENDEDOR declara que lo recibió a entera satisfacción.
      </p>
      <p>
        <b>TERCERA. DECLARACIONES DEL VENDEDOR.</b> EL VENDEDOR declara bajo la gravedad de juramento que: (a) es el único y legítimo propietario del equipo y lo adquirió de
        forma lícita; (b) el equipo no está reportado como hurtado, perdido ni bloqueado, y está libre de gravámenes, embargos o pleitos pendientes;
        (c) los datos personales que suministra son verdaderos. Si el equipo resultare de procedencia ilícita o reportado, EL VENDEDOR responderá civil y penalmente
        ante EL COMPRADOR y las autoridades, y se obliga a devolver de inmediato el dinero recibido.
      </p>
      <p>
        <b>CUARTA. VERIFICACIÓN.</b> EL COMPRADOR verificó el documento de identidad original de EL VENDEDOR y que el IMEI del equipo no figura reportado como hurtado o extraviado
        al momento de la compra.
      </p>
      <p>
        <b>QUINTA. ENTREGA Y ESTADO.</b> EL VENDEDOR entrega en este acto el equipo en el estado físico y de funcionamiento en que se encuentra, que EL COMPRADOR conoce y acepta,
        sin cuentas ni bloqueos que impidan su uso, y se compromete a desvincularlo de sus cuentas personales.
      </p>
      <p>
        <b>SEXTA. DATOS PERSONALES.</b> EL VENDEDOR autoriza a EL COMPRADOR a tratar sus datos personales para el registro de esta compra y para atender requerimientos de las
        autoridades, conforme a la Ley 1581 de 2012.
      </p>
      <p>Para constancia se firma en dos ejemplares del mismo tenor, en la fecha y ciudad indicadas.</p>

      <div className="contract-signs">
        <div className="sign with-print">
          <div className="grow">
            <div className="sign-line" />
            <b>EL VENDEDOR</b>
            <div>{c.seller.name}</div>
            <div>C.C. {c.seller.document}</div>
          </div>
          <div className="fingerprint">Huella índice derecho</div>
        </div>
        <div className="sign">
          <div className="sign-line" />
          <b>EL COMPRADOR</b>
          <div>{c.buyer.name}</div>
          <div>C.C. {c.buyer.document}</div>
        </div>
      </div>
      <footer className="contract-foot">IMEI verificado · registrado por {c.createdByName} · {new Date(c.createdAt ?? Date.now()).toLocaleString('es-CO')}</footer>
    </div>
  );
}

/** Imprime el contrato; en el diálogo de impresión, «Guardar como PDF» lo deja en PDF con nombre propio. */
function printContract(c: UsedPurchase) {
  const prev = document.title;
  document.title = `Contrato-compraventa-${pad(c.number, 4)}-${c.seller.name.replace(/\s+/g, '-')}`;
  document.body.classList.add('print-letter');
  const done = () => {
    document.title = prev;
    document.body.classList.remove('print-letter');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  printNow();
}

function ContractModal({ c, s, onClose }: { c: UsedPurchase; s: BusinessSettings; onClose: () => void }) {
  return (
    <Modal wide title={`Contrato de compraventa N.º ${pad(c.number, 4)}`} onClose={onClose}
      footer={<>
        <span className="faint grow" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} />Para PDF: en «Destino» elija «Guardar como PDF».</span>
        <button className="btn ghost" onClick={onClose}>Cerrar</button>
        <button className="btn primary" onClick={() => printContract(c)}><Printer size={16} />Imprimir / PDF</button>
      </>}>
      <UsedContract c={c} s={s} />
    </Modal>
  );
}
