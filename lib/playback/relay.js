/* Relay from the public deployment to the playback origin.
 *
 * Why this exists: the upstream refuses data-centre addresses for most tracks
 * ("sign in to confirm you're not a bot"), and the media URLs it hands out are
 * bound to the address that asked for them. Measured from Vercel in iad1,
 * sin1, hnd1 and fra1, only a few very popular videos resolved at all. So the
 * resolve and the media fetch both run on an origin with an address the
 * upstream accepts, and the Vercel function relays the bytes.
 *
 * The browser still only ever talks to the ARMusic domain. The origin is
 * reached server side, authenticated with a shared key, and its address is
 * never sent to the client. Only the Range header goes out and only the media
 * headers come back; everything else is rebuilt here.
 *
 * ARMUSIC_ORIGIN may list more than one address, comma separated, all
 * pointing at the same origin by different routes. Each is tried in the order
 * of how well it has been doing (failures push a route down for a while), so
 * one route going bad costs one quick retry rather than a dead song. */

const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream');
const { PlaybackError, sendPlaybackError } = require('./errors');

/* Connections to the origin are kept open and reused. Measured from the
 * Vercel function: a fresh connection costs about 570 ms before the first
 * byte (TCP and TLS through the tunnel), a reused one about 160 ms. fetch()
 * there did not reuse connections, so the node agent is used directly. */
const AGENT_OPTS = { keepAlive: true, keepAliveMsecs: 30000, maxSockets: 64, maxFreeSockets: 16, timeout: 60000 };
const agents = { 'https:': new https.Agent(AGENT_OPTS), 'http:': new http.Agent(AGENT_OPTS) };

/* A small promise wrapper over http(s).request that looks enough like a
 * fetch Response for the code below: status, headers.get, json, a node
 * stream as body, and cancel. */
function request(url, { method = 'GET', headers = {}, signal, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const req = lib.request(u, { method, headers, agent: agents[u.protocol] }, (res) => {
      done = true;
      clearTimeout(timer);
      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v); } },
        stream: res,
        async json() {
          const parts = [];
          for await (const c of res) parts.push(c);
          return JSON.parse(Buffer.concat(parts).toString('utf8'));
        },
        cancel() { res.destroy(); },
      });
    });
    const timer = setTimeout(() => { if (!done) req.destroy(new Error('timeout')); }, timeoutMs);
    const onAbort = () => req.destroy(new Error('aborted'));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', (e) => { clearTimeout(timer); if (!done) reject(e); });
    req.end();
  });
}

const PASS_BACK = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'];
const CONNECT_TIMEOUT_MS = 4000;
const PENALTY_MS = 60 * 1000;

let cachedCfg = null;
let cachedFrom = null;
function originConfig() {
  const raw = process.env.ARMUSIC_ORIGIN;
  const key = process.env.ARMUSIC_ORIGIN_KEY;
  if (!raw) return null;
  if (cachedCfg && cachedFrom === raw + '|' + key) return cachedCfg;
  const bases = [];
  for (const part of raw.split(',')) {
    let u;
    try { u = new URL(part.trim()); } catch { continue; }
    if (u.protocol !== 'https:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') continue;
    bases.push({ base: u.toString().replace(/\/+$/, ''), failedAt: 0, ms: 0 });
  }
  if (!bases.length) return null;
  cachedCfg = { bases, base: bases[0].base, key: key || '' };
  cachedFrom = raw + '|' + key;
  return cachedCfg;
}

/* Routes in the order to try: healthy ones first, fastest first. */
function ordered(cfg) {
  const now = Date.now();
  return [...cfg.bases].sort((a, b) => {
    const pa = now - a.failedAt < PENALTY_MS ? 1 : 0;
    const pb = now - b.failedAt < PENALTY_MS ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return (a.ms || 0) - (b.ms || 0);
  });
}

function note(route, ms, ok) {
  if (!ok) { route.failedAt = Date.now(); return; }
  route.failedAt = 0;
  route.ms = route.ms ? route.ms * 0.7 + ms * 0.3 : ms;
}

/* One request to the origin, trying each route in turn. A route that cannot
 * be reached, or answers with something that is not the origin (a proxy's
 * challenge page, a 5xx from the route itself), counts as failed and the next
 * one is tried. Answers that come from the origin are returned as they are. */
async function originFetch(cfg, path, init, signal) {
  let lastErr = null;
  for (const route of ordered(cfg)) {
    if (signal && signal.aborted) break;
    const t0 = Date.now();
    try {
      const r = await request(route.base + path, { ...init, signal });
      const fromOrigin = r.headers.get('x-armusic-origin') === '1';
      if (!fromOrigin && (r.status >= 500 || r.status === 403 || r.status === 429)) {
        r.cancel();
        note(route, 0, false);
        console.log('[playback] route refused', r.status, 'cf=' + (r.headers.get('cf-mitigated') || ''));
        lastErr = new Error(`route ${r.status}`);
        continue;
      }
      note(route, Date.now() - t0, true);
      return { r, cleanup: () => {} };
    } catch (e) {
      if (signal && signal.aborted) throw e;
      note(route, 0, false);
      console.log('[playback] route unreachable', e && e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error('no route');
}

/* path is built by the caller from validated parts only, never from raw input */
async function relay(path, req, res, clientIp, opts = {}) {
  const cfg = originConfig();
  if (!cfg) return sendPlaybackError(res, new PlaybackError('PLAYBACK_NOT_CONFIGURED', 'no origin'));

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const headers = { 'X-ARMusic-Key': cfg.key, 'X-ARMusic-Client-Ip': String(clientIp || '') };
  if (typeof req.headers.range === 'string' && req.headers.range.length < 64) headers.Range = req.headers.range;

  let got;
  try {
    got = await originFetch(cfg, path, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers }, ac.signal);
  } catch (e) {
    if (ac.signal.aborted && res.destroyed) return;
    res.locals.originUnreachable = true;
    return sendPlaybackError(res, new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', `origin unreachable: ${e && e.message}`));
  }
  const r = got.r;

  const type = String(r.headers.get('content-type') || '');
  if (!r.ok && r.status !== 206) {
    // The origin already answers with one of the PLAYBACK_* codes. Pass the
    // code on, never the raw body, so nothing else can slip through.
    let code = 'PLAYBACK_SOURCE_UNAVAILABLE';
    try {
      if (type.includes('json')) {
        const j = await r.json();
        if (j && typeof j.error === 'string' && /^PLAYBACK_[A-Z_]+$/.test(j.error)) code = j.error;
      } else {
        r.cancel();
      }
    } catch {}
    got.cleanup();
    const extra = r.status === 416 && r.headers.get('content-range') ? { 'Content-Range': r.headers.get('content-range'), 'Accept-Ranges': 'bytes' } : undefined;
    return sendPlaybackError(res, new PlaybackError(code, `origin ${r.status}`), extra);
  }

  res.statusCode = r.status;
  for (const h of PASS_BACK) {
    const v = r.headers.get(h);
    if (v != null) res.setHeader(h, v);
  }
  if (typeof opts.cacheControl === 'function') {
    const cc = opts.cacheControl(r.status, Number(r.headers.get('content-length')) || 0);
    if (cc) res.setHeader('Cache-Control', cc);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  if (req.method === 'HEAD') { r.cancel(); return res.end(); }

  pipeline(r.stream, res, (err) => {
    got.cleanup();
    if (err && !ac.signal.aborted && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.log('[playback] relay error', err.message);
      try { res.destroy(); } catch {}
    }
  });
}

/* Short calls to the origin that carry no media: warm-ups and health.
 * Answers with the origin's status, or 502 when it cannot be reached. */
async function relaySmall(method, path, clientIp, timeoutMs = 4000) {
  const cfg = originConfig();
  if (!cfg) return { status: 503 };
  try {
    const got = await originFetch(cfg, path, {
      method,
      timeoutMs,
      headers: { 'X-ARMusic-Key': cfg.key, 'X-ARMusic-Client-Ip': String(clientIp || '') },
    });
    let body = null;
    try { body = await got.r.json(); } catch {}
    got.cleanup();
    return { status: got.r.status, body };
  } catch {
    return { status: 502 };
  }
}

function routeInfo() {
  const cfg = originConfig();
  if (!cfg) return [];
  const now = Date.now();
  return cfg.bases.map((b, i) => ({ route: i, ms: Math.round(b.ms), healthy: now - b.failedAt >= PENALTY_MS }));
}

module.exports = { relay, relaySmall, originConfig, routeInfo };
