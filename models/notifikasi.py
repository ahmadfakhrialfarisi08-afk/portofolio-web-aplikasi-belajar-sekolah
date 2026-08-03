from models.db import get_koneksi


def buat_notifikasi(user_id, judul, pesan, tipe):
    conn = get_koneksi()
    conn.execute("""
        INSERT INTO notifikasi (user_id, judul, pesan, tipe) VALUES (?, ?, ?, ?)
    """, (user_id, judul, pesan, tipe))
    conn.commit()
    conn.close()


def notifikasi_untuk_user(user_id, hanya_belum_dibaca=False):
    conn = get_koneksi()
    if hanya_belum_dibaca:
        hasil = conn.execute("""
            SELECT * FROM notifikasi WHERE user_id = ? AND sudah_dibaca = 0
            ORDER BY dibuat_at DESC
        """, (user_id,)).fetchall()
    else:
        hasil = conn.execute("""
            SELECT * FROM notifikasi WHERE user_id = ?
            ORDER BY dibuat_at DESC
        """, (user_id,)).fetchall()
    conn.close()
    return hasil


def tandai_dibaca(notifikasi_id):
    conn = get_koneksi()
    conn.execute("UPDATE notifikasi SET sudah_dibaca = 1 WHERE id = ?", (notifikasi_id,))
    conn.commit()
    conn.close()
