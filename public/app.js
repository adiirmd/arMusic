/* ============================================================
   AR Music — SPA frontend
   Streams via the official YouTube IFrame player, metadata via
   the local proxy to YouTube Music, synced lyrics via LRCLIB.
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

const api = async (path) => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function hueFrom(str) {
  let h = 0;
  const s = String(str || 'home');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  // keep every page tint inside the calm blue band (cyan -> indigo)
  return 190 + (Math.abs(h) % 55);
}
function applyTint(key) {
  document.documentElement.style.setProperty('--tint', hueFrom(key));
  const main = $('#main');
  if (main) main.style.setProperty('--tint', hueFrom(key));
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function updateThemeIcon() {
  const use = $('#theme-ic use');
  if (use) use.setAttribute('href', currentTheme() === 'light' ? '#i-moon' : '#i-sun');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', currentTheme() === 'light' ? '#e8eef7' : '#070c16');
}
/* ---------- language ----------
 *
 * Switching redraws instead of reloading. A reload would take the YouTube
 * frame down with it, and anyone who changes the language while a song is
 * playing would lose the song. So every place that holds wording is drawn
 * again by hand, and the player is left alone.
 */
function updateLangButton() {
  const el = $('#lang-code');
  if (el) el.textContent = I18N.LANG_LABEL[I18N.currentLang()] || 'EN';
}

function setLang(code) {
  if (!I18N.LANGS.includes(code) || code === I18N.currentLang()) return;
  localStorage.setItem(I18N.LANG_KEY, JSON.stringify(code));
  I18N.applyStaticText();
  updateLangButton();
  notifyNativeLanguage();
  closeModal();              // its contents were drawn in the old language
  renderNav();
  renderSidebarLibrary();
  renderNowPlaying();
  renderQueue();
  renderPlayButtons();
  updateLikeButtons();
  updateQualityButton();
  syncNpMore();
  syncFloatWidget();
  if (Player.current) setMediaMetadata(Player.current);
  route();                   // the page someone is looking at right now
}

function toggleLang() {
  setLang(I18N.currentLang() === 'en' ? 'id' : 'en');
}

/* The Android side shows a notification and the odd message of its own, and
   those should follow the same choice rather than the phone's language. */
function notifyNativeLanguage() {
  try {
    if (window.ARMusicNative && typeof ARMusicNative.setLanguage === 'function') {
      ARMusicNative.setLanguage(I18N.currentLang());
    }
  } catch {}
}

function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  store.set('theme', next);
  updateThemeIcon();
}
function openNowPlaying() {
  $('#nowplaying').classList.remove('hidden');
  document.body.classList.add('np-open');
  updatePanelButtons();
}
function closeNowPlaying() {
  Player.pending = null;
  $('#nowplaying').classList.add('hidden');
  document.body.classList.remove('np-open');
  renderNowPlaying();
  renderPlayButtons();
  updateLikeButtons();
  updatePanelButtons();
}
function isNPOpen() { return document.body.classList.contains('np-open'); }
function activeNPTab() { const t = $('.np-tab.active'); return t ? t.dataset.nptab : null; }
function updatePanelButtons() {
  const open = isNPOpen();
  const onQueue = open && activeNPTab() === 'queue';
  const o = $('#mini-open');
  if (o) {
    o.classList.toggle('on', open);
    o.title = open ? 'Hide now playing' : 'Now playing';
    o.setAttribute('aria-pressed', String(open));
  }
  // leave .title to updateQueueTab, which shows the queue count there
  const q = $('#mini-queue-m');
  if (q) {
    q.classList.toggle('on', onQueue);
    q.setAttribute('aria-pressed', String(onQueue));
  }
}
function focusedSong() { return Player.pending || Player.current; }
function isPreviewing() {
  return !!(Player.pending && (!Player.current || Player.pending.videoId !== Player.current.videoId));
}

/* An event log used to live here, along with a hidden page at #/log to read
   it on. It was there to trace background playback on devices that could not
   be tried directly, and it has done its job. All of it is gone, the page
   included.

   Whatever it left behind on the device is cleared out once on load, so no
   stale notes pile up on anyone's phone now that the feature itself is gone. */
try { localStorage.removeItem('armusic_diag'); } catch {}


/* ================= local library (localStorage) ================= */
const KEY = 'armusic_';
const OLD_KEY = 'smw_';
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(KEY + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(KEY + k, JSON.stringify(v)); },
};

/* Moves storage from the old prefix to the new one, once.
   The order is deliberate: copy first, check the copy matches exactly, and
   only then delete the old. If a single one does not match, the old is left
   exactly where it is. People's playlists and favorites live in here, so
   leaving a stale key behind beats losing what it holds. */
(function migrateStore() {
  try {
    const oldKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD_KEY)) oldKeys.push(k);
    }
    for (const k of oldKeys) {
      const baru = KEY + k.slice(OLD_KEY.length);
      // what is already under the new prefix wins; never write over it with the old
      if (localStorage.getItem(baru) === null) {
        localStorage.setItem(baru, localStorage.getItem(k));
      }
      // baru dihapus setelah salinannya benar-benar ada di tempat baru
      if (localStorage.getItem(baru) !== null) localStorage.removeItem(k);
    }
  } catch {}
})();
const Library = {
  get favorites() { return store.get('fav', []); },
  isFav(id) { return this.favorites.some((s) => s.videoId === id); },
  toggleFav(song) {
    let f = this.favorites;
    if (this.isFav(song.videoId)) { f = f.filter((s) => s.videoId !== song.videoId); toast(tr('toast.removedFavorites')); }
    else { f.unshift(song); toast(tr('toast.addedFavorites')); }
    store.set('fav', f);
    updateLikeButtons();
    renderSidebarLibrary();
  },
  get playlists() { return store.get('pls', []); },
  createPlaylist(name) {
    const pls = this.playlists;
    const pl = { id: 'local_' + Date.now(), name, tracks: [] };
    pls.unshift(pl); store.set('pls', pls); renderSidebarLibrary(); return pl;
  },
  addToPlaylist(pid, song) {
    const pls = this.playlists;
    const pl = pls.find((p) => p.id === pid);
    if (!pl) return;
    if (!pl.tracks.some((t) => t.videoId === song.videoId)) pl.tracks.push(song);
    store.set('pls', pls);
  },
  removeFromPlaylist(pid, vid) {
    const pls = this.playlists;
    const pl = pls.find((p) => p.id === pid);
    if (!pl) return;
    pl.tracks = pl.tracks.filter((t) => t.videoId !== vid);
    store.set('pls', pls);
  },
  deletePlaylist(pid) { store.set('pls', this.playlists.filter((p) => p.id !== pid)); renderSidebarLibrary(); },
  renamePlaylist(pid, name) {
    const n = String(name || '').trim();
    if (!n) return;
    const pls = this.playlists;
    const pl = pls.find((p) => p.id === pid);
    if (!pl) return;
    pl.name = n;
    store.set('pls', pls);
    renderSidebarLibrary();
  },
  moveInPlaylist(pid, from, dir) {
    const pls = this.playlists;
    const pl = pls.find((p) => p.id === pid);
    if (!pl) return false;
    const to = from + dir;
    if (to < 0 || to >= pl.tracks.length) return false;
    const [item] = pl.tracks.splice(from, 1);
    pl.tracks.splice(to, 0, item);
    store.set('pls', pls);
    return true;
  },
  get saved() { return store.get('sav', []); },
  isSaved(browseId) { return this.saved.some((s) => s.browseId === browseId); },
  toggleSaved(item) {
    let sv = this.saved;
    if (this.isSaved(item.browseId)) { sv = sv.filter((s) => s.browseId !== item.browseId); toast(tr('toast.removedLibrary')); }
    else { sv.unshift(item); toast(tr('toast.savedLibrary')); }
    store.set('sav', sv);
    renderSidebarLibrary();
  },
  get history() { return store.get('hist', []); },
  pushHistory(song) {
    let h = this.history.filter((s) => s.videoId !== song.videoId);
    h.unshift({ ...song, playedAt: Date.now() });
    store.set('hist', h.slice(0, 100));
    // play stats (local scrobble)
    const st = store.get('stats', {});
    const k = song.videoId;
    if (!st[k]) st[k] = { title: song.title, artist: song.artist || '', thumbnail: song.thumbnail, plays: 0, secs: 0, last: 0 };
    st[k].plays++; st[k].last = Date.now();
    st[k].title = song.title; st[k].thumbnail = song.thumbnail;
    store.set('stats', st);
  },
  get stats() { return store.get('stats', {}); },
  addListenTime(videoId, secs) {
    const st = store.get('stats', {});
    if (st[videoId]) { st[videoId].secs += secs; store.set('stats', st); }
  },
};

/* ================= player state ================= */
const Player = {
  yt: null,
  ready: false,
  queue: [],
  index: -1,
  shuffle: false,
  repeat: 0, // 0 none, 1 all, 2 one
  lyrics: { synced: null, plain: null, source: null, lines: [] },
  lyricsBrowseId: null,
  relatedBrowseId: null,
  sleepTimer: null,
  speed: 1,
  sbSegments: [],
  sbEnabled: store.get('sb_on', true),
  hq: store.get('yt_hq', false), // false = YouTube Music audio, true = YouTube max quality
  quality: 'hd720',
  cued: false,
  wantPlaying: false, // user intent, so a background pause can be told apart from a deliberate one
  pending: null, // song shown in Now Playing while previous track keeps playing
  loadId: 0,
  get current() { return this.queue[this.index] || null; },
};

/* Playback uses the official YouTube IFrame.
   Default: YouTube Music audio version (official audio / ATV) at hd720.
   Quality ON: YouTube max (1080p–4K) for the highest audio bitrate. */
const QUALITY_RANK = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
const qualityRank = (q) => { const i = QUALITY_RANK.indexOf(q); return i < 0 ? 99 : i; };
function bestQuality() {
  if (!Player.yt || !Player.ready || !Player.yt.getAvailableQualityLevels) return 'highres';
  const levels = Player.yt.getAvailableQualityLevels() || [];
  return QUALITY_RANK.find((q) => levels.includes(q)) || levels[0] || 'highres';
}
function suggestedQuality() { return Player.hq ? 'highres' : 'hd720'; }
function applyPlaybackQuality() {
  if (!Player.yt || !Player.ready) return;
  if (Player.hq) {
    const best = bestQuality();
    Player.quality = best;
    try { Player.yt.setSize(1920, 1080); } catch {}
    try { Player.yt.setPlaybackQuality(best); } catch {}
    try { Player.yt.setPlaybackQualityRange(best, best); } catch {}
  } else {
    Player.quality = 'hd720';
    try { Player.yt.setSize(720, 720); } catch {}
    try { Player.yt.setPlaybackQuality('hd720'); } catch {}
    try { Player.yt.setPlaybackQualityRange('hd720', 'hd720'); } catch {}
  }
}
function updateQualityButton() {
  const btn = $('#np-quality');
  if (!btn) return;
  btn.classList.toggle('on', !!Player.hq);
  const span = btn.querySelector('span');
  if (span) span.textContent = Player.hq ? 'Max' : 'Quality';
  btn.title = Player.hq
    ? 'YouTube max quality — tap for YouTube Music audio'
    : 'YouTube Music audio — tap for YouTube max quality';
  document.body.classList.toggle('hq-audio', !!Player.hq);
  syncNpMore();
}
function toggleQuality() {
  Player.hq = !Player.hq;
  store.set('yt_hq', Player.hq);
  updateQualityButton();
  toast(Player.hq ? 'YouTube max quality' : 'YouTube Music audio');
  if (Player.cued || !Player.yt || !Player.ready || !Player.current) {
    applyPlaybackQuality();
    return;
  }
  const t = PB.time();
  Player.yt.loadVideoById({
    videoId: Player.current.videoId,
    startSeconds: t,
    suggestedQuality: suggestedQuality(),
  });
  applyPlaybackQuality();
  setTimeout(applyPlaybackQuality, 400);
  setTimeout(applyPlaybackQuality, 1600);
}

const PB = {
  /* A thin wrapper over the YouTube player. It mirrors that player's shape,
     state numbers included, so the rest of the app only ever calls one place.
     There was briefly a second engine here, a media element of the page's own,
     chasing background playback. It was taken out; the reasons are written up
     near the bottom of this file. */
  state() {
    try { return Player.yt && Player.yt.getPlayerState ? Player.yt.getPlayerState() : -1; } catch { return -1; }
  },
  time() {
    try { return (Player.yt && Player.yt.getCurrentTime && Player.yt.getCurrentTime()) || 0; } catch { return 0; }
  },
  duration() {
    try { return (Player.yt && Player.yt.getDuration && Player.yt.getDuration()) || 0; } catch { return 0; }
  },
  seek(t) { try { Player.yt.seekTo(t, true); } catch {} },
  play() { try { Player.yt.playVideo(); } catch {} },
  pause() { try { Player.yt.pauseVideo(); } catch {} },
  volume(v) { try { Player.yt.setVolume(Math.max(0, Math.min(100, Number(v) || 0))); } catch {} },
  mute(on) { try { if (on) Player.yt.mute(); else Player.yt.unMute(); } catch {} },
  rate(r) { try { Player.yt.setPlaybackRate(r); } catch {} },
};

window.onYouTubeIframeAPIReady = () => {
  Player.yt = new YT.Player('yt-player', {
    height: '720', width: '720',
    host: 'https://www.youtube.com',
    playerVars: {
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      origin: location.origin,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      fs: 0,
      vq: 'hd720',
    },
    events: {
      onReady: () => {
        Player.ready = true;
        const v = store.get('vol', 100);
        PB.volume(Number(v));
        applyPlaybackQuality();
        try {
          const iframe = Player.yt.getIframe && Player.yt.getIframe();
          if (iframe) iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        } catch {}
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          try {
            const vid = Player.yt.getVideoData && Player.yt.getVideoData().video_id;
            if (vid && Player.current && vid !== Player.current.videoId) return;
          } catch {}
          nextTrack(true);
        }
        if (e.data === YT.PlayerState.PLAYING) {
          setTimeout(maybeRetryLyrics, 600);
          applyPlaybackQuality();
          setTimeout(applyPlaybackQuality, 500);
          setTimeout(applyPlaybackQuality, 2000);
        }
        if (e.data === YT.PlayerState.BUFFERING) applyPlaybackQuality();
        if (e.data === YT.PlayerState.PLAYING) {
          Player.wantPlaying = true;
          // after the YouTube frame has set up its own session, not before
          setTimeout(assertMediaSession, 900);
        }
        resumeIfBackgroundPause(e.data);
        syncMediaSession(e.data === YT.PlayerState.PLAYING);
        document.body.classList.toggle('paused', e.data !== YT.PlayerState.PLAYING);
        renderPlayButtons();
      },
      onPlaybackQualityChange: (e) => {
        if (!Player.hq) return;
        const best = bestQuality();
        if (e.data && qualityRank(e.data) > qualityRank(best)) applyPlaybackQuality();
      },
      onError: () => { toast(tr('toast.trackUnavailable')); setTimeout(() => nextTrack(true), 800); },
    },
  });
};
(() => { const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s); })();

function playSong(song, queue = null, index = null) {
  if (!song || !song.videoId) return;
  song = normalizeSong(song);
  Player.cued = false;
  Player.pending = null;
  if (queue) {
    Player.queue = queue.map((q) => ({ ...normalizeSong(q), _user: false }));
    let idx = index ?? queue.findIndex((q) => q.videoId === song.videoId);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    Player.index = idx;
  } else { Player.queue = [{ ...song, _user: false }]; Player.index = 0; }
  startCurrent();
  if (!queue || queue.length <= 1) fetchQueue(song); // build radio queue
}

function userQueueCount() {
  return Player.queue.filter((q, i) => i > Player.index && q._user).length;
}
function alreadyQueued(videoId) {
  return Player.queue.some((q, i) => i > Player.index && q._user && q.videoId === videoId);
}
function queueSong(song, playNext = false) {
  if (!song || !song.videoId) return;
  const s = { ...normalizeSong(song), _user: true };
  if (!Player.current) { playSong(s); return; }
  if (!playNext && alreadyQueued(song.videoId)) {
    toast(tr('toast.alreadyQueue'));
    renderQueue();
    return;
  }
  if (playNext) {
    Player.queue.splice(Player.index + 1, 0, s);
    toast(tr('toast.playingNext'));
  } else {
    let i = Player.index + 1;
    while (i < Player.queue.length && Player.queue[i]._user) i++;
    Player.queue.splice(i, 0, s);
    toast(tr('toast.addedQueue'));
  }
  renderQueue();
}
function removeQueued(i) {
  if (i === Player.index || i < 0 || i >= Player.queue.length) return;
  if (i < Player.index) Player.index--;
  Player.queue.splice(i, 1);
  renderQueue();
}
function clearUserQueue() {
  Player.queue = Player.queue.filter((q, i) => i <= Player.index || !q._user);
  renderQueue();
  toast(tr('toast.queueCleared'));
}
function slimSong(s) {
  if (!s || !s.videoId) return null;
  return {
    videoId: s.videoId,
    title: s.title || '',
    artist: s.artist || s.subtitle || '',
    thumbnail: s.thumbnail || '',
    duration: s.duration || '',
    playlistId: s.playlistId || '',
    _user: !!s._user,
  };
}
function persistQueue() {
  try {
    if (!Player.queue.length) {
      localStorage.removeItem(KEY + 'qstate');
      return;
    }
    const q = Player.queue.map(slimSong).filter(Boolean).slice(0, 80);
    store.set('qstate', {
      queue: q,
      index: Math.min(Math.max(0, Player.index), q.length - 1),
      shuffle: !!Player.shuffle,
      repeat: Player.repeat || 0,
      speed: Player.speed || 1,
    });
  } catch {}
}
function restoreQueue() {
  const st = store.get('qstate', null);
  if (!st || !Array.isArray(st.queue) || !st.queue.length) return false;
  Player.queue = st.queue.map((s) => ({ ...normalizeSong(s), _user: !!s._user }));
  Player.index = Math.min(Math.max(0, Number(st.index) || 0), Player.queue.length - 1);
  Player.shuffle = !!st.shuffle;
  resetShuffleBag();
  Player.repeat = (st.repeat === 1 || st.repeat === 2) ? st.repeat : 0;
  if (typeof st.speed === 'number' && st.speed > 0) Player.speed = st.speed;
  Player.cued = true;
  Player.pending = null;
  const s = Player.current;
  if (!s) return false;
  const loadId = ++Player.loadId;
  const tryCue = () => {
    if (loadId !== Player.loadId) return;
    if (!Player.ready) return setTimeout(tryCue, 300);
    try {
      Player.yt.cueVideoById({ videoId: s.videoId, suggestedQuality: suggestedQuality() });
      PB.rate(Player.speed);
    } catch {}
  };
  tryCue();
  setMediaMetadata(s);
  // 'paused' rather than left at 'none'. Without it the system decides there
  // is nothing to control, and the picture in picture window opens with no
  // play button on it at all
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; } catch {}
  renderNowPlaying();
  renderQueue();
  updateLikeButtons();
  renderPlayButtons();
  $('#miniplayer').classList.remove('hidden');
  document.body.classList.add('has-player', 'paused');
  document.title = `${s.title} • AR Music`;
  applyTint(s.videoId || s.title);
  const shOn = Player.shuffle;
  $('#mini-shuffle') && $('#mini-shuffle').classList.toggle('on', shOn);
  $('#np-shuffle') && $('#np-shuffle').classList.toggle('on', shOn);
  const on = Player.repeat > 0;
  const ic = icon(Player.repeat === 2 ? 'i-repeat-1' : 'i-repeat');
  [$('#mini-repeat'), $('#np-repeat')].forEach((b) => {
    if (!b) return;
    b.classList.toggle('on', on);
    b.innerHTML = ic;
  });
  const sp = $('#np-speed span');
  if (sp) sp.textContent = Player.speed + '×';
  return true;
}
function moveQueued(i, dir) {
  const to = i + dir;
  if (!Number.isFinite(i) || i <= Player.index || to <= Player.index) return;
  if (to >= Player.queue.length) return;
  if (!Player.queue[i] || !Player.queue[i]._user) return;
  if (!Player.queue[to] || !Player.queue[to]._user) return;
  const [item] = Player.queue.splice(i, 1);
  Player.queue.splice(to, 0, item);
  renderQueue();
}

function startCurrent() {
  Player.cued = false;
  Player.pending = null;
  const s = Player.current;
  if (!s) return;
  const loadId = ++Player.loadId;

  const tryPlay = () => {
    if (loadId !== Player.loadId) return;
    if (!Player.ready) return setTimeout(tryPlay, 300);
    Player.yt.loadVideoById({ videoId: s.videoId, suggestedQuality: suggestedQuality() });
    PB.rate(Player.speed);
    Player.wantPlaying = true;
    PB.play();
    applyPlaybackQuality();
    setTimeout(applyPlaybackQuality, 400);
    setTimeout(applyPlaybackQuality, 1600);
  };
  tryPlay();
  Library.pushHistory(s);
  maybeExtendQueue();
  Player.lyrics = { synced: null, plain: null, source: null, lines: [] };
  Player._lyricsRetried = false;
  Player._lyricsDur = 0;
  lastLyricIdx = -1;
  syncFloatLyric('');
  renderNowPlaying();
  renderQueue();
  updateLikeButtons();
  $('#miniplayer').classList.remove('hidden');
  document.body.classList.add('has-player');
  document.title = `${s.title} • AR Music`;
  applyTint(s.videoId || s.title);
  setMediaMetadata(s);
  loadLyrics(s);
  loadSponsorBlock(s.videoId);
  // refresh related tab lazily
  Player.relatedBrowseId = null; // stale — belongs to the previous song until fetchQueue returns
  Player.lyricsBrowseId = null;
  $('#related-list').innerHTML = `<div class="loading-note">${tr('misc.loading')}</div>`;
  Player._relatedLoaded = false;
  // if the Related tab is currently open, reload it right away for the new song
  // (small delay so fetchQueue for the new song has started first)
  if ($('#np-related').classList.contains('active') && !$('#nowplaying').classList.contains('hidden')) {
    setTimeout(() => loadRelated(true), 150);
  }
}

/* ---------- scoring the radio candidates ----------
 *
 * The order YouTube sends already carries a sense of what is similar, so what
 * happens here nudges rather than sorting from scratch. Every weighting based
 * on listening history is worked out on the device; nothing about what someone
 * listens to is sent to the server.
 */
function artistKeys(s) {
  const ids = ((s && s.artists) || []).map((a) => a && a.browseId).filter(Boolean);
  const names = String((s && s.artist) || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (s && s.artistBrowseId) ids.push(s.artistBrowseId);
  return { ids: new Set(ids), names: new Set(names) };
}

/* Berapa kali tiap artis diputar, dari statistik lokal. */
function artistPlayCounts() {
  const by = {};
  try {
    for (const v of Object.values(Library.stats)) {
      const a = String((v && v.artist) || '').split(',')[0].trim().toLowerCase();
      if (a) by[a] = (by[a] || 0) + ((v && v.plays) || 0);
    }
  } catch {}
  return by;
}

const RADIO_RUN_LIMIT = 3; // songs in a row from the same artist

/* Spreads an already sorted list so no more than RADIO_RUN_LIMIT songs in a
   row come from the same artist. Without this, the weight given to the same
   artist makes the radio feel like one album on repeat. */
function spreadArtists(list) {
  const out = [];
  const tunda = [];
  let last = '';
  let run = 0;
  const nama = (c) => [...artistKeys(c).names][0] || '';
  for (const c of list) {
    const a = nama(c);
    if (a && a === last && run >= RADIO_RUN_LIMIT) { tunda.push(c); continue; }
    out.push(c);
    if (a && a === last) run++; else { last = a; run = 1; }
    // once the artist changes, whatever was held back can come in again
    for (let i = 0; i < tunda.length; i++) {
      const t = tunda[i];
      const ta = nama(t);
      if (ta === last && run >= RADIO_RUN_LIMIT) continue;
      tunda.splice(i, 1);
      out.push(t);
      if (ta && ta === last) run++; else { last = ta; run = 1; }
      break;
    }
  }
  return out.concat(tunda);
}

function rankRadio(list, seed, existing) {
  const s = artistKeys(seed);
  const fav = artistPlayCounts();
  let recent = new Set();
  try { recent = new Set(Library.history.slice(0, 30).map((h) => h.videoId)); } catch {}
  const seen = new Set((existing || []).map((q) => q && q.videoId).filter(Boolean));
  const perArtist = {};

  const dinilai = (list || [])
    .filter((c) => c && c.videoId && !seen.has(c.videoId))
    .map((c, i) => {
      const k = artistKeys(c);
      const first = [...k.names][0] || '';
      let score = 100 - i; // dasarnya tetap urutan YouTube
      if ([...k.ids].some((id) => s.ids.has(id))) score += 120;
      else if ([...k.names].some((n) => s.names.has(n))) score += 90;
      if (first && fav[first]) score += Math.min(30, fav[first] * 3);
      if (recent.has(c.videoId)) score -= 150;
      const n = (perArtist[first] = (perArtist[first] || 0) + 1);
      if (n > 4) score -= 60;
      return { c, score, i };
    })
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((x) => ({ ...normalizeSong(x.c), artist: x.c.artist, artists: x.c.artists, _user: false }));

  return spreadArtists(dinilai);
}

/* Extends a queue that is running low, without taking it apart.
 *
 * Unlike fetchQueue, which rebuilds the whole thing and resets Player.index,
 * this only adds to the end. It covers two cases at once: a radio that has run
 * through its batch, and an album or playlist that has run out of songs while
 * playback should carry on with something in the same vein. */
async function extendQueue(seed) {
  if (!seed || !seed.videoId || Player._extending) return;
  Player._extending = true;
  const loadId = Player.loadId;
  try {
    const d = await api(`/api/next?videoId=${encodeURIComponent(seed.videoId)}`);
    if (loadId !== Player.loadId) return; // pendengar sudah pindah lagu sendiri
    const tambahan = rankRadio(d.queue, seed, Player.queue);
    if (!tambahan.length) return;
    Player.queue = Player.queue.concat(tambahan);
    persistQueue();
    renderQueue();
  } catch (e) { console.warn('extend queue fail', e); }
  finally { Player._extending = false; }
}

/* Called on every change of song. Extends early rather than waiting for the
   last one to finish, so nothing stalls at the hand over. */
function maybeExtendQueue() {
  if (Player.cued || Player.repeat === 1) return;
  const sisa = Player.queue.length - 1 - Player.index;
  if (sisa > 3) return;
  const seed = Player.queue[Player.queue.length - 1] || Player.current;
  extendQueue(seed);
}

async function fetchQueue(song) {
  const vid = song && song.videoId;
  const loadId = Player.loadId;
  Player._queueFetching = true;
  try {
    // The song's playlistId is deliberately left out. A song that came from
    // an album, a playlist or a chart carries the id of where it came from,
    // and sending that makes the server use that playlist instead of the
    // radio. What fills the queue is then the rest of that playlist, which on
    // a mixed one drifts a long way from the genre. Without a playlistId the
    // server falls back to RDAMVM<videoId>, the YouTube Music radio for that
    // song. Playing an album on purpose does not come through here.
    const d = await api(`/api/next?videoId=${encodeURIComponent(song.videoId)}`);
    if (Player.cued || loadId !== Player.loadId) return;
    if (!vid || !Player.current || Player.current.videoId !== vid) return;
    Player.lyricsBrowseId = d.lyricsBrowseId;
    Player.relatedBrowseId = d.relatedBrowseId;
    if (d.queue && d.queue.length > 1) {
      const current = Player.current;
      const userUpcoming = Player.queue.filter((q, i) => i > Player.index && q._user);
      const radio = rankRadio(d.queue, current, [current, ...userUpcoming]);
      Player.queue = [current, ...userUpcoming, ...radio].filter(Boolean);
      Player.index = 0;
      renderQueue();
    }
    if (!Player.lyrics.synced && !Player.lyrics.plain) loadLyrics(Player.current, { silent: true });
  } catch (e) { console.warn('queue fail', e); }
  finally {
    if (loadId === Player.loadId) Player._queueFetching = false;
  }
}

/* ---------- shuffle ----------
 *
 * The next song used to be drawn evenly from the whole queue, songs already
 * played included, with no memory of what had come up. One song could turn up
 * again and again while another never got a turn. Now it works like a shuffled
 * deck: every song comes out once before any of them repeats.
 */
function resetShuffleBag() {
  Player.shuffleBag = null;
  Player.shuffleBagFor = -1;
}

function takeFromShuffleBag() {
  const n = Player.queue.length;
  if (!n) return -1;
  // The queue changes in a dozen places, so the deck checks itself. Safer than
  // trusting every caller to remember to reshuffle, and it means songs that
  // have just arrived get their turn too.
  if (Player.shuffleBagFor !== n) resetShuffleBag();
  // Deliberately checks only for "never built", not for "empty". A spent deck
  // is left empty so playback can come to a stop when repeat is off; the only
  // thing that refills it is repeat all, through resetShuffleBag.
  if (!Array.isArray(Player.shuffleBag)) {
    const idx = [];
    for (let i = 0; i < n; i++) if (i !== Player.index) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) {           // Fisher Yates
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    Player.shuffleBag = idx;
    Player.shuffleBagFor = n;
  }
  // drop positions that no longer hold, say because the queue got shorter
  while (Player.shuffleBag.length) {
    const i = Player.shuffleBag.shift();
    if (i < Player.queue.length && i !== Player.index) return i;
  }
  return -1;
}

function nextTrack(auto) {
  if (Player.cued) {
    if (auto) return;
    togglePlay();
    return;
  }
  if (Player.repeat === 2 && auto) { PB.seek(0); Player.wantPlaying = true; PB.play(); return; }
  if (!Player.queue.length) return;
  let ni;
  if (Player.shuffle) {
    // songs the listener queued keep their place at the front, in order
    const userNext = Player.queue.findIndex((q, i) => i > Player.index && q._user);
    if (userNext >= 0) ni = userNext;
    else {
      ni = takeFromShuffleBag();
      if (ni < 0) {
        // every song has had its turn
        if (Player.repeat === 1) { resetShuffleBag(); ni = takeFromShuffleBag(); }
        if (ni < 0) return;
      }
    }
  } else ni = Player.index + 1;
  if (ni >= Player.queue.length) {
    if (Player.repeat === 1) ni = 0;
    else return;
  }
  Player.index = ni;
  startCurrent();
}
function prevTrack() {
  if (Player.cued) { togglePlay(); return; }
  if (PB.time() > 4) { PB.seek(0); return; }
  if (Player.index > 0) { Player.index--; startCurrent(); }
  else if (Player.yt) PB.seek(0);
}
function seekRelative(delta) {
  if (!Player.yt || !Player.ready) return;
  try {
    const cur = PB.time() || 0;
    const dur = PB.duration() || 0;
    PB.seek(Math.max(0, dur ? Math.min(dur - 1, cur + delta) : cur + delta), true);
  } catch {}
}
/* When wrapped in the Android app, tell the native side whether audio is
   running so it can keep a media foreground service alive. Harmless in a
   plain browser, where the bridge simply is not there. */
let _lastNativeState = null;
function notifyNativePlayback(playing) {
  const s = Player.current || {};
  const key = `${playing}|${s.videoId || ''}`;
  if (_lastNativeState === key) return;
  _lastNativeState = key;
  try {
    const br = window.ARMusicNative;
    if (br && typeof br.setPlaying === 'function') {
      let dur = 0;
      try { dur = Math.round(PB.duration()); } catch {}
      br.setPlaying(!!playing, String(s.title || ''), String(s.artist || ''),
        String(s.thumbnail || ''), dur);
    }
  } catch {}
}

/* ---- hooks the Android shell calls into ---- */
/* Back should close whatever is layered on top before leaving the app. */
window.ARMusicCloseOverlay = function () {
  const modal = $('#modal');
  if (modal && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); return true; }
  if (isNPOpen()) { closeNowPlaying(); return true; }
  return false;
};
/* Transport buttons on the notification land here. */
/* Pauses plainly, not through togglePlay. While a song is still loading,
   getPlayerState has not reported PLAYING yet, and togglePlay would read that
   as "stopped" and start it instead. */
function commandPause() {
  if (Player.cued || !Player.yt || !Player.ready) return;
  Player.wantPlaying = false;
  try { PB.pause(); } catch {}
}

/* Commands from the notification and the media session in the Android app.
   'play' and 'pause' say what they want, so a command that arrives when things
   are already that way does nothing. 'toggle' is still accepted for older
   builds of the app that keep sending it. */
window.ARMusicCommand = function (cmd) {
  try {
    if (cmd === 'play') { if (!isPlayingNow()) togglePlay(); }
    else if (cmd === 'pause') commandPause();
    else if (cmd === 'toggle') togglePlay();
    else if (cmd === 'next') nextTrack(false);
    else if (cmd === 'prev') prevTrack();
  } catch {}
};
/* Title, artist and artwork for the system notification, the lock screen and
   the picture in picture window. Called when a queue is restored too, so the
   system already knows the song before anyone presses play. */
function setMediaMetadata(s) {
  if (!s || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title || '', artist: s.artist || s.subtitle || '',
      artwork: s.thumbnail ? [{ src: s.thumbnail, sizes: '544x544' }] : [],
    });
  } catch {}
}

/* The button handlers go on once when the page loads, not every time a song
   plays. They used to be set inside playSong, so until something had actually
   been played the system had no buttons to show, and the picture in picture
   window came up without a play button on it.
   Play and pause go through togglePlay rather than straight to the player,
   because a song that has just been restored is not loaded yet and only
   togglePlay knows how to start it. */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const on = (a, fn) => {
    try {
      navigator.mediaSession.setActionHandler(a, fn);
    } catch {}
  };
  on('previoustrack', prevTrack);
  on('nexttrack', () => nextTrack(false));
  on('play', () => { if (!isPlayingNow()) togglePlay(); });
  on('pause', () => commandPause());
  on('stop', () => commandPause());
  // without these the lock screen shows no scrubber and no skip buttons
  on('seekbackward', (d) => seekRelative(-(d && d.seekOffset ? d.seekOffset : 10)));
  on('seekforward', (d) => seekRelative(d && d.seekOffset ? d.seekOffset : 10));
  on('seekto', (d) => {
    if (!Player.yt || !d || d.fastSeek === true) return;
    try { PB.seek(d.seekTime, true); } catch {}
  });
}
function isPlayingNow() {
  if (Player.cued || !Player.yt || !Player.ready) return false;
  try { return PB.state() === YT.PlayerState.PLAYING; } catch { return false; }
}

/* ---------- taking the notification back ----------
 *
 * The notification was showing up with the right title and artwork, but its
 * buttons never reached this code. The giveaway was the icon on it: a pause
 * icon, meaning the system thought something was running, while we had already
 * set the state to paused. So what the system was reading was not this page's
 * media session.
 *
 * The reason is that one page can hold more than one media session. This page
 * has its own, and the YouTube frame inside it sets up another. Chrome passes
 * the buttons to only one of them, whichever registered its handlers and
 * metadata most recently. Ours go on once when the page loads, long before
 * anything is played, while the YouTube frame sets its own up exactly when
 * playback starts. So ours is always the older one, and the buttons went to
 * the player inside the frame, which is the very thing that is not allowed to
 * make a sound.
 *
 * So the handlers and metadata are set again at the two moments that decide
 * it: shortly after a song is really running, and right as the tab is left.
 * The second is the important one, because it is the last chance to be the
 * most recent before anyone reaches for the notification.
 */
function assertMediaSession() {
  if (!('mediaSession' in navigator)) return;
  setupMediaSession();
  if (Player.current) setMediaMetadata(Player.current);
  try {
    navigator.mediaSession.playbackState = isPlayingNow() ? 'playing' : 'paused';
  } catch {}
}

/* ---------- holding a media session, tried and taken out again ----------
 *
 * This existed once and was removed on purpose. The note stays so nobody runs
 * the same experiment again, myself included.
 *
 * It made sense at the time. On a phone in normal mode nothing appeared in the
 * notification bar at all, and the reason was plain: Chrome only raises a media
 * notification for media actually running in this page, while the only thing
 * making a sound sits inside the YouTube frame, which belongs to another
 * origin. Once that frame goes quiet there is nothing left to attach a
 * notification to. MediaSession metadata does not help, because metadata only
 * fills a notification that already exists rather than bringing one into being.
 *
 * So this page briefly held media of its own, thirty seconds of silence played
 * on a loop, so the notification would be raised in this page's name and
 * survive the YouTube frame stopping.
 *
 * That part worked, and the result is exactly what closed the question. The
 * notification appeared with the right title, artist and artwork, and once the
 * handlers were set again (see assertMediaSession) its buttons did reach this
 * code: pressing next really did change the song, visible in the title on the
 * notification changing with it. But there was still no sound. That is the
 * decisive test, because a press on a notification carries the user's own
 * interaction, which no automatic attempt has. Even a request to play with
 * that behind it was refused.
 *
 * The conclusion: the YouTube frame refuses to make a sound while its page is
 * left, and that refusal cannot be argued with from the page's side.
 *
 * What was left behind was worse than silence. The notification lit up as if
 * music were playing when there was none, pressing pause changed nothing on it
 * because what counted as running was that loop of silence, and pressing next
 * quietly rearranged someone's queue with nothing to hear. A notification that
 * lies is more misleading than no notification at all, so it came out.
 *
 * The one piece kept from the experiment is assertMediaSession, because on
 * devices where the notification does appear on its own, setting the handlers
 * again is still what sends the buttons here.
 */

/* Keep the OS notification and lock screen honest about what is playing. */
function syncMediaSession(playing) {
  notifyNativePlayback(playing);
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  try {
    const dur = PB.duration();
    const cur = PB.time();
    if (dur > 0 && cur >= 0 && cur <= dur && navigator.mediaSession.setPositionState) {
      navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(cur, dur), playbackRate: Player.speed || 1 });
    }
  } catch {}
}
function togglePlay() {
  if (!Player.current) return;
  if (Player.cued) {
    const s = Player.current;
    const hasRadio = Player.queue.some((q, i) => i > Player.index && !q._user);
    startCurrent();
    if (!hasRadio) fetchQueue(s);
    return;
  }
  if (!Player.yt || !Player.ready) return;
  const st = PB.state();
  if (st === YT.PlayerState.PLAYING) { Player.wantPlaying = false; PB.pause(); }
  else { Player.wantPlaying = true; PB.play(); }
}
function playPendingSong() {
  const s = Player.pending;
  if (!s || !s.videoId) return togglePlay();
  Player.pending = null;
  const userUpcoming = Player.queue.filter((q, i) => i > Player.index && q._user);
  Player.queue = [{ ...normalizeSong(s), _user: false }, ...userUpcoming];
  Player.index = 0;
  startCurrent();
  fetchQueue(s);
}
function toggleNowPlayingPlay() {
  if (isPreviewing()) {
    playPendingSong();
    return;
  }
  togglePlay();
}

/* progress loop */
let _lastTick = null;
function syncPlaybackUI() {
  if (!Player.yt || !Player.ready || !Player.current || !Player.yt.getDuration) return;
  const cur = PB.time() || 0;
  // local scrobble: accumulate listen time while playing
  const playing = PB.state() === YT.PlayerState.PLAYING;
  const now = Date.now();
  if (playing && _lastTick) Library.addListenTime(Player.current.videoId, Math.min(2, (now - _lastTick) / 1000));
  _lastTick = now;
  // SponsorBlock auto-skip
  if (playing && Player.sbEnabled && Player.sbSegments.length) {
    const seg = Player.sbSegments.find((g) => cur >= g.start && cur < g.end - 0.3);
    if (seg) {
      PB.seek(seg.end, true);
      toast(tr('toast.sbSkipped', { what: seg.category.replace('_', ' ') }));
    }
  }
  const dur = PB.duration() || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  $('#mini-progress-fill').style.width = pct + '%';
  const knob = $('.pb-knob');
  if (knob) knob.style.left = pct + '%';
  $('#mini-cur').textContent = fmtTime(cur);
  $('#mini-dur').textContent = fmtTime(dur);
  if (!isPreviewing() && !seekDragging) {
    $('#np-range').value = dur ? Math.round((cur / dur) * 1000) : 0;
    $('#np-cur').textContent = fmtTime(cur);
    $('#np-dur').textContent = fmtTime(dur);
  }
  if (!isPreviewing()) updateLyricHighlight(cur);
  syncFloatProgress(pct);
  if (Player.floatOn) { drawPipFrame(pct); syncPipVideo(playing); }
  syncMediaSession(playing);
}
setInterval(syncPlaybackUI, 400);

function renderPlayButtons() {
  const actuallyPlaying = Player.ready && PB.state() === YT.PlayerState.PLAYING;
  const preview = isPreviewing();
  $('#mini-play').innerHTML = icon(actuallyPlaying ? 'i-pause' : 'i-play');
  $('#np-play').innerHTML = icon(!preview && actuallyPlaying ? 'i-pause' : 'i-play');
  const pn = $('#np-playnext');
  const qa = $('#np-queueadd');
  if (pn) pn.classList.toggle('hidden', !preview);
  if (qa) qa.classList.toggle('hidden', !preview);
  syncFloatWidget();
}

/* ================= SponsorBlock / votes / speed / video ================= */
async function loadSponsorBlock(videoId) {
  Player.sbSegments = [];
  try {
    const d = await api(`/api/sponsorblock?videoId=${encodeURIComponent(videoId)}`);
    Player.sbSegments = d.segments || [];
    if (Player.sbSegments.length && Player.sbEnabled) toast(tr('toast.sbSegments', { n: Player.sbSegments.length }));
  } catch {}
}
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
function cycleSpeed() {
  const i = SPEEDS.indexOf(Player.speed);
  Player.speed = SPEEDS[(i + 1) % SPEEDS.length];
  if (Player.yt && Player.ready) PB.rate(Player.speed);
  $('#np-speed span').textContent = Player.speed + '×';
  persistQueue();
  toast(tr('toast.speed', { n: Player.speed }));
}
function toggleSB() {
  Player.sbEnabled = !Player.sbEnabled;
  store.set('sb_on', Player.sbEnabled);
  $('#np-sb').classList.toggle('on', Player.sbEnabled);
  syncNpMore();
  toast(tr(Player.sbEnabled ? 'toast.sbOn' : 'toast.sbOff'));
}

/* ================= lyrics ================= */
let lyricsReqId = 0; // guard against out-of-order responses on fast skips
async function loadLyrics(song, { silent = false } = {}) {
  if (!song) return;
  const myReq = ++lyricsReqId;
  const durationSec = (() => {
    if (Player.ready) return Math.round(PB.duration());
    return 0;
  })();
  Player._lyricsDur = durationSec;
  const artist = [song.artist, song.artists && song.artists[0] && song.artists[0].name, song.subtitle]
    .map((x) => String(x || '').split('•')[0].replace(/\s*-\s*topic$/i, '').trim())
    .find((x) => x && !looksLikePlays(x)) || '';
  const title = displayTitle(song.title) || song.title;
  if (!silent && !Player.lyrics.synced && !Player.lyrics.plain) {
    $('#lyrics-container').innerHTML = `<div class="lyrics-empty">${tr('lyrics.looking')}</div>`;
  }
  try {
    const d = await api(`/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${durationSec}&browseId=${encodeURIComponent(Player.lyricsBrowseId || '')}`);
    if (myReq !== lyricsReqId) return; // a newer request superseded us
    // never downgrade: keep existing synced lyrics if the retry found less
    if (Player.lyrics.synced && !d.synced) return;
    Player.lyrics = { ...d, lines: d.synced ? parseLRC(d.synced) : [] };
  } catch {
    if (myReq !== lyricsReqId) return;
    if (!Player.lyrics.synced && !Player.lyrics.plain) Player.lyrics = { synced: null, plain: null, source: null, lines: [] };
  }
  renderLyrics();
}
/* retry once the real duration is known (player loaded after first attempt),
   or when the first attempt found nothing */
function maybeRetryLyrics() {
  const s = Player.current;
  if (!s || !Player.yt || !Player.ready || !Player.yt.getDuration) return;
  const dur = Math.round(PB.duration() || 0);
  if (!dur) return;
  const noLyrics = !Player.lyrics.synced && !Player.lyrics.plain;
  const durChanged = Math.abs(dur - (Player._lyricsDur || 0)) > 2;
  if ((noLyrics || (durChanged && !Player.lyrics.synced)) && !Player._lyricsRetried) {
    Player._lyricsRetried = true;
    loadLyrics(s, { silent: true });
  }
}
function parseLRC(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split('\n')) {
    const m = raw.match(/\[(\d+):(\d+)(?:[.:](\d+))?\](.*)/);
    if (!m) continue;
    const frac = m[3] ? Number(`0.${m[3]}`) : 0;
    lines.push({ t: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, text: (m[4] || '').trim() });
  }
  return lines.sort((a, b) => a.t - b.t);
}
/* LRCLIB times a specific release. When YouTube Music serves a different
   master, remix or upload, every line lands early or late by a fixed amount.
   A per-song shift lets that be nudged; effective cue = line.t + shift. */
function lyricShift() {
  const id = Player.current && Player.current.videoId;
  if (!id) return 0;
  return Number(store.get('lyrshift', {})[id]) || 0;
}
function bumpLyricShift(delta) {
  const id = Player.current && Player.current.videoId;
  if (!id) return;
  const m = store.get('lyrshift', {});
  const next = Math.max(-10, Math.min(10, (Number(m[id]) || 0) + delta));
  if (!next) delete m[id]; else m[id] = Number(next.toFixed(1));
  const keys = Object.keys(m);
  if (keys.length > 100) delete m[keys[0]]; // keep the map bounded
  store.set('lyrshift', m);
  lastLyricIdx = -2; // force the highlighter to repaint
  renderLyricSource();
  let cur = 0;
  try { cur = PB.time(); } catch {}
  updateLyricHighlight(cur);
  toast(next ? `Lyrics shifted ${next > 0 ? '+' : ''}${next.toFixed(1)}s` : 'Lyrics sync reset');
}
function renderLyricSource() {
  const src = $('#lyrics-source');
  if (!src) return;
  const L = Player.lyrics;
  const sh = lyricShift();
  const base = L && L.source ? `Lyrics provided by ${L.source}` : '';
  src.textContent = sh ? `${base}${base ? ' · ' : ''}${sh > 0 ? '+' : ''}${sh.toFixed(1)}s` : base;
}
function renderLyrics() {
  const c = $('#lyrics-container');
  const L = Player.lyrics;
  if (L.lines.length) {
    c.innerHTML = L.lines.map((l, i) => `<div class="lyric-line" data-i="${i}" data-t="${l.t}">${esc(l.text) || '♪'}</div>`).join('');
    $$('.lyric-line', c).forEach((el) => el.addEventListener('click', () => {
      PB.seek(Math.max(0, parseFloat(el.dataset.t) + lyricShift()));
      Player.wantPlaying = true;
      PB.play();
    }));
  } else if (L.plain) {
    c.innerHTML = `<div class="lyric-plain">${esc(L.plain)}</div>`;
  } else {
    c.innerHTML = `<div class="lyrics-empty">${tr('lyrics.notFound')}<br><br>
      <button class="pill-btn" id="lyrics-retry">${icon('i-repeat')}<span>${tr('empty.retry')}</span></button></div>`;
    const rb = $('#lyrics-retry', c);
    if (rb) rb.addEventListener('click', () => {
      Player._lyricsRetried = false;
      loadLyrics(Player.current);
    });
  }
  renderLyricSource();
  lastLyricIdx = -1;
  if (L.lines.length) {
    $('#np-lyric-preview').textContent = '';
    syncFloatLyric('');
  } else if (L.plain) {
    const first = String(L.plain).split('\n').map((x) => x.trim()).find(Boolean) || '';
    $('#np-lyric-preview').textContent = first;
    syncFloatLyric(first);
  } else {
    $('#np-lyric-preview').textContent = '';
    syncFloatLyric('');
  }
}
/* Centre the active line by scrolling ONLY the lyrics box.
   scrollIntoView() walks up and scrolls every scrollable ancestor, and
   #nowplaying is one of them: overflow:hidden still scrolls from script.
   That pushed the panel header out of view and it never came back. */
function centerLyric(container, line) {
  if (!container || !line) return;
  const cRect = container.getBoundingClientRect();
  const lRect = line.getBoundingClientRect();
  const top = container.scrollTop + (lRect.top - cRect.top) - (container.clientHeight - lRect.height) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  keepPanelAnchored();
}
/* Safety net: the panel itself must never sit scrolled. */
function keepPanelAnchored() {
  const np = $('#nowplaying');
  if (np && np.scrollTop) np.scrollTop = 0;
  const inner = $('#nowplaying .np-inner');
  if (inner && inner.scrollTop) inner.scrollTop = 0;
}
let lastLyricIdx = -1;
function updateLyricHighlight(cur) {
  const L = Player.lyrics;
  if (!L.lines.length) return;
  let idx = -1;
  const sh = lyricShift();
  for (let i = 0; i < L.lines.length; i++) { if (cur >= L.lines[i].t + sh - 0.2) idx = i; else break; }
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;
  const c = $('#lyrics-container');
  $$('.lyric-line', c).forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('past', i < idx);
  });
  const active = c.querySelector('.lyric-line.active');
  if (active && $('#np-lyrics').classList.contains('active')) centerLyric(c, active);
  const line = idx >= 0 ? L.lines[idx].text : '';
  $('#np-lyric-preview').textContent = line;
  syncFloatLyric(line);
}

/* The artist line acts as a link only when there is somewhere to go: the
   artist's browseId, or at least a name to search for. The role is set along
   with it, so anything that looks clickable can be reached with a keyboard and
   not only with a mouse. */
function setArtistLink(el, on) {
  if (!el) return;
  el.classList.toggle('linkish', on);
  if (on) {
    el.setAttribute('role', 'link');
    el.tabIndex = 0;
  } else {
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }
}

/* ================= now playing UI ================= */
function renderNowPlaying() {
  const mini = Player.current;
  const np = Player.pending || Player.current;
  if (mini) {
    $('#mini-art').src = mini.thumbnail || '';
    const mt = $('#mini-title');
    const ma = $('#mini-artist');
    const title = displayTitle(mini.title) || mini.title || '';
    mt.textContent = title;
    mt.title = title;
    const artist = mini.artist || mini.subtitle || '';
    ma.textContent = artist;
    ma.title = artist;
    setArtistLink(ma, !!(songArtistBrowseId(mini) || artist.trim()));
  }
  if (!np) return;
  $('#np-art').src = safeCover(np.thumbnail) || COVER_PH;
  $('#np-title').textContent = np.title;
  const artEl = $('#np-artist');
  artEl.textContent = np.artist || np.subtitle || '';
  setArtistLink(artEl, !!(songArtistBrowseId(np) || (np.artist || '').trim()));
  $('#np-bg').style.backgroundImage = np.thumbnail ? `url("${np.thumbnail}")` : 'none';
  syncFloatWidget();
}
function updateLikeButtons() {
  const mini = Player.current;
  const np = Player.pending || Player.current;
  const miniLiked = mini && Library.isFav(mini.videoId);
  const npLiked = np && Library.isFav(np.videoId);
  $('#mini-like').innerHTML = icon(miniLiked ? 'i-heart-f' : 'i-heart-o');
  $('#mini-like').classList.toggle('liked', !!miniLiked);
  $('#np-like').innerHTML = icon(npLiked ? 'i-heart-f' : 'i-heart-o') + `<span>${npLiked ? 'Favorited' : 'Favorite'}</span>`;
  $('#np-like').classList.toggle('liked', !!npLiked);
  renderSidebarLibrary();
}
function updateQueueTab() {
  const n = userQueueCount();
  $$('.np-tab').forEach((t) => {
    if (t.dataset.nptab !== 'queue') return;
    const ic = t.querySelector('svg');
    t.innerHTML = (ic ? ic.outerHTML : icon('i-queue')) + `<span>${n ? tr('tab.queueCount', { n }) : tr('tab.queue')}</span>`;
  });
  const q = $('#mini-queue-m');
  if (q) {
    q.classList.toggle('has-q', n > 0);
    q.title = n ? tr('tab.queueCount', { n }) : tr('tab.queue');
  }
}
function renderQueue() {
  updateQueueTab();
  persistQueue();
  const el = $('#queue-list');
  if (!el) return;
  if (!Player.queue.length) {
    el.innerHTML = `<div class="q-empty">
      <div class="q-empty-title">${tr('queue.empty')}</div>
      <div class="q-empty-s">Tap the queue icon on any song to add it here. Songs you add play before radio.</div>
    </div>`;
    persistQueue();
    return;
  }
  const upcoming = [];
  Player.queue.forEach((q, i) => { if (i > Player.index) upcoming.push({ q, i }); });
  const user = upcoming.filter((x) => x.q._user);
  const radio = upcoming.filter((x) => !x.q._user);
  const now = Player.current;
  let html = '';
  html += `<div class="q-note">Your queue plays first. Radio fills in after.</div>`;
  if (now) {
    html += `<div class="q-head">${tr('queue.nowHead')}</div>${trackRowHTML({ ...now, qi: Player.index }, true)}`;
  }
  if (user.length) {
    html += `<div class="q-head q-head-row"><span>${tr('queue.yourQueueCount', { n: user.length })}</span><button type="button" class="q-clear" id="q-clear">${tr('misc.clear')}</button></div>`;
    html += user.map(({ q, i }, n) => {
      const up = n === 0 ? ' disabled' : '';
      const dn = n === user.length - 1 ? ' disabled' : '';
      return trackRowHTML({ ...q, qi: i, qn: n + 1 }, false,
        `<button class="tbtn btn-qup" data-qi="${i}" title="${tr('misc.moveUp')}"${up}>${icon('i-chev-up')}</button>` +
        `<button class="tbtn btn-qdn" data-qi="${i}" title="${tr('misc.moveDown')}"${dn}>${icon('i-chev-down')}</button>` +
        `<button class="tbtn btn-qrm" data-qi="${i}" title="${tr('misc.removeQueue')}">${icon('i-x')}</button>`);
    }).join('');
  } else {
    html += `<div class="q-head">${tr('queue.title')}</div><div class="q-hint">${tr('queue.hint')}</div>`;
  }
  if (radio.length) {
    html += `<div class="q-head">From radio · ${radio.length}</div>`;
    html += radio.map(({ q, i }) => trackRowHTML({ ...q, qi: i, qRadio: true }, false)).join('');
  }
  el.innerHTML = html;
  $$('.track', el).forEach((row) => {
    let it;
    try { it = JSON.parse(row.dataset.item); } catch { return; }
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tbtn')) return;
      const idx = Number(row.dataset.qi);
      if (Number.isFinite(idx) && idx >= 0) { Player.index = idx; startCurrent(); }
    });
    const favBtn = $('.btn-fav', row);
    if (favBtn) favBtn.addEventListener('click', (e) => { e.stopPropagation(); Library.toggleFav(songFromItem(it)); favBtn.innerHTML = icon(Library.isFav(it.videoId) ? 'i-heart-f' : 'i-heart-o'); });
    const addBtn = $('.btn-addpl', row);
    if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddToPlaylist(songFromItem(it)); });
    const qBtn = $('.btn-queue', row);
    if (qBtn) qBtn.addEventListener('click', (e) => { e.stopPropagation(); queueSong(songFromItem(it)); });
    const dlBtn = $('.btn-dl', row);
    if (dlBtn) dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadSong(songFromItem(it)); });
    const moreBtn = $('.btn-more', row);
    if (moreBtn) moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const qi = Number(row.dataset.qi);
      openSongMenu(songFromItem(it), { qi: Number.isFinite(qi) ? qi : undefined });
    });
  });
  $$('.btn-qrm', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeQueued(Number(b.dataset.qi)); }));
  $$('.btn-qup', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); moveQueued(Number(b.dataset.qi), -1); }));
  $$('.btn-qdn', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); moveQueued(Number(b.dataset.qi), 1); }));
  if (window.matchMedia('(min-width: 861px)').matches) {
    $$('.track.q-user', el).forEach((row) => {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', row.dataset.qi);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(row.dataset.qi);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
        if (from <= Player.index || to <= Player.index) return;
        if (!Player.queue[from] || !Player.queue[from]._user || !Player.queue[to] || !Player.queue[to]._user) return;
        const [item] = Player.queue.splice(from, 1);
        Player.queue.splice(to, 0, item);
        renderQueue();
      });
    });
  }
  const clr = $('#q-clear', el);
  if (clr) clr.addEventListener('click', clearUserQueue);
  persistQueue();
}
async function loadRelated(force = false) {
  const el = $('#related-list');
  if (!el) return;
  const song = Player.current;
  if (!song) { el.innerHTML = `<div class="loading-note">${tr('toast.playFirst')}</div>`; return; }
  if (Player._relatedLoaded && !force) return;
  Player._relatedLoaded = true;
  el.innerHTML = `<div class="loading-note">${tr('misc.loading')}</div>`;

  const vid = song.videoId;
  const sameSong = () => Player.current && Player.current.videoId === vid;

  for (let i = 0; i < 16 && !Player.relatedBrowseId && sameSong(); i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (!Player._queueFetching && i >= 3 && !Player.relatedBrowseId) break;
  }
  if (!sameSong()) { Player._relatedLoaded = false; return; }

  const renderFail = () => {
    Player._relatedLoaded = false;
    el.innerHTML = `<div class="loading-note">${tr('empty.relatedFailed')}<br><br>
      <button class="pill-btn" id="related-retry">${icon('i-repeat')}<span>${tr('empty.retry')}</span></button></div>`;
    const rb = $('#related-retry', el);
    if (rb) rb.addEventListener('click', () => loadRelated(true));
  };

  const paint = (html) => {
    if (!sameSong()) { Player._relatedLoaded = false; return false; }
    el.innerHTML = html;
    bindItems(el);
    return true;
  };

  if (Player.relatedBrowseId) {
    try {
      const d = await api(`/api/related?browseId=${encodeURIComponent(Player.relatedBrowseId)}`);
      if (d.sections && d.sections.length) {
        paint(relatedSectionsHTML(d.sections));
        return;
      }
    } catch {}
  }
  if (!sameSong()) { Player._relatedLoaded = false; return; }

  try {
    const d = await api(`/api/next?videoId=${encodeURIComponent(vid)}`);
    if (!sameSong()) { Player._relatedLoaded = false; return; }
    if (d.relatedBrowseId) Player.relatedBrowseId = d.relatedBrowseId;
    if (Player.relatedBrowseId) {
      try {
        const rel = await api(`/api/related?browseId=${encodeURIComponent(Player.relatedBrowseId)}`);
        if (rel.sections && rel.sections.length) {
          paint(relatedSectionsHTML(rel.sections));
          return;
        }
      } catch {}
    }
    const items = (d.queue || [])
      .filter((q) => q.videoId && q.videoId !== vid)
      .slice(0, 25)
      .map((q) => ({ type: 'song', videoId: q.videoId, title: q.title, subtitle: q.artist, thumbnail: q.thumbnail, duration: q.duration, artists: q.artists }));
    if (items.length) {
      paint(shelfHTML({ title: 'Similar songs', items, list: true }));
      return;
    }
  } catch {}
  if (sameSong()) renderFail();
}

/* ================= download (via converter service, direct save) ================= */
const activeDownloads = new Set();
function downloadFilename(song) {
  const t = displayTitle(song && song.title) || 'track';
  const a = String((song && song.artist) || '').split(',')[0].trim();
  const raw = (a ? `${a} - ${t}` : t).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${raw.slice(0, 80) || 'track'}.mp3`;
}
function clickDownload(href, name) {
  /* Inside the Android app, hand it to the Android side. A WebView downloads
     nothing by itself, and without this route the download button really does
     nothing at all. The filename goes along with it so what gets saved is named
     after the song rather than whatever the converter called it. */
  try {
    if (window.ARMusicNative && typeof ARMusicNative.download === 'function') {
      ARMusicNative.download(String(href), String(name || ''));
      return;
    }
  } catch {}

  const aEl = document.createElement('a');
  aEl.href = href;
  aEl.download = name || '';
  /* Deliberately without target _blank. Opening a new window asks for
     permission that has already run out: the conversion takes a good fifteen
     seconds, and after a wait like that this click no longer counts as coming
     from a person's touch, so a phone browser blocks it as a popup. That is
     why downloads on a phone stopped with no word once the conversion
     finished. The file itself is served as an attachment, so this page does
     not go wandering off anywhere. */
  aEl.rel = 'noopener noreferrer';
  document.body.appendChild(aEl);
  aEl.click();
  aEl.remove();
}
async function downloadSong(song) {
  if (!song || !song.videoId) return;
  if (activeDownloads.has(song.videoId)) { toast(tr('toast.alreadyDownloading')); return; }
  activeDownloads.add(song.videoId);
  toast(tr('toast.preparing', { title: song.title }));
  try {
    const st = await api(`/api/download-start?videoId=${encodeURIComponent(song.videoId)}`);
    if (!st.progressUrl) throw new Error('no progress url');
    let url = null;
    let lastProg = -1;
    for (let i = 0; i < 60; i++) {
      if (i) await new Promise((r) => setTimeout(r, 2500));
      try {
        const p = await api(`/api/download-progress?progressUrl=${encodeURIComponent(st.progressUrl)}`);
        if (p.done && p.url) { url = p.url; break; }
        const raw = Number(p.progress) || 0;
        const pct = Math.min(99, raw > 100 ? Math.round(raw / 10) : Math.round(raw));
        if (pct !== lastProg) {
          lastProg = pct;
          toast(tr('toast.converting', { title: song.title, pct }));
        }
      } catch {}
    }
    if (!url) throw new Error('timeout');
    toast(tr('toast.downloading', { title: song.title }));
    const name = downloadFilename(song);
    /* The file used to be fetched whole first so it could be saved under the
       right name. The converter's server refuses cross origin requests, so that
       step never once succeeded and always fell through to the path below.
       Straight there now, without a request already known to fail. */
    clickDownload(url, name);
    toast(tr('toast.downloadStarted'));
  } catch (e) {
    toast(tr('toast.downloadFailed'));
  } finally {
    activeDownloads.delete(song.videoId);
  }
}

/* ================= rendering helpers ================= */
function looksLikePlays(s) {
  return /pemutaran|plays|ditonton|views|x ditonton/i.test(String(s || ''));
}
function normalizeDuration(s) {
  const t = String(s || '').trim();
  if (/^\d{1,2}(\.\d{2}){1,2}$/.test(t)) return t.replace(/\./g, ':');
  return t;
}
function displayTitle(t) {
  const raw = String(t || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/\s*[\(\[]\s*official\s*(hd\s*)?(4k\s*)?(music\s*)?(lyric(s)?\s*)?(audio|video|visualizer|mv)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*(official\s*)?(hd\s*)?(music\s*)?(lyric(s)?\s*)?(audio|video|visualizer|mv)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*(official\s*)?(4k|hd|hq|8d(?:\s*audio)?|1080p|720p)\s*[\)\]]/gi, '')
    .replace(/\s*-\s*(official|lyric(s)?|audio|video|visualizer|topic).*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw;
}
function normalizeSong(s) {
  if (!s) return s;
  return { ...s, title: displayTitle(s.title) };
}
function songFromItem(it) {
  const artists = it.artists || [];
  const artistBrowseId = it.artistBrowseId || (artists[0] && artists[0].browseId) || '';
  const fromArr = artists.map((a) => a.name).filter(Boolean).join(', ');
  const artist = fromArr || it.artist || (looksLikePlays(it.subtitle) ? '' : (it.subtitle || ''));
  return normalizeSong({
    videoId: it.videoId, title: it.title,
    artist,
    artistBrowseId,
    thumbnail: it.thumbnail, duration: normalizeDuration(it.duration), playlistId: it.playlistId,
  });
}
const COVER_PH = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#242424"/><path fill="#6a6a6a" d="M32 24v26.6a7 7 0 1 0 4 6.4V32h14V24H32z"/></svg>'
);
function safeCover(src) {
  const u = String(src || '').trim();
  if (!u || u === 'undefined' || u === 'null' || u === 'about:blank') return '';
  return u;
}
function coverHTML(src, kind = '') {
  const u = safeCover(src);
  if (!u) return `<div class="art-ph${kind ? ' art-ph-' + kind : ''}">${icon('i-note')}</div>`;
  return `<img loading="lazy" src="${esc(u)}" alt="">`;
}
function cardHTML(it) {
  const cls = it.type === 'artist' ? 'card artist' : 'card';
  return `<div class="${cls}" data-item='${esc(JSON.stringify(it))}'>
    <div class="art">${coverHTML(it.thumbnail)}<div class="play-ov">${icon('i-play')}</div></div>
    <div class="t">${esc(it.title)}</div><div class="s">${esc(it.subtitle || '')}</div>
  </div>`;
}
function trackRowHTML(it, playing = false, extraBtn = '') {
  const qi = it.qi != null ? ` data-qi="${it.qi}"` : '';
  const pl = it.plId ? ` data-pl="${esc(it.plId)}" data-pi="${it.plIndex}"` : '';
  const qn = it.qn ? `<span class="q-num">${it.qn}</span>` : '';
  const tn = it.tn != null ? `<span class="t-num">${it.tn}</span>` : '';
  const cls = `track${playing ? ' playing' : ''}${it.qRadio ? ' q-radio' : ''}${it.qn ? ' q-user' : ''}${it.plId ? ' pl-track' : ''}`;
  return `<div class="${cls}"${qi}${pl} data-item='${esc(JSON.stringify(it))}'>
    <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    ${tn}${qn}
    ${coverHTML(it.thumbnail, 'track')}
    <div class="tmeta"><div class="tt">${esc(displayTitle(it.title))}</div><div class="ts">${esc(it.artist || it.subtitle || '')}</div></div>
    <span class="tdur">${it.duration ? esc(it.duration) : '<span class="tdur-none">–</span>'}</span>
    <button class="tbtn btn-fav" title="${tr('player.favorite')}">${icon(Library.isFav(it.videoId) ? 'i-heart-f' : 'i-heart-o')}</button>
    <button class="tbtn btn-queue" title="${tr('player.addToQueue')}">${icon('i-queue')}</button>
    <button class="tbtn btn-addpl" title="${tr('modal.addToPlaylist')}">${icon('i-plus')}</button>
    <button class="tbtn btn-dl" title="${tr('player.download')}">${icon('i-download')}</button>
    <button class="tbtn btn-more" title="${tr('player.more')}">${icon('i-more')}</button>
    ${extraBtn}
  </div>`;
}
function trackHeadHTML() {
  return `<div class="track-head" aria-hidden="true"><span class="th-n">#</span><span class="th-t">${tr('col.title')}</span><span class="th-d">${tr('col.time')}</span></div>`;
}
function quickCardHTML(it) {
  return `<button class="quick-card" data-item='${esc(JSON.stringify(it))}'>
    ${coverHTML(it.thumbnail, 'quick')}
    <span class="qc-t">${esc(it.title)}</span>
    <span class="play-ov">${icon('i-play')}</span>
  </button>`;
}
function carouselHTML(inner) {
  return `<div class="carousel-wrap">
    <button type="button" class="car-btn car-prev" aria-label="${tr('misc.scrollLeft')}">${icon('i-back')}</button>
    <div class="carousel">${inner}</div>
    <button type="button" class="car-btn car-next" aria-label="${tr('misc.scrollRight')}">${icon('i-fwd')}</button>
  </div>`;
}
function emptyHTML(title, sub, opts = {}) {
  const ic = opts.ic || 'i-note';
  const cta = opts.label
    ? `<button type="button" class="pill-btn primary empty-cta"${opts.go ? ` data-go="${esc(opts.go)}"` : ''}${opts.act ? ` data-act="${esc(opts.act)}"` : ''}>${opts.label}</button>`
    : '';
  return `<div class="empty-block">
    <div class="empty-ic">${icon(ic)}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-s">${sub}</div>
    ${cta}
  </div>`;
}
function likedCardHTML() {
  const n = Library.favorites.length;
  return `<div class="card liked-card" data-nav="#/library/favorites">
    <div class="art liked-cover">${icon('i-heart-f', 'ic liked-heart')}<div class="play-ov">${icon('i-play')}</div></div>
    <div class="t">${tr('nav.likedSongs')}</div>
    <div class="s">${n} song${n === 1 ? '' : 's'}</div>
  </div>`;
}
function shelfHTML(sec) {
  if (sec.list) {
    return `<div class="shelf"><div class="shelf-title">${esc(sec.title)}</div>
      <div class="track-list">${sec.items.map((i) => (i.videoId ? trackRowHTML(i) : cardHTML(i))).join('')}</div></div>`;
  }
  return `<div class="shelf"><div class="shelf-title">${esc(sec.title)}</div>
    ${carouselHTML(sec.items.map(cardHTML).join(''))}</div>`;
}
function bindCarousels(root) {
  $$('.carousel-wrap', root).forEach((wrap) => {
    const sc = $('.carousel', wrap);
    const prev = $('.car-prev', wrap);
    const next = $('.car-next', wrap);
    if (!sc || !prev || !next) return;
    const step = () => Math.max(200, Math.floor(sc.clientWidth * 0.82));
    const sync = () => {
      const max = sc.scrollWidth - sc.clientWidth - 6;
      prev.classList.toggle('off', sc.scrollLeft <= 6);
      next.classList.toggle('off', sc.scrollLeft >= max);
    };
    prev.addEventListener('click', (e) => { e.stopPropagation(); sc.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', (e) => { e.stopPropagation(); sc.scrollBy({ left: step(), behavior: 'smooth' }); });
    sc.addEventListener('scroll', sync, { passive: true });
    requestAnimationFrame(sync);
  });
}
function bindEmptyCtas(root) {
  $$('.empty-cta', root).forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.act === 'newpl') openCreatePlaylist();
      else if (b.dataset.act === 'reload') location.reload();
      else if (b.dataset.go) go(b.dataset.go);
    });
  });
}
function bindItems(root) {
  $$('.card, .quick-card, .sr-top', root).forEach((el) => {
    el.addEventListener('click', () => {
      try { openItem(JSON.parse(el.dataset.item)); } catch {}
    });
  });
  $$('.track', root).forEach((el) => {
    let it;
    try { it = JSON.parse(el.dataset.item); } catch { return; }
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tbtn')) return;
      if (it.browseId && (it.type === 'album' || it.type === 'playlist' || it.type === 'artist')) openItem(it);
      else if (it.videoId) openSongNowPlaying(songFromItem(it));
      else openItem(it);
    });
    const favBtn = $('.btn-fav', el);
    if (favBtn) favBtn.addEventListener('click', (e) => { e.stopPropagation(); Library.toggleFav(songFromItem(it)); favBtn.innerHTML = icon(Library.isFav(it.videoId) ? 'i-heart-f' : 'i-heart-o'); });
    const addBtn = $('.btn-addpl', el);
    if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddToPlaylist(songFromItem(it)); });
    const qBtn = $('.btn-queue', el);
    if (qBtn) qBtn.addEventListener('click', (e) => { e.stopPropagation(); queueSong(songFromItem(it)); });
    const dlBtn = $('.btn-dl', el);
    if (dlBtn) dlBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadSong(songFromItem(it)); });
    const moreBtn = $('.btn-more', el);
    if (moreBtn) moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSongMenu(songFromItem(it), {
        plId: it.plId || el.dataset.pl,
        plIndex: it.plIndex != null ? it.plIndex : (el.dataset.pi !== undefined && el.dataset.pi !== '' ? Number(el.dataset.pi) : undefined),
      });
    });
  });
  bindCarousels(root);
  bindEmptyCtas(root);
}
function openItem(it) {
  if (!it) return;
  const kind = it.browseType || it.type;
  const isPage = it.browseId && (kind === 'album' || kind === 'playlist' || kind === 'artist' || kind === 'browse');
  if (isPage) {
    closeNowPlaying();
    if (kind === 'artist') return go(`#/artist/${it.browseId}`);
    if (kind === 'album') return go(`#/album/${it.browseId}`);
    return go(`#/playlist/${it.browseId}${it.params ? '?params=' + encodeURIComponent(it.params) : ''}`);
  }
  if (it.watchPlaylist && it.playlistId) {
    closeNowPlaying();
    return go(`#/playlist/${String(it.playlistId).startsWith('VL') ? it.playlistId : 'VL' + it.playlistId}`);
  }
  if (it.videoId) return openSongNowPlaying(songFromItem(it));
  if (it.playlistId) {
    closeNowPlaying();
    return go(`#/playlist/${String(it.playlistId).startsWith('VL') ? it.playlistId : 'VL' + it.playlistId}`);
  }
}
function songDurLabel(s) {
  return (s && s.duration) ? String(s.duration) : '0:00';
}
function resetNpSeek(s) {
  const dur = songDurLabel(s);
  const range = $('#np-range'); if (range) range.value = 0;
  const nc = $('#np-cur'); if (nc) nc.textContent = '0:00';
  const nd = $('#np-dur'); if (nd) nd.textContent = dur;
  const lp = $('#np-lyric-preview'); if (lp) lp.textContent = '';
}
function openSongNowPlaying(song) {
  if (!song || !song.videoId) return;
  const same = Player.current && Player.current.videoId === song.videoId;
  if (!same) {
    // picking a track always switches playback to it; showing it in Now Playing
    // while the previous song kept playing read as the click being ignored
    playSong(song);
  } else {
    Player.pending = null;
    renderNowPlaying();
    updateLikeButtons();
    renderPlayButtons();
  }
  openNowPlaying();
  switchNPTab('player');
}

/* ================= router / views ================= */
const NAV = [
  { id: 'home', key: 'nav.home', icon: 'i-home-o', iconActive: 'i-home', hash: '#/home' },
  { id: 'search', key: 'nav.search', icon: 'i-search', iconActive: 'i-search', hash: '#/search' },
  { id: 'charts', key: 'nav.charts', icon: 'i-chart', iconActive: 'i-chart', hash: '#/charts' },
  { id: 'library', key: 'nav.library', icon: 'i-library', iconActive: 'i-library', hash: '#/library' },
];
function renderNav() {
  const html = NAV.map((n) => `<button class="nav-item" data-id="${n.id}" data-ic="${n.icon}" data-ica="${n.iconActive}" onclick="location.hash='${n.hash}'"><svg class="ic"><use href="#${n.icon}"/></svg><span>${tr(n.key)}</span></button>`).join('');
  // desktop sidebar: only Home + Search; library lives in its own section
  $('#nav-desktop').innerHTML = NAV.filter((n) => ['home', 'search', 'charts'].includes(n.id))
    .map((n) => `<button class="nav-item" data-id="${n.id}" data-ic="${n.icon}" data-ica="${n.iconActive}" onclick="location.hash='${n.hash}'"><svg class="ic"><use href="#${n.icon}"/></svg><span>${tr(n.key)}</span></button>`).join('');
  $('#nav-mobile').innerHTML = html;
  renderSidebarLibrary();
}
function setActiveNav(id) {
  // the Search page has its own search bar; the topbar one would be a duplicate
  document.body.classList.toggle('on-search', id === 'search');
  $$('.nav-item').forEach((el) => {
    const active = el.dataset.id === id;
    el.classList.toggle('active', active);
    const use = el.querySelector('use');
    if (use) use.setAttribute('href', '#' + (active ? el.dataset.ica : el.dataset.ic));
  });
}

/* ---- Your Library sidebar (left rail) ---- */
function renderSidebarLibrary() {
  const el = $('#lib-list');
  if (!el) return;
  const favs = Library.favorites;
  const pls = Library.playlists;
  const saved = Library.saved;
  let html = '';
  if (favs.length) {
    html += `<button class="lib-row" data-nav="#/library/favorites">
      <span class="lib-ph liked-ph">${icon('i-heart-f')}</span>
      <span class="lr-meta"><span class="lr-t">${tr('nav.likedSongs')}</span><br><span class="lr-s">${tr('player.playlist')} · ${tr('misc.songs', { n: favs.length })}</span></span>
    </button>`;
  }
  html += pls.map((p) => `<button class="lib-row" data-nav="#/localpl/${p.id}">
      ${coverHTML(p.tracks[0] && p.tracks[0].thumbnail, 'lib')}
      <span class="lr-meta"><span class="lr-t">${esc(p.name)}</span><br><span class="lr-s">Playlist · ${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}</span></span>
    </button>`).join('');
  html += saved.map((it) => `<button class="lib-row ${it.type === 'artist' ? 'round' : ''}" data-item='${esc(JSON.stringify(it))}'>
      ${coverHTML(it.thumbnail, 'lib')}
      <span class="lr-meta"><span class="lr-t">${esc(it.title)}</span><br><span class="lr-s">${it.type === 'artist' ? 'Artist' : it.type === 'album' ? 'Album' : 'Playlist'}</span></span>
    </button>`).join('');
  if (!html) html = `<div class="lib-empty"><b>${tr('empty.libraryEmpty')}</b><br>${tr('lib.emptyHint')}</div>`;
  el.innerHTML = html;
  $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
  $$('[data-item]', el).forEach((b) => b.addEventListener('click', () => {
    try { openItem(JSON.parse(b.dataset.item)); } catch {}
  }));
}
const go = (hash) => { location.hash = hash; };

async function route() {
  const hash = location.hash || '#/home';
  const [path, qs] = hash.slice(2).split('?');
  const parts = path.split('/');
  const view = $('#view');
  const params = new URLSearchParams(qs || '');
  window.scrollTo(0, 0);
  $('#main').scrollTop = 0;
  view.classList.remove('view-enter');
  void view.offsetWidth;
  applyTint(parts[0] || 'home');

  try {
    if (parts[0] === '' || parts[0] === 'home') { setActiveNav('home'); await viewHome(view); }
    else if (parts[0] === 'search') { setActiveNav('search'); await viewSearch(view, decodeURIComponent(parts[1] || ''), params.get('filter')); }
    else if (parts[0] === 'charts') { setActiveNav('charts'); await viewCharts(view); }
    else if (parts[0] === 'stats') { setActiveNav('library'); viewStats(view); }
    else if (parts[0] === 'moods') { setActiveNav('moods'); await viewMoods(view); }
    else if (parts[0] === 'library') { setActiveNav('library'); viewLibrary(view, parts[1] || 'playlists'); }
    else if (parts[0] === 'album' || parts[0] === 'playlist' || parts[0] === 'artist' || parts[0] === 'browse') {
      setActiveNav('');
      await viewBrowse(view, parts[1], parts[0], params.get('params'));
    }
    else if (parts[0] === 'localpl') { setActiveNav('library'); viewLocalPlaylist(view, parts[1]); }
    else if (parts[0] === 'song' && parts[1]) { setActiveNav('home'); await viewHome(view); openSharedSong(parts[1]); }
    else {
      view.innerHTML = emptyHTML(tr('empty.notFound'), tr('empty.notFound.sub'), { label: tr('empty.goHome'), go: '#/home', ic: 'i-search' });
      bindEmptyCtas(view);
    }
  } catch (e) {
    view.innerHTML = emptyHTML(tr('empty.failed'), esc(e.message || tr('empty.failed.sub')), { label: 'Retry', act: 'reload', ic: 'i-note' });
    bindEmptyCtas(view);
  }
  view.classList.add('view-enter');
}
window.addEventListener('hashchange', route);

const skeletonHTML = `<div class="page-title">&nbsp;</div>` + Array(3).fill(`
  <div class="shelf"><div class="skeleton" style="width:180px;height:22px;margin-bottom:12px"></div>
  <div class="carousel">${Array(6).fill('<div><div class="skeleton" style="width:160px;height:160px"></div></div>').join('')}</div></div>`).join('');

/* ---- Home ---- */
async function viewHome(view) {
  view.innerHTML = skeletonHTML;
  const now = new Date();
  const h = now.getHours();
  const greet = tr(h < 11 ? 'home.morning' : h < 16 ? 'home.afternoon' : 'home.evening');
  applyTint(greet);
  const d = await api('/api/home');
  const hist = Library.history.slice(0, 16);
  const favs = Library.favorites.slice(0, 12);
  const pls = Library.playlists.filter((p) => p.tracks && p.tracks.length);
  const saved = Library.saved.slice(0, 12);
  const dateLine = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  let html = `<div class="hello-row"><div><div class="greeting">${esc(dateLine)}</div><h1 class="page-title">${greet}</h1></div></div>`;
  if (hist.length) {
    html += `<div class="shelf-title">${tr('home.recentlyPlayed')}</div><div class="quick-grid">${hist.slice(0, 8).map((s) => quickCardHTML({ ...s, type: 'song', subtitle: s.artist })).join('')}</div>`;
  }
  html += `<div id="mix-slot"></div>`;
  if (hist.length > 8) {
    html += `<div class="shelf"><div class="shelf-title">${tr('home.jumpBackIn')}</div>${carouselHTML(hist
      .slice(8).map((s) => cardHTML({ ...s, type: 'song', subtitle: s.artist })).join(''))}</div>`;
  }
  if (favs.length) {
    html += `<div class="shelf"><div class="shelf-title">${tr('lib.liked')}</div>
      ${carouselHTML(favs.map((s) => cardHTML({ ...s, type: 'song', subtitle: s.artist })).join(''))}</div>`;
  }
  if (pls.length) {
    html += `<div class="shelf"><div class="shelf-title">${tr('nav.yourPlaylists')}</div>
      ${carouselHTML(pls.map((p) => `<div class="card" data-pl="${esc(p.id)}">
        <div class="art">${coverHTML(p.tracks[0] && p.tracks[0].thumbnail)}<div class="play-ov">${icon('i-play')}</div></div>
        <div class="t">${esc(p.name)}</div><div class="s">${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}</div>
      </div>`).join(''))}</div>`;
  }
  if (saved.length) {
    html += `<div class="shelf"><div class="shelf-title">${tr('lib.saved')}</div>
      ${carouselHTML(saved.map(cardHTML).join(''))}</div>`;
  }
  html += d.sections.map(shelfHTML).join('');
  view.innerHTML = html;
  bindItems(view);
  $$('[data-pl]', view).forEach((el) => el.addEventListener('click', () => go(`#/localpl/${el.dataset.pl}`)));
  loadMixForYou();
}

/* "Mix for you" — personalized-feel shelf built from your listening history (no account needed) */
async function loadMixForYou() {
  const hist = Library.history;
  const seeds = [...Library.favorites, ...hist].filter((s) => s.videoId);
  if (!seeds.length) return;
  const slot = $('#mix-slot');
  if (!slot) return;
  try {
    const seed = seeds[Math.floor(Math.random() * Math.min(5, seeds.length))];
    const d = await api(`/api/next?videoId=${encodeURIComponent(seed.videoId)}`);
    const items = (d.queue || []).slice(1, 13).map((q) => ({
      type: 'song', videoId: q.videoId, title: q.title, subtitle: q.artist, thumbnail: q.thumbnail,
    }));
    if (!items.length) return;
    slot.innerHTML = shelfHTML({ title: `Mix for you · based on “${seed.title}”`, items });
    bindItems(slot);
  } catch {}
}

/* ---- Search ---- */
const SEARCH_TYPE_LABEL = { song: 'Songs', video: 'Videos', album: 'Albums', artist: 'Artists', playlist: 'Playlists', browse: 'More' };
function pushRecentSearch(q) {
  q = String(q || '').trim();
  if (!q) return;
  const list = [q, ...store.get('srec', []).filter((x) => String(x).toLowerCase() !== q.toLowerCase())].slice(0, 8);
  store.set('srec', list);
}
function removeRecentSearch(q) {
  store.set('srec', store.get('srec', []).filter((x) => x !== q));
}
function isSearchCard(it) {
  const t = it.type || it.browseType;
  return t === 'album' || t === 'playlist' || t === 'artist' || t === 'browse' || (!!it.browseId && !it.videoId);
}
function moodCardHTML(c, i) {
  const raw = String(c.color || '').trim();
  const color = /^#?[0-9a-fA-F]{3,8}$/.test(raw) ? (raw[0] === '#' ? raw : '#' + raw) : MOOD_COLORS[i % MOOD_COLORS.length];
  return `<button type="button" class="mood-card" style="--mc:${esc(color)}" data-b="${esc(c.browseId)}" data-p="${esc(c.params || '')}">${esc(c.title)}</button>`;
}
function bindMoods(root) {
  $$('.mood-card', root).forEach((el) => el.addEventListener('click', () => {
    go(`#/browse/${el.dataset.b}${el.dataset.p ? '?params=' + encodeURIComponent(el.dataset.p) : ''}`);
  }));
}
function topResultHTML(it) {
  const kind = it.type === 'artist' ? 'artist' : '';
  const cta = it.videoId ? 'Play' : 'Open';
  const ic = it.videoId ? 'i-play' : (it.type === 'artist' ? 'i-search' : 'i-fwd');
  return `<button type="button" class="sr-top ${kind}" data-item='${esc(JSON.stringify(it))}'>
    ${coverHTML(it.thumbnail, 'sr')}
    <div class="sr-meta">
      <div class="sr-kicker">${tr('search.topResult')}</div>
      <div class="sr-title">${esc(displayTitle(it.title) || it.title)}</div>
      <div class="sr-sub">${esc(it.subtitle || it.artist || '')}</div>
      <span class="pill-btn primary">${icon(ic)}<span>${cta}</span></span>
    </div>
  </button>`;
}
function searchResultsHTML(sections) {
  if (!sections || !sections.length) {
    return emptyHTML(tr('empty.noResults'), tr('empty.noResults.sub'), { ic: 'i-search' });
  }
  let html = '';
  const leftover = [];
  for (const sec of sections) {
    if (/^top result$/i.test(sec.title || '') && sec.items && sec.items[0]) {
      html += topResultHTML(sec.items[0]);
      continue;
    }
    leftover.push(...(sec.items || []));
  }
  if (sections.length === 1 && leftover.length && !/^top result$/i.test(sections[0].title || '')) {
    const allCard = leftover.every(isSearchCard);
    const allRow = leftover.every((i) => !isSearchCard(i));
    if (allCard || allRow) {
      html += allRow
        ? `<div class="shelf"><div class="shelf-title">${esc(sections[0].title || 'Songs')}</div><div class="track-list">${leftover.map((i) => trackRowHTML(i)).join('')}</div></div>`
        : `<div class="shelf"><div class="shelf-title">${esc(sections[0].title || 'Results')}</div>${carouselHTML(leftover.map(cardHTML).join(''))}</div>`;
      return html;
    }
  }
  const groups = { song: [], video: [], album: [], artist: [], playlist: [], browse: [] };
  leftover.forEach((it) => {
    let t = it.type || (it.videoId ? 'song' : 'browse');
    if (!groups[t]) t = it.videoId ? 'song' : 'browse';
    groups[t].push(it);
  });
  ['song', 'video', 'album', 'artist', 'playlist', 'browse'].forEach((t) => {
    const items = groups[t];
    if (!items.length) return;
    const title = SEARCH_TYPE_LABEL[t];
    html += (t === 'song' || t === 'video')
      ? `<div class="shelf"><div class="shelf-title">${title}</div><div class="track-list">${items.map((i) => trackRowHTML(i)).join('')}</div></div>`
      : `<div class="shelf"><div class="shelf-title">${title}</div>${carouselHTML(items.map(cardHTML).join(''))}</div>`;
  });
  return html || emptyHTML(tr('empty.noResults'), tr('empty.noResults.sub'), { ic: 'i-search' });
}
function relatedSectionsHTML(sections) {
  return (sections || []).map((sec) => {
    const items = sec.items || [];
    if (!items.length) return '';
    const allSongs = items.every((i) => i.videoId && !isSearchCard(i));
    if (allSongs) {
      return `<div class="shelf"><div class="shelf-title">${esc(sec.title || 'Songs')}</div>
        <div class="track-list">${items.slice(0, 16).map((i) => trackRowHTML(i)).join('')}</div></div>`;
    }
    return `<div class="shelf"><div class="shelf-title">${esc(sec.title || 'More')}</div>${carouselHTML(items.map(cardHTML).join(''))}</div>`;
  }).join('');
}
function recentSearchHTML() {
  const rec = store.get('srec', []).filter(Boolean).slice(0, 8);
  if (!rec.length) return '';
  return `<div class="shelf-title recent-head"><span>${tr('search.recent')}</span>
    <button type="button" class="q-clear" id="srec-clear">${tr('misc.clear')}</button></div>
    <div class="recent-row">${rec.map((qq) => `<span class="recent-chip">
      <button type="button" class="recent-go" data-q="${esc(qq)}">${icon('i-clock')}<span>${esc(qq)}</span></button>
      <button type="button" class="recent-x" data-rm="${esc(qq)}" title="${tr('misc.remove')}">${icon('i-x')}</button>
    </span>`).join('')}</div>`;
}
function bindSearchChrome(view, q, filter) {
  const input = $('#search-input');
  const bar = $('.search-bar', view);
  const clearBtn = $('#search-clear');
  const syncClear = () => bar && bar.classList.toggle('has-q', !!(input && input.value.trim()));
  syncClear();
  if (clearBtn) clearBtn.addEventListener('click', () => go('#/search'));
  if (!q && input && window.innerWidth > 860) {
    input.focus();
    input.setSelectionRange((input.value || '').length, (input.value || '').length);
  }
  let sugT;
  if (input) {
    // arrow keys walk the suggestion list; nothing is chosen until Enter
    let sugIdx = -1;
    let typed = input.value;
    const sugItems = () => $$('#suggest button');
    const clearSug = () => { $('#suggest').innerHTML = ''; sugIdx = -1; };
    const paintSug = () => {
      sugItems().forEach((b, i) => b.classList.toggle('sel', i === sugIdx));
      const sel = sugItems()[sugIdx];
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    };
    const moveSug = (step) => {
      const items = sugItems();
      if (!items.length) return;
      if (sugIdx === -1) typed = input.value;
      sugIdx += step;
      if (sugIdx < -1) sugIdx = items.length - 1;
      if (sugIdx >= items.length) sugIdx = -1;
      // -1 means "back to what I actually typed"
      input.value = sugIdx === -1 ? typed : items[sugIdx].dataset.q;
      syncClear();
      paintSug();
    };
    const runSearch = (term) => {
      if (!term) return;
      pushRecentSearch(term);
      go(`#/search/${encodeURIComponent(term)}${filter && filter !== 'all' ? '?filter=' + filter : ''}`);
    };
    input.addEventListener('input', () => {
      syncClear();
      clearTimeout(sugT);
      sugIdx = -1;
      typed = input.value;
      const v = input.value.trim();
      if (!v) { clearSug(); return; }
      sugT = setTimeout(async () => {
        try {
          const d = await api(`/api/suggest?q=${encodeURIComponent(v)}`);
          sugIdx = -1;
          $('#suggest').innerHTML = (d.suggestions || []).slice(0, 6)
            .map((s) => `<button type="button" data-q="${esc(s)}">${icon('i-search')}<span>${esc(s)}</span></button>`).join('');
          sugItems().forEach((b, i) => {
            b.addEventListener('click', () => runSearch(b.dataset.q));
            b.addEventListener('mousemove', () => { sugIdx = i; paintSug(); });
          });
        } catch {}
      }, 220);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); return; }
      if (e.key === 'Escape') {
        if (sugIdx !== -1) { input.value = typed; syncClear(); }
        clearSug();
        input.blur();
        return;
      }
      if (e.key === 'Enter') {
        const items = sugItems();
        const term = (sugIdx >= 0 && items[sugIdx]) ? items[sugIdx].dataset.q : input.value.trim();
        clearSug();
        runSearch(term);
      }
    });
  }
  $$('.search-chips .chip', view).forEach((c) => c.addEventListener('click', () => {
    const f = c.dataset.f;
    const term = (input && input.value.trim()) || q;
    if (!term) return;
    go(`#/search/${encodeURIComponent(term)}${f !== 'all' ? '?filter=' + f : ''}`);
  }));
  $$('.recent-go', view).forEach((b) => b.addEventListener('click', () => go(`#/search/${encodeURIComponent(b.dataset.q)}`)));
  $$('.recent-x', view).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    removeRecentSearch(b.dataset.rm);
    const chip = b.closest('.recent-chip');
    if (chip) chip.remove();
    if (!$('.recent-chip', view)) {
      const head = $('.recent-head', view);
      const row = $('.recent-row', view);
      if (head) head.remove();
      if (row) row.remove();
    }
  }));
  const clr = $('#srec-clear');
  if (clr) clr.addEventListener('click', () => { store.set('srec', []); viewSearch(view, '', filter); });
}
async function viewSearch(view, q = '', filter = null) {
  const filters = ['all', 'songs', 'videos', 'albums', 'artists', 'playlists'];
  const hist = !q ? Library.history.slice(0, 6) : [];
  view.innerHTML = `
    ${q ? '' : `<div class="page-title">${tr('nav.search')}</div>`}
    <div class="search-bar${q ? ' has-q' : ''}">${icon('i-search', 'ic search-ic')}<input id="search-input" placeholder="${tr('search.placeholder')}" value="${esc(q)}" autocomplete="off" spellcheck="false"><button type="button" class="search-clear" id="search-clear" title="${tr('misc.clear')}">${icon('i-x')}</button></div>
    <div class="suggest" id="suggest"></div>
    ${q ? `<div class="search-chips">${filters.map((f) => `<button type="button" class="chip ${((filter || 'all') === f) ? 'active' : ''}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>` : recentSearchHTML()}
    <div id="search-results">${q
      ? `<div class="loading-note">${tr('search.searching')}</div>`
      : `${hist.length ? `<div class="shelf"><div class="shelf-title">${tr('home.recentlyPlayed')}</div><div class="track-list">${hist.map((s) => trackRowHTML({ ...s, subtitle: s.artist })).join('')}</div></div>` : ''}<div id="browse-all"><div class="shelf-title">${tr('home.browseAll')}</div><div class="mood-grid" id="browse-grid"><div class="loading-note">Loading…</div></div></div>`}</div>`;
  bindSearchChrome(view, q, filter);
  if (!q) bindItems($('#search-results'));
  if (!q) {
    try {
      const d = await api('/api/moods');
      const grid = $('#browse-grid');
      if (grid) {
        grid.innerHTML = (d.categories || []).map(moodCardHTML).join('');
        bindMoods(grid);
      }
    } catch {
      const grid = $('#browse-grid');
      if (grid) grid.innerHTML = emptyHTML(tr('empty.moods'), tr('empty.moods.sub'), { label: tr('empty.retry'), go: '#/search', ic: 'i-search' });
    }
    return;
  }
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}${filter && filter !== 'all' ? '&filter=' + filter : ''}`);
    pushRecentSearch(q);
    $('#suggest').innerHTML = '';
    const res = $('#search-results');
    res.innerHTML = searchResultsHTML(d.sections || []);
    bindItems(res);
  } catch (e) {
    const res = $('#search-results');
    if (res) res.innerHTML = emptyHTML(tr('empty.searchFailed'), esc(e.message || tr('empty.searchFailed.sub')), { label: 'Retry', go: `#/search/${encodeURIComponent(q)}`, ic: 'i-search' });
  }
}

/* ---- Charts ---- */
async function viewCharts(view) {
  view.innerHTML = skeletonHTML;
  const d = await api('/api/charts');
  const dateLine = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const secs = d.sections || [];
  let body = '';
  secs.forEach((sec, i) => {
    const items = sec.items || [];
    if (i === 0 && items.length && items.length <= 6 && items.every(isSearchCard)) {
      body += `<div class="shelf"><div class="shelf-title">${esc(sec.title)}</div><div class="chart-grid">${items.map(cardHTML).join('')}</div></div>`;
    } else {
      body += shelfHTML(sec);
    }
  });
  view.innerHTML = `<div class="hello-row"><div><div class="greeting">${esc(dateLine)}</div><h1 class="page-title">${tr('nav.charts')}</h1></div></div>`
    + (body || emptyHTML(tr('empty.charts'), tr('empty.charts.sub'), { label: tr('empty.retry'), go: '#/charts', ic: 'i-chart' }));
  bindItems(view);
}

/* browse-tile palette (fallback when YT colors are missing) */
const MOOD_COLORS = ['#2f5fc0','#3b8fd4','#2a7f8f','#4d8df0','#35b4c4','#4a63b8','#1f6f9c','#5a7fd8','#2e8fa8','#3d6fc4','#6a8fe0','#27698c','#4478cc','#2f9ab0','#5470c8','#3aa0bc'];

/* ---- Moods ---- */
async function viewMoods(view) {
  view.innerHTML = `<div class="page-title">${tr('home.moods')}</div><div class="loading-note">Loading…</div>`;
  const d = await api('/api/moods');
  view.innerHTML = `<div class="page-title">${tr('home.moods')}</div>
    <div class="mood-grid">${d.categories.map(moodCardHTML).join('')}</div>`;
  bindMoods(view);
}

/* ---- Stats (local scrobble) ---- */
function viewStats(view) {
  const st = Library.stats;
  const rows = Object.entries(st).map(([videoId, v]) => ({ videoId, ...v }));
  const totalPlays = rows.reduce((a, r) => a + r.plays, 0);
  const totalMin = Math.round(rows.reduce((a, r) => a + r.secs, 0) / 60);
  // top artists
  const byArtist = {};
  rows.forEach((r) => {
    const a = (r.artist || 'Unknown').split(',')[0].trim() || 'Unknown';
    byArtist[a] = (byArtist[a] || 0) + r.plays;
  });
  const topArtists = Object.entries(byArtist).sort((x, y) => y[1] - x[1]).slice(0, 10);
  const topSongs = [...rows].sort((x, y) => y.plays - x.plays).slice(0, 20);
  const maxA = topArtists[0] ? topArtists[0][1] : 1;
  view.innerHTML = `<div class="hello-row"><div>
      <div class="greeting">${tr('lib.thisDeviceOnly')}</div>
      <h1 class="page-title">${tr('lib.stats')}</h1>
    </div></div>
    <div class="stats-cards">
      <div class="stat-card"><div class="stat-num">${totalPlays}</div><div class="stat-lbl">${tr('stats.plays')}</div></div>
      <div class="stat-card"><div class="stat-num">${totalMin}</div><div class="stat-lbl">${tr('stats.minutes')}</div></div>
      <div class="stat-card"><div class="stat-num">${rows.length}</div><div class="stat-lbl">${tr('stats.unique')}</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(byArtist).length}</div><div class="stat-lbl">${tr('stats.artists')}</div></div>
    </div>
    ${topArtists.length ? `<div class="shelf"><div class="shelf-title">${tr('stats.topArtists')}</div>
      ${topArtists.map(([a, n], i) => `<div class="stat-bar-row"><span class="sb-rank">${i + 1}</span><span class="sb-name">${esc(a)}</span><div class="sb-bar"><div style="width:${(n / maxA) * 100}%"></div></div><span class="sb-n">${n}</span></div>`).join('')}</div>` : ''}
    ${topSongs.length ? `<div class="shelf"><div class="shelf-title">${tr('stats.mostPlayed')}</div>${trackHeadHTML()}<div class="track-list">
      ${topSongs.map((r, i) => trackRowHTML({ videoId: r.videoId, title: r.title, subtitle: `${r.artist} · ${r.plays} plays · ${Math.round(r.secs / 60)} min`, thumbnail: r.thumbnail, tn: i + 1 })).join('')}</div></div>` : ''}
    ${!rows.length ? emptyHTML(tr('empty.stats'), tr('empty.stats.sub'), { label: tr('empty.browseHome'), go: '#/home', ic: 'i-chart' }) : ''}`;
  bindItems(view);
}

/* ---- Catatan pemeriksaan ---- */

/* ---- Library ---- */
function viewLibrary(view, tab) {
  const tabs = [['playlists', tr('lib.playlists')], ['favorites', tr('lib.favorites')], ['saved', tr('lib.saved')], ['history', tr('lib.historyTab')], ['stats', tr('lib.statsTab')]];
  // location.replace, not location.hash: this redirect must not leave a step
  // of its own in history, or the back button lands here and gets pushed
  // forward again, which looks like a button that does not work
  if (tab === 'stats') { location.replace('#/stats'); return; }
  let body = '';
  if (tab === 'favorites') {
    const f = Library.favorites;
    body = f.length
      ? `<div class="lib-actions"><button class="pill-btn primary" id="fav-play">${icon('i-play')}<span>${tr('player.playAll')}</span></button> <button class="pill-btn" id="fav-shuffle">${icon('i-shuffle')}<span>${tr('player.shuffle')}</span></button></div>
         ${trackHeadHTML()}<div class="track-list">${f.map((s, i) => trackRowHTML({ ...s, subtitle: s.artist, tn: i + 1 })).join('')}</div>`
      : emptyHTML(tr('empty.liked'), tr('empty.liked.sub'), { label: tr('empty.findSongs'), go: '#/search', ic: 'i-heart-o' });
  } else if (tab === 'history') {
    const h = Library.history;
    body = h.length
      ? `${trackHeadHTML()}<div class="track-list">${h.map((s, i) => trackRowHTML({ ...s, subtitle: s.artist, tn: i + 1 })).join('')}</div>`
      : emptyHTML(tr('empty.history'), tr('empty.history.sub'), { label: tr('empty.browseHome'), go: '#/home', ic: 'i-clock' });
  } else if (tab === 'saved') {
    const sv = Library.saved;
    body = sv.length
      ? `<div class="lib-grid">${sv.map(cardHTML).join('')}</div>`
      : emptyHTML(tr('empty.saved'), tr('empty.saved.sub'), { label: tr('empty.browseMoods'), go: '#/moods', ic: 'i-save' });
  } else {
    const pls = Library.playlists;
    body = `<div class="lib-actions">
        <button class="pill-btn primary" id="btn-newpl">${icon('i-plus')}<span>${tr('nav.newPlaylist')}</span></button>
        <button class="pill-btn" id="btn-import">${icon('i-download')}<span>${tr('nav.importYt')}</span></button>
        <button class="pill-btn" id="btn-backup">${icon('i-download')}<span>${tr('lib.backup')}</span></button>
        <button class="pill-btn" id="btn-restore">${icon('i-upload')}<span>${tr('lib.restore')}</span></button>
      </div>`;
    const cards = (Library.favorites.length ? likedCardHTML() : '') + pls.map((p) => `<div class="card" data-pl="${p.id}"><div class="art">${coverHTML(p.tracks[0] && p.tracks[0].thumbnail)}<div class="play-ov">${icon('i-play')}</div></div><div class="t">${esc(p.name)}</div><div class="s">${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}</div></div>`).join('');
    body += cards
      ? `<div class="lib-grid">${cards}</div>`
      : emptyHTML(tr('empty.playlists'), tr('empty.playlists.sub'), { ic: 'i-note' });
  }
  view.innerHTML = `<div class="page-title">${tr('lib.title')}</div>
    <div class="chip-row">${tabs.map(([id, l]) => `<button class="chip ${tab === id ? 'active' : ''}" onclick="location.hash='#/library/${id}'">${l}</button>`).join('')}</div>${body}`;
  bindItems(view);
  const np = $('#btn-newpl');
  if (np) np.addEventListener('click', openCreatePlaylist);
  const im = $('#btn-import');
  if (im) im.addEventListener('click', openImportForm);
  const bk = $('#btn-backup');
  if (bk) bk.addEventListener('click', openBackupForm);
  const rs = $('#btn-restore');
  if (rs) rs.addEventListener('click', openRestoreForm);
  const fp = $('#fav-play');
  if (fp) fp.addEventListener('click', () => { const q = [...Library.favorites]; playSong(q[0], q, 0); });
  const fsh = $('#fav-shuffle');
  if (fsh) fsh.addEventListener('click', () => { const q = [...Library.favorites].sort(() => Math.random() - 0.5); playSong(q[0], q, 0); });
  $$('[data-pl]', view).forEach((el) => el.addEventListener('click', () => go(`#/localpl/${el.dataset.pl}`)));
  $$('[data-nav]', view).forEach((el) => el.addEventListener('click', () => go(el.dataset.nav)));
}

/* ---- import a public YT Music playlist/album into local library ---- */
function openImportForm() {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.importTitle');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<form class="pl-form" id="im-form" autocomplete="off">
      <div class="pl-form-cover im" aria-hidden="true">${icon('i-download')}</div>
      <label class="pl-form-label" for="im-form-url">${tr('modal.link')}</label>
      <input id="im-form-url" class="pl-form-input" type="text" inputmode="url" placeholder="https://music.youtube.com/playlist?list=…" />
      <div class="pl-form-hint">${tr('modal.importHint')}</div>
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="im-form-cancel">${tr('modal.cancel')}</button>
        <button type="submit" class="pill-btn primary" id="im-form-go">${icon('i-download')}<span>${tr('modal.import')}</span></button>
      </div>
    </form>`;
  const input = $('#im-form-url');
  const goBtn = $('#im-form-go');
  const submit = async () => {
    const url = (input && input.value || '').trim();
    if (!url) {
      if (input) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); }
      return;
    }
    if (goBtn) { goBtn.disabled = true; goBtn.innerHTML = icon('i-download') + `<span>${tr('modal.importing')}</span>`; }
    try {
      await importFromLink(url);
      closeModal();
    } catch (e) {
      toast(tr('toast.importFailed', { msg: e.message || '' }));
      if (goBtn) { goBtn.disabled = false; goBtn.innerHTML = icon('i-download') + `<span>${tr('modal.import')}</span>`; }
    }
  };
  $('#im-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('#im-form-cancel').addEventListener('click', closeModal);
  modal.classList.remove('hidden');
  setTimeout(() => input && input.focus(), 50);
}
async function importFromLink(url) {
  if (!url) return;
  toast(tr('toast.resolving'));
  const r = await api(`/api/resolve?url=${encodeURIComponent(url)}`);
  if (r.kind === 'song') {
    let song = { videoId: r.videoId, title: 'Loading…', playlistId: r.playlistId };
    try {
      const n = await api(`/api/next?videoId=${encodeURIComponent(r.videoId)}`);
      const hit = (n.queue || []).find((q) => q.videoId === r.videoId) || (n.queue || [])[0];
      if (hit) song = songFromItem(hit);
    } catch {}
    openSongNowPlaying(song);
    return;
  }
  if (r.kind === 'artist') { go(`#/artist/${r.id}`); return; }
  const d = await api(`/api/browse?id=${encodeURIComponent(r.id)}`);
  if (!d.tracks.length) { toast(tr('toast.noTracks')); return; }
  const name = (d.header && d.header.title) || 'Imported playlist';
  const pl = Library.createPlaylist(name);
  d.tracks.forEach((t) => Library.addToPlaylist(pl.id, songFromItem(t)));
  toast(`Imported "${name}" (${d.tracks.length} song${d.tracks.length === 1 ? '' : 's'})`);
  if ((location.hash || '').startsWith('#/library')) route();
  else go('#/library');
}

/* ---- backup / restore whole local library as a JSON file ---- */
function backupLibrary() {
  const data = {
    app: 'ar-music',
    version: 2,
    exportedAt: new Date().toISOString(),
    favorites: Library.favorites,
    playlists: Library.playlists,
    history: Library.history,
    saved: Library.saved,
    stats: Library.stats,
    settings: {
      theme: store.get('theme', 'dark'),
      vol: store.get('vol', 100),
      sb_on: store.get('sb_on', true),
      yt_hq: store.get('yt_hq', false),
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ar-music-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(tr('toast.backupDownloaded'));
}
function restoreLibrary() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        // Recognised by what is inside it, not by the app name written in it.
        // Older backup files still restore, and no app name needs naming here.
        const hasLib = !!d && (Array.isArray(d.favorites) || Array.isArray(d.playlists)
          || Array.isArray(d.saved) || Array.isArray(d.history));
        if (!hasLib) throw new Error('Not an AR Music backup');
        if (Array.isArray(d.favorites)) store.set('fav', d.favorites);
        if (Array.isArray(d.playlists)) store.set('pls', d.playlists);
        if (Array.isArray(d.history)) store.set('hist', d.history);
        if (Array.isArray(d.saved)) store.set('sav', d.saved);
        if (d.stats && typeof d.stats === 'object' && !Array.isArray(d.stats)) store.set('stats', d.stats);
        if (d.settings && typeof d.settings === 'object') {
          if (d.settings.theme === 'light' || d.settings.theme === 'dark') {
            store.set('theme', d.settings.theme);
            document.documentElement.setAttribute('data-theme', d.settings.theme);
            updateThemeIcon();
          }
          if (typeof d.settings.vol === 'number') {
            store.set('vol', d.settings.vol);
            $('#mini-volume').value = d.settings.vol;
            $('#np-volume').value = d.settings.vol;
            if (Player.yt && Player.ready) PB.volume(d.settings.vol);
            updateVolumeIcon();
          }
          if (typeof d.settings.sb_on === 'boolean') {
            store.set('sb_on', d.settings.sb_on);
            Player.sbEnabled = d.settings.sb_on;
            $('#np-sb').classList.toggle('on', Player.sbEnabled);
          }
          if (typeof d.settings.yt_hq === 'boolean') {
            store.set('yt_hq', d.settings.yt_hq);
            Player.hq = d.settings.yt_hq;
            updateQualityButton();
          }
        }
        renderSidebarLibrary();
        toast(tr('toast.libraryRestored'));
        closeModal();
        route();
      } catch (e) { toast(tr('toast.restoreFailed', { msg: e.message || '' })); }
    };
    reader.onerror = () => toast(tr('toast.restoreUnreadable'));
    reader.readAsText(f);
  };
  inp.click();
}
function viewLocalPlaylist(view, pid) {
  const pl = Library.playlists.find((p) => p.id === pid);
  if (!pl) {
    view.innerHTML = emptyHTML(tr('empty.playlistGone'), tr('empty.playlistGone.sub'), { label: tr('empty.yourLibrary'), go: '#/library', ic: 'i-library' });
    bindEmptyCtas(view);
    return;
  }
  const rows = pl.tracks.map((s, i) => {
    const up = i === 0 ? ' disabled' : '';
    const dn = i === pl.tracks.length - 1 ? ' disabled' : '';
    return trackRowHTML({ ...s, subtitle: s.artist, plId: pid, plIndex: i, tn: i + 1 }, false,
      `<button class="tbtn btn-qup" data-i="${i}" title="${tr('misc.moveUp')}"${up}>${icon('i-chev-up')}</button>` +
      `<button class="tbtn btn-qdn" data-i="${i}" title="${tr('misc.moveDown')}"${dn}>${icon('i-chev-down')}</button>` +
      `<button class="tbtn btn-rm" data-vid="${esc(s.videoId)}" title="${tr('misc.remove')}">${icon('i-x')}</button>`);
  }).join('');
  const cover = safeCover(pl.tracks[0] && pl.tracks[0].thumbnail)
    ? `<img src="${esc(pl.tracks[0].thumbnail)}" alt="">`
    : `<div class="detail-ph">${icon('i-note')}</div>`;
  view.innerHTML = `<div class="detail-head">
      ${cover}
      <div class="detail-info"><div class="detail-kicker">${tr('player.playlist')}</div><h1>${esc(pl.name)}</h1><div class="sub">${tr('misc.songs', { n: pl.tracks.length })} · ${tr('pl.local')}</div>
      <div class="detail-actions">
        <button class="pill-btn primary" id="pl-play">${icon('i-play')}<span>${tr('player.play')}</span></button>
        <button class="pill-btn" id="pl-shuffle">${icon('i-shuffle')}<span>${tr('player.shuffle')}</span></button>
        <button class="pill-btn" id="pl-rename">${icon('i-note')}<span>${tr('modal.rename')}</span></button>
        <button class="pill-btn" id="pl-del">${icon('i-trash')}<span>${tr('modal.delete')}</span></button>
      </div></div></div>
    ${rows ? trackHeadHTML() + `<div class="track-list">${rows}</div>` : emptyHTML(tr('empty.playlistEmpty'), tr('empty.playlistEmpty.sub'), { label: tr('empty.findSongs'), go: '#/search', ic: 'i-note' })}`;
  bindItems(view);
  $$('.btn-rm', view).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    Library.removeFromPlaylist(pid, b.dataset.vid);
    route();
  }));
  $$('.btn-qup', view).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Library.moveInPlaylist(pid, Number(b.dataset.i), -1)) route();
  }));
  $$('.btn-qdn', view).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Library.moveInPlaylist(pid, Number(b.dataset.i), 1)) route();
  }));
  if (window.matchMedia('(min-width: 861px)').matches) {
    $$('.track', view).forEach((row) => {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', row.dataset.pi);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(row.dataset.pi);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
        const pls = Library.playlists;
        const cur = pls.find((p) => p.id === pid);
        if (!cur) return;
        const [item] = cur.tracks.splice(from, 1);
        cur.tracks.splice(to, 0, item);
        store.set('pls', pls);
        route();
      });
    });
  }
  $('#pl-play').addEventListener('click', () => pl.tracks.length && playSong(pl.tracks[0], [...pl.tracks], 0));
  $('#pl-shuffle').addEventListener('click', () => {
    if (!pl.tracks.length) return;
    const q = [...pl.tracks].sort(() => Math.random() - 0.5);
    playSong(q[0], q, 0);
  });
  $('#pl-rename').addEventListener('click', () => openRenamePlaylist(pid));
  $('#pl-del').addEventListener('click', () => openDeletePlaylist(pid));
}

/* ---- Browse (album / playlist / artist / mood) ---- */
async function viewBrowse(view, id, kind, extraParams) {
  view.innerHTML = skeletonHTML;
  const d = await api(`/api/browse?id=${encodeURIComponent(id)}${extraParams ? '&params=' + encodeURIComponent(extraParams) : ''}`);
  applyTint(id || kind);
  const h = d.header || { title: '', subtitle: '' };
  const kick = kind === 'artist' ? 'Artist' : kind === 'album' ? 'Album' : kind === 'playlist' ? 'Playlist' : 'Collection';
  let html = '';
  if (h.title) {
    html += `<div class="detail-head ${kind === 'artist' ? 'artist' : ''}">
      ${safeCover(h.thumbnail) ? `<img src="${esc(h.thumbnail)}" alt="">` : `<div class="detail-ph">${icon('i-note')}</div>`}
      <div class="detail-info"><div class="detail-kicker">${kick}</div><h1>${esc(h.title)}</h1>
        <div class="sub">${esc([h.strapline, h.subtitle].filter(Boolean).join(' • '))}${h.description ? `<br><span style="font-size:12.5px">${esc(h.description.slice(0, 260))}${h.description.length > 260 ? '…' : ''}</span>` : ''}</div>
        <div class="detail-actions">
          ${d.tracks.length ? `<button class="pill-btn primary" id="br-play">${icon('i-play')}<span>${tr('player.play')}</span></button><button class="pill-btn" id="br-shuffle">${icon('i-shuffle')}<span>${tr('player.shuffle')}</span></button>` : ''}
          <button class="pill-btn" id="br-save">${icon(Library.isSaved(id) ? 'i-save-f' : 'i-save')}<span>${tr(Library.isSaved(id) ? 'lib.saved.done' : 'lib.save')}</span></button>
        </div>
      </div></div>`;
  }
  if (d.tracks.length) {
    const headerArtist = (h.artists && h.artists[0] && h.artists[0].name) || h.strapline || '';
    const headerArtistId = (h.artists && h.artists[0] && h.artists[0].browseId) || '';
    html += `${trackHeadHTML()}<div class="track-list">${d.tracks.map((t, i) => {
      const fromArr = (t.artists || []).map((a) => a.name).filter(Boolean).join(', ');
      const artist = t.artist || fromArr || headerArtist;
      return trackRowHTML({
        ...t,
        tn: i + 1,
        artist,
        subtitle: artist || t.subtitle,
        artistBrowseId: t.artistBrowseId || (t.artists && t.artists[0] && t.artists[0].browseId) || headerArtistId,
        duration: normalizeDuration(t.duration),
      });
    }).join('')}</div>`;
  }
  html += (d.sections || []).map(shelfHTML).join('');
  view.innerHTML = html || emptyHTML(tr('empty.nothingHere'), tr('empty.nothingHere.sub'), { label: tr('empty.goHome'), go: '#/home', ic: 'i-note' });
  bindItems(view);
  const toSongs = () => d.tracks.map((t) => ({ ...songFromItem(t), thumbnail: t.thumbnail || h.thumbnail }));
  const bp = $('#br-play');
  if (bp) bp.addEventListener('click', () => { const q = toSongs(); playSong(q[0], q, 0); });
  const bs = $('#br-shuffle');
  if (bs) bs.addEventListener('click', () => { const q = toSongs().sort(() => Math.random() - 0.5); playSong(q[0], q, 0); });
  const bsv = $('#br-save');
  if (bsv) bsv.addEventListener('click', () => {
    Library.toggleSaved({
      type: kind === 'artist' ? 'artist' : kind === 'album' ? 'album' : 'playlist',
      browseType: kind, browseId: id,
      title: h.title, subtitle: h.subtitle || '', thumbnail: h.thumbnail,
    });
    bsv.innerHTML = icon(Library.isSaved(id) ? 'i-save-f' : 'i-save') + `<span>${tr(Library.isSaved(id) ? 'lib.saved.done' : 'lib.save')}</span>`;
  });
  // playing track highlight handled implicitly on rerender
}

/* ================= song overflow menu ================= */
function openSongMenu(song, opts = {}) {
  if (!song || !song.videoId) return;
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  if (actions) actions.classList.remove('hidden');
  $('#modal-title').textContent = displayTitle(song.title) || tr('modal.song');
  const liked = Library.isFav(song.videoId);
  const qi = opts.qi;
  const inUserQ = Number.isFinite(qi) && qi > Player.index && Player.queue[qi] && Player.queue[qi]._user;
  const isFirst = inUserQ && (qi === Player.index + 1 || !(Player.queue[qi - 1] && Player.queue[qi - 1]._user));
  const isLast = inUserQ && !(Player.queue[qi + 1] && Player.queue[qi + 1]._user);
  const inPl = !!(opts.plId && Number.isFinite(opts.plIndex));
  const pl = inPl ? Library.playlists.find((p) => p.id === opts.plId) : null;
  const isPlFirst = inPl && opts.plIndex === 0;
  const isPlLast = inPl && pl && opts.plIndex === pl.tracks.length - 1;
  const row = (act, ic, label, disabled) =>
    `<button type="button" class="modal-row${disabled ? ' disabled' : ''}" data-act="${act}"${disabled ? ' disabled' : ''}>${icon(ic)}<span>${label}</span></button>`;
  body.innerHTML = `<div class="sm-head">
      ${coverHTML(song.thumbnail, 'sm')}
      <div class="sm-meta"><div class="sm-t">${esc(displayTitle(song.title))}</div><div class="sm-s">${esc(song.artist || song.subtitle || '')}</div></div>
    </div>
    ${row('next', 'i-next', 'Play next')}
    ${row('queue', 'i-queue', 'Add to queue')}
    ${row('fav', liked ? 'i-heart-f' : 'i-heart-o', liked ? 'Favorited' : 'Favorite')}
    ${row('pl', 'i-plus', 'Add to playlist')}
    ${row('dl', 'i-download', tr('player.download'))}
    ${row('share', 'i-share', tr('player.share'))}
    ${row('artist', 'i-search', tr('misc.goToArtist'))}
    ${inUserQ ? `${row('up', 'i-chev-up', 'Move up', isFirst)}${row('dn', 'i-chev-down', 'Move down', isLast)}${row('rm', 'i-x', 'Remove from queue')}` : ''}
    ${inPl ? `${row('plup', 'i-chev-up', 'Move up', isPlFirst)}${row('pldn', 'i-chev-down', 'Move down', isPlLast)}${row('plrm', 'i-x', 'Remove from playlist')}` : ''}`;
  $$('[data-act]', body).forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    const a = b.dataset.act;
    if (a === 'next') queueSong(song, true);
    else if (a === 'queue') queueSong(song, false);
    else if (a === 'fav') Library.toggleFav(song);
    else if (a === 'pl') { openAddToPlaylist(song); return; }
    else if (a === 'dl') downloadSong(song);
    else if (a === 'share') { shareSong(song); }
    else if (a === 'artist') { goToArtist(song); }
    else if (a === 'up') moveQueued(qi, -1);
    else if (a === 'dn') moveQueued(qi, 1);
    else if (a === 'rm') removeQueued(qi);
    else if (a === 'plup') { if (Library.moveInPlaylist(opts.plId, opts.plIndex, -1)) route(); }
    else if (a === 'pldn') { if (Library.moveInPlaylist(opts.plId, opts.plIndex, 1)) route(); }
    else if (a === 'plrm') { Library.removeFromPlaylist(opts.plId, song.videoId); route(); }
    closeModal();
  }));
  modal.classList.remove('hidden');
}

function openNowPlayingMore() {
  const song = focusedSong();
  if (!song) return;
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  if (actions) actions.classList.remove('hidden');
  $('#modal-title').textContent = displayTitle(song.title) || tr('modal.more');
  const row = (act, ic, label, on) =>
    `<button type="button" class="modal-row${on ? ' on' : ''}" data-npact="${act}">${icon(ic)}<span>${label}</span></button>`;
  body.innerHTML = `
    ${row('dl', 'i-download', tr('player.download'))}
    ${row('share', 'i-share', tr('player.share'))}
    ${row('artist', 'i-search', tr('misc.goToArtist'))}
    ${row('speed', 'i-clock', tr('more.speed', { n: Player.speed }))}
    ${row('float', 'i-pip', Player.floatOn ? tr('more.widgetOn') : tr('player.widget'))}
    ${row('quality', 'i-expand', tr(Player.hq ? 'more.qualityMax' : 'more.qualityYtm'))}
    ${row('sb', 'i-next', tr(Player.sbEnabled ? 'more.sbOn' : 'more.sb'))}`;
  $$('[data-npact]', body).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.npact;
    if (a === 'dl') downloadSong(song);
    else if (a === 'share') shareSong(song);
    else if (a === 'artist') goToArtist(song);
    else if (a === 'speed') cycleSpeed();
    else if (a === 'float') toggleFloatWidget();
    else if (a === 'quality') toggleQuality();
    else if (a === 'sb') toggleSB();
    closeModal();
  }));
  modal.classList.remove('hidden');
}
function syncNpMore() {
  const btn = $('#np-more');
  if (btn) btn.classList.toggle('has-on', !!(Player.floatOn || Player.sbEnabled || Player.hq));
}
function closeModal() {
  const modal = $('#modal');
  if (modal) modal.classList.add('hidden');
  const actions = $('.modal-actions');
  if (actions) actions.classList.remove('hidden');
}
function songArtistBrowseId(s) {
  if (!s) return '';
  if (s.artistBrowseId) return s.artistBrowseId;
  const a = s.artists && s.artists[0];
  return (a && a.browseId) || '';
}
function goToArtist(song) {
  const s = song || focusedSong();
  if (!s) return;
  const id = songArtistBrowseId(s);
  closeNowPlaying();
  if (id) go(`#/artist/${id}`);
  else if (s.artist) go(`#/search/${encodeURIComponent(String(s.artist).split(',')[0].trim())}`);
}
async function openSharedSong(videoId) {
  if (!videoId) return;
  let song = { videoId, title: 'Song' };
  try {
    const d = await api(`/api/next?videoId=${encodeURIComponent(videoId)}`);
    const hit = (d.queue || []).find((q) => q.videoId === videoId) || (d.queue || [])[0];
    if (hit) song = songFromItem(hit);
  } catch {}
  openSongNowPlaying(song);
}
async function shareSong(song) {
  const s = song || focusedSong();
  if (!s || !s.videoId) return;
  const url = `${location.origin}${location.pathname}#/song/${s.videoId}`;
  const title = displayTitle(s.title) || s.title || 'Song';
  const text = s.artist ? `${title} — ${s.artist}` : title;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
    else {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(tr('toast.linkCopied'));
  } catch {
    toast(url);
  }
}
function openSleepTimer() {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.sleepTitle');
  if (actions) actions.classList.add('hidden');
  const active = !!Player.sleepTimer;
  body.innerHTML = `<form class="pl-form" id="sl-form">
      <div class="pl-form-cover" aria-hidden="true">${icon('i-clock')}</div>
      <div class="pl-form-hint">${tr(active ? 'modal.sleepRunning' : 'modal.sleepHint')}</div>
      <div class="pl-presets" id="sl-presets">
        ${[15, 30, 45, 60].map((m) => `<button type="button" class="chip" data-m="${m}">${tr('modal.minutes', { n: m })}</button>`).join('')}
      </div>
      <label class="pl-form-label" for="sl-mins">${tr('modal.customMinutes')}</label>
      <input id="sl-mins" class="pl-form-input" type="number" min="0" max="240" placeholder="${tr('modal.minutesHint')}" />
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="sl-cancel-timer">${tr(active ? 'modal.cancelTimer' : 'modal.close')}</button>
        <button type="submit" class="pill-btn primary">${tr('modal.start')}</button>
      </div>
    </form>`;
  const input = $('#sl-mins');
  const start = (m) => {
    clearTimeout(Player.sleepTimer);
    Player.sleepTimer = null;
    $('#np-sleep') && $('#np-sleep').classList.remove('on');
    if (m > 0) {
      Player.sleepTimer = setTimeout(() => {
        Player.wantPlaying = false; // or the background watchdog would resume it
        Player.yt && PB.pause();
        Player.sleepTimer = null;
        $('#np-sleep') && $('#np-sleep').classList.remove('on');
        toast(tr('toast.sleepPaused'));
      }, m * 60000);
      $('#np-sleep') && $('#np-sleep').classList.add('on');
      toast(tr('toast.sleepIn', { n: m }));
    } else toast(tr('toast.sleepCancelled'));
    closeModal();
  };
  $$('#sl-presets .chip').forEach((c) => c.addEventListener('click', () => start(Number(c.dataset.m))));
  $('#sl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = Number(input.value);
    if (!Number.isFinite(m) || m < 0) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
    start(m);
  });
  $('#sl-cancel-timer').addEventListener('click', () => {
    if (Player.sleepTimer) start(0);
    else closeModal();
  });
  modal.classList.remove('hidden');
  setTimeout(() => input && input.focus(), 50);
}
function openBackupForm() {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.backupTitle');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<div class="pl-form">
      <div class="pl-form-cover" aria-hidden="true">${icon('i-download')}</div>
      <div class="pl-form-hint">${tr('modal.backupHint')}</div>
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="bk-close">${tr('modal.cancel')}</button>
        <button type="button" class="pill-btn primary" id="bk-go">${icon('i-download')}<span>${tr('modal.downloadBackup')}</span></button>
      </div>
    </div>`;
  $('#bk-close').addEventListener('click', closeModal);
  $('#bk-go').addEventListener('click', () => { backupLibrary(); closeModal(); });
  modal.classList.remove('hidden');
}
function openRestoreForm() {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.restoreTitle');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<div class="pl-form">
      <div class="pl-form-cover im" aria-hidden="true">${icon('i-upload')}</div>
      <div class="pl-form-hint">${tr('modal.restoreHint')}</div>
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="rs-close">${tr('modal.cancel')}</button>
        <button type="button" class="pill-btn primary" id="rs-go">${icon('i-upload')}<span>${tr('modal.chooseFile')}</span></button>
      </div>
    </div>`;
  $('#rs-close').addEventListener('click', closeModal);
  $('#rs-go').addEventListener('click', () => restoreLibrary());
  modal.classList.remove('hidden');
}
function openCreatePlaylist() {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.createPlaylist');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<form class="pl-form" id="pl-form" autocomplete="off">
      <div class="pl-form-cover" aria-hidden="true">${icon('i-note')}</div>
      <label class="pl-form-label" for="pl-form-name">${tr('modal.playlistName')}</label>
      <input id="pl-form-name" class="pl-form-input" type="text" maxlength="80" placeholder="${tr('misc.myPlaylist')}" />
      <div class="pl-form-hint">${tr('modal.createHint')}</div>
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="pl-form-cancel">${tr('modal.cancel')}</button>
        <button type="submit" class="pill-btn primary" id="pl-form-create">${icon('i-plus')}<span>${tr('modal.create')}</span></button>
      </div>
    </form>`;
  const input = $('#pl-form-name');
  const submit = () => {
    const name = (input && input.value || '').trim();
    if (!name) {
      if (input) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); }
      return;
    }
    Library.createPlaylist(name);
    closeModal();
    toast(tr('toast.created', { name }));
    if ((location.hash || '').startsWith('#/library')) route();
    else go('#/library');
  };
  $('#pl-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('#pl-form-cancel').addEventListener('click', closeModal);
  modal.classList.remove('hidden');
  setTimeout(() => input && input.focus(), 50);
}
function openRenamePlaylist(pid) {
  const pl = Library.playlists.find((p) => p.id === pid);
  if (!pl) return;
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.renamePlaylist');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<form class="pl-form" id="rn-form" autocomplete="off">
      <div class="pl-form-cover" aria-hidden="true">${icon('i-note')}</div>
      <label class="pl-form-label" for="rn-name">Playlist name</label>
      <input id="rn-name" class="pl-form-input" type="text" maxlength="80" value="${esc(pl.name)}" />
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="rn-cancel">Cancel</button>
        <button type="submit" class="pill-btn primary">Save</button>
      </div>
    </form>`;
  const input = $('#rn-name');
  $('#rn-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (input.value || '').trim();
    if (!name) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
    Library.renamePlaylist(pid, name);
    closeModal();
    toast(tr('toast.playlistRenamed'));
    route();
  });
  $('#rn-cancel').addEventListener('click', closeModal);
  modal.classList.remove('hidden');
  setTimeout(() => { if (input) { input.focus(); input.select(); } }, 50);
}
function openDeletePlaylist(pid) {
  const pl = Library.playlists.find((p) => p.id === pid);
  if (!pl) return;
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  $('#modal-title').textContent = tr('modal.deletePlaylist');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<div class="pl-form">
      <div class="pl-form-cover im" aria-hidden="true">${icon('i-trash')}</div>
      <div class="pl-form-hint">${tr('modal.deleteHint', { name: esc(pl.name) })}</div>
      <div class="pl-form-actions">
        <button type="button" class="pill-btn" id="dlpl-cancel">Cancel</button>
        <button type="button" class="pill-btn primary" id="dlpl-go">${icon('i-trash')}<span>Delete</span></button>
      </div>
    </div>`;
  $('#dlpl-cancel').addEventListener('click', closeModal);
  $('#dlpl-go').addEventListener('click', () => {
    Library.deletePlaylist(pid);
    closeModal();
    toast(tr('toast.playlistDeleted'));
    go('#/library');
  });
  modal.classList.remove('hidden');
}

/* ================= add-to-playlist modal ================= */
function openAddToPlaylist(song) {
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  if (actions) actions.classList.remove('hidden');
  $('#modal-title').textContent = tr('modal.addToPlaylist');
  const render = () => {
    const pls = Library.playlists;
    body.innerHTML = `<div class="q-modal-row">
        <button class="pill-btn" id="q-playnext">${icon('i-next')}<span>${tr('player.playNext')}</span></button>
        <button class="pill-btn" id="q-add">${icon('i-queue')}<span>${tr('player.addToQueue')}</span></button>
      </div>
      <input id="newpl-name" placeholder="${tr('misc.newPlaylistName')}">
      <button class="pill-btn primary" id="newpl-create" style="margin-bottom:12px">${tr('modal.createAndAdd')}</button>
      ${pls.length ? `<div class="pl-list-label">Your playlists</div>` : ''}
      ${pls.map((p) => {
        const cover = p.tracks[0] && p.tracks[0].thumbnail;
        const n = p.tracks.length;
        return `<button type="button" class="modal-row pl-pick" data-id="${p.id}">
          ${cover ? `<img class="pl-pick-art" src="${esc(cover)}" alt="">` : `<span class="pl-pick-ph">${icon('i-note')}</span>`}
          <span class="pl-pick-meta"><span class="pl-pick-name">${esc(p.name)}</span><span class="pl-pick-count">${n} song${n === 1 ? '' : 's'}</span></span>
        </button>`;
      }).join('') || '<div class="empty-note">No playlists yet</div>'}`;
    $('#q-playnext').addEventListener('click', () => { queueSong(song, true); closeModal(); });
    $('#q-add').addEventListener('click', () => { queueSong(song, false); closeModal(); });
    $('#newpl-create').addEventListener('click', () => {
      const name = $('#newpl-name').value.trim();
      if (!name) return;
      const pl = Library.createPlaylist(name);
      Library.addToPlaylist(pl.id, song);
      toast(tr('toast.addedTo', { name }));
      modal.classList.add('hidden');
    });
    $$('.modal-row', body).forEach((r) => r.addEventListener('click', () => {
      Library.addToPlaylist(r.dataset.id, song);
      toast(tr('toast.addedPlaylist'));
      modal.classList.add('hidden');
    }));
  };
  render();
  modal.classList.remove('hidden');
}
$('#modal-cancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ================= wire up controls ================= */
$('#mini-play').addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
$('#mini-next').addEventListener('click', (e) => { e.stopPropagation(); nextTrack(false); });
$('#mini-prev').addEventListener('click', (e) => { e.stopPropagation(); prevTrack(); });
$('#mini-like').addEventListener('click', (e) => { e.stopPropagation(); if (Player.current) Library.toggleFav(Player.current); });
/* On small screens and inside the app, the player bar shows no Now Playing
   button at all, so the song title becomes the way in. What gets checked is
   whether the button is there, not how wide the screen is: where the button
   exists, the title deliberately does nothing. */
function npButtonShown() {
  const btn = $('#mini-open');
  // What gets hidden on a small screen is the parent, .pb-right, and that
  // leaves the button's own display untouched. So what is checked is whether
  // the button actually takes up any room on screen.
  return !!btn && btn.getBoundingClientRect().width > 0;
}

/* Only the Now Playing button opens the panel.
   The whole player bar used to open it, empty space included, and so did the
   artwork and the song title. The result was a panel opening uninvited simply
   because the bar got brushed. */
const openNP = (e) => {
  if (e) e.stopPropagation();
  Player.pending = null;
  renderNowPlaying();
  renderPlayButtons();
  updateLikeButtons();
  openNowPlaying();
};
$('#mini-title').addEventListener('click', (e) => {
  if (npButtonShown()) return;
  openNP(e);
});

// the two bar buttons toggle their panel instead of only opening it
$('#mini-open').addEventListener('click', (e) => {
  e.stopPropagation();
  if (isNPOpen()) closeNowPlaying(); else openNP();
});
const toggleQueue = (e) => {
  e.stopPropagation();
  if (isNPOpen() && activeNPTab() === 'queue') closeNowPlaying();
  else { openNowPlaying(); switchNPTab('queue'); }
};
$('#mini-queue-m').addEventListener('click', toggleQueue);
/* shuffle / repeat on the bar (synced with Now Playing buttons) */
$('#mini-shuffle').addEventListener('click', (e) => {
  e.stopPropagation();
  Player.shuffle = !Player.shuffle;
  resetShuffleBag();
  $('#mini-shuffle').classList.toggle('on', Player.shuffle);
  $('#np-shuffle').classList.toggle('on', Player.shuffle);
  toast(Player.shuffle ? 'Shuffle on' : 'Shuffle off');
});
$('#mini-repeat').addEventListener('click', (e) => {
  e.stopPropagation();
  Player.repeat = (Player.repeat + 1) % 3;
  const on = Player.repeat > 0;
  const ic = icon(Player.repeat === 2 ? 'i-repeat-1' : 'i-repeat');
  $('#mini-repeat').classList.toggle('on', on); $('#mini-repeat').innerHTML = ic;
  $('#np-repeat').classList.toggle('on', on); $('#np-repeat').innerHTML = ic;
  persistQueue();
  toast(['Repeat off', 'Repeat all', 'Repeat one'][Player.repeat]);
});
/* volume on the bar */
/* ---- mute / unmute ---- */
Player.lastVol = null;
function isMuted() { return Number($('#mini-volume').value) === 0; }
function applyVolume(v, remember) {
  const vol = Math.max(0, Math.min(100, Number(v) || 0));
  if (Player.yt && Player.ready) {
    PB.volume(vol);
    // the IFrame player keeps its own mute flag; volume 0 alone would not clear it
    if (vol === 0) PB.mute(true); else PB.mute(false);
  }
  $('#mini-volume').value = vol;
  $('#np-volume').value = vol;
  if (remember) store.set('vol', vol);
  updateVolumeIcon();
}
function updateVolumeIcon() {
  const muted = isMuted();
  ['#mini-mute', '#np-mute'].forEach((sel) => {
    const btn = $(sel);
    if (!btn) return;
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', muted ? '#i-volume-x' : '#i-volume');
    btn.classList.toggle('muted', muted);
    btn.title = muted ? 'Unmute' : 'Mute';
    btn.setAttribute('aria-label', btn.title);
  });
}
function toggleMute() {
  if (isMuted()) {
    // restore what was playing before; fall back if the last level was also 0
    applyVolume(Player.lastVol && Player.lastVol > 0 ? Player.lastVol : 100, true);
  } else {
    Player.lastVol = Number($('#mini-volume').value);
    applyVolume(0, false); // keep the stored level so a reload is not silent
  }
}
$('#mini-mute') && $('#mini-mute').addEventListener('click', toggleMute);
$('#np-mute') && $('#np-mute').addEventListener('click', toggleMute);

$('#mini-volume').addEventListener('input', (e) => {
  if (Player.yt && Player.ready) PB.volume(Number(e.target.value));
  if (Player.yt && Player.ready) { if (Number(e.target.value) === 0) PB.mute(true); else PB.mute(false); }
  $('#np-volume').value = e.target.value;
  updateVolumeIcon();
});
/* click-to-seek on the bar */
$('#mini-bar').addEventListener('click', (e) => {
  if (Player.cued || !Player.yt || !Player.ready) return;
  const r = e.currentTarget.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const dur = PB.duration() || 0;
  if (dur) PB.seek(frac * dur, true);
});
$('#np-close').addEventListener('click', closeNowPlaying);
$('#np-play').addEventListener('click', toggleNowPlayingPlay);
$('#np-next').addEventListener('click', () => nextTrack(false));
$('#np-prev').addEventListener('click', prevTrack);
$('#np-like').addEventListener('click', () => focusedSong() && Library.toggleFav(focusedSong()));
$('#np-playnext').addEventListener('click', () => {
  const s = focusedSong();
  if (!s) return;
  queueSong(s, true);
  Player.pending = null;
  renderNowPlaying();
  renderPlayButtons();
  updateLikeButtons();
  switchNPTab('queue');
});
$('#np-queueadd').addEventListener('click', () => {
  const s = focusedSong();
  if (!s) return;
  queueSong(s, false);
  Player.pending = null;
  renderNowPlaying();
  renderPlayButtons();
  updateLikeButtons();
  switchNPTab('queue');
});
$('#np-addpl').addEventListener('click', () => focusedSong() && openAddToPlaylist(focusedSong()));
$('#np-download').addEventListener('click', () => focusedSong() && downloadSong(focusedSong()));
$('#np-shuffle').addEventListener('click', function () {
  Player.shuffle = !Player.shuffle;
  resetShuffleBag();
  this.classList.toggle('on', Player.shuffle);
  $('#mini-shuffle').classList.toggle('on', Player.shuffle);
  persistQueue();
  toast(Player.shuffle ? 'Shuffle on' : 'Shuffle off');
});
$('#np-repeat').addEventListener('click', function () {
  Player.repeat = (Player.repeat + 1) % 3;
  const on = Player.repeat > 0;
  const ic = icon(Player.repeat === 2 ? 'i-repeat-1' : 'i-repeat');
  this.classList.toggle('on', on); this.innerHTML = ic;
  $('#mini-repeat').classList.toggle('on', on); $('#mini-repeat').innerHTML = ic;
  persistQueue();
  toast(['Repeat off', 'Repeat all', 'Repeat one'][Player.repeat]);
});
$('#np-speed').addEventListener('click', cycleSpeed);
$('#np-float').addEventListener('click', toggleFloatWidget);
$('#mini-float').addEventListener('click', (e) => { e.stopPropagation(); toggleFloatWidget(); });
$('#np-quality').addEventListener('click', toggleQuality);
$('#np-sb').addEventListener('click', toggleSB);
$('#np-volume').addEventListener('input', (e) => {
  if (Player.yt) PB.volume(Number(e.target.value));
  if (Player.yt && Player.ready) { if (Number(e.target.value) === 0) PB.mute(true); else PB.mute(false); }
  $('#mini-volume').value = e.target.value;
  updateVolumeIcon();
});
$('#np-lyric-preview').addEventListener('click', () => switchNPTab('lyrics'));
$('#np-sleep').addEventListener('click', openSleepTimer);
const npShare = $('#np-share');
if (npShare) npShare.addEventListener('click', () => shareSong(focusedSong()));
const npMore = $('#np-more');
if (npMore) npMore.addEventListener('click', openNowPlayingMore);
$('#np-artist').addEventListener('click', (e) => { e.stopPropagation(); goToArtist(focusedSong()); });
/* The artist line in the player bar goes to the artist page. The click is
   stopped here so no other handler on the bar fires along with it. When there
   is no artist to go to, the click is left alone. */
$('#mini-artist').addEventListener('click', (e) => {
  if (!e.currentTarget.classList.contains('linkish')) return;
  e.stopPropagation();
  goToArtist(Player.current);
});
/* Enter and space on the artist line do the same as clicking it. */
[$('#mini-artist'), $('#np-artist')].forEach((el) => {
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    el.click();
  });
});

let seekDragging = false;
const range = $('#np-range');
range.addEventListener('input', () => { seekDragging = true; });
range.addEventListener('change', () => {
  seekDragging = false;
  if (isPreviewing() || !Player.yt || !Player.ready) return;
  const dur = PB.duration() || 0;
  PB.seek((range.value / 1000) * dur, true);
});

function switchNPTab(name) {
  $$('.np-tab').forEach((t) => t.classList.toggle('active', t.dataset.nptab === name));
  $$('.np-pane').forEach((p) => p.classList.toggle('active', p.id === 'np-' + name));
  if (name === 'related') loadRelated();
  if (name === 'lyrics') { lastLyricIdx = -2; }
  if (name === 'queue') renderQueue();
  updatePanelButtons();
  keepPanelAnchored();
}
$$('.np-tab').forEach((t) => t.addEventListener('click', () => switchNPTab(t.dataset.nptab)));
$('#lyr-earlier') && $('#lyr-earlier').addEventListener('click', () => bumpLyricShift(-0.5));
$('#lyr-later') && $('#lyr-later').addEventListener('click', () => bumpLyricShift(0.5));
$('#nowplaying').addEventListener('scroll', keepPanelAnchored, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.shiftKey) nextTrack(false);
  if (e.code === 'ArrowLeft' && e.shiftKey) prevTrack();
  if (e.code === 'Escape') closeNowPlaying();
  if (e.code === 'KeyL') toggleTheme();
  if (e.code === 'KeyP') { e.preventDefault(); toggleFloatWidget(); }
});

/* topbar back / forward */
$('#nav-back').addEventListener('click', () => history.back());
$('#nav-fwd').addEventListener('click', () => history.forward());
$('#lib-new').addEventListener('click', () => go('#/library'));
$('#lib-title-btn').addEventListener('click', () => go('#/library'));
(() => {
  const np = $('#nowplaying');
  let startY = 0;
  np.addEventListener('touchstart', (e) => { startY = e.changedTouches[0].clientY; }, { passive: true });
  np.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 90 && window.innerWidth < 1100) closeNowPlaying();
  }, { passive: true });
})();

/* ================= floating widget / Picture-in-Picture ================= */
Player.pipWin = null;
Player.floatOn = false;

const FW_CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0c1422; color: #e9eff9;
    font-family: "Plus Jakarta Sans", Segoe UI, sans-serif; overflow: hidden; }
  html[data-theme="light"] { color-scheme: light; }
  html[data-theme="light"] body { background: #fff; color: #0f1c2f; }
  #float-widget {
    display: flex; align-items: center; gap: 10px; height: 100%;
    padding: 10px 12px; box-sizing: border-box;
    background: linear-gradient(135deg, #16223a, #0c1422);
  }
  html[data-theme="light"] #float-widget { background: linear-gradient(135deg, #eef4fc, #fff); }
  #fw-art { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; background: #1a2740; flex-shrink: 0; }
  .fw-meta { min-width: 0; flex: 1; }
  #fw-title { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #fw-artist { font-size: 12px; opacity: .65; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #fw-lyric { margin-top: 5px; font-size: 12px; font-weight: 700; color: #6ba6ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; line-height: 1.3; }
  #fw-lyric:empty { display: none; }
  .fw-bar { margin-top: 8px; height: 4px; background: rgba(255,255,255,.22); border-radius: 99px; cursor: pointer; overflow: hidden; }
  html[data-theme="light"] .fw-bar { background: rgba(0,0,0,.18); }
  #fw-fill { height: 100%; width: 0; background: #6ba6ff; border-radius: 99px; }
  .fw-controls { display: flex; align-items: center; gap: 2px; }
  .fw-btn { width: 32px; height: 32px; border: none; background: none; color: inherit; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .fw-btn:hover { background: rgba(255,255,255,.1); }
  .fw-play { width: 38px; height: 38px; background: #4d8df0; color: #fff; border-radius: 12px; }
  html[data-theme="light"] .fw-play { background: #2f6ed0; color: #fff; }
  .fw-btn .ic { width: 16px; height: 16px; fill: currentColor; display: block; }
  .hidden { display: none !important; }
`;

function widgetDocs() {
  const docs = [document];
  if (Player.pipWin && !Player.pipWin.closed) docs.push(Player.pipWin.document);
  return docs;
}
function syncFloatWidget() {
  const s = Player.current;
  const playing = Player.ready && PB.state() === YT.PlayerState.PLAYING;
  const ic = icon(playing ? 'i-pause' : 'i-play');
  for (const doc of widgetDocs()) {
    const art = doc.getElementById('fw-art');
    const title = doc.getElementById('fw-title');
    const artist = doc.getElementById('fw-artist');
    const play = doc.querySelector('[data-fw="play"]');
    if (art && s) art.src = safeCover(s.thumbnail) || COVER_PH;
    if (title) title.textContent = s ? s.title : '—';
    if (artist) artist.textContent = s ? (s.artist || s.subtitle || '') : '—';
    if (play) play.innerHTML = ic;
  }
  $('#mini-float')?.classList.toggle('on', Player.floatOn);
  $('#np-float')?.classList.toggle('on', Player.floatOn);
  syncNpMore();
  if (s && s.thumbnail) loadPipArt(s.thumbnail);
}
function syncFloatLyric(text) {
  const t = text || '';
  for (const doc of widgetDocs()) {
    const el = doc.getElementById('fw-lyric');
    if (el) el.textContent = t;
  }
}
function syncFloatProgress(pct) {
  for (const doc of widgetDocs()) {
    const fill = doc.getElementById('fw-fill');
    if (fill) fill.style.width = (pct || 0) + '%';
  }
}
function bindFloatWidget(rootDoc) {
  const root = rootDoc.getElementById('float-widget');
  if (!root || root._fwBound) return;
  root._fwBound = true;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fw]');
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.fw;
    if (act === 'play') togglePlay();
    else if (act === 'prev') prevTrack();
    else if (act === 'next') nextTrack(false);
    else if (act === 'close') closeFloatWidget();
  });
  root.querySelector('#fw-bar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!Player.yt || !Player.ready) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const dur = PB.duration() || 0;
    if (dur) PB.seek(frac * dur, true);
  });
  root.querySelector('#fw-art')?.addEventListener('dblclick', () => {
    closeNowPlaying();
    openNowPlaying();
  });
  root.querySelector('#fw-lyric')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openNowPlaying();
    switchNPTab('lyrics');
  });
}

function enableDrag(el) {
  if (el._fwDrag) return;
  el._fwDrag = true;
  const saved = store.get('fw_pos', null);
  if (saved && Number.isFinite(saved.l) && Number.isFinite(saved.t)) {
    el.style.left = saved.l + 'px';
    el.style.top = saved.t + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  } else {
    el.style.right = '16px';
    el.style.bottom = '24px';
    el.style.left = 'auto';
    el.style.top = 'auto';
  }
  let drag = null;
  const down = (e) => {
    if (e.target.closest('button, .fw-bar')) return;
    const r = el.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    drag = { dx: pt.clientX - r.left, dy: pt.clientY - r.top };
    el.classList.add('dragging');
  };
  const move = (e) => {
    if (!drag) return;
    const pt = e.touches ? e.touches[0] : e;
    const x = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, pt.clientX - drag.dx));
    const y = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, pt.clientY - drag.dy));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    if (e.cancelable) e.preventDefault();
  };
  const up = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    const r = el.getBoundingClientRect();
    store.set('fw_pos', { l: r.left, t: r.top });
  };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  el.addEventListener('touchstart', down, { passive: true });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);
}

async function openPipWidget() {
  if (!('documentPictureInPicture' in window)) return false;
  try {
    if (Player.pipWin && !Player.pipWin.closed) { Player.pipWin.close(); Player.pipWin = null; }
    const pip = await documentPictureInPicture.requestWindow({ width: 400, height: 120 });
    Player.pipWin = pip;
    pip.document.documentElement.setAttribute('data-theme', currentTheme());
    const st = pip.document.createElement('style');
    st.textContent = FW_CSS;
    pip.document.head.appendChild(st);
    const sprite = document.querySelector('body > svg');
    if (sprite) pip.document.body.appendChild(sprite.cloneNode(true));
    const widget = $('#float-widget').cloneNode(true);
    widget.id = 'float-widget';
    widget.classList.remove('hidden');
    widget.style.cssText = '';
    pip.document.body.appendChild(widget);
    bindFloatWidget(pip.document);
    syncFloatWidget();
    syncFloatLyric(currentLyricText());
    pip.addEventListener('pagehide', () => {
      Player.pipWin = null;
      if (Player.floatOn) closeFloatWidget();
    });
    return true;
  } catch {
    return false;
  }
}


let pipArtImg = null;
let pipArtSrc = '';
function loadPipArt(url) {
  if (!url || url === pipArtSrc) return;
  pipArtSrc = url;
  const img = new Image();
  img.onload = () => { pipArtImg = img; drawPipFrame(); };
  img.onerror = () => { pipArtImg = null; };
  img.src = '/api/thumb?url=' + encodeURIComponent(url);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function currentLyricText() {
  const L = Player.lyrics;
  if (!L) return '';
  if (L.lines && L.lines.length) {
    let cur = 0;
    try { cur = PB.time(); } catch {}
    let idx = -1;
    for (let i = 0; i < L.lines.length; i++) {
      if (cur >= L.lines[i].t - 0.2) idx = i;
      else break;
    }
    return idx >= 0 ? (L.lines[idx].text || '') : '';
  }
  if (L.plain) return String(L.plain).split('\n').map((x) => x.trim()).find(Boolean) || '';
  return '';
}
/* What gets drawn in the picture in picture window on phones and tablets.
 *
 * There is no way to put HTML inside that window, so the card is painted onto
 * a canvas by hand to come as close as possible to the desktop widget:
 * artwork, title, artist, a progress bar and a note of what it is doing. The
 * buttons belong to the browser and appear over this picture when touched.
 */
function roundedBox(ctx, x, y, w, h, r) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function clipText(ctx, teks, maksLebar) {
  let t = String(teks || '');
  if (ctx.measureText(t).width <= maksLebar) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maksLebar) t = t.slice(0, -1);
  return t + '…';
}

function drawPipFrame(pct) {
  const canvas = $('#pip-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const s = Player.current;
  if (s && s.thumbnail) loadPipArt(s.thumbnail);

  // background: the artwork, blurred and then dimmed
  ctx.fillStyle = '#0a1220';
  ctx.fillRect(0, 0, w, h);
  if (pipArtImg) {
    ctx.save();
    ctx.filter = 'blur(28px)';
    ctx.globalAlpha = 0.5;
    const sc = Math.max(w / pipArtImg.width, h / pipArtImg.height) * 1.3;
    const dw = pipArtImg.width * sc, dh = pipArtImg.height * sc;
    ctx.drawImage(pipArtImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
    ctx.fillStyle = 'rgba(7,12,22,0.72)';
    ctx.fillRect(0, 0, w, h);
  }

  const pad = 22;
  const artSize = 112;
  const artX = pad, artY = 40;

  // artwork
  ctx.save();
  roundRect(ctx, artX, artY, artSize, artSize, 12);
  ctx.clip();
  if (pipArtImg) {
    const sc = Math.max(artSize / pipArtImg.width, artSize / pipArtImg.height);
    const dw = pipArtImg.width * sc, dh = pipArtImg.height * sc;
    ctx.drawImage(pipArtImg, artX + (artSize - dw) / 2, artY + (artSize - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#162034';
    ctx.fillRect(artX, artY, artSize, artSize);
  }
  ctx.restore();

  // title and artist
  const tx = artX + artSize + 18;
  const maxW = w - tx - pad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 26px "Plus Jakarta Sans", Segoe UI, sans-serif';
  ctx.fillText(clipText(ctx, (s && displayTitle(s.title)) || 'AR Music', maxW), tx, artY + 36);
  ctx.fillStyle = 'rgba(233,239,249,0.72)';
  ctx.font = '600 18px "Plus Jakarta Sans", Segoe UI, sans-serif';
  ctx.fillText(clipText(ctx, (s && (s.artist || s.subtitle)) || '', maxW), tx, artY + 64);

  // penanda keadaan, jeda atau berjalan
  const berjalan = !document.body.classList.contains('paused');
  ctx.fillStyle = berjalan ? '#6ba6ff' : 'rgba(233,239,249,0.55)';
  const iy = artY + 92;
  if (berjalan) {
    ctx.fillRect(tx, iy - 12, 5, 16);
    ctx.fillRect(tx + 9, iy - 12, 5, 16);
  } else {
    ctx.beginPath();
    ctx.moveTo(tx, iy - 13);
    ctx.lineTo(tx + 15, iy - 4);
    ctx.lineTo(tx, iy + 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(233,239,249,0.55)';
  ctx.font = '700 14px "Plus Jakarta Sans", Segoe UI, sans-serif';
  ctx.fillText(berjalan ? 'Memutar' : 'Dijeda', tx + 24, iy + 2);

  // progress bar
  const barY = artY + artSize + 26;
  const barW = w - pad * 2;
  ctx.fillStyle = 'rgba(146,166,198,0.28)';
  roundedBox(ctx, pad, barY, barW, 6, 3);
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  if (p > 0) {
    ctx.fillStyle = '#6ba6ff';
    roundedBox(ctx, pad, barY, Math.max(6, barW * p), 6, 3);
  }

  // one line of lyric if there is one, filling the space that is left
  const baris = currentLyricText();
  if (baris) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(233,239,249,0.8)';
    ctx.font = '600 17px "Plus Jakarta Sans", Segoe UI, sans-serif';
    ctx.fillText(clipText(ctx, baris, w - pad * 2), w / 2, barY + 34);
  }
}

/* ---------- the canvas video behind picture in picture on phones ----------
 *
 * The window is built from a <video> element fed by a canvas we paint
 * ourselves, while the music comes out of the YouTube frame.
 *
 * Play and pause are NOT taken from this video's events. That was tried once
 * and the result was fatal: on a phone the browser pauses its own canvas video
 * the moment the page is hidden, that read as a pause command, and the music
 * died on the spot. On a tablet the video is not paused, so the symptom only
 * ever showed up on phones.
 *
 * The right route is Media Session, whose handlers are already registered in
 * setupMediaSession. The previous and next buttons that appear in the picture
 * in picture window are proof that this is the path Android uses; a plain
 * video element has no skip buttons at all.
 *
 * Two jobs are left here: keep the video running so the picture does not go
 * dead, and keep its state in step with the music so the browser does not
 * show the wrong thing.
 */
let _pipSelf = false;

function bindPipVideo(video) {
  if (!video || video._pipBound) return;
  video._pipBound = true;
  video.addEventListener('pause', () => {
    if (_pipSelf || !Player.floatOn) return;
    // Not a command from anyone, just the browser putting the video to sleep.
    // Start it again as long as the music is meant to be running.
    if (!Player.wantPlaying) return;
    _pipSelf = true;
    try { const r = video.play(); if (r && r.catch) r.catch(() => {}); } catch {}
    setTimeout(() => { _pipSelf = false; }, 0);
  });
}

/* Keeps the canvas video's state in step with the music. */
function syncPipVideo(playing) {
  const video = $('#pip-video');
  if (!video || !Player.floatOn || !video.srcObject) return;
  if (playing === !video.paused) return;
  _pipSelf = true;
  try {
    if (playing) { const r = video.play(); if (r && r.catch) r.catch(() => {}); }
    else video.pause();
  } catch {}
  setTimeout(() => { _pipSelf = false; }, 0);
}

async function startSystemPip() {
  const video = $('#pip-video');
  const canvas = $('#pip-canvas');
  if (!video || !canvas) return false;
  if (!document.pictureInPictureEnabled && !video.webkitSetPresentationMode) return false;
  // A phone still in its normal browser mode is the one place this window is
  // worse than nothing. The music cannot keep going behind it there at all,
  // and the controls the browser draws on a canvas stream do not reach the
  // player, so what opens is a window that looks like it should help and then
  // watches the track die. The in page bar below is at least honest about
  // what it can do.
  if (isPhoneDefaultMode()) return false;
  try {
    drawPipFrame(0);
    if (!video.srcObject) video.srcObject = canvas.captureStream(15);
    video.muted = true;
    video.playsInline = true;
    bindPipVideo(video);
    _pipSelf = true;
    await video.play();
    _pipSelf = false;
    // A few frames first, before the window is asked for. Without this the
    // window opens before the canvas has been painted and all anyone sees is
    // a black rectangle.
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      drawPipFrame(0);
    }
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
    if (video.requestPictureInPicture) {
      await video.requestPictureInPicture();
    } else if (video.webkitSetPresentationMode) {
      video.webkitSetPresentationMode('picture-in-picture');
    } else {
      return false;
    }
    // Closing the window means done. This used to keep widget mode on and
    // bring up the small in page bar instead, so closing the popup never put
    // things back the way they were.
    video.onleavepictureinpicture = () => {
      if (Player.floatOn) closeFloatWidget();
    };
    return true;
  } catch {
    return false;
  }
}

async function openFloatWidget() {
  // The widget follows whatever is running, so something has to be running.
  // Player.current alone is not enough: a queue restored from storage already
  // has a song in it that has never been played, and the window would open
  // with nothing to control.
  if (!Player.current || Player.cued) { toast(tr('toast.playFirst')); return; }
  Player.floatOn = true;
  closeNowPlaying();
  document.body.classList.add('float-mode');
  drawPipFrame();
  /* Urutannya penting.
   *
   * Document picture in picture comes first because that window holds our own
   * widget, play button, skip buttons and scrubber included. What used to come
   * first was the plain picture in picture holding a canvas of lyrics, and the
   * buttons in that window belong to the browser: for a canvas stream it
   * offers no play button at all, only a ten second skip that does nothing.
   * That was the window with no play button people kept running into.
   *
   * It also comes first because the request needs the permission carried by
   * the click that just happened, and that runs out while another attempt is
   * being waited on.
   *
   * The rest stay as fallbacks: the canvas for phone browsers that do not
   * support document picture in picture yet, then the small in page bar when
   * neither is available. */
  const el = $('#float-widget');
  const docOk = await openPipWidget();
  const sysOk = docOk ? false : await startSystemPip();
  if (docOk) {
    el.classList.add('hidden');
    toast(tr('toast.widgetDoc'));
  } else if (sysOk) {
    el.classList.add('hidden');
    toast(tr('toast.widgetPip'));
  } else {
    el.classList.remove('hidden');
    enableDrag(el);
    bindFloatWidget(document);
    toast(tr('toast.widgetInPage'));
  }
  syncFloatWidget();
}
function closeFloatWidget() {
  Player.floatOn = false;
  document.body.classList.remove('float-mode');
  $('#float-widget').classList.add('hidden');
  if (Player.pipWin && !Player.pipWin.closed) {
    try { Player.pipWin.close(); } catch {}
  }
  Player.pipWin = null;
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  const video = $('#pip-video');
  if (video) {
    if (video.webkitSetPresentationMode && video.webkitPresentationMode === 'picture-in-picture') {
      try { video.webkitSetPresentationMode('inline'); } catch {}
    }
    // no point painting the canvas once the window is gone
    try { video.pause(); } catch {}
  }
  syncFloatWidget();
}
function toggleFloatWidget() {
  if (Player.floatOn) closeFloatWidget();
  else openFloatWidget();
}

/* ---------- pointing phone and tablet browsers at the app ----------
 *
 * The web version cannot play in the background on a handheld (see the note
 * below for why), so rather than letting the music die quietly, say where the
 * version that can is. Shown only where it is both true and useful:
 *
 *   - A phone or tablet. A desktop browser already keeps playing, so there is
 *     nothing to offer there, whatever its user agent claims.
 *   - Android, because the download is an APK. There is no iOS build, and
 *     offering one that does not exist would be worse than staying quiet.
 *   - Not inside the app itself, which is already the answer.
 *   - Once. Dismissed is dismissed, remembered on the device.
 */
function isHandheld() {
  // Touch is what separates a phone or tablet from a desktop here. Screen
  // width would call a small window a phone, and the user agent alone would
  // fall for a desktop browser asked to request the desktop site.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return !!coarse || navigator.maxTouchPoints > 0;
}

/* A phone whose browser is still in its normal mode, as opposed to one that
 * has been asked for the desktop site. That distinction is the one that
 * decides whether background playback works at all, so it is worth being
 * precise about how it is read.
 *
 * Chrome on Android drops the "Mobile" token from its user agent the moment
 * the desktop site is requested, and a tablet never carries that token to
 * begin with. Touch rules out a desktop browser that merely has a narrow
 * window. Measured across four user agents:
 *
 *   phone, normal mode    touch, Mobile present   -> true
 *   phone, desktop site   touch, no Mobile        -> false
 *   tablet, normal mode   touch, no Mobile        -> false
 *   desktop               no touch, no Mobile     -> false
 *
 * Only the first of those is the case that cannot play in the background,
 * which is exactly the set this needs to name.
 */
function isPhoneDefaultMode() {
  return isHandheld() && /Mobile/i.test(navigator.userAgent);
}

/* Android phones and tablets whose browser is still in its normal mode.
 *
 * Wider than isPhoneDefaultMode above, and it has to be. That one wants the
 * Mobile token, and an Android tablet never sends it even in normal mode, so
 * tablets never got caught by it despite having the same problem and the same
 * way out.
 *
 * What is used here is the word Android, because asking for the desktop site
 * drops that word from the user agent entirely: Chrome swaps in a Linux
 * desktop user agent instead. Touch rules out a real desktop. Measured across
 * five cases:
 *
 *   phone, normal mode     touch, Android present  -> true
 *   tablet, normal mode    touch, Android present  -> true
 *   phone, desktop site    touch, no Android       -> false
 *   tablet, desktop site   touch, no Android       -> false
 *   real desktop           neither                 -> false
 *
 * An Android browser other than Chrome might keep the word Android on the
 * desktop site. The worst that costs is light: the guide shows up for someone
 * who already turned it on, and it can be closed.
 */
function isAndroidDefaultMode() {
  return isHandheld() && /Android/i.test(navigator.userAgent);
}

/* The one thing that genuinely works in a phone browser, and nobody knows how
 * to do it unless they are told. Deliberately numbered steps matching what is
 * on screen rather than an explanation, because all anyone needs here is to
 * know what to press. */
function openDesktopSiteGuide() {
  store.set('guide_seen', true);
  const modal = $('#modal');
  const body = $('#modal-body');
  const actions = $('.modal-actions');
  if (!modal || !body) return;
  $('#modal-title').textContent = tr('guide.title');
  if (actions) actions.classList.add('hidden');
  body.innerHTML = `<div class="guide">
      <p class="guide-line">${tr('guide.intro')}</p>
      <ol class="guide-steps">
        <li>${tr('guide.step1')}</li>
        <li>${tr('guide.step2')}</li>
        <li>${tr('guide.step3')}</li>
      </ol>
      <p class="guide-line">${tr('guide.outro')}</p>
      <div class="pl-form-actions">
        <a class="pill-btn" id="pd-apl" href="https://github.com/adiirmd/arMusic/releases/latest" target="_blank" rel="noopener">${icon('i-download')}<span>${tr('guide.androidApp')}</span></a>
        <button type="button" class="pill-btn primary" id="pd-ok">${tr('guide.gotIt')}</button>
      </div>
    </div>`;
  $('#pd-ok').addEventListener('click', closeModal);
  $('#pd-apl').addEventListener('click', closeModal);
  modal.classList.remove('hidden');
}

/* Confirmation that what someone just did worked. Without it they turn the
 * setting on and never find out whether they got it right. The marker is
 * cleared so this only ever says it once. */
function noticeDesktopSiteOn() {
  if (!store.get('guide_seen', false)) return;
  if (!isHandheld() || isAndroidDefaultMode()) return;
  store.set('guide_seen', false);
  store.set('appbanner_off', true);
  toast(tr('toast.desktopOn'));
}

function maybeShowAppBanner() {
  const el = $('#app-banner');
  if (!el) return;
  const worthOffering =
    isAndroidDefaultMode() &&
    !document.documentElement.classList.contains('in-app');
  if (!worthOffering || store.get('appbanner_off', false)) return;
  // On devices where background playback really does not work, lead with the
  // switch that settles it on the spot. Offering only the download means
  // telling someone to install an app for something their own browser menu
  // already handles. Holds for phones and tablets alike, since both are stuck
  // the same way while they stay in normal mode.
  const heading = el.querySelector('.ab-title');
  const sub = el.querySelector('.ab-sub');
  if (heading) heading.textContent = tr('banner.title');
  if (sub) sub.textContent = tr('banner.sub');
  el.classList.remove('hidden');
}
$('#ab-close')?.addEventListener('click', (e) => {
  e.stopPropagation();
  store.set('appbanner_off', true);
  $('#app-banner').classList.add('hidden');
});
// tapping through to the release is an answer too, so stop asking
$('#ab-get')?.addEventListener('click', (e) => { e.stopPropagation(); store.set('appbanner_off', true); });
// the whole banner opens the guide, not just one small button inside it
$('#app-banner')?.addEventListener('click', () => openDesktopSiteGuide());
$('#app-banner')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDesktopSiteGuide(); }
});
/* The app tags the page after load, so the check waits for that to land. */
window.addEventListener('load', () => setTimeout(() => {
  noticeDesktopSiteOn();
  maybeShowAppBanner();
}, 300));

/* ---------- the page is not on screen ----------
 *
 * What was tried, and what it settled, so nobody spends another evening on it:
 *
 *   - Desktop browser: a background tab keeps playing on its own, always has.
 *   - Phone browser asked for the desktop site: the music stops for a moment,
 *     the retry below gets it going again, and it carries on in the
 *     background. The notification controls work too. Same on a tablet, which
 *     never sends a phone user agent in the first place.
 *   - Phone browser in its normal mode: it stops and stays stopped. Every
 *     retry is refused. Giving the page a media element of its own does raise
 *     a working notification, and its buttons do reach this code, but asking
 *     to play from inside one of those handlers is refused just the same. That
 *     is the decisive test, because a notification press carries the user
 *     activation that no automatic retry has, and it still made no sound.
 *
 *   - The Android app, same phone and same YouTube frame, keeps playing. The
 *     only thing done differently there is that its WebView never reports
 *     itself hidden — see BackgroundWebView.
 *
 * Read together, those say the block is not the page being told it is hidden:
 * the desktop site case is hidden just the same and still plays. What differs
 * is only the user agent, and what reads the user agent is the embedded
 * player itself.
 *
 * The clearest evidence is what the notification bar shows. On the desktop
 * site a media notification appears and its play button works. In normal mode
 * nothing appears at all. That ordering matters and is easy to get backwards:
 * the notification is not missing because playback is blocked by some policy,
 * playback stopping is why the notification never exists. Chrome only raises
 * one for media that is actually running, so once the frame goes quiet there
 * is nothing to attach it to. Holding a media element of our own does raise
 * that notification, and it was still removed again: the note beside
 * assertMediaSession says what it settled and why keeping it was worse.
 *
 * The stopping itself is not something a page can talk its way out of. It
 * cannot set its own user agent, and the frame that makes the sound belongs
 * to another origin.
 *
 * Which leaves one idea, and it was built and measured on the device before
 * being removed again: stop letting the frame be the thing that makes the
 * sound, and play the audio from an element of our own instead, the way every
 * other music site does. Getting a file to feed that element has exactly two
 * possible sources, and both are closed.
 *
 *   - Fetching the audio ourselves. Six client types were tried from the real
 *     server. Two demand a device attestation only the official app can
 *     produce, three are told to sign in to prove they are not a robot
 *     because the address belongs to a data centre, and two are simply no
 *     longer served. No amount of code gets past either wall.
 *
 *   - The third party converter this app already uses for downloads. It does
 *     hand back a file, but it cannot feed a player. It answers no cross
 *     origin request, so the file cannot be read and handed over as one
 *     piece. It serves no partial requests, so streaming it survives only
 *     until the first jump in position and then falls to nothing, which is
 *     the stutter that was heard. Its m4a never delivered a single byte to
 *     the element. And every file takes between fourteen and thirty seconds
 *     to prepare, which is a wait nobody should be asked to sit through
 *     before a song starts.
 *
 * So the honest things left are what this code does: keep asking while the
 * tab is hidden, because on the desktop site that is what makes it work; pick
 * playback back up on return; and say plainly which switch fixes it rather
 * than let the music die without explanation.
 */
const BG_RESUME_MAX = 8;
let bgResumeTries = 0;
let bgHintShown = false;

/* Pushing the YouTube frame to start again only makes sense where that is
 * actually allowed, which is the desktop site and anything that is not a
 * phone. On a phone in normal mode the request is always refused, and pressing
 * it over and over is worse than pointless: every attempt lets out a fragment
 * of sound before being stopped again, so what people hear is a stutter. Far
 * better to stay quiet. */
function mayForceResume() {
  return !isPhoneDefaultMode();
}

function resumeIfBackgroundPause(state) {
  if (!document.hidden || !Player.wantPlaying || Player.cued) return;
  if (state !== YT.PlayerState.PAUSED) return;
  if (!mayForceResume()) return;
  if (bgResumeTries >= BG_RESUME_MAX) return;
  bgResumeTries++;
  try { PB.play(); } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    bgResumeTries = 0;
    // kesempatan terakhir menjadi pemilik sesi media sebelum notifikasinya
    // dipakai, lihat catatan di assertMediaSession
    assertMediaSession();
    return;
  }
  // timers are throttled in the background, so the UI is stale on return
  syncPlaybackUI();
  renderPlayButtons();

  // Back on screen with a track that should be running but is not. The pause
  // came from the browser, not from the listener — wantPlaying says so — and
  // the page is allowed to play again now that it is visible, so carry on from
  // where it stopped instead of making someone hunt for the play button.
  let st = -1;
  try { st = PB.state(); } catch {}
  if (Player.wantPlaying && !Player.cued && st === YT.PlayerState.PAUSED) {
    try { PB.play(); } catch {}
    // Say why it happened, once on this device. Nagging about it every time
    // someone checks a message would be worse than the silence was.
    /* This is the most useful second to explain it, because it is exactly when
       someone runs into the problem themselves. It used to be a toast, which
       vanished before it could be read and never said how to fix it. Once per
       device only: nagging every time someone checks a message would be worse
       than the silence it replaced. */
    if (!bgHintShown && !store.get('bgnote', false) && isAndroidDefaultMode()
        && !document.documentElement.classList.contains('in-app')) {
      bgHintShown = true;
      store.set('bgnote', true);
      openDesktopSiteGuide();
    }
  }
  bgResumeTries = 0;
});

// Backstop for a browser that pauses without reporting a state change.
setInterval(() => {
  if (!Player.yt || !Player.ready) return;
  if (!document.hidden) { bgResumeTries = 0; return; }
  if (!Player.wantPlaying || Player.cued) return;
  if (!mayForceResume()) return;
  if (bgResumeTries >= BG_RESUME_MAX) return;
  let st = -1;
  try { st = PB.state(); } catch { return; }
  if (st === YT.PlayerState.PAUSED) {
    bgResumeTries++;
    try { PB.play(); } catch {}
  } else if (st === YT.PlayerState.PLAYING) {
    bgResumeTries = 0;
  }
}, 1500);


/* cleanup: unregister any previously installed service worker */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  // this app never touches the Cache API, so anything left in here belongs to
  // an older version and can go entirely
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}

/* boot */
(() => {
  const splash = $('#splash');
  if (!splash) return;
  const hide = () => {
    if (splash.classList.contains('gone')) return;
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 700);
  };
  window.addEventListener('load', () => setTimeout(hide, 1500));
  setTimeout(hide, 2800);
})();
I18N.applyStaticText();
updateLangButton();
notifyNativeLanguage();
renderNav();
setupMediaSession();
updateThemeIcon();
$('#theme-toggle').addEventListener('click', toggleTheme);
$('#lang-toggle').addEventListener('click', toggleLang);
$('#tb-search').addEventListener('click', () => go('#/search'));
$('#np-sb').classList.toggle('on', Player.sbEnabled);
updateQualityButton();
syncNpMore();
bindFloatWidget(document);
enableDrag($('#float-widget'));
const savedVol = store.get('vol', 100);
$('#mini-volume').value = savedVol;
$('#np-volume').value = savedVol;
updateVolumeIcon();
$('#mini-volume').addEventListener('change', (e) => store.set('vol', Number(e.target.value)));
$('#np-volume').addEventListener('change', (e) => store.set('vol', Number(e.target.value)));
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG') return;
  if (el.classList.contains('logo-img') || el.closest('#splash')) return;
  if (el.id === 'mini-art' || el.id === 'np-art' || el.id === 'fw-art') {
    if (el.src && !el.src.startsWith('data:')) el.src = COVER_PH;
    return;
  }
  if (el.dataset.fb) return;
  el.dataset.fb = '1';
  const ph = document.createElement('div');
  ph.className = 'art-ph';
  if (el.classList.contains('pl-pick-art')) ph.classList.add('pl-pick-ph');
  if (el.closest('.track')) ph.classList.add('art-ph-track');
  else if (el.closest('.quick-card')) ph.classList.add('art-ph-quick');
  else if (el.closest('.sr-top')) ph.classList.add('art-ph-sr');
  else if (el.closest('.lib-row')) ph.classList.add('art-ph-lib');
  else if (el.closest('.sm-head')) ph.classList.add('art-ph-sm');
  else if (el.closest('.detail-head')) ph.classList.add('detail-ph');
  ph.innerHTML = icon('i-note');
  el.replaceWith(ph);
}, true);
window.addEventListener('pagehide', persistQueue);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistQueue(); });
restoreQueue();
route();
