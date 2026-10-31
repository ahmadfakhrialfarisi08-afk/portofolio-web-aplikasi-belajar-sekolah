"""
stt_engine.py
--------------
Mesin Speech-to-Text (STT) LOKAL/OFFLINE untuk transkrip Voice Note tugas
guru (Voice-to-Text + Audio Player di sisi siswa).

KENAPA LOKAL, BUKAN API CLOUD (Google/Azure/dsb)?
Project ini di-hosting di PythonAnywhere (el0fakhri.pythonanywhere.com).
Hosting ini -- termasuk tier gratisnya -- membatasi akses internet KELUAR
cuma ke daftar domain yang di-whitelist. Kalau STT dipanggil ke API cloud,
fitur ini bisa tiba-tiba berhenti berfungsi kapan saja tergantung domain
API itu di-whitelist atau tidak, di luar kendali kode aplikasi ini sama
sekali. Supaya fitur TETAP JALAN tanpa bergantung pada koneksi luar,
dipakai model Whisper OFFLINE lewat library `faster-whisper` -- jalan
sepenuhnya di CPU server sendiri, tidak butuh internet sama sekali saat
proses transkripsi berlangsung (cuma butuh internet SEKALI di awal untuk
mengunduh file model, itu pun bisa diunduh manual & ditaruh di cache lokal
kalau outbound internet ke Hugging Face juga dibatasi).

INSTALASI (jalankan sekali di virtualenv project):
    pip install faster-whisper

Kalau library ini belum terinstall, atau model gagal dimuat (mis. RAM
hosting tidak cukup), SEMUA fungsi di sini FAIL SOFT -- balikin pesan
error yang jelas, TIDAK membuat crash seluruh aplikasi Flask. Voice Note
tugas tetap bisa dipakai (audio tetap tersimpan & bisa diputar siswa),
cuma transkripnya yang berstatus 'gagal' dengan pesan penjelasan (lihat
_proses_transkrip_vn_tugas() di app.py).
"""
import threading

_model_lock = threading.Lock()
_model = None
_model_gagal_dimuat = False
_model_pesan_error = None

# 'tiny' terbukti terlalu tidak akurat buat Bahasa Indonesia (transkrip jadi
# ngaco/halusinasi kata yang gak nyambung) -- naik ke 'base': masih ringan
# buat CPU tanpa GPU (~150MB model vs ~75MB 'tiny'), cukup buat pesan suara
# singkat guru (arahan/pengumuman kelas), tapi akurasinya jauh lebih baik.
# Kalau RAM/CPU server ternyata lega dan masih kurang akurat, boleh naik lagi
# ke 'small' (lebih lambat & modelnya lebih besar lagi, ~500MB).
UKURAN_MODEL = 'base'


def _muat_model():
    """Load model SEKALI saja (cache di variabel global _model), dipanggil
    lazy saat transkripsi pertama diminta -- supaya start Flask app tidak
    ikut lambat/berat kalau ternyata fitur ini belum pernah dipakai."""
    global _model, _model_gagal_dimuat, _model_pesan_error
    if _model is not None or _model_gagal_dimuat:
        return
    with _model_lock:
        if _model is not None or _model_gagal_dimuat:
            return
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            _model_gagal_dimuat = True
            _model_pesan_error = (
                "Library 'faster-whisper' belum terinstall di server "
                "(jalankan: pip install faster-whisper)."
            )
            return
        try:
            # compute_type='int8': jauh lebih hemat RAM & lebih cepat di
            # CPU dibanding float32 default, dengan penurunan akurasi yang
            # kecil -- cocok untuk hosting dengan resource terbatas.
            _model = WhisperModel(UKURAN_MODEL, device='cpu', compute_type='int8')
        except Exception as exc:
            _model_gagal_dimuat = True
            _model_pesan_error = f'Gagal memuat model STT: {exc}'


def transkrip_audio_file(path_file_audio):
    """Transkripsi satu file audio di disk (format apa pun yang didukung
    ffmpeg -- webm/ogg/mp4/mp3/wav, dst; faster-whisper sudah membawa
    binding ke ffmpeg lewat av/ctranslate2, tidak perlu convert manual di
    sini). Balikin tuple:

        (segments, error)

    - Sukses: segments = [{'start': float, 'end': float, 'text': str}, ...]
      diurutkan sesuai waktu, error = None. Kalau audio ternyata hening
      total, segments = [] TETAP dianggap sukses (bukan error) -- audio
      memang valid, cuma tidak ada ucapan yang terdeteksi.
    - Gagal: segments = [], error = pesan string alasan kegagalan (model
      tidak ada/gagal load, atau file audio tidak bisa diproses).
    """
    _muat_model()
    if _model is None:
        return [], (_model_pesan_error or 'Model STT tidak tersedia di server.')

    try:
        # vad_filter=True: Voice Activity Detection bawaan faster-whisper,
        # otomatis membuang bagian hening panjang sebelum ditranskripsi --
        # selaras dengan requirement "kurangi ... hening" di tahap
        # pembersihan audio, sekaligus membuat timestamp segmen lebih
        # rapi (tidak ada segmen kosong isi hening) & mempercepat proses.
        argumen_transcribe = dict(
            language='id',  # paksa Bahasa Indonesia -- pesan sekolah ini selalu berbahasa Indonesia, menghindari salah deteksi bahasa terutama untuk audio pendek
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            beam_size=5,  # cari lebih banyak kemungkinan kata sebelum memutuskan -- lebih akurat, sedikit lebih lambat (masih wajar untuk voice note singkat)
            condition_on_previous_text=False,  # cegah "halusinasi berantai": tanpa ini, sekali model salah tebak 1 kalimat, kesalahan itu ikut jadi konteks & menular ke kalimat berikutnya
            word_timestamps=True,  # WAJIB buat filter per-KATA (bukan cuma per-kalimat) di bawah -- lebih presisi, gak buang 1 kalimat penuh gara-gara 1-2 kata ngaco
        )
        try:
            # hallucination_silence_threshold: kalau ada jeda diam beneran (>2 detik)
            # tapi model tetap "ngoceh" ngeluarin teks di situ, itu ciri klasik
            # halusinasi Whisper (ngarang kalimat pas gak ada suara sama sekali) --
            # bagian itu langsung dibuang. Cuma ada di versi faster-whisper yang
            # lebih baru, jadi dicoba dulu & fallback diam-diam kalau belum didukung.
            segments_iter, _info = _model.transcribe(
                path_file_audio, hallucination_silence_threshold=2.0, **argumen_transcribe
            )
            segments_iter = list(segments_iter)  # tarik generator sekarang, biar TypeError versi lama ketauan di sini
        except TypeError:
            segments_iter, _info = _model.transcribe(path_file_audio, **argumen_transcribe)

        # --- Lapis 1: filter kepercayaan PER-SEGMEN (per-kalimat) ---------
        # Kalau audio noisy (musik/suara orang lain bercampur), Whisper TETAP
        # mengeluarkan teks walau sebenarnya cuma nebak asal (halusinasi).
        # faster-whisper menyertakan skor kepercayaan per-segmen -- kalau
        # skornya jelek BANGET (bukan cuma ragu-ragu di beberapa kata, tapi
        # satu kalimat penuh gak jelas), ganti semua teksnya jadi keterangan
        # jujur (timestamp TETAP dipertahankan biar sorotan teks tetap sinkron
        # audio). Ambang diperketat dari versi sebelumnya (lebih sensitif
        # nangkep kalimat meragukan, dgn konsekuensi kadang jadi kelewat
        # "curiga" -- tapi lebih aman drpd nampilin teks ngaco ke siswa).
        AMBANG_NO_SPEECH = 0.5           # makin dekat 1 = makin yakin bagian ini BUKAN ucapan (musik/noise murni)
        AMBANG_LOGPROB = -0.8            # makin negatif = model makin gak yakin sama tebakan katanya
        AMBANG_COMPRESSION_RATIO = 2.2   # rasio kompresi teks tinggi = biasanya tanda teks berulang-ulang/ngaco (halusinasi)

        # --- Lapis 2: filter kepercayaan PER-KATA ---------------------------
        # Buat kalimat yg lolos lapis 1 (gak separah itu), tetap cek tiap kata
        # satu-satu -- kata dgn skor kepercayaan rendah (khas kalau ketiban
        # noise/suara lain sekilas di tengah kalimat yg sebagian besar jelas)
        # diganti "[...]" alih-alih dibiarkan jadi kata ngaco yang menyesatkan.
        # Timestamp tiap kata (start/end) DISIMPAN (dulu dibuang setelah dipakai
        # nge-filter) -- dipakai sisi siswa buat highlight per-kata yang halus
        # DI DALAM kalimat aktif (kalimat tetap jadi patokan utama pindah blok
        # karena batasnya dari VAD/jeda hening beneran, jadi paling stabil;
        # kata cuma penegas visual, biar timestamp kata yg kadang meleset
        # dikit gak bikin seluruh baris ikut salah lompat).
        AMBANG_PROB_KATA = 0.4

        hasil = []
        for seg in segments_iter:
            teks = (seg.text or '').strip()
            if not teks:
                continue
            ragu_kalimat = (
                getattr(seg, 'no_speech_prob', 0) > AMBANG_NO_SPEECH
                or getattr(seg, 'avg_logprob', 0) < AMBANG_LOGPROB
                or getattr(seg, 'compression_ratio', 0) > AMBANG_COMPRESSION_RATIO
            )
            entri_kata = []
            if ragu_kalimat:
                teks_final = '(bagian ini kurang jelas -- ada noise/musik/suara lain bercampur)'
            else:
                kata_kata = getattr(seg, 'words', None) or []
                kata_sebelumnya_ragu = False
                for w in kata_kata:
                    kata = (getattr(w, 'word', '') or '').strip()
                    if not kata:
                        continue
                    mulai = round(float(getattr(w, 'start', seg.start)), 2)
                    selesai = round(float(getattr(w, 'end', seg.end)), 2)
                    if getattr(w, 'probability', 1.0) < AMBANG_PROB_KATA:
                        if kata_sebelumnya_ragu and entri_kata:
                            entri_kata[-1]['end'] = selesai  # gabung beberapa kata ragu beruntun jadi 1 placeholder, bukan "[...] [...] [...]"
                        else:
                            entri_kata.append({'start': mulai, 'end': selesai, 'text': '[...]'})
                        kata_sebelumnya_ragu = True
                    else:
                        entri_kata.append({'start': mulai, 'end': selesai, 'text': kata})
                        kata_sebelumnya_ragu = False
                teks_final = ' '.join(e['text'] for e in entri_kata) if entri_kata else teks
            entri = {
                'start': round(float(seg.start), 2),
                'end': round(float(seg.end), 2),
                'text': teks_final,
            }
            if entri_kata:  # cuma disertakan kalau ada -- hemat ukuran JSON utk segmen yg diblok penuh/tanpa word_timestamps
                entri['words'] = entri_kata
            hasil.append(entri)
        return hasil, None
    except Exception as exc:
        return [], f'Proses transkripsi gagal: {exc}'
