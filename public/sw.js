const CACHE_NAME = 'boitto-cache-v2'; // Increment version
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg'
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force the waiting service worker to become active
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', (event) => {
    // Strategy: Network First for index.html and assets
    // We want the most recent version if online
    if (event.request.method !== 'GET') {
        return; // Only cache GET requests
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // If it's a valid response, cache it and return
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request);
            })
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        Promise.all([
            // Claim clients to start controlling them immediately
            self.clients.claim(),
            // Remove old caches
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheWhitelist.indexOf(cacheName) === -1) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
        ])
    );
});
