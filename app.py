import uuid
import os
import json
import random
import string
import smtplib
import ssl
import time
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, flash, session, make_response, jsonify, send_from_directory
 
# Muat variabel dari file .env jika tersedia (opsional, untuk kemudahan development).
# Kalau python-dotenv belum terinstall / file .env tidak ada, baris ini aman diabaikan.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
 
import requests
 
app = Flask(__name__)
# Key rahasia untuk menangani session dan flash message
app.secret_key = 'arcana_smart_school_secret_key'

# ----------------------------------------------------
# CACHE-CONTROL UNTUK HALAMAN LOGIN & DASHBOARD (anti bfcache "nyangkut")
# ----------------------------------------------------
# Lapisan tambahan (di luar fix pageshow/bfcache di login.html): kasih tahu
# browser supaya TIDAK menyimpan halaman login & dashboard ini di cache HTTP
# biasa maupun di back-forward cache. Ini jaga-jaga kalau ada browser lain
# (selain yang sudah ditest di login.html) yang bfcache-nya tetap mengabaikan
# event pageshow, dan juga supaya klik tombol Back setelah LOGOUT tidak
# menampilkan dashboard versi lama yang sempat ke-cache browser.
HALAMAN_TANPA_CACHE = ('login', 'dashboard', 'dashboard_siswa', 'dashboard_guru', 'dashboard_staf')

@app.after_request
def _cegah_cache_halaman_sensitif(response):
    if request.endpoint in HALAMAN_TANPA_CACHE:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    return response

# ----------------------------------------------------
# KONFIGURASI ASISTEN AI (OLLAMA LOKAL)
# ----------------------------------------------------
# Ollama jalan sebagai proses terpisah di komputer (default: ollama serve,
# listen di localhost:11434). Flask di sini cuma jadi "jembatan" -- browser
# TIDAK boleh manggil Ollama langsung (selain soal CORS, endpoint Ollama
# juga belum ada autentikasi/rate limit), jadi semua request lewat backend
# ini dulu baru diteruskan ke Ollama.
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2')
 
SYSTEM_PROMPT_AI_SUPPORT = (
    "Kamu adalah 'Asisten BA', asisten virtual Portal Sekolah SMK Banjar Asri "
    "Cimaung. Tugasmu jawab pertanyaan siswa seputar fitur portal: Tugas & "
    "Catatan, Quiz & Leaderboard, Koleksi Border/prestasi, Jadwal Pelajaran, "
    "Daftar Guru, dan kontak BK. Jawab singkat (maks 3 kalimat), ramah, pakai "
    "Bahasa Indonesia santai tapi sopan. Kalau pertanyaannya di luar topik "
    "portal sekolah, arahkan siswa untuk menghubungi IT Support lewat tombol "
    "di sidebar."
)
 
# ----------------------------------------------------
# DATA USER DUMMY (DATABASE SIMULASI)
# ----------------------------------------------------
# Username akun DEV/Admin ASLI (AHMAD FAKHRI AL FARISI) & id border khusus
# yang cuma boleh dipakai olehnya. Dipakai buat validasi di /api/profil/border
# (server-side) supaya siswa lain TIDAK BISA "curang" pasang border admin
# lewat request API langsung (mis. dari DevTools/Postman), walau di UI
# Dashboard Siswa tombolnya memang sudah disembunyikan/dikunci untuk mereka.
USERNAME_ADMIN_DEV = 'siswa'
BORDER_ID_ADMIN = 'admin_dev'
 
# Foto profil bawaan yang otomatis dipakai SEMUA siswa sejak awal (baik akun
# dummy di bawah maupun akun baru lewat /register) sampai siswa yang
# bersangkutan mengganti fotonya sendiri lewat updateProfilePhoto() di
# dashboard_siswa.html (yang lalu menyimpannya ke sini via /api/profil/foto).
# Path relatif ini sengaja disamakan gayanya dengan path file border
# (mis. '../static/img/border_pemula.jpg') yang sudah dipakai di
# dashboard_siswa.html, supaya konsisten saat dipakai sebagai src <img>
# dari halaman yang sama.
FOTO_PROFIL_DEFAULT = '../static/img/foto_profil_default.jpg'

# Daftar platform sosmed yang diizinkan disimpan lewat /api/profil/sosmed --
# dicek juga di server (bukan cuma di frontend PLATFORM_SOSMED_IDCARD di
# dashboard_siswa.html) supaya field aneh/asal tidak ikut kesimpan kalau ada
# yang kirim request langsung ke endpoint ini.
PLATFORM_SOSMED_DIIZINKAN = {'instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'whatsapp'}
 
users = {
    'guru': {
        'username': 'guru', 
        'password': 'guru123', 
        'role': 'guru',
        'email': 'guru@sekolah.sch.id',
        'fullname': 'Guru Pengajar',
        'identity_number': '198501012010011001'
    },
    'siswa': {
        'username': 'siswa', 
        'password': 'siswa123', 
        'role': 'siswa',
        'email': 'ahmad.fakhrialfarisi08@gmail.com',
        'fullname': 'AHMAD FAKHRI AL FARISI',
        'identity_number': '0051234567',
        'kelas': 'XII TKJ 3/TAV',
        'border_aktif': 'admin_dev',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
 
    
    'staf1': {
        'username': 'staf1', 
        'password': 'passstaf', 
        'role': 'staf_kebersihan',
        'email': 'staf1@sekolah.sch.id',
        'fullname': 'Staf Kebersihan 01',
        'identity_number': 'STAF-001'
    },
    'syam': {
        'username': 'syam',
        'password': 'semBandung',
        'role': 'siswa',
        'email': 'syam@sekolah.sch.id',
        'fullname': 'SYAM KHOERATUL MUKMIN',
        'identity_number': '0059999999',
        'kelas': 'XII TKJ 3/TAV',
        'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'dapeng': {
        'username': 'dafa',
        'password': 'dafa123',
        'role': 'siswa',
        'email': 'dafa@sekolah.sch.id',
        'fullname': 'DAFA ALFIANSYAH',
        'identity_number': '0059658999',
        'kelas': 'XI RPL',
        'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'waldi': {
        'username': 'waldi',
        'password': 'waldi123',
        'role': 'siswa',
        'email': 'waldi@sekolah.sch.id',
        'fullname': 'WALDI WAHIDIN',
        'identity_number': '0059999998',
        'kelas': 'XII TKJ 3/TAV',
        'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'setiawan': {
            'username': 'setiawan',
            'password': 'setiawan',
            'role': 'siswa',
            'email': 'setiawan@sekolah.sch.id',
            'fullname': 'SETIAWAN SAPUTRA',
            'identity_number': '0069999999',
            'kelas': 'XII TKJ 3/TAV',
            'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'jibril': {
                'username': 'jibril',
                'password': 'qwerty46',
                'role': 'siswa',
                'email': 'jibril@sekolah.sch.id',
                'fullname': 'MUHAMMAD JIBRIL AL MANAFI',
                'identity_number': '0069886099',
                'kelas': 'XII TKJ 3/TAV',
                'border_aktif': 'starter_pemula',
            'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'afrizal': {
                'username': 'afrizalmustaqim',
                'password': 'afrizalmustaqim',
                'role': 'siswa',
                'email': 'afrizal@sekolah.sch.id',
                'fullname': 'AFRIZAL MUSTAQIM',
                'identity_number': '0067989099',
                'kelas': 'XII TKJ 3/TAV',
                'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'fadzri': {
        'username': 'fadzri',
        'password': 'fadzri123',
        'role': 'siswa',
        'email': 'fadzri@sekolah.sch.id',
        'fullname': 'MUHAMMAD FADZRI',
        'identity_number': '0059999997',
        'kelas': 'XII TKJ 3/TAV',
        'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    }
}

# ----------------------------------------------------
# PERSISTENSI DATA USERS (akun baru, foto profil, border aktif)
# ----------------------------------------------------
# BUG YANG DIPERBAIKI: dict `users` di atas MURNI in-memory -- persis
# masalah yang sama seperti quiz_store & friends_store sebelum dibenahi
# (lihat catatan di bawah). Efeknya, tiap kali Flask reloader restart
# proses (debug=True restart otomatis setiap ada file source yang
# berubah -- termasuk saat developer push/edit kode di server), SEMUA
# perubahan yang tadinya cuma nempel di memori RAM hilang lagi:
#   - Siswa yang SUDAH ganti foto profil sendiri -> balik lagi jadi
#     foto_profil_default.jpg seolah belum pernah diganti.
#   - Siswa yang sudah ganti border/efek nama -> balik lagi ke
#     'starter_pemula' seolah belum pernah dibuka/dipasang.
#   - Akun baru yang daftar lewat /register -> hilang total, tidak bisa
#     login lagi walau baru saja berhasil daftar.
# Sekarang users disimpan ke file JSON di disk (data/users_store.json)
# tiap kali ada perubahan, lalu dibaca ulang & digabungkan ke atas data
# dummy hardcoded di atas setiap proses Flask start -- jadi perubahan
# nyata yang sudah dilakukan siswa TIDAK PERNAH ketiban/ketimpa balik
# ke nilai default bawaan.
USERS_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'users_store.json')


def _muat_users_store():
    """Baca users_store.json (kalau ada) lalu GABUNGKAN ke atas dict
    `users` dummy hardcoded di atas: akun yang sudah ada datanya
    ditimpa/diperbarui per-field (foto_profil, border_aktif, dst -- bukan
    diganti seluruh objeknya), akun yang belum ada (hasil /register)
    ditambahkan baru. Dipanggil sekali saat modul ini di-load."""
    try:
        with open(USERS_STORE_PATH, 'r', encoding='utf-8') as f:
            simpanan = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return
    for username, data in simpanan.items():
        if username in users:
            users[username].update(data)
        else:
            users[username] = data


def _simpan_users_store():
    """Tulis SELURUH isi dict `users` saat ini ke file JSON di disk.
    Dipanggil tiap kali ada perubahan (daftar akun baru, ganti foto
    profil, ganti border aktif) supaya datanya langsung awet, tidak
    hilang walau proses Flask direstart sebelum sempat dimatikan rapi."""
    os.makedirs(os.path.dirname(USERS_STORE_PATH), exist_ok=True)
    tmp_path = USERS_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, USERS_STORE_PATH)  # atomic, hindari file JSON korup


_muat_users_store()


def _akun_ini_admin_dev():
    """True hanya kalau yang sedang login adalah akun Admin/Developer ASLI
    (USERNAME_ADMIN_DEV) -- dipakai buat menggerbangi endpoint kelola data
    guru di bawah (tambah/edit/hapus), sama persis pola proteksinya dengan
    border admin di /api/profil/border. Dicek dari session Flask sungguhan,
    BUKAN dari nama tampilan, supaya tidak bisa "ditipu" lewat request
    langsung mengatasnamakan akun lain."""
    return 'user' in session and session['user'].get('username') == USERNAME_ADMIN_DEV

# ----------------------------------------------------
# DATA GURU & TENAGA PENGAJAR (menu "Daftar Guru")
# ----------------------------------------------------
# Dulu daftar guru ini hardcode statis di dashboard_siswa.html (const
# daftarGuruSekolah). Sekarang dipindah ke sini supaya bisa dikelola
# (tambah/edit/hapus) oleh SATU akun Admin/Developer lewat menu "Kelola
# Guru", dan perubahannya langsung kelihatan oleh SEMUA siswa lain lewat
# /api/guru/list -- bukan cuma nempel di browser admin sendiri.
GURU_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'guru_store.json')

DAFTAR_GURU_DEFAULT = [
    {'nama': 'Hendra, S.Kom', 'lulusan': 'S1 Ilmu Komputer - Universitas Padjadjaran', 'mapel': 'Dasar-Dasar TKI', 'kelas': 'X TKJ 1', 'tingkat': 'X', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Siti, S.T', 'lulusan': 'S1 Teknik Informatika - Universitas Telkom', 'mapel': 'Dasar-Dasar TKI', 'kelas': 'X TKJ 2', 'tingkat': 'X', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Rudi, S.Kom', 'lulusan': 'S1 Sistem Informasi - Universitas Widyatama', 'mapel': 'Dasar-Dasar TKI', 'kelas': 'X TKJ 3', 'tingkat': 'X', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Joko, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Otomotif - UPI Bandung', 'mapel': 'Gambar Teknik Otomotif', 'kelas': 'X TKR 1', 'tingkat': 'X', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Agus, S.T', 'lulusan': 'S1 Teknik Mesin - Institut Teknologi Nasional', 'mapel': 'Gambar Teknik Otomotif', 'kelas': 'X TKR 2', 'tingkat': 'X', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Dedi, S.T', 'lulusan': 'S1 Teknik Elektro - Universitas Jenderal Achmad Yani', 'mapel': 'Dasar Listrik & Elektronika', 'kelas': 'X TAV 1', 'tingkat': 'X', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Eko, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Elektro - UPI Bandung', 'mapel': 'Dasar Listrik & Elektronika', 'kelas': 'X TAV 2', 'tingkat': 'X', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1500336624523-d727130c3328?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Fitri, S.Kom', 'lulusan': 'S1 Teknik Informatika - Universitas Komputer Indonesia', 'mapel': 'Teknologi WAN', 'kelas': 'XI TKJ 1', 'tingkat': 'XI', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Bayu, S.T', 'lulusan': 'S1 Teknik Komputer - Politeknik Negeri Bandung', 'mapel': 'Teknologi WAN', 'kelas': 'XI TKJ 2', 'tingkat': 'XI', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Yudi, S.Kom', 'lulusan': 'S1 Ilmu Komputer - Universitas Padjadjaran', 'mapel': 'Teknologi WAN', 'kelas': 'XI TKJ 3', 'tingkat': 'XI', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Bambang, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Otomotif - UPI Bandung', 'mapel': 'Pemeliharaan Sasis Kendaraan', 'kelas': 'XI TKR 1', 'tingkat': 'XI', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Yanto, S.T', 'lulusan': 'S1 Teknik Mesin - Universitas Jenderal Achmad Yani', 'mapel': 'Pemeliharaan Sasis Kendaraan', 'kelas': 'XI TKR 2', 'tingkat': 'XI', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Suryana, S.T', 'lulusan': 'S1 Teknik Elektro - Institut Teknologi Nasional', 'mapel': 'Mikroprosesor & Mikrokontroler', 'kelas': 'XI TAV 1', 'tingkat': 'XI', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Tukiman, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Elektro - UPI Bandung', 'mapel': 'Mikroprosesor & Mikrokontroler', 'kelas': 'XI TAV 2', 'tingkat': 'XI', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1615109398623-88346a601842?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Dian, S.Kom', 'lulusan': 'S1 Sistem Informasi - Universitas Widyatama', 'mapel': 'Administrasi Server', 'kelas': 'XII TKJ 1', 'tingkat': 'XII', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Oky, S.T', 'lulusan': 'S1 Teknik Komputer - Politeknik Negeri Bandung', 'mapel': 'Administrasi Server', 'kelas': 'XII TKJ 2', 'tingkat': 'XII', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Ahmad, S.T', 'lulusan': 'S1 Teknik Informatika - Universitas Telkom', 'mapel': 'Administrasi Infrastruktur Jaringan', 'kelas': 'XII TKJ 3', 'tingkat': 'XII', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Dadan, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Otomotif - UPI Bandung', 'mapel': 'Pemeliharaan Mesin Kendaraan Ringan', 'kelas': 'XII TKR 1', 'tingkat': 'XII', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Toto, S.T', 'lulusan': 'S1 Teknik Mesin - Institut Teknologi Nasional', 'mapel': 'Pemeliharaan Kelistrikan Kendaraan', 'kelas': 'XII TKR 2', 'tingkat': 'XII', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Yana, S.T', 'lulusan': 'S1 Teknik Elektro - Universitas Jenderal Achmad Yani', 'mapel': 'Audio Video Sistem', 'kelas': 'XII TAV 1', 'tingkat': 'XII', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1607990281513-2c110a25bd8c?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Heri, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Elektro - UPI Bandung', 'mapel': 'Audio Video Sistem', 'kelas': 'XII TAV 2', 'tingkat': 'XII', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&q=80&w=500'},
]


def _muat_daftar_guru():
    """Baca guru_store.json (hasil tambah/edit/hapus admin sebelumnya) kalau
    sudah ada. Kalau belum pernah ada sama sekali (baru pertama kali server
    dijalankan), pakai DAFTAR_GURU_DEFAULT di atas dengan id 0..N diisi dari
    urutan array-nya."""
    try:
        with open(GURU_STORE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return [dict(g, id=i) for i, g in enumerate(DAFTAR_GURU_DEFAULT)]


daftar_guru = _muat_daftar_guru()


def _simpan_daftar_guru():
    """Tulis SELURUH isi list `daftar_guru` saat ini ke file JSON di disk,
    persis pola yang sama dengan _simpan_users_store() -- atomic write lewat
    file .tmp dulu baru di-rename, supaya file tidak korup kalau proses mati
    di tengah penulisan."""
    os.makedirs(os.path.dirname(GURU_STORE_PATH), exist_ok=True)
    tmp_path = GURU_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(daftar_guru, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, GURU_STORE_PATH)


# Kalau file store belum ada sama sekali (server baru pertama kali jalan),
# langsung simpan versi default-nya supaya file-nya beneran tercipta di disk.
if not os.path.exists(GURU_STORE_PATH):
    _simpan_daftar_guru()

# ----------------------------------------------------
# DATA QUIZ SISWA (SIMULASI TABEL quiz_scores)
# Struktur: quiz_store[username][jenis] = { ...struktur data quiz milik siswa
# itu sendiri, PERSIS sama seperti objek "data" yang dulu cuma disimpan di
# localStorage browser (totalPoin, bestByLevel, totalPoinByLevel,
# leaderboard) }.
#
# KENAPA INI PERLU:
# Sebelumnya leaderboard cuma disimpan di localStorage yang dinamespace per
# ID siswa (key `quiz_data_<id>`) -- artinya tiap akun sebenarnya punya
# salinan leaderboard-nya SENDIRI-SENDIRI di browser, jadi siswa lain
# (apalagi beda perangkat/browser) TIDAK PERNAH bisa lihat entri milik
# siswa lain. Dengan disimpan di sini (server, dalam memori proses Flask):
#   1) Progress tiap akun (poin, skor terbaik) ikut akun itu sendiri --
#      login dari perangkat/browser mana pun, datanya sama.
#   2) Leaderboard digabung dari SEMUA akun siswa yang pernah menyimpan
#      data, jadi kalau siswa A dapat peringkat 1, siswa B yang login
#      (di perangkat manapun) bisa lihat itu.
# CATATAN: dulu ini murni in-memory (hilang kalau server direstart) --
# gara-gara Flask jalan dengan debug=True, reloader-nya otomatis me-restart
# proses SETIAP KALI ada file source yang berubah. Efeknya: begitu ada
# siswa lain login/main quiz saat developer lagi ngedit-ngedit file,
# quiz_store keburu kosong lagi sebelum sempat digabung -- makanya
# leaderboard "gabungan semua siswa" kelihatannya cuma nampilin diri
# sendiri padahal logic gabungnya sendiri sudah benar. Sekarang
# quiz_store dibaca dari & ditulis ke file JSON di disk (lihat
# _muat_quiz_store / _simpan_quiz_store) supaya progres semua siswa tetap
# ada walau server restart. Untuk produksi sungguhan, tetap sebaiknya
# ganti dengan tabel database (mis. quiz_scores, quiz_leaderboard_entries).
# ----------------------------------------------------
QUIZ_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'quiz_store.json')
 
 
def _muat_quiz_store():
    """Baca quiz_store dari file JSON di disk (kalau ada). Dipanggil sekali
    saat modul ini di-load, termasuk setiap kali reloader Flask restart
    proses -- jadi data siswa yang sudah pernah tersimpan tidak hilang."""
    try:
        with open(QUIZ_STORE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
 
 
def _simpan_quiz_store():
    """Tulis quiz_store saat ini ke file JSON di disk. Dipanggil setiap
    kali ada perubahan (lihat api_quiz_save) supaya data langsung awet,
    tidak nunggu server dimatikan dengan rapi dulu."""
    os.makedirs(os.path.dirname(QUIZ_STORE_PATH), exist_ok=True)
    tmp_path = QUIZ_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(quiz_store, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, QUIZ_STORE_PATH)  # atomic, hindari file JSON korup kalau nulis lagi ketiban proses lain
 
 
quiz_store = _muat_quiz_store()


# ----------------------------------------------------
# DATA PRESTASI SISWA (SIMULASI TABEL prestasi_submissions)
# SENGAJA dibuat TERPISAH TOTAL dari quiz_store di atas -- variabel Python
# beda (prestasi_store, bukan quiz_store), file JSON di disk beda
# (prestasi_store.json, bukan quiz_store.json), dan endpoint beda
# (/api/prestasi/..., bukan /api/quiz/...) -- supaya proses baca/tulis
# salah satu fitur TIDAK PERNAH bentrok/nimpa punya fitur satunya walau
# dua-duanya sama-sama dipanggil dari dashboard_siswa.html.
#
# Beda skema dengan quiz_store: quiz_store dipecah per SLOT (per akun/
# profil dummy, lihat _kunci_slot_quiz) karena tiap siswa punya progress
# quiz masing-masing. Prestasi TIDAK begitu -- di client (lihat
# KEY_PRESTASI_SISWA di dashboard_siswa.html), satu KELAS berbagi SATU
# daftar pengajuan prestasi (karena guru perlu lihat & approve pengajuan
# semua siswa di kelas itu dari satu tempat, dan leaderboard prestasi
# butuh lihat prestasi semua siswa sekelas sekaligus). Jadi di sini
# prestasi_store dipecah per KELAS, bukan per akun:
#   prestasi_store[kelas] = [ {id, judul, jenis, keterangan, foto,
#                               hashFile, teksOCR, namaSiswa,
#                               tanggalAjukan, status, ...}, ... ]
# Skema tiap item persis sama dengan objek yang dulu cuma ada di
# localStorage (lihat ajukanPrestasi() di dashboard_siswa.html) supaya
# dashboard guru (yang baca/tulis skema yang sama) tetap kompatibel.
# ----------------------------------------------------
PRESTASI_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'prestasi_store.json')


def _muat_prestasi_store():
    """Baca prestasi_store dari file JSON di disk (kalau ada). File ini
    SENGAJA terpisah dari quiz_store.json (lihat catatan di atas)."""
    try:
        with open(PRESTASI_STORE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _simpan_prestasi_store():
    """Tulis prestasi_store saat ini ke file JSON di disk (atomic, sama
    pola dengan _simpan_quiz_store supaya tidak korup kalau ketiban
    proses lain nulis bersamaan)."""
    os.makedirs(os.path.dirname(PRESTASI_STORE_PATH), exist_ok=True)
    tmp_path = PRESTASI_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(prestasi_store, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, PRESTASI_STORE_PATH)


prestasi_store = _muat_prestasi_store()


# ----------------------------------------------------
# DATA KOTAK SARAN (SIMULASI TABEL suggestion_submissions)
# SENGAJA dibuat TERPISAH TOTAL dari quiz_store & prestasi_store di atas --
# variabel Python beda (saran_store, bukan quiz_store/prestasi_store), file
# JSON di disk beda (saran_store.json), dan endpoint beda (/api/saran/...)
# -- supaya proses baca/tulis salah satu fitur TIDAK PERNAH bentrok/nimpa
# punya fitur satunya.
#
# Beda skema dengan prestasi_store: prestasi_store dipecah per KELAS
# (karena guru cuma perlu lihat prestasi kelas yang diampu), sedangkan
# saran_store adalah SATU daftar datar (list) yang menampung saran dari
# SEMUA siswa/kelas sekaligus -- soalnya kotak saran ini cuma boleh dibaca
# oleh SATU akun (Admin/Developer, lihat _akun_ini_admin_dev), bukan per
# kelas seperti prestasi. Skema tiap item:
#   { id, anonim, nama, kelas, saran, waktu }
# Persis sama dengan objek yang dikirim client (lihat kirimSaranSiswa() /
# simpanSaranKeServer() di dashboard_siswa.html).
# ----------------------------------------------------
SARAN_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'saran_store.json')


def _muat_saran_store():
    """Baca saran_store (list) dari file JSON di disk (kalau ada)."""
    try:
        with open(SARAN_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _simpan_saran_store():
    """Tulis saran_store saat ini ke file JSON di disk (atomic, sama pola
    dengan _simpan_prestasi_store supaya tidak korup kalau ketiban proses
    lain nulis bersamaan)."""
    os.makedirs(os.path.dirname(SARAN_STORE_PATH), exist_ok=True)
    tmp_path = SARAN_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(saran_store, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, SARAN_STORE_PATH)


saran_store = _muat_saran_store()


def _default_quiz_blob(jenis):
    if jenis == 'essay':
        return {'bestByLevel': {'easy': 0, 'medium': 0, 'hard': 0}, 'leaderboard': []}
    return {
        'totalPoin': 0,
        'bestByLevel': {'easy': 0, 'medium': 0, 'hard': 0},
        'totalPoinByLevel': {'easy': 0, 'medium': 0, 'hard': 0},
        'leaderboard': []
    }
 
 
# ----------------------------------------------------
# DATA PERTEMANAN SISWA (SIMULASI TABEL friendships & friend_requests)
# Dipakai fitur "Cari Teman" supaya 2 akun BENERAN (login berbeda,
# browser/tab berbeda -- bukan sekadar profil dummy lokal) bisa saling
# kirim & terima permintaan pertemanan, dan hasilnya kelihatan di kedua
# sisi. Sama seperti quiz_store di atas, ini ditulis ke file JSON di
# disk (bukan cuma in-memory) supaya progres tidak hilang kalau Flask
# reloader restart proses saat file source lagi diedit developer.
# Struktur:
#   friendships[username]     = set/list username teman (2 arah, disimpan
#                                di kedua sisi supaya query cepat)
#   friend_requests[username] = list permintaan pertemanan yang MASUK ke
#                                username ini, tiap entri:
#                                { 'from': <username pengirim>, 'created_at': iso-string }
# ----------------------------------------------------
FRIENDS_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'friends_store.json')
 
 
def _muat_friends_store():
    try:
        with open(FRIENDS_STORE_PATH, 'r', encoding='utf-8') as f:
            raw = json.load(f)
            return (
                {k: set(v) for k, v in raw.get('friendships', {}).items()},
                raw.get('friend_requests', {})
            )
    except (FileNotFoundError, json.JSONDecodeError):
        return {}, {}
 
 
def _simpan_friends_store():
    os.makedirs(os.path.dirname(FRIENDS_STORE_PATH), exist_ok=True)
    tmp_path = FRIENDS_STORE_PATH + '.tmp'
    serializable = {
        'friendships': {k: sorted(v) for k, v in friendships.items()},
        'friend_requests': friend_requests
    }
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(serializable, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, FRIENDS_STORE_PATH)
 
 
friendships, friend_requests = _muat_friends_store()
 
 
def _apakah_berteman(a, b):
    return b in friendships.get(a, set())
 
 
def _cari_request_pending(dari_username, ke_username):
    for r in friend_requests.get(ke_username, []):
        if r['from'] == dari_username:
            return r
    return None
 
 
def _tambah_pertemanan(a, b):
    friendships.setdefault(a, set()).add(b)
    friendships.setdefault(b, set()).add(a)
 
 
def _status_pertemanan(me, target):
    """Status hubungan pertemanan dari sudut pandang `me` terhadap `target`."""
    if me == target:
        return 'diri_sendiri'
    if _apakah_berteman(me, target):
        return 'berteman'
    if _cari_request_pending(me, target):
        return 'menunggu_dikirim'  # aku yang ngirim, nunggu target terima
    if _cari_request_pending(target, me):
        return 'menunggu_diterima'  # target yang ngirim, nunggu aku terima
    return 'belum'
 
 
# ----------------------------------------------------
# KONFIGURASI OTP - LUPA PASSWORD
# ----------------------------------------------------
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 5
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60
RESET_TOKEN_EXPIRY_MINUTES = 10
 
# Konfigurasi SMTP diambil dari environment variable.
# Jika tidak diset, OTP hanya akan dicetak ke console (mode development).
MAIL_SERVER = os.environ.get('MAIL_SERVER')
MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'true').lower() == 'true'
MAIL_SENDER = os.environ.get('MAIL_SENDER', MAIL_USERNAME or 'no-reply@sekolah.sch.id')
 
# ----------------------------------------------------
# PENYIMPANAN OTP SEMENTARA (SIMULASI TABEL otp_requests)
# Struktur: otp_store[username] = {
#     'otp': '123456',
#     'role': 'siswa',
#     'email': 'siswa@sekolah.sch.id',
#     'expires_at': datetime,
#     'attempts': 0,
#     'verified': False,
#     'reset_token': None,
#     'reset_token_expires_at': None,
#     'last_sent_at': datetime,
# }
# CATATAN: di aplikasi production, simpan ini di database (misalnya tabel
# password_resets) dengan kolom yang sama, bukan di memori proses seperti ini.
# ----------------------------------------------------
otp_store = {}
 
 
def generate_otp():
    """Membuat kode OTP numerik acak sepanjang OTP_LENGTH digit."""
    return ''.join(random.choices(string.digits, k=OTP_LENGTH))
 
 
def mask_email(email):
    """Menyamarkan email untuk ditampilkan ke user, misal: si***@sekolah.sch.id"""
    try:
        local, domain = email.split('@', 1)
    except ValueError:
        return email
    if len(local) <= 2:
        masked_local = local[0] + '*' * max(len(local) - 1, 1)
    else:
        masked_local = local[:2] + '*' * (len(local) - 2)
    return f"{masked_local}@{domain}"
 
 
def send_otp_email(to_email, otp, fullname):
    """
    Mengirim kode OTP ke email user.
    Jika kredensial SMTP tersedia di environment variable, email akan
    dikirim sungguhan. Jika tidak, OTP dicetak ke console (mode demo/dev)
    supaya fitur tetap bisa diuji tanpa server SMTP.
    """
    subject = 'Kode OTP Reset Password - Arcana Smart School'
    body = (
        f"Halo {fullname},\n\n"
        f"Kami menerima permintaan untuk mereset password akun Anda.\n"
        f"Kode OTP Anda adalah: {otp}\n\n"
        f"Kode ini berlaku selama {OTP_EXPIRY_MINUTES} menit. "
        f"Jangan bagikan kode ini kepada siapa pun.\n\n"
        f"Jika Anda tidak merasa meminta reset password, abaikan email ini.\n\n"
        f"Salam,\nArcana Smart School"
    )
 
    if not MAIL_SERVER or not MAIL_USERNAME or not MAIL_PASSWORD:
        # Mode development: tidak ada konfigurasi SMTP, OTP dicetak ke console.
        print(f"[DEV MODE] OTP untuk {to_email}: {otp}")
        return False
 
    try:
        msg = MIMEText(body, 'plain', 'utf-8')
        msg['Subject'] = subject
        msg['From'] = MAIL_SENDER
        msg['To'] = to_email
 
        context = ssl.create_default_context()
        with smtplib.SMTP(MAIL_SERVER, MAIL_PORT) as server:
            if MAIL_USE_TLS:
                server.starttls(context=context)
            server.login(MAIL_USERNAME, MAIL_PASSWORD)
            server.sendmail(MAIL_SENDER, [to_email], msg.as_string())
        return True
    except Exception as exc:
        print(f"[ERROR] Gagal mengirim email OTP ke {to_email}: {exc}")
        print(f"[DEV FALLBACK] OTP untuk {to_email}: {otp}")
        return False
 
 
# ----------------------------------------------------
# ROUTE UTAMA / ROOT
# ----------------------------------------------------
@app.route('/')
def index():
    return redirect(url_for('login'))
 
# ----------------------------------------------------
# ROUTE LOGIN
# ----------------------------------------------------
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        # Selalu bersihkan sisa session lama saat halaman login dibuka.
        # Tanpa ini, kalau login akun baru gagal (role salah, dsb), session
        # akun SEBELUMNYA masih nyangkut dan /dashboard tetap nampilin akun
        # lama itu -- kelihatan seperti "kejebak" di satu akun terus.
        session.pop('user', None)
        return render_template('login.html')
 
    if request.method == 'POST':
        role = request.form.get('role')
        username = request.form.get('username')
        password = request.form.get('password')

        # Deteksi apakah ini request AJAX dari login.html (fetch dengan header
        # X-Requested-With) -- kalau iya, balas JSON supaya frontend bisa tahu
        # hasil valid/tidaknya SEBELUM animasi transisi selesai (lihat login.html),
        # jadi animasi "berhasil" (centang) hanya main kalau memang berhasil, dan
        # animasi "gagal" (silang) main kalau username/password/role salah.
        is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

        # Cari user sesuai username dan role
        user = None
        for u in users.values():
            if u['username'] == username and u['role'] == role:
                user = u
                break

        if not (user and user['password'] == password):
            pesan_gagal = 'Username, password, atau role salah!'
            # Tetap simpan flash error seperti semula -- kalau frontend nanti
            # navigasi ulang/reload ke /login (baik lewat AJAX maupun submit
            # form biasa untuk browser yang JS-nya nonaktif), pesan ini tetap
            # muncul di halaman login.
            flash(pesan_gagal, 'error')
            if is_ajax:
                return jsonify(success=False, message=pesan_gagal)
            return redirect(url_for('login'))

        # Master Device / approval device dihilangkan dulu -- login sekarang
        # langsung jalan begitu username/password/role cocok, tanpa perlu
        # persetujuan dari perangkat lain.
        return _finish_login(user, is_ajax)


def _finish_login(user, is_ajax=False):
    """Set session login."""
    session['user'] = {
        'nama': user.get('fullname', user['username']),
        'username': user['username'],
        'role': user['role']
    }
    tujuan = url_for('dashboard')
    if is_ajax:
        return jsonify(success=True, redirect=tujuan)
    return redirect(tujuan)
 
 
# ----------------------------------------------------
# ROUTE REGISTER / BUAT AKUN BARU
# ----------------------------------------------------
@app.route('/register', methods=['GET', 'POST'])
@app.route('/buat_akun_baru.html', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        role = request.form.get('role')
        fullname = request.form.get('fullname')
        identity_number = request.form.get('identity_number')
        username = request.form.get('username')
        password = request.form.get('password')
        email = request.form.get('email', f"{username}@sekolah.sch.id")
 
        if username in users:
            flash('Username sudah digunakan, silakan pilih username lain!', 'error')
            return redirect(url_for('register'))
 
        normalized_role = role.lower()
        if 'guru' in normalized_role:
            normalized_role = 'guru'
        elif 'siswa' in normalized_role:
            normalized_role = 'siswa'
        elif 'staf' in normalized_role:
            normalized_role = 'staf_kebersihan'
 
        users[username] = {
            'username': username,
            'password': password,
            'role': normalized_role,
            'email': email,
            'fullname': fullname,
            'identity_number': identity_number,
            'border_aktif': 'starter_pemula' if normalized_role == 'siswa' else None,
            # Foto profil siswa baru otomatis pakai foto default (lihat
            # FOTO_PROFIL_DEFAULT) sampai dia ganti sendiri lewat
            # updateProfilePhoto() -> /api/profil/foto.
            'foto_profil': FOTO_PROFIL_DEFAULT if normalized_role == 'siswa' else None
        }
        _simpan_users_store()
 
        flash('Akun berhasil dibuat! Silakan masuk dengan akun baru Anda.', 'success')
        return redirect(url_for('login'))
 
    return render_template('buat_akun_baru.html')
 
# ----------------------------------------------------
# ROUTE LUPA PASSWORD
# ----------------------------------------------------
@app.route('/lupa_password', methods=['GET', 'POST'])
@app.route('/lupa_password.html', methods=['GET', 'POST'])
def lupa_password():
    if request.method == 'POST':
        role = request.form.get('role')
        username = request.form.get('username')
        email = request.form.get('email')
 
        user_found = False
        for u in users.values():
            if u['username'] == username and u['role'] == role:
                user_found = True
                break
 
        if user_found:
            flash(f'Link reset password berhasil dikirim ke email {email}. Silakan cek kotak masuk Anda!', 'success')
        else:
            flash('Kombinasi Role dan Username tidak cocok!', 'error')
 
        return redirect(url_for('lupa_password'))
 
    return render_template('lupa_password.html')
 
 
def _find_user_by_role_username(role, username):
    for u in users.values():
        if u['username'] == username and u['role'] == role:
            return u
    return None
 
 
# ----------------------------------------------------
# API: KIRIM / KIRIM ULANG KODE OTP
# ----------------------------------------------------
@app.route('/api/forgot-password/send-otp', methods=['POST'])
def api_forgot_password_send_otp():
    data = request.get_json(silent=True) or {}
    role = (data.get('role') or '').strip()
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
 
    if not role or not username or not email:
        return jsonify(success=False, message='Semua field wajib diisi.'), 400
 
    user = _find_user_by_role_username(role, username)
    if not user:
        return jsonify(success=False, message='Kombinasi Role dan Username tidak ditemukan.'), 404
 
    if user['email'].strip().lower() != email:
        return jsonify(success=False, message='Email tidak sesuai dengan yang terdaftar pada akun ini.'), 400
 
    now = datetime.utcnow()
    existing = otp_store.get(username)
 
    # Batasi kirim ulang supaya tidak spam
    if existing and existing.get('last_sent_at'):
        elapsed = (now - existing['last_sent_at']).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
            remaining = int(OTP_RESEND_COOLDOWN_SECONDS - elapsed)
            return jsonify(
                success=False,
                message=f'Mohon tunggu {remaining} detik sebelum meminta kode baru.',
                cooldown=remaining
            ), 429
 
    otp = generate_otp()
    otp_store[username] = {
        'otp': otp,
        'role': role,
        'email': user['email'],
        'expires_at': now + timedelta(minutes=OTP_EXPIRY_MINUTES),
        'attempts': 0,
        'verified': False,
        'reset_token': None,
        'reset_token_expires_at': None,
        'last_sent_at': now,
    }
 
    send_otp_email(user['email'], otp, user.get('fullname', username))
 
    return jsonify(
        success=True,
        message=f"Kode OTP telah dikirim ke {mask_email(user['email'])}.",
        masked_email=mask_email(user['email']),
        expires_in_seconds=OTP_EXPIRY_MINUTES * 60,
        resend_cooldown_seconds=OTP_RESEND_COOLDOWN_SECONDS,
    )
 
 
# ----------------------------------------------------
# API: VERIFIKASI KODE OTP
# ----------------------------------------------------
@app.route('/api/forgot-password/verify-otp', methods=['POST'])
def api_forgot_password_verify_otp():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    otp_input = (data.get('otp') or '').strip()
 
    if not username or not otp_input:
        return jsonify(success=False, message='Kode OTP wajib diisi.'), 400
 
    entry = otp_store.get(username)
    if not entry:
        return jsonify(success=False, message='Sesi OTP tidak ditemukan. Silakan minta kode baru.'), 400
 
    now = datetime.utcnow()
 
    if now > entry['expires_at']:
        del otp_store[username]
        return jsonify(success=False, message='Kode OTP sudah kedaluwarsa. Silakan minta kode baru.'), 400
 
    if entry['attempts'] >= OTP_MAX_ATTEMPTS:
        del otp_store[username]
        return jsonify(success=False, message='Terlalu banyak percobaan salah. Silakan minta kode baru.'), 429
 
    if otp_input != entry['otp']:
        entry['attempts'] += 1
        sisa = OTP_MAX_ATTEMPTS - entry['attempts']
        if sisa <= 0:
            del otp_store[username]
            return jsonify(success=False, message='Terlalu banyak percobaan salah. Silakan minta kode baru.'), 429
        return jsonify(success=False, message=f'Kode OTP salah. Sisa percobaan: {sisa}.'), 400
 
    # OTP benar
    entry['verified'] = True
    entry['attempts'] = 0
    reset_token = uuid.uuid4().hex
    entry['reset_token'] = reset_token
    entry['reset_token_expires_at'] = now + timedelta(minutes=RESET_TOKEN_EXPIRY_MINUTES)
 
    return jsonify(success=True, message='Verifikasi OTP berhasil.', reset_token=reset_token)
 
 
# ----------------------------------------------------
# API: SET PASSWORD BARU (SETELAH OTP TERVERIFIKASI)
# ----------------------------------------------------
@app.route('/api/forgot-password/reset-password', methods=['POST'])
def api_forgot_password_reset_password():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    reset_token = (data.get('reset_token') or '').strip()
    new_password = data.get('new_password') or ''
    confirm_password = data.get('confirm_password') or ''
 
    entry = otp_store.get(username)
    if not entry or not entry.get('verified'):
        return jsonify(success=False, message='Verifikasi OTP diperlukan sebelum mengganti password.'), 400
 
    now = datetime.utcnow()
    if (not entry.get('reset_token')
            or reset_token != entry['reset_token']
            or not entry.get('reset_token_expires_at')
            or now > entry['reset_token_expires_at']):
        del otp_store[username]
        return jsonify(success=False, message='Sesi reset password tidak valid atau sudah kedaluwarsa. Ulangi dari awal.'), 400
 
    if len(new_password) < 6:
        return jsonify(success=False, message='Password baru minimal 6 karakter.'), 400
 
    if new_password != confirm_password:
        return jsonify(success=False, message='Konfirmasi password tidak sama dengan password baru.'), 400
 
    user = users.get(username)
    if not user:
        del otp_store[username]
        return jsonify(success=False, message='Akun tidak ditemukan.'), 404
 
    user['password'] = new_password
    del otp_store[username]
 
    return jsonify(success=True, message='Password berhasil diubah. Silakan masuk dengan password baru Anda.')
 
# ----------------------------------------------------
# API: QUIZ & LEADERBOARD (per akun + gabungan semua siswa)
# ----------------------------------------------------
 
def _cek_sesi_masih_cocok(expected_username):
    """Cegah bug 'kesave ke akun yang salah': Flask cuma punya SATU cookie
    session per browser. Kalau di browser yang sama sempat login akun LAIN
    (mis. tab dashboard Ahmad masih kebuka, terus di tab lain login sebagai
    Syam), cookie session browser itu ikut berubah jadi milik akun yang
    login belakangan -- padahal tab dashboard yang lama masih nampilin
    nama akun sebelumnya. Tanpa pengecekan ini, quiz yang "keliatannya"
    diselesaikan si A bisa kesimpen ke akun B di server.
    expected_username dikirim dari halaman yang sudah ter-render (jadi
    merekam akun siapa yang SEHARUSNYA sedang dipakai), dibandingkan
    dengan session AKTUAL saat request ini masuk.
    """
    if 'user' not in session:
        return False, jsonify(success=False, message='Belum login.'), 401
    if expected_username and expected_username != session['user']['username']:
        return False, jsonify(
            success=False,
            message='Sesi login sudah berubah (kemungkinan akun lain login di tab/perangkat yang sama pada browser ini). Muat ulang halaman ini dan login ulang sebelum lanjut.',
            session_mismatch=True
        ), 409
    return True, None, None
 
 
def _kunci_slot_quiz(username, slot_id):
    """Bikin kunci penyimpanan di quiz_store untuk SATU 'slot' progres quiz.
 
    Kenapa perlu 'slot' (bukan langsung pakai username akun Flask)?
    Fitur "Akun Dummy (Profil Login)" di dashboard cuma ganti NAMA/tampilan
    di browser -- akun yang BENAR-BENAR login ke Flask (session) tetap 1
    akun yang sama. Kalau kunci penyimpanan cuma pakai username akun asli,
    maka 2 profil dummy yang dipakai gantian di akun asli yang sama akan
    SALING TIMPA di server (dummy B main -> nimpa slot dummy A), padahal di
    localStorage browser masing-masing dummy sudah punya "kotak" sendiri
    (dinamespace dari ID_SISWA_AKTIF). slot_id di sini adalah ID_SISWA_AKTIF
    yang dikirim dari client -- sama dengan username akun asli kalau memang
    tidak sedang "coba sebagai akun dummy", atau id profil dummy kalau
    sedang aktif. Hasilnya tiap profil (akun asli maupun tiap akun dummy)
    dapat slot server sendiri-sendiri, tapi tetap di balik 1 login Flask
    yang sudah divalidasi _cek_sesi_masih_cocok -- jadi bukan celah keamanan
    baru, cuma granularitas penyimpanan.
    """
    slot_id = (slot_id or '').strip() or username
    return f"{username}::{slot_id}"
 
 
@app.route('/api/quiz/load', methods=['GET'])
def api_quiz_load():
    """Ambil data quiz milik SLOT yang sedang aktif (akun asli, atau profil
    dummy yang sedang dipakai) di akun yang sedang login. Dipanggil saat
    dashboard siswa dibuka, supaya progress slot ini ikut nyambung walau
    dibuka dari perangkat/browser lain."""
    ok, err_resp, err_code = _cek_sesi_masih_cocok(request.args.get('expected_username'))
    if not ok:
        return err_resp, err_code
 
    jenis = request.args.get('jenis', 'pg')
    if jenis not in ('pg', 'essay'):
        return jsonify(success=False, message='Jenis quiz tidak valid.'), 400
 
    username = session['user']['username']
    kunci = _kunci_slot_quiz(username, request.args.get('slot_id'))
    blob = quiz_store.get(kunci, {}).get(jenis)
    return jsonify(success=True, data=blob)  # null kalau memang belum pernah main/simpan
 
 
@app.route('/api/quiz/save', methods=['POST'])
def api_quiz_save():
    """Simpan data quiz milik SLOT yang sedang aktif (lihat _kunci_slot_quiz)
    ke server. Dipanggil setiap kali skor/leaderboard lokal di-update
    (pengganti localStorage sebagai sumber utama, biar tersimpan per slot &
    bisa dibaca slot/akun lain lewat endpoint leaderboard-global di
    bawah)."""
    body = request.get_json(silent=True) or {}
 
    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code
 
    jenis = body.get('jenis')
    data = body.get('data')
    if jenis not in ('pg', 'essay') or not isinstance(data, dict):
        return jsonify(success=False, message='Data quiz tidak valid.'), 400
 
    username = session['user']['username']
    kunci = _kunci_slot_quiz(username, body.get('slot_id'))
    quiz_store.setdefault(kunci, {})[jenis] = data
    _simpan_quiz_store()
    return jsonify(success=True)
 
 
@app.route('/api/quiz/leaderboard-global', methods=['GET'])
def api_quiz_leaderboard_global():
    """Gabungkan entri leaderboard dari SEMUA akun siswa yang sudah pernah
    menyimpan data, supaya siswa manapun yang login bisa lihat peringkat
    siswa lain -- bukan cuma peringkat dirinya sendiri seperti sebelumnya."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
 
    jenis = request.args.get('jenis', 'pg')
    if jenis not in ('pg', 'essay'):
        return jsonify(success=False, message='Jenis quiz tidak valid.'), 400
 
    gabungan = {}  # kunci "nama||level" -> entri skor tertinggi
    for username, per_jenis in quiz_store.items():
        blob = per_jenis.get(jenis)
        if not blob:
            continue
        for entri in blob.get('leaderboard', []):
            kunci = f"{entri.get('nama')}||{entri.get('level')}"
            existing = gabungan.get(kunci)
            if not existing or (entri.get('skor', 0) > existing.get('skor', 0)):
                gabungan[kunci] = entri
 
    daftar = list(gabungan.values())
    return jsonify(success=True, leaderboard=daftar)


# ----------------------------------------------------
# API: PRESTASI SISWA -- endpoint SENDIRI, terpisah dari /api/quiz/... di
# atas (lihat catatan di prestasi_store). Dipanggil dari
# dashboard_siswa.html (savePrestasiData / muatPrestasiDariServer) supaya
# Leaderboard Prestasi (Journey Prestasi) ikut sinkron lintas akun &
# perangkat, sama seperti Leaderboard Quiz -- tanpa numpang/nimpa data di
# quiz_store.
# ----------------------------------------------------
@app.route('/api/prestasi/load', methods=['GET'])
def api_prestasi_load():
    """Ambil daftar pengajuan prestasi milik SATU kelas dari server.
    Dipanggil saat dashboard siswa dibuka, supaya prestasi yang diajukan/
    disetujui dari perangkat/browser lain (siswa lain di kelas yang sama,
    atau guru yang approve dari dashboard guru) ikut kebaca di sini."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    kelas = (request.args.get('kelas') or '').strip()
    if not kelas:
        return jsonify(success=False, message='Kelas tidak valid.'), 400

    daftar = prestasi_store.get(kelas, [])
    return jsonify(success=True, data=daftar)


@app.route('/api/prestasi/save', methods=['POST'])
def api_prestasi_save():
    """Simpan (timpa) seluruh daftar pengajuan prestasi milik SATU kelas
    ke server. Dipanggil setiap kali daftar lokal berubah (pengajuan baru,
    atau hasil gabungan dengan data server) -- pola full-list-overwrite
    ini sengaja sama dengan savePrestasiData() di client, yang memang
    selalu menulis ulang seluruh array tiap kali ada perubahan."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    kelas = (body.get('kelas') or '').strip()
    data = body.get('data')
    if not kelas or not isinstance(data, list):
        return jsonify(success=False, message='Data prestasi tidak valid.'), 400

    prestasi_store[kelas] = data
    _simpan_prestasi_store()
    return jsonify(success=True)


# ----------------------------------------------------
# API: KOTAK SARAN -- endpoint SENDIRI, terpisah dari /api/prestasi/... &
# /api/quiz/... di atas (lihat catatan di saran_store). Dipanggil dari
# dashboard_siswa.html (kirimSaranSiswa / sinkronkanSaranDenganServer)
# supaya saran yang masuk tersimpan di server (bukan cuma localStorage 1
# browser) dan bisa dibaca Admin/Developer (Ahmad Fakhri Al Farisi) dari
# perangkat manapun (HP maupun laptop).
# ----------------------------------------------------
@app.route('/api/saran/kirim', methods=['POST'])
def api_saran_kirim():
    """Simpan SATU saran baru ke server. Endpoint ini SENGAJA terbuka untuk
    siapapun yang sedang login (bukan cuma Admin/Dev) -- karena yang perlu
    MENGIRIM saran adalah siswa biasa, sedangkan yang perlu MELIHAT daftar
    saran (lihat api_saran_list di bawah) memang cuma Admin/Dev."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    data = body.get('data')
    if not isinstance(data, dict) or not (data.get('saran') or '').strip():
        return jsonify(success=False, message='Data saran tidak valid.'), 400

    # id dibuat ulang di server (bukan percaya begitu saja pada id kiriman
    # client) supaya tidak ada 2 saran beda pengirim kebetulan bentrok id --
    # format tetap sama (saran_<timestamp ms>) supaya urutan "terbaru di
    # atas" di dashboard tetap bisa dihitung dari id seperti pola prestasi.
    saran_baru = {
        'id': f"saran_{int(time.time() * 1000)}",
        'anonim': bool(data.get('anonim')),
        'nama': None if data.get('anonim') else data.get('nama'),
        'kelas': None if data.get('anonim') else data.get('kelas'),
        'saran': (data.get('saran') or '').strip(),
        'waktu': data.get('waktu'),
    }
    saran_store.append(saran_baru)
    _simpan_saran_store()
    return jsonify(success=True, data=saran_baru)


@app.route('/api/saran/list', methods=['GET'])
def api_saran_list():
    """Ambil SELURUH daftar saran yang pernah masuk (lintas siswa/kelas/
    perangkat). HANYA boleh diakses Admin/Developer ASLI (Ahmad Fakhri Al
    Farisi) -- siswa lain yang mencoba akses endpoint ini langsung ditolak,
    sama persis pola proteksinya dengan endpoint kelola guru di bawah."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Tidak punya akses ke Kotak Saran.'), 403

    return jsonify(success=True, data=saran_store)


# ----------------------------------------------------
# API: CARI TEMAN (pencarian siswa, permintaan pertemanan, profil statistik)
# ----------------------------------------------------
@app.route('/api/teman/cari', methods=['GET'])
def api_teman_cari():
    """Cari siswa lain berdasarkan nama (dipakai search bar 'Cari Teman').
    Punya session sendiri per akun -- jadi akun Ahmad login di satu browser
    dan akun Syam login di browser/tab lain bisa saling temukan satu sama
    lain lewat data users[] yang sama di server."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    q = (request.args.get('q') or '').strip().lower()
    me = session['user']['username']
    if not q:
        return jsonify(success=True, hasil=[])
 
    hasil = []
    for u in users.values():
        if u['role'] != 'siswa' or u['username'] == me:
            continue
        if q in u['fullname'].lower():
            hasil.append({
                'username': u['username'],
                'nama': u['fullname'],
                'kelas': u.get('kelas', '-'),
                'status': _status_pertemanan(me, u['username']),
                'border': u.get('border_aktif') or 'starter_pemula',
                # Foto profil siswa itu: kalau dia sudah pernah ganti foto sendiri
                # lewat /api/profil/foto, itu yang dipakai (TIDAK PERNAH ditimpa
                # di sini). Kalau belum pernah ganti sama sekali, otomatis fallback
                # ke foto_profil_default.jpg (lihat FOTO_PROFIL_DEFAULT di atas).
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
    return jsonify(success=True, hasil=hasil)
 
 
@app.route('/api/kelas/roster', methods=['GET'])
def api_kelas_roster():
    """Daftar siswa di satu kelas beserta border yang sedang mereka pakai --
    dipakai 'Denah Kelas' di Dashboard Guru supaya avatar tiap murid sinkron
    sama border aslinya (dari /api/profil/border), bukan data acak/dummy."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
 
    kelas = (request.args.get('kelas') or '').strip()
    if not kelas:
        return jsonify(success=False, message='Parameter kelas kosong.'), 400
 
    hasil = []
    for u in users.values():
        if u['role'] == 'siswa' and u.get('kelas') == kelas:
            border_terpasang = u.get('border_aktif') or 'starter_pemula'
            # Sanitasi tambahan (jaga-jaga ada data lama sebelum validasi di
            # /api/profil/border ditambahkan): kalau bukan akun dev asli tapi
            # somehow border_aktif-nya 'admin_dev', jangan ikut ditampilkan
            # sebagai admin ke Dashboard Guru -- turunkan ke starter.
            if border_terpasang == BORDER_ID_ADMIN and u['username'] != USERNAME_ADMIN_DEV:
                border_terpasang = 'starter_pemula'
            hasil.append({
                'username': u['username'],
                'nama': u['fullname'],
                'border': border_terpasang,
                # Foto profil asli tiap siswa -- supaya avatar di Denah Kelas &
                # Tabel Siswa Dashboard Guru sinkron ke foto yang BENERAN dipakai
                # orangnya (bukan cuma akun yang sedang login di browser guru ini).
                # Siswa yang belum pernah ganti foto sendiri otomatis fallback ke
                # foto_profil_default.jpg -- foto siswa yang SUDAH diganti tidak
                # pernah ditimpa di sini.
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
    return jsonify(success=True, siswa=hasil)
 
 
@app.route('/api/profil/border', methods=['POST'])
def api_profil_border():
    """Simpan id border yang sedang dipakai siswa ini ke server (bukan cuma
    localStorage), supaya siswa LAIN yang lihat lewat 'Cari Teman' bisa
    kelihatan foto profil (border) yang sedang beneran dipakai orangnya --
    bukan cuma placeholder generic. Cukup simpan id string-nya saja; daftar
    lengkap border (nama, minPoin, file gambar) tetap didefinisikan di
    frontend (DAFTAR_BORDER_* di dashboard_siswa.html), backend gak perlu
    tahu detail itu."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    data = request.get_json(silent=True) or {}
    border_id = (data.get('id') or '').strip()
    if not border_id:
        return jsonify(success=False, message='ID border kosong.'), 400
 
    me = session['user']['username']
 
    # PENTING: border admin/dev cuma boleh dipasang oleh akun DEV asli
    # (AHMAD FAKHRI AL FARISI / username 'siswa'). Dicek di server, bukan
    # cuma di frontend, supaya tidak bisa ditembus dengan mengirim request
    # langsung ke endpoint ini mengatasnamakan siswa lain.
    if border_id == BORDER_ID_ADMIN and me != USERNAME_ADMIN_DEV:
        return jsonify(success=False, message='Border ini khusus akun Admin/Developer.'), 403
 
    if me in users:
        users[me]['border_aktif'] = border_id
        _simpan_users_store()
    return jsonify(success=True)


# ----------------------------------------------------
# API: KELOLA DAFTAR GURU (menu "Daftar Guru")
# ----------------------------------------------------
@app.route('/api/guru/list', methods=['GET'])
def api_guru_list():
    """Ambil daftar guru terbaru -- dibaca siapapun yang sudah login
    (siswa/guru/staf), supaya menu 'Daftar Guru' semua orang selalu sinkron
    dengan hasil kelola admin, bukan lagi hardcode statis per file HTML."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
    return jsonify(success=True, guru=daftar_guru)


@app.route('/api/guru/tambah', methods=['POST'])
def api_guru_tambah():
    """Tambah data guru baru -- KHUSUS akun Admin/Developer asli. Dicek di
    server (bukan cuma disembunyikan di UI) supaya tidak bisa ditembus lewat
    request langsung ke endpoint ini mengatasnamakan akun lain."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Khusus akun Admin/Developer yang boleh mengelola daftar guru.'), 403

    data = request.get_json(silent=True) or {}
    nama = (data.get('nama') or '').strip()
    if not nama:
        return jsonify(success=False, message='Nama guru wajib diisi.'), 400

    id_baru = max((g['id'] for g in daftar_guru), default=-1) + 1
    guru_baru = {
        'id': id_baru,
        'nama': nama,
        'lulusan': (data.get('lulusan') or '').strip(),
        'mapel': (data.get('mapel') or '').strip(),
        'kelas': (data.get('kelas') or '').strip(),
        'tingkat': (data.get('tingkat') or '').strip(),
        'jurusan': (data.get('jurusan') or '').strip(),
        'foto': (data.get('foto') or '').strip(),
    }
    daftar_guru.append(guru_baru)
    _simpan_daftar_guru()
    return jsonify(success=True, guru=guru_baru)


@app.route('/api/guru/edit/<int:id_guru>', methods=['POST'])
def api_guru_edit(id_guru):
    """Ubah data guru yang sudah ada -- KHUSUS Admin/Developer, sama seperti
    /api/guru/tambah di atas."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Khusus akun Admin/Developer yang boleh mengelola daftar guru.'), 403

    target = next((g for g in daftar_guru if g['id'] == id_guru), None)
    if not target:
        return jsonify(success=False, message='Guru tidak ditemukan.'), 404

    data = request.get_json(silent=True) or {}
    nama = (data.get('nama') or '').strip()
    if not nama:
        return jsonify(success=False, message='Nama guru wajib diisi.'), 400

    for field in ('nama', 'lulusan', 'mapel', 'kelas', 'tingkat', 'jurusan', 'foto'):
        if field in data:
            target[field] = (data.get(field) or '').strip()

    _simpan_daftar_guru()
    return jsonify(success=True, guru=target)


@app.route('/api/guru/hapus/<int:id_guru>', methods=['POST'])
def api_guru_hapus(id_guru):
    """Hapus data guru -- KHUSUS Admin/Developer."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Khusus akun Admin/Developer yang boleh mengelola daftar guru.'), 403

    global daftar_guru
    sebelum = len(daftar_guru)
    daftar_guru = [g for g in daftar_guru if g['id'] != id_guru]
    if len(daftar_guru) == sebelum:
        return jsonify(success=False, message='Guru tidak ditemukan.'), 404

    _simpan_daftar_guru()
    return jsonify(success=True)


@app.route('/api/profil/sosmed', methods=['GET'])
def api_profil_sosmed_get():
    """Ambil sosial media milik akun sendiri yang sedang login, buat isi awal
    form modal 'Atur Sosial Media' di dashboard_siswa.html supaya siswa lihat
    lagi apa yang sudah pernah diisi sebelumnya, bukan form kosong melulu."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401

    me = session['user']['username']
    sosmed = users.get(me, {}).get('sosmed') or {}
    return jsonify(success=True, sosmed=sosmed)


@app.route('/api/profil/sosmed', methods=['POST'])
def api_profil_sosmed_post():
    """Simpan sosial media (IG, TikTok, dll) siswa ke server -- pola sama
    dengan /api/profil/foto & /api/profil/border di atas. Dipakai balik oleh
    renderSosmedIdCard() saat siswa LAIN membuka ID Card kita lewat
    'Cari Teman' (lihat /api/teman/profil/<username> di bawah)."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401

    data = request.get_json(silent=True) or {}
    sosmed_mentah = data.get('sosmed')
    if not isinstance(sosmed_mentah, dict):
        return jsonify(success=False, message='Format sosmed tidak valid.'), 400

    # Cuma simpan platform yang dikenal & yang isinya tidak kosong -- field
    # yang dikosongkan siswa di form otomatis hilang dari data tersimpan.
    sosmed_bersih = {}
    for platform, nilai in sosmed_mentah.items():
        if platform in PLATFORM_SOSMED_DIIZINKAN and isinstance(nilai, str) and nilai.strip():
            sosmed_bersih[platform] = nilai.strip()[:200]

    me = session['user']['username']
    if me in users:
        users[me]['sosmed'] = sosmed_bersih
        _simpan_users_store()
    return jsonify(success=True, sosmed=sosmed_bersih)


@app.route('/api/profil/foto', methods=['POST'])
def api_profil_foto():
    """Simpan foto profil (base64) siswa ke server -- pola sama persis dengan
    /api/profil/border di atas. Sebelumnya foto profil cuma tersimpan di
    localStorage browser sendiri, jadi siswa LAIN yang pakai 'Cari Teman'
    gak pernah lihat foto asli orangnya (cuma placeholder generik). Sekarang
    begitu siswa ganti foto (lihat updateProfilePhoto() di dashboard_siswa.html),
    foto barunya ikut dikirim & disimpan di sini supaya kelihatan di hasil
    pencarian & ID card teman."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    data = request.get_json(silent=True) or {}
    foto = (data.get('foto') or '').strip()
    if not foto:
        return jsonify(success=False, message='Foto kosong.'), 400
 
    me = session['user']['username']
    if me in users:
        users[me]['foto_profil'] = foto
        _simpan_users_store()
    return jsonify(success=True)
 
 
@app.route('/api/teman/relasi', methods=['GET'])
def api_teman_relasi():
    """Ambil daftar permintaan pertemanan yang MASUK ke akun ini + daftar
    teman yang sudah terkonfirmasi. Dipanggil buat isi dropdown lonceng
    'Permintaan Pertemanan' & badge angkanya."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    me = session['user']['username']
    masuk = []
    for r in friend_requests.get(me, []):
        u = users.get(r['from'])
        if u:
            masuk.append({
                'username': u['username'],
                'nama': u['fullname'],
                'kelas': u.get('kelas', '-'),
                # border & foto disertakan biar dropdown 'Permintaan Pertemanan'
                # bisa nampilin avatar+border+efek nama+title -- sama persis
                # polanya kayak /api/teman/cari di atas.
                'border': u.get('border_aktif') or 'starter_pemula',
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
 
    teman = []
    for uname in sorted(friendships.get(me, set())):
        u = users.get(uname)
        if u:
            teman.append({
                'username': u['username'],
                'nama': u['fullname'],
                'kelas': u.get('kelas', '-'),
                'border': u.get('border_aktif') or 'starter_pemula',
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
 
    return jsonify(success=True, permintaan_masuk=masuk, teman=teman)
 
 
@app.route('/api/teman/kirim', methods=['POST'])
def api_teman_kirim():
    """Kirim permintaan pertemanan ke siswa lain. Kalau ternyata siswa itu
    sudah LEBIH DULU ngirim permintaan ke kita, langsung dianggap saling
    setuju (auto jadi teman) daripada bikin 2 permintaan nyilang."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    me = session['user']['username']
    data = request.get_json(silent=True) or {}
    target = (data.get('to_username') or '').strip()
 
    if not target or target == me or target not in users or users[target]['role'] != 'siswa':
        return jsonify(success=False, message='Siswa tujuan tidak valid.'), 400
    if _apakah_berteman(me, target):
        return jsonify(success=False, message='Kalian sudah berteman.'), 400
    if _cari_request_pending(me, target):
        return jsonify(success=False, message='Permintaan pertemanan sudah pernah dikirim, tinggal tunggu direspon.'), 400
 
    if _cari_request_pending(target, me):
        # Dia sudah lebih dulu ngirim permintaan ke kita -> langsung berteman
        friend_requests[me] = [r for r in friend_requests.get(me, []) if r['from'] != target]
        _tambah_pertemanan(me, target)
        _simpan_friends_store()
        return jsonify(success=True, message='Kalian sekarang berteman!', status='berteman')
 
    friend_requests.setdefault(target, []).append({
        'from': me,
        'created_at': datetime.utcnow().isoformat()
    })
    _simpan_friends_store()
    return jsonify(success=True, message='Permintaan pertemanan terkirim.', status='menunggu_dikirim')
 
 
@app.route('/api/teman/tanggapi', methods=['POST'])
def api_teman_tanggapi():
    """Terima/tolak permintaan pertemanan yang masuk ke akun yang sedang login."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    me = session['user']['username']
    data = request.get_json(silent=True) or {}
    from_username = (data.get('from_username') or '').strip()
    aksi = data.get('aksi')
 
    if aksi not in ('terima', 'tolak'):
        return jsonify(success=False, message='Aksi tidak valid.'), 400
    if not _cari_request_pending(from_username, me):
        return jsonify(success=False, message='Permintaan pertemanan tidak ditemukan (mungkin sudah ditanggapi).'), 404
 
    friend_requests[me] = [r for r in friend_requests.get(me, []) if r['from'] != from_username]
    if aksi == 'terima':
        _tambah_pertemanan(me, from_username)
    _simpan_friends_store()
    return jsonify(success=True, status=_status_pertemanan(me, from_username))
 
 
@app.route('/api/teman/profil/<username>', methods=['GET'])
def api_teman_profil(username):
    """Data buat ID card statistik siswa yang muncul saat nama di hasil
    pencarian diklik: identitas, kelas, jumlah teman, dan skor quiz
    (diambil dari quiz_store, slot akun asli siswa itu -- lihat
    _kunci_slot_quiz)."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
 
    me = session['user']['username']
    u = users.get(username)
    if not u or u['role'] != 'siswa':
        return jsonify(success=False, message='Siswa tidak ditemukan.'), 404
 
    kunci_slot = f"{username}::{username}"
    blob_pg = quiz_store.get(kunci_slot, {}).get('pg') or _default_quiz_blob('pg')
    blob_essay = quiz_store.get(kunci_slot, {}).get('essay') or _default_quiz_blob('essay')
 
    return jsonify(success=True, profil={
        'username': u['username'],
        'nama': u['fullname'],
        'kelas': u.get('kelas', '-'),
        'jumlah_teman': len(friendships.get(username, set())),
        'quiz_pg_total_poin': blob_pg.get('totalPoin', 0),
        'quiz_pg_best_by_level': blob_pg.get('bestByLevel', {'easy': 0, 'medium': 0, 'hard': 0}),
        'quiz_essay_best_by_level': blob_essay.get('bestByLevel', {'easy': 0, 'medium': 0, 'hard': 0}),
        'status_pertemanan': _status_pertemanan(me, username),
        # Border & foto profil aslinya, dipetakan jadi border/efek nama/title
        # di sisi frontend (lihat renderIdCardTeman() -> getSemuaBorder()).
        # Foto: pakai punya siswa itu sendiri kalau sudah pernah diganti, kalau
        # belum otomatis fallback ke foto_profil_default.jpg -- tidak pernah
        # menimpa foto yang sudah diganti siswa yang bersangkutan.
        'border': u.get('border_aktif') or 'starter_pemula',
        'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT,
        # Sosial media yang diisi siswa itu sendiri lewat modal "Atur Sosial
        # Media" -> disimpan lewat /api/profil/sosmed di atas. Dipetakan jadi
        # ikon-ikon berwarna di kotak sosmed ID Card oleh renderSosmedIdCard()
        # di dashboard_siswa.html.
        'sosmed': u.get('sosmed') or {}
    })
 
 
# ----------------------------------------------------
# ROUTE ASISTEN AI (PROXY KE OLLAMA LOKAL)
# ----------------------------------------------------
@app.route('/api/ai/chat', methods=['POST'])
def api_ai_chat():
    """Terima pertanyaan dari widget 'AI Support' di dashboard, teruskan ke
    Ollama yang jalan lokal (lihat OLLAMA_URL/OLLAMA_MODEL di atas), lalu
    balikkan jawabannya ke browser. Kalau Ollama belum/tidak jalan, jangan
    bikin error di UI -- balikkan pesan yang jelas supaya frontend bisa
    fallback ke jawaban template lama (balasAISupport di JS)."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
 
    data = request.get_json(silent=True) or {}
    pesan = (data.get('pesan') or '').strip()
    if not pesan:
        return jsonify(success=False, message='Pesan kosong.'), 400
 
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                'model': OLLAMA_MODEL,
                'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT_AI_SUPPORT},
                    {'role': 'user', 'content': pesan}
                ],
                'stream': False
            },
            timeout=30
        )
        resp.raise_for_status()
        hasil = resp.json()
        balasan = (hasil.get('message') or {}).get('content', '').strip()
        if not balasan:
            return jsonify(success=False, message='Ollama tidak mengembalikan jawaban.'), 502
        return jsonify(success=True, balasan=balasan)
    except requests.exceptions.ConnectionError:
        return jsonify(success=False, message='Ollama belum aktif di server (jalankan "ollama serve").'), 503
    except requests.exceptions.Timeout:
        return jsonify(success=False, message='Ollama terlalu lama merespons.'), 504
    except Exception:
        return jsonify(success=False, message='Terjadi kendala saat menghubungi asisten AI.'), 500
 
 
# ----------------------------------------------------
# ROUTE DAFTAR GURU
# ----------------------------------------------------
@app.route('/guru')
@app.route('/daftar_guru.html')
def halaman_daftar_guru():
    if 'user' not in session:
        return redirect(url_for('login'))
    return render_template('daftar_guru.html', username=session['user']['nama'])
 
# ----------------------------------------------------
# ROUTE DASHBOARD (PENGARAH BERDASARKAN ROLE)
# ----------------------------------------------------
@app.route('/dashboard')
def dashboard():
    if 'user' not in session:
        return redirect(url_for('login'))
 
    role = session['user']['role']
    if role == 'siswa':
        return redirect(url_for('dashboard_siswa'))
    elif role == 'guru':
        return redirect(url_for('dashboard_guru'))
    elif role in ['staf_kebersihan', 'staf']:
        return redirect(url_for('dashboard_staf'))
    else:
        flash('Role pengguna tidak dikenali!', 'error')
        return redirect(url_for('login'))
 
# ----------------------------------------------------
# DASHBOARD SPECIFIC TO ROLES
# ----------------------------------------------------
@app.route('/dashboard/siswa')
def dashboard_siswa():
    if 'user' not in session or session['user']['role'] != 'siswa':
        return redirect(url_for('login'))
    # Foto profil siswa yang login: ambil dari data users (kalau siswa ini
    # sudah pernah ganti foto, ini sudah foto barunya -- lihat
    # /api/profil/foto). Kalau field-nya belum ada sama sekali (mis. akun
    # lama sebelum fitur ini ditambahkan), fallback ke FOTO_PROFIL_DEFAULT
    # supaya tidak pernah kosong.
    u = users.get(session['user']['username'], {})
    foto_profil = u.get('foto_profil') or FOTO_PROFIL_DEFAULT
    return render_template(
        'dashboard_siswa.html',
        username=session['user']['nama'],
        nama=session['user']['nama'],
        login_username=session['user']['username'],
        foto_profil=foto_profil
    )
 
@app.route('/dashboard/guru')
def dashboard_guru():
    if 'user' not in session or session['user']['role'] != 'guru':
        return redirect(url_for('login'))
    return render_template('dashboard_guru.html', username=session['user']['nama'])
 
@app.route('/dashboard/staf')
def dashboard_staf():
    if 'user' not in session or session['user']['role'] not in ['staf_kebersihan', 'staf']:
        return redirect(url_for('login'))
    return render_template('dashboard_staf.html', username=session['user']['nama'])
 
# ----------------------------------------------------
# ROUTE LOGOUT
# ----------------------------------------------------
@app.route('/logout')
def logout():
    session.pop('user', None)
    flash('Anda telah keluar dari sistem.', 'success')
    return redirect(url_for('login'))
 
# ----------------------------------------------------
# ROUTE PWA & MANIFEST SUPPORT
# ----------------------------------------------------
@app.route('/manifest.json')
def manifest():
    """Mengalirkan file manifest.json dari folder public ke URL utama /manifest.json"""
    return send_from_directory(os.path.join(app.root_path, 'public'), 'manifest.json', mimetype='application/json')
 
@app.route('/pwabuilder-sw.js')
@app.route('/sw.js')
def service_worker():
    """Mengalirkan file Service Worker dari folder public agar PWA berjalan offline/PWABuilder mengenali SW."""
    return send_from_directory(os.path.join(app.root_path, 'public'), 'sw.js', mimetype='application/javascript')
 
 
# ----------------------------------------------------
# RUN APP
# ----------------------------------------------------
if __name__ == '__main__':
    # threaded=True: penting supaya server bisa proses BEBERAPA request
    # sekaligus (mis. beberapa siswa main quiz bersamaan, atau beberapa
    # request /api/quiz/save menumpuk cepat saat main level Hard yang
    # waktunya singkat). Tanpa ini, Flask dev server default cuma proses
    # 1 request pada satu waktu -- kalau ada 1 request yang lambat/nyangkut,
    # SEMUA request lain (termasuk dari siswa lain) ikut antre "pending"
    # sampai request pertama itu selesai, walau sebenarnya tidak ada error.
    app.run(debug=True, threaded=True)