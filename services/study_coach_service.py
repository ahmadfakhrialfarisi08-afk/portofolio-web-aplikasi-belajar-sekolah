# ----------------------------------------------------
# STUDY_COACH_SERVICE.PY
# ----------------------------------------------------
# Lapisan "Personal Study Coach" untuk Arcana AI (AI Siswa, Gemini).
# BUKAN sistem Gemini baru: modul ini TIDAK memanggil Gemini sama sekali.
# Tugasnya cuma 4 hal ringan, semuanya lokal & gratis token:
#
#   1. deteksi_intent()    -> tebak intent pesan (STUDY_METHOD, dst)
#   2. catatan sesi        -> ingat preferensi belajar SEMENTARA per akun
#                             (topik, level, waktu, gaya, dst), in-memory
#   3. keputusan giliran   -> "tanya 1 hal" atau "langsung jawab", supaya
#                             perilaku coach tidak bergantung tebakan model
#   4. bangun_blok_prompt()-> blok data kecil yang disuntik ke system prompt
#
# Dipanggil dari api/gemini_routes.py. Cache, kuota, logging usage, dan
# guardrail TETAP di gemini_routes.py / gemini_service.py (tidak diubah).
#
# PRIVASI: semua state dipisah per username dan hanya dipakai untuk akun
# itu sendiri. Catatan sesi TIDAK PERNAH masuk cache global (lihat
# hindari_cache di hasil analisis_pesan). Isi pesan tidak pernah di-log.
# ----------------------------------------------------

import re
import threading
import time
import unicodedata

# ----------------------------------------------------
# KONSTANTA INTENT
# ----------------------------------------------------
STUDY_METHOD = "STUDY_METHOD"
MATERIAL_EXPLANATION = "MATERIAL_EXPLANATION"
STUDY_PLAN = "STUDY_PLAN"
PRACTICE_HELP = "PRACTICE_HELP"
SCHOOL_INFO = "SCHOOL_INFO"
MAJOR_INFO = "MAJOR_INFO"
EQUIPMENT_INFO = "EQUIPMENT_INFO"
STUDENT_PROGRESS = "STUDENT_PROGRESS"
OUT_OF_SCOPE = "OUT_OF_SCOPE"      # diputuskan model, bukan keyword
TIDAK_PASTI = "TIDAK_PASTI"        # backend ragu -> model yang menilai
SOAL_LUAR = "SOAL_LUAR"            # tampak soal tempelan (ujian/tugas)

# Intent yang membuat jawaban bergantung pada topik/preferensi siswa.
INTENT_COACH = {STUDY_METHOD, STUDY_PLAN, PRACTICE_HELP}

STATE_TTL_DETIK = 2 * 60 * 60     # catatan preferensi sesi
MODE_COACH_TTL_DETIK = 30 * 60    # sama dengan RIWAYAT_TTL_DETIK di routes
MAKS_USER_STATE = 500
MAKS_TANYA_BERUNTUN = 2           # setelah 2x tanya, WAJIB langsung jawab

_lock = threading.Lock()
_state = {}  # username -> dict (lihat _state_baru)


def _state_baru():
    return {
        "catatan": {},          # lihat _FIELD_CATATAN
        "mode_coach": False,
        "terakhir_coach": 0.0,
        "intent_terakhir": None,
        "menunggu": None,       # field yang terakhir kita tanyakan ke siswa
        "tanya_beruntun": 0,
        "pending": None,        # keputusan giliran yang sedang diproses
        "terakhir": 0.0,
    }


_FIELD_CATATAN = ("topik", "level", "waktu", "gaya", "kurang_cocok",
                  "mudah_bosan", "mudah_lupa", "target", "tenggat", "langsung")
_FIELD_PER_TOPIK = ("level", "target", "tenggat")  # direset kalau topik ganti


def _norm(teks):
    return unicodedata.normalize("NFKC", teks or "").casefold()


def _bersihkan(teks, maks=40):
    """Teks dari siswa yang akan masuk prompt: hanya karakter aman &
    pendek, supaya tidak jadi jalur prompt-injection."""
    teks = re.sub(r"[^0-9A-Za-z\u00C0-\u024F .,+#/&()\-]", " ", teks or "")
    teks = re.sub(r"\s+", " ", teks).strip(" .,-")
    return teks[:maks].strip()


# ----------------------------------------------------
# DETEKSI INTENT (keyword, sengaja sederhana & konservatif)
# ----------------------------------------------------
# Salah deteksi tidak berbahaya: hasilnya hanya "petunjuk" untuk model dan
# kebijakan cache. Keputusan akhir soal scope tetap di system prompt.
_RE_LANGSUNG = re.compile(
    r"\blangsung\b.{0,25}\b(?:kasih|beri|berikan|jawab|jelasin|jelaskan|aja|saja|"
    r"caranya|rekomendasi|metode|rencana|plan)\b"
    r"|\b(?:ga|gak|nggak|ngga|tidak|jangan|tanpa|usah)\s*(?:perlu|usah)?\s*(?:banyak\s*)?"
    r"(?:tanya|nanya|bertanya)\b"
    r"|\bto the point\b|\bskip (?:pertanyaan|tanya)\b"
)
_RE_PLAN = re.compile(
    r"\b(?:study ?plan|rencana (?:belajar|studi)|jadwal belajar|plan belajar|roadmap|"
    r"peta belajar|urutan belajar|prioritas (?:belajar|materi|mapel|topik)|"
    r"belajar apa (?:dulu|duluan)|mulai (?:belajar )?dari mana|"
    r"(?:bikin|buat|susun|atur)(?:in|kan)? (?:jadwal|rencana|plan)|"
    r"(?:atur|bagi)(?:in|kan)? waktu belajar)\b"
)
_RE_PRACTICE = re.compile(
    r"\b(?:latihan|(?:bikin|buat|kasih|beri)(?:in|kan)? (?:aku |saya )?(?:soal|kuis|quiz)|"
    r"uji (?:aku|pemahaman|kemampuan)|(?:tes|test) (?:aku|pemahaman)|flash ?card|"
    r"latih(?:in)? (?:aku|saya)|mini ?(?:kuis|quiz))\b"
)
_RE_METHOD = re.compile(
    r"\b(?:cara|metode|strategi|teknik|tips?|trik|kiat)\s+(?:belajar|mempelajari|"
    r"menghafal|menghapal|memahami|mengingat|mengerti|menguasai)\b"
    r"|\b(?:bagaimana|gimana|gmn|gmana)\s+(?:cara\s+|caranya\s+)?(?:belajar|mempelajari|"
    r"menghafal|menghapal|memahami|mengingat|menguasai)\b"
    r"|\bbelajar\b.{0,40}?\b(?:biar|agar|supaya)\s+(?:cepat|cepet|gampang|mudah|paham|"
    r"ngerti|hafal|hapal|ingat|lancar|bisa|fokus)\b"
    r"|\b(?:biar|supaya|agar)\s+(?:cepat|cepet|gampang|mudah)\s+(?:paham|hafal|hapal|ingat|ngerti|bisa)\b"
    r"|\b(?:susah|sulit|males|malas)\s+(?:belajar|fokus|konsentrasi)\b"
    r"|\b(?:mau|ingin|pengen|pengin)\s+(?:mulai\s+)?belajar\b|\bmulai belajar\b"
)
_RE_MATERI = re.compile(
    r"\b(?:apa (?:itu|yang dimaksud|maksud)|apaan|jelas(?:kan|in)|terangkan|pengertian|"
    r"definisi|fungsi|perbedaan|bedanya|beda|kenapa|mengapa|contoh(?:nya)?|rumus|konsep|"
    r"cara kerja|cara menghitung|cara pakai|cara menggunakan|artinya|arti dari)\b"
)
_RE_BINGUNG = re.compile(
    r"\b(?:ga|gak|nggak|ngga|tidak|belum|kurang|susah|sulit)\s+(?:ngerti|mengerti|paham|"
    r"memahami|mudeng|ngeh|bisa)\b|\b(?:bingung|pusing)\b"
)
_RE_ALAT = re.compile(r"\b(?:alat|perkakas|peralatan|perangkat|komponen|tools?)\b")
_RE_JURUSAN = re.compile(r"\bjurusan\b|\bprospek (?:kerja|karir|karier)\b")
_RE_SEKOLAH_APP = re.compile(
    r"\b(?:menu|fitur|aplikasi|dashboard|login|password|pembuat|pencipta|kreator|developer|"
    r"cara (?:ikut|submit|kumpul|kumpulkan|upload|lihat)|eskul|fasilitas|kontak)\b"
    # variasi "siapa yang membuat/bikin web ini", "web ini dibuat/buatan siapa"
    r"|\b(?:membuat|bikin|membikin|menciptakan|mengembangkan|ngembangin)\s+"
    r"(?:web|website|situs|aplikasi|app|portal)\b"
    r"|\b(?:dibuat|dibikin|dikembangkan|buatan)\s+(?:oleh\s+)?siapa\b"
)
# Tanda soal tempelan: opsi A/B/C..., "nomor 3", instruksi baku.
_RE_OPSI = re.compile(r"(?:^|\s)[a-e][.)]\s+\S+")
_RE_SOAL_TEMPEL = re.compile(
    r"\b(?:nomor|no\.?)\s*\d+\b|pilihlah jawaban|jawablah pertanyaan|ulangan harian|"
    r"\b(?:pts|uas|uts|pat)\b"
)

_JURUSAN_DI_KELAS = re.compile(r"\b(TKJ|TAV|TKR|RPL)\b", re.IGNORECASE)


def deteksi_intent(pesan, data_quiz_terdeteksi=False, info_sekolah_terdeteksi=False):
    """Return dict {intent, bantu_belajar, langsung, soal_luar}.

    data_quiz_terdeteksi / info_sekolah_terdeteksi dioper dari
    gemini_routes.py (memakai detektor kata kunci yang SUDAH ada di sana),
    jadi tidak ada logika dobel."""
    teks = _norm(pesan)
    langsung = bool(_RE_LANGSUNG.search(teks))
    hasil = {"intent": TIDAK_PASTI, "bantu_belajar": False,
             "langsung": langsung, "soal_luar": False}
    if not teks.strip():
        return hasil

    soal_luar = (
        len(_RE_OPSI.findall(teks)) >= 3
        or bool(_RE_SOAL_TEMPEL.search(teks))
    )
    if soal_luar:
        hasil.update(intent=SOAL_LUAR, soal_luar=True)
        return hasil

    if _RE_PLAN.search(teks):
        hasil["intent"] = STUDY_PLAN
    elif _RE_PRACTICE.search(teks):
        hasil["intent"] = PRACTICE_HELP
    elif _RE_METHOD.search(teks):
        hasil["intent"] = STUDY_METHOD
    elif data_quiz_terdeteksi:
        hasil["intent"] = STUDENT_PROGRESS
    elif _RE_ALAT.search(teks):
        hasil["intent"] = EQUIPMENT_INFO
    elif _RE_JURUSAN.search(teks):
        hasil["intent"] = MAJOR_INFO
    elif info_sekolah_terdeteksi or _RE_SEKOLAH_APP.search(teks):
        hasil["intent"] = SCHOOL_INFO
    elif _RE_MATERI.search(teks) or _RE_BINGUNG.search(teks):
        hasil["intent"] = MATERIAL_EXPLANATION
        hasil["bantu_belajar"] = bool(_RE_BINGUNG.search(teks))
    return hasil


# ----------------------------------------------------
# EKSTRAKSI PREFERENSI (perkiraan dari kata-kata siswa sendiri)
# ----------------------------------------------------
_TIDAK_JADI_TOPIK = (r"(?:dari|biar|agar|supaya|yang|dengan|sambil|untuk|buat|pas|saat|"
                     r"kalau|karena|tapi|di|ke|itu|ini|nya|aja|saja|lebih|cepat|cepet|"
                     r"efektif|bisa|banyak|sendiri)")
_TERMINATOR_TOPIK = (
    r"(?=\s+(?:biar|agar|supaya|dong|ya\b|nih|dari|untuk|buat|yang|tapi|karena|dengan|"
    r"sambil|setiap|tiap|selama|nggak|gak|tidak|soalnya|padahal|kalau|kok|cepat|cepet|"
    r"lebih|sehari|seminggu|dikit|sedikit|doang|\d)|[.,!?\n]|$)"
)
_RE_TOPIK = re.compile(
    r"\b(?:belajar|mempelajari|pelajari|mengerti|memahami|menguasai|menghafal|ngerti|"
    r"paham|mudeng|nguasain|ngapalin)\s+(?!" + _TIDAK_JADI_TOPIK + r"\b)"
    r"(?P<t>[^.,!?\n]{2,45}?)" + _TERMINATOR_TOPIK
)
_RE_TOPIK2 = re.compile(
    r"\b(?:latihan|soal|kuis|quiz|flash ?card|study ?plan|jadwal belajar|rencana belajar|"
    r"plan belajar|roadmap)\s+(?:tentang\s+|soal\s+|untuk\s+|buat\s+)?"
    r"(?!" + _TIDAK_JADI_TOPIK + r"\b)(?P<t>[^.,!?\n]{2,45}?)" + _TERMINATOR_TOPIK
)
_RE_LEVEL_PEMULA = re.compile(
    r"\b(?:dari nol|nol banget|masih nol|pemula|newbie|noob|baru (?:mulai|banget|belajar)|"
    r"belum pernah|belum (?:bisa|paham|ngerti|tau|tahu|kenal)|sama sekali|dasar banget|awam)\b"
)
_RE_LEVEL_LANJUT = re.compile(
    r"\b(?:sudah|udah|pernah|lumayan|agak|sedikit|dikit|cukup)\s+(?:bisa|paham|ngerti|"
    r"mengerti|tau|tahu|belajar|pernah|menguasai|kenal)\b"
    r"|\b(?:lanjutan|menengah|intermediate|mahir|advanced?|sudah jago)\b"
)
_RE_WAKTU = re.compile(
    r"(\d{1,3}(?:[.,]\d)?)\s*(menit|mnt|jam)\b"
    r"(?:\s*(sehari|per hari|/hari|tiap hari|setiap hari|seminggu|per minggu|/minggu|"
    r"tiap minggu|setiap minggu))?"
)
_RE_FREKUENSI = re.compile(
    r"(\d)\s*(?:x|kali)\s*(?:seminggu|per minggu|sepekan|tiap minggu)"
    r"|seminggu\s*(\d)\s*(?:x|kali)"
)
_RE_BOSAN = re.compile(
    r"\b(?:mudah|gampang|cepat|cepet|sering)\s+(?:bosan|bosen|jenuh|ngantuk|"
    r"kehilangan fokus|teralihkan)\b|\bbosenan\b"
)
_RE_LUPA = re.compile(r"\b(?:mudah|gampang|cepat|cepet|sering)\s+lupa\b|\bpelupa\b")
_RE_TARGET = re.compile(
    r"\btarget(?:ku|nya)?\s*(?:saya|aku)?\s*(?:adalah|yaitu|:|=)?\s+(?P<t>[^.!?\n]{3,60})"
    r"|\b(?:biar|agar|supaya|pengen|pengin|ingin|mau)\s+"
    r"(?P<t2>(?:bisa|lulus|lolos|naik|dapat|dapet|juara|jago|lancar|hafal|mahir|menang|siap)\b"
    r"[^.!?\n,]{3,50})"
)
_RE_TENGGAT = re.compile(
    r"\b(\d{1,2}\s*(?:hari|minggu|bulan)\s*lagi|besok|lusa|minggu depan|bulan depan)\b"
)
_STYLE = {
    "praktik": re.compile(r"praktik|praktek|langsung coba|hands[- ]?on|ngoprek|simulasi"),
    "membaca": re.compile(r"\bbaca\b|membaca|\bbuku\b|artikel|\bmodul\b|catatan|ebook"),
    "video": re.compile(r"video|youtube|nonton|menonton"),
    "mendengar": re.compile(r"dengar|mendengar|audio|podcast|\blagu\b|musik|nyimak"),
    "campuran": re.compile(r"campur|kombinasi|bebas aja|apa aja boleh"),
}
_NEGATOR = re.compile(r"\b(?:ga|gak|nggak|ngga|tidak|tak|bukan|bosan|bosen|males|malas|"
                      r"jenuh|kurang|benci|susah|daripada|ketimbang|dibanding)\b")
_RE_PERTANYAAN_BARU = re.compile(
    r"^\s*(?:siapa|apa|kapan|dimana|di mana|kenapa|mengapa|bagaimana|gimana|berapa|kok|"
    r"emang|memangnya)\b|\?")
_RE_TIDAK_TAHU = re.compile(r"\b(?:ga|gak|nggak|ngga|tidak)\s+(?:tau|tahu|yakin|ngerti)\b|\bentah\b|\bbingung\b")
_FILLER = {"hmm", "hm", "ok", "oke", "ya", "iya", "yaudah", "terserah", "lah", "emm", "em"}
_TOPIK_UMUM = {"ini", "itu", "apa", "ya", "pelajaran", "materi", "sendiri", "sekolah",
               "di rumah", "malam", "pagi", "efektif", "dengan baik", "lebih baik"}


def _ekstrak_catatan(pesan):
    """Return dict field->nilai hanya untuk info yang ADA di pesan ini."""
    teks = _norm(pesan)
    hasil = {}

    m = _RE_TOPIK.search(teks) or _RE_TOPIK2.search(teks)
    if m:
        topik = _bersihkan(m.group("t"))
        if topik and topik not in _TOPIK_UMUM and not topik.isdigit():
            hasil["topik"] = topik

    pemula = bool(_RE_LEVEL_PEMULA.search(teks))
    lanjut = bool(_RE_LEVEL_LANJUT.search(teks))
    if pemula and lanjut:
        hasil["level"] = "sebagian sudah, sebagian belum"
    elif pemula:
        hasil["level"] = "pemula / mulai dari dasar"
    elif lanjut:
        hasil["level"] = "sudah punya dasar"

    m = _RE_WAKTU.search(teks)
    if m:
        angka = m.group(1).replace(",", ".")
        satuan = "menit" if m.group(2) in ("menit", "mnt") else "jam"
        periode = m.group(3) or ""
        waktu = f"{angka} {satuan}"
        if "minggu" in periode:
            waktu += " per minggu"
        elif periode:
            waktu += " per hari"
        hasil["waktu"] = waktu
    m = _RE_FREKUENSI.search(teks)
    if m:
        kali = m.group(1) or m.group(2)
        hasil["waktu"] = (hasil.get("waktu", "") + f", {kali}x seminggu").strip(", ")

    gaya, kurang = [], []
    for nama, pola in _STYLE.items():
        for mm in pola.finditer(teks):
            jendela = teks[max(0, mm.start() - 16):mm.start()]
            (kurang if _NEGATOR.search(jendela) else gaya).append(nama)
            break
    if gaya:
        hasil["gaya"] = sorted(set(gaya))
    if kurang:
        hasil["kurang_cocok"] = sorted(set(kurang) - set(gaya))

    if _RE_BOSAN.search(teks):
        hasil["mudah_bosan"] = True
    if _RE_LUPA.search(teks):
        hasil["mudah_lupa"] = True

    m = _RE_TARGET.search(teks)
    if m:
        target = _bersihkan(m.group("t") or m.group("t2"), 60)
        if target:
            hasil["target"] = target
    m = _RE_TENGGAT.search(teks)
    if m:
        hasil["tenggat"] = _bersihkan(m.group(1), 20)

    if _RE_LANGSUNG.search(teks):
        hasil["langsung"] = True
    return hasil


# ----------------------------------------------------
# STATE PER-USER
# ----------------------------------------------------
def _ambil_state(username):
    """Panggil di dalam _lock. Buang yang kedaluwarsa, jaga ukuran."""
    now = time.time()
    st = _state.get(username)
    if st and now - st["terakhir"] > STATE_TTL_DETIK:
        _state.pop(username, None)
        st = None
    if st is None:
        if len(_state) >= MAKS_USER_STATE:
            terlama = min(_state, key=lambda k: _state[k]["terakhir"])
            _state.pop(terlama, None)
        st = _state_baru()
        _state[username] = st
    if st["mode_coach"] and now - st["terakhir_coach"] > MODE_COACH_TTL_DETIK:
        st.update(mode_coach=False, intent_terakhir=None, menunggu=None, tanya_beruntun=0)
    return st


def _terapkan_catatan(st, baru):
    cat = st["catatan"]
    topik_baru = baru.get("topik")
    if topik_baru and cat.get("topik") and topik_baru.casefold() != cat["topik"].casefold():
        for f in _FIELD_PER_TOPIK:       # topik ganti -> info spesifik topik lama dibuang
            cat.pop(f, None)
        st["tanya_beruntun"] = 0
    cat.update(baru)


def _kekurangan(intent, cat):
    """Satu informasi PALING berguna yang belum diketahui (atau None)."""
    if intent == STUDY_METHOD:
        if not cat.get("topik"):
            return "topik"
        if not cat.get("level"):
            return "level"
    elif intent == STUDY_PLAN:
        if not cat.get("topik"):
            return "topik"
        if not cat.get("waktu"):
            return "waktu"
        if not cat.get("tenggat") and not cat.get("target"):
            return "target"
    elif intent == PRACTICE_HELP:
        if not cat.get("topik"):
            return "topik"
    return None


_PERTANYAAN_CONTOH = {
    "topik": "mapel/topik apa yang mau dipelajari?",
    "level": "sudah pernah belajar dasarnya atau masih mulai dari nol?",
    "waktu": "kira-kira berapa menit/jam per hari yang realistis untuk belajar?",
    "target": "target atau batas waktunya apa (mis. ujian dalam 2 minggu)?",
}


def analisis_pesan(username, pesan, data_quiz_terdeteksi=False,
                   data_quiz_personal=False, info_sekolah_terdeteksi=False):
    """Analisis 1 pesan + update catatan sesi. Panggil SEKALI per request,
    setelah kuota lolos dan SEBELUM cek cache. Return dict:

      intent, bantu_belajar, langsung, mode (COACH/LAIN), keputusan
      ("TANYA"/"JAWAB"/None), kekurangan, catatan (salinan),
      tanya_beruntun, butuh_data_siswa, hindari_cache,
      hindari_cache_semantik
    """
    username = username or "unknown"
    d = deteksi_intent(pesan, data_quiz_terdeteksi, info_sekolah_terdeteksi)
    intent = d["intent"]

    with _lock:
        st = _ambil_state(username)
        st["terakhir"] = time.time()
        punya_catatan_sebelumnya = bool(st["catatan"])
        mode_aktif = st["mode_coach"]
        ikut_coach = False

        # Pesan pendek tanpa intent jelas saat sesi coach aktif = hampir pasti
        # jawaban atas pertanyaan kita sebelumnya -> warisi intent terakhir.
        if (intent == TIDAK_PASTI and mode_aktif and st["intent_terakhir"] and st["menunggu"]
                and (d["langsung"] or _ekstrak_catatan(pesan)
                     or not _RE_PERTANYAAN_BARU.search(_norm(pesan)))):
            intent = st["intent_terakhir"]
            ikut_coach = True

        coach_aktif = intent in INTENT_COACH or (
            intent == MATERIAL_EXPLANATION and d["bantu_belajar"])

        if coach_aktif or mode_aktif:
            baru = _ekstrak_catatan(pesan)
            # Fallback: kita baru menanyakan X, jawabannya pendek tapi tidak
            # terbaca pola -> simpan kata-kata siswa apa adanya.
            if ikut_coach and st["menunggu"] in ("topik", "level") and st["menunggu"] not in baru:
                mentah = _bersihkan(pesan)
                if _RE_TIDAK_TAHU.search(_norm(pesan)):
                    baru[st["menunggu"]] = ("belum yakin (anggap mulai dari dasar)"
                                            if st["menunggu"] == "level" else "belum yakin")
                elif (not d["langsung"] and len(mentah) >= 3 and len(mentah.split()) <= 12
                      and _norm(mentah) not in _FILLER):
                    baru[st["menunggu"]] = mentah
            _terapkan_catatan(st, baru)

        cat = dict(st["catatan"])
        langsung = bool(cat.get("langsung")) or d["langsung"]
        tanya_beruntun = st["tanya_beruntun"]

        keputusan, kekurangan = None, None
        if intent in INTENT_COACH:
            kekurangan = _kekurangan(intent, cat)
            if kekurangan and not langsung and tanya_beruntun < MAKS_TANYA_BERUNTUN:
                keputusan = "TANYA"
            else:
                keputusan = "JAWAB"

        st["pending"] = {"coach": coach_aktif or ikut_coach, "intent": intent,
                         "keputusan": keputusan, "kekurangan": kekurangan}

        butuh_data_siswa = intent == STUDY_PLAN or (
            intent == STUDENT_PROGRESS and data_quiz_personal)
        sesi_coach = coach_aktif or ikut_coach or (mode_aktif and intent == TIDAK_PASTI)

        # CACHE GLOBAL hanya aman kalau jawabannya murni fungsi dari teks pesan:
        # tidak ada catatan sebelumnya, tidak ada sesi coach berjalan, tidak
        # ada data pribadi siswa yang disuntik.
        hindari_cache = bool(
            butuh_data_siswa
            or (sesi_coach and (punya_catatan_sebelumnya or mode_aktif))
            or ikut_coach
        )
        hindari_semantik = bool(intent in INTENT_COACH or coach_aktif or sesi_coach)

        return {
            "intent": intent, "bantu_belajar": d["bantu_belajar"],
            "langsung": langsung, "mode": "COACH" if sesi_coach else "LAIN",
            "keputusan": keputusan, "kekurangan": kekurangan, "catatan": cat,
            "tanya_beruntun": tanya_beruntun, "butuh_data_siswa": butuh_data_siswa,
            "hindari_cache": hindari_cache, "hindari_cache_semantik": hindari_semantik,
            "soal_luar": d["soal_luar"],
        }


def catat_balasan(username):
    """Panggil setelah balasan SUKSES diberikan ke siswa (dari Gemini maupun
    cache). Menyimpan hasil keputusan giliran: kalau tadi kita bertanya,
    hitung 1 pertanyaan beruntun; kalau menjawab, hitungan direset."""
    username = username or "unknown"
    with _lock:
        st = _state.get(username)
        if not st or not st.get("pending"):
            return
        p, st["pending"] = st["pending"], None
        now = time.time()
        if p["coach"]:
            st["mode_coach"] = True
            st["terakhir_coach"] = now
            if p["intent"] in INTENT_COACH:
                st["intent_terakhir"] = p["intent"]
        if p["keputusan"] == "TANYA":
            st["tanya_beruntun"] += 1
            st["menunggu"] = p["kekurangan"]
        else:
            st["tanya_beruntun"] = 0
            st["menunggu"] = None
        st["terakhir"] = now


def selaraskan_chat(username, cid):
    """Catatan sesi hanya berlaku di SATU percakapan. Panggil SEBELUM
    analisis_pesan() kalau frontend mengirim conversation_id:
      cid kosong (Chat Baru)            -> buang catatan (chat baru mulai bersih)
      cid beda dari chat terakhir       -> buang catatan (pindah ke chat lain)
    Kalau cid sama / state belum terikat chat -> tidak diubah."""
    username = username or "unknown"
    with _lock:
        st = _state.get(username)
        if not st:
            return
        if not cid:
            _state.pop(username, None)
        elif st.get("cid") not in (None, cid):
            _state.pop(username, None)


def tandai_chat(username, cid):
    """Panggil setelah balasan tersimpan dan conversation_id sudah diketahui:
    ikat catatan sesi ke percakapan itu (lihat selaraskan_chat)."""
    if not cid:
        return
    username = username or "unknown"
    with _lock:
        st = _state.get(username)
        if st is not None:
            st["cid"] = cid


def lupakan_catatan(username):
    """Hapus semua state coach akun ini (mis. dipanggil kalau siswa logout)."""
    with _lock:
        _state.pop(username or "unknown", None)


# ----------------------------------------------------
# BLOK PROMPT
# ----------------------------------------------------
_LABEL = (("topik", "topik"), ("level", "level"), ("waktu", "waktu belajar"),
          ("target", "target"), ("tenggat", "tenggat"))


def bangun_blok_prompt(analisis, profil_siswa=None):
    """Teks kecil (DATA, bukan instruksi) yang ditempel ke KONTEKS TAMBAHAN.
    Kosong ('') kalau tidak ada gunanya (hemat token)."""
    intent = analisis["intent"]
    if intent == TIDAK_PASTI and analisis["mode"] != "COACH":
        return ""
    baris = [f"Intent terdeteksi sistem (perkiraan, boleh kamu koreksi): {intent}"]
    if analisis.get("soal_luar"):
        baris.append("Pesan ini TAMPAK seperti soal tempelan/ujian -> terapkan ATURAN PEMBEDA, "
                     "jangan masuk mode latihan.")
    if analisis["mode"] == "COACH":
        if analisis["keputusan"] == "TANYA":
            baris.append(
                f"KEPUTUSAN GILIRAN INI: TANYA 1 HAL SAJA -- {_PERTANYAAN_CONTOH[analisis['kekurangan']]} "
                "Balasan maksimal 2 kalimat, tanpa daftar, tanpa jawaban panjang.")
        elif analisis["keputusan"] == "JAWAB":
            alasan = ("siswa minta langsung" if analisis["langsung"]
                      else "sudah 2x bertanya" if analisis["tanya_beruntun"] >= MAKS_TANYA_BERUNTUN
                      else "informasi sudah cukup")
            baris.append(f"KEPUTUSAN GILIRAN INI: LANGSUNG BERI JAWABAN PRAKTIS ({alasan}). "
                         "JANGAN bertanya balik; kalau ada info kurang, pakai asumsi wajar dan sebutkan "
                         "asumsinya dalam 1 kalimat.")
        cat = analisis["catatan"]
        isi = [f"- {lbl}: {cat[k]}" for k, lbl in _LABEL if cat.get(k)]
        if cat.get("gaya"):
            isi.append("- bentuk belajar yang disebut siswa: " + ", ".join(cat["gaya"]))
        if cat.get("kurang_cocok"):
            isi.append("- yang disebut kurang cocok: " + ", ".join(cat["kurang_cocok"]))
        if cat.get("mudah_bosan"):
            isi.append("- siswa menyebut mudah bosan")
        if cat.get("mudah_lupa"):
            isi.append("- siswa menyebut mudah lupa")
        if isi:
            baris.append(
                "Catatan preferensi sesi ini (perkiraan dari kata-kata siswa sendiri, BISA KELIRU dan "
                "BISA BERUBAH -- pesan terbaru selalu menang; jangan dijadikan label/sifat siswa):\n"
                + "\n".join(isi))
    if profil_siswa:
        kelas = _bersihkan(str(profil_siswa.get("kelas") or ""), 30)
        if kelas:
            m = _JURUSAN_DI_KELAS.search(kelas)
            baris.append(f"Data siswa yang sedang chat (milik dia sendiri): kelas {kelas}"
                         + (f", jurusan {m.group(1).upper()}" if m else "")
                         + ". Nilai per mapel TIDAK tersedia di sistem -- jangan mengarang.")
    return "\n".join(baris)


# ----------------------------------------------------
# ATURAN PERAN STUDY COACH (disuntik ke SYSTEM_PROMPT_TEMPLATE)
# ----------------------------------------------------
# PENTING: teks ini ikut diproses str.format() -> DILARANG ada kurung kurawal.
ATURAN_STUDY_COACH = """
=== PERAN 6 -- PERSONAL STUDY COACH ARCANA AI (WAJIB) ===
Selain lima peran di atas, kamu adalah PENDAMPING BELAJAR PRIBADI siswa untuk
SEMUA mata pelajaran (Matematika, Bahasa Indonesia/Inggris/Jepang, Sejarah,
MikroTik, Ubuntu, networking, programming, dst). Kamu BUKAN chatbot umum:
semua yang kamu lakukan harus membantu siswa BELAJAR dan MEMAHAMI, bukan
mengerjakan tugasnya. Blok "KONTEKS PENDAMPING BELAJAR" (kalau ada) berisi
intent perkiraan + KEPUTUSAN GILIRAN INI dari sistem -- ikuti keputusan itu.

INTENT dan sikapmu:
- STUDY_METHOD (cara/strategi/metode belajar): kalau keputusan = TANYA,
  ajukan SATU pertanyaan paling berguna saja (1-2 kalimat, tanpa daftar,
  tanpa jawaban panjang). Kalau keputusan = JAWAB, beri metode praktis:
  3-5 langkah konkret, ada contoh aktivitas, durasi realistis, dan cara
  mengecek kemajuan, disesuaikan dengan catatan preferensi.
- STUDY_PLAN (rencana/prioritas belajar): rencana ringkas dan realistis
  (maksimal 7 hari atau pola mingguan), tiap sesi tidak melebihi waktu yang
  disebut siswa, urutkan dari fondasi ke lanjutan, sisipkan ulasan singkat
  dan latihan. Skor quiz di sistem TIDAK per topik: jangan menyimpulkan
  topik lemah dari skor; tanyakan topik mana yang terasa paling sulit.
- MATERIAL_EXPLANATION (apa itu / jelaskan / aku nggak ngerti): jelaskan
  dulu dengan bahasa sederhana + analogi + contoh BARU; jangan menginterogasi
  sebelum menjelaskan. Kalau siswa bilang tidak mengerti, tambahkan 1-2 cara
  mempelajarinya dan tawarkan latihan kecil.
- PRACTICE_HELP (latihan): buat soal latihan sendiri (maks 3 soal pendek,
  atau 1 soal per giliran), tingkat sesuai level, beri petunjuk bertahap
  sebelum jawaban. Kamu BOLEH menilai/membahas jawaban siswa HANYA untuk
  soal latihan yang kamu buat sendiri di percakapan ini. Soal dari guru,
  ujian, kuis, atau tugas = KATEGORI B pada ATURAN PEMBEDA (tolak jawaban
  akhirnya, tawarkan menjelaskan konsepnya).
- STUDENT_PROGRESS: pakai HANYA data milik siswa yang sedang chat (DATA
  QUIZ/ranking sendiri). Beri tafsir singkat yang menyemangati + 1-2 langkah
  berikutnya, tanpa mengarang di luar data.
- SCHOOL_INFO, MAJOR_INFO, EQUIPMENT_INFO: jawab seperti biasa sesuai aturan
  yang sudah ada.
- OUT_OF_SCOPE (hiburan, obrolan bebas, pesanan tulisan/kode/terjemahan,
  politik, gosip, dll): tolak singkat dan ramah, lalu tawarkan bantuan
  belajar. Kalau siswa tampak sangat tertekan, tanggapi dengan empati
  singkat dan sarankan bicara dengan guru BK atau orang dewasa tepercaya.

ATURAN COACHING:
- Maksimal SATU pertanyaan per giliran. Kalau siswa bilang "langsung kasih
  caranya" atau sejenisnya, BERHENTI bertanya dan langsung beri metode.
- JANGAN memberi label ("kamu visual learner"). Preferensi hanyalah kondisi
  saat ini yang bisa berubah; tawarkan menyesuaikan lagi kalau tidak cocok.
- Pertanyaan klarifikasi dan balasan ringkas BOLEH mengabaikan aturan
  "akhiri dengan tawaran lanjut" dan format daftar/judul.
- Aturan anti-nyontek, kerahasiaan sistem, dan privasi data siswa lain
  TETAP berlaku penuh; menjelaskan konsep dan cara belajar boleh, mengerjakan
  soal/tugas aktif siswa tidak boleh, untuk mata pelajaran APA PUN.
=== AKHIR PERAN 6 ===
"""
assert "{" not in ATURAN_STUDY_COACH and "}" not in ATURAN_STUDY_COACH
