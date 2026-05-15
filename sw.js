const CACHE = 'cch-v7';
const STATIC = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/config.js',
  '/css/tokens.css',
  '/css/primitives.css',
  '/chess/engine.js',
  '/chess/board-ui.js',
  '/chess/ai.js',
  '/chess/clock.js',
  '/chess/pgn.js',
  '/chess/elo.js',
  '/storage/db.js',
  '/tournament/bracket.js',
  '/multiplayer/relay.js',
  '/js/utils.js',
  '/js/ui/icons.js',
  '/js/ui/primitives.js',
  '/js/ui/eval-graph.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/events.js',
  '/js/registrations.js',
  '/engine/analysis.js',
  '/engine/move-quality.js',
  '/engine/stockfish-loader.js',
  '/engine/versions.js',
  '/engine/stockfish/stockfish-nnue-16-single.js',
  '/engine/stockfish/stockfish-nnue-16-single.wasm',
  '/manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Network-first for live data (Firebase, Google APIs, Lichess cloud-eval).
  // Stockfish is now bundled locally, so the jsdelivr pass-through is gone.
  const isExternal = url.hostname.includes('firebase') ||
                     url.hostname.includes('googleapis') ||
                     url.hostname.includes('gstatic') ||
                     url.hostname.includes('lichess');
  if (isExternal) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  // Cache-first for all local static assets
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
