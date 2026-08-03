from models.db import get_koneksi


def tambah_kelas(nama_kelas, tingkat):
    conn = get_koneksi()
    try:
        conn.execute(
            "INSERT INTO kelas (nama_kelas, tingkat) VALUES (?, ?)",
            (nama_kelas, tingkat)
        )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


def semua_kelas():
    conn = get_koneksi()
    hasil = conn.execute("SELECT * FROM kelas ORDER BY tingkat, nama_kelas").fetchall()
    conn.close()
    return hasil


def cari_kelas_by_id(kelas_id):
    conn = get_koneksi()
    hasil = conn.execute("SELECT * FROM kelas WHERE id = ?", (kelas_id,)).fetchone()
    conn.close()
    return hasil
