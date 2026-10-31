from functools import wraps
from flask import session, jsonify


def login_required(role_dibutuhkan=None):
    """
    Decorator buat proteksi route.
    Contoh pakai: @login_required(role_dibutuhkan="guru")
    Kalau belum login -> ditolak. Kalau login tapi role beda -> ditolak juga.
    Ini kunci keamanan biar siswa gak bisa akses endpoint guru, dst.
    """
    def decorator(fungsi):
        @wraps(fungsi)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return jsonify({"error": "Kamu belum login"}), 401

            if role_dibutuhkan and session.get("role") != role_dibutuhkan:
                return jsonify({"error": "Kamu gak punya akses ke fitur ini"}), 403

            return fungsi(*args, **kwargs)
        return wrapper
    return decorator
