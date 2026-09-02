const APP_VERSION = 'pcl-v17-8-install-bar-always-visible-20260902-1';
const SHELL_CACHE = `${APP_VERSION}-shell`;
const RUNTIME_CACHE = `${APP_VERSION}-runtime`;

// Core data is deliberately NOT versioned with the app.
// This preserves Pokémon/move/item data across code updates.
const CORE_DATA_CACHE = 'pcl-core-data-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app-version.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const CORE_DATA_URLS = [
  'https://play.pokemonshowdown.com/data/pokedex.json',
  'https://play.pokemonshowdown.com/data/moves.json',
  'https://play.pokemonshowdown.com/data/items.json',

  'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/champions/items.ts',
  'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/champions/moves.ts',

  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv',

  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv',
  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv',

  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/items.csv',
  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/item_names.csv',

  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/abilities.csv',
  'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/ability_names.csv'
];

const CORE_DATA_SET = new Set(CORE_DATA_URLS);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      
  );
});

async function notifyClients(message){
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  clients.forEach(client=>client.postMessage(message));
}

async function cacheOneCoreData(url, cache){
  try{
    const response=await fetch(url,{cache:'no-store'});
    if(response && (response.ok || response.type==='opaque')){
      await cache.put(url,response.clone());
      return true;
    }
  }catch(_){}
  return false;
}

async function precacheCoreData(){
  const cache=await caches.open(CORE_DATA_CACHE);
  let done=0;
  const total=CORE_DATA_URLS.length;

  for(const url of CORE_DATA_URLS){
    const existing=await cache.match(url);
    if(!existing){
      await cacheOneCoreData(url,cache);
    }
    done++;
    await notifyClients({type:'CORE_DATA_PROGRESS',done,total});
  }

  const cached=await Promise.all(CORE_DATA_URLS.map(url=>cache.match(url)));
  const readyCount=cached.filter(Boolean).length;
  await notifyClients({
    type:'CORE_DATA_READY',
    done:readyCount,
    total,
    complete:readyCount===total
  });
}

self.addEventListener('activate', event => {
  event.waitUntil(
    (async()=>{
      const keys=await caches.keys();
      await Promise.all(
        keys
          .filter(key =>
            key !== SHELL_CACHE &&
            key !== RUNTIME_CACHE &&
            key !== CORE_DATA_CACHE
          )
          .map(key=>caches.delete(key))
      );

      await self.clients.claim();

      // Best-effort background download. Individual failures never block app use.
      await precacheCoreData();
    })()
  );
});

self.addEventListener('message', event => {
  const data=event.data||{};

  if(data.type==='SKIP_WAITING'){
    self.skipWaiting();
    return;
  }

  if(data.type==='PRECACHE_CORE_DATA'){
    event.waitUntil(precacheCoreData());
  }
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

async function coreDataStaleWhileRevalidate(request) {
  const cache = await caches.open(CORE_DATA_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request, {cache:'no-store'})
    .then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

async function runtimeStaleWhileRevalidate(request) {
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

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Pokémon / move / item / Korean-name data:
  // use persistent local cache first, while refreshing online when possible.
  if (CORE_DATA_SET.has(url.href)) {
    event.respondWith(coreDataStaleWhileRevalidate(request));
    return;
  }

  // Other occasional external requests keep the versioned runtime cache.
  event.respondWith(runtimeStaleWhileRevalidate(request));
});
