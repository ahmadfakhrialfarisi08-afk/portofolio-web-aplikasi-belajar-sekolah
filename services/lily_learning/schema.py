"""
Lily Learning — Activity Schema (Tahap 1).

Lapisan tengah: data mentah -> **Activity Schema** -> renderer (Tahap berikutnya).
Modul ini TIDAK memanggil AI dan TIDAK menyentuh frontend. Tugasnya:
  1. Mendefinisikan bentuk aktivitas belajar (dict sederhana, JSON-serializable).
  2. Memvalidasi + membersihkan data aktivitas (batas ukuran, tipe wajib, nilai enum).
  3. Menolak aktivitas yang tidak layak dengan ActivityError.

====================================================================
TIPE AKTIVITAS YANG DIDUKUNG (Tahap 1):
====================================================================

1. multiple_choice — Soal pilihan ganda.
{
  "tipe":       "multiple_choice",
  "id":         "mc_001",                         # string unik, slug bebas
  "pertanyaan": "Apa ibu kota Indonesia?",        # wajib, 5–2000 karakter
  "pilihan": [                                     # wajib, 2–8 pilihan
    {"kode": "A", "teks": "Jakarta"},
    {"kode": "B", "teks": "Bandung"},
    {"kode": "C", "teks": "Surabaya"},
  ],
  "jawaban_benar": "A",                           # kode pilihan yang benar; wajib
  "clue":        "Perhatikan huruf pertama.",     # opsional, str
  "explanation": "Jakarta adalah ibu kota RI.",   # opsional, str
  "feedback": {                                    # opsional
    "benar": "Hebat! Jawaban kamu tepat.",
    "salah": "Coba lagi, perhatikan kota mana yang menjadi pusat pemerintahan."
  },
  "meta": {"mapel": "IPS", "kelas": "IV"}         # opsional, dict str->str
}

--------------------------------------------------------------------

2. step_solver — Soal bertahap (step-by-step problem solver).
{
  "tipe":       "step_solver",
  "id":         "ss_001",
  "pertanyaan": "Hitunglah keliling segitiga dengan sisi 3, 4, 5!",
  "langkah": [
    {
      "nomor":       1,                            # int ≥ 1, berurutan
      "instruksi":   "Tuliskan rumus keliling segitiga.",
      "jawaban":     "K = a + b + c",              # jawaban referensi (plain text)
      "tipe_input":  "teks",                       # "teks" | "angka" | "pilihan"
      "pilihan":     null,                         # list pilihan jika tipe_input="pilihan"
      "clue":        "Keliling = jumlah semua sisi.",
      "explanation": "Rumus keliling adalah K = a + b + c."
    },
    {
      "nomor":       2,
      "instruksi":   "Substitusikan nilai a=3, b=4, c=5.",
      "jawaban":     "K = 3 + 4 + 5",
      "tipe_input":  "teks",
      "pilihan":     null,
      "clue":        "Ganti a, b, c dengan angka yang diberikan.",
      "explanation": "K = 3 + 4 + 5 = 12."
    }
  ],
  "clue_bertahap": [                               # clue umum bertahap (opsional)
    "Ingat bahwa keliling adalah total panjang semua sisi.",
    "Coba hitung satu per satu."
  ],
  "explanation":       "Keliling = 3 + 4 + 5 = 12 cm.",   # opsional
  "completion_message": "Selamat! Kamu berhasil menyelesaikan soal ini.",
  "meta": {"mapel": "Matematika", "kelas": "V"}
}
====================================================================
"""
import re
from enum import Enum

# ---------------------------------------------------------------------------
# Konstanta batas ukuran
# ---------------------------------------------------------------------------
MAKS_PANJANG_PERTANYAAN = 2000
MIN_PANJANG_PERTANYAAN = 5
MAKS_PANJANG_TEKS_PENDEK = 500    # clue, explanation, feedback
MAKS_PANJANG_INSTRUKSI = 600
MAKS_PANJANG_JAWABAN_REF = 600
MAKS_PANJANG_TEKS_PILIHAN = 300
MAKS_PANJANG_ID = 80
MAKS_PILIHAN_MC = 8
MIN_PILIHAN_MC = 2
MAKS_LANGKAH = 20
MIN_LANGKAH = 1
MAKS_CLUE_BERTAHAP = 10
MAKS_META_ENTRI = 12
MAKS_PANJANG_META_NILAI = 200


# ---------------------------------------------------------------------------
# Enum tipe aktivitas
# ---------------------------------------------------------------------------
class ActivityType(str, Enum):
    MULTIPLE_CHOICE = "multiple_choice"
    STEP_SOLVER = "step_solver"


TIPE_INPUT_LANGKAH = ("teks", "angka", "pilihan")


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------
class ActivityError(ValueError):
    """Data aktivitas tidak valid atau tidak layak divalidasi."""


# ---------------------------------------------------------------------------
# Helper pembersih teks (sederhana, tanpa regex AI-filler)
# ---------------------------------------------------------------------------
_RE_KONTROL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_RE_SPASI = re.compile(r"[ \t\u00A0]+")


def _bersihkan(teks: object, maks: int = MAKS_PANJANG_TEKS_PENDEK, wajib: bool = False) -> str:
    """Kembalikan string bersih. Jika wajib=True dan hasilnya kosong, raise ActivityError."""
    if teks is None:
        bersih = ""
    elif isinstance(teks, (int, float)) and not isinstance(teks, bool):
        bersih = str(teks)
    elif isinstance(teks, str):
        t = _RE_KONTROL.sub("", teks)
        t = t.replace("\r\n", "\n").replace("\r", "\n")
        t = _RE_SPASI.sub(" ", t)
        bersih = "\n".join(ln.strip() for ln in t.split("\n")).strip()
    else:
        bersih = ""

    bersih = bersih[:maks].rstrip()
    if wajib and not bersih:
        raise ActivityError("Teks wajib tidak boleh kosong.")
    return bersih


def _slug_id(raw: object, bawaan: str = "aktivitas") -> str:
    """Buat ID yang aman (huruf kecil, underscore, angka)."""
    if not isinstance(raw, str):
        raw = ""
    s = re.sub(r"[^a-z0-9_\-]+", "_", raw.strip().lower()).strip("_")
    return s[:MAKS_PANJANG_ID] or bawaan


def _bersihkan_meta(raw: object) -> dict:
    """Bersihkan dict metadata string->string opsional."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        return {}
    hasil = {}
    for k, v in list(raw.items())[:MAKS_META_ENTRI]:
        if isinstance(k, str) and isinstance(v, str) and k.strip():
            hasil[k.strip()[:60]] = v.strip()[:MAKS_PANJANG_META_NILAI]
    return hasil


# ---------------------------------------------------------------------------
# Validasi: multiple_choice
# ---------------------------------------------------------------------------
def _validasi_pilihan_mc(raw: object) -> list:
    """Validasi list pilihan multiple choice. Return list bersih [{kode, teks}]."""
    if not isinstance(raw, list):
        raise ActivityError("Field 'pilihan' harus berupa list.")

    hasil = []
    kode_sudah = set()
    for i, item in enumerate(raw[:MAKS_PILIHAN_MC]):
        if not isinstance(item, dict):
            raise ActivityError(f"Pilihan ke-{i+1} bukan dict.")
        kode = _bersihkan(item.get("kode"), maks=10)
        if not kode:
            raise ActivityError(f"Pilihan ke-{i+1} tidak punya 'kode'.")
        if kode in kode_sudah:
            raise ActivityError(f"Kode pilihan '{kode}' duplikat.")
        teks = _bersihkan(item.get("teks"), maks=MAKS_PANJANG_TEKS_PILIHAN, wajib=True)
        kode_sudah.add(kode)
        hasil.append({"kode": kode, "teks": teks})

    if len(hasil) < MIN_PILIHAN_MC:
        raise ActivityError(
            f"'pilihan' harus memiliki minimal {MIN_PILIHAN_MC} item, ditemukan {len(hasil)}."
        )
    return hasil


def _validasi_feedback(raw: object) -> dict:
    """Validasi dict feedback {benar, salah}. Opsional."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        return {}
    hasil = {}
    for k in ("benar", "salah"):
        v = _bersihkan(raw.get(k), maks=MAKS_PANJANG_TEKS_PENDEK)
        if v:
            hasil[k] = v
    return hasil


def validasi_multiple_choice(mentah: object) -> dict:
    """
    Validasi + bersihkan dict aktivitas multiple_choice.
    Return dict bersih atau raise ActivityError.
    """
    if not isinstance(mentah, dict):
        raise ActivityError("Aktivitas harus berupa objek/dict.")

    tipe = mentah.get("tipe")
    if tipe != ActivityType.MULTIPLE_CHOICE:
        raise ActivityError(
            f"Tipe aktivitas harus '{ActivityType.MULTIPLE_CHOICE}', ditemukan '{tipe}'."
        )

    pertanyaan = _bersihkan(mentah.get("pertanyaan"), maks=MAKS_PANJANG_PERTANYAAN)
    if len(pertanyaan) < MIN_PANJANG_PERTANYAAN:
        raise ActivityError(
            f"'pertanyaan' terlalu pendek (minimal {MIN_PANJANG_PERTANYAAN} karakter)."
        )

    pilihan = _validasi_pilihan_mc(mentah.get("pilihan"))
    kode_valid = {p["kode"] for p in pilihan}

    jawaban_benar = _bersihkan(mentah.get("jawaban_benar"), maks=10)
    if not jawaban_benar:
        raise ActivityError("Field 'jawaban_benar' wajib diisi.")
    if jawaban_benar not in kode_valid:
        raise ActivityError(
            f"'jawaban_benar' ('{jawaban_benar}') tidak ada di antara kode pilihan: {sorted(kode_valid)}."
        )

    return {
        "tipe": ActivityType.MULTIPLE_CHOICE,
        "id": _slug_id(mentah.get("id"), bawaan="mc"),
        "pertanyaan": pertanyaan,
        "pilihan": pilihan,
        "jawaban_benar": jawaban_benar,
        "clue": _bersihkan(mentah.get("clue"), maks=MAKS_PANJANG_TEKS_PENDEK),
        "explanation": _bersihkan(mentah.get("explanation"), maks=MAKS_PANJANG_TEKS_PENDEK),
        "feedback": _validasi_feedback(mentah.get("feedback")),
        "meta": _bersihkan_meta(mentah.get("meta")),
    }


# ---------------------------------------------------------------------------
# Validasi: step_solver
# ---------------------------------------------------------------------------
def _validasi_langkah(raw_langkah: object) -> list:
    """Validasi list langkah step_solver. Return list bersih."""
    if not isinstance(raw_langkah, list):
        raise ActivityError("Field 'langkah' harus berupa list.")

    if len(raw_langkah) < MIN_LANGKAH:
        raise ActivityError(f"'langkah' harus memiliki minimal {MIN_LANGKAH} item.")

    hasil = []
    for i, item in enumerate(raw_langkah[:MAKS_LANGKAH]):
        if not isinstance(item, dict):
            raise ActivityError(f"Langkah ke-{i+1} bukan dict.")

        # Nomor urut
        nomor_raw = item.get("nomor")
        try:
            nomor = int(nomor_raw)
        except (TypeError, ValueError):
            raise ActivityError(f"Langkah ke-{i+1}: 'nomor' harus integer, ditemukan '{nomor_raw}'.")
        if nomor < 1:
            raise ActivityError(f"Langkah ke-{i+1}: 'nomor' harus ≥ 1.")

        instruksi = _bersihkan(item.get("instruksi"), maks=MAKS_PANJANG_INSTRUKSI)
        if not instruksi:
            raise ActivityError(f"Langkah ke-{i+1}: 'instruksi' wajib diisi.")

        jawaban_ref = _bersihkan(item.get("jawaban"), maks=MAKS_PANJANG_JAWABAN_REF)
        if not jawaban_ref:
            raise ActivityError(f"Langkah ke-{i+1}: 'jawaban' (referensi) wajib diisi.")

        tipe_input = item.get("tipe_input", "teks")
        if tipe_input not in TIPE_INPUT_LANGKAH:
            raise ActivityError(
                f"Langkah ke-{i+1}: 'tipe_input' harus salah satu dari {TIPE_INPUT_LANGKAH}, "
                f"ditemukan '{tipe_input}'."
            )

        # pilihan hanya valid jika tipe_input="pilihan"
        pilihan_langkah = None
        if tipe_input == "pilihan":
            raw_pil = item.get("pilihan")
            if not isinstance(raw_pil, list) or len(raw_pil) < 2:
                raise ActivityError(
                    f"Langkah ke-{i+1}: tipe_input='pilihan' butuh field 'pilihan' dengan ≥ 2 item."
                )
            pilihan_langkah = [
                _bersihkan(p, maks=MAKS_PANJANG_TEKS_PILIHAN)
                for p in raw_pil[:MAKS_PILIHAN_MC]
                if _bersihkan(p, maks=MAKS_PANJANG_TEKS_PILIHAN)
            ]
            if len(pilihan_langkah) < 2:
                raise ActivityError(
                    f"Langkah ke-{i+1}: 'pilihan' harus memiliki minimal 2 item yang tidak kosong."
                )

        hasil.append({
            "nomor": nomor,
            "instruksi": instruksi,
            "jawaban": jawaban_ref,
            "tipe_input": tipe_input,
            "pilihan": pilihan_langkah,
            "clue": _bersihkan(item.get("clue"), maks=MAKS_PANJANG_TEKS_PENDEK),
            "explanation": _bersihkan(item.get("explanation"), maks=MAKS_PANJANG_TEKS_PENDEK),
        })

    # Validasi nomor urut tidak boleh ada duplikat
    nomor_list = [l["nomor"] for l in hasil]
    if len(nomor_list) != len(set(nomor_list)):
        raise ActivityError("Nomor langkah tidak boleh duplikat.")

    return hasil


def _validasi_clue_bertahap(raw: object) -> list:
    """Validasi list clue bertahap (opsional). Return list str."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return []
    hasil = []
    for item in raw[:MAKS_CLUE_BERTAHAP]:
        t = _bersihkan(item, maks=MAKS_PANJANG_TEKS_PENDEK)
        if t:
            hasil.append(t)
    return hasil


def validasi_step_solver(mentah: object) -> dict:
    """
    Validasi + bersihkan dict aktivitas step_solver.
    Return dict bersih atau raise ActivityError.
    """
    if not isinstance(mentah, dict):
        raise ActivityError("Aktivitas harus berupa objek/dict.")

    tipe = mentah.get("tipe")
    if tipe != ActivityType.STEP_SOLVER:
        raise ActivityError(
            f"Tipe aktivitas harus '{ActivityType.STEP_SOLVER}', ditemukan '{tipe}'."
        )

    pertanyaan = _bersihkan(mentah.get("pertanyaan"), maks=MAKS_PANJANG_PERTANYAAN)
    if len(pertanyaan) < MIN_PANJANG_PERTANYAAN:
        raise ActivityError(
            f"'pertanyaan' terlalu pendek (minimal {MIN_PANJANG_PERTANYAAN} karakter)."
        )

    langkah = _validasi_langkah(mentah.get("langkah"))

    completion_message = _bersihkan(
        mentah.get("completion_message"), maks=MAKS_PANJANG_TEKS_PENDEK
    )

    return {
        "tipe": ActivityType.STEP_SOLVER,
        "id": _slug_id(mentah.get("id"), bawaan="ss"),
        "pertanyaan": pertanyaan,
        "langkah": langkah,
        "clue_bertahap": _validasi_clue_bertahap(mentah.get("clue_bertahap")),
        "explanation": _bersihkan(mentah.get("explanation"), maks=MAKS_PANJANG_TEKS_PENDEK),
        "completion_message": completion_message,
        "meta": _bersihkan_meta(mentah.get("meta")),
    }


# ---------------------------------------------------------------------------
# Dispatcher validasi umum
# ---------------------------------------------------------------------------
_VALIDATOR = {
    ActivityType.MULTIPLE_CHOICE: validasi_multiple_choice,
    ActivityType.STEP_SOLVER: validasi_step_solver,
}


def validasi_aktivitas(mentah: object) -> dict:
    """
    Validasi aktivitas belajar dari tipe apapun yang didukung.
    Dispatch ke validator yang sesuai berdasarkan field 'tipe'.
    Raise ActivityError jika tidak valid.
    """
    if not isinstance(mentah, dict):
        raise ActivityError("Aktivitas harus berupa objek/dict.")
    tipe = mentah.get("tipe")
    validator = _VALIDATOR.get(tipe)
    if validator is None:
        tipe_valid = [t.value for t in ActivityType]
        raise ActivityError(
            f"Tipe aktivitas tidak dikenal: '{tipe}'. Tipe yang didukung: {tipe_valid}."
        )
    return validator(mentah)
