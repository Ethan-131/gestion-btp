const CACHE='antras-v2-beta1';
const ASSETS=[
  './',
  './index.html',
  './v66.html',
  './manifest.webmanifest',
  './antras-logo.png',
  './icon-192.png',
  './icon-512.png',
  './css/v66.css','./css/v95.css','./css/v96.css',
  './js/supabase-config.js',
  './js/v66-app.js',
  './js/v105-personal-project-stats.js',
  './js/v2-role-config.js',
  './js/v2-shell.js',
  './js/v2-accounts.js',
  './js/v2-dashboard.js',
  './js/v96-project-catalog.js',
  './js/project-catalog.js'
];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  ]));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
        return response;
      })
      .catch(()=>caches.match(event.request).then(cached=>{
        if(cached)return cached;
        if(event.request.mode==='navigate')return caches.match('./v66.html');
        return Response.error();
      }))
  );
});
