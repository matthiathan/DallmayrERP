const LEGACY_CACHE_PREFIX = 'dallmayr-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX)).map((key) => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});

// Intentionally no fetch handler: the legacy mobile/PWA layer has been retired.
