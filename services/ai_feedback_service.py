# ----------------------------------------------------
# AI_FEEDBACK_SERVICE.PY
# ----------------------------------------------------
# Penilaian siswa terhadap balasan AI Support (jempol atas/bawah + alasan),
# disimpan di SQLite terpisah: data/ai_feedback.db (dibuat otomatis).
#
# Prinsip:
# - TIDAK menyentuh logic AI, cache, atau logging token. Modul ini hanya
#   menyimpan & merangkum penilaian.
# - Isi chat TIDAK disimpan di sini. Yang disimpan: id percakapan/pesan,
#   nilai, alasan (pilihan baku), intent, dan apakah balasan dari cache.
# - Ringkasan admin TIDAK memuat username/nama siswa (anonim, agregat saja).
# - Semua fungsi jalur chat (catat_meta) aman: tidak pernah melempar.
import os
import sqlite3
import threading
import time

DB_PATH = os.environ.get("AI_FEEDBACK_DB") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "ai_feedback.db",
)

ALASAN_VALID = {
    "tidak_nyambung": "Tidak nyambung",
    "terlalu_panjang": "Terlalu panjang",
    "terlalu_umum": "Saran terlalu umum",
    "salah": "Jawabannya salah",
}
BATAS_PER_MENIT = 30          # penilaian per user per 60 detik (anti spam)
WIB = 7 * 3600                # tanggal harian dihitung dalam WIB

_lock = threading.Lock()
_siap = False
_hits = {}                    # username -> [timestamp]


def _koneksi():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _pastikan_skema():
    global _siap
    if _siap:
        return
    with _lock:
        if _siap:
            return
        c = _koneksi()
        try:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS balasan_meta (
                    percakapan_id TEXT NOT NULL,
                    pesan_id INTEGER NOT NULL,
                    intent TEXT,
                    dari_cache INTEGER NOT NULL DEFAULT 0,
                    waktu REAL NOT NULL,
                    PRIMARY KEY (percakapan_id, pesan_id)
                );
                CREATE INDEX IF NOT EXISTS idx_meta_waktu ON balasan_meta (waktu);
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    percakapan_id TEXT NOT NULL,
                    pesan_id INTEGER NOT NULL,
                    nilai INTEGER NOT NULL,          -- 1 = membantu, -1 = kurang membantu
                    alasan TEXT,
                    intent TEXT,
                    dari_cache INTEGER NOT NULL DEFAULT 0,
                    waktu REAL NOT NULL,
                    UNIQUE (username, percakapan_id, pesan_id)
                );
                CREATE INDEX IF NOT EXISTS idx_feedback_waktu ON feedback (waktu);
                """
            )
            c.commit()
            _siap = True
        finally:
            c.close()


def catat_meta(percakapan_id, pesan_id, intent, dari_cache=False):
    """Catat 1 balasan AI (untuk penyebut 'berapa balasan yang dinilai' dan
    pengelompokan per intent). Tidak pernah melempar."""
    try:
        if not percakapan_id or not isinstance(pesan_id, int):
            return
        _pastikan_skema()
        with _lock:
            c = _koneksi()
            try:
                c.execute(
                    "INSERT OR IGNORE INTO balasan_meta "
                    "(percakapan_id, pesan_id, intent, dari_cache, waktu) VALUES (?,?,?,?,?)",
                    (percakapan_id, pesan_id, (str(intent)[:40] if intent else None),
                     1 if dari_cache else 0, time.time()),
                )
                c.commit()
            finally:
                c.close()
    except Exception:
        pass


def _terlalu_sering(username):
    sekarang = time.time()
    with _lock:
        daftar = [t for t in _hits.get(username, []) if sekarang - t < 60]
        if len(daftar) >= BATAS_PER_MENIT:
            _hits[username] = daftar
            return True
        daftar.append(sekarang)
        _hits[username] = daftar
        if len(_hits) > 2000:
            for k in list(_hits)[:500]:
                _hits.pop(k, None)
    return False


def simpan(username, percakapan_id, pesan_id, nilai, alasan=None):
    """Simpan/ubah penilaian (1 user + 1 balasan = 1 penilaian; menilai lagi
    = mengubah). Kepemilikan pesan HARUS sudah dicek pemanggil.
    Return: 'ok' | 'terlalu_sering' | 'tidak_valid' | 'gagal'."""
    if nilai not in (1, -1) or isinstance(nilai, bool):
        return "tidak_valid"
    if not username or not percakapan_id or not isinstance(pesan_id, int):
        return "tidak_valid"
    alasan = alasan if (nilai == -1 and alasan in ALASAN_VALID) else None
    if _terlalu_sering(username):
        return "terlalu_sering"
    try:
        _pastikan_skema()
        with _lock:
            c = _koneksi()
            try:
                m = c.execute(
                    "SELECT intent, dari_cache FROM balasan_meta WHERE percakapan_id = ? AND pesan_id = ?",
                    (percakapan_id, pesan_id),
                ).fetchone()
                intent = m["intent"] if m else None
                dari_cache = m["dari_cache"] if m else 0
                c.execute(
                    "INSERT INTO feedback (username, percakapan_id, pesan_id, nilai, alasan, intent, dari_cache, waktu) "
                    "VALUES (?,?,?,?,?,?,?,?) "
                    "ON CONFLICT (username, percakapan_id, pesan_id) DO UPDATE SET "
                    "nilai = excluded.nilai, alasan = excluded.alasan, waktu = excluded.waktu",
                    (username, percakapan_id, pesan_id, nilai, alasan, intent, dari_cache, time.time()),
                )
                c.commit()
            finally:
                c.close()
        return "ok"
    except Exception:
        return "gagal"


def _persen(a, b):
    return round(100.0 * a / b, 1) if b else None


def ringkas(hari=30):
    """Ringkasan agregat untuk admin (tanpa username, tanpa isi chat)."""
    hari = max(1, min(int(hari), 365))
    batas = time.time() - hari * 86400
    _pastikan_skema()
    c = _koneksi()
    try:
        fb = c.execute(
            "SELECT nilai, alasan, intent, dari_cache, waktu FROM feedback WHERE waktu >= ?", (batas,)
        ).fetchall()
        meta = c.execute(
            "SELECT intent, dari_cache, waktu FROM balasan_meta WHERE waktu >= ?", (batas,)
        ).fetchall()
    finally:
        c.close()

    suka = sum(1 for r in fb if r["nilai"] == 1)
    tidak = len(fb) - suka
    alasan = {k: 0 for k in ALASAN_VALID}
    alasan_kosong = 0
    for r in fb:
        if r["nilai"] == -1:
            if r["alasan"] in alasan:
                alasan[r["alasan"]] += 1
            else:
                alasan_kosong += 1

    def tanggal(ts):
        return time.strftime("%Y-%m-%d", time.gmtime(ts + WIB))

    harian = {}
    for r in meta:
        d = harian.setdefault(tanggal(r["waktu"]), {"balasan": 0, "suka": 0, "tidak_suka": 0})
        d["balasan"] += 1
    for r in fb:
        d = harian.setdefault(tanggal(r["waktu"]), {"balasan": 0, "suka": 0, "tidak_suka": 0})
        d["suka" if r["nilai"] == 1 else "tidak_suka"] += 1

    per_intent = {}
    for r in meta:
        k = r["intent"] or "TIDAK_DIKETAHUI"
        per_intent.setdefault(k, {"balasan": 0, "suka": 0, "tidak_suka": 0})["balasan"] += 1
    for r in fb:
        k = r["intent"] or "TIDAK_DIKETAHUI"
        per_intent.setdefault(k, {"balasan": 0, "suka": 0, "tidak_suka": 0})[
            "suka" if r["nilai"] == 1 else "tidak_suka"] += 1

    per_sumber = {"cache": {"suka": 0, "tidak_suka": 0}, "gemini": {"suka": 0, "tidak_suka": 0}}
    for r in fb:
        per_sumber["cache" if r["dari_cache"] else "gemini"]["suka" if r["nilai"] == 1 else "tidak_suka"] += 1

    def bentuk(d):
        n = d["suka"] + d["tidak_suka"]
        return dict(d, dinilai=n, persen_suka=_persen(d["suka"], n))

    return {
        "periode_hari": hari,
        "total_balasan": len(meta),
        "total_dinilai": len(fb),
        "suka": suka,
        "tidak_suka": tidak,
        "persen_suka": _persen(suka, len(fb)),
        "tingkat_dinilai": _persen(len(fb), len(meta)),
        "alasan_tidak_suka": dict(alasan, tanpa_alasan=alasan_kosong),
        "label_alasan": dict(ALASAN_VALID),
        "per_intent": sorted(
            ({"intent": k, **bentuk(v)} for k, v in per_intent.items()),
            key=lambda x: x["balasan"], reverse=True),
        "per_sumber": {k: bentuk(v) for k, v in per_sumber.items()},
        "harian": [{"tanggal": k, **bentuk(v)} for k, v in sorted(harian.items())],
    }
