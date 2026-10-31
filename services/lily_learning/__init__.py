"""Lily Learning: modul aktivitas belajar interaktif.

Lapisan data (Tahap 1) — tanpa AI, tanpa renderer frontend.
Hanya: schema validasi + catalog aktivitas.
"""
from .schema import (
    ActivityError,
    ActivityType,
    validasi_multiple_choice,
    validasi_step_solver,
    validasi_aktivitas,
)
from .catalog import (
    CatalogError,
    tambah_aktivitas,
    ambil_aktivitas,
    hapus_aktivitas,
    daftar_aktivitas,
    CATALOG,
)

__all__ = [
    # schema
    "ActivityError",
    "ActivityType",
    "validasi_multiple_choice",
    "validasi_step_solver",
    "validasi_aktivitas",
    # catalog
    "CatalogError",
    "tambah_aktivitas",
    "ambil_aktivitas",
    "hapus_aktivitas",
    "daftar_aktivitas",
    "CATALOG",
]
