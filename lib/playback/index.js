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
const { streamTrack } = require('./stream');
const { relay, originConfig } = require('./relay');
const { PlaybackError, sendPlaybackError } = require('./errors');
const { createLimiter, clientIp } = require('../ratelimit');
const { warmUp } = require('./resolver');

// A track is a handful of range requests plus seeks. 240 a minute per address
// is far above what a listener produces and far below what a scraper wants.
const limitPlay = createLimiter({ windowMs: 60 * 1000, max: 240 });
const limitDownload = createLimiter({ windowMs: 60 * 60 * 1000, max: 60 });

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
        return relay(path, req, res, ip);
      }

      const download = kind === 'download' ? (typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : 'track') : null;
      try {
        await streamTrack(trackId, req, res, { quality, download });
      } catch (e) {
        sendPlaybackError(res, e);
      }
    };
  }

  app.get('/api/play/:trackId', handler('play'));
  app.head('/api/play/:trackId', handler('play'));
  app.get('/api/download/:trackId', handler('download'));
}

module.exports = { mount };
