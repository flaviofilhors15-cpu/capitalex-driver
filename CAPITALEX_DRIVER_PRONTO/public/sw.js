const CACHE_NAME = 'capitalex-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/account.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  // Nunca fazer cache de rotas de API (back-end)
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const isHTML = e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html');
      
      const fetchPromise = fetch(e.request).then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      });

      // Se for HTML, tenta a rede primeiro (para ter a versão mais nova). Se falhar (offline), usa o cache.
      if (isHTML) {
        return fetchPromise.catch(() => cached);
      }
      
      // Para arquivos estáticos (CSS, JS, Imagens), usa o cache primeiro para ser super rápido.
      return cached || fetchPromise;
    })
  );
});
