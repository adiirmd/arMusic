/* AR Music — wording for both languages.
 *
 * Kept out of app.js on purpose. That file is already four thousand lines, and
 * a two language dictionary would bury the code it belongs to. Nothing here
 * runs logic; it only holds words and hands them out.
 *
 * English is what everyone gets until they choose otherwise. Picking a
 * language is a deliberate act, so it is remembered on the device and never
 * guessed from the browser.
 *
 * House rules for the wording:
 *   - No dashes anywhere in what people read.
 *   - Indonesian should sound like a person talking, not like English with the
 *     words swapped. Where a real Indonesian word exists it is used, so
 *     playlist becomes "daftar putar" and queue becomes "antrean".
 *   - Names stay names. AR Music, YouTube Music, SponsorBlock and LRCLIB are
 *     not translated in either direction.
 */

const LANGS = ['en', 'id'];
const LANG_LABEL = { en: 'EN', id: 'ID' };

const DICT = {
  en: {
    /* ---------- navigation and chrome ---------- */
    'nav.home': 'Home',
    'nav.search': 'Search',
    'nav.charts': 'Charts',
    'nav.library': 'Your Library',
    'nav.back': 'Go back',
    'nav.forward': 'Go forward',
    'nav.theme': 'Switch theme',
    'nav.language': 'Language',
    'nav.searchHint': 'What do you want to play?',
    'nav.tagline': 'Music For Everyone',
    'nav.newPlaylist': 'New playlist',
    'nav.importYt': 'Import from YT Music',
    'nav.yourPlaylists': 'Your playlists',
    'nav.likedSongs': 'Liked Songs',

    /* ---------- player ---------- */
    'player.play': 'Play',
    'player.playPause': 'Play or pause',
    'player.previous': 'Previous',
    'player.next': 'Next',
    'player.shuffle': 'Shuffle',
    'player.repeat': 'Repeat',
    'player.favorite': 'Favorite',
    'player.mute': 'Mute',
    'player.queue': 'Queue',
    'player.nowPlaying': 'Now playing',
    'player.minimize': 'Minimize',
    'player.sleepTimer': 'Sleep timer',
    'player.widget': 'Floating widget',
    'player.closeWidget': 'Close widget',
    'player.floatingPlayer': 'Floating player',
    'player.speed': 'Playback speed',
    'player.quality': 'Quality',
    'player.qualityHint': 'YouTube Music audio. Tap for YouTube max quality',
    'player.sbHint': 'Skip sponsors automatically',
    'player.download': 'Download',
    'player.share': 'Share',
    'player.more': 'More',
    'player.playNext': 'Play next',
    'player.addToQueue': 'Add to queue',
    'player.playlist': 'Playlist',
    'player.playAll': 'Play all',
    'player.openLyrics': 'Open lyrics',

    /* ---------- now playing tabs ---------- */
    'tab.song': 'Song',
    'tab.lyrics': 'Lyrics',
    'tab.queue': 'Queue',
    'tab.queueCount': 'Queue · {n}',
    'tab.related': 'Related',

    /* ---------- lyrics ---------- */
    'lyrics.none': 'No lyrics yet',
    'lyrics.looking': 'Looking for lyrics…',
    'lyrics.notFound': 'No lyrics found for this track',
    'lyrics.earlier': 'Nudge lyrics earlier',
    'lyrics.later': 'Nudge lyrics later',

    /* ---------- queue ---------- */
    'queue.title': 'Your queue',
    'queue.empty': 'Queue is empty',
    'queue.clear': 'Clear',

    /* ---------- home and browse ---------- */
    'home.jumpBackIn': 'Jump back in',
    'home.recentlyPlayed': 'Recently played',
    'home.moods': 'Moods and genres',
    'home.browseAll': 'Browse all',
    'home.morning': 'Good morning',
    'home.afternoon': 'Good afternoon',
    'home.evening': 'Good evening',
    'home.mixForYou': 'Mix for you · based on “{title}”',

    /* ---------- search ---------- */
    'search.placeholder': 'Songs, artists, albums or playlists',
    'search.recent': 'Recent searches',
    'search.searching': 'Searching…',
    'search.topResult': 'Top result',
    'search.songs': 'Songs',
    'search.artists': 'Artists',
    'search.albums': 'Albums',
    'search.playlists': 'Playlists',
    'search.videos': 'Videos',
    'search.more': 'More',
    'search.all': 'All',

    /* ---------- library ---------- */
    'lib.playlists': 'Playlists',
    'lib.favorites': 'Favorites',
    'lib.historyTab': 'History',
    'lib.statsTab': 'Stats',
    'lib.liked': 'Liked songs',
    'lib.history': 'Recently played',
    'lib.saved': 'Saved',
    'lib.stats': 'Listening stats',
    'lib.backup': 'Backup',
    'lib.restore': 'Restore',
    'lib.save': 'Save',
    'lib.saved.done': 'Saved',
    'lib.thisDeviceOnly': 'This device only',

    /* ---------- stats ---------- */
    'stats.minutes': 'Minutes listened',
    'stats.plays': 'Total plays',
    'stats.unique': 'Unique songs',
    'stats.topArtists': 'Top artists',
    'stats.mostPlayed': 'Most played',

    /* ---------- table headers ---------- */
    'col.title': 'Title',
    'col.time': 'Time',

    /* ---------- modals and forms ---------- */
    'modal.close': 'Close',
    'modal.cancel': 'Cancel',
    'modal.create': 'Create',
    'modal.createAndAdd': 'Create and add',
    'modal.cancelTimer': 'Cancel timer',
    'modal.customMinutes': 'Or type the minutes',
    'modal.minutesHint': 'for example 20',
    'modal.minutes': '{n} min',
    'modal.delete': 'Delete',
    'modal.rename': 'Rename',
    'modal.start': 'Start',
    'modal.import': 'Import',
    'modal.importing': 'Importing…',
    'modal.chooseFile': 'Choose file',
    'modal.link': 'Link',
    'modal.tryAgain': 'Try again',
    'modal.addToPlaylist': 'Add to playlist',
    'modal.createPlaylist': 'Create playlist',
    'modal.renamePlaylist': 'Rename playlist',
    'modal.deletePlaylist': 'Delete playlist',
    'modal.playlistName': 'Playlist name',
    'modal.importTitle': 'Import from YouTube Music',
    'modal.sleepTitle': 'Sleep timer',
    'modal.backupTitle': 'Back up your library',
    'modal.restoreTitle': 'Restore your library',
    'modal.downloadBackup': 'Download backup',
    'modal.song': 'Song',
    'modal.more': 'More',
    'modal.backupHint': 'Saves a file with your playlists, favorites, history and settings. Keep it somewhere safe.',
    'modal.restoreHint': 'This replaces everything you have now. Playlists and favorites on this device will be written over.',
    'modal.deleteHint': 'Delete "{name}"? This cannot be undone. The songs themselves stay on YouTube Music.',
    'modal.importHint': 'Paste a public YouTube Music playlist, album, artist or song link.',
    'modal.sleepHint': 'The music pauses once the time is up.',
    'modal.sleepRunning': 'A timer is already running. Pick a new time to replace it.',
    'modal.createHint': 'Give it a name. You can add songs whenever you like.',

    /* ---------- toasts ---------- */
    'toast.addedFavorites': 'Added to favorites',
    'toast.removedFavorites': 'Removed from favorites',
    'toast.addedPlaylist': 'Added to playlist',
    'toast.addedTo': 'Added to "{name}"',
    'toast.created': 'Created "{name}"',
    'toast.imported': 'Imported "{name}" ({songs})',
    'toast.addedQueue': 'Added to your queue',
    'toast.alreadyQueue': 'Already in your queue',
    'toast.playingNext': 'Playing next',
    'toast.queueCleared': 'Queue cleared',
    'toast.playlistDeleted': 'Playlist deleted',
    'toast.playlistRenamed': 'Playlist renamed',
    'toast.savedLibrary': 'Saved to your library',
    'toast.removedLibrary': 'Removed from your library',
    'toast.linkCopied': 'Link copied',
    'toast.resolving': 'Opening link…',
    'toast.noTracks': 'No songs found. The playlist may be private.',
    'toast.imported': 'Imported "{name}" with {n} songs',
    'toast.importFailed': 'Import failed: {msg}',
    'toast.backupDownloaded': 'Backup saved',
    'toast.libraryRestored': 'Library restored',
    'toast.restoreFailed': 'Restore failed: {msg}',
    'toast.restoreUnreadable': 'Restore failed, that file could not be read',
    'toast.preparing': 'Preparing "{title}" in 320kbps MP3…',
    'toast.converting': 'Converting "{title}"… {pct}%',
    'toast.downloading': 'Downloading "{title}"…',
    'toast.downloadStarted': 'Download started',
    'toast.downloadFailed': 'Download failed, try again in a moment',
    'toast.alreadyDownloading': 'Already downloading this song',
    'toast.trackUnavailable': 'This song is unavailable, skipping',
    'toast.sleepIn': 'Sleeping in {n} min',
    'toast.sleepCancelled': 'Sleep timer cancelled',
    'toast.sleepPaused': 'Sleep timer paused the music',
    'toast.speed': 'Speed {n}×',
    'toast.sbOn': 'SponsorBlock on',
    'toast.sbOff': 'SponsorBlock off',
    'toast.sbSegments': 'SponsorBlock will skip {n} part of this song|SponsorBlock will skip {n} parts of this song',
    'toast.sbSkipped': 'Skipped {what} with SponsorBlock',
    'toast.playFirst': 'Play a song first',
    'toast.widgetDoc': 'Widget opened, it stays on top of other windows',
    'toast.widgetPip': 'Widget on, open another app and the music keeps going',
    'toast.widgetInPage': 'Widget on, drag it wherever you like',
    'toast.qualityHigh': 'Highest quality on, uses more data',
    'toast.qualityNormal': 'Normal quality on',
    'toast.desktopOn': 'Desktop site is on. The music keeps playing when you switch apps now.',

    /* ---------- empty states ---------- */
    'empty.notFound': 'Page not found',
    'empty.notFound.sub': 'That link does not exist, or the page was taken down.',
    'empty.goHome': 'Go home',
    'empty.failed': 'Could not load this',
    'empty.failed.sub': 'Something went wrong on the way.',
    'empty.noResults': 'Nothing found',
    'empty.noResults.sub': 'Try another spelling, or a different artist, song or playlist.',
    'empty.moods': 'Could not load moods',
    'empty.moods.sub': 'Check your connection and give it another go.',
    'empty.retry': 'Try again',
    'empty.searchFailed': 'Search failed',
    'empty.searchFailed.sub': 'Give it another go in a moment.',
    'empty.charts': 'No charts right now',
    'empty.charts.sub': 'Give it another go in a moment.',
    'empty.stats': 'Nothing to show yet',
    'empty.stats.sub': 'Play some music. The numbers build up as you listen.',
    'empty.browseHome': 'Go to home',
    'empty.liked': 'No liked songs yet',
    'empty.liked.sub': 'Tap the heart on any song and it lands here.',
    'empty.findSongs': 'Find songs',
    'empty.history': 'Nothing played yet',
    'empty.history.sub': 'Songs you play will show up here.',
    'empty.saved': 'Nothing saved yet',
    'empty.saved.sub': 'Open any album, playlist or artist and tap Save.',
    'empty.browseMoods': 'Browse moods',
    'empty.playlists': 'No playlists yet',
    'empty.playlists.sub': 'Use New playlist above, or bring one over from YouTube Music.',
    'empty.playlistGone': 'Playlist not found',
    'empty.playlistGone.sub': 'It may have been deleted.',
    'empty.yourLibrary': 'Your Library',
    'empty.playlistEmpty': 'This playlist is empty',
    'empty.playlistEmpty.sub': 'Open any song and tap Playlist to put it here.',
    'empty.nothingHere': 'Nothing here',
    'empty.nothingHere.sub': 'This page has no songs or albums yet.',
    'empty.libraryEmpty': 'Your library is empty',
    'empty.relatedFailed': 'Could not load related songs',

    /* ---------- desktop site guide ---------- */
    'guide.title': 'Keep the music going',
    'guide.intro': 'Phone browsers stop the music the moment you leave the tab. One browser setting turns that off, and you only need to switch it on once.',
    'guide.step1': 'Tap the three dots in the top right of your browser',
    'guide.step2': 'Look for <b>Desktop site</b>',
    'guide.step3': 'Tick it, and this page will reload on its own',
    'guide.outro': 'After that the music keeps playing when you switch apps, and the buttons in your notification bar work. Your browser remembers this for AR Music only, so you will not have to do it again.',
    'guide.gotIt': 'Got it',
    'guide.androidApp': 'Android app',
    'banner.title': 'Music stops when you switch apps',
    'banner.sub': 'Turn on Desktop site in your browser menu and the music keeps going. Tap to see how.',
    'banner.how': 'See how',
    'banner.close': 'Close',

    /* ---------- misc ---------- */
    'misc.loading': 'Loading…',
    'misc.songs': '{n} song|{n} songs',
    'misc.clear': 'Clear',
    'misc.moveUp': 'Move up',
    'misc.moveDown': 'Move down',
    'misc.removeQueue': 'Remove from queue',
    'misc.remove': 'Remove',
    'misc.scrollLeft': 'Scroll left',
    'misc.scrollRight': 'Scroll right',
    'misc.newPlaylistName': 'Name for the new playlist',
    'misc.myPlaylist': 'My playlist',
    'misc.goToArtist': 'Go to artist',
    'misc.importedPlaylist': 'Imported playlist',
    'misc.noPlaylistsYet': 'No playlists yet',
    'queue.nowHead': 'Now playing',
    'queue.yourQueueCount': 'Your queue · {n}',
    'queue.hint': 'Nothing queued yet. Tap the queue icon on a song, or Play next on Now Playing.',
    'lib.emptyHint': 'Like songs, save albums and artists, or open Your Library to make a playlist',
    'lib.title': 'Library',
    'pl.local': 'Local playlist',
    'stats.artists': 'Artists',
    'more.widgetOn': 'Widget on',
    'more.speed': 'Speed · {n}×',
    'more.qualityMax': 'Quality · Max',
    'more.qualityYtm': 'Quality · YouTube Music',
    'more.sbOn': 'SponsorBlock on',
    'more.sb': 'SponsorBlock',
    'misc.error': 'Something went wrong.',
  },

  id: {
    /* ---------- navigation ---------- */
    'nav.home': 'Beranda',
    'nav.search': 'Cari',
    'nav.charts': 'Tangga Lagu',
    'nav.library': 'Koleksi Kamu',
    'nav.back': 'Kembali',
    'nav.forward': 'Maju',
    'nav.theme': 'Ganti tema',
    'nav.language': 'Bahasa',
    'nav.searchHint': 'Mau dengar apa hari ini?',
    'nav.tagline': 'Musik Untuk Semua',
    'nav.newPlaylist': 'Daftar putar baru',
    'nav.importYt': 'Ambil dari YT Music',
    'nav.yourPlaylists': 'Daftar putar kamu',
    'nav.likedSongs': 'Lagu Favorit',

    /* ---------- player ---------- */
    'player.play': 'Putar',
    'player.playPause': 'Putar atau jeda',
    'player.previous': 'Sebelumnya',
    'player.next': 'Berikutnya',
    'player.shuffle': 'Acak',
    'player.repeat': 'Ulang',
    'player.favorite': 'Favorit',
    'player.mute': 'Bisukan',
    'player.queue': 'Antrean',
    'player.nowPlaying': 'Sedang diputar',
    'player.minimize': 'Perkecil',
    'player.sleepTimer': 'Matikan otomatis',
    'player.widget': 'Pemutar mengambang',
    'player.closeWidget': 'Tutup pemutar mengambang',
    'player.floatingPlayer': 'Pemutar mengambang',
    'player.speed': 'Kecepatan putar',
    'player.quality': 'Kualitas',
    'player.qualityHint': 'Audio YouTube Music. Ketuk untuk kualitas tertinggi YouTube',
    'player.sbHint': 'Lewati bagian sponsor otomatis',
    'player.download': 'Unduh',
    'player.share': 'Bagikan',
    'player.more': 'Lainnya',
    'player.playNext': 'Putar setelah ini',
    'player.addToQueue': 'Tambah ke antrean',
    'player.playlist': 'Daftar putar',
    'player.playAll': 'Putar semua',
    'player.openLyrics': 'Buka lirik',

    /* ---------- now playing tabs ---------- */
    'tab.song': 'Lagu',
    'tab.lyrics': 'Lirik',
    'tab.queue': 'Antrean',
    'tab.queueCount': 'Antrean · {n}',
    'tab.related': 'Serupa',

    /* ---------- lyrics ---------- */
    'lyrics.none': 'Belum ada lirik',
    'lyrics.looking': 'Mencari lirik…',
    'lyrics.notFound': 'Lirik lagu ini tidak ketemu',
    'lyrics.earlier': 'Majukan lirik',
    'lyrics.later': 'Mundurkan lirik',

    /* ---------- queue ---------- */
    'queue.title': 'Antrean kamu',
    'queue.empty': 'Antrean masih kosong',
    'queue.clear': 'Kosongkan',

    /* ---------- home ---------- */
    'home.jumpBackIn': 'Lanjut dengar',
    'home.recentlyPlayed': 'Baru diputar',
    'home.moods': 'Suasana dan genre',
    'home.browseAll': 'Lihat semua',
    'home.morning': 'Selamat pagi',
    'home.afternoon': 'Selamat siang',
    'home.evening': 'Selamat malam',
    'home.mixForYou': 'Racikan buat kamu · dari “{title}”',

    /* ---------- search ---------- */
    'search.placeholder': 'Lagu, penyanyi, album, atau daftar putar',
    'search.recent': 'Pencarian terakhir',
    'search.searching': 'Mencari…',
    'search.topResult': 'Paling cocok',
    'search.songs': 'Lagu',
    'search.artists': 'Penyanyi',
    'search.albums': 'Album',
    'search.playlists': 'Daftar putar',
    'search.videos': 'Video',
    'search.more': 'Lainnya',
    'search.all': 'Semua',

    /* ---------- library ---------- */
    'lib.playlists': 'Daftar putar',
    'lib.favorites': 'Favorit',
    'lib.historyTab': 'Riwayat',
    'lib.statsTab': 'Rekap',
    'lib.liked': 'Lagu favorit',
    'lib.history': 'Baru diputar',
    'lib.saved': 'Disimpan',
    'lib.stats': 'Rekap dengar',
    'lib.backup': 'Cadangkan',
    'lib.restore': 'Pulihkan',
    'lib.save': 'Simpan',
    'lib.saved.done': 'Tersimpan',
    'lib.thisDeviceOnly': 'Hanya di perangkat ini',

    /* ---------- stats ---------- */
    'stats.minutes': 'Menit didengar',
    'stats.plays': 'Total putar',
    'stats.unique': 'Lagu berbeda',
    'stats.topArtists': 'Penyanyi teratas',
    'stats.mostPlayed': 'Paling sering diputar',

    /* ---------- table headers ---------- */
    'col.title': 'Judul',
    'col.time': 'Durasi',

    /* ---------- modals and forms ---------- */
    'modal.close': 'Tutup',
    'modal.cancel': 'Batal',
    'modal.create': 'Buat',
    'modal.createAndAdd': 'Buat lalu tambahkan',
    'modal.cancelTimer': 'Batalkan',
    'modal.customMinutes': 'Atau tulis sendiri menitnya',
    'modal.minutesHint': 'misalnya 20',
    'modal.minutes': '{n} menit',
    'modal.delete': 'Hapus',
    'modal.rename': 'Ganti nama',
    'modal.start': 'Mulai',
    'modal.import': 'Ambil',
    'modal.importing': 'Mengambil…',
    'modal.chooseFile': 'Pilih berkas',
    'modal.link': 'Tautan',
    'modal.tryAgain': 'Coba lagi',
    'modal.addToPlaylist': 'Tambah ke daftar putar',
    'modal.createPlaylist': 'Buat daftar putar',
    'modal.renamePlaylist': 'Ganti nama daftar putar',
    'modal.deletePlaylist': 'Hapus daftar putar',
    'modal.playlistName': 'Nama daftar putar',
    'modal.importTitle': 'Ambil dari YouTube Music',
    'modal.sleepTitle': 'Matikan otomatis',
    'modal.backupTitle': 'Cadangkan koleksi kamu',
    'modal.restoreTitle': 'Pulihkan koleksi kamu',
    'modal.downloadBackup': 'Unduh cadangan',
    'modal.song': 'Lagu',
    'modal.more': 'Lainnya',
    'modal.backupHint': 'Menyimpan satu berkas berisi daftar putar, lagu favorit, riwayat, dan pengaturan kamu. Taruh di tempat yang aman.',
    'modal.restoreHint': 'Ini menimpa semua yang ada sekarang. Daftar putar dan lagu favorit di perangkat ini akan tertulis ulang.',
    'modal.deleteHint': 'Hapus "{name}"? Sekali dihapus tidak bisa dikembalikan. Lagunya sendiri tetap ada di YouTube Music.',
    'modal.importHint': 'Tempel tautan daftar putar, album, penyanyi, atau lagu YouTube Music yang bisa diakses umum.',
    'modal.sleepHint': 'Musiknya dijeda begitu waktunya habis.',
    'modal.sleepRunning': 'Sudah ada waktu yang berjalan. Pilih waktu baru untuk menggantinya.',
    'modal.createHint': 'Kasih nama dulu. Lagunya bisa ditambahkan kapan saja.',

    /* ---------- toasts ---------- */
    'toast.addedFavorites': 'Masuk ke favorit',
    'toast.removedFavorites': 'Dikeluarkan dari favorit',
    'toast.addedPlaylist': 'Masuk ke daftar putar',
    'toast.addedTo': 'Masuk ke "{name}"',
    'toast.created': 'Daftar putar "{name}" dibuat',
    'toast.imported': '"{name}" diambil ({songs})',
    'toast.addedQueue': 'Masuk ke antrean',
    'toast.alreadyQueue': 'Sudah ada di antrean',
    'toast.playingNext': 'Diputar setelah lagu ini',
    'toast.queueCleared': 'Antrean dikosongkan',
    'toast.playlistDeleted': 'Daftar putar dihapus',
    'toast.playlistRenamed': 'Nama daftar putar diganti',
    'toast.savedLibrary': 'Tersimpan di koleksi kamu',
    'toast.removedLibrary': 'Dikeluarkan dari koleksi kamu',
    'toast.linkCopied': 'Tautan disalin',
    'toast.resolving': 'Membuka tautan…',
    'toast.noTracks': 'Lagunya tidak ketemu. Daftar putarnya mungkin disetel pribadi.',
    'toast.imported': 'Berhasil mengambil "{name}" berisi {n} lagu',
    'toast.importFailed': 'Gagal mengambil: {msg}',
    'toast.backupDownloaded': 'Cadangan tersimpan',
    'toast.libraryRestored': 'Koleksi dipulihkan',
    'toast.restoreFailed': 'Gagal memulihkan: {msg}',
    'toast.restoreUnreadable': 'Gagal memulihkan, berkasnya tidak terbaca',
    'toast.preparing': 'Menyiapkan "{title}" dalam MP3 320kbps…',
    'toast.converting': 'Mengubah "{title}"… {pct}%',
    'toast.downloading': 'Mengunduh "{title}"…',
    'toast.downloadStarted': 'Unduhan dimulai',
    'toast.downloadFailed': 'Unduhan gagal, coba lagi sebentar lagi',
    'toast.alreadyDownloading': 'Lagu ini sedang diunduh',
    'toast.trackUnavailable': 'Lagu ini tidak tersedia, dilewati',
    'toast.sleepIn': 'Musik berhenti {n} menit lagi',
    'toast.sleepCancelled': 'Matikan otomatis dibatalkan',
    'toast.sleepPaused': 'Musik dijeda oleh matikan otomatis',
    'toast.speed': 'Kecepatan {n}×',
    'toast.sbOn': 'SponsorBlock menyala',
    'toast.sbOff': 'SponsorBlock mati',
    'toast.sbSegments': 'SponsorBlock akan melewati {n} bagian di lagu ini|SponsorBlock akan melewati {n} bagian di lagu ini',
    'toast.sbSkipped': 'Bagian {what} dilewati SponsorBlock',
    'toast.playFirst': 'Putar dulu lagunya',
    'toast.widgetDoc': 'Pemutar mengambang terbuka dan selalu di atas jendela lain',
    'toast.widgetPip': 'Pemutar mengambang menyala. Buka aplikasi lain, musiknya tetap jalan',
    'toast.widgetInPage': 'Pemutar mengambang menyala. Geser ke mana saja',
    'toast.qualityHigh': 'Kualitas tertinggi menyala, kuotanya lebih boros',
    'toast.qualityNormal': 'Kualitas biasa menyala',
    'toast.desktopOn': 'Situs desktop sudah menyala. Sekarang musiknya tetap jalan waktu kamu pindah aplikasi.',

    /* ---------- empty states ---------- */
    'empty.notFound': 'Halaman tidak ketemu',
    'empty.notFound.sub': 'Tautannya tidak ada, atau halamannya sudah dihapus.',
    'empty.goHome': 'Ke beranda',
    'empty.failed': 'Gagal memuat halaman ini',
    'empty.failed.sub': 'Ada yang tidak beres di tengah jalan.',
    'empty.noResults': 'Tidak ketemu',
    'empty.noResults.sub': 'Coba ejaan lain, atau penyanyi, lagu, maupun daftar putar yang berbeda.',
    'empty.moods': 'Gagal memuat suasana',
    'empty.moods.sub': 'Periksa koneksi kamu, lalu coba lagi.',
    'empty.retry': 'Coba lagi',
    'empty.searchFailed': 'Pencarian gagal',
    'empty.searchFailed.sub': 'Coba lagi sebentar lagi.',
    'empty.charts': 'Tangga lagu belum tersedia',
    'empty.charts.sub': 'Coba lagi sebentar lagi.',
    'empty.stats': 'Belum ada yang bisa ditampilkan',
    'empty.stats.sub': 'Putar musik dulu. Angkanya bertambah sambil kamu dengar.',
    'empty.browseHome': 'Ke beranda',
    'empty.liked': 'Belum ada lagu favorit',
    'empty.liked.sub': 'Ketuk tanda hati di lagu mana pun, nanti masuk ke sini.',
    'empty.findSongs': 'Cari lagu',
    'empty.history': 'Belum ada yang diputar',
    'empty.history.sub': 'Lagu yang kamu putar akan muncul di sini.',
    'empty.saved': 'Belum ada yang disimpan',
    'empty.saved.sub': 'Buka album, daftar putar, atau penyanyi mana pun lalu ketuk Simpan.',
    'empty.browseMoods': 'Lihat suasana',
    'empty.playlists': 'Belum ada daftar putar',
    'empty.playlists.sub': 'Pakai Daftar putar baru di atas, atau ambil punya kamu dari YouTube Music.',
    'empty.playlistGone': 'Daftar putar tidak ketemu',
    'empty.playlistGone.sub': 'Mungkin sudah dihapus.',
    'empty.yourLibrary': 'Koleksi Kamu',
    'empty.playlistEmpty': 'Daftar putar ini masih kosong',
    'empty.playlistEmpty.sub': 'Buka lagu mana pun lalu ketuk Daftar putar untuk memasukkannya ke sini.',
    'empty.nothingHere': 'Belum ada apa apa',
    'empty.nothingHere.sub': 'Halaman ini belum punya lagu maupun album.',
    'empty.libraryEmpty': 'Koleksi kamu masih kosong',
    'empty.relatedFailed': 'Gagal memuat lagu serupa',

    /* ---------- desktop site guide ---------- */
    'guide.title': 'Biar musiknya jalan terus',
    'guide.intro': 'Browser di ponsel menghentikan musik begitu tabnya kamu tinggal. Ada satu pengaturan browser yang mematikan perilaku itu, dan cukup dinyalakan sekali saja.',
    'guide.step1': 'Ketuk tanda tiga titik di pojok kanan atas browser',
    'guide.step2': 'Cari <b>Situs desktop</b>',
    'guide.step3': 'Centang, nanti halaman ini memuat ulang sendiri',
    'guide.outro': 'Setelah itu musiknya tetap jalan waktu kamu pindah aplikasi, dan tombol di bilah notifikasi bisa dipakai. Browser kamu mengingat pengaturan ini khusus untuk AR Music, jadi tidak perlu diulang.',
    'guide.gotIt': 'Mengerti',
    'guide.androidApp': 'Aplikasi Android',
    'banner.title': 'Musik berhenti waktu pindah aplikasi',
    'banner.sub': 'Nyalakan Situs desktop di menu browser, musiknya jadi tetap jalan. Ketuk untuk lihat caranya.',
    'banner.how': 'Lihat cara',
    'banner.close': 'Tutup',

    /* ---------- misc ---------- */
    'misc.loading': 'Memuat…',
    'misc.songs': '{n} lagu|{n} lagu',
    'misc.clear': 'Kosongkan',
    'misc.moveUp': 'Naikkan',
    'misc.moveDown': 'Turunkan',
    'misc.removeQueue': 'Keluarkan dari antrean',
    'misc.remove': 'Hapus',
    'misc.scrollLeft': 'Geser ke kiri',
    'misc.scrollRight': 'Geser ke kanan',
    'misc.newPlaylistName': 'Nama daftar putar baru',
    'misc.myPlaylist': 'Daftar putar saya',
    'misc.goToArtist': 'Buka halaman penyanyi',
    'misc.importedPlaylist': 'Daftar putar dari luar',
    'misc.noPlaylistsYet': 'Belum ada daftar putar',
    'queue.nowHead': 'Sedang diputar',
    'queue.yourQueueCount': 'Antrean kamu · {n}',
    'queue.hint': 'Antreannya masih kosong. Ketuk ikon antrean di sebuah lagu, atau pakai Putar setelah ini di layar pemutar.',
    'lib.emptyHint': 'Sukai lagu, simpan album dan penyanyi, atau buka Koleksi Kamu untuk membuat daftar putar',
    'lib.title': 'Koleksi',
    'pl.local': 'Daftar putar di perangkat ini',
    'stats.artists': 'Penyanyi',
    'more.widgetOn': 'Pemutar mengambang menyala',
    'more.speed': 'Kecepatan · {n}×',
    'more.qualityMax': 'Kualitas · Tertinggi',
    'more.qualityYtm': 'Kualitas · YouTube Music',
    'more.sbOn': 'SponsorBlock menyala',
    'more.sb': 'SponsorBlock',
    'misc.error': 'Ada yang tidak beres.',
  },
};

const LANG_KEY = 'armusic_lang';

function currentLang() {
  try {
    const saved = JSON.parse(localStorage.getItem(LANG_KEY));
    if (LANGS.includes(saved)) return saved;
  } catch {}
  return 'en';
}

/* Looks a word up and fills in the blanks.
 *
 * A missing key comes back wrapped in brackets rather than silently falling
 * back to English. Silence is how half translated screens ship: everything
 * looks fine until someone who reads the other language opens it. The brackets
 * make the hole loud, both on screen and in the tests that sweep for leftovers.
 *
 * A value holding a pipe carries two shapes for counting, one for a single
 * thing and one for several, and {n} decides which is used.
 */
function tr(key, vars) {
  const lang = currentLang();
  let s = (DICT[lang] && DICT[lang][key]);
  if (s == null) s = DICT.en[key];
  if (s == null) return '⟦' + key + '⟧';
  if (s.includes('|')) {
    const parts = s.split('|');
    const n = vars && Number(vars.n);
    s = (n === 1 ? parts[0] : parts[1]) || parts[0];
  }
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return s;
}

/* Fills every piece of wording that lives in the page itself rather than being
   built in JavaScript. Marked with attributes instead of matched by their text,
   so a word appearing twice never gets replaced in the wrong place. */
function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = tr(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = tr(el.getAttribute('data-i18n-html'));
  });
  for (const [attr, target] of [['data-i18n-title', 'title'],
                                ['data-i18n-placeholder', 'placeholder'],
                                ['data-i18n-aria', 'aria-label']]) {
    document.querySelectorAll('[' + attr + ']').forEach((el) => {
      el.setAttribute(target, tr(el.getAttribute(attr)));
    });
  }
  document.documentElement.lang = currentLang();
}

window.I18N = { LANGS, LANG_LABEL, LANG_KEY, DICT, tr, currentLang, applyStaticText };
window.tr = tr;
