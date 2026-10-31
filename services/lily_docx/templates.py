"""
Template tampilan DOCX. Hanya data gaya (tidak ada logic AI / python-docx di sini),
jadi ganti tampilan cukup ubah file ini.

ambil_template(jenis) -> dict gaya. Jenis tidak dikenal memakai template "formal" bawaan.
"""

_FORMAL = {
    "nama": "formal",
    # Halaman A4, ukuran dalam cm
    "halaman": {"lebar": 21.0, "tinggi": 29.7, "kiri": 2.5, "kanan": 2.5, "atas": 2.3, "bawah": 2.0},
    "font": "Times New Roman",
    "ukuran_isi": 12,
    "ukuran_tabel": 10.5,
    "ukuran_judul": 16,
    "ukuran_h1": 13,
    "ukuran_h2": 12,
    "spasi_baris": 1.15,
    "spasi_setelah": 6,       # pt
    "warna_h1": "1F3864",     # biru tua
    "warna_garis": "8EA9DB",
    "warna_kepala_tabel": "DCE6F2",
    "judul_kapital": True,
    "meta_sebagai_tabel": True,
    "header_footer": True,
}

# Perbedaan kecil per jenis dokumen. Kunci cocok dengan kata dalam slug "jenis" dari schema.
_VARIAN = {
    "soal": {"ukuran_isi": 11.5},
    "rubrik": {"ukuran_tabel": 10},
    "lkpd": {"ukuran_isi": 11.5},
    "surat": {"meta_sebagai_tabel": False, "judul_kapital": False, "warna_h1": "000000"},
    "notulen": {"meta_sebagai_tabel": True},
}


def ambil_template(jenis):
    t = dict(_FORMAL)
    t["halaman"] = dict(_FORMAL["halaman"])
    slug = (jenis or "").lower()
    for kata, ubah in _VARIAN.items():
        if kata in slug:
            t.update(ubah)
            t["nama"] = "formal-" + kata
            break
    return t


def gabung_template(dasar, ubah):
    """Gabungkan template kustom (parsial) di atas template dasar. Kunci 'halaman' digabung per-kunci."""
    hasil = dict(dasar)
    hasil["halaman"] = dict(dasar["halaman"])
    for k, v in (ubah or {}).items():
        if k == "halaman" and isinstance(v, dict):
            hasil["halaman"].update(v)
        else:
            hasil[k] = v
    return hasil


# Nama bulan untuk tanggal tanda tangan (tanpa bergantung locale server).
BULAN = ("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
         "September", "Oktober", "November", "Desember")
