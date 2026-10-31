# -*- coding: utf-8 -*-
"""Tes modul services/lily_offline (KB, intent, router). Jalankan: python -m unittest discover -s test -v"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.lily_offline import KnowledgeBase, KBError, router  # noqa: E402
from services.lily_offline.knowledge import normalisasi  # noqa: E402

def _baca(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "services", "lily_offline", "data", "kb_default.json")


class Dasar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.user = os.path.join(self.tmp.name, "kb_guru.json")
        self.kb = KnowledgeBase(DEFAULT, self.user)
        self._env = dict(os.environ)

    def tearDown(self):
        os.environ.clear(); os.environ.update(self._env)
        router.reset_kb()
        self.tmp.cleanup()


class TestNormalisasi(unittest.TestCase):
    def test_huruf_kecil_dan_tanda_baca(self):
        self.assertEqual(normalisasi("  Halo,  LILY!!! "), "halo lily")

    def test_aksen_dan_none(self):
        self.assertEqual(normalisasi("Café"), "cafe")
        self.assertEqual(normalisasi(None), "")


class TestIntent(Dasar):
    def intent(self, t):
        e, _ = self.kb.cari(t)
        return e["id"] if e else None

    def test_sapaan(self):
        for t in ("halo", "Hai!", "selamat pagi", "Assalamualaikum"):
            self.assertEqual(self.intent(t), "sapaan", t)

    def test_terima_kasih_dan_pamit(self):
        self.assertEqual(self.intent("makasih ya"), "terima_kasih")
        self.assertEqual(self.intent("dadah lily"), "pamit")

    def test_identitas_kemampuan(self):
        self.assertEqual(self.intent("kamu siapa?"), "identitas")
        self.assertEqual(self.intent("kamu bisa apa"), "kemampuan")

    def test_dokumen(self):
        self.assertEqual(self.intent("tolong buat dokumen modul ajar matematika"), "dokumen")

    def test_status_offline(self):
        self.assertEqual(self.intent("kenapa offline sih"), "status_offline")

    def test_sapaan_di_kalimat_panjang_tidak_menjawab_sapaan(self):
        # "halo" + pertanyaan panjang jangan dijawab hanya dengan sapaan
        self.assertNotEqual(self.intent("halo, tolong jelaskan perbedaan fotosintesis dan respirasi seluler"), "sapaan")

    def test_frasa_terpanjang_menang(self):
        self.assertEqual(self.intent("halo, buat dokumen rpp ya"), "dokumen")

    def test_kata_utuh_bukan_potongan(self):
        self.assertIsNone(self.intent("sepatu"))          # 'hi'/'pagi' tidak boleh cocok di dalam kata lain
        self.assertIsNone(self.intent("tempagi"))

    def test_tidak_ada_kecocokan(self):
        self.assertIsNone(self.intent("berapa hasil 17 dikali 23"))
        self.assertIsNone(self.intent(""))
        self.assertIsNone(self.intent("???"))


class TestKB(Dasar):
    def test_tambah_dan_cari(self):
        self.kb.tambah("jam_kerja", ["jam kerja", "jam buka"], "Info jam kerja diisi guru.")
        e, _ = self.kb.cari("jam buka sekolah?")
        self.assertEqual(e["id"], "jam_kerja")

    def test_tambah_tersimpan_ke_file_dan_dimuat_ulang(self):
        self.kb.tambah("x1", ["kata x"], "Jawaban x")
        kb2 = KnowledgeBase(DEFAULT, self.user)
        self.assertEqual(kb2.cari("kata x")[0]["id"], "x1")

    def test_id_duplikat_ditolak(self):
        with self.assertRaises(KBError):
            self.kb.tambah("sapaan", ["a"], "b")

    def test_validasi(self):
        for kw in (dict(id="Bad Id", kata_kunci=["a"], jawaban="b"),
                   dict(id="ok", kata_kunci=[], jawaban="b"),
                   dict(id="ok", kata_kunci=["a"], jawaban=""),
                   dict(id="ok", kata_kunci=["a"], jawaban="x" * 801),
                   dict(id="ok", kata_kunci=[5], jawaban="b"),
                   dict(id="ok", kata_kunci=["a"], jawaban="b\x00c")):
            with self.assertRaises(KBError, msg=str(kw)):
                self.kb.tambah(**kw)

    def test_ubah_entri_bawaan_tidak_menyentuh_file_bawaan(self):
        sebelum = _baca(DEFAULT)
        self.kb.ubah("identitas", jawaban="Aku Lily versi sekolah.")
        self.assertEqual(self.kb.cari("siapa kamu")[0]["jawaban"], "Aku Lily versi sekolah.")
        self.assertEqual(_baca(DEFAULT), sebelum)

    def test_hapus_entri_guru(self):
        self.kb.tambah("tmp", ["kata tmp"], "t")
        self.kb.hapus("tmp")
        self.assertIsNone(self.kb.cari("kata tmp")[0])

    def test_hapus_entri_bawaan_menonaktifkan(self):
        self.kb.hapus("pamit")
        self.assertIsNone(self.kb.cari("dadah")[0])
        self.assertEqual(KnowledgeBase(DEFAULT, self.user).cari("dadah")[0], None)

    def test_hapus_id_tak_ada(self):
        with self.assertRaises(KBError):
            self.kb.hapus("tidak_ada")

    def test_file_guru_rusak_tidak_mematikan_bawaan(self):
        with open(self.user, "w", encoding="utf-8") as f:
            f.write("{bukan json")
        kb = KnowledgeBase(DEFAULT, self.user)
        self.assertEqual(kb.cari("halo")[0]["id"], "sapaan")

    def test_perubahan_file_oleh_proses_lain_terbaca(self):
        with open(self.user, "w", encoding="utf-8") as f:
            json.dump([{"id": "baru", "kata_kunci": ["kata baru"], "jawaban": "j"}], f)
        self.assertEqual(self.kb.cari("kata baru")[0]["id"], "baru")

    def test_file_bawaan_valid(self):
        data = json.loads(_baca(DEFAULT))
        self.assertGreaterEqual(len(data), 5)
        ids = [e["id"] for e in data]
        self.assertEqual(len(ids), len(set(ids)))


class TestRouter(Dasar):
    def test_default_nonaktif(self):
        os.environ.pop("LILY_OFFLINE_FALLBACK", None)
        self.assertFalse(router.enabled())

    def test_nilai_env(self):
        for v, ex in (("on", True), ("ON", True), ("1", True), ("true", True), ("off", False), ("", False), ("nope", False)):
            os.environ["LILY_OFFLINE_FALLBACK"] = v
            self.assertEqual(router.enabled(), ex, v)

    def test_jawab_membawa_mood_dan_behavior(self):
        os.environ["LILY_OFFLINE_KB_PATH"] = self.user
        router.reset_kb()
        h = router.jawab("terima kasih lily")
        self.assertEqual((h["intent"], h["mood"], h["behavior"]), ("terima_kasih", "grateful", "thank"))

    def test_jawab_tanpa_kecocokan_none(self):
        os.environ["LILY_OFFLINE_KB_PATH"] = self.user
        router.reset_kb()
        self.assertIsNone(router.jawab("berapa 17 kali 23"))

    def test_mood_behavior_kustom_divalidasi_bentuknya(self):
        self.kb.tambah("x2", ["kata x2"], "j", mood="happy", behavior="greet")
        self.assertEqual(self.kb.cari("kata x2")[0]["mood"], "happy")
        for bad in ("Happy", "h", "ha ppy", 5):
            with self.assertRaises(KBError, msg=str(bad)):
                self.kb.tambah("x3", ["kata x3"], "j", mood=bad)

    def test_semua_jawaban_bawaan_muat_batas_lily(self):
        for e in self.kb.semua():
            self.assertLessEqual(len(e["jawaban"]), 220, e["id"])
            self.assertIn("mood", e); self.assertIn("behavior", e)

    def test_jawab_input_aneh(self):
        os.environ["LILY_OFFLINE_KB_PATH"] = self.user
        router.reset_kb()
        for t in (None, 123, "", "   "):
            self.assertIsNone(router.jawab(t))


if __name__ == "__main__":
    unittest.main()
