const CACHE_NAME = 'audiobook-creator-v5'; // Increment cache version for the final update

const urlsToCache = [
  './',
  './index.html',
  './tts_app.html',
  './main.js',
  './manifest.json',
  './ort-dist/ort.min.js',
  './phonemizer-dist/phonemizer.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// --- THIS IS THE FINAL, ROBUST FETCH HANDLER ---
self.addEventListener('fetch', event => {
  // Strategy: For navigations, try network first, then cache.
  // For all other requests (assets), use cache first.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Network failed (we are offline). Serve the main app page from cache.
        // This is crucial for the offline share target to work.
        return caches.match('./tts_app.html');
      })
    );
    return; // Don't fall through to the logic below
  }

  // For non-navigation requests (images, JS, CSS, models, etc.),
  // use a "cache-first" strategy for speed.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // If the resource is in the cache, return it.
      if (cachedResponse) {
        return cachedResponse;
      }
      // If not in cache, fetch from network and cache it for next time.
      return fetch(event.request).then(networkResponse => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      });
    })
  );
});


self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});