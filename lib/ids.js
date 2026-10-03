/* Catalogue ids as the browser sees them.
 *
 * Every id that comes back from the catalogue (songs, albums, artists,
 * playlists, browse params) is replaced with an opaque token before a
 * response leaves this server, and turned back into the real id when the
 * browser sends it in again. The page never holds an id that could be
 * recognised or looked up anywhere else.
 *
 * The scheme is deterministic so the same song always gets the same token,
 * which is what keeps favorites, history and share links stable:
 *
 *   iv    = HMAC(k_iv, id)[0..12)
 *   token = "x" + base64url(iv || AES-256-CTR(k_enc, iv, id))
 *
 * Opening a token decrypts it and checks the iv against the HMAC of the
 * result, so a made up or altered token is rejected rather than decrypted
 * into garbage. Both keys come from ARMUSIC_SECRET, which therefore has to
 * stay the same for as long as people's saved libraries should keep working. */

const crypto = require('node:crypto');

const TOKEN_RE = /^x[A-Za-z0-9_-]{18,2000}$/;
const ID_KEYS = new Set(['videoId', 'browseId', 'playlistId', 'params', 'lyricsBrowseId', 'relatedBrowseId', 'artistBrowseId']);

/* The names the page knows these fields by. Internally the routes keep the
 * catalogue's own field names; on the way out they are renamed to these, and
 * on the way in (query strings) they are renamed back. */
const OUT_NAMES = {
  videoId: 'trackId',
  browseId: 'pageId',
  playlistId: 'listId',
  browseType: 'pageType',
  lyricsBrowseId: 'lyricsId',
  relatedBrowseId: 'relatedId',
  artistBrowseId: 'artistId',
  watchPlaylist: 'mixList',
};
const IN_NAMES = { trackId: 'videoId', pageId: 'browseId', listId: 'playlistId' };

let keys = null;
function getKeys() {
  if (keys) return keys;
  let secret = process.env.ARMUSIC_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('[ids] ARMUSIC_SECRET is not set; ids will change on restart');
  }
  const master = crypto.createHash('sha256').update(String(secret)).digest();
  keys = {
    enc: crypto.createHmac('sha256', master).update('armusic-id-enc').digest(),
    iv: crypto.createHmac('sha256', master).update('armusic-id-iv').digest(),
  };
  return keys;
}

function ivFor(pt) {
  return crypto.createHmac('sha256', getKeys().iv).update(pt).digest().subarray(0, 12);
}

function ctr(iv) {
  return Buffer.concat([iv, Buffer.alloc(4)]);
}

function sealId(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  if (isToken(raw)) return raw;
  const pt = Buffer.from(raw, 'utf8');
  const iv = ivFor(pt);
  const c = crypto.createCipheriv('aes-256-ctr', getKeys().enc, ctr(iv));
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return 'x' + Buffer.concat([iv, ct]).toString('base64url');
}

function openId(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const buf = Buffer.from(token.slice(1), 'base64url');
  if (buf.length < 13) return null;
  const iv = buf.subarray(0, 12);
  const d = crypto.createDecipheriv('aes-256-ctr', getKeys().enc, ctr(iv));
  const pt = Buffer.concat([d.update(buf.subarray(12)), d.final()]);
  const check = ivFor(pt);
  if (!crypto.timingSafeEqual(check, iv)) return null;
  return pt.toString('utf8');
}

function isToken(v) {
  return typeof v === 'string' && TOKEN_RE.test(v) && openId(v) !== null;
}

/* A value from the browser: a token is opened, anything else is passed
 * through as it is. Passing through keeps links and libraries from before
 * this change working; the answer the browser gets back is sealed either way. */
function fromClient(v) {
  if (typeof v !== 'string') return v;
  const o = openId(v);
  return o === null ? v : o;
}

/* Seals every id field in a response body, however deep. */
function sealIdsDeep(v, depth = 0) {
  if (depth > 40 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => sealIdsDeep(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      out[OUT_NAMES[k] || k] = ID_KEYS.has(k) && typeof x === 'string' ? sealId(x) : sealIdsDeep(x, depth + 1);
    }
    return out;
  }
  return v;
}

/* Express middleware: opens tokens in the query string before any route
 * sees it. Express 5 rebuilds req.query on every read, so the opened copy is
 * pinned in place. */
const QUERY_KEYS = ['videoId', 'playlistId', 'browseId', 'id', 'params'];
function openQuery(req, res, next) {
  const q = { ...req.query };
  let changed = false;
  for (const [ext, int] of Object.entries(IN_NAMES)) {
    if (q[ext] !== undefined && q[int] === undefined) { q[int] = q[ext]; delete q[ext]; changed = true; }
  }
  for (const k of QUERY_KEYS) {
    if (typeof q[k] === 'string') {
      const o = fromClient(q[k]);
      if (o !== q[k]) { q[k] = o; changed = true; }
    }
  }
  if (changed) Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
  next();
}

/* POST /api/id/seal { values: [...] } -> { sealed: [...] }, same order.
 * Used once by libraries saved before ids were sealed. */
function sealBatch(req, res) {
  const values = Array.isArray(req.body && req.body.values) ? req.body.values.slice(0, 5000) : [];
  const sealed = values.map((v) => (typeof v === 'string' && v.length > 0 && v.length <= 1000 ? sealId(v) : ''));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sealed });
}

module.exports = { OUT_NAMES, IN_NAMES, sealId, openId, isToken, fromClient, sealIdsDeep, openQuery, sealBatch, ID_KEYS };
