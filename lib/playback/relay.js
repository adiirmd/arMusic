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
 * headers come back; everything else is rebuilt here. */

const { Readable, pipeline } = require('node:stream');
const { PlaybackError, sendPlaybackError } = require('./errors');

const PASS_BACK = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'];
const CONNECT_TIMEOUT_MS = 15000;

function originConfig() {
  const base = process.env.ARMUSIC_ORIGIN;
  const key = process.env.ARMUSIC_ORIGIN_KEY;
  if (!base) return null;
  let u;
  try { u = new URL(base); } catch { return null; }
  if (u.protocol !== 'https:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
  return { base: u.toString().replace(/\/+$/, ''), key: key || '' };
}

/* path is built by the caller from validated parts only, never from raw input */
async function relay(path, req, res, clientIp) {
  const cfg = originConfig();
  if (!cfg) return sendPlaybackError(res, new PlaybackError('PLAYBACK_NOT_CONFIGURED', 'no origin'));

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const headers = { 'X-ARMusic-Key': cfg.key, 'X-ARMusic-Client-Ip': String(clientIp || '') };
  if (typeof req.headers.range === 'string' && req.headers.range.length < 64) headers.Range = req.headers.range;

  const timer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(cfg.base + path, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: ac.signal, redirect: 'error' });
  } catch (e) {
    clearTimeout(timer);
    if (ac.signal.aborted && res.destroyed) return;
    console.log('[playback] origin unreachable', e && e.message, e && e.cause && (e.cause.code || e.cause.message));
    return sendPlaybackError(res, new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', `origin unreachable: ${e && e.message}`));
  }
  clearTimeout(timer);

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
        await r.body?.cancel();
      }
    } catch {}
    console.log('[playback] origin answered', r.status, code);
    const extra = r.status === 416 && r.headers.get('content-range') ? { 'Content-Range': r.headers.get('content-range'), 'Accept-Ranges': 'bytes' } : undefined;
    return sendPlaybackError(res, new PlaybackError(code, `origin ${r.status}`), extra);
  }

  res.statusCode = r.status;
  for (const h of PASS_BACK) {
    const v = r.headers.get(h);
    if (v != null) res.setHeader(h, v);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  if (req.method === 'HEAD' || !r.body) return res.end();

  pipeline(Readable.fromWeb(r.body, { highWaterMark: 256 * 1024 }), res, (err) => {
    if (err && !ac.signal.aborted && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.log('[playback] relay error', err.message);
      try { res.destroy(); } catch {}
    }
  });
}

module.exports = { relay, originConfig };
