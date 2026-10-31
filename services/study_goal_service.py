# ----------------------------------------------------
# STUDY_GOAL_SERVICE.PY
# ----------------------------------------------------
# Tujuan belajar + peta langkah untuk Personal Study Coach (Arcana AI).
# TIDAK memanggil Gemini sama sekali (nol token): judul tujuan dan langkah
# dibuat dari template + topik yang sudah dicatat study_coach_service.
# Disimpan PERMANEN di SQLite: data/ai_study_goal.db (dibuat otomatis),
# jadi siswa yang kembali besok masih melihat "kamu di langkah ke-3".
#
# Prinsip:
# - 1 tujuan AKTIF per PERCAKAPAN (conversation_id) per siswa. Chat Baru
#   tidak punya tujuan sampai siswa menanyakan metode/rencana belajar di
#   chat itu; membuka chat lama menampilkan progres terakhir chat itu.
#   Semua query difilter username.
# - Langkah selesai hanya lewat aksi siswa ("Lancar") yang tervalidasi
#   server (urutan langkah harus sama dengan langkah yang sedang aktif).
# - Ringkasan admin tanpa username & tanpa isi chat.
# - Tidak pernah melempar exception ke jalur chat (lihat gemini_routes).
import os
import sqlite3
import threading
import time
import uuid
 
DB_PATH = os.environ.get("AI_STUDY_GOAL_DB") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "ai_study_goal.db",
)
 
MAKS_TUJUAN_PER_USER = 100
TOPIK_MAKS = 40
 
_TEMPLATE = {
    "BELAJAR": (
        ("Pahami konsep inti", "Tanpa dasar ini, soal terasa acak."),
        ("Kerjakan 5 soal latihan", "Latihan menguji ingatan, bukan cuma membaca."),
        ("Perbaiki yang salah", "Kesalahan menunjukkan bagian yang belum paham."),
        ("Uji diri tanpa catatan", "Memastikan kamu benar-benar bisa, bukan sekadar kenal."),
    ),
    "RENCANA": (
        ("Tentukan target belajar", "Target jelas bikin kamu tahu kapan sudah cukup."),
        ("Bagi materi per sesi", "Sesi kecil lebih mudah dijalani tiap hari."),
        ("Jalani sesi pertama", "Memulai adalah bagian tersulit; sesi pertama membuktikan rencananya realistis."),
        ("Evaluasi hasil minggu ini", "Dari sini rencana disesuaikan, bukan dipaksakan."),
    ),
}
 
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
                CREATE TABLE IF NOT EXISTS tujuan (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    conversation_id TEXT,                   -- NULL = data lama; '' = menunggu dilekatkan ke chat
                    judul TEXT NOT NULL,
                    topik TEXT NOT NULL,
                    jenis TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'aktif',   -- aktif | selesai | diganti
                    ditutup INTEGER NOT NULL DEFAULT 0,
                    bintang INTEGER,
                    dibuat REAL NOT NULL,
                    diubah REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_tujuan_user ON tujuan (username, diubah DESC);
                CREATE TABLE IF NOT EXISTS langkah (
                    tujuan_id TEXT NOT NULL REFERENCES tujuan(id) ON DELETE CASCADE,
                    urutan INTEGER NOT NULL,
                    judul TEXT NOT NULL,
                    alasan TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'belum',   -- belum | selesai
                    waktu REAL,
                    PRIMARY KEY (tujuan_id, urutan)
                );
                """
            )
            # Migrasi DB lama (tanpa kolom conversation_id). Baris lama bernilai NULL
            # sehingga tidak cocok ke chat mana pun (tidak tampil, tidak mengganggu).
            kolom = {r[1] for r in c.execute("PRAGMA table_info(tujuan)").fetchall()}
            if "conversation_id" not in kolom:
                c.execute("ALTER TABLE tujuan ADD COLUMN conversation_id TEXT")
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_tujuan_chat ON tujuan (username, conversation_id, status)"
            )
            c.commit()
            _siap = True
        finally:
            c.close()
 
 
def _bersih_topik(topik):
    t = " ".join(str(topik or "").split())
    return t[:TOPIK_MAKS].strip()
 
 
def _muat(c, tid):
    t = c.execute("SELECT * FROM tujuan WHERE id = ?", (tid,)).fetchone()
    if not t:
        return None
    ls = c.execute(
        "SELECT urutan, judul, alasan, status FROM langkah WHERE tujuan_id = ? ORDER BY urutan", (tid,)
    ).fetchall()
    langkah = [dict(urutan=l["urutan"], judul=l["judul"], alasan=l["alasan"], status=l["status"]) for l in ls]
    sekarang = next((i for i, l in enumerate(langkah) if l["status"] != "selesai"), max(len(langkah) - 1, 0))
    return {
        "id": t["id"], "conversation_id": t["conversation_id"], "judul": t["judul"], "topik": t["topik"], "jenis": t["jenis"],
        "status": t["status"], "ditutup": bool(t["ditutup"]), "bintang": t["bintang"],
        "langkah": langkah, "sekarang": sekarang,
        "selesai_jumlah": sum(1 for l in langkah if l["status"] == "selesai"),
    }
 
 
def tujuan_aktif(username, cid):
    """Tujuan aktif di percakapan `cid` milik user (dict) atau None.
    cid kosong (Chat Baru) -> selalu None."""
    if not username or not cid:
        return None
    _pastikan_skema()
    c = _koneksi()
    try:
        r = c.execute(
            "SELECT id FROM tujuan WHERE username = ? AND conversation_id = ? AND status = 'aktif' "
            "ORDER BY diubah DESC LIMIT 1",
            (username, cid),
        ).fetchone()
        return _muat(c, r["id"]) if r else None
    finally:
        c.close()


def untuk_kartu(username, cid):
    """Yang ditampilkan di kartu untuk percakapan `cid`: tujuan aktif chat itu,
    atau tujuan yang sudah tuntas dan belum ditutup/dinilai. None kalau chat
    itu belum punya tujuan (atau cid kosong = Chat Baru) -> frontend sembunyikan kartu."""
    if not username or not cid or not isinstance(cid, str) or len(cid) > 64:
        return None
    _pastikan_skema()
    c = _koneksi()
    try:
        r = c.execute(
            "SELECT id FROM tujuan WHERE username = ? AND conversation_id = ? AND status = 'aktif' "
            "ORDER BY diubah DESC LIMIT 1",
            (username, cid),
        ).fetchone()
        if not r:
            r = c.execute(
                "SELECT id FROM tujuan WHERE username = ? AND conversation_id = ? "
                "AND status = 'selesai' AND ditutup = 0 ORDER BY diubah DESC LIMIT 1",
                (username, cid),
            ).fetchone()
        return _muat(c, r["id"]) if r else None
    finally:
        c.close()


def buat_tujuan(username, topik, jenis="BELAJAR", cid=None):
    """Buat tujuan baru HANYA kalau percakapan `cid` belum punya tujuan aktif.
    cid kosong = Chat Baru yang percakapannya baru dibuat SETELAH balasan:
    tujuan disimpan 'menunggu' (conversation_id = '') dan harus dilekatkan
    lewat lekatkan() begitu conversation_id diketahui.
    Return dict tujuan (yang baru atau yang sudah aktif), None kalau gagal."""
    cid = cid.strip() if isinstance(cid, str) else ""
    if len(cid) > 64:
        return None
    topik = _bersih_topik(topik)
    if not username or not topik:
        return None
    jenis = jenis if jenis in _TEMPLATE else "BELAJAR"
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            if cid:
                ada = c.execute(
                    "SELECT id FROM tujuan WHERE username = ? AND conversation_id = ? AND status = 'aktif' LIMIT 1",
                    (username, cid),
                ).fetchone()
                if ada:
                    return _muat(c, ada["id"])
            else:
                # buang tujuan 'menunggu' yatim (balasan sebelumnya gagal sebelum sempat dilekatkan)
                c.execute("DELETE FROM tujuan WHERE username = ? AND conversation_id = ''", (username,))
            tid = uuid.uuid4().hex
            sekarang = time.time()
            judul = ("Rencana belajar " if jenis == "RENCANA" else "Paham ") + topik
            c.execute(
                "INSERT INTO tujuan (id, username, conversation_id, judul, topik, jenis, status, dibuat, diubah) "
                "VALUES (?,?,?,?,?,?,'aktif',?,?)",
                (tid, username, cid, judul, topik, jenis, sekarang, sekarang),
            )
            for i, (jd, al) in enumerate(_TEMPLATE[jenis], start=1):
                c.execute(
                    "INSERT INTO langkah (tujuan_id, urutan, judul, alasan) VALUES (?,?,?,?)",
                    (tid, i, jd, al),
                )
            c.execute(
                "DELETE FROM tujuan WHERE username = ? AND id NOT IN "
                "(SELECT id FROM tujuan WHERE username = ? ORDER BY diubah DESC LIMIT ?)",
                (username, username, MAKS_TUJUAN_PER_USER),
            )
            c.commit()
            return _muat(c, tid)
        finally:
            c.close()
 
 
def lekatkan(username, tid, cid):
    """Hubungkan tujuan 'menunggu' (dibuat di giliran pertama Chat Baru) ke
    conversation_id yang baru terbentuk. Hanya mengubah tujuan milik user yang
    masih 'menunggu'. Return True kalau berhasil."""
    if not username or not tid or not isinstance(cid, str) or not cid or len(cid) > 64:
        return False
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute(
                "UPDATE tujuan SET conversation_id = ? WHERE id = ? AND username = ? AND conversation_id = ''",
                (cid, tid, username),
            ).rowcount
            c.commit()
            return n > 0
        finally:
            c.close()


def hapus_untuk_percakapan(username, cid):
    """Percakapan dihapus -> tujuan di chat itu ikut dihapus. Return jumlah baris."""
    if not username or not isinstance(cid, str) or not cid:
        return 0
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute(
                "DELETE FROM tujuan WHERE username = ? AND conversation_id = ?", (username, cid)
            ).rowcount
            c.commit()
            return n
        finally:
            c.close()


def hapus_semua_user(username):
    """'Hapus semua riwayat' -> semua tujuan terikat chat milik user ikut dihapus."""
    if not username:
        return 0
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute("DELETE FROM tujuan WHERE username = ?", (username,)).rowcount
            c.commit()
            return n
        finally:
            c.close()


def tandai_lancar(username, tid, urutan):
    """Siswa menyatakan langkah yang SEDANG aktif lancar. `urutan` harus sama
    dengan urutan langkah aktif (cegah klik ganda / tombol basi). Kalau itu
    langkah terakhir, tujuan jadi 'selesai'. Return tujuan terbaru atau None."""
    if isinstance(urutan, bool) or not isinstance(urutan, int):
        return None
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            t = c.execute(
                "SELECT id FROM tujuan WHERE id = ? AND username = ? AND status = 'aktif'", (tid, username)
            ).fetchone()
            if not t:
                return None
            sekarang_langkah = c.execute(
                "SELECT urutan FROM langkah WHERE tujuan_id = ? AND status = 'belum' ORDER BY urutan LIMIT 1",
                (tid,),
            ).fetchone()
            if sekarang_langkah and sekarang_langkah["urutan"] == urutan:
                now = time.time()
                c.execute(
                    "UPDATE langkah SET status = 'selesai', waktu = ? WHERE tujuan_id = ? AND urutan = ?",
                    (now, tid, urutan),
                )
                tersisa = c.execute(
                    "SELECT COUNT(*) AS n FROM langkah WHERE tujuan_id = ? AND status = 'belum'", (tid,)
                ).fetchone()["n"]
                c.execute(
                    "UPDATE tujuan SET diubah = ?, status = ? WHERE id = ?",
                    (now, "selesai" if tersisa == 0 else "aktif", tid),
                )
                c.commit()
            return _muat(c, tid)
        finally:
            c.close()
 
 
def ganti(username, tid):
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute(
                "UPDATE tujuan SET status = 'diganti', ditutup = 1, diubah = ? "
                "WHERE id = ? AND username = ? AND status = 'aktif'",
                (time.time(), tid, username),
            ).rowcount
            c.commit()
            return n > 0
        finally:
            c.close()
 
 
def tutup(username, tid):
    """Sembunyikan kartu 'tuntas' tanpa menilai."""
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute(
                "UPDATE tujuan SET ditutup = 1 WHERE id = ? AND username = ? AND status = 'selesai'",
                (tid, username),
            ).rowcount
            c.commit()
            return n > 0
        finally:
            c.close()
 
 
def beri_bintang(username, tid, bintang):
    if isinstance(bintang, bool) or bintang not in (1, 2, 3, 4, 5):
        return False
    _pastikan_skema()
    with _lock:
        c = _koneksi()
        try:
            n = c.execute(
                "UPDATE tujuan SET bintang = ?, ditutup = 1 WHERE id = ? AND username = ? AND status = 'selesai'",
                (bintang, tid, username),
            ).rowcount
            c.commit()
            return n > 0
        finally:
            c.close()
 
 
def blok_prompt(t):
    """Satu blok DATA kecil (~60 token) untuk system prompt. '' kalau tidak ada."""
    try:
        if not t or t["status"] != "aktif" or not t["langkah"]:
            return ""
        n = t["sekarang"]
        return (
            f"TUJUAN BELAJAR AKTIF (data sistem): {t['judul']}. "
            f"Langkah sekarang {n + 1}/{len(t['langkah'])}: {t['langkah'][n]['judul']}. "
            "Arahkan jawaban ke langkah ini tanpa menambah langkah baru; kalau pertanyaan jelas di luar "
            "tujuan, jawab itu dulu. BATASI jawaban maksimal 5 kalimat atau 4 poin pendek, tanpa judul "
            "dan tanpa pengantar panjang; tawarkan lanjut hanya 1 kalimat. Kalau siswa bingung, pecah "
            "jadi bagian lebih kecil dengan nada tenang. Saran harus spesifik, bisa dikerjakan hari ini, "
            "dan punya hasil jelas."
        )
    except Exception:
        return ""
 
 
def ringkas(hari=30):
    """Agregat untuk admin: tujuan dibuat/tuntas/diganti/aktif + rata-rata bintang."""
    hari = max(1, min(int(hari), 365))
    batas = time.time() - hari * 86400
    _pastikan_skema()
    c = _koneksi()
    try:
        baris = c.execute(
            "SELECT status, bintang FROM tujuan WHERE dibuat >= ?", (batas,)
        ).fetchall()
    finally:
        c.close()
    n = len(baris)
    selesai = sum(1 for b in baris if b["status"] == "selesai")
    bintang = [b["bintang"] for b in baris if b["bintang"]]
    return {
        "dibuat": n,
        "tuntas": selesai,
        "aktif": sum(1 for b in baris if b["status"] == "aktif"),
        "diganti": sum(1 for b in baris if b["status"] == "diganti"),
        "persen_tuntas": round(100.0 * selesai / n, 1) if n else None,
        "jumlah_bintang": len(bintang),
        "rata_bintang": round(sum(bintang) / len(bintang), 2) if bintang else None,
    }
