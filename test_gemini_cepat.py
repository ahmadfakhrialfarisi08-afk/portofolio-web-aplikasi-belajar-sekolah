# ----------------------------------------------------
# TEST_GEMINI_CEPAT.PY
# ----------------------------------------------------
# Script paling cepat buat ngecek koneksi ke Gemini API sudah jalan atau
# belum -- TANPA perlu nyalain Flask sama sekali. Cukup jalankan:
#
#   python test_gemini_cepat.py
#
# Pastikan file .env sudah ada isinya (lihat .env.example) sebelum jalankan.
# ----------------------------------------------------

from services.gemini_service import tanya_gemini, GeminiError

if __name__ == "__main__":
    print("Menghubungi Gemini...")
    try:
        jawaban = tanya_gemini("Perkenalkan dirimu dalam 1-2 kalimat singkat.")
        print("\n✅ BERHASIL! Jawaban dari Gemini:\n")
        print(jawaban)
    except GeminiError as e:
        print("\n❌ GAGAL:\n")
        print(e)
