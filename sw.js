const C="arn-v2";
const A=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./app-icon.png","./header-logo.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request).then(r=>{
    if(!r||!r.ok)return r;
    const c=r.clone();
    caches.open(C).then(k=>k.put(e.request,c));
    return r;
  }).catch(()=>caches.match("./index.html"))));
});
