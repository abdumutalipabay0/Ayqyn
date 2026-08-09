/* ──────────────────────────────────────────────────────────────────────────
   Service Worker

   Two jobs:
     1. Precache the app shell so a reload with no network renders the app
        rather than a browser error page.
     2. Cache /api/* responses as they arrive, and serve them when the network
        is gone — the last real measurements, never a substitute for them.

   POST /api/profile/attribute is deliberately not cached. Replaying a stored
   answer for a symptom log the user has since changed would be a fabricated
   figure, which is the one thing this product must not produce. Offline, that
   screen says so.
   ────────────────────────────────────────────────────────────────────────── */

const VERSION = 'v50';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  '/tokens.css',
  '/app.js',
  '/chart.js',
  '/tape.js',
  '/explorer.js',
  '/offline.html',
  '/fonts/geist-var.woff2',
  '/fonts/geist-mono-400.woff2'
];

// /api/meta describes the record and carries the threshold scale: without it
// the app cannot label a single figure, so it is precached alongside the shell
// rather than left to be picked up on the way past. The page memoises it for
// the session, which means it may never be requested twice — and would then
// never land in a freshly versioned cache.
const DATA_ASSETS = ['/api/meta'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // addAll fails the whole install if any asset 404s; add individually so
      // one bad path cannot leave the app with no shell at all.
      const data = await caches.open(DATA);
      const put = async (url, target) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await target.put(url, res);
        } catch (err) {
          console.warn('[sw] precache miss', url, err);
        }
      };
      await Promise.all([
        ...SHELL_ASSETS.map((u) => put(u, cache)),
        ...DATA_ASSETS.map((u) => put(u, data))
      ]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

/** Network first, falling back to whatever we last stored. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (!hit) throw err;
    // Tag the response so the page can say plainly that these figures came
    // from cache rather than from the laboratory just now.
    const headers = new Headers(hit.headers);
    headers.set('X-From-Cache', '1');
    return new Response(await hit.blob(), {
      status: hit.status,
      statusText: hit.statusText,
      headers
    });
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Navigations: network, then the cached shell, then the offline page.
  if (request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            const cache = await caches.open(SHELL);
            cache.put('/index.html', res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      })()
    );
    return;
  }

  if (request.method !== 'GET') return; // POST attribution is never replayed

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      networkFirst(request, DATA).catch(
        () =>
          new Response(
            JSON.stringify({
              error: 'offline_no_cache',
              message: 'Нет сети, и этот запрос ещё ни разу не выполнялся, поэтому в кэше его нет.'
            }),
            { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
          )
      )
    );
    return;
  }

  // Shell assets: cache first for instant paint, refreshed in the background.
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      return hit || (await network) || new Response('', { status: 504 });
    })()
  );
});
