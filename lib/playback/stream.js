/* streamTrack: relays one byte range of a track from the media host to the
 * client, as it arrives.
 *
 * Nothing is written to disk and nothing is held in memory beyond the chunk in
 * flight. The body is an async generator piped into the response with
 * stream.pipeline, so the generator only pulls the next piece from upstream
 * when the response has drained. A slow client therefore slows the upstream
 * read down with it instead of piling bytes up in this process.
 *
 * Upstream is asked for closed ranges no larger than UPSTREAM_CHUNK, one after
 * another. That keeps every upstream request a size the media host accepts,
 * and it gives a natural point to reconnect: if a piece fails halfway, the
 * next request starts at the exact byte where the last one stopped. */

const { Readable, pipeline } = require('node:stream');
const resolver = require('./resolver');
const { parseRange } = require('./range');
const { PlaybackError, sendPlaybackError } = require('./errors');

const UPSTREAM_CHUNK = 8 * 1024 * 1024;
/* An open ended range ("bytes=N-") from a media element is answered with at
 * most this many bytes. Media elements treat a shorter 206 as normal and ask
 * for the next piece when they need it. It keeps every response, and so every
 * serverless invocation, short, instead of one function holding a connection
 * open for the length of a one hour mix. */
const PLAY_CHUNK = Math.max(64 * 1024, Number(process.env.ARMUSIC_PLAY_CHUNK) || UPSTREAM_CHUNK);
const MAX_RECONNECTS = 3;
const UPSTREAM_TIMEOUT_MS = 12000;
const UPSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function log(...a) {
  if (process.env.ARMUSIC_PLAYBACK_LOG !== '0') console.log('[playback]', ...a);
}

/* One closed range from the media host. Throws PlaybackError on a status
 * that is not usable, with the real reason kept in .detail for the log. */
async function openUpstream(src, start, end, signal) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(src.url, {
      headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UPSTREAM_UA, Accept: '*/*' },
      signal: ac.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (r.status !== 206 && r.status !== 200) {
      try { await r.body?.cancel(); } catch {}
      const code = r.status === 416 ? 'PLAYBACK_RANGE_ERROR' : 'PLAYBACK_SOURCE_UNAVAILABLE';
      const err = new PlaybackError(code, `upstream ${r.status}`);
      err.upstreamStatus = r.status;
      throw err;
    }
    return { res: r, cleanup: () => signal && signal.removeEventListener('abort', onAbort) };
  } catch (e) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (e instanceof PlaybackError) throw e;
    throw new PlaybackError('PLAYBACK_STREAM_ERROR', String(e && e.message) + (e && e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''));
  }
}

/* Yields the bytes from start to end inclusive, reconnecting from the current
 * offset when a piece breaks. The first piece is opened by the caller, so the
 * response status can be decided before any header is sent. */
async function* rangeBody(ctx, first, start, end, signal) {
  let pos = start;
  let current = first;
  let reconnects = 0;
  try {
    while (pos <= end) {
      if (!current) {
        const pieceEnd = Math.min(end, pos + UPSTREAM_CHUNK - 1);
        try {
          current = await openUpstream(ctx.src, pos, pieceEnd, signal);
        } catch (e) {
          if (signal.aborted) return;
          if (e.upstreamStatus === 403 && reconnects < MAX_RECONNECTS) {
            // The cached source went stale (expired, or the token rotated).
            reconnects++;
            ctx.src = await ctx.resolve(ctx.trackId, { quality: ctx.quality, force: true });
            continue;
          }
          if (reconnects < MAX_RECONNECTS) {
            reconnects++;
            await new Promise((r) => setTimeout(r, 250 * reconnects));
            continue;
          }
          throw e;
        }
      }
      const reader = current.res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.byteLength) continue;
          // never pass on more than was asked for, whatever upstream sends
          const room = end - pos + 1;
          const piece = value.byteLength > room ? value.subarray(0, room) : value;
          pos += piece.byteLength;
          yield Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength);
          if (pos > end) break;
        }
      } catch (e) {
        if (signal.aborted) return;
        if (reconnects >= MAX_RECONNECTS) {
          throw new PlaybackError('PLAYBACK_STREAM_ERROR', `read failed at ${pos}: ${e && e.message}`);
        }
        reconnects++;
        log('reconnect', ctx.trackId, 'at', pos, String(e && e.message));
      } finally {
        try { reader.releaseLock(); } catch {}
        try { await current.res.body.cancel(); } catch {}
        current.cleanup();
        current = null;
      }
    }
  } finally {
    if (current) {
      try { await current.res.body.cancel(); } catch {}
      current.cleanup();
    }
  }
}

/* Public entry, called by the /api/play and /api/download routes.
 *
 * opts.quality  'std' or 'hi'
 * opts.download a filename stem, turns the response into an attachment */
async function streamTrack(trackId, req, res, opts = {}) {
  const quality = opts.quality === 'hi' ? 'hi' : 'std';
  // tests pass a stand-in resolver; production always uses the real one
  const resolve = opts.resolve || resolver.resolveTrack;
  const ac = new AbortController();
  const abort = () => ac.abort();
  res.on('close', abort);
  req.on('aborted', abort);

  const t0 = Date.now();
  let src;
  try {
    src = await resolve(trackId, { quality });
  } catch (e) {
    log('resolve failed', trackId, e.code || '', e.detail || e.message);
    return sendPlaybackError(res, e);
  }

  let size = src.size;
  const rangeHeader = req.headers.range;

  // Size unknown is rare (the upstream nearly always reports it). Learn it
  // from a one byte request instead of guessing.
  if (!size) {
    try {
      const probe = await openUpstream(src, 0, 0, ac.signal);
      const cr = probe.res.headers.get('content-range') || '';
      try { await probe.res.body.cancel(); } catch {}
      probe.cleanup();
      const m = /\/(\d+)$/.exec(cr);
      size = m ? Number(m[1]) : null;
    } catch (e) {
      return sendPlaybackError(res, e);
    }
    if (!size) return sendPlaybackError(res, new PlaybackError('PLAYBACK_SOURCE_UNAVAILABLE', 'size unknown'));
  }

  const range = parseRange(rangeHeader, size);
  if (range.kind === 'invalid' || range.kind === 'unsatisfiable') {
    return sendPlaybackError(res, new PlaybackError('PLAYBACK_RANGE_ERROR', `range ${rangeHeader}`), {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes',
    });
  }
  const partial = range.kind === 'range';
  const start = partial ? range.start : 0;
  let end = partial ? range.end : size - 1;
  if (partial && range.open && !opts.download) end = Math.min(end, start + PLAY_CHUNK - 1);

  // Open the first piece before committing to a status, so a dead source is
  // reported as a clean error instead of a 206 that never delivers. A plain
  // network failure (reset, DNS hiccup) is retried twice; a 403 means the
  // cached source is stale and gets one fresh resolve.
  const ctx = { trackId, quality, src, resolve };
  const firstEnd = Math.min(end, start + UPSTREAM_CHUNK - 1);
  let first;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      first = await openUpstream(ctx.src, start, firstEnd, ac.signal);
      break;
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e.upstreamStatus === 403 && !refreshed) {
        refreshed = true;
        try {
          ctx.src = await resolve(trackId, { quality, force: true });
        } catch (e2) {
          log('refresh failed', trackId, e2.detail || e2.message);
          return sendPlaybackError(res, e2);
        }
        continue;
      }
      if (!e.upstreamStatus && attempt < 2) {
        log('open retry', trackId, e.detail || e.message);
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }
      log('open failed', trackId, e.detail || e.message);
      return sendPlaybackError(res, e);
    }
  }
  if (ac.signal.aborted) {
    try { await first.res.body.cancel(); } catch {}
    first.cleanup();
    return;
  }

  // Headers are written by hand from what is known here. Nothing from the
  // upstream response is copied across.
  res.statusCode = partial ? 206 : 200;
  res.setHeader('Content-Type', ctx.src.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(end - start + 1));
  if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (opts.download) {
    const stem = String(opts.download).replace(/[^\p{L}\p{N} ._()&,'-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'track';
    const name = `${stem}.${ctx.src.ext}`;
    const ascii = name.replace(/[^\x20-\x7e]+/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  log('stream', trackId, quality, partial ? `${start}-${end}/${size}` : `full ${size}`, `ttfb-ready ${Date.now() - t0}ms`);

  if (req.method === 'HEAD') {
    try { await first.res.body.cancel(); } catch {}
    first.cleanup();
    return res.end();
  }

  const body = Readable.from(rangeBody(ctx, first, start, end, ac.signal), { objectMode: false, highWaterMark: 256 * 1024 });
  pipeline(body, res, (err) => {
    if (err && !ac.signal.aborted && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      log('stream error', trackId, err.detail || err.message);
      sendPlaybackError(res, err);
    }
  });
}

module.exports = { streamTrack, UPSTREAM_CHUNK };
