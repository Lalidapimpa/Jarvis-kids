/* Jarvis Jr. service worker
   Job: let the app open instantly and still work when the internet drops.
   Rule: NEVER cache the Jarvis brain (/.netlify/functions/) -- a stale answer is worse than none.
   Bump CACHE when index.html changes, or tablets will keep showing the old app. */

var CACHE = 'jarvis-v2';

var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll fails the whole install if ONE file 404s -> add one by one instead
      return Promise.all(SHELL.map(function (u) {
        return c.add(u)['catch'](function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE) ? null : caches['delete'](k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1. Jarvis brain -> always live. If offline, let it fail so the app's
  //    built-in offline facts take over.
  if (url.pathname.indexOf('/.netlify/') === 0) return;

  // 2. Fonts + the real animal photos and the Wikipedia lookup that finds them.
  //    Cache once, then serve from cache forever -> photos work offline after the
  //    first time a child has met that animal.
  if (url.hostname.indexOf('fonts.googleapis.com') !== -1 ||
      url.hostname.indexOf('fonts.gstatic.com') !== -1 ||
      url.hostname.indexOf('upload.wikimedia.org') !== -1 ||
      url.hostname.indexOf('wikipedia.org') !== -1) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })['catch'](function () { return hit; });
      })
    );
    return;
  }

  // 3. Our own files -> serve from cache instantly, refresh in the background.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      var live = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () {
        // offline: fall back to the cached app shell for page loads
        return hit || caches.match('./index.html');
      });
      return hit || live;
    })
  );
});
