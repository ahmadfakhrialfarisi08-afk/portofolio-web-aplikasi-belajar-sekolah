import os
from flask import Blueprint, request, session, jsonify
from werkzeug.utils import secure_filename
from routes.utils import login_required
from models.laporan_sampah import buat_laporan, semua_laporan_aktif, tandai_dibersihkan
from models.lokasi_sekolah import semua_lokasi

staff_bp = Blueprint("staff", __name__, url_prefix="/staff")

FOLDER_UPLOAD = "uploads/sampah"


@staff_bp.route("/denah", methods=["GET"])
@login_required(role_dibutuhkan="staff")
def lihat_denah():
    """
    Data buat gambar denah: semua titik lokasi + daftar laporan sampah aktif di tiap titik.
    Frontend tinggal hitung berapa laporan per lokasi_id buat nentuin 'seberapa merah' titiknya.
    """
    lokasi = [dict(l) for l in semua_lokasi()]
    laporan = [dict(l) for l in semua_laporan_aktif()]
    return jsonify({"lokasi": lokasi, "laporan_sampah": laporan})


@staff_bp.route("/upload-foto", methods=["POST"])
def upload_foto_robot():
    """
    Endpoint ini dipanggil ROBOT (bukan staff manusia), jadi sengaja gak pakai
    login_required biasa - nanti bisa diganti pakai API key khusus robot.
    """
    lokasi_id = request.form.get("lokasi_id", type=int)
    perkiraan_jumlah = request.form.get("perkiraan_jumlah", "belum diketahui")
    foto = request.files.get("foto")

    if not lokasi_id or not foto:
        return jsonify({"error": "lokasi_id dan foto wajib dikirim"}), 400

    os.makedirs(FOLDER_UPLOAD, exist_ok=True)
    nama_file = secure_filename(f"lokasi{lokasi_id}_{foto.filename}")
    path_file = os.path.join(FOLDER_UPLOAD, nama_file)
    foto.save(path_file)

    laporan_id = buat_laporan(lokasi_id, path_file, perkiraan_jumlah)
    return jsonify({"pesan": "Laporan sampah tersimpan", "laporan_id": laporan_id}), 201


@staff_bp.route("/tandai-bersih/<int:laporan_id>", methods=["POST"])
@login_required(role_dibutuhkan="staff")
def tandai_bersih(laporan_id):
    tandai_dibersihkan(laporan_id, session["user_id"])
    return jsonify({"pesan": "Ditandai sudah dibersihkan"})
