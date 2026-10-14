/* PiFix service worker — STATIC ASSET CACHE ONLY.
 *
 * Deliberately minimal. Pi Browser's WebView has unreliable service worker
 * support, no Web Push and no background sync, and a stale cached API response
 * about money would be worse than a slow one. So:
 *   • hashed build assets  → cache-first (they are immutable)
 *   • locale JSON          → network-first (short timeout), cached fallback
 *   • the app shell        → network-first with a cached fallback
 *   • EVERYTHING under /api → never touched by the worker
 */

/* Bump this on any change to a PRECACHE entry: `activate` deletes every cache
 * whose name does not start with VERSION. The manifest is precached, so a new
 * icon set is invisible to "Add to Home Screen" until this changes.
 *
 * Locales used to be stale-while-revalidate, so a newly added key rendered as
 * its raw id ("terms.title") on the first load after every deploy — seen in Pi
 * Browser and again on the PiNet page. They are network-first now; the cached
 * copy is only for when the network is down or too slow. */
const VERSION = 'pifix-v27';
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL_URL = '/index.html';

const PRECACHE = ['/', SHELL_URL, '/manifest.webmanifest', '/favicon.svg'];
const LOCALE_TIMEOUT_MS = 4000;

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
        const network = fetch(request, { cache: 'no-cache' }).then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        });
        // A slow network falls back to the cached bundle after a few seconds
        // rather than leaving the app on its boot screen.
        const slow = new Promise((resolve) => setTimeout(resolve, LOCALE_TIMEOUT_MS));
        const first = await Promise.race([network.catch(() => undefined), slow]);
        if (first && first.ok) return first;
        const cached = await cache.match(request);
        if (cached) return cached;
        return network;
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
          // Only a good page may become the offline shell; caching a 5xx here
          // would show the error screen every time the network drops.
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          }
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
