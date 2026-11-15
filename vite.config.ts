import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Escribe en dist/sw.js la lista de archivos de esta versión, para que funcione sin internet completa. */
function precacheList(): Plugin {
  let files: string[] = [];
  let outDir = 'dist';
  return {
    name: 'dcpro-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    generateBundle(_o, bundle) {
      files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => '/' + f).sort();
    },
    closeBundle() {
      const sw = resolve(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const src = readFileSync(sw, 'utf8');
      writeFileSync(sw, src.replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files)};`));
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheList()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // El ayudante de carga de Vite va con React (siempre presente), no con la librería de IA
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) return 'react';
          if (!id.includes('node_modules')) return;
          if (id.includes('firebase')) return 'firebase';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@anthropic-ai') || id.includes('zod')) return 'ai';
        },
      },
    },
  },
});
