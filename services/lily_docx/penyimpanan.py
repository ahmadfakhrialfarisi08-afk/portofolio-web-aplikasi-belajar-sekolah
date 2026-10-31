"""Penyimpanan file .docx hasil Lily DOCX: aman, per-guru, nama file masuk akal. Tanpa Flask (mudah dites).

- File ada di <root project>/data/lily_docx/<hash-username>/<id>.docx (ubah lewat env LILY_DOCX_DIR).
- <id> = uuid4 hex (tidak bisa ditebak); folder tiap guru dinamai hash username, jadi guru lain tidak bisa membuka file orang lain.
- Path TIDAK PERNAH dibentuk dari input klien selain <id> yang divalidasi ^[0-9a-f]{32}$ (tahan path traversal).
- Penulisan atomik (tmp -> os.replace): tidak ada file setengah jadi.
- Dibersihkan otomatis: file lebih tua dari LILY_DOCX_TTL_HARI (default 7) dan kelebihan di atas 50 file per guru.
"""
import hashlib
import json
import os
import re
import tempfile
import time
import unicodedata
import uuid

MAKS_FILE_PER_GURU = 50
_RE_ID = re.compile(r'^[0-9a-f]{32}$')
_RE_BERKAS = re.compile(r'^([0-9a-f]{32})\.(docx|json)$')


def direktori_dasar():
    env = (os.environ.get('LILY_DOCX_DIR') or '').strip()
    if env:
        return env
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, 'data', 'lily_docx')


def _ttl_detik():
    try:
        return max(0.0, float(os.environ.get('LILY_DOCX_TTL_HARI', '7'))) * 86400
    except ValueError:
        return 7 * 86400.0


def _dir_guru(username, dasar=None, buat=False):
    d = os.path.join(dasar or direktori_dasar(), hashlib.sha256(str(username).encode('utf-8')).hexdigest()[:24])
    if buat:
        os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def nama_file_aman(judul, cadangan='dokumen_lily'):
    """'Modul Ajar Basis Data: XI TKJ' -> 'Modul_Ajar_Basis_Data_XI_TKJ.docx' (ASCII, tanpa karakter terlarang, maks ~80)."""
    t = unicodedata.normalize('NFKD', str(judul or '')).encode('ascii', 'ignore').decode('ascii')
    t = re.sub(r'[^A-Za-z0-9]+', '_', t).strip('_')[:80].strip('_')
    return (t or cadangan) + '.docx'


def _tulis_atomik(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix='.tmp')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def bersihkan(username, dasar=None, sekarang=None, ttl=None, maks=None):
    """Hapus file kedaluwarsa dan kelebihan milik satu guru. Mengembalikan jumlah dokumen yang dihapus."""
    d = _dir_guru(username, dasar)
    sekarang = time.time() if sekarang is None else sekarang
    ttl = _ttl_detik() if ttl is None else ttl
    maks = MAKS_FILE_PER_GURU if maks is None else maks
    try:
        daftar = os.listdir(d)
    except OSError:
        return 0
    grup, waktu = {}, {}
    for n in daftar:
        p = os.path.join(d, n)
        m = _RE_BERKAS.match(n)
        try:
            mtime = os.path.getmtime(p)
            if m:
                grup.setdefault(m.group(1), []).append(p)
                waktu[m.group(1)] = max(waktu.get(m.group(1), 0), mtime)
            elif n.endswith('.tmp') and sekarang - mtime > 3600:
                os.remove(p)
        except OSError:
            continue
    dihapus = 0
    for i, fid in enumerate(sorted(waktu, key=waktu.get, reverse=True)):
        if sekarang - waktu[fid] > ttl or i >= maks - 1:      # sisakan 1 tempat untuk file yang akan disimpan
            for p in grup[fid]:
                try:
                    os.remove(p)
                except OSError:
                    pass
            dihapus += 1
    return dihapus


def simpan(username, data, nama, dasar=None):
    """Simpan bytes .docx; mengembalikan file_id. OSError dibiarkan naik (pemanggil menjawab 'simpan_gagal')."""
    d = _dir_guru(username, dasar, buat=True)
    bersihkan(username, dasar)
    fid = uuid.uuid4().hex
    _tulis_atomik(os.path.join(d, fid + '.docx'), data)
    try:
        _tulis_atomik(os.path.join(d, fid + '.json'), json.dumps({'nama': nama, 'dibuat': time.time()}).encode('utf-8'))
    except OSError:
        pass                                                   # nama cadangan dipakai saat unduh
    return fid


def buka(username, file_id, dasar=None):
    """(path, nama_unduh) bila file milik guru ini ada, selain itu None."""
    if not isinstance(file_id, str) or not _RE_ID.match(file_id):
        return None
    d = _dir_guru(username, dasar)
    path = os.path.join(d, file_id + '.docx')
    if not os.path.isfile(path):
        return None
    nama = None
    try:
        with open(os.path.join(d, file_id + '.json'), encoding='utf-8') as f:
            nama = json.load(f).get('nama')
    except (OSError, ValueError, AttributeError):
        pass
    return path, nama_file_aman(os.path.splitext(str(nama or ''))[0])
