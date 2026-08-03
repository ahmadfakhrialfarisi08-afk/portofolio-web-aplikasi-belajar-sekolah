from flask import Blueprint, session, jsonify
from routes.utils import login_required
from models.user import kelas_siswa, semua_guru
from models.tugas import tugas_untuk_kelas
from models.guru_mengajar import kelas_yang_diajar

siswa_bp = Blueprint("siswa", __name__, url_prefix="/siswa")


@siswa_bp.route("/tugas", methods=["GET"])
@login_required(role_dibutuhkan="siswa")
def daftar_tugas():
    """Cuma nampilin tugas dari kelas siswa ini sendiri - gak nyasar ke kelas lain."""
    kelas_id = kelas_siswa(session["user_id"])
    if not kelas_id:
        return jsonify({"error": "Kamu belum terdaftar di kelas manapun"}), 400

    daftar = tugas_untuk_kelas(kelas_id, jenis="tugas")
    hasil = [dict(t) for t in daftar]
    return jsonify(hasil)


@siswa_bp.route("/catatan", methods=["GET"])
@login_required(role_dibutuhkan="siswa")
def daftar_catatan():
    kelas_id = kelas_siswa(session["user_id"])
    if not kelas_id:
        return jsonify({"error": "Kamu belum terdaftar di kelas manapun"}), 400

    daftar = tugas_untuk_kelas(kelas_id, jenis="catatan")
    hasil = [dict(c) for c in daftar]
    return jsonify(hasil)


@siswa_bp.route("/guru", methods=["GET"])
@login_required(role_dibutuhkan="siswa")
def daftar_guru():
    """
    Data buat fitur swipe: nama guru + mapel yang diajar di kelas siswa ini.
    """
    kelas_id = kelas_siswa(session["user_id"])
    guru_list = semua_guru()

    hasil = []
    for guru in guru_list:
        jadwal = kelas_yang_diajar(guru["id"])
        mapel_di_kelas_ini = [j["mapel"] for j in jadwal if j["kelas_id"] == kelas_id]
        if mapel_di_kelas_ini:
            hasil.append({
                "id": guru["id"],
                "nama": guru["nama"],
                "mapel": mapel_di_kelas_ini
            })

    return jsonify(hasil)
