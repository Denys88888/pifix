/* PiFix service worker — STATIC ASSET CACHE ONLY.
 *
 * Deliberately minimal. Pi Browser's WebView has unreliable service worker
 * support, no Web Push and no background sync, and a stale cached API response
 * about money would be worse than a slow one. So:
 *   • hashed build assets  → cache-first (they are immutable)
 *   • locale JSON          → stale-while-revalidate
 *   • the app shell        → network-first with a cached fallback
 *   • EVERYTHING under /api → never touched by the worker
 */

/* Bump this on every locale change, and on any change to a PRECACHE entry.
 * `activate` deletes every cache whose name does not start with VERSION, so
 * bumping is what evicts stale translation bundles. Locales are
 * stale-while-revalidate, which means a newly added key renders as its raw id
 * ("auth.piNoResponse") on the first load after a deploy and only comes good on
 * the next one — seen for real in Pi Browser. The manifest is precached, so a
 * new icon set is invisible to "Add to Home Screen" until this changes too. */
const VERSION = 'pifix-v5';
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL_URL = '/index.html';

const PRECACHE = ['/', SHELL_URL, '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

function isLocale(url) {
  return url.pathname.startsWith('/locales/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache the API, the Pi SDK, or map tiles.
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (isLocale(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // Navigations: network first so a new deploy is picked up immediately,
  // falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
    );
  }
});

// Lets a future build tell the waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
