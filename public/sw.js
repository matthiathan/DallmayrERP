const STATIC_CACHE = 'dallmayr-erp-static-v2';
const STATIC_ASSETS = [
  '/offline.html',
  '/icons/dallmayr-app.svg',
  '/icons/dallmayr-maskable.svg',
];

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const href = event.notification.data?.href || '/';
  let targetUrl = new URL('/', self.location.origin).href;

  try {
    const url = new URL(href, self.location.origin);
    if (url.origin === self.location.origin) targetUrl = url.href;
  } catch {
    targetUrl = new URL('/', self.location.origin).href;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const sameOriginClient = clients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (sameOriginClient) {
        if ('navigate' in sameOriginClient) {
          return sameOriginClient.navigate(targetUrl).then((client) => (
            client ? client.focus() : self.clients.openWindow(targetUrl)
          ));
        }

        return sameOriginClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
