/* EdilganSuperCoach : réseau d'abord (toujours la dernière version), cache en secours hors connexion */
const C='edilgan-v2';
const SHELL=['./','index.html','manifest.json','icon.png','icon-192.png','icon-512.png','world.json','ciqual.json'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const q=e.request,u=new URL(q.url);
  if(q.method!=='GET'||u.origin!==location.origin||u.pathname.endsWith('version.json'))return;
  e.respondWith(fetch(q,{cache:'no-cache'}).then(r=>{if(r.ok&&r.type==='basic'){const cp=r.clone();caches.open(C).then(c=>c.put(q,cp)).catch(()=>{})}return r})
    .catch(async()=>{const m=await caches.match(q,{ignoreSearch:true});if(m)return m;if(q.mode==='navigate')return (await caches.match('index.html'))||(await caches.match('./'))||Response.error();return Response.error()}));
});
