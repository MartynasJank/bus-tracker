const CACHE = 'vilnius-bus-v48';

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function cacheResponse(req, res) {
  const toCache = res.clone(); // clone synchronously before any async work
  caches.open(CACHE).then(c => c.put(req, toCache));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/')) {
    // Network first — cache fallback for offline schedule viewing
    e.respondWith(
      fetch(e.request)
        .then(res => { cacheResponse(e.request, res); return res; })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Network first — always get fresh code, cache for offline fallback
    e.respondWith(
      fetch(e.request)
        .then(res => { if (res.ok) cacheResponse(e.request, res); return res; })
        .catch(() => caches.match(e.request))
    );
  }
});
