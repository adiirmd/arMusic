# AR Music

Pemutar musik web gratis. Cari, telusuri, dan putar lagu dari YouTube Music lengkap dengan lirik tersinkron, antrean, dan library lokal tanpa akun, tanpa iklan, dan tanpa build step.

**Live:** [music.adiirmd.my.id](https://music.adiirmd.my.id)

---

## Fitur

**Pemutaran**
- Putar lagu, album, playlist, dan radio artis dari YouTube Music
- Antrean dengan drag-and-drop, shuffle, dan repeat (satu lagu / semua)
- Lirik tersinkron per baris, klik baris untuk lompat ke detiknya
- Kontrol kecepatan putar, sleep timer, dan pilihan kualitas audio
- Auto-skip segmen non-musik lewat SponsorBlock
- Widget mengambang dan Picture-in-Picture, tetap jalan saat pindah tab
- Terintegrasi Media Session, jadi tombol di notifikasi dan headset berfungsi

**Jelajah**
- Beranda, pencarian dengan saran, tangga lagu, dan kategori mood/genre
- Halaman album, playlist, dan artis
- Impor playlist lewat tautan

**Library**
- Favorit, playlist buatan sendiri, riwayat dengar, album/artis tersimpan
- Statistik dengar
- Backup dan restore seluruh library sebagai satu file JSON

**Tampilan**
- Tema biru dengan mode gelap dan terang
- Responsif dari ponsel sampai desktop, siap dibungkus jadi aplikasi Android

---

## Cara kerja

```
Browser ──────────────► YouTube IFrame Player   (audio diputar di sini)
   │
   └──── /api/* ──────► Express  ──────────────► YouTube Music InnerTube
                                  ──────────────► LRCLIB / Netease / Textyl  (lirik)
                                  ──────────────► SponsorBlock              (lewati segmen)
```

Frontend-nya SPA vanilla JavaScript, tanpa framework dan tanpa bundler — `public/` disajikan apa adanya. Backend Express hanya bertugas jadi proxy: mengambil metadata dari API internal YouTube Music, mencari lirik dari beberapa sumber, dan meneruskan thumbnail.

**Audio tidak pernah melewati server.** Pemutaran sepenuhnya ditangani YouTube IFrame Player di browser. Artinya log server tidak akan pernah menunjukkan error pemutaran — kalau lagu tidak mau jalan, periksa Console browser, bukan log backend.

---

## Menjalankan secara lokal

Butuh Node.js 18 atau lebih baru.

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

Port bisa diganti lewat `PORT`:

```bash
PORT=8080 npm start
```

Tidak ada API key atau file `.env` yang perlu disiapkan.

---

## Deploy

Repo ini sudah siap untuk Vercel. `api/index.js` membungkus aplikasi Express jadi serverless function, dan `vercel.json` mengarahkan `/api/*` ke sana sementara sisanya dilayani sebagai file statis dari `public/`.

```bash
vercel deploy
```

Untuk host lain, `npm start` sudah cukup — `server.js` melayani file statis sekaligus API dalam satu proses.

---

## Endpoint API

| Endpoint | Kegunaan |
| --- | --- |
| `GET /api/home` | Rak konten untuk beranda |
| `GET /api/search?q=` | Pencarian lagu, album, artis, playlist |
| `GET /api/suggest?q=` | Saran pencarian |
| `GET /api/browse?id=` | Isi album, playlist, atau artis |
| `GET /api/charts` | Tangga lagu |
| `GET /api/moods` | Kategori mood dan genre |
| `GET /api/next?videoId=` | Antrean lanjutan untuk sebuah lagu |
| `GET /api/related?browseId=` | Rekomendasi terkait |
| `GET /api/resolve?url=` | Mengubah tautan YouTube/YT Music jadi id internal |
| `GET /api/lyrics?title=&artist=&duration=&browseId=` | Lirik, diutamakan yang tersinkron |
| `GET /api/sponsorblock?videoId=` | Segmen yang bisa dilewati |
| `GET /api/thumb?url=` | Proxy thumbnail, dibatasi ke domain milik Google |
| `GET /api/download-start`, `/api/download-progress` | Unduhan lewat layanan pihak ketiga |

---

## Penyimpanan data

Seluruh library tersimpan di `localStorage` browser — tidak ada database, tidak ada akun, dan tidak ada data yang dikirim ke server. Konsekuensinya, data terikat ke satu browser di satu perangkat: membersihkan data situs akan menghapusnya.

Gunakan **Backup** di halaman Library untuk mengunduh seluruh isinya sebagai satu file JSON, dan **Restore** untuk memuatnya kembali di perangkat lain. Restore juga menerima format backup dari versi lama supaya file yang sudah terlanjur diunduh tidak tertolak.

---

## Struktur proyek

```
public/
  index.html      kerangka halaman + sprite ikon SVG
  app.js          seluruh SPA: router, player, library, UI
  styles.css      tema dan tata letak (dark + light)
  logo.svg        brand mark, sumber untuk semua ukuran PNG
  favicon.svg     ikon tab, sumber untuk favicon PNG
server.js         Express: file statis + proxy API
api/index.js      pembungkus serverless untuk Vercel
vercel.json       konfigurasi build dan routing
```

---

## Catatan

- Pemutaran butuh akses ke `youtube.com`. Di jaringan yang memblokirnya, aplikasi tetap terbuka dan metadata tetap muncul, tapi lagu tidak akan berbunyi.
- Aplikasi ini bergantung pada API internal YouTube Music yang tidak berdokumentasi resmi dan bisa berubah sewaktu-waktu tanpa pemberitahuan.
- Dibuat untuk keperluan pribadi dan pembelajaran.
