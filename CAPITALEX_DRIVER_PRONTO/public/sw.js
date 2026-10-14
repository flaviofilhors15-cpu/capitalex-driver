const CACHE_NAME = 'capitalex-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/account.js',
  '/notifications.js',
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

// Ao clicar na notificação, abre ou foca no app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Suporte para Web Push do servidor
self.addEventListener('push', e => {
  let data = { title: 'Capitalex Driver', body: 'Lembrete de corridas!' };
  try {
    if (e.data) data = e.data.json();
  } catch(err) {
    if (e.data) data.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'capitalex-push'
    })
  );
});
