const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ARMUSIC_SECRET = 'test-secret-for-ids';
const ids = require('../lib/ids');

const LEAK_RE = /videoId|browseId|playlistId|dQw4w9WgXcQ|MPREb_|UCZTJ|RDAMVM/;

test('ids round trip and are stable', () => {
  for (const raw of ['dQw4w9WgXcQ', 'MPREb_CYsLIfsMAsg', 'UCZTJAWkXqP_P10K2Hyf6WWw', 'RDAMVMdQw4w9WgXcQ', 'ggMPOg1uX1JOQWZFeDByc2Jm']) {
    const t = ids.sealId(raw);
    assert.match(t, /^x[A-Za-z0-9_-]+$/);
    assert.ok(!t.includes(raw));
    assert.equal(ids.openId(t), raw);
    assert.equal(ids.sealId(raw), t, 'same id, same token');
    assert.equal(ids.sealId(t), t, 'sealing a token again changes nothing');
  }
});

test('tampered or made up tokens are rejected', () => {
  const t = ids.sealId('dQw4w9WgXcQ');
  const bad = t.slice(0, 10) + (t[10] === 'A' ? 'B' : 'A') + t.slice(11);
  assert.equal(ids.openId(bad), null);
  assert.equal(ids.openId('x' + 'A'.repeat(30)), null);
  assert.equal(ids.openId('dQw4w9WgXcQ'), null);
  assert.equal(ids.fromClient('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'raw ids from old links pass through');
  assert.equal(ids.fromClient(t), 'dQw4w9WgXcQ');
});

test('response bodies are renamed and sealed', () => {
  const body = { queue: [{ videoId: 'dQw4w9WgXcQ', title: 'T', artists: [{ name: 'A', browseId: 'UCZTJAWkXqP_P10K2Hyf6WWw' }] }],
    lyricsBrowseId: 'MPLYt_abc', relatedBrowseId: 'MPTRt_abc', item: { browseType: 'album', browseId: 'MPREb_CYsLIfsMAsg', watchPlaylist: true, playlistId: 'RDAMVMdQw4w9WgXcQ' } };
  const out = ids.sealIdsDeep(body);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, LEAK_RE);
  assert.equal(ids.openId(out.queue[0].trackId), 'dQw4w9WgXcQ');
  assert.equal(ids.openId(out.queue[0].artists[0].pageId), 'UCZTJAWkXqP_P10K2Hyf6WWw');
  assert.equal(out.item.pageType, 'album');
  assert.equal(out.item.mixList, true);
  assert.ok(out.lyricsId && out.relatedId);
});

test('query strings are renamed and opened before routes see them', () => {
  const req = { query: { trackId: ids.sealId('dQw4w9WgXcQ'), pageId: ids.sealId('MPLYt_abc'), id: ids.sealId('MPREb_x'), q: 'hello' } };
  ids.openQuery(req, {}, () => {});
  assert.equal(req.query.videoId, 'dQw4w9WgXcQ');
  assert.equal(req.query.browseId, 'MPLYt_abc');
  assert.equal(req.query.id, 'MPREb_x');
  assert.equal(req.query.q, 'hello');
  assert.equal(req.query.trackId, undefined);
});
