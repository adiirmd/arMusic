# AR Music

Pemutar musik web gratis. Cari, telusuri, dan putar lagu lengkap dengan lirik tersinkron, antrean, dan library lokal, tanpa akun dan tanpa iklan.

**Live:** [music.adiirmd.id](https://music.adiirmd.id)

---

## Fitur

**Pemutaran**
- Putar lagu, album, playlist, dan radio artis
- Antrean, shuffle, dan repeat (satu lagu atau semua)
- Lirik tersinkron per baris, klik baris untuk lompat ke detiknya
- Kecepatan putar, sleep timer, dan dua pilihan kualitas audio
- Lewati intro dan obrolan secara otomatis
- Widget mengambang dan Picture-in-Picture
- Media Session, jadi tombol di notifikasi dan headset berfungsi
- Unduh lagu sebagai file audio asli (m4a), tanpa konversi ulang

**Jelajah**
- Beranda, pencarian dengan saran, tangga lagu, kategori mood dan genre
- Halaman album, playlist, dan artis
- Impor playlist lewat tautan

**Library**
- Favorit, playlist sendiri, riwayat, album dan artis tersimpan
- Statistik dengar
- Backup dan restore seluruh library sebagai satu file JSON

---

## Cara kerja

```
Browser ─┬─ music.adiirmd.id (Vercel)      halaman, katalog, lirik, gambar
         │      └─ /api/play  ──► origin   jalur cadangan untuk audio
         └─ stream.adiirmd.my.id ──► origin (server rumah) ──► sumber audio
                (Cloudflare Tunnel)
```

Dalam keadaan normal browser hanya bicara dengan dua domain milik sendiri: `music.adiirmd.id` untuk halaman dan API, `stream.adiirmd.my.id` untuk audio. Content Security Policy halaman mengunci request ke dua domain itu, ditambah pemutar cadangan yang dijelaskan di bawah.

### Audio

Elemen `<audio>` memutar `https://stream.adiirmd.my.id/play/<token>`. Di belakangnya ada origin, server rumahan yang menerjemahkan token ke sumber audio, membuka koneksi ke sana, dan meneruskan byte begitu tiba. Tidak ada file sementara dan tidak ada transcoding. Range request diteruskan apa adanya, jadi geser durasi langsung meminta posisi yang dituju, dan client yang lambat ikut memperlambat pembacaan dari sumber.

Origin terpisah dari Vercel karena sumber audio menolak IP data center untuk hampir semua lagu, dan alamat media yang diberikannya terikat ke IP yang meminta. Kalau jalur `stream` gagal untuk seorang pendengar, halaman memakai `/api/play` di Vercel, yang meneruskan request ke origin lewat Tailscale Funnel.

### Supaya langsung bunyi

Diukur di browser sungguhan pada production, waktu dari klik sampai lagu bunyi 0,2 sampai 0,5 detik, dan geser durasi umumnya di bawah 0,05 detik. Yang membuatnya begitu:

- Origin menyimpan potongan audio 256 KB di memori (LRU, dibatasi `ARMUSIC_CACHE_MB`). Cache diisi sambil streaming, dan lagu yang sedang diputar ditarik utuh di belakang layar, jadi geser ke detik mana pun dijawab dari memori.
- Lagu berikutnya di antrean, lagu yang muncul di layar, dan lagu yang disorot atau disentuh disiapkan lebih dulu lewat `/warm`. Lagu berikutnya juga dimuat diam diam di elemen audio kedua, yang langsung jadi pemutar begitu lagu sekarang habis.
- Koneksi ke `stream` dijaga tetap terbuka selama halaman dipakai. Dari jaringan rumahan, membuka koneksi baru makan 0,3 sampai 0,8 detik, sedangkan request di koneksi yang sudah terbuka dijawab sekitar 60 ms.
- Sesi dan token sumber diperbarui di belakang layar sebelum habis. Jawaban katalog di-cache di CDN dengan `stale-while-revalidate`.

### Kalau server rumah mati

Halaman pindah ke pemutar embed publik dan melanjutkan lagu dari detik yang sama. Hanya pada mode ini browser memuat sesuatu dari luar, karena id asli lagu yang dibutuhkan pemutar itu hanya diberikan `/api/fallback` selama origin tidak bisa dihubungi. Selama origin hidup jawabannya 409. Halaman mengecek tiap 15 detik, dan begitu origin kembali, lagu berikutnya diputar lewat jalur biasa lagi. Unduhan berhenti sementara selama mode cadangan.

Di server, `armusic-watchdog.timer` mengecek origin, Tailscale Funnel, dan tunnel `stream` tiap dua menit, lalu memulihkan yang mati.

### Id, gambar, dan error

Id yang dipegang browser adalah token terenkripsi (AES, deterministik), bukan id asli dari katalog. Gambar dikirim lewat `/api/img/<token>` dan font di-host sendiri di `public/fonts`. Error pemutaran yang sampai ke browser hanya berupa kode: `PLAYBACK_BAD_REQUEST`, `PLAYBACK_RANGE_ERROR`, `PLAYBACK_RATE_LIMITED`, `PLAYBACK_SOURCE_UNAVAILABLE`, `PLAYBACK_STREAM_ERROR`. Detailnya ada di log server.

---

## Menjalankan secara lokal

Butuh Node.js 20 atau lebih baru.

```bash
npm install
npm start          # http://localhost:3000
npm test
```

Tanpa `ARMUSIC_ORIGIN`, satu proses melakukan semuanya, termasuk mengambil audio sendiri. Itu cara paling gampang untuk mencoba, asal dijalankan dari jaringan rumahan.

---

## Konfigurasi

| Variabel | Dipakai di | Fungsi |
| --- | --- | --- |
| `ARMUSIC_SECRET` | Vercel dan origin, nilainya harus sama | Kunci untuk token id dan gambar. Jangan diganti, atau semua id di library orang berubah |
| `ARMUSIC_ORIGIN` | Vercel | Alamat origin. Kalau diisi, `/api/play` diteruskan ke sana |
| `ARMUSIC_ORIGIN_KEY` | Vercel dan origin | Kunci bersama antara keduanya |
| `ARMUSIC_ROLE=origin` | origin | Origin hanya melayani route audio |
| `ARMUSIC_PLAY_CHUNK` | origin | Batas byte per respons untuk Range terbuka, default 8 MB |
| `ARMUSIC_CACHE_MB` | origin | Batas memori cache audio, default 160 |
| `ARMUSIC_EDGE_PORT` | origin | Port untuk `stream`, dibuka di localhost dan dijangkau lewat tunnel |
| `ARMUSIC_FILL` | origin | `0` mematikan penarikan lagu utuh ke memori |
| `ARMUSIC_WARM_BYTES` | origin | Seberapa banyak awal lagu yang disiapkan, default 512 KB |
| `HOST`, `PORT` | origin | Alamat listen |

Di origin, jalankan Node dengan `--dns-result-order=ipv4first` kalau host-nya tidak punya rute IPv6. Origin yang dipakai sekarang jalan sebagai service systemd.

---

## Deploy

```bash
vercel deploy
```

`api/index.js` membungkus aplikasi Express jadi serverless function, `vercel.json` mengarahkan `/api/*` ke sana dan menyajikan `public/` sebagai file statis dengan header CSP.

---

## Endpoint API

| Endpoint | Kegunaan |
| --- | --- |
| `GET /api/home` | Rak konten beranda |
| `GET /api/search?q=` | Pencarian |
| `GET /api/suggest?q=` | Saran pencarian |
| `GET /api/browse?id=` | Isi album, playlist, atau artis |
| `GET /api/charts` | Tangga lagu |
| `GET /api/moods` | Kategori mood dan genre |
| `GET /api/next?trackId=` | Antrean lanjutan untuk sebuah lagu |
| `GET /api/related?pageId=` | Rekomendasi terkait |
| `GET /api/resolve?url=` | Mengubah tautan jadi id |
| `GET /api/lyrics?title=&artist=&duration=&pageId=` | Lirik, diutamakan yang tersinkron |
| `GET /api/skips?trackId=` | Bagian yang bisa dilewati |
| `GET /api/play/:trackId` | Audio, mendukung Range |
| `GET /api/download/:trackId?name=` | Audio sebagai lampiran |
| `POST /api/warm/:trackId` | Siapkan lagu sebelum diputar |
| `GET /api/health` | Status jalur ke origin |
| `GET /api/fallback/:trackId` | Id untuk pemutar cadangan, hanya saat origin mati |
| `GET /api/img/:token` | Gambar |
| `stream.adiirmd.my.id/play/:token` | Audio langsung dari origin, hanya token tersegel |
| `POST /api/img/seal`, `POST /api/id/seal` | Migrasi sekali jalan untuk library lama |

---

## Penyimpanan data

Seluruh library tersimpan di `localStorage` browser. Tidak ada database dan tidak ada akun. Library dari versi lama dimigrasi otomatis saat pertama dibuka: nama field, id, dan alamat gambar diganti ke format sekarang.

Gunakan **Backup** di halaman Library untuk mengunduh seluruh isinya sebagai satu file JSON, dan **Restore** untuk memuatnya di perangkat lain. File backup lama tetap diterima.

---

## Struktur proyek

```
public/              SPA, disajikan apa adanya
lib/playback/        audio: resolve, stream, cache, range, relay, edge, error
lib/ids.js           token id
lib/images.js        token gambar
lib/ratelimit.js     pembatas request
server.js            Express: katalog, lirik, dan semua route di atas
api/index.js         pembungkus serverless untuk Vercel
test/                node --test
android/             pembungkus WebView untuk Android
```

---

## Catatan

- Katalog dan sumber audio bergantung pada API pihak ketiga yang tidak berdokumentasi resmi dan bisa berubah kapan saja.
- Aplikasi Android ada di `android/`, rilisnya di halaman Releases.
- Dibuat untuk keperluan pribadi dan pembelajaran.
