/* Audio blocks kept in memory on the origin.
 *
 * A track is split into fixed blocks. Blocks are stored as they stream past
 * on their way to a listener, never fetched ahead just to fill the cache, so
 * caching costs no wait. A later request (replay, seek back, the next person
 * playing the same song, or a warm-up for the next track in someone's queue)
 * is answered from here without touching the source.
 *
 * Bounded by bytes, least recently used goes first. Memory only: nothing is
 * written to disk. */

const BLOCK = 256 * 1024;
const BUDGET = Math.max(16, Number(process.env.ARMUSIC_CACHE_MB) || 160) * 1024 * 1024;

const map = new Map(); // key -> Buffer, insertion order is recency
let bytes = 0;
const stats = { hits: 0, misses: 0, stored: 0, evicted: 0 };

/* A source is identified by track, format and size, so a block can never be
 * served for a different encoding of the same song. */
function sourceKey(src) {
  return `${src.trackId}:${src.itag || src.mime}:${src.size}`;
}

function blockKey(src, idx) {
  return `${sourceKey(src)}:${idx}`;
}

/* Length of block idx for a file of `size` bytes. */
function blockLen(size, idx) {
  return Math.min(BLOCK, size - idx * BLOCK);
}

function get(src, idx) {
  const k = blockKey(src, idx);
  const b = map.get(k);
  if (!b) { stats.misses++; return null; }
  map.delete(k);
  map.set(k, b);
  stats.hits++;
  return b;
}

function has(src, idx) {
  return map.has(blockKey(src, idx));
}

function set(src, idx, buf) {
  if (!src.size || buf.length !== blockLen(src.size, idx)) return;
  const k = blockKey(src, idx);
  if (map.has(k)) return;
  map.set(k, buf);
  bytes += buf.length;
  stats.stored++;
  while (bytes > BUDGET && map.size) {
    const [oldK, oldB] = map.entries().next().value;
    map.delete(oldK);
    bytes -= oldB.length;
    stats.evicted++;
  }
}

function info() {
  return { blocks: map.size, mb: +(bytes / 1048576).toFixed(1), budgetMb: BUDGET / 1048576, ...stats };
}

function clear() {
  map.clear();
  bytes = 0;
}

module.exports = { BLOCK, blockLen, get, has, set, info, clear, sourceKey };
