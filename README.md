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
Browser ── HTTPS ──► music.adiirmd.id (Vercel)
                       │  /api/*      katalog, lirik, gambar
                       │  /api/play   audio, Range aware
                       ▼
                     origin (server rumah) ──► sumber audio
```

Browser hanya pernah bicara dengan domain AR Music. Tidak ada iframe, script, gambar, font, atau request audio ke domain lain, dan Content-Security-Policy halaman mengunci semuanya ke `'self'`.

- **Audio** diputar oleh elemen `<audio>` dengan sumber `/api/play/<id>`. Server menerjemahkan id ke sumber audio, membuka koneksi ke sana, lalu meneruskan byte secara streaming begitu tiba. Tidak ada file sementara, tidak ada transcoding, tidak ada buffer seluruh lagu. Range request diteruskan apa adanya, jadi seek langsung meminta posisi yang dituju. Backpressure dijaga lewat `stream.pipeline`: client yang lambat ikut memperlambat pembacaan dari sumber.
- **Siap sebelum ditekan.** Lagu berikutnya di antrean disiapkan di server (`/api/warm`), dan setelah lagu yang sedang jalan cukup aman buffernya, lagu berikutnya juga dimuat diam diam di elemen audio kedua. Begitu lagu habis, elemen itu langsung jadi pemutar. Lagu yang disorot mouse atau disentuh juga disiapkan duluan.
- **Cache.** Origin menyimpan potongan audio 256 KB di memori (LRU, dibatasi `ARMUSIC_CACHE_MB`), diisi sambil streaming jadi tidak pernah membuat pendengar menunggu. Putar ulang, seek mundur, dan lagu yang sudah disiapkan dilayani dari situ. Jawaban katalog di-cache di CDN dengan `stale-while-revalidate`, gambar dan font di-cache lama di browser.
- **Koneksi.** Vercel memakai ulang koneksi ke origin (keep alive), sesi dan token sumber diperbarui di belakang layar sebelum habis, dan `ARMUSIC_ORIGIN` boleh berisi beberapa alamat yang dicoba bergantian kalau satu gagal.
- **Id** yang diterima browser adalah token terenkripsi (AES, deterministik), bukan id asli dari katalog.
- **Gambar** dikirim sebagai `/api/img/<token>`, alamat aslinya terenkripsi dan hanya dibuka di server.
- **Font** di-host sendiri di `public/fonts`.

Kenapa ada origin terpisah: sumber audio menolak alamat IP data center untuk hampir semua lagu, dan alamat media yang diberikan terikat ke IP yang memintanya. Jadi resolve dan pengambilan audio dijalankan di server dengan IP rumahan, dan fungsi Vercel meneruskan byte-nya. Origin hanya melayani `/api/play` dan `/api/download`, dan hanya untuk request yang membawa kunci bersama.

Error pemutaran yang sampai ke browser hanya berupa kode: `PLAYBACK_BAD_REQUEST`, `PLAYBACK_RANGE_ERROR`, `PLAYBACK_RATE_LIMITED`, `PLAYBACK_SOURCE_UNAVAILABLE`, `PLAYBACK_STREAM_ERROR`. Detailnya ada di log server.

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
| `ARMUSIC_WARM_BYTES` | origin | Seberapa banyak awal lagu yang disiapkan, default 512 KB |
| `HOST`, `PORT` | origin | Alamat listen |

Di origin, jalankan Node dengan `--dns-result-order=ipv4first` kalau host-nya tidak punya rute IPv6. Origin yang dipakai sekarang jalan sebagai service systemd, dijaga timer yang tiap dua menit mengecek origin dan jalur publiknya lalu memulihkan yang mati.

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
| `GET /api/img/:token` | Gambar |
| `POST /api/img/seal`, `POST /api/id/seal` | Migrasi sekali jalan untuk library lama |

---

## Penyimpanan data

Seluruh library tersimpan di `localStorage` browser. Tidak ada database dan tidak ada akun. Library dari versi lama dimigrasi otomatis saat pertama dibuka: nama field, id, dan alamat gambar diganti ke format sekarang.

Gunakan **Backup** di halaman Library untuk mengunduh seluruh isinya sebagai satu file JSON, dan **Restore** untuk memuatnya di perangkat lain. File backup lama tetap diterima.

---

## Struktur proyek

```
public/              SPA, disajikan apa adanya
lib/playback/        gateway audio: resolve, stream, cache, range, relay, error
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
- Dibuat untuk keperluan pribadi dan pembelajaran.
