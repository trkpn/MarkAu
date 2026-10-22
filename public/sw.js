/**
 * MarkAu Service Worker
 * Complete offline PWA capability
 *
 * Strategy
 * --------
 *   Navigations  → the freshest build when the network answers quickly,
 *                  the cached app shell otherwise (so an offline start is
 *                  instant instead of waiting for a connection timeout)
 *   Static assets → served from the cache immediately, refreshed in the
 *                  background (stale-while-revalidate)
 *
 * Two details matter for the offline case:
 *   1. The cache is always looked up by URL with `ignoreVary`, because the
 *      dev/preview server sends `Vary: Origin` and a header-aware lookup
 *      would miss entries that are really there.
 *   2. A dead network must never delay a response. The network is raced
 *      against a short timeout, and the refresh runs in `waitUntil` so it
 *      can never block the page.
 */

const CACHE_NAME = 'markau-' + (self.__SW_TIMESTAMP__ || Date.now());

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/main.js',
  '/src/style.css',
  '/src/icons.js',
  '/src/markdown-parser.js',
  '/src/tts-engine.js',
  '/src/stt-engine.js',
  '/src/settings-manager.js',
  '/src/sample-markdown.js'
];

/** How long the network may delay a navigation before the cache is used. */
const NAVIGATION_TIMEOUT_MS = 1200;

/** How long a background refresh may run before it is abandoned. */
const REFRESH_TIMEOUT_MS = 8000;

/**
 * Fetches with a timeout, resolving to null instead of rejecting.
 * @param {Request|string} request
 * @param {number} timeout
 * @returns {Promise<Response|null>}
 */
async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks a request up in the cache.
 *
 * `ignoreVary` is deliberate: the served responses carry `Vary: Origin`, and
 * a header-aware match would reject perfectly good entries.
 *
 * @param {Cache} cache
 * @param {Request} request
 * @returns {Promise<Response|undefined>}
 */
async function matchCached(cache, request) {
  const url = new URL(request.url);
  return (
    (await cache.match(url.pathname + url.search, { ignoreSearch: true, ignoreVary: true })) ||
    (await cache.match(url.pathname, { ignoreSearch: true, ignoreVary: true }))
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          const response = await fetch(url, { cache: 'no-cache' });
          if (response && response.status === 200) {
            await cache.put(url, response);
          }
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) console.warn(`[SW] ${failed} asset(s) could not be precached`);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            // The cache of the old name is purged as well, so the rename
            // does not leave a copy of the app behind.
            const isOutdated =
              key.startsWith('markau-') || key.startsWith('markaudio-');
            if (key !== CACHE_NAME && isOutdated) {
              console.log('[SW] Purging outdated cache:', key);
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin http/https requests
  if (url.origin !== self.location.origin) return;

  // --- Navigations: fresh when the network is quick, cached otherwise ---
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        const network = fetchWithTimeout(event.request, NAVIGATION_TIMEOUT_MS);
        const fresh = await network;

        if (fresh && fresh.status === 200) {
          const clone = fresh.clone();
          event.waitUntil(cache.put('/index.html', clone).catch(() => {}));
          return fresh;
        }

        const cached = await matchCached(cache, event.request);
        if (cached) return cached;

        const shell = (await cache.match('/index.html')) || (await cache.match('/'));
        if (shell) return shell;

        return new Response('Offline: This app has to be opened once while online.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })()
    );
    return;
  }

  // --- Static assets: serve from cache, refresh in the background ---
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await matchCached(cache, event.request);

      if (cached) {
        // The refresh must never delay the response.
        event.waitUntil(
          (async () => {
            const fresh = await fetchWithTimeout(event.request, REFRESH_TIMEOUT_MS);
            if (fresh && fresh.status === 200) {
              await cache.put(event.request, fresh.clone()).catch(() => {});
            }
          })()
        );
        return cached;
      }

      const fresh = await fetchWithTimeout(event.request, REFRESH_TIMEOUT_MS);
      if (fresh) {
        if (fresh.status === 200) {
          const clone = fresh.clone();
          event.waitUntil(cache.put(event.request, clone).catch(() => {}));
        }
        return fresh;
      }

      return new Response('Offline: Resource not available', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    })()
  );
});
