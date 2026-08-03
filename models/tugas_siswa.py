from models.db import get_koneksi


def buat_status_untuk_sekelas(tugas_id, kelas_id):
    """
    Dipanggil otomatis begitu guru bikin tugas baru.
    Semua siswa di kelas itu langsung dapet baris status 'belum' -
    ini yang bikin tugas 'langsung masuk serentak ke semua siswa kelas itu'.
    """
    conn = get_koneksi()
    siswa_di_kelas = conn.execute(
        "SELECT user_id FROM siswa_detail WHERE kelas_id = ?", (kelas_id,)
    ).fetchall()

    for siswa in siswa_di_kelas:
        conn.execute(
            "INSERT INTO tugas_siswa (tugas_id, siswa_id, status) VALUES (?, ?, 'belum')",
            (tugas_id, siswa["user_id"])
        )

    conn.commit()
    conn.close()


def tandai_selesai(tugas_id, siswa_id):
    conn = get_koneksi()
    conn.execute("""
        UPDATE tugas_siswa
        SET status = 'sudah', dikumpulkan_at = CURRENT_TIMESTAMP
        WHERE tugas_id = ? AND siswa_id = ?
    """, (tugas_id, siswa_id))
    conn.commit()
    conn.close()


def status_pengumpulan(tugas_id):
    """Buat guru: lihat siapa aja yang udah/belum ngumpulin tugas ini."""
    conn = get_koneksi()
    hasil = conn.execute("""
        SELECT ts.status, u.nama
        FROM tugas_siswa ts
        JOIN users u ON ts.siswa_id = u.id
        WHERE ts.tugas_id = ?
    """, (tugas_id,)).fetchall()
    conn.close()
    return hasil
