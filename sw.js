const C="arn-v3";
const A=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./app-icon-192.png","./app-icon-512.png","./header-logo.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(caches.match(e.request).then(cached=>{
    if(cached) return cached;
    return fetch(e.request).then(r=>{
      if(!r||!r.ok)return r;
      const copy=r.clone();
      caches.open(C).then(c=>c.put(e.request,copy));
      return r;
    }).catch(()=>e.request.mode==="navigate"?caches.match("./index.html"):Response.error());
  }));
});
