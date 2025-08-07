const CACHE_NAME = 'audiobook-creator-v3'; // Increment cache version for a clean update

// --- KEY CHANGE: Only cache the small "app shell" files on install ---
const urlsToCache = [
  './',
  './index.html',
  './tts_app.html',
  './main.js',
  './manifest.json',
  './ort-dist/ort.min.js',
  // REMOVED '/model/kitten_tts_nano_v0_1.onnx',
  // REMOVED '/model/voices.json',
  './phonemizer-dist/phonemizer.js',
  './icon-192.png',
  './icon-512.png'
  // The wasm files will be cached on first use by the fetch handler below
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


// --- KEY CHANGE: The fetch handler is now much smarter ---
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // If the file is in the cache, return it immediately.
        if (cachedResponse) {
          return cachedResponse;
        }

        // If the file is not in the cache, fetch it from the network.
        return fetch(event.request).then(
          networkResponse => {
            // After fetching, put a copy of the response into the cache for next time.
            return caches.open(CACHE_NAME).then(cache => {
              // We must clone the response because a response is a "stream"
              // and can only be consumed once.
              cache.put(event.request, networkResponse.clone());
              // Return the original response to the app.
              return networkResponse;
            });
          }
        );
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