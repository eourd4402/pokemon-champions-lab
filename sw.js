const APP_VERSION = 'pcl-v16-7-analysis-order-fix-20260902-1';
const SHELL_CACHE = `${APP_VERSION}-shell`;
const RUNTIME_CACHE = `${APP_VERSION}-runtime`;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request, {cache: 'no-store'});
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : undefined);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 설치형 앱을 열 때는 항상 서버의 최신 index.html을 우선 사용한다.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // 같은 사이트의 앱 파일도 최신본 우선, 네트워크 실패 시 캐시 fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Showdown / PokeAPI 등 외부 데이터는 캐시를 우선 보여주면서 최신본을 갱신한다.
  // 한 번 온라인에서 불러온 데이터는 이후 일시적인 오프라인에서도 재사용 가능하다.
  event.respondWith(staleWhileRevalidate(request));
});
