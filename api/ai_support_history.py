# ----------------------------------------------------
# AI_SUPPORT_HISTORY.PY
# ----------------------------------------------------
# Riwayat percakapan AI Support siswa (multi-sesi, seperti ChatGPT).
# Disimpan PERMANEN di SQLite: data/ai_support_history.db (dibuat otomatis).
#
# Prinsip:
# - Semua query WAJIB difilter username -> siswa A tidak bisa baca/hapus
#   percakapan siswa B walau menebak conversation_id.
# - Foto TIDAK disimpan, cuma penanda teks "[user melampirkan foto]".
# - Konteks untuk Gemini diambil dari percakapan yang sedang dibuka
#   (bukan dari memori per-user lagi), jadi "Chat Baru" = konteks kosong.
# - Tidak pernah melempar exception ke pemanggil di jalur chat: kalau
#   DB bermasalah, chat tetap jalan (riwayat saja yang tidak tersimpan).
import os
import sqlite3
import threading
import time
import uuid

DB_PATH = os.environ.get("AI_SUPPORT_HISTORY_DB") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "ai_support_history.db",
)

MAKS_PERCAKAPAN_PER_USER = 50      # lewat ini, percakapan paling lama dibuang
MAKS_PESAN_PER_PERCAKAPAN = 200    # baris (user+AI) per percakapan
KONTEKS_MAKS_BARIS = 4             # sama seperti RIWAYAT_MAKS_BARIS lama (2 pasang)
KONTEKS_MAKS_KARAKTER = 600        # potong tiap baris buat jaga token
JUDUL_MAKS = 60

_lock = threading.Lock()
_siap = False


def _koneksi():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
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
                CREATE TABLE IF NOT EXISTS percakapan (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    judul TEXT NOT NULL DEFAULT 'Chat baru',
                    dibuat REAL NOT NULL,
                    diubah REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_percakapan_user
                    ON percakapan (username, diubah DESC);
                CREATE TABLE IF NOT EXISTS pesan (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    percakapan_id TEXT NOT NULL
                        REFERENCES percakapan(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,            -- 'user' | 'model'
                    teks TEXT NOT NULL,
                    dari_cache INTEGER NOT NULL DEFAULT 0,
                    waktu REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_pesan_percakapan
                    ON pesan (percakapan_id, id);
                """
            )
            c.commit()
            _siap = True
        finally:
            c.close()


def _judul_dari_pesan(teks):
    t = " ".join((teks or "").split())
    if not t:
        return "Chat baru"
    return t if len(t) <= JUDUL_MAKS else t[: JUDUL_MAKS - 1].rstrip() + "…"


def _milik(c, username, cid):
    if not username or not cid or not isinstance(cid, str) or len(cid) > 64:
        return False
    r = c.execute(
        "SELECT 1 FROM percakapan WHERE id = ? AND username = ?", (cid, username)
    ).fetchone()
    return r is not None


# ---------------- dipakai gemini_routes (jalur chat) ----------------

def ambil_konteks(username, cid):
    """List {"role","text"} (maks KONTEKS_MAKS_BARIS terakhir) untuk Gemini.
    [] kalau cid kosong/bukan milik user/DB bermasalah."""
    try:
        _pastikan_skema()
        c = _koneksi()
        try:
            if not _milik(c, username, cid):
                return []
            baris = c.execute(
                "SELECT role, teks FROM pesan WHERE percakapan_id = ? "
                "ORDER BY id DESC LIMIT ?",
                (cid, KONTEKS_MAKS_BARIS),
            ).fetchall()
        finally:
            c.close()
        hasil = [{"role": b["role"], "text": b["teks"][:KONTEKS_MAKS_KARAKTER]} for b in reversed(baris)]
        # Gemini wajib mulai dari giliran user
        while hasil and hasil[0]["role"] != "user":
            hasil.pop(0)
        return hasil
    except Exception:
        return []


def catat_giliran(username, cid, pesan_user, balasan, dari_cache=False, ada_gambar=False):
    """Simpan 1 pasang tanya-jawab. cid kosong/tidak valid -> percakapan
    BARU dibuat. Return conversation_id (atau None kalau gagal)."""
    teks_user = (pesan_user or "").strip()
    if ada_gambar:
        teks_user = (teks_user + " " if teks_user else "") + "[user melampirkan foto]"
    teks_ai = (balasan or "").strip()
    if not username or not teks_user or not teks_ai:
        return cid if isinstance(cid, str) else None
    try:
        _pastikan_skema()
        sekarang = time.time()
        with _lock:
            c = _koneksi()
            try:
                if not _milik(c, username, cid):
                    cid = uuid.uuid4().hex
                    c.execute(
                        "INSERT INTO percakapan (id, username, judul, dibuat, diubah) VALUES (?,?,?,?,?)",
                        (cid, username, _judul_dari_pesan(teks_user), sekarang, sekarang),
                    )
                else:
                    c.execute("UPDATE percakapan SET diubah = ? WHERE id = ?", (sekarang, cid))
                c.execute(
                    "INSERT INTO pesan (percakapan_id, role, teks, dari_cache, waktu) VALUES (?,?,?,?,?)",
                    (cid, "user", teks_user, 0, sekarang),
                )
                c.execute(
                    "INSERT INTO pesan (percakapan_id, role, teks, dari_cache, waktu) VALUES (?,?,?,?,?)",
                    (cid, "model", teks_ai, 1 if dari_cache else 0, sekarang),
                )
                # batasi jumlah pesan di percakapan ini
                c.execute(
                    "DELETE FROM pesan WHERE percakapan_id = ? AND id NOT IN "
                    "(SELECT id FROM pesan WHERE percakapan_id = ? ORDER BY id DESC LIMIT ?)",
                    (cid, cid, MAKS_PESAN_PER_PERCAKAPAN),
                )
                # batasi jumlah percakapan user ini
                c.execute(
                    "DELETE FROM percakapan WHERE username = ? AND id NOT IN "
                    "(SELECT id FROM percakapan WHERE username = ? ORDER BY diubah DESC LIMIT ?)",
                    (username, username, MAKS_PERCAKAPAN_PER_USER),
                )
                c.commit()
            finally:
                c.close()
        return cid
    except Exception:
        return cid if isinstance(cid, str) else None


# ---------------- dipakai ai_support_history_routes (UI riwayat) ----------------

def daftar_percakapan(username, limit=MAKS_PERCAKAPAN_PER_USER):
    _pastikan_skema()
    c = _koneksi()
    try:
        baris = c.execute(
            "SELECT id, judul, dibuat, diubah FROM percakapan "
            "WHERE username = ? ORDER BY diubah DESC LIMIT ?",
            (username, int(limit)),
        ).fetchall()
    finally:
        c.close()
    return [dict(b) for b in baris]


def ambil_pesan(username, cid):
    """None kalau bukan milik user."""
    _pastikan_skema()
    c = _koneksi()
    try:
        if not _milik(c, username, cid):
            return None
        baris = c.execute(
            "SELECT role, teks, dari_cache, waktu FROM pesan WHERE percakapan_id = ? ORDER BY id",
            (cid,),
        ).fetchall()
    finally:
        c.close()
    return [
        {"role": b["role"], "teks": b["teks"], "dari_cache": bool(b["dari_cache"]), "waktu": b["waktu"]}
        for b in baris
    ]


def ganti_judul(username, cid, judul):
    judul = _judul_dari_pesan(judul)
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            if not _milik(c, username, cid):
                return False
            c.execute("UPDATE percakapan SET judul = ? WHERE id = ?", (judul, cid))
            c.commit()
            return True
        finally:
            c.close()


def hapus_percakapan(username, cid):
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            if not _milik(c, username, cid):
                return False
            c.execute("DELETE FROM percakapan WHERE id = ?", (cid,))
            c.commit()
            return True
        finally:
            c.close()


def hapus_semua(username):
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute("DELETE FROM percakapan WHERE username = ?", (username,)).rowcount
            c.commit()
            return n
        finally:
            c.close()
