const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function originServer(handler) {
  const s = http.createServer(handler);
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}` })));
}

async function relayApp() {
  // fresh module each time so the route list follows the env
  delete require.cache[require.resolve('../lib/playback/relay')];
  const { relay } = require('../lib/playback/relay');
  const app = express();
  app.get('/p', (req, res) => relay('/api/play/xTOKEN', req, res, '1.2.3.4'));
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}` })); });
}

test('relay passes media through with only media headers, and checks the key', async (t) => {
  let seen = null;
  const o = await originServer((req, res) => {
    seen = { key: req.headers['x-armusic-key'], range: req.headers.range, ip: req.headers['x-armusic-client-ip'], cookie: req.headers.cookie };
    res.writeHead(206, { 'X-ARMusic-Origin': '1', 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10', 'Set-Cookie': 'x=1', 'X-Secret': 'no' });
    res.end(Buffer.alloc(10, 7));
  });
  process.env.ARMUSIC_ORIGIN = o.url;
  process.env.ARMUSIC_ORIGIN_KEY = 'k1';
  const g = await relayApp();
  t.after(() => { o.s.close(); g.s.close(); });
  const r = await fetch(`${g.base}/p`, { headers: { Range: 'bytes=0-9', Cookie: 'session=abc' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-9/100');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('x-secret'), null);
  assert.equal(Buffer.from(await r.arrayBuffer()).length, 10);
  assert.deepEqual(seen, { key: 'k1', range: 'bytes=0-9', ip: '1.2.3.4', cookie: undefined });
});

test('a dead or refusing route falls through to the next one', async (t) => {
  const bad = await originServer((req, res) => { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('<html>challenge</html>'); });
  const good = await originServer((req, res) => { res.writeHead(206, { 'X-ARMusic-Origin': '1', 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-3/4', 'Content-Length': '4' }); res.end('abcd'); });
  process.env.ARMUSIC_ORIGIN = `http://127.0.0.1:1,${bad.url},${good.url}`;
  const g = await relayApp();
  t.after(() => { bad.s.close(); good.s.close(); g.s.close(); });
  const r = await fetch(`${g.base}/p`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), 'abcd');
});

test('an error from the origin itself is passed on as its code, not retried elsewhere', async (t) => {
  let other = 0;
  const o = await originServer((req, res) => { res.writeHead(502, { 'X-ARMusic-Origin': '1', 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'PLAYBACK_SOURCE_UNAVAILABLE', leak: 'https://x.googlevideo.com' })); });
  const o2 = await originServer((req, res) => { other++; res.writeHead(500); res.end(); });
  process.env.ARMUSIC_ORIGIN = `${o.url},${o2.url}`;
  const g = await relayApp();
  t.after(() => { o.s.close(); o2.s.close(); g.s.close(); });
  const r = await fetch(`${g.base}/p`);
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'PLAYBACK_SOURCE_UNAVAILABLE' });
  assert.equal(other, 0);
});

test('connections to the origin are reused', async (t) => {
  const sockets = new Set();
  const o = await originServer((req, res) => { sockets.add(req.socket); res.writeHead(206, { 'X-ARMusic-Origin': '1', 'Content-Range': 'bytes 0-0/1', 'Content-Length': '1' }); res.end('a'); });
  process.env.ARMUSIC_ORIGIN = o.url;
  const g = await relayApp();
  t.after(() => { o.s.closeAllConnections(); o.s.close(); g.s.close(); });
  for (let i = 0; i < 5; i++) await (await fetch(`${g.base}/p`)).text();
  assert.equal(sockets.size, 1, `${sockets.size} connections for 5 requests`);
});
