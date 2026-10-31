"""
REMINDER JADWAL MENGAJAR GURU  (server = sumber kebenaran, waktu WIB dari server)

Dipasang dari app.py lewat pasang_reminder_jadwal(...).  Tidak membuat sistem
jadwal/tugas baru:
  - pemilik sesi   : daftar_guru yang sudah ada (cocok kelas + mapel), atau field
                     opsional `guru` pada entri jadwal
  - tugas/catatan  : sync store yang sudah ada (tasks_<KELAS>), yang SUDAH dicap
                     server (namaGuru dari session, waktuKirimGuru dari jam server)
  - yang baru      : hanya status per sesi (tahap yang sudah tampil, pilihan guru,
                     alarm sudah dibunyikan) di data/reminder_jadwal_store.json

Satu status per (tanggal WIB + username guru + sesi). Tidak ada timer di browser
yang menentukan apa pun: browser hanya bertanya "apa yang harus tampil sekarang?".
"""
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from flask import jsonify, request, session

WIB = timezone(timedelta(hours=7))

MENIT_BANNER = 10            # banner bergerak
MENIT_TAB = 5                # tab kecil tetap terlihat
POLL_MAKS_DETIK = 30         # saran interval polling ke client
SIMPAN_HARI = 3              # status lebih tua dari ini dibuang

# KEPUTUSAN YANG PERLU DIKONFIRMASI: kalau True, guru yang menekan "Mengajar di Kelas"
# tidak diperingatkan/dibunyikan lagi pada jam mulai (pilihannya TETAP hanya dicatat,
# bukan bukti kehadiran, dan kewajiban TIDAK dianggap selesai). Kalau False, peringatan
# tetap muncul sampai ada tugas/catatan.
PILIHAN_MENGAJAR_MENGHENTIKAN_ALARM = True

# Salinan jadwal yang sekarang hard-coded di dashboard_guru.js (jadwalMengajar).
# Opsional per entri: "guru": "<nama persis seperti akun>", "hari": [0..6] (Senin=0).
# Tanpa `guru`, pemilik dicari di daftar_guru berdasarkan kelas + mapel.
JADWAL_MENGAJAR = [
    {"start": "07:00", "end": "08:30", "kelas": "XII TKJ 3", "mapel": "Administrasi Infrastruktur Jaringan"},
    {"start": "08:30", "end": "10:00", "kelas": "XI TKJ 1", "mapel": "Teknologi WAN"},
    {"start": "10:15", "end": "11:45", "kelas": "X TKJ 2", "mapel": "Dasar-Dasar TKI"},
    {"start": "12:30", "end": "14:00", "kelas": "XII TAV 1", "mapel": "Audio Video Sistem"},
]

AKSI_VALID = {"banner_ditutup", "banner_diklik", "mengajar_langsung", "beri_tugas_dibuka"}

_store_lock = threading.Lock()
_store_cache = None


def sekarang_wib():
    """Satu-satunya sumber waktu. Diganti saat pengujian."""
    return datetime.now(WIB)


def _norm(teks):
    return " ".join(str(teks or "").strip().lower().split())


def _norm_kelas(teks):
    return " ".join(str(teks or "").lower().split("/")[0].replace("_", " ").split())


def _id_sesi(entri):
    return re.sub(r"[^a-z0-9]+", "_", f"{entri['kelas']}_{entri['start']}".lower()).strip("_")


def _hhmm(tgl, hhmm):
    j, m = (int(x) for x in hhmm.split(":"))
    return datetime(tgl.year, tgl.month, tgl.day, j, m, tzinfo=WIB)


def pasang_reminder_jadwal(app, *, muat_sync_store, ambil_daftar_guru, batasi, base_dir=None):
    base_dir = base_dir or os.path.dirname(os.path.abspath(__file__))
    store_path = os.path.join(base_dir, "data", "reminder_jadwal_store.json")

    # ---------------- penyimpanan status ----------------
    def muat():
        global _store_cache
        with _store_lock:
            if _store_cache is None:
                try:
                    with open(store_path, "r", encoding="utf-8") as f:
                        _store_cache = json.load(f)
                except (FileNotFoundError, json.JSONDecodeError):
                    _store_cache = {}
            return _store_cache

    def simpan(store):
        os.makedirs(os.path.dirname(store_path), exist_ok=True)
        tmp = store_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, store_path)

    def bersihkan(store, hari_ini):
        batas = (hari_ini - timedelta(days=SIMPAN_HARI)).isoformat()
        for k in [k for k in store if k.split("|", 1)[0] < batas]:
            del store[k]

    # ---------------- jadwal & kepemilikan ----------------
    def pemilik_sesi(entri):
        if entri.get("guru"):
            return _norm(entri["guru"])
        for g in ambil_daftar_guru():
            if _norm_kelas(g.get("kelas")) == _norm_kelas(entri["kelas"]) and _norm(g.get("mapel")) == _norm(entri["mapel"]):
                return _norm(g.get("nama"))
        return None

    def sesi_milik(nama_norm, tgl):
        hasil = []
        for e in JADWAL_MENGAJAR:
            if "hari" in e and tgl.weekday() not in e["hari"]:
                continue
            if pemilik_sesi(e) != nama_norm:
                continue
            hasil.append({
                "id": _id_sesi(e), "kelas": e["kelas"], "mapel": e["mapel"],
                "start": e["start"], "end": e["end"], "jam": f"{e['start']} - {e['end']}",
                "mulai": _hhmm(tgl, e["start"]), "selesai": _hhmm(tgl, e["end"]),
            })
        hasil.sort(key=lambda s: s["mulai"])
        return hasil

    def kewajiban_terpenuhi(sesi, semua, nama_norm, tgl):
        """Tugas/catatan oleh GURU INI, untuk KELAS INI, hari ini, dibuat setelah sesi
        sebelumnya (guru+kelas yang sama) berakhir dan sebelum sesi ini berakhir.
        Waktu kirim dan nama guru dicap server saat tugas disimpan (/api/sync)."""
        awal = _hhmm(tgl, "00:00")
        for s in semua:
            if s["id"] != sesi["id"] and _norm_kelas(s["kelas"]) == _norm_kelas(sesi["kelas"]) and s["selesai"] <= sesi["mulai"]:
                awal = max(awal, s["selesai"])
        awal_ms, akhir_ms = awal.timestamp() * 1000, sesi["selesai"].timestamp() * 1000
        kunci = "tasks_" + re.sub(r"\s+", "_", sesi["kelas"].strip())
        for t in muat_sync_store().get(kunci) or []:
            if not isinstance(t, dict) or _norm(t.get("namaGuru")) != nama_norm:
                continue
            w = t.get("waktuKirimGuru")
            if isinstance(w, (int, float)) and not isinstance(w, bool) and awal_ms <= w <= akhir_ms:
                return True
        return False

    def tahap_sesi(sesi, now):
        if now >= sesi["selesai"]:
            return None
        sisa = (sesi["mulai"] - now).total_seconds()
        if sisa <= 0:
            return "mulai"
        if sisa <= MENIT_TAB * 60:
            return "lima"
        if sisa <= MENIT_BANNER * 60:
            return "sepuluh"
        return None

    def detik_ke_batas(sesi, now):
        """Detik sampai tahap sesi ini berganti (untuk polling tepat waktu)."""
        sisa = (sesi["mulai"] - now).total_seconds()
        kandidat = [sisa - MENIT_BANNER * 60, sisa - MENIT_TAB * 60, sisa, (sesi["selesai"] - now).total_seconds()]
        positif = [k for k in kandidat if k > 0]
        return min(positif) if positif else None

    def guru_login():
        u = session.get("user")
        if not u or u.get("role") != "guru":
            return None
        nama = _norm(u.get("nama"))
        return (u.get("username"), nama) if nama else None

    def respon(data, kode=200):
        r = jsonify(data)
        r.status_code = kode
        r.headers["Cache-Control"] = "no-store"
        return r

    # ---------------- endpoint ----------------
    def reminder_jadwal_aktif():
        ident = guru_login()
        if not ident:
            return respon({"ok": False, "error": "Hanya untuk guru yang login"}, 403)
        username, nama = ident
        now = sekarang_wib()
        tgl = now.date()
        semua = sesi_milik(nama, tgl)
        hasil, poll = [], POLL_MAKS_DETIK
        store = muat()
        berubah = False
        for s in semua:
            tahap = tahap_sesi(s, now)
            batas = detik_ke_batas(s, now)
            if batas is not None:
                poll = min(poll, batas)
            if tahap is None or kewajiban_terpenuhi(s, semua, nama, tgl):
                continue
            kunci = f"{tgl.isoformat()}|{username}|{s['id']}"
            with _store_lock:
                st = store.setdefault(kunci, {})
                item = {"sesi_id": s["id"], "kelas": s["kelas"], "mapel": s["mapel"], "jam": s["jam"],
                        "start": s["start"], "tahap": tahap, "bunyi": False,
                        "detik_ke_mulai": int((s["mulai"] - now).total_seconds())}
                if tahap == "sepuluh":
                    if st.get("t10_selesai"):
                        continue
                    if "t10_tampil" not in st:
                        st["t10_tampil"] = int(time.time()); berubah = True
                elif tahap == "lima":
                    if st.get("pilihan") == "mengajar_langsung":
                        continue
                    if "t5_tampil" not in st:
                        st["t5_tampil"] = int(time.time()); berubah = True
                else:  # mulai
                    if PILIHAN_MENGAJAR_MENGHENTIKAN_ALARM and st.get("pilihan") == "mengajar_langsung":
                        continue
                    if "alarm_dibunyikan" not in st:   # sekali per sesi, ditandai saat dikirim
                        st["alarm_dibunyikan"] = int(time.time()); berubah = True
                        item["bunyi"] = True
                hasil.append(item)
        if berubah:
            with _store_lock:
                bersihkan(store, tgl)
                simpan(store)
        return respon({"ok": True, "waktu_server_wib": now.strftime("%Y-%m-%d %H:%M:%S") + " WIB",
                       "pengingat": hasil, "poll_lagi_detik": max(2, min(POLL_MAKS_DETIK, int(poll) + 1))})

    def reminder_jadwal_aksi():
        ident = guru_login()
        if not ident:
            return respon({"ok": False, "error": "Hanya untuk guru yang login"}, 403)
        username, nama = ident
        body = request.get_json(silent=True) or {}
        aksi, sesi_id = body.get("aksi"), body.get("sesi_id")
        if aksi not in AKSI_VALID or not isinstance(sesi_id, str):
            return respon({"ok": False, "error": "Data tidak valid"}, 400)
        now = sekarang_wib()
        tgl = now.date()
        semua = sesi_milik(nama, tgl)           # pemilik dari session server, bukan dari client
        sesi = next((s for s in semua if s["id"] == sesi_id), None)
        if not sesi:
            return respon({"ok": False, "error": "Sesi tidak ditemukan"}, 404)
        tahap = tahap_sesi(sesi, now)
        if aksi == "mengajar_langsung" and tahap not in ("lima", "mulai"):
            return respon({"ok": False, "error": "Belum waktunya"}, 409)
        kunci = f"{tgl.isoformat()}|{username}|{sesi_id}"
        store = muat()
        with _store_lock:
            st = store.setdefault(kunci, {})
            if aksi in ("banner_ditutup", "banner_diklik"):
                st["t10_selesai"] = int(time.time())
            elif aksi == "mengajar_langsung":
                st["pilihan"] = "mengajar_langsung"          # hanya pilihan, BUKAN bukti kehadiran
                st["pilihan_at"] = int(time.time())
            else:
                st["beri_tugas_dibuka_at"] = int(time.time())  # informasi saja
            bersihkan(store, tgl)
            simpan(store)
        return respon({"ok": True})

    app.add_url_rule("/api/reminder/jadwal/aktif", "reminder_jadwal_aktif",
                     batasi("berat")(reminder_jadwal_aktif), methods=["GET"])
    app.add_url_rule("/api/reminder/jadwal/aksi", "reminder_jadwal_aksi",
                     batasi("umum")(reminder_jadwal_aksi), methods=["POST"])
