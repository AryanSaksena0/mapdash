/* Mapdash service worker.
   Network-first for code, cache-first for artwork. That means you always get
   the newest build when you're online, you still work with no connection,
   and editing a file locally shows up on a normal refresh instead of being
   silently served from a stale cache. */
const V = 'mapdash-v17';
const SHELL = ['./','./index.html','./js/mapdash.js','./js/warmer.js','./data/world-data.js',
               './config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(e.request.method!=='GET' || url.origin!==location.origin) return;  // never touch Supabase

  const codeish = /\.(html|js|json|webmanifest)$/.test(url.pathname) ||
                  e.request.mode==='navigate' || url.pathname.endsWith('/');

  if(codeish){                                    // fresh if possible, cached if not
    e.respondWith(
      fetch(e.request).then(res=>{
        const copy=res.clone(); caches.open(V).then(c=>c.put(e.request,copy)); return res;
      }).catch(()=> caches.match(e.request).then(hit=> hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(                                  // images etc: cache is fine
    caches.match(e.request).then(hit=> hit || fetch(e.request).then(res=>{
      const copy=res.clone(); caches.open(V).then(c=>c.put(e.request,copy)); return res;
    }))
  );
});
