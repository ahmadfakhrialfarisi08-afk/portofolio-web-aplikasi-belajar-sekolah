from models.db import get_koneksi


def tambah_jadwal(guru_id, kelas_id, mapel, hari, jam_mulai, jam_selesai, is_walikelas=False):
    conn = get_koneksi()
    conn.execute("""
        INSERT INTO guru_mengajar (guru_id, kelas_id, mapel, hari, jam_mulai, jam_selesai, is_walikelas)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (guru_id, kelas_id, mapel, hari, jam_mulai, jam_selesai, 1 if is_walikelas else 0))
    conn.commit()
    conn.close()


def kelas_yang_diajar(guru_id):
    """
    Semua kelas + jadwal yang diajar guru ini.
    Dipakai buat tampilan dashboard guru: daftar semua kelas dan jam ngajarnya.
    """
    conn = get_koneksi()
    hasil = conn.execute("""
        SELECT gm.id, gm.mapel, gm.hari, gm.jam_mulai, gm.jam_selesai, gm.is_walikelas,
               k.id AS kelas_id, k.nama_kelas
        FROM guru_mengajar gm
        JOIN kelas k ON gm.kelas_id = k.id
        WHERE gm.guru_id = ?
        ORDER BY gm.hari, gm.jam_mulai
    """, (guru_id,)).fetchall()
    conn.close()
    return hasil


def walikelas_dari(kelas_id):
    """
    Cari siapa wali kelas dari kelas tertentu.
    Ini yang jawab pertanyaan kamu: 'guru B bisa lihat guru A walikelas kelas apa'
    """
    conn = get_koneksi()
    hasil = conn.execute("""
        SELECT u.id, u.nama
        FROM guru_mengajar gm
        JOIN users u ON gm.guru_id = u.id
        WHERE gm.kelas_id = ? AND gm.is_walikelas = 1
        LIMIT 1
    """, (kelas_id,)).fetchone()
    conn.close()
    return hasil


def guru_mengajar_di_kelas(kelas_id):
    """Cek: guru yang login ini ngajar di kelas tertentu apa nggak? (buat validasi izin)"""
    conn = get_koneksi()
    hasil = conn.execute(
        "SELECT * FROM guru_mengajar WHERE kelas_id = ?", (kelas_id,)
    ).fetchall()
    conn.close()
    return hasil
