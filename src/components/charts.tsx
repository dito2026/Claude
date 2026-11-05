// Gráficos SVG livianos (sin librerías): columnas, líneas con área y barras horizontales.
// Reglas: un solo eje, marcas delgadas, rejilla tenue, tooltip al pasar el dedo o el mouse,
// leyenda cuando hay ≥2 series y vista de tabla en cada gráfico.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChartColumn, Table2 } from 'lucide-react';

export interface Series {
  key: string;
  label: string;
  /** color CSS (usar los tokens --s1, --s2, --s-accent, --s-muted) */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

const compactFmt = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
export const compactMoney = (n: number) => (n < 0 ? '−$' : '$') + compactFmt.format(Math.abs(n));
export const plain = (n: number) => new Intl.NumberFormat('es-CO').format(Math.round(n));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Marcas «redondas» del eje: 0, paso, 2·paso… cubriendo [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/** Barra con esquinas de 4px solo en el extremo del dato. */
function barPath(x: number, w: number, y0: number, y1: number) {
  const h = Math.abs(y0 - y1);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

interface PlotProps {
  labels: string[];
  longLabels?: string[];
  series: Series[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  /** cambia para repetir la animación de entrada (p. ej. al cambiar de periodo) */
  animKey?: string;
  /** colores por barra (forma de énfasis: una barra en rojo, el resto neutras) */
  barColors?: string[];
  /** línea: rellena el área bajo la primera serie */
  area?: boolean;
  kind: 'column' | 'line';
  empty?: string;
}

const PAD = { top: 14, right: 10, bottom: 24 };

function Plot({ labels, longLabels, series, format, axisFormat = format, height = 220, animKey, barColors, area, kind, empty }: PlotProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1] || 1;
  const left = Math.max(...ticks.map((t) => axisFormat(t).length)) * 6.4 + 12;
  const plotW = Math.max(10, width - left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, n);
  const y = (v: number) => PAD.top + plotH - ((v - tMin) / (tMax - tMin || 1)) * plotH;
  const cx = (i: number) => left + band * (i + 0.5);
  const zeroY = y(0);
  const isEmpty = all.every((v) => v === 0);

  // etiquetas del eje X sin chocar
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 34))));

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - left) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  let marks: ReactNode = null;
  if (width > 0 && kind === 'column') {
    const s = series.length;
    const gap = 2;
    const groupW = Math.min(band * 0.72, s * 24 + (s - 1) * gap);
    const bw = Math.max(1, Math.min(24, (groupW - (s - 1) * gap) / s));
    const used = bw * s + gap * (s - 1);
    marks = (
      <g className="marks grow" key={animKey}>
        {series.map((ser, si) =>
          ser.values.map((v, i) => {
            if (v == null) return null;
            const x = cx(i) - used / 2 + si * (bw + gap);
            const d = barPath(x, bw, zeroY, y(v));
            return d ? <path key={`${ser.key}-${i}`} d={d} fill={barColors?.[i] ?? ser.color} opacity={hover != null && hover !== i ? 0.55 : 1} /> : null;
          }),
        )}
      </g>
    );
  } else if (width > 0) {
    marks = (
      <g className="marks" key={animKey}>
        {series.map((ser, si) => {
          const segs: string[] = [];
          let cur = '';
          ser.values.forEach((v, i) => {
            if (v == null) {
              if (cur) segs.push(cur);
              cur = '';
            } else cur += `${cur ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
          });
          if (cur) segs.push(cur);
          const pts = ser.values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
          return (
            <g key={ser.key}>
              {area && si === 0 && pts.length > 1 && (
                <path className="fade-in" d={`M${cx(pts[0][0])},${zeroY}${pts.map(([i, v]) => `L${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}L${cx(pts[pts.length - 1][0])},${zeroY}Z`} fill={ser.color} opacity={0.1} />
              )}
              {segs.map((d, k) => (
                <path key={k} className="draw" pathLength={1} d={d} fill="none" stroke={ser.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={ser.dashed ? '4 4' : undefined} />
              ))}
              {pts.length === 1 && <circle cx={cx(pts[0][0])} cy={y(pts[0][1])} r={4} fill={ser.color} />}
              {hover != null && ser.values[hover] != null && (
                <circle cx={cx(hover)} cy={y(ser.values[hover]!)} r={4.5} fill={ser.color} stroke="var(--surface)" strokeWidth={2} />
              )}
            </g>
          );
        })}
      </g>
    );
  }

  const tipLeft = hover != null ? Math.min(Math.max(cx(hover), 90), Math.max(90, width - 90)) : 0;

  return (
    <div className="plot" ref={ref} style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'grid-line'} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="axis-text">{axisFormat(t)}</text>
            </g>
          ))}
          {hover != null && kind === 'column' && <rect x={left + band * hover} y={PAD.top} width={band} height={plotH} className="hover-band" />}
          {hover != null && kind === 'line' && <line x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />}
          {marks}
          {labels.map((l, i) =>
            i % step === 0 ? (
              <text key={i} x={cx(i)} y={height - 6} textAnchor="middle" className={`axis-text ${hover === i ? 'on' : ''}`}>{l}</text>
            ) : null,
          )}
          <rect
            x={left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          />
        </svg>
      )}
      {isEmpty && <div className="plot-empty">{empty ?? 'Sin movimientos en este periodo'}</div>}
      {hover != null && (
        <div className="tip" style={{ left: tipLeft }}>
          <div className="tip-title">{longLabels?.[hover] ?? labels[hover]}</div>
          {series.map((s) =>
            s.values[hover] == null ? null : (
              <div key={s.key} className="tip-row">
                <i style={{ background: barColors?.[hover] ?? s.color }} />
                <span>{s.label}</span>
                <b>{format(s.values[hover]!)}</b>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export const ColumnChart = (p: Omit<PlotProps, 'kind' | 'area'>) => <Plot {...p} kind="column" />;
export const LineChart = (p: Omit<PlotProps, 'kind' | 'barColors'>) => <Plot {...p} kind="line" />;

/** Barras horizontales ordenadas, con etiqueta y valor directos. */
export function HBarChart({ rows, format, sub, max: maxRows = 8, otherLabel = 'Otras' }: { rows: { label: string; value: number; sub?: string }[]; format: (n: number) => string; sub?: (r: { label: string; value: number; sub?: string }) => string | undefined; max?: number; otherLabel?: string }) {
  let shown = rows;
  if (rows.length > maxRows) {
    const rest = rows.slice(maxRows - 1);
    shown = [...rows.slice(0, maxRows - 1), { label: `${otherLabel} (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0) }];
  }
  const max = Math.max(1, ...shown.map((r) => r.value));
  return (
    <div className="hbars grow-x">
      {shown.map((r) => (
        <div key={r.label} className="hbar" title={`${r.label}: ${format(r.value)}`}>
          <div className="hbar-label">{r.label}{sub?.(r) && <small>{sub(r)}</small>}</div>
          <div className="hbar-track"><i style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} /></div>
          <div className="hbar-value">{format(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}><i className={i.dashed ? 'dashed' : ''} style={{ background: i.dashed ? undefined : i.color, borderColor: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
  /** fila final de totales */
  total?: (string | number)[];
}

/** Tarjeta de gráfico: título, cifra principal, leyenda y botón para ver los datos en tabla. */
export function ChartCard({ title, value, sub, legend, table, children, className = '', icon }: { title: string; value?: ReactNode; sub?: ReactNode; legend?: ReactNode; table?: ChartTable; children: ReactNode; className?: string; icon?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className}`}>
      <header className="chart-head">
        <div className="grow">
          <h3>{icon}{title}</h3>
          {value != null && <div className="chart-value">{value}</div>}
          {sub && <div className="chart-sub">{sub}</div>}
        </div>
        {table && (
          <button type="button" className="btn sm ghost icon-only" onClick={() => setAsTable((v) => !v)} title={asTable ? 'Ver gráfico' : 'Ver datos en tabla'} aria-label={asTable ? 'Ver gráfico' : 'Ver datos en tabla'}>
            {asTable ? <ChartColumn size={16} /> : <Table2 size={16} />}
          </button>
        )}
      </header>
      {legend && !asTable && legend}
      {asTable && table ? (
        <div className="table-wrap chart-table">
          <table className="table">
            <thead><tr>{table.columns.map((c, i) => <th key={c} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, k) => (
                <tr key={k}>{r.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>
              ))}
              {table.total && <tr className="total">{table.total.map((c, i) => <td key={i} className={i ? 'num strong' : 'strong'}>{c}</td>)}</tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-body">{children}</div>
      )}
    </section>
  );
}
