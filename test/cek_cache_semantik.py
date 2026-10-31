"""Diagnosa cache semantik AI Support.

Jalankan dari ROOT project:   python test/cek_cache_semantik.py
Tidak menulis apa pun ke cache. Yang dicek:
  1. Konfigurasi .env lengkap atau belum (kalau belum, cache semantik MATI
     diam-diam: semua error ditelan jadi "cache miss").
  2. Supabase (RPC pencarian) bisa dihubungi atau tidak.
  3. Kemiripan (cosine) pasangan pertanyaan 'beda kata, maksud sama' vs
     ambang AI_SEMANTIC_CACHE_AMBANG -- ini yang menentukan hit/miss.
Edit PASANGAN di bawah dengan pertanyaan nyata yang lu uji.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from services import semantic_cache_service as sc  # noqa: E402

# (pertanyaan A, pertanyaan B, SEHARUSNYA sama? True/False)
PASANGAN = [
    ("siapa pembuat web ini", "siapa yang bikin website sekolah ini", True),
    ("apa itu jaringan LAN", "jelaskan pengertian LAN", True),
    ("cara cek ip address di windows", "gimana caranya lihat ip komputer windows", True),
    ("apa itu jaringan LAN", "apa itu jaringan WAN", False),
    ("syarat daftar SMK", "syarat daftar SMP", False),
]


def cosine(a, b):
    d = sum(x * y for x, y in zip(a, b))
    return d / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def ok(flag):
    return "OK   " if flag else "KOSONG"


print("== Konfigurasi ==")
print(f"GEMINI_API_KEY            : {ok(bool(sc.GEMINI_API_KEY))}")
print(f"SUPABASE_URL              : {ok(bool(sc.SUPABASE_URL))}")
print(f"SUPABASE_SERVICE_ROLE_KEY : {ok(bool(sc.SUPABASE_SERVICE_ROLE_KEY))}")
print(f"Fitur aktif               : {sc._fitur_aktif()}")
print(f"Ambang                    : {sc.AMBANG_SIMILARITY_DEFAULT}   TTL: {sc.TTL_CACHE_SEMANTIK_DETIK}s")
if not sc._fitur_aktif():
    print("\n>> Cache semantik NONAKTIF karena env di atas belum lengkap. Isi dulu di .env, restart server.")

print("\n== Supabase RPC ==")
try:
    vektor = sc._buat_embedding_inti("tes koneksi", {})
    r = sc._panggil_rpc_supabase(
        sc.SUPABASE_CACHE_RPC,
        {"query_embedding": vektor, "ambang_similarity": 0.99, "ttl_detik": sc.TTL_CACHE_SEMANTIK_DETIK},
    )
    print(f"OK, RPC '{sc.SUPABASE_CACHE_RPC}' bisa dipanggil (hasil: {len(r)} baris)")
except Exception as e:
    print(f"GAGAL: {e}\n>> Inilah yang selama ini ditelan diam-diam sebagai 'cache miss'.")

print("\n== Kemiripan pasangan pertanyaan ==")
try:
    for a, b, harus_sama in PASANGAN:
        s = cosine(sc._buat_embedding_inti(a, {}), sc._buat_embedding_inti(b, {}))
        kena = s >= sc.AMBANG_SIMILARITY_DEFAULT
        tanda = "benar" if kena == harus_sama else ("MELESET (harusnya kena)" if harus_sama else "BAHAYA (harusnya TIDAK kena)")
        print(f"{s:.3f}  {'HIT ' if kena else 'miss'}  [{tanda}]  {a!r} ~ {b!r}")
except Exception as e:
    print(f"Embedding gagal: {e}")
