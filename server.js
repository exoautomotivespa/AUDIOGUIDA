'use strict';
// Guida audio per visite al laboratorio. Nessuna dipendenza: serve solo Node.js (18 o successivo).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const AUDIO_DIR = path.join(ROOT, 'audio');
const CFG_FILE = path.join(ROOT, 'config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
// titolo, nomi delle lingue e nomiTappe vengono riletti quando config.json cambia
let liveCfg = cfg, cfgMtime = 0;
function settings() {
  try {
    const m = fs.statSync(CFG_FILE).mtimeMs;
    if (m !== cfgMtime) { liveCfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); cfgMtime = m; }
  } catch { /* file in modifica o non valido: si tiene l'ultima versione buona */ }
  return liveCfg;
}

const PORT = Number(process.env.PORT || cfg.porta || 3000);
const PASSWORD = String(process.env.PASSWORD_REGIA || cfg.passwordRegia || '');
// "numeroTappe": "auto" (o assente) = tanti pulsanti quanto il numero di traccia più alto trovato.
// Un numero fisso (es. 21) resta possibile se si vuole bloccare il totale.
const FIXED_TRACKS = Number.isInteger(cfg.numeroTappe) && cfg.numeroTappe > 0 ? cfg.numeroTappe : null;
function trackCount(lingue = languages()) {
  if (FIXED_TRACKS) return FIXED_TRACKS;
  let max = 0;
  for (const l of lingue) for (const n of l.tappe) if (n > max) max = n;
  return Math.max(1, Math.min(999, max));
}
const SESSION_MS = 12 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav']);
const LANG_RE = /^[A-Za-z0-9_-]{1,20}$/;

// Stato della visita: tappa in riproduzione (null = ferma), contatore comandi, orario di avvio
// pausa: secondi trascorsi al momento della pausa (null = non in pausa)
let state = { tappa: null, seq: 0, avviataAlle: null, pausa: null };
function elapsed() {
  if (!state.tappa) return 0;
  if (state.pausa !== null) return state.pausa;
  return (Date.now() - state.avviataAlle) / 1000;
}
const guests = new Set();
const sessions = new Map();

// ---------- tracce audio ----------
// Ogni lingua è una cartella in audio/ (es. audio/it). Il numero della tappa è il numero
// all'inizio del nome file: "1.mp3", "01.mp3" e "01 - Accoglienza.mp3" valgono tutti come tappa 1.
function trackMap(lang) {
  const map = {};
  let files = [];
  try { files = fs.readdirSync(path.join(AUDIO_DIR, lang)); } catch { return map; }
  for (const f of files.sort()) {
    if (!AUDIO_EXT.has(path.extname(f).toLowerCase())) continue;
    const m = f.match(/^(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!map[n]) map[n] = f;
  }
  return map;
}
// "05 - Banco prova.mp3" -> "Banco prova"; "05.mp3" -> ""
function titleFromFile(f) {
  return f.replace(/\.[^.]+$/, '').replace(/^\d+\s*[-_.):]*\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function languages() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && LANG_RE.test(d.name)).map(d => d.name);
  } catch { /* cartella audio mancante */ }
  const names = settings().lingue || {};
  const order = Object.keys(names);
  const rank = c => (order.indexOf(c) < 0 ? 999 : order.indexOf(c));
  dirs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return dirs
    .map(code => {
      const map = trackMap(code);
      const titoli = {};
      for (const n in map) { const t = titleFromFile(map[n]); if (t) titoli[n] = t; }
      return { code, nome: names[code] || code, tappe: Object.keys(map).map(Number).sort((a, b) => a - b), titoli };
    })
    .filter(l => l.tappe.length > 0);
}

// ---------- utilità HTTP ----------
function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(data));
}
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Non trovato'); }

function sendFile(req, res, file, cache = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes', 'Cache-Control': cache
    };
    const range = req.headers.range;
    // Le richieste "Range" servono a iPhone/Safari per riprodurre l'audio
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start = NaN, end = NaN;
      if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
      else if (m && m[1] !== '') { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1; }
      if (isNaN(start) || isNaN(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// ---------- accesso regia ----------
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function isAuthed(req) {
  const token = cookies(req).regia;
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// ---------- canale in tempo reale verso i telefoni (Server-Sent Events) ----------
function publicState() {
  return { tappa: state.tappa, seq: state.seq, trascorsi: elapsed(), inPausa: state.pausa !== null };
}
function sendEvent(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { guests.delete(client); }
}
function broadcast(event, data) { for (const c of guests) sendEvent(c, event, data); }

function openStream(req, res, lang, regia = false) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  const client = { res, lang, regia };
  guests.add(client);
  sendEvent(client, 'stato', publicState());
  req.on('close', () => guests.delete(client));
}
// Battito ogni 15 s per tenere aperte le connessioni
setInterval(() => { for (const c of guests) { try { c.res.write(': ping\n\n'); } catch { guests.delete(c); } } }, 15000);

function regiaStatus() {
  const perLingua = {};
  let ospiti = 0;
  for (const c of guests) { if (c.regia) continue; ospiti++; perLingua[c.lang] = (perLingua[c.lang] || 0) + 1; }
  const lingue = languages();
  const totale = trackCount(lingue);
  const mancanti = {};
  for (let n = 1; n <= totale; n++) {
    const miss = lingue.filter(l => !l.tappe.includes(n)).map(l => l.nome);
    if (miss.length) mancanti[n] = miss;
  }
  const fissi = settings().nomiTappe || {};
  const titoli = {};
  for (let n = 1; n <= totale; n++) {
    const t = fissi[n] || (lingue.find(l => l.titoli[n]) || { titoli: {} }).titoli[n];
    if (t) titoli[n] = t;
  }
  return {
    tappa: state.tappa, seq: state.seq, numeroTappe: totale, titoli,
    trascorsi: Math.round(elapsed()), inPausa: state.pausa !== null,
    ospiti, perLingua, lingue: lingue.map(l => ({ code: l.code, nome: l.nome })), mancanti
  };
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return notFound(res); }
  const p = url.pathname;
  const get = req.method === 'GET' || req.method === 'HEAD';
  const post = req.method === 'POST';

  try {
    if (get && (p === '/' || p === '/index.html')) return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    if (get && (p === '/regia' || p === '/regia.html')) return sendFile(req, res, path.join(PUBLIC_DIR, 'regia.html'));
    if (get && p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    // Logo: public/logo.svg oppure public/logo.png (basta sostituire il file)
    if (get && p === '/logo') {
      for (const f of ['logo.svg', 'logo.png']) {
        if (fs.existsSync(path.join(PUBLIC_DIR, f))) return sendFile(req, res, path.join(PUBLIC_DIR, f));
      }
      return notFound(res);
    }
    // Carattere incluso, funziona anche senza internet
    const fm = p.match(/^\/fonts\/([a-z0-9-]+\.woff2)$/);
    if (get && fm) return sendFile(req, res, path.join(PUBLIC_DIR, 'fonts', fm[1]), 'public, max-age=604800');
    // Colore del marchio da config.json
    if (get && p === '/tema.css') {
      const c = String(settings().colorePrincipale || '');
      const ok = /^#[0-9A-Fa-f]{6}$/.test(c);
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(ok ? `:root { --brand: ${c}; }\n` : '');
    }

    if (get && p === '/api/config') {
      const lingue = languages();
      const st = settings();
      return json(res, 200, { titolo: st.titolo || 'Visita guidata', numeroTappe: trackCount(lingue), nomiTappe: st.nomiTappe || {}, lingue });
    }

    if (get && p === '/api/eventi') {
      const lang = url.searchParams.get('lingua') || '';
      if (!LANG_RE.test(lang)) return json(res, 400, { errore: 'Lingua non valida' });
      return openStream(req, res, lang, url.searchParams.get('regia') === '1' && isAuthed(req));
    }

    const a = p.match(/^\/audio\/([A-Za-z0-9_-]{1,20})\/(\d{1,3})$/);
    if (get && a) {
      const file = trackMap(a[1])[parseInt(a[2], 10)];
      if (!file) return notFound(res);
      return sendFile(req, res, path.join(AUDIO_DIR, a[1], file), 'public, max-age=3600');
    }

    if (post && p === '/api/login') {
      const body = await readBody(req);
      if (!PASSWORD || !sameSecret(body.password || '', PASSWORD)) {
        await new Promise(r => setTimeout(r, 800));
        return json(res, 401, { errore: 'Password errata' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      return json(res, 200, { ok: true }, {
        'Set-Cookie': `regia=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`
      });
    }

    if (p.startsWith('/api/regia/')) {
      if (!isAuthed(req)) return json(res, 401, { errore: 'Accesso richiesto' });

      if (get && p === '/api/regia/stato') return json(res, 200, regiaStatus());

      if (post && p === '/api/regia/play') {
        const body = await readBody(req);
        const n = parseInt(body.tappa, 10);
        if (!(n >= 1 && n <= trackCount())) return json(res, 400, { errore: 'Tappa non valida' });
        state = { tappa: n, seq: state.seq + 1, avviataAlle: Date.now(), pausa: null };
        broadcast('play', { tappa: n, seq: state.seq });
        console.log(`[${new Date().toLocaleTimeString('it-IT')}] Tappa ${n} avviata su ${[...guests].filter(c => !c.regia).length} telefoni`);
        return json(res, 200, regiaStatus());
      }

      if (post && p === '/api/regia/stop') {
        state = { tappa: null, seq: state.seq + 1, avviataAlle: null, pausa: null };
        broadcast('stop', { seq: state.seq });
        console.log(`[${new Date().toLocaleTimeString('it-IT')}] Audio fermato`);
        return json(res, 200, regiaStatus());
      }

      if (post && p === '/api/regia/pausa') {
        if (!state.tappa) return json(res, 409, { errore: 'Nessuna tappa in riproduzione' });
        if (state.pausa === null) {
          state = { ...state, seq: state.seq + 1, pausa: elapsed() };
          broadcast('pausa', { seq: state.seq, tappa: state.tappa, trascorsi: state.pausa });
          console.log(`[${new Date().toLocaleTimeString('it-IT')}] Tappa ${state.tappa} in pausa`);
        } else {
          state = { ...state, seq: state.seq + 1, avviataAlle: Date.now() - state.pausa * 1000, pausa: null };
          broadcast('riprendi', { seq: state.seq, tappa: state.tappa, trascorsi: elapsed() });
          console.log(`[${new Date().toLocaleTimeString('it-IT')}] Tappa ${state.tappa} ripresa`);
        }
        return json(res, 200, regiaStatus());
      }

      if (post && p === '/api/regia/esci') {
        sessions.delete(cookies(req).regia);
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'regia=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
    }

    return notFound(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { errore: 'Errore interno' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  const lingue = languages();
  console.log('\n  Guida audio laboratorio avviata\n');
  console.log(`  Lingue trovate: ${lingue.length ? lingue.map(l => `${l.nome} (${l.tappe.length} tracce)`).join(', ') : 'nessuna, metti gli MP3 in audio/<lingua>/'}`);
  console.log(`  Pulsanti sul telecomando: ${trackCount(lingue)}${FIXED_TRACKS ? ' (numero fisso da config.json)' : ' (calcolati dalle tracce, si aggiornano da soli)'}`);
  for (const ip of ips) {
    console.log(`\n  Pagina ospiti (da mettere nel QR code):  http://${ip}:${PORT}/`);
    console.log(`  Telecomando per il tablet:               http://${ip}:${PORT}/regia`);
  }
  if (!ips.length) console.log(`\n  http://localhost:${PORT}/  e  http://localhost:${PORT}/regia`);
  if (!PASSWORD || PASSWORD === 'cambiami') console.log('\n  ATTENZIONE: cambia "passwordRegia" in config.json prima di usarla con gli ospiti.');
  console.log('\n  Lascia aperta questa finestra durante la visita. Per chiudere: Ctrl+C\n');
});
