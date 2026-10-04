/* Fills the CDN in front of the site with whole songs, from the origin.
 *
 * The page plays from /api/a/<token>. The CDN stores a song only after one
 * whole, unranged request for it has gone through, and a browser never makes
 * one (it always asks for a range). So the origin makes that request itself
 * for songs that are about to be played: the next in the queue, the one being
 * reached for, the one being listened to. From then on every play and every
 * jump in that song is answered by the CDN node near the listener.
 *
 * Bounded: one fill per song and quality per six days, two at a time, songs
 * over the CDN's size limit skipped. The request goes to the public site the
 * same way a browser would, so it fills the same edge the listener uses. */

const https = require('node:https');
const ids = require('../ids');

const SITE = process.env.ARMUSIC_SITE_ORIGIN || 'https://music.adiirmd.id';
const ENABLED = process.env.ARMUSIC_ROLE === 'origin' && process.env.ARMUSIC_PREFILL !== '0';
const TTL_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_RUNNING = 2;
const MAX_QUEUE = 30;

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const done = new Map(); // key -> time filled
const queued = new Map(); // key -> promise settled when that fill is over
const queue = [];
let running = 0;
const stats = { filled: 0, alreadyCached: 0, failed: 0 };

function key(trackId, quality) { return `${trackId}:${quality}`; }

/* Resolves to whether the song is in the CDN once this attempt is over. */
function prefill(trackId, quality = 'std', urgent = false) {
  if (!ENABLED) return Promise.resolve(false);
  const k = key(trackId, quality);
  if (has(trackId, quality)) return Promise.resolve(true);
  if (queued.has(k)) return queued.get(k).p;
  let settle;
  const p = new Promise((r) => { settle = r; });
  const job = { trackId, quality, k, settle };
  queued.set(k, { p, job });
  if (urgent) queue.unshift(job); else queue.push(job);
  while (queue.length > MAX_QUEUE) {
    const drop = queue.pop();
    queued.delete(drop.k);
    drop.settle(false);
  }
  pump();
  return p;
}

function has(trackId, quality = 'std') {
  const t = done.get(key(trackId, quality));
  return !!t && Date.now() - t < TTL_MS;
}

function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift();
    running++;
    fill(job).finally(() => {
      running--;
      queued.delete(job.k);
      job.settle(has(job.trackId, job.quality));
      pump();
    });
  }
}

function fill({ trackId, quality, k }) {
  return new Promise((resolve) => {
    const url = `${SITE}/api/a/${encodeURIComponent(ids.sealId(trackId))}${quality === 'hi' ? '?q=hi' : ''}`;
    const req = https.get(url, { agent, headers: { 'User-Agent': 'ARMusic-prefill/1' }, timeout: 60000 }, (res) => {
      const status = res.headers['x-vercel-cache'];
      if (res.statusCode !== 200) { res.resume(); stats.failed++; return resolve(); }
      if (status === 'HIT' || status === 'STALE') {
        // already there; nothing to carry
        res.destroy();
        stats.alreadyCached++;
        done.set(k, Date.now());
        return resolve();
      }
      res.on('data', () => {});
      res.on('end', () => { stats.filled++; done.set(k, Date.now()); resolve(); });
      res.on('error', () => { stats.failed++; resolve(); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => { stats.failed++; resolve(); });
  }).then(() => {
    if (done.size > 5000) done.delete(done.keys().next().value);
  });
}

function info() { return { ...stats, queued: queue.length, running, known: done.size }; }

module.exports = { prefill, has, info };
