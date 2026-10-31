# ----------------------------------------------------
# IMAGE_CACHE_SERVICE.PY
# ----------------------------------------------------
# Cache GAMBAR untuk AI Support: foto komponen/alat TKJ-TAV-TKR yang pernah
# dijawab Gemini disimpan (dikompres sadis) + jawabannya, supaya foto YANG
# MIRIP + pertanyaan yang mirip bisa dijawab ulang tanpa nembak Gemini.
#
# BUKAN "melatih" AI -- Gemini tidak jadi lebih pintar. Ini murni cache
# (hemat kuota + lebih cepat), sama semangatnya dengan semantic_cache_service.py.
#
# CARA KERJA
#   1. Foto (base64 JPEG hasil kompresi frontend) didecode, lalu dihitung
#      "sidik gambar" perceptual hash (dHash 64-bit). Foto yang tampilannya
#      mirip menghasilkan hash yang jaraknya (Hamming) kecil, walau ukuran/
#      kompresinya beda.
#   2. Cache dianggap KENA kalau DUA syarat terpenuhi sekaligus:
#        a. jarak hash foto <= AI_GAMBAR_MAKS_JARAK_HASH (default 8 dari 64 bit)
#        b. pertanyaannya mirip maknanya (embedding, cosine >= AI_GAMBAR_AMBANG_TANYA)
#      Syarat (b) wajib: foto yang sama bisa ditanya beda ("ini apa?" vs
#      "cara pakainya gimana?") dan jawabannya harus beda.
#   3. Foto yang disimpan = versi WebP kecil (maks sisi 512px, kualitas
#      diturunkan bertahap sampai <= ~30 KB) dalam base64. Fungsinya buat
#      REVIEW oleh guru/admin, bukan ditampilkan ke siswa lain.
#
# VERIFIKASI (default AKTIF): entri baru berstatus terverifikasi=false dan
# TIDAK PERNAH dipakai ulang sebelum guru/admin membalik jadi true di
# Supabase. Alasannya: kalau AI salah kenali foto (mis. spakbor dibilang
# reflektor) lalu langsung di-cache, kesalahannya menyebar ke semua siswa.
# Matikan dengan AI_GAMBAR_CACHE_WAJIB_VERIFIKASI=0 di .env (TIDAK disarankan).
#
# PRIVASI: foto siswa bisa memuat wajah/nama/lembar ujian. Karena itu:
#   - entri yang belum diverifikasi otomatis dihapus setelah
#     AI_GAMBAR_HAPUS_PENDING_HARI (default 14 hari);
#   - foto tidak pernah dikirim balik ke siswa lain, cuma dipakai
#     mencocokkan hash;
#   - pemanggil (gemini_routes.py) TIDAK memanggil modul ini kalau user
#     punya riwayat percakapan aktif (jawaban bergantung konteks).
#
# PRINSIP SAMA seperti modul cache lain: TIDAK PERNAH melempar exception ke
# pemanggil. Pillow belum terpasang / Supabase down / tabel belum dibuat /
# embedding gagal -> cukup balikin None/False (= cache miss), chat tetap jalan.
#
# SETUP: jalankan supabase_setup_cache_gambar.sql di Supabase SQL Editor,
# lalu `pip install pillow`. Memakai SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
# yang sama dengan semantic_cache_service.py.
# ----------------------------------------------------

import base64
import io
import os
import random
import threading
import time

import requests

try:
    from PIL import Image, ImageOps
    _PIL_ADA = True
except ImportError:  # Pillow belum dipasang -> fitur nonaktif, bukan error
    _PIL_ADA = False

# Pemantauan API (opsional) -- lihat catatan di semantic_cache_service.py.
try:
    from services import ai_usage_log as _usage
except Exception:
    _usage = None

from services.semantic_cache_service import (
    buat_embedding,
    _fitur_aktif as _fitur_semantik_aktif,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
)

SUPABASE_TABEL_GAMBAR = os.environ.get("SUPABASE_CACHE_GAMBAR_TABEL", "ai_cache_gambar").strip()
SUPABASE_RPC_GAMBAR = os.environ.get("SUPABASE_CACHE_GAMBAR_RPC", "cari_cache_gambar_mirip").strip()


def _env_int(nama, bawaan):
    try:
        return int((os.environ.get(nama) or str(bawaan)).strip() or str(bawaan))
    except ValueError:
        return bawaan


def _env_float(nama, bawaan):
    try:
        return float((os.environ.get(nama) or str(bawaan)).strip() or str(bawaan))
    except ValueError:
        return bawaan


MAKS_JARAK_HASH = _env_int("AI_GAMBAR_MAKS_JARAK_HASH", 8)          # dari 64 bit
AMBANG_SIMILARITY_TANYA = _env_float("AI_GAMBAR_AMBANG_TANYA", 0.92)
WAJIB_VERIFIKASI = (os.environ.get("AI_GAMBAR_CACHE_WAJIB_VERIFIKASI", "1").strip() != "0")
HAPUS_PENDING_HARI = _env_int("AI_GAMBAR_HAPUS_PENDING_HARI", 14)

THUMB_MAKS_SISI = 512
THUMB_TARGET_KB = 30
THUMB_KUALITAS = (50, 40, 30, 22)
MAKS_UKURAN_INPUT_BYTE = 1_500_000   # foto dari frontend sudah kecil; tolak yang aneh-aneh
PELUANG_BERSIHKAN = 0.05
TIMEOUT_DETIK = 10

TEKS_TANPA_PERTANYAAN = "(foto tanpa teks)"


def _aktif():
    return _PIL_ADA and _fitur_semantik_aktif()


def _buka_gambar(gambar_base64):
    mentah = base64.b64decode(gambar_base64, validate=False)
    if not mentah or len(mentah) > MAKS_UKURAN_INPUT_BYTE:
        raise ValueError("ukuran gambar tidak wajar")
    img = Image.open(io.BytesIO(mentah))
    img = ImageOps.exif_transpose(img)
    return img


def hitung_sidik_gambar(img):
    """dHash 64-bit -> string '0101...' (64 karakter)."""
    kecil = img.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(kecil.getdata())
    bit = []
    for baris in range(8):
        for kolom in range(8):
            kiri = px[baris * 9 + kolom]
            kanan = px[baris * 9 + kolom + 1]
            bit.append("1" if kiri > kanan else "0")
    return "".join(bit)


def kompres_thumbnail_b64(img):
    """WebP kecil dalam base64, turun kualitas bertahap sampai <= THUMB_TARGET_KB."""
    salinan = img.convert("RGB")
    salinan.thumbnail((THUMB_MAKS_SISI, THUMB_MAKS_SISI), Image.LANCZOS)
    hasil = b""
    for kualitas in THUMB_KUALITAS:
        buf = io.BytesIO()
        salinan.save(buf, format="WEBP", quality=kualitas, method=6)
        hasil = buf.getvalue()
        if len(hasil) / 1024 <= THUMB_TARGET_KB:
            break
    return base64.b64encode(hasil).decode("ascii")


def _embedding_teks(embedding):
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


def _header():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "content-type": "application/json",
    }


def _cari(sidik, embedding, hanya_terverifikasi):
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{SUPABASE_RPC_GAMBAR}",
        json={
            "p_sidik": sidik,
            "query_embedding": _embedding_teks(embedding),
            "maks_jarak_hash": MAKS_JARAK_HASH,
            "ambang_similarity": AMBANG_SIMILARITY_TANYA,
            "p_hanya_terverifikasi": hanya_terverifikasi,
        },
        headers=_header(),
        timeout=TIMEOUT_DETIK,
    )
    resp.raise_for_status()
    baris = resp.json()
    if isinstance(baris, list) and baris:
        return baris[0]
    return None


def cari_jawaban_gambar_mirip(gambar_base64, pesan):
    """Balikin string balasan kalau ada foto MIRIP + pertanyaan MIRIP yang
    sudah terverifikasi; selain itu None (cache miss / fitur nonaktif / error)."""
    if not _aktif() or not gambar_base64:
        return None
    try:
        img = _buka_gambar(gambar_base64)
        sidik = hitung_sidik_gambar(img)
        embedding = buat_embedding((pesan or "").strip() or TEKS_TANPA_PERTANYAAN, tujuan="cari_gambar")
        temuan = _cari(sidik, embedding, hanya_terverifikasi=WAJIB_VERIFIKASI)
        if not temuan:
            return None
        balasan = temuan.get("balasan")
        if isinstance(balasan, str) and balasan.strip():
            return balasan
        return None
    except Exception:
        return None


def _bersihkan_pending_kadaluarsa():
    try:
        batas = time.strftime(
            "%Y-%m-%dT%H:%M:%S+00:00",
            time.gmtime(time.time() - HAPUS_PENDING_HARI * 86400),
        )
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABEL_GAMBAR}",
            params={"terverifikasi": "eq.false", "dibuat_pada": f"lt.{batas}"},
            headers=_header(),
            timeout=TIMEOUT_DETIK,
        )
    except Exception:
        pass


def _simpan_sekarang(gambar_base64, pesan, balasan):
    try:
        teks_tanya = (pesan or "").strip() or TEKS_TANPA_PERTANYAAN
        teks_balasan = (balasan or "").strip()
        if not teks_balasan:
            return False
        img = _buka_gambar(gambar_base64)
        sidik = hitung_sidik_gambar(img)
        embedding = buat_embedding(teks_tanya, tujuan="simpan_gambar")

        # Jangan simpan duplikat: kalau sudah ada entri mirip (status APA PUN), lewati.
        if _cari(sidik, embedding, hanya_terverifikasi=False):
            return False

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABEL_GAMBAR}",
            json={
                "sidik_gambar": sidik,
                "pertanyaan_asli": teks_tanya[:1000],
                "embedding": _embedding_teks(embedding),
                "balasan": teks_balasan,
                "gambar_webp_b64": kompres_thumbnail_b64(img),
                "terverifikasi": False,
            },
            headers={**_header(), "prefer": "return=minimal"},
            timeout=TIMEOUT_DETIK,
        )
        resp.raise_for_status()
        if random.random() < PELUANG_BERSIHKAN:
            _bersihkan_pending_kadaluarsa()
        return True
    except Exception:
        return False


def simpan_ke_cache_gambar(gambar_base64, pesan, balasan):
    """Simpan di THREAD TERPISAH supaya jawaban ke siswa tidak ikut tertunda
    (hash + embedding + insert bisa makan ~1 detik). Selalu best-effort."""
    if not _aktif() or not gambar_base64 or not balasan:
        return False
    try:
        # Thread baru tidak mewarisi konteks permintaan -- dibungkus supaya
        # embedding di thread ini tetap tercatat atas nama user yang sama.
        threading.Thread(
            target=(_usage.bungkus_konteks(_simpan_sekarang) if _usage is not None else _simpan_sekarang),
            args=(gambar_base64, pesan, balasan),
            daemon=True,
        ).start()
        return True
    except Exception:
        return False
