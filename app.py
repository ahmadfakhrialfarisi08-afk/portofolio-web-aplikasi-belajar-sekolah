import uuid
import os
import json
import random
import string
import smtplib
import ssl
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
 
app = Flask(__name__)
# Key rahasia untuk menangani session dan flash message
app.secret_key = 'arcana_smart_school_secret_key'
 
# ----------------------------------------------------
# DATA USER DUMMY (DATABASE SIMULASI)
# ----------------------------------------------------
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
        'kelas': 'XII TKJ 3/TAV'
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
        'kelas': 'XII TKJ 3/TAV'
    }
}
 
# ----------------------------------------------------
# DATA DEVICE DUMMY (SIMULASI TABEL DEVICES)
# Struktur: devices[username] = [ {token, name, ip, is_master, status, created_at}, ... ]
# ----------------------------------------------------
devices = {}
 
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
 
 
def get_device_token():
    """Ambil device_token dari cookie browser. Kalau belum ada, buat baru."""
    return request.cookies.get('device_token') or uuid.uuid4().hex
 
 
def build_device_name():
    ua = request.headers.get('User-Agent', 'Unknown Device')
    return ua[:150]
 
 
def find_device(username, token):
    for d in devices.get(username, []):
        if d['token'] == token:
            return d
    return None


def is_master_device(username, token):
    """Cek apakah token device yang dipakai sekarang adalah Master Device
    yang berstatus approved milik username tsb. Dipakai buat mengunci
    fitur approve/reject perangkat supaya cuma bisa dilakukan dari
    Master Device (bukan sembarang device yang sedang login)."""
    d = find_device(username, token)
    return bool(d and d.get('is_master') and d.get('status') == 'approved')
 
 
def set_device_cookie(resp, token):
    resp.set_cookie(
        'device_token',
        token,
        max_age=60 * 60 * 24 * 365,  # 1 tahun
        httponly=True,
        samesite='Lax'
    )
    return resp
 
 
# ----------------------------------------------------
# ROUTE UTAMA / ROOT
# ----------------------------------------------------
@app.route('/')
def index():
    return redirect(url_for('login'))
 
# ----------------------------------------------------
# ROUTE LOGIN (dengan Master Device & Approval Device)
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
 
        # Cari user sesuai username dan role
        user = None
        for u in users.values():
            if u['username'] == username and u['role'] == role:
                user = u
                break
 
        if not (user and user['password'] == password):
            flash('Username, password, atau role salah!', 'error')
            return redirect(url_for('login'))
 
        # ------------------------------------------------------------
        # Verifikasi Master Device / approval device kedua.
        # Device pertama yang dipakai login otomatis jadi Master Device.
        # Device lain butuh persetujuan dari Master Device sebelum bisa
        # masuk -- walau username/password/role yang dimasukkan benar.
        # ------------------------------------------------------------
        device_token = get_device_token()
        existing_device = find_device(username, device_token)

        if existing_device:
            if existing_device['status'] == 'approved':
                existing_device['last_login_at'] = datetime.utcnow()
                return _finish_login(user, device_token)

            if existing_device['status'] == 'pending':
                flash('Perangkat ini masih menunggu persetujuan dari Master Device. Buka Portal di Master Device untuk menyetujuinya lewat menu "Perangkat".', 'error')
                resp = make_response(redirect(url_for('login')))
                return set_device_cookie(resp, device_token)

            # status == 'rejected'
            flash('Perangkat ini ditolak aksesnya oleh Master Device. Hubungi pemilik akun.', 'error')
            resp = make_response(redirect(url_for('login')))
            return set_device_cookie(resp, device_token)

        # Device ini belum pernah terdaftar untuk akun ini sama sekali
        daftar_device_user = devices.get(username, [])

        if not daftar_device_user:
            # Belum ada device sama sekali -> device ini otomatis jadi Master Device
            devices.setdefault(username, []).append({
                'token': device_token,
                'name': build_device_name(),
                'ip': request.remote_addr,
                'is_master': True,
                'status': 'approved',
                'created_at': datetime.utcnow(),
                'last_login_at': datetime.utcnow(),
            })
            flash('Perangkat ini telah didaftarkan sebagai Master Device.', 'success')
            return _finish_login(user, device_token)

        # Sudah ada Master Device lain, tapi device ini belum pernah login
        # -> buat permintaan approval, JANGAN login dulu
        devices[username].append({
            'token': device_token,
            'name': build_device_name(),
            'ip': request.remote_addr,
            'is_master': False,
            'status': 'pending',
            'created_at': datetime.utcnow(),
            'last_login_at': None,
        })
        flash('Login dari perangkat baru terdeteksi. Menunggu persetujuan dari Master Device sebelum akses diberikan.', 'error')
        resp = make_response(redirect(url_for('login')))
        return set_device_cookie(resp, device_token)
 
 
def _finish_login(user, device_token):
    """Set session login + simpan device_token di cookie browser."""
    session['user'] = {
        'nama': user.get('fullname', user['username']),
        'username': user['username'],
        'role': user['role']
    }
    resp = make_response(redirect(url_for('dashboard')))
    return set_device_cookie(resp, device_token)
 
 
# ----------------------------------------------------
# ROUTE RESET MASTER DEVICE
# ----------------------------------------------------
# Menghapus seluruh data device (termasuk Master Device lama) milik akun,
# lalu langsung mendaftarkan perangkat yang dipakai untuk reset ini
# sebagai Master Device baru. Wajib verifikasi ulang password karena
# aksi ini melewati mekanisme approval device.
@app.route('/reset_device', methods=['GET', 'POST'])
def reset_device():
    if request.method == 'POST':
        role = request.form.get('role')
        username = request.form.get('username')
        password = request.form.get('password')
 
        user = None
        for u in users.values():
            if u['username'] == username and u['role'] == role:
                user = u
                break
 
        if not (user and user['password'] == password):
            flash('Username, password, atau role salah! Reset Master Device gagal.', 'error')
            return redirect(url_for('reset_device'))
 
        # Hapus semua device lama (termasuk Master Device sebelumnya)
        devices[username] = []
 
        # Daftarkan perangkat saat ini sebagai Master Device baru
        new_token = uuid.uuid4().hex
        devices[username].append({
            'token': new_token,
            'name': build_device_name(),
            'ip': request.remote_addr,
            'is_master': True,
            'status': 'approved',
            'created_at': datetime.utcnow(),
            'last_login_at': datetime.utcnow(),
        })
 
        flash('Master Device berhasil direset. Perangkat ini sekarang menjadi Master Device baru.', 'success')
        return _finish_login(user, new_token)
 
    return render_template('reset_device.html')


# ----------------------------------------------------
# API PERANGKAT (approval device dari sidebar dashboard)
# Cuma Master Device (device_token cookie yang sedang dipakai == device
# ber-flag is_master & status approved) yang boleh lihat & menyetujui/
# menolak device lain milik akun yang sama.
# ----------------------------------------------------
@app.route('/api/perangkat/list', methods=['GET'])
def api_perangkat_list():
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    username = session['user']['username']
    token_saya = request.cookies.get('device_token')
    saya_master = is_master_device(username, token_saya)

    daftar = []
    for d in sorted(devices.get(username, []), key=lambda x: x.get('created_at') or datetime.min, reverse=True):
        daftar.append({
            'token': d['token'],
            'nama': d.get('name') or 'Perangkat Tidak Dikenal',
            'ip': d.get('ip'),
            'is_master': bool(d.get('is_master')),
            'status': d.get('status'),
            'perangkat_ini': d['token'] == token_saya,
            'created_at': d['created_at'].isoformat() if d.get('created_at') else None,
            'last_login_at': d['last_login_at'].isoformat() if d.get('last_login_at') else None,
        })

    return jsonify(success=True, is_master=saya_master, devices=daftar)


@app.route('/api/perangkat/approve', methods=['POST'])
def api_perangkat_approve():
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    username = session['user']['username']
    token_saya = request.cookies.get('device_token')
    if not is_master_device(username, token_saya):
        return jsonify(success=False, message='Hanya Master Device yang bisa menyetujui perangkat.'), 403

    data = request.get_json(silent=True) or {}
    target_token = (data.get('token') or '').strip()
    target = find_device(username, target_token)
    if not target:
        return jsonify(success=False, message='Perangkat tidak ditemukan.'), 404

    target['status'] = 'approved'
    return jsonify(success=True, message=f"Perangkat '{target.get('name', 'ini')}' telah disetujui.")


@app.route('/api/perangkat/reject', methods=['POST'])
def api_perangkat_reject():
    if 'user' not in session:
        return jsonify(success=False, message='Belum login.'), 401

    username = session['user']['username']
    token_saya = request.cookies.get('device_token')
    if not is_master_device(username, token_saya):
        return jsonify(success=False, message='Hanya Master Device yang bisa menolak perangkat.'), 403

    data = request.get_json(silent=True) or {}
    target_token = (data.get('token') or '').strip()
    target = find_device(username, target_token)
    if not target:
        return jsonify(success=False, message='Perangkat tidak ditemukan.'), 404

    if target.get('is_master'):
        return jsonify(success=False, message='Master Device tidak bisa menolak dirinya sendiri.'), 400

    target['status'] = 'rejected'
    return jsonify(success=True, message=f"Perangkat '{target.get('name', 'ini')}' telah ditolak.")


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
            'identity_number': identity_number
        }
 
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
                'status': _status_pertemanan(me, u['username'])
            })
    return jsonify(success=True, hasil=hasil)


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
            masuk.append({'username': u['username'], 'nama': u['fullname'], 'kelas': u.get('kelas', '-')})

    teman = []
    for uname in sorted(friendships.get(me, set())):
        u = users.get(uname)
        if u:
            teman.append({'username': u['username'], 'nama': u['fullname'], 'kelas': u.get('kelas', '-')})

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
        'status_pertemanan': _status_pertemanan(me, username)
    })


# ----------------------------------------------------
# ROUTE DAFTAR GURU
# ----------------------------------------------------
@app.route('/guru')
@app.route('/daftar_guru.html')
def daftar_guru():
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
    return render_template(
        'dashboard_siswa.html',
        username=session['user']['nama'],
        nama=session['user']['nama'],
        login_username=session['user']['username']
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