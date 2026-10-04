const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ARMUSIC_SECRET = process.env.ARMUSIC_SECRET || 'test-secret-for-unit-tests';
const ids = require('../lib/ids');
const { createEdgeApp } = require('../lib/playback/edge');

function start() {
  const app = createEdgeApp();
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}` })); });
}

test('edge only takes sealed tokens and only its own paths', async (t) => {
  const g = await start();
  t.after(() => g.s.close());
  assert.equal((await fetch(`${g.base}/play/dQw4w9WgXcQ`)).status, 400, 'raw id refused');
  assert.equal((await fetch(`${g.base}/play/../../etc/passwd`)).status, 404);
  assert.equal((await fetch(`${g.base}/api/home`)).status, 404);
  assert.equal((await fetch(`${g.base}/proxy?url=https://example.com`)).status, 404);
  assert.equal((await fetch(`${g.base}/warm/nope`, { method: 'POST' })).status, 400);
  const h = await fetch(`${g.base}/health`);
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('access-control-allow-origin'), 'https://music.adiirmd.id');
});

test('edge answers the CORS preflight for the site alone', async (t) => {
  const g = await start();
  t.after(() => g.s.close());
  const r = await fetch(`${g.base}/play/${ids.sealId('dQw4w9WgXcQ')}`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://music.adiirmd.id');
});
