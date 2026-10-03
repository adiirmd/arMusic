const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange } = require('../lib/playback/range');
const { isValidTrackId } = require('../lib/playback/trackId');

test('no header means the whole file', () => {
  assert.deepEqual(parseRange(undefined, 100), { kind: 'none' });
  assert.deepEqual(parseRange('', 100), { kind: 'none' });
});

test('closed range', () => {
  assert.deepEqual(parseRange('bytes=0-999999', 3000000), { kind: 'range', start: 0, end: 999999, open: false });
});

test('closed range past the end is clamped', () => {
  assert.deepEqual(parseRange('bytes=10-500', 100), { kind: 'range', start: 10, end: 99, open: false });
});

test('open range is marked open', () => {
  assert.deepEqual(parseRange('bytes=50-', 100), { kind: 'range', start: 50, end: 99, open: true });
});

test('suffix range', () => {
  assert.deepEqual(parseRange('bytes=-10', 100), { kind: 'range', start: 90, end: 99, open: false });
  assert.deepEqual(parseRange('bytes=-1000', 100), { kind: 'range', start: 0, end: 99, open: false });
});

test('start past the end is unsatisfiable', () => {
  assert.equal(parseRange('bytes=100-', 100).kind, 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100).kind, 'unsatisfiable');
});

test('garbage is invalid', () => {
  for (const h of ['bytes=', 'bytes=-', 'items=0-1', 'bytes=5-1', 'bytes=0-1,4-5', 'bytes=a-b', 'bytes=1e3-2000', 'x'.repeat(100)]) {
    assert.equal(parseRange(h, 100).kind, 'invalid', h);
  }
});

test('track id validation', () => {
  assert.ok(isValidTrackId('dQw4w9WgXcQ'));
  assert.ok(isValidTrackId('BRPaF-O-3rE'));
  for (const bad of ['', 'short', 'dQw4w9WgXcQx', '../etc/pass', 'dQw4w9WgXc?', 'https://x.y', null, 12345678901]) {
    assert.equal(isValidTrackId(bad), false, String(bad));
  }
});
