#!/usr/bin/env bash
#
# Menyiapkan kunci penandatanganan rilis Android, sekali saja.
#
#   bash android/setup-signing.sh
#
# Skrip ini membuat keystore, lalu menyiapkan empat secret yang dibaca
# .github/workflows/android-release.yml. Kalau GitHub CLI tersedia dan sudah
# login, secretnya langsung disetel; kalau tidak, nilainya dicetak untuk
# ditempel sendiri.
#
# Kuncinya dibuat di komputer Anda dan tidak pernah dikirim ke mana pun selain
# sebagai secret repo. Jangan pernah commit berkas .jks-nya.

set -euo pipefail

KS="${1:-release.jks}"
ALIAS="armusic"
REPO="adiirmd/arMusic"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v keytool >/dev/null || {
  echo "keytool tidak ditemukan. Pasang JDK 17 dulu, lalu jalankan lagi." >&2
  exit 1
}

# Menimpa keystore lama berarti semua pembaruan berikutnya tidak bisa dipasang
# menimpa versi yang sudah beredar. Lebih baik berhenti daripada menghancurkan
# kunci yang mungkin masih dipakai.
if [ -e "$KS" ]; then
  echo "Sudah ada '$KS' di sini. Skrip berhenti supaya kunci lama tidak tertimpa." >&2
  echo "Kalau memang mau membuat kunci baru, pindahkan dulu berkas itu." >&2
  exit 1
fi

# Sengaja tidak memakai 'head' di ujung pipa: head menutup pipa lebih dulu,
# tr kena SIGPIPE, dan dengan pipefail seluruh skrip berhenti tanpa pesan.
PW="$(LC_ALL=C head -c 1024 /dev/urandom | tr -dc 'A-Za-z0-9' | cut -c1-32)"

say "Membuat keystore $KS"
keytool -genkeypair -v \
  -keystore "$KS" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=AR Music, O=AR Music, C=ID" >/dev/null

B64="$(base64 -w0 "$KS" 2>/dev/null || base64 "$KS" | tr -d '\n')"

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  say "Menyetel secret di $REPO lewat GitHub CLI"
  printf '%s' "$B64"   | gh secret set ANDROID_KEYSTORE_BASE64   --repo "$REPO"
  printf '%s' "$PW"    | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
  printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS         --repo "$REPO"
  printf '%s' "$PW"    | gh secret set ANDROID_KEY_PASSWORD      --repo "$REPO"
  echo "Keempat secret sudah disetel."
else
  say "GitHub CLI tidak ada atau belum login — tempel sendiri empat nilai ini"
  echo "Buka: https://github.com/$REPO/settings/secrets/actions"
  echo
  echo "ANDROID_KEYSTORE_PASSWORD  $PW"
  echo "ANDROID_KEY_ALIAS          $ALIAS"
  echo "ANDROID_KEY_PASSWORD       $PW"
  echo "ANDROID_KEYSTORE_BASE64    (isi berkas $KS.base64.txt)"
  printf '%s' "$B64" > "$KS.base64.txt"
  echo
  echo "Base64-nya ditulis ke $KS.base64.txt karena terlalu panjang untuk disalin dari layar."
  echo "Hapus berkas itu setelah ditempel."
fi

say "Simpan baik-baik"
cat <<EOT
  Berkas kunci     : $KS
  Kata sandi       : $PW
  Alias            : $ALIAS

Backup keduanya di tempat aman, di luar folder repo ini. Kalau kunci ini
hilang, versi berikutnya tidak akan bisa dipasang menimpa yang sudah
terpasang di HP — Android menolak APK dengan tanda tangan berbeda, dan
aplikasinya harus dicopot dulu.

'$KS' sudah masuk .gitignore, jadi tidak akan ikut ter-commit.

Setelah secretnya terpasang, jalankan workflow rilis sekali lagi. Rilis
berikutnya tidak akan ditandai prerelease lagi.
EOT
