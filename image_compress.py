"""
Helper TERPUSAT untuk kompresi gambar upload (base64 data URL) sebelum
disimpan ke store JSON di server.

Kenapa dipisah jadi modul sendiri (bukan ditulis ulang di tiap endpoint):
supaya logic resize/convert-WebP/strip-metadata cuma ada di SATU tempat.
Kalau nanti aturan kompresi berubah (quality/resolusi disesuaikan lagi),
cukup diubah di sini -- endpoint di app.py tinggal panggil dengan angka
batas yang beda.

CATATAN PENTING -- baca sebelum menambah pemakaian baru di endpoint lain:
- SENGAJA TIDAK dipakai untuk foto prestasi (/api/prestasi/save). Foto itu
  jadi target fitur watermark steganografi LSB (lihat sisipkanDataRahasiaLSB
  & komentar "STEGANOGRAFI LSB" di dashboard_guru.js) yang RUSAK kalau
  gambarnya di-resize/dikompres ulang -- itu keputusan sadar (dari sesi
  pembahasan sebelumnya), bukan kelupaan.
- SENGAJA TIDAK dipakai untuk "bukti pelanggaran" -- fitur upload foto
  untuk pelanggaran belum ada sama sekali di pelanggaran_store saat ini.
"""

import base64
import io
import re

from PIL import Image, ImageOps, UnidentifiedImageError

# Format gambar yang didukung untuk diproses. Format/file lain (termasuk
# yang bukan gambar sama sekali, mis. PDF/teks yang disamarkan jadi data
# URL) ditolak lewat GambarTidakValid.
FORMAT_DIDUKUNG = {'JPEG', 'PNG', 'WEBP', 'GIF', 'BMP', 'MPO'}

_POLA_DATA_URL = re.compile(r'^data:([\w/\-+.]+);base64,(.+)$', re.DOTALL)

# Proteksi tambahan terhadap "decompression bomb" (gambar kecil di disk
# tapi meledak jadi raksasa saat di-decode, bisa bikin server kehabisan
# memori). Batas longgar (200 megapiksel) -- jauh di atas resolusi kamera
# HP biasa, jadi tidak akan menolak foto normal.
Image.MAX_IMAGE_PIXELS = 200_000_000


class GambarTidakValid(Exception):
    """Dilempar kalau data URL yang dikirim bukan gambar yang didukung,
    korup, atau berisiko (decompression bomb) untuk diproses. Endpoint
    pemanggil WAJIB menangkap ini dan membalas 400 ke client -- JANGAN
    biarkan menjalar jadi 500."""
    pass


def kompres_gambar_base64(data_url, max_dimensi, quality):
    """Kompres SATU gambar (data URL base64) jadi WebP.

    Parameter:
        data_url    : string "data:image/xxx;base64,...."
        max_dimensi : batas piksel untuk sisi TERPANJANG gambar
        quality     : quality WebP (0-100)

    Aturan:
    - Rotasi dari EXIF Orientation (foto dari HP) diperbaiki DULU,
      sebelum metadata dibuang -- supaya orientasinya tidak berubah.
    - Kalau sisi terpanjang > max_dimensi -> resize proporsional
      (aspect ratio tidak berubah, dan TIDAK meng-upscale gambar yang
      sudah lebih kecil dari batas).
    - Metadata/EXIF yang tidak perlu otomatis hilang karena hasil
      resize/convert ditulis ulang dari nol (bukan copy exif asli).
    - Hasil akhir selalu dibungkus balik jadi data URL biasa (mime
      image/webp) -- supaya semua kode lama yang sudah pakai pola
      `<img src="{field_foto}">` tetap jalan tanpa perubahan apa pun.

    Return: (data_url_baru, ukuran_asli_byte, ukuran_baru_byte)
    Raise : GambarTidakValid
    """
    cocok = _POLA_DATA_URL.match((data_url or '').strip())
    if not cocok:
        raise GambarTidakValid('Bukan format data URL gambar yang valid.')

    payload_b64 = cocok.group(2)
    try:
        raw_bytes = base64.b64decode(payload_b64, validate=True)
    except Exception:
        raise GambarTidakValid('Data base64 gambar korup/tidak valid.')

    if not raw_bytes:
        raise GambarTidakValid('Data gambar kosong.')

    ukuran_asli = len(raw_bytes)

    try:
        im = Image.open(io.BytesIO(raw_bytes))
        im.load()
    except Image.DecompressionBombError:
        raise GambarTidakValid('Gambar terlalu besar/berisiko untuk diproses.')
    except (UnidentifiedImageError, OSError, ValueError):
        raise GambarTidakValid('File bukan gambar yang bisa dibaca/didukung.')

    if (im.format or '').upper() not in FORMAT_DIDUKUNG:
        raise GambarTidakValid(f"Format gambar '{im.format}' tidak didukung.")

    # WAJIB sebelum strip metadata: baca orientasi EXIF & putar piksel
    # sesuai itu, supaya nanti pas EXIF-nya beneran hilang, tampilannya
    # tidak jadi kesimpan miring/terbalik.
    im = ImageOps.exif_transpose(im)

    # Pertahankan transparansi kalau memang ada (RGBA), selain itu
    # dipastikan RGB biasa. WebP mendukung dua-duanya.
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
    else:
        im = im.convert('RGB')

    lebar, tinggi = im.size
    sisi_terpanjang = max(lebar, tinggi)
    if sisi_terpanjang > max_dimensi:
        skala = max_dimensi / float(sisi_terpanjang)
        lebar_baru = max(1, round(lebar * skala))
        tinggi_baru = max(1, round(tinggi * skala))
        # LANCZOS -- filter resize kualitas terbaik Pillow, penting
        # supaya hasilnya tetap enak dilihat & tajam walau di-zoom.
        im = im.resize((lebar_baru, tinggi_baru), Image.LANCZOS)
    # else: sisi terpanjang sudah <= batas -> TIDAK di-resize sama
    # sekali (tidak upscale gambar yang memang sudah kecil).

    buffer_keluar = io.BytesIO()
    # method=6 = effort kompresi WebP paling tinggi (encode sedikit lebih
    # lambat, tapi ukuran file paling optimal untuk quality yang sama).
    # exif sengaja TIDAK disertakan -> metadata otomatis tidak ikut.
    im.save(buffer_keluar, format='WEBP', quality=quality, method=6)
    hasil_bytes = buffer_keluar.getvalue()

    data_url_baru = 'data:image/webp;base64,' + base64.b64encode(hasil_bytes).decode('ascii')
    return data_url_baru, ukuran_asli, len(hasil_bytes)
