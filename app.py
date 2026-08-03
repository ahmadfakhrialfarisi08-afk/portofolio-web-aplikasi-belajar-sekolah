import uuid
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, make_response

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
        'email': 'siswa@sekolah.sch.id',
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
    }
}

# ----------------------------------------------------
# DATA DEVICE DUMMY (SIMULASI TABEL DEVICES)
# Struktur: devices[username] = [ {token, name, ip, is_master, status, created_at}, ... ]
# ----------------------------------------------------
devices = {}


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

        device_token = get_device_token()
        existing_device = find_device(username, device_token)

        # Kasus 1: device ini sudah pernah terdaftar sebelumnya
        if existing_device:
            if existing_device['status'] == 'approved':
                existing_device['last_login_at'] = datetime.utcnow()
                return _finish_login(user, device_token)

            if existing_device['status'] == 'pending':
                flash('Perangkat ini masih menunggu persetujuan dari Master Device.', 'error')
                return redirect(url_for('login'))

            if existing_device['status'] == 'rejected':
                flash('Perangkat ini ditolak aksesnya. Hubungi admin.', 'error')
                return redirect(url_for('login'))

        # Kasus 2: user belum punya device sama sekali -> jadikan Master Device
        user_devices = devices.setdefault(username, [])

        if not user_devices:
            user_devices.append({
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

        # Kasus 3: sudah ada Master Device, tapi device ini baru -> minta approval
        user_devices.append({
            'token': device_token,
            'name': build_device_name(),
            'ip': request.remote_addr,
            'is_master': False,
            'status': 'pending',
            'created_at': datetime.utcnow(),
            'last_login_at': None,
        })
        flash(
            'Login dari perangkat baru terdeteksi. Menunggu persetujuan dari Master Device sebelum akses diberikan.',
            'error'
        )
        return redirect(url_for('login'))

    return render_template('login.html')


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
    return render_template('dashboard_siswa.html', username=session['user']['nama'])

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