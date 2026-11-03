import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

try {
  document.documentElement.dataset.theme = localStorage.getItem('dcpro:theme') || 'light';
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
