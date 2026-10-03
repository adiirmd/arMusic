/* The gateway against a fake upstream on localhost.
 *
 * The fake serves a deterministic byte pattern, honours closed ranges only
 * (like the real media host), and can be told to cut a connection partway,
 * reject a range, or count how much it has written. streamTrack is driven
 * through a real Express app so headers and status codes are the real ones. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { streamTrack } = require('../lib/playback/stream');

const SIZE = 3 * 1024 * 1024 + 12345;
const byteAt = (i) => (i * 31 + 7) & 0xff;
function expected(start, end) {
  const b = Buffer.alloc(end - start + 1);
  for (let i = start; i <= end; i++) b[i - start] = byteAt(i);
  return b;
}

function fakeUpstream(opts = {}) {
  const stats = { requests: [], written: 0 };
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    stats.requests.push(req.headers.range || '(none)');
    if (opts.reject && opts.reject(stats.requests.length)) { res.writeHead(403); return res.end('denied'); }
    if (!m) { res.writeHead(403); return res.end('closed ranges only'); }
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), SIZE - 1);
    if (start >= SIZE) { res.writeHead(416); return res.end(); }
    res.writeHead(206, {
      'Content-Type': 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${SIZE}`,
      'Content-Length': String(end - start + 1),
      'X-Upstream-Secret': 'must-not-leak',
      'Set-Cookie': 'up=1',
    });
    let pos = start;
    const cutAt = opts.cutAfter && stats.requests.length === 1 ? start + opts.cutAfter : Infinity;
    const pump = () => {
      while (pos <= end) {
        if (pos >= cutAt) { res.destroy(); return; }
        const n = Math.min(64 * 1024, end - pos + 1, cutAt - pos);
        const chunk = expected(pos, pos + n - 1);
        pos += n;
        stats.written += n;
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
      res.end();
    };
    pump();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, stats, url: `http://127.0.0.1:${server.address().port}/media?expire=9999999999&sig=SECRET` });
  }));
}

function gateway(upstreamUrl, extra = {}) {
  const app = express();
  let resolves = 0;
  const resolve = async () => {
    resolves++;
    return { trackId: 'aaaaaaaaaaa', url: upstreamUrl, mime: 'audio/mp4', ext: 'm4a', size: SIZE, expiresAt: Date.now() + 1e6 };
  };
  app.get('/api/play/:id', (req, res) => streamTrack(req.params.id, req, res, { resolve, ...extra }));
  app.get('/api/download/:id', (req, res) => streamTrack(req.params.id, req, res, { resolve, download: 'My Song' }));
  return new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r({ server: s, base: `http://127.0.0.1:${s.address().port}`, resolves: () => resolves }));
  });
}

async function readAll(res) {
  const parts = [];
  for await (const c of res.body) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

test('Range 0-999999 answers 206 with exact headers and bytes', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=0-999999' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 0-999999/${SIZE}`);
  assert.equal(r.headers.get('content-length'), '1000000');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.equal(r.headers.get('content-type'), 'audio/mp4');
  assert.equal(r.headers.get('content-disposition'), 'inline');
  assert.equal(r.headers.get('x-upstream-secret'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  const body = await readAll(r);
  assert.ok(body.equals(expected(0, 999999)));
});

test('seek: a range in the middle maps to the same upstream range, not byte 0', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=2000000-2100000' } });
  assert.equal(r.status, 206);
  const body = await readAll(r);
  assert.ok(body.equals(expected(2000000, 2100000)));
  assert.deepEqual(up.stats.requests, ['bytes=2000000-2100000']);
});

test('open range from a media element is served as a bounded 206', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=100-' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 100-${SIZE - 1}/${SIZE}`);
  const body = await readAll(r);
  assert.ok(body.equals(expected(100, SIZE - 1)));
});

test('no Range header streams the whole file with 200 and a length', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-length'), String(SIZE));
  const body = await readAll(r);
  assert.equal(body.length, SIZE);
  assert.ok(body.equals(expected(0, SIZE - 1)));
});

test('first byte reaches the client before the upstream has finished', async (t) => {
  // Upstream that sends 64 KiB, then holds the connection for 1.5 s.
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    const start = Number(m[1]); const end = Number(m[2]);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${SIZE}`, 'Content-Length': String(end - start + 1) });
    res.write(expected(start, start + 65535));
    setTimeout(() => { res.end(expected(start + 65536, end)); }, 1500);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const gw = await gateway(`http://127.0.0.1:${server.address().port}/m`);
  t.after(() => { server.close(); gw.server.close(); });
  const t0 = Date.now();
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=0-199999' } });
  const reader = r.body.getReader();
  const first = await reader.read();
  const tFirst = Date.now() - t0;
  assert.ok(first.value.byteLength > 0);
  assert.ok(tFirst < 1000, `first chunk after ${tFirst} ms, should not wait for the whole range`);
  let n = first.value.byteLength;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; }
  assert.equal(n, 200000);
  assert.ok(Date.now() - t0 >= 1400, 'the rest arrived only when upstream sent it');
});

test('a connection cut mid stream is resumed from the exact byte', async (t) => {
  const up = await fakeUpstream({ cutAfter: 300000 });
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=1000-1999999' } });
  assert.equal(r.status, 206);
  const body = await readAll(r);
  assert.equal(body.length, 1999000);
  assert.ok(body.equals(expected(1000, 1999999)));
  assert.equal(up.stats.requests.length, 2);
  const resumed = /^bytes=(\d+)-/.exec(up.stats.requests[1]);
  assert.ok(Number(resumed[1]) > 1000, 'second request starts where the first stopped');
});

test('a dead source is a clean JSON error, with nothing upstream in it', async (t) => {
  const up = await fakeUpstream({ reject: () => true });
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=0-10' } });
  assert.equal(r.status, 502);
  const text = await r.text();
  assert.deepEqual(JSON.parse(text), { error: 'PLAYBACK_SOURCE_UNAVAILABLE' });
  assert.doesNotMatch(text, /127\.0\.0\.1|SECRET|denied|403/);
  assert.equal(gw.resolves(), 2, 'a 403 triggers exactly one fresh resolve');
});

test('a stale source is refreshed once and playback goes on', async (t) => {
  const up = await fakeUpstream({ reject: (n) => n === 1 });
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=0-4095' } });
  assert.equal(r.status, 206);
  assert.ok((await readAll(r)).equals(expected(0, 4095)));
});

test('bad ranges answer 416 with the size', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  for (const h of [`bytes=${SIZE}-`, 'bytes=9-1', 'bytes=0-1,5-6', 'pages=1-2']) {
    const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: h } });
    assert.equal(r.status, 416, h);
    assert.equal(r.headers.get('content-range'), `bytes */${SIZE}`);
    assert.deepEqual(await r.json(), { error: 'PLAYBACK_RANGE_ERROR' });
  }
  assert.equal(up.stats.requests.length, 0, 'nothing is fetched for a bad range');
});

test('download is an attachment with a safe filename', async (t) => {
  const up = await fakeUpstream();
  const gw = await gateway(up.url);
  t.after(() => { up.server.close(); gw.server.close(); });
  const r = await fetch(`${gw.base}/api/download/aaaaaaaaaaa`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="My Song\.m4a"/);
  assert.equal((await readAll(r)).length, SIZE);
});

test('backpressure: a client that stops reading stops the upstream reads', async (t) => {
  const big = 40 * 1024 * 1024;
  let written = 0; const reqs = [];
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    reqs.push(req.headers.range);
    const start = Number(m[1]); const end = Math.min(Number(m[2]), big - 1);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${big}`, 'Content-Length': String(end - start + 1) });
    let pos = start; const block = Buffer.alloc(64 * 1024, 1);
    const pump = () => {
      while (pos <= end) {
        const n = Math.min(block.length, end - pos + 1);
        pos += n; written += n;
        if (!res.write(n === block.length ? block : block.subarray(0, n))) { res.once('drain', pump); return; }
      }
      res.end();
    };
    pump();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const app = express();
  app.get('/p', (req, res) => streamTrack('aaaaaaaaaaa', req, res, {
    resolve: async () => ({ url: `http://127.0.0.1:${server.address().port}/m`, mime: 'audio/mp4', ext: 'm4a', size: big, expiresAt: Date.now() + 1e6 }),
  }));
  const gw = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { server.close(); gw.close(); });

  // A raw socket client that reads the headers and then nothing at all.
  const net = require('node:net');
  const sock = net.connect(gw.address().port, '127.0.0.1');
  t.after(() => sock.destroy());
  sock.write(`GET /p HTTP/1.1\r\nHost: x\r\nRange: bytes=0-${big - 1}\r\n\r\n`);
  await new Promise((r) => sock.once('data', r));
  sock.pause();
  await new Promise((r) => setTimeout(r, 1500));
  const stalledAt = written;
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(written, stalledAt, 'upstream writes stop while the client is not reading');
  assert.ok(written < 24 * 1024 * 1024, `only ${(written / 1048576).toFixed(1)} MiB pulled for a 40 MiB range`);
  assert.equal(reqs.length, 1, 'no further upstream piece is requested');
});

test('client disconnect cancels the upstream request', async (t) => {
  let closed = false;
  const server = http.createServer((req, res) => {
    res.writeHead(206, { 'Content-Range': `bytes 0-${SIZE - 1}/${SIZE}`, 'Content-Length': String(SIZE) });
    res.write(Buffer.alloc(1024));
    req.on('close', () => { closed = true; });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const gw = await gateway(`http://127.0.0.1:${server.address().port}/m`);
  t.after(() => { server.closeAllConnections(); server.close(); gw.server.close(); });
  const ac = new AbortController();
  const r = await fetch(`${gw.base}/api/play/aaaaaaaaaaa`, { headers: { Range: 'bytes=0-1000000' }, signal: ac.signal });
  const reader = r.body.getReader();
  await reader.read();
  ac.abort();
  await new Promise((res) => setTimeout(res, 500));
  assert.ok(closed, 'upstream connection closed after the client went away');
});
