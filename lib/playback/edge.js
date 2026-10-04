/* The public edge of the media origin.
 *
 * The relay through the Vercel function costs a long detour on every request:
 * browser to Singapore, through a tunnel relay in Tokyo, to the origin at
 * home and back. Measured, that is 0.8 to 2 s before the first byte, while
 * the origin itself answers from memory in about 1 ms. Starting a song or
 * jumping in it paid that each time.
 *
 * This listener lets the page reach the origin directly, through a Cloudflare
 * tunnel whose edge sits close to the listener. It is deliberately narrow:
 *
 *   - only GET/HEAD of /play/<token>, /download/<token>, POST /warm/<token>,
 *     and a bare /health;
 *   - only sealed tokens are accepted, never a raw catalogue id, so it serves
 *     exactly the songs the site itself handed out;
 *   - rate limited per listener address (taken from the tunnel's header,
 *     which only the tunnel can set since this port listens on localhost);
 *   - answers carry only media headers, and CORS is open to the site alone.
 *
 * If this path fails for a listener, the page falls back to the relay, and
 * if the origin is down altogether, to the backup player. */

const express = require('express');
const ids = require('../ids');
const { createLimiter } = require('../ratelimit');
const { isValidTrackId } = require('./trackId');
const { PlaybackError, sendPlaybackError } = require('./errors');
const { streamTrack, warmTrack, fillTrack } = require('./stream');
const { prefill, has: inCdn } = require('./prefill');

const SITE = process.env.ARMUSIC_SITE_ORIGIN || 'https://music.adiirmd.id';

function createEdgeApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const limitPlay = createLimiter({ windowMs: 60 * 1000, max: 240 });
  const limitDownload = createLimiter({ windowMs: 60 * 60 * 1000, max: 60 });
  const limitWarm = createLimiter({ windowMs: 60 * 1000, max: 120 });
  let warmRunning = 0;

  const ipOf = (req) => {
    const v = req.headers['cf-connecting-ip'];
    return typeof v === 'string' && v.length < 64 ? v : (req.socket.remoteAddress || 'unknown');
  };

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', SITE);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // lets the site measure its own requests here (connection, first byte)
    res.setHeader('Timing-Allow-Origin', SITE);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Max-Age', '86400');
      return res.status(204).end();
    }
    next();
  });

  // a sealed token only; raw ids are refused here
  const openToken = (given) => {
    const s = String(given || '');
    if (!ids.isToken(s)) return null;
    const id = ids.fromClient(s);
    return isValidTrackId(id) ? id : null;
  };

  const media = (kind) => async (req, res) => {
    const trackId = openToken(req.params.t);
    if (!trackId) return sendPlaybackError(res, new PlaybackError('PLAYBACK_BAD_REQUEST', 'bad id'));
    const ip = ipOf(req);
    if (!(kind === 'download' ? limitDownload : limitPlay)(ip)) {
      return sendPlaybackError(res, new PlaybackError('PLAYBACK_RATE_LIMITED', ip), { 'Retry-After': '30' });
    }
    const quality = req.query.q === 'hi' ? 'hi' : 'std';
    const download = kind === 'download' ? (typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : 'track') : null;
    try {
      await streamTrack(trackId, req, res, { quality, download });
    } catch (e) {
      sendPlaybackError(res, e);
    }
    // once a song is being listened to, the rest of it is brought into
    // memory in the background, so a jump anywhere in it is answered at once
    if (kind === 'play') { fillTrack(trackId, { quality }); prefill(trackId, quality, true); }
  };
  app.get('/play/:t', media('play'));
  app.head('/play/:t', media('play'));
  app.get('/download/:t', media('download'));

  app.post('/warm/:t', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const trackId = openToken(req.params.t);
    if (!trackId) return res.status(400).end();
    if (!limitWarm(ipOf(req))) return res.status(429).end();
    const quality = req.query.q === 'hi' ? 'hi' : 'std';
    // p=1: someone is about to press this one; also put it in the CDN.
    // The answer waits until the song is ready (8 s at most) and says
    // whether the CDN holds it, so the page knows which address to use.
    const wantCdn = req.query.p === '1';
    if (warmRunning >= 16) return res.status(202).json({ cdn: inCdn(trackId, quality) });
    warmRunning++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res.status(202).json({ cdn: inCdn(trackId, quality) });
    };
    const timer = setTimeout(finish, 8000);
    Promise.all([
      warmTrack(trackId, { quality }).catch(() => {}),
      wantCdn ? prefill(trackId, quality, true) : null,
    ]).finally(() => { warmRunning--; clearTimeout(timer); finish(); });
  });

  app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  app.use((req, res) => res.status(404).end());
  return app;
}

module.exports = { createEdgeApp };
