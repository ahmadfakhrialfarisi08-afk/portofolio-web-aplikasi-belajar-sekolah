"""
Document Schema Lily DOCX Generator.

Lapisan tengah: AI -> **Document Schema** -> DOCX Renderer.
Modul ini TIDAK memanggil AI dan TIDAK menyentuh python-docx. Tugasnya:
  1. mendefinisikan bentuk dokumen (dict sederhana, mudah di-JSON-kan),
  2. memvalidasi + membersihkan keluaran AI (batas ukuran, tipe blok, filler/meta AI),
  3. menolak dokumen yang tidak layak dirender (kosong / rusak) dengan SchemaError.

Bentuk dokumen (setelah dibersihkan):
{
  "jenis":  "modul_ajar",                      # slug bebas huruf kecil/underscore
  "judul":  "Modul Ajar Basis Data",
  "meta":   [["Mata Pelajaran", "Basis Data"], ["Kelas", "XI TKJ"]],   # HANYA data yang tersedia
  "bagian": [
     {"judul": "Tujuan Pembelajaran",
      "blok": [
         {"tipe": "paragraf", "teks": "..."},
         {"tipe": "subjudul", "teks": "..."},
         {"tipe": "daftar",   "gaya": "bullet" | "nomor", "item": ["...", "..."]},
         {"tipe": "tabel",    "kolom": ["No", "Kegiatan"], "baris": [["1", "..."]]}
      ]}
  ],
  "isian_kosong": ["Nama guru", "NIP"],       # data yang TIDAK tersedia -> dikosongkan, tidak dikarang
  "tanda_tangan": true
}
"""
import re

# --- Batas ukuran (melindungi renderer & memori; keluaran AI tidak dipercaya) ---
MAKS_BAGIAN = 30
MAKS_BLOK_PER_BAGIAN = 40
MAKS_ITEM_DAFTAR = 40
MAKS_KOLOM_TABEL = 8
MAKS_BARIS_TABEL = 60
MAKS_PANJANG_TEKS = 4000
MAKS_PANJANG_SEL = 600
MAKS_PANJANG_JUDUL = 160
MAKS_META = 14

TIPE_BLOK = ("paragraf", "subjudul", "daftar", "tabel")


class SchemaError(ValueError):
    """Dokumen dari AI tidak bisa dipakai (kosong / bentuk salah)."""


# ---------------------------------------------------------------------------
# Pembersih filler / meta AI. Hanya membuang KALIMAT PEMBUKA/PENUTUP yang berisi meta,
# bukan isi pelajaran. Pola sengaja spesifik supaya kata biasa tidak ikut terhapus.
# ---------------------------------------------------------------------------
_FILLER_KALIMAT = re.compile(
    r"^\s*(?:"
    r"berdasarkan\s+(?:permintaan|instruksi|perintah|arahan|prompt)\s+(?:anda|bapak|ibu|bapak/ibu|guru|kamu)[^.:\n]*[.:]"
    r"|sesuai\s+(?:dengan\s+)?(?:permintaan|instruksi|perintah)\s+(?:anda|bapak|ibu|bapak/ibu|guru|kamu)[^.:\n]*[.:]"
    r"|sebagai\s+(?:sebuah\s+)?(?:ai|asisten|model\s+bahasa|kecerdasan\s+buatan)[^.:\n]*[.:]"
    r"|berikut\s+(?:ini\s+)?(?:adalah\s+)?(?:dokumen|modul|draf|draft)[^.:\n]*:"
    r"|tentu[,!.]?\s+(?:berikut|ini|saya|lily)[^.:\n]*[.:!]"
    r"|baik[,!.]?\s+(?:berikut|ini|saya|lily)[^.:\n]*[.:!]"
    r"|semoga\s+(?:dokumen|modul|bermanfaat|membantu)[^.\n]*\.?"
    r"|(?:jika|kalau)\s+(?:anda|bapak|ibu|bapak/ibu)\s+(?:butuh|membutuhkan|ingin)[^.\n]*(?:revisi|perubahan|bantuan)[^.\n]*\.?"
    r"|lily\s+(?:telah|sudah)\s+(?:membuat|menyusun)[^.\n]*\.?"
    r")\s*",
    re.IGNORECASE,
)

# Kalau SELURUH teks sebuah blok adalah meta -> blok dibuang.
_BLOK_META_PENUH = re.compile(
    r"^\s*(?:catatan\s+ai|catatan\s+untuk\s+guru|disclaimer\s+ai|dibuat\s+(?:oleh|dengan)\s+(?:ai|lily|scorus)[^\n]*)\s*:?.*$",
    re.IGNORECASE,
)

_RE_SPASI = re.compile(r"[ \t\u00A0]+")
_RE_KONTROL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uD800-\uDFFF\uFFFE\uFFFF]")  # XML 1.0 tidak menerima karakter ini
_RE_MARKDOWN_AWAL = re.compile(r"^\s*(?:#{1,6}\s+|[-*\u2022]\s+|\d{1,2}[.)]\s+)")
_RE_BOLD = re.compile(r"\*\*(.+?)\*\*|(?<![_\w])__([^_\s](?:[^_\n]*[^_\s])?)__(?![_\w])")


def bersihkan_teks(teks, maks=MAKS_PANJANG_TEKS):
    """String aman untuk dokumen: tanpa karakter kontrol, spasi rapi, tanpa penanda markdown tebal,
    tanpa kalimat meta AI di awal. Selalu mengembalikan str (boleh kosong)."""
    if teks is None:
        return ""
    if isinstance(teks, (int, float)) and not isinstance(teks, bool):
        teks = str(teks)
    if not isinstance(teks, str):
        return ""
    t = _RE_KONTROL.sub("", teks).replace("\r\n", "\n").replace("\r", "\n")
    t = _RE_BOLD.sub(lambda m: m.group(1) or m.group(2) or "", t)
    t = t.replace("`", "")
    t = _RE_SPASI.sub(" ", t)
    t = "\n".join(baris.strip() for baris in t.split("\n")).strip()
    # Buang kalimat meta di awal (maks 2x, kalau AI menumpuk).
    for _ in range(2):
        baru = _FILLER_KALIMAT.sub("", t, count=1).strip()
        if baru == t:
            break
        t = baru
    if _BLOK_META_PENUH.match(t):
        return ""
    return t[:maks].rstrip()


def _judul_bersih(teks, maks=MAKS_PANJANG_JUDUL):
    t = bersihkan_teks(teks, maks)
    t = _RE_MARKDOWN_AWAL.sub("", t).strip().rstrip(":")
    return t.replace("\n", " ")[:maks]


def _slug(teks, bawaan="dokumen"):
    if not isinstance(teks, str):  # keluaran AI tidak dipercaya: jenis bisa berupa list/dict/angka
        teks = ""
    s = re.sub(r"[^a-z0-9]+", "_", teks.lower()).strip("_")
    return s[:40] or bawaan


# ---------------------------------------------------------------------------
def _bersihkan_blok(b):
    if not isinstance(b, dict):
        return None
    tipe = b.get("tipe")
    if tipe not in TIPE_BLOK:
        return None

    if tipe in ("paragraf", "subjudul"):
        teks = _judul_bersih(b.get("teks")) if tipe == "subjudul" else bersihkan_teks(b.get("teks"))
        return {"tipe": tipe, "teks": teks} if teks else None

    if tipe == "daftar":
        item = b.get("item")
        if not isinstance(item, list):
            return None
        bersih = []
        for i in item[:MAKS_ITEM_DAFTAR]:
            t = bersihkan_teks(i, MAKS_PANJANG_SEL)
            t = _RE_MARKDOWN_AWAL.sub("", t).strip()  # nomor/bullet dari AI dibuang; renderer yang menomori
            if t:
                bersih.append(t)
        if not bersih:
            return None
        return {"tipe": "daftar", "gaya": "nomor" if b.get("gaya") == "nomor" else "bullet", "item": bersih}

    # tabel
    kolom = b.get("kolom")
    baris = b.get("baris")
    if not isinstance(kolom, list) or not kolom or not isinstance(baris, list):
        return None
    kolom = [_judul_bersih(k, 60) or " " for k in kolom[:MAKS_KOLOM_TABEL]]
    n = len(kolom)
    isi = []
    for r in baris[:MAKS_BARIS_TABEL]:
        if not isinstance(r, list):
            continue
        sel = [bersihkan_teks(c, MAKS_PANJANG_SEL) for c in r[:n]]
        sel += [""] * (n - len(sel))  # baris pendek dilengkapi kosong (jangan dikarang)
        if any(sel):
            isi.append(sel)
    if not isi:
        return None
    return {"tipe": "tabel", "kolom": kolom, "baris": isi}


def _bersihkan_meta(meta):
    hasil = []
    if isinstance(meta, dict):
        meta = list(meta.items())
    if not isinstance(meta, list):
        return hasil
    for p in meta[:MAKS_META]:
        if isinstance(p, (list, tuple)) and len(p) == 2:
            k, v = _judul_bersih(p[0], 50), bersihkan_teks(p[1], 200).replace("\n", " ")
            if k and v:  # nilai kosong = data tidak tersedia -> baris tidak dibuat
                hasil.append([k, v])
    return hasil


def validasi_dokumen(mentah):
    """Terima dict mentah (keluaran AI) -> dict bersih sesuai schema. Raise SchemaError kalau tidak layak."""
    if not isinstance(mentah, dict):
        raise SchemaError("Dokumen bukan objek JSON.")
    judul = _judul_bersih(mentah.get("judul"))
    if not judul:
        raise SchemaError("Dokumen tidak punya judul.")

    bagian_mentah = mentah.get("bagian")
    if not isinstance(bagian_mentah, list) or not bagian_mentah:
        raise SchemaError("Dokumen tidak punya bagian.")

    bagian = []
    for bg in bagian_mentah[:MAKS_BAGIAN]:
        if not isinstance(bg, dict):
            continue
        blok = []
        blok_mentah = bg.get("blok")
        if not isinstance(blok_mentah, list):
            blok_mentah = []
        for b in blok_mentah[:MAKS_BLOK_PER_BAGIAN]:
            bb = _bersihkan_blok(b)
            if bb:
                blok.append(bb)
        sj = _judul_bersih(bg.get("judul"))
        if blok:
            bagian.append({"judul": sj, "blok": blok})
    if not bagian:
        raise SchemaError("Semua bagian dokumen kosong.")
    # Dokumen yang isinya hanya judul-judul tanpa isi nyata dianggap gagal (bukan dokumen).
    jumlah_teks = sum(
        len(b.get("teks", "")) + sum(len(i) for i in b.get("item", [])) + sum(len(c) for r in b.get("baris", []) for c in r)
        for bg in bagian for b in bg["blok"]
    )
    if jumlah_teks < 80:
        raise SchemaError("Isi dokumen terlalu sedikit.")

    kosong = []
    if isinstance(mentah.get("isian_kosong"), list):
        for k in mentah["isian_kosong"][:12]:
            t = _judul_bersih(k, 60)
            if t and t not in kosong:
                kosong.append(t)

    return {
        "jenis": _slug(mentah.get("jenis")),
        "judul": judul,
        "meta": _bersihkan_meta(mentah.get("meta")),
        "bagian": bagian,
        "isian_kosong": kosong,
        "tanda_tangan": bool(mentah.get("tanda_tangan", False)),
    }


# ---------------------------------------------------------------------------
# Struktur usulan (tahap 1: 2 pilihan). Juga divalidasi, karena datang dari AI.
# ---------------------------------------------------------------------------
def validasi_struktur(mentah):
    """{"id","judul","deskripsi","bagian":[str,...]} -> dict bersih atau None."""
    if not isinstance(mentah, dict):
        return None
    judul = _judul_bersih(mentah.get("judul"), 80)
    bagian = mentah.get("bagian")
    if not judul or not isinstance(bagian, list):
        return None
    nama_bagian = []
    for b in bagian[:MAKS_BAGIAN]:
        t = _judul_bersih(b, 90)
        if t and t not in nama_bagian:
            nama_bagian.append(t)
    if len(nama_bagian) < 2:
        return None
    return {
        "judul": judul,
        "deskripsi": bersihkan_teks(mentah.get("deskripsi"), 220).replace("\n", " "),
        "bagian": nama_bagian,
    }


def validasi_pilihan_klien(mentah):
    """Struktur yang DIKIRIM BALIK browser (stateless). Dibersihkan ulang; tidak dipercaya apa adanya."""
    s = validasi_struktur(mentah)
    return s
