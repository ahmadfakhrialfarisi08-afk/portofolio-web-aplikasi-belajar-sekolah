"""
Logika Login dengan Master Device & Approval Device Kedua
============================================================
Arcana Smart School - Modul Autentikasi

Alur kerja:
1. Saat user login pertama kali, device yang digunakan otomatis
   didaftarkan sebagai "Master Device" (langsung disetujui).
2. Jika user login dari device lain, sistem membuat permintaan
   approval berstatus "pending" dan TIDAK memberi akses sampai
   disetujui dari Master Device.
3. Master Device dapat melihat daftar device yang menunggu approval
   dan menyetujui/menolaknya.

Catatan: contoh ini pakai Flask + Flask-SQLAlchemy + Flask-Login.
Sesuaikan nama model User dengan struktur project yang sudah ada.
"""

import uuid
import hashlib
from datetime import datetime

from flask import Blueprint, request, redirect, url_for, flash, render_template, make_response
from flask_login import login_user, login_required, current_user
from werkzeug.security import check_password_hash

from extensions import db  # sesuaikan dengan lokasi instance SQLAlchemy di project-mu
from models import User    # model User yang sudah ada

auth_bp = Blueprint("auth", __name__)

# ---------------------------------------------------------------------------
# MODEL DEVICE
# ---------------------------------------------------------------------------
class Device(db.Model):
    __tablename__ = "devices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    device_token = db.Column(db.String(64), nullable=False, index=True)
    device_name = db.Column(db.String(150))       # contoh: dari User-Agent
    ip_address = db.Column(db.String(45))

    is_master = db.Column(db.Boolean, default=False)
    status = db.Column(db.String(20), default="pending")  # pending | approved | rejected

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login_at = db.Column(db.DateTime)

    user = db.relationship("User", backref="devices")


# ---------------------------------------------------------------------------
# HELPER: fingerprint device
# ---------------------------------------------------------------------------
def get_device_token():
    """
    Ambil device_token dari cookie. Kalau belum ada, buat token baru.
    Token disimpan di cookie httponly supaya device bisa dikenali
    di kunjungan berikutnya tanpa perlu login ulang tiap saat.
    """
    token = request.cookies.get("device_token")
    if not token:
        token = uuid.uuid4().hex
    return token


def build_device_name():
    ua = request.headers.get("User-Agent", "Unknown Device")
    # dipendekkan biar rapi di tampilan approval
    return ua[:150]


# ---------------------------------------------------------------------------
# ROUTE: LOGIN
# ---------------------------------------------------------------------------
@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("index.html")

    role = request.form.get("role")
    username = request.form.get("username")
    password = request.form.get("password")

    user = User.query.filter_by(username=username, role=role).first()

    if not user or not check_password_hash(user.password_hash, password):
        flash("Username, role, atau password salah.", "error")
        return redirect(url_for("auth.login"))

    device_token = get_device_token()
    existing_device = Device.query.filter_by(
        user_id=user.id, device_token=device_token
    ).first()

    # Kasus 1: device ini sudah pernah terdaftar
    if existing_device:
        if existing_device.status == "approved":
            existing_device.last_login_at = datetime.utcnow()
            db.session.commit()
            return _finish_login(user, device_token)

        if existing_device.status == "pending":
            flash("Perangkat ini masih menunggu persetujuan dari Master Device.", "error")
            return redirect(url_for("auth.login"))

        if existing_device.status == "rejected":
            flash("Perangkat ini ditolak aksesnya. Hubungi admin.", "error")
            return redirect(url_for("auth.login"))

    # Kasus 2: belum ada device sama sekali untuk user ini -> jadikan Master Device
    has_any_device = Device.query.filter_by(user_id=user.id).first()

    if not has_any_device:
        new_device = Device(
            user_id=user.id,
            device_token=device_token,
            device_name=build_device_name(),
            ip_address=request.remote_addr,
            is_master=True,
            status="approved",
            last_login_at=datetime.utcnow(),
        )
        db.session.add(new_device)
        db.session.commit()
        flash("Perangkat ini telah didaftarkan sebagai Master Device.", "success")
        return _finish_login(user, device_token)

    # Kasus 3: sudah ada master device, tapi device baru ini belum pernah login
    # -> buat permintaan approval, JANGAN login
    pending_device = Device(
        user_id=user.id,
        device_token=device_token,
        device_name=build_device_name(),
        ip_address=request.remote_addr,
        is_master=False,
        status="pending",
    )
    db.session.add(pending_device)
    db.session.commit()

    flash(
        "Login dari perangkat baru terdeteksi. Menunggu persetujuan dari Master Device sebelum akses diberikan.",
        "error",
    )
    return redirect(url_for("auth.login"))


def _finish_login(user, device_token):
    """Set session login + simpan device_token di cookie."""
    login_user(user)
    resp = make_response(redirect(url_for("dashboard")))  # sesuaikan endpoint tujuan
    resp.set_cookie(
        "device_token",
        device_token,
        max_age=60 * 60 * 24 * 365,  # 1 tahun
        httponly=True,
        samesite="Lax",
    )
    return resp


# ---------------------------------------------------------------------------
# ROUTE: DAFTAR & APPROVAL DEVICE (hanya bisa diakses dari Master Device)
# ---------------------------------------------------------------------------
@auth_bp.route("/devices", methods=["GET"])
@login_required
def list_devices():
    device_token = request.cookies.get("device_token")
    current_device = Device.query.filter_by(
        user_id=current_user.id, device_token=device_token
    ).first()

    if not current_device or not current_device.is_master:
        flash("Hanya Master Device yang dapat mengelola perangkat.", "error")
        return redirect(url_for("dashboard"))

    devices = Device.query.filter_by(user_id=current_user.id).order_by(
        Device.created_at.desc()
    ).all()
    return render_template("devices.html", devices=devices)


@auth_bp.route("/devices/<int:device_id>/approve", methods=["POST"])
@login_required
def approve_device(device_id):
    device_token = request.cookies.get("device_token")
    current_device = Device.query.filter_by(
        user_id=current_user.id, device_token=device_token
    ).first()

    if not current_device or not current_device.is_master:
        flash("Hanya Master Device yang dapat menyetujui perangkat.", "error")
        return redirect(url_for("dashboard"))

    target = Device.query.filter_by(id=device_id, user_id=current_user.id).first()
    if not target:
        flash("Perangkat tidak ditemukan.", "error")
        return redirect(url_for("auth.list_devices"))

    target.status = "approved"
    db.session.commit()
    flash(f"Perangkat '{target.device_name}' telah disetujui.", "success")
    return redirect(url_for("auth.list_devices"))


@auth_bp.route("/devices/<int:device_id>/reject", methods=["POST"])
@login_required
def reject_device(device_id):
    device_token = request.cookies.get("device_token")
    current_device = Device.query.filter_by(
        user_id=current_user.id, device_token=device_token
    ).first()

    if not current_device or not current_device.is_master:
        flash("Hanya Master Device yang dapat menolak perangkat.", "error")
        return redirect(url_for("dashboard"))

    target = Device.query.filter_by(id=device_id, user_id=current_user.id).first()
    if not target:
        flash("Perangkat tidak ditemukan.", "error")
        return redirect(url_for("auth.list_devices"))

    target.status = "rejected"
    db.session.commit()
    flash(f"Perangkat '{target.device_name}' telah ditolak.", "success")
    return redirect(url_for("auth.list_devices"))
