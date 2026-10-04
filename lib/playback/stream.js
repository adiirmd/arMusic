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
const cache = require('./blockcache');

const UPSTREAM_CHUNK = 8 * 1024 * 1024;
/* An open ended range ("bytes=N-") from a media element is answered with at
 * most this many bytes. Media elements treat a shorter 206 as normal and ask
 * for the next piece when they need it. It keeps every response, and so every
 * serverless invocation, short, instead of one function holding a connection
 * open for the length of a one hour mix. */
const PLAY_CHUNK = Math.max(64 * 1024, Number(process.env.ARMUSIC_PLAY_CHUNK) || UPSTREAM_CHUNK);
// how much of a track a warm-up keeps ready: about 25 seconds of audio,
// enough for playback to start and settle before the network has to deliver
const WARM_BYTES = Math.max(cache.BLOCK, Number(process.env.ARMUSIC_WARM_BYTES) || 512 * 1024);
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

/* Where a run of uncached bytes starting at pos should end: at the request
 * end, at the size cap for one upstream request, or just before the next
 * block that is already in the cache, whichever comes first. */
function runEndFor(src, pos, end) {
  let runEnd = Math.min(end, pos + UPSTREAM_CHUNK - 1);
  const first = Math.floor(pos / cache.BLOCK) + 1;
  const last = Math.floor(runEnd / cache.BLOCK);
  for (let k = first; k <= last; k++) {
    if (cache.has(src, k)) { runEnd = k * cache.BLOCK - 1; break; }
  }
  return runEnd;
}

/* Yields the bytes from start to end inclusive.
 *
 * Cached blocks are served straight from memory. Gaps are fetched from the
 * source, and every whole block that passes through is stored on the way.
 * While a cached stretch is being served, the request for the gap after it is
 * already opened, so the hand over from memory to network has no pause.
 * A connection that breaks partway is reopened at the exact byte it reached. */
async function* rangeBody(ctx, first, start, end, signal) {
  let pos = start;
  let current = first;
  let ahead = null; // { pos, promise } upstream opened early for the next gap
  let reconnects = 0;
  // bytes of the block currently being assembled for the cache
  let accIdx = -1;
  let acc = [];
  let accLen = 0;

  const feed = (piece, at) => {
    if (!ctx.src.size) return;
    let off = 0;
    while (off < piece.length) {
      const p = at + off;
      const idx = Math.floor(p / cache.BLOCK);
      const blockStart = idx * cache.BLOCK;
      if (accIdx !== idx) {
        // only start assembling at the first byte of a block
        if (p !== blockStart) {
          off += Math.min(piece.length - off, blockStart + cache.BLOCK - p);
          continue;
        }
        accIdx = idx; acc = []; accLen = 0;
      }
      const want = cache.blockLen(ctx.src.size, idx) - accLen;
      const take = Math.min(want, piece.length - off);
      acc.push(piece.subarray(off, off + take));
      accLen += take;
      off += take;
      if (accLen === cache.blockLen(ctx.src.size, idx)) {
        cache.set(ctx.src, idx, Buffer.concat(acc, accLen));
        accIdx = -1; acc = []; accLen = 0;
      }
    }
  };

  const openAhead = (p) => {
    if (ahead || p > end || signal.aborted) return;
    const runEnd = runEndFor(ctx.src, p, end);
    const promise = openUpstream(ctx.src, p, runEnd, signal).then(
      (v) => ({ ok: v, runEnd }),
      (e) => ({ err: e }),
    );
    ahead = { pos: p, promise };
  };
  const dropAhead = async () => {
    if (!ahead) return;
    const r = await ahead.promise;
    ahead = null;
    if (r.ok) { try { await r.ok.res.body.cancel(); } catch {} r.ok.cleanup(); }
  };

  try {
    while (pos <= end) {
      // 1. memory first
      if (!current) {
        const idx = Math.floor(pos / cache.BLOCK);
        const blk = cache.get(ctx.src, idx);
        if (blk) {
          // the stretch after the cached blocks gets opened now, in parallel
          let n = idx + 1;
          while (n * cache.BLOCK <= end && cache.has(ctx.src, n)) n++;
          if (n * cache.BLOCK <= end) openAhead(n * cache.BLOCK);
          const from = pos - idx * cache.BLOCK;
          const to = Math.min(blk.length, end - idx * cache.BLOCK + 1);
          const piece = blk.subarray(from, to);
          pos += piece.length;
          yield piece;
          continue;
        }
      }

      // 2. the source
      if (!current) {
        if (ahead && ahead.pos === pos) {
          const r = await ahead.promise;
          ahead = null;
          if (r.ok) current = r.ok;
          else if (signal.aborted) return;
        } else if (ahead) {
          await dropAhead();
        }
      }
      if (!current) {
        const runEnd = runEndFor(ctx.src, pos, end);
        try {
          current = await openUpstream(ctx.src, pos, runEnd, signal);
        } catch (e) {
          if (signal.aborted) return;
          if (e.upstreamStatus === 403 && reconnects < MAX_RECONNECTS) {
            // the cached source went stale (expired, or the token rotated)
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
      const runStart = pos;
      const reader = current.res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.byteLength) continue;
          // never pass on more than was asked for, whatever upstream sends
          const room = end - pos + 1;
          const v = value.byteLength > room ? value.subarray(0, room) : value;
          const piece = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
          feed(piece, pos);
          pos += piece.length;
          yield piece;
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
      if (pos === runStart && reconnects >= MAX_RECONNECTS) {
        throw new PlaybackError('PLAYBACK_STREAM_ERROR', `no data at ${pos}`);
      }
    }
  } finally {
    if (current) {
      try { await current.res.body.cancel(); } catch {}
      current.cleanup();
    }
    await dropAhead();
  }
}

/* Puts the first blocks of a track in memory ahead of time, so that pressing
 * play on it later is answered from here. Used for the next songs in a queue
 * and for songs someone is about to press. Concurrent calls share one fetch. */
const warming = new Map();
async function warmTrack(trackId, { quality = 'std', bytes = WARM_BYTES, resolve = resolver.resolveTrack } = {}) {
  const key = `${trackId}:${quality}`;
  if (warming.has(key)) return warming.get(key);
  const p = (async () => {
    const src = await resolve(trackId, { quality });
    if (!src.size) return { cached: false };
    const end = Math.min(src.size - 1, Math.ceil(bytes / cache.BLOCK) * cache.BLOCK - 1);
    const lastIdx = Math.floor(end / cache.BLOCK);
    let missing = -1;
    for (let k = 0; k <= lastIdx; k++) if (!cache.has(src, k)) { missing = k; break; }
    if (missing < 0) return { cached: true, already: true };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const ctx = { trackId, quality, src, resolve };
      // drain the generator; blocks are stored as they pass
      for await (const _ of rangeBody(ctx, null, missing * cache.BLOCK, end, ac.signal)) { /* stored by feed */ }
      return { cached: true };
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => warming.delete(key));
  warming.set(key, p);
  return p;
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
  if (partial && range.open && !opts.download) {
    // ends on a block boundary, so the request that follows starts on one
    // and every block it fetches can be cached whole
    const capped = start + PLAY_CHUNK - 1;
    end = Math.min(end, Math.ceil((capped + 1) / cache.BLOCK) * cache.BLOCK - 1);
  }

  // Open the first piece before committing to a status, so a dead source is
  // reported as a clean error instead of a 206 that never delivers. When the
  // first block is already in memory there is nothing to open: the answer
  // starts at once. A plain network failure (reset, DNS hiccup) is retried
  // twice; a 403 means the cached source is stale and gets one fresh resolve.
  const ctx = { trackId, quality, src, resolve };
  let first = null;
  let fromCache = cache.has(ctx.src, Math.floor(start / cache.BLOCK));
  let refreshed = false;
  for (let attempt = 0; !fromCache; attempt++) {
    try {
      first = await openUpstream(ctx.src, start, runEndFor(ctx.src, start, end), ac.signal);
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
    if (first) { try { await first.res.body.cancel(); } catch {} first.cleanup(); }
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
  log('stream', trackId, quality, partial ? `${start}-${end}/${size}` : `full ${size}`, `ttfb-ready ${Date.now() - t0}ms`, fromCache ? 'cache' : 'source');

  if (req.method === 'HEAD') {
    if (first) { try { await first.res.body.cancel(); } catch {} first.cleanup(); }
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

module.exports = { streamTrack, warmTrack, UPSTREAM_CHUNK, WARM_BYTES };
