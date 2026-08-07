import uuid
import os
import random
import string
import smtplib
import ssl
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, flash, session, make_response, jsonify

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
        'identity_number': '0051234567'
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
        'identity_number': '0059999999'
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
# CATATAN: ini masih penyimpanan in-memory (hilang kalau server direstart),
# sama seperti dict `users` dan `devices` di atas. Untuk produksi sungguhan,
# ganti dengan tabel database (mis. quiz_scores, quiz_leaderboard_entries).
# ----------------------------------------------------
quiz_store = {}


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
        # NOTE: Verifikasi Master Device / approval device DINONAKTIFKAN
        # SEMENTARA karena UI untuk approve/reject device di dashboard
        # belum dibuat. Begitu fitur approve/reject-nya sudah ada,
        # kembalikan logic pengecekan device (lihat versi lama file ini
        # untuk referensi). Untuk sekarang, begitu kredensial valid,
        # langsung login tanpa cek status device sama sekali.
        # ------------------------------------------------------------
        device_token = get_device_token()
        return _finish_login(user, device_token)


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


@app.route('/api/quiz/load', methods=['GET'])
def api_quiz_load():
    """Ambil data quiz milik akun yang sedang login (dipanggil saat
    dashboard siswa dibuka, supaya progress akun ini ikut nyambung
    walau login dari perangkat/browser lain)."""
    ok, err_resp, err_code = _cek_sesi_masih_cocok(request.args.get('expected_username'))
    if not ok:
        return err_resp, err_code

    jenis = request.args.get('jenis', 'pg')
    if jenis not in ('pg', 'essay'):
        return jsonify(success=False, message='Jenis quiz tidak valid.'), 400

    username = session['user']['username']
    blob = quiz_store.get(username, {}).get(jenis)
    return jsonify(success=True, data=blob)  # null kalau memang belum pernah main/simpan


@app.route('/api/quiz/save', methods=['POST'])
def api_quiz_save():
    """Simpan data quiz milik akun yang sedang login ke server. Dipanggil
    setiap kali skor/leaderboard lokal di-update (pengganti localStorage
    sebagai sumber utama, biar tersimpan per akun & bisa dibaca akun lain
    lewat endpoint leaderboard-global di bawah)."""
    body = request.get_json(silent=True) or {}

    ok, err_resp, err_code = _cek_sesi_masih_cocok(body.get('expected_username'))
    if not ok:
        return err_resp, err_code

    jenis = body.get('jenis')
    data = body.get('data')
    if jenis not in ('pg', 'essay') or not isinstance(data, dict):
        return jsonify(success=False, message='Data quiz tidak valid.'), 400

    username = session['user']['username']
    quiz_store.setdefault(username, {})[jenis] = data
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
# RUN APP
# ----------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True)