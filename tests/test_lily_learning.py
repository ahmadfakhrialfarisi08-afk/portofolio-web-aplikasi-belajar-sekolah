"""
Test suite Lily Learning — Tahap 1.
Menguji schema.py dan catalog.py tanpa API, tanpa AI, tanpa frontend.

Jalankan dari root project:
    python -m pytest tests/test_lily_learning.py -v
    # atau
    python -m unittest tests.test_lily_learning -v
"""
import json
import sys
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from services.lily_learning.schema import (
    ActivityError,
    ActivityType,
    validasi_aktivitas,
    validasi_multiple_choice,
    validasi_step_solver,
    MAKS_PANJANG_PERTANYAAN,
    MAKS_PILIHAN_MC,
    MAKS_LANGKAH,
    MIN_PANJANG_PERTANYAAN,
    MIN_PILIHAN_MC,
    MIN_LANGKAH,
)
from services.lily_learning.catalog import (
    CatalogError,
    bersihkan_catalog,
    tambah_aktivitas,
    ambil_aktivitas,
    hapus_aktivitas,
    daftar_aktivitas,
    ringkasan_catalog,
)


# ===========================================================================
# FIXTURE: Data contoh valid
# ===========================================================================

def mc_valid(**ubah) -> dict:
    """Template aktivitas multiple_choice yang valid."""
    d = {
        "tipe": "multiple_choice",
        "id": "mc_001",
        "pertanyaan": "Apa ibu kota Indonesia?",
        "pilihan": [
            {"kode": "A", "teks": "Jakarta"},
            {"kode": "B", "teks": "Bandung"},
            {"kode": "C", "teks": "Surabaya"},
            {"kode": "D", "teks": "Medan"},
        ],
        "jawaban_benar": "A",
        "clue": "Perhatikan kota mana yang menjadi pusat pemerintahan.",
        "explanation": "Jakarta adalah ibu kota Republik Indonesia.",
        "feedback": {
            "benar": "Hebat! Jawaban kamu tepat.",
            "salah": "Coba lagi. Perhatikan pusat pemerintahan RI.",
        },
        "meta": {"mapel": "IPS", "kelas": "IV"},
    }
    d.update(ubah)
    return d


def ss_valid(**ubah) -> dict:
    """Template aktivitas step_solver yang valid."""
    d = {
        "tipe": "step_solver",
        "id": "ss_001",
        "pertanyaan": "Hitunglah keliling segitiga dengan sisi a=3 cm, b=4 cm, c=5 cm!",
        "langkah": [
            {
                "nomor": 1,
                "instruksi": "Tuliskan rumus keliling segitiga.",
                "jawaban": "K = a + b + c",
                "tipe_input": "teks",
                "pilihan": None,
                "clue": "Keliling = jumlah semua sisi.",
                "explanation": "Rumus keliling segitiga adalah K = a + b + c.",
            },
            {
                "nomor": 2,
                "instruksi": "Substitusikan nilai a=3, b=4, c=5 ke dalam rumus.",
                "jawaban": "K = 3 + 4 + 5",
                "tipe_input": "teks",
                "pilihan": None,
                "clue": "Gantikan huruf a, b, c dengan angka yang diketahui.",
                "explanation": "K = 3 + 4 + 5.",
            },
            {
                "nomor": 3,
                "instruksi": "Hitung hasil penjumlahan untuk mendapatkan keliling.",
                "jawaban": "12",
                "tipe_input": "angka",
                "pilihan": None,
                "clue": "3 + 4 + 5 = ?",
                "explanation": "3 + 4 + 5 = 12 cm.",
            },
        ],
        "clue_bertahap": [
            "Ingat bahwa keliling adalah total panjang semua sisi.",
            "Coba hitung satu per satu: 3+4 terlebih dahulu.",
        ],
        "explanation": "Keliling segitiga tersebut adalah 12 cm.",
        "completion_message": "Selamat! Kamu berhasil menyelesaikan soal keliling segitiga!",
        "meta": {"mapel": "Matematika", "kelas": "V"},
    }
    d.update(ubah)
    return d


# ===========================================================================
# TEST: Schema — multiple_choice
# ===========================================================================

class TestSchemaMultipleChoice(unittest.TestCase):
    """Menguji validasi schema untuk aktivitas multiple_choice."""

    def test_valid_dikembalikan_bersih(self):
        """Aktivitas valid harus dikembalikan tanpa error dengan field lengkap."""
        hasil = validasi_multiple_choice(mc_valid())
        self.assertEqual(hasil["tipe"], ActivityType.MULTIPLE_CHOICE)
        self.assertEqual(hasil["id"], "mc_001")
        self.assertEqual(hasil["pertanyaan"], "Apa ibu kota Indonesia?")
        self.assertEqual(len(hasil["pilihan"]), 4)
        self.assertEqual(hasil["jawaban_benar"], "A")
        self.assertIn("clue", hasil)
        self.assertIn("explanation", hasil)
        self.assertIn("feedback", hasil)
        self.assertIn("meta", hasil)

    def test_tipe_salah_ditolak(self):
        """Tipe yang bukan 'multiple_choice' harus ditolak."""
        with self.assertRaises(ActivityError) as ctx:
            validasi_multiple_choice(mc_valid(tipe="step_solver"))
        self.assertIn("multiple_choice", str(ctx.exception))

    def test_pertanyaan_wajib(self):
        """Pertanyaan kosong harus ditolak."""
        kasus = [None, "", "   ", "ab"]  # 'ab' terlalu pendek (< 5 karakter)
        for p in kasus:
            with self.subTest(pertanyaan=p):
                with self.assertRaises(ActivityError):
                    validasi_multiple_choice(mc_valid(pertanyaan=p))

    def test_pertanyaan_terlalu_panjang_dipotong(self):
        """Pertanyaan melebihi batas harus dipotong, bukan error."""
        panjang = "x" * (MAKS_PANJANG_PERTANYAAN + 100)
        hasil = validasi_multiple_choice(mc_valid(pertanyaan=panjang))
        self.assertLessEqual(len(hasil["pertanyaan"]), MAKS_PANJANG_PERTANYAAN)

    def test_pilihan_minimum(self):
        """Kurang dari 2 pilihan harus ditolak."""
        for n in (0, 1):
            pilihan = [{"kode": "A", "teks": "Pilihan A"}] * n
            with self.subTest(n=n):
                with self.assertRaises(ActivityError):
                    validasi_multiple_choice(mc_valid(pilihan=pilihan))

    def test_pilihan_maksimum_dipotong(self):
        """Lebih dari batas maks pilihan harus dipotong, bukan error."""
        banyak = [{"kode": str(i), "teks": f"Pilihan {i}"} for i in range(MAKS_PILIHAN_MC + 5)]
        # jawaban_benar harus ada di pilihan yang disimpan (max)
        hasil = validasi_multiple_choice(mc_valid(
            pilihan=banyak,
            jawaban_benar=str(MAKS_PILIHAN_MC - 1)
        ))
        self.assertLessEqual(len(hasil["pilihan"]), MAKS_PILIHAN_MC)

    def test_pilihan_kode_duplikat_ditolak(self):
        """Kode pilihan duplikat harus ditolak."""
        pilihan = [
            {"kode": "A", "teks": "Jawaban satu"},
            {"kode": "A", "teks": "Jawaban dua"},
        ]
        with self.assertRaises(ActivityError) as ctx:
            validasi_multiple_choice(mc_valid(pilihan=pilihan, jawaban_benar="A"))
        self.assertIn("duplikat", str(ctx.exception).lower())

    def test_pilihan_bukan_list_ditolak(self):
        """Field 'pilihan' bukan list harus ditolak."""
        for v in (None, "A,B,C", {"A": "Jakarta"}, 42):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_multiple_choice(mc_valid(pilihan=v))

    def test_pilihan_item_bukan_dict_ditolak(self):
        """Item pilihan yang bukan dict harus ditolak."""
        with self.assertRaises(ActivityError):
            validasi_multiple_choice(mc_valid(pilihan=["A", "B", "C"]))

    def test_jawaban_benar_wajib(self):
        """Field 'jawaban_benar' kosong harus ditolak."""
        for v in (None, "", "  "):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_multiple_choice(mc_valid(jawaban_benar=v))

    def test_jawaban_benar_tidak_ada_di_pilihan_ditolak(self):
        """Jawaban benar yang tidak ada di pilihan harus ditolak."""
        with self.assertRaises(ActivityError) as ctx:
            validasi_multiple_choice(mc_valid(jawaban_benar="Z"))
        self.assertIn("kode pilihan", str(ctx.exception).lower())

    def test_clue_explanation_opsional(self):
        """clue dan explanation tidak wajib; bisa None/kosong."""
        d = mc_valid()
        d.pop("clue", None)
        d.pop("explanation", None)
        hasil = validasi_multiple_choice(d)
        self.assertEqual(hasil["clue"], "")
        self.assertEqual(hasil["explanation"], "")

    def test_feedback_opsional(self):
        """feedback tidak wajib."""
        d = mc_valid()
        d.pop("feedback", None)
        hasil = validasi_multiple_choice(d)
        self.assertEqual(hasil["feedback"], {})

    def test_feedback_tidak_valid_diabaikan_tidak_error(self):
        """feedback yang bukan dict tidak menyebabkan error."""
        hasil = validasi_multiple_choice(mc_valid(feedback="Bagus!"))
        self.assertEqual(hasil["feedback"], {})

    def test_meta_opsional(self):
        """meta tidak wajib."""
        d = mc_valid()
        d.pop("meta", None)
        hasil = validasi_multiple_choice(d)
        self.assertEqual(hasil["meta"], {})

    def test_meta_bukan_dict_diabaikan(self):
        """meta yang bukan dict menghasilkan dict kosong."""
        hasil = validasi_multiple_choice(mc_valid(meta=["IPS", "IV"]))
        self.assertEqual(hasil["meta"], {})

    def test_id_slug_dibersihkan(self):
        """ID dengan karakter tidak valid dibersihkan."""
        hasil = validasi_multiple_choice(mc_valid(id="MC Soal #1 (2024)!"))
        # Hanya huruf kecil, angka, underscore, strip
        import re
        self.assertRegex(hasil["id"], r'^[a-z0-9_\-]+$')

    def test_id_tidak_ada_pakai_bawaan(self):
        """Jika tidak ada ID, dipakai nilai bawaan 'mc'."""
        d = mc_valid()
        d.pop("id", None)
        hasil = validasi_multiple_choice(d)
        self.assertEqual(hasil["id"], "mc")

    def test_karakter_kontrol_dibuang(self):
        """Karakter kontrol di pertanyaan harus dibuang."""
        hasil = validasi_multiple_choice(
            mc_valid(pertanyaan="Apa\x00 ibu\x01 kota\x1F Indonesia?")
        )
        self.assertNotIn("\x00", hasil["pertanyaan"])
        self.assertNotIn("\x01", hasil["pertanyaan"])

    def test_tipe_dikembalikan_sebagai_enum(self):
        """Tipe harus dikembalikan sebagai ActivityType enum."""
        hasil = validasi_multiple_choice(mc_valid())
        self.assertEqual(hasil["tipe"], ActivityType.MULTIPLE_CHOICE)
        self.assertIsInstance(hasil["tipe"], ActivityType)

    def test_json_serializable(self):
        """Hasil validasi harus bisa di-JSON-kan."""
        hasil = validasi_multiple_choice(mc_valid())
        # ActivityType adalah str, jadi json.dumps bisa
        json_str = json.dumps(hasil)
        self.assertIsInstance(json_str, str)

    def test_aktivitas_bukan_dict_ditolak(self):
        """Input yang bukan dict harus ditolak."""
        for v in (None, [], "string", 42, True):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_multiple_choice(v)


# ===========================================================================
# TEST: Schema — step_solver
# ===========================================================================

class TestSchemaStepSolver(unittest.TestCase):
    """Menguji validasi schema untuk aktivitas step_solver."""

    def test_valid_dikembalikan_bersih(self):
        """Aktivitas valid harus dikembalikan tanpa error dengan field lengkap."""
        hasil = validasi_step_solver(ss_valid())
        self.assertEqual(hasil["tipe"], ActivityType.STEP_SOLVER)
        self.assertEqual(hasil["id"], "ss_001")
        self.assertIn("pertanyaan", hasil)
        self.assertEqual(len(hasil["langkah"]), 3)
        self.assertIn("clue_bertahap", hasil)
        self.assertIn("explanation", hasil)
        self.assertIn("completion_message", hasil)
        self.assertIn("meta", hasil)

    def test_tipe_salah_ditolak(self):
        """Tipe yang bukan 'step_solver' harus ditolak."""
        with self.assertRaises(ActivityError) as ctx:
            validasi_step_solver(ss_valid(tipe="multiple_choice"))
        self.assertIn("step_solver", str(ctx.exception))

    def test_pertanyaan_wajib(self):
        """Pertanyaan kosong atau terlalu pendek harus ditolak."""
        for p in (None, "", "   ", "ab"):
            with self.subTest(pertanyaan=p):
                with self.assertRaises(ActivityError):
                    validasi_step_solver(ss_valid(pertanyaan=p))

    def test_langkah_wajib_minimal_satu(self):
        """Field 'langkah' harus ada dan memiliki minimal 1 item."""
        for v in (None, [], "bukan list"):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_step_solver(ss_valid(langkah=v))

    def test_langkah_maksimum_dipotong(self):
        """Lebih dari batas maks langkah harus dipotong."""
        banyak = [
            {
                "nomor": i + 1,
                "instruksi": f"Langkah ke-{i+1}",
                "jawaban": f"Jawaban {i+1}",
                "tipe_input": "teks",
            }
            for i in range(MAKS_LANGKAH + 5)
        ]
        hasil = validasi_step_solver(ss_valid(langkah=banyak))
        self.assertLessEqual(len(hasil["langkah"]), MAKS_LANGKAH)

    def test_langkah_instruksi_wajib(self):
        """Instruksi langkah yang kosong harus ditolak."""
        langkah = [
            {"nomor": 1, "instruksi": "", "jawaban": "K = a + b + c", "tipe_input": "teks"}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_jawaban_wajib(self):
        """Jawaban referensi langkah yang kosong harus ditolak."""
        langkah = [
            {"nomor": 1, "instruksi": "Tuliskan rumus.", "jawaban": "", "tipe_input": "teks"}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_nomor_harus_integer(self):
        """Nomor langkah yang bukan integer harus ditolak."""
        langkah = [
            {"nomor": "satu", "instruksi": "Tuliskan rumus.", "jawaban": "K = a+b+c", "tipe_input": "teks"}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_nomor_kurang_dari_satu_ditolak(self):
        """Nomor langkah < 1 harus ditolak."""
        langkah = [
            {"nomor": 0, "instruksi": "Tuliskan rumus.", "jawaban": "K = a+b+c", "tipe_input": "teks"}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_nomor_duplikat_ditolak(self):
        """Nomor langkah duplikat harus ditolak."""
        langkah = [
            {"nomor": 1, "instruksi": "Langkah A.", "jawaban": "A", "tipe_input": "teks"},
            {"nomor": 1, "instruksi": "Langkah B.", "jawaban": "B", "tipe_input": "teks"},
        ]
        with self.assertRaises(ActivityError) as ctx:
            validasi_step_solver(ss_valid(langkah=langkah))
        self.assertIn("duplikat", str(ctx.exception).lower())

    def test_langkah_tipe_input_tidak_valid_ditolak(self):
        """tipe_input yang tidak dikenal harus ditolak."""
        langkah = [
            {"nomor": 1, "instruksi": "Tuliskan.", "jawaban": "A", "tipe_input": "radio_button"}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_tipe_input_angka(self):
        """tipe_input='angka' valid."""
        langkah = [
            {"nomor": 1, "instruksi": "Hitung hasilnya.", "jawaban": "12", "tipe_input": "angka"}
        ]
        hasil = validasi_step_solver(ss_valid(langkah=langkah))
        self.assertEqual(hasil["langkah"][0]["tipe_input"], "angka")

    def test_langkah_tipe_pilihan_butuh_pilihan_list(self):
        """tipe_input='pilihan' tanpa field 'pilihan' yang valid harus ditolak."""
        langkah = [
            {"nomor": 1, "instruksi": "Pilih rumus.", "jawaban": "K=a+b+c",
             "tipe_input": "pilihan", "pilihan": None}
        ]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_langkah_tipe_pilihan_dengan_pilihan_valid(self):
        """tipe_input='pilihan' dengan pilihan yang valid harus diterima."""
        langkah = [
            {"nomor": 1, "instruksi": "Pilih rumus.", "jawaban": "K=a+b+c",
             "tipe_input": "pilihan", "pilihan": ["K=a+b+c", "K=a×b×c", "K=a+b"]}
        ]
        hasil = validasi_step_solver(ss_valid(langkah=langkah))
        self.assertEqual(hasil["langkah"][0]["tipe_input"], "pilihan")
        self.assertEqual(len(hasil["langkah"][0]["pilihan"]), 3)

    def test_langkah_bukan_dict_ditolak(self):
        """Item langkah yang bukan dict harus ditolak."""
        langkah = ["langkah satu", "langkah dua"]
        with self.assertRaises(ActivityError):
            validasi_step_solver(ss_valid(langkah=langkah))

    def test_clue_bertahap_opsional(self):
        """clue_bertahap tidak wajib."""
        d = ss_valid()
        d.pop("clue_bertahap", None)
        hasil = validasi_step_solver(d)
        self.assertEqual(hasil["clue_bertahap"], [])

    def test_clue_bertahap_bukan_list_diabaikan(self):
        """clue_bertahap yang bukan list menghasilkan list kosong."""
        hasil = validasi_step_solver(ss_valid(clue_bertahap="Clue tunggal"))
        self.assertEqual(hasil["clue_bertahap"], [])

    def test_clue_bertahap_maksimum_dipotong(self):
        """clue_bertahap melebihi batas dipotong."""
        from services.lily_learning.schema import MAKS_CLUE_BERTAHAP
        banyak = [f"Clue ke-{i}" for i in range(MAKS_CLUE_BERTAHAP + 5)]
        hasil = validasi_step_solver(ss_valid(clue_bertahap=banyak))
        self.assertLessEqual(len(hasil["clue_bertahap"]), MAKS_CLUE_BERTAHAP)

    def test_completion_message_opsional(self):
        """completion_message tidak wajib."""
        d = ss_valid()
        d.pop("completion_message", None)
        hasil = validasi_step_solver(d)
        self.assertEqual(hasil["completion_message"], "")

    def test_langkah_clue_explanation_opsional(self):
        """clue dan explanation per langkah tidak wajib."""
        langkah = [
            {"nomor": 1, "instruksi": "Tuliskan rumus.", "jawaban": "K = a+b+c", "tipe_input": "teks"}
        ]
        hasil = validasi_step_solver(ss_valid(langkah=langkah))
        self.assertEqual(hasil["langkah"][0]["clue"], "")
        self.assertEqual(hasil["langkah"][0]["explanation"], "")

    def test_tipe_dikembalikan_sebagai_enum(self):
        """Tipe harus dikembalikan sebagai ActivityType enum."""
        hasil = validasi_step_solver(ss_valid())
        self.assertEqual(hasil["tipe"], ActivityType.STEP_SOLVER)
        self.assertIsInstance(hasil["tipe"], ActivityType)

    def test_json_serializable(self):
        """Hasil validasi harus bisa di-JSON-kan."""
        hasil = validasi_step_solver(ss_valid())
        json_str = json.dumps(hasil)
        self.assertIsInstance(json_str, str)

    def test_aktivitas_bukan_dict_ditolak(self):
        """Input yang bukan dict harus ditolak."""
        for v in (None, [], "string", 42):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_step_solver(v)


# ===========================================================================
# TEST: Schema — dispatcher validasi_aktivitas
# ===========================================================================

class TestSchemaDispatcher(unittest.TestCase):
    """Menguji dispatcher validasi_aktivitas."""

    def test_dispatch_multiple_choice(self):
        """Dispatcher menggunakan validator multiple_choice yang benar."""
        hasil = validasi_aktivitas(mc_valid())
        self.assertEqual(hasil["tipe"], ActivityType.MULTIPLE_CHOICE)

    def test_dispatch_step_solver(self):
        """Dispatcher menggunakan validator step_solver yang benar."""
        hasil = validasi_aktivitas(ss_valid())
        self.assertEqual(hasil["tipe"], ActivityType.STEP_SOLVER)

    def test_tipe_tidak_dikenal_ditolak(self):
        """Tipe yang tidak dikenal harus ditolak dengan pesan yang jelas."""
        for tipe in ("drag_drop", "fill_blank", None, 123, []):
            with self.subTest(tipe=tipe):
                with self.assertRaises(ActivityError) as ctx:
                    validasi_aktivitas({"tipe": tipe})
                # Pesan harus informatif
                pesan = str(ctx.exception).lower()
                self.assertTrue(
                    "tipe" in pesan or "dikenal" in pesan or "didukung" in pesan,
                    f"Pesan kurang informatif: {ctx.exception}"
                )

    def test_bukan_dict_ditolak(self):
        """Input bukan dict harus ditolak."""
        for v in (None, [], "string"):
            with self.subTest(v=v):
                with self.assertRaises(ActivityError):
                    validasi_aktivitas(v)


# ===========================================================================
# TEST: Catalog
# ===========================================================================

class TestCatalog(unittest.TestCase):
    """Menguji operasi CRUD catalog aktivitas."""

    def setUp(self):
        """Bersihkan catalog sebelum setiap test."""
        bersihkan_catalog()

    def tearDown(self):
        """Bersihkan catalog setelah setiap test."""
        bersihkan_catalog()

    def test_tambah_dan_ambil_multiple_choice(self):
        """Tambah MC ke catalog lalu ambil kembali."""
        tambah_aktivitas(mc_valid())
        hasil = ambil_aktivitas("mc_001")
        self.assertIsNotNone(hasil)
        self.assertEqual(hasil["tipe"], ActivityType.MULTIPLE_CHOICE)
        self.assertEqual(hasil["id"], "mc_001")

    def test_tambah_dan_ambil_step_solver(self):
        """Tambah SS ke catalog lalu ambil kembali."""
        tambah_aktivitas(ss_valid())
        hasil = ambil_aktivitas("ss_001")
        self.assertIsNotNone(hasil)
        self.assertEqual(hasil["tipe"], ActivityType.STEP_SOLVER)

    def test_tambah_aktivitas_tidak_valid_ditolak(self):
        """Tambah aktivitas yang tidak valid harus raise ActivityError."""
        with self.assertRaises(ActivityError):
            tambah_aktivitas({"tipe": "multiple_choice", "pertanyaan": ""})

    def test_tambah_id_duplikat_ditolak(self):
        """Tambah aktivitas dengan ID yang sama (tanpa timpa) harus raise CatalogError."""
        tambah_aktivitas(mc_valid())
        with self.assertRaises(CatalogError) as ctx:
            tambah_aktivitas(mc_valid())
        self.assertIn("sudah ada", str(ctx.exception))

    def test_tambah_dengan_timpa(self):
        """Tambah aktivitas dengan timpa=True menggantikan yang lama."""
        tambah_aktivitas(mc_valid())
        mc_baru = mc_valid(explanation="Penjelasan baru setelah ditimpa.")
        tambah_aktivitas(mc_baru, timpa=True)
        hasil = ambil_aktivitas("mc_001")
        self.assertIn("baru", hasil["explanation"].lower())

    def test_ambil_tidak_ada_mengembalikan_none(self):
        """Ambil ID yang tidak ada harus mengembalikan None."""
        self.assertIsNone(ambil_aktivitas("tidak_ada"))

    def test_ambil_bukan_string_mengembalikan_none(self):
        """Ambil dengan ID bukan string harus mengembalikan None."""
        for v in (None, 123, [], {}):
            with self.subTest(v=v):
                self.assertIsNone(ambil_aktivitas(v))

    def test_hapus_aktivitas(self):
        """Hapus aktivitas yang ada harus berhasil."""
        tambah_aktivitas(mc_valid())
        berhasil = hapus_aktivitas("mc_001")
        self.assertTrue(berhasil)
        self.assertIsNone(ambil_aktivitas("mc_001"))

    def test_hapus_tidak_ada_mengembalikan_false(self):
        """Hapus ID yang tidak ada harus mengembalikan False."""
        self.assertFalse(hapus_aktivitas("tidak_ada"))

    def test_daftar_kosong(self):
        """Catalog kosong mengembalikan list kosong."""
        self.assertEqual(daftar_aktivitas(), [])

    def test_daftar_semua(self):
        """Daftar semua aktivitas tanpa filter."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        hasil = daftar_aktivitas()
        self.assertEqual(len(hasil), 2)

    def test_daftar_filter_tipe_mc(self):
        """Filter berdasarkan tipe multiple_choice."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        mc_list = daftar_aktivitas(tipe="multiple_choice")
        self.assertEqual(len(mc_list), 1)
        self.assertEqual(mc_list[0]["tipe"], ActivityType.MULTIPLE_CHOICE)

    def test_daftar_filter_tipe_ss(self):
        """Filter berdasarkan tipe step_solver."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        ss_list = daftar_aktivitas(tipe="step_solver")
        self.assertEqual(len(ss_list), 1)
        self.assertEqual(ss_list[0]["tipe"], ActivityType.STEP_SOLVER)

    def test_daftar_filter_tipe_tidak_dikenal(self):
        """Filter tipe yang tidak dikenal mengembalikan list kosong."""
        tambah_aktivitas(mc_valid())
        hasil = daftar_aktivitas(tipe="drag_drop")
        self.assertEqual(hasil, [])

    def test_daftar_filter_mapel(self):
        """Filter berdasarkan meta mapel."""
        tambah_aktivitas(mc_valid())  # mapel=IPS
        tambah_aktivitas(ss_valid())  # mapel=Matematika
        ips_list = daftar_aktivitas(mapel="IPS")
        self.assertEqual(len(ips_list), 1)
        self.assertEqual(ips_list[0]["meta"]["mapel"], "IPS")

    def test_daftar_filter_kelas(self):
        """Filter berdasarkan meta kelas."""
        tambah_aktivitas(mc_valid())  # kelas=IV
        tambah_aktivitas(ss_valid())  # kelas=V
        kelas_iv = daftar_aktivitas(kelas="IV")
        self.assertEqual(len(kelas_iv), 1)
        self.assertEqual(kelas_iv[0]["meta"]["kelas"], "IV")

    def test_daftar_filter_mapel_case_insensitive(self):
        """Filter mapel tidak peka huruf besar/kecil."""
        tambah_aktivitas(mc_valid())  # mapel=IPS
        self.assertEqual(len(daftar_aktivitas(mapel="ips")), 1)
        self.assertEqual(len(daftar_aktivitas(mapel="IPS")), 1)
        self.assertEqual(len(daftar_aktivitas(mapel="Ips")), 1)

    def test_daftar_filter_gabungan(self):
        """Filter tipe + mapel + kelas secara bersamaan."""
        tambah_aktivitas(mc_valid())          # MC, IPS, IV
        tambah_aktivitas(ss_valid())          # SS, Matematika, V
        mc_ips_iv = mc_valid(id="mc_002", meta={"mapel": "IPS", "kelas": "IV"})
        tambah_aktivitas(mc_ips_iv)
        hasil = daftar_aktivitas(tipe="multiple_choice", mapel="IPS", kelas="IV")
        self.assertEqual(len(hasil), 2)  # mc_001 dan mc_002

    def test_daftar_mengembalikan_salinan(self):
        """Memodifikasi hasil daftar tidak mengubah catalog."""
        tambah_aktivitas(mc_valid())
        daftar = daftar_aktivitas()
        daftar[0]["pertanyaan"] = "DIUBAH"
        hasil_asli = ambil_aktivitas("mc_001")
        self.assertNotEqual(hasil_asli["pertanyaan"], "DIUBAH")

    def test_bersihkan_catalog(self):
        """bersihkan_catalog mengosongkan semua data."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        jumlah = bersihkan_catalog()
        self.assertEqual(jumlah, 2)
        self.assertEqual(daftar_aktivitas(), [])

    def test_ringkasan_catalog(self):
        """ringkasan_catalog mengembalikan data agregat yang benar."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        ringkasan = ringkasan_catalog()
        self.assertEqual(ringkasan["total"], 2)
        self.assertIn("multiple_choice", ringkasan["per_tipe"])
        self.assertIn("step_solver", ringkasan["per_tipe"])
        self.assertIn("mc_001", ringkasan["ids"])
        self.assertIn("ss_001", ringkasan["ids"])

    def test_tambah_mengembalikan_aktivitas_bersih(self):
        """tambah_aktivitas mengembalikan dict aktivitas yang sudah divalidasi."""
        hasil = tambah_aktivitas(mc_valid())
        self.assertIsInstance(hasil, dict)
        self.assertEqual(hasil["tipe"], ActivityType.MULTIPLE_CHOICE)


# ===========================================================================
# TEST: Contoh data lengkap (integrasi schema + catalog)
# ===========================================================================

class TestIntegrasi(unittest.TestCase):
    """Test integrasi ringan antara schema dan catalog."""

    def setUp(self):
        bersihkan_catalog()

    def tearDown(self):
        bersihkan_catalog()

    def test_workflow_lengkap_mc(self):
        """Tambah, ambil, filter, hapus untuk multiple_choice."""
        tambah_aktivitas(mc_valid())
        self.assertIsNotNone(ambil_aktivitas("mc_001"))
        self.assertEqual(len(daftar_aktivitas(tipe="multiple_choice")), 1)
        hapus_aktivitas("mc_001")
        self.assertIsNone(ambil_aktivitas("mc_001"))

    def test_workflow_lengkap_ss(self):
        """Tambah, ambil, filter, hapus untuk step_solver."""
        tambah_aktivitas(ss_valid())
        self.assertIsNotNone(ambil_aktivitas("ss_001"))
        self.assertEqual(len(daftar_aktivitas(tipe="step_solver")), 1)
        hapus_aktivitas("ss_001")
        self.assertIsNone(ambil_aktivitas("ss_001"))

    def test_multi_aktivitas_berbeda_tipe(self):
        """Multiple aktivitas berbeda tipe bisa coexist di catalog."""
        for i in range(3):
            tambah_aktivitas(mc_valid(id=f"mc_{i:03d}"))
        for i in range(2):
            tambah_aktivitas(ss_valid(id=f"ss_{i:03d}"))

        self.assertEqual(ringkasan_catalog()["total"], 5)
        self.assertEqual(len(daftar_aktivitas(tipe="multiple_choice")), 3)
        self.assertEqual(len(daftar_aktivitas(tipe="step_solver")), 2)

    def test_json_round_trip(self):
        """Aktivitas yang disimpan di catalog bisa di-JSON dan di-parse balik."""
        tambah_aktivitas(mc_valid())
        tambah_aktivitas(ss_valid())
        semua = daftar_aktivitas()
        for a in semua:
            json_str = json.dumps(a)
            parsed = json.loads(json_str)
            self.assertEqual(parsed["id"], a["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
