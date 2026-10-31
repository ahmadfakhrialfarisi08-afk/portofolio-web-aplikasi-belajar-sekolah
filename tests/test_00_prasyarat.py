"""Tes prasyarat Lily DOCX: apakah implementasi yang diharapkan tes benar-benar ada di project ini.

Tidak menulis ulang atau menggantikan implementasi apa pun. Hanya memeriksa:
  1. berkas implementasi ada di lokasi yang diharapkan,
  2. dependensi (python-docx, lxml, flask) terpasang,
  3. modul bisa diimpor dan menyediakan simbol yang dipakai tes lain,
  4. status services/lily_docx/offline.py dilaporkan terpisah (SKIP bila tidak ada, bukan PASS).

Tanpa jaringan, tanpa token API. Jalankan dari root project:
    python -m unittest test.test_00_prasyarat -v
"""
import importlib
import importlib.util
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

BERKAS_WAJIB = [
    'app.py',
    os.path.join('services', 'lily_docx', '__init__.py'),
    os.path.join('services', 'lily_docx', 'ai.py'),
    os.path.join('services', 'lily_docx', 'penyimpanan.py'),
    os.path.join('api', 'lily_docx_routes.py'),
    os.path.join('api', 'scorus_ai_routes.py'),
]
BERKAS_OFFLINE = os.path.join('services', 'lily_docx', 'offline.py')

# Simbol yang diakses oleh test_lily_docx*.py (diekstrak dari kode tes, bukan dikarang).
KONTRAK = {
    'services.lily_docx': ['SchemaError', 'buat_docx', 'validasi_dokumen', 'ai', 'penyimpanan'],
    'services.lily_docx.ai': ['AIError', 'MAKS_BAGIAN', 'MAKS_CUSTOM', 'MAKS_PROMPT', '_opsi_custom',
                              'analisis', 'buat_dokumen', 'panggil_openai', 'susun_schema'],
    'services.lily_docx.penyimpanan': ['MAKS_FILE_PER_GURU', '_dir_guru', 'bersihkan', 'buka',
                                       'direktori_dasar', 'nama_file_aman', 'simpan'],
    'api.lily_docx_routes': ['BATAS_REQUEST', 'MIME_DOCX', '_hits', 'lily_docx_bp', 'penyimpanan', 'buat_docx',
                             '_api_habis', '_tandai_api_habis', '_tandai_api_pulih', '_catat_usage',
                             '_teks_api_habis', '_pilih_llm'],
    'api.scorus_ai_routes': ['STATUS_FILE', 'USAGE_DIR', '_status_mem', '_api_habis', '_tandai_api_habis'],
}


def _simbol_ada(modul, nama_modul, simbol):
    """Atribut biasa, atau submodul (mis. services.lily_docx.ai) yang baru jadi atribut setelah diimpor."""
    if hasattr(modul, simbol):
        return True
    if hasattr(modul, '__path__') and importlib.util.find_spec(nama_modul + '.' + simbol) is not None:
        importlib.import_module(nama_modul + '.' + simbol)  # bila submodul rusak, galatnya muncul jelas
        return True
    return False


class TestStrukturProject(unittest.TestCase):
    def test_berkas_implementasi_ada(self):
        for rel in BERKAS_WAJIB:
            with self.subTest(berkas=rel):
                self.assertTrue(os.path.isfile(os.path.join(ROOT, rel)), 'Tidak ditemukan: %s (ROOT=%s)' % (rel, ROOT))

    def test_requirements_memuat_python_docx(self):
        req = os.path.join(ROOT, 'requirements.txt')
        if not os.path.isfile(req):
            self.skipTest('requirements.txt tidak ada di ROOT')
        with open(req, 'rb') as f:
            mentah = f.read()
        teks = mentah.decode('utf-16' if mentah[:2] in (b'\xff\xfe', b'\xfe\xff') else 'utf-8')
        nama = [b.split('==')[0].strip().lower() for b in teks.splitlines() if b.strip()]
        for paket in ('python-docx', 'lxml'):
            self.assertIn(paket, nama)


class TestDependensi(unittest.TestCase):
    def test_paket_terpasang(self):
        for modul in ('docx', 'lxml', 'flask'):
            with self.subTest(modul=modul):
                self.assertIsNotNone(importlib.util.find_spec(modul), 'Paket belum terpasang: %s' % modul)


class TestKontrakSimbol(unittest.TestCase):
    def test_modul_dan_simbol_tersedia(self):
        for nama_modul, simbol in KONTRAK.items():
            with self.subTest(modul=nama_modul):
                try:
                    m = importlib.import_module(nama_modul)
                except Exception as e:  # noqa: BLE001 - tujuan tes ini justru melaporkan segala kegagalan impor
                    self.fail('Gagal impor %s: %s: %s' % (nama_modul, type(e).__name__, e))
                hilang = [s for s in simbol if not _simbol_ada(m, nama_modul, s)]
                self.assertEqual(hilang, [], 'Simbol tidak ada di %s: %s' % (nama_modul, hilang))


class TestOfflineGenerator(unittest.TestCase):
    def test_status_offline_py(self):
        """Dilaporkan terpisah. Tidak ada antarmuka offline.py di tes mana pun, jadi tes ini hanya mendeteksi keberadaan."""
        path = os.path.join(ROOT, BERKAS_OFFLINE)
        if not os.path.isfile(path):
            self.skipTest('%s tidak ada: generator offline TIDAK dapat diuji (belum ada implementasi atau belum disertakan)' % BERKAS_OFFLINE)
        try:
            importlib.import_module('services.lily_docx.offline')
        except Exception as e:  # noqa: BLE001
            self.fail('offline.py ada tetapi gagal diimpor: %s: %s' % (type(e).__name__, e))
        self.skipTest('offline.py ada dan bisa diimpor, tetapi belum ada tes perilakunya: tambahkan setelah antarmukanya diketahui')


if __name__ == '__main__':
    unittest.main(verbosity=2)
