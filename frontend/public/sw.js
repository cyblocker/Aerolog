const CACHE_NAME = 'aerolog-shell-v7';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/manifest-admin.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API or auth-gated endpoints in shared Cache Storage
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin/api/') ||
    url.pathname.startsWith('/cdn-cgi/')
  ) {
    return;
  }

  // Network-first for HTML navigations so Zero Trust auth redirects still happen online,
  // falling back to cached app shell when offline (e.g. Airplane Mode).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          return (await caches.match('/')) || Response.error();
        })
    );
    return;
  }

  // Cache-first for static hashed bundle assets and icons
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png' ||
    url.pathname === '/icon-maskable-512.png' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
