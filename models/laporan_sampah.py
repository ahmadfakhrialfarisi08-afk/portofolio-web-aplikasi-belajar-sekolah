from models.db import get_koneksi


def buat_laporan(lokasi_id, foto_url, perkiraan_jumlah):
    """Dipanggil pas robot kirim foto baru."""
    conn = get_koneksi()
    cursor = conn.execute("""
        INSERT INTO laporan_sampah (lokasi_id, foto_url, perkiraan_jumlah)
        VALUES (?, ?, ?)
    """, (lokasi_id, foto_url, perkiraan_jumlah))
    laporan_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return laporan_id


def semua_laporan_aktif():
    """
    Semua laporan yang statusnya masih 'belum_dibersihkan'.
    Ini yang dipakai buat gambar titik merah di denah -
    1 lokasi bisa punya banyak baris di sini = titik makin 'ramai'.
    """
    conn = get_koneksi()
    hasil = conn.execute("""
        SELECT ls.*, l.nama_lokasi, l.koordinat_x, l.koordinat_y
        FROM laporan_sampah ls
        JOIN lokasi_sekolah l ON ls.lokasi_id = l.id
        WHERE ls.status = 'belum_dibersihkan'
        ORDER BY ls.waktu_pengambilan DESC
    """).fetchall()
    conn.close()
    return hasil


def tandai_dibersihkan(laporan_id, staff_id):
    conn = get_koneksi()
    conn.execute("""
        UPDATE laporan_sampah SET status = 'sudah_dibersihkan', dibersihkan_oleh = ?
        WHERE id = ?
    """, (staff_id, laporan_id))
    conn.commit()
    conn.close()
