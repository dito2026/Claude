import { CREDIT_METHOD } from '../lib/types';
import { useSettings } from '../services/settings';

/**
 * Medio de pago con botones, SIN valor por defecto: hay que tocar uno (evita que una transferencia
 * quede como efectivo por olvido). `missing` resalta el recuadro cuando falta elegirlo.
 */
export function PayMethods({ value, onChange, missing, label = 'Medio de pago', allowCredit = false, disabled = false }: {
  value: string;
  onChange: (m: string) => void;
  missing?: boolean;
  label?: string;
  allowCredit?: boolean;
  disabled?: boolean;
}) {
  const settings = useSettings();
  const methods = settings.paymentMethods.filter((m) => allowCredit || m !== CREDIT_METHOD);
  return (
    <div className="field full">
      <span>{label} <em>*</em></span>
      <div className={`pay-methods ${missing ? 'missing' : ''}`} role="radiogroup" aria-label={label} style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
        {methods.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value === m} className={`cat-chip ${value === m ? 'active' : ''}`} onClick={() => onChange(m)}>{m}</button>
        ))}
      </div>
    </div>
  );
}
