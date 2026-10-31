import sqlite3
from config import DATABASE_PATH


def get_koneksi():
    """Satu fungsi ini dipanggil semua model lain, biar gak duplikat kode koneksi."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row  # hasil query bisa diakses kayak dictionary: row["nama"]
    conn.execute("PRAGMA foreign_keys = ON")  # biar relasi antar tabel dicek ketat
    return conn


def init_db():
    """Bikin semua tabel kalau belum ada. Dipanggil sekali pas app.py start."""
    conn = get_koneksi()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('siswa', 'guru', 'staff'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS kelas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama_kelas TEXT NOT NULL UNIQUE,
            tingkat TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS siswa_detail (
            user_id INTEGER PRIMARY KEY,
            kelas_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (kelas_id) REFERENCES kelas(id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS guru_mengajar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guru_id INTEGER NOT NULL,
            kelas_id INTEGER NOT NULL,
            mapel TEXT NOT NULL,
            hari TEXT NOT NULL,
            jam_mulai TEXT NOT NULL,
            jam_selesai TEXT NOT NULL,
            is_walikelas INTEGER DEFAULT 0,
            FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (kelas_id) REFERENCES kelas(id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS tugas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guru_id INTEGER NOT NULL,
            kelas_id INTEGER NOT NULL,
            judul TEXT NOT NULL,
            deskripsi TEXT,
            jenis TEXT CHECK(jenis IN ('tugas', 'catatan')) NOT NULL,
            deadline TEXT,
            dibuat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (kelas_id) REFERENCES kelas(id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS tugas_siswa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tugas_id INTEGER NOT NULL,
            siswa_id INTEGER NOT NULL,
            status TEXT CHECK(status IN ('belum', 'sudah')) DEFAULT 'belum',
            dikumpulkan_at TIMESTAMP,
            FOREIGN KEY (tugas_id) REFERENCES tugas(id) ON DELETE CASCADE,
            FOREIGN KEY (siswa_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS notifikasi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            judul TEXT NOT NULL,
            pesan TEXT,
            tipe TEXT CHECK(tipe IN ('jadwal_mengajar', 'tugas_baru', 'sampah_baru')),
            sudah_dibaca INTEGER DEFAULT 0,
            dibuat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS lokasi_sekolah (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama_lokasi TEXT NOT NULL,
            koordinat_x REAL NOT NULL,
            koordinat_y REAL NOT NULL
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS laporan_sampah (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lokasi_id INTEGER NOT NULL,
            foto_url TEXT NOT NULL,
            perkiraan_jumlah TEXT,
            waktu_pengambilan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT CHECK(status IN ('belum_dibersihkan', 'sudah_dibersihkan')) DEFAULT 'belum_dibersihkan',
            dibersihkan_oleh INTEGER,
            FOREIGN KEY (lokasi_id) REFERENCES lokasi_sekolah(id),
            FOREIGN KEY (dibersihkan_oleh) REFERENCES users(id)
        )
    """)

    conn.commit()
    conn.close()
