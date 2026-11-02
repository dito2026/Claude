import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type { Customer, Device, Priority, RepairOrder, Technician } from '../lib/types';
import { OPEN_STATUSES } from '../lib/types';
import { dateTime, fromLocalInput, matches, money, pad, toLocalInput } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, Field, Modal, MoneyInput, PageHead, SearchBox, Seg, useAction } from '../components/ui';
import { CustomerPicker } from '../components/CustomerPicker';
import { orderTone, PRIORITIES, priorityTone } from '../components/status';
import { createOrder, isOverdue, orderTotal } from '../services/orders';
import { useSettings } from '../services/settings';

type Filter = 'abiertas' | 'listas' | 'atrasadas' | 'cerradas' | 'todas';

export function Orders() {
  const { rows, loading } = useCollection<RepairOrder>('repairOrders');
  const { profile, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('abiertas');
  const [mineOnly, setMineOnly] = useState(profile?.role === 'tecnico');
  const creating = params.get('nueva') === '1';

  const list = rows
    .filter((o) => !mineOnly || o.technicianId === profile?.technicianId)
    .filter((o) => {
      switch (filter) {
        case 'abiertas': return OPEN_STATUSES.includes(o.status);
        case 'listas': return o.status === 'Reparado / Listo';
        case 'atrasadas': return isOverdue(o);
        case 'cerradas': return o.status === 'Entregado' || o.status === 'No reparado';
        default: return true;
      }
    })
    .filter((o) => matches(q, o.number, o.customer.name, o.customer.phone, o.device.brand, o.device.model, o.device.imei, o.reportedIssue))
    .sort((a, b) => b.number - a.number);

  return (
    <>
      <PageHead
        eyebrow="Servicio técnico"
        title="Órdenes de reparación"
        subtitle="Cada equipo recibido es una orden de trabajo (OT) con su historial, repuestos y cobro."
        actions={
          <>
            <SearchBox value={q} onChange={setQ} placeholder="OT, cliente, equipo o IMEI" />
            {can('orders.create') && (
              <button className="btn primary" onClick={() => setParams({ nueva: '1' })}><Plus size={16} />Nueva orden</button>
            )}
          </>
        }
      />
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'abiertas', label: 'Abiertas' },
            { value: 'listas', label: 'Listas' },
            { value: 'atrasadas', label: 'Atrasadas' },
            { value: 'cerradas', label: 'Cerradas' },
            { value: 'todas', label: 'Todas' },
          ]}
        />
        {profile?.technicianId && (
          <label className="checkbox"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />Solo mis órdenes</label>
        )}
        <span className="faint">{list.length} órdenes</span>
      </div>
      <div className="card">
        {loading ? <Empty>Cargando…</Empty> : list.length === 0 ? <Empty>No hay órdenes en esta vista.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>OT</th><th>Equipo</th><th>Cliente</th><th>Técnico</th><th>Estado</th><th>Prioridad</th><th>Entrega</th><th className="num">Total</th></tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className="click" onClick={() => nav(`/taller/${o.id}`)}>
                    <td className="mono strong">{pad(o.number)}</td>
                    <td><span className="strong">{o.device.brand} {o.device.model}</span><small>{o.reportedIssue}</small></td>
                    <td>{o.customer.name}<small>{o.customer.phone}</small></td>
                    <td>{o.technicianName || <span className="faint">Sin asignar</span>}</td>
                    <td><Badge tone={orderTone(o.status)}>{o.status}</Badge></td>
                    <td><Badge tone={priorityTone(o.priority)}>{o.priority}</Badge></td>
                    <td className="nowrap">{isOverdue(o) ? <span className="red">{dateTime(o.promisedAt)}</span> : dateTime(o.promisedAt)}</td>
                    <td className="num">{money(orderTotal(o) || o.budget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewOrderModal onClose={() => setParams({})} onCreated={(id) => nav(`/taller/${id}`)} />}
    </>
  );
}

const EMPTY_DEVICE: Device = { brand: '', model: '', imei: '', color: '', unlockCode: '', accessories: '', condition: '' };

function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { actor } = useAuth();
  const settings = useSettings();
  const techs = useCollection<Technician>('technicians').rows.filter((t) => t.active);
  const { run, busy } = useAction();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [device, setDevice] = useState<Device>(EMPTY_DEVICE);
  const [issue, setIssue] = useState('');
  const [techId, setTechId] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [promised, setPromised] = useState(toLocalInput(new Date(Date.now() + 2 * 86400000).toISOString()));
  const [budget, setBudget] = useState(0);
  const [labor, setLabor] = useState(0);
  const [techPay, setTechPay] = useState(0);
  const [warranty, setWarranty] = useState(settings.defaultWarrantyDays);
  const [deposit, setDeposit] = useState(0);
  const [depMethod, setDepMethod] = useState('Efectivo');

  useEffect(() => setWarranty(settings.defaultWarrantyDays), [settings.defaultWarrantyDays]);
  const dev = (k: keyof Device) => (e: { target: { value: string } }) => setDevice({ ...device, [k]: e.target.value });

  const submit = () =>
    run(async () => {
      const t = techs.find((x) => x.id === techId);
      const r = await createOrder(actor, {
        customer: customer!,
        device,
        reportedIssue: issue,
        technicianId: t?.id ?? '',
        technicianName: t?.name ?? '',
        technicianUserId: t?.userId ?? '',
        priority,
        promisedAt: fromLocalInput(promised),
        budget,
        laborPrice: labor,
        technicianPay: techPay,
        warrantyDays: warranty,
        intakeDeposit: deposit > 0 ? { amount: deposit, method: depMethod } : undefined,
      });
      onCreated(r.id);
    }, 'Orden creada');

  return (
    <Modal
      wide
      title="Nueva orden de reparación"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !customer} onClick={submit}>Crear orden</button>
        </>
      }
    >
      <div className="stack">
        <Field label="Cliente" required><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <div className="form-grid three">
          <Field label="Marca" required><input className="input" value={device.brand} onChange={dev('brand')} placeholder="Samsung, Apple, Xiaomi…" /></Field>
          <Field label="Modelo" required><input className="input" value={device.model} onChange={dev('model')} /></Field>
          <Field label="IMEI o serial"><input className="input mono" value={device.imei} onChange={dev('imei')} /></Field>
          <Field label="Color"><input className="input" value={device.color} onChange={dev('color')} /></Field>
          <Field label="Clave / patrón de desbloqueo"><input className="input" value={device.unlockCode} onChange={dev('unlockCode')} /></Field>
          <Field label="Accesorios que deja"><input className="input" value={device.accessories} onChange={dev('accessories')} placeholder="Cargador, forro, SIM…" /></Field>
          <Field label="Falla reportada" required className="full"><textarea className="input" value={issue} onChange={(e) => setIssue(e.target.value)} /></Field>
          <Field label="Revisión al recibir (estado físico)" className="full"><input className="input" value={device.condition} onChange={dev('condition')} placeholder="Rayones, golpes, pantalla, humedad…" /></Field>
          <Field label="Técnico">
            <select className="input" value={techId} onChange={(e) => setTechId(e.target.value)}>
              <option value="">Sin asignar</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Prometida para"><input className="input" type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} /></Field>
          <Field label="Presupuesto al cliente"><MoneyInput value={budget} onChange={setBudget} /></Field>
          <Field label="Mano de obra (cobro)"><MoneyInput value={labor} onChange={setLabor} /></Field>
          <Field label="Pago al técnico"><MoneyInput value={techPay} onChange={setTechPay} /></Field>
          <Field label="Garantía (días)"><input className="input num" type="number" min={0} value={warranty} onChange={(e) => setWarranty(Number(e.target.value))} /></Field>
          <Field label="Abono inicial"><MoneyInput value={deposit} onChange={setDeposit} /></Field>
          <Field label="Medio del abono">
            <select className="input" value={depMethod} onChange={(e) => setDepMethod(e.target.value)} disabled={!deposit}>
              {settings.paymentMethods.filter((m) => m !== 'Crédito tienda').map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Los repuestos se agregan desde la orden y se descuentan del inventario en ese momento.</div>
      </div>
    </Modal>
  );
}
