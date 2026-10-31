import uuid
import os
import re
import json
import random
import secrets
import string
import smtplib
import ssl
import time
import threading
import base64
import binascii
import tempfile
from collections import defaultdict, deque
from functools import wraps
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, flash, session, make_response, jsonify, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from flask.sessions import SecureCookieSessionInterface
 
# Muat variabel dari file .env jika tersedia (opsional, untuk kemudahan development).
# Kalau python-dotenv belum terinstall / file .env tidak ada, baris ini aman diabaikan.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
 
import requests

# Helper kompresi gambar upload (WebP) -- lihat catatan lengkap kenapa
# terpusat & kenapa foto prestasi/bukti pelanggaran SENGAJA tidak lewat
# sini di komentar dalam image_compress.py.
from image_compress import kompres_gambar_base64, GambarTidakValid

# Mesin Speech-to-Text LOKAL (offline, tanpa API cloud) untuk transkrip
# Voice Note tugas guru. Lihat komentar lengkap di stt_engine.py kenapa
# harus offline (batasan akses internet keluar di hosting PythonAnywhere).
from stt_engine import transkrip_audio_file

# Batas resolusi (sisi terpanjang, px) & quality WebP per jenis foto.
# Foto profil paling kecil (cuma avatar bulat kecil di UI), foto
# tugas/soal paling besar (siswa/guru perlu baca detail tulisan di foto).
PROFIL_FOTO_MAX_DIM = 1000
PROFIL_FOTO_QUALITY = 80
TUGAS_FOTO_MAX_DIM = 2000
TUGAS_FOTO_QUALITY = 85
 
app = Flask(__name__)

# Kompresi gzip/brotli otomatis untuk respons teks (HTML/CSS/JS/JSON).
# Halaman login ~150 KB bisa turun jadi ~30 KB di jaringan -> hemat kuota
# siswa/guru. OPSIONAL: kalau paket belum terinstall, aplikasi tetap jalan
# normal tanpa kompresi (install dengan: pip install flask-compress).
try:
    from flask_compress import Compress
    Compress(app)
except ImportError:
    print("[INFO] flask-compress belum terinstall -- respons dikirim tanpa kompresi "
          "(pip install flask-compress untuk menghemat kuota).")
# Key rahasia untuk menangani session dan flash message
# KEAMANAN: secret key WAJIB dari environment (.env / konfigurasi hosting),
# JANGAN ditulis di kode. Buat dengan:
#   python -c "import secrets; print(secrets.token_hex(32))"
# lalu isi SECRET_KEY=... di .env. Mengganti key = semua user login ulang sekali.
app.secret_key = os.environ.get('SECRET_KEY')
if not app.secret_key:
    raise RuntimeError('SECRET_KEY belum diset. Tambahkan SECRET_KEY=<string acak panjang> di file .env / environment hosting.')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# Set COOKIE_SECURE=1 di server HTTPS (PythonAnywhere). Biarkan kosong di laptop (http).
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('COOKIE_SECURE', '0') == '1'
# PERBAIKAN BUG "Belum login sebagai guru" saat klik Batalkan/Kasih Pelanggaran:
# sebelumnya session TIDAK PERNAH di-set permanent (lihat _finish_login), jadi
# Flask memakai session cookie non-permanent yang browser boleh buang kapan
# saja dianggap perlu (bukan cuma saat browser benar-benar ditutup) --
# akibatnya guru yang jendela "Rekap Pengumpulan Tugas"-nya dibiarkan terbuka
# lumayan lama bisa tiba-tiba kehilangan session di tengah jalan, lalu setiap
# aksi guru (kasih/batalkan pelanggaran, dst) ditolak 401 padahal tadinya
# sudah login benar. Sekarang session dibuat permanent (lihat
# session.permanent = True di _finish_login) dengan umur eksplisit yang
# cukup panjang untuk satu hari kerja penuh di sekolah.
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)

# ----------------------------------------------------
# BLUEPRINT GEMINI (folder api/ + services/)
# ----------------------------------------------------
# Endpoint /api/gemini/test dan /api/gemini/chat ada di api/gemini_routes.py,
# logic pemanggilan ke Google Gemini ada di services/gemini_service.py.
# API key diambil dari GEMINI_API_KEY di file .env.
from api.gemini_routes import gemini_bp, set_quiz_context_provider, set_maintenance_context_provider, set_admin_checker_provider
app.register_blueprint(gemini_bp)

# Blueprint SCORUS AI (asisten AI guru, OpenAI) -- endpoint POST /api/scorus-ai/chat
# Key dari OPENAI_API_KEY di file .env (dibaca saat ada request, bukan di sini).
from api.scorus_ai_routes import scorus_ai_bp
app.register_blueprint(scorus_ai_bp)

# Riwayat chat multi-sesi SCORUS AI (khusus guru) -- /api/scorus/conversations & /api/scorus/chat.
# Memanggil jalankan_scorus_ai() dari scorus_ai_routes, jadi cache/quota/usage log tetap yang lama.
# Database: SQLite data/scorus_history.db (otomatis dibuat), atau SCORUS_DB_URL di .env.
from api.scorus_history_routes import scorus_history_bp
app.register_blueprint(scorus_history_bp)

# LILY melihat foto profil guru (vision, lewat server) -- POST /api/lily/foto. Key: OPENAI_API_KEY di .env.
# Matikan dengan LILY_FOTO_AI=0 di .env (browser otomatis memakai kalimat lokal).
from api.lily_foto_routes import lily_foto_bp
app.register_blueprint(lily_foto_bp)

# LILY DOCX Generator (khusus guru): prompt -> pilihan struktur A/B/Custom -> file .docx -- /api/lily/docx/*.
# Key dari OPENAI_API_KEY di .env (dibaca saat request). Matikan dengan LILY_DOCX_AI=0 di .env.
from api.lily_docx_routes import lily_docx_bp
app.register_blueprint(lily_docx_bp)

# ----------------------------------------------------
# CACHE-CONTROL UNTUK HALAMAN LOGIN & DASHBOARD (anti bfcache "nyangkut")
# ----------------------------------------------------
# Lapisan tambahan (di luar fix pageshow/bfcache di login.html): kasih tahu
# browser supaya TIDAK menyimpan halaman login & dashboard ini di cache HTTP
# biasa maupun di back-forward cache. Ini jaga-jaga kalau ada browser lain
# (selain yang sudah ditest di login.html) yang bfcache-nya tetap mengabaikan
# event pageshow, dan juga supaya klik tombol Back setelah LOGOUT tidak
# menampilkan dashboard versi lama yang sempat ke-cache browser.
HALAMAN_TANPA_CACHE = ('login', 'dashboard', 'dashboard_siswa', 'dashboard_guru', 'dashboard_staf', 'lupa_password')

@app.after_request
def _cegah_cache_halaman_sensitif(response):
    if request.endpoint in HALAMAN_TANPA_CACHE:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    return response

# ----------------------------------------------------
# HEADER KEAMANAN + PROTEKSI CSRF (CEK ORIGIN / REFERER)
# ----------------------------------------------------
# Tanpa dependency tambahan. Setiap request yang MENGUBAH data (POST/PUT/
# PATCH/DELETE) wajib berasal dari situs ini sendiri: browser selalu
# menyertakan header Origin (atau Referer) pada request lintas-situs, jadi
# form palsu di situs lain yang mencoba "membajak" sesi login user ditolak.
# Kalau situs dipasang di belakang domain/proxy lain, daftarkan origin
# tambahan di .env:  ALLOWED_ORIGINS=https://domain-kamu.com,https://www.domain-kamu.com
from urllib.parse import urlparse as _urlparse

_ORIGIN_TAMBAHAN = {
    o.strip().lower().rstrip('/')
    for o in (os.environ.get('ALLOWED_ORIGINS') or '').split(',') if o.strip()
}

@app.before_request
def _tolak_request_lintas_situs():
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return None
    sumber = request.headers.get('Origin') or request.headers.get('Referer')
    if not sumber:
        return None  # klien non-browser (curl dsb) -- bukan vektor CSRF
    try:
        p = _urlparse(sumber)
        origin = f"{p.scheme}://{p.netloc}".lower()
        netloc = p.netloc.lower()
    except Exception:
        netloc, origin = '', ''
    if netloc and netloc == request.host.lower():
        return None
    if origin in _ORIGIN_TAMBAHAN:
        return None
    print(f"[SECURITY] request lintas-situs ditolak: {request.method} {request.path} dari {_ambil_ip_client()}")
    if request.path.startswith('/api/') or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify(success=False, message='Permintaan ditolak (asal tidak valid).'), 403
    return ('Permintaan ditolak (asal tidak valid).', 403)

@app.after_request
def _header_keamanan(response):
    h = response.headers
    h.setdefault('X-Content-Type-Options', 'nosniff')
    # SAMEORIGIN (bukan DENY): login.html memuat lupa_password.html lewat
    # iframe di domain yang sama. Situs LAIN tetap tidak bisa membingkai.
    h.setdefault('X-Frame-Options', 'SAMEORIGIN')
    h.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    h.setdefault('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
    if app.config.get('SESSION_COOKIE_SECURE'):
        h.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return response

# Asset statis (CSS/JS/gambar di folder /static) boleh di-cache lumayan lama
# oleh browser -- tidak sensitif seperti halaman dashboard di atas, dan ini
# yang paling gampang "gratis" menghemat request ke hosting yang resource-nya
# terbatas (browser tidak perlu minta ulang file yang sama tiap kunjungan).
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 60 * 60 * 24 * 7  # 7 hari

# ----------------------------------------------------
# RATE LIMITING SEDERHANA PER-IP (TANPA DEPENDENCY TAMBAHAN)
# ----------------------------------------------------
# Sengaja custom (bukan pakai library seperti flask-limiter) supaya tidak
# perlu tambahan instalasi paket di hosting gratis yang resource-nya
# terbatas. Implementasinya sliding-window sederhana pakai in-memory deque
# per kunci -- cukup untuk skala pengguna sekolah ini (puluhan akun),
# TIDAK dirancang untuk trafik besar/multi-proses (kalau nanti pakai
# banyak worker/proses, jatah ini akan kesebar per proses, bukan global).
#
# Kunci pembatas = IP + username yang sedang login (kalau ada). Ini penting
# supaya banyak siswa yang kebetulan berbagi 1 IP publik yang sama (mis.
# WiFi sekolah/warnet) TIDAK ikut kena blokir massal gara-gara 1 akun lain
# di jaringan yang sama kena limit -- tiap akun yang sudah login tetap
# dapat jatah sendiri-sendiri. Untuk request yang BELUM login (mis. mencoba
# login/reset password), kunci tetap murni per-IP karena memang di situ
# titik anti brute-force-nya.
_rate_limit_lock = threading.Lock()
_rate_limit_hits = defaultdict(deque)  # kunci -> deque[timestamp request]

# (maks_request, jendela_detik) per kategori endpoint -- angka awal sesuai
# yang diminta, silakan disesuaikan lagi kalau ternyata masih kurang pas.
#
# PERBAIKAN BUG "status kumpul & rekap tugas hilang/balik ke 0 setelah hard
# refresh": angka lama (terutama 'burst': 20 request/10 detik) ternyata
# KETERLALU KETAT untuk 1x buka/refresh Dashboard Guru. Satu refresh itu
# sendiri langsung memicu BANYAK request paralel (Promise.all) sekaligus:
# muatCacheTugasSemuaKelas (sync/bulk), muatPelanggaranAktifDariServer,
# lalu hitungDanTampilkanPerluDinilai() yang manggil ambilSubmisiTugasServer
# (/api/tugas/submissions) DAN ambilHasilPeriksaBulkServer (/api/sync/bulk)
# untuk SETIAP tugas di SETIAP kelas yang punya murid asli -- belum lagi
# evaluasi/list, prestasi/load, guru/list, kelas/roster, dst. Total gampang
# tembus >20 request dalam hitungan detik pertama.
#
# Begitu 'burst' (dicek DULUAN sebelum kategori lain di batasi()) kena
# limit, server balas 429 -- tapi ambilSubmisiTugasServer() &
# ambilHasilPeriksaBulkServer() di dashboard_guru.js CUMA cek res.ok, kalau
# gagal langsung fallback ke `{}` (dianggap "belum ada yang kumpul/
# dinilai") TANPA membedakan "memang belum ada" vs "gagal ambil karena kena
# rate limit". Itulah kenapa status "Sudah Kumpul" yang sebelumnya sempat
# tampil bisa balik jadi "Belum Kumpul" & badge "Perlu Dinilai" tidak
# nambah tepat sesudah refresh -- padahal datanya di server tetap utuh,
# cuma GAGAL DIAMBIL. Angka di bawah dinaikkan supaya beban 1x refresh
# dashboard yang sah TIDAK ikut kena limit yang sebenarnya ditujukan untuk
# lonjakan tidak wajar (klik spam/loop bug).
BATAS_RATE_LIMIT = {
    'login':  (5, 60),     # login, register, kirim/verifikasi OTP
    'umum':   (60, 60),    # API umum (baca/tulis data ringan)
    'berat':  (120, 60),   # endpoint yang baca banyak data / komputasi berat -- dinaikkan dari 20 karena 1x buka Rekap/Dashboard Guru bisa memicu puluhan panggilan paralel yang sah (submisi + hasil periksa per tugas per kelas)
    'upload': (10, 60),    # upload foto/tugas
    'burst':  (60, 10),    # jaga-jaga lonjakan beruntun dalam waktu singkat -- dinaikkan dari 20 karena 1x hard refresh Dashboard Guru yang sah saja sudah bisa memicu puluhan request paralel sekaligus (lihat catatan besar di atas); lonjakan beruntun/bug loop yang BENERAN tidak wajar (ratusan request) tetap kena batasi
}


# Jumlah reverse proxy tepercaya di depan app (PythonAnywhere/Nginx = 1).
# Set TRUSTED_PROXY_HOPS=0 di laptop (tanpa proxy). Sama dengan gemini_routes.py.
_TRUSTED_PROXY_HOPS = max(0, int((os.environ.get('TRUSTED_PROXY_HOPS') or '1').strip() or '1'))


def _ambil_ip_client():
    # KEAMANAN: X-Forwarded-For diisi client, entri paling KIRI bisa dipalsukan
    # (bypass rate limit login). Proxy tepercaya menambah IP asli di ujung KANAN,
    # jadi ambil entri ke-N dari kanan (N = _TRUSTED_PROXY_HOPS).
    if _TRUSTED_PROXY_HOPS > 0:
        xff = request.headers.get('X-Forwarded-For', '')
        daftar = [i.strip() for i in xff.split(',') if i.strip()]
        if len(daftar) >= _TRUSTED_PROXY_HOPS:
            return daftar[-_TRUSTED_PROXY_HOPS]
    return request.remote_addr or 'unknown'


class _SessionInterfaceAmanHTTPS(SecureCookieSessionInterface):
    """Flag Secure pada cookie session otomatis ON kalau request datang lewat
    HTTPS (langsung atau lewat reverse proxy tepercaya yang mengirim
    X-Forwarded-Proto: https), tanpa harus ingat set COOKIE_SECURE=1.
    COOKIE_SECURE=1 tetap memaksa Secure selalu ON."""
    def get_cookie_secure(self, app):
        if app.config.get('SESSION_COOKIE_SECURE'):
            return True
        try:
            if request.is_secure:
                return True
            if _TRUSTED_PROXY_HOPS > 0:
                proto = request.headers.get('X-Forwarded-Proto', '').split(',')[-1].strip().lower()
                return proto == 'https'
        except RuntimeError:
            pass
        return False


app.session_interface = _SessionInterfaceAmanHTTPS()


def _kunci_rate_limit():
    ip = _ambil_ip_client()
    user = (session.get('user') or {}).get('username')
    return f"{ip}::{user}" if user else ip


def _cek_dan_catat_rate_limit(kategori):
    """True = masih boleh lanjut, False = sudah melebihi batas kategori ini."""
    maks_request, jendela = BATAS_RATE_LIMIT[kategori]
    kunci = f"{kategori}:{_kunci_rate_limit()}"
    sekarang = time.time()
    with _rate_limit_lock:
        antrian = _rate_limit_hits[kunci]
        while antrian and sekarang - antrian[0] > jendela:
            antrian.popleft()
        if len(antrian) >= maks_request:
            return False
        antrian.append(sekarang)
        return True


# ----------------------------------------------------
# PROTEKSI BRUTE-FORCE LOGIN PER AKUN (selain rate limit per-IP di atas)
# ----------------------------------------------------
# Dua lapis, dihitung dari percobaan login GAGAL dalam jendela 15 menit:
#   - per (IP + username): maks 5 gagal  -> IP itu diblok utk username itu
#   - per username (semua IP): maks 15 gagal -> akun dikunci sementara
# Dicek SEBELUM password diperiksa dan berlaku juga utk username yang tidak
# ada (responsnya identik), jadi tidak bisa dipakai menebak username valid.
# In-memory per proses, sama seperti rate limiter di atas.
_LOGIN_GAGAL_JENDELA = 15 * 60
_LOGIN_GAGAL_MAKS_IP_USER = 5
_LOGIN_GAGAL_MAKS_USER = 15
_login_gagal = defaultdict(deque)
_login_gagal_lock = threading.Lock()
# Hash tiruan: dipakai supaya waktu respons username-tidak-ada sama dengan
# username-ada (cegah user enumeration lewat selisih waktu).
_HASH_PALSU = generate_password_hash(secrets.token_hex(16))
PASSWORD_MAKS_PANJANG = 128


def _kunci_gagal_login(username):
    return (f"iu:{_ambil_ip_client()}:{username}", f"u:{username}")


def _bersihkan_gagal_login_locked(sekarang):
    if len(_login_gagal) < 5000:
        return
    for k in [k for k, d in _login_gagal.items() if not d or sekarang - d[-1] > _LOGIN_GAGAL_JENDELA]:
        del _login_gagal[k]


def _login_sedang_dikunci(username):
    sekarang = time.time()
    k_iu, k_u = _kunci_gagal_login(username)
    with _login_gagal_lock:
        hasil = []
        for k, maks in ((k_iu, _LOGIN_GAGAL_MAKS_IP_USER), (k_u, _LOGIN_GAGAL_MAKS_USER)):
            d = _login_gagal.get(k)
            if d is None:
                hasil.append(False)
                continue
            while d and sekarang - d[0] > _LOGIN_GAGAL_JENDELA:
                d.popleft()
            if not d:
                del _login_gagal[k]
                hasil.append(False)
            else:
                hasil.append(len(d) >= maks)
        return any(hasil)


def _catat_login_gagal(username):
    sekarang = time.time()
    with _login_gagal_lock:
        _bersihkan_gagal_login_locked(sekarang)
        for k in _kunci_gagal_login(username):
            _login_gagal[k].append(sekarang)


def _reset_login_gagal(username):
    with _login_gagal_lock:
        for k in _kunci_gagal_login(username):
            _login_gagal.pop(k, None)


def _respon_429():
    resp = jsonify(success=False, ok=False, message='Terlalu banyak request, coba lagi sebentar ya.')
    resp.status_code = 429
    resp.headers['Retry-After'] = '10'
    return resp


def batasi(kategori):
    """Decorator rate-limit untuk 1 route. Burst-check (jendela 10 detik)
    selalu dicek duluan sebelum kategori spesifiknya, supaya lonjakan
    beruntun (mis. klik ganda / bug loop di frontend) kena batas duluan
    sebelum jatah per-menitnya ikut habis karena hal yang sama."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not _cek_dan_catat_rate_limit('burst'):
                return _respon_429()
            if not _cek_dan_catat_rate_limit(kategori):
                return _respon_429()
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ----------------------------------------------------
# LOGGING SEDERHANA PER-REQUEST (untuk cari tahu endpoint mana yang paling
# banyak dipanggil saat traffic terasa tinggi)
# ----------------------------------------------------
LOG_AKSES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'access_log.jsonl')
_log_lock = threading.Lock()

# Access log berotasi otomatis (2 MB x 3 cadangan) dan handler dibuka sekali,
# bukan open()/close() file di setiap request seperti sebelumnya. Kalau app
# dijalankan dengan >1 worker proses, rotasi bisa saling bentrok -- dalam kasus
# itu cukup log request berstatus >= 400 atau durasi > 500 ms saja.
import logging
from logging.handlers import RotatingFileHandler
_akses_logger = logging.getLogger('akses')
_akses_logger.setLevel(logging.INFO)
_akses_logger.propagate = False
try:
    os.makedirs(os.path.dirname(LOG_AKSES_PATH), exist_ok=True)
    _h_akses = RotatingFileHandler(LOG_AKSES_PATH, maxBytes=2_000_000, backupCount=3, encoding='utf-8', delay=True)
    _h_akses.setFormatter(logging.Formatter('%(message)s'))
    _akses_logger.addHandler(_h_akses)
except Exception as _exc_log:
    print(f"[WARN] Gagal menyiapkan access log: {_exc_log}")


@app.before_request
def _catat_waktu_mulai_request():
    request._waktu_mulai = time.time()


@app.after_request
def _log_akses_request(response):
    try:
        # Jangan ikut log request ke file statis (css/js/gambar) -- biar log
        # tetap fokus ke endpoint aplikasi/API yang relevan buat didiagnosis.
        if request.endpoint not in ('static', 'ping'):
            durasi_ms = round((time.time() - getattr(request, '_waktu_mulai', time.time())) * 1000, 1)
            baris = {
                'waktu': datetime.utcnow().isoformat(),
                'ip': _ambil_ip_client(),
                'method': request.method,
                'path': request.path,
                'status': response.status_code,
                'durasi_ms': durasi_ms,
                'user': (session.get('user') or {}).get('username'),
            }
            _akses_logger.info(json.dumps(baris, ensure_ascii=False))
    except Exception as exc:
        # Logging tidak boleh sampai bikin request utama gagal.
        print(f"[WARN] Gagal menulis access log: {exc}")
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
# Username akun DEV/Admin ASLI (AHMAD FAKHRI AL FARISI) & id border-border
# khusus yang cuma boleh dipakai olehnya. Dipakai buat validasi di
# /api/profil/border (server-side) supaya siswa lain TIDAK BISA "curang"
# pasang border admin/khusus lewat request API langsung (mis. dari
# DevTools/Postman), walau di UI Dashboard Siswa tombolnya memang sudah
# disembunyikan/dikunci untuk mereka.
USERNAME_ADMIN_DEV = 'siswa'
BORDER_ID_ADMIN = 'admin_dev'

# PERBAIKAN: sebelumnya validasi kepemilikan di sini CUMA mencakup
# 'admin_dev' -- padahal kategori 'khusus' di DAFTAR_BORDER_KHUSUS
# (dashboard_siswa_2.js) sudah berkembang jadi 2 border ('border_imortal'
# / Kristal Imortal, DAN 'border_ice' / Ice-Collector) yang SAMA-SAMA cuma
# boleh dipakai akun dev asli (lihat isBorderTerbuka() di frontend -- kedua
# id ini digerbangi kategori 'khusus', bukan per-id). Karena backend cuma
# ngecek 'admin_dev', siswa lain BISA mengakali via request API langsung ke
# /api/profil/border (id: 'border_imortal' atau 'border_ice') dan lolos
# tersimpan padahal tombolnya di UI mereka terkunci.
#
# Sekarang semua id "border khusus" yang eksklusif akun dev dikumpulkan di
# SATU set ini, dipakai bareng oleh _field_tampilan_publik_aman() (baca/
# tampil) & api_profil_border() (simpan) -- satu sumber kebenaran, sama
# seperti pola BORDER_ID_ADMIN sebelumnya, tinggal diperluas kalau nanti
# nambah border khusus baru lagi.
ID_BORDER_KHUSUS_ADMIN_DEV = {BORDER_ID_ADMIN, 'border_imortal', 'border_ice'}


def _border_publik_aman(u):
    """Ambil border_aktif seorang user, TAPI kalau ternyata border-nya
    'admin_dev' padahal usernya BUKAN akun dev asli, turunkan paksa ke
    'starter_pemula' -- sama kayak sanitasi yang sudah ada di
    /api/kelas/roster. BUG YANG DIPERBAIKI: sanitasi itu dulu cuma
    ditempel di /api/kelas/roster, sedangkan endpoint lain yang juga
    nampilin border ke publik (/api/teman/cari, /api/teman/relasi,
    profil publik siswa) masih baca border_aktif MENTAH tanpa sanitasi
    -- jadi kalau ada akun siswa yang datanya somehow ke-set 'admin_dev'
    (mis. data lama sebelum validasi di /api/profil/border ditambahkan),
    border admin itu tetap kelihatan bocor ke siswa lain lewat 'Cari
    Teman' walau siswa itu BUKAN akun dev. Sekarang semua endpoint yang
    menampilkan border publik WAJIB lewat fungsi ini, satu sumber
    kebenaran, supaya tidak ada celah yang kelewat lagi."""
    return _field_tampilan_publik_aman(u, 'border_aktif')


# ----------------------------------------------------
# TAHAP 2: Efek Nama & Title dipakai TERPISAH dari Border (server-side)
# ----------------------------------------------------
# Di Tahap 1 (frontend-only), siswa sudah bisa mix-and-match border, efek
# nama, & title dari koleksi manapun yang sudah terbuka -- TAPI cuma
# nyimpen pilihan itu di localStorage device sendiri. Efeknya, siswa LAIN
# yang lihat lewat Leaderboard Quiz / "Cari Teman" tetap melihat kombinasi
# LAMA (efek nama & title yang otomatis ikut satu paket sama border),
# karena server cuma pernah punya SATU field `border_aktif`.
#
# Sekarang server punya 2 field baru per user, polanya SAMA PERSIS dengan
# `border_aktif`:
#   - efek_nama_aktif : id border yang GAYA/WARNA efek namanya dipakai
#   - title_aktif      : id border yang TEKS title/badge-nya dipakai
# Keduanya menyimpan ID BORDER (bukan nama efek/title itu sendiri) --
# soalnya di frontend efek nama & title selalu DITURUNKAN dari sebuah
# objek border lewat getEfekNamaClass()/getTitleBadgeClass() (lihat
# dashboard_siswa_2.js), jadi cukup ingat "meniru gaya border yang mana"
# tanpa backend perlu tahu detail nama warna/kelas CSS-nya sama sekali.
#
# Kalau siswa belum pernah pakai fitur mix-and-match ini sama sekali
# (field belum pernah diisi), fallback-nya ikut border_aktif -- perilaku
# lama tetap jalan normal buat siswa yang belum sentuh fitur ini.
FIELD_KEY_TAMPILAN = {
    'border': 'border_aktif',
    'efekNama': 'efek_nama_aktif',
    'title': 'title_aktif',
}


def _field_tampilan_publik_aman(u, field_key):
    """Versi umum dari _border_publik_aman() di atas, dipakai buat
    field_key 'border_aktif', 'efek_nama_aktif', MAUPUN 'title_aktif'.
    Satu sumber kebenaran buat sanitasi border admin/dev & border khusus
    lain (lihat ID_BORDER_KHUSUS_ADMIN_DEV) di KETIGA field tampilan itu,
    supaya efek nama/title-nya juga tidak bisa bocor ke siswa lain lewat
    jalur yang sama seperti border-nya (mis. data lama dari sebelum
    validasi ini diperluas ke border_imortal/border_ice)."""
    nilai = u.get(field_key) or u.get('border_aktif') or 'starter_pemula'
    if nilai in ID_BORDER_KHUSUS_ADMIN_DEV and u.get('username') != USERNAME_ADMIN_DEV:
        return 'starter_pemula'
    return nilai


def _efek_nama_publik_aman(u):
    """Id border yang gaya efek namanya sedang dipakai user ini (Tahap 2),
    fallback ke border_aktif kalau belum pernah diatur terpisah."""
    return _field_tampilan_publik_aman(u, 'efek_nama_aktif')


def _title_publik_aman(u):
    """Id border yang teks title/badge-nya sedang dipakai user ini
    (Tahap 2), fallback ke border_aktif kalau belum pernah diatur
    terpisah."""
    return _field_tampilan_publik_aman(u, 'title_aktif')
 
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
        'password': generate_password_hash('guru123'), 
        'role': 'guru',
        'email': 'guru@sekolah.sch.id',
        'fullname': 'Ahmad, S.T',
        'identity_number': '198501012010011001',
        # GANTI KE NOMOR WA ASLI GURU/GURU PIKET YANG BERSANGKUTAN --
        # dipakai tombol "Ajukan Banding" di overlay peringatan pelanggaran
        # siswa (lihat _format_nomor_wa() & api_pelanggaran_set() di bawah)
        # supaya siswa bisa langsung diarahkan ke chat WhatsApp guru yang
        # menandai pelanggarannya. Format bebas (boleh pakai 08xx atau
        # +62xx), otomatis dirapikan ke format internasional saat dipakai.
        'whatsapp': '081234567890'
    },
    'pak joel': {
            'username': 'pak joel', 
            'password': generate_password_hash('joel123'), 
            'role': 'guru',
            'email': 'joel@sekolah.sch.id',
            'fullname': 'PAK JOEL',
            'identity_number': '198501901210011001',
            'whatsapp': '081234567890'
    },
    'siswa': {
        'username': 'siswa', 
        'password': generate_password_hash('siswa123'), 
        'role': 'siswa',
        'email': 'ahmad.fakhrialfarisi08@gmail.com',
        'fullname': 'AHMAD FAKHRI AL FARISI',
        'identity_number': '6398601297',
        'kelas': 'XII TKJ 3/TAV',
        'border_aktif': 'admin_dev',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
 
    
    'staf1': {
        'username': 'staf1', 
        'password': generate_password_hash('passstaf'), 
        'role': 'staf_kebersihan',
        'email': 'staf1@sekolah.sch.id',
        'fullname': 'Staf Kebersihan 01',
        'identity_number': 'STAF-001'
    },
    'syam': {
        'username': 'syam',
        'password': generate_password_hash('semBandung'),
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
        'password': generate_password_hash('dafa123'),
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
        'password': generate_password_hash('waldi123'),
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
            'password': generate_password_hash('setiawan'),
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
                'password': generate_password_hash('qwerty46'),
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
                'password': generate_password_hash('afrizalmustaqim'),
                'role': 'siswa',
                'email': 'afrizal@sekolah.sch.id',
                'fullname': 'AFRIZAL MUSTAQIM',
                'identity_number': '0067989099',
                'kelas': 'XII TKJ 3/TAV',
                'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'Wildan': {
                'username': 'Wildan',
                'password': generate_password_hash('wildan123'),
                'role': 'siswa',
                'email': 'Wildan@sekolah.sch.id',
                'fullname': 'WILDAN MAULANA DIENUL HAQ',
                'identity_number': '0905216019',
                'kelas': 'XII TKJ 2',
                'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'admin fajri': {
              'username': 'fajri',
              'password': generate_password_hash('fajri123'),
              'role': 'siswa',
              'email': 'fajri@sekolah.sch.id',
              'fullname': 'A FAJRI',
              'identity_number': '0067954186',
              'kelas': 'XII TKJ 3/TAV',
              'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'teknisi wildan': {
              'username': 'wildan',
              'password': generate_password_hash('wildan'),
              'role': 'siswa',
              'email': 'Teknisi_wildan@sekolah.sch.id',
              'fullname': 'MUHAMMAD WILDAN',
              'identity_number': '0647927486',
              'kelas': 'BINTANG NET MULTIDATA',
              'border_aktif': 'starter_pemula',
        'foto_profil': FOTO_PROFIL_DEFAULT
    },
    'fadzri': {
        'username': 'fadzri',
        'password': generate_password_hash('fadzri123'),
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


def _password_sudah_hash(nilai):
    """Cek kasar apakah suatu nilai password sudah berbentuk hash werkzeug
    (format aslinya selalu 'metode:params$salt$hash', mis. 'scrypt:...'),
    bukan password mentah. Dipakai supaya data lama di users_store.json
    yang KEBETULAN masih plaintext (tersimpan sebelum hashing diterapkan)
    tidak menimpa balik hash yang sudah benar di dict `users` dummy."""
    return isinstance(nilai, str) and ':' in nilai and '$' in nilai


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
    perlu_simpan_ulang = False
    for username, data in simpanan.items():
        if not isinstance(data, dict):
            continue
        if username in users:
            if 'password' in data and not _password_sudah_hash(data['password']):
                # Field password di file JSON ini masih plaintext (peninggalan
                # sebelum hashing diterapkan) -- JANGAN dipakai menimpa hash
                # yang sudah benar di dict users dummy, supaya login tidak
                # jadi gagal terus karena ketiban versi lama.
                data = {k: v for k, v in data.items() if k != 'password'}
                perlu_simpan_ulang = True
            users[username].update(data)
        else:
            # Akun baru dari store: kalau password-nya ternyata masih plaintext
            # (peninggalan sebelum hashing), hash sekarang -- tidak ada password
            # mentah yang boleh hidup di memori maupun di disk.
            if 'password' in data and not _password_sudah_hash(data['password']):
                data['password'] = generate_password_hash(str(data['password']))
                perlu_simpan_ulang = True
            users[username] = data
    if perlu_simpan_ulang:
        try:
            _simpan_users_store()  # timpa file lama yang masih memuat plaintext
        except Exception as exc:
            print(f"[WARN] Gagal menyimpan ulang users_store: {type(exc).__name__}")


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


def _akun_ini_bk():
    """True kalau yang sedang login adalah akun BK -- dicek dari role
    session ('bk') ATAU field is_bk di data users (jaga-jaga kalau akun
    BK disimpan dgn role 'guru' + flag tambahan)."""
    if 'user' not in session:
        return False
    if session['user'].get('role') == 'bk':
        return True
    u = users.get(session['user'].get('username'))
    return bool(u and u.get('is_bk'))


# ----------------------------------------------------
# PEMANTAUAN API (ai_usage_log + /api/admin/ai-usage)
# ----------------------------------------------------
# Pola sama dengan set_quiz_context_provider di bawah: gemini_routes tidak
# boleh import app.py (circular), jadi app.py yang "menitipkan" fungsinya.
# Endpoint /api/admin/ai-usage fail-closed: sebelum provider ini terdaftar
# semua request ditolak.
set_admin_checker_provider(_akun_ini_admin_dev)

try:
    from services import ai_usage_log
except Exception:
    ai_usage_log = None


def _kelas_untuk_ai_usage(username):
    """Kelas siswa untuk log pemakaian AI. Key dict `users` tidak selalu sama
    dengan field 'username', jadi dicari lewat nilai. Guru/staf tidak punya
    field kelas -> None (tercatat sebagai 'Tidak tercatat')."""
    for u in users.values():
        if u.get('username') == username:
            return u.get('kelas')
    return None


if ai_usage_log is not None:
    ai_usage_log.set_kelas_provider(_kelas_untuk_ai_usage)

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
    {'nama': 'PAK JOEL', 'lulusan': 'S1 Teknik Informatika - Universitas Telkom', 'mapel': 'Administrasi Infrastruktur Jaringan', 'kelas': 'XII TKJ 3', 'tingkat': 'XII', 'jurusan': 'TKJ', 'foto': 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Dadan, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Otomotif - UPI Bandung', 'mapel': 'Pemeliharaan Mesin Kendaraan Ringan', 'kelas': 'XII TKR 1', 'tingkat': 'XII', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Toto, S.T', 'lulusan': 'S1 Teknik Mesin - Institut Teknologi Nasional', 'mapel': 'Pemeliharaan Kelistrikan Kendaraan', 'kelas': 'XII TKR 2', 'tingkat': 'XII', 'jurusan': 'TKR', 'foto': 'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Yana, S.T', 'lulusan': 'S1 Teknik Elektro - Universitas Jenderal Achmad Yani', 'mapel': 'Audio Video Sistem', 'kelas': 'XII TAV 1', 'tingkat': 'XII', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1607990281513-2c110a25bd8c?auto=format&fit=crop&q=80&w=500'},
    {'nama': 'Heri, S.Pd', 'lulusan': 'S1 Pendidikan Teknik Elektro - UPI Bandung', 'mapel': 'Audio Video Sistem', 'kelas': 'XII TAV 2', 'tingkat': 'XII', 'jurusan': 'TAV', 'foto': 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?auto=format&fit=crop&q=80&w=500'},
]


def _muat_daftar_guru():
    """Baca guru_store.json (hasil tambah/edit/hapus admin sebelumnya) kalau
    sudah ada. Kalau belum pernah ada sama sekali (baru pertama kali server
    dijalankan), pakai DAFTAR_GURU_DEFAULT di atas dengan id 0..N diisi dari
    urutan array-nya.

    BUG YANG DIPERBAIKI: kalau file guru_store.json ini sempat diedit manual
    (atau berasal dari versi lama sebelum field 'id' selalu diisi otomatis),
    ada entri guru yang bisa saja tidak punya field 'id' sama sekali. Sebelum
    perbaikan ini, itu bikin /api/guru/tambah CRASH 500 setiap kali diklik --
    baris `max(g['id'] for g in daftar_guru)` langsung KeyError begitu ketemu
    satu saja entri tanpa 'id'. Sekarang begitu dibaca dari file, entri yang
    belum punya 'id' otomatis dikasih id baru (lanjutan dari id tertinggi yang
    sudah ada), dan hasilnya langsung ditulis balik ke file supaya rapi
    permanen -- bukan cuma "ditambal" sementara di memori tiap start server."""
    try:
        with open(GURU_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return [dict(g, id=i) for i, g in enumerate(DAFTAR_GURU_DEFAULT)]

    id_berikutnya = max((g['id'] for g in data if 'id' in g), default=-1) + 1
    ada_yang_dibetulkan = False
    for g in data:
        if 'id' not in g:
            g['id'] = id_berikutnya
            id_berikutnya += 1
            ada_yang_dibetulkan = True
    if ada_yang_dibetulkan:
        try:
            tmp_path = GURU_STORE_PATH + '.tmp'
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, GURU_STORE_PATH)
        except OSError as exc:
            print(f"[WARN] Gagal menulis perbaikan id guru ke disk: {exc}")
    return data


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
        json.dump(quiz_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, QUIZ_STORE_PATH)  # atomic, hindari file JSON korup kalau nulis lagi ketiban proses lain
 
 
quiz_store = _muat_quiz_store()


# ----------------------------------------------------
# PROGRES QUIZ YANG BELUM SELESAI (SNAPSHOT "IN-PROGRESS")
# SENGAJA dibuat TERPISAH TOTAL dari quiz_store di atas (variabel Python
# beda, file JSON di disk beda: quiz_inprogress_store.json) -- supaya:
#   1) Snapshot kuis yang BELUM tuntas ini TIDAK PERNAH ikut kebaca oleh
#      api_quiz_leaderboard_global() (yang iterasi murni ke quiz_store),
#      jadi tidak mungkin nyasar tampil di leaderboard sebagai skor final.
#   2) File quiz_store.json (data final, penting buat leaderboard semua
#      siswa) tetap bersih -- baca/tulis snapshot in-progress yang lebih
#      sering (tiap 1 soal dijawab) tidak numpuk campur di file yang sama.
#
# Struktur: quiz_inprogress_store[kunci_slot] = snapshot persis sama seperti
# yang dulu HANYA hidup di localStorage klien (lihat
# simpanProgressQuizSementara() di dashboard_siswa_2.js): { jenis, level,
# mapelId, mapelNama, soal, index, skor, benar, disimpanPada }. Cuma SATU
# snapshot aktif per slot (bukan dipisah per jenis PG/Essay) -- field
# 'jenis' di dalam objeknya sendiri yang menandai tipe quiz-nya, sama
# persis perilaku KEY_QUIZ_INPROGRESS di localStorage yang juga cuma 1 key
# (ditimpa/dihapus tiap kali quiz baru dimulai apapun jenisnya). kunci_slot
# sama persis dengan _kunci_slot_quiz() yang dipakai quiz_store, jadi tiap
# akun (atau tiap profil dummy) tetap punya slot progres sendiri-sendiri.
#
# Kenapa perlu disimpan ke SERVER (bukan cukup localStorage saja): supaya
# dialog "kuis kamu terputus di soal nomor X, lanjutkan?" tetap bisa muncul
# walau siswa buka dashboard dari PERANGKAT/BROWSER LAIN dari tempat dia
# terakhir main (mis. mulai di laptop, lanjut dibuka lagi dari HP/tablet).
# ----------------------------------------------------
QUIZ_INPROGRESS_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'quiz_inprogress_store.json')


def _muat_quiz_inprogress_store():
    """Baca quiz_inprogress_store dari file JSON di disk (kalau ada). Pola
    sama persis dengan _muat_quiz_store."""
    try:
        with open(QUIZ_INPROGRESS_STORE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _simpan_quiz_inprogress_store():
    """Tulis quiz_inprogress_store saat ini ke file JSON di disk (atomic,
    pola sama dengan _simpan_quiz_store supaya tidak korup kalau ketiban
    proses lain)."""
    os.makedirs(os.path.dirname(QUIZ_INPROGRESS_STORE_PATH), exist_ok=True)
    tmp_path = QUIZ_INPROGRESS_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(quiz_inprogress_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, QUIZ_INPROGRESS_STORE_PATH)


quiz_inprogress_store = _muat_quiz_inprogress_store()


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
        json.dump(prestasi_store, f, ensure_ascii=False, separators=(',', ':'))
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
        json.dump(saran_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, SARAN_STORE_PATH)


saran_store = _muat_saran_store()


# ----------------------------------------------------
# DATA EVALUASI GURU (SIMULASI TABEL teacher_evaluations)
# SEBELUMNYA fitur "Beri Saran/Evaluasi" untuk guru (tombol "Beri Saran" di
# tiap kartu "Daftar Guru", Dashboard Siswa) CUMA nulis ke localStorage
# browser (key 'evaluasi_guru') -- artinya kalau guru & siswa buka dashboard
# di PERANGKAT/BROWSER YANG BERBEDA (kondisi pemakaian sungguhan di sekolah),
# rating/masukan yang masuk TIDAK PERNAH nyampe ke guru sama sekali, reload
# berkali-kali pun percuma -- persis masalah yang sama dengan Kotak Saran
# lama (lihat catatan saran_store) & Pelanggaran lama (lihat catatan
# pelanggaran_store di bawah).
# Sekarang disimpan di SINI (server, pola sama seperti quiz_store/
# prestasi_store/saran_store di atas) supaya:
#   1) Badge "Saran & Evaluasi" di Dashboard Guru otomatis bertambah begitu
#      ada siswa dari PERANGKAT MANAPUN yang mengirim, tanpa guru perlu
#      reload manual (lihat hitungDanTampilkanEvaluasiBelumDibaca() di
#      dashboard_guru.js -- pola pollingnya SAMA seperti "Tugas Belum
#      Dinilai"/hitungDanTampilkanPerluDinilai()).
#   2) Rata-rata rating guru di "Daftar Guru" (Dashboard Siswa) akurat
#      lintas siswa/perangkat, bukan cuma dari device masing-masing.
# SENGAJA dibuat TERPISAH TOTAL dari saran_store -- itu "Kotak Saran" untuk
# Admin/Dev (Ahmad Fakhri Al Farisi), ini "Saran & Evaluasi" untuk guru.
# Variabel Python beda (evaluasi_store), file JSON beda
# (evaluasi_store.json), endpoint beda (/api/evaluasi/...).
# Skema tiap item (persis skema lama di localStorage + 1 field baru):
#   { id, guruNama, guruMapel, ratingPenjelasan, ratingKeadilan,
#     ratingKomunikasi, pesan, anonim, namaPengirim, waktu, dibaca }
# 'dibaca' baru ada di skema server ini (localStorage lama tidak kenal
# konsep ini) -- dipakai badge "belum dibaca" di Dashboard Guru: begitu guru
# membuka tab Saran & Evaluasi, SELURUH entri yang belum dibaca ditandai
# lewat /api/evaluasi/tandai-dibaca (dipanggil dari renderEvaluasiGuru() di
# dashboard_guru.js), badge-nya nol lagi sampai ada masukan baru masuk.
# ----------------------------------------------------
EVALUASI_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'evaluasi_store.json')


def _muat_evaluasi_store():
    """Baca evaluasi_store (list) dari file JSON di disk (kalau ada)."""
    try:
        with open(EVALUASI_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _simpan_evaluasi_store():
    """Tulis evaluasi_store saat ini ke file JSON di disk (atomic, sama pola
    dengan _simpan_saran_store supaya tidak korup kalau ketiban proses lain
    nulis bersamaan)."""
    os.makedirs(os.path.dirname(EVALUASI_STORE_PATH), exist_ok=True)
    tmp_path = EVALUASI_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(evaluasi_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, EVALUASI_STORE_PATH)


evaluasi_store = _muat_evaluasi_store()


# ============================================================
# SKEMA BARU SISTEM PELANGGARAN + PENEBUS
# ------------------------------------------------------------
# GANTIKAN skema pelanggaran_store LAMA (cuma {aktif:true/false,
# keterangan, oleh, oleh_whatsapp, aksi_siswa, ...}) dengan skema BARU
# yang punya alur STATUS (workflow tugas penebus) + kategori + audit
# trail. Ditulis TERPISAH supaya tinggal ditempel ke app.py lama kamu --
# TIDAK menggantikan/menghapus fungsi lain apa pun di app.py (login,
# session, tugas, maintenance, dll).
#
# CARA PASANG KE app.py:
#   1. Cari blok lama "DATA PELANGGARAN AKTIF SISWA" di app.py kamu
#      (mulai dari komentar besar sebelum PELANGGARAN_STORE_PATH,
#      sampai akhir fungsi _urutkan_antrian_aktif() -- kira-kira baris
#      976-1058 di file yang kamu upload). GANTIKAN seluruh blok itu
#      dengan isi file ini.
#   2. Semua import yang dipakai di sini (os, json, uuid, time,
#      datetime, timedelta) SUDAH ADA di bagian atas app.py kamu --
#      TIDAK perlu ditambah import baru apa pun.
#   3. Variabel global `pelanggaran_store` TETAP DIPAKAI (nama sama
#      persis) -- tapi 2 titik LAIN di app.py yang masih menyentuhnya
#      langsung (route dashboard_siswa() & api_tugas_submit()) baca
#      skema/field LAMA, jadi WAJIB disesuaikan manual juga. Snippet
#      pastinya saya kasih terpisah di chat (bukan di file ini), cari
#      bagian "WAJIB DITEMPEL MANUAL" di jawaban saya.
#   4. MIGRASI OTOMATIS: entri lama (tidak punya field 'status') otomatis
#      dikonversi ke skema baru saat pelanggaran_store.json dimuat
#      pertama kali (lihat _migrasi_entri_lama()) -- data lama TIDAK
#      hilang, tapi field 'oleh_whatsapp'/'aksi_siswa' (murni sistem WA
#      lama) SENGAJA tidak ikut dibawa karena sudah tidak relevan di
#      sistem banding baru (lihat endpoint_pelanggaran.py:
#      api_pelanggaran_banding()). Entri lama jadi status 'aktif' polos
#      -- guru tinggal buka modal detail siswa itu & klik
#      [Kasih Tugas Penebus] kalau mau lanjutkan alur baru utk entri
#      peninggalan ini.
# ============================================================

# ----------------------------------------------------
# KONSTANTA SKEMA
# ----------------------------------------------------
# Urutan status dipakai buat SORTING tampilan (modal detail guru &
# antrian/arsip siswa): aktif > menunggu_tugas > menunggu_acc >
# selesai/dibatalkan.
URUTAN_STATUS_PELANGGARAN = ['menunggu_bk', 'aktif', 'menunggu_tugas',
                              'menunggu_acc', 'selesai', 'dibatalkan']

# Status yang MENGUNCI tugas siswa (dipakai gantikan cek lama
# `if pelanggaran_store.get(username):` di api_tugas_submit() -- lihat
# siswa_punya_pelanggaran_mengunci() di bawah).
STATUS_BELUM_SELESAI = {'aktif', 'menunggu_tugas', 'menunggu_acc', 'menunggu_bk'}

# Status yang masuk ARSIP di sisi siswa (bukan lagi bagian antrian aktif).
STATUS_ARSIP = {'selesai', 'dibatalkan'}

KATEGORI_PELANGGARAN = {'ringan', 'sedang', 'berat'}
DURASI_AUTO_ACC_HARI = {'ringan': 3, 'sedang': 7, 'berat': 14}
DEDUKSI_POIN_KATEGORI = {'ringan': -2, 'sedang': -5, 'berat': -15}

# PRESET JENIS PELANGGARAN -- dipakai form manual guru: pilih jenis,
# kategori & instruksi penebus otomatis ke-autofill dari sini (guru
# masih BEBAS edit teksnya sebelum submit, KECUALI kategori 'berat'
# yang WAJIB tetap terisi -- lihat validasi di api_pelanggaran_tambah()).
# CATATAN: ini cuma starting point yang masuk akal, silakan disesuaikan
# ke tata tertib sekolah kamu sendiri (SMK Banjar Asri Cimaung).
PRESET_JENIS_PELANGGARAN = {
    'Terlambat masuk sekolah': {
        'kategori': 'ringan',
        'instruksi_penebus_default': 'Membuat surat pernyataan tidak akan mengulangi keterlambatan, ditandatangani orang tua/wali.',
    },
    'Atribut/seragam tidak lengkap': {
        'kategori': 'ringan',
        'instruksi_penebus_default': 'Melengkapi atribut yang kurang dan kirim foto bukti sudah dipakai lengkap keesokan harinya.',
    },
    'Tidak mengerjakan tugas': {
        'kategori': 'ringan',
        'instruksi_penebus_default': '',
    },
    'Ribut di kelas': {
        'kategori': 'sedang',
        'instruksi_penebus_default': 'Membuat surat pernyataan tidak akan mengulangi, ditandatangani wali kelas.',
    },
    'Mengganggu teman': {
        'kategori': 'sedang',
        'instruksi_penebus_default': 'Meminta maaf langsung ke teman bersangkutan di depan wali kelas + surat pernyataan.',
    },
    'Membolos/tidak masuk tanpa keterangan': {
        'kategori': 'berat',
        'instruksi_penebus_default': 'Membuat surat pernyataan bermaterai + dihadiri orang tua/wali ke sekolah.',
    },
    'Merokok di lingkungan sekolah': {
        'kategori': 'berat',
        'instruksi_penebus_default': 'Membuat surat pernyataan bermaterai + orang tua/wali dipanggil ke sekolah + tugas edukasi bahaya rokok.',
    },
    'Berkelahi/tindak kekerasan': {
        'kategori': 'berat',
        'instruksi_penebus_default': 'Orang tua/wali WAJIB dipanggil ke sekolah + surat pernyataan bermaterai + tugas edukasi.',
    },
    'Lainnya (isi manual)': {
        'kategori': 'ringan',
        'instruksi_penebus_default': '',
    },
}


# ----------------------------------------------------
# STORE (persist ke file JSON di disk, POLA SAMA PERSIS seperti
# quiz_store/prestasi_store/maintenance_store yang sudah ada di app.py)
# ----------------------------------------------------
PELANGGARAN_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'pelanggaran_store.json')


def _migrasi_entri_lama(e):
    """Konversi 1 entri skema LAMA (tidak punya 'status') ke skema BARU.
    Skema lama tidak kenal konsep tugas penebus/ACC sama sekali -- entri
    lama jadi status 'aktif' polos apa adanya."""
    if 'status' in e:
        return e  # sudah skema baru, tidak perlu dimigrasi
    return {
        'id': e.get('id') or _buat_id_pelanggaran(),
        'jenis': e.get('keterangan') or 'Pelanggaran (data lama)',
        'kategori': 'ringan',
        'keterangan': e.get('keterangan') or '',
        'status': 'aktif',
        'instruksi_penebus': None,
        'deadline': None,
        'bukti': None,
        'catatan_siswa': None,
        'catatan_penolakan': None,
        'alasan_banding': None,
        'dilaporkan_oleh': e.get('oleh_username'),
        'dilaporkan_oleh_nama': e.get('oleh'),
        'dibuat_at': e.get('dibuat_at') or datetime.utcnow().isoformat(),
        'ditugaskan_at': None,
        'dikirim_at': None,
        'ditinjau_oleh': None,
        'ditinjau_oleh_nama': None,
        'diselesaikan_at': None,
        'ditolak_at': None,
        'dibatalkan_oleh': None,
        'dibatalkan_oleh_nama': None,
        'dibatalkan_at': None,
        'auto_acc': False,
        'catatan_auto_acc': None,
        'ditinjau_bk_oleh': None,
        'ditinjau_bk_oleh_nama': None,
        'disetujui_bk_at': None,
        'catatan_bk': None,
    }


def _muat_pelanggaran_store():
    """Baca pelanggaran_store dari file JSON di disk (kalau ada) + MIGRASI
    otomatis tiap entri lama ke skema baru (lihat _migrasi_entri_lama())."""
    try:
        with open(PELANGGARAN_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return {u: [_migrasi_entri_lama(e) for e in daftar] for u, daftar in data.items()}


def _simpan_pelanggaran_store():
    """Tulis pelanggaran_store saat ini ke file JSON di disk (atomic, pola
    sama dgn _simpan_quiz_store dkk supaya tidak korup kalau ketiban
    proses lain nulis bersamaan)."""
    os.makedirs(os.path.dirname(PELANGGARAN_STORE_PATH), exist_ok=True)
    tmp_path = PELANGGARAN_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(pelanggaran_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, PELANGGARAN_STORE_PATH)


pelanggaran_store = _muat_pelanggaran_store()


def _buat_id_pelanggaran():
    """Format id: 'pel_<epoch_ms>_<4 hex acak>' -- sama persis pola id
    skema lama, supaya id entri lama yang ke-migrasi tetap konsisten
    bentuknya kalau somehow perlu dibuatkan id baru (fallback saja)."""
    return 'pel_%d_%s' % (int(time.time() * 1000), uuid.uuid4().hex[:4])


# ----------------------------------------------------
# HELPER OTORISASI -- satu sumber kebenaran dipakai bareng oleh
# endpoint_pelanggaran.py utk (1) siapa boleh KELOLA (tugaskan/acc/
# tolak/batalkan) satu entri, dan (2) siapa boleh LIHAT field audit-nya.
# ----------------------------------------------------
def _boleh_kelola_pelanggaran(entri):
    """True kalau guru yang SEDANG LOGIN adalah pelapor entri ini, ATAU
    akun Admin/Developer (_akun_ini_admin_dev() -- fungsi ini SUDAH ADA
    di app.py kamu, dipakai jg utk menu Maintenance & Kelola Guru)."""
    if 'user' not in session:
        return False
    return entri.get('dilaporkan_oleh') == session['user'].get('username') or _akun_ini_admin_dev()


def _cari_entri_pelanggaran(username, pelanggaran_id):
    """Cari 1 entri pelanggaran milik seorang siswa by id. None kalau
    siswa/id tidak ditemukan."""
    for e in (pelanggaran_store.get(username) or []):
        if e.get('id') == pelanggaran_id:
            return e
    return None


def _proses_auto_acc():
    """Sapu semua entri 'menunggu_acc' lintas siswa. Kalau lewat batas
    hari sesuai kategori (dari dikirim_at), auto-ACC jadi 'selesai'."""
    berubah = False
    sekarang = datetime.utcnow()
    for username, daftar in pelanggaran_store.items():
        for e in daftar:
            if (e.get('status') or 'aktif') != 'menunggu_acc':
                continue
            kategori = e.get('kategori') or 'ringan'
            batas_hari = DURASI_AUTO_ACC_HARI.get(kategori, 3)
            basis_iso = e.get('dikirim_at') or e.get('ditugaskan_at') or e.get('dibuat_at')
            if not basis_iso:
                continue
            try:
                basis = datetime.fromisoformat(basis_iso)
            except ValueError:
                continue
            if sekarang - basis >= timedelta(days=batas_hari):
                e['status'] = 'selesai'
                e['auto_acc'] = True
                e['catatan_auto_acc'] = (
                    f'Otomatis disetujui sistem karena guru tidak meninjau '
                    f'dalam {batas_hari} hari (kategori {kategori}).'
                )
                e['diselesaikan_at'] = sekarang.isoformat()
                berubah = True
    if berubah:
        _simpan_pelanggaran_store()
    return berubah


def siswa_punya_pelanggaran_mengunci(username):
    """PENGGANTI cek lama `if pelanggaran_store.get(username):` di
    api_tugas_submit() -- cek lama itu mengunci tugas SELAMA masih ada
    entri APA PUN di list, termasuk yang di skema baru ini sudah
    'selesai'/'dibatalkan' (kalau tidak diganti, tugas siswa yang
    pelanggarannya sudah BERES akan SALAH terus-menerus terkunci).
    Sekarang HANYA mengunci kalau masih ada entri berstatus
    aktif/menunggu_tugas/menunggu_acc/menunggu_bk."""
    _proses_auto_acc()
    return any(
        (e.get('status') or 'aktif') in STATUS_BELUM_SELESAI
        for e in (pelanggaran_store.get(username) or [])
    )


def _urutkan_pelanggaran_siswa(daftar):
    """Urutkan list pelanggaran 1 siswa: aktif dulu, menunggu_tugas,
    menunggu_acc, terakhir selesai/dibatalkan (dalam status yang sama,
    paling lama dibuat duluan)."""
    prioritas = {s: i for i, s in enumerate(URUTAN_STATUS_PELANGGARAN)}
    return sorted(
        daftar,
        key=lambda e: (prioritas.get(e.get('status') or 'aktif', 99), e.get('dibuat_at') or '')
    )


def bangun_ringkasan_semua_siswa():
    """QUERY RINGKASAN lintas siswa -- dipakai /api/pelanggaran/semua utk
    render badge ⚠️ di Card Siswa Beranda Dashboard Guru. Siswa yang
    SEMUA pelanggarannya sudah selesai/dibatalkan TIDAK ikut muncul di
    hasil ini sama sekali (badge otomatis tidak tampil, sesuai spek
    "muncul cuma kalau ada"). Warna badge (prioritas): merah kalau ada
    status 'aktif', biru kalau ada 'menunggu_acc' (tidak ada aktif),
    kuning kalau cuma ada 'menunggu_tugas' (tidak ada aktif/menunggu_acc)."""
    hasil = {}
    for username, daftar in pelanggaran_store.items():
        if not daftar:
            continue
        jml = {s: 0 for s in URUTAN_STATUS_PELANGGARAN}
        for e in daftar:
            st = e.get('status') or 'aktif'
            jml[st] = jml.get(st, 0) + 1
        belum_selesai = (jml['aktif'] + jml['menunggu_tugas'] + jml['menunggu_acc']
                         + jml.get('menunggu_bk', 0))
        if belum_selesai == 0:
            continue
        if jml['aktif'] > 0:
            warna = 'merah'
        elif jml.get('menunggu_bk', 0) > 0:
            warna = 'ungu'
        elif jml['menunggu_acc'] > 0:
            warna = 'biru'
        else:
            warna = 'kuning'
        hasil[username] = {
            'jumlah_aktif': jml['aktif'],
            'jumlah_menunggu_tugas': jml['menunggu_tugas'],
            'jumlah_menunggu_acc': jml['menunggu_acc'],
            'jumlah_selesai': jml['selesai'],
            'jumlah_dibatalkan': jml['dibatalkan'],
            'jumlah_belum_selesai': belum_selesai,
            'warna_badge': warna,
        }
    return hasil


def _format_wib(iso_str):
    """'2026-09-26T10:15:00' -> '26-09-2026 17:15 WIB' (UTC+7), sama pola
    dgn waktu_wib yang sudah dipakai di api_tugas_submit()."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str)
    except ValueError:
        return None
    wib = dt + timedelta(hours=7)
    return wib.strftime('%d-%m-%Y %H:%M') + ' WIB'


def pelanggaran_untuk_response(entri, mode, bisa_lihat_audit=False):
    """SATU-SATUNYA fungsi yang boleh dipakai utk SERIALIZE entri
    pelanggaran ke JSON response -- baik utk guru maupun siswa.

    mode='siswa': field audit (dilaporkan_oleh, ditinjau_oleh,
    dibatalkan_oleh + versi _nama-nya) SELALU dibuang total, apa pun
    nilai bisa_lihat_audit -- sesuai aturan "field audit JANGAN PERNAH
    dikirim ke frontend siswa".

    mode='guru': field audit CUMA disertakan kalau bisa_lihat_audit True
    (guru pelapor entri itu sendiri, atau admin -- lihat
    _boleh_kelola_pelanggaran()). Guru LAIN tetap bisa lihat isi
    pelanggarannya (jenis/keterangan/status/instruksi/bukti/dst), cuma
    TIDAK tahu siapa yang melapor/meninjau/membatalkan."""
    hasil = {
        'id': entri.get('id'),
        'jenis': entri.get('jenis') or entri.get('keterangan') or 'Pelanggaran',
        'kategori': entri.get('kategori') or 'ringan',
        'keterangan': entri.get('keterangan') or '',
        'status': entri.get('status') or 'aktif',
        'instruksi_penebus': entri.get('instruksi_penebus'),
        'deadline': entri.get('deadline'),
        'deadline_formatted': _format_wib(entri.get('deadline')),
        'bukti': entri.get('bukti'),
        'catatan_siswa': entri.get('catatan_siswa'),
        'catatan_penolakan': entri.get('catatan_penolakan'),
        'alasan_banding': entri.get('alasan_banding'),
        'dibuat_at': entri.get('dibuat_at'),
        'dibuat_at_formatted': _format_wib(entri.get('dibuat_at')),
        'ditugaskan_at': entri.get('ditugaskan_at'),
        'dikirim_at': entri.get('dikirim_at'),
        'diselesaikan_at': entri.get('diselesaikan_at'),
        'diselesaikan_at_formatted': _format_wib(entri.get('diselesaikan_at')),
        'ditolak_at': entri.get('ditolak_at'),
        'dibatalkan_at': entri.get('dibatalkan_at'),
        'dibatalkan_at_formatted': _format_wib(entri.get('dibatalkan_at')),
        'auto_acc': bool(entri.get('auto_acc')),
        'catatan_auto_acc': entri.get('catatan_auto_acc'),
        'catatan_bk': entri.get('catatan_bk'),
    }
    if mode == 'guru' and bisa_lihat_audit:
        hasil['dilaporkan_oleh'] = entri.get('dilaporkan_oleh')
        hasil['dilaporkan_oleh_nama'] = entri.get('dilaporkan_oleh_nama')
        hasil['ditinjau_oleh'] = entri.get('ditinjau_oleh')
        hasil['ditinjau_oleh_nama'] = entri.get('ditinjau_oleh_nama')
        hasil['dibatalkan_oleh'] = entri.get('dibatalkan_oleh')
        hasil['dibatalkan_oleh_nama'] = entri.get('dibatalkan_oleh_nama')
    return hasil


# POIN KEAMANAN SISWA (TERPISAH dari poin quiz)
POIN_KEAMANAN_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        'data', 'poin_keamanan_store.json')
POIN_KEAMANAN_DEFAULT = 100
POIN_KEAMANAN_MIN = 0
POIN_KEAMANAN_MAX = 100
PEMULIHAN_HARIAN = 1
PEMULIHAN_MAKS_PER_BULAN = 30

def _muat_poin_keamanan_store():
    try:
        with open(POIN_KEAMANAN_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _simpan_poin_keamanan_store():
    os.makedirs(os.path.dirname(POIN_KEAMANAN_STORE_PATH), exist_ok=True)
    tmp = POIN_KEAMANAN_STORE_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(poin_keamanan_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, POIN_KEAMANAN_STORE_PATH)

poin_keamanan_store = _muat_poin_keamanan_store()

def _ambil_data_poin_keamanan(username):
    data = poin_keamanan_store.get(username)
    if not data:
        data = {'saldo': POIN_KEAMANAN_DEFAULT, 'riwayat': [],
                'terakhir_pulih_tanggal': datetime.utcnow().date().isoformat(),
                'pulih_bulan': datetime.utcnow().strftime('%Y-%m'),
                'pulih_terpakai_bulan_ini': 0}
        poin_keamanan_store[username] = data
    return data

def _proses_pemulihan_harian(username):
    data = _ambil_data_poin_keamanan(username)
    hari_ini = datetime.utcnow().date()
    bulan_ini = hari_ini.strftime('%Y-%m')
    if data.get('pulih_bulan') != bulan_ini:
        data['pulih_bulan'] = bulan_ini
        data['pulih_terpakai_bulan_ini'] = 0
    try:
        tgl_terakhir = datetime.fromisoformat(data.get('terakhir_pulih_tanggal')).date()
    except (TypeError, ValueError):
        tgl_terakhir = hari_ini
    selisih_hari = (hari_ini - tgl_terakhir).days
    if selisih_hari <= 0:
        return
    if siswa_punya_pelanggaran_mengunci(username):
        data['terakhir_pulih_tanggal'] = hari_ini.isoformat()
        _simpan_poin_keamanan_store()
        return
    sisa_kuota = max(0, PEMULIHAN_MAKS_PER_BULAN - data.get('pulih_terpakai_bulan_ini', 0))
    tambahan = min(selisih_hari * PEMULIHAN_HARIAN, sisa_kuota)
    data['terakhir_pulih_tanggal'] = hari_ini.isoformat()
    if tambahan > 0:
        saldo_baru = max(POIN_KEAMANAN_MIN, min(POIN_KEAMANAN_MAX, data['saldo'] + tambahan))
        delta_aktual = saldo_baru - data['saldo']
        data['saldo'] = saldo_baru
        data['pulih_terpakai_bulan_ini'] += tambahan
        if delta_aktual != 0:
            data['riwayat'].append({'tanggal': datetime.utcnow().isoformat(),
                'delta': delta_aktual,
                'alasan': f'Pemulihan otomatis ({selisih_hari} hari tanpa pelanggaran)',
                'saldo_sesudah': data['saldo']})
    _simpan_poin_keamanan_store()

def _tambah_poin_keamanan(username, delta, alasan):
    data = _ambil_data_poin_keamanan(username)
    saldo_baru = max(POIN_KEAMANAN_MIN, min(POIN_KEAMANAN_MAX, data['saldo'] + delta))
    delta_aktual = saldo_baru - data['saldo']
    data['saldo'] = saldo_baru
    data['riwayat'].append({'tanggal': datetime.utcnow().isoformat(),
        'delta': delta_aktual, 'alasan': alasan, 'saldo_sesudah': data['saldo']})
    _simpan_poin_keamanan_store()
    return data['saldo']

def _status_poin_keamanan_response(username):
    _proses_pemulihan_harian(username)
    data = _ambil_data_poin_keamanan(username)
    saldo = data['saldo']
    if saldo >= 70: status_label = 'Aman'
    elif saldo >= 40: status_label = 'Waspada'
    else: status_label = 'Kritis'
    batas_30 = datetime.utcnow() - timedelta(days=30)
    riwayat = []
    for r in data.get('riwayat', []):
        try:
            if datetime.fromisoformat(r['tanggal']) >= batas_30:
                riwayat.append(r)
        except (KeyError, ValueError):
            continue
    riwayat.sort(key=lambda r: r['tanggal'], reverse=True)
    return {'saldo': saldo, 'maksimal': POIN_KEAMANAN_MAX,
            'progress_persen': round(saldo / POIN_KEAMANAN_MAX * 100),
            'status': status_label, 'riwayat_30_hari': riwayat}


# ============================================================
# ENDPOINT PELANGGARAN + PENEBUS
# ------------------------------------------------------------
# CARA PASANG KE app.py:
#   1. Tempel isi file ini PERSIS di posisi endpoint /api/pelanggaran/*
#      yang lama (kira-kira baris 1067-1296 di app.py yang kamu upload).
#   2. HAPUS 3 endpoint lama ini -- sudah digantikan total, dan field yang
#      mereka pakai (aktif: true/false, oleh_whatsapp, aksi_siswa) sudah
#      tidak ada lagi di skema baru:
#         - api_pelanggaran_set()      (/api/pelanggaran/set)
#         - api_pelanggaran_edit()     (/api/pelanggaran/edit)
#         - api_pelanggaran_dilihat()  (/api/pelanggaran/dilihat)
#      Kalau fungsi _format_nomor_wa() di app.py kamu CUMA dipakai
#      3 fungsi di atas (cek dulu dgn Ctrl+F), boleh ikut dihapus juga.
#   3. 2 endpoint LAMA di bawah ini (api_pelanggaran_semua,
#      api_pelanggaran_status) & 1 endpoint (api_pelanggaran_daftar)
#      MENGGANTIKAN definisi lama dgn nama fungsi + path SAMA PERSIS --
#      jangan didefinisikan dua kali.
#   4. Semua endpoint di sini asumsi sudah bisa akses langsung: app,
#      request, jsonify, session, users, batasi, kompres_gambar_base64,
#      GambarTidakValid, TUGAS_FOTO_MAX_DIM, TUGAS_FOTO_QUALITY,
#      _akun_ini_admin_dev -- SEMUA ini SUDAH ADA di app.py kamu (tidak
#      perlu import tambahan), plus semua yang didefinisikan di
#      skema_pelanggaran.py (pelanggaran_store, PRESET_JENIS_PELANGGARAN,
#      dst -- pastikan skema_pelanggaran.py ditempel LEBIH DULU / DI ATAS
#      blok endpoint ini).
# ============================================================

@app.route('/api/pelanggaran/preset-jenis', methods=['GET'])
@batasi('umum')
def api_pelanggaran_preset_jenis():
    """[BARU] Daftar preset jenis pelanggaran (+ kategori & instruksi
    penebus default per jenis) -- dipakai dropdown "Pilih Jenis" di form
    manual guru utk auto-isi kategori & instruksi penebus (guru masih
    bebas edit sebelum submit)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    return jsonify(success=True, preset=PRESET_JENIS_PELANGGARAN)


@app.route('/api/pelanggaran/siswa-semua', methods=['GET'])
@batasi('berat')
def api_pelanggaran_siswa_semua():
    """[BARU] Daftar SEMUA siswa lintas kelas (username, nama, kelas) --
    dipakai dropdown "Pilih Siswa" di form manual Tambah Pelanggaran.
    Sengaja TIDAK bergantung parameter ?kelas= (beda dari /api/kelas/
    roster yang sudah ada) supaya guru bisa cari siswa dari kelas mana
    pun langsung dari 1 form, tanpa harus pilih kelas dulu."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    hasil = [{
        'username': u['username'],
        'nama': u['fullname'],
        'kelas': u.get('kelas') or '-'
    } for u in users.values() if u.get('role') == 'siswa']
    hasil.sort(key=lambda x: (x['kelas'], x['nama']))
    return jsonify(success=True, siswa=hasil)


@app.route('/api/pelanggaran/tambah', methods=['POST'])
@batasi('umum')
def api_pelanggaran_tambah():
    """[BARU] Guru menambah SATU entri pelanggaran baru lewat Form Manual
    di Halaman Pelanggaran. Kalau instruksi_penebus SUDAH diisi saat
    entri dibuat, entri LANGSUNG berstatus 'menunggu_tugas' (tugas
    penebus sudah dikasih dari awal, siswa tinggal kerjakan). Kalau
    instruksi penebus KOSONG (cuma boleh utk kategori 'ringan'), entri
    dimulai dari status 'aktif' -- guru menyusulkan instruksinya
    belakangan lewat tombol [Kasih Tugas Penebus] di modal detail (lihat
    api_pelanggaran_tugaskan())."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    jenis = (body.get('jenis') or '').strip()[:100]
    kategori = (body.get('kategori') or 'ringan').strip().lower()
    keterangan = (body.get('keterangan') or '').strip()[:500]
    instruksi_penebus = (body.get('instruksi_penebus') or '').strip()[:500]
    deadline = (body.get('deadline') or '').strip() or None  # ISO string dari <input type="datetime-local">

    if not username or username not in users or users[username].get('role') != 'siswa':
        return jsonify(success=False, message='Siswa tidak ditemukan.'), 400
    if not jenis:
        return jsonify(success=False, message='Jenis pelanggaran belum dipilih.'), 400
    if kategori not in KATEGORI_PELANGGARAN:
        kategori = 'ringan'
    if kategori == 'berat' and not instruksi_penebus:
        return jsonify(success=False, message='Kategori berat wajib diisi instruksi penebus, tidak boleh kosong.'), 400

    guru_username = session['user']['username']
    guru_nama = session['user'].get('nama') or guru_username
    sekarang = datetime.utcnow().isoformat()

    if kategori == 'berat':
        status_awal = 'menunggu_bk'
        ditugaskan_at_awal = None
    else:
        status_awal = 'menunggu_tugas' if instruksi_penebus else 'aktif'
        ditugaskan_at_awal = sekarang if instruksi_penebus else None

    entri = {
        'id': _buat_id_pelanggaran(),
        'jenis': jenis,
        'kategori': kategori,
        'keterangan': keterangan,
        'status': status_awal,
        'instruksi_penebus': instruksi_penebus or None,
        'deadline': deadline,
        'bukti': None,
        'catatan_siswa': None,
        'catatan_penolakan': None,
        'alasan_banding': None,
        'dilaporkan_oleh': guru_username,
        'dilaporkan_oleh_nama': guru_nama,
        'dibuat_at': sekarang,
        'ditugaskan_at': ditugaskan_at_awal,
        'dikirim_at': None,
        'ditinjau_oleh': None,
        'ditinjau_oleh_nama': None,
        'diselesaikan_at': None,
        'ditolak_at': None,
        'dibatalkan_oleh': None,
        'dibatalkan_oleh_nama': None,
        'dibatalkan_at': None,
        'auto_acc': False,
        'catatan_auto_acc': None,
        'ditinjau_bk_oleh': None,
        'ditinjau_bk_oleh_nama': None,
        'disetujui_bk_at': None,
        'catatan_bk': None,
    }
    pelanggaran_store.setdefault(username, []).append(entri)
    _simpan_pelanggaran_store()
    if kategori in ('ringan', 'sedang'):
        _tambah_poin_keamanan(username, DEDUKSI_POIN_KATEGORI[kategori],
                              f'Pelanggaran {kategori}: {jenis}')
    return jsonify(success=True, id=entri['id'], status=entri['status'])


@app.route('/api/pelanggaran/tugaskan', methods=['POST'])
@batasi('umum')
def api_pelanggaran_tugaskan():
    """[BARU] Tombol [Kasih Tugas Penebus] -- HANYA valid utk entri
    berstatus 'aktif' (instruksi penebusnya belum diisi sama sekali saat
    dibuat). Guru pelapor entri itu (atau admin) mengisi instruksi +
    deadline sekarang, entri pindah status ke 'menunggu_tugas'."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()
    instruksi_penebus = (body.get('instruksi_penebus') or '').strip()[:500]
    deadline = (body.get('deadline') or '').strip() or None

    if not instruksi_penebus:
        return jsonify(success=False, message='Instruksi penebus tidak boleh kosong.'), 400

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if not _boleh_kelola_pelanggaran(entri):
        return jsonify(success=False, message='Bukan pelanggaran yang kamu laporkan -- tidak bisa dikelola guru lain.'), 403
    if entri['status'] != 'aktif':
        return jsonify(success=False, message='Entri ini sudah punya tugas penebus / bukan status aktif.'), 400

    entri['instruksi_penebus'] = instruksi_penebus
    entri['deadline'] = deadline
    entri['status'] = 'menunggu_tugas'
    entri['ditugaskan_at'] = datetime.utcnow().isoformat()
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id, status='menunggu_tugas')


@app.route('/api/pelanggaran/kirim-bukti', methods=['POST'])
@batasi('upload')
def api_pelanggaran_kirim_bukti():
    """[BARU] Siswa mengirim bukti tugas penebus dari overlay/upload di
    Dashboard Siswa -- HANYA valid kalau entri itu milik siswa yang
    SEDANG LOGIN sendiri (dicek dari sesi, bukan dari body) & berstatus
    'menunggu_tugas'. Foto dikompres pola SAMA PERSIS dgn
    api_tugas_submit() (TUGAS_FOTO_MAX_DIM/QUALITY) supaya konsisten
    (kalau 1 foto gagal, seluruh pengiriman ditolak, sama seperti submit
    tugas biasa)."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401

    username = session['user']['username']
    body = request.get_json(silent=True) or {}
    pelanggaran_id = (body.get('id') or '').strip()
    catatan = (body.get('catatan') or '').strip()[:500]
    bukti_mentah = body.get('bukti') or []

    if not pelanggaran_id:
        return jsonify(success=False, message='id pelanggaran kosong.'), 400
    if not isinstance(bukti_mentah, list) or len(bukti_mentah) == 0:
        return jsonify(success=False, message='Belum ada bukti foto yang dikirim.'), 400

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if entri['status'] != 'menunggu_tugas':
        return jsonify(success=False, message='Entri ini sedang tidak menunggu bukti (mungkin sudah dikirim/di-ACC).'), 400

    bukti_terkompresi = []
    for foto_item in bukti_mentah:
        try:
            foto_baru, _asli, _baru = kompres_gambar_base64(
                foto_item, TUGAS_FOTO_MAX_DIM, TUGAS_FOTO_QUALITY
            )
        except GambarTidakValid as e:
            return jsonify(success=False, message=f'Salah satu foto bukti tidak valid: {e}'), 400
        bukti_terkompresi.append(foto_baru)

    entri['bukti'] = bukti_terkompresi
    entri['catatan_siswa'] = catatan or None
    entri['status'] = 'menunggu_acc'
    entri['dikirim_at'] = datetime.utcnow().isoformat()
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id, status='menunggu_acc')


@app.route('/api/pelanggaran/acc', methods=['POST'])
@batasi('umum')
def api_pelanggaran_acc():
    """[BARU] Guru pelapor (atau admin) meng-ACC bukti tugas penebus yang
    dikirim siswa -- HANYA valid utk status 'menunggu_acc'. Entri pindah
    ke 'selesai' (masuk arsip siswa, & ikut mengurangi/menghilangkan
    penguncian tugas kalau ini pelanggaran belum-selesai TERAKHIR siswa
    itu -- lihat siswa_punya_pelanggaran_mengunci())."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if not _boleh_kelola_pelanggaran(entri):
        return jsonify(success=False, message='Bukan pelanggaran yang kamu laporkan -- tidak bisa di-ACC guru lain.'), 403
    if entri['status'] != 'menunggu_acc':
        return jsonify(success=False, message='Entri ini bukan status menunggu ACC.'), 400

    guru_username = session['user']['username']
    entri['status'] = 'selesai'
    entri['ditinjau_oleh'] = guru_username
    entri['ditinjau_oleh_nama'] = session['user'].get('nama') or guru_username
    entri['diselesaikan_at'] = datetime.utcnow().isoformat()
    _simpan_pelanggaran_store()
    _tambah_poin_keamanan(username, 5, f"ACC tugas penebus: {entri.get('jenis')}")
    return jsonify(success=True, id=pelanggaran_id, status='selesai')


@app.route('/api/pelanggaran/tolak', methods=['POST'])
@batasi('umum')
def api_pelanggaran_tolak():
    """[BARU] Guru pelapor (atau admin) menolak bukti tugas penebus yang
    dikirim siswa (belum memenuhi instruksi) -- HANYA valid utk status
    'menunggu_acc'. Entri BALIK ke 'menunggu_tugas' (bukti & catatan lama
    DIHAPUS supaya siswa mengirim ulang bukti yang baru, bukan numpuk
    bukti lama yang sudah ditolak); instruksi/deadline tetap sama seperti
    sebelumnya KECUALI guru sertakan yang baru di body."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()
    catatan_penolakan = (body.get('catatan_penolakan') or '').strip()[:500]
    instruksi_baru = (body.get('instruksi_penebus') or '').strip()[:500]
    deadline_baru = (body.get('deadline') or '').strip()

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if not _boleh_kelola_pelanggaran(entri):
        return jsonify(success=False, message='Bukan pelanggaran yang kamu laporkan -- tidak bisa ditolak guru lain.'), 403
    if entri['status'] != 'menunggu_acc':
        return jsonify(success=False, message='Entri ini bukan status menunggu ACC.'), 400

    guru_username = session['user']['username']
    entri['status'] = 'menunggu_tugas'
    entri['bukti'] = None
    entri['catatan_siswa'] = None
    entri['dikirim_at'] = None
    entri['ditinjau_oleh'] = guru_username
    entri['ditinjau_oleh_nama'] = session['user'].get('nama') or guru_username
    entri['ditolak_at'] = datetime.utcnow().isoformat()
    entri['catatan_penolakan'] = catatan_penolakan or None
    if instruksi_baru:
        entri['instruksi_penebus'] = instruksi_baru
    if deadline_baru:
        entri['deadline'] = deadline_baru
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id, status='menunggu_tugas')


@app.route('/api/pelanggaran/batalkan-manual', methods=['POST'])
@batasi('umum')
def api_pelanggaran_batalkan_manual():
    """[BARU] Guru pelapor (atau admin) membatalkan SATU entri pelanggaran
    secara manual (mis. ternyata salah catat) -- bisa dari status APA PUN
    KECUALI yang sudah final ('selesai'/'dibatalkan' itu sendiri). Mengisi
    dibatalkan_at + dibatalkan_oleh (field audit, TIDAK PERNAH dikirim ke
    frontend siswa -- lihat pelanggaran_untuk_response())."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if not _boleh_kelola_pelanggaran(entri):
        return jsonify(success=False, message='Bukan pelanggaran yang kamu laporkan -- tidak bisa dibatalkan guru lain.'), 403
    if entri['status'] in STATUS_ARSIP:
        return jsonify(success=False, message='Entri ini sudah selesai/dibatalkan sebelumnya.'), 400

    guru_username = session['user']['username']
    entri['status'] = 'dibatalkan'
    entri['dibatalkan_oleh'] = guru_username
    entri['dibatalkan_oleh_nama'] = session['user'].get('nama') or guru_username
    entri['dibatalkan_at'] = datetime.utcnow().isoformat()
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id, status='dibatalkan')


@app.route('/api/pelanggaran/banding', methods=['POST'])
@batasi('umum')
def api_pelanggaran_banding():
    """[BARU] GANTI tombol WhatsApp lama -- siswa mengajukan banding lewat
    textarea (bukan buka chat WA guru). Alasan disimpan di entrinya
    sendiri (alasan_banding), TIDAK mengubah status/alur tugas penebus --
    murni catatan buat guru/BK pertimbangkan manual. Boleh dipakai
    selama entri belum 'dibatalkan'."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401

    username = session['user']['username']
    body = request.get_json(silent=True) or {}
    pelanggaran_id = (body.get('id') or '').strip()
    alasan = (body.get('alasan_banding') or '').strip()[:500]

    if not pelanggaran_id:
        return jsonify(success=False, message='id pelanggaran kosong.'), 400
    if not alasan:
        return jsonify(success=False, message='Alasan banding tidak boleh kosong.'), 400

    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if entri['status'] == 'dibatalkan':
        return jsonify(success=False, message='Pelanggaran ini sudah dibatalkan.'), 400

    entri['alasan_banding'] = alasan
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id)


# ----------------------------------------------------
# ENDPOINT LAMA -- DISESUAIKAN ke skema baru (path & nama fungsi SAMA
# PERSIS spy frontend lama yang manggil path ini tetap "kena", tapi
# ISINYA diganti total)
# ----------------------------------------------------
@app.route('/api/pelanggaran/semua', methods=['GET'])
@batasi('berat')
def api_pelanggaran_semua():
    """[DISESUAIKAN] Dulu balikin {data, aktif, jumlah} skema lama --
    sekarang balikin 'ringkasan' per siswa (buat badge ⚠️ warna-warni di
    Card Beranda) SEKALIGUS 'data' detail tiap siswa (buat modal),
    keduanya sudah lewat pelanggaran_untuk_response() (field audit
    disaring per guru yang login)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    _proses_auto_acc()

    ringkasan = bangun_ringkasan_semua_siswa()
    data = {}
    for username, daftar in pelanggaran_store.items():
        if not daftar:
            continue
        terurut = _urutkan_pelanggaran_siswa(daftar)
        data[username] = [
            pelanggaran_untuk_response(e, 'guru', _boleh_kelola_pelanggaran(e))
            for e in terurut
        ]
    return jsonify(success=True, ringkasan=ringkasan, data=data)


@app.route('/api/pelanggaran/status', methods=['GET'])
@batasi('umum')
def api_pelanggaran_status():
    """[DISESUAIKAN] Dulu balikin {aktif, daftar_aktif} skema lama --
    sekarang balikin 'daftar_aktif' (entri BELUM selesai milik siswa yang
    login: aktif/menunggu_tugas/menunggu_acc, tetap 1 antrian sama seperti
    sebelumnya) + 'arsip' terpisah (selesai/dibatalkan, buat tab Arsip).
    'mengunci': true kalau MASIH ADA entri belum selesai -- INI yang
    dipakai gantikan cek lama di api_tugas_submit() (lihat
    siswa_punya_pelanggaran_mengunci())."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401
    _proses_auto_acc()
    username = session['user']['username']
    daftar = _urutkan_pelanggaran_siswa(pelanggaran_store.get(username) or [])
    belum_selesai = [e for e in daftar if e['status'] in STATUS_BELUM_SELESAI]
    arsip = [e for e in daftar if e['status'] in STATUS_ARSIP]
    return jsonify(
        success=True,
        mengunci=len(belum_selesai) > 0,
        daftar_aktif=[pelanggaran_untuk_response(e, 'siswa') for e in belum_selesai],
        arsip=[pelanggaran_untuk_response(e, 'siswa') for e in arsip]
    )


@app.route('/api/pelanggaran/daftar', methods=['GET'])
@batasi('umum')
def api_pelanggaran_daftar():
    """[DISESUAIKAN] Dipakai Modal Detail Pelanggaran per siswa (Dashboard
    Guru) -- daftar detail SATU siswa (by ?username=...), sudah lewat
    pelanggaran_untuk_response() (audit disaring per guru yang login)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    _proses_auto_acc()
    username = (request.args.get('username') or '').strip()
    if not username:
        return jsonify(success=False, message='Username siswa kosong.'), 400
    daftar = _urutkan_pelanggaran_siswa(pelanggaran_store.get(username) or [])
    return jsonify(
        success=True,
        username=username,
        daftar=[pelanggaran_untuk_response(e, 'guru', _boleh_kelola_pelanggaran(e)) for e in daftar]
    )


@app.route('/api/pelanggaran/reminder', methods=['GET'])
@batasi('umum')
def api_pelanggaran_reminder():
    """Daftar entri milik guru ini, status 'menunggu_acc' >3 hari."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    _proses_auto_acc()
    guru_username = session['user']['username']
    sekarang = datetime.utcnow()
    hasil = []
    for username, daftar in pelanggaran_store.items():
        for e in daftar:
            if (e.get('status') or 'aktif') != 'menunggu_acc':
                continue
            if e.get('dilaporkan_oleh') != guru_username:
                continue
            basis_iso = e.get('dikirim_at')
            if not basis_iso:
                continue
            try:
                basis = datetime.fromisoformat(basis_iso)
            except ValueError:
                continue
            hari_menunggu = (sekarang - basis).days
            if hari_menunggu >= 3:
                hasil.append({
                    'id': e.get('id'), 'username': username,
                    'nama_siswa': (users.get(username) or {}).get('fullname') or username,
                    'jenis': e.get('jenis'), 'hari_menunggu': hari_menunggu,
                    'dikirim_at_formatted': _format_wib(basis_iso),
                })
    hasil.sort(key=lambda x: -x['hari_menunggu'])
    return jsonify(success=True, jumlah=len(hasil), daftar=hasil)


@app.route('/api/pelanggaran/butuh-aksi', methods=['GET'])
@batasi('umum')
def api_pelanggaran_butuh_aksi():
    """Hitung pelanggaran MILIK guru login: aktif + menunggu_acc + menunggu_bk.
    Prioritas warna badge: aktif (merah) > menunggu_acc (biru) > menunggu_bk (ungu)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    _proses_auto_acc()
    guru_username = session['user']['username']
    jml_aktif = 0
    jml_menunggu_acc = 0
    jml_menunggu_bk = 0
    for daftar in pelanggaran_store.values():
        for e in daftar:
            if e.get('dilaporkan_oleh') != guru_username:
                continue
            st = e.get('status') or 'aktif'
            if st == 'aktif':
                jml_aktif += 1
            elif st == 'menunggu_acc':
                jml_menunggu_acc += 1
            elif st == 'menunggu_bk':
                jml_menunggu_bk += 1
    if jml_aktif > 0:
        warna = 'merah'
    elif jml_menunggu_acc > 0:
        warna = 'biru'
    elif jml_menunggu_bk > 0:
        warna = 'ungu'
    else:
        warna = None
    return jsonify(
        success=True,
        aktif=jml_aktif,
        menunggu_acc=jml_menunggu_acc,
        menunggu_bk=jml_menunggu_bk,
        total=jml_aktif + jml_menunggu_acc + jml_menunggu_bk,
        warna=warna
    )


@app.route('/api/keamanan/poin/status', methods=['GET'])
@batasi('umum')
def api_keamanan_poin_status():
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
    role = session['user']['role']
    me = session['user']['username']
    diminta = (request.args.get('username') or '').strip()
    if role == 'siswa':
        target = me
    elif role == 'guru' or _akun_ini_bk() or _akun_ini_admin_dev():
        target = diminta or me
        if target not in users or users[target].get('role') != 'siswa':
            return jsonify(success=False, message='Siswa tidak ditemukan.'), 400
    else:
        return jsonify(success=False, message='Tidak punya akses.'), 403
    return jsonify(success=True, username=target,
                   **_status_poin_keamanan_response(target))


@app.route('/api/keamanan/poin/manual', methods=['POST'])
@batasi('umum')
def api_keamanan_poin_manual():
    if 'user' not in session or (session['user']['role'] != 'guru' and not _akun_ini_bk()):
        return jsonify(success=False, message='Belum login sebagai guru/BK.'), 401
    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    try:
        delta = int(body.get('delta'))
    except (TypeError, ValueError):
        return jsonify(success=False, message='Jumlah poin tidak valid.'), 400
    catatan = (body.get('catatan') or '').strip()[:300]
    if username not in users or users[username].get('role') != 'siswa':
        return jsonify(success=False, message='Siswa tidak ditemukan.'), 400
    if delta < 1 or delta > 3:
        return jsonify(success=False, message='Poin manual hanya boleh +1 sampai +3.'), 400
    if not catatan:
        return jsonify(success=False, message='Catatan wajib diisi.'), 400
    nama = session['user'].get('nama') or session['user']['username']
    saldo = _tambah_poin_keamanan(username, delta, f'+{delta} manual oleh {nama}: {catatan}')
    return jsonify(success=True, saldo=saldo)


@app.route('/api/pelanggaran/bk/menunggu', methods=['GET'])
@batasi('berat')
def api_pelanggaran_bk_menunggu():
    if not _akun_ini_bk():
        return jsonify(success=False, message='Khusus akun BK.'), 403
    _proses_auto_acc()
    hasil = []
    for username, daftar in pelanggaran_store.items():
        for e in daftar:
            if (e.get('status') or 'aktif') == 'menunggu_bk':
                item = pelanggaran_untuk_response(e, 'guru', True)
                item['username'] = username
                item['nama_siswa'] = (users.get(username) or {}).get('fullname') or username
                hasil.append(item)
    hasil.sort(key=lambda x: x.get('dibuat_at') or '')
    return jsonify(success=True, jumlah=len(hasil), daftar=hasil)


@app.route('/api/pelanggaran/bk/approve', methods=['POST'])
@batasi('umum')
def api_pelanggaran_bk_approve():
    if not _akun_ini_bk():
        return jsonify(success=False, message='Khusus akun BK.'), 403
    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()
    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if entri.get('status') != 'menunggu_bk':
        return jsonify(success=False, message='Bukan status menunggu BK.'), 400
    bk_u = session['user']['username']
    sekarang = datetime.utcnow().isoformat()
    entri['status'] = 'menunggu_tugas' if entri.get('instruksi_penebus') else 'aktif'
    entri['ditugaskan_at'] = sekarang if entri.get('instruksi_penebus') else None
    entri['ditinjau_bk_oleh'] = bk_u
    entri['ditinjau_bk_oleh_nama'] = session['user'].get('nama') or bk_u
    entri['disetujui_bk_at'] = sekarang
    _simpan_pelanggaran_store()
    kategori = entri.get('kategori') or 'berat'
    _tambah_poin_keamanan(username, DEDUKSI_POIN_KATEGORI.get(kategori, -15),
                          f"Pelanggaran berat disetujui BK: {entri.get('jenis')}")
    return jsonify(success=True, id=pelanggaran_id, status=entri['status'])


@app.route('/api/pelanggaran/bk/reject', methods=['POST'])
@batasi('umum')
def api_pelanggaran_bk_reject():
    if not _akun_ini_bk():
        return jsonify(success=False, message='Khusus akun BK.'), 403
    body = request.get_json(silent=True) or {}
    username = (body.get('username') or '').strip()
    pelanggaran_id = (body.get('id') or '').strip()
    catatan = (body.get('catatan') or '').strip()[:500]
    if not catatan:
        return jsonify(success=False, message='Catatan wajib diisi.'), 400
    entri = _cari_entri_pelanggaran(username, pelanggaran_id)
    if not entri:
        return jsonify(success=False, message='Pelanggaran tidak ditemukan.'), 404
    if entri.get('status') != 'menunggu_bk':
        return jsonify(success=False, message='Bukan status menunggu BK.'), 400
    bk_u = session['user']['username']
    bk_n = session['user'].get('nama') or bk_u
    entri['status'] = 'dibatalkan'
    entri['catatan_bk'] = catatan
    entri['ditinjau_bk_oleh'] = bk_u
    entri['ditinjau_bk_oleh_nama'] = bk_n
    entri['dibatalkan_oleh'] = bk_u
    entri['dibatalkan_oleh_nama'] = bk_n
    entri['dibatalkan_at'] = datetime.utcnow().isoformat()
    _simpan_pelanggaran_store()
    return jsonify(success=True, id=pelanggaran_id, status='dibatalkan')



# ----------------------------------------------------
# FITUR MAINTENANCE (khusus akun Admin/Developer -- USERNAME_ADMIN_DEV)
# Admin bisa "mengunci sementara" menu tertentu di Dashboard Siswa (mis.
# lagi ada perbaikan) -- begitu dikunci, SEMUA siswa (di perangkat manapun)
# langsung ketutup overlay & tidak bisa buka tab itu lagi, sedangkan akun
# Admin sendiri tetap bisa akses normal. Sama pola-nya dengan
# pelanggaran_store di atas (server sebagai satu-satunya sumber
# kebenaran, disimpan ke file JSON di disk, dibaca oleh SEMUA akun yang
# login lewat GET /api/maintenance/status).
# Skema: maintenance_store[fitur_id] = True/False
# ----------------------------------------------------
MAINTENANCE_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'maintenance_store.json')

# id fitur yang boleh dikunci -- HARUS SAMA PERSIS dengan
# DAFTAR_FITUR_MAINTENANCE di dashboard_siswa_2.js (kalau nanti nambah/
# hapus fitur yang bisa di-maintenance, ubah DUA tempat ini bareng).
FITUR_MAINTENANCE_VALID = {
    'akademik', 'tugas', 'guru', 'cari-teman',
    'quiz', 'pengumuman', 'kotak-saran', 'ai-support',
}


def _muat_maintenance_store():
    """Baca maintenance_store dari file JSON di disk (kalau ada)."""
    try:
        with open(MAINTENANCE_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _simpan_maintenance_store():
    """Tulis maintenance_store saat ini ke file JSON di disk (atomic, sama
    pola dengan _simpan_pelanggaran_store dkk supaya tidak korup kalau
    ketiban proses lain nulis bersamaan)."""
    os.makedirs(os.path.dirname(MAINTENANCE_STORE_PATH), exist_ok=True)
    tmp_path = MAINTENANCE_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(maintenance_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, MAINTENANCE_STORE_PATH)


maintenance_store = _muat_maintenance_store()


# ----------------------------------------------------
# SISTEM RELEASE NOTES (auto-generate changelog maintenance)
# ----------------------------------------------------
RELEASE_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'release_store.json')
MAINTENANCE_SESI_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'maintenance_sesi.json')


def _muat_release_store():
    try:
        with open(RELEASE_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _simpan_release_store():
    os.makedirs(os.path.dirname(RELEASE_STORE_PATH), exist_ok=True)
    tmp_path = RELEASE_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(release_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, RELEASE_STORE_PATH)


def _muat_maintenance_sesi():
    try:
        with open(MAINTENANCE_SESI_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _simpan_maintenance_sesi():
    os.makedirs(os.path.dirname(MAINTENANCE_SESI_PATH), exist_ok=True)
    tmp_path = MAINTENANCE_SESI_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(maintenance_sesi, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, MAINTENANCE_SESI_PATH)


release_store = _muat_release_store()
maintenance_sesi = _muat_maintenance_sesi()


LABEL_FITUR_MAINTENANCE = {
    'akademik': 'Koleksi Prestasi',
    'tugas': 'Tugas & Catatan',
    'guru': 'Daftar Guru',
    'cari-teman': 'Cari Teman',
    'quiz': 'Quiz & Leaderboard',
    'pengumuman': 'Pengumuman',
    'kotak-saran': 'Kotak Saran',
    'ai-support': 'AI Support',
}


def _hitung_versi_release_berikutnya():
    """VERSI (DIUBAH): SENGAJA dibuat KONSTAN "v1.0" untuk SEMUA release
    -- angka ini mewakili versi APLIKASI secara keseluruhan, jadi harus
    konsisten "v1.0" terus, BUKAN nomor urut per-release yang naik
    otomatis tiap toggle OFF maintenance seperti skema lama (v1.0.0,
    v1.0.1, v1.0.2, dst). Kalau nanti aplikasinya naik versi besar (mis.
    ganti jadi "v2.0"), tinggal ubah string di sini manual -- BUKAN
    dihitung otomatis dari jumlah release lagi."""
    return "v1.0"


def _generate_release_dari_sesi(fitur_id, sesi):
    sekarang_ms = int(time.time() * 1000)
    mulai_ms = sesi.get('mulai', sekarang_ms)
    durasi_menit = max(1, round((sekarang_ms - mulai_ms) / 60000))
    waktu_selesai = datetime.utcnow() + timedelta(hours=7)
    tanggal_tampil = waktu_selesai.strftime('%d %B %Y')
    fitur_nama = LABEL_FITUR_MAINTENANCE.get(fitur_id, fitur_id)
    fitur_baru = sesi.get('fitur_baru', [])
    perbaikan = [{'nama': fitur_nama, 'desc': 'Perbaikan dan peningkatan pada ' + fitur_nama}]
    entry = {
        'id': 'release_' + str(mulai_ms),
        'versi': _hitung_versi_release_berikutnya(),
        'fitur_id': fitur_id,
        'fitur_nama': fitur_nama,
        'mulai': mulai_ms,
        'selesai': sekarang_ms,
        'durasi_menit': durasi_menit,
        'oleh': sesi.get('oleh', 'admin'),
        'fitur_baru': fitur_baru,
        'perbaikan': perbaikan,
        'tanggal_tampil': tanggal_tampil,
    }
    release_store.append(entry)
    _simpan_release_store()
    return entry

# ============================================================
# ROUTE MAINTENANCE & RELEASE NOTES (auto-generate changelog)
# ============================================================

@app.route('/api/maintenance/status', methods=['GET'])
@batasi('umum')
def api_maintenance_status():
    """Dipanggil SEMUA akun yang login tiap Dashboard Siswa dibuka --
    siswa perlu tahu fitur mana yang lagi dikunci supaya overlay
    'Sedang Diperbaiki' ikut muncul di sidebar/bottom-nav mereka."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
    return jsonify(success=True, fitur=maintenance_store)


@app.route('/api/maintenance/toggle', methods=['POST'])
@batasi('umum')
def api_maintenance_toggle():
    """Nyalakan/matikan status maintenance utk satu fitur -- HANYA akun
    Admin/Developer asli.

    OTOMATISASI RELEASE NOTES:
    - Toggle ON  -> catat waktu mulai + siapa yang nyalakan (di maintenance_sesi)
    - Toggle OFF -> pindahkan sesi itu jadi 1 entry release BARU (auto-generate),
                    lengkap dengan versi, durasi, fitur baru (kalau ditandai),
                    & daftar perbaikan.
    """
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Tidak diizinkan.'), 403

    body = request.get_json(silent=True) or {}
    fitur = body.get('fitur')
    aktif = bool(body.get('aktif'))

    if fitur not in FITUR_MAINTENANCE_VALID:
        return jsonify(success=False, message='Fitur tidak dikenal.'), 400

    status_lama = bool(maintenance_store.get(fitur, False))

    # Hanya proses kalau statusnya BENERAN berubah -- hindari double-generate
    # kalau admin klik toggle berkali-kali dengan state yang sama.
    if status_lama != aktif:
        if aktif:
            maintenance_sesi[fitur] = {
                'mulai': int(time.time() * 1000),
                'oleh': session['user'].get('nama') or session['user']['username'],
                'fitur_baru': [],
            }
            _simpan_maintenance_sesi()
        else:
            sesi = maintenance_sesi.pop(fitur, None)
            if sesi:
                _generate_release_dari_sesi(fitur, sesi)
                _simpan_maintenance_sesi()

    maintenance_store[fitur] = aktif
    _simpan_maintenance_store()
    return jsonify(success=True, fitur=maintenance_store)


@app.route('/api/maintenance/tandai-fitur-baru', methods=['POST'])
@batasi('umum')
def api_maintenance_tandai_fitur_baru():
    """Admin menandai fitur baru APA SAJA yang ditambahkan SELAMA maintenance
    fitur tertentu masih aktif. Ditandai SEBELUM toggle OFF, biar begitu
    toggle OFF, entry release otomatis punya info 'fitur baru' ini.

    Body: { fitur: 'ai-support', fitur_baru: [{nama, desc}, ...] }
    """
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Tidak diizinkan.'), 403

    body = request.get_json(silent=True) or {}
    fitur = body.get('fitur')
    if fitur not in FITUR_MAINTENANCE_VALID:
        return jsonify(success=False, message='Fitur tidak dikenal.'), 400

    sesi = maintenance_sesi.get(fitur)
    if not sesi:
        return jsonify(success=False, message='Fitur ini tidak sedang dalam maintenance.'), 400

    daftar = body.get('fitur_baru') or []
    if not isinstance(daftar, list):
        return jsonify(success=False, message='Format fitur_baru tidak valid.'), 400

    bersih = []
    for item in daftar:
        if not isinstance(item, dict):
            continue
        nama = (item.get('nama') or '').strip()[:120]
        desc = (item.get('desc') or '').strip()[:300]
        if nama:
            bersih.append({'nama': nama, 'desc': desc})
    sesi['fitur_baru'] = bersih
    maintenance_sesi[fitur] = sesi
    _simpan_maintenance_sesi()
    return jsonify(success=True, fitur_baru=bersih)


@app.route('/api/releases/list', methods=['GET'])
@batasi('umum')
def api_releases_list():
    """Ambil SEMUA release yang pernah di-generate (lintas fitur & waktu),
    terbaru di atas. Dipakai modal changelog di dashboard siswa."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    terurut = sorted(release_store, key=lambda r: r.get('selesai', 0), reverse=True)
    return jsonify(success=True, data=terurut)


# ----------------------------------------------------
# PROVIDER KONTEKS MAINTENANCE & RELEASE NOTES UNTUK AI SUPPORT
# ----------------------------------------------------
# Didaftarkan ke gemini_routes.py lewat set_maintenance_context_provider()
# -- pola SAMA PERSIS dengan set_quiz_context_provider di bawah (lihat
# _ambil_konteks_quiz_untuk_ai) -- supaya AI Support bisa menjelaskan
# status maintenance & changelog fitur secara DETAIL, tanpa gemini_routes.py
# perlu import balik ke app.py (circular import).
#
# PENTING SOAL PRIVASI/EMBARGO FITUR BARU:
# maintenance_sesi[fitur_id]['fitur_baru'] adalah daftar fitur baru yang
# BARU DITANDAI ADMIN SELAMA maintenance fitur itu MASIH AKTIF (belum
# di-toggle OFF) -- lihat api_maintenance_tandai_fitur_baru di atas. Ini
# SENGAJA TIDAK PERNAH diikutkan di fungsi provider ini. Fitur baru itu
# baru resmi pindah jadi entry `release_store` (dan baru boleh disebut ke
# AI Support) begitu admin toggle OFF fitur bersangkutan (lihat
# _generate_release_dari_sesi, dipanggil dari api_maintenance_toggle).
# Jadi kalau suatu saat AI Support "bocor" cerita fitur baru SEBELUM
# maintenance-nya selesai, itu BUG -- perbaiki di sini, JANGAN pernah
# baca dari maintenance_sesi langsung di fungsi ini.
def _ambil_konteks_maintenance_untuk_ai():
    """Dipanggil gemini_routes.py HANYA saat pesan user terdeteksi
    menanyakan status maintenance/fitur baru (hemat token untuk
    pertanyaan lain). Return dict:
    - 'status': {nama_fitur_tampilan: True/False} -- True = sedang
      maintenance/terkunci, dari maintenance_store (real-time).
    - 'rilis': list ringkas release TERBARU (maks 15 entri, dari
      release_store) -- masing-masing sudah final/sudah diumumkan,
      aman disebutkan secara detail."""
    status_dengan_nama = {
        LABEL_FITUR_MAINTENANCE.get(fid, fid): bool(aktif)
        for fid, aktif in maintenance_store.items()
    }
    rilis_terurut = sorted(release_store, key=lambda r: r.get('selesai', 0), reverse=True)
    # Hemat token: cukup 15 release TERBARU yang disuntik ke prompt --
    # histori lengkap tetap ada/aman di release_store, cuma tidak semua
    # ikut dikirim ke Gemini tiap chat.
    rilis_ringkas = [
        {
            'id': r.get('id'),
            'versi': r.get('versi'),
            'fitur_nama': r.get('fitur_nama'),
            'tanggal_tampil': r.get('tanggal_tampil'),
            'fitur_baru': r.get('fitur_baru') or [],
            'perbaikan': r.get('perbaikan') or [],
        }
        for r in rilis_terurut[:15]
    ]
    return {'status': status_dengan_nama, 'rilis': rilis_ringkas}


set_maintenance_context_provider(_ambil_konteks_maintenance_untuk_ai)


# ----------------------------------------------------
# DATA PENGUMPULAN TUGAS PER SISWA (SIMULASI TABEL task_submissions)
# SEBELUMNYA status "Sudah Kumpul" utk siswa selain akun DEV (id #1) di
# Dashboard Guru CUMA di-generate dari hash(username+task_id) -- artinya
# status & FOTO yang tampil (termasuk foto acak dari picsum.photos) TIDAK
# PERNAH benar-benar berasal dari input siswa ybs, walau kelihatan
# "konsisten" tiap dibuka ulang. Sekarang diganti data ASLI: satu-satunya
# cara entri di sini terisi adalah request POST /api/tugas/submit yang
# datang dari SESI LOGIN siswa ybs sendiri (session['user']['username']),
# membawa foto yang memang dia pilih di browser -- sama seperti akun DEV.
# Skema: tugas_submission_store[task_id][username] =
#   { submitted, images: [...], waktu, waktu_iso, nilai, catatan }
# Disimpan per-siswa (bukan satu flag per-tugas yang dibagi sekelas seperti
# skema lama di tasks_<KELAS>), supaya satu siswa kirim tugas TIDAK ikut
# menandai siswa lain di kelas yang sama sebagai "sudah kumpul".
# ----------------------------------------------------
TUGAS_SUBMISSION_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'tugas_submission_store.json')

# ANTRIAN OFFLINE (antrian_tugas_offline.js di dashboard_siswa): kalau internet siswa
# putus saat menekan Kirim, tugas diantrikan di HP lalu dikirim belakangan.
# Jam pengumpulan boleh memakai WAKTU KLIK dari HP (client_waktu), TAPI hanya kalau:
#   - requestnya membawa client_id (request dari antrian), dan
#   - klik itu tidak di masa depan dan tidak lebih lama dari batas di bawah.
# Kiriman yang tertunda LEBIH dari batas (3 jam) DITOLAK. Klik di masa depan -> jam server.
# Waktu masuk server SELALU dicatat
# terpisah (waktu_masuk_server_iso) supaya guru bisa melihat kiriman yang tertunda.
TUGAS_OFFLINE_MAKS_TUNDA_MENIT = 180        # BATAS MAKSIMAL tanpa internet (klik -> masuk server). Lewat ini: ditolak.
TUGAS_OFFLINE_SELISIH_WAJAR_DETIK = 120     # di bawah ini dianggap kiriman normal (bukan antrian)


def _muat_tugas_submission_store():
    try:
        with open(TUGAS_SUBMISSION_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _simpan_tugas_submission_store():
    os.makedirs(os.path.dirname(TUGAS_SUBMISSION_STORE_PATH), exist_ok=True)
    tmp_path = TUGAS_SUBMISSION_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(tugas_submission_store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, TUGAS_SUBMISSION_STORE_PATH)


tugas_submission_store = _muat_tugas_submission_store()


def _cari_tugas_untuk_siswa(task_id, username):
    """Cari objek tugas (dari sync store, tasks_<KELAS>) KHUSUS di kelas akun siswa.
    Nama kelas dinormalisasi (_samakan_nama_kelas) supaya 'XII TKJ 3/TAV' di akun
    siswa cocok dengan 'tasks_XII_TKJ_3' dari Dashboard Guru. None kalau tidak ketemu."""
    kelas_akun = (users.get(username) or {}).get('kelas')
    if not kelas_akun:
        return None
    target = _samakan_nama_kelas(kelas_akun)
    for kunci, daftar in list(_muat_sync_store().items()):
        m = _POLA_KUNCI_TASKS.fullmatch(kunci)
        if not m or not isinstance(daftar, list) or _samakan_nama_kelas(m.group(1)) != target:
            continue
        for t in daftar:
            if isinstance(t, dict) and t.get('id') == task_id:
                return t
    return None


def _waktu_efektif_kiriman(waktu_masuk_utc, client_id, klik_ms):
    """Tentukan jam pengumpulan. Balikan: (waktu_utc, klik_dipakai_ms, dikirim_offline, pesan_tolak).
    - Bukan kiriman antrian (tanpa client_id/client_waktu): jam server.
    - Kiriman antrian, klik 0..MAKS menit lalu: pakai WAKTU KLIK dari HP.
    - Tertunda LEBIH dari MAKS menit (TUGAS_OFFLINE_MAKS_TUNDA_MENIT, 3 jam): DITOLAK.
    - Klik di masa depan (jam HP maju / tidak valid): jam server."""
    if not (client_id and klik_ms):
        return waktu_masuk_utc, None, False, None
    try:
        klik_utc = datetime.utcfromtimestamp(klik_ms / 1000.0)
    except (OverflowError, OSError, ValueError):
        return waktu_masuk_utc, None, False, None
    selisih = (waktu_masuk_utc - klik_utc).total_seconds()
    if selisih > TUGAS_OFFLINE_MAKS_TUNDA_MENIT * 60:
        m = TUGAS_OFFLINE_MAKS_TUNDA_MENIT
        batas_txt = f"{m // 60} jam" if m % 60 == 0 else f"{m} menit"
        return waktu_masuk_utc, None, True, (
            f"Kiriman tertunda lebih dari {batas_txt} tanpa internet sehingga tidak bisa diterima lagi. "
            "Hubungi gurumu.")
    if selisih >= 0:
        return klik_utc, klik_ms, selisih > TUGAS_OFFLINE_SELISIH_WAJAR_DETIK, None
    return waktu_masuk_utc, None, False, None


def _pesan_tugas_tutup(tugas, entri_lama, waktu_efektif_ms):
    """Tugas TUTUP saat deadline (tidak ada status 'terlambat'). Yang dibandingkan
    adalah WAKTU EFEKTIF pengumpulan: kiriman dari antrian offline memakai waktu klik
    di HP (dalam batas TUGAS_OFFLINE_MAKS_TUNDA_MENIT), jadi tugas yang diklik sebelum
    deadline tetap diterima walau baru sampai server setelah deadline.
    Kalau guru sedang meminta REVISI, yang berlaku adalah batas_revisi (bukan deadline
    awal). Balikan: pesan penolakan (str) atau None kalau masih boleh."""
    if not isinstance(tugas, dict):
        return None
    if (entri_lama or {}).get('keputusan') == 'revisi':
        batas = (entri_lama or {}).get('batas_revisi')
        if isinstance(batas, (int, float)) and waktu_efektif_ms > batas:
            return 'Batas waktu revisi sudah lewat.'
        return None
    deadline = tugas.get('deadlineTimestamp')
    if isinstance(deadline, (int, float)) and waktu_efektif_ms > deadline:
        return 'Tugas sudah ditutup karena melewati deadline.'
    return None


@app.route('/api/tugas/submit', methods=['POST'])
@batasi('upload')
def api_tugas_submit():
    """Siswa yang SEDANG LOGIN mengirim tugas. Ini satu-satunya endpoint yang
    bisa mengubah status pengumpulan tugas suatu akun jadi True -- dan itu
    cuma bisa terjadi kalau requestnya datang dari sesi login akun ybs
    sendiri (tidak bisa 'atas nama' siswa lain), membawa minimal 1 foto.
    Jam pengumpulan dicatat dari JAM SERVER (bukan jam browser siswa) supaya
    tidak bisa dimanipulasi lewat ubah jam device -- KECUALI kiriman dari
    antrian offline (client_id + client_waktu), yang boleh memakai waktu klik
    dari HP, dengan batas tertunda maksimal TUGAS_OFFLINE_MAKS_TUNDA_MENIT (3 jam; lebih dari itu ditolak).
    Request dengan client_id yang sama bersifat IDEMPOTEN (aman dikirim ulang).
    Tugas TUTUP saat deadline: kiriman ditolak 403 kalau waktu efektif pengumpulannya
    melewati deadlineTimestamp tugas (atau batas_revisi kalau sedang diminta revisi)."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401

    body = request.get_json(silent=True) or {}
    task_id = (body.get('task_id') or '').strip()
    images = body.get('images') or []
    if not task_id:
        return jsonify(success=False, message='task_id kosong.'), 400
    if not isinstance(images, list) or len(images) == 0:
        return jsonify(success=False, message='Belum ada foto yang dikirim.'), 400

    # ANTRIAN OFFLINE -- idempotensi. Request dari antrian bisa sampai lebih dari
    # sekali (respons hilang di jaringan jelek, 2 tab terbuka, dst). Kalau
    # client_id yang sama sudah tersimpan, balas sukses TANPA menimpa apa pun --
    # penting supaya keputusan/revisi guru yang sudah masuk tidak ke-reset.
    username = session['user']['username']
    # KUNCI PER KELAS: tugas harus ada di tasks_<KELAS> milik kelas akun ini. Tugas kelas lain
    # (atau ID asal-asalan) ditolak -- dulu "tidak ditemukan -> tidak diblokir". Admin/Dev dikecualikan.
    if not _akun_ini_admin_dev() and _cari_tugas_untuk_siswa(task_id, username) is None:
        return jsonify(success=False, message='Tugas ini tidak ditemukan di kelasmu.'), 403
    client_id = str(body.get('client_id') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_\-]{8,64}', client_id):
        client_id = ''
    try:
        klik_ms = int(body.get('client_waktu')) if client_id else None
    except (TypeError, ValueError):
        klik_ms = None
    lama_awal = (tugas_submission_store.get(task_id) or {}).get(username) or {}
    if client_id and lama_awal.get('client_id') == client_id:
        return jsonify(success=True, waktu=lama_awal.get('waktu'), duplikat=True)
    # Kiriman antrian yang LEBIH TUA dari pengumpulan yang sudah tersimpan tidak
    # boleh menimpa yang lebih baru.
    if client_id and klik_ms and lama_awal.get('klik_ms') and klik_ms < lama_awal['klik_ms']:
        return jsonify(success=True, waktu=lama_awal.get('waktu'), usang=True)

    waktu_masuk_utc = datetime.utcnow()
    waktu_utc, klik_dipakai_ms, dikirim_offline, pesan_tolak_tunda = _waktu_efektif_kiriman(
        waktu_masuk_utc, client_id, klik_ms)
    if pesan_tolak_tunda:
        return jsonify(success=False, message=pesan_tolak_tunda), 403

    # TUGAS TUTUP SAAT DEADLINE (dicek di server, bukan cuma di JavaScript HP siswa).
    # Memakai waktu EFEKTIF di atas. Dicek SEBELUM kompresi foto supaya kiriman yang
    # ditolak tidak membuang CPU. Tugas tidak ditemukan di kelas siswa -> tidak diblokir
    # (perilaku lama dipertahankan).
    waktu_efektif_ms = int((waktu_utc - datetime(1970, 1, 1)).total_seconds() * 1000)
    pesan_tutup = _pesan_tugas_tutup(_cari_tugas_untuk_siswa(task_id, username), lama_awal, waktu_efektif_ms)
    if pesan_tutup:
        return jsonify(success=False, message=pesan_tutup), 403

    # KOMPRESI OTOMATIS (hemat storage jangka panjang): tiap foto tugas
    # di-resize ke maks TUGAS_FOTO_MAX_DIM px + convert ke WebP SEBELUM
    # disimpan. Batasnya sengaja paling longgar dari semua jenis foto di
    # aplikasi ini karena guru/siswa perlu baca tulisan tangan/detail
    # soal dari foto ini -- kalau ADA satu foto yang gagal (format tidak
    # didukung/korup), SELURUH pengumpulan ditolak (bukan cuma foto yang
    # gagal dilewati diam-diam) supaya siswa tahu & bisa kirim ulang foto
    # yang bermasalah.
    images_terkompresi = []
    for foto_item in images:
        try:
            foto_baru, _asli, _baru = kompres_gambar_base64(
                foto_item, TUGAS_FOTO_MAX_DIM, TUGAS_FOTO_QUALITY
            )
        except GambarTidakValid as e:
            return jsonify(success=False, message=f'Salah satu foto tidak valid: {e}'), 400
        images_terkompresi.append(foto_baru)
    images = images_terkompresi

    username = session['user']['username']

    # TUTUP CELAH: sebelumnya penguncian tugas selama "Pelanggaran Aktif"
    # CUMA dicek di JavaScript (dashboard_siswa_pelanggaran.js /
    # dashboard_siswa.js) -- itu gampang dilewati siapa pun yang buka
    # DevTools/Console browser (mis. timpa window.pelanggaranSiswaSedangAktif
    # jadi selalu false, atau langsung fetch() endpoint ini tanpa lewat UI
    # sama sekali). Validasi client-side itu cuma buat UX (kasih feedback
    # instan) -- validasi yang BENAR-BENAR menentukan wajib ada di server,
    # di sinilah tempatnya. Statusnya diambil dari pelanggaran_store
    # berdasarkan SESI LOGIN (session['user']['username']), BUKAN dari
    # field apa pun yang mungkin dikirim client di body request -- supaya
    # tidak bisa dipalsukan dari sisi client dengan cara apa pun.
    if siswa_punya_pelanggaran_mengunci(username):
        return jsonify(
            success=False,
            message='Tugas ini terkunci karena kamu masih berstatus Pelanggaran Aktif. Selesaikan dulu dengan guru/wali kelas.'
        ), 403

    waktu_wib = waktu_utc + timedelta(hours=7)  # WIB = UTC+7

    tugas_submission_store.setdefault(task_id, {})
    lama = tugas_submission_store[task_id].get(username, {})
    tugas_submission_store[task_id][username] = {
        'submitted': True,
        'images': images,
        'waktu': waktu_wib.strftime('%H:%M:%S') + ' WIB',
        'waktu_iso': waktu_utc.isoformat(),
        'nilai': lama.get('nilai'),
        'catatan': lama.get('catatan'),
        # PENTING (fitur "Revisi"): entri lama ditimpa TOTAL oleh dict baru
        # ini -- termasuk 'images' -- jadi begitu siswa kirim ulang tugas
        # (baik pengumpulan pertama maupun revisi), foto LAMA otomatis
        # tidak lagi ada di mana pun (bukan cuma disembunyikan): dict lama
        # dibuang sepenuhnya oleh Python, lalu _simpan_tugas_submission_store()
        # di bawah menulis ULANG seluruh file JSON di disk berisi state
        # BARU ini -- jadi foto lama juga tidak lagi tersimpan di disk
        # server. Field keputusan/alasanKeputusan/waktuKeputusan (diisi
        # guru lewat /api/tugas/keputusan saat menolak/minta revisi) turut
        # di-RESET ke null di sini secara sengaja: begitu siswa mengirim
        # ulang, status "Perlu Revisi"/"Ditolak" otomatis hilang dari sisi
        # siswa maupun guru sampai guru memeriksa & memutuskan lagi.
        'keputusan': None,
        'alasanKeputusan': None,
        'waktuKeputusan': None,
        # Sama seperti keputusan/alasanKeputusan di atas: batas waktu revisi
        # yang mungkin sudah ditentukan guru untuk pengumpulan SEBELUMNYA
        # ikut di-reset begitu siswa kirim ulang -- batas waktu lama sudah
        # tidak relevan lagi buat pengumpulan yang baru ini.
        'batas_revisi': None,
        'batas_revisi_formatted': None,
        # FITUR TAMBAHAN: anotasi foto (coretan warna/lingkaran) yang guru
        # gambar LANGSUNG di atas foto tugas siswa saat "Minta Revisi" --
        # lihat 'foto_anotasi' di api_tugas_keputusan() di bawah. Sama seperti
        # batas_revisi di atas: anotasi utk pengumpulan SEBELUMNYA sudah tidak
        # relevan lagi begitu siswa kirim foto baru, jadi ikut di-reset null.
        'foto_anotasi_revisi': None,
        # Mengirim tugas otomatis berarti sudah dibaca -- kalau sebelumnya
        # belum pernah tercatat 'dibaca' (mis. siswa langsung kirim tanpa
        # sempat ke-detect oleh tandaiTugasDibukaJikaPerlu()), catat juga
        # di sini supaya statusPengerjaan tidak pernah nyangkut di 'belum'.
        'dilihat': True,
        'dilihat_at': lama.get('dilihat_at') or waktu_utc.isoformat(),
        # ANTRIAN OFFLINE: jejak buat idempotensi & transparansi ke guru.
        'client_id': client_id or None,
        'klik_ms': klik_dipakai_ms,
        'dikirim_offline': dikirim_offline,
        'waktu_masuk_server_iso': waktu_masuk_utc.isoformat(),
    }
    _simpan_tugas_submission_store()
    return jsonify(success=True, waktu=tugas_submission_store[task_id][username]['waktu'])


@app.route('/api/tugas/keputusan', methods=['POST'])
@batasi('umum')
def api_tugas_keputusan():
    """Guru menolak / meminta revisi SATU pengumpulan tugas siswa tertentu,
    dari 'Rekap Pengumpulan per Tugas' di Dashboard Guru (tombol "Tolak" /
    "Minta Revisi"). Disimpan LANGSUNG di tugas_submission_store, di kunci
    yang sama dgn nilai/catatan/images (task_id -> username) -- BUKAN lagi
    di sync_store generik keyed by id numerik dummy (skema lama, rawan
    salah kalau roster siswa berubah) -- supaya:
      1) Selalu konsisten dgn identitas ASLI (username sesi login), sama
         seperti submission itu sendiri.
      2) Begitu siswa kirim ulang tugas ini (POST /api/tugas/submit),
         field keputusan/alasanKeputusan di sini OTOMATIS ke-reset jadi
         null (lihat catatan di api_tugas_submit()) -- tidak perlu logic
         tambahan apa pun di sini buat "membersihkan" status revisi lama.

    FITUR TAMBAHAN: keputusan == 'batal' -- guru MENARIK KEMBALI keputusan
    'ditolak'/'revisi' yang sudah diambil (mis. salah pencet / murid
    ternyata sudah benar), TANPA menunggu siswa kirim ulang tugasnya.
    Pengumpulan otomatis balik jadi status normal "Terkumpul" -- semua
    field terkait (keputusan/alasanKeputusan/waktuKeputusan/batas_revisi/
    batas_revisi_formatted) di-reset ke None, sama seperti kalau siswa
    kirim ulang lewat api_tugas_submit(), TAPI foto/nilai/catatan siswa
    yang sudah ada TIDAK ikut disentuh sama sekali. 'alasan' TIDAK wajib
    diisi untuk aksi ini (beda dari 'ditolak'/'revisi').

    Dibatasi HANYA untuk guru yang MEMBUAT tugas ini (pola sama seperti
    api_tugas_nilai())."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    body = request.get_json(silent=True) or {}
    task_id = (body.get('task_id') or '').strip()
    username = (body.get('username') or '').strip()
    keputusan = (body.get('keputusan') or '').strip()
    alasan = (body.get('alasan') or '').strip()
    # FITUR TAMBAHAN: batas waktu revisi -- opsional, cuma dipakai kalau
    # keputusan == 'revisi'. batas_revisi: timestamp epoch ms (int) dari
    # klien atau None; batas_revisi_formatted: teks siap tampil "YYYY-MM-DD
    # Pukul HH:MM WIB" atau None. Divalidasi longgar (bukan wajib diisi,
    # beda dengan 'alasan') supaya guru tetap bisa Minta Revisi tanpa
    # batas waktu khusus.
    batas_revisi_raw = body.get('batas_revisi')
    batas_revisi = None
    if keputusan == 'revisi' and isinstance(batas_revisi_raw, (int, float)):
        batas_revisi = int(batas_revisi_raw)
    batas_revisi_formatted = None
    if keputusan == 'revisi':
        teks = body.get('batas_revisi_formatted')
        if isinstance(teks, str) and teks.strip():
            batas_revisi_formatted = teks.strip()
    # FITUR TAMBAHAN: anotasi foto -- guru bisa menggambar coretan/lingkaran
    # warna LANGSUNG di atas foto tugas siswa (di Dashboard Guru, kanvas HTML5)
    # buat nunjuk persis bagian mana yang perlu direvisi, bukan cuma lewat
    # teks alasan. Dikirim klien sebagai list data-URL PNG (1 elemen per foto
    # yang dianotasi, urutannya SAMA dengan foto aslinya) -- opsional & cuma
    # dipakai kalau keputusan == 'revisi'. Divalidasi longgar (list of str),
    # sama pola dgn batas_revisi di atas.
    foto_anotasi = None
    if keputusan == 'revisi':
        mentah = body.get('foto_anotasi')
        if isinstance(mentah, list) and mentah:
            foto_anotasi = [f for f in mentah if isinstance(f, str) and f.strip()] or None
    if not task_id or not username:
        return jsonify(success=False, message='task_id/username kosong.'), 400
    if keputusan not in ('ditolak', 'revisi', 'batal'):
        return jsonify(success=False, message='Nilai keputusan tidak valid.'), 400
    if keputusan != 'batal' and not alasan:
        return jsonify(success=False, message='Alasan wajib diisi.'), 400

    tolakan = _tolak_jika_bukan_pemilik_tugas(task_id)
    if tolakan:
        return tolakan

    if task_id not in tugas_submission_store or username not in tugas_submission_store[task_id]:
        return jsonify(success=False, message='Data pengumpulan siswa ini tidak ditemukan.'), 404

    if keputusan == 'batal':
        # Menarik keputusan -- balik ke status normal "Terkumpul", TANPA
        # menyentuh submitted/images/waktu/nilai/catatan sama sekali.
        tugas_submission_store[task_id][username]['keputusan'] = None
        tugas_submission_store[task_id][username]['alasanKeputusan'] = None
        tugas_submission_store[task_id][username]['waktuKeputusan'] = None
        tugas_submission_store[task_id][username]['batas_revisi'] = None
        tugas_submission_store[task_id][username]['batas_revisi_formatted'] = None
        tugas_submission_store[task_id][username]['foto_anotasi_revisi'] = None
        _simpan_tugas_submission_store()
        return jsonify(success=True)

    tugas_submission_store[task_id][username]['keputusan'] = keputusan
    tugas_submission_store[task_id][username]['alasanKeputusan'] = alasan
    tugas_submission_store[task_id][username]['waktuKeputusan'] = datetime.utcnow().isoformat()
    # 'ditolak' tidak punya konsep batas waktu revisi -- kalau kebetulan
    # ada nilai lama dari keputusan 'revisi' sebelumnya, bersihkan supaya
    # tidak nyangkut/salah tampil di sisi guru maupun siswa.
    tugas_submission_store[task_id][username]['batas_revisi'] = batas_revisi
    tugas_submission_store[task_id][username]['batas_revisi_formatted'] = batas_revisi_formatted
    tugas_submission_store[task_id][username]['foto_anotasi_revisi'] = foto_anotasi
    _simpan_tugas_submission_store()
    return jsonify(success=True)


def _cari_pemilik_tugas(task_id):
    """Cari nama guru pembuat tugas `task_id`, dengan menyisir semua kunci
    'tasks_<KELAS>' di sync store (tempat daftar tugas per kelas disimpan --
    lihat SYNC_STORE_PATH di bawah). Balikin None kalau task_id tidak
    ditemukan sama sekali ATAU tugasnya tidak punya field namaGuru (tugas
    lama sebelum fitur atribusi guru ada) -- dalam kedua kasus itu endpoint
    pemanggil akan bersikap toleran (tidak memblokir), sama seperti sikap
    tugasIniMilikGuruLogin() di frontend untuk data lama.

    PERBAIKAN KEAMANAN/PRIVASI: sebelumnya endpoint /api/tugas/submissions
    dan /api/tugas/nilai cuma cek "yang login role-nya guru", TANPA cek guru
    MANA -- jadi guru A bisa saja (mis. lewat DevTools/panggil API langsung)
    melihat foto/nilai atau bahkan menimpa nilai tugas yang dibuat guru B,
    walau tombol/menu di UI sudah menyembunyikan itu. Pengecekan kepemilikan
    yang BENAR wajib ada di server seperti ini, karena penyaringan di
    JavaScript cuma soal tampilan dan gampang dilewati."""
    store = _muat_sync_store()
    for kunci, daftar_tugas in store.items():
        if not kunci.startswith('tasks_') or not isinstance(daftar_tugas, list):
            continue
        for tugas in daftar_tugas:
            if isinstance(tugas, dict) and tugas.get('id') == task_id:
                nama_guru = (tugas.get('namaGuru') or '').strip().lower()
                return nama_guru or None
    return None


def _tolak_jika_bukan_pemilik_tugas(task_id):
    """Dipakai bersama oleh endpoint submissions & nilai. Balikin response
    jsonify(...) 403 kalau task_id diketahui milik guru LAIN, atau None
    kalau boleh lanjut (termasuk saat pemiliknya tidak diketahui, demi
    kompatibilitas tugas lama)."""
    pemilik = _cari_pemilik_tugas(task_id)
    nama_guru_login = (session['user'].get('nama') or '').strip().lower()
    if pemilik and pemilik != nama_guru_login:
        return jsonify(
            success=False,
            message='Anda bukan guru yang memberi tugas ini, jadi tidak bisa membuka pengumpulannya.'
        ), 403
    return None


@app.route('/api/tugas/submissions/<task_id>', methods=['GET'])
@batasi('berat')
def api_tugas_submissions(task_id):
    """Guru mengambil status pengumpulan ASLI SEMUA siswa untuk SATU tugas
    (dipakai buat rekap roster di Dashboard Guru) -- menggantikan simulasi
    hash yang lama. Kalau belum ada satupun siswa yang kirim, hasilnya
    objek kosong -- BUKAN data acak.

    Dibatasi HANYA untuk guru yang MEMBUAT tugas ini (lihat
    _tolak_jika_bukan_pemilik_tugas) -- foto/pengumpulan siswa untuk satu
    tugas tidak boleh terbuka ke guru lain di luar yang bersangkutan."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    tolakan = _tolak_jika_bukan_pemilik_tugas(task_id)
    if tolakan:
        return tolakan
    return jsonify(success=True, submissions=tugas_submission_store.get(task_id, {}))


def _ringkas_entri_submisi(entri):
    """Salinan entri submisi TANPA foto base64: 'images' diganti 'jumlah_foto',
    daftar data-URL lain (mis. foto_anotasi_revisi) diganti 'jumlah_<nama field>'."""
    hasil = {}
    for k, v in (entri or {}).items():
        if k == 'images':
            hasil['jumlah_foto'] = len(v) if isinstance(v, list) else 0
        elif isinstance(v, str) and v.startswith('data:'):
            continue
        elif isinstance(v, list) and any(isinstance(x, str) and x.startswith('data:') for x in v):
            hasil['jumlah_' + k] = len(v)
        else:
            hasil[k] = v
    return hasil


@app.route('/api/tugas/submissions-ringkas', methods=['GET'])
@batasi('berat')
def api_tugas_submissions_ringkas():
    """Status pengumpulan BANYAK tugas sekaligus (?ids=a,b,c) tanpa foto --
    dipakai polling badge 'Perlu Dinilai' di Dashboard Guru supaya tidak perlu
    mengunduh seluruh foto siswa tiap 30 detik. Aturan kepemilikan SAMA dengan
    /api/tugas/submissions/<id>: tugas milik guru lain tidak disertakan
    (frontend memperlakukannya seperti gagal ambil, bukan kosong)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    ids = []
    for i in (request.args.get('ids') or '').split(','):
        i = i.strip()
        if i and i not in ids:
            ids.append(i)
    ids = ids[:100]
    ids_set = set(ids)

    # Peta pemilik dibangun SEKALI (bukan memindai seluruh sync_store per tugas).
    pemilik = {}
    for kunci, daftar_tugas in _muat_sync_store().items():
        if not kunci.startswith('tasks_') or not isinstance(daftar_tugas, list):
            continue
        for tugas in daftar_tugas:
            if isinstance(tugas, dict) and tugas.get('id') in ids_set:
                pemilik[tugas['id']] = (tugas.get('namaGuru') or '').strip().lower() or None
    nama_login = (session['user'].get('nama') or '').strip().lower()

    hasil = {}
    for task_id in ids:
        if pemilik.get(task_id) and pemilik[task_id] != nama_login:
            continue
        hasil[task_id] = {
            username: _ringkas_entri_submisi(entri)
            for username, entri in tugas_submission_store.get(task_id, {}).items()
        }
    return jsonify(success=True, submissions=hasil)


@app.route('/api/tugas/submission/<task_id>', methods=['GET'])
@batasi('umum')
def api_tugas_submission_diri_sendiri(task_id):
    """Siswa cek status pengumpulan tugas MILIKNYA SENDIRI (per akun),
    dipakai Dashboard Siswa supaya status 'Sudah Dikirim' tidak lagi
    kebawa/ketuker ke siswa lain di kelas yang sama seperti skema lama
    (tasks_<KELAS> yang satu flag dibagi sekelas). 'dilihat' disertakan
    juga di sini (lihat api_tugas_dibaca() di bawah) supaya kartu tugas
    bisa langsung tahu status "Sedang Dikerjakan"-nya sendiri."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401
    username = session['user']['username']
    entri = tugas_submission_store.get(task_id, {}).get(username)
    return jsonify(success=True, data=entri or {'submitted': False, 'dilihat': False})


@app.route('/api/tugas/dibaca', methods=['POST'])
@batasi('umum')
def api_tugas_dibaca():
    """Siswa menandai SATU tugas sebagai 'sudah dibuka/dibaca' oleh dirinya
    sendiri, TEPAT SAAT konten lengkapnya benar-benar ditampilkan (lihat
    tandaiTugasDibukaJikaPerlu() di dashboard_siswa.js) -- dipakai Dashboard
    Guru supaya status tugas siswa ybs otomatis pindah dari "Belum
    Dikerjakan" ke "Sedang Dikerjakan" (lihat sinkronkanSubmissionAsliSiswaID1()
    & renderPenilaianTugas() di dashboard_guru.js), lintas perangkat.

    Disimpan di tugas_submission_store -- skema SAMA PERSIS dengan status
    pengumpulan (per-siswa per-tugas), BUKAN lagi field isViewedByStudent
    yang dulu ikut ditulis ke tasks_<KELAS> yang dibagi SEKELAS. Skema lama
    itu berisiko: siswa yang menyimpan balik status "dibuka"-nya bisa
    menimpa daftar tugas sekelas dengan salinan yang sudah basi (kalau ada
    tugas baru dari guru masuk di antara waktu siswa fetch & simpan ulang),
    berpotensi bikin tugas baru itu hilang dari Dashboard Siswa lain.
    Endpoint ini TIDAK PERNAH menyentuh tasks_<KELAS> sama sekali, jadi
    risiko itu tidak ada lagi. Idempotent: dipanggil berkali-kali aman,
    tidak menimpa 'dilihat_at' yang sudah tercatat."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login sebagai siswa.'), 401
    body = request.get_json(silent=True) or {}
    # Terima 1 task_id (klien lama) ATAU banyak sekaligus lewat task_ids (klien baru, digabung).
    daftar_id = body.get('task_ids')
    if not isinstance(daftar_id, list):
        daftar_id = [body.get('task_id')]
    daftar_id = [str(x).strip() for x in daftar_id if x and str(x).strip()][:50]
    if not daftar_id:
        return jsonify(success=False, message='task_id kosong.'), 400

    username = session['user']['username']
    if not _akun_ini_admin_dev():
        daftar_id = [x for x in daftar_id if _cari_tugas_untuk_siswa(x, username) is not None]
        if not daftar_id:
            return jsonify(success=False, message='Tugas tidak ditemukan di kelasmu.'), 403
    berubah = False
    for task_id in daftar_id:
        tugas_submission_store.setdefault(task_id, {})
        entri = tugas_submission_store[task_id].get(username)
        if not entri:
            tugas_submission_store[task_id][username] = {
                'submitted': False,
                'images': [],
                'waktu': None,
                'waktu_iso': None,
                'nilai': None,
                'catatan': None,
                'dilihat': True,
                'dilihat_at': datetime.utcnow().isoformat(),
            }
            berubah = True
        elif not entri.get('dilihat'):
            entri['dilihat'] = True
            entri['dilihat_at'] = datetime.utcnow().isoformat()
            berubah = True
    if berubah:
        _simpan_tugas_submission_store()
    return jsonify(success=True)


@app.route('/api/tugas/nilai', methods=['POST'])
@batasi('umum')
def api_tugas_nilai():
    """Guru memberi nilai/catatan ke pengumpulan tugas SATU siswa tertentu.

    Dibatasi HANYA untuk guru yang MEMBUAT tugas ini (lihat
    _tolak_jika_bukan_pemilik_tugas) -- tanpa ini, guru A bisa saja mengubah
    nilai/catatan tugas buatan guru B lewat panggilan API langsung."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    body = request.get_json(silent=True) or {}
    task_id = (body.get('task_id') or '').strip()
    username = (body.get('username') or '').strip()
    if not task_id or not username:
        return jsonify(success=False, message='task_id/username kosong.'), 400
    tolakan = _tolak_jika_bukan_pemilik_tugas(task_id)
    if tolakan:
        return tolakan
    if task_id not in tugas_submission_store or username not in tugas_submission_store[task_id]:
        return jsonify(success=False, message='Data pengumpulan tidak ditemukan.'), 404
    tugas_submission_store[task_id][username]['nilai'] = body.get('nilai')
    tugas_submission_store[task_id][username]['catatan'] = body.get('catatan')
    _simpan_tugas_submission_store()
    return jsonify(success=True)


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

# ----------------------------------------------------
# GENERIC KEY-VALUE SYNC STORE
# ----------------------------------------------------
# Dulu banyak data (daftar tugas per kelas, notifikasi tugas ditarik guru,
# dll) cuma disimpan di localStorage browser -- artinya data itu NEMPEL di
# satu device/browser doang dan TIDAK sinkron antara HP & laptop walau
# login akun yang sama. Store generik ini jadi "localStorage versi server":
# dashboard_guru.html & dashboard_siswa.html simpan/ambil data pakai kunci
# yang SAMA PERSIS dengan nama kunci localStorage lama (mis. 'tasks_XII_TKJ_3',
# 'notif_tugas_XII_TKJ_3'), tapi sekarang datanya betulan disimpan di sini
# (file JSON di server) sehingga device mana pun yang buka dashboard akan
# baca data yang sama.
SYNC_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'sync_store.json')

# CATATAN PERBAIKAN PERFORMA: sebelumnya _muat_sync_store() membaca ULANG
# file JSON dari disk di SETIAP request GET -- dikombinasikan dengan
# frontend yang dulu memanggil endpoint ini sekali per kelas (lihat
# perbaikan getTasksKelas() di dashboard_guru.html), ini jadi puluhan
# operasi baca-file per kali halaman dibuka. Sekarang isi file di-cache di
# memori proses dan HANYA dibaca ulang dari disk sekali saat proses start,
# lalu di-invalidasi (diperbarui) sendiri tiap kali _simpan_sync_store()
# menulis data baru -- jadi tetap konsisten, tanpa baca file berulang.
_sync_store_cache = None
_sync_store_lock = threading.Lock()


def _muat_sync_store():
    global _sync_store_cache
    with _sync_store_lock:
        if _sync_store_cache is None:
            try:
                with open(SYNC_STORE_PATH, 'r', encoding='utf-8') as f:
                    _sync_store_cache = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                _sync_store_cache = {}
        return _sync_store_cache


def _simpan_sync_store(store):
    global _sync_store_cache
    os.makedirs(os.path.dirname(SYNC_STORE_PATH), exist_ok=True)
    tmp_path = SYNC_STORE_PATH + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(store, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp_path, SYNC_STORE_PATH)
    with _sync_store_lock:
        _sync_store_cache = store


# ----------------------------------------------------
# HEMAT KUOTA: ETag + 304 Not Modified untuk GET sync, dan /ping ringan
# ----------------------------------------------------
# Browser mengirim If-None-Match otomatis; kalau data tidak berubah server
# membalas 304 TANPA body (~200 byte) -- polling tiap beberapa detik jadi
# hampir gratis di kuota. "private, no-cache" = selalu validasi ke server
# (data tetap real-time), tapi body hanya dikirim kalau memang berubah.
def _json_etag(payload):
    resp = jsonify(payload)
    resp.add_etag()
    resp.headers['Cache-Control'] = 'private, no-cache'
    return resp.make_conditional(request)


@app.after_request
def _etag_otomatis_api_get(response):
    """Semua GET /api/* yang membalas JSON 200 otomatis dapat ETag -> polling yang
    datanya tidak berubah dibalas 304 tanpa body (hemat kuota, tanpa ubah tiap endpoint)."""
    try:
        if (request.method == 'GET' and request.path.startswith('/api/')
                and response.status_code == 200 and response.mimetype == 'application/json'
                and not response.direct_passthrough and 'ETag' not in response.headers):
            response.add_etag()
            response.headers.setdefault('Cache-Control', 'private, no-cache')
            response.vary.add('Cookie')
            response.make_conditional(request)
    except Exception as exc:
        print(f"[WARN] etag otomatis gagal: {exc}")
    return response


@app.route('/ping', methods=['GET', 'HEAD'])
def ping():
    """Dipakai status_koneksi.js: tanpa session/DB/log, balasan kosong 204."""
    r = app.response_class(status=204)
    r.headers['Cache-Control'] = 'no-store'
    return r


@app.route('/api/sync/<kunci>', methods=['GET'])
@batasi('berat')
def api_sync_get(kunci):
    """Ambil data yang tersimpan di server untuk 1 kunci (mis. 'tasks_XII_TKJ_3')."""
    if 'user' not in session:
        return jsonify({'ok': False, 'error': 'Belum login'}), 401
    # OTORISASI BACA (server-side): dicek SEBELUM menyentuh store, jadi respons
    # 403 identik untuk kunci yang ada maupun tidak -- tidak bocor isi/keberadaan.
    if not _sync_boleh_baca(kunci):
        return jsonify({'ok': False, 'error': 'Tidak berhak mengakses data ini'}), 403
    store = _muat_sync_store()
    # None (bukan [] atau {}) kalau kuncinya belum pernah disimpan -- biar
    # client yang tahu persis "kunci ini kosong" dan bisa pakai fallback-nya
    # sendiri (array kosong, null, dsb) sesuai jenis data yang dia harapkan.
    return _json_etag({'ok': True, 'data': store.get(kunci, None)})


# ----------------------------------------------------
# OTORISASI TULIS SYNC STORE  (PRIORITAS 1 KEAMANAN)
# ----------------------------------------------------
# Sebelumnya POST /api/sync/<kunci> cuma cek "sudah login" lalu menimpa
# kunci APA PUN dengan isi dari client -- siswa mana pun bisa menimpa
# tasks_<KELAS> kelas lain, mengganti namaGuru, atau menulis kunci asal.
# Sekarang: (1) kunci wajib cocok allowlist di bawah, (2) hak tulis
# ditentukan dari ROLE & KELAS di session/server (users[username]['kelas']),
# BUKAN dari apa pun yang dikirim client, (3) kalau tidak cocok -> ditolak
# (fail closed). Format response sukses tidak berubah: {'ok': True}.
#
#   tasks_<KELAS>          -> guru/admin saja. Siswa TIDAK PERNAH menulis di sini
#                             (status kumpul/dibaca siswa lewat /api/tugas/*).
#                             Tugas milik guru lain tidak bisa diubah/dihapus,
#                             dan namaGuru dicap dari session (bukan dari client).
#   notif_tugas_<KELAS>    -> guru/admin bebas; siswa HANYA kelasnya sendiri dan
#                             HANYA boleh menandai dibaca=true notif yang sudah ada.
#   hasilPeriksaTugas_*    -> guru/admin saja (nilai tugas).
#   kunci lain             -> ditolak.
_POLA_KELAS_SYNC = r'[A-Za-z0-9_\-]{1,60}'
_POLA_KUNCI_TASKS = re.compile(r'tasks_(' + _POLA_KELAS_SYNC + r')')
_POLA_KUNCI_NOTIF = re.compile(r'notif_tugas_(' + _POLA_KELAS_SYNC + r')')
_POLA_KUNCI_HASIL = re.compile(r'hasilPeriksaTugas_[A-Za-z0-9_\-]{1,150}')
_sync_tulis_lock = threading.Lock()


def _norm_nama(teks):
    return ' '.join(str(teks or '').strip().lower().split())


def _sesi_guru_atau_admin():
    """True hanya untuk role 'guru' ASLI atau akun Admin/Dev ASLI -- dicek dari
    session Flask, bukan dari data kiriman client."""
    if 'user' not in session:
        return False
    return session['user'].get('role') == 'guru' or _akun_ini_admin_dev()


def _sesi_siswa_biasa():
    return ('user' in session
            and session['user'].get('role') == 'siswa'
            and not _akun_ini_admin_dev())


def _kelas_cocok_akun_siswa(kelas_dari_client):
    """Kelas yang diklaim client harus sama dengan kelas akun di SERVER
    (users[username]['kelas']). Akun tanpa kelas -> ditolak (fail closed)."""
    kelas_akun = (users.get(session['user'].get('username')) or {}).get('kelas')
    if not kelas_akun or not kelas_dari_client:
        return False
    return _samakan_nama_kelas(kelas_akun) == _samakan_nama_kelas(kelas_dari_client)


def _gabung_tasks_guru(lama, baru, nama_login):
    """Gabungkan tasks_<KELAS> kiriman guru dengan versi server.
    - tugas baru: namaGuru dicap = nama guru di session
    - tugas milik guru LAIN: versi server yang dipakai (edit/hapus diabaikan)
    - tugas milik sendiri: boleh diubah, tapi namaGuru tidak boleh diganti
    - tugas lama tanpa namaGuru: boleh disimpan, namaGuru orang lain diabaikan
    Balikin None kalau datanya tidak valid."""
    nama_norm = _norm_nama(nama_login)
    if not nama_norm:
        return None
    lama = lama if isinstance(lama, list) else []
    lama_by_id = {}
    for t in lama:
        if isinstance(t, dict) and isinstance(t.get('id'), (str, int)) and t.get('id') != '':
            lama_by_id[t['id']] = t
    hasil, dipakai = [], set()
    for t in baru:
        if not isinstance(t, dict) or not isinstance(t.get('id'), (str, int)) or t.get('id') == '':
            return None
        tid = t['id']
        if tid in dipakai:
            continue
        dipakai.add(tid)
        old = lama_by_id.get(tid)
        item = dict(t)
        if old is None:
            item['namaGuru'] = nama_login
            # Waktu kirim dicap SERVER (epoch ms), bukan dari jam browser: dipakai fitur
            # reminder mengajar untuk menentukan tugas ini milik sesi yang mana & untuk info
            # "guru lain sudah memberi tugas". Client tidak bisa memundurkan/memajukan waktunya.
            item['waktuKirimGuru'] = int(time.time() * 1000)
        else:
            pemilik = _norm_nama(old.get('namaGuru'))
            if pemilik and pemilik != nama_norm:
                item = old
            elif pemilik:
                item['namaGuru'] = old.get('namaGuru')
            else:
                if _norm_nama(item.get('namaGuru')) not in ('', nama_norm):
                    item.pop('namaGuru', None)
        # Edit tugas tidak boleh mengubah waktu kirim asli (dipertahankan dari versi server).
        if old is not None and item is not old:
            if 'waktuKirimGuru' in old:
                item['waktuKirimGuru'] = old['waktuKirimGuru']
            else:
                item.pop('waktuKirimGuru', None)
        hasil.append(item)
    for tid, old in lama_by_id.items():
        if tid not in dipakai:
            pemilik = _norm_nama(old.get('namaGuru'))
            if pemilik and pemilik != nama_norm:
                hasil.append(old)
    return hasil


@app.route('/api/sync/<kunci>', methods=['POST'])
@batasi('umum')
def api_sync_set(kunci):
    """Timpa data untuk 1 kunci dengan data baru dari client -- SEKARANG hanya
    kalau kunci ada di allowlist dan role/kelas di session berhak menulisnya
    (lihat catatan OTORISASI TULIS SYNC STORE di atas)."""
    if 'user' not in session:
        return jsonify({'ok': False, 'error': 'Belum login'}), 401
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or 'data' not in payload:
        return jsonify({'ok': False, 'error': 'Data tidak valid'}), 400
    data = payload['data']
    boleh_guru = _sesi_guru_atau_admin()
    admin = _akun_ini_admin_dev()

    if _POLA_KUNCI_TASKS.fullmatch(kunci):
        if not boleh_guru:
            return jsonify({'ok': False, 'error': 'Tidak berhak mengubah data tugas'}), 403
        if not isinstance(data, list):
            return jsonify({'ok': False, 'error': 'Data tidak valid'}), 400
        with _sync_tulis_lock:
            store = _muat_sync_store()
            if admin:
                hasil = [t for t in data if isinstance(t, dict)]
            else:
                hasil = _gabung_tasks_guru(store.get(kunci), data, session['user'].get('nama'))
            if hasil is None:
                return jsonify({'ok': False, 'error': 'Data tugas tidak valid'}), 400
            store[kunci] = hasil
            _simpan_sync_store(store)
        return jsonify({'ok': True})

    m_notif = _POLA_KUNCI_NOTIF.fullmatch(kunci)
    if m_notif:
        if not isinstance(data, list):
            return jsonify({'ok': False, 'error': 'Data tidak valid'}), 400
        if boleh_guru:
            if not all(isinstance(n, dict) for n in data):
                return jsonify({'ok': False, 'error': 'Data tidak valid'}), 400
            with _sync_tulis_lock:
                store = _muat_sync_store()
                store[kunci] = data
                _simpan_sync_store(store)
            return jsonify({'ok': True})
        if _sesi_siswa_biasa():
            if not _kelas_cocok_akun_siswa(m_notif.group(1)):
                return jsonify({'ok': False, 'error': 'Bukan kelas Anda'}), 403
            dibaca_masuk = {n['id'] for n in data
                            if isinstance(n, dict) and isinstance(n.get('id'), str) and n.get('dibaca') is True}
            with _sync_tulis_lock:
                store = _muat_sync_store()
                daftar = store.get(kunci)
                if isinstance(daftar, list) and dibaca_masuk:
                    berubah = False
                    for n in daftar:
                        if isinstance(n, dict) and n.get('id') in dibaca_masuk and n.get('dibaca') is not True:
                            n['dibaca'] = True
                            berubah = True
                    if berubah:
                        _simpan_sync_store(store)
            return jsonify({'ok': True})
        return jsonify({'ok': False, 'error': 'Tidak berhak'}), 403

    if _POLA_KUNCI_HASIL.fullmatch(kunci):
        if not boleh_guru:
            return jsonify({'ok': False, 'error': 'Tidak berhak memberi nilai'}), 403
        if not isinstance(data, dict):
            return jsonify({'ok': False, 'error': 'Data tidak valid'}), 400
        with _sync_tulis_lock:
            store = _muat_sync_store()
            store[kunci] = data
            _simpan_sync_store(store)
        return jsonify({'ok': True})

    return jsonify({'ok': False, 'error': 'Kunci sync tidak dikenali'}), 403


def _sync_boleh_baca(kunci):
    """OTORISASI BACA sync store (dipakai GET satuan & GET bulk).
    Identitas, role, dan kelas HANYA dari session Flask + data users di server
    -- tidak pernah dari query/body/header client.
      - guru / admin-dev ASLI : akses baca seperti sebelumnya (tidak diubah).
      - siswa biasa           : hanya tasks_<KELAS> & notif_tugas_<KELAS> untuk
                                KELAS AKUNNYA SENDIRI. hasilPeriksaTugas_* (nilai)
                                dan kunci lain -> ditolak.
      - role lain / tanpa kelas : ditolak (fail closed)."""
    if 'user' not in session:
        return False
    if _sesi_guru_atau_admin():
        return True
    if _sesi_siswa_biasa():
        m = _POLA_KUNCI_TASKS.fullmatch(kunci) or _POLA_KUNCI_NOTIF.fullmatch(kunci)
        return bool(m) and _kelas_cocok_akun_siswa(m.group(1))
    return False


@app.route('/api/sync/bulk', methods=['GET'])
@batasi('berat')
def api_sync_bulk_get():
    """Versi 'banyak sekaligus' dari /api/sync/<kunci> GET -- terima daftar
    kunci dipisah koma lewat query string (?kunci=tasks_X,tasks_Y,...) dan
    balikkan semuanya dalam SATU response. Dibuat supaya frontend yang
    sebelumnya harus request satu-satu per kelas (lihat komentar di
    getTasksKelas() / muatCacheSemuaTugas() di dashboard_guru.html) bisa
    jadi cukup 1 request untuk semua kelas sekaligus."""
    if 'user' not in session:
        return jsonify({'ok': False, 'error': 'Belum login'}), 401
    daftar_kunci = [k.strip() for k in (request.args.get('kunci') or '').split(',') if k.strip()]
    # OTORISASI BACA per kunci (server-side). Kunci yang tidak berhak DIBUANG
    # dari response (isinya tidak pernah disentuh). Kalau SEMUA kunci yang
    # diminta ditolak -> 403. Format response tetap {'ok', 'data': {kunci: nilai}}.
    kunci_boleh = [k for k in daftar_kunci if _sync_boleh_baca(k)]
    if daftar_kunci and not kunci_boleh:
        return jsonify({'ok': False, 'error': 'Tidak berhak mengakses data ini'}), 403
    store = _muat_sync_store()
    return _json_etag({'ok': True, 'data': {k: store.get(k, None) for k in kunci_boleh}})
 
 
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
    return ''.join(secrets.choice(string.digits) for _ in range(OTP_LENGTH))
 
 
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
        # Rate limit di sini (bukan decorator di seluruh route) supaya
        # cuma PERCOBAAN login (POST) yang dibatasi -- membuka halaman
        # /login (GET) tetap bebas, tidak ikut jatah yang sama.
        if not _cek_dan_catat_rate_limit('login'):
            pesan_gagal = 'Terlalu banyak percobaan login. Coba lagi sebentar ya.'
            is_ajax_limit = request.headers.get('X-Requested-With') == 'XMLHttpRequest'
            flash(pesan_gagal, 'error')
            if is_ajax_limit:
                return jsonify(success=False, message=pesan_gagal), 429
            return redirect(url_for('login'))

        role = request.form.get('role')
        username = (request.form.get('username') or '').strip()[:64]
        password = request.form.get('password') or ''

        # Deteksi apakah ini request AJAX dari login.html (fetch dengan header
        # X-Requested-With) -- kalau iya, balas JSON supaya frontend bisa tahu
        # hasil valid/tidaknya SEBELUM animasi transisi selesai (lihat login.html),
        # jadi animasi "berhasil" (centang) hanya main kalau memang berhasil, dan
        # animasi "gagal" (silang) main kalau username/password/role salah.
        is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

        # Lockout brute-force per akun -- dicek SEBELUM password diperiksa.
        if _login_sedang_dikunci(username):
            pesan_kunci = 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.'
            flash(pesan_kunci, 'error')
            if is_ajax:
                resp = jsonify(success=False, message=pesan_kunci)
                resp.status_code = 429
                resp.headers['Retry-After'] = '60'
                return resp
            return redirect(url_for('login'))

        # Cari akun berdasarkan USERNAME dulu (role dicek terpisah di bawah), supaya
        # frontend bisa diberi tahu KOLOM mana yang salah: username / password / role.
        kandidat = [u for u in users.values() if u.get('username') == username]
        user_sesuai = next((u for u in kandidat if u.get('role') == role), None)
        akun_dicek = user_sesuai or (kandidat[0] if kandidat else None)
        username_ada = akun_dicek is not None

        # SELALU jalankan 1x verifikasi hash (pakai hash palsu kalau akun tidak
        # ada) supaya waktu respons tidak membocorkan username mana yang valid.
        hash_target = akun_dicek.get('password') if akun_dicek else None
        hash_valid = isinstance(hash_target, str) and _password_sudah_hash(hash_target)
        if not hash_valid:
            hash_target = _HASH_PALSU
        password_cocok = check_password_hash(hash_target, password[:PASSWORD_MAKS_PANJANG + 1])
        if len(password) > PASSWORD_MAKS_PANJANG or not hash_valid:
            password_cocok = False

        # Penentuan kolom yang salah: username -> password -> role. Role baru
        # dinyatakan salah SETELAH password terbukti benar, jadi pihak yang tidak
        # punya password tidak bisa menebak role sebuah akun lewat kolom ini.
        if not username_ada:
            kolom_salah = 'username'
        elif not password_cocok:
            kolom_salah = 'password'
        elif user_sesuai is None:
            kolom_salah = 'role'
        else:
            kolom_salah = None

        if kolom_salah:
            _catat_login_gagal(username)
            # Respons NON-AJAX (tanpa JavaScript) tetap memakai pesan GENERIK. Hanya
            # respons AJAX dari login.html yang menyertakan 'field' supaya kolom yang
            # salah bisa ditandai merah (username / password / role).
            pesan_gagal = 'Username, password, atau role salah!'
            flash(pesan_gagal, 'error')
            if is_ajax:
                return jsonify(success=False, message=pesan_gagal, field=kolom_salah)
            return redirect(url_for('login'))

        user = user_sesuai

        _reset_login_gagal(username)

        # Master Device / approval device dihilangkan dulu -- login sekarang
        # langsung jalan begitu username/password/role cocok, tanpa perlu
        # persetujuan dari perangkat lain.
        return _finish_login(user, is_ajax)


def _finish_login(user, is_ajax=False):
    """Set session login."""
    # PERBAIKAN: wajib di-set True supaya session ikut umur
    # PERMANENT_SESSION_LIFETIME di atas (12 jam), bukan session cookie
    # sementara yang gampang hilang sebelum browser ditutup -- lihat catatan
    # besar di app.config['PERMANENT_SESSION_LIFETIME'].
    # REGENERATE SESSION: buang seluruh isi session lama (mencegah session
    # fixation / sisa data akun sebelumnya), lalu buat session baru dengan
    # ID acak baru. session.permanent WAJIB di-set SETELAH clear() karena
    # clear() ikut menghapus flag permanent-nya.
    session.clear()
    session['_sid'] = secrets.token_urlsafe(32)
    session.permanent = True
    session['user'] = {
        'nama': user.get('fullname', user['username']),
        'username': user['username'],
        'role': user['role'],
        # NISN siswa (field aslinya bernama 'identity_number' di data users)
        # -- dipakai AI Support buat nyuntik riwayat pembayaran khusus siswa
        # ini. Guru/staf tidak punya NISN, jadi field ini kosong buat
        # mereka, dan itu memang wajar (blok pembayaran cuma relevan buat
        # siswa).
        'identity_number': user.get('identity_number', '')
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
        if not _cek_dan_catat_rate_limit('login'):
            flash('Terlalu banyak percobaan. Coba lagi sebentar ya.', 'error')
            return redirect(url_for('register'))

        # KEAMANAN: registrasi publik SELALU 'siswa'. Field 'role' dari client
        # tidak pernah dipakai buat menentukan role -- kalau ada dan bukan
        # 'siswa' (mis. 'guru', 'staf', 'admin', 'bk'), permintaan DITOLAK
        # (bukan diam-diam diturunkan), supaya percobaan escalation kelihatan.
        role_client = (request.form.get('role') or '').strip().lower()
        if role_client and role_client != 'siswa':
            print(f"[SECURITY] register ditolak: role '{role_client[:20]}' dari {_ambil_ip_client()}")
            flash('Registrasi publik hanya untuk akun siswa.', 'error')
            return redirect(url_for('register'))
        normalized_role = 'siswa'

        fullname = (request.form.get('fullname') or '').strip()[:100]
        identity_number = (request.form.get('identity_number') or '').strip()[:32]
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''
        email = (request.form.get('email') or '').strip()[:120] or f"{username}@sekolah.sch.id"

        if not re.fullmatch(r"[A-Za-z0-9_. -]{3,32}", username):
            flash('Username 3-32 karakter: huruf, angka, spasi, titik, garis bawah, atau strip.', 'error')
            return redirect(url_for('register'))
        if len(password) < 8 or len(password) > PASSWORD_MAKS_PANJANG:
            flash(f'Password harus 8-{PASSWORD_MAKS_PANJANG} karakter.', 'error')
            return redirect(url_for('register'))
        if not fullname:
            flash('Nama lengkap wajib diisi.', 'error')
            return redirect(url_for('register'))

        # Cek duplikat terhadap KEY dan field 'username' (key dict tidak selalu
        # sama dengan username) dan tanpa membedakan huruf besar/kecil.
        uname_lower = username.lower()
        if username in users or any(
            str(k).lower() == uname_lower or str(u.get('username', '')).lower() == uname_lower
            for k, u in users.items()
        ):
            flash('Username sudah digunakan, silakan pilih username lain!', 'error')
            return redirect(url_for('register'))

        users[username] = {
            'username': username,
            'password': generate_password_hash(password),
            'role': normalized_role,
            'email': email,
            'fullname': fullname,
            'identity_number': identity_number,
            'border_aktif': 'starter_pemula',
            # Foto profil siswa baru otomatis pakai foto default (lihat
            # FOTO_PROFIL_DEFAULT) sampai dia ganti sendiri lewat
            # updateProfilePhoto() -> /api/profil/foto.
            'foto_profil': FOTO_PROFIL_DEFAULT
        }
        try:
            _simpan_users_store()
        except Exception as exc:
            # Jangan bocorkan detail error ke user; batalkan akun yang belum tersimpan.
            users.pop(username, None)
            print(f"[ERROR] Gagal menyimpan akun baru: {type(exc).__name__}")
            flash('Terjadi kesalahan saat membuat akun. Coba lagi nanti.', 'error')
            return redirect(url_for('register'))

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
        if not _cek_dan_catat_rate_limit('login'):
            flash('Terlalu banyak percobaan. Coba lagi sebentar ya.', 'error')
            return redirect(url_for('lupa_password'))
        role = request.form.get('role')
        username = request.form.get('username')
        email = request.form.get('email')
 
        user_found = False
        for u in users.values():
            if u['username'] == username and u['role'] == role:
                user_found = True
                break
 
        if user_found:
            flash('Jika data yang kamu masukkan cocok, instruksi reset password akan dikirim ke email terdaftar.', 'success')
        else:
            flash('Jika data yang kamu masukkan cocok, instruksi reset password akan dikirim ke email terdaftar.', 'success')
 
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
def _respon_otp_generik(email):
    """Balasan SAMA persis untuk akun ada / tidak ada / email salah, supaya
    penyerang tidak bisa menebak username & email mana yang terdaftar."""
    return jsonify(
        success=True,
        message=f"Jika data cocok, kode OTP telah dikirim ke {mask_email(email)}.",
        masked_email=mask_email(email),
        expires_in_seconds=OTP_EXPIRY_MINUTES * 60,
        resend_cooldown_seconds=OTP_RESEND_COOLDOWN_SECONDS,
    )


@app.route('/api/forgot-password/send-otp', methods=['POST'])
@batasi('login')
def api_forgot_password_send_otp():
    data = request.get_json(silent=True) or {}
    role = (data.get('role') or '').strip()
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
 
    if not role or not username or not email:
        return jsonify(success=False, message='Semua field wajib diisi.'), 400
 
    user = _find_user_by_role_username(role, username)
    if not user:
        return _respon_otp_generik(email)
 
    if (user.get('email') or '').strip().lower() != email:
        return _respon_otp_generik(email)
 
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
@batasi('login')
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
 
    if not secrets.compare_digest(otp_input.encode('utf-8'), str(entry['otp']).encode('utf-8')):
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
@batasi('login')
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
            or not secrets.compare_digest(reset_token.encode('utf-8'), str(entry['reset_token']).encode('utf-8'))
            or not entry.get('reset_token_expires_at')
            or now > entry['reset_token_expires_at']):
        del otp_store[username]
        return jsonify(success=False, message='Sesi reset password tidak valid atau sudah kedaluwarsa. Ulangi dari awal.'), 400
 
    if len(new_password) < 8 or len(new_password) > PASSWORD_MAKS_PANJANG:
        return jsonify(success=False, message=f'Password baru harus 8-{PASSWORD_MAKS_PANJANG} karakter.'), 400
 
    if new_password != confirm_password:
        return jsonify(success=False, message='Konfirmasi password tidak sama dengan password baru.'), 400
 
    user = users.get(username)
    if not user:
        del otp_store[username]
        return jsonify(success=False, message='Akun tidak ditemukan.'), 404
 
    user['password'] = generate_password_hash(new_password)
    _simpan_users_store()  # FIX: sebelumnya tidak disimpan -> hilang saat restart
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
@batasi('umum')
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
@batasi('umum')
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
@batasi('berat')
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
# PROVIDER DATA QUIZ UNTUK AI SUPPORT (GEMINI) -- BARU
# ----------------------------------------------------
# Supaya AI Support (lihat api/gemini_routes.py) bisa menjawab pertanyaan
# leaderboard/ranking/statistik quiz dengan DATA ASLI dari aplikasi (bukan
# karangan Gemini), di sini didaftarkan sebuah fungsi "provider" ke modul
# gemini_routes lewat set_quiz_context_provider().
#
# KENAPA LEWAT CALLBACK (bukan gemini_routes.py import langsung dari
# app.py): app.py inilah yang mengimpor gemini_routes (lihat baris
# `from api.gemini_routes import gemini_bp, set_quiz_context_provider` di
# atas) -- kalau gemini_routes balik mengimpor sesuatu dari app.py, itu
# jadi IMPORT MELINGKAR (circular import) yang bikin server gagal start.
# Dengan pola callback ini, gemini_routes.py TIDAK PERLU tahu apa-apa
# soal quiz_store/users sama sekali -- cukup panggil fungsi yang sudah
# didaftarkan di bawah ini, app.py yang urus semua detail data aslinya.
#
# PENTING: fungsi-fungsi di bawah ini HANYA MEMBACA quiz_store & users
# yang SUDAH ADA (read-only, tidak pernah menulis apa pun ke keduanya) --
# TIDAK mengubah/menghapus logika endpoint quiz yang sudah berjalan sama
# sekali, ini murni tambahan baru.
def _gabungkan_leaderboard_quiz(jenis):
    """Logikanya SAMA PERSIS dengan bagian gabung-leaderboard di dalam
    api_quiz_leaderboard_global() di atas (satu entri per kombinasi
    nama+level, ambil skor tertinggi) -- diekstrak jadi fungsi sendiri di
    sini supaya bisa dipakai ulang oleh provider AI Support di bawah
    tanpa duplikasi logic. api_quiz_leaderboard_global() TIDAK diubah
    sama sekali (tetap jalan seperti sebelumnya, endpoint publiknya juga
    tidak dipanggil ulang lewat fungsi ini)."""
    gabungan = {}
    for _username, per_jenis in quiz_store.items():
        blob = per_jenis.get(jenis)
        if not blob:
            continue
        for entri in blob.get('leaderboard', []):
            kunci = f"{entri.get('nama')}||{entri.get('level')}"
            existing = gabungan.get(kunci)
            if not existing or (entri.get('skor', 0) > existing.get('skor', 0)):
                gabungan[kunci] = entri
    return list(gabungan.values())


def _hitung_ranking_siswa_dari_leaderboard(daftar_leaderboard, nama):
    """Dari daftar leaderboard GABUNGAN (belum dipotong top-N), hitung
    skor TERBAIK milik tiap nama (diambil dari level manapun -- easy/
    medium/hard sekaligus, karena pertanyaan seperti "ranking saya
    berapa?" biasanya dimaksudkan sebagai ranking keseluruhan, bukan per
    level), urutkan skor tertinggi -> terendah, lalu cari posisi `nama`
    di situ.

    CATATAN: leaderboard di quiz_store dikunci pakai NAMA (bukan
    username) -- sama persis seperti yang sudah dipakai
    api_quiz_leaderboard_global() di atas. Ini bukan hal baru yang
    ditambahkan fungsi ini, cuma ikut konvensi yang sudah ada; artinya
    kalau ada 2 siswa dengan nama PERSIS sama, ranking-nya bisa
    tercampur -- keterbatasan yang sudah ada sejak awal, di luar cakupan
    perubahan ini.

    Return None kalau nama tidak ditemukan sama sekali di leaderboard
    (mis. siswa itu belum pernah menyelesaikan quiz jenis ini)."""
    if not nama:
        return None
    skor_terbaik_per_nama = {}
    for entri in daftar_leaderboard:
        n = entri.get('nama')
        s = entri.get('skor', 0)
        if n not in skor_terbaik_per_nama or s > skor_terbaik_per_nama[n]:
            skor_terbaik_per_nama[n] = s
    if not skor_terbaik_per_nama:
        return None
    terurut = sorted(skor_terbaik_per_nama.items(), key=lambda kv: kv[1], reverse=True)
    posisi = next((i + 1 for i, (n, _s) in enumerate(terurut) if n == nama), None)
    if posisi is None:
        return None
    return {
        'posisi': posisi,
        'total_peserta': len(terurut),
        'skor_terbaik': skor_terbaik_per_nama[nama],
    }


def _cari_nama_asli_di_leaderboard(daftar_leaderboard, nama_dicari):
    """BARU. Cari nama PERSIS seperti tersimpan di leaderboard yang paling
    cocok dengan `nama_dicari` (yang datang dari deteksi pesan user, bisa
    saja beda kapitalisasi/cuma sebagian nama depan, mis. user ketik
    'fakhri' padahal di leaderboard tersimpan 'Fakhri Al Farisi').

    Pencocokan case-insensitive, dicoba 2 tahap:
      1) SAMA PERSIS (setelah disamakan huruf besar/kecil) -- prioritas
         utama supaya tidak salah pilih kalau ada nama mirip.
      2) Kalau tidak ada yang sama persis, cari nama di leaderboard yang
         MENGANDUNG `nama_dicari` sebagai kata (mis. 'fakhri' cocok
         dengan 'Fakhri Al Farisi').

    TIDAK PERNAH mengarang nama -- kalau tidak ketemu sama sekali,
    return None (dan pemanggil wajib jujur bilang tidak ketemu, bukan
    menebak nama paling mirip)."""
    if not nama_dicari:
        return None
    target = nama_dicari.strip().lower()
    if not target:
        return None
    nama_unik = {entri.get('nama') for entri in daftar_leaderboard if entri.get('nama')}
    for n in nama_unik:
        if n.strip().lower() == target:
            return n
    cocok_sebagian = [n for n in nama_unik if target in n.strip().lower().split() or target in n.strip().lower()]
    if len(cocok_sebagian) == 1:
        return cocok_sebagian[0]
    return None  # tidak ketemu ATAU ambigu (lebih dari 1 nama cocok) -- jangan menebak


def _filter_leaderboard_per_subjek(daftar_leaderboard, subjek):
    """BARU. Filter entri leaderboard berdasarkan field kategori/mapel
    ASLI yang ada di tiap entri -- field 'kategori', 'mapel', atau
    'mapelNama' (cek ketiganya, urutan itu, pakai yang pertama terisi).

    PENTING -- TIDAK PERNAH MENGARANG: struktur quiz_store SAAT INI
    (lihat _default_quiz_blob & api_quiz_save) TIDAK mengisi field
    kategori/mapel/mapelNama sama sekali per entri leaderboard -- field
    itu cuma ada di quiz_inprogress_store (snapshot SEMENTARA saat quiz
    masih berjalan, lihat catatan panjang di atas quiz_inprogress_store)
    dan DIBUANG begitu quiz selesai/disimpan final. Jadi fungsi ini akan
    mengembalikan list KOSONG untuk semua data yang ada sekarang -- itu
    BENAR & DIHARAPKAN, BUKAN bug. Fungsi ini disiapkan supaya begitu
    frontend suatu saat mulai mengirim field kategori/mapel/mapelNama
    per entri ke /api/quiz/save, filter ini OTOMATIS mulai bekerja tanpa
    perlu ubah kode lagi -- lihat juga _ambil_konteks_quiz_untuk_ai yang
    memakai fungsi ini & tetap jujur melaporkan status
    'subjek_data_tersedia' ke AI Support."""
    if not subjek:
        return list(daftar_leaderboard)
    target = subjek.strip().lower()
    hasil = []
    for entri in daftar_leaderboard:
        nilai_kategori = (entri.get('kategori') or entri.get('mapel') or entri.get('mapelNama') or '')
        if target in str(nilai_kategori).strip().lower():
            hasil.append(entri)
    return hasil


def _ada_data_subjek_di_leaderboard(daftar_leaderboard):
    """BARU. True kalau MINIMAL SATU entri di leaderboard (gabungan semua
    siswa) punya field kategori/mapel/mapelNama terisi -- dipakai supaya
    AI Support bisa membedakan 'subjek yang diminta memang tidak ada
    hasilnya' vs 'data per-mapel memang belum pernah tersimpan sama
    sekali di aplikasi ini', dua kondisi yang butuh kalimat jujur
    berbeda."""
    return any(
        (entri.get('kategori') or entri.get('mapel') or entri.get('mapelNama'))
        for entri in daftar_leaderboard
    )


def _ambil_konteks_quiz_untuk_ai(username, jenis=None, limit=10, subjek=None, nama_target=None):
    """Provider data ASLI yang dipanggil AI Support (lewat callback yang
    didaftarkan ke gemini_routes) untuk menjawab pertanyaan leaderboard/
    ranking/statistik quiz -- BUKAN dikarang oleh Gemini.

    Parameter:
    - username: username akun yang SEDANG LOGIN/chat (dari session Flask
      di sisi gemini_routes.py), dipakai untuk mengambil personal_stats
      & ranking milik user itu SENDIRI SAJA. Boleh None (mis. sesi tidak
      valid) -- personal_stats & ranking otomatis ikut None.
    - jenis: tidak dipakai untuk membatasi leaderboard yang dikembalikan
      (selalu dikembalikan DUA-DUANYA, pg & essay, lihat alasannya di
      docstring return) -- parameter ini disediakan untuk kompatibilitas/
      pengembangan lanjutan (mis. kalau nanti mau dibatasi salah satu
      saja demi hemat, tinggal dipakai di sini tanpa ubah signature).
    - limit: berapa banyak entri TERATAS yang mau ditampilkan di
      leaderboard_pg/leaderboard_essay (dibatasi 1-50 supaya tidak boros
      token kalau ada yang minta "top 999").
    - subjek: BARU. Nama mata pelajaran/kategori yang diminta user (mis.
      "Matematika", "Produktif") -- SUDAH dinormalisasi oleh
      gemini_routes.py sebelum sampai sini. Kalau diisi, leaderboard_pg/
      leaderboard_essay di bawah DIFILTER dulu pakai
      _filter_leaderboard_per_subjek (lihat fungsi itu untuk penjelasan
      kenapa hasilnya SAAT INI selalu kosong -- data kategori/mapel per
      entri memang belum pernah tersimpan). Kalau None, tidak ada filter
      (perilaku PERSIS sama seperti sebelum parameter ini ada).
    - nama_target: BARU. Nama siswa yang ranking-nya mau dicari (dari
      pesan seperti "Fakhri ranking berapa di Matematika") -- BUKAN
      current_user. Kalau diisi, dicari nama aslinya di leaderboard
      (lihat _cari_nama_asli_di_leaderboard) lalu dihitung rankingnya
      lewat _hitung_ranking_siswa_dari_leaderboard yang SUDAH ADA (fungsi
      itu memang sejak awal generik per nama, bukan cuma current_user).
      Data nama+skor leaderboard bersifat publik (lihat aturan di
      SYSTEM_PROMPT_TEMPLATE), jadi aman dicari untuk siapa saja, bukan
      cuma current_user.

    Return dict siap-pakai (JSON-serializable):
    {
      'current_user': {'username', 'nama'} atau None kalau username
                       tidak valid/tidak ditemukan,
      'personal_stats': {'pg_total_poin', 'pg_best_by_level',
                          'essay_best_by_level'} atau None,
      'ranking_pg': {'posisi', 'total_peserta', 'skor_terbaik'} atau None,
      'ranking_essay': idem tapi untuk essay,
      'leaderboard_pg': [...top `limit` entri leaderboard PG, urut skor
                          tertinggi, SUDAH difilter subjek kalau diminta...],
      'leaderboard_essay': [...idem tapi leaderboard Essay...],
      'subjek_diminta': nilai parameter `subjek` apa adanya (atau None),
      'subjek_data_tersedia': True/False -- lihat
                               _ada_data_subjek_di_leaderboard,
      'nama_target': nilai parameter `nama_target` apa adanya (atau None),
      'nama_target_ditemukan': nama ASLI di leaderboard yang cocok, atau
                                 None kalau tidak ketemu/ambigu,
      'ranking_nama_target_pg': sama skema dengan ranking_pg tapi untuk
                                  nama_target, atau None,
      'ranking_nama_target_essay': idem tapi essay,
    }

    CATATAN PENTING soal KATEGORI/MAPEL: struktur data quiz_store SAAT
    INI (lihat _default_quiz_blob di atas) TIDAK menyimpan kategori/mapel
    per entri leaderboard -- cuma 'nama', 'level' (easy/medium/hard), dan
    'skor'. Fungsi ini SENGAJA tidak memfilter/mengarang field itu --
    tiap entri leaderboard dikembalikan APA ADANYA (mentah), jadi KALAU
    suatu saat client mulai mengisi field tambahan seperti 'kategori'/
    'mapel'/'mapelNama' per entri, field itu OTOMATIS ikut terbawa di
    sini tanpa perlu ubah fungsi ini lagi -- gemini_routes.py yang akan
    memfilter/menyaringnya sesuai instruksi system prompt. Untuk SEKARANG
    (field itu belum ada sama sekali), AI diinstruksikan supaya jujur
    bilang data per-mapel belum tersedia -- lihat aturan terkait di
    SYSTEM_PROMPT_TEMPLATE (gemini_routes.py)."""
    gabungan_pg_full = _gabungkan_leaderboard_quiz('pg')
    gabungan_essay_full = _gabungkan_leaderboard_quiz('essay')

    # BARU: cek dulu ATAS DATA PENUH (belum difilter subjek/dipotong limit)
    # apakah field kategori/mapel/mapelNama tersedia SAMA SEKALI di
    # aplikasi ini -- dicek gabungan PG+Essay sekaligus. Ini status GLOBAL,
    # tidak tergantung subjek yang diminta user.
    subjek_data_tersedia = (
        _ada_data_subjek_di_leaderboard(gabungan_pg_full)
        or _ada_data_subjek_di_leaderboard(gabungan_essay_full)
    )

    # BARU: kalau user minta subjek tertentu, filter DULU (pakai data ASLI
    # apa adanya -- lihat _filter_leaderboard_per_subjek) SEBELUM diurutkan
    # & dipotong limit. Kalau `subjek` None, ini no-op (sama persis
    # perilaku lama).
    gabungan_pg_untuk_leaderboard = _filter_leaderboard_per_subjek(gabungan_pg_full, subjek)
    gabungan_essay_untuk_leaderboard = _filter_leaderboard_per_subjek(gabungan_essay_full, subjek)

    batas = max(1, min(int(limit or 10), 50))

    def _urutkan_dan_potong(daftar):
        terurut = sorted(daftar, key=lambda e: e.get('skor', 0), reverse=True)
        return terurut[:batas]

    leaderboard_pg = _urutkan_dan_potong(gabungan_pg_untuk_leaderboard)
    leaderboard_essay = _urutkan_dan_potong(gabungan_essay_untuk_leaderboard)

    current_user = None
    personal_stats = None
    ranking_pg = None
    ranking_essay = None

    if username and username in users:
        u = users[username]
        nama_user = u.get('fullname', username)
        current_user = {'username': username, 'nama': nama_user}

        # Statistik pribadi diambil dari SLOT AKUN ASLI (bukan profil
        # dummy) -- sama seperti kunci di _kunci_slot_quiz(username, None)
        # yaitu f"{username}::{username}", konsisten dengan endpoint
        # /api/quiz/load & /api/quiz/save saat TIDAK sedang memakai
        # profil dummy (slot_id kosong -> fallback ke username).
        kunci_slot = _kunci_slot_quiz(username, None)
        blob_pg = quiz_store.get(kunci_slot, {}).get('pg') or _default_quiz_blob('pg')
        blob_essay = quiz_store.get(kunci_slot, {}).get('essay') or _default_quiz_blob('essay')
        personal_stats = {
            'pg_total_poin': blob_pg.get('totalPoin', 0),
            'pg_best_by_level': blob_pg.get('bestByLevel', {'easy': 0, 'medium': 0, 'hard': 0}),
            'essay_best_by_level': blob_essay.get('bestByLevel', {'easy': 0, 'medium': 0, 'hard': 0}),
        }
        ranking_pg = _hitung_ranking_siswa_dari_leaderboard(gabungan_pg_full, nama_user)
        ranking_essay = _hitung_ranking_siswa_dari_leaderboard(gabungan_essay_full, nama_user)

    # BARU: ranking untuk nama siswa LAIN yang ditanya (mis. "Fakhri
    # ranking berapa di Matematika") -- dihitung dari list yang SUDAH
    # difilter subjek kalau subjek diminta & datanya tersedia (supaya
    # konsisten dengan leaderboard_pg/leaderboard_essay di atas), atau
    # dari data penuh kalau tidak ada filter subjek. Nama & skor
    # leaderboard bersifat publik, jadi ini aman dicari untuk siapa saja,
    # bukan cuma current_user.
    nama_target_ditemukan = None
    ranking_nama_target_pg = None
    ranking_nama_target_essay = None
    if nama_target:
        sumber_pg = gabungan_pg_untuk_leaderboard if subjek else gabungan_pg_full
        sumber_essay = gabungan_essay_untuk_leaderboard if subjek else gabungan_essay_full
        nama_target_ditemukan = (
            _cari_nama_asli_di_leaderboard(sumber_pg, nama_target)
            or _cari_nama_asli_di_leaderboard(sumber_essay, nama_target)
        )
        if nama_target_ditemukan:
            ranking_nama_target_pg = _hitung_ranking_siswa_dari_leaderboard(sumber_pg, nama_target_ditemukan)
            ranking_nama_target_essay = _hitung_ranking_siswa_dari_leaderboard(sumber_essay, nama_target_ditemukan)

    return {
        'current_user': current_user,
        'personal_stats': personal_stats,
        'ranking_pg': ranking_pg,
        'ranking_essay': ranking_essay,
        'leaderboard_pg': leaderboard_pg,
        'leaderboard_essay': leaderboard_essay,
        'subjek_diminta': subjek,
        'subjek_data_tersedia': subjek_data_tersedia,
        'nama_target': nama_target,
        'nama_target_ditemukan': nama_target_ditemukan,
        'ranking_nama_target_pg': ranking_nama_target_pg,
        'ranking_nama_target_essay': ranking_nama_target_essay,
    }


# Daftarkan provider di atas ke gemini_routes -- dipanggil SEKALI saat
# app.py di-load (mirip pola app.register_blueprint di atas), supaya
# tiap ada chat masuk ke AI Support, gemini_routes.py bisa memanggil data
# ASLI ini tanpa perlu import balik ke app.py (lihat catatan circular
# import di komentar provider di atas).
set_quiz_context_provider(_ambil_konteks_quiz_untuk_ai)


@app.route('/api/quiz/inprogress/load', methods=['GET'])
@batasi('umum')
def api_quiz_inprogress_load():
    """Ambil snapshot progres quiz yang BELUM selesai milik SLOT yang
    sedang aktif -- dipanggil tiap kali tab Quiz dibuka (bukaQuizDariAwal()
    di client), supaya progres yang terakhir ditinggal di perangkat/browser
    LAIN tetap ketemu & ditawarkan untuk dilanjutkan. Cuma ada SATU snapshot
    aktif per slot (bukan dipisah per jenis PG/Essay) -- persis meniru
    perilaku KEY_QUIZ_INPROGRESS di localStorage client yang juga cuma 1
    key, ditimpa/dihapus tiap kali quiz baru dimulai apapun jenisnya."""
    ok, err_resp, err_code = _cek_sesi_masih_cocok(request.args.get('expected_username'))
    if not ok:
        return err_resp, err_code

    username = session['user']['username']
    kunci = _kunci_slot_quiz(username, request.args.get('slot_id'))
    snapshot = quiz_inprogress_store.get(kunci)
    return jsonify(success=True, data=snapshot)  # null kalau memang tidak ada progres tertinggal


@app.route('/api/quiz/inprogress/save', methods=['POST'])
@batasi('umum')
def api_quiz_inprogress_save():
    """Simpan/timpa snapshot progres quiz yang sedang berjalan milik SLOT
    aktif ke server. Dipanggil tiap kali siswa selesai menjawab 1 soal
    (sama seperti simpanProgressQuizSementara() menulis ke localStorage),
    supaya kalau lanjut dibuka dari perangkat lain, progres ini tetap
    ketemu. Body tidak divalidasi detail strukturnya (dianggap 'blob'
    milik client, sama seperti api_quiz_save) -- cukup pastikan berupa
    object."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    data = body.get('data')
    if not isinstance(data, dict):
        return jsonify(success=False, message='Snapshot progres quiz tidak valid.'), 400

    username = session['user']['username']
    kunci = _kunci_slot_quiz(username, body.get('slot_id'))
    quiz_inprogress_store[kunci] = data
    _simpan_quiz_inprogress_store()
    return jsonify(success=True)


@app.route('/api/quiz/inprogress/clear', methods=['POST'])
@batasi('umum')
def api_quiz_inprogress_clear():
    """Hapus snapshot progres quiz milik SLOT aktif dari server -- dipanggil
    begitu quiz benar-benar tuntas dijawab semua (selesaikanQuiz()/
    selesaikanQuizEssay()), tiap kali quiz baru mulai (startQuiz(), jaga-
    jaga tambahan), ATAU siswa memilih 'Mulai dari Awal' di dialog
    konfirmasi lanjut quiz, supaya progres lama tidak nyangkut terus &
    ditawarkan lagi padahal sudah tidak relevan."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    username = session['user']['username']
    kunci = _kunci_slot_quiz(username, body.get('slot_id'))
    if kunci in quiz_inprogress_store:
        del quiz_inprogress_store[kunci]
        _simpan_quiz_inprogress_store()
    return jsonify(success=True)


# ----------------------------------------------------
# API: PRESTASI SISWA -- endpoint SENDIRI, terpisah dari /api/quiz/... di
# atas (lihat catatan di prestasi_store). Dipanggil dari
# dashboard_siswa.html (savePrestasiData / muatPrestasiDariServer) supaya
# Leaderboard Prestasi (Journey Prestasi) ikut sinkron lintas akun &
# perangkat, sama seperti Leaderboard Quiz -- tanpa numpang/nimpa data di
# quiz_store.
# ----------------------------------------------------
@app.route('/api/prestasi/load', methods=['GET'])
@batasi('umum')
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


# ----------------------------------------------------
# OTORISASI PRESTASI  (PRIORITAS 1 KEAMANAN)
# ----------------------------------------------------
# Sebelumnya siapa pun yang login bisa menimpa daftar prestasi kelas APA PUN,
# termasuk menulis status 'disetujui' sendiri. Sekarang:
#   - siswa: kelas WAJIB sama dengan kelas akunnya di server; hanya bisa
#     (a) menambah pengajuan BARU atas namanya sendiri (status dipaksa
#     'menunggu', field keputusan guru dibuang) dan (b) menghapus pengajuan
#     miliknya sendiri. Item lain/edit item yang sudah ada = versi server.
#   - guru/admin: alur approval lama tetap (tulis daftar utuh), pemilik
#     pengajuan ('_oleh' = username siswa, dicap server) tidak bisa dihapus.
_FIELD_KEPUTUSAN_PRESTASI = (
    'status', 'adminPenyetuju', 'tanggalKonfirmasi', 'catatanAdmin',
    'rewardDiberikan', 'poinReward', 'riwayat', 'notifikasiPembatalan',
    'pembatalanTerakhir', '_oleh',
)
_POLA_KELAS_PRESTASI = re.compile(r'[A-Za-z0-9_ /\-]{1,60}')
_prestasi_tulis_lock = threading.Lock()


def _kunci_prestasi_kelas(kelas):
    norm = _samakan_nama_kelas(kelas)
    for k in list(prestasi_store.keys()):
        if _samakan_nama_kelas(k) == norm:
            return k
    return norm.upper().replace(' ', '_')


def _id_prestasi_valid(it):
    return isinstance(it, dict) and isinstance(it.get('id'), str) and 0 < len(it['id']) <= 100


def _gabung_prestasi_siswa(lama, masuk, username, nama_login):
    nama_norm = _norm_nama(nama_login)
    masuk_by_id = {}
    for it in masuk:
        if _id_prestasi_valid(it):
            masuk_by_id.setdefault(it['id'], it)
    hasil, ada = [], set()
    for e in (lama if isinstance(lama, list) else []):
        if not isinstance(e, dict):
            continue
        eid = e.get('id')
        if isinstance(eid, str):
            ada.add(eid)
        milik = (e.get('_oleh') == username) or (
            not e.get('_oleh') and nama_norm and _norm_nama(e.get('namaSiswa')) == nama_norm)
        if milik and isinstance(eid, str) and eid not in masuk_by_id:
            continue  # pemilik menghapus pengajuannya sendiri
        if milik and not e.get('_oleh'):
            e = dict(e)
            e['_oleh'] = username
        hasil.append(e)
    for eid, it in masuk_by_id.items():
        if eid in ada:
            continue
        if not nama_norm or _norm_nama(it.get('namaSiswa')) != nama_norm:
            continue  # bukan pengajuan atas nama akun ini -> diabaikan
        baru = {k: v for k, v in it.items() if k not in _FIELD_KEPUTUSAN_PRESTASI}
        baru['namaSiswa'] = nama_login
        baru['status'] = 'menunggu'
        baru['_oleh'] = username
        hasil.append(baru)
    return hasil


def _gabung_prestasi_guru_admin(lama, masuk):
    lama_by_id = {e['id']: e for e in (lama if isinstance(lama, list) else []) if _id_prestasi_valid(e)}
    hasil = []
    for it in masuk:
        if not _id_prestasi_valid(it):
            continue
        it = dict(it)
        old = lama_by_id.get(it['id'])
        if old and old.get('_oleh'):
            it['_oleh'] = old['_oleh']
        hasil.append(it)
    return hasil


@app.route('/api/prestasi/save', methods=['POST'])
@batasi('umum')
def api_prestasi_save():
    """Simpan daftar pengajuan prestasi SATU kelas ke server -- dengan otorisasi
    (lihat catatan OTORISASI PRESTASI di atas). Format response tidak berubah."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    kelas = (body.get('kelas') or '').strip() if isinstance(body.get('kelas'), str) else ''
    data = body.get('data')
    if not kelas or not _POLA_KELAS_PRESTASI.fullmatch(kelas) or not isinstance(data, list):
        return jsonify(success=False, message='Data prestasi tidak valid.'), 400

    username = session['user']['username']
    if _sesi_guru_atau_admin():
        with _prestasi_tulis_lock:
            kunci = _kunci_prestasi_kelas(kelas)
            prestasi_store[kunci] = _gabung_prestasi_guru_admin(prestasi_store.get(kunci), data)
            _simpan_prestasi_store()
        return jsonify(success=True)

    if _sesi_siswa_biasa():
        if not _kelas_cocok_akun_siswa(kelas):
            return jsonify(success=False, message='Anda tidak berhak mengubah prestasi kelas lain.'), 403
        with _prestasi_tulis_lock:
            kunci = _kunci_prestasi_kelas(kelas)
            prestasi_store[kunci] = _gabung_prestasi_siswa(
                prestasi_store.get(kunci), data, username, session['user'].get('nama'))
            _simpan_prestasi_store()
        return jsonify(success=True)

    return jsonify(success=False, message='Anda tidak berhak menyimpan prestasi.'), 403


# ----------------------------------------------------
# API: KOTAK SARAN -- endpoint SENDIRI, terpisah dari /api/prestasi/... &
# /api/quiz/... di atas (lihat catatan di saran_store). Dipanggil dari
# dashboard_siswa.html (kirimSaranSiswa / sinkronkanSaranDenganServer)
# supaya saran yang masuk tersimpan di server (bukan cuma localStorage 1
# browser) dan bisa dibaca Admin/Developer (Ahmad Fakhri Al Farisi) dari
# perangkat manapun (HP maupun laptop).
# ----------------------------------------------------
@app.route('/api/saran/kirim', methods=['POST'])
@batasi('umum')
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
@batasi('umum')
def api_saran_list():
    """Ambil SELURUH daftar saran yang pernah masuk (lintas siswa/kelas/
    perangkat). HANYA boleh diakses Admin/Developer ASLI (Ahmad Fakhri Al
    Farisi) -- siswa lain yang mencoba akses endpoint ini langsung ditolak,
    sama persis pola proteksinya dengan endpoint kelola guru di bawah."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Tidak punya akses ke Kotak Saran.'), 403

    return jsonify(success=True, data=saran_store)


# ----------------------------------------------------
# API: SARAN & EVALUASI GURU -- endpoint SENDIRI, terpisah dari
# /api/saran/... (Kotak Saran Admin/Dev di atas) & /api/prestasi/... (lihat
# catatan di evaluasi_store). Dipanggil dari dashboard_siswa_2.js
# (kirimSaranGuru/muatEvaluasiGuru) & dashboard_guru.js (muatEvaluasiGuru/
# hitungDanTampilkanEvaluasiBelumDibaca/renderEvaluasiGuru).
# ----------------------------------------------------
@app.route('/api/evaluasi/kirim', methods=['POST'])
@batasi('umum')
def api_evaluasi_kirim():
    """Simpan SATU evaluasi/saran guru baru ke server. Endpoint ini SENGAJA
    terbuka untuk siapapun yang sedang login (siswa biasa yang mengirim) --
    sama pola aksesnya dengan api_saran_kirim di atas."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    data = body.get('data')
    if not isinstance(data, dict) or not (data.get('pesan') or '').strip() or not (data.get('guruNama') or '').strip():
        return jsonify(success=False, message='Data evaluasi tidak valid.'), 400

    def _rating(kunci):
        try:
            n = int(data.get(kunci) or 0)
        except (TypeError, ValueError):
            n = 0
        return n if 1 <= n <= 5 else 0

    rating_penjelasan = _rating('ratingPenjelasan')
    rating_keadilan = _rating('ratingKeadilan')
    rating_komunikasi = _rating('ratingKomunikasi')
    if not (rating_penjelasan and rating_keadilan and rating_komunikasi):
        return jsonify(success=False, message='Rating ketiga aspek (Penjelasan/Keadilan/Komunikasi) wajib diisi 1-5.'), 400

    anonim = bool(data.get('anonim'))
    # id dibuat ulang di server (bukan percaya begitu saja pada id kiriman
    # client) supaya tidak ada 2 evaluasi beda pengirim kebetulan bentrok id
    # -- pola sama persis dengan api_saran_kirim.
    evaluasi_baru = {
        'id': f"evaluasi_{int(time.time() * 1000)}",
        'guruNama': data.get('guruNama'),
        'guruMapel': data.get('guruMapel'),
        'ratingPenjelasan': rating_penjelasan,
        'ratingKeadilan': rating_keadilan,
        'ratingKomunikasi': rating_komunikasi,
        'pesan': (data.get('pesan') or '').strip(),
        'anonim': anonim,
        'namaPengirim': None if anonim else data.get('namaPengirim'),
        'waktu': data.get('waktu'),
        'dibaca': False,
    }
    evaluasi_store.append(evaluasi_baru)
    _simpan_evaluasi_store()
    return jsonify(success=True, data=evaluasi_baru)


@app.route('/api/evaluasi/list', methods=['GET'])
@batasi('umum')
def api_evaluasi_list():
    """Ambil SELURUH daftar evaluasi guru (lintas siswa/kelas/perangkat).
    SENGAJA dibuka untuk SEMUA akun yang sedang login (bukan cuma guru) --
    siswa di tab 'Daftar Guru' juga perlu ini untuk menghitung rata-rata
    rating tiap guru (lihat hitungRatingGuru() di dashboard_siswa_2.js),
    sama seperti /api/guru/list & /api/prestasi/load yang juga terbuka
    untuk semua akun."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    return jsonify(success=True, data=evaluasi_store)


@app.route('/api/evaluasi/jumlah-belum-dibaca', methods=['GET'])
@batasi('umum')
def api_evaluasi_jumlah_belum_dibaca():
    """Hanya ANGKA evaluasi yang belum dibaca -- untuk badge di Dashboard Guru
    (polling berkala) supaya tidak mengunduh seluruh daftar evaluasi."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    jumlah = sum(1 for x in evaluasi_store if isinstance(x, dict) and not x.get('dibaca'))
    return jsonify(success=True, jumlah=jumlah)


@app.route('/api/evaluasi/tandai-dibaca', methods=['POST'])
@batasi('umum')
def api_evaluasi_tandai_dibaca():
    """Tandai SELURUH evaluasi yang belum dibaca sebagai sudah dibaca --
    dipanggil dashboard_guru.js begitu guru membuka tab 'Saran & Evaluasi'
    (lihat renderEvaluasiGuru()). Badge jumlah belum dibaca jadi 0 lagi
    sampai ada evaluasi baru masuk. SENGAJA hanya akun guru yang boleh
    menandai (siswa tidak berkepentingan dengan status baca ini)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    jumlah_ditandai = 0
    for item in evaluasi_store:
        if not item.get('dibaca'):
            item['dibaca'] = True
            jumlah_ditandai += 1
    if jumlah_ditandai:
        _simpan_evaluasi_store()
    return jsonify(success=True, jumlah_ditandai=jumlah_ditandai)


# ----------------------------------------------------
# API: CARI TEMAN (pencarian siswa, permintaan pertemanan, profil statistik)
# ----------------------------------------------------
@app.route('/api/teman/cari', methods=['GET'])
@batasi('umum')
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
                'border': _border_publik_aman(u),
                # TAHAP 2: efek nama & title dikirim TERPISAH dari border
                # (lihat _efek_nama_publik_aman/_title_publik_aman di atas),
                # supaya kombinasi mix-and-match siswa ini (border A + efek
                # nama B + title C) juga ikut kelihatan bener di hasil
                # pencarian siswa lain, bukan cuma border-nya doang.
                'efekNama': _efek_nama_publik_aman(u),
                'title': _title_publik_aman(u),
                # Foto profil siswa itu: kalau dia sudah pernah ganti foto sendiri
                # lewat /api/profil/foto, itu yang dipakai (TIDAK PERNAH ditimpa
                # di sini). Kalau belum pernah ganti sama sekali, otomatis fallback
                # ke foto_profil_default.jpg (lihat FOTO_PROFIL_DEFAULT di atas).
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
    return jsonify(success=True, hasil=hasil)
 
 
@app.route('/api/kelas/roster', methods=['GET'])
@batasi('berat')
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
            # Sanitasi border dipusatkan di _border_publik_aman() (lihat
            # definisinya di atas) -- dipakai sama di SEMUA endpoint yang
            # menampilkan border publik, bukan cuma di sini.
            border_terpasang = _border_publik_aman(u)
            hasil.append({
                'username': u['username'],
                'nama': u['fullname'],
                'border': border_terpasang,
                # TAHAP 2: efek nama & title terpisah, sama pola dengan
                # /api/teman/cari di atas -- Denah Kelas Guru ikut sinkron
                # kalau nanti dipakai juga di sana.
                'efekNama': _efek_nama_publik_aman(u),
                'title': _title_publik_aman(u),
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
@batasi('umum')
def api_profil_border():
    """Simpan id border/efek-nama/title yang sedang dipakai siswa ini ke
    server (bukan cuma localStorage), supaya siswa LAIN yang lihat lewat
    'Cari Teman' atau Leaderboard Quiz bisa kelihatan kombinasi yang
    BENERAN dipakai orangnya -- bukan cuma placeholder generic.

    TAHAP 2: endpoint ini sekarang juga menerima field opsional `tipe`
    ('border' | 'efekNama' | 'title', default 'border') supaya satu
    endpoint yang sama bisa dipakai buat menyimpan ketiga jenis pilihan
    mix-and-match Tahap 1 (lihat pakaiBorder/pakaiEfekNama/pakaiTitle di
    dashboard_siswa_2.js) -- bukan cuma border seperti sebelumnya. Yang
    disimpan tetap cuma id string border acuan-nya (bukan nama efek/title
    itu sendiri); daftar lengkap border (nama, minPoin, file gambar) tetap
    didefinisikan di frontend (DAFTAR_BORDER_* di dashboard_siswa.html),
    backend gak perlu tahu detail itu.

    VALIDASI KEPEMILIKAN ("cek dulu, kalau gak ada balikin ke default"):
    slot border/efek-nama/title itu sendiri-sendiri divalidasi. Untuk
    SEMUA id di ID_BORDER_KHUSUS_ADMIN_DEV (admin_dev, border_imortal,
    border_ice) -- satu-satunya border yang butuh validasi KEPEMILIKAN di
    server (border lain semua dibuka lewat poin quiz/prestasi yang
    dihitung di frontend) -- cuma akun DEV asli yang "punya" border-border
    itu. Kalau ada akun LAIN yang somehow mencoba memasang salah satu id
    tersebut ke SALAH SATU slot (border/efek nama/title, mis. lewat
    request API langsung/DevTools, bukan lewat tombol UI yang memang
    sudah dikunci untuk mereka), permintaan itu TIDAK dianggap
    error/gagal -- slot itu diam-diam dialihkan ke border bawaan sekolah
    (starter_pemula) dan tetap dibalas success, PERSIS seperti perilaku
    baca di _field_tampilan_publik_aman() (satu sumber kebenaran yang
    sama dipakai di sisi simpan maupun tampil).

    PERBAIKAN: sebelumnya pengecekan ini cuma mencakup 'admin_dev' --
    sekarang diperluas ke seluruh isi ID_BORDER_KHUSUS_ADMIN_DEV supaya
    'border_imortal' (Kristal Imortal) & 'border_ice' (Ice/Collector), yang
    di frontend sama-sama dikunci hanya untuk akun dev lewat kategori
    'khusus', juga tidak bisa "ditembus" langsung ke API ini."""
    if 'user' not in session or session['user']['role'] != 'siswa':
        return jsonify(success=False, message='Belum login.'), 401
    if siswa_punya_pelanggaran_mengunci(session['user']['username']):
        return jsonify(success=False,
            message='Ganti border terkunci selama masih ada pelanggaran belum selesai.'), 403
 
    data = request.get_json(silent=True) or {}
    border_id = (data.get('id') or '').strip()
    tipe = (data.get('tipe') or 'border').strip()
    field_key = FIELD_KEY_TAMPILAN.get(tipe)
    if not field_key:
        return jsonify(success=False, message='Tipe tampilan tidak valid.'), 400
    if not border_id:
        return jsonify(success=False, message='ID border kosong.'), 400
 
    me = session['user']['username']
    BORDER_DEFAULT_STARTER = 'starter_pemula'
 
    # PENTING: border admin/dev & border khusus lain di
    # ID_BORDER_KHUSUS_ADMIN_DEV cuma "dimiliki" akun DEV asli (AHMAD
    # FAKHRI AL FARISI / username 'siswa') -- berlaku juga buat slot efek
    # nama & title yang meniru gaya border-border itu, bukan cuma slot
    # border aslinya. Dicek di server, bukan cuma di frontend, supaya
    # tidak bisa ditembus dengan mengirim request langsung ke endpoint ini
    # mengatasnamakan siswa lain. Kalau ternyata BUKAN pemiliknya, slot ini
    # TIDAK error -- otomatis dialihkan ke default Starter (lihat docstring
    # di atas), siswa itu tetap bisa lanjut, cuma dapat starter_pemula.
    if border_id in ID_BORDER_KHUSUS_ADMIN_DEV and me != USERNAME_ADMIN_DEV:
        border_id = BORDER_DEFAULT_STARTER
 
    if me in users:
        users[me][field_key] = border_id
        _simpan_users_store()
    return jsonify(success=True, id=border_id)


# ----------------------------------------------------
# API: KELOLA DAFTAR GURU (menu "Daftar Guru")
# ----------------------------------------------------
@app.route('/api/guru/list', methods=['GET'])
@batasi('umum')
def api_guru_list():
    """Ambil daftar guru terbaru -- dibaca siapapun yang sudah login
    (siswa/guru/staf), supaya menu 'Daftar Guru' semua orang selalu sinkron
    dengan hasil kelola admin, bukan lagi hardcode statis per file HTML."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
    return jsonify(success=True, guru=daftar_guru)


@app.route('/api/guru/tambah', methods=['POST'])
@batasi('umum')
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

    # .get('id', -1) sengaja dipakai (bukan g['id']) supaya kalaupun ada entri
    # lama di guru_store.json yang entah bagaimana masih tanpa 'id', endpoint
    # ini tidak ikut crash -- _muat_daftar_guru() di atas memang sudah
    # membetulkan itu saat startup, ini cuma jaga-jaga lapis kedua.
    id_baru = max((g.get('id', -1) for g in daftar_guru), default=-1) + 1
    # BUG YANG DIPERBAIKI: field 'jenis' (Biasa/Produktif) dari form "Kelola
    # Guru" sebelumnya tidak ikut disimpan sama sekali di sini -- makanya
    # pilihan jenis mapel yang dipilih admin di form selalu hilang. Divalidasi
    # ke 2 nilai yang valid, fallback 'biasa' kalau datang nilai lain/kosong.
    jenis = data.get('jenis') if data.get('jenis') in ('biasa', 'produktif') else 'biasa'
    guru_baru = {
        'id': id_baru,
        'nama': nama,
        'lulusan': (data.get('lulusan') or '').strip(),
        'mapel': (data.get('mapel') or '').strip(),
        'kelas': (data.get('kelas') or '').strip(),
        'tingkat': (data.get('tingkat') or '').strip(),
        'jurusan': (data.get('jurusan') or '').strip(),
        'jenis': jenis,
        'foto': (data.get('foto') or '').strip(),
    }
    daftar_guru.append(guru_baru)
    _simpan_daftar_guru()
    return jsonify(success=True, guru=guru_baru)


@app.route('/api/guru/edit/<int:id_guru>', methods=['POST'])
@batasi('umum')
def api_guru_edit(id_guru):
    """Ubah data guru yang sudah ada -- KHUSUS Admin/Developer, sama seperti
    /api/guru/tambah di atas."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Khusus akun Admin/Developer yang boleh mengelola daftar guru.'), 403

    target = next((g for g in daftar_guru if g.get('id') == id_guru), None)
    if not target:
        return jsonify(success=False, message='Guru tidak ditemukan.'), 404

    data = request.get_json(silent=True) or {}
    nama = (data.get('nama') or '').strip()
    if not nama:
        return jsonify(success=False, message='Nama guru wajib diisi.'), 400

    for field in ('nama', 'lulusan', 'mapel', 'kelas', 'tingkat', 'jurusan', 'foto'):
        if field in data:
            target[field] = (data.get(field) or '').strip()
    # BUG YANG DIPERBAIKI: sama seperti /api/guru/tambah, field 'jenis'
    # (Biasa/Produktif) sebelumnya tidak ikut di-update di sini.
    if 'jenis' in data and data.get('jenis') in ('biasa', 'produktif'):
        target['jenis'] = data.get('jenis')

    _simpan_daftar_guru()
    return jsonify(success=True, guru=target)


@app.route('/api/guru/hapus/<int:id_guru>', methods=['POST'])
@batasi('umum')
def api_guru_hapus(id_guru):
    """Hapus data guru -- KHUSUS Admin/Developer."""
    if not _akun_ini_admin_dev():
        return jsonify(success=False, message='Khusus akun Admin/Developer yang boleh mengelola daftar guru.'), 403

    global daftar_guru
    sebelum = len(daftar_guru)
    daftar_guru = [g for g in daftar_guru if g.get('id') != id_guru]
    if len(daftar_guru) == sebelum:
        return jsonify(success=False, message='Guru tidak ditemukan.'), 404

    _simpan_daftar_guru()
    return jsonify(success=True)


@app.route('/api/profil/sosmed', methods=['GET'])
@batasi('umum')
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
@batasi('umum')
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
@batasi('upload')
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

    # KOMPRESI OTOMATIS (hemat storage jangka panjang): resize ke maks
    # PROFIL_FOTO_MAX_DIM px di sisi terpanjang + convert ke WebP. Tetap
    # data URL biasa (cuma mime-nya jadi image/webp) supaya kode lama
    # yang render lewat <img src="..."> tidak perlu diubah sama sekali.
    try:
        foto, _ukuran_asli, _ukuran_baru = kompres_gambar_base64(
            foto, PROFIL_FOTO_MAX_DIM, PROFIL_FOTO_QUALITY
        )
    except GambarTidakValid as e:
        return jsonify(success=False, message=f'Foto tidak valid: {e}'), 400
 
    me = session['user']['username']
    if me in users:
        users[me]['foto_profil'] = foto
        _simpan_users_store()
    return jsonify(success=True)
 
 
@app.route('/api/teman/relasi', methods=['GET'])
@batasi('umum')
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
                # border, efek nama, & title disertakan (TAHAP 2: terpisah)
                # biar dropdown 'Permintaan Pertemanan' bisa nampilin
                # avatar+border+efek nama+title -- sama persis polanya
                # kayak /api/teman/cari di atas.
                'border': _border_publik_aman(u),
                'efekNama': _efek_nama_publik_aman(u),
                'title': _title_publik_aman(u),
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
                'border': _border_publik_aman(u),
                'efekNama': _efek_nama_publik_aman(u),
                'title': _title_publik_aman(u),
                'foto': u.get('foto_profil') or FOTO_PROFIL_DEFAULT
            })
 
    return jsonify(success=True, permintaan_masuk=masuk, teman=teman)
 
 
@app.route('/api/teman/kirim', methods=['POST'])
@batasi('umum')
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
@batasi('umum')
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
@batasi('umum')
def api_teman_profil(username):
    """Data buat ID card statistik siswa yang muncul saat nama di hasil
    pencarian diklik: identitas, kelas, jumlah teman, dan skor quiz
    (diambil dari quiz_store, slot akun asli siswa itu -- lihat
    _kunci_slot_quiz).

    Sengaja dibuka juga untuk akun GURU (bukan cuma siswa) supaya bisa
    dipakai fitur "lihat profil Developer" di halaman Tentang Dashboard
    Guru (klik nama developer -> tampil kartu profil, mirip Cari Teman
    di sisi siswa). Kalau yang login guru, status pertemanan tetap
    dihitung tapi hasilnya otomatis 'belum' (guru tidak ikut sistem
    pertemanan siswa) -- aman, tidak error."""
    if 'user' not in session or session['user']['role'] not in ('siswa', 'guru'):
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
        # Border, efek nama, & title (TAHAP 2: tiga field terpisah, tidak
        # lagi ikut satu paket), dipetakan jadi objek border lengkap di sisi
        # frontend (lihat renderIdCardTeman() -> getSemuaBorder()).
        # Foto: pakai punya siswa itu sendiri kalau sudah pernah diganti, kalau
        # belum otomatis fallback ke foto_profil_default.jpg -- tidak pernah
        # menimpa foto yang sudah diganti siswa yang bersangkutan.
        'border': _border_publik_aman(u),
        'efekNama': _efek_nama_publik_aman(u),
        'title': _title_publik_aman(u),
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
@batasi('berat')
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
def _kunci_kelas_akun(username):
    """'XII TKJ 3/TAV' (kelas di akun) -> 'XII_TKJ_3' (bentuk kunci tasks_<KELAS> dari Dashboard Guru)."""
    kelas = str((users.get(username) or {}).get('kelas') or '').split('/')[0]
    return re.sub(r'[^A-Za-z0-9_\-]', '', '_'.join(kelas.split()))


def _sisipkan_kelas_siswa(html, kunci_kelas):
    """Sematkan kelas siswa (dari SERVER) ke HTML pertama, sebelum script lain jalan.
    Ini cuma petunjuk tampilan -- penegakan akses tetap di server (session), bukan dari nilai ini."""
    skrip = '<script>window.KELAS_SISWA_SERVER=' + json.dumps(kunci_kelas) + ';</script>'
    hasil, n = re.subn(r'(<head[^>]*>)', lambda m: m.group(1) + skrip, html, count=1, flags=re.IGNORECASE)
    return hasil if n else skrip + html


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

    # FITUR (tutup celah "akal-akalan" siswa via reload/login berulang):
    # status Pelanggaran Aktif siswa ini disematkan LANGSUNG di HTML pertama
    # yang dikirim ke browser -- BUKAN cuma lewat /api/pelanggaran/status
    # yang baru kepanggil belakangan dari JS (dashboard_siswa_pelanggaran.js
    # membaca window.PELANGGARAN_AWAL di bawah SEBELUM fetch/polling apa pun
    # sempat jalan). Sebelumnya ada jeda singkat di awal tiap load/login
    # (nunggu event 'load' + delay + waktu fetch pertama) di mana penguncian
    # tugas belum efektif karena cache di JS masih default false -- siswa
    # yang paham ini bisa coba kirim tugas atau reload/login berkali-kali
    # berharap "keburu" di jeda itu. Sekarang datanya sudah ikut terkirim di
    # response HTML ini juga, jadi TIDAK ADA jeda tereksploitasi lagi, mau
    # login/reload berapa kali pun.
    _proses_auto_acc()
    _daftar_pelanggaran_awal = _urutkan_pelanggaran_siswa(
        pelanggaran_store.get(session['user']['username'], []))
    daftar_aktif_awal = [
        pelanggaran_untuk_response(e, mode='siswa')
        for e in _daftar_pelanggaran_awal
        if (e.get('status') or 'aktif') in STATUS_BELUM_SELESAI
    ]
    # [FIX] Bentuk dict ini dulu {'aktif': bool, 'daftar_aktif': [...]} --
    # BEDA dari response /api/pelanggaran/status ({'mengunci', 'daftar_aktif',
    # 'arsip'}) yang dibaca dashboard_siswa_pelanggaran.js lewat JSON.parse()
    # sebagai data awal. Field 'mengunci' gak pernah ada -> JS baca undefined
    # -> window.pelanggaranSiswaSedangAktif() selalu false di awal walau
    # sebenarnya ada pelanggaran yang mengunci, dan 'arsip' juga gak pernah
    # kekirim di data awal. Disamakan persis sekarang.
    arsip_awal = [
        pelanggaran_untuk_response(e, mode='siswa')
        for e in _daftar_pelanggaran_awal
        if (e.get('status') or 'aktif') in STATUS_ARSIP
    ]
    pelanggaran_awal = {
        'success': True,
        'mengunci': bool(daftar_aktif_awal),
        'daftar_aktif': daftar_aktif_awal,
        'arsip': arsip_awal
    }

    # FITUR MAINTENANCE: sama alasannya dengan pelanggaran_awal di atas --
    # status maintenance disematkan langsung di HTML pertama (bukan cuma
    # nunggu fetch /api/maintenance/status dari JS) supaya tidak ada jeda
    # sekilas di mana menu yang lagi dikunci sempat kelihatan "kebuka"
    # normal sebelum overlay-nya sempat dipasang oleh JS.
    maintenance_awal = maintenance_store

    html = render_template(
        'dashboard_siswa.html',
        username=session['user']['nama'],
        nama=session['user']['nama'],
        login_username=session['user']['username'],
        foto_profil=foto_profil,
        pelanggaran_awal=pelanggaran_awal,
        maintenance_awal=maintenance_awal
    )
    return _sisipkan_kelas_siswa(html, _kunci_kelas_akun(session['user']['username']))
 
@app.route('/dashboard/guru')
def dashboard_guru():
    if 'user' not in session or session['user']['role'] != 'guru':
        return redirect(url_for('login'))
    return render_template(
        'dashboard_guru.html',
        username=session['user']['nama'],
        # Dikirim terpisah dari 'username' (yang isinya fullname buat
        # ditampilkan) -- ini KHUSUS buat dibandingkan sama username akun
        # asli di /api/sesi/whoami lewat JS (lihat pengecekSesiBerubahGuru()
        # di dashboard_guru.js), supaya tab ini bisa tahu kalau cookie
        # session browser sudah pindah ke akun guru lain (mis. gara-gara
        # login akun baru di tab/perangkat lain pada browser yang sama --
        # lihat juga catatan _cek_sesi_masih_cocok soal ini).
        login_username=session['user']['username']
    )


@app.route('/api/sesi/whoami')
def api_sesi_whoami():
    """Endpoint ringan buat cek akun APA yang SEBENARNYA sedang aktif di
    balik cookie session browser ini SAAT INI -- dipanggil berkala oleh
    dashboard_guru.html (lihat pengecekSesiBerubahGuru() di
    dashboard_guru.js) buat mendeteksi tab yang sudah "basi": layarnya
    masih nampilin akun lama, padahal di baliknya cookie session sudah
    berubah jadi akun lain.

    Ini bisa kejadian karena Flask cuma punya SATU cookie session per
    BROWSER, bukan per tab -- persis seperti yang sudah dijelaskan di
    komentar _cek_sesi_masih_cocok(): kalau tab A login sebagai Guru 1,
    lalu tab B (browser sama) login sebagai Guru 2, session browser itu
    ikut berubah jadi milik Guru 2 untuk SEMUA tab, tapi tab A yang sudah
    lebih dulu ter-render tidak otomatis ikut berubah tampilannya sampai
    di-refresh. Dulu ini cuma dijaga di level API tertentu (mis. simpan
    quiz), sekarang halaman dashboard guru sendiri juga aktif mengecek
    supaya guru langsung dikasih tahu & diarahkan reload, bukan diam-diam
    lanjut kerja di tab yang datanya sudah tidak sesuai."""
    if 'user' not in session:
        return jsonify(success=True, logged_in=False)
    return jsonify(
        success=True,
        logged_in=True,
        username=session['user']['username'],
        role=session['user']['role'],
        nama=session['user']['nama']
    )
 
@app.route('/dashboard/staf')
def dashboard_staf():
    if 'user' not in session or session['user']['role'] not in ['staf_kebersihan', 'staf']:
        return redirect(url_for('login'))
    return render_template('dashboard_staf.html', username=session['user']['nama'])
 
# ======================================================
# FITUR: TRANSKRIP VOICE NOTE TUGAS (Voice-to-Text)
# ======================================================
# Menempel di Voice Note yang SUDAH ADA di form "Beri Tugas" (bukan sistem
# terpisah). ALUR:
#   Guru rekam suara di form "Beri Tugas" (dashboard_guru.js)
#     -> noise suppression + kompresi bertingkat (<= 1MB) dilakukan DI
#        BROWSER (Web Audio API + MediaRecorder Opus) sebelum dikirim
#     -> saat guru menekan "Simpan & Kirim Ke Kelas", audio di-upload ke
#        POST /api/guru/vn-tugas/upload (di bawah). Audio itu sendiri
#        TETAP disimpan di data tugas (task.audioDataUrl) seperti biasa;
#        server ini cuma menyimpan TRANSKRIP-nya (audio dipakai sementara
#        buat STT lalu dibuang), dikunci oleh id -> task.vnId
#     -> STT jalan di BACKGROUND THREAD pakai Whisper LOKAL (stt_engine.py)
#     -> siswa mengambil transkrip bertimestamp lewat
#        GET /api/vn-tugas/<id>/transkrip lalu menyorotnya sinkron dengan
#        audio (event 'timeupdate'; lihat vn_transkrip_player.js)
#
# KENAPA STT LOKAL (bukan Google/Azure Speech API)?: hosting PythonAnywhere
# (termasuk tier gratis) membatasi akses internet KELUAR cuma ke domain
# yang di-whitelist -- API cloud STT bisa gagal kapan saja di luar kendali
# kode ini. Whisper lokal (faster-whisper) jalan 100% di CPU server sendiri.
VN_TUGAS_MAX_BYTES = 1 * 1024 * 1024  # 1 MB -- sinkron dgn VN_MAX_BYTES di dashboard_guru.js
VN_TUGAS_STORE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'vn_tugas_store.json')
_vn_tugas_lock = threading.RLock()
# Cuma 1 transkrip Whisper jalan bersamaan (CPU hosting terbatas); sisanya antre.
_stt_semaphore = threading.BoundedSemaphore(1)


def _muat_vn_tugas_store():
    try:
        with open(VN_TUGAS_STORE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    # Server sempat mati/restart saat STT masih jalan -> thread-nya hilang,
    # status 'proses' tidak akan pernah selesai sendiri. Tandai 'gagal'
    # supaya siswa tidak menunggu selamanya (audio tetap bisa diputar).
    for entri in data.values():
        if isinstance(entri, dict) and entri.get('status') == 'proses':
            entri['status'] = 'gagal'
            entri['pesan_gagal'] = 'Server sempat restart saat transkrip diproses.'
    return data


def _simpan_vn_tugas_store():
    os.makedirs(os.path.dirname(VN_TUGAS_STORE_PATH), exist_ok=True)
    tmp_path = VN_TUGAS_STORE_PATH + '.tmp'
    with _vn_tugas_lock:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(vn_tugas_store, f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp_path, VN_TUGAS_STORE_PATH)


vn_tugas_store = _muat_vn_tugas_store()


def _ukuran_data_url_bytes(data_url):
    """Hitung ukuran ASLI (bytes, setelah didecode base64) sebuah data URL
    'data:<mime>;base64,<isi>'. Validasi ukuran di server WAJIB dihitung
    ulang seperti ini (bukan cuma percaya field ukuran yang diklaim client)
    supaya batas 1MB tidak bisa dilewati dengan memalsukan field itu."""
    if not isinstance(data_url, str) or ',' not in data_url:
        raise ValueError('Format data URL audio tidak valid.')
    header, b64_isi = data_url.split(',', 1)
    if 'base64' not in header:
        raise ValueError('Format data URL audio tidak valid (bukan base64).')
    try:
        return len(base64.b64decode(b64_isi, validate=True))
    except (binascii.Error, ValueError):
        raise ValueError('Data audio korup/tidak bisa didecode.')


def _proses_transkrip_vn_tugas(vn_id, audio_bytes, mime):
    """Jalan di THREAD TERPISAH: tulis audio ke file sementara, transkripsi
    pakai STT lokal (stt_engine.py), simpan hasil ke store, hapus file
    sementara. Dibungkus try/except selebar mungkin -- kegagalan STT TIDAK
    BOLEH mengganggu tugas/audionya, cuma status jadi 'gagal'."""
    tmp_path = None
    try:
        ekstensi = '.webm'
        if 'mp4' in mime:
            ekstensi = '.mp4'
        elif 'ogg' in mime:
            ekstensi = '.ogg'
        elif 'wav' in mime:
            ekstensi = '.wav'
        elif 'mp3' in mime or 'mpeg' in mime:
            ekstensi = '.mp3'

        with tempfile.NamedTemporaryFile(suffix=ekstensi, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        print(f'[VN-STT] mulai transkrip {vn_id} ({len(audio_bytes) // 1024} KB, {mime})')
        with _stt_semaphore:
            segments, error = transkrip_audio_file(tmp_path)
        if error:
            print(f'[VN-STT] GAGAL {vn_id}: {error}')
        else:
            print(f'[VN-STT] selesai {vn_id}: {len(segments)} segmen')

        with _vn_tugas_lock:
            entri = vn_tugas_store.get(vn_id)
            if not entri:
                return  # guru menghapus tugas/VN sebelum transkrip selesai
            if error:
                entri['status'] = 'gagal'
                entri['pesan_gagal'] = error
            else:
                entri['transkrip'] = segments
                entri['status'] = 'selesai'
            _simpan_vn_tugas_store()
    except Exception as exc:
        with _vn_tugas_lock:
            entri = vn_tugas_store.get(vn_id)
            if entri:
                entri['status'] = 'gagal'
                entri['pesan_gagal'] = f'Kesalahan internal STT: {exc}'
                _simpan_vn_tugas_store()
        print(f'[WARN] Gagal transkrip VN tugas {vn_id}: {exc}')
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.route('/api/guru/vn-tugas/upload', methods=['POST'])
@batasi('upload')
def api_vn_tugas_upload():
    """Guru mengirim audio Voice Note tugas (sudah di-suppress + dikompres
    di browser) untuk ditranskrip. Body JSON: { kelas, audio_data_url,
    durasi_detik (opsional) }. Balikin { success, id } -- id ini disimpan
    guru di data tugas (task.vnId)."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401

    body = request.get_json(silent=True) or {}
    kelas = (body.get('kelas') or '').strip()
    audio_data_url = body.get('audio_data_url')
    durasi_detik = body.get('durasi_detik')

    if not kelas:
        return jsonify(success=False, message='Kelas tujuan belum dipilih.'), 400
    if not isinstance(audio_data_url, str) or not audio_data_url.startswith('data:audio'):
        return jsonify(success=False, message='Audio tidak valid/kosong.'), 400
    if not isinstance(durasi_detik, (int, float)) or durasi_detik <= 0:
        durasi_detik = None

    try:
        ukuran_bytes = _ukuran_data_url_bytes(audio_data_url)
    except ValueError as e:
        return jsonify(success=False, message=str(e)), 400

    # TOLAK kalau tetap > 1MB (bukan dipotong diam-diam).
    if ukuran_bytes > VN_TUGAS_MAX_BYTES:
        return jsonify(
            success=False,
            message=(
                f'Audio masih {ukuran_bytes / 1024:.0f} KB setelah dikompres '
                f'(maks {VN_TUGAS_MAX_BYTES / 1024:.0f} KB). '
                'Coba perpendek durasinya atau rekam ulang.'
            )
        ), 413

    mime = audio_data_url.split(';')[0].replace('data:', '') or 'audio/webm'
    audio_bytes = base64.b64decode(audio_data_url.split(',', 1)[1])
    vn_id = uuid.uuid4().hex
    user_sesi = session['user']

    with _vn_tugas_lock:
        vn_tugas_store[vn_id] = {
            'id': vn_id,
            'guru_username': user_sesi['username'],
            'kelas': kelas,
            'durasi_detik': durasi_detik,
            'transkrip': [],
            'status': 'proses',  # proses -> selesai | gagal
            'pesan_gagal': None,
            'dibuat_at': datetime.utcnow().isoformat(),
        }
        _simpan_vn_tugas_store()

    print(f'[VN-STT] upload diterima {vn_id} dari {user_sesi["username"]} utk kelas {kelas}')
    # STT di background thread -- guru tidak perlu menunggu.
    threading.Thread(target=_proses_transkrip_vn_tugas, args=(vn_id, audio_bytes, mime), daemon=True).start()

    return jsonify(success=True, id=vn_id)


def _samakan_nama_kelas(nama):
    """Normalisasi nama kelas supaya 'XII TKJ 3' (nama kelas di Dashboard
    Guru) dan 'XII TKJ 3/TAV' (nama kelas di akun siswa) dianggap SAMA.
    Aturan: huruf kecil, buang sufiks setelah '/', underscore -> spasi,
    spasi ganda dirapikan. BUG YANG DIPERBAIKI: sebelumnya dibandingkan
    persis sama, jadi siswa selalu ditolak 403 dan transkrip tidak pernah
    tampil."""
    teks = str(nama or '').lower().split('/')[0].replace('_', ' ')
    return ' '.join(teks.split())


@app.route('/api/vn-tugas/<vn_id>/transkrip', methods=['GET'])
@batasi('berat')
def api_vn_tugas_transkrip(vn_id):
    """Ambil status + transkrip bertimestamp sebuah Voice Note tugas.
    Boleh diakses: guru pemilik, atau siswa yang KELASNYA sama dengan kelas
    tujuan. Kelas siswa diambil dari data akun di server (users[username]
    ['kelas']), bukan dari parameter client yang bisa dipalsukan."""
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401
    role = session['user'].get('role')
    username = session['user'].get('username')

    entri = vn_tugas_store.get(vn_id)
    if not entri:
        return jsonify(success=False, message='Transkrip tidak ditemukan.'), 404

    if role == 'guru':
        if entri.get('guru_username') != username:
            return jsonify(success=False, message='Bukan voice note milik Anda.'), 403
    elif role == 'siswa':
        kelas_siswa = (users.get(username) or {}).get('kelas')
        if not kelas_siswa or _samakan_nama_kelas(kelas_siswa) != _samakan_nama_kelas(entri.get('kelas')):
            print(f"[VN-STT] siswa {username} (kelas '{kelas_siswa}') ditolak utk VN kelas '{entri.get('kelas')}'")
            return jsonify(success=False, message='Voice note ini bukan untuk kelas Anda.'), 403
    else:
        return jsonify(success=False, message='Akses ditolak.'), 403

    return jsonify(
        success=True,
        status=entri.get('status', 'proses'),
        transkrip=entri.get('transkrip') or [],
        pesan_gagal=entri.get('pesan_gagal'),
    )


@app.route('/api/guru/vn-tugas/hapus/<vn_id>', methods=['POST'])
@batasi('umum')
def api_vn_tugas_hapus(vn_id):
    """Hapus transkrip VN tugas (dipanggil saat tugas dihapus / rekamannya
    diganti). HANYA pemilik -- dicek di server, bukan cuma disembunyikan di UI."""
    if 'user' not in session or session['user']['role'] != 'guru':
        return jsonify(success=False, message='Belum login sebagai guru.'), 401
    with _vn_tugas_lock:
        entri = vn_tugas_store.get(vn_id)
        if not entri:
            return jsonify(success=True)  # sudah tidak ada -> tujuan tercapai
        if entri.get('guru_username') != session['user']['username']:
            return jsonify(success=False, message='Anda bukan pemilik voice note ini.'), 403
        del vn_tugas_store[vn_id]
        _simpan_vn_tugas_store()
    return jsonify(success=True)


# ----------------------------------------------------
# ROUTE LOGOUT
# ----------------------------------------------------
@app.route('/logout')
def logout():
    # Hapus SELURUH isi session (bukan cuma key 'user'); cookie ikut dibuang
    # oleh Flask karena session kosong. Flash baru di-set SETELAH clear().
    session.clear()
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
    #
    # MODE_DEBUG: diambil dari environment variable FLASK_DEBUG, DEFAULT
    # sekarang "0" (mati) demi keamanan. Di laptop set FLASK_DEBUG=1 di .env. debug=True mengaktifkan auto-reloader Werkzeug
    # (server restart sendiri tiap ada file .py yang berubah) -- ini
    # normal & berguna saat development, TAPI ikut mereset cache jawaban
    # Gemini yang in-memory (lihat gemini_routes.py) tiap kali restart.
    # Sebelum dipakai serius oleh siswa/guru (production), set
    # FLASK_DEBUG=0 di .env atau environment supaya debug mati -- tanpa
    # perlu ubah baris kode ini lagi.
    MODE_DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=MODE_DEBUG, threaded=True)