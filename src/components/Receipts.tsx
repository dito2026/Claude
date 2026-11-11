import { Mail, MessageCircle, Printer } from 'lucide-react';
import type { BusinessSettings, Invoice, RepairOrder } from '../lib/types';
import { dateOnly, dateTime, money, pad, whatsappLink } from '../lib/format';
import { depositsTotal, orderTotal } from '../services/orders';
import { Modal, printNow } from './ui';

function Header({ s }: { s: BusinessSettings }) {
  return (
    <>
      <h2>{s.name.toUpperCase()}</h2>
      <div className="c">{s.slogan}</div>
      {s.nit && <div className="c">NIT {s.nit}</div>}
      {s.address && <div className="c">{s.address}{s.city ? ` · ${s.city}` : ''}</div>}
      {s.phone && <div className="c">Tel. {s.phone}</div>}
      {s.taxRate === 0 && <div className="c">No responsable de IVA</div>}
      <hr />
    </>
  );
}

export function InvoiceReceipt({ inv, s }: { inv: Invoice; s: BusinessSettings }) {
  return (
    <div className="receipt">
      <Header s={s} />
      <div><b>Comprobante de venta N.º {pad(inv.number, 6)}</b></div>
      <div>{dateTime(inv.createdAt)}</div>
      <div>Cliente: {inv.customer.name || 'Consumidor final'}</div>
      {inv.customer.document && <div>Doc.: {inv.customer.document}</div>}
      {inv.repairOrderNumber && <div>Orden de servicio: OT {pad(inv.repairOrderNumber)}</div>}
      <div>Atendió: {inv.cashierName}</div>
      {inv.status === 'anulada' && <div className="big c">*** ANULADA ***</div>}
      <hr />
      <table>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td>{it.qty} × {it.description}{it.imei ? <><br />IMEI {it.imei}</> : null}
                {it.unitId && <><br />{warrantyLine(it)}</>}</td>
              <td className="r">{money(it.qty * it.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table>
        <tbody>
          <tr><td>Subtotal</td><td className="r">{money(inv.subtotal)}</td></tr>
          {inv.discount > 0 && <tr><td>Descuento</td><td className="r">-{money(inv.discount)}</td></tr>}
          {inv.tax > 0 && <tr><td>IVA</td><td className="r">{money(inv.tax)}</td></tr>}
          <tr className="big"><td>TOTAL</td><td className="r">{money(inv.total)}</td></tr>
          {inv.depositsApplied > 0 && <tr><td>Abonos previos</td><td className="r">-{money(inv.depositsApplied)}</td></tr>}
          {inv.payments.map((p, i) => (
            <tr key={i}><td>{p.method}</td><td className="r">{money(p.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      {s.warrantyTerms?.trim() && (
        <>
          <hr />
          <div className="c receipt-terms">{s.warrantyTerms}</div>
        </>
      )}
      <hr />
      <div className="c">{s.ticketFooter}</div>
    </div>
  );
}

/** «Garantía 6 meses · hasta 11/05/2027» o «Sin garantía». */
export function warrantyLine(it: Pick<Invoice['items'][number], 'warrantyMonths' | 'warrantyUntil'>) {
  if (it.warrantyMonths == null) return '';
  if (it.warrantyMonths <= 0) return 'Sin garantía';
  return `Garantía ${it.warrantyMonths} ${it.warrantyMonths === 1 ? 'mes' : 'meses'}${it.warrantyUntil ? ` · hasta ${dateOnly(it.warrantyUntil)}` : ''}`;
}

export function OrderReceipt({ o, s }: { o: RepairOrder; s: BusinessSettings }) {
  const total = orderTotal(o);
  const deposits = depositsTotal(o);
  return (
    <div className="receipt">
      <Header s={s} />
      <div className="big c">ORDEN DE SERVICIO</div>
      <div className="big c">OT {pad(o.number)}</div>
      <hr />
      <div>Ingreso: {dateTime(o.createdAt)}</div>
      {o.promisedAt && <div>Entrega estimada: {dateTime(o.promisedAt)}</div>}
      <div>Cliente: {o.customer.name}</div>
      {o.customer.phone && <div>Cel.: {o.customer.phone}</div>}
      <hr />
      <div>Equipo: {o.device.brand} {o.device.model}</div>
      {o.device.imei && <div>IMEI/serial: {o.device.imei}</div>}
      {o.device.color && <div>Color: {o.device.color}</div>}
      <div>Accesorios: {o.device.accessories || 'Ninguno'}</div>
      <div>Estado físico: {o.device.condition || '—'}</div>
      <div>Falla: {o.reportedIssue}</div>
      <hr />
      <table>
        <tbody>
          <tr><td>Presupuesto</td><td className="r">{money(o.budget || total)}</td></tr>
          <tr><td>Abonado</td><td className="r">{money(deposits)}</td></tr>
          <tr className="big"><td>Saldo</td><td className="r">{money(Math.max(0, (o.budget || total) - deposits))}</td></tr>
        </tbody>
      </table>
      <hr />
      <div style={{ fontSize: 10 }}>
        Garantía de {o.warrantyDays} días sobre la reparación realizada, no cubre golpes, humedad ni
        manipulación de terceros. Equipos no reclamados después de 90 días se consideran abandonados.
      </div>
      <br />
      <div>Firma cliente: ______________________</div>
      <hr />
      <div className="c">{s.ticketFooter}</div>
    </div>
  );
}

const invoiceText = (inv: Invoice, s: BusinessSettings) =>
  [
    `*${s.name}* · Comprobante N.º ${pad(inv.number, 6)}`,
    dateOnly(inv.createdAt),
    ...inv.items.map((i) => `• ${i.qty} × ${i.description}: ${money(i.qty * i.unitPrice)}${i.imei ? `\n   IMEI ${i.imei}` : ''}${i.unitId && i.warrantyMonths != null ? `\n   ${warrantyLine(i)}` : ''}`),
    `*Total: ${money(inv.total)}*`,
    s.ticketFooter,
    ...(s.warrantyTerms?.trim() ? ['', s.warrantyTerms.trim()] : []),
  ].join('\n');

const orderText = (o: RepairOrder, s: BusinessSettings) =>
  [
    `*${s.name}* · Orden de servicio *OT ${pad(o.number)}*`,
    `Equipo: ${o.device.brand} ${o.device.model}`,
    `Estado: *${o.status}*`,
    o.promisedAt ? `Entrega estimada: ${dateTime(o.promisedAt)}` : '',
    `Abonado: ${money(depositsTotal(o))}`,
  ]
    .filter(Boolean)
    .join('\n');

function ShareButtons({ phone, email, subject, text }: { phone?: string; email?: string; subject: string; text: string }) {
  return (
    <>
      {phone && (
        <a className="btn" href={whatsappLink(phone, text)} target="_blank" rel="noreferrer">
          <MessageCircle size={16} />WhatsApp
        </a>
      )}
      {email && (
        <a className="btn" href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.replace(/\*/g, ''))}`}>
          <Mail size={16} />Correo
        </a>
      )}
      <button className="btn primary" onClick={printNow}><Printer size={16} />Imprimir</button>
    </>
  );
}

export function InvoiceModal({ inv, s, onClose }: { inv: Invoice; s: BusinessSettings; onClose: () => void }) {
  return (
    <Modal
      title={`Comprobante N.º ${pad(inv.number, 6)}`}
      onClose={onClose}
      footer={<ShareButtons phone={inv.customer.phone} email={inv.customer.email} subject={`Comprobante ${inv.number}`} text={invoiceText(inv, s)} />}
    >
      <InvoiceReceipt inv={inv} s={s} />
    </Modal>
  );
}

export function OrderReceiptModal({ o, s, onClose }: { o: RepairOrder; s: BusinessSettings; onClose: () => void }) {
  return (
    <Modal
      title={`Recibo de ingreso OT ${pad(o.number)}`}
      onClose={onClose}
      footer={<ShareButtons phone={o.customer.phone} email={o.customer.email} subject={`Orden de servicio ${o.number}`} text={orderText(o, s)} />}
    >
      <OrderReceipt o={o} s={s} />
    </Modal>
  );
}
