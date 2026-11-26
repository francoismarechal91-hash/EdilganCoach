/* EdilganSuperCoach : réseau d'abord (toujours la dernière version), cache en secours hors connexion.
   v2 : - page : réseau limité à 3,5 s puis copie en cache (réseau très lent ≠ écran blanc) ; le cache se met à jour en arrière-plan ;
        - ne met en cache que les réponses 200 « basic » du même site : jamais d'erreur 404/500, jamais de réponse opaque ni d'API tierce ;
        - repli sur la page uniquement pour une navigation (jamais pour un .json) ;
        - précache tolérant (un fichier en échec ne bloque plus les autres), sans passer par le cache HTTP ;
        - suppression des anciens caches. */
const C='edilgan-v3';
const SHELL=['./','manifest.json','icon.png','icon-192.png','icon-512.png','world.json','ciqual.json'];
const NAV_MS=3500;
const okToCache=r=>!!r&&r.status===200&&r.type==='basic';

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>Promise.all(SHELL.map(u=>
    fetch(new Request(u,{cache:'reload'})).then(r=>okToCache(r)?c.put(u,r):null).catch(()=>null)))));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request,u=new URL(req.url);
  if(req.method!=='GET'||u.origin!==location.origin||/\/(version\.json|sw\.js)$/.test(u.pathname))return; // API tierces et version.json : non interceptés
  const nav=req.mode==='navigate',key=nav?'./':req;   // une seule copie de la page (#accueil, index.html, ?source=pwa…)
  const net=fetch(req,{cache:'no-cache'});
  e.waitUntil(net.then(r=>{if(!okToCache(r))return;const cp=r.clone();return caches.open(C).then(c=>c.put(key,cp))}).catch(()=>{}));
  e.respondWith((async()=>{
    if(nav){
      const old=await caches.match('./',{cacheName:C})||await caches.match('index.html');
      const fresh=net.then(r=>r.ok?r:(old||r));
      if(!old)return fresh.catch(()=>new Response('<!doctype html><meta charset="utf-8"><title>Hors connexion</title><p style="font:18px system-ui;padding:24px">Pas de connexion. Ouvre l\'app une première fois avec internet.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}));
      return Promise.race([fresh.catch(()=>old),new Promise(ok=>setTimeout(()=>ok(old),NAV_MS))]);
    }
    try{const r=await net;if(r.ok)return r;return (await caches.match(req,{ignoreSearch:true}))||r}
    catch(err){return (await caches.match(req,{ignoreSearch:true}))||Response.error()}
  })());
});
