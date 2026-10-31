from flask import Blueprint, request, jsonify, session
from models.user import daftar_user, cek_login

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/register", methods=["POST"])
def register():
    nama = request.form.get("nama")
    username = request.form.get("username")
    password = request.form.get("password")
    role = request.form.get("role")  # "siswa", "guru", atau "staff"
    kelas_id = request.form.get("kelas_id", type=int)  # cuma dipakai kalau role siswa

    if not all([nama, username, password, role]):
        return jsonify({"error": "Nama, username, password, dan role wajib diisi"}), 400

    if role == "siswa" and not kelas_id:
        return jsonify({"error": "Siswa wajib punya kelas_id"}), 400

    berhasil = daftar_user(nama, username, password, role, kelas_id)
    if not berhasil:
        return jsonify({"error": "Username sudah dipakai"}), 400

    return jsonify({"pesan": "Registrasi berhasil"}), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    username = request.form.get("username")
    password = request.form.get("password")

    user = cek_login(username, password)
    if user is None:
        return jsonify({"error": "Username atau password salah"}), 401

    session["user_id"] = user["id"]
    session["role"] = user["role"]

    return jsonify({
        "pesan": "Login berhasil",
        "nama": user["nama"],
        "role": user["role"]
    })


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"pesan": "Logout berhasil"})
