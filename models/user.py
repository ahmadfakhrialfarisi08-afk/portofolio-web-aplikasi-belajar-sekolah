from werkzeug.security import generate_password_hash, check_password_hash
from models.db import get_koneksi


def daftar_user(nama, username, password, role, kelas_id=None):
    """
    Daftarin user baru. Password otomatis di-hash.
    kelas_id cuma diisi kalau role == 'siswa'.
    """
    password_hash = generate_password_hash(password)
    conn = get_koneksi()
    try:
        cursor = conn.execute(
            "INSERT INTO users (nama, username, password_hash, role) VALUES (?, ?, ?, ?)",
            (nama, username, password_hash, role)
        )
        user_id = cursor.lastrowid

        # kalau siswa, langsung catat kelasnya di tabel siswa_detail
        if role == "siswa" and kelas_id:
            conn.execute(
                "INSERT INTO siswa_detail (user_id, kelas_id) VALUES (?, ?)",
                (user_id, kelas_id)
            )

        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def cari_user_by_username(username):
    conn = get_koneksi()
    user = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    return user


def cari_user_by_id(user_id):
    conn = get_koneksi()
    user = conn.execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    conn.close()
    return user


def cek_login(username, password):
    """Return data user kalau username+password cocok, None kalau salah."""
    user = cari_user_by_username(username)
    if user is None:
        return None
    if check_password_hash(user["password_hash"], password):
        return user
    return None


def kelas_siswa(user_id):
    """Cari siswa ini kelasnya apa (dipakai buat filter tugas)."""
    conn = get_koneksi()
    hasil = conn.execute(
        "SELECT kelas_id FROM siswa_detail WHERE user_id = ?", (user_id,)
    ).fetchone()
    conn.close()
    return hasil["kelas_id"] if hasil else None


def semua_guru():
    """Daftar semua user dengan role guru (buat fitur swipe di dashboard siswa)."""
    conn = get_koneksi()
    hasil = conn.execute(
        "SELECT id, nama, username FROM users WHERE role = 'guru'"
    ).fetchall()
    conn.close()
    return hasil
