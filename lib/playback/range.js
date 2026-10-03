/* Range header handling for the playback gateway.
 *
 * Only a single byte range is accepted. Browsers never ask a media element for
 * more than one at a time, and multipart/byteranges would mean buffering and
 * re-framing the body, which is exactly what this gateway is built not to do. */

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/* Returns one of:
 *   { kind: 'none' }                      no Range header, whole file
 *   { kind: 'range', start, end }         satisfiable, end is inclusive
 *   { kind: 'unsatisfiable' }             valid syntax, outside the file
 *   { kind: 'invalid' }                   anything else
 *
 * An invalid header is answered with 416 rather than ignored, so a client
 * that sends garbage finds out instead of silently getting 200. */
function parseRange(header, size) {
  if (header == null || header === '') return { kind: 'none' };
  const raw = String(header).trim();
  if (raw.length > 64) return { kind: 'invalid' };
  const m = RANGE_RE.exec(raw.replace(/\s+/g, ''));
  if (!m) return { kind: 'invalid' };
  const [, a, b] = m;
  if (a === '' && b === '') return { kind: 'invalid' };
  if (!Number.isSafeInteger(size) || size <= 0) return { kind: 'unsatisfiable' };

  let start;
  let end;
  if (a === '') {
    // suffix form, the last N bytes
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Number(b);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: 'invalid' };
    if (b !== '' && end < start) return { kind: 'invalid' };
    if (start >= size) return { kind: 'unsatisfiable' };
    end = Math.min(end, size - 1);
  }
  // open means the client left the end to the server ("bytes=N-")
  return { kind: 'range', start, end, open: a !== '' && b === '' };
}

module.exports = { parseRange };
