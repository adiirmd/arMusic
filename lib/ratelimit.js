/* A small fixed-window rate limiter kept in memory.
 *
 * Per process, so on a serverless platform each instance counts on its own.
 * That still caps what a single client can make one instance do, which is the
 * point: a resolve costs real upstream requests. */

function createLimiter({ windowMs, max }) {
  const hits = new Map();
  let lastSweep = Date.now();
  return function allow(key) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      lastSweep = now;
    }
    let e = hits.get(key);
    if (!e || now - e.start >= windowMs) {
      e = { start: now, n: 0 };
      hits.set(key, e);
    }
    e.n++;
    return e.n <= max;
  };
}

/* The client address. On Vercel the platform header is trusted; behind the
 * origin key the relay passes the real address along. */
function clientIp(req, trustRelay) {
  if (trustRelay) {
    const relayed = req.headers['x-armusic-client-ip'];
    if (typeof relayed === 'string' && relayed.length < 64) return relayed;
  }
  const v = req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'];
  if (typeof v === 'string' && v) return v.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { createLimiter, clientIp };
