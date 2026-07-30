const STATIC_CACHE = 'dallmayr-erp-static-v2';
const STATIC_ASSETS = [
  '/offline.html',
  '/icons/dallmayr-app.svg',
  '/icons/dallmayr-maskable.svg',
];

function offlineDocumentResponse() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DallmayrERP offline</title><body><main><h1>DallmayrERP is offline</h1><p>Reconnect and reload to continue.</p></main></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/offline.html')) || offlineDocumentResponse()),
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
