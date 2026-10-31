# ----------------------------------------------------
# AI_USAGE_LOG.PY
# ----------------------------------------------------
# Pemantauan pemakaian API AI Support (Gemini): log JSONL append-only +
# agregasi untuk halaman admin "Pemantauan API".
#
# PRINSIP (sengaja dijaga ketat):
#   1. Cache hit BUKAN panggilan generateContent. Cache hit dicatat sebagai
#      jenis "chat" (sumber exact/semantic/image) dengan token_gemini = 0.
#   2. generateContent ("generate_content") dan embedding ("embedding")
#      dicatat TERPISAH, masing-masing SATU record per panggilan API nyata.
#   3. Token HANYA diambil dari usageMetadata yang dikirim Gemini. Kalau
#      tidak ada (request gagal / timeout / stream putus) token = tidak ada
#      (null), TIDAK PERNAH ditebak atau dihitung dari panjang teks.
#   4. Tidak ada double logging: tiap panggilan API dicatat sekali di titik
#      panggilannya (gemini_service.py / semantic_cache_service.py), tiap
#      permintaan chat dicatat sekali di gemini_routes.py (dijaga flag
#      "chat_tercatat" di konteks).
#   5. Logging TIDAK PERNAH melempar exception ke pemanggil. Semua fungsi
#      publik dibungkus try/except -- gagal menulis log tidak boleh membuat
#      chat gagal.
#   6. ISI CHAT TIDAK DISIMPAN -- hanya panjang pesan (jumlah karakter).
#
# PENYIMPANAN
#   data/ai_usage/ai_usage-YYYY-MM-DD.jsonl  (satu file per hari server)
#   - Satu file per hari = rotasi otomatis berdasarkan tanggal, aman untuk
#     beberapa worker/proses (mode append + SATU write() per baris), tidak
#     ada rotasi berbasis ukuran yang bisa bentrok antar proses.
#   - Dalam satu proses, penulisan dijaga threading.Lock (server jalan
#     dengan threaded=True).
#   - Tidak ada data yang dihapus otomatis.
#
# HARGA / BIAYA
#   TIDAK ada angka harga yang di-hardcode. Biaya hanya dihitung kalau harga
#   diisi lewat .env (harga per 1 JUTA token, sesuai daftar harga Google):
#     AI_HARGA_INPUT_PER_JUTA=...        (token input/prompt)
#     AI_HARGA_OUTPUT_PER_JUTA=...       (token output; sudah termasuk thinking)
#     AI_HARGA_CACHED_PER_JUTA=...       (opsional, token input yang kena cache)
#     AI_HARGA_EMBEDDING_PER_JUTA=...    (opsional, hanya dipakai kalau API
#                                          melaporkan token embedding)
#     AI_HARGA_MATA_UANG=USD             (label saja, bawaan USD)
#     AI_HARGA_MODEL_JSON={"nama-model":{"input":..,"output":..,"cached":..}}
#                                         (opsional, menimpa harga di atas
#                                          per model)
#   Kalau harga belum diisi, biaya ditampilkan "belum dikonfigurasi".
#   Biaya dihitung saat DIBACA (bukan saat ditulis), jadi memperbaiki harga
#   di .env langsung berlaku untuk seluruh histori.
#
# CATATAN AKURASI
#   - embedContent Gemini tidak selalu mengembalikan usageMetadata. Kalau
#     tidak ada, jumlah PANGGILAN embedding tetap dihitung tapi token & biaya
#     embedding tidak (tidak ditebak).
#   - Stream yang putus di tengah jalan dicatat "terputus" tanpa token
#     (usageMetadata final baru dikirim di akhir stream).
# ----------------------------------------------------

import calendar
import hashlib
import json
import os
import re
import threading
import time
import uuid

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from flask import session, has_request_context
except ImportError:  # dipakai di luar Flask (script test) -> tanpa konteks sesi
    session = None

    def has_request_context():
        return False


# ----------------------------------------------------
# KONFIGURASI
# ----------------------------------------------------
LOG_AKTIF = (os.environ.get("AI_USAGE_LOG_AKTIF", "1").strip() != "0")

# Sama pola dengan CACHE_FILE_PATH/QUOTA_FILE_PATH di gemini_routes.py:
# modul ini ada di services/, jadi naik satu folder ke root project dulu.
DATA_DIR = (os.environ.get("AI_USAGE_LOG_DIR") or "").strip() or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "ai_usage",
)

_POLA_NAMA_FILE = re.compile(r"^ai_usage-(\d{4}-\d{2}-\d{2})\.jsonl$")
_POLA_TANGGAL = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_POLA_BULAN = re.compile(r"^\d{4}-\d{2}$")

SUMBER_CACHE = ("exact", "semantic", "image")
KELAS_TIDAK_ADA = "Tidak tercatat"
KONTEKS_KEDALUWARSA_DETIK = 180

_tulis_lock = threading.Lock()


def _path_hari(tanggal):
    return os.path.join(DATA_DIR, f"ai_usage-{tanggal}.jsonl")


# ----------------------------------------------------
# PENULISAN LOG
# ----------------------------------------------------
def _tulis(rec):
    """Tambah SATU baris JSON ke file log hari ini. Best-effort, tidak
    pernah melempar exception."""
    if not LOG_AKTIF:
        return False
    try:
        ts = time.time()
        rec["ts"] = round(ts, 3)
        lt = time.localtime(ts)
        rec["t"] = time.strftime("%Y-%m-%d %H:%M:%S", lt)
        baris = (json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        path = _path_hari(time.strftime("%Y-%m-%d", lt))
        with _tulis_lock:
            os.makedirs(DATA_DIR, exist_ok=True)
            # SATU write() per baris pada file mode append -> baris utuh
            # walau ada proses lain yang menulis ke file yang sama.
            with open(path, "ab") as f:
                f.write(baris)
        return True
    except Exception:
        return False


# ----------------------------------------------------
# KONTEKS PERMINTAAN (siapa yang chat, endpoint mana, id permintaan)
# ----------------------------------------------------
# Disimpan di thread-local, BUKAN flask.g: respons streaming dijalankan
# ulang lewat stream_with_context (app context baru -> g baru), sehingga g
# tidak bisa diandalkan di dalam generator SSE. Route mengoper objek
# konteks secara eksplisit ke catat_chat()/pelapor generate, dan thread-
# local ini hanya dipakai untuk kode yang tidak dioper konteks (embedding).
_lokal = threading.local()
_kelas_provider = None
_cache_kelas = {}
_cache_kelas_lock = threading.Lock()
TTL_CACHE_KELAS_DETIK = 600


def set_kelas_provider(fn):
    """OPSIONAL. Daftarkan fungsi fn(username) -> str|None yang mengembalikan
    kelas siswa dari database (dipanggil dari app.py, pola sama dengan
    set_quiz_context_provider di gemini_routes.py). Tanpa ini, kelas
    diambil dari session["user"] (key "kelas") kalau ada; kalau tidak ada,
    dicatat sebagai "Tidak tercatat"."""
    global _kelas_provider
    _kelas_provider = fn


def _cari_kelas(username, user_sesi):
    try:
        for kunci in ("kelas", "nama_kelas", "class"):
            nilai = (user_sesi or {}).get(kunci)
            if isinstance(nilai, str) and nilai.strip():
                return nilai.strip()[:40]
        if _kelas_provider is None or not username:
            return None
        sekarang = time.time()
        with _cache_kelas_lock:
            ada = _cache_kelas.get(username)
            if ada and sekarang - ada[0] < TTL_CACHE_KELAS_DETIK:
                return ada[1]
        nilai = _kelas_provider(username)
        nilai = nilai.strip()[:40] if isinstance(nilai, str) and nilai.strip() else None
        with _cache_kelas_lock:
            _cache_kelas[username] = (sekarang, nilai)
        return nilai
    except Exception:
        return None


def mulai_konteks(endpoint, ada_foto=False, panjang_pesan=0):
    """Dipanggil route chat SEKALI per permintaan (setelah lolos quota).
    Mengembalikan dict konteks (atau None kalau gagal) dan sekaligus
    memasangnya di thread-local."""
    try:
        user = session.get("user") if (session is not None and has_request_context()) else None
        user = user if isinstance(user, dict) else {}
        username = str(user.get("username") or "unknown")[:60]
        role = user.get("role")
        konteks = {
            "rid": uuid.uuid4().hex[:12],
            "username": username,
            "kelas": _cari_kelas(username, user),
            "role": role if isinstance(role, str) else None,
            "endpoint": endpoint,
            "foto": bool(ada_foto),
            "panjang_pesan": int(panjang_pesan or 0),
            "mulai": time.monotonic(),
            "dibuat": time.time(),
            "chat_tercatat": False,
        }
        _lokal.konteks = konteks
        return konteks
    except Exception:
        return None


def pasang_konteks(konteks):
    """Pasang ulang konteks di thread-local (dipakai generator SSE)."""
    try:
        _lokal.konteks = konteks
    except Exception:
        pass


def bersihkan_konteks():
    try:
        _lokal.konteks = None
    except Exception:
        pass


def ambil_konteks():
    try:
        k = getattr(_lokal, "konteks", None)
        if k and time.time() - k.get("dibuat", 0) <= KONTEKS_KEDALUWARSA_DETIK:
            return k
    except Exception:
        pass
    return None


def bungkus_konteks(fn):
    """Bungkus fungsi yang akan dijalankan di THREAD BARU supaya konteks
    permintaan saat ini ikut terbawa (thread baru tidak mewarisi
    thread-local)."""
    konteks = ambil_konteks()

    def _jalankan(*args, **kwargs):
        pasang_konteks(konteks)
        try:
            return fn(*args, **kwargs)
        finally:
            bersihkan_konteks()

    return _jalankan


# ----------------------------------------------------
# USAGE METADATA -> field token (HANYA yang benar-benar dilaporkan API)
# ----------------------------------------------------
def _int_valid(v):
    return v if (isinstance(v, int) and not isinstance(v, bool) and v >= 0) else None


def _token_dari_usage(usage):
    hasil = {}
    if not isinstance(usage, dict):
        return hasil
    peta = (
        ("token_prompt", "promptTokenCount"),
        ("token_output", "candidatesTokenCount"),
        ("token_total", "totalTokenCount"),
        ("token_thoughts", "thoughtsTokenCount"),
        ("token_cached", "cachedContentTokenCount"),
        ("token_tooluse", "toolUsePromptTokenCount"),
    )
    for nama, kunci in peta:
        nilai = _int_valid(usage.get(kunci))
        if nilai is not None:
            hasil[nama] = nilai
    return hasil


def _konteks_dasar(konteks):
    k = konteks or {}
    return {
        "rid": k.get("rid"),
        "username": k.get("username") or "sistem",
        "kelas": k.get("kelas"),
        "endpoint": k.get("endpoint"),
    }


# ----------------------------------------------------
# API PENCATATAN (dipakai gemini_routes.py & service Gemini/embedding)
# ----------------------------------------------------
def catat_chat(sumber, status="ok", cache_eligible=False, jenis_error=None, konteks=None, alasan_cache=None):
    """Satu record per permintaan chat. sumber: exact | semantic | image |
    gemini. Cache hit = token_gemini 0 (tidak ada panggilan generateContent).
    Dijaga flag chat_tercatat supaya tidak pernah tercatat dua kali."""
    try:
        k = konteks or ambil_konteks()
        if not k or k.get("chat_tercatat"):
            return False
        k["chat_tercatat"] = True
        rec = {"v": 1, "jenis": "chat"}
        rec.update(_konteks_dasar(k))
        rec.update({
            "sumber": sumber,
            "status": status,
            "cache_eligible": bool(cache_eligible),
            "foto": bool(k.get("foto")),
            "panjang_pesan": k.get("panjang_pesan", 0),
            "latensi_ms": int((time.monotonic() - k.get("mulai", time.monotonic())) * 1000),
        })
        if k.get("role"):
            rec["role"] = k["role"]
        if sumber in SUMBER_CACHE:
            rec["token_gemini"] = 0
        if jenis_error:
            rec["jenis_error"] = str(jenis_error)[:60]
        # Kode alasan kenapa request ini sampai ke Gemini (bukan cache): hanya kode, bukan isi chat.
        if alasan_cache and sumber not in SUMBER_CACHE:
            rec["alasan_cache"] = str(alasan_cache)[:40]
        return _tulis(rec)
    except Exception:
        return False


def catat_generate(info, konteks=None):
    """Satu record per panggilan generateContent/streamGenerateContent
    (info dari gemini_service.py: model, stream, status, jenis_error,
    http_status, percobaan, latensi_ms, usage)."""
    try:
        k = konteks or ambil_konteks()
        rec = {"v": 1, "jenis": "generate_content"}
        rec.update(_konteks_dasar(k))
        rec.update({
            "model": info.get("model"),
            "stream": bool(info.get("stream")),
            "status": info.get("status") or "error",
            "foto": bool((k or {}).get("foto")),
            "latensi_ms": info.get("latensi_ms"),
        })
        if info.get("http_status"):
            rec["http_status"] = info["http_status"]
        if info.get("percobaan"):
            rec["percobaan"] = info["percobaan"]
        if rec["status"] != "ok" and info.get("jenis_error"):
            rec["jenis_error"] = str(info["jenis_error"])[:60]
        token = _token_dari_usage(info.get("usage"))
        if token:
            rec["usage_ada"] = True
            rec.update(token)
        return _tulis(rec)
    except Exception:
        return False


def buat_pelapor_generate(konteks=None):
    """Bikin callback on_usage(info) untuk tanya_gemini()/tanya_gemini_stream()
    yang terikat ke konteks permintaan ini (aman dipanggil dari generator
    SSE yang jalan setelah route return)."""
    k = konteks or ambil_konteks()

    def _pelapor(info):
        catat_generate(info, konteks=k)

    return _pelapor


def catat_embedding(info, konteks=None):
    """Satu record per panggilan embedContent (dari semantic_cache_service).
    Token hanya dicatat kalau API melaporkan usageMetadata."""
    try:
        k = konteks or ambil_konteks()
        rec = {"v": 1, "jenis": "embedding"}
        rec.update(_konteks_dasar(k))
        rec.update({
            "model": info.get("model"),
            "tujuan": info.get("tujuan") or "lainnya",
            "status": info.get("status") or "error",
            "latensi_ms": info.get("latensi_ms"),
        })
        if info.get("http_status"):
            rec["http_status"] = info["http_status"]
        if rec["status"] != "ok" and info.get("jenis_error"):
            rec["jenis_error"] = str(info["jenis_error"])[:60]
        token = _token_dari_usage(info.get("usage"))
        if token:
            rec["usage_ada"] = True
            rec.update(token)
        return _tulis(rec)
    except Exception:
        return False


# ----------------------------------------------------
# HARGA (dari .env, tidak ada angka bawaan)
# ----------------------------------------------------
def _env_float_opsional(nama):
    mentah = (os.environ.get(nama) or "").strip()
    if not mentah:
        return None
    try:
        nilai = float(mentah)
        return nilai if nilai >= 0 else None
    except ValueError:
        return None


def _muat_harga():
    per_model = {}
    mentah = (os.environ.get("AI_HARGA_MODEL_JSON") or "").strip()
    if mentah:
        try:
            data = json.loads(mentah)
            if isinstance(data, dict):
                for nama, h in data.items():
                    if isinstance(h, dict):
                        per_model[str(nama)] = {
                            "input": h.get("input") if isinstance(h.get("input"), (int, float)) else None,
                            "output": h.get("output") if isinstance(h.get("output"), (int, float)) else None,
                            "cached": h.get("cached") if isinstance(h.get("cached"), (int, float)) else None,
                        }
        except ValueError:
            pass
    return {
        "mata_uang": (os.environ.get("AI_HARGA_MATA_UANG") or "USD").strip() or "USD",
        "input": _env_float_opsional("AI_HARGA_INPUT_PER_JUTA"),
        "output": _env_float_opsional("AI_HARGA_OUTPUT_PER_JUTA"),
        "cached": _env_float_opsional("AI_HARGA_CACHED_PER_JUTA"),
        "embedding": _env_float_opsional("AI_HARGA_EMBEDDING_PER_JUTA"),
        "per_model": per_model,
    }


def _harga_model(harga, model):
    khusus = harga["per_model"].get(model) or {}
    masuk = khusus.get("input") if khusus.get("input") is not None else harga["input"]
    keluar = khusus.get("output") if khusus.get("output") is not None else harga["output"]
    cached = khusus.get("cached") if khusus.get("cached") is not None else harga["cached"]
    return masuk, keluar, cached


def _harga_terkonfigurasi(harga):
    if harga["input"] is not None and harga["output"] is not None:
        return True
    return any(h.get("input") is not None and h.get("output") is not None for h in harga["per_model"].values())


def _hitung_biaya(m, harga):
    """Biaya generateContent dari token yang DILAPORKAN API, per model.
    Kembalikan dict {generate, embedding, total, lengkap} atau None kalau
    harga belum dikonfigurasi."""
    if not _harga_terkonfigurasi(harga):
        return None
    generate = 0.0
    lengkap = True
    for model, mm in (m.get("model") or {}).items():
        masuk, keluar, cached = _harga_model(harga, model)
        if masuk is None or keluar is None:
            lengkap = False  # model ini tidak punya harga -> jangan ditebak
            continue
        cached_tok = min(mm.get("cached", 0), mm.get("in", 0))
        biasa = mm.get("in", 0) - cached_tok
        harga_cached = cached if cached is not None else masuk
        generate += (biasa * masuk + cached_tok * harga_cached + mm.get("out", 0) * keluar) / 1_000_000.0
    embedding = None
    if harga["embedding"] is not None:
        embedding = (m.get("emb_token", 0) * harga["embedding"]) / 1_000_000.0
        if m.get("emb", 0) > m.get("emb_dengan_token", 0):
            lengkap = False  # ada panggilan embedding tanpa laporan token
    total = generate + (embedding or 0.0)
    return {
        "generate": round(generate, 6),
        "embedding": round(embedding, 6) if embedding is not None else None,
        "total": round(total, 6),
        "lengkap": lengkap,
    }


# ----------------------------------------------------
# AGREGASI
# ----------------------------------------------------
_KUNCI_ANGKA = (
    "chat", "hit_exact", "hit_semantic", "hit_image", "chat_gemini", "chat_gagal",
    "chat_eligible", "chat_foto", "lat_hit_sum", "lat_hit_n",
    "gen", "gen_ok", "gen_error", "gen_terputus", "gen_usage", "gen_tanpa_usage",
    "tok_prompt", "tok_output", "tok_thoughts", "tok_cached", "tok_tooluse", "tok_total",
    "lat_gen_sum", "lat_gen_n",
    "emb", "emb_ok", "emb_error", "emb_token", "emb_dengan_token",
)


def _metrik_baru():
    m = {k: 0 for k in _KUNCI_ANGKA}
    m["model"] = {}
    m["emb_tujuan"] = {}
    m["err"] = {}
    m["lewat"] = {}
    return m


def _tambah_dict_angka(dst, src):
    for k, v in src.items():
        if isinstance(v, dict):
            sub = dst.setdefault(k, {})
            _tambah_dict_angka(sub, v)
        else:
            dst[k] = dst.get(k, 0) + v


def _gabung(dst, src):
    for k in _KUNCI_ANGKA:
        dst[k] += src[k]
    _tambah_dict_angka(dst["model"], src["model"])
    _tambah_dict_angka(dst["emb_tujuan"], src["emb_tujuan"])
    _tambah_dict_angka(dst["err"], src["err"])
    _tambah_dict_angka(dst["lewat"], src["lewat"])


def _akumulasi(m, rec):
    jenis = rec.get("jenis")
    if jenis == "chat":
        m["chat"] += 1
        sumber = rec.get("sumber")
        if sumber == "exact":
            m["hit_exact"] += 1
        elif sumber == "semantic":
            m["hit_semantic"] += 1
        elif sumber == "image":
            m["hit_image"] += 1
        else:
            m["chat_gemini"] += 1
        if sumber in SUMBER_CACHE:
            lat = _int_valid(rec.get("latensi_ms"))
            if lat is not None:
                m["lat_hit_sum"] += lat
                m["lat_hit_n"] += 1
        if rec.get("cache_eligible"):
            m["chat_eligible"] += 1
        if rec.get("foto"):
            m["chat_foto"] += 1
        alasan = rec.get("alasan_cache")
        if alasan:
            m["lewat"][alasan] = m["lewat"].get(alasan, 0) + 1
        if rec.get("status") != "ok":
            m["chat_gagal"] += 1
    elif jenis == "generate_content":
        m["gen"] += 1
        status = rec.get("status")
        if status == "ok":
            m["gen_ok"] += 1
            lat = _int_valid(rec.get("latensi_ms"))
            if lat is not None:
                m["lat_gen_sum"] += lat
                m["lat_gen_n"] += 1
        elif status == "terputus":
            m["gen_terputus"] += 1
        else:
            m["gen_error"] += 1
        if status != "ok":
            kunci_err = rec.get("jenis_error") or "tidak_diketahui"
            m["err"][kunci_err] = m["err"].get(kunci_err, 0) + 1
        if rec.get("usage_ada"):
            m["gen_usage"] += 1
            prompt = rec.get("token_prompt", 0) or 0
            tooluse = rec.get("token_tooluse", 0) or 0
            keluar = (rec.get("token_output", 0) or 0) + (rec.get("token_thoughts", 0) or 0)
            cached = rec.get("token_cached", 0) or 0
            m["tok_prompt"] += prompt
            m["tok_output"] += rec.get("token_output", 0) or 0
            m["tok_thoughts"] += rec.get("token_thoughts", 0) or 0
            m["tok_cached"] += cached
            m["tok_tooluse"] += tooluse
            m["tok_total"] += rec.get("token_total", 0) or 0
            nama_model = rec.get("model") or "tidak_diketahui"
            mm = m["model"].setdefault(nama_model, {"in": 0, "out": 0, "cached": 0})
            mm["in"] += prompt + tooluse
            mm["out"] += keluar
            mm["cached"] += cached
        elif status == "ok":
            m["gen_tanpa_usage"] += 1
    elif jenis == "embedding":
        m["emb"] += 1
        tujuan = rec.get("tujuan") or "lainnya"
        m["emb_tujuan"][tujuan] = m["emb_tujuan"].get(tujuan, 0) + 1
        if rec.get("status") == "ok":
            m["emb_ok"] += 1
        else:
            m["emb_error"] += 1
        if rec.get("usage_ada"):
            tok = rec.get("token_total")
            if tok is None:
                tok = rec.get("token_prompt")
            if tok is not None:
                m["emb_token"] += tok
                m["emb_dengan_token"] += 1


class _AggHari:
    """Agregat satu file harian. Dibaca INKREMENTAL (hanya byte baru sejak
    pembacaan terakhir) karena file bersifat append-only."""

    def __init__(self):
        self.offset = 0
        self.total = _metrik_baru()
        self.jam = {}    # jam(0-23) -> metrik
        self.user = {}   # username -> {"kelas": str|None, "m": metrik, "terakhir": ts}

    def tambah(self, rec):
        ts = rec.get("ts")
        if not isinstance(ts, (int, float)):
            return
        jam = time.localtime(ts).tm_hour
        username = rec.get("username") or "sistem"
        _akumulasi(self.total, rec)
        _akumulasi(self.jam.setdefault(jam, _metrik_baru()), rec)
        u = self.user.setdefault(username, {"kelas": None, "m": _metrik_baru(), "terakhir": 0})
        if rec.get("kelas"):
            u["kelas"] = rec["kelas"]
        if ts > u["terakhir"]:
            u["terakhir"] = ts
        _akumulasi(u["m"], rec)


_cache_hari = {}
_agg_lock = threading.Lock()


def _daftar_hari():
    try:
        nama = os.listdir(DATA_DIR)
    except OSError:
        return []
    hasil = []
    for n in nama:
        cocok = _POLA_NAMA_FILE.match(n)
        if cocok:
            hasil.append(cocok.group(1))
    hasil.sort()
    return hasil


def _muat_hari(tanggal):
    """Ambil agregat satu hari (membaca hanya bagian file yang baru)."""
    path = _path_hari(tanggal)
    try:
        ukuran = os.path.getsize(path)
    except OSError:
        return None
    agg = _cache_hari.get(tanggal)
    if agg is None or ukuran < agg.offset:  # file baru / terpotong -> baca ulang
        agg = _AggHari()
        _cache_hari[tanggal] = agg
    if ukuran > agg.offset:
        with open(path, "rb") as f:
            f.seek(agg.offset)
            data = f.read(ukuran - agg.offset)
        akhir = data.rfind(b"\n")
        if akhir != -1:  # baris terakhir yang belum lengkap ditunda ke pembacaan berikutnya
            for baris in data[: akhir + 1].split(b"\n"):
                if not baris.strip():
                    continue
                try:
                    rec = json.loads(baris)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    agg.tambah(rec)
            agg.offset += akhir + 1
    return agg


def _agg_satu_jam(tanggal, jam):
    """Untuk skala 'jam': baca file hari itu, ambil hanya record pada jam
    tsb, sekaligus bangun deret per menit."""
    path = _path_hari(tanggal)
    total = _metrik_baru()
    menit = {}
    user = {}
    try:
        with open(path, "rb") as f:
            for baris in f:
                if not baris.strip():
                    continue
                try:
                    rec = json.loads(baris)
                except ValueError:
                    continue
                ts = rec.get("ts") if isinstance(rec, dict) else None
                if not isinstance(ts, (int, float)):
                    continue
                lt = time.localtime(ts)
                if lt.tm_hour != jam:
                    continue
                _akumulasi(total, rec)
                _akumulasi(menit.setdefault(lt.tm_min, _metrik_baru()), rec)
                username = rec.get("username") or "sistem"
                u = user.setdefault(username, {"kelas": None, "m": _metrik_baru(), "terakhir": 0})
                if rec.get("kelas"):
                    u["kelas"] = rec["kelas"]
                if ts > u["terakhir"]:
                    u["terakhir"] = ts
                _akumulasi(u["m"], rec)
    except OSError:
        pass
    return total, menit, user


def versi_data(skala="global", bulan=None, tanggal=None, jam=None):
    """Sidik jari MURAH (hanya os.stat, tanpa membaca isi file) dari data yang
    dipakai sebuah tampilan. Dipakai untuk realtime hemat: client kirim versi
    terakhir yang ia pegang; kalau sama dengan versi sekarang, route cukup
    membalas {"berubah": false} tanpa memanggil ringkas(). Mengembalikan None
    kalau gagal (client akan menganggap 'berubah' dan minta data penuh)."""
    try:
        hari_ini = time.strftime("%Y-%m-%d")
        bulan = bulan or hari_ini[:7]
        tanggal = tanggal or hari_ini
        if skala == "global":
            target = _daftar_hari()
        elif skala == "bulan":
            target = [t for t in _daftar_hari() if t.startswith(bulan)]
        else:
            target = [tanggal]
        bagian = [str(skala), str(bulan), str(tanggal)]
        if skala == "jam":
            bagian.append(str(jam if jam not in (None, "") else time.localtime().tm_hour))
        for t in target:
            try:
                st = os.stat(_path_hari(t))
                bagian.append(f"{t}:{st.st_size}:{st.st_mtime_ns}")
            except OSError:
                pass
        return hashlib.md5("|".join(bagian).encode("utf-8")).hexdigest()[:16]
    except Exception:
        return None


def _hit_total(m):
    return m["hit_exact"] + m["hit_semantic"] + m["hit_image"]


def _persen(a, b):
    return round(a * 100.0 / b, 1) if b else None


def _baris_ringkas(m, harga):
    biaya = _hitung_biaya(m, harga)
    return {
        "chat": m["chat"],
        "cache_hit": _hit_total(m),
        "gemini_call": m["gen"],
        "embedding_call": m["emb"],
        "token_total": m["tok_total"],
        "token_prompt": m["tok_prompt"],
        "token_output": m["tok_output"] + m["tok_thoughts"],
        "biaya": biaya["total"] if biaya else None,
    }


def _ringkasan_lengkap(m, harga, jumlah_user):
    hit = _hit_total(m)
    biaya = _hitung_biaya(m, harga)
    return {
        "chat_total": m["chat"],
        "user_unik": jumlah_user,
        "chat_dengan_foto": m["chat_foto"],
        "chat_gagal": m["chat_gagal"],
        "cache": {
            "hit_total": hit,
            "exact": m["hit_exact"],
            "semantic": m["hit_semantic"],
            "image": m["hit_image"],
            "lewat_gemini": m["chat_gemini"],
            "layak_cache": m["chat_eligible"],
            "hit_rate_persen": _persen(hit, m["chat"]),
            "hit_rate_layak_persen": _persen(hit, m["chat_eligible"]),
            "rata_latensi_hit_ms": round(m["lat_hit_sum"] / m["lat_hit_n"]) if m["lat_hit_n"] else None,
            "token_gemini_saat_hit": 0,
            "alasan_lewat": dict(sorted(m["lewat"].items(), key=lambda kv: -kv[1])),
        },
        "generate_content": {
            "total": m["gen"],
            "ok": m["gen_ok"],
            "gagal": m["gen_error"],
            "terputus": m["gen_terputus"],
            "dengan_usage": m["gen_usage"],
            "ok_tanpa_usage": m["gen_tanpa_usage"],
            "rata_latensi_ms": round(m["lat_gen_sum"] / m["lat_gen_n"]) if m["lat_gen_n"] else None,
            "jenis_error": dict(sorted(m["err"].items(), key=lambda kv: -kv[1])),
        },
        "token": {
            "prompt": m["tok_prompt"],
            "output": m["tok_output"],
            "thoughts": m["tok_thoughts"],
            "cached": m["tok_cached"],
            "tool_use": m["tok_tooluse"],
            "total": m["tok_total"],
            "dari_panggilan": m["gen_usage"],
        },
        "embedding": {
            "total": m["emb"],
            "ok": m["emb_ok"],
            "gagal": m["emb_error"],
            "token": m["emb_token"],
            "panggilan_dengan_token": m["emb_dengan_token"],
            "per_tujuan": dict(sorted(m["emb_tujuan"].items(), key=lambda kv: -kv[1])),
        },
        "biaya": biaya,
    }


def _nama_bulan_id(ym):
    nama = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
            "Agustus", "September", "Oktober", "November", "Desember"]
    try:
        return f"{nama[int(ym[5:7]) - 1]} {ym[:4]}"
    except Exception:
        return ym


def ringkas(skala="global", bulan=None, tanggal=None, jam=None, top=50):
    """Bangun seluruh data halaman Pemantauan API. Melempar ValueError kalau
    parameter tidak valid (route mengubahnya jadi HTTP 400)."""
    if skala not in ("global", "bulan", "hari", "jam"):
        raise ValueError("skala harus global, bulan, hari, atau jam.")
    sekarang = time.localtime()
    hari_ini = time.strftime("%Y-%m-%d", sekarang)
    if bulan is not None and not _POLA_BULAN.match(bulan):
        raise ValueError("format bulan harus YYYY-MM.")
    if tanggal is not None and not _POLA_TANGGAL.match(tanggal):
        raise ValueError("format tanggal harus YYYY-MM-DD.")
    bulan = bulan or hari_ini[:7]
    tanggal = tanggal or hari_ini
    if skala == "jam":
        try:
            jam = int(jam) if jam is not None and str(jam) != "" else sekarang.tm_hour
        except (TypeError, ValueError):
            raise ValueError("jam harus angka 0-23.")
        if not 0 <= jam <= 23:
            raise ValueError("jam harus angka 0-23.")
    try:
        top = max(1, min(int(top), 500))
    except (TypeError, ValueError):
        top = 50

    # Versi dihitung SEBELUM membaca data: kalau ada log masuk saat agregasi,
    # poll berikutnya melihat versi berbeda dan mengambil data lagi (aman).
    versi = versi_data(skala, bulan, tanggal, jam)

    harga = _muat_harga()
    total = _metrik_baru()
    users = {}        # username -> {"kelas","m","terakhir"}
    dist_jam = {}     # jam-dalam-hari -> metrik (distribusi jam sibuk)
    deret = []        # [(kunci, label, metrik)]

    with _agg_lock:
        hari_ada = _daftar_hari()

        def _ambil(tgl):
            return _muat_hari(tgl) if tgl in hari_ada else None

        def _serap_hari(agg):
            _gabung(total, agg.total)
            for h, mh in agg.jam.items():
                _gabung(dist_jam.setdefault(h, _metrik_baru()), mh)
            for uname, u in agg.user.items():
                tujuan = users.setdefault(uname, {"kelas": None, "m": _metrik_baru(), "terakhir": 0})
                if u["kelas"]:
                    tujuan["kelas"] = u["kelas"]
                tujuan["terakhir"] = max(tujuan["terakhir"], u["terakhir"])
                _gabung(tujuan["m"], u["m"])

        if skala == "global":
            periode = "Semua waktu"
            per_bulan = {}
            for tgl in hari_ada:
                agg = _ambil(tgl)
                if agg is None:
                    continue
                _serap_hari(agg)
                _gabung(per_bulan.setdefault(tgl[:7], _metrik_baru()), agg.total)
            deret = [(ym, _nama_bulan_id(ym), per_bulan[ym]) for ym in sorted(per_bulan)]
        elif skala == "bulan":
            periode = _nama_bulan_id(bulan)
            tahun, bln = int(bulan[:4]), int(bulan[5:7])
            if not 1 <= bln <= 12:
                raise ValueError("bulan tidak valid.")
            jumlah_hari = calendar.monthrange(tahun, bln)[1]
            for d in range(1, jumlah_hari + 1):
                tgl = f"{bulan}-{d:02d}"
                agg = _ambil(tgl)
                if agg is not None:
                    _serap_hari(agg)
                    deret.append((tgl, str(d), agg.total))
                else:
                    deret.append((tgl, str(d), _metrik_baru()))
        elif skala == "hari":
            periode = tanggal
            agg = _ambil(tanggal)
            if agg is not None:
                _serap_hari(agg)
            for h in range(24):
                deret.append((f"{h:02d}", f"{h:02d}", (agg.jam.get(h) if agg else None) or _metrik_baru()))
        else:  # jam
            periode = f"{tanggal} pukul {jam:02d}:00-{jam:02d}:59"
            if tanggal in hari_ada:
                tot, menit, usr = _agg_satu_jam(tanggal, jam)
                _gabung(total, tot)
                dist_jam[jam] = tot
                users = usr
                for mnt in range(60):
                    deret.append((f"{mnt:02d}", f"{jam:02d}:{mnt:02d}", menit.get(mnt) or _metrik_baru()))
            else:
                for mnt in range(60):
                    deret.append((f"{mnt:02d}", f"{jam:02d}:{mnt:02d}", _metrik_baru()))

        tersedia_bulan = sorted({t[:7] for t in hari_ada})
        tersedia_tanggal = hari_ada[-120:]

    # ----- susun keluaran -----
    seri = []
    puncak_seri = None
    for kunci, label, m in deret:
        baris = _baris_ringkas(m, harga)
        baris["kunci"] = kunci
        baris["label"] = label
        seri.append(baris)
        if baris["chat"] > 0 and (puncak_seri is None or baris["chat"] > puncak_seri["chat"]):
            puncak_seri = {"kunci": kunci, "label": label, "chat": baris["chat"]}

    per_jam = []
    puncak_jam = None
    for h in range(24):
        m = dist_jam.get(h) or _metrik_baru()
        baris = _baris_ringkas(m, harga)
        baris["jam"] = h
        baris["label"] = f"{h:02d}:00"
        per_jam.append(baris)
        if baris["chat"] > 0 and (puncak_jam is None or baris["chat"] > puncak_jam["chat"]):
            puncak_jam = {"jam": h, "label": f"{h:02d}:00-{h:02d}:59", "chat": baris["chat"]}

    daftar_user = []
    for uname, u in users.items():
        b = _baris_ringkas(u["m"], harga)
        b.update({
            "username": uname,
            "kelas": u["kelas"] or KELAS_TIDAK_ADA,
            "gagal": u["m"]["chat_gagal"],
            "terakhir": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(u["terakhir"])) if u["terakhir"] else None,
        })
        daftar_user.append(b)
    daftar_user.sort(key=lambda x: (-x["chat"], -x["token_total"], x["username"]))

    per_kelas = {}
    for uname, u in users.items():
        nama_kelas = u["kelas"] or KELAS_TIDAK_ADA
        entri = per_kelas.setdefault(nama_kelas, {"m": _metrik_baru(), "user": 0})
        _gabung(entri["m"], u["m"])
        entri["user"] += 1
    daftar_kelas = []
    for nama_kelas, e in per_kelas.items():
        b = _baris_ringkas(e["m"], harga)
        b.update({"kelas": nama_kelas, "user": e["user"]})
        daftar_kelas.append(b)
    daftar_kelas.sort(key=lambda x: (-x["chat"], x["kelas"]))

    return {
        "skala": skala,
        "versi": versi,
        "periode": {"label": periode, "bulan": bulan, "tanggal": tanggal, "jam": jam},
        "diperbarui": time.strftime("%Y-%m-%d %H:%M:%S", sekarang),
        "zona_waktu": time.strftime("%z", sekarang),
        "harga": {
            "dikonfigurasi": _harga_terkonfigurasi(harga),
            "mata_uang": harga["mata_uang"],
            "catatan": (
                "Biaya dihitung dari token usageMetadata x harga di .env (AI_HARGA_*)."
                if _harga_terkonfigurasi(harga)
                else "Harga belum dikonfigurasi. Isi AI_HARGA_INPUT_PER_JUTA dan AI_HARGA_OUTPUT_PER_JUTA di .env untuk menampilkan biaya."
            ),
        },
        "ringkasan": _ringkasan_lengkap(total, harga, len(users)),
        "seri": seri,
        "puncak_seri": puncak_seri,
        "per_jam": per_jam,
        "puncak_jam": puncak_jam,
        "user": daftar_user[:top],
        "user_total": len(daftar_user),
        "kelas": daftar_kelas,
        "tersedia": {"bulan": tersedia_bulan, "tanggal": tersedia_tanggal},
    }
