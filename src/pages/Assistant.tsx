import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Trash2 } from 'lucide-react';
import { useCollection } from '../data/hooks';
import type {
  CashMovement, Invoice, PhoneUnit, Product, Purchase, RepairOrder, Seller, StockMovement, Supplier, Technician,
} from '../lib/types';
import { PageHead } from '../components/ui';
import { businessSnapshot } from '../services/automation';
import { aiAskBusiness, aiErrorMessage, type ChatTurn } from '../services/ai';

const SUGGESTIONS = [
  '¿Cómo me fue esta semana comparado con la anterior?',
  '¿Qué repuestos y accesorios debo comprar y a quién?',
  '¿Cuáles órdenes están atrasadas y qué hago con ellas?',
  '¿Qué línea de negocio me deja más ganancia este mes?',
  '¿A qué proveedores les debo y qué vence primero?',
  '¿Qué celulares llevan más tiempo sin venderse?',
];

const STORE = 'dcpro:assistant:v1';

export function Assistant() {
  const invoices = useCollection<Invoice>('invoices').rows;
  const movements = useCollection<CashMovement>('cashMovements').rows;
  const products = useCollection<Product>('products').rows;
  const orders = useCollection<RepairOrder>('repairOrders').rows;
  const purchases = useCollection<Purchase>('purchases').rows;
  const units = useCollection<PhoneUnit>('phoneUnits').rows;
  const technicians = useCollection<Technician>('technicians').rows;
  const sellers = useCollection<Seller>('sellers').rows;
  const stockMovements = useCollection<StockMovement>('stockMovements').rows;
  const suppliers = useCollection<Supplier>('suppliers').rows;

  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as ChatTurn[]; } catch { return []; }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(turns)); } catch { /* sin almacenamiento */ }
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const next: ChatTurn[] = [...turns, { role: 'user', text: question }];
    setTurns(next); setText(''); setError(''); setBusy(true);
    try {
      const snapshot = businessSnapshot({ invoices, movements, products, orders, purchases, units, technicians, sellers, stockMovements, suppliers });
      const answer = await aiAskBusiness(next.slice(-12), snapshot);
      setTurns([...next, { role: 'assistant', text: answer }]);
    } catch (e) {
      setError(aiErrorMessage(e));
      setTurns(turns);
      setText(question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead eyebrow="Inteligencia artificial" title="Asistente del negocio"
        subtitle="Pregunte en lenguaje normal: responde con las ventas, la caja, el inventario y el taller de hoy."
        actions={turns.length > 0 && <button className="btn ghost" onClick={() => setTurns([])}><Trash2 size={16} />Nueva conversación</button>} />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 260px)' }}>
        <div className="card-pad stack" style={{ flex: 1, overflowY: 'auto' }}>
          {turns.length === 0 && (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '24px 0' }}>
              <Sparkles size={34} className="red" />
              <div className="muted">Pruebe con una de estas preguntas:</div>
              <div className="row gap-sm" style={{ justifyContent: 'center', maxWidth: 760 }}>
                {SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => void ask(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div style={{
                whiteSpace: 'pre-wrap', padding: '10px 14px', borderRadius: 12, lineHeight: 1.55,
                background: t.role === 'user' ? 'var(--text)' : 'var(--surface-2)',
                color: t.role === 'user' ? 'var(--surface)' : 'var(--text)',
                border: t.role === 'user' ? 'none' : '1px solid var(--line)',
              }}>{t.text.replace(/\*\*/g, '')}</div>
            </div>
          ))}
          {busy && <div className="faint">Analizando los datos del negocio…</div>}
          {error && <div className="alert error">{error}</div>}
          <div ref={end} />
        </div>
        <form className="row gap-sm card-pad" style={{ borderTop: '1px solid var(--line)', flexWrap: 'nowrap' }}
          onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
          <input className="input grow" placeholder="Escriba su pregunta…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          <button className="btn primary" disabled={busy || !text.trim()}><Send size={16} />Preguntar</button>
        </form>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        Las respuestas las genera una IA a partir de un resumen de sus datos; verifique las cifras importantes en Contabilidad antes de decidir.
      </p>
    </>
  );
}
