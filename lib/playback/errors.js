/* The only errors the browser ever sees from the playback gateway.
 *
 * Whatever went wrong upstream (a status code, a hostname, a reason string)
 * stays in the server log. The client gets one of these codes and nothing
 * else, so the page can react without learning anything about the source. */

const CODES = {
  PLAYBACK_BAD_REQUEST: 400,
  PLAYBACK_RANGE_ERROR: 416,
  PLAYBACK_RATE_LIMITED: 429,
  PLAYBACK_SOURCE_UNAVAILABLE: 502,
  PLAYBACK_STREAM_ERROR: 502,
  PLAYBACK_NOT_CONFIGURED: 503,
};

class PlaybackError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.status = CODES[code] || 500;
    // detail is for logs only and is never serialised to the client
    this.detail = detail;
  }
}

function sendPlaybackError(res, err, extraHeaders) {
  const code = err instanceof PlaybackError ? err.code : 'PLAYBACK_STREAM_ERROR';
  const status = err instanceof PlaybackError ? err.status : 502;
  if (res.headersSent) {
    // Bytes are already on the wire, so a status code can no longer be sent.
    // Cutting the connection is the honest signal: the media element sees a
    // network error at the point it stopped, rather than a file that quietly
    // ends early and looks complete.
    try { res.destroy(); } catch {}
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify({ error: code }));
}

module.exports = { PlaybackError, sendPlaybackError, CODES };
