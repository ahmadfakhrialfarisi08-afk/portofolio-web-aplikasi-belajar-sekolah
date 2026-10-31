"""
Lily Learning — Activity Catalog (Tahap 1).

Penyimpanan in-memory untuk aktivitas belajar yang telah divalidasi.
Tidak menggunakan database atau AI. Cukup untuk testing schema di Tahap 1.

Catalog berfungsi sebagai:
  1. Registry aktivitas yang sudah divalidasi.
  2. CRUD sederhana: tambah, ambil, hapus, daftar.
  3. Filter berdasarkan tipe, meta (mapel, kelas), dll.

Catatan:
  - Di Tahap 2+, catalog ini dapat digantikan oleh database/ORM.
  - Semua data hanya tersimpan di memori (hilang saat restart).
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .schema import ActivityError, ActivityType, validasi_aktivitas

# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class CatalogError(ValueError):
    """Kesalahan operasi catalog aktivitas."""


# ---------------------------------------------------------------------------
# Catalog (in-memory, thread-safe untuk single-thread / testing)
# ---------------------------------------------------------------------------

# Struktur internal: {id: dict_aktivitas_bersih}
CATALOG: Dict[str, dict] = {}


def tambah_aktivitas(mentah: object, *, timpa: bool = False) -> dict:
    """
    Validasi + tambahkan aktivitas ke catalog.

    Args:
        mentah: dict mentah (belum divalidasi).
        timpa:  jika True, aktivitas dengan ID yang sama akan ditimpa.

    Returns:
        dict aktivitas yang sudah bersih & tersimpan.

    Raises:
        ActivityError: jika data tidak valid.
        CatalogError:  jika ID sudah ada dan timpa=False.
    """
    aktivitas = validasi_aktivitas(mentah)
    aid = aktivitas["id"]

    if aid in CATALOG and not timpa:
        raise CatalogError(
            f"Aktivitas dengan ID '{aid}' sudah ada. Gunakan timpa=True untuk mengganti."
        )

    CATALOG[aid] = aktivitas
    return aktivitas


def ambil_aktivitas(aid: str) -> Optional[dict]:
    """
    Ambil aktivitas berdasarkan ID.

    Returns:
        dict aktivitas atau None jika tidak ditemukan.
    """
    if not isinstance(aid, str):
        return None
    return CATALOG.get(aid)


def hapus_aktivitas(aid: str) -> bool:
    """
    Hapus aktivitas berdasarkan ID.

    Returns:
        True jika berhasil dihapus, False jika tidak ada.
    """
    if aid in CATALOG:
        del CATALOG[aid]
        return True
    return False


def daftar_aktivitas(
    *,
    tipe: Optional[str] = None,
    mapel: Optional[str] = None,
    kelas: Optional[str] = None,
) -> List[dict]:
    """
    Daftar semua aktivitas, dengan filter opsional.

    Args:
        tipe:   filter berdasarkan tipe aktivitas (e.g. "multiple_choice").
        mapel:  filter berdasarkan meta['mapel'] (case-insensitive).
        kelas:  filter berdasarkan meta['kelas'] (case-insensitive).

    Returns:
        List dict aktivitas (salinan — tidak bisa memodifikasi catalog langsung).
    """
    hasil = list(CATALOG.values())

    if tipe is not None:
        # Normalisasi ke ActivityType jika perlu
        try:
            tipe_enum = ActivityType(tipe)
        except ValueError:
            return []  # tipe tidak dikenal -> hasilnya kosong
        hasil = [a for a in hasil if a["tipe"] == tipe_enum]

    if mapel is not None:
        mapel_lower = mapel.strip().lower()
        hasil = [
            a for a in hasil
            if a.get("meta", {}).get("mapel", "").lower() == mapel_lower
        ]

    if kelas is not None:
        kelas_lower = kelas.strip().lower()
        hasil = [
            a for a in hasil
            if a.get("meta", {}).get("kelas", "").lower() == kelas_lower
        ]

    # Kembalikan salinan agar tidak ada side-effect
    return [dict(a) for a in hasil]


def bersihkan_catalog() -> int:
    """
    Kosongkan seluruh catalog (berguna untuk testing).

    Returns:
        Jumlah aktivitas yang dihapus.
    """
    jumlah = len(CATALOG)
    CATALOG.clear()
    return jumlah


def ringkasan_catalog() -> dict:
    """
    Kembalikan ringkasan isi catalog.

    Returns:
        dict dengan total, per_tipe, ids.
    """
    per_tipe: Dict[str, int] = {}
    for a in CATALOG.values():
        t = a["tipe"]
        per_tipe[t] = per_tipe.get(t, 0) + 1

    return {
        "total": len(CATALOG),
        "per_tipe": per_tipe,
        "ids": list(CATALOG.keys()),
    }
