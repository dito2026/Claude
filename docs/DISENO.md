# DIGITAL CELL PRO — Sistema de diseño

Archivo: `src/design-system.css`. Se carga después de `styles.css` (ver `src/main.tsx`) y redefine tokens y componentes base. Identidad: **negro · blanco · rojo**. Retícula de **4 px**. Objetivo: **WCAG 2.2 AA**.

## 1. Auditoría (hallazgos medidos en el código)

| Problema | Antes | Ahora |
|---|---|---|
| Texto secundario gris (claro) | `#a8a29e` 2.5:1 ❌ | `#6f6863` 5.0–5.5:1 ✅ |
| Texto secundario (oscuro) | `#6b6b6b` 3.5:1 ❌ | `#8f8f8f` 5.5:1 ✅ |
| Rojo como texto (oscuro) | `#e10600` 3.8:1 ❌ | `--red-text #ff5a52` 6.1:1 ✅ |
| Insignia roja sobre fondo rosado | 4.3:1 ❌ | `--red-text #c40500` 5.4:1 ✅ |
| Etiquetas del menú lateral | `#525252` 2.5:1 ❌ | `#8a8a8a` 5.7:1 ✅ |
| Foco con teclado | solo en campos | anillo visible en todo lo interactivo |
| Tamaños de letra | 12 tamaños sueltos (9–44 px) | escala de 8 pasos |
| Espaciados | ~20 rellenos distintos | escala de 4 px |
| Objetivos táctiles | botones de 30–36 px | ≥ 44 px con dedo (`pointer: coarse`) |
| Zoom al escribir en iPhone | campos de 14 px | 16 px en pantallas táctiles |
| Modales en celular | caja centrada, se cortaba | hoja inferior a pantalla completa |
| Carga | texto «Cargando…» | filas *skeleton* con `aria-live` |
| Tema | siempre claro por defecto | sigue el tema del sistema hasta que la persona elige |

## 2. Tokens

**Espaciado:** `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 · `--sp-10` 40 · `--sp-12` 48 · `--sp-16` 64.

**Tipografía (Inter, base 14 px):**

| Token | Tamaño | Uso |
|---|---|---|
| `--fs-2xs` | 11 px | solo etiquetas en mayúsculas |
| `--fs-xs` | 12 px | ayudas y metadatos |
| `--fs-sm` | 13 px | tablas densas y botones |
| `--fs-md` | 14 px | texto base |
| `--fs-lg` | 16 px | títulos de tarjeta y modal |
| `--fs-xl` | 20 px | h2 y cifras secundarias |
| `--fs-2xl` | 24 px | título de página |
| `--fs-3xl` | 28 px | KPI |

Interlineados: `--lh-tight` 1.2 · `--lh-snug` 1.35 · `--lh-normal` 1.5.

**Radios:** `--radius-xs` 6 · `--radius-sm` 8 (botones, campos) · `--radius-md` 10 (alertas) · `--radius` 14 (tarjetas) · `--radius-lg` 18 (modales) · `--radius-full`.

**Elevación:** `--shadow-1` tarjetas · `--shadow-2` hover y menús · `--shadow-3` modales y avisos. El modo oscuro tiene su propia versión, más profunda.

**Color:** superficies `--bg`, `--surface` y `--surface-2`; texto `--text`, `--text-2` y `--text-3`; marca `--red`, `--red-text`, `--red-soft` y `--red-line`; estados `--ok`, `--warn` e `--info` (siempre con texto o ícono, nunca solo color). Gráficos: `--s1`, `--s2`, `--s-accent`, `--s-ink` y `--s-context` (validados para daltonismo).

**Movimiento:** `--ease-out`, `--dur-fast` 120 ms, `--dur` 200 ms y `--dur-slow` 320 ms. Todo se desactiva con `prefers-reduced-motion`.

## 3. Componentes

- **Botones:** 38 px (`.btn`), 32 px (`.btn.sm`) y 44 px con dedo. Un solo primario rojo por pantalla; el resto, contorno o `ghost`. Al presionar se hunden 1 px. Deshabilitado: 45 % de opacidad, sin sombra.
- **Campos:** 38 px, radio 8 y anillo de foco rojo suave. `.invalid` o `aria-invalid` ponen borde rojo. Placeholder con contraste AA. 16 px en táctil.
- **Tarjetas:** radio 14 y `--shadow-1`. Encabezado `--sp-4`/`--sp-5`, cuerpo `--sp-5`. Tablas con encabezado de 11 px en `--text-2`.
- **Navegación:** etiquetas de sección legibles, ítems de 40 px de alto, foco interno rojo. La barra superior es translúcida y se difumina al hacer scroll.
- **Modales:** radio 18, `--shadow-3`, fondo difuminado y entrada suave. En celular (≤ 600 px) son una **hoja inferior** que respeta el área segura del iPhone, con botones a todo el ancho.
- **Carga:** `<SkeletonRows />` reemplaza «Cargando…».

## 4. Cómo usarlo en código nuevo

```css
.mi-tarjeta {
  padding: var(--sp-5);
  border-radius: var(--radius);
  box-shadow: var(--shadow-1);
  background: var(--surface);
  color: var(--text);
}
.mi-tarjeta small { font-size: var(--fs-xs); color: var(--text-3); }
.mi-tarjeta .alerta { color: var(--red-text); }   /* rojo como TEXTO: siempre --red-text */
```

```tsx
import { SkeletonRows, Empty } from '../components/ui';
{loading ? <SkeletonRows /> : list.length === 0 ? <Empty>Sin datos.</Empty> : <Tabla />}
```

**Reglas:** no escribir colores ni medidas sueltas, sino tokens. El rojo de relleno es `--red` y el rojo de texto es `--red-text`. Todo control nuevo debe verse con Tab (`:focus-visible`) y medir ≥ 44 px en táctil.
