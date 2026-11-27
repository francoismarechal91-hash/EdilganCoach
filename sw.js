/* EdilganSuperCoach : réseau d'abord (toujours la dernière version), cache en secours hors connexion.
   v2 : - page : réseau limité à 3,5 s puis copie en cache (réseau très lent ≠ écran blanc) ; le cache se met à jour en arrière-plan ;
        - ne met en cache que les réponses 200 « basic » du même site : jamais d'erreur 404/500, jamais de réponse opaque ni d'API tierce ;
        - repli sur la page uniquement pour une navigation (jamais pour un .json) ;
        - précache tolérant (un fichier en échec ne bloque plus les autres), sans passer par le cache HTTP ;
        - suppression des anciens caches.
   v3 (ag_perf) : - polices et icônes (fichiers qui ne changent pas) servies tout de suite depuis le cache, puis vérifiées en arrière-plan :
          le texte s'affiche sans attendre le réseau, même lent ; la page et les .json restent « réseau d'abord » comme avant ;
        - installation d'une nouvelle version : on ne retélécharge que la page et ce qui manque (avant : ~1 Mo à chaque mise à jour) ;
        - icon-512.png n'est plus précachée (sert seulement à l'installation, jamais hors connexion) : -225 Ko au premier lancement.
   Si un jour tu changes une police ou une icône SANS changer son nom, change aussi C ci-dessous (ex. 'edilgan-v7'). */
const C='edilgan-v8';
const SHELL=['./','manifest.json','icon.png','icon-192.png','world.json','ciqual.json','fonts/bricolage-var-latin.woff2','fonts/orbitron-var-latin.woff2','fonts/fredoka-var-latin.woff2','fonts/nunito-var-latin.woff2'];
const NAV_MS=3500;
const okToCache=r=>!!r&&r.status===200&&r.type==='basic';
const STATIC=/\.(woff2|png)$/; // fichiers fixes : cache d'abord, mise à jour en arrière-plan

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>Promise.all(SHELL.map(u=>(u==='./'?Promise.resolve(null):c.match(u).catch(()=>null)).then(hit=>hit||
    fetch(new Request(u,{cache:'reload'})).then(r=>okToCache(r)?c.put(u,r):null).catch(()=>null))))));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!=='edg-flags').map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(/\/sounds\//.test(e.request.url)||e.request.headers.has('range'))return; // sons : le navigateur gère les requêtes partielles (lecture iPhone)

  const req=e.request,u=new URL(req.url);
  if(req.method!=='GET'||u.origin!==location.origin||/\/(version\.json|sw\.js)$/.test(u.pathname))return; // API tierces et version.json : non interceptés
  const nav=req.mode==='navigate',key=nav?'./':req;   // une seule copie de la page (#accueil, index.html, ?source=pwa…)
  if(!nav&&!u.search&&req.cache!=='no-store'&&STATIC.test(u.pathname)){
    const pc=caches.open(C),net=fetch(req,{cache:'no-cache'});
    e.waitUntil(net.then(r=>{if(!okToCache(r))return;const cp=r.clone();return pc.then(c=>c.put(req,cp))}).catch(()=>{}));
    e.respondWith(pc.then(c=>c.match(req,{ignoreSearch:true})).catch(()=>null).then(hit=>hit||net.catch(()=>Response.error())));
    return}
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

/* Notifications de rappels (envoyées par GitHub Actions, même téléphone en veille) */
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}if(!d||typeof d!=='object')d={};
  if(d.kind!=null&&!/^[a-z]{1,12}$/.test(String(d.kind)))d.kind=null; // ag_sec : nom de drapeau de cache borné
  const t=d.title||'EdilganSuperCoach',flag=d.kind?caches.open('edg-flags').then(c=>c.put('push-'+d.kind,new Response(String(Date.now())))).catch(()=>{}):null;
  e.waitUntil(Promise.all([self.registration.showNotification(t,{body:d.body||'',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||'edg',renotify:true,data:{url:d.url||'./'}}),flag]))});
self.addEventListener('notificationclick',e=>{e.notification.close();let url=self.registration.scope;
  // ag_sec : une notification n'ouvre jamais autre chose que l'app (pas d'adresse externe ni javascript:)
  try{const u=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope);if(u.origin===location.origin&&u.href.startsWith(self.registration.scope))url=u.href}catch(_){}
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>{for(const c of L){if('focus' in c){if(c.navigate)c.navigate(url).catch(()=>{});return c.focus()}}return self.clients.openWindow(url)}))});
