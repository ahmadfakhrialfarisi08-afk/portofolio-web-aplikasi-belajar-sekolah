"""
Kompres logo PNG -> WebP (tetap tajam, transparansi dipertahankan).

Cara pakai (dari folder project Flask, yang punya static/img):
    pip install pillow
    python kompres_logo.py

File PNG asli TIDAK dihapus/diubah. Hasil .webp ditulis di sebelahnya.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

FOLDER = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("static/img")
DAFTAR = [
    "edunex_logo.png",
    "logo_TEKNIK_KOMPUTER_JARINGAN.png",
    "logo_TEKNIK_AUDIO_VIDEO.png",
    "logo_TEKNIK_KENDARAAN_RINGAN.png",
    "logo_sekolah.png",            # opsional: simpan logo sekolah di sini
]
MAKS_SISI = 1000      # logo tampil max ~400px, 1000px sudah aman untuk layar retina
KUALITAS = 95         # 90 + alpha 100 = tidak terlihat bedanya di logo flat

def kb(p): return p.stat().st_size / 1024

total_asli = total_baru = 0
for nama in DAFTAR:
    src = FOLDER / nama
    if not src.exists():
        print(f"- lewati (tidak ada): {src}")
        continue
    im = Image.open(src).convert("RGBA")
    if max(im.size) > MAKS_SISI:
        im.thumbnail((MAKS_SISI, MAKS_SISI), Image.LANCZOS)
    out = src.with_suffix(".webp")
    im.save(out, "WEBP", quality=KUALITAS, alpha_quality=100, method=6)

    # Cek selisih visual vs aslinya (di ukuran yang sama), di atas latar putih & hijau
    asli = Image.open(src).convert("RGBA").resize(im.size, Image.LANCZOS)
    baru = Image.open(out).convert("RGBA")
    selisih = []
    for bg in [(255, 255, 255), (10, 80, 40)]:
        a = Image.new("RGBA", im.size, bg + (255,)); a.alpha_composite(asli)
        b = Image.new("RGBA", im.size, bg + (255,)); b.alpha_composite(baru)
        d = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
        selisih.append(max(ImageStat.Stat(d).mean))
    total_asli += kb(src); total_baru += kb(out)
    print(f"{nama:40s} {kb(src):7.0f} KB -> {kb(out):6.0f} KB  "
          f"(selisih rata-rata piksel: {max(selisih):.2f} dari 255)")

print(f"\nTotal: {total_asli:.0f} KB -> {total_baru:.0f} KB "
      f"(hemat {100 - 100*total_baru/max(total_asli,1):.0f}%)")
print("Selisih < 1.0 = tidak terlihat mata. Kalau ada yang > 2, naikkan KUALITAS ke 95.")
