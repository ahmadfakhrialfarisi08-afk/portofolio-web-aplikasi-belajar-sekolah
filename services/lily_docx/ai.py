"""Lily DOCX -- AI Logic: prompt guru -> intent -> 2 struktur dinamis + Custom -> Document Schema.

Modul ini TIDAK menyentuh schema.py / templates.py / renderer.py. Ia hanya memakai API publik paket:
  validasi_dokumen, SchemaError, buat_docx.

Alur (stateless; browser membawa intent + pilihan di antara tahap, tidak dipercaya mentah -> disanitasi ulang):

  1) analisis(prompt, identitas, jawaban=None)
       -> {"tahap": "tanya", "pertanyaan": [{kunci, pertanyaan}], "intent": {...}}   data wajib kurang (maks 3)
       -> {"tahap": "pilih", "intent": {...}, "pilihan": [A, B, custom]}            A & B dari AI, custom selalu ada
     Satu panggilan AI. Bila guru sudah menjawab (jawaban != None) AI tidak boleh bertanya lagi.
  2) susun_schema(prompt, intent, pilihan, jawaban, struktur_custom, identitas)
       -> {"schema": <dict valid hasil validasi_dokumen>, "peringatan": [...], "usage": [...]}
  3) buat_dokumen(...) = susun_schema() + buat_docx()  -> tambah kunci "docx": bytes

Injeksi LLM: semua fungsi menerima `llm(pesan, maks_token, temperature) -> (hasil_dict|None, jenis_error|None, usage|None)`
(bentuk sama dengan _panggil_openai di lily_foto_routes.py). Default: panggil_openai() di bawah.
Setiap kegagalan menjadi AIError(kode, message) supaya route memilih respons yang jujur per jenis kegagalan.

Env opsional: OPENAI_API_KEY (dibaca saat request), LILY_DOCX_MODEL=gpt-4o-mini, LILY_DOCX_TIMEOUT=60 (detik).
"""
import json
import os
import re
import urllib.error
import urllib.request

from services.lily_docx import SchemaError, buat_docx, validasi_dokumen

MODEL_DOCX = os.environ.get('LILY_DOCX_MODEL', 'gpt-4o-mini')
try:
    TIMEOUT_DOCX = max(10.0, min(120.0, float(os.environ.get('LILY_DOCX_TIMEOUT', '60'))))
except ValueError:
    TIMEOUT_DOCX = 60.0

MAKS_PROMPT = 1500
MAKS_JAWABAN = 800
MAKS_CUSTOM = 600
MAKS_PERTANYAAN = 3
MIN_BAGIAN, MAKS_BAGIAN = 3, 12
ID_CUSTOM = 'custom'

# Data identitas/administratif TIDAK pernah ditanyakan ke guru: diisi sistem dari profil, atau dikosongkan (garis isian).
_KUNCI_IDENTITAS = ('sekolah', 'nip', 'nuptk', 'kepala', 'nomor_sk', 'no_sk', 'nama_guru', 'guru', 'penyusun',
                    'tanggal', 'identitas', 'tanda_tangan', 'ttd', 'alamat', 'npsn')


class AIError(Exception):
    """kode: prompt_kosong, bukan_dokumen, custom_kosong, pilihan_tidak_valid, struktur_gagal, schema_gagal,
    api_habis (sebab 'quota'/'kunci' -> route memanggil _tandai_api_habis), ai_gagal."""

    def __init__(self, kode, message, sebab=None, usage=None):
        Exception.__init__(self, message)
        self.kode, self.message, self.sebab, self.usage = kode, message, sebab, usage or []


class _Ulang(Exception):
    """Keluaran AI tidak memenuhi syarat; layak dicoba sekali lagi dengan catatan perbaikan."""


# ---------------------------------------------------------------- klien OpenAI (tanpa retry internal)
def panggil_openai(pesan, maks_token=4000, temperature=0.5):
    key = (os.environ.get('OPENAI_API_KEY') or '').strip()
    if not key:
        return None, 'lain', None
    badan = {'model': MODEL_DOCX, 'messages': pesan, 'response_format': {'type': 'json_object'},
             'temperature': temperature, 'max_tokens': maks_token}
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions', data=json.dumps(badan).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_DOCX) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        kode = ''
        try:
            err = json.load(e).get('error') or {}
            kode = (str(err.get('code') or '') + ' ' + str(err.get('type') or '')).lower()
        except (ValueError, AttributeError, OSError):
            pass
        if 'insufficient_quota' in kode or 'billing' in kode:
            return None, 'quota', None
        if e.code in (401, 403) or 'invalid_api_key' in kode:
            return None, 'kunci', None
        return None, 'lain', None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None, 'lain', None
    usage = data.get('usage') if isinstance(data, dict) else None
    try:
        return json.loads(data['choices'][0]['message']['content']), None, usage
    except (KeyError, IndexError, TypeError, ValueError):
        return None, None, usage


class _Sesi:
    """Membungkus llm: mengumpulkan usage (untuk dicatat route) dan memetakan kegagalan ke AIError."""

    def __init__(self, llm):
        self.llm = llm or panggil_openai
        self.usage = []

    def minta(self, pesan, maks_token, temperature):
        hasil, jenis, usage = self.llm(pesan, maks_token, temperature)
        if usage:
            self.usage.append(usage)
        if jenis in ('quota', 'kunci'):
            raise AIError('api_habis', 'API AI tidak tersedia.', sebab=jenis, usage=self.usage)
        if not isinstance(hasil, dict):
            raise AIError('ai_gagal', 'AI tidak merespons.', usage=self.usage)
        return hasil


# ---------------------------------------------------------------- pembersih kecil
_RE_KONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_RE_NOMOR = re.compile(r'^\s*(?:[-*\u2022#>]+|\d+\s*[.)])\s*')


def _bersih(teks, batas):
    return re.sub(r'\s+', ' ', _RE_KONTROL.sub('', str(teks or ''))).strip()[:batas]


def _judul_bagian(teks):
    return _bersih(_RE_NOMOR.sub('', str(teks or '').replace('**', '')), 80)


def _norm(teks):
    return re.sub(r'[^a-z0-9 ]+', '', _judul_bagian(teks).lower()).strip()


def _slug(teks):
    s = re.sub(r'[^a-z0-9]+', '_', str(teks or '').lower()).strip('_')[:40]
    return s or None


# ---------------------------------------------------------------- tahap 1: analisis -> pertanyaan | pilihan
SYS_ANALISIS = (
    "Kamu perencana dokumen untuk Lily, asisten guru SMK di SCORUS AI. Balas SATU objek JSON saja, bahasa Indonesia.\n"
    "Tugas: pahami permintaan guru, lalu rancang pilihan struktur dokumen yang cocok untuk permintaan INI.\n"
    "Kunci JSON:\n"
    '- "dokumen_guru": true bila guru meminta dibuatkan dokumen (modul ajar, soal, surat, rubrik, notulen, laporan, dst); false bila bukan.\n'
    '- "jenis": label jenis dokumen huruf kecil dengan garis bawah (mis. modul_ajar, surat_tugas); pilih yang paling pas.\n'
    '- "topik": topik/isi pokok dokumen (maks 15 kata).\n'
    '- "ringkasan": satu kalimat apa yang diminta guru.\n'
    '- "data_kurang": daftar {"kunci": ..., "pertanyaan": ...}, maks 3. Isi HANYA bila tanpa data itu isi dokumen tidak bisa dibuat '
    "dengan benar (mis. topik/mata pelajaran/jenjang yang tidak tersirat sama sekali). Bila permintaan sudah cukup jelas, kosongkan []. "
    "DILARANG menanyakan: nama sekolah, nama guru, NIP, nama kepala sekolah, nomor SK, tanggal, atau identitas lain; itu diisi sistem "
    "atau dikosongkan dengan garis isian. Jangan menanyakan preferensi gaya/panjang; itu dipilih lewat pilihan struktur.\n"
    '- "pilihan": TEPAT 2 struktur, atau [] bila data_kurang tidak kosong. Tiap pilihan: {"judul": nama singkat pilihan, '
    '"deskripsi": 1 kalimat apa bedanya, "bagian": daftar 3-12 nama bagian berurutan}. '
    "Kedua pilihan harus BERBEDA NYATA (pendekatan, kedalaman, atau fokus) dan disusun khusus untuk permintaan ini, bukan daftar baku. "
    "Nama bagian = judul bagian dokumen saja, tanpa nomor, tanpa penjelasan."
)


def _pertanyaan_valid(daftar):
    out, lihat = [], set()
    for x in (daftar if isinstance(daftar, list) else []):
        if not isinstance(x, dict):
            continue
        kunci = _slug(x.get('kunci')) or 'data'
        tanya = _bersih(x.get('pertanyaan'), 200)
        if not tanya or any(k in kunci for k in _KUNCI_IDENTITAS) or tanya.lower() in lihat:
            continue
        lihat.add(tanya.lower())
        out.append({'kunci': kunci, 'pertanyaan': tanya})
    return out[:MAKS_PERTANYAAN]


def _opsi_bersih(raw):
    """Satu opsi dari sumber tak tepercaya -> dict rapi atau None."""
    if not isinstance(raw, dict) or not isinstance(raw.get('bagian'), list):
        return None
    bagian, lihat = [], set()
    for b in raw['bagian']:
        j = _judul_bagian(b)
        if j and _norm(j) not in lihat:
            lihat.add(_norm(j))
            bagian.append(j)
    if not (MIN_BAGIAN <= len(bagian) <= MAKS_BAGIAN):
        return None
    judul = _bersih(raw.get('judul'), 60)
    if not judul:
        return None
    return {'judul': judul, 'deskripsi': _bersih(raw.get('deskripsi'), 160), 'bagian': bagian}


def _dua_opsi(daftar):
    """Ambil 2 opsi valid yang tidak sama struktur. id A/B ditentukan kode, bukan AI."""
    hasil, tanda = [], set()
    for raw in (daftar if isinstance(daftar, list) else []):
        o = _opsi_bersih(raw)
        if not o:
            continue
        sig = tuple(_norm(b) for b in o['bagian'])
        if sig in tanda:
            continue
        tanda.add(sig)
        hasil.append(o)
    if len(hasil) < 2:
        raise _Ulang('perlu tepat 2 pilihan struktur valid yang berbeda (3-12 bagian, judul terisi), ditemukan %d' % len(hasil))
    for o, i in zip(hasil[:2], 'AB'):
        o['id'] = i
    return hasil[:2]


def _opsi_custom():
    return {'id': ID_CUSTOM, 'judul': 'Custom', 'bagian': [],
            'deskripsi': 'Tulis sendiri bagian atau isi dokumen yang kamu inginkan.'}


def _intent_bersih(raw):
    raw = raw if isinstance(raw, dict) else {}
    return {'jenis': _slug(raw.get('jenis')), 'topik': _bersih(raw.get('topik'), 150), 'ringkasan': _bersih(raw.get('ringkasan'), 200)}


def analisis(prompt, identitas=None, jawaban=None, llm=None):
    prompt = _bersih(prompt, MAKS_PROMPT)
    jawaban = _bersih(jawaban, MAKS_JAWABAN)
    if len(prompt) < 3:
        raise AIError('prompt_kosong', 'Permintaan dokumen masih kosong.')
    sesi = _Sesi(llm)
    teks = 'Permintaan guru: ' + prompt
    if jawaban:
        teks += '\nJawaban guru atas pertanyaan sebelumnya: ' + jawaban + '\nData sudah cukup: JANGAN bertanya lagi, data_kurang harus [].'
    catatan = ''
    for percobaan in range(2):
        pesan = [{'role': 'system', 'content': SYS_ANALISIS}, {'role': 'user', 'content': teks + catatan}]
        hasil = sesi.minta(pesan, 1200, 0.7)
        intent = _intent_bersih(hasil)
        if hasil.get('dokumen_guru') is False:
            if jawaban:
                raise AIError('bukan_dokumen', 'Permintaan ini bukan permintaan membuat dokumen.', usage=sesi.usage)
            return {'tahap': 'tanya', 'intent': intent, 'usage': sesi.usage, 'pertanyaan': [
                {'kunci': 'dokumen', 'pertanyaan': 'Dokumen guru apa yang ingin Lily buatkan, dan tentang apa?'}]}
        if not jawaban:
            tanya = _pertanyaan_valid(hasil.get('data_kurang'))
            if tanya:
                return {'tahap': 'tanya', 'intent': intent, 'pertanyaan': tanya, 'usage': sesi.usage}
        try:
            opsi = _dua_opsi(hasil.get('pilihan'))
        except _Ulang as e:
            catatan = '\nPerbaikan: respons sebelumnya ditolak karena ' + str(e) + '. Isi "pilihan" dengan benar dan kosongkan data_kurang.'
            continue
        return {'tahap': 'pilih', 'intent': intent, 'pilihan': opsi + [_opsi_custom()], 'usage': sesi.usage}
    raise AIError('struktur_gagal', 'Lily belum berhasil menyusun pilihan struktur.', usage=sesi.usage)


# ---------------------------------------------------------------- tahap 2: pilihan -> Document Schema
SYS_SCHEMA = (
    "Kamu penulis dokumen guru SMK untuk Lily (SCORUS AI). Balas SATU objek JSON saja, bahasa Indonesia baku. "
    "Tulis isi dokumen yang LENGKAP, konkret, dan siap pakai di kelas.\n"
    "Bentuk JSON:\n"
    '{"jenis": str, "judul": str, "meta": [[label, nilai], ...], "bagian": [{"judul": str, "blok": [...]}, ...], '
    '"isian_kosong": [label, ...], "tanda_tangan": true|false}\n'
    "Jenis blok (tiap bagian minimal 1 blok):\n"
    '  {"tipe":"paragraf","teks":str}\n'
    '  {"tipe":"subjudul","teks":str}\n'
    '  {"tipe":"daftar","gaya":"nomor"|"bullet","item":[str,...]}   (item TANPA nomor/simbol di depan)\n'
    '  {"tipe":"tabel","kolom":[str,...],"baris":[[str,...],...]}    (jumlah sel tiap baris = jumlah kolom)\n'
    "Aturan keras:\n"
    "- Isi dokumen saja. DILARANG kalimat pembuka/penutup/meta AI (\"Tentu\", \"Berikut adalah\", \"Semoga bermanfaat\", "
    "catatan untuk pengguna, penjelasan proses), DILARANG markdown (**, ##, ```), DILARANG teks placeholder seperti [isi di sini].\n"
    "- Jangan mengarang identitas atau data administratif: nama sekolah, nama guru, NIP, nama kepala sekolah, nomor SK, NIS, tanggal. "
    "Sistem mengisi nama sekolah, penyusun, NIP, tanggal, dan blok tanda tangan sendiri; jangan menuliskannya di meta atau isi.\n"
    '- "meta": hanya data yang PASTI dari permintaan guru (mata pelajaran, kelas, topik, alokasi waktu, dst). Nilai tidak diketahui jangan '
    'dimasukkan ke meta; masukkan labelnya ke "isian_kosong" (mis. "Nomor SK") agar sistem memberi garis isian.\n'
    '- Bila isi memang butuh ruang tulis tangan, pakai "________" di dalam teks.\n'
    '- "bagian": ikuti STRUKTUR yang diberikan: satu bagian per nama, urutan sama, judul bagian = nama itu. Jangan menambah bagian lain.\n'
    '- "tanda_tangan": true bila jenis dokumen lazim disahkan/ditandatangani, selain itu false.'
)


def _blok_struktur(pilihan, struktur_custom):
    if pilihan['id'] == ID_CUSTOM:
        return ('Struktur CUSTOM dari guru (ikuti: bila berupa daftar nama bagian, pakai persis sebagai judul bagian berurutan; '
                'bila berupa permintaan bebas, susun bagian yang paling sesuai): ' + struktur_custom)
    return 'Struktur terpilih "%s" (%s). Bagian berurutan: %s' % (
        pilihan['judul'], pilihan['deskripsi'] or '-', ' | '.join(pilihan['bagian']))


def _bagian_hilang(schema, wajib):
    ada = [_norm(b.get('judul')) for b in schema.get('bagian', []) if isinstance(b, dict)]
    hilang = []
    for w in wajib:
        n = _norm(w)
        if not any(n == a or (n and a and (n in a or a in n)) for a in ada):
            hilang.append(w)
    return hilang


def _siapkan_pilihan(pilihan, struktur_custom):
    if not isinstance(pilihan, dict):
        raise AIError('pilihan_tidak_valid', 'Pilihan struktur tidak valid.')
    if pilihan.get('id') == ID_CUSTOM:
        custom = _bersih(struktur_custom, MAKS_CUSTOM)
        if len(custom) < 3:
            raise AIError('custom_kosong', 'Tuliskan dulu struktur Custom yang kamu inginkan.')
        return _opsi_custom(), custom
    o = _opsi_bersih(pilihan)
    if not o:
        raise AIError('pilihan_tidak_valid', 'Pilihan struktur tidak valid.')
    o['id'] = pilihan.get('id') if pilihan.get('id') in ('A', 'B') else 'A'
    return o, ''


def susun_schema(prompt, intent, pilihan, jawaban=None, struktur_custom=None, identitas=None, llm=None):
    """identitas tidak dikirim ke AI sama sekali (dipakai renderer lewat buat_docx); parameter ada demi kesamaan tanda tangan."""
    prompt = _bersih(prompt, MAKS_PROMPT)
    if len(prompt) < 3:
        raise AIError('prompt_kosong', 'Permintaan dokumen masih kosong.')
    pilihan, custom = _siapkan_pilihan(pilihan, struktur_custom)
    intent = _intent_bersih(intent)
    jawaban = _bersih(jawaban, MAKS_JAWABAN)
    teks = 'Permintaan guru: ' + prompt + '\n'
    if intent['jenis']:
        teks += 'Jenis dokumen: ' + intent['jenis'] + '\n'
    if intent['topik']:
        teks += 'Topik: ' + intent['topik'] + '\n'
    if jawaban:
        teks += 'Jawaban guru atas pertanyaan data: ' + jawaban + '\n'
    teks += _blok_struktur(pilihan, custom)

    sesi = _Sesi(llm)
    catatan, hilang_akhir, terakhir = '', [], None
    for percobaan in range(2):
        pesan = [{'role': 'system', 'content': SYS_SCHEMA}, {'role': 'user', 'content': teks + catatan}]
        mentah = sesi.minta(pesan, 4500, 0.5)
        try:
            try:
                schema = validasi_dokumen(mentah)
            except SchemaError as e:
                if 'jenis' not in str(e).lower() or 'jenis' not in mentah:
                    raise
                mentah = dict(mentah)
                del mentah['jenis']          # dokumen tanpa 'jenis' sah (lihat test_dokumen_besar_tetap_valid)
                schema = validasi_dokumen(mentah)
        except SchemaError as e:
            terakhir = str(e)
            catatan = '\nPerbaikan: dokumen sebelumnya ditolak validator karena: %s. Buat ulang, lengkapi isi tiap bagian.' % terakhir
            continue
        hilang_akhir = _bagian_hilang(schema, pilihan['bagian']) if pilihan['id'] != ID_CUSTOM else []
        if hilang_akhir and percobaan == 0:
            catatan = '\nPerbaikan: bagian berikut belum ada, wajib dibuat dengan judul persis: ' + ' | '.join(hilang_akhir)
            continue
        return {'schema': schema, 'usage': sesi.usage,
                'peringatan': ['Bagian "%s" tidak berhasil dibuat.' % h for h in hilang_akhir]}
    raise AIError('schema_gagal', 'Lily belum berhasil menyusun dokumen: %s' % terakhir, usage=sesi.usage)


def buat_dokumen(prompt, intent, pilihan, jawaban=None, struktur_custom=None, identitas=None,
                 template=None, tanggal=None, llm=None):
    hasil = susun_schema(prompt, intent, pilihan, jawaban=jawaban, struktur_custom=struktur_custom,
                         identitas=identitas, llm=llm)
    hasil['docx'] = buat_docx(hasil['schema'], identitas=identitas, template=template, tanggal=tanggal)
    return hasil
