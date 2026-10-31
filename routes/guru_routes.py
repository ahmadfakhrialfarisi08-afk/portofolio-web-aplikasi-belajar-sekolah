from flask import Blueprint, request, session, jsonify
from routes.utils import login_required
from models.guru_mengajar import kelas_yang_diajar, walikelas_dari
from models.tugas import buat_tugas
from models.tugas_siswa import buat_status_untuk_sekelas
from models.notifikasi import buat_notifikasi
from models.user import kelas_siswa
from models.db import get_koneksi

guru_bp = Blueprint("guru", __name__, url_prefix="/guru")


@guru_bp.route("/kelas", methods=["GET"])
@login_required(role_dibutuhkan="guru")
def daftar_kelas_saya():
    """
    Semua kelas + jadwal yang diajar guru ini, plus keterangan
    dia wali kelas di kelas mana (kalau ada).
    """
    jadwal = kelas_yang_diajar(session["user_id"])
    hasil = [dict(j) for j in jadwal]
    return jsonify(hasil)


@guru_bp.route("/walikelas/<int:kelas_id>", methods=["GET"])
@login_required(role_dibutuhkan="guru")
def cek_walikelas(kelas_id):
    """
    Guru bisa cek: kelas ini wali kelasnya siapa?
    Ini yang jawab pertanyaan kamu soal guru A & guru B saling lihat wali kelas.
    """
    wali = walikelas_dari(kelas_id)
    if wali is None:
        return jsonify({"pesan": "Kelas ini belum ada wali kelasnya"}), 404
    return jsonify({"wali_kelas_id": wali["id"], "nama": wali["nama"]})


@guru_bp.route("/tambah-tugas", methods=["POST"])
@login_required(role_dibutuhkan="guru")
def tambah_tugas():
    """
    Guru bikin tugas/catatan baru.
    Begitu tersimpan, LANGSUNG dibikinin status 'belum' buat SEMUA siswa
    di kelas itu doang - inilah yang bikin 'serentak tapi gak nyasar'.
    """
    kelas_id = request.form.get("kelas_id", type=int)
    judul = request.form.get("judul")
    deskripsi = request.form.get("deskripsi")
    jenis = request.form.get("jenis")  # "tugas" atau "catatan"
    deadline = request.form.get("deadline")

    if not all([kelas_id, judul, jenis]):
        return jsonify({"error": "kelas_id, judul, dan jenis wajib diisi"}), 400

    # validasi: guru ini beneran ngajar di kelas itu, gak asal nembak kelas_id
    jadwal_guru = kelas_yang_diajar(session["user_id"])
    kelas_valid = any(j["kelas_id"] == kelas_id for j in jadwal_guru)
    if not kelas_valid:
        return jsonify({"error": "Kamu gak mengajar di kelas ini"}), 403

    tugas_id = buat_tugas(session["user_id"], kelas_id, judul, deskripsi, jenis, deadline)

    # otomatis bikin status "belum" buat semua siswa di kelas itu
    if jenis == "tugas":
        buat_status_untuk_sekelas(tugas_id, kelas_id)

    # kirim notifikasi ke semua siswa di kelas itu
    conn = get_koneksi()
    siswa_kelas = conn.execute(
        "SELECT user_id FROM siswa_detail WHERE kelas_id = ?", (kelas_id,)
    ).fetchall()
    conn.close()

    for siswa in siswa_kelas:
        buat_notifikasi(
            siswa["user_id"],
            f"{jenis.capitalize()} baru: {judul}",
            deskripsi,
            "tugas_baru"
        )

    return jsonify({"pesan": "Tugas berhasil dibuat dan dikirim ke semua siswa kelas ini"}), 201
