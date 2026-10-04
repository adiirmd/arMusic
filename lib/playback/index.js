/* The playback gateway, as mounted on the Express app.
 *
 *   GET /api/play/:trackId          media bytes, Range aware
 *   GET /api/download/:trackId      same bytes, as an attachment
 *
 * Two modes, chosen by environment:
 *
 *   ARMUSIC_ORIGIN set     this instance relays to that origin (the Vercel
 *                          deployment). The origin does the upstream work.
 *   ARMUSIC_ORIGIN unset   this instance resolves and streams itself (the
 *                          origin, or a local npm start).
 *
 * When ARMUSIC_ORIGIN_KEY is set and ARMUSIC_ORIGIN is not, requests must carry
 * the key. That is what keeps the origin from being used directly. */

const crypto = require('node:crypto');
const { isValidTrackId } = require('./trackId');
const ids = require('../ids');
const { streamTrack, warmTrack, fillTrack } = require('./stream');
const { relay, relaySmall, originConfig, routeInfo } = require('./relay');
const blockcache = require('./blockcache');
const resolver = require('./resolver');
const { PlaybackError, sendPlaybackError } = require('./errors');
const { createLimiter, clientIp } = require('../ratelimit');
const { warmUp } = require('./resolver');

// A track is a handful of range requests plus seeks. 240 a minute per address
// is far above what a listener produces and far below what a scraper wants.
const limitPlay = createLimiter({ windowMs: 60 * 1000, max: 240 });
const limitDownload = createLimiter({ windowMs: 60 * 60 * 1000, max: 60 });
const limitWarm = createLimiter({ windowMs: 60 * 1000, max: 90 });
const limitFallback = createLimiter({ windowMs: 60 * 1000, max: 60 });

/* Whether the origin can be reached, remembered briefly so a burst of
 * listeners asking at once costs one check. A failure is believed for less
 * time than a success, so recovery is noticed quickly. */
let originSeen = { at: 0, up: true };
let originCheck = null;
async function originUp(relaySmall, fresh = false) {
  const age = Date.now() - originSeen.at;
  // a page that has just watched the media path fail asks for a fresh look,
  // so a stale "up" from a few seconds ago cannot send it round again
  if (age < (originSeen.up ? (fresh ? 0 : 3000) : 8000)) return originSeen.up;
  if (!originCheck) {
    originCheck = relaySmall('GET', '/api/health', '', 2000)
      .then((r) => { originSeen = { at: Date.now(), up: r.status === 200 }; return originSeen.up; })
      .finally(() => { originCheck = null; });
  }
  return originCheck;
}
// how many warm-ups may run on the origin at once, so a burst of them never
// competes with someone who is actually listening
const MAX_WARM_RUNNING = 4;
let warmRunning = 0;

function keyMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mount(app) {
  const relayMode = !!originConfig();
  const originKey = process.env.ARMUSIC_ORIGIN_KEY || '';
  const guarded = !relayMode && !!originKey;

  if (!relayMode && process.env.ARMUSIC_WARMUP !== '0') {
    // start the upstream session and token minter in the background
    setTimeout(() => { warmUp(); }, 0);
  }

  function handler(kind) {
    return async (req, res) => {
      // the page sends a sealed id; a raw one from an old link still works
      const given = String(req.params.trackId || '');
      const trackId = ids.fromClient(given);
      if (!isValidTrackId(trackId)) return sendPlaybackError(res, new PlaybackError('PLAYBACK_BAD_REQUEST', 'bad id'));
      const quality = req.query.q === 'hi' ? 'hi' : 'std';

      if (guarded && !keyMatches(req.headers['x-armusic-key'], originKey)) {
        res.status(404).end();
        return;
      }
      const ip = clientIp(req, guarded);
      const allow = kind === 'download' ? limitDownload : limitPlay;
      if (!allow(ip)) {
        return sendPlaybackError(res, new PlaybackError('PLAYBACK_RATE_LIMITED', ip), { 'Retry-After': '30' });
      }

      if (relayMode) {
        const qs = new URLSearchParams();
        if (quality === 'hi') qs.set('q', 'hi');
        if (kind === 'download' && typeof req.query.name === 'string') qs.set('name', req.query.name.slice(0, 120));
        const path = `/api/${kind === 'download' ? 'download' : 'play'}/${encodeURIComponent(ids.sealId(trackId))}${qs.toString() ? '?' + qs : ''}`;
        // the origin was just seen down: answer at once instead of waiting
        // on it again, so the page can switch to the backup without delay
        if (!originSeen.up && Date.now() - originSeen.at < 8000) {
          return sendPlaybackError(res, new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', 'origin down'));
        }
        await relay(path, req, res, ip);
        if (res.headersSent && res.locals.originUnreachable) {
          originSeen = { at: Date.now(), up: false };
        }
        return;
      }

      const download = kind === 'download' ? (typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : 'track') : null;
      try {
        await streamTrack(trackId, req, res, { quality, download });
        if (kind === 'play') fillTrack(trackId, { quality });
      } catch (e) {
        sendPlaybackError(res, e);
      }
    };
  }

  /* POST /api/warm/:trackId
   * Gets a track ready before anyone presses play on it: resolves it and
   * keeps its first seconds in memory on the origin. The page calls this for
   * the next song in the queue and for a song someone is reaching for. It
   * answers at once; the work carries on in the background. */
  app.post('/api/warm/:trackId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const trackId = ids.fromClient(String(req.params.trackId || ''));
    if (!isValidTrackId(trackId)) return res.status(400).json({ error: 'PLAYBACK_BAD_REQUEST' });
    if (guarded && !keyMatches(req.headers['x-armusic-key'], originKey)) return res.status(404).end();
    const ip = clientIp(req, guarded);
    if (!limitWarm(ip)) return res.status(429).json({ error: 'PLAYBACK_RATE_LIMITED' });
    const quality = req.query.q === 'hi' ? 'hi' : 'std';
    if (relayMode) {
      const r = await relaySmall('POST', `/api/warm/${encodeURIComponent(ids.sealId(trackId))}${quality === 'hi' ? '?q=hi' : ''}`, ip);
      return res.status(r.status === 202 || r.status === 200 ? 202 : 204).end();
    }
    if (warmRunning >= MAX_WARM_RUNNING) return res.status(202).json({ queued: false });
    warmRunning++;
    warmTrack(trackId, { quality })
      .catch(() => {})
      .finally(() => { warmRunning--; });
    res.status(202).json({ queued: true });
  });

  /* GET /api/fallback/:trackId
   * The backup path. When the media origin cannot be reached, the page plays
   * the track through the public embedded player instead, and for that it
   * needs the track's public id. That id is handed out only while the origin
   * is down: as long as the origin answers, this says so (409) and the page
   * keeps playing through the gateway, where nothing upstream is visible. */
  app.get('/api/fallback/:trackId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const trackId = ids.fromClient(String(req.params.trackId || ''));
    if (!isValidTrackId(trackId)) return res.status(400).json({ error: 'PLAYBACK_BAD_REQUEST' });
    if (!limitFallback(clientIp(req, guarded))) return res.status(429).json({ error: 'PLAYBACK_RATE_LIMITED' });
    if (!relayMode) return res.status(409).json({ error: 'PLAYBACK_ORIGIN_UP' });
    if (await originUp(relaySmall, req.query.fresh === '1')) return res.status(409).json({ error: 'PLAYBACK_ORIGIN_UP' });
    res.json({ v: trackId });
  });

  /* GET /api/health  origin only, with the key: is the gateway ready, and how
   * full is its memory. */
  app.get('/api/health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (relayMode) {
      const t = Date.now();
      const r = await relaySmall('GET', '/api/health', '', 5000);
      originSeen = { at: Date.now(), up: r.status === 200 };
      return res.status(r.status === 200 ? 200 : 503).json({ ok: r.status === 200, ms: Date.now() - t, routes: routeInfo() });
    }
    if (guarded && !keyMatches(req.headers['x-armusic-key'], originKey)) return res.status(404).end();
    res.json({ ok: true, cache: blockcache.info(), sources: resolver.cacheInfo(), warmRunning, uptime: Math.round(process.uptime()) });
  });

  app.get('/api/play/:trackId', handler('play'));
  app.head('/api/play/:trackId', handler('play'));
  app.get('/api/download/:trackId', handler('download'));
}

module.exports = { mount };
