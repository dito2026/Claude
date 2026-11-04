// Inteligencia artificial con Claude (Anthropic).
// La clave de API la guarda el administrador en Configuración (documento secrets/ai en la nube,
// visible solo para el personal con sesión). La app llama a Claude directamente desde el navegador.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { backend } from '../data';
import { useDocument } from '../data/hooks';

export const AI_MODEL = 'claude-opus-5-5';

export interface AiConfig {
  apiKey: string;
  enabled: boolean;
}

export async function loadAiConfig(): Promise<AiConfig | null> {
  const c = await backend.get<AiConfig & { id: string }>('secrets', 'ai');
  return c && c.apiKey && c.enabled ? c : null;
}

export const saveAiConfig = (c: AiConfig) =>
  backend.set('secrets', 'ai', { apiKey: c.apiKey.trim(), enabled: c.enabled, updatedAt: new Date().toISOString() });

async function client() {
  const cfg = await loadAiConfig();
  if (!cfg) throw new Error('La inteligencia artificial no está configurada. El administrador debe activarla en Configuración.');
  return new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
}

/** Opciones comunes: si el modelo declina por políticas, el servidor reintenta con su modelo de respaldo. */
const COMMON = {
  model: AI_MODEL,
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default' as const,
};

/** Traduce errores de la API a mensajes claros en español. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'La clave de API de Claude no es válida. Revísela en Configuración.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'La clave de API no tiene permiso para usar este modelo.';
  if (e instanceof Anthropic.RateLimitError) return 'Demasiadas consultas seguidas a la IA. Espere un momento e intente de nuevo.';
  if (e instanceof Anthropic.BadRequestError) return `La IA rechazó la solicitud: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'No hay conexión con el servicio de IA. Revise el internet.';
  if (e instanceof Anthropic.APIError) return `Error del servicio de IA (${e.status ?? '—'}). Intente de nuevo.`;
  return e instanceof Error ? e.message : String(e);
}

function assertAnswered(stopReason: string | null) {
  if (stopReason === 'refusal') throw new Error('La IA no pudo responder esta solicitud.');
  if (stopReason === 'max_tokens') throw new Error('La respuesta de la IA quedó incompleta. Intente con menos información.');
}

// ---------------- 1. Diagnóstico de reparación ----------------
export const DiagnosisSchema = z.object({
  resumen: z.string().describe('Una frase con la conclusión más probable'),
  causas: z.array(z.object({
    causa: z.string(),
    probabilidad: z.enum(['alta', 'media', 'baja']),
    porque: z.string(),
  })),
  pruebas: z.array(z.string()).describe('Pasos concretos para confirmar, en orden'),
  repuestos: z.array(z.string()).describe('Repuestos que probablemente se necesiten'),
  dificultad: z.enum(['baja', 'media', 'alta']),
  tiempo_estimado: z.string(),
  advertencias: z.array(z.string()).describe('Riesgos: datos, humedad, pantalla, clave, garantía, etc.'),
  mensaje_cliente: z.string().describe('Mensaje corto y amable para el cliente explicando el diagnóstico, sin precios'),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export async function aiDiagnose(input: {
  brand: string; model: string; issue: string; condition: string; notes: string; catalogParts: string[];
}): Promise<Diagnosis> {
  const c = await client();
  const res = await c.beta.messages.parse({
    ...COMMON,
    output_config: { effort: 'medium', format: betaZodOutputFormat(DiagnosisSchema) },
    system:
      'Eres un técnico experto en reparación de celulares de un taller en Colombia. Das diagnósticos ' +
      'prácticos para el técnico del mostrador. Responde en español de Colombia, conciso. No inventes ' +
      'precios. Si un repuesto del inventario del taller corresponde, menciónalo con su nombre exacto.',
    messages: [{
      role: 'user',
      content:
        `Equipo: ${input.brand} ${input.model}\nFalla reportada por el cliente: ${input.issue}\n` +
        `Estado físico al recibir: ${input.condition || 'sin datos'}\nNotas del técnico: ${input.notes || 'ninguna'}\n` +
        `Repuestos que hay en el inventario del taller: ${input.catalogParts.slice(0, 150).join('; ') || 'ninguno'}`,
    }],
  });
  assertAnswered(res.stop_reason);
  if (!res.parsed_output) throw new Error('La IA no devolvió un diagnóstico válido.');
  return res.parsed_output;
}

// ---------------- 2. Leer factura de proveedor (foto o PDF) ----------------
export const InvoiceReadSchema = z.object({
  proveedor: z.string().describe('Nombre del proveedor tal como aparece, o vacío'),
  numero_factura: z.string(),
  fecha: z.string().describe('AAAA-MM-DD o vacío'),
  forma_pago: z.enum(['credito', 'contado', 'desconocido']),
  items: z.array(z.object({
    descripcion: z.string(),
    cantidad: z.number(),
    costo_unitario: z.number().describe('En pesos colombianos, sin IVA si viene discriminado'),
    producto_id: z.string().describe('id del producto del inventario que corresponde, o vacío si no hay'),
    imeis: z.array(z.string()).describe('IMEI o seriales que aparezcan para este ítem'),
  })),
  total: z.number(),
  observaciones: z.string(),
});
export type InvoiceRead = z.infer<typeof InvoiceReadSchema>;

export async function aiReadSupplierInvoice(
  file: { base64: string; mediaType: string },
  catalog: { id: string; name: string; sku: string }[],
  suppliers: string[],
): Promise<InvoiceRead> {
  const c = await client();
  const isPdf = file.mediaType === 'application/pdf';
  const media = (isPdf ? null : file.mediaType) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null;
  const res = await c.beta.messages.parse({
    ...COMMON,
    output_config: { effort: 'medium', format: betaZodOutputFormat(InvoiceReadSchema) },
    system:
      'Lees facturas y remisiones de proveedores de un negocio de celulares en Colombia. Extrae los ítems ' +
      'con cantidad y costo unitario en pesos (números sin puntos ni símbolos). Relaciona cada ítem con el ' +
      'producto del inventario más parecido usando su id; si ninguno corresponde claramente deja producto_id vacío. ' +
      'Si un dato no se ve, déjalo vacío o en 0; no inventes.',
    messages: [{
      role: 'user',
      content: [
        isPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } }
          : { type: 'image', source: { type: 'base64', media_type: media!, data: file.base64 } },
        {
          type: 'text',
          text:
            `Proveedores registrados: ${suppliers.join('; ') || 'ninguno'}\n` +
            `Inventario (id | sku | nombre):\n${catalog.slice(0, 400).map((p) => `${p.id} | ${p.sku} | ${p.name}`).join('\n')}`,
        },
      ],
    }],
  });
  assertAnswered(res.stop_reason);
  if (!res.parsed_output) throw new Error('La IA no pudo leer la factura.');
  return res.parsed_output;
}

// ---------------- 3. Asistente del negocio ----------------
export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export async function aiAskBusiness(history: ChatTurn[], snapshot: string): Promise<string> {
  const c = await client();
  const res = await c.beta.messages.create({
    ...COMMON,
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text:
          'Eres el asistente de gestión de Digital Cell, un negocio de celulares, accesorios y servicio técnico ' +
          'en Colombia. Respondes al dueño y su equipo en español de Colombia, claro y breve, con cifras en ' +
          'pesos ($ 1.234.567). Usa SOLO los datos del negocio que se te entregan; si algo no está en los datos, ' +
          'dilo. Puedes dar recomendaciones prácticas (qué reponer, qué cobrar, qué está atrasado).',
      },
      { type: 'text', text: `DATOS DEL NEGOCIO (JSON, generados ahora):\n${snapshot}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: history.map((t) => ({ role: t.role, content: t.text })),
  });
  assertAnswered(res.stop_reason);
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
  if (!text) throw new Error('La IA no devolvió respuesta.');
  return text;
}

export async function fileToBase64(f: File): Promise<{ base64: string; mediaType: string }> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mediaType: f.type || 'image/jpeg' };
}

/** true solo si el administrador activó la IA con una clave. Mientras no, la app oculta sus botones. */
export function useAiEnabled(): boolean {
  const { doc } = useDocument<AiConfig & { id: string }>('secrets', 'ai');
  return !!doc?.enabled && !!doc.apiKey;
}
