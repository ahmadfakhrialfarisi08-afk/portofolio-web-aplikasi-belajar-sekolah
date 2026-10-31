"""Test AI Logic Lily DOCX: prompt -> intent -> pilihan struktur -> Document Schema. Tanpa jaringan (LLM dipalsukan).
Jalankan: python -m unittest test.test_lily_docx_ai -v"""
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.lily_docx import SchemaError
from services.lily_docx import ai
from services.lily_docx.ai import AIError, analisis, buat_dokumen, susun_schema

ISI = "Peserta didik mampu menjelaskan konsep dan menerapkannya dalam praktik secara runtut dan benar."


class LLMPalsu:
    """Memutar jawaban berurutan, merekam pesan yang dikirim."""

    def __init__(self, *jawaban):
        self.jawaban, self.pesan, self.i = list(jawaban), [], 0

    def __call__(self, pesan, maks_token, temperature):
        self.pesan.append(pesan)
        j = self.jawaban[min(self.i, len(self.jawaban) - 1)]
        self.i += 1
        return j if isinstance(j, tuple) else (j, None, {"total_tokens": 10})

    @property
    def teks(self):
        return "\n".join(str(m["content"]) for p in self.pesan for m in p)


def opsi(judul, *bagian):
    return {"judul": judul, "deskripsi": "Pendekatan " + judul, "bagian": list(bagian)}


def analisis_ok(**ubah):
    d = {"dokumen_guru": True, "jenis": "modul_ajar", "topik": "Basis data relasional", "ringkasan": "Modul ajar basis data",
         "data_kurang": [],
         "pilihan": [opsi("Lengkap", "Tujuan Pembelajaran", "Kegiatan Pembelajaran", "Asesmen", "Refleksi"),
                     opsi("Ringkas Proyek", "Tujuan", "Proyek", "Rubrik Penilaian")]}
    d.update(ubah)
    return d


def dokumen_ai(*judul_bagian, **ubah):
    d = {"jenis": "modul_ajar", "judul": "Modul Ajar Basis Data", "meta": [["Kelas", "XI TKJ"]],
         "bagian": [{"judul": j, "blok": [{"tipe": "paragraf", "teks": ISI + " " + ISI}]} for j in judul_bagian],
         "isian_kosong": ["Nomor SK"], "tanda_tangan": True}
    d.update(ubah)
    return d


PILIHAN_A = {"id": "A", **opsi("Lengkap", "Tujuan Pembelajaran", "Kegiatan Pembelajaran", "Asesmen")}


class TestAnalisis(unittest.TestCase):
    def test_prompt_jelas_langsung_pilihan_dua_plus_custom(self):
        llm = LLMPalsu(analisis_ok())
        r = analisis("Buatkan modul ajar basis data kelas XI TKJ", llm=llm)
        self.assertEqual(r["tahap"], "pilih")
        self.assertEqual([o["id"] for o in r["pilihan"]], ["A", "B", "custom"])
        self.assertEqual(r["pilihan"][0]["bagian"][0], "Tujuan Pembelajaran")
        self.assertEqual(r["pilihan"][2]["bagian"], [])
        self.assertEqual(llm.i, 1)  # satu panggilan AI saja

    def test_struktur_dinamis_mengikuti_keluaran_ai(self):
        a = analisis("modul ajar", llm=LLMPalsu(analisis_ok()))
        b = analisis("surat tugas", llm=LLMPalsu(analisis_ok(
            jenis="surat_tugas", pilihan=[opsi("Formal", "Dasar", "Penugasan", "Penutup"), opsi("Singkat", "Perihal", "Isi", "Waktu")])))
        self.assertNotEqual(a["pilihan"][0]["bagian"], b["pilihan"][0]["bagian"])
        self.assertEqual(b["intent"]["jenis"], "surat_tugas")

    def test_data_wajib_kurang_bertanya_dan_identitas_dibuang(self):
        kurang = [{"kunci": "mata_pelajaran", "pertanyaan": "Mata pelajarannya apa?"},
                  {"kunci": "nip", "pertanyaan": "Berapa NIP Anda?"},
                  {"kunci": "nama_sekolah", "pertanyaan": "Nama sekolah?"},
                  {"kunci": "kelas", "pertanyaan": "Untuk kelas berapa?"}]
        r = analisis("buatkan modul ajar", llm=LLMPalsu(analisis_ok(data_kurang=kurang, pilihan=[])))
        self.assertEqual(r["tahap"], "tanya")
        self.assertEqual([q["kunci"] for q in r["pertanyaan"]], ["mata_pelajaran", "kelas"])

    def test_sudah_dijawab_tidak_bertanya_lagi(self):
        llm = LLMPalsu(analisis_ok(data_kurang=[{"kunci": "kelas", "pertanyaan": "Kelas?"}]))
        r = analisis("buatkan modul ajar", jawaban="Basis data, kelas XI", llm=llm)
        self.assertEqual(r["tahap"], "pilih")
        self.assertIn("JANGAN bertanya lagi", llm.teks)
        self.assertIn("Basis data, kelas XI", llm.teks)

    def test_opsi_tidak_valid_diulang_sekali_lalu_berhasil(self):
        jelek = analisis_ok(pilihan=[opsi("Cuma", "satu", "dua")])
        llm = LLMPalsu(jelek, analisis_ok())
        r = analisis("modul ajar", llm=llm)
        self.assertEqual(r["tahap"], "pilih")
        self.assertEqual(llm.i, 2)
        self.assertIn("Perbaikan", llm.pesan[1][1]["content"])

    def test_dua_opsi_kembar_dianggap_satu(self):
        kembar = analisis_ok(pilihan=[opsi("X", "A1", "B1", "C1"), opsi("Y", "1. A1", "B1", "**C1**")])
        with self.assertRaises(AIError) as c:
            analisis("modul ajar", llm=LLMPalsu(kembar))
        self.assertEqual(c.exception.kode, "struktur_gagal")

    def test_bukan_dokumen(self):
        llm = LLMPalsu(analisis_ok(dokumen_guru=False))
        self.assertEqual(analisis("halo apa kabar", llm=llm)["tahap"], "tanya")
        with self.assertRaises(AIError) as c:
            analisis("halo apa kabar", jawaban="ngobrol aja", llm=llm)
        self.assertEqual(c.exception.kode, "bukan_dokumen")

    def test_kegagalan_api_dipetakan(self):
        with self.assertRaises(AIError) as c:
            analisis("modul ajar", llm=LLMPalsu((None, "quota", None)))
        self.assertEqual((c.exception.kode, c.exception.sebab), ("api_habis", "quota"))
        with self.assertRaises(AIError) as c:
            analisis("modul ajar", llm=LLMPalsu((None, "lain", None)))
        self.assertEqual(c.exception.kode, "ai_gagal")
        with self.assertRaises(AIError) as c:
            analisis("  ", llm=LLMPalsu(analisis_ok()))
        self.assertEqual(c.exception.kode, "prompt_kosong")


class TestSusunSchema(unittest.TestCase):
    BAGIAN = ["Tujuan Pembelajaran", "Kegiatan Pembelajaran", "Asesmen"]

    def test_hasil_lolos_validasi_dan_filler_dibuang(self):
        d = dokumen_ai(*self.BAGIAN)
        d["bagian"][0]["blok"][0]["teks"] = "Tentu, berikut modulnya: " + ISI + " " + ISI
        r = susun_schema("modul ajar basis data", {"jenis": "modul_ajar"}, PILIHAN_A, llm=LLMPalsu(d))
        self.assertEqual([b["judul"] for b in r["schema"]["bagian"]], self.BAGIAN)
        self.assertFalse(r["schema"]["bagian"][0]["blok"][0]["teks"].startswith("Tentu"))
        self.assertEqual(r["peringatan"], [])

    def test_identitas_tidak_dikirim_ke_ai_dan_ada_larangan_mengarang(self):
        llm = LLMPalsu(dokumen_ai(*self.BAGIAN))
        susun_schema("modul ajar", {}, PILIHAN_A, identitas={"sekolah": "SMK Rahasia", "guru_nama": "Budi Santoso", "nip": "198"}, llm=llm)
        self.assertNotIn("Budi Santoso", llm.teks)
        self.assertNotIn("SMK Rahasia", llm.teks)
        self.assertIn("Jangan mengarang identitas", llm.teks)

    def test_bagian_hilang_diperbaiki_sekali(self):
        llm = LLMPalsu(dokumen_ai("Tujuan Pembelajaran", "Asesmen"), dokumen_ai(*self.BAGIAN))
        r = susun_schema("modul ajar", {}, PILIHAN_A, llm=llm)
        self.assertEqual(llm.i, 2)
        self.assertIn("Kegiatan Pembelajaran", llm.pesan[1][1]["content"])
        self.assertEqual(r["peringatan"], [])

    def test_bagian_tetap_hilang_menjadi_peringatan_jujur(self):
        llm = LLMPalsu(dokumen_ai("Tujuan Pembelajaran", "Asesmen"))
        r = susun_schema("modul ajar", {}, PILIHAN_A, llm=llm)
        self.assertEqual(r["peringatan"], ['Bagian "Kegiatan Pembelajaran" tidak berhasil dibuat.'])

    def test_dokumen_ditolak_validator_diulang_lalu_gagal_jelas(self):
        kosong = {"judul": "X", "bagian": []}
        r = susun_schema("modul ajar", {}, PILIHAN_A, llm=LLMPalsu(kosong, dokumen_ai(*self.BAGIAN)))
        self.assertEqual(len(r["schema"]["bagian"]), 3)
        with self.assertRaises(AIError) as c:
            susun_schema("modul ajar", {}, PILIHAN_A, llm=LLMPalsu(kosong))
        self.assertEqual(c.exception.kode, "schema_gagal")

    def test_custom(self):
        with self.assertRaises(AIError) as c:
            susun_schema("modul ajar", {}, {"id": "custom"}, struktur_custom="  ", llm=LLMPalsu(dokumen_ai("Bebas")))
        self.assertEqual(c.exception.kode, "custom_kosong")
        llm = LLMPalsu(dokumen_ai("Latar Belakang", "Langkah Praktik"))
        r = susun_schema("modul ajar", {}, {"id": "custom"}, struktur_custom="1. Latar Belakang\n2. Langkah Praktik", llm=llm)
        self.assertIn("Struktur CUSTOM", llm.teks)
        self.assertIn("Langkah Praktik", llm.teks)
        self.assertEqual(len(r["schema"]["bagian"]), 2)

    def test_pilihan_dari_browser_disanitasi(self):
        with self.assertRaises(AIError) as c:
            susun_schema("modul ajar", {}, {"id": "A", "judul": "X", "bagian": ["satu"]}, llm=LLMPalsu(dokumen_ai("satu")))
        self.assertEqual(c.exception.kode, "pilihan_tidak_valid")
        with self.assertRaises(AIError):
            susun_schema("modul ajar", {}, "A", llm=LLMPalsu(dokumen_ai("satu")))

    def test_buat_dokumen_memanggil_buat_docx(self):
        r = buat_dokumen("modul ajar", {}, PILIHAN_A, identitas={"guru_nama": "Budi"}, llm=LLMPalsu(dokumen_ai(*self.BAGIAN)))
        self.assertTrue(r["docx"].startswith(b"PK"))


class TestKlienOpenAI(unittest.TestCase):
    """panggil_openai tanpa jaringan: urlopen dipalsukan, key tidak pernah dibutuhkan."""

    def _urlopen_ok(self, isi):
        resp = io.BytesIO(json.dumps(isi).encode("utf-8"))
        return mock.patch("urllib.request.urlopen", return_value=mock.MagicMock(__enter__=lambda s: resp, __exit__=lambda *a: False))

    def _http_error(self, kode, badan):
        e = urllib.error.HTTPError("https://api.openai.com", kode, "x", {}, io.BytesIO(json.dumps(badan).encode("utf-8")))
        self.addCleanup(e.close)
        return mock.patch("urllib.request.urlopen", side_effect=e)

    def test_balasan_sukses_diurai_beserta_usage(self):
        balasan = {"choices": [{"message": {"content": json.dumps({"judul": "X"})}}], "usage": {"total_tokens": 7}}
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "kunci-palsu"}), self._urlopen_ok(balasan):
            self.assertEqual(ai.panggil_openai([{"role": "user", "content": "x"}]), ({"judul": "X"}, None, {"total_tokens": 7}))
        rusak = {"choices": [{"message": {"content": "bukan json"}}], "usage": {"total_tokens": 3}}
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "kunci-palsu"}), self._urlopen_ok(rusak):
            self.assertEqual(ai.panggil_openai([]), (None, None, {"total_tokens": 3}))

    def test_error_http_dipetakan_ke_jenis(self):
        mulai = {"OPENAI_API_KEY": "kunci-palsu"}
        kasus = [(429, {"error": {"code": "insufficient_quota", "type": "insufficient_quota"}}, "quota"),
                 (401, {"error": {"code": "invalid_api_key"}}, "kunci"),
                 (403, {}, "kunci"),
                 (429, {"error": {"code": "rate_limit_exceeded"}}, "lain"),
                 (500, {"error": {"message": "boom"}}, "lain")]
        for kode, badan, harapan in kasus:
            with mock.patch.dict(os.environ, mulai), self._http_error(kode, badan):
                self.assertEqual(ai.panggil_openai([]), (None, harapan, None), (kode, badan))
        with mock.patch.dict(os.environ, mulai), mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("putus")):
            self.assertEqual(ai.panggil_openai([]), (None, "lain", None))
        # tanpa key: tidak ada koneksi sama sekali
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}), mock.patch("urllib.request.urlopen") as u:
            self.assertEqual(ai.panggil_openai([{"role": "user", "content": "x"}]), (None, "lain", None))
        u.assert_not_called()


class TestSanitasiInput(unittest.TestCase):
    def test_prompt_dipotong_dan_karakter_kontrol_dibuang_sebelum_dikirim(self):
        llm = LLMPalsu(analisis_ok())
        analisis("modul\x00 ajar\x07 " + "x" * 5000, llm=llm)
        kirim = llm.pesan[0][1]["content"]
        self.assertNotIn("\x00", kirim)
        self.assertNotIn("\x07", kirim)
        self.assertLessEqual(len(kirim), len("Permintaan guru: ") + ai.MAKS_PROMPT)

    def test_pertanyaan_dedup_slug_dan_maksimal_tiga(self):
        kurang = [{"kunci": "Mata Pelajaran!", "pertanyaan": "Mapelnya apa?"},
                  {"kunci": "mapel_lagi", "pertanyaan": "mapelnya APA?"},
                  {"kunci": "kelas", "pertanyaan": "Kelas berapa?"},
                  {"kunci": "durasi", "pertanyaan": "Berapa jam pelajaran?"},
                  {"kunci": "semester", "pertanyaan": "Semester berapa?"},
                  "bukan dict", {"kunci": "tanpa_tanya", "pertanyaan": "  "}]
        r = analisis("modul ajar", llm=LLMPalsu(analisis_ok(data_kurang=kurang, pilihan=[])))
        self.assertEqual([q["kunci"] for q in r["pertanyaan"]], ["mata_pelajaran", "kelas", "durasi"])

    def test_intent_dari_browser_tidak_dipercaya(self):
        llm = LLMPalsu(dokumen_ai("Tujuan Pembelajaran", "Kegiatan Pembelajaran", "Asesmen"))
        susun_schema("modul ajar", ["bukan", "dict"], PILIHAN_A, llm=llm)
        self.assertNotIn("Jenis dokumen:", llm.teks)
        llm = LLMPalsu(dokumen_ai("Tujuan Pembelajaran", "Kegiatan Pembelajaran", "Asesmen"))
        susun_schema("modul ajar", {"jenis": "Modul Ajar!!", "topik": "T" * 999}, PILIHAN_A, llm=llm)
        self.assertIn("Jenis dokumen: modul_ajar", llm.teks)
        self.assertIn("Topik: " + "T" * 150 + "\n", llm.teks)

    def test_struktur_opsi_dibersihkan_dan_dibatasi(self):
        panjang = opsi("Terlalu panjang", *["Bagian %d" % i for i in range(ai.MAKS_BAGIAN + 1)])
        bersih = opsi("Rapi", "1. Pendahuluan", "- **Isi**", "isi", "Penutup")
        r = analisis("modul ajar", llm=LLMPalsu(analisis_ok(pilihan=[panjang, bersih, opsi("Lain", "P1", "P2", "P3")])))
        self.assertEqual(r["pilihan"][0]["judul"], "Rapi")
        self.assertEqual(r["pilihan"][0]["bagian"], ["Pendahuluan", "Isi", "Penutup"])
        self.assertEqual([o["id"] for o in r["pilihan"]], ["A", "B", "custom"])

    def test_struktur_custom_dipotong_dan_tidak_kena_pemeriksaan_bagian_hilang(self):
        llm = LLMPalsu(dokumen_ai("Bagian Lain Saja"))
        r = susun_schema("modul ajar", {}, {"id": "custom"}, struktur_custom="Latar Belakang " + "x" * 2000, llm=llm)
        self.assertEqual(llm.i, 1)
        self.assertEqual(r["peringatan"], [])
        kirim = llm.pesan[0][1]["content"]
        self.assertLessEqual(len(kirim.split("sesuai): ")[1]), ai.MAKS_CUSTOM)

    def test_usage_dari_semua_panggilan_ikut_di_error(self):
        kosong = {"judul": "X", "bagian": []}
        with self.assertRaises(AIError) as c:
            susun_schema("modul ajar", {}, PILIHAN_A, llm=LLMPalsu(kosong))
        self.assertEqual(c.exception.kode, "schema_gagal")
        self.assertEqual(len(c.exception.usage), 2)  # percobaan pertama + ulang, keduanya dicatat route



if __name__ == "__main__":
    unittest.main()
