import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './design-system.css';

try {
  // Sin preferencia guardada, sigue el tema del celular o computador
  const saved = localStorage.getItem('dcpro:theme');
  const system = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = saved || system;
  // Tamaño de letra elegido en este equipo (botón «Aa» de la barra superior)
  const scale = Number(localStorage.getItem('dcpro:fontScale')) || 1;
  document.documentElement.style.setProperty('--fs-scale', String(scale));
} catch {
  /* sin almacenamiento */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// App instalable que abre sin internet (solo en la versión publicada).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('No se pudo activar el modo sin conexión', e));
  });
}
