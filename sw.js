const VERSION='paper-shelf-shell-v1';
const FILES=['./','./index.html','./app.css','./app.js','./store.js','./ui.js','./reader.js','./importer.js','./zip-worker.js','./lookup.js','./vendor/fflate.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('paper-shelf-shell-')&&key!==VERSION)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data==='activate-update')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const scope=new URL(self.registration.scope);
  // Only the shipped shell is cached. No imported file is sent over HTTP.
  const shell=new Set(FILES.map(path=>new URL(path,scope).href));
  if(!shell.has(url.href)&&event.request.mode!=='navigate')return;
  event.respondWith((async()=>{const cached=await caches.match(event.request);if(cached)return cached;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return caches.match(new URL('./index.html',scope));throw error;}})());
});
