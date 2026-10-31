# Semua pengaturan project ditaruh di sini,
# biar kalau mau ganti nanti gak perlu ubek-ubek banyak file

import os

# Muat variabel dari file .env kalau ada (API key, dll) -- aman diabaikan
# kalau python-dotenv belum terinstall atau file .env belum dibuat.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SECRET_KEY = "ganti-ini-dengan-random-string-nanti"
DATABASE_PATH = "database.db"

# ----------------------------------------------------
# PENGATURAN GOOGLE GEMINI
# ----------------------------------------------------
# Isi GEMINI_API_KEY di file .env (JANGAN ditulis langsung di sini supaya
# tidak ke-commit ke git -- .env sudah otomatis diabaikan lewat .gitignore).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
