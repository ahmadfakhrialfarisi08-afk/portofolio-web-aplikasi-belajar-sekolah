from models.db import get_koneksi


def tambah_lokasi(nama_lokasi, koordinat_x, koordinat_y):
    conn = get_koneksi()
    cursor = conn.execute("""
        INSERT INTO lokasi_sekolah (nama_lokasi, koordinat_x, koordinat_y) VALUES (?, ?, ?)
    """, (nama_lokasi, koordinat_x, koordinat_y))
    lokasi_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return lokasi_id


def semua_lokasi():
    conn = get_koneksi()
    hasil = conn.execute("SELECT * FROM lokasi_sekolah").fetchall()
    conn.close()
    return hasil
