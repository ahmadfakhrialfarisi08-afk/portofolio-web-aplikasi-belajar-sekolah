from flask import Flask, render_template, request, redirect, url_for, flash, session

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

        if user and user['password'] == password:
            session['user'] = {
                'nama': user.get('fullname', username),
                'username': user['username'],
                'role': user['role']
            }
            return redirect(url_for('dashboard'))
        else:
            flash('Username, password, atau role salah!', 'error')
            return redirect(url_for('login'))

    return render_template('login.html')

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