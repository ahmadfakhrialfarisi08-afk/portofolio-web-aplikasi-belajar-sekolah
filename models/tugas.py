from models.db import get_koneksi


def buat_tugas(guru_id, kelas_id, judul, deskripsi, jenis, deadline=None):
    """
    Bikin tugas/catatan baru buat 1 kelas spesifik.
    Karena kelas_id disimpan di sini, nanti pas siswa minta data tugas,
    kita tinggal filter WHERE kelas_id = kelas siswa itu -> otomatis gak nyasar.
    """
    conn = get_koneksi()
    cursor = conn.execute("""
        INSERT INTO tugas (guru_id, kelas_id, judul, deskripsi, jenis, deadline)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (guru_id, kelas_id, judul, deskripsi, jenis, deadline))
    tugas_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return tugas_id


def tugas_untuk_kelas(kelas_id, jenis=None):
    """
    INI KUNCI UTAMA logika 'tugas gak nyasar ke kelas lain'.
    Query ini cuma ambil baris yang kelas_id-nya PERSIS sama dengan kelas siswa yang minta.
    """
    conn = get_koneksi()
    if jenis:
        hasil = conn.execute("""
            SELECT t.*, u.nama AS nama_guru
            FROM tugas t
            JOIN users u ON t.guru_id = u.id
            WHERE t.kelas_id = ? AND t.jenis = ?
            ORDER BY t.dibuat_at DESC
        """, (kelas_id, jenis)).fetchall()
    else:
        hasil = conn.execute("""
            SELECT t.*, u.nama AS nama_guru
            FROM tugas t
            JOIN users u ON t.guru_id = u.id
            WHERE t.kelas_id = ?
            ORDER BY t.dibuat_at DESC
        """, (kelas_id,)).fetchall()
    conn.close()
    return hasil


def tugas_by_guru(guru_id):
    """Semua tugas yang pernah dibuat guru ini (buat riwayat)."""
    conn = get_koneksi()
    hasil = conn.execute("""
        SELECT t.*, k.nama_kelas
        FROM tugas t
        JOIN kelas k ON t.kelas_id = k.id
        WHERE t.guru_id = ?
        ORDER BY t.dibuat_at DESC
    """, (guru_id,)).fetchall()
    conn.close()
    return hasil
