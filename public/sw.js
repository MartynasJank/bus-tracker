const CACHE = 'vilnius-bus-v50';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const toCache = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, toCache));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
  // Static files: no SW interception — browser fetches from network directly
});
