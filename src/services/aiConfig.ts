// Configuración de la IA (clave y si está activa). Va aparte de ai.ts para que el menú y las
// pantallas que solo preguntan «¿está activa?» no descarguen la librería de Claude.
import { backend } from '../data';
import { useDocument } from '../data/hooks';

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

/** true solo si el administrador activó la IA con una clave. Mientras no, la app oculta sus botones. */
export function useAiEnabled(): boolean {
  const { doc } = useDocument<AiConfig & { id: string }>('secrets', 'ai');
  return !!doc?.enabled && !!doc.apiKey;
}
