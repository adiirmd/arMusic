const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ARMUSIC_SECRET = 'test-secret-for-images';
const images = require('../lib/images');

const UPSTREAM_RE = /youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com|ggpht\.com|googleusercontent\.com/i;

test('image URLs become opaque same-origin paths and round trip', () => {
  const src = 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg?sqp=xyz&rs=abc';
  const sealed = images.sealUrl(src);
  assert.ok(sealed.startsWith('/api/img/'));
  assert.doesNotMatch(sealed, UPSTREAM_RE);
  assert.equal(images.unseal(sealed.slice('/api/img/'.length)), src);
});

test('the same picture always gets the same path, so caching works', () => {
  const src = 'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj';
  assert.equal(images.sealUrl(src), images.sealUrl(src));
  assert.notEqual(images.sealUrl(src), images.sealUrl(src + 'x'));
});

test('a tampered token is refused', () => {
  const t = images.sealUrl('https://yt3.ggpht.com/abc=s120').slice('/api/img/'.length);
  const flipped = (t[30] === 'A' ? 'B' : 'A');
  assert.equal(images.unseal(t.slice(0, 30) + flipped + t.slice(31)), null);
  assert.equal(images.unseal('not-a-token'), null);
  assert.equal(images.unseal('../../../etc/passwd'), null);
});

test('non-image upstream links are dropped, other strings untouched', () => {
  assert.equal(images.sealUrl('https://www.youtube.com/watch?v=abcdefghijk'), '');
  assert.equal(images.sealUrl('https://rr1---sn-x.googlevideo.com/videoplayback?x=1'), '');
  assert.equal(images.sealUrl('https://music.youtube.com/playlist?list=PL1'), '');
  assert.equal(images.sealUrl('https://lrclib.net/api'), 'https://lrclib.net/api');
  assert.equal(images.sealUrl('Some song title about youtube'), 'Some song title about youtube');
});

test('sealDeep leaves no upstream host anywhere in a response body', () => {
  const body = {
    sections: [{ title: 'Top', items: [
      { title: 'A', thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', artists: [{ name: 'B', browseId: 'UC1' }] },
      { title: 'C', thumbnail: 'https://yt3.googleusercontent.com/zz=s576', link: 'https://www.youtube.com/watch?v=1' },
    ] }],
    header: { thumbnail: 'https://yt3.ggpht.com/ytc/zz=w120' },
    n: 3, ok: true, nil: null,
  };
  const out = images.sealDeep(body);
  assert.doesNotMatch(JSON.stringify(out), UPSTREAM_RE);
  assert.equal(out.n, 3);
  assert.equal(out.ok, true);
  assert.equal(out.nil, null);
  assert.equal(out.sections[0].items[0].artists[0].browseId, 'UC1');
});
