const VERSION = 'shuaci-v7-public-20261019-mobile-1';
const APP_CACHE = `${VERSION}-app`;
const RUNTIME_CACHE = 'shuaci-v7-audio-runtime';
const BASE = new URL('./', self.registration.scope);
const asset = (value) => new URL(value, BASE).href;
const APP_SHELL = ['', 'index.html', 'styles.css', 'app.js', 'db.js', 'icon.svg', 'manifest.webmanifest',
  'data/study-v5.json'].map(asset);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('shuaci-v7-') && key.endsWith('-app') && key !== APP_CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(new URL('audio/v7-packs/', BASE).pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.pathname.startsWith(new URL('audio/', BASE).pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(APP_CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(asset('index.html')))));
});
