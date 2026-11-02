const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export const money = (n: number | undefined | null) => cop.format(Math.round(Number(n) || 0));

const dt = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const d = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const dateTime = (iso?: string) => (iso ? dt.format(new Date(iso)) : '—');
export const dateOnly = (iso?: string) => (iso ? d.format(new Date(iso)) : '—');

export const pad = (n: number | undefined, size = 5) => String(n ?? 0).padStart(size, '0');

export const sameDay = (iso: string | undefined, ref = new Date()) => {
  if (!iso) return false;
  const x = new Date(iso);
  return (
    x.getFullYear() === ref.getFullYear() && x.getMonth() === ref.getMonth() && x.getDate() === ref.getDate()
  );
};

export const daysAgo = (n: number) => {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - n);
  return x;
};

export const addDays = (iso: string, days: number) => {
  const x = new Date(iso);
  x.setDate(x.getDate() + days);
  return x.toISOString();
};

/** Valor de <input type="datetime-local"> ↔ ISO */
export const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const x = new Date(iso);
  const off = x.getTimezoneOffset();
  return new Date(x.getTime() - off * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const matches = (q: string, ...fields: (string | number | undefined)[]) => {
  if (!q.trim()) return true;
  const n = normalize(q.trim());
  return fields.some((f) => f !== undefined && normalize(String(f)).includes(n));
};

/** Enlace de WhatsApp a un celular colombiano. */
export const whatsappLink = (phone: string, text: string) => {
  let p = phone.replace(/\D/g, '');
  if (p.length === 10) p = `57${p}`;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};
