# AR Music — aplikasi Android

Pembungkus WebView native untuk [music.adiirmd.my.id](https://music.adiirmd.my.id).
Bukan Capacitor dan bukan Cordova: hanya satu Activity, satu Service, dan tiga
dependensi AndroidX. Dipilih begitu supaya APK-nya kecil, izinnya sedikit, dan
seluruh isinya mudah dibaca ulang.

| | |
| --- | --- |
| Package | `id.my.adiirmd.armusic` |
| minSdk | 24 (Android 7.0) |
| targetSdk | 35 (Android 15) |
| Bahasa | Kotlin |

---

## Cara membangun

Butuh JDK 17 dan Android SDK.

```bash
cd android
./gradlew assembleDebug          # untuk mencoba di perangkat sendiri
./gradlew assembleRelease        # perlu keystore, lihat di bawah
```

Hasilnya ada di `app/build/outputs/`.

---

## Menyiapkan keystore

Kunci penandatanganan **tidak pernah disimpan di repo**. Buat sekali, lalu
simpan sebagai secret di GitHub. Ada skrip yang mengurus semuanya:

```bash
bash android/setup-signing.sh
```

Skrip itu membuat keystore dengan kata sandi acak 32 karakter, lalu menyetel
keempat secret lewat GitHub CLI kalau tersedia, atau mencetak nilainya untuk
ditempel sendiri. Berhenti kalau sudah ada keystore di tempat yang sama,
supaya kunci lama tidak tertimpa.

Kalau lebih suka manual, isinya sama dengan ini:

```bash
keytool -genkeypair -v \
  -keystore release.jks \
  -alias armusic \
  -keyalg RSA -keysize 4096 -validity 10000
```

Simpan `release.jks` dan kata sandinya di tempat aman. **Kalau hilang, semua
pembaruan berikutnya tidak akan bisa dipasang menimpa versi lama** — Android
menolak APK dengan tanda tangan berbeda, dan pengguna harus menghapus dulu
aplikasinya.

Ubah jadi base64 lalu daftarkan empat secret di
**Settings → Secrets and variables → Actions**:

```bash
base64 -w0 release.jks       # isi untuk ANDROID_KEYSTORE_BASE64
```

| Secret | Isi |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | hasil base64 dari `release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | kata sandi keystore |
| `ANDROID_KEY_ALIAS` | `armusic` |
| `ANDROID_KEY_PASSWORD` | kata sandi kunci |

---

## Membuat rilis

```bash
git tag v1.0.0
git push origin v1.0.0
```

Workflow `.github/workflows/android-release.yml` akan membangun APK dan AAB,
memverifikasi tanda tangannya, lalu melampirkannya ke Release beserta
`SHA256SUMS.txt`. Bisa juga dijalankan manual lewat tab Actions untuk sekadar
mengetes build tanpa membuat rilis.

---

## Soal Play Protect dan keamanan

Tidak ada trik untuk "meloloskan" aplikasi dari Play Protect, dan memang tidak
perlu ada. Play Protect menandai aplikasi karena perilakunya mencurigakan.
Jalan satu-satunya adalah tidak melakukan hal yang mencurigakan:

**Izin seminimal mungkin.** Hanya lima, dan semuanya bisa dijelaskan:

| Izin | Alasan |
| --- | --- |
| `INTERNET` | memuat situs dan API-nya |
| `ACCESS_NETWORK_STATE` | mendeteksi saat perangkat offline |
| `FOREGROUND_SERVICE` | menjaga audio saat aplikasi di latar belakang |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | jenis service di atas, wajib sejak Android 14 |
| `POST_NOTIFICATIONS` | notifikasi pemutar, wajib sejak Android 13 |

Tidak ada lokasi, kontak, SMS, penyimpanan, kamera, mikrofon, daftar aplikasi
terpasang, maupun accessibility service. Kombinasi izin itulah yang biasanya
memicu peringatan.

**Hal lain yang dijaga:**

- Ditandatangani dengan skema v1, v2, dan v3. Play Protect membaca v2/v3.
- `usesCleartextTraffic="false"` plus network security config: semua lalu lintas wajib HTTPS.
- WebView dikunci ke domain sendiri dan domain YouTube yang dibutuhkan pemutar. Tautan lain dilempar ke browser, jadi aplikasi ini tidak bisa dijadikan peramban umum.
- `allowFileAccess` dan `allowContentAccess` dimatikan, jadi WebView tidak bisa menyentuh berkas perangkat.
- Tidak ada pemuatan kode dinamis, tidak ada reflection akal-akalan, tidak ada packer. R8 hanya dipakai untuk minify biasa. Obfuscation berlebihan justru membuat aplikasi tampak seperti malware.
- Tidak ada SDK iklan maupun pelacak.
- `android:exported` hanya pada Activity peluncur; Service tidak diekspor.
- Tidak ada data yang dicadangkan ke cloud (`allowBackup="false"`), karena library-nya tersimpan lokal dan aplikasi sudah punya ekspor JSON sendiri.

**Yang tetap akan Anda lihat, dan itu normal:** memasang APK di luar Play Store
selalu memunculkan konfirmasi "sumber tidak dikenal", dan Play Protect bisa
menampilkan dialog pemindaian sekali. Itu berlaku untuk semua APK yang dipasang
manual, termasuk aplikasi yang sepenuhnya bersih, dan tidak bisa dihilangkan
dari sisi aplikasi. Kalau ingin benar-benar tanpa peringatan, jalurnya adalah
menerbitkannya di Google Play memakai berkas `.aab`.

**Catatan soal SafetyNet.** SafetyNet Attestation — sekarang Play Integrity API —
sering disalahpahami. Fungsinya memeriksa apakah *perangkatnya* asli dan tidak
di-root, dan dipakai oleh aplikasi yang ingin menolak perangkat bermasalah,
misalnya aplikasi perbankan. Aplikasi tidak "lolos SafetyNet"; perangkatlah
yang lolos. Aplikasi ini tidak memakainya dan tidak membutuhkannya.

---

## Pemutaran di latar belakang

Audio dimainkan WebView, bukan kode native. Dua hal yang membuatnya bertahan
saat aplikasi ditinggalkan:

1. `MainActivity.onPause()` **sengaja tidak** memanggil `web.onPause()` maupun `pauseTimers()`. Keduanya adalah yang biasanya membungkam WebView begitu aplikasi meninggalkan layar.
2. `PlaybackService` berjalan sebagai foreground service bertipe `mediaPlayback` selama ada lagu yang diputar. Android membekukan proses latar belakang biasa; foreground service adalah cara resmi untuk tidak dibekukan.

Sisi web memberi tahu status pemutaran lewat `window.ARMusicNative.setPlaying()`.
Di browser biasa objek itu tidak ada dan pemanggilannya dilewati, jadi kode web
tetap jalan normal di luar aplikasi.
