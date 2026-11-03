// DIGITAL CELL PRO — service worker: permite abrir la app sin internet.
// Los datos los maneja Firestore (con su propia caché); aquí solo se guarda la app.
const CACHE = 'dcpro-app-v1';
const FONTS = 'dcpro-fonts-v1';

// Al instalar: guarda la página y los archivos que ella usa (JS/CSS con hash).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch('/index.html', { cache: 'no-store' });
    const html = await res.clone().text();
    await cache.put('/index.html', res);
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    await cache.addAll([...new Set(['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', ...assets])]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [CACHE, FONTS];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navegación (abrir la app o cualquier ruta): red primero, si no hay internet la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Archivos de la app (llevan hash en el nombre: no cambian): caché primero.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Tipografías de Google: caché primero.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })());
  }
  // Todo lo demás (Firebase/Firestore) va directo a la red: Firestore tiene su propia caché.
});
