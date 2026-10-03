/* Artwork without upstream hostnames.
 *
 * Every image URL that comes back from the upstream is replaced, before the
 * response leaves the server, with /api/img/<token>. The token is the URL
 * encrypted with AES-256-GCM under a server key, so the browser can neither
 * read the original address nor make the server fetch one of its choosing.
 *
 * The IV is derived from the URL itself (an HMAC of it) rather than random.
 * The same picture therefore always gets the same token, which keeps browser
 * caching working across pages and across visits. The only thing that leaks
 * is that two tokens are equal when their pictures are equal. */

const crypto = require('node:crypto');
const { Readable, pipeline } = require('node:stream');

const IMAGE_HOSTS = [/(^|\.)ytimg\.com$/, /(^|\.)ggpht\.com$/, /(^|\.)googleusercontent\.com$/];
const UPSTREAM_ANY = /^https?:\/\/[^/]*(youtube\.com|youtu\.be|ytimg\.com|ggpht\.com|googleusercontent\.com|googlevideo\.com)(\/|$|\?)/i;
const PREFIX = '/api/img/';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

let keys = null;
function getKeys() {
  if (keys) return keys;
  let secret = process.env.ARMUSIC_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('[img] ARMUSIC_SECRET is not set; artwork tokens will not survive a restart');
  }
  const master = crypto.createHash('sha256').update(String(secret)).digest();
  keys = {
    enc: crypto.createHmac('sha256', master).update('armusic-img-enc').digest(),
    iv: crypto.createHmac('sha256', master).update('armusic-img-iv').digest(),
  };
  return keys;
}

function isImageHost(host) {
  return IMAGE_HOSTS.some((re) => re.test(host));
}

function seal(url) {
  const k = getKeys();
  const pt = Buffer.from(url, 'utf8');
  const iv = crypto.createHmac('sha256', k.iv).update(pt).digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', k.enc, iv);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

function unseal(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', getKeys().enc, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* An upstream image URL becomes a same-origin path. Anything else that points
 * at an upstream host is dropped, so no such address reaches the client. */
function sealUrl(u) {
  if (typeof u !== 'string' || !UPSTREAM_ANY.test(u)) return u;
  let parsed;
  try { parsed = new URL(u); } catch { return ''; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  if (!isImageHost(parsed.hostname)) return '';
  parsed.protocol = 'https:';
  return PREFIX + seal(parsed.toString());
}

/* Walks a JSON-able value and seals every upstream URL inside it. */
function sealDeep(v, depth = 0) {
  if (depth > 40) return v;
  if (typeof v === 'string') return sealUrl(v);
  if (Array.isArray(v)) return v.map((x) => sealDeep(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = sealDeep(v[k], depth + 1);
    return out;
  }
  return v;
}

/* GET /api/img/:token */
async function serveImage(req, res) {
  const url = unseal(req.params.token);
  let parsed = null;
  try { parsed = url ? new URL(url) : null; } catch {}
  if (!parsed || parsed.protocol !== 'https:' || !isImageHost(parsed.hostname)) {
    res.status(404).setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 ARMusicImage/1.0', Accept: 'image/avif,image/webp,image/*' },
      signal: ac.signal,
      redirect: 'error',
    });
    clearTimeout(timer);
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const len = Number(r.headers.get('content-length') || 0);
    if (!r.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type) || len > MAX_IMAGE_BYTES) {
      try { await r.body?.cancel(); } catch {}
      res.status(502).setHeader('Cache-Control', 'no-store');
      return res.end();
    }
    res.status(200);
    res.setHeader('Content-Type', type);
    if (len) res.setHeader('Content-Length', String(len));
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let seen = 0;
    const limited = Readable.from((async function* () {
      for await (const chunk of r.body) {
        seen += chunk.byteLength;
        if (seen > MAX_IMAGE_BYTES) throw new Error('image too large');
        yield Buffer.from(chunk);
      }
    })());
    pipeline(limited, res, () => {});
  } catch {
    clearTimeout(timer);
    if (!res.headersSent) {
      res.status(502).setHeader('Cache-Control', 'no-store');
      res.end();
    } else {
      res.destroy();
    }
  }
}

/* POST /api/img/seal  { urls: [...] } -> { sealed: [...] }, same order
 * For libraries saved before this change: the page sends the old addresses it
 * still has in storage once, gets paths back, and forgets the addresses. The
 * answer is a plain list in the same order so no upstream address is echoed
 * back, not even as a key. */
function sealBatch(req, res) {
  const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls.slice(0, 1000) : [];
  const sealed = urls.map((u) => {
    if (typeof u !== 'string' || u.length > 2048) return '';
    const s = sealUrl(u);
    return s && s.startsWith(PREFIX) ? s : '';
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sealed });
}

module.exports = { seal, unseal, sealUrl, sealDeep, serveImage, sealBatch, UPSTREAM_ANY, PREFIX };
