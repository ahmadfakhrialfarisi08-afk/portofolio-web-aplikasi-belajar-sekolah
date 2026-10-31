# NEW ERA SCHOOL EDUCATION

Aplikasi web belajar untuk sekolah, dibangun dengan Flask. Guru dan siswa punya dashboard masing-masing, dilengkapi asisten AI berbasis Gemini dan maskot **Lily**.

> Proyek portofolio. Dibuat oleh **AHMAD FAKHRI AL FARISI**.

## Fitur

**Siswa**
- Dashboard siswa: tugas, catatan, jadwal, dan notifikasi
- Quiz dan leaderboard, lengkap dengan border avatar dan title/badge
- AI Support dan Study Coach pribadi (Gemini) dengan riwayat chat

**Guru**
- Dashboard guru: kelas, tugas, dan pantauan siswa
- Pengingat jadwal mengajar
- Fitur pelanggaran dan penebus
- Pengecekan orisinalitas tugas tulisan tangan
- **SCORUS AI** dan maskot **Lily**, termasuk pembuat dokumen Word (modul ajar dan sejenisnya)

**Admin**
- Pemantauan pemakaian API AI (token, biaya, cache)
- Maintenance mode per fitur

## Teknologi

- Python, Flask, SQLAlchemy, SQLite
- Google Gemini API
- Supabase (opsional, untuk cache semantik AI dan data prestasi)
- JavaScript, HTML, dan CSS (Tailwind)

## Cara menjalankan

Syarat: Python 3.10 atau lebih baru.

```bash
# 1. Clone repo
git clone https://github.com/ahmadfakhrialfarisi08-afk/portofolio-web-aplikasi-belajar-sekolah.git
cd portofolio-web-aplikasi-belajar-sekolah

# 2. Buat virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# 3. Pasang dependensi
pip install -r requirements.txt

# 4. Siapkan konfigurasi
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
# lalu isi nilai di file .env

# 5. Jalankan
python app.py
```

Aplikasi berjalan di `http://127.0.0.1:5000`.

## Konfigurasi

Semua rahasia disimpan di file `.env` yang **tidak ikut di repo**. Lihat `.env.example` untuk daftar variabel:

| Variabel | Fungsi |
| --- | --- |
| `GEMINI_API_KEY` | Kunci API Gemini untuk fitur AI |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Opsional, mengaktifkan cache semantik AI |
| `SUPABASE_PRESTASI_URL`, `SUPABASE_ANON_KEY` | Opsional, data prestasi |

Tanpa variabel Supabase, aplikasi tetap jalan. Fitur cache semantik dan prestasi saja yang nonaktif.

## Catatan keamanan

- Jangan pernah commit file `.env` atau database. Keduanya sudah masuk `.gitignore`.
- Data siswa dan guru tidak disertakan di repo ini.

## Lisensi

Dirilis di bawah [lisensi MIT](LICENSE). Hak cipta © AHMAD FAKHRI AL FARISI.
