# ----------------------------------------------------
# GEMINI_SERVICE.PY
# ----------------------------------------------------
# Modul kecil yang isinya cuma urusan "ngobrol ke Google Gemini API".
# Sengaja dipisah dari app.py biar gampang di-test sendiri (lihat
# test_gemini_cepat.py) dan gampang di-maintain kalau nanti Google
# ganti versi model/endpoint-nya.
#
# Cara pakai singkat (dari file lain):
#
#   from gemini_service import tanya_gemini, GeminiError
#
#   try:
#       jawaban = tanya_gemini("Halo, kamu siapa?")
#   except GeminiError as e:
#       print("Gagal:", e)
#
# API Key WAJIB diisi di file .env (baris: GEMINI_API_KEY=isi-key-kamu),
# jangan pernah ditulis langsung di kode ini.
# ----------------------------------------------------

import os
import re
import time
import random
import json
import threading
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Diambil dari environment variable / file .env. Kalau kosong, tanya_gemini()
# akan langsung menolak dengan pesan error yang jelas (bukan error mentah
# dari Google yang membingungkan).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# Model default bisa dioverride lewat .env (GEMINI_MODEL=...) tanpa ubah kode.
# PENTING soal pemilihan nama model ini (per dokumentasi resmi Google,
# https://ai.google.dev/gemini-api/docs/models):
# - Alias yang diakhiri "-latest" (mis. gemini-flash-latest) itu VALID,
#   tapi BISA diam-diam menunjuk ke rilis stable, PREVIEW, atau
#   EXPERIMENTAL -- dan "rate limit lebih ketat untuk model
#   experimental/preview" (kutipan dokumentasi Google). Alias ini juga
#   bisa di-hot-swap Google ke versi lain kapan saja (breaking change
#   dikasih tahu H-2 minggu lewat email, tapi tetap bisa berubah tanpa
#   kamu ubah kode sama sekali).
# - "gemini-2.5-flash-lite" di bawah ini adalah model versi STABIL yang
#   di-pin eksplisit (bukan alias) -- statusnya jelas, jatah rate limit
#   lebih longgar & konsisten, dan paling murah/cepat di keluarga 2.5,
#   cocok buat chatbot sekolah seperti ini. Kalau nanti mau naik ke
#   generasi lebih baru, ganti ke model STABIL yang di-pin juga (cek
#   daftar terbaru di ai.google.dev/gemini-api/docs/models), BUKAN ke
#   alias "-latest" lagi.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()

# ----------------------------------------------------
# BATAS PANJANG OUTPUT (token) -- BARU
# ----------------------------------------------------
# Sebelumnya TIDAK ADA batas sama sekali di payload -- Gemini bebas
# menjawab sepanjang apapun (termasuk kalau "kepancing" jawab sangat
# panjang), boros token/biaya tanpa perlu. Angka di bawah ini SENGAJA
# dibuat longgar (bukan pemotong ketat/rutin) -- untuk chatbot sekolah
# seperti ini, jawaban normal (beberapa paragraf) jauh di bawah batas ini,
# jadi perannya murni sebagai PENGAMAN terhadap jawaban yang "kebablasan"
# panjang, BUKAN pemendek yang mengubah maksud jawaban di pemakaian
# sehari-hari. Bisa dioverride lewat .env (GEMINI_MAX_OUTPUT_TOKENS=...)
# kalau ternyata perlu dinaikkan/diturunkan tanpa ubah kode.
GEMINI_MAX_OUTPUT_TOKENS = int((os.environ.get("GEMINI_MAX_OUTPUT_TOKENS") or "1024").strip() or "1024")

GEMINI_API_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

# Endpoint versi STREAMING -- Gemini mengirim balasan sepotong-sepotong
# (Server-Sent Events) alih-alih nunggu jawaban lengkap baru dikirim
# sekaligus. ?alt=sse dibutuhkan supaya formatnya SSE standar (baris
# "data: {...}"), bukan format lain yang lebih ribet di-parse.
GEMINI_API_STREAM_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"
)


# ----------------------------------------------------
# DATA PRESTASI SISWA (LANGSUNG DARI SUPABASE, BUKAN LEWAT URL CONTEXT)
# ----------------------------------------------------
# Kenapa ambil langsung dari sini alih-alih nyuruh Gemini "buka" halaman
# web sekolah lewat fitur url_context: JAUH lebih hemat token (cuma data
# bersihnya yang masuk ke prompt, bukan seluruh HTML halaman) dan lebih
# cepat + akurat (URL foto diambil PERSIS dari database, tidak ada
# risiko Gemini salah baca/mengarang src gambar dari HTML).
#
# URL & apikey ini ditemukan lewat tab Network di browser (F12) saat
# buka halaman prestasi di banjarasri.com -- role di dalam key ini
# adalah "anon" (anon key Supabase), yaitu key yang MEMANG didesain
# untuk dipakai terbuka di browser siapa pun, jadi aman dipakai di sini
# juga. JANGAN PERNAH pakai "service_role" key (key rahasia yang beda,
# harusnya tidak pernah terlihat di Network tab browser) kalau suatu
# saat ketemu -- kalau itu yang kelihatan di Network tab, berarti ada
# kesalahan konfigurasi di sisi web sekolah dan sebaiknya jangan dipakai.
SUPABASE_PRESTASI_URL = os.environ.get("SUPABASE_PRESTASI_URL", "").strip()
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()

# Domain yang boleh muncul di URL foto prestasi yang disuntik ke Gemini --
# jaga-jaga kalau suatu saat field foto_url di database diisi manual jadi
# link aneh/domain lain, kita tetap tidak meneruskannya sebagai gambar.
_DOMAIN_FOTO_DIIZINKAN = "supabase.co"

_cache_prestasi_lock = threading.Lock()
_cache_prestasi = {"data": None, "waktu": 0.0}

# Data prestasi jarang berubah (nambah manual oleh admin sekolah), jadi
# cache-nya boleh lebih lama dari cache jawaban chat (TTL_CACHE_DETIK di
# routes.py) -- ini cuma buat ngirit hit ke Supabase tiap ada chat masuk.
TTL_CACHE_PRESTASI_DETIK = 10 * 60  # 10 menit


def ambil_data_prestasi(paksa_refresh=False):
    """Ambil semua data prestasi dari tabel `prestasi` di Supabase (dipakai
    web sekolah). Hasilnya di-cache TTL_CACHE_PRESTASI_DETIK detik.

    SENGAJA tidak melempar exception kalau gagal (beda dari tanya_gemini) --
    kalau Supabase lagi down/timeout, AI Support tetap harus bisa jawab
    pertanyaan LAIN yang tidak berhubungan dengan prestasi. Kalau gagal:
    - Ada cache lama? -> pakai cache lama itu (lebih baik agak basi
      daripada kosong sama sekali).
    - Belum pernah berhasil sama sekali? -> balikin list kosong.

    Return: list of dict, satu dict per entri prestasi.
    """
    with _cache_prestasi_lock:
        if not paksa_refresh and _cache_prestasi["data"] is not None:
            if time.time() - _cache_prestasi["waktu"] < TTL_CACHE_PRESTASI_DETIK:
                return _cache_prestasi["data"]

    try:
        resp = requests.get(
            SUPABASE_PRESTASI_URL,
            params={"select": "*", "order": "created_at.desc"},
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "authorization": f"Bearer {SUPABASE_ANON_KEY}",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            raise ValueError("Format respons Supabase tidak dikenali (bukan list).")
    except Exception:
        # Gagal (timeout, Supabase down, format berubah, dll) -- pakai
        # cache lama kalau ada, jangan sampai bikin seluruh chat error.
        with _cache_prestasi_lock:
            if _cache_prestasi["data"] is not None:
                return _cache_prestasi["data"]
        return []

    with _cache_prestasi_lock:
        _cache_prestasi["data"] = data
        _cache_prestasi["waktu"] = time.time()
    return data


def format_data_prestasi_untuk_konteks(data_prestasi):
    """Ubah list dict prestasi (dari ambil_data_prestasi()) jadi teks rapi
    satu baris per entri, siap disuntik ke system prompt Gemini. Field
    `sekolah` (jenjang: SMP/SMA/SMK) & `tingkat` disertakan apa adanya
    supaya Gemini bisa mem-filter sendiri sesuai pertanyaan user, tanpa
    perlu buka halaman web lagi."""
    if not data_prestasi:
        return "(Data prestasi sedang tidak bisa diambil -- kalau ditanya, jawab jujur sedang ada gangguan teknis.)"

    baris = []
    for p in data_prestasi:
        foto = (p.get("foto_url") or "").strip()
        foto_valid = foto.startswith("https://") and _DOMAIN_FOTO_DIIZINKAN in foto
        baris.append(
            f"- Nama: {p.get('nama_siswa', '?')} | Jenjang: {p.get('sekolah', '?')} | "
            f"Tingkat: {p.get('tingkat', '?')} | Tahun: {p.get('tahun', '?')} | "
            f"Judul: {p.get('judul_prestasi', '?')} | "
            f"Foto: {foto if foto_valid else '(tidak ada foto valid)'}"
        )
    return "\n".join(baris)


# ----------------------------------------------------
# ISI HALAMAN WEB SEKOLAH (DIAMBIL LANGSUNG SERVER-SIDE, BUKAN LEWAT
# FITUR "URL CONTEXT" BAWAAN GEMINI)
# ----------------------------------------------------
# Kenapa ini ditambahkan: sebelumnya AI Support 100% mengandalkan Gemini
# MEMUTUSKAN SENDIRI untuk membuka {URL_WEB_SEKOLAH} lewat tool
# `url_context` yang disebut di system prompt. Ternyata ini TIDAK
# reliable -- terutama di model kecil/murah seperti gemini-2.5-flash-lite,
# model sering kali TIDAK memicu tool itu sama sekali walau instruksinya
# sudah ada di system_instruction (beda kalau URL-nya ditulis eksplisit
# di pesan/contents, tapi kita tidak mau maksa user selalu nulis link).
# Hasilnya: AI jawab "saya tidak dapat mengakses halaman resmi sekolah"
# padahal sebenarnya BISA -- cuma dia tidak memilih untuk mencoba.
#
# Solusinya disamakan dengan pola data prestasi di atas: kita AMBIL
# SENDIRI isi halamannya di server (requests.get biasa), lalu suntikkan
# sebagai teks polos ke system prompt tiap request. Gemini jadi TIDAK
# PERNAH perlu memutuskan untuk "membuka" apapun -- infonya sudah ada
# di depan matanya dari awal. Jauh lebih pasti, dan hemat karena
# di-cache (lihat TTL_CACHE_WEB_SEKOLAH_DETIK di bawah).
#
# CATATAN: seluruh konten (termasuk daftar ekstrakurikuler di section
# "Fasilitas Ekstrakurikuler") ternyata ada dalam SATU halaman
# (banjarasri.com adalah one-page site dengan anchor #tentang,
# #fasilitas, dst) -- jadi cukup 1 URL saja yang perlu diambil.

from html.parser import HTMLParser


class _EkstrakTeksHTML(HTMLParser):
    """Parser HTML paling sederhana -- buang tag <script>/<style> dan
    ambil semua teks yang terlihat di halaman, dikasih baris baru di
    batas elemen blok (<p>, <div>, <li>, heading, dst) supaya hasilnya
    tetap enak dibaca (bukan satu paragraf raksasa tanpa jeda)."""

    _TAG_BLOK = {
        "p", "div", "li", "tr", "br",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "section", "article", "header", "footer",
    }

    def __init__(self):
        super().__init__()
        self._sedang_di_skip = False
        self._potongan = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._sedang_di_skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._sedang_di_skip = False
        if tag in self._TAG_BLOK:
            self._potongan.append("\n")

    def handle_data(self, data):
        if self._sedang_di_skip:
            return
        teks = data.strip()
        if teks:
            self._potongan.append(teks + " ")

    def ambil_teks(self):
        gabungan = "".join(self._potongan)
        gabungan = re.sub(r"[ \t]+", " ", gabungan)
        gabungan = re.sub(r"\n[ \t]*", "\n", gabungan)
        gabungan = re.sub(r"\n{2,}", "\n", gabungan)
        return gabungan.strip()


def _ekstrak_teks_polos_dari_html(html_mentah):
    parser = _EkstrakTeksHTML()
    try:
        parser.feed(html_mentah)
    except Exception:
        pass
    return parser.ambil_teks()


_cache_web_lock = threading.Lock()
_cache_web_sekolah = {"teks": None, "waktu": 0.0}

# Isi web (eskul, fasilitas, kontak, dll) jarang berubah -- cache agak
# lama biar hemat, tapi tetap disegarkan otomatis tiap ~1 jam.
TTL_CACHE_WEB_SEKOLAH_DETIK = 60 * 60  # 1 jam

# Batas panjang teks yang disuntik ke prompt, jaga-jaga kalau halamannya
# suatu saat jadi sangat panjang -- jangan sampai boros token/kepotong
# aneh di tengah oleh Gemini.
MAKS_KARAKTER_KONTEKS_WEB = 8000


def ambil_konteks_website_sekolah(url=None, paksa_refresh=False):
    """Ambil isi halaman web sekolah (banjarasri.com) LANGSUNG dari
    server (bukan lewat tool url_context Gemini), ubah jadi teks polos,
    dan cache TTL_CACHE_WEB_SEKOLAH_DETIK detik.

    SENGAJA tidak melempar exception kalau gagal (sama seperti
    ambil_data_prestasi) -- kalau web sekolah down/timeout, AI Support
    tetap harus bisa jawab pertanyaan LAIN yang tidak butuh info web.
    Kalau gagal:
    - Ada cache lama? -> pakai cache lama itu (lebih baik agak basi
      daripada kosong sama sekali).
    - Belum pernah berhasil sama sekali? -> balikin None.
    """
    url = (url or "https://www.banjarasri.com/").strip()

    with _cache_web_lock:
        if not paksa_refresh and _cache_web_sekolah["teks"] is not None:
            if time.time() - _cache_web_sekolah["waktu"] < TTL_CACHE_WEB_SEKOLAH_DETIK:
                return _cache_web_sekolah["teks"]

    try:
        resp = requests.get(
            url,
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0 (compatible; AISupportBanjarAsri/1.0)"},
        )
        resp.raise_for_status()
        teks = _ekstrak_teks_polos_dari_html(resp.text)
        if not teks:
            raise ValueError("Hasil ekstraksi teks kosong.")
        teks = teks[:MAKS_KARAKTER_KONTEKS_WEB]
    except Exception:
        with _cache_web_lock:
            if _cache_web_sekolah["teks"] is not None:
                return _cache_web_sekolah["teks"]
        return None

    with _cache_web_lock:
        _cache_web_sekolah["teks"] = teks
        _cache_web_sekolah["waktu"] = time.time()
    return teks


# ----------------------------------------------------
# CATATAN: FITUR RIWAYAT PEMBAYARAN SISWA SUDAH DIHAPUS TOTAL
# ----------------------------------------------------
# Dulu di sini ada fungsi ambil_riwayat_pembayaran() &
# format_riwayat_pembayaran_untuk_konteks() yang mengambil data dari
# Supabase project finance (SUPABASE_FINANCE_URL) dan menyuntikkannya ke
# system prompt Gemini supaya AI Support bisa jawab pertanyaan SPP/
# pembayaran. Fitur ini SUDAH DIHAPUS TOTAL atas permintaan -- AI Support
# sekarang tidak pernah lagi mengambil/menampilkan data pembayaran apa
# pun (lihat aturan tolak permanen di SYSTEM_PROMPT_TEMPLATE, routes.py).
#
# Kalau nanti fitur ini mau diaktifkan lagi, servicenya perlu dibuat
# ulang dari awal -- SEBELUM itu, JANGAN taruh URL/anon key Supabase
# langsung di source code seperti sebelumnya (itu sempat ter-hardcode di
# sini sebagai fallback os.environ.get()); pakai HANYA variabel
# environment (.env, tidak di-commit ke repo).


# ----------------------------------------------------
# OPTIMASI TOKEN (BARU): BATASI RIWAYAT CHAT YANG IKUT DIKIRIM KE GEMINI
# ----------------------------------------------------
# CATATAN: saat ini gemini_routes.py TIDAK mengirim `riwayat` sama sekali
# (tiap chat diperlakukan berdiri sendiri, tanpa memori percakapan) --
# jadi fungsi ini belum "aktif" dipakai. Tapi kalau nanti fitur memori
# percakapan diaktifkan, riwayat WAJIB dipangkas dulu lewat fungsi ini
# SEBELUM dioper ke tanya_gemini()/tanya_gemini_stream(), supaya prompt
# tidak membengkak tanpa batas seiring panjangnya obrolan.
#
# Aturan pemangkasan:
# - Hanya MAKS_TURN_RIWAYAT pasangan/baris TERAKHIR yang dikirim (default
#   5) -- turn yang lebih lama dibuang total, bukan dirangkum (merangkum
#   otomatis butuh panggilan Gemini lagi, jadi malah nambah kuota, bukan
#   ngirit). Kalau butuh "ingatan" lebih panjang dari itu, simpan
#   ringkasannya secara MANUAL di sisi pemanggil (mis. 1 baris ringkasan
#   fakta penting yang disisipkan sebagai riwayat "role: user" paling
#   awal), BUKAN dengan menaikkan angka ini.
# - Tiap baris riwayat juga dipotong ke MAKS_KARAKTER_PER_TURN karakter
#   -- jaga-jaga kalau ada 1 turn yang sangat panjang (mis. user pernah
#   tempel teks panjang), supaya 1 turn saja tidak mendominasi jatah
#   token yang seharusnya buat konteks lain (prestasi/web/quiz).
MAKS_TURN_RIWAYAT = int((os.environ.get("AI_MAKS_TURN_RIWAYAT") or "5").strip() or "5")
MAKS_KARAKTER_PER_TURN = 600


def potong_riwayat_untuk_konteks(riwayat, maks_turn=None):
    """Pangkas `riwayat` (list [{"role": "user"/"model", "text": "..."}])
    supaya cuma `maks_turn` (default MAKS_TURN_RIWAYAT) entri PALING
    BARU yang disertakan, tiap entri juga dipotong panjangnya. Aman
    dipanggil dengan riwayat kosong/None (balikin list kosong).

    Panggil ini SEBELUM mengoper `riwayat` ke tanya_gemini()/
    tanya_gemini_stream(), bukan menaruh logic pemangkasan sendiri-
    sendiri di tiap pemanggil."""
    if not riwayat:
        return []
    batas = maks_turn if maks_turn is not None else MAKS_TURN_RIWAYAT
    if batas <= 0:
        return []
    terbaru = list(riwayat)[-batas:]
    hasil = []
    for baris in terbaru:
        if not isinstance(baris, dict):
            continue
        role = baris.get("role")
        teks = (baris.get("text") or "").strip()
        if role not in ("user", "model") or not teks:
            continue
        if len(teks) > MAKS_KARAKTER_PER_TURN:
            teks = teks[:MAKS_KARAKTER_PER_TURN].rstrip() + " […dipotong]"
        hasil.append({"role": role, "text": teks})
    return hasil


class GeminiError(Exception):
    """Dilempar kalau ada apapun yang gagal saat menghubungi Gemini --
    dari API key kosong/salah, koneksi putus, sampai balasan yang aneh.
    Pesannya sengaja ditulis dalam Bahasa Indonesia yang jelas supaya bisa
    langsung ditampilkan ke user tanpa perlu diterjemahkan lagi."""
    pass


# Berapa kali dicoba ulang kalau Gemini balas 503 (server lagi sibuk/
# overload) -- 1 kali percobaan awal + MAKS_RETRY kali ulang, jadi total
# maksimal percobaan = MAKS_RETRY + 1.
MAKS_RETRY_503 = 2

# Jeda dasar (detik) sebelum percobaan ulang pertama. Percobaan berikutnya
# jedanya digandakan (exponential backoff) + sedikit variasi acak (jitter)
# supaya kalau banyak request nyoba ulang bersamaan, tidak semuanya
# "nabrak" Gemini di detik yang sama persis.
JEDA_DASAR_RETRY = 2

# ----------------------------------------------------
# CIRCUIT BREAKER UNTUK ERROR KUOTA (429) BERUNTUN
# ----------------------------------------------------
# tanya_gemini()/tanya_gemini_stream() di bawah SUDAH aman dari retry tak
# berujung (loop retry-nya dibatasi MAKS_RETRY_503, cuma untuk status 503,
# dan selalu ada jeda sebelum retry). Circuit breaker ini adalah lapisan
# PERTAHANAN TAMBAHAN, jaga-jaga kalau suatu saat ada bug LAIN di kode
# manapun (mis. di gemini_routes.py atau file lain) yang memanggil fungsi
# di modul ini berulang-ulang dari dalam loop tanpa sengaja -- terutama
# bahaya kalau itu terjadi tepat setelah API key baru diisi (bisa langsung
# menghabiskan kuota harian dalam hitungan detik).
#
# Cara kerja: kalau Gemini balas 429 (kuota/rate limit habis) sebanyak
# AMBANG_429_BERUNTUN kali BERTURUT-TURUT, "sirkuit" dianggap terbuka
# selama JEDA_SIRKUIT_TERBUKA_DETIK -- selama itu, SEMUA panggilan ke
# Gemini langsung ditolak dari sini (GeminiError) TANPA pernah mengirim
# request ke API sama sekali, jadi tidak ada tambahan konsumsi kuota.
# Sirkuit otomatis "reset" (hitungan beruntun kembali ke 0) begitu ada
# satu panggilan yang berhasil (bukan 429).
_circuit_lock = threading.Lock()
_circuit_state = {"beruntun_429": 0, "buka_sampai": 0.0}

AMBANG_429_BERUNTUN = 3          # 3x kena 429 berturut-turut -> sirkuit dibuka
JEDA_SIRKUIT_TERBUKA_DETIK = 60  # selama ini, tolak semua panggilan tanpa nembak API


def _circuit_breaker_cek():
    with _circuit_lock:
        sisa = _circuit_state["buka_sampai"] - time.time()
        if sisa > 0:
            raise GeminiError(
                f"Terlalu banyak error kuota (429) beruntun -- pemanggilan ke "
                f"Gemini dijeda otomatis selama {int(sisa)} detik lagi untuk "
                "melindungi sisa kuota. Coba lagi setelah jeda ini selesai."
            )


def _circuit_breaker_catat_429():
    with _circuit_lock:
        _circuit_state["beruntun_429"] += 1
        if _circuit_state["beruntun_429"] >= AMBANG_429_BERUNTUN:
            _circuit_state["buka_sampai"] = time.time() + JEDA_SIRKUIT_TERBUKA_DETIK


def _circuit_breaker_catat_sukses():
    with _circuit_lock:
        _circuit_state["beruntun_429"] = 0


# ----------------------------------------------------
# PELAPORAN USAGE (untuk Pemantauan API)
# ----------------------------------------------------
# tanya_gemini()/tanya_gemini_stream() menerima parameter OPSIONAL
# `on_usage`: callback yang dipanggil TEPAT SATU KALI per panggilan API
# nyata ke Gemini dengan dict:
#   {model, stream, status ("ok"|"error"|"terputus"), jenis_error,
#    http_status, percobaan, latensi_ms, usage}
# `usage` = isi usageMetadata ASLI dari Gemini (atau None). Token tidak
# pernah dihitung/ditebak di sini. Kalau request tidak pernah terkirim
# (key kosong, pesan kosong, circuit breaker terbuka) callback TIDAK
# dipanggil karena memang tidak ada panggilan API. Kalau on_usage tidak
# diisi, perilaku fungsi 100% sama seperti sebelumnya.

def _lapor_usage(on_usage, laporan, mulai):
    """Panggil on_usage (kalau ada & request memang terkirim). Tidak pernah
    melempar exception -- gagal melapor tidak boleh mengganggu chat."""
    if on_usage is None or not laporan.get("request_terkirim"):
        return
    try:
        info = dict(laporan)
        info["latensi_ms"] = int((time.monotonic() - mulai) * 1000)
        on_usage(info)
    except Exception:
        pass


def _jenis_error_dari_laporan(laporan):
    if laporan.get("jenis_error"):
        return laporan["jenis_error"]
    kode = laporan.get("http_status")
    if isinstance(kode, int) and kode >= 400:
        return f"http_{kode}"
    return "respons_tidak_valid"


def _tanya_gemini_inti(pesan, system_prompt=None, model=None, riwayat=None, timeout=60,
                        pakai_url_context=False, gambar_base64=None, gambar_mime_type=None,
                        _laporan=None):
    """Kirim satu pertanyaan ke Gemini dan kembalikan teks jawabannya (str).

    Parameter:
    - pesan: pertanyaan/pesan terbaru dari user. Boleh kosong KALAU
      gambar_base64 diisi (mis. user cuma kirim foto tanpa caption).
    - system_prompt: instruksi "peran" AI ini (opsional), mis. "Kamu adalah
      asisten sekolah, jawab singkat & sopan."
    - model: override model default (opsional), mis. "gemini-2.0-pro".
    - riwayat: opsional, list riwayat chat sebelumnya dengan format
      [{"role": "user"/"model", "text": "..."}], dipakai kalau mau bikin
      chat yang "ingat" percakapan sebelumnya. Kalau tidak diisi, tiap
      pertanyaan diperlakukan berdiri sendiri (tanpa konteks sebelumnya).
      CATATAN: riwayat di sini murni teks -- foto TIDAK ikut disimpan/
      dikirim ulang lewat riwayat (lihat catatan gambar_base64 di bawah).
    - timeout: batas waktu tunggu request (detik).
    - pakai_url_context: kalau True, aktifkan fitur "URL Context" bawaan
      Gemini -- Gemini akan otomatis membuka & membaca halaman web yang
      disebutkan di prompt/system_prompt (mis. link web sekolah) buat
      cari info terbaru, tanpa kita perlu scraping manual. Butuh URL-nya
      memang disebutkan di teks prompt supaya Gemini tahu halaman mana
      yang boleh/perlu dibuka.
    - gambar_base64: opsional, string base64 MENTAH (TANPA prefix
      "data:image/...;base64,") dari 1 foto yang mau disertakan di pesan
      user paling akhir ini saja -- dipakai buat fitur "kirim foto soal"
      di AI Support. Cuma didukung untuk pesan TERBARU (bukan riwayat
      lama), karena riwayat percakapan sengaja disimpan sebagai teks
      polos saja (lihat gemini_routes.py) supaya tidak perlu menyimpan
      file foto siapa pun di server/session.
    - gambar_mime_type: mime type foto di atas (mis. "image/jpeg",
      "image/png", "image/webp"). Wajib diisi kalau gambar_base64 diisi.

    Kalau Gemini balas 503 (server lagi sibuk/overload), fungsi ini otomatis
    COBA ULANG beberapa kali (lihat MAKS_RETRY_503) dengan jeda yang makin
    lama sebelum akhirnya menyerah -- jadi user tidak langsung lihat error
    cuma gara-gara Gemini lagi sibuk sebentar.

    Melempar GeminiError kalau ada kegagalan apapun, supaya pemanggil
    (route Flask, script test, dll) tinggal try/except satu jenis error saja.
    """
    if not GEMINI_API_KEY:
        raise GeminiError(
            "GEMINI_API_KEY belum diisi. Buka file .env, isi baris "
            "GEMINI_API_KEY=isi-key-kamu-di-sini, lalu restart server."
        )
    teks_pesan = (pesan or "").strip()
    if not teks_pesan and not gambar_base64:
        raise GeminiError("Pesan tidak boleh kosong.")

    _circuit_breaker_cek()  # lempar GeminiError duluan kalau sirkuit lagi terbuka

    model_dipakai = (model or GEMINI_MODEL).strip()
    url = GEMINI_API_URL_TEMPLATE.format(model=model_dipakai)

    # Susun riwayat percakapan (kalau ada) + pesan terbaru jadi format
    # "contents" yang diminta Gemini API.
    # OPTIMASI TOKEN: riwayat SELALU dipangkas dulu lewat
    # potong_riwayat_untuk_konteks() (maks MAKS_TURN_RIWAYAT turn
    # terakhir) -- diterapkan DI SINI (bukan cuma "disarankan" ke
    # pemanggil) supaya jaminannya tidak tergantung pemanggil ingat
    # memanggilnya atau tidak.
    contents = []
    for baris in potong_riwayat_untuk_konteks(riwayat):
        contents.append({"role": baris["role"], "parts": [{"text": baris["text"]}]})

    # Bagian pesan user PALING AKHIR: gambar (kalau ada) diletakkan
    # SEBELUM teks -- urutan ini yang direkomendasikan Google supaya
    # model "melihat" gambarnya dulu baru membaca instruksi/pertanyaan
    # yang menyertainya.
    parts_terbaru = []
    if gambar_base64:
        parts_terbaru.append({
            "inline_data": {
                "mime_type": gambar_mime_type or "image/jpeg",
                "data": gambar_base64,
            }
        })
    if teks_pesan:
        parts_terbaru.append({"text": teks_pesan})
    contents.append({"role": "user", "parts": parts_terbaru})

    payload = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": GEMINI_MAX_OUTPUT_TOKENS},
    }
    if system_prompt:
        payload["system_instruction"] = {"parts": [{"text": system_prompt}]}
    if pakai_url_context:
        payload["tools"] = [{"url_context": {}}]

    # percobaan ke-0 = percobaan pertama (bukan retry), percobaan ke-1 dst
    # = hasil retry setelah dapat 503 di percobaan sebelumnya.
    for percobaan in range(MAKS_RETRY_503 + 1):
        _laporan["request_terkirim"] = True
        _laporan["percobaan"] = percobaan + 1
        try:
            resp = requests.post(
                url,
                params={"key": GEMINI_API_KEY},
                json=payload,
                timeout=timeout
            )
        except requests.exceptions.ConnectionError:
            _laporan["jenis_error"] = "koneksi"
            raise GeminiError("Tidak bisa terhubung ke server Gemini. Cek koneksi internet.")
        except requests.exceptions.Timeout:
            _laporan["jenis_error"] = "timeout"
            raise GeminiError("Gemini terlalu lama merespons (timeout), coba lagi.")

        # 503 = server Gemini lagi sibuk/overload sementara -- ini satu-
        # satunya status yang layak dicoba ulang otomatis, karena biasanya
        # cuma butuh nunggu beberapa detik sampai kapasitasnya longgar lagi.
        if resp.status_code == 503 and percobaan < MAKS_RETRY_503:
            jeda = JEDA_DASAR_RETRY * (2 ** percobaan) + random.uniform(0, 1)
            time.sleep(jeda)
            continue

        # Kalau bukan 503 (atau sudah kehabisan jatah retry), langsung
        # lanjut ke pengecekan status di bawah seperti biasa.
        break

    _laporan["http_status"] = resp.status_code

    if resp.status_code == 400:
        raise GeminiError(f"Request ke Gemini tidak valid (400): {resp.text[:300]}")
    if resp.status_code in (401, 403):
        raise GeminiError(
            "API Key Gemini ditolak (401/403). Cek lagi GEMINI_API_KEY di "
            "file .env, pastikan tidak ada spasi/tanda kutip nyasar."
        )
    if resp.status_code == 404:
        raise GeminiError(
            f"Model '{model_dipakai}' tidak ditemukan (404), atau API key ini "
            "belum diberi akses ke model tersebut. Cek nama model di "
            f"GEMINI_MODEL (.env), atau cek status akun/billing di AI Studio. "
            f"Pesan asli dari Google: {resp.text[:500]}"
        )
    if resp.status_code == 429:
        _circuit_breaker_catat_429()
        raise GeminiError(f"Kuota/rate limit Gemini terlampaui, coba lagi sebentar. Detail: {resp.text[:300]}")
    if resp.status_code == 503:
        raise GeminiError(
            "Gemini sedang sibuk (503) dan tetap gagal setelah "
            f"{MAKS_RETRY_503} kali percobaan ulang. Coba lagi sebentar lagi."
        )
    if not resp.ok:
        raise GeminiError(f"Gemini mengembalikan error {resp.status_code}: {resp.text[:300]}")

    _circuit_breaker_catat_sukses()  # lolos semua pengecekan status -> reset hitungan 429 beruntun

    hasil = resp.json()
    # Usage ASLI dari Gemini (None kalau tidak ada) -- tidak pernah ditebak.
    _laporan["usage"] = hasil.get("usageMetadata") if isinstance(hasil, dict) else None

    kandidat_list = hasil.get("candidates") or []
    if not kandidat_list:
        # Bisa kejadian kalau prompt ke-block oleh filter keamanan Google
        # SEBELUM sempat menghasilkan kandidat jawaban sama sekali.
        alasan = (hasil.get("promptFeedback") or {}).get("blockReason")
        if alasan:
            raise GeminiError(f"Pertanyaan diblokir oleh filter keamanan Gemini ({alasan}).")
        raise GeminiError("Gemini tidak mengembalikan jawaban apapun.")

    kandidat = kandidat_list[0]
    finish_reason = kandidat.get("finishReason")
    parts = (kandidat.get("content") or {}).get("parts") or []
    teks = "".join(p.get("text", "") for p in parts).strip()

    if not teks:
        if finish_reason == "SAFETY":
            raise GeminiError("Jawaban diblokir oleh filter keamanan Gemini.")
        raise GeminiError("Format balasan Gemini tidak dikenali / kosong.")

    return teks


def tanya_gemini(pesan, system_prompt=None, model=None, riwayat=None, timeout=60,
                  pakai_url_context=False, gambar_base64=None, gambar_mime_type=None,
                  on_usage=None):
    """Kirim satu pertanyaan ke Gemini dan kembalikan teks jawabannya (str).

    Dokumentasi lengkap parameter & perilaku: lihat docstring
    _tanya_gemini_inti() tepat di atas. Tambahan satu-satunya:
    - on_usage: opsional, callback(info: dict) yang dipanggil satu kali per
      panggilan API nyata (sukses maupun gagal) berisi usageMetadata ASLI
      dari Gemini -- lihat catatan "PELAPORAN USAGE" di atas. Return value
      dan exception fungsi ini TIDAK berubah.
    """
    laporan = {
        "model": (model or GEMINI_MODEL).strip(),
        "stream": False,
        "request_terkirim": False,
        "usage": None,
        "http_status": None,
        "percobaan": 0,
        "jenis_error": None,
    }
    mulai = time.monotonic()
    try:
        teks = _tanya_gemini_inti(
            pesan, system_prompt=system_prompt, model=model, riwayat=riwayat,
            timeout=timeout, pakai_url_context=pakai_url_context,
            gambar_base64=gambar_base64, gambar_mime_type=gambar_mime_type,
            _laporan=laporan,
        )
        laporan["status"] = "ok"
        return teks
    except Exception:
        laporan["status"] = "error"
        laporan["jenis_error"] = _jenis_error_dari_laporan(laporan)
        raise
    finally:
        _lapor_usage(on_usage, laporan, mulai)


def _tanya_gemini_stream_inti(pesan, system_prompt=None, model=None, riwayat=None, timeout=60,
                               pakai_url_context=False, gambar_base64=None, gambar_mime_type=None,
                               _laporan=None, _on_usage=None, _mulai=None):
    """Sama seperti tanya_gemini(), tapi mengembalikan GENERATOR yang
    yield potongan teks (str) satu-satu begitu Gemini mengeluarkannya --
    dipakai buat bikin efek "ngetik" real-time di frontend (kayak ChatGPT),
    bukan nunggu jawaban lengkap baru muncul sekaligus.

    Parameter pakai_url_context, gambar_base64, dan gambar_mime_type sama
    persis kegunaannya seperti di tanya_gemini() -- lihat dokumentasi di
    sana.

    Cara pakai (biasanya dari route Flask yang bikin response SSE):

        for potongan in tanya_gemini_stream("Halo"):
            ...kirim `potongan` ke client, misal lewat Server-Sent Events...

    CATATAN:
    - GeminiError dilempar kalau gagal SEBELUM streaming mulai (key
      kosong, pesan kosong, status 400/401/403/404/429/503, dst) --
      sama seperti tanya_gemini().
    - TIDAK ada retry otomatis untuk 503 di versi streaming ini (beda
      dari tanya_gemini() biasa) -- soalnya kalau sudah mulai ngetik lalu
      putus di tengah, "retry dari awal" bakal bikin jawaban dobel/aneh
      di layar user. Kalau gagal duluan sebelum sempat streaming apapun,
      user tinggal kirim ulang pertanyaannya (biasanya sudah cukup).
    - Kalau koneksi putus DI TENGAH streaming (bukan di awal), itu akan
      muncul sebagai exception biasa dari `requests` saat generator ini
      di-iterasi -- pemanggil (route Flask) sebaiknya bungkus loop-nya
      dengan try/except juga, bukan cuma andalkan GeminiError di sini.
    """
    if not GEMINI_API_KEY:
        raise GeminiError(
            "GEMINI_API_KEY belum diisi. Buka file .env, isi baris "
            "GEMINI_API_KEY=isi-key-kamu-di-sini, lalu restart server."
        )
    teks_pesan = (pesan or "").strip()
    if not teks_pesan and not gambar_base64:
        raise GeminiError("Pesan tidak boleh kosong.")

    _circuit_breaker_cek()  # lempar GeminiError duluan kalau sirkuit lagi terbuka

    model_dipakai = (model or GEMINI_MODEL).strip()
    url = GEMINI_API_STREAM_URL_TEMPLATE.format(model=model_dipakai)

    # OPTIMASI TOKEN: sama seperti tanya_gemini() -- lihat catatan di sana.
    contents = []
    for baris in potong_riwayat_untuk_konteks(riwayat):
        contents.append({"role": baris["role"], "parts": [{"text": baris["text"]}]})

    parts_terbaru = []
    if gambar_base64:
        parts_terbaru.append({
            "inline_data": {
                "mime_type": gambar_mime_type or "image/jpeg",
                "data": gambar_base64,
            }
        })
    if teks_pesan:
        parts_terbaru.append({"text": teks_pesan})
    contents.append({"role": "user", "parts": parts_terbaru})

    payload = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": GEMINI_MAX_OUTPUT_TOKENS},
    }
    if system_prompt:
        payload["system_instruction"] = {"parts": [{"text": system_prompt}]}
    if pakai_url_context:
        payload["tools"] = [{"url_context": {}}]

    _laporan["request_terkirim"] = True
    _laporan["percobaan"] = 1
    try:
        # stream=True -- PENTING: ini yang bikin `requests` tidak nunggu
        # seluruh body kebaca dulu, langsung dikasih ke kita per-baris
        # begitu datang dari Gemini.
        resp = requests.post(
            url,
            params={"key": GEMINI_API_KEY, "alt": "sse"},
            json=payload,
            timeout=timeout,
            stream=True,
        )
    except requests.exceptions.ConnectionError:
        _laporan["jenis_error"] = "koneksi"
        raise GeminiError("Tidak bisa terhubung ke server Gemini. Cek koneksi internet.")
    except requests.exceptions.Timeout:
        _laporan["jenis_error"] = "timeout"
        raise GeminiError("Gemini terlalu lama merespons (timeout), coba lagi.")

    # Status code sudah bisa dicek di sini (headers sudah sampai) walau
    # body-nya belum selesai kebaca semua -- jadi error di awal (key
    # salah, model salah, dst) tetap ketahuan SEBELUM mulai "ngetik".
    _laporan["http_status"] = resp.status_code
    if resp.status_code == 400:
        raise GeminiError(f"Request ke Gemini tidak valid (400): {resp.text[:300]}")
    if resp.status_code in (401, 403):
        raise GeminiError(
            "API Key Gemini ditolak (401/403). Cek lagi GEMINI_API_KEY di "
            "file .env, pastikan tidak ada spasi/tanda kutip nyasar."
        )
    if resp.status_code == 404:
        raise GeminiError(
            f"Model '{model_dipakai}' tidak ditemukan (404), atau API key ini "
            "belum diberi akses ke model tersebut. Cek nama model di "
            f"GEMINI_MODEL (.env), atau cek status akun/billing di AI Studio. "
            f"Pesan asli dari Google: {resp.text[:500]}"
        )
    if resp.status_code == 429:
        _circuit_breaker_catat_429()
        raise GeminiError(f"Kuota/rate limit Gemini terlampaui, coba lagi sebentar. Detail: {resp.text[:300]}")
    if resp.status_code == 503:
        raise GeminiError(f"Gemini sedang sibuk (503), coba lagi sebentar. Detail: {resp.text[:300]}")
    if not resp.ok:
        raise GeminiError(f"Gemini mengembalikan error {resp.status_code}: {resp.text[:300]}")

    _circuit_breaker_catat_sukses()  # lolos semua pengecekan status -> reset hitungan 429 beruntun

    def _pecah_jadi_potongan_teks():
        usage_terakhir = None
        selesai_normal = False
        try:
            for baris_mentah in resp.iter_lines(decode_unicode=True):
                if not baris_mentah or not baris_mentah.startswith("data: "):
                    continue  # baris kosong/komentar SSE, lewati saja
                potongan_json = baris_mentah[len("data: "):]
                try:
                    potongan = json.loads(potongan_json)
                except json.JSONDecodeError:
                    continue  # baris tidak valid, lewati -- jangan crash total
                # Usage ASLI dari Gemini: tiap chunk boleh membawa
                # usageMetadata, nilai final ada di chunk terakhir.
                um = potongan.get("usageMetadata")
                if isinstance(um, dict) and um:
                    usage_terakhir = um
                kandidat_list = potongan.get("candidates") or []
                if not kandidat_list:
                    continue
                parts = (kandidat_list[0].get("content") or {}).get("parts") or []
                for p in parts:
                    teks_potongan = p.get("text")
                    if teks_potongan:
                        yield teks_potongan
            selesai_normal = True
        except GeneratorExit:
            _laporan["jenis_error"] = "klien_terputus"
            raise
        except BaseException:
            _laporan["jenis_error"] = "stream_error"
            raise
        finally:
            if selesai_normal:
                _laporan["status"] = "ok"
                _laporan["usage"] = usage_terakhir
            else:
                # Stream putus/dibatalkan: usage FINAL tidak pernah diterima,
                # jadi token sengaja dikosongkan (tidak ditebak).
                _laporan["status"] = "terputus"
                _laporan["usage"] = None
            _lapor_usage(_on_usage, _laporan, _mulai)

    return _pecah_jadi_potongan_teks()


def tanya_gemini_stream(pesan, system_prompt=None, model=None, riwayat=None, timeout=60,
                         pakai_url_context=False, gambar_base64=None, gambar_mime_type=None,
                         on_usage=None):
    """Versi streaming dari tanya_gemini(): mengembalikan GENERATOR potongan
    teks. Dokumentasi lengkap: lihat docstring _tanya_gemini_stream_inti()
    tepat di atas. Tambahan satu-satunya: on_usage (opsional) -- callback
    yang dipanggil satu kali saat stream selesai/putus (atau saat gagal
    sebelum stream mulai), berisi usageMetadata ASLI dari chunk terakhir.
    Stream yang putus di tengah dilaporkan status "terputus" tanpa token.
    """
    laporan = {
        "model": (model or GEMINI_MODEL).strip(),
        "stream": True,
        "request_terkirim": False,
        "usage": None,
        "http_status": None,
        "percobaan": 0,
        "jenis_error": None,
    }
    mulai = time.monotonic()
    try:
        return _tanya_gemini_stream_inti(
            pesan, system_prompt=system_prompt, model=model, riwayat=riwayat,
            timeout=timeout, pakai_url_context=pakai_url_context,
            gambar_base64=gambar_base64, gambar_mime_type=gambar_mime_type,
            _laporan=laporan, _on_usage=on_usage, _mulai=mulai,
        )
    except Exception:
        # Gagal SEBELUM stream mulai (status HTTP error, timeout, dst).
        laporan["status"] = "error"
        laporan["jenis_error"] = _jenis_error_dari_laporan(laporan)
        _lapor_usage(on_usage, laporan, mulai)
        raise
 