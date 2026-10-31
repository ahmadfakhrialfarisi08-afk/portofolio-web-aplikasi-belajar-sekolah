"""
SCORUS AI -- riwayat chat multi-sesi (khusus guru).

Letak file: api/scorus_history_routes.py (sejajar api/scorus_ai_routes.py).

Endpoint (semua wajib login sebagai guru, dan hanya menyentuh data milik akun itu sendiri):
    POST   /api/scorus/conversations        -> chat baru
    GET    /api/scorus/conversations        -> daftar riwayat
    GET    /api/scorus/conversations/<id>   -> buka satu chat (beserta pesan)
    POST   /api/scorus/chat                 -> kirim pesan  {conversation_id?, message}
    DELETE /api/scorus/conversations/<id>   -> hapus chat (pesan ikut terhapus)

Integrasi: TIDAK ada sistem AI baru. /api/scorus/chat memanggil jalankan_scorus_ai()
di scorus_ai_routes.py -- jadi aturan topik, cache, rate limit, quota harian, dan
panggilan OpenAI-nya sama persis dengan yang sudah berjalan.

Database: project ini sebelumnya tidak memakai database (data lain berupa file JSON),
jadi riwayat chat memakai SQLAlchemy dengan SQLite di data/scorus_history.db, terpisah
dari store JSON yang ada. Untuk pindah ke MySQL/Postgres cukup isi di .env:
    SCORUS_DB_URL=mysql+pymysql://user:pass@host/dbname
Tabel dibuat otomatis saat request pertama (create_all) -- tidak perlu migrasi manual.

Opsional (.env):
    SCORUS_AI_KONTEKS_PESAN=9          # maks pesan LAMA yang ikut dikirim ke AI
    SCORUS_AI_KONTEKS_KARAKTER=6000    # maks total karakter pesan LAMA yang ikut dikirim
    SCORUS_AI_KONTEKS_PER_PESAN=1200   # tiap pesan LAMA dipotong sampai segini karakter saat dikirim ke AI
    SCORUS_MAKS_CHAT_PER_GURU=50       # maks jumlah chat tersimpan per guru
    SCORUS_MAKS_PESAN_PER_CHAT=60      # maks pesan dalam satu chat (30 tanya-jawab)
    SCORUS_RIWAYAT_HARI=60             # chat yang tidak disentuh selama ini dihapus otomatis (0 = nonaktif)
Ukuran database dibatasi tiga lapis: jumlah chat per guru, jumlah pesan per chat, dan umur chat.
Batas konteks hanya untuk menghemat token; isi chat di database tidak dipotong.
"""
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text,
    create_engine, delete, event, exists, func, inspect, text,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import declarative_base, relationship, scoped_session, sessionmaker

from api.scorus_ai_routes import (
    MAX_PANJANG_PESAN,
    MAX_PESAN_RIWAYAT,
    _BASE_DIR,
    jalankan_scorus_ai,
    pastikan_guru,
)

scorus_history_bp = Blueprint("scorus_history", __name__)

JUDUL_DEFAULT = "Chat Baru"
MAKS_PANJANG_JUDUL = 60
KONTEKS_MAKS_PESAN = int(os.getenv("SCORUS_AI_KONTEKS_PESAN", str(MAX_PESAN_RIWAYAT - 1)))
KONTEKS_MAKS_KARAKTER = int(os.getenv("SCORUS_AI_KONTEKS_KARAKTER", "6000"))
KONTEKS_MAKS_PER_PESAN = int(os.getenv("SCORUS_AI_KONTEKS_PER_PESAN", "1200"))
MAKS_CHAT_PER_GURU = int(os.getenv("SCORUS_MAKS_CHAT_PER_GURU", "50"))
MAKS_PESAN_PER_CHAT = int(os.getenv("SCORUS_MAKS_PESAN_PER_CHAT", "60"))
RETENSI_HARI = int(os.getenv("SCORUS_RIWAYAT_HARI", "60"))


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def _url_database():
    url = os.getenv("SCORUS_DB_URL", "").strip()
    if url:
        return url
    folder = os.path.join(_BASE_DIR, "data")
    os.makedirs(folder, exist_ok=True)
    # sqlite:/// + path absolut (Linux: /home/..  -> 4 slash; Windows: C:/.. -> 3 slash)
    return "sqlite:///" + os.path.join(folder, "scorus_history.db").replace("\\", "/")


_DB_URL = _url_database()
_PAKAI_SQLITE = _DB_URL.startswith("sqlite")

# hide_parameters=True: kalau ada error SQL, isi chat tidak ikut tercetak di log.
if _PAKAI_SQLITE:
    engine = create_engine(
        _DB_URL, hide_parameters=True, pool_pre_ping=True,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _aktifkan_foreign_key(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")  # supaya ON DELETE CASCADE jalan di SQLite
        cur.close()
else:
    engine = create_engine(_DB_URL, hide_parameters=True, pool_pre_ping=True, pool_recycle=280)

SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False))
Base = declarative_base()


def _sekarang():
    """UTC tanpa tzinfo (disimpan sebagai UTC; dikirim ke frontend dengan akhiran Z)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Conversation(Base):
    __tablename__ = "scorus_conversations"

    # Satu index gabungan melayani daftar riwayat (filter user, urut terbaru) dan pembersihan chat lama.
    __table_args__ = (Index("ix_scorus_conv_user_updated", "user_id", "updated_at"),)

    id = Column(Integer, primary_key=True)
    # Project ini tidak punya model User (akun ada di users_store.json), jadi pemilik
    # chat dicatat lewat username dari session["user"]["username"].
    user_id = Column(String(80), nullable=False)
    title = Column(String(120), nullable=False, default=JUDUL_DEFAULT)
    created_at = Column(DateTime, nullable=False, default=_sekarang)
    updated_at = Column(DateTime, nullable=False, default=_sekarang)

    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Message.id",
    )


class Message(Base):
    __tablename__ = "scorus_messages"
    __table_args__ = (CheckConstraint("role IN ('user','assistant')", name="ck_scorus_msg_role"),)

    id = Column(Integer, primary_key=True)
    conversation_id = Column(
        Integer, ForeignKey("scorus_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String(10), nullable=False)
    content = Column(Text, nullable=False)
    # user | assistant_ai | assistant_local | api_exhausted  (NULL = baris lama sebelum kolom ini ada)
    message_type = Column(String(20), nullable=True)
    timestamp = Column(DateTime, nullable=False, default=_sekarang)

    conversation = relationship("Conversation", back_populates="messages")


_init_lock = threading.Lock()
_db_siap = False


def _migrasi_kolom_message_type():
    """Database lama belum punya kolom message_type: tambahkan sekali (aman dipanggil berulang / multi-worker)."""
    try:
        kolom = {c["name"] for c in inspect(engine).get_columns("scorus_messages")}
        if "message_type" not in kolom:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE scorus_messages ADD COLUMN message_type VARCHAR(20)"))
    except SQLAlchemyError:
        pass  # worker lain sudah menambahkannya; kalau gagal, baris lama tetap terbaca (kolom nullable)


def init_scorus_db():
    """Buat tabel kalau belum ada. Aman dipanggil berulang."""
    global _db_siap
    if _db_siap:
        return
    with _init_lock:
        if not _db_siap:
            Base.metadata.create_all(engine)
            _migrasi_kolom_message_type()
            _db_siap = True


@scorus_history_bp.before_request
def _siapkan_db():
    init_scorus_db()


@scorus_history_bp.teardown_app_request
def _tutup_session(_exc):
    SessionLocal.remove()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
def _iso(dt):
    return dt.isoformat(timespec="seconds") + "Z"


def _conv_dict(c):
    return {"id": c.id, "title": c.title, "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at)}


def _msg_dict(m):
    tipe = m.message_type or ("user" if m.role == "user" else "assistant_ai")
    return {"id": m.id, "role": m.role, "content": m.content, "message_type": tipe,
            "timestamp": _iso(m.timestamp)}


def _buat_judul(teks):
    t = re.sub(r"\s+", " ", teks).strip()
    if not t:
        return JUDUL_DEFAULT
    return t[:MAKS_PANJANG_JUDUL].rstrip() + ("…" if len(t) > MAKS_PANJANG_JUDUL else "")


def _ambil_milik(db, conv_id, username):
    """Ownership: chat orang lain diperlakukan sama seperti tidak ada (404)."""
    return (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == username)
        .first()
    )


def _id_valid(nilai):
    if isinstance(nilai, bool):
        return None
    try:
        n = int(nilai)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _konteks_lama(db, conv_id):
    """Pesan lama dari chat INI saja, dibatasi jumlah dan total karakter (hemat token)."""
    baris = (
        db.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.id.desc())
        .limit(KONTEKS_MAKS_PESAN)
        .all()
    )
    urut = list(reversed(baris))  # lama -> baru
    bersih = []
    for i, m in enumerate(urut):
        if m.message_type == "api_exhausted":
            continue
        if m.role == "user" and i + 1 < len(urut) and urut[i + 1].message_type == "api_exhausted":
            continue
        bersih.append(m)
    terpilih, total = [], 0
    for m in reversed(bersih):  # dari yang terbaru
        isi = m.content
        if len(isi) > KONTEKS_MAKS_PER_PESAN:  # jawaban panjang lama dipotong (hemat token)
            isi = isi[:KONTEKS_MAKS_PER_PESAN].rstrip() + "…"
        total += len(isi)
        if total > KONTEKS_MAKS_KARAKTER and terpilih:
            break
        terpilih.append({"role": m.role, "content": isi})
    terpilih.reverse()
    return terpilih


def _error(pesan, status):
    return jsonify({"error": pesan}), status


_purge_terakhir = {}  # username -> waktu pembersihan terakhir (maks sekali per jam per guru)


def _bersihkan_chat_lama(db, username):
    """Hapus chat milik guru ini yang sudah RETENSI_HARI hari tidak disentuh (pesannya ikut)."""
    if RETENSI_HARI <= 0:
        return
    sekarang = time.time()
    if sekarang - _purge_terakhir.get(username, 0) < 3600:
        return
    _purge_terakhir[username] = sekarang
    batas = _sekarang() - timedelta(days=RETENSI_HARI)
    try:
        ids = [
            r[0] for r in db.query(Conversation.id)
            .filter(Conversation.user_id == username, Conversation.updated_at < batas)
            .all()
        ]
        if ids:
            db.execute(delete(Message).where(Message.conversation_id.in_(ids)))
            db.execute(delete(Conversation).where(Conversation.id.in_(ids)))
            db.commit()
    except SQLAlchemyError:
        db.rollback()
        current_app.logger.exception("SCORUS history: gagal membersihkan chat lama")


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@scorus_history_bp.route("/api/scorus/conversations", methods=["POST"])
def buat_conversation():
    username, err = pastikan_guru()
    if err:
        return err
    db = SessionLocal()
    try:
        # Kalau sudah ada chat kosong, pakai lagi (hindari tumpukan "Chat Baru" kosong).
        kosong = (
            db.query(Conversation)
            .filter(Conversation.user_id == username, ~exists().where(Message.conversation_id == Conversation.id))
            .order_by(Conversation.updated_at.desc())
            .first()
        )
        if kosong:
            kosong.updated_at = _sekarang()
            db.commit()
            return jsonify({"conversation": _conv_dict(kosong), "dipakai_ulang": True}), 200

        jumlah = db.query(func.count(Conversation.id)).filter(Conversation.user_id == username).scalar()
        if jumlah >= MAKS_CHAT_PER_GURU:
            return _error("Riwayat chat sudah penuh (%d). Hapus beberapa chat lama dulu." % MAKS_CHAT_PER_GURU, 409)

        conv = Conversation(user_id=username, title=JUDUL_DEFAULT)
        db.add(conv)
        db.commit()
        return jsonify({"conversation": _conv_dict(conv), "dipakai_ulang": False}), 201
    except SQLAlchemyError:
        db.rollback()
        current_app.logger.exception("SCORUS history: gagal membuat conversation")
        return _error("Gagal membuat chat baru.", 500)


@scorus_history_bp.route("/api/scorus/conversations", methods=["GET"])
def daftar_conversation():
    username, err = pastikan_guru()
    if err:
        return err
    db = SessionLocal()
    _bersihkan_chat_lama(db, username)
    try:
        baris = (
            db.query(Conversation)
            .filter(Conversation.user_id == username)
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .limit(MAKS_CHAT_PER_GURU)
            .all()
        )
        return jsonify({"conversations": [_conv_dict(c) for c in baris]})
    except SQLAlchemyError:
        current_app.logger.exception("SCORUS history: gagal membaca daftar")
        return _error("Gagal memuat riwayat.", 500)


@scorus_history_bp.route("/api/scorus/conversations/<int:conv_id>", methods=["GET"])
def buka_conversation(conv_id):
    username, err = pastikan_guru()
    if err:
        return err
    db = SessionLocal()
    try:
        conv = _ambil_milik(db, conv_id, username)
        if not conv:
            return _error("Chat tidak ditemukan.", 404)
        pesan = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.id.asc())
            .all()
        )
        return jsonify({"conversation": _conv_dict(conv), "messages": [_msg_dict(m) for m in pesan]})
    except SQLAlchemyError:
        current_app.logger.exception("SCORUS history: gagal membuka conversation")
        return _error("Gagal membuka chat.", 500)


@scorus_history_bp.route("/api/scorus/conversations/<int:conv_id>", methods=["DELETE"])
def hapus_conversation(conv_id):
    username, err = pastikan_guru()
    if err:
        return err
    db = SessionLocal()
    try:
        conv = _ambil_milik(db, conv_id, username)
        if not conv:
            return _error("Chat tidak ditemukan.", 404)
        db.delete(conv)  # pesan ikut terhapus (cascade)
        db.commit()
        return jsonify({"ok": True})
    except SQLAlchemyError:
        db.rollback()
        current_app.logger.exception("SCORUS history: gagal menghapus conversation")
        return _error("Gagal menghapus chat.", 500)


@scorus_history_bp.route("/api/scorus/chat", methods=["POST"])
def kirim_pesan():
    username, err = pastikan_guru()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    teks = body.get("message")
    if not isinstance(teks, str) or not teks.strip():
        return _error("Pesan kosong.", 400)
    teks = teks.strip()
    if len(teks) > MAX_PANJANG_PESAN:
        return _error("Pesan terlalu panjang (maksimal %d karakter)." % MAX_PANJANG_PESAN, 400)
    # CATATAN: role TIDAK diambil dari frontend. Pesan baru selalu "user",
    # jawaban selalu "assistant" -- keduanya ditentukan di sini.

    db = SessionLocal()
    conv = None
    jumlah_pesan = 0
    konteks = []
    try:
        if body.get("conversation_id") is not None:
            conv_id = _id_valid(body.get("conversation_id"))
            if conv_id is None:
                return _error("conversation_id tidak valid.", 400)
            conv = _ambil_milik(db, conv_id, username)
            if not conv:
                return _error("Chat tidak ditemukan.", 404)
            jumlah_pesan = db.query(func.count(Message.id)).filter(Message.conversation_id == conv.id).scalar()
            if jumlah_pesan >= MAKS_PESAN_PER_CHAT:
                return _error("Chat ini sudah terlalu panjang. Mulai chat baru ya.", 409)
            konteks = _konteks_lama(db, conv.id)  # hanya dari chat aktif ini
        else:
            jumlah_chat = db.query(func.count(Conversation.id)).filter(Conversation.user_id == username).scalar()
            if jumlah_chat >= MAKS_CHAT_PER_GURU:
                return _error("Riwayat chat sudah penuh (%d). Hapus beberapa chat lama dulu." % MAKS_CHAT_PER_GURU, 409)
        db.commit()  # lepas transaksi baca sebelum panggilan AI yang lama
    except SQLAlchemyError:
        current_app.logger.exception("SCORUS history: gagal membaca konteks")
        return _error("Gagal membaca riwayat chat.", 500)

    # --- Service SCORUS AI yang sudah ada (aturan topik -> cache -> quota -> OpenAI) ---
    payload, status = jalankan_scorus_ai(username, konteks + [{"role": "user", "content": teks}])
    if status != 200:
        return jsonify(payload), status  # tidak ada yang disimpan kalau AI gagal
    jawaban = payload["reply"]
    # Jenis pesan asisten: AI (termasuk cache) / lokal (aturan) / api_exhausted. Lokal & api_exhausted bukan respons API.
    tipe_ai = payload.get("message_type") or "assistant_ai"

    # --- Simpan user message + assistant message, update updated_at ---
    try:
        sekarang = _sekarang()
        if conv is None:
            conv = Conversation(user_id=username, title=_buat_judul(teks), created_at=sekarang)
            db.add(conv)
            db.flush()
        elif jumlah_pesan == 0 and conv.title == JUDUL_DEFAULT:
            conv.title = _buat_judul(teks)  # judul dari pesan pertama, tanpa panggilan AI tambahan

        pesan_user = Message(conversation_id=conv.id, role="user", content=teks, message_type="user",
                             timestamp=sekarang)
        pesan_ai = Message(conversation_id=conv.id, role="assistant", content=jawaban, message_type=tipe_ai,
                           timestamp=_sekarang())
        db.add_all([pesan_user, pesan_ai])
        conv.updated_at = pesan_ai.timestamp
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        current_app.logger.exception("SCORUS history: gagal menyimpan pesan")
        # Jawaban sudah didapat (dan kuota terpakai), jadi tetap dikirim ke guru.
        return jsonify({"reply": jawaban, "sumber": payload.get("sumber"), "message_type": tipe_ai,
                        "lily_expression": payload.get("lily_expression"), "tersimpan": False})

    return jsonify({
        "reply": jawaban,
        "sumber": payload.get("sumber"),
        "message_type": tipe_ai,
        "lily_expression": payload.get("lily_expression"),
        "tersimpan": True,
        "conversation": _conv_dict(conv),
        "user_message": _msg_dict(pesan_user),
        "assistant_message": _msg_dict(pesan_ai),
    })
