/**
 * MarkAudio Service Worker
 * Complete offline PWA capability with Network-First strategy
 * Automatic timestamp-based cache naming (no hardcoded v-numbers)
 */

// Timestamp-based cache naming (replaced during build with unique build timestamp)
const CACHE_NAME = 'markaudio-' + (self.__SW_TIMESTAMP__ || Date.now());

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

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && (res.status === 200 || res.type === 'opaque')) {
              await cache.put(url, res);
            }
          } catch (_) {}
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('markaudio-')) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin http/https requests
  if (url.origin !== self.location.origin) return;

  // Network-First with Cache Fallback:
  // 1. Fetch from network to ensure latest changes are delivered
  // 2. Clone response synchronously before returning to prevent 'body is already used' error
  // 3. If network fails (OFFLINE), immediately serve from CacheStorage
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          // Synchronous clone while body is unused
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {});
          }).catch(() => {});
        }
        return networkResponse;
      })
      .catch(async () => {
        // Network failed -> We are OFFLINE!
        const cache = await caches.open(CACHE_NAME);

        // 1. Exact match with request
        let cached = await cache.match(event.request);
        if (cached) return cached;

        // 2. Match without query search parameters (e.g. ?t=..., ?import)
        cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        // 3. Match pathname directly
        cached = await cache.match(url.pathname);
        if (cached) return cached;

        // 4. If navigation request (HTML), fallback to index.html or root
        if (
          event.request.mode === 'navigate' ||
          event.request.destination === 'document' ||
          url.pathname === '/' ||
          url.pathname.endsWith('.html')
        ) {
          const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
          if (fallback) return fallback;
        }

        return new Response('Offline: Resource not available', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});
