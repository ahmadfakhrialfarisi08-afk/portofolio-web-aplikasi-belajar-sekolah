"""LILY DOCX -- route terpisah dari chat SCORUS AI / Lily Foto. Menghubungkan:
prompt guru -> analisis() -> pilihan A/B/Custom -> susun_schema() -> buat_docx() -> file .docx -> unduh.

Stateless: browser membawa `intent` dan `pilihan` di antara tahap (disanitasi ulang di services/lily_docx/ai.py).
Semua endpoint khusus guru yang login. Key API dibaca dari OPENAI_API_KEY (browser tidak pernah memegang key).

  POST /api/lily/docx/analisis  {prompt, jawaban?}
       -> {success, tahap:'tanya', intent, pertanyaan:[{kunci,pertanyaan}]}          (data wajib kurang, maks 3)
       -> {success, tahap:'pilih',  intent, pilihan:[{id:'A'},{id:'B'},{id:'custom'}]}
  POST /api/lily/docx/buat      {prompt, intent, pilihan:{...salah satu dari analisis}, jawaban?, struktur_custom?}
       -> {success, file_id, nama_file, judul, url, peringatan:[...]}
  GET  /api/lily/docx/unduh/<file_id>  -> file .docx (hanya milik guru yang membuatnya)

Gagal selalu JSON {success:false, kode, message}. Kode: belum_login, nonaktif, data_kurang, prompt_kosong, custom_kosong,
pilihan_tidak_valid, bukan_dokumen, rate_limit, struktur_gagal, schema_gagal, ai_gagal, render_gagal, simpan_gagal,
tidak_ditemukan, galat_server; API habis -> 503 dengan message_type 'api_exhausted' (sama seperti Lily Foto).

Identitas (sekolah, nama guru, NIP) HANYA diambil dari session['user'] bila ada; tidak pernah dikarang dan tidak dikirim ke AI.
Env opsional: LILY_DOCX_AI=0 (matikan), LILY_DOCX_DIR, LILY_DOCX_TTL_HARI, LILY_DOCX_MODEL, LILY_DOCX_TIMEOUT.
"""
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request, send_file, session, url_for

from api.scorus_ai_routes import (
    _api_habis, _catat_usage, _tandai_api_habis, _tandai_api_pulih, _teks_api_habis,
)
from services.lily_docx import SchemaError, ai, buat_docx, penyimpanan

lily_docx_bp = Blueprint('lily_docx', __name__)

MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
BATAS_REQUEST = {'analisis': (20, 600), 'buat': (8, 600)}      # (maks request, detik) per akun per proses
_hits = defaultdict(deque)
_lock = threading.Lock()

_STATUS = {'prompt_kosong': 400, 'custom_kosong': 400, 'pilihan_tidak_valid': 400, 'bukan_dokumen': 422,
           'struktur_gagal': 502, 'schema_gagal': 502, 'ai_gagal': 502}
_PESAN = {
    'prompt_kosong': 'Tulis dulu dokumen apa yang kamu butuhkan.',
    'custom_kosong': 'Tuliskan dulu struktur Custom yang kamu inginkan.',
    'pilihan_tidak_valid': 'Pilihan struktur tidak valid. Ulangi dari awal.',
    'bukan_dokumen': 'Permintaan ini sepertinya bukan permintaan membuat dokumen.',
    'struktur_gagal': 'Lily belum berhasil menyusun pilihan struktur. Coba lagi sebentar.',
    'schema_gagal': 'Lily belum berhasil menyusun dokumen. Coba lagi atau pilih struktur lain.',
    'ai_gagal': 'AI tidak merespons. Coba lagi sebentar.',
}
_KODE_LOKAL = {'prompt_kosong', 'custom_kosong', 'pilihan_tidak_valid'}   # gagal sebelum memanggil AI -> bukan pemakaian API


# ---------------------------------------------------------------- util
def _pilih_llm():
    """None = pakai ai.panggil_openai. Titik injeksi untuk test."""
    return None


def _gagal(kode, message, status):
    return jsonify(success=False, kode=kode, message=message), status


def _balasan_api_habis(alasan):
    teks = _teks_api_habis(alasan)
    return {'success': False, 'kode': 'api_habis', 'message': teks, 'response': teks, 'mood': 'concerned',
            'message_type': 'api_exhausted', 'api_status': 'exhausted', 'lily_expression': 'concerned'}


def _boleh_lanjut(username, aksi):
    maks, jendela = BATAS_REQUEST[aksi]
    sekarang = time.time()
    with _lock:
        q = _hits[(aksi, username)]
        while q and sekarang - q[0] > jendela:
            q.popleft()
        if len(q) >= maks:
            return False
        q.append(sekarang)
        return True


def _catat_aman(*a, **kw):
    try:
        _catat_usage(*a, **kw)
    except Exception:                                   # pencatatan tidak boleh menggagalkan dokumen guru
        current_app.logger.warning('lily_docx: _catat_usage gagal', exc_info=True)


def _catat_hasil(username, daftar_usage, ok):
    status = 'ok' if ok else 'error'
    for u in (daftar_usage or [None]):
        _catat_aman('lily_docx', 'api', username, ai.MODEL_DOCX, u, status=status)


def _identitas_guru(user):
    """Identitas penyusun HANYA dari session['user'] bila tersedia. Tidak ada nilai bawaan/karangan; yang kosong dibiarkan
    kosong sehingga renderer memberi garis isian. Sesuaikan nama kunci di sini bila struktur session berbeda."""
    peta = {'sekolah': ('sekolah', 'nama_sekolah'), 'guru_nama': ('nama', 'nama_lengkap', 'name'), 'nip': ('nip',)}
    out = {}
    for tujuan, kunci in peta.items():
        for k in kunci:
            v = user.get(k)
            if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
                out[tujuan] = str(v).strip()
                break
    return out or None


def _tanggal_wib():
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=7))).replace(tzinfo=None)


def _masuk():
    """(username, user, None) bila boleh lanjut; (None, None, response) bila ditolak."""
    user = session.get('user') or {}
    if user.get('role') != 'guru' or not user.get('username'):
        return None, None, _gagal('belum_login', 'Belum login sebagai guru.', 401)
    return user['username'], user, None


def _siap_ai(username):
    """Pemeriksaan sebelum memanggil AI. Response bila ditolak, None bila boleh."""
    if os.environ.get('LILY_DOCX_AI', '1') == '0':
        return _gagal('nonaktif', 'Fitur dokumen dimatikan.', 503)
    alasan = _api_habis()
    if alasan:                                          # API habis: jangan hubungi OpenAI, jangan makan jatah rate limit
        _catat_aman('lily_docx', 'api_habis', username, status='api_habis')
        return jsonify(_balasan_api_habis(alasan)), 503
    return None


def _tangani_aierror(e, username):
    if e.kode == 'api_habis':
        _tandai_api_habis(e.sebab)
        _catat_aman('lily_docx', 'api_habis', username, status='api_habis')
        return jsonify(_balasan_api_habis(e.sebab)), 503
    if e.usage:
        _tandai_api_pulih()                             # ada usage = HTTP 200 = API hidup
    if e.usage or e.kode not in _KODE_LOKAL:
        _catat_hasil(username, e.usage, False)
    current_app.logger.warning('lily_docx gagal: %s (%s)', e.kode, e.message)
    return _gagal(e.kode, _PESAN.get(e.kode, 'Dokumen belum berhasil dibuat.'), _STATUS.get(e.kode, 502))


def _galat_server(username):
    current_app.logger.exception('lily_docx: galat tak terduga')
    return _gagal('galat_server', 'Terjadi kesalahan di server. Coba lagi sebentar.', 500)


def _teks_opsional(d, kunci):
    v = d.get(kunci)
    return v if v is None or isinstance(v, str) else False


# ---------------------------------------------------------------- endpoint
@lily_docx_bp.route('/api/lily/docx/analisis', methods=['POST'])
def api_docx_analisis():
    username, user, tolak = _masuk()
    if tolak:
        return tolak
    tolak = _siap_ai(username)
    if tolak:
        return tolak
    d = request.get_json(silent=True)
    if not isinstance(d, dict) or not isinstance(d.get('prompt'), str) or _teks_opsional(d, 'jawaban') is False:
        return _gagal('data_kurang', 'Data permintaan tidak lengkap.', 400)
    if len(d['prompt'].strip()) < 3:
        return _gagal('prompt_kosong', _PESAN['prompt_kosong'], 400)
    if not _boleh_lanjut(username, 'analisis'):
        return _gagal('rate_limit', 'Terlalu sering. Coba lagi sebentar.', 429)
    try:
        hasil = ai.analisis(d['prompt'], jawaban=d.get('jawaban'), llm=_pilih_llm())
    except ai.AIError as e:
        return _tangani_aierror(e, username)
    except Exception:
        return _galat_server(username)
    _catat_hasil(username, hasil.get('usage'), True)
    _tandai_api_pulih()
    out = {k: hasil[k] for k in ('tahap', 'intent', 'pertanyaan', 'pilihan') if k in hasil}
    return jsonify(success=True, **out)


@lily_docx_bp.route('/api/lily/docx/buat', methods=['POST'])
def api_docx_buat():
    username, user, tolak = _masuk()
    if tolak:
        return tolak
    tolak = _siap_ai(username)
    if tolak:
        return tolak
    d = request.get_json(silent=True)
    if (not isinstance(d, dict) or not isinstance(d.get('prompt'), str) or not isinstance(d.get('pilihan'), dict)
            or _teks_opsional(d, 'jawaban') is False or _teks_opsional(d, 'struktur_custom') is False):
        return _gagal('data_kurang', 'Data permintaan tidak lengkap.', 400)
    if len(d['prompt'].strip()) < 3:
        return _gagal('prompt_kosong', _PESAN['prompt_kosong'], 400)
    if d['pilihan'].get('id') == ai.ID_CUSTOM and len((d.get('struktur_custom') or '').strip()) < 3:
        return _gagal('custom_kosong', _PESAN['custom_kosong'], 400)
    if not _boleh_lanjut(username, 'buat'):
        return _gagal('rate_limit', 'Terlalu sering. Coba lagi sebentar.', 429)

    try:
        hasil = ai.susun_schema(d['prompt'], d.get('intent'), d['pilihan'], jawaban=d.get('jawaban'),
                                struktur_custom=d.get('struktur_custom'), llm=_pilih_llm())
    except ai.AIError as e:
        return _tangani_aierror(e, username)
    except Exception:
        return _galat_server(username)
    _catat_hasil(username, hasil.get('usage'), True)
    _tandai_api_pulih()
    schema = hasil['schema']

    kw = {'tanggal': _tanggal_wib()}
    identitas = _identitas_guru(user)
    if identitas:
        kw['identitas'] = identitas
    try:
        data = buat_docx(schema, **kw)
        if not isinstance(data, (bytes, bytearray)) or not bytes(data[:2]) == b'PK':
            raise ValueError('hasil renderer bukan file docx')
    except SchemaError:
        current_app.logger.warning('lily_docx: schema ditolak renderer', exc_info=True)
        return _gagal('schema_gagal', _PESAN['schema_gagal'], 502)
    except Exception:
        current_app.logger.exception('lily_docx: render gagal')
        return _gagal('render_gagal', 'Dokumen gagal dibuat. Coba lagi sebentar.', 500)

    nama = penyimpanan.nama_file_aman(schema.get('judul'))
    try:
        fid = penyimpanan.simpan(username, bytes(data), nama)
    except OSError:
        current_app.logger.exception('lily_docx: simpan gagal')
        return _gagal('simpan_gagal', 'Dokumen berhasil dibuat tetapi gagal disimpan. Coba lagi.', 500)
    return jsonify(success=True, file_id=fid, nama_file=nama, judul=schema.get('judul'),
                   url=url_for('lily_docx.api_docx_unduh', file_id=fid), peringatan=hasil.get('peringatan') or [])


@lily_docx_bp.route('/api/lily/docx/unduh/<file_id>', methods=['GET'])
def api_docx_unduh(file_id):
    username, user, tolak = _masuk()
    if tolak:
        return tolak
    ada = penyimpanan.buka(username, file_id)
    if not ada:
        return _gagal('tidak_ditemukan', 'File tidak ditemukan atau sudah kedaluwarsa.', 404)
    path, nama = ada
    try:
        resp = send_file(path, mimetype=MIME_DOCX, as_attachment=True, download_name=nama, max_age=0)
    except OSError:
        return _gagal('tidak_ditemukan', 'File tidak ditemukan atau sudah kedaluwarsa.', 404)
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    return resp
