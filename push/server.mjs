// EdilganSuperCoach — serveur de rappels (GitHub Actions). Aucune donnée en clair dans le dépôt :
// chaque téléphone envoie ses rappels chiffrés (ECDH P-256 + AES-GCM) ; seul ce script, avec le secret EDG_PUSH, peut les lire.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import webpush from 'web-push';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');
const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const env = process.env, REPO = env.REPO || '', GH = env.GH_TOKEN || '';
const sh = c => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const SEED = env.EDG_PUSH ? unb64u(env.EDG_PUSH.trim()) : null;
if (!SEED || SEED.length < 16) { console.log('Secret EDG_PUSH absent : rien à faire.'); process.exit(0); }

function derive(label) {
  for (let i = 0; i < 64; i++) {
    const k = Buffer.from(crypto.hkdfSync('sha256', SEED, Buffer.from('edilgan'), Buffer.from(label + ':' + i), 32));
    const d = BigInt('0x' + k.toString('hex'));
    if (d > 0n && d < N) { const e = crypto.createECDH('prime256v1'); e.setPrivateKey(k); return { priv: k, pub: e.getPublicKey(), ecdh: e }; }
  }
  throw new Error('dérivation impossible');
}
const V = derive('vapid'), B = derive('box');
webpush.setVapidDetails('https://' + (REPO.split('/')[0] || 'edilgan') + '.github.io/', b64u(V.pub), b64u(V.priv));

function open(token) {
  const buf = unb64u(token);
  if (buf.length < 65 + 12 + 17) throw new Error('trop court');
  const eph = buf.subarray(0, 65), iv = buf.subarray(65, 77), ct = buf.subarray(77, buf.length - 16), tag = buf.subarray(buf.length - 16);
  const shared = B.ecdh.computeSecret(eph);
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('edilgan-box'), Buffer.from('aes'), 32));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}
// ag_sec : validation stricte. La clé publique « box » est publique (push/public.json) : n'importe qui peut chiffrer
// un enregistrement. On vérifie donc tout ce qui est ensuite utilisé (fuseau horaire, types, tailles, adresse d'envoi).
const okTz = tz => { if (tz == null) return true; if (typeof tz !== 'string' || tz.length > 64) return false; try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; } };
const okStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
function okEndpoint(u) {
  if (typeof u !== 'string' || u.length > 1024) return false;
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:' || x.username || x.password) return false;
  const h = x.hostname.toLowerCase();
  // jamais d'adresse locale / IP brute : les services de notification des navigateurs ont un nom de domaine public
  return !(h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('['));
}
function valid(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length < 10 || r.id.length > 80) return false;
  const s = r.sub; if (!s || typeof s !== 'object' || !okEndpoint(s.endpoint) || !s.keys || typeof s.keys !== 'object') return false;
  if (typeof s.keys.p256dh !== 'string' || !/^[A-Za-z0-9_=+/-]{80,100}$/.test(s.keys.p256dh) || typeof s.keys.auth !== 'string' || !/^[A-Za-z0-9_=+/-]{16,32}$/.test(s.keys.auth)) return false;
  if (!okTz(r.tz)) return false;
  if (!Array.isArray(r.items) || r.items.length > 80) return false;
  return r.items.every(x => x && typeof x === 'object' && typeof x.h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.h) && typeof x.t === 'string' && x.t.length <= 120
    && okStr(x.d, 200) && okStr(x.k, 24) && (x.u == null || (typeof x.u === 'string' && /^#?[A-Za-z0-9_-]{0,30}$/.test(x.u)))
    && (x.days == null || (Array.isArray(x.days) && x.days.length <= 7 && x.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6))));
}
const regFile = id => 'push/reg/' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 24) + '.enc';
let dirty = false;
function commit(msg) {
  if (!dirty) return;
  sh('git config user.name "edilgan-rappels"'); sh('git config user.email "edilgan-rappels@users.noreply.github.com"');
  sh('git add -A push'); try { sh('git commit -m "' + msg.replace(/"/g, '') + '"'); } catch { return; }
  for (let i = 0; i < 4; i++) { try { sh('git pull --rebase -q'); sh('git push -q'); return; } catch (e) { console.log('push réessai', i); } }
}
async function gh(path, method = 'GET', body) {
  const r = await fetch('https://api.github.com/repos/' + REPO + path, { method, headers: { Authorization: 'Bearer ' + GH, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? r.json() : null;
}
async function send(reg, p) {
  try { await webpush.sendNotification(reg.sub, JSON.stringify(p), { TTL: 1800, urgency: 'high', topic: (p.tag || 'edg').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'edg' }); return true; }
  // journaux publics (dépôt public) : seulement le code d'erreur, jamais le corps de la réponse ni l'adresse
  catch (e) { console.log('envoi échoué', e.statusCode || 'réseau'); return e.statusCode === 404 || e.statusCode === 410 ? 'gone' : false; }
}

// clés publiques pour l'app
fs.mkdirSync('push/reg', { recursive: true });
const pub = JSON.stringify({ v: 1, vapid: b64u(V.pub), box: b64u(B.pub) }) + '\n';
if (!fs.existsSync('push/public.json') || fs.readFileSync('push/public.json', 'utf8') !== pub) { fs.writeFileSync('push/public.json', pub); dirty = true; console.log('Clés publiques écrites.'); }

if (env.EVENT === 'issues') {
  const m = String(env.ISSUE_BODY || '').slice(0, 65536).match(/EDGP1:([A-Za-z0-9_-]{60,60000})(?![A-Za-z0-9_-])/);
  let reg = null, msg = '';
  try { reg = m ? open(m[1]) : null; } catch (e) { reg = null; }
  if (!reg || !valid(reg)) msg = '❌ Enregistrement illisible. Réessaie depuis l\'app (Mes rappels).';
  else {
    const f = regFile(reg.id), n = fs.readdirSync('push/reg').filter(x => x.endsWith('.enc')).length;
    if (reg.off || !reg.items.length) { if (fs.existsSync(f)) { fs.unlinkSync(f); dirty = true; } msg = '✅ Notifications désactivées pour ce téléphone.'; await send(reg, { title: 'Rappels désactivés', body: 'Plus de notification sur ce téléphone.', tag: 'ok', kind: 'off' }); }
    else if (!fs.existsSync(f) && n >= 10) msg = '❌ Trop de téléphones enregistrés (10 maximum).';
    else {
      fs.writeFileSync(f, m[1] + '\n'); dirty = true;
      const ok = await send(reg, { title: 'Rappels activés ✓', body: reg.items.length + ' rappel' + (reg.items.length > 1 ? 's' : '') + ' programmé' + (reg.items.length > 1 ? 's' : '') + '. Ils arriveront même téléphone en veille.', tag: 'ok', kind: 'ok', url: './#accueil' });
      msg = ok === true ? '✅ Enregistré : ' + reg.items.length + ' rappels. Une notification de confirmation vient d\'être envoyée.' : '⚠️ Enregistré, mais la notification de test n\'est pas passée. Vérifie que les notifications sont autorisées.';
    }
  }
  commit('Rappels : enregistrement d\'un téléphone');
  if (env.ISSUE_NUMBER) await gh('/issues/' + env.ISSUE_NUMBER, 'PATCH', { body: msg + '\n\n(Le contenu chiffré a été retiré de ce message.)', state: 'closed', state_reason: 'completed' });
  console.log(msg);
  process.exit(0);
}

// tournée planifiée : envoie les rappels dont l'heure tombe dans la fenêtre depuis la tournée précédente
const now = Date.now(), LEAD = 3 * 60e3;
let from = now - 10 * 60e3;
try {
  const j = await gh('/actions/workflows/rappels.yml/runs?status=success&event=schedule&per_page=5');
  const prev = ((j && j.workflow_runs) || []).find(x => String(x.id) !== String(env.RUN_ID));
  if (prev && prev.run_started_at) from = Date.parse(prev.run_started_at);
} catch {}
from = Math.max(from, now - 45 * 60e3);
const A = from + LEAD, Z = now + LEAD;
const wdN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let sent = 0;
let bad = 0;
for (const f of fs.readdirSync('push/reg').filter(x => x.endsWith('.enc'))) {
  // ag_sec : un enregistrement défectueux ne doit jamais bloquer les rappels des autres téléphones
  try {
    let reg; try { reg = open(fs.readFileSync('push/reg/' + f, 'utf8').trim()); } catch { bad++; continue; }
    if (!valid(reg)) { bad++; continue; }
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: reg.tz || 'Europe/Paris', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    const due = new Map();
    for (let t = Math.floor(A / 60e3) * 60e3 + 60e3; t <= Z; t += 60e3) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
      const hm = p.hour + ':' + p.minute, wd = wdN[p.weekday];
      for (const it of reg.items) if (it.h === hm && (!it.days || it.days.includes(wd))) due.set(it.k + it.h + it.t, it);
    }
    for (const it of due.values()) {
      const r = await send(reg, { title: it.t, body: it.d || '', tag: (it.k || 'edg') + it.h.replace(':', ''), url: './' + (it.u || '#accueil') });
      if (r === 'gone') { fs.unlinkSync('push/reg/' + f); dirty = true; break; }
      if (r === true) sent++;
    }
  } catch { bad++; }
}
// journaux publics : ni heure ni nombre de rappels envoyés (ce serait l'emploi du temps santé du foyer, lisible par tous)
console.log('Tournée terminée.' + (bad ? ' ' + bad + ' enregistrement(s) ignoré(s).' : ''));
// garde le dépôt « actif » (GitHub met en pause les tâches planifiées après 60 jours sans activité)
try { const last = +sh('git log -1 --format=%ct') * 1000; if (now - last > 40 * 864e5) { fs.writeFileSync('push/keepalive.txt', new Date(now).toISOString() + '\n'); dirty = true; } } catch {}
commit('Rappels : entretien');
