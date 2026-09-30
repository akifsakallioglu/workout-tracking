// Service worker: uygulama dosyalarını telefonda saklar; uygulama internetsiz de açılır.
// Her yayında VERSION artırılır. Yeni bir dosya eklenince FILES listesine de yazılır
// (uçtan uca test, listede eksik dosya kalmadığını denetler).
const VERSION = '11';
const CACHE = `antrenman-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/chart.js',
  'js/db.js',
  'js/logic.js',
  'js/main.js',
  'js/seed.js',
  'js/store.js',
  'js/ui.js',
  'js/views/exercise-card.js',
  'js/views/history.js',
  'js/views/home.js',
  'js/views/program.js',
  'js/views/progress.js',
  'js/views/settings.js',
  'js/views/workout.js',
  'icons/apple-touch-icon.png',
  'icons/day-legs.png',
  'icons/day-lower.png',
  'icons/day-pull.png',
  'icons/day-push.png',
  'icons/day-upper.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // Tarayıcının HTTP önbelleği atlanır: yeni yayından hemen sonra eski dosya saklanmasın.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('antrenman-') && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Kullanıcı "Güncelle"ye basınca bekleyen yeni sürüm hemen devreye girer.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Önce önbellek: dosya önbellekte varsa oradan, yoksa ağdan. Sayfa açılışlarında adres ne olursa
// olsun (örneğin ?sw=1) önbellekteki index.html verilir.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.mode === 'navigate') {
        return (await cache.match('index.html')) ?? fetch(request);
      }
      return (await cache.match(request)) ?? fetch(request);
    })(),
  );
});
