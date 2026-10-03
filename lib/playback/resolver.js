/* resolveTrack: track id in, upstream media source out. Server side only.
 *
 * The result holds the upstream media URL, which is bound to this machine's
 * address and to the token minted for the track. It is used by streamTrack in
 * this same process and is never serialised to a client.
 *
 * Metadata resolution and media streaming are kept apart on purpose. Resolving
 * costs a few hundred milliseconds (one player request plus a token); after
 * that every range request for the same track, including every seek, goes
 * straight to the media host with the cached source. */

const vm = require('node:vm');
const { mintFor, resetMinter } = require('./potoken');
const { PlaybackError } = require('./errors');
const { isValidTrackId } = require('./trackId');

const SESSION_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const CACHE_MAX = 400;
// The upstream URL carries its own expiry. Stop using it well before then.
const EXPIRY_MARGIN_MS = 15 * 60 * 1000;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/* Quality presets. Standard is AAC in MP4, which every browser and the
 * Android WebView decode. High prefers Opus in WebM, which carries more detail
 * at a similar size, and falls back to AAC when the track has no Opus stream. */
const PRESETS = {
  std: [140, 251, 250, 139, 249],
  hi: [251, 140, 250, 249, 139],
};

let sessionP = null;
let sessionAt = 0;
const cache = new Map(); // key -> { value, expiresAt }
const inflight = new Map();

async function loadLib() {
  const lib = await import('youtubei.js');
  if (!lib.Platform.shim._armusicEval) {
    // The player script is evaluated in a fresh vm context with a time limit,
    // so it cannot reach this process's globals or hang it.
    lib.Platform.shim.eval = async (data, env) => {
      const props = [];
      if (env.n) props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
      if (env.sig) props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
      const code = `(function(){${data.output}\nreturn { ${props.join(', ')} };})()`;
      return vm.runInNewContext(code, {}, { timeout: 3000 });
    };
    lib.Platform.shim._armusicEval = true;
  }
  try { lib.Log.setLevel(lib.Log.Level.ERROR); } catch {}
  return lib;
}

async function getSession() {
  if (sessionP && Date.now() - sessionAt < SESSION_MAX_AGE_MS) return sessionP;
  sessionAt = Date.now();
  sessionP = loadLib()
    .then(({ Innertube }) => Innertube.create({ retrieve_player: true, generate_session_locally: true, lang: 'en', location: 'ID' }))
    .catch((e) => { sessionP = null; throw e; });
  return sessionP;
}

function resetSession() {
  sessionP = null;
}

function pickFormat(formats, quality) {
  const audio = formats.filter((f) => f && f.has_audio && !f.has_video);
  if (!audio.length) return null;
  const order = PRESETS[quality] || PRESETS.std;
  for (const itag of order) {
    const f = audio.find((x) => x.itag === itag);
    if (f) return f;
  }
  return audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
}

function cleanMime(m) {
  const base = String(m || '').split(';')[0].trim().toLowerCase();
  return /^audio\/(mp4|webm)$/.test(base) ? base : 'application/octet-stream';
}

async function resolveOnce(trackId, quality) {
  const yt = await getSession();
  const pot = await mintFor(trackId);
  const info = await yt.getBasicInfo(trackId, { client: 'YTMUSIC', po_token: pot });
  const ps = info.playability_status || {};
  if (ps.status !== 'OK' || !info.streaming_data) {
    throw new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', `playability ${ps.status || '?'}: ${ps.reason || ''}`);
  }
  const f = pickFormat(info.streaming_data.adaptive_formats || [], quality);
  if (!f) throw new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', 'no audio format');
  const base = await f.decipher(yt.session.player);
  if (!base) throw new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', 'empty media url');
  const url = new URL(base);
  url.searchParams.set('pot', pot);

  const exp = Number(url.searchParams.get('expire')) * 1000;
  const expiresAt = Number.isFinite(exp) && exp > Date.now()
    ? exp - EXPIRY_MARGIN_MS
    : Date.now() + DEFAULT_TTL_MS;
  const size = Number(f.content_length);
  return {
    trackId,
    url: url.toString(),
    mime: cleanMime(f.mime_type),
    ext: cleanMime(f.mime_type) === 'audio/webm' ? 'webm' : 'm4a',
    size: Number.isSafeInteger(size) && size > 0 ? size : null,
    durationMs: Number(f.approx_duration_ms) || null,
    expiresAt,
  };
}

/* Resolve with one retry on a fresh session and a fresh token minter. A stale
 * player script or an expired integrity token both look like a failure the
 * first time and go away on the second. */
async function resolveFresh(trackId, quality) {
  try {
    return await resolveOnce(trackId, quality);
  } catch (e) {
    if (e instanceof PlaybackError && /playability (UNPLAYABLE|ERROR)/.test(e.detail || '')) throw e;
    resetSession();
    resetMinter();
    try {
      return await resolveOnce(trackId, quality);
    } catch (e2) {
      if (e2 instanceof PlaybackError) throw e2;
      throw new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', String(e2 && e2.message));
    }
  }
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) { cache.delete(key); return null; }
  // refresh recency for the simple LRU
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: value.expiresAt });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/* Public entry. { force: true } skips the cache, used after the media host
 * rejects a cached source. Concurrent calls for the same track share one
 * resolution, which matters because a browser opening a track fires two or
 * three range requests at almost the same moment. */
async function resolveTrack(trackId, { quality = 'std', force = false } = {}) {
  if (!isValidTrackId(trackId)) throw new PlaybackError('PLAYBACK_BAD_REQUEST', 'bad track id');
  const q = PRESETS[quality] ? quality : 'std';
  const key = `${trackId}:${q}`;
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return hit;
  } else {
    cache.delete(key);
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = resolveFresh(trackId, q)
    .then((v) => { cacheSet(key, v); return v; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* Warm the session and the token minter before the first play request needs
 * them, so the first listener after a cold start does not pay for both. */
function warmUp() {
  return Promise.all([getSession(), require('./potoken').getMinter()]).catch(() => {});
}

module.exports = { resolveTrack, warmUp, pickFormat, PRESETS };
