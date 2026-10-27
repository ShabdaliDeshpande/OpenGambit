// OpenGambit service worker: makes the app installable and lets playing the
// computer, puzzles and analysis work offline once they've been opened.
// Online play, accounts and tournaments always need the network.

const CACHE = 'opengambit-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

/** How a same-origin GET is answered: 'network' (never cached), 'page', 'asset' or 'static'. */
function strategyFor(pathname, mode) {
  if (pathname.startsWith('/api/') || pathname === '/ws' || pathname === '/healthz' || pathname === '/sw.js') return 'network';
  if (mode === 'navigate') return 'page';
  // built files have a content hash in their name, so they never change
  if (pathname.startsWith('/assets/')) return 'asset';
  return 'static';
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const strategy = strategyFor(url.pathname, req.mode);
  if (strategy === 'network') return;

  if (strategy === 'page') {
    // fresh page when online; the saved app when offline
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then(r => r || Response.error())),
    );
    return;
  }

  if (strategy === 'asset') {
    event.respondWith(
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // icons, puzzle files…: answer from the cache, refresh in the background
  event.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});

// a system notification (daily chess) opens the app at its link, reusing an open tab if there is one
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      return open
        .navigate(url)
        .catch(() => open)
        .then(c => (c ?? open).focus());
    }),
  );
});
