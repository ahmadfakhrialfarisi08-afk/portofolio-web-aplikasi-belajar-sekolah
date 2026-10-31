# ----------------------------------------------------
# SEMANTIC_CACHE_SERVICE.PY
# ----------------------------------------------------
# Lapisan cache TAMBAHAN di atas cache exact-match yang sudah ada di
# gemini_routes.py (_cache_respon_gemini). Bedanya:
#
# - Cache exact-match (routes.py): cocok kalau pertanyaannya SAMA PERSIS
#   setelah dirapikan (huruf kecil, spasi rapi, tanda baca ujung dibuang).
#   "Siapa pembuat web ini?" dan "siapa pembuat web ini" dianggap sama,
#   tapi "siapa yang bikin web sekolah ini?" dianggap BEDA walau maknanya
#   identik -- jadi tetap nembak Gemini lagi.
#
# - Cache semantik (modul ini): pertanyaan diubah jadi EMBEDDING (vector
#   angka lewat Gemini Embedding API), lalu dicari pertanyaan LAMA yang
#   paling mirip MAKNANYA lewat pgvector di Supabase (cosine similarity).
#   Kalau kemiripannya di atas ambang batas (AMBANG_SIMILARITY_DEFAULT),
#   jawaban lama dipakai lagi -- "siapa yang bikin web sekolah ini?" bisa
#   kena cache dari "siapa pembuat web ini?" walau kata-katanya beda.
#
# ALUR PEMAKAIAN (dipanggil dari gemini_routes.py, TEPAT di tempat yang
# sama dengan cache exact-match, dengan guard privasi yang SAMA):
#
#   1. Cek cache exact-match dulu (murah, tidak butuh panggilan API sama
#      sekali) -- ini TETAP di routes.py, tidak berubah.
#   2. Kalau tidak ketemu -> panggil cari_jawaban_mirip(pesan) di sini.
#   3. Kalau tetap tidak ketemu -> baru nembak Gemini biasa (tanya_gemini),
#      lalu simpan hasilnya lewat simpan_ke_cache_semantik(pesan, balasan).
#
# PRINSIP UTAMA (SAMA seperti modul-modul lain di project ini): modul ini
# TIDAK PERNAH melempar exception ke pemanggilnya. Kalau Supabase down,
# Gemini Embedding API gagal, kunci belum diisi di .env, dsb -- semua
# fungsi publik di sini cukup balikin None/False, supaya AI Support TETAP
# BISA jawab (lewat jalur Gemini biasa) walau fitur cache semantiknya lagi
# bermasalah. Cache (apapun jenisnya) adalah OPTIMISASI, bukan bagian inti
# yang boleh bikin seluruh chat ikut gagal kalau dia sendiri gagal.
#
# SETUP YANG DIBUTUHKAN (lihat juga supabase_setup_cache_semantik.sql):
#   1. Di Supabase project yang SAMA dengan tabel prestasi, jalankan file
#      supabase_setup_cache_semantik.sql lewat SQL Editor -- ini akan
#      mengaktifkan extension pgvector, membuat tabel
#      ai_cache_semantik, index HNSW-nya, dan function RPC
#      cari_cache_semantik_mirip yang dipakai modul ini buat query.
#   2. Isi 2 variabel baru di file .env:
#        SUPABASE_URL=https://xxxxxxxx.supabase.co   (root URL project, TANPA /rest/v1/...)
#        SUPABASE_SERVICE_ROLE_KEY=isi-service-role-key-kamu
#      PENTING soal SUPABASE_SERVICE_ROLE_KEY (BEDA dari SUPABASE_ANON_KEY
#      yang dipakai ambil_data_prestasi() di gemini_service.py):
#      - "service_role" key itu SECRET/RAHASIA -- dia bisa baca & tulis ke
#        SEMUA tabel tanpa peduli aturan Row Level Security (RLS). Jangan
#        PERNAH taruh key ini di kode, di frontend/browser, atau di mana
#        pun yang bisa dilihat orang lain -- HANYA di file .env server ini
#        (dan file .env TIDAK boleh ikut di-commit ke Git/repo publik).
#      - Kenapa perlu service_role (bukan anon key) khusus untuk tabel
#        cache ini: modul ini perlu INSERT baris baru ke tabel
#        ai_cache_semantik dari server, dan anon key (yang memang didesain
#        aman dipakai terbuka di browser) BIASANYA tidak diberi izin
#        INSERT lewat RLS. Karena pemanggilan ke tabel ini SELALU dari
#        server (Flask), bukan dari browser user, pakai service_role di
#        sini AMAN -- key-nya tidak pernah terkirim/terlihat ke browser
#        siapa pun.
#   3. Kalau kedua variabel di atas TIDAK diisi, fitur ini otomatis
#      nonaktif (fungsi-fungsi di bawah langsung balikin None/False tanpa
#      pernah mencoba menghubungi Supabase/Gemini Embedding) -- AI Support
#      tetap jalan normal, cuma tanpa cache semantik.
# ----------------------------------------------------

import os
import random
import re
import threading
import time
import unicodedata

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Pemantauan API (opsional): kalau modulnya tidak ada / error saat import,
# fitur cache tetap jalan normal, hanya tanpa pencatatan usage.
try:
    from services import ai_usage_log as _usage
except Exception:
    _usage = None

# Dipakai buat panggil Gemini Embedding API -- SENGAJA pakai key & URL
# base yang SAMA dengan gemini_service.py (tidak ada key terpisah khusus
# embedding, Google memang memakai 1 API key yang sama untuk semua model
# Gemini termasuk model embedding).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# Model embedding STABIL (bukan alias "-latest") -- per dokumentasi resmi
# Google (ai.google.dev/gemini-api/docs/embeddings), "gemini-embedding-001"
# adalah model produksi yang di-pin, mendukung Matryoshka Representation
# Learning (MRL) sehingga output-nya bisa dipotong ke dimensi lebih kecil
# (768/1536) dengan kehilangan kualitas yang sangat kecil (~0.26% di 768
# dibanding ukuran penuh 3072).
GEMINI_EMBEDDING_MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001").strip()

GEMINI_EMBED_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"
)

# 768 dimensi dipilih (bukan default 3072) karena:
# - Storage & bandwidth ke Supabase cuma 25% dari ukuran penuh.
# - Kehilangan kualitas kemiripan makna sangat kecil (~0.26% MTEB score
#   dibanding 3072 penuh, menurut dokumentasi Google) -- tidak terasa
#   untuk kasus cache FAQ chatbot sekolah seperti ini.
# - pgvector index (HNSW) jauh lebih ringan & cepat di dimensi segini.
# PENTING: kalau angka ini diubah, index & kolom `embedding vector(...)`
# di tabel Supabase (lihat supabase_setup_cache_semantik.sql) HARUS ikut
# diubah ke dimensi yang sama persis -- keduanya WAJIB selalu cocok.
EMBEDDING_DIMENSI = int((os.environ.get("AI_EMBEDDING_DIMENSI") or "768").strip() or "768")

# Task type "SEMANTIC_SIMILARITY" dipilih (bukan RETRIEVAL_QUERY/
# RETRIEVAL_DOCUMENT) karena tujuannya membandingkan PERTANYAAN dengan
# PERTANYAAN LAIN (simetris) -- bukan pertanyaan vs dokumen panjang. Task
# type ini yang menurut dokumentasi Google memang dioptimalkan Google
# untuk "seberapa mirip makna dua potong teks", persis kasus kita.
GEMINI_EMBED_TASK_TYPE = "SEMANTIC_SIMILARITY"


# ----------------------------------------------------
# KONFIGURASI SUPABASE UNTUK TABEL CACHE SEMANTIK
# ----------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# Nama tabel & function RPC -- HARUS sama persis dengan yang dibuat lewat
# supabase_setup_cache_semantik.sql. Dibuat bisa dioverride lewat .env
# jaga-jaga kalau nama tabel/function di project Supabase kamu beda.
SUPABASE_CACHE_TABEL = os.environ.get("SUPABASE_CACHE_TABEL", "ai_cache_semantik").strip()
SUPABASE_CACHE_RPC = os.environ.get("SUPABASE_CACHE_RPC", "cari_cache_semantik_mirip").strip()

# Ambang batas kemiripan (cosine similarity, rentang -1..1, tapi untuk
# teks pertanyaan wajar hampir selalu di rentang 0..1). SENGAJA dibuat
# TINGGI (0.93) -- lebih baik cache "melewatkan" pertanyaan yang sebenarnya
# mirip (paling buruk: nembak Gemini lagi, boros dikit) daripada cache
# "kepedean" menganggap dua pertanyaan BEDA MAKNA sebagai sama padahal
# jawabannya seharusnya beda (mis. "syarat daftar SMP" vs "syarat daftar
# SMK" -- mirip secara kata, TAPI jawabannya harus beda). Bisa dituning
# lewat .env (AI_SEMANTIC_CACHE_AMBANG=...) tanpa ubah kode kalau ternyata
# kurang/kelewat ketat di pemakaian nyata.
AMBANG_SIMILARITY_DEFAULT = float(
    (os.environ.get("AI_SEMANTIC_CACHE_AMBANG") or "0.93").strip() or "0.93"
)

# TTL entri cache semantik -- SENGAJA punya variabel sendiri (terpisah
# dari TTL_CACHE_DETIK milik cache exact-match di routes.py) walau nilai
# defaultnya sama, supaya nanti bisa dituning independen tanpa bingung
# yang mana punya siapa.
TTL_CACHE_SEMANTIK_DETIK = int(
    (os.environ.get("AI_SEMANTIC_CACHE_TTL_DETIK") or str(24 * 60 * 60)).strip() or str(24 * 60 * 60)
)

TIMEOUT_EMBEDDING_DETIK = 10
TIMEOUT_SUPABASE_DETIK = 10

# Peluang (0.0 - 1.0) tiap kali ADA PENYIMPANAN baru, sekalian membuang
# entri cache semantik yang sudah kadaluarsa dari tabel Supabase. Dibuat
# PROBABILISTIK (bukan dijalankan setiap kali) supaya tidak nambah 1
# query DELETE ekstra di SETIAP pertanyaan -- cukup "kadang-kadang" saja,
# efeknya sama (tabel tidak membengkak tak terbatas) tapi jauh lebih
# hemat panggilan ke Supabase untuk pemakaian sehari-hari.
PELUANG_BERSIHKAN_KADALUARSA = 0.05


# ----------------------------------------------------
# VERIFIKASI ANGKA & SIMBOL (embedding lemah membedakan angka)
# ----------------------------------------------------
# Embedding hampir tidak bergeser oleh angka ("top 3" vs "top 5", "kelas 10" vs
# "kelas 11", "T568A" vs "T568B"), jadi kemiripan makna saja tidak cukup.
# Aturan: kalau pesan baru atau pertanyaan tersimpan punya angka/simbol
# penting, "tanda pembeda"-nya harus SAMA PERSIS, kalau tidak dianggap miss.
# Pembandingan butuh teks pertanyaan yang tersimpan, jadi RPC Supabase harus
# mengembalikan kolom `pertanyaan_asli`. Kalau tidak bisa diverifikasi,
# pesan berangka TIDAK dipakai/disimpan di cache semantik (aman, sama seperti
# perilaku lama). Env AI_SEMANTIC_RPC_PUNYA_PERTANYAAN=1 memaksa dianggap
# didukung (pakai hanya kalau RPC-nya memang sudah mengembalikan kolom itu).
_RE_TOKEN_ANGKA = re.compile(r"[a-z0-9]*\d[a-z0-9]*(?:[.,:][a-z0-9]+)*")
_SIMBOL_PENTING = frozenset("+#%=<>/@$")
_rpc_punya_pertanyaan = (os.environ.get("AI_SEMANTIC_RPC_PUNYA_PERTANYAAN") or "").strip() == "1"


def _tanda_pembeda(teks):
    """-> (token_berangka, simbol_penting). Contoh: "t568a" dan "t568b"
    menghasilkan tanda berbeda; "192.168.1.1" satu token utuh."""
    t = unicodedata.normalize("NFKC", teks or "").casefold()
    # "membu@t" == "membuat": @ yang diapit huruf bukan simbol pembeda.
    t = re.sub(r"(?<=[a-z])@(?=[a-z])", "a", t)
    angka = tuple(_RE_TOKEN_ANGKA.findall(t))
    simbol = tuple(sorted(ch for ch in t if ch in _SIMBOL_PENTING))
    return angka, simbol


def angka_didukung():
    """True kalau cache semantik boleh dipakai untuk pesan berangka (RPC
    terbukti mengembalikan pertanyaan_asli untuk verifikasi)."""
    return bool(_rpc_punya_pertanyaan)


def _fitur_aktif():
    """True kalau semua konfigurasi wajib (Gemini API key + kredensial
    Supabase khusus tabel cache ini) sudah diisi. Kalau salah satu kosong,
    seluruh fitur cache semantik dianggap NONAKTIF (bukan error) --
    dicek paling awal di tiap fungsi publik supaya tidak buang waktu
    coba menghubungi API mana pun kalau memang belum di-setup."""
    return bool(GEMINI_API_KEY and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


class _EmbeddingGagal(Exception):
    """Exception INTERNAL saja (tidak pernah bocor keluar modul ini) --
    dipakai supaya alur di buat_embedding() bisa keluar lebih awal dari
    beberapa titik pengecekan sekaligus, ditangkap oleh pemanggil publik
    (cari_jawaban_mirip/simpan_ke_cache_semantik) lalu diubah jadi
    None/False biasa."""
    pass


def _buat_embedding_inti(teks, _laporan):
    """Ubah 1 potong teks jadi vector embedding (list of float, panjang
    EMBEDDING_DIMENSI) lewat Gemini Embedding API.

    Melempar _EmbeddingGagal (BUKAN GeminiError dari gemini_service.py --
    modul ini sengaja berdiri sendiri, tidak menumpangi circuit breaker
    milik chat biasa, supaya masalah di fitur cache tidak pernah ikut
    membuka circuit breaker chat utama) kalau gagal dengan alasan apapun.
    SELALU dipanggil dari dalam try/except oleh fungsi publik di bawah --
    tidak dimaksudkan dipanggil langsung dari luar modul ini."""
    teks_bersih = (teks or "").strip()
    if not teks_bersih:
        raise _EmbeddingGagal("Teks kosong.")

    url = GEMINI_EMBED_URL_TEMPLATE.format(model=GEMINI_EMBEDDING_MODEL)
    payload = {
        "model": f"models/{GEMINI_EMBEDDING_MODEL}",
        "content": {"parts": [{"text": teks_bersih}]},
        "taskType": GEMINI_EMBED_TASK_TYPE,
        "outputDimensionality": EMBEDDING_DIMENSI,
    }

    _laporan["request_terkirim"] = True
    try:
        resp = requests.post(
            url,
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=TIMEOUT_EMBEDDING_DETIK,
        )
    except requests.exceptions.RequestException as e:
        _laporan["jenis_error"] = "timeout" if isinstance(e, requests.exceptions.Timeout) else "koneksi"
        raise _EmbeddingGagal(f"Gagal menghubungi Gemini Embedding API: {e}")

    _laporan["http_status"] = resp.status_code
    if not resp.ok:
        raise _EmbeddingGagal(f"Gemini Embedding API balas error {resp.status_code}: {resp.text[:300]}")

    try:
        hasil = resp.json()
        # Usage HANYA kalau API melaporkannya (embedContent sering tidak) -- tidak ditebak.
        _laporan["usage"] = hasil.get("usageMetadata") if isinstance(hasil, dict) else None
        nilai = hasil["embedding"]["values"]
    except (ValueError, KeyError, TypeError):
        raise _EmbeddingGagal("Format respons Gemini Embedding API tidak dikenali.")

    if not isinstance(nilai, list) or len(nilai) != EMBEDDING_DIMENSI:
        raise _EmbeddingGagal(
            f"Panjang embedding tidak sesuai (dapat {len(nilai) if isinstance(nilai, list) else '?'}, "
            f"harusnya {EMBEDDING_DIMENSI})."
        )

    # CATATAN soal normalisasi: pgvector di sisi Supabase memakai operator
    # cosine distance (`<=>`, lihat supabase_setup_cache_semantik.sql),
    # yang RUMUSNYA SUDAH otomatis membagi dengan panjang (norm) kedua
    # vector -- jadi TIDAK butuh normalisasi manual tambahan di sini
    # walau outputDimensionality yang dipakai bukan 3072 (beda dengan
    # kalau kita hitung cosine similarity manual pakai dot product polos).
    return nilai


def buat_embedding(teks, tujuan=None):
    """Ubah teks jadi vector embedding -- lihat docstring
    _buat_embedding_inti() di atas untuk perilaku lengkap (tidak berubah).
    `tujuan` (opsional) hanya label untuk Pemantauan API, mis.
    "cari_semantik" / "simpan_semantik" / "cari_gambar" / "simpan_gambar".
    Tiap panggilan embedContent nyata dicatat SATU kali, terpisah dari
    generateContent."""
    laporan = {
        "model": GEMINI_EMBEDDING_MODEL,
        "tujuan": tujuan or "lainnya",
        "request_terkirim": False,
        "usage": None,
        "http_status": None,
        "jenis_error": None,
    }
    mulai = time.monotonic()
    try:
        hasil = _buat_embedding_inti(teks, laporan)
        laporan["status"] = "ok"
        return hasil
    except Exception:
        laporan["status"] = "error"
        if not laporan.get("jenis_error"):
            kode = laporan.get("http_status")
            laporan["jenis_error"] = f"http_{kode}" if isinstance(kode, int) and kode >= 400 else "respons_tidak_valid"
        raise
    finally:
        # Tidak ada request terkirim (mis. teks kosong) -> tidak ada panggilan API, tidak dicatat.
        if _usage is not None and laporan.get("request_terkirim"):
            try:
                laporan["latensi_ms"] = int((time.monotonic() - mulai) * 1000)
                _usage.catat_embedding(laporan)
            except Exception:
                pass


def _panggil_rpc_supabase(nama_fungsi, payload):
    """Helper kecil buat POST ke endpoint RPC PostgREST Supabase
    (/rest/v1/rpc/<nama_fungsi>). Melempar exception biasa (requests./
    ValueError) kalau gagal -- ditangkap oleh pemanggil (semuanya di
    modul ini sudah dalam try/except)."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{nama_fungsi}"
    resp = requests.post(
        url,
        json=payload,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "content-type": "application/json",
        },
        timeout=TIMEOUT_SUPABASE_DETIK,
    )
    resp.raise_for_status()
    return resp.json()


def cari_jawaban_mirip(pesan, ambang_similarity=None):
    """Cari pertanyaan LAMA yang paling mirip MAKNANYA dengan `pesan`
    lewat cosine similarity di pgvector (Supabase), dibatasi entri yang
    belum kadaluarsa (TTL_CACHE_SEMANTIK_DETIK).

    PENTING -- pemanggil (gemini_routes.py) TETAP bertanggung jawab
    memutuskan KAPAN fungsi ini boleh dipanggil (mis. HANYA untuk
    pertanyaan teks murni tanpa foto, dan HANYA kalau
    _pesan_perlu_data_pribadi_quiz(pesan) bernilai False) -- guard privasi
    itu SENGAJA tetap di routes.py (satu tempat, dipakai bareng cache
    exact-match), TIDAK diduplikasi di sini, supaya tidak ada risiko dua
    aturan privasi yang beda sendiri-sendiri lalu suatu saat tidak
    sinkron satu sama lain.

    Return: string balasan (siap dipakai langsung) kalau ketemu entri di
    atas ambang batas, atau None kalau tidak ketemu / fitur belum
    di-setup / ada error apapun di tengah jalan (Supabase down, Gemini
    Embedding API gagal, dll -- SEMUANYA dianggap "cache miss", TIDAK
    PERNAH dilempar sebagai exception ke pemanggil)."""
    if not _fitur_aktif():
        return None

    ambang = AMBANG_SIMILARITY_DEFAULT if ambang_similarity is None else ambang_similarity

    try:
        embedding_pesan = buat_embedding(pesan, tujuan="cari_semantik")
        baris = _panggil_rpc_supabase(
            SUPABASE_CACHE_RPC,
            {
                "query_embedding": embedding_pesan,
                "ambang_similarity": ambang,
                "ttl_detik": TTL_CACHE_SEMANTIK_DETIK,
            },
        )
        if not isinstance(baris, list) or not baris:
            return None
        global _rpc_punya_pertanyaan
        teratas = baris[0] if isinstance(baris[0], dict) else {}
        balasan = teratas.get("balasan")
        if not isinstance(balasan, str) or not balasan.strip():
            return None
        tanda_baru = _tanda_pembeda(pesan)
        if "pertanyaan_asli" in teratas:
            _rpc_punya_pertanyaan = True
            tersimpan = teratas.get("pertanyaan_asli")
            if isinstance(tersimpan, str) and _tanda_pembeda(tersimpan) != tanda_baru:
                return None  # angka/simbol beda -> bukan pertanyaan yang sama
        elif tanda_baru[0]:
            return None      # pesan berangka tapi tidak bisa diverifikasi -> anggap miss
        return balasan
    except Exception:
        # Mencakup _EmbeddingGagal, requests.exceptions.*, ValueError dari
        # .json(), KeyError, dst -- SEMUA dianggap "cache miss, lanjut ke
        # Gemini biasa", TIDAK PERNAH bikin chat gagal gara-gara fitur
        # optimisasi ini bermasalah.
        return None


def _bersihkan_entri_kadaluarsa_best_effort():
    """Best-effort: hapus baris di tabel cache semantik yang sudah lebih
    tua dari TTL_CACHE_SEMANTIK_DETIK, supaya tabel tidak membengkak tanpa
    batas seiring waktu (beda dengan cache exact-match di routes.py yang
    punya MAKS_ENTRI_CACHE + LRU -- di sini cukup dibuang berdasar umur,
    lebih simpel karena disimpan di Supabase, bukan di memori proses).
    Dipanggil PROBABILISTIK (lihat PELUANG_BERSIHKAN_KADALUARSA), dan
    SENGAJA tidak melempar exception apapun kalau gagal -- kegagalan di
    sini tidak boleh mengganggu penyimpanan entri baru yang jadi tujuan
    utama simpan_ke_cache_semantik()."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_CACHE_TABEL}"
        batas_waktu_iso = (
            time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - TTL_CACHE_SEMANTIK_DETIK))
        )
        requests.delete(
            url,
            params={"dibuat_pada": f"lt.{batas_waktu_iso}"},
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            },
            timeout=TIMEOUT_SUPABASE_DETIK,
        )
    except Exception:
        pass


def simpan_ke_cache_semantik(pesan, balasan):
    """Simpan pasangan (pesan, balasan) ke tabel cache semantik di
    Supabase, LENGKAP dengan embedding-nya, supaya pertanyaan lain yang
    mirip MAKNANYA nanti bisa langsung kena cache lewat
    cari_jawaban_mirip().

    Sama seperti cari_jawaban_mirip(): pemanggil (routes.py) yang
    memutuskan KAPAN fungsi ini boleh dipanggil (skip untuk foto, skip
    untuk pertanyaan data pribadi quiz, skip untuk balasan yang kelihatan
    seperti penolakan -- guard-guard yang SAMA PERSIS dengan yang dipakai
    untuk _simpan_ke_cache() exact-match).

    Return True kalau berhasil disimpan, False kalau fitur belum
    di-setup atau gagal di titik manapun (SELALU best-effort, TIDAK
    PERNAH melempar exception ke pemanggil -- gagal simpan cache TIDAK
    BOLEH membuat jawaban yang sudah berhasil didapat dari Gemini jadi
    gagal juga dikirim ke user)."""
    if not _fitur_aktif():
        return False

    teks_pesan = (pesan or "").strip()
    teks_balasan = (balasan or "").strip()
    if not teks_pesan or not teks_balasan:
        return False
    # Pesan berangka hanya disimpan kalau nanti bisa diverifikasi saat dicari.
    if _tanda_pembeda(teks_pesan)[0] and not angka_didukung():
        return False

    try:
        embedding_pesan = buat_embedding(teks_pesan, tujuan="simpan_semantik")
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_CACHE_TABEL}"
        resp = requests.post(
            url,
            json={
                "pertanyaan_asli": teks_pesan[:1000],  # jaga-jaga, sama seperti batas panjang pesan di routes.py
                "balasan": teks_balasan,
                "embedding": embedding_pesan,
            },
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "content-type": "application/json",
                "prefer": "return=minimal",
            },
            timeout=TIMEOUT_SUPABASE_DETIK,
        )
        resp.raise_for_status()

        if random.random() < PELUANG_BERSIHKAN_KADALUARSA:
            _bersihkan_entri_kadaluarsa_best_effort()

        return True
    except Exception:
        return False
