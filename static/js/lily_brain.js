/* LILY BRAIN -- otak maskot SCORUS AI (context-aware, bukan sekadar ganti gambar).
 * Pipeline: IDLE -> NOTICE_EVENT -> ANALYZE_CONTEXT -> SELECT_EXPRESSION -> SELECT_EYE_DIRECTION
 *           -> PLAY_BEHAVIOR -> SHOW_RESPONSE -> RETURN_TO_IDLE
 * Tanpa dependensi. Aset gambar dipetakan lewat `sprites` (lihat README). Aset yang belum ada
 * otomatis jatuh ke sprite terdekat, jadi bisa dipasang bertahap.
 *
 * v2 (upgrade incremental, kompatibel dengan v1):
 *  - 28 mood (13 lama + 15 baru) + micro-expression (eyes/mouth/head) per mood
 *  - state makro: IDLE ATTENTION NOTICE THINKING FOCUSED RESPONDING EMPATHETIC ENCOURAGING
 *    SUCCESS CELEBRATION RETURN_TO_IDLE (atribut data-state; state pipeline lama tetap ada)
 *  - transisi emosi bertahap (normal -> concerned -> sad), blink acak 4 jenis, saccade saat membaca
 *  - prioritas: critical > interaction > notification(penting) > ai > achievement > error > processing > observation > idle
 *  - API tetap {mood, attention, behavior, response}; field baru opsional: intensity (0.1-1)
 *
 * v3 (asset pipeline modular): opsi `rig` (lily_rig.js) menggantikan pergantian sprite full-character dengan
 *  layer face/eyes/mouth + kedip & gaze frame-by-frame + gesture badan. Otak (state, prioritas, BEHAVIORS) tidak berubah.
 *
 * v4 (kepekaan konteks / Needs Engine, tambahan murni -- pipeline lama tidak diubah):
 *  aktivitas + konteks -> pahami kebutuhan -> solusi tercepat -> ekspresi sesuai.
 *  - sense({type, ...}): pintu masuk sinyal konteks. Tipe: struggle, hesitate, lost, mistake, pending, teaching_soon.
 *  - sensor DOM lokal (tanpa AI, tanpa membaca isi kolom): klik berulang, kolom diam lama, pencarian diulang,
 *    validasi form gagal (event 'invalid'), koneksi putus, error beruntun.
 *  - gerbang sibuk: guru sedang mengetik/bekerja cepat/focusMode -> tawaran ditunda (maks 60 dtk), lalu dilepas saat tenang.
 *  - bantuan ditawarkan, tidak dipaksa: "Mau aku bantu?" + tombol; diabaikan -> jeda berikutnya makin panjang.
 *  - OpenAI/Gemini HANYA setelah guru menekan "Ya" dan hanya bila sinyal membawa fakta nyata (reason:true).
 *
 * v5 (lifecycle interaksi foto profil -- tambahan; pipeline, cooldown, dedup, sensor, local-first tidak diganti):
 *  - photoFlow(stage, data): open -> selected -> preview -> saving -> success | cancel | error. Tiap tahap = event + perilaku
 *    sendiri (mikro-ekspresi, gerak mata, miring kepala). Tahap yang datang terlalu cepat DIGABUNG (yang terbaru menang
 *    setelah tahap sebelumnya sempat terlihat), bukan dibuang oleh dedup/cooldown.
 *  - watchPhotoUI({input, trigger, preview, save, form, cancel, avatar}): sensor DOM opsional, HANYA selector yang diberikan
 *    (tidak menebak elemen). Tahap yang tidak bisa dideteksi DOM dikirim UI: document.dispatchEvent(new CustomEvent('lily:photo',{detail:{stage:'success'}})).
 *  - Antrean emit() kini menyimpan definisi event + dilewatkan dedup/cooldown saat diputar ulang (sebelumnya event antre
 *    kena dedup sendiri / event dinamis hilang). Event satu alur boleh menggantikan event alur yang sama tanpa menunggu expressionMinHold.
 *  - Ekspresi bertahan selama bubble masih tampil (linger), lalu kembali ke idle bertahap (settle), bukan langsung 'normal'.
 *  - Lily tidak macet: lookPhoto / think punya batas aman; ai_start yang antre dibuang bila jawabannya sudah datang.
 *
 * v6 (konteks guru MEMBERI TUGAS -- tambahan; pipeline emit/antre/cooldown/dedup/prioritas/sibuk/foto tidak diganti):
 *  - noteTaskGiven({kelas, jenis:'tugas'}) / document 'lily:task': satu tugas baru dicatat LOKAL (kelas, waktu, sibuk atau tidak,
 *    baru bicara atau tidak). Tugas yang datang berurutan (jeda <= taskGap) dihitung SATU aktivitas (klaster), bukan event terpisah.
 *  - Jumlah hanya menentukan TINGKAT PERHATIAN, bukan menilai guru. Tidak ada kalimat yang menyalahkan / mengasihani siswa.
 *  - Reaksi lewat emit('task_given') dengan prioritas 'task_ctx' (5.2): kalah dari jadwal mengajar, error, notifikasi, jawaban AI,
 *    foto, dan 'think'; menang atas observasi/idle. Tidak pernah diantre (tak ada reaksi basi): bila Lily sedang sibuk, dilewati.
 *  - Maks SATU komentar per klaster + jeda komentar taskCommentCd; guru sibuk (mengetik, kolom form aktif, mode fokus) -> hanya
 *    mikro-ekspresi, komentar ditahan maks taskHoldMs lalu dibuang. Tanpa API/AI sama sekali.
 *
 * v7 (kepekaan halus -- tambahan; sense()/emit()/prioritas/cooldown/dedup/sibuk/foto/tugas tidak diganti):
 *  Perhatikan -> pahami konteks -> bantu bila perlu -> beri ruang. Lily hanya menyimpulkan KEBUTUHAN dari aktivitas di aplikasi, bukan emosi guru.
 *  - kategori sense(): ERROR, STUCK (=hesitate), REPEAT, SEARCHING (=lost), CONFUSION, dan success. Tipe lama tetap jalan.
 *  - tingkat respons: diam | mikro-ekspresi (level:1, tanpa teks, tidak pernah ditunda/diantre) | tawaran singkat | solusi langsung | bantu penuh (guru bertanya).
 *  - teks + ekspresi + intensitas dari satu sumber: perilaku sense* menaruh langkah 'peak' dan 'say' di langkah yang sama; coherentMood()
 *    mengoreksi pertentangan jelas (mis. "Tenang, aku bantu" dengan wajah kaget). surprised/sad tidak dipakai di jalur ini; concerned hanya untuk kegagalan nyata.
 *  - guru menolak ("Nanti" atau mengetik "nanti/belum/tidak usah"): ditahan snoozeMs, dibalas calm SEKALI, jeda tawaran berikutnya memanjang.
 *  - REPEAT hanya bicara bila ada pintasan NYATA (sig.shortcut / opts.shortcutFor); tanpa itu diam, karena mengulang itu wajar.
 *  - CONFUSION dari jejak menu (hash tujuan di sessionStorage, tanpa isi halaman); berpindah menu sambil membaca/mengetik tidak dihitung.
 *
 * v8 (perbaikan reaksi ganti foto profil -- pipeline emit/antre/cooldown/dedup/prioritas tidak diganti):
 *  - Setiap foto baru SELALU menghasilkan reaksi + kalimat. Cooldown/riwayat foto hanya memilih kalimat yang tidak berulang, tidak lagi membuat Lily diam.
 *    Satu-satunya yang dilewati: pemicu GANDA UI untuk foto yang sama dalam <3 dtk (reaksinya sudah berjalan).
 *  - Foto baru menggantikan reaksi foto sebelumnya yang masih menunggu (bukan saling timpa); photoFlow('success') tidak lagi dibuang guard 4 dtk.
 *  - Mood & animasi bervariasi per kategori dan tidak sama dua kali berturut-turut.
 *  - Mood foto = fungsi KONTEKS (kategori/pool kalimat/data terukur), bukan acak; bertahan sampai akhir reaksi (tidak dipaksa 'warm'); unknown = curious/attentive; maskot = photoMascot (excited/happy).
 *  - Foto yang adalah gambar maskot Lily sendiri dikenali (petunjuk UI/nama file, atau kemiripan piksel dengan sprite Lily) -> respons khusus.
 */
(function (global) {
  'use strict';
 
  /* Folder tempat lily_brain.js berada (mis. /static/js/): dipakai memuat analyzer foto secara malas. */
  var SCRIPT_BASE = (function () {
    try { var cs = document.currentScript; if (cs && cs.src) return cs.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, ''); } catch (e) {}
    return '/static/js/';
  })();
 
  var LEGACY_MOODS = ['normal','happy','excited','thinking','confused','worried','surprised','sad',
                      'sleepy','wink','encouraging','celebrating','love'];
  var CORE_MOODS = ['calm','warm','curious','attentive','focused','uncertain','concerned','reassuring','proud',
                    'relieved','grateful','empathetic','playful','amazed','apologetic'];
  var MOODS = LEGACY_MOODS.concat(CORE_MOODS);
  /* Mood tanpa sprite sendiri jatuh ke sprite terdekat (rantai maks 4 lompatan), jadi aset bisa dipasang bertahap. */
  var FALLBACK_MOOD = { love: 'happy', encouraging: 'happy', celebrating: 'excited',
                        thinking: 'normal', confused: 'surprised', excited: 'happy', happy: 'normal',
                        worried: 'sad', sad: 'worried', wink: 'happy', sleepy: 'normal', surprised: 'normal',
                        calm: 'normal', warm: 'happy', curious: 'normal', attentive: 'normal', focused: 'normal',
                        uncertain: 'confused', concerned: 'worried', reassuring: 'happy', proud: 'happy',
                        relieved: 'happy', grateful: 'love', empathetic: 'worried', playful: 'wink',
                        amazed: 'surprised', apologetic: 'sad' };
  /* Angka lebih kecil = prioritas lebih tinggi. */
  var PRI = { critical: 1, interaction: 2,
              /* konteks guru (lily_teacher.js): sisipan di tabel yang sama, urutan = spesifikasi. Mesin pembanding tidak berubah. */
              sched_late_notask: 2.1, sched_ongoing: 2.2, sched_5: 2.3, sched_10: 2.4, grading: 2.45,
              notification: 2.5, ai: 2.8, achievement: 3, need_fix: 3.5, error: 4,
              task_ctx: 5.2,                       /* v6: reaksi guru memberi tugas -- di bawah jadwal/error/AI/foto/think, di atas observasi */
              need_offer: 5.5, need_remind: 5.8,
              processing: 5, observation: 6, idle: 7 };
  var DIRS = { user: [0, 0], left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], focus: [0, 0.25],
               slight_left: [-0.5, 0], slight_right: [0.5, 0], slight_up: [0, -0.5], slight_down: [0, 0.5] };
 
  /* Pose kepala: [miring (deg), skala (condong maju/mundur), geser-y (px)]. Semua halus. */
  var HEAD = { neutral: [0, 1, 0], tilt_l: [-3, 1, 0], tilt_r: [3, 1, 0], lean: [0, 1.025, 1],
               back: [0, 0.982, -1.5], down: [0, 1, 1.5] };
  /* Micro-expression per mood. eyes/mouth = label (atribut data-eyes/data-mouth untuk CSS, overlay, atau aset kelak). */
  var PROFILE = {
    normal:      { eyes: 'neutral',   mouth: 'slight_smile',   head: 'neutral' },
    calm:        { eyes: 'relaxed',   mouth: 'slight_smile',   head: 'neutral', breath: 4.8 },
    warm:        { eyes: 'soft',      mouth: 'warm_smile',     head: 'tilt_r' },
    curious:     { eyes: 'curious',   mouth: 'small_surprise', head: 'tilt_r' },
    attentive:   { eyes: 'attentive', mouth: 'slight_smile',   head: 'lean' },
    focused:     { eyes: 'focused',   mouth: 'neutral',        head: 'lean' },
    thinking:    { eyes: 'focused',   mouth: 'thinking',       head: 'tilt_l' },
    uncertain:   { eyes: 'neutral',   mouth: 'thinking',       head: 'tilt_l' },
    confused:    { eyes: 'wide',      mouth: 'thinking',       head: 'tilt_l' },
    worried:     { eyes: 'soft',      mouth: 'concerned',      head: 'tilt_l' },
    concerned:   { eyes: 'soft',      mouth: 'concerned',      head: 'tilt_l', breath: 5 },
    reassuring:  { eyes: 'soft',      mouth: 'warm_smile',     head: 'tilt_r' },
    proud:       { eyes: 'relaxed',   mouth: 'warm_smile',     head: 'back' },
    happy:       { eyes: 'relaxed',   mouth: 'happy_smile',    head: 'neutral' },
    excited:     { eyes: 'wide',      mouth: 'open_smile',     head: 'lean' },
    relieved:    { eyes: 'relaxed',   mouth: 'slight_smile',   head: 'back', breath: 5.6 },
    grateful:    { eyes: 'soft',      mouth: 'warm_smile',     head: 'tilt_r' },
    empathetic:  { eyes: 'soft',      mouth: 'concerned',      head: 'tilt_l', breath: 5 },
    encouraging: { eyes: 'attentive', mouth: 'happy_smile',    head: 'tilt_r' },
    playful:     { eyes: 'curious',   mouth: 'slight_smile',   head: 'tilt_r' },
    surprised:   { eyes: 'wide',      mouth: 'small_surprise', head: 'back' },
    amazed:      { eyes: 'wide',      mouth: 'open_smile',     head: 'back' },
    apologetic:  { eyes: 'soft',      mouth: 'apologetic',     head: 'down' },
    sad:         { eyes: 'soft',      mouth: 'concerned',      head: 'down' },
    sleepy:      { eyes: 'sleepy',    mouth: 'neutral',        head: 'down' },
    wink:        { eyes: 'neutral',   mouth: 'happy_smile',    head: 'tilt_r' },
    celebrating: { eyes: 'wide',      mouth: 'open_smile',     head: 'lean' },
    love:        { eyes: 'soft',      mouth: 'warm_smile',     head: 'tilt_r' }
  };
  /* Mood dengan mata sudah tertutup/melengkung di sprite: kedip dilewati agar tidak terlihat aneh. */
  var NO_BLINK = { excited: 1, celebrating: 1, wink: 1, love: 1, grateful: 1, sleepy: 1, playful: 1 };
  var NEG = { sad: 1, apologetic: 1 };
  var SOFT_NEG = { concerned: 1, worried: 1, empathetic: 1, apologetic: 1, sad: 1 };
  var HIGH = { excited: 1, celebrating: 1, amazed: 1 };
  var THINKY = { thinking: 1, uncertain: 1, confused: 1, concerned: 1, worried: 1 };
  var STRESS = { worried: 1, concerned: 1, empathetic: 1 };
  /* v7 -- koherensi teks <-> ekspresi. Dipanggil di _analyze (mood dari sinyal/AI) dan di langkah bicara (_step).
   * Hanya mengoreksi pertentangan yang jelas; selain itu mood tidak disentuh. */
  var CALM_RE     = /\b(tenang|tidak apa|tak apa|wajar|pelan-pelan|pelan pelan|aku bantu|lily bantu|kubantu|mau aku bantu|perlu bantuan|bisa bantu|kita (coba|cek|perbaiki|bereskan))\b/i;
  var REASSURE_RE = /(tenang|tidak apa|tak apa|wajar|pelan-pelan|pelan pelan)/i;
  var SORRY_RE    = /\b(maaf|aduh|waduh|kendala|gagal|terputus)\b/i;
  var GOOD_RE     = /\b(selamat|berhasil|beres|mantap|hore|lancar|tersambung)\b/i;
  var NEGW_RE     = /\b(belum|tidak|tak|gagal|kendala|maaf|error|salah|gak|nggak)\b/i;
  var AROUSAL     = { surprised: 1, amazed: 1, excited: 1, celebrating: 1, playful: 1, wink: 1 };
  function coherentMood(text, mood) {
    if (!text || !mood) return mood;
    var s = String(text), neg = NEGW_RE.test(s);
    if (CALM_RE.test(s) && (AROUSAL[mood] || mood === 'sad')) return mood === 'sad' ? 'concerned' : (REASSURE_RE.test(s) ? 'reassuring' : 'attentive');
    if (SORRY_RE.test(s) && (AROUSAL[mood] || mood === 'happy')) return /\bmaaf\b/i.test(s) ? 'apologetic' : 'concerned';
    if (GOOD_RE.test(s) && !neg && SOFT_NEG[mood]) return 'happy';
    return mood;
  }
  /* Penolakan singkat sesudah tawaran ("nanti", "belum", "tidak usah dulu"). Kalimat lain ("tidak bisa login") BUKAN penolakan. */
  var DECLINE_RE = /^(nanti|belum|tidak|tak|gak|ga|nggak|enggak|engga|ndak|skip|no|cukup)( (usah|perlu|dulu|aja|saja|deh|ya|kok|sekarang|butuh|dibantu|bantuan|bantu|makasih|terima|kasih|lily|ly|nanti))*$/;
 
  /* behavior -> state makro (atribut data-state) */
  var BEH_STATE = { greet: 'ATTENTION', notice: 'NOTICE', focusTask: 'FOCUSED', think: 'THINKING', read: 'FOCUSED',
                    taskDone: 'SUCCESS', relieved: 'SUCCESS', celebrate: 'CELEBRATION', worried: 'EMPATHETIC',
                    apologize: 'EMPATHETIC', reassure: 'EMPATHETIC', empathize: 'EMPATHETIC', encourage: 'ENCOURAGING',
                    observe: 'ATTENTION', attend: 'ATTENTION', clarify: 'ATTENTION', nudge: 'ATTENTION', wake: 'ATTENTION',
                    wink: 'RESPONDING', thanks: 'RESPONDING', photoNotice: 'NOTICE', lookPhoto: 'NOTICE', photoReact: 'NOTICE', photoQuiet: 'NOTICE', sleepy: 'IDLE', idle: 'IDLE',
                    photoQuietB: 'NOTICE', photoQuietC: 'NOTICE', photoOpen: 'ATTENTION', photoSelected: 'NOTICE', photoPreview: 'ATTENTION',
                    photoSaving: 'FOCUSED', photoDone: 'SUCCESS', photoMascot: 'SUCCESS', photoCancel: 'ATTENTION', photoError: 'EMPATHETIC',
                    offer: 'ATTENTION', guide: 'RESPONDING', remind: 'ATTENTION',
                    taskGlance: 'ATTENTION', taskNod: 'ATTENTION', taskCurious: 'ATTENTION',
                    taskSaySoft: 'RESPONDING', taskSayMulti: 'RESPONDING', taskSayBurst: 'RESPONDING',
                    microAttentive: 'ATTENTION', microCurious: 'ATTENTION', microConcerned: 'ATTENTION', senseOffer: 'ATTENTION',
                    senseFix: 'FOCUSED', senseGood: 'SUCCESS', senseCalm: 'ATTENTION' };
  /* v8 (pose): 6 ekspresi pencarian/penjelasan dari lily_poses.js. Murni tambahan: tanpa lily_poses.js / gambar, semuanya no-op.
   * menemukan_jawaban = jawaban AI yang BENAR-BENAR sukses; curious = data/jawaban tidak ditemukan; lost = permintaan gagal / jawaban pengganti lokal
   * (gagal/tidak ketemu tidak pernah memakai menemukan_jawaban). Set false untuk mematikan. */
  /* v9 (tempo): askMs = Lily "menerima" pertanyaan (confused ringan) sebelum membaca; readMinMs = minimal pose membaca terlihat sebelum
   * hasil boleh tampil (hanya menahan bila jawaban datang LEBIH CEPAT; AI lambat -> tetap membaca tanpa batas atas selain batas aman think);
   * *Ms = lama pose hasil bertahan sebelum crossfade kembali ke sprite (lihat --lily-pose-fade di lily_poses.js). Semua titik awal, bisa disetel. */
  var POSE_FLOW = { menemukan_jawaban: true, menemukan_jawabanMs: 2000, curious: true, curiousMs: 2000, lost: true, lostMs: 2000,
                    askMs: 1000, readMinMs: 1700 };
  var BEH_ALIAS = { support: 'encourage', thank: 'thanks' };   // nilai behavior dari API -> behavior frontend
  var GESTURE_ANIM = { wave: 'tilt', nod: 'nod', thinking: 'tilt', encouraging: 'nodsmall', celebrate: 'bounce', greeting: 'nod' };
  /* Kembali ke idle bertahap: mood kuat -> mood lebih tenang (maks 2 langkah) -> normal. Mood negatif lembut ditangani _via(). */
  var SETTLE = { surprised: 'curious', amazed: 'warm', excited: 'happy', celebrating: 'proud', curious: 'attentive', attentive: 'calm',
                 focused: 'attentive', thinking: 'attentive', happy: 'warm', proud: 'warm', warm: 'calm', relieved: 'calm', grateful: 'warm',
                 love: 'warm', playful: 'warm', wink: 'happy', encouraging: 'warm', reassuring: 'warm', uncertain: 'attentive', confused: 'attentive' };
  /* Cermin kiri-kanan untuk perilaku satu alur: gerak yang sama tidak selalu ke arah yang sama. */
  var MIRROR = { tilt_r: 'tilt_l', tilt_l: 'tilt_r', left: 'right', right: 'left', slight_left: 'slight_right', slight_right: 'slight_left' };
  var ukurMood = function (u) { return u ? (u.terang === 'cerah' ? 'happy' : u.terang === 'redup' ? 'calm' : (u.nuansa === 'hangat' ? 'warm' : 'curious')) : undefined; };
 
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var now = function () { return Date.now(); };
 
  /* ---------- Router lokal (tanpa Gemini): intent berbasis aturan + bank kalimat acak ----------
   * Urutan reactToText: normalisasi -> intent lokal -> API_EXHAUSTED? -> cache sesi -> backend (1x, tanpa retry). */
  var LOCAL_INTENTS = [
    { id: 'greeting', mood: 'warm', behavior: 'observe',
      re: /^\s*(h+a+l+o+|h+a+i+|h+e+y+|hi|selamat\s+(pagi|siang|sore|malam)|pagi|siang|sore|malam|assalamu'?alaikum)(\s+(lily|ly|kak|bu|pak))*\s*[!.?]*\s*$/i,
      lines: ['Halo! \u{1F44B}', 'Hai! Lily di sini \u{1F604}', 'Halo, Pak/Bu! Ada yang bisa Lily bantu?', 'Hai hai! Lily siap membantu.'] },
    { id: 'thanks', mood: 'grateful', behavior: 'thank',
      re: /^\s*(terima\s*kasih|makasih|thanks?|thank\s+you|thx|trims)(\s+(banyak|ya+|lily|ly|kak))*\s*[!.]*\s*$/i,
      lines: ['Sama-sama! \u{1F60A}', 'Siap, Pak/Bu. Senang bisa membantu!', 'Sama-sama! Kabari Lily kalau butuh lagi ya.', 'Dengan senang hati!'] }
  ];
  var EXHAUSTED_TEXT = 'Waduh, Lily belum bisa menjawab dulu nih. Token AI-nya sedang habis. Silakan hubungi Kepala Sekolah untuk menambahkan token agar Lily bisa digunakan kembali.';
  var EXHAUST_CODES = { api_exhausted: 1, quota_exhausted: 1, billing_exhausted: 1, resource_exhausted: 1, api_key_invalid: 1, permission_denied: 1 };
  var EXHAUST_TTL = 10 * 60 * 1000;      // setelah ini 1 request boleh "mengintip" lagi ke server (cek status)
  var API_STATE = { exhaustedAt: 0, text: '' };    // global per halaman; sumber kebenaran tetap di server
  var CACHE_TTL = 10 * 60 * 1000, CACHE_MAX = 40;
  var normText = function (t) { return String(t == null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var apiExhausted = function () { return API_STATE.exhaustedAt && (now() - API_STATE.exhaustedAt) < EXHAUST_TTL; };
  /* d = body JSON (atau null), status = HTTP status. 429 biasa (rate limit) BUKAN habis; hanya kode eksplisit / 402. */
  var isExhausted = function (d, status) {
    if (status === 402) return true;
    if (!d || typeof d !== 'object') return false;
    var c = String(d.message_type || d.error_code || d.code || d.error || '').toLowerCase();
    return d.api_status === 'exhausted' || d.api_exhausted === true || !!EXHAUST_CODES[c];
  };
  var localIntent = function (norm) {
    if (!norm || norm.length > 40) return null;          // pesan panjang = pertanyaan sungguhan, bukan sapaan
    for (var i = 0; i < LOCAL_INTENTS.length; i++) if (LOCAL_INTENTS[i].re.test(norm)) return LOCAL_INTENTS[i];
    return null;
  };
 
  /* ---------- kalimat lokal (dipakai saat tidak memanggil AI) ---------- */
  var LINES = {
    greetPagi:  ['Selamat pagi, Pak/Bu! \u{1F44B} Senang ketemu lagi.', 'Pagi, Pak/Bu! Kalau ada yang mau disiapkan hari ini, Lily temani.'],
    greetSiang: ['Selamat siang, Pak/Bu! \u{1F44B} Lily di sini kalau ada yang bisa dibantu.', 'Siang, Pak/Bu! Semoga kelasnya menyenangkan hari ini.'],
    greetSore:  ['Selamat sore, Pak/Bu! \u{1F44B} Kalau ada yang mau dirapikan, Lily bantu.', 'Sore, Pak/Bu! Mau lanjut apa dulu hari ini?'],
    greetMalam: ['Selamat malam, Pak/Bu! \u{1F44B} Lily di sini kalau ada yang perlu dibantu.'],
    taskDone:   ['Satu tugas selesai. Pelan-pelan tapi pasti, Pak/Bu.', 'Satu beres. Lily ikut lega.', 'Terima kasih sudah menuntaskannya, Pak/Bu.', 'Selesai satu. Silakan tarik napas sebentar.'],
    streak:     ['Wah, produktif sekali hari ini! Terima kasih sudah bekerja keras.'],
    pending:    ['Tugasnya lumayan banyak ya. Kita selesaikan satu per satu, yuk.',
                 'Ada beberapa yang belum selesai. Mau mulai dari yang paling dekat deadline?'],
    error:      ['Aduh, ada kendala. Coba ulangi sebentar lagi ya, Pak/Bu.', 'Maaf, ini tidak berjalan mulus. Tenang, kita coba lagi.'],
    achieve:    ['Selamat, Pak/Bu! Pencapaian yang membanggakan!'],
    allDone:    ['Semua tugas selesai! Waktunya tarik napas dulu \u{1F389}'],
    idleNudge:  ['Masih di sana, Pak/Bu? Kalau perlu bantuan, panggil saya ya.'],
    notice:     [],   // notifikasi biasa cukup ditandai lewat tatapan & ekspresi; Lily bicara hanya bila ada teks konkret (event guru/AI)
    thinkingDone: [],
    thanks:     ['Terima kasih, Pak/Bu. Senang bisa membantu.', 'Sama-sama, Pak/Bu. Senang bisa bantu.'],
    photoNew:   ['Eh, foto profilnya ganti ya, Pak/Bu? Tampilannya jadi segar!', 'Wah, foto barunya sudah terpasang, Pak/Bu. Keren!', 'Ooh, foto profil baru! Cocok sekali, Pak/Bu.',
                 'Foto barunya sudah tampil di profil, Pak/Bu. Rapi sekali!', 'Ada wajah baru di pojok layar nih. Bagus, Pak/Bu!', 'Fotonya diganti ya, Pak/Bu? Lily langsung sadar lho.'],
    photoFirst: ['Foto profil pertama Pak/Bu sudah terpasang! Sekarang dashboardnya terasa lebih personal.', 'Akhirnya ada foto di profil, Pak/Bu. Senang melihatnya!', 'Wah, profilnya tidak polos lagi. Bagus, Pak/Bu!'],
    photoAgain: ['Ganti lagi nih, Pak/Bu? Cari yang paling pas ya. \u{1F604}', 'Yang ini juga bagus kok, Pak/Bu. Tapi pilih yang paling nyaman ya.', 'Eh, ganti lagi? Lily sampai ikut menoleh lagi nih.'],
    photoDoneSay: [],   // kalimat sukses hanya dari teks nyata (hasil analisis foto); tanpa teks -> hanya mikro-ekspresi
    photoErrorSay: ['Fotonya belum berhasil disimpan, Pak/Bu. Coba lagi sebentar ya.', 'Ada kendala saat menyimpan foto. Tenang, bisa dicoba lagi.'],
    clarify:    ['Hmm, Lily belum menangkap maksudnya. Boleh diperjelas sedikit, Pak/Bu?'],
    mistake:    ['Tidak apa-apa, Pak/Bu. Kita perbaiki pelan-pelan.', 'Wajar kok, Pak/Bu. Coba kita cek lagi bagian itu.'],
    empathize:  ['Pelan-pelan saja, Pak/Bu. Kita bereskan satu per satu.'],
    relievedAfterStress: ['Akhirnya satu selesai. Lily ikut senang, Pak/Bu.'],
    offer:      ['Mau aku bantu?', 'Perlu bantuan, Pak/Bu?', 'Ada yang bisa Lily bantu?'],   // cadangan bila sinyal tidak membawa teks sendiri
    /* v7: bahasa tentang KEJADIAN di aplikasi, bukan tentang perasaan guru */
    offerFail:  ['Kayaknya belum berhasil. Mau aku bantu?', 'Sepertinya belum berjalan lancar. Mau aku bantu?'],
    offerError: ['Kayaknya belum berhasil. Mau aku bantu cek?', 'Sudah beberapa kali ada kendala. Mau aku bantu cek?'],
    offerGoal:  ['Lagi mau ke mana, Pak/Bu? Kalau mau, aku bantu cari jalurnya.', 'Mau ke bagian mana? Aku bisa bantu cari jalurnya.'],
    declined:   ['Oke \u{1F60A} Aku di sini kalau nanti dibutuhkan.', 'Siap, Pak/Bu. Kabari saja kalau perlu ya \u{1F60A}', 'Oke, silakan lanjut. Aku di sini kalau dibutuhkan.'],
    good:       ['Nah, sudah berhasil \u{1F60A}', 'Mantap, sudah lancar.', 'Sip, beres.', 'Berhasil! Lanjut ya, Pak/Bu.']
  };
 
  /* Kesan lokal dari DATA TERUKUR foto (dihitung browser dari piksel): dipakai bila AI tidak tersedia. {w} = nama warna dominan. */
  var FOTO_UKUR = {
    warna:  ['Warna {w}-nya enak dilihat, Lily jadi senang, Pak/Bu!', 'Fotonya bernuansa {w}. Lily suka suasananya, Pak/Bu.',
             'Wah, {w} sekali. Lily langsung penasaran ceritanya, Pak/Bu!', 'Nuansa {w}-nya bikin profil Pak/Bu terasa hidup. Lily kagum!',
             'Lily suka warna {w} di foto ini, Pak/Bu. Segar dilihat.'],
    cerah:  ['Fotonya cerah sekali, Pak/Bu. Lily ikut semangat!', 'Terang dan lega dilihat. Lily senang, Pak/Bu!'],
    sedang: ['Pencahayaannya pas, Pak/Bu. Lily suka, enak dipandang.', 'Fotonya seimbang dan nyaman dilihat. Lily senang, Pak/Bu.'],
    redup:  ['Fotonya kalem dan teduh, Pak/Bu. Lily jadi ikut tenang.', 'Suasananya tenang dengan cahaya yang redup. Lily suka, Pak/Bu.'],
    netral: ['Fotonya sederhana dan rapi, Pak/Bu. Lily suka.', 'Tampilan barunya bersih dan tenang. Lily senang, Pak/Bu.']
  };
 
  /* ---------- reaksi foto profil: kalimat natural per kategori (0-2 emoji, pendek, tanpa istilah teknis) ----------
   * Aturan isi: tidak memuji fisik, tidak menebak hubungan antarorang, tidak menyebut lokasi/objek yang tidak diketahui detector. */
  var PHOTO_LINES = {
    pertama: ['Akhirnya profilnya punya foto. Dashboard-nya jadi terasa lebih personal.', 'Foto pertama sudah terpasang. Lily senang melihatnya.',
              'Sekarang profilnya tidak polos lagi, Pak/Bu.', 'Terasa lebih hidup ya, dengan foto di profil.', 'Foto profil pertama. Pilihan yang rapi.'],
    baru:    ['Fotonya diganti ya? Lily langsung menyadarinya.', 'Tampilan barunya enak dilihat.', 'Suasananya jadi beda. Lily suka.',
              'Ada yang berubah di pojok layar. Terlihat segar.', 'Foto baru, suasana baru.', 'Pilihan yang pas untuk hari ini.'],
    gantiLagi: ['Masih mencari yang paling pas ya? Tidak apa-apa, pelan-pelan saja.', 'Ganti lagi nih. Lily ikut menoleh.',
                'Semuanya kelihatan baik, pilih yang paling nyaman.', 'Sedang mencoba-coba ya? Seru juga.', 'Yang ini juga bagus, Pak/Bu.'],
    satu:    ['Fotonya rapi dan nyaman dilihat.', 'Pilihan foto yang pas untuk dashboard.', 'Komposisinya enak, Lily suka.',
              'Fotonya terasa tenang dan hangat.', 'Cocok dipasang di profil.'],
    dua:     ['Kali ini tidak sendirian ya. Suasananya hangat.', 'Fotonya terasa akrab. Lily ikut tersenyum.',
              'Foto berdua, kelihatannya menyenangkan.', 'Ada teman di foto ini. Lily suka suasananya.'],
    banyak:  ['Wah, ramai sekali. Kelihatannya menyenangkan.', 'Fotonya penuh suasana. Lily sampai bingung mau lihat yang mana dulu.',
              'Kebersamaannya terasa di foto ini.', 'Satu foto, banyak cerita ya, Pak/Bu.'],
    alam:    ['Pemandangannya teduh. Mata ikut istirahat.', 'Suasananya menenangkan, Lily jadi ikut tenang.',
              'Dashboard-nya terasa lebih lega dengan foto ini.', 'Indah sekali. Lily suka suasana seperti ini.', 'Segar dilihat, Pak/Bu.'],
    objek:   ['Bukan foto wajah kali ini. Unik juga.', 'Pilihan yang tidak biasa. Lily penasaran ceritanya.',
              'Profilnya jadi lebih misterius \u{1F440}', 'Kreatif ya pilihannya.', 'Beda dari yang biasa, tapi Lily suka.'],
    unknown: ['Ada yang berubah di profil. Lily perhatikan lho.', 'Suasana barunya terasa beda.', 'Tampilan baru. Lily suka perubahannya.',
              'Hmm, menarik. Ada yang baru di pojok layar.'],
    balik:   ['Kembali ke foto yang ini ya.', 'Foto ini lagi. Lily mengenalinya.', 'Rupanya yang ini memang paling cocok.',
              'Balik ke versi lama. Ada nostalgianya sedikit.', 'Yang ini terasa pas sekali.'],
    langganan: ['Sepertinya ini foto andalan, Pak/Bu.', 'Foto yang ini sudah seperti ciri khas dashboard.', 'Setia sekali dengan foto ini. Lily suka konsistensinya.',
                'Memang yang ini yang paling sering muncul.'],
    booster: ['Pelan-pelan saja hari ini, Pak/Bu. Lily temani.', 'Jangan lupa minum dulu sebelum lanjut bekerja.', 'Semoga harinya lancar ya, Pak/Bu.',
              'Satu per satu saja, nanti juga selesai.', 'Kalau lelah, istirahat sebentar tidak apa-apa.'],
    sama:    ['Masih foto yang sama ya, Pak/Bu. Lily tetap suka.', 'Dipasang lagi yang ini? Lily sudah hafal fotonya.',
              'Fotonya tidak berubah, tapi tetap enak dilihat.', 'Oh, tetap pakai yang ini. Konsisten ya, Pak/Bu.'],
    maskot:  ['Eh, itu Lily! Dipasang jadi foto profil, Pak/Bu? Lily jadi malu \u{1F633}', 'Wah, Lily jadi foto profil! Terima kasih ya, Pak/Bu. Lily terharu.',
              'Itu Lily ya? Lily kaget lihat diri sendiri di pojok layar \u{1F604}', 'Ada Lily di profil! Rasanya aneh dan senang sekaligus.',
              'Foto profilnya Lily nih. Pilihan yang imut, Pak/Bu!', 'Lily lihat Lily. Lucu sekali rasanya \u{1F60A}']
  };
  /* Mood foto ditentukan KONTEKS, bukan acak. Tiap daftar berurutan: paling cocok dulu; _photoMood memutar daftar ini
   * (tidak sama dua kali berturut-turut) setelah menyaring mood yang bertentangan dengan kalimat (coherentMood).
   *  - POOL_MOOD : kalimat dari riwayat foto (pool yang dipakai _photoLine) -> mood yang sesuai nada kalimat itu.
   *  - CAT_MOOD  : kalimat umum/kategori -> mood sesuai isi foto. 'unknown' = penasaran/memperhatikan (BUKAN datar).
   *  - MASKOT_MOOD: mood per kalimat maskot (index sama dengan PHOTO_LINES.maskot): excited/happy/grateful. */
  var CAT_MOOD = { satu: ['warm', 'happy', 'proud'], dua: ['happy', 'warm', 'curious'],
                   banyak: ['amazed', 'excited', 'happy'], alam: ['calm', 'amazed', 'happy'], objek: ['curious', 'playful', 'attentive'],
                   maskot: ['excited', 'happy', 'grateful'], unknown: ['curious', 'attentive'] };
  var POOL_MOOD = { pertama: ['happy', 'proud', 'warm'], sama: ['warm', 'playful', 'calm'], balik: ['playful', 'warm', 'curious'],
                    langganan: ['proud', 'warm', 'happy'], gantiLagi: ['playful', 'curious', 'warm'] };
  var MASKOT_MOOD = ['excited', 'grateful', 'excited', 'excited', 'happy', 'happy'];
 
  /* Ubah hasil analyzer lokal -> kategori Lily. Tidak bergantung pada nama persis: dicocokkan lewat kata kunci,
   * keyakinan rendah / tak dikenal -> 'unknown' (Lily tidak memaksa menebak). */
  function kategoriLily(res) {
    if (!res) return 'unknown';
    var c = res.confidence != null ? res.confidence : res.keyakinan;
    if (typeof c === 'number' && c < 0.35) return 'unknown';
    var k = String(res.kategori || res.category || '').toLowerCase();
    if (!k) return 'unknown';
    if (/(no[_ -]?face|none|tanpa|tidak|bukan|objek|object|benda|logo|ilustrasi|illustration|kartun|cartoon|other|lainnya)/.test(k)) return 'objek';
    if (/(grup|group|banyak|ramai|rame|crowd|kelompok|multi|many)/.test(k)) return 'banyak';
    if (/(dua|two|berdua|pair|couple|duo)/.test(k)) return 'dua';
    if (/(pemandangan|scenery|landscape|alam|nature|outdoor|langit|sky)/.test(k)) return 'alam';
    if (/(satu|one|single|solo|selfie|portrait|potret|wajah|face|person|orang)/.test(k)) return 'satu';
    return 'unknown';
  }
 
  /* Fingerprint ringan dari data-URL kecil (FNV-1a 2x). Hanya hash yang disimpan, BUKAN foto. */
  function fnv(str, seed) { var h = seed >>> 0; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function fingerprintOf(img) {
    if (typeof img !== 'string' || !img) return null;
    return 'p' + fnv(img, 2166136261).toString(36) + fnv(img, 374761393).toString(36) + img.length.toString(36);
  }
  var PHOTO_KEY = 'lily_photo_hist_v1', PHOTO_MAX = 30;
 
  /* ---- Pengenalan maskot: apakah foto yang dipilih = gambar Lily sendiri? Murni lokal (canvas), tanpa AI/server.
   * Dua sinyal, keduanya tidak peduli latar: (1) histogram warna (hue) hanya dari piksel berwarna jenuh -> latar putih/abu/transparan tidak ikut;
   * (2) dHash 9x8 (sprite ditempel di warna latar foto; dicoba stretch/cover/contain agar tahan crop). Ambang bisa dilihat lewat debug (lily._log). ---- */
  function hueHist(d, skip) {                           // skip = [r,g,b] latar rata foto: pikselnya tidak ikut (latar pastel berwarna tidak merusak kemiripan)
    var h = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], tot = 0, i;
    for (i = 0; i + 3 < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
      if (skip && Math.abs(r - skip[0]) + Math.abs(g - skip[1]) + Math.abs(b - skip[2]) < 70) continue;
      if (!mx || dl / mx < 0.25 || mx < 51) continue;
      var hue = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
      h[Math.min(11, Math.floor(((hue * 60 + 360) % 360) / 30))] += dl / mx; tot += dl / mx;
    }
    if (tot < 3) return null;                           // hampir tak ada piksel berwarna: tak bisa dibandingkan
    var n = h.map(function (x) { return x / tot; });
    return n.map(function (x, k) { return 0.25 * n[(k + 11) % 12] + 0.5 * x + 0.25 * n[(k + 1) % 12]; });   // haluskan: hue di batas bin tidak membuat beda
  }
  function histSim(a, b) { var s = 0; for (var i = 0; i < 12; i++) s += Math.min(a[i], b[i]); return s; }
  function dBits(d) {                                   // d = RGBA 9x8 -> 64 bit
    var g = [], bits = [], i, x, y;
    for (i = 0; i + 3 < d.length; i += 4) g.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    for (y = 0; y < 8; y++) for (x = 0; x < 8; x++) bits.push(g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0);
    return bits;
  }
  function hamming(a, b) { var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }
  function mascotMatch(dist, sim) { return (dist <= 10 && sim >= 0.5) || (dist <= 18 && sim >= 0.8); }
  function drawTo(els, w, h, mode, bg) {                // gabungkan satu/lebih <img> (layer rig) ke canvas w x h; null bila gagal
    try {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d', { willReadFrequently: true });
      if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
      for (var i = 0; i < els.length; i++) {
        var iw = els[i].naturalWidth || els[i].width, ih = els[i].naturalHeight || els[i].height;
        if (!iw || !ih) return null;
        if (mode === 'stretch') x.drawImage(els[i], 0, 0, w, h);
        else { var k = mode === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih); x.drawImage(els[i], (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k); }
      }
      return x.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }                        // canvas tercemar (lintas origin) = anggap tidak cocok
  }
  function borderStat(d, n) {                           // warna rata-rata tepi + apakah tepinya rata (latar polos) -> {rgb, flat}
    var px = [], i, r = 0, g = 0, b = 0, dev = 0;
    for (i = 0; i < n; i++) [[i, 0], [i, n - 1], [0, i], [n - 1, i]].forEach(function (p) { var o = (p[1] * n + p[0]) * 4; px.push([d[o], d[o + 1], d[o + 2]]); });
    px.forEach(function (q) { r += q[0]; g += q[1]; b += q[2]; });
    r /= px.length; g /= px.length; b /= px.length;
    px.forEach(function (q) { dev += Math.abs(q[0] - r) + Math.abs(q[1] - g) + Math.abs(q[2] - b); });
    return { rgb: [r, g, b], flat: dev / px.length < 24 };
  }
  function borderBg(d, n) {
    var r = 0, g = 0, b = 0, c = 0;
    for (var i = 0; i < n; i++) [[i, 0], [i, n - 1], [0, i], [n - 1, i]].forEach(function (p) { var o = (p[1] * n + p[0]) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; c++; });
    return 'rgb(' + Math.round(r / c) + ',' + Math.round(g / c) + ',' + Math.round(b / c) + ')';
  }
  function loadImg(src) {
    return new Promise(function (ok, fail) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { fail(new Error('img')); }; im.src = src; });
  }
 
  /* ---------- definisi event -> perilaku ---------- */
  /* t = ms sejak mulai. Step: {mood, eye, anim, say, head, eyes, mouth, gesture, saccade, peak}.
   * eye: nama arah (user/left/right/up/down/focus/slight_*) atau 'target'.
   * peak: langkah yang boleh diganti mood dari AI; tanpa peak -> semua langkah t>0 (perilaku v1). */
  var BEHAVIORS = {
    greet:     [{ t: 0, mood: 'warm', eye: 'user', eyes: 'soft' },
                { t: 350, mood: 'happy', anim: 'nod', gesture: 'greeting', say: 'greet', peak: 1 }, { t: 3800, end: 1 }],
    notice:    [{ t: 0, mood: 'surprised', eye: 'target', eyeWide: 1 },
                { t: 900, mood: 'curious', eye: 'target', head: 'tilt_r' },
                { t: 1900, mood: 'warm', eye: 'user', say: 'notice' }, { t: 3200, end: 1 }],
    focusTask: [{ t: 0, mood: 'focused', eye: 'target', focus: 1 },
                { t: 2600, mood: 'attentive', eye: 'user' }, { t: 3000, end: 1 }],
    /* pose: selama AI memproses = membaca/mencari informasi, ditahan sampai jawaban benar-benar datang (tidak berganti-ganti). */
    think:     [{ t: 0, mood: 'curious', eye: 'user', head: 'tilt_r', pose: 'confused' },   // v9: pertanyaan diterima (penasaran/bingung ringan)
                { t: POSE_FLOW.askMs, mood: 'thinking', eye: 'slight_up', focus: 1, head: 'tilt_l', pose: 'searching' },
                { t: POSE_FLOW.askMs + 1500, mood: 'thinking', eye: 'focus', focus: 1 },
                { t: POSE_FLOW.askMs + 3200, mood: 'thinking', eye: 'slight_up', head: 'tilt_l' },
                { t: 30000, end: 1 }],   // normalnya dihentikan ai_done / jawaban; 'end' = batas aman agar tidak macet
    taskDone:  [{ t: 0, mood: 'surprised', eye: 'target', eyeWide: 1 },
                { t: 450, mood: 'happy', eye: 'user', anim: 'hop' },
                { t: 1000, mood: 'proud', head: 'lean', say: 'taskDone', peak: 1 }, { t: 3800, end: 1 }],
    celebrate: [{ t: 0, mood: 'surprised', eye: 'user', eyeWide: 1 },
                { t: 450, mood: 'excited', anim: 'hop' },
                { t: 1100, mood: 'celebrating', anim: 'bounce', gesture: 'celebrate', say: 'achieve', peak: 1 },
                { t: 4500, mood: 'proud', head: 'lean' }, { t: 5200, end: 1 }],
    worried:   [{ t: 0, mood: 'attentive', eye: 'target' },
                { t: 700, mood: 'concerned', eye: 'target', head: 'tilt_l', peak: 1 },
                { t: 1800, mood: 'encouraging', eye: 'user', say: 'pending' }, { t: 4800, end: 1 }],
    encourage: [{ t: 0, mood: 'attentive', eye: 'user', head: 'tilt_r' },
                { t: 500, mood: 'concerned', eye: 'user', peak: 1 },
                { t: 1700, mood: 'encouraging', eye: 'user', anim: 'nodsmall', gesture: 'encouraging', say: 'pending' },
                { t: 4200, end: 1 }],
    apologize: [{ t: 0, mood: 'attentive', eye: 'target' },
                { t: 600, mood: 'concerned', eye: 'down', anim: 'sink', peak: 1 },
                { t: 1500, mood: 'reassuring', eye: 'user', say: 'error' }, { t: 5000, end: 1 }],
    reassure:  [{ t: 0, mood: 'attentive', eye: 'user' },
                { t: 500, mood: 'concerned', eye: 'user', head: 'tilt_l' },
                { t: 1300, mood: 'reassuring', eye: 'user', head: 'tilt_r', say: 'mistake', peak: 1 }, { t: 4600, end: 1 }],
    empathize: [{ t: 0, mood: 'attentive', eye: 'user' },
                { t: 600, mood: 'empathetic', eye: 'user', head: 'tilt_l', peak: 1 },
                { t: 1800, mood: 'reassuring', eye: 'user', say: 'empathize' }, { t: 4400, end: 1 }],
    thanks:    [{ t: 0, mood: 'surprised', eye: 'user', eyeWide: 1 },
                { t: 450, mood: 'warm', eye: 'user', eyes: 'soft', head: 'tilt_r' },
                { t: 1000, mood: 'grateful', eye: 'user', say: 'thanks', peak: 1 }, { t: 3800, end: 1 }],
    clarify:   [{ t: 0, mood: 'curious', eye: 'user', head: 'tilt_r' },
                { t: 700, mood: 'confused', eye: 'user', head: 'tilt_l', peak: 1, pose: 'confused' },
                { t: 1700, mood: 'attentive', eye: 'user', say: 'clarify' }, { t: 4200, end: 1 }],
    relieved:  [{ t: 0, mood: 'concerned', eye: 'user' },
                { t: 600, mood: 'relieved', eye: 'user', anim: 'sigh', peak: 1 },
                { t: 1500, mood: 'happy', eye: 'user', say: 'relievedAfterStress' }, { t: 4200, end: 1 }],
    /* foto baru: penasaran -> takjub (lewat 'surprised' singkat dari _via) sambil menatap avatar baru -> hangat */
    photoNotice: [{ t: 0, mood: 'curious', eye: 'target', eyeWide: 1, head: 'tilt_r' },
                { t: 1100, mood: 'amazed', eye: 'target', head: 'tilt_r', say: 'photoNew', peak: 1 },
                { t: 3800, mood: 'warm', eye: 'user', head: 'tilt_r', peak: 1 }, { t: 5400, end: 1 }],   // ekor ikut mood konteks (tanpa override tetap 'warm')
    /* foto = maskot Lily sendiri: kaget sebentar -> excited/happy (mood dari konteks) sambil loncat kecil -> tetap ceria */
    photoMascot: [{ t: 0, mood: 'surprised', eye: 'target', eyeWide: 1, head: 'back' },
                  { t: 450, mood: 'excited', eye: 'target', anim: 'hop', say: 'photoNew', peak: 1 },
                  { t: 2400, mood: 'happy', eye: 'user', head: 'tilt_r', anim: 'nodsmall', peak: 1 }, { t: 5600, end: 1 }],
    /* foto lama/berulang atau konteks kurang: hanya mikro-ekspresi (tanpa dialog), 3 varian agar tidak monoton */
    photoQuiet:  [{ t: 0, mood: 'curious', eye: 'target', head: 'tilt_r' },
                  { t: 900, mood: 'attentive', eye: 'slight_right', head: 'lean' },
                  { t: 1900, mood: 'warm', eye: 'target', head: 'tilt_r', anim: 'nodsmall' },
                  { t: 3200, mood: 'warm', eye: 'user', head: 'neutral' }, { t: 4400, end: 1 }],
    photoQuietB: [{ t: 0, mood: 'attentive', eye: 'target', head: 'lean' },
                  { t: 1000, mood: 'curious', eye: 'slight_up', head: 'tilt_l' },
                  { t: 2100, mood: 'warm', eye: 'target', head: 'tilt_r' },
                  { t: 3400, mood: 'calm', eye: 'user' }, { t: 4400, end: 1 }],
    photoQuietC: [{ t: 0, mood: 'curious', eye: 'target', head: 'tilt_l', anim: 'tilt' },
                  { t: 1100, mood: 'attentive', eye: 'target', head: 'lean' },
                  { t: 2200, mood: 'happy', eye: 'user', head: 'tilt_r', anim: 'nodsmall' },
                  { t: 3600, mood: 'warm', eye: 'user' }, { t: 4600, end: 1 }],
    /* foto sedang "dilihat" (tanpa info lifecycle & isi belum diketahui): penasaran -> melirik -> miring kepala -> memperhatikan.
     * Bukan 'kaget': Lily belum tahu isinya. 'end' = batas aman bila hasil tidak pernah datang. */
    lookPhoto: [{ t: 0, mood: 'curious', eye: 'target', head: 'tilt_r' },
                { t: 900, mood: 'curious', eye: 'slight_right', head: 'tilt_l' },
                { t: 1700, mood: 'attentive', eye: 'target', focus: 1, head: 'lean' },
                { t: 9000, end: 1 }],
    /* ---- LIFECYCLE foto profil (photoFlow). Tidak ada dialog kecuali teks nyata dari hasil analisis / pesan UI. ---- */
    photoOpen: [{ t: 0, mood: 'attentive', eye: 'target', eyes: 'attentive', head: 'lean' },
                { t: 900, mood: 'curious', eye: 'slight_down', head: 'tilt_r' },
                { t: 3400, mood: 'attentive', eye: 'slight_up', head: 'tilt_l' },
                { t: 6200, mood: 'curious', eye: 'target', head: 'tilt_r' },
                { t: 9500, mood: 'attentive', eye: 'user', head: 'lean' },
                { t: 24000, end: 1 }],
    photoSelected: [{ t: 0, mood: 'curious', eye: 'target', eyes: 'curious', head: 'tilt_r', anim: 'tilt' },
                    { t: 800, mood: 'curious', eye: 'slight_right', head: 'tilt_l' },
                    { t: 1600, mood: 'attentive', eye: 'target', head: 'tilt_r' },
                    { t: 3800, mood: 'attentive', eye: 'slight_down', head: 'lean' },
                    { t: 30000, end: 1 }],
    photoPreview: [{ t: 0, mood: 'attentive', eye: 'target', eyes: 'attentive', head: 'lean' },
                   { t: 2200, mood: 'attentive', eye: 'slight_down', head: 'lean', saccade: 1 },
                   { t: 5200, mood: 'attentive', eye: 'target', head: 'tilt_r' },
                   { t: 30000, end: 1 }],
    photoSaving: [{ t: 0, mood: 'focused', eye: 'target', focus: 1, head: 'lean' },
                  { t: 1800, mood: 'focused', eye: 'focus', focus: 1 },
                  { t: 4200, mood: 'focused', eye: 'slight_up', focus: 1, head: 'lean' },
                  { t: 25000, end: 1 }],
    /* sukses: lega -> senang (kalimat hanya bila plan.text ada) -> hangat */
    photoDone: [{ t: 0, mood: 'relieved', eye: 'target', anim: 'sigh' },
                { t: 800, mood: 'happy', eye: 'target', head: 'tilt_r', say: 'photoDoneSay', peak: 1 },
                { t: 2600, mood: 'warm', eye: 'user', head: 'tilt_r', anim: 'nodsmall', peak: 1 },   // peak: mood hasil analisis foto bertahan (dulu dipaksa 'warm' untuk semua foto)
                { t: 4200, end: 1 }],
    photoCancel: [{ t: 0, mood: 'attentive', eye: 'user' },
                  { t: 800, mood: 'calm', eye: 'user', head: 'neutral' },
                  { t: 2400, end: 1 }],
    photoError: [{ t: 0, mood: 'attentive', eye: 'target' },
                 { t: 600, mood: 'concerned', eye: 'target', head: 'tilt_l', anim: 'sink', peak: 1 },
                 { t: 1700, mood: 'reassuring', eye: 'user', head: 'tilt_r', say: 'photoErrorSay' },
                 { t: 4800, end: 1 }],
    photoReact: [{ t: 0, mood: 'curious', eye: 'target', head: 'tilt_r' },
                 { t: 450, mood: 'warm', eye: 'target', say: 'photoNew', peak: 1 },
                 { t: 3800, mood: 'warm', eye: 'user', head: 'tilt_r', peak: 1 }, { t: 7000, end: 1 }],
    /* v4: menawarkan bantuan (tenang, tidak terkejut), memberi arahan solusi, mengingatkan pelan */
    offer:     [{ t: 0, mood: 'attentive', eye: 'target', eyes: 'attentive' },
                { t: 700, mood: 'curious', eye: 'user', head: 'tilt_r', peak: 1 },
                { t: 1500, mood: 'warm', eye: 'user', say: 'offer' }, { t: 12000, end: 1 }],
    guide:     [{ t: 0, mood: 'attentive', eye: 'target', focus: 1 },
                { t: 600, mood: 'reassuring', eye: 'target', head: 'tilt_r', say: 'offer', peak: 1 },
                { t: 3200, mood: 'attentive', eye: 'user' }, { t: 7000, end: 1 }],
    remind:    [{ t: 0, mood: 'attentive', eye: 'target' },
                { t: 600, mood: 'attentive', eye: 'user', head: 'tilt_r', peak: 1 },
                { t: 1400, mood: 'warm', eye: 'user', say: 'offer' }, { t: 6000, end: 1 }],
    attend:    [{ t: 0, mood: 'attentive', eye: 'user', eyes: 'attentive', head: 'lean' }, { t: 2600, end: 1 }],
    read:      [{ t: 0, mood: 'focused', eye: 'target', focus: 1 },
                { t: 900, mood: 'focused', eye: 'slight_down', focus: 1, saccade: 1 },
                { t: 3000, mood: 'attentive', eye: 'user' }, { t: 3500, end: 1 }],
    observe:   [{ t: 0, mood: 'attentive', eye: 'target' }, { t: 600, mood: 'calm', eye: 'user', peak: 1 }, { t: 2800, end: 1 }],
    sleepy:    [{ t: 0, mood: 'sleepy', eye: 'down', anim: 'sink' }],  // bertahan sampai ada aktivitas
    wake:      [{ t: 0, mood: 'surprised', eye: 'user', eyeWide: 1 }, { t: 600, mood: 'calm', anim: 'nod' }, { t: 1400, end: 1 }],
    nudge:     [{ t: 0, mood: 'attentive', eye: 'user', anim: 'tilt', say: 'idleNudge' }, { t: 3500, end: 1 }],
    wink:      [{ t: 0, mood: 'wink', eye: 'user', peak: 1 }, { t: 1400, end: 1 }],
    /* v6: reaksi memberi tugas. Mood sengaja hangat/ingin tahu; TANPA surprised/worried/sad/concerned (tidak menghakimi). */
    taskGlance:  [{ t: 0, mood: 'attentive', eye: 'slight_right' },
                  { t: 700, mood: 'calm', eye: 'user', anim: 'nodsmall' }, { t: 1700, end: 1 }],
    taskNod:     [{ t: 0, mood: 'attentive', eye: 'user', head: 'tilt_r' },
                  { t: 700, mood: 'warm', eye: 'user', anim: 'nodsmall' }, { t: 2000, end: 1 }],
    taskCurious: [{ t: 0, mood: 'curious', eye: 'slight_up', head: 'tilt_r' },
                  { t: 900, mood: 'warm', eye: 'user', head: 'tilt_r', anim: 'nodsmall' },
                  { t: 2400, mood: 'calm', eye: 'user', head: 'neutral' }, { t: 3200, end: 1 }],
    taskSaySoft: [{ t: 0, mood: 'curious', eye: 'slight_right', head: 'tilt_r' },
                  { t: 800, mood: 'warm', eye: 'user', head: 'tilt_r', anim: 'nodsmall', say: 'taskSay', peak: 1 },
                  { t: 3200, mood: 'warm', eye: 'user', head: 'neutral' }, { t: 4200, end: 1 }],
    taskSayMulti: [{ t: 0, mood: 'curious', eye: 'slight_left', head: 'tilt_l' },
                  { t: 800, mood: 'attentive', eye: 'slight_right', head: 'lean' },
                  { t: 1700, mood: 'proud', eye: 'user', head: 'tilt_r', anim: 'nodsmall', say: 'taskSay', peak: 1 },
                  { t: 3800, mood: 'warm', eye: 'user', head: 'neutral' }, { t: 4800, end: 1 }],
    taskSayBurst: [{ t: 0, mood: 'attentive', eye: 'slight_right' },
                  { t: 700, mood: 'curious', eye: 'user', head: 'tilt_l', anim: 'tilt' },
                  { t: 1500, mood: 'playful', eye: 'user', head: 'tilt_r', say: 'taskSay', peak: 1 },
                  { t: 3600, mood: 'warm', eye: 'user', head: 'neutral' }, { t: 4600, end: 1 }],
    /* v7: respons kepekaan. Langkah 'peak' = langkah 'say': wajah dan kalimat berubah bersamaan, dan moodnya satu sumber dengan teksnya.
     * Tidak ada surprised/sad. Mikro-ekspresi tidak punya 'say' (tanpa teks). */
    microAttentive: [{ t: 0, mood: 'attentive', eye: 'target', head: 'lean' },
                     { t: 1500, mood: 'calm', eye: 'user' }, { t: 2200, end: 1 }],
    microCurious:   [{ t: 0, mood: 'attentive', eye: 'target' },
                     { t: 600, mood: 'curious', eye: 'target', head: 'tilt_r' },
                     { t: 1900, mood: 'calm', eye: 'user' }, { t: 2600, end: 1 }],
    microConcerned: [{ t: 0, mood: 'attentive', eye: 'target' },
                     { t: 600, mood: 'concerned', eye: 'target', head: 'tilt_l' },
                     { t: 1800, mood: 'calm', eye: 'user' }, { t: 2600, end: 1 }],
    senseOffer: [{ t: 0, mood: 'attentive', eye: 'target', eyes: 'attentive' },
                 { t: 600, mood: 'concerned', eye: 'user', head: 'tilt_r', say: 'offer', peak: 1 }, { t: 12000, end: 1 }],
    senseFix:   [{ t: 0, mood: 'attentive', eye: 'target', focus: 1 },
                 { t: 500, mood: 'focused', eye: 'target', focus: 1, head: 'lean', say: 'offer', peak: 1 },
                 { t: 3500, mood: 'attentive', eye: 'user' }, { t: 7000, end: 1 }],
    senseGood:  [{ t: 0, mood: 'happy', eye: 'user', head: 'tilt_r', anim: 'nodsmall', say: 'good', peak: 1 },
                 { t: 2600, mood: 'warm', eye: 'user' }, { t: 3600, end: 1 }],
    senseCalm:  [{ t: 0, mood: 'calm', eye: 'user', head: 'tilt_r', say: 'declined', peak: 1 }, { t: 2400, end: 1 }],
    idle:      [{ t: 0, mood: 'normal', eye: 'user' }]
  };
 
  /* event -> {pri, cd (ms cooldown event yang sama), say (apakah boleh bicara), behavior|fn} */
  var EVENTS = {
    dashboard_open: { pri: 'interaction', cd: 600000, behavior: 'greet', sayKey: 'greet', motivation: false },
    /* konteks guru: teks & mood dikirim lily_teacher.js lewat data.response/mood; cd = cooldown brain biasa */
    sched_late_notask: { pri: 'sched_late_notask', cd: 5000, behavior: 'notice', target: 'notification' },
    sched_ongoing:     { pri: 'sched_ongoing',     cd: 5000, behavior: 'observe', target: 'notification' },
    sched_5:           { pri: 'sched_5',           cd: 5000, behavior: 'notice', target: 'notification' },
    sched_10:          { pri: 'sched_10',          cd: 5000, behavior: 'observe', target: 'notification' },
    grading:           { pri: 'grading',           cd: 5000, behavior: 'notice', target: 'notification' },
    task_open:      { pri: 'interaction', cd: 8000, behavior: 'focusTask', target: 'content' },
    task_completed: { pri: 'achievement', cd: 4000, behavior: 'taskDone', motivation: true },
    tasks_pending:  { pri: 'observation', cd: 900000, behavior: 'worried', target: 'content', motivation: true },
    achievement:    { pri: 'achievement', cd: 20000, behavior: 'celebrate', motivation: true },
    all_done:       { pri: 'achievement', cd: 60000, behavior: 'celebrate', sayKey: 'allDone', motivation: true },
    error:          { pri: 'error', cd: 15000, behavior: 'apologize' },
    notification:   { pri: 'observation', cd: 5000, behavior: 'notice', target: 'notification' },  // {important:true} -> prioritas 'notification'
    ai_start:       { pri: 'processing', cd: 0, behavior: 'think' },
    ai_done:        { pri: 'processing', cd: 0, behavior: null },
    critical:       { pri: 'critical', cd: 3000, behavior: 'apologize', target: 'notification' },
    idle_long:      { pri: 'idle', cd: 300000, behavior: 'sleepy' },
    idle_nudge:     { pri: 'observation', cd: 600000, behavior: 'nudge', motivation: true },
    user_returned:  { pri: 'interaction', cd: 0, behavior: 'wake' },
    playful:        { pri: 'observation', cd: 120000, behavior: 'wink' },
    /* event baru v2 */
    /* flow:'photo' = event satu alur: boleh menggantikan event alur yang sama tanpa menunggu expressionMinHold.
     * photo_changed cd 0: ini aksi nyata guru; anti-spam kalimat sudah ada di _photoLine (cooldown per foto & global). */
    photo_look:       { pri: 'interaction', cd: 0, behavior: 'lookPhoto', target: 'avatar', flow: 'photo' },
    photo_quiet:      { pri: 'interaction', cd: 0, behavior: 'photoQuiet', target: 'avatar', flow: 'photo' },
    photo_changed:    { pri: 'interaction', cd: 0, behavior: 'photoNotice', target: 'avatar', sayKey: 'photoNew', flow: 'photo' },
    photo_open:       { pri: 'interaction', cd: 0, behavior: 'photoOpen',     target: 'avatar', flow: 'photo' },
    photo_selected:   { pri: 'interaction', cd: 0, behavior: 'photoSelected', target: 'avatar', flow: 'photo' },
    photo_preview:    { pri: 'interaction', cd: 0, behavior: 'photoPreview',  target: 'avatar', flow: 'photo' },
    photo_saving:     { pri: 'interaction', cd: 0, behavior: 'photoSaving',   target: 'avatar', flow: 'photo' },
    photo_done:       { pri: 'interaction', cd: 0, behavior: 'photoDone',     target: 'avatar', flow: 'photo' },
    photo_cancel:     { pri: 'interaction', cd: 0, behavior: 'photoCancel',   target: 'user',   flow: 'photo' },
    photo_error:      { pri: 'interaction', cd: 0, behavior: 'photoError',    target: 'avatar', flow: 'photo' },
    teacher_typing:   { pri: 'observation', cd: 25000, behavior: 'attend' },
    content_reading:  { pri: 'observation', cd: 15000, behavior: 'read', target: 'content' },
    teacher_praise:   { pri: 'interaction', cd: 8000, behavior: 'thanks' },
    teacher_mistake:  { pri: 'error', cd: 15000, behavior: 'reassure', target: 'content' },
    teacher_struggle: { pri: 'observation', cd: 300000, behavior: 'empathize', motivation: true },
    ai_confused:      { pri: 'interaction', cd: 0, behavior: 'clarify' },
    /* v4: cooldown & dedup per kunci ditangani sense(); di sini cd 0 */
    need_offer:       { pri: 'need_offer',  cd: 0, behavior: 'offer', target: 'user' },
    need_fix:         { pri: 'need_fix',    cd: 0, behavior: 'guide', target: 'user' },
    need_remind:      { pri: 'need_remind', cd: 0, behavior: 'remind', target: 'user' },
    teacher_searching: { pri: 'observation', cd: 20000, behavior: 'read', target: 'content' },   // diam: hanya menatap kolom pencarian
    /* v6: satu event untuk semua reaksi tugas; perilaku/teks dari agregator (noteTaskGiven). cd 0 + key unik: cooldown & dedup
     * dikerjakan agregator (per klaster), bukan cooldown per-nama yang akan membuang tahap penting. */
    task_given:       { pri: 'task_ctx', cd: 0, behavior: 'taskGlance', target: 'user' },
    /* v7: mikro-ekspresi kepekaan (kalah dari tawaran), berhasil, dan balasan tenang saat bantuan ditolak. cd/dedup dikerjakan sense()/pemanggil. */
    need_micro:       { pri: 'need_remind', cd: 0, behavior: 'microAttentive', target: 'user' },
    need_good:        { pri: 'need_fix',    cd: 0, behavior: 'senseGood',      target: 'user' },
    need_ack:         { pri: 'need_fix',    cd: 0, behavior: 'senseCalm',      target: 'user' }
  };
 
  function Lily(opts) {
    opts = opts || {};
    this.root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root;
    this.sprite = this.root.querySelector('.lily-sprite');
    this.bubble = this.root.querySelector('.lily-bubble');
    this.sprites = opts.sprites || {};
    /* rig (LilyRig, opsional): render layer modular. Tanpa rig atau asset belum AVAILABLE -> jalur sprite lama, perilaku identik. */
    this.rig = opts.rig || null;
    this.layered = !!(this.rig && this.rig.layered);
    /* poses (LilyPoses, opsional): lapisan pose tambahan di atas sprite. Tanpa modul/gambar -> this.poses null, perilaku lama persis. */
    this.poses = null;
    try { if (global.LilyPoses && this.sprite) this.poses = global.LilyPoses.create({ root: this.root, sprite: this.sprite, dev: !!opts.debug }); } catch (e) { this.poses = null; }
    if (this.poses) { var pz = this.poses; setTimeout(function () { pz.preload(); }, 1500); }
    this.targets = opts.targets || {};            // {content:'#area', notification:'#bell', button:'#btn'}
    this.endpoint = opts.endpoint || '/api/scorus-ai/lily';
    this.photoEndpoint = opts.photoEndpoint || '/api/lily/foto';   // vision lewat backend (key tidak ada di browser)
    this.debug = !!opts.debug;
    this.onReply = typeof opts.onReply === 'function' ? opts.onReply : null;   // (meta) => simpan ke chat history: {source, message_type, lily_expression}
    this.lastReply = null;
    this.isVisible = typeof opts.isVisible === 'function' ? opts.isVisible : null;   // Lily tak terlihat (mis. tab lain) -> sense() diam, tidak membakar cooldown/anggaran
    this.shortcutFor = typeof opts.shortcutFor === 'function' ? opts.shortcutFor : null;   // v7: (sinyal) => {label, run, text?} | null -- hanya pintasan NYATA yang sudah ada di halaman
    this.onHelp = typeof opts.onHelp === 'function' ? opts.onHelp : null;   // (sinyal) => false bila halaman tidak menangani; selain itu dianggap sudah ditangani
    this._txtCache = {};      // cache sesi per halaman/akun (memori saja, tidak dibagi antar user)
    this._aiSeq = 0; this._aiGateT = 0; this._thinkAt = 0;   // v9: token pertanyaan, timer gerbang durasi minimum, awal 'think'
    this._txtInflight = {};   // request identik yang sedang jalan dipakai bersama (tanpa panggilan ganda)
    this.sapaan = opts.sapaan || null;            // mis. 'Pak Joel' / 'Ahmad'; null = tetap 'Pak/Bu' bawaan (gender tidak ditebak)
    this.cfg = Object.assign({
      motivationCooldown: 90000, responseCooldown: 7000, expressionMinHold: 1200,
      idleSleepAfter: 120000, idleNudgeAfter: 300000, dupWindow: 30000,
      needGap: 90000, busyRate: 14, hesitateAfter: 45000, hesitateMax: 2, deferTtl: 60000, snoozeMs: 1800000, clickBurst: 5, maxLinger: 9000,
      taskGap: 180000, taskBurstWindow: 180000, taskSettle: 1200, taskMicroGap: 5000, taskCommentCd: 480000, taskRankGap: 120000,
      taskHoldMs: 60000, taskWrapAfter: 90000, taskQuietAfter: 20000, taskSayGap: 15000,
      clickMicro: 3, microGap: 20000, microCd: 120000, microMax: 8, stuckMicroAfter: 22000,
      repeatMin: 6, repeatWindow: 150000, navWindow: 45000, navMin: 4, navGap: 14000
    }, opts.config || {});
    this.reduceMotion = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
 
    this.state = 'IDLE';       // state pipeline (v1)
    this.macro = 'IDLE';       // state makro (v2): IDLE ATTENTION NOTICE THINKING FOCUSED RESPONDING ...
    this.ctx = { pendingTasks: 0, completedRecent: [], lastActivity: now() };
    this.cur = { mood: 'normal', eye: 'user', pri: PRI.idle, id: 0, name: 'idle' };
    this.mood = 'normal';
    this.lastMoodAt = 0;
    this.lastEventAt = {};   // nama event -> waktu
    this.eventCount = {};    // habituasi: makin sering, makin lama jedanya
    this.dupSeen = {};       // signature -> waktu
    this.lastSayAt = 0;
    this.lastMotivationAt = 0;
    this.lastLine = {};
    this.lastIdleAct = '';
    this.idleCool = {};      // aksi idle -> waktu boleh lagi
    this.timers = [];
    this.queued = null;
    this.sleeping = false;
    this.nudged = false;
    this._bubbleT = 0; this._bubbleUntil = 0;
    this._pf = null; this._pfN = 0; this._pfEl = null; this._photoCtx = null; this._lastQuiet = ''; this._lastMir = false;
    this._curSrc = null; this._lastDir = null; this._amp = 1; this._saccId = 0; this._blinking = false;
    this.lastBlinkAt = 0; this._lastBlinkDelay = 0; this._blinkT = 0; this._soonT = 0; this._swapT = 0;
 
    this._needInit();
    this._bind();
    this._render('normal', 'user');
    this._idleLoop();
    this._sleepWatch();
    this._blinkLoop();
    this._sensors();
    this._taskInit();
  }
  var P = Lily.prototype;
 
  P._log = function () { if (this.debug) console.log.apply(console, ['[Lily]'].concat([].slice.call(arguments))); };
  P._go = function (s) { this.state = s; this._log('state', s); };
  P._macro = function (m) { this.macro = m; if (this.root) this.root.setAttribute('data-state', m); };
 
  /* ---------------- aktivitas pengguna ---------------- */
  P._bind = function () {
    var self = this, last = 0;
    var act = function () {
      var t = now(); if (t - last < 800) return; last = t;
      var wasAsleep = self.sleeping;
      self.ctx.lastActivity = t; self.nudged = false;
      if (wasAsleep) { self.sleeping = false; self.emit('user_returned'); }
    };
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (ev) {
      global.addEventListener(ev, act, { passive: true });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) act(); });
  };
 
  P._sleepWatch = function () {
    var self = this;
    setInterval(function () {
      if (document.hidden) return;
      if (self._pfActive && self._pfActive()) return;     // guru sedang memilih/menyimpan foto (dialog file native menahan event halaman)
      var idle = now() - self.ctx.lastActivity;
      if (!self.sleeping && idle > self.cfg.idleNudgeAfter && !self.nudged) { self.nudged = true; self.emit('idle_nudge'); }
      if (!self.sleeping && idle > self.cfg.idleSleepAfter) { self.sleeping = true; self.emit('idle_long'); }
    }, 5000);
  };
 
  P.setContext = function (patch) { Object.assign(this.ctx, patch || {}); };
 
  /* ---------------- 1. NOTICE_EVENT ---------------- */
  P.emit = function (name, data, opt) {
    data = data || {}; opt = opt || {};
    var def = opt.def || EVENTS[name];                  // opt.def: definisi tersimpan saat event diantrekan (event dinamis sudah dihapus dari EVENTS)
    if (!def) return false;
    var replay = !!opt.replay;                          // putar ulang dari antrean: dedup/cooldown sudah dihitung saat pertama kali masuk
    if (name === 'error' || name === 'teacher_mistake') this._trackErr();   // v4: error beruntun = tanda kesulitan
    this._go('NOTICE_EVENT');
 
    // ai_done tidak punya perilaku sendiri: hentikan 'think' bila sedang berjalan
    if (name === 'ai_done') {
      if (this.cur.name === 'think') this._finish(this.cur.id);
      if (this.queued && this.queued.name === 'ai_start') this.queued = null;   // jawaban sudah datang: 'think' antre tidak boleh diputar
      this._go('IDLE'); return true;
    }
    var t = now();
    var sig = name + '|' + (data.key || '');
    var n = this.eventCount[name] || 0;
    if (!replay) {
      // pencegahan duplikat: event + signature yang sama dalam jendela waktu
      if (this.dupSeen[sig] && t - this.dupSeen[sig] < this.cfg.dupWindow && def.pri !== 'critical') {
        this._log('duplikat diabaikan', sig); this._go(this.cur.name === 'idle' ? 'IDLE' : 'PLAY_BEHAVIOR'); return false;
      }
      // cooldown event + habituasi (pengulangan ke-n melipatgandakan jeda, maks x4)
      var cd = def.cd * Math.min(4, 1 + n * 0.5);
      if (def.cd && this.lastEventAt[name] && t - this.lastEventAt[name] < cd && def.pri !== 'critical') {
        this._log('cooldown', name); this._go(this.cur.name === 'idle' ? 'IDLE' : 'PLAY_BEHAVIOR'); return false;
      }
      this.dupSeen[sig] = t; this.lastEventAt[name] = t; this.eventCount[name] = n + 1;
    }
 
    /* ---------------- 2. ANALYZE_CONTEXT ---------------- */
    this._go('ANALYZE_CONTEXT');
    var plan = this._analyze(name, def, data);
    if (!plan) { this._go('IDLE'); return false; }
 
    /* ---------------- 3. prioritas ---------------- */
    var pri = PRI[plan.pri || def.pri];
    if (this.cur.name !== 'idle' && pri > this.cur.pri) {
      // prioritas lebih rendah dari yang sedang berjalan: antri (kedaluwarsa) atau buang
      if (pri <= PRI.observation) this._enqueue(name, data, def, pri, t, opt.exp);
      this._go('PLAY_BEHAVIOR'); return false;
    }
    var sameFlow = !!(plan.flow && this.cur.flow === plan.flow);   // tahap berikutnya dari alur yang sama boleh langsung menggantikan
    if (this.cur.name !== 'idle' && pri === this.cur.pri && !sameFlow && t - this.lastMoodAt < this.cfg.expressionMinHold) {
      this._enqueue(name, data, def, pri, t, opt.exp);              // terlalu cepat: tunda, jangan hilang
      this._go('PLAY_BEHAVIOR'); return false;
    }
    this._play(plan, pri);
    return true;
  };
 
  /* Satu slot antrean. Yang lebih penting (angka PRI lebih kecil) tidak digantikan; sama penting -> yang terbaru menang.
   * Jawaban bernaskah (data.response) diberi umur lebih panjang: tidak boleh hilang hanya karena Lily sedang bereaksi. */
  P._enqueue = function (name, data, def, pri, t, exp) {
    var q = this.queued;
    if (q && q.exp > t && q.pri < pri) return;
    this.queued = { name: name, data: data, def: def, pri: pri, exp: exp || (t + (data && data.response ? 15000 : 4000)) };
  };
 
  P._analyze = function (name, def, data) {
    var c = this.ctx, plan = { behavior: def.behavior, pri: def.pri, target: def.target, say: null, speak: true, flow: def.flow || null };
    var t = now();
 
    if (name === 'tasks_pending') {
      var n = data.count != null ? data.count : c.pendingTasks;
      c.pendingTasks = n;
      if (n < 4) return null;                       // sedikit: tidak perlu bereaksi
      if (this._isBusy()) return null;              // v4: guru sedang sibuk -> jangan ganggu
      plan.behavior = n >= 10 ? 'worried' : 'encourage';
      c.stressedAt = t;                             // tanda dari state aplikasi (bukan memori palsu)
    }
    if (name === 'task_completed') {
      c.completedRecent = c.completedRecent.filter(function (x) { return t - x < 600000; }).concat(t);
      if (c.pendingTasks > 0) c.pendingTasks--;
      if (c.completedRecent.length >= 3) { plan.say = 'streak'; plan.behavior = 'celebrate'; }
      if (data.allDone) { plan.say = 'allDone'; plan.behavior = 'celebrate'; }
      if (!plan.say && c.stressedAt && t - c.stressedAt < 1200000) {   // sebelumnya state menandai guru kewalahan
        plan.say = 'relievedAfterStress'; plan.behavior = 'relieved'; c.stressedAt = 0;
      }
    }
    if (name === 'photo_changed') {                     // pilih kalimat sesuai konteks nyata dari halaman, tanpa AI
      plan.say = data.pertama ? 'photoFirst' : data.lagi ? 'photoAgain' : 'photoNew';
      if (data.lagi) plan.behavior = 'photoNotice';
      var u = data.ukur;
      if (u && !data.pertama && !data.lagi) {                       // kesan dari data terukur, tetap tanpa AI
        var pool = (u.warna && u.warna !== 'netral') ? FOTO_UKUR.warna : (FOTO_UKUR[u.terang] || FOTO_UKUR.netral);
        var tx, k = 0;
        do { tx = pick(pool); k++; } while (tx === this.lastLine.photoUkur && pool.length > 1 && k < 4);
        this.lastLine.photoUkur = tx;
        plan.text = this._sapa(tx.replace('{w}', u.warna || ''));
        plan.moodOverride = u.terang === 'cerah' ? 'happy' : u.terang === 'redup' ? 'calm' : (u.nuansa === 'hangat' ? 'warm' : 'curious');
      }
    }
    if (name === 'dashboard_open') {
      var h = new Date().getHours();
      plan.say = h < 11 ? 'greetPagi' : h < 15 ? 'greetSiang' : h < 18 ? 'greetSore' : 'greetMalam';
    }
    if (def.sayKey && !plan.say) plan.say = def.sayKey;
    if (data.pri && data.pri !== 'critical' && PRI[data.pri] !== undefined) plan.pri = data.pri;   // mis. sapaan guru dari wrapper = 'observation'
    if (data.attention) plan.target = data.attention;
    if (data.targetEl) plan.targetEl = data.targetEl;
    if (data.behavior && BEHAVIORS[data.behavior]) plan.behavior = data.behavior;
    if (data.mood) plan.moodOverride = data.mood;
    if (data.pose && POSE_FLOW[data.pose]) { plan.pose = data.pose; plan.poseMs = POSE_FLOW[data.pose + 'Ms']; }
    if (data.response) { plan.text = data.response; }
    if (data.intensity != null && isFinite(data.intensity)) plan.intensity = +data.intensity;
    if (data.actions && data.actions.length) plan.actions = data.actions;      // v4: tombol di bubble (Ya / Nanti / Buka)
    if (Array.isArray(data.prepare) && data.prepare.length && !data.response)  // v4: ringkasan persiapan mengajar dari data nyata
      plan.text = this._sapa(data.prepare.slice(0, 3).map(String).join(' \u00B7 '));
    if (name === 'notification' && data.important) plan.pri = 'notification';
    if (plan.text && plan.moodOverride) plan.moodOverride = coherentMood(plan.text, plan.moodOverride);   // v7: teks & wajah tidak boleh bertentangan
    plan.motivation = !!def.motivation;
    plan.name = name;
    if (plan.flow) {                                    // variasi kiri/kanan: cenderung berlawanan dengan yang terakhir
      plan.mirror = Math.random() < (this._lastMir ? 0.3 : 0.7);
      this._lastMir = plan.mirror;
    }
    return plan;
  };
 
  /* ---------------- 4-7. SELECT_* -> PLAY_BEHAVIOR -> SHOW_RESPONSE ---------------- */
  P._play = function (plan, pri) {
    var self = this;
    this._clearTimers();
    var steps = BEHAVIORS[plan.behavior] || BEHAVIORS.observe;
    if (this.layered) this.rig.stopGesture();                     // interrupt: gesture lama menuju fase return, bukan terpotong
    var id = ++this.cur.id;
    this.cur = { mood: this.mood, eye: 'user', pri: pri, id: id, name: plan.behavior === 'idle' ? 'idle' : plan.behavior, flow: plan.flow || null };
    this._amp = this._ampOf(plan.intensity);
    plan.low = plan.intensity != null && plan.intensity < 0.35;
    plan.hasPeak = steps.some(function (x) { return x.peak; });
    this._saccId = 0;
    this.root.style.setProperty('--lily-head-x', '0px');
    if (plan.behavior === 'think') this._thinkAt = now();         // v9: acuan durasi minimum membaca
    this._poseOff(80);                                            // pose lama dilepas, kecuali perilaku/langkah baru langsung memasang pose (cegah kedip)
    if (plan.pose) this.timers.push(setTimeout(function () { if (self.cur.id === id) self._pose(plan.pose, plan.poseMs); }, 0));
    this._macro(BEH_STATE[plan.behavior] || 'ATTENTION');
    this._go('PLAY_BEHAVIOR');
 
    steps.forEach(function (s) {
      var tm = setTimeout(function () {
        if (self.cur.id !== id) return;
        if (s.end) { return self._endStep(plan, id); }
        self._step(plan, s, id);
      }, s.t);
      self.timers.push(tm);
    });
    // respons dari AI tapi perilaku tidak punya langkah 'say': tampilkan sebentar setelah ekspresi muncul
    if (plan.text && !steps.some(function (x) { return x.say; })) {
      this.timers.push(setTimeout(function () { if (self.cur.id === id) { self._go('SHOW_RESPONSE'); self._say(plan, 'ai'); } }, 700));
    }
    // tanpa langkah 'end' (think/sleepy) perilaku bertahan sampai dihentikan event lain
  };
 
  P._ampOf = function (i) { return i == null ? 1 : Math.max(0.6, Math.min(1.5, 0.5 + i)); };
 
  P._stepMood = function (plan, s) {
    var ov = plan.moodOverride;
    if (ov && (plan.hasPeak ? s.peak : s.t > 0)) return ov;
    return s.mood || this.mood;
  };
 
  P._step = function (plan, s, id) {
    this._go('SELECT_EXPRESSION');
    var mood = this._stepMood(plan, s);
    if (s.say && plan.text) mood = coherentMood(plan.text, mood);
    this._go('SELECT_EYE_DIRECTION');
    var eye = s.eye || this.cur.eye, head = s.head;
    if (plan.mirror) { eye = MIRROR[eye] || eye; head = MIRROR[head] || head; }
    var o = { target: plan.target, targetEl: plan.targetEl, wide: s.eyeWide, focus: s.focus,
              style: s.eyes, head: head, mouth: s.mouth };
    this._transition(mood, eye, o, id);
    if (s.pose) this._pose(s.pose);
    var anim = s.anim;
    if (anim && plan.low && (anim === 'hop' || anim === 'bounce')) anim = 'nodsmall';   // intensity rendah -> gerak lebih kecil
    if (anim) this._anim(anim);
    if (s.gesture) this._gesture(s.gesture, !anim);
    if (s.saccade) this._saccade(id);
    else if (this._saccId) { this._saccId = 0; this.root.style.setProperty('--lily-head-x', '0px'); }
    if (s.say) { this._go('SHOW_RESPONSE'); this._say(plan, s.say); }
  };
 
  /* Transisi emosi: tidak langsung normal -> sad, melainkan normal -> concerned -> sad. */
  P._via = function (from, to) {
    if (from === to) return null;
    if (NEG[to] && !SOFT_NEG[from]) return 'concerned';
    if (HIGH[to] && !HIGH[from] && from !== 'surprised' && from !== 'happy' && from !== 'proud') return 'surprised';
    if (to === 'happy' && THINKY[from]) return 'relieved';
    if ((to === 'normal' || to === 'calm') && SOFT_NEG[from]) return 'reassuring';
    return null;
  };
 
  P._transition = function (mood, eye, o, id) {
    var self = this, via = this.reduceMotion ? null : this._via(this.mood, mood);
    if (!via) { this._render(mood, eye, o); return; }
    this._render(via, eye, o);
    this.timers.push(setTimeout(function () { if (self.cur.id === id) self._render(mood, eye, o); }, rnd(220, 340)));
  };
 
  /* Gerakan mata kecil saat membaca (saccade): geser halus acak sampai step berikutnya. */
  P._saccade = function (id) {
    var self = this;
    this._saccId = id;
    (function tick() {
      if (self._saccId !== id || self.cur.id !== id || self.reduceMotion) return;
      self.root.style.setProperty('--lily-head-x', rnd(-1.4, 1.4).toFixed(1) + 'px');
      self.timers.push(setTimeout(tick, rnd(600, 1100)));
    })();
  };
 
  /* Gesture: pakai sprite 'gesture:<nama>' bila ada, jika tidak cukup animasi CSS. */
  P._gesture = function (name, withAnim) {
    var self = this, src = this.sprites['gesture:' + name];
    if (this.layered && this.rig.gesture(name)) return;          // frame badan dari rig; kepala/wajah tetap dari layer
    if (!this.layered && src && this.sprite) {
      this.sprite.setAttribute('src', src);
      setTimeout(function () { if (self._curSrc && !self._blinking) self.sprite.setAttribute('src', self._curSrc); }, 1100);
    }
    if (withAnim) this._anim(GESTURE_ANIM[name] || 'nodsmall');
  };
 
  /* Akhir perilaku: bila Lily sedang berbicara (bubble masih tampil), ekspresi ditahan sampai bubble habis (maks cfg.maxLinger)
   * dengan sedikit gerak kepala, supaya wajah tidak kembali netral di tengah kalimat. */
  P._endStep = function (plan, id) {
    if (this.cur.id !== id) return;
    var self = this, rest = (this._bubbleUntil || 0) - now();
    if (plan.spoke && !plan.lingered && rest > 0) {
      plan.lingered = true;
      this._idle_headMove();
      this.timers.push(setTimeout(function () { self._endStep(plan, id); }, Math.min(rest, this.cfg.maxLinger) + 350));
      return;
    }
    this._finish(id);
  };
 
  /* Langkah mood antara mood sekarang dan 'normal' (kosong untuk mood negatif lembut: sudah ditangani _via()). */
  P._settlePath = function (mood) {
    if (SOFT_NEG[mood]) return [];
    var p = [], m = mood;
    while (SETTLE[m] && p.length < 2) { m = SETTLE[m]; if (m === 'normal') break; p.push(m); }
    return p;
  };
 
  P._finish = function (id) {
    if (this.cur.id !== id) return;
    var self = this;
    this._macro('RETURN_TO_IDLE'); this._go('RETURN_TO_IDLE');
    this._clearTimers(); this._saccId = 0;
    if (!(this.poses && this.poses.holding)) this._poseOff(80);   // v9: pose hasil yang masih dalam masa tahan dilepas oleh timernya sendiri (tidak terpotong)
    this.cur = { mood: 'normal', eye: 'user', pri: PRI.idle, id: this.cur.id + 1, name: 'idle' };
    var idleId = this.cur.id;
    this._amp = 1;
    this.root.style.setProperty('--lily-head-x', '0px');
    /* kembali ke idle bertahap (mis. amazed -> warm -> calm -> normal), berhenti bila ada perilaku baru */
    var path = this.reduceMotion ? [] : this._settlePath(this.mood);
    var run = function (i) {
      if (self.cur.id !== idleId) return;
      if (i < path.length) {
        self._render(path[i], 'user', { smooth: true });
        self.timers.push(setTimeout(function () { run(i + 1); }, rnd(480, 640)));
      } else {
        self._transition('normal', 'user', { smooth: true }, idleId);   // mis. concerned -> reassuring -> normal
      }
    };
    run(0);
    setTimeout(function () { if (self.cur.id === idleId && self.cur.name === 'idle') self._macro('IDLE'); }, 450 + path.length * 640);
    this._go('IDLE');
    var q = this.queued; this.queued = null;
    if (q && q.exp > now()) { setTimeout(function () { self.emit(q.name, q.data, { replay: true, def: q.def, exp: q.exp }); }, 600); }
  };
 
  /* ---------------- respons (bicara) + anti-spam ---------------- */
  P._say = function (plan, key) {
    var t = now();
    var text = plan.text;
    if (!text) {
      var k = plan.say || key;
      var pool = LINES[k] || LINES[key];
      if (!pool || !pool.length) return;
      // motivasi punya cooldown sendiri; ekspresi tetap tampil walau kalimat ditahan
      if (plan.motivation && t - this.lastMotivationAt < this.cfg.motivationCooldown) return;
      var tries = 0; do { text = pick(pool); tries++; } while (text === this.lastLine[k] && pool.length > 1 && tries < 4);
      this.lastLine[k] = text;
      if (plan.motivation) this.lastMotivationAt = t;
      text = this._sapa(text);
    }
    if (t - this.lastSayAt < this.cfg.responseCooldown && plan.pri !== 'critical' && !plan.text) return;
    this.lastSayAt = t;
    plan.spoke = true;
    if (/^(ATTENTION|NOTICE|FOCUSED|THINKING)$/.test(this.macro)) this._macro('RESPONDING');
    this._showBubble(text, plan.actions);
  };
 
  /* Sapaan: 'Pak/Bu' di kalimat bawaan diganti sapaan nyata guru (nama atau Pak/Bu dari akun). Tanpa data -> tidak diubah. */
  /* Label peran akun ("Guru Pengajar") bukan nama: dilewati, sapaan kembali ke 'Pak/Bu'. */
  var SAPA_GENERIK = /^(guru|pengajar|guru pengajar|guru mapel|admin|user|pengguna|teacher)$/i;
  P.setSapaan = function (s) { this.sapaan = (typeof s === 'string' && s.trim() && !SAPA_GENERIK.test(s.trim())) ? s.trim() : null; };
  P._sapa = function (text) { return this.sapaan ? String(text).replace(/Pak\/Bu/g, this.sapaan) : text; };
 
  P._showBubble = function (text, actions) {
    if (!this.bubble) return;
    var b = this.bubble, self = this, hasA = !!(actions && actions.length);
    b.textContent = text; b.classList.add('show');
    this._bubbleUntil = now() + (hasA ? 10000 : Math.min(9000, 2500 + text.length * 55));
    this._pendingOffer = hasA ? (actions._offer || null) : null;
    if (hasA) this._mountActions(b, actions);
    clearTimeout(this._bubbleT);
    this._bubbleT = setTimeout(function () {
      b.classList.remove('show');
      var po = self._pendingOffer;                       // tawaran habis tanpa dijawab = diabaikan -> Lily mundur
      if (po) { self._pendingOffer = null; self._ignored++; self._ignoredAt = now(); self._needSnooze[po.key] = now() + self.cfg.snoozeMs; }
      self._blinkSoon();
    }, hasA ? 10000 : Math.min(9000, 2500 + text.length * 55));
  };
 
  /* ---------------- render: sprite + arah mata + animasi ---------------- */
  P._targetVec = function (name, el) {
    if (DIRS[name]) return DIRS[name];
    var node = el || (this.targets[name] && document.querySelector(this.targets[name]));
    if (!node) return [0, 0];
    var a = this.root.getBoundingClientRect(), b = node.getBoundingClientRect();
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var len = Math.max(1, Math.hypot(dx, dy));
    return [Math.max(-1, Math.min(1, dx / len)), Math.max(-1, Math.min(1, dy / len))];
  };
 
  P._dirName = function (v) {
    if (Math.abs(v[0]) < 0.6 && Math.abs(v[1]) < 0.6) return 'idle';   // slight_* tetap memakai sprite dasar
    return Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] < 0 ? 'left' : 'right') : (v[1] < 0 ? 'up' : 'down');
  };
 
  /* Urutan pencarian sprite: mood:wide, eyes:wide, mood:focus, eyes:focus, mood:arah, mood:gaya, mood, eyes:gaya,
   * lalu rantai fallback (tiap mood pengganti dengan arah dan tanpa arah), terakhir 'normal'. */
  P._src = function (mood, dirName, wide, focus, style) {
    var S = this.sprites, m = mood, tries = 0, d = dirName && dirName !== 'idle' ? dirName : null;
    var st = style && style !== 'neutral' ? style : null;
    var keys = [];
    if (wide) keys.push(m + ':wide', 'eyes:wide');
    if (focus) keys.push(m + ':focus', 'eyes:focus');
    if (d) keys.push(m + ':' + d);
    if (st) keys.push(m + ':' + st);
    keys.push(m);
    if (st) keys.push('eyes:' + st);
    while (tries++ < 4 && FALLBACK_MOOD[m]) { m = FALLBACK_MOOD[m]; if (d) keys.push(m + ':' + d); keys.push(m); }
    keys.push('normal');
    for (var i = 0; i < keys.length; i++) if (S[keys[i]]) return S[keys[i]];
    return null;
  };
 
  P._render = function (mood, eye, o) {
    o = o || {};
    if (MOODS.indexOf(mood) < 0) mood = 'normal';
    var v;
    if (eye === 'target') v = this._targetVec(o.target || 'user', o.targetEl);
    else v = this._targetVec(eye || 'user');
    var dirName = this._dirName(v);
    var prof = PROFILE[mood] || PROFILE.normal;
    var style = o.style || prof.eyes;
    if (this.layered) {
      this.rig.show({ mood: mood, eyes: o.wide ? 'wide' : style, mouth: o.mouth || prof.mouth, dir: dirName });
    } else {
      var src = this._src(mood, dirName, o.wide, o.focus, style);
      if (src && this.sprite && this.sprite.getAttribute('src') !== src) { this.sprite.setAttribute('src', src); this._swapFx(); }
      if (src) this._curSrc = src;
    }
    if (this._lastDir && this._lastDir !== dirName) this._blinkSoon();   // kedip kecil setelah pindah fokus
    this._lastDir = dirName;
    this.mood = mood; this.cur.eye = eye; this.lastMoodAt = now();
    // kepala/tubuh ikut condong sedikit ke arah pandangan (parallax halus, ~3px / 2deg), diskalakan intensity
    var k = this.reduceMotion ? 0 : 1, amp = this._amp || 1;
    this.root.style.setProperty('--lily-gaze-x', (v[0] * 3 * k * amp).toFixed(2) + 'px');
    this.root.style.setProperty('--lily-gaze-y', (v[1] * 2 * k * amp).toFixed(2) + 'px');
    this.root.style.setProperty('--lily-tilt', (v[0] * 2 * k * amp).toFixed(2) + 'deg');
    var hn = o.head || prof.head, h = HEAD[hn] || HEAD.neutral, rs = this.root.style;
    rs.setProperty('--lily-mood-tilt', (h[0] * amp * k).toFixed(2) + 'deg');
    rs.setProperty('--lily-lean-s', (1 + (h[1] - 1) * amp * k).toFixed(4));
    rs.setProperty('--lily-lean-y', (h[2] * amp * k).toFixed(2) + 'px');
    if (prof.breath) rs.setProperty('--lily-breath', prof.breath + 's'); else rs.removeProperty('--lily-breath');
    this.root.setAttribute('data-mood', mood);
    this.root.setAttribute('data-eye', dirName);
    this.root.setAttribute('data-eyes', style);
    this.root.setAttribute('data-mouth', o.mouth || prof.mouth);
    this.root.setAttribute('data-head', hn);
  };
 
  /* Pergantian sprite diperhalus: redup sangat singkat (lihat .lily-swap di lily.css). */
  P._swapFx = function () {
    if (this.reduceMotion || !this.sprite) return;
    var sp = this.sprite;
    sp.classList.remove('lily-swap'); void sp.offsetWidth; sp.classList.add('lily-swap');
    clearTimeout(this._swapT);
    this._swapT = setTimeout(function () { sp.classList.remove('lily-swap'); }, 240);
  };
 
  P._anim = function (name) {
    if (this.reduceMotion) return;
    var r = this.root, cls = 'lily-anim-' + name;
    r.classList.remove(cls); void r.offsetWidth; r.classList.add(cls);
    setTimeout(function () { r.classList.remove(cls); }, 1400);
  };
 
  /* v9: urutan ekspresi mengikuti status AI nyata. _aiBegin() = token pertanyaan baru (membatalkan hasil pertanyaan lama);
   * _aiSettle(token, fn) = jalankan fn (ai_done + hasil) setelah durasi minimum membaca, bila 'think' memang sedang tampil.
   * Hasil dengan token usang dibuang: jawaban lama tidak boleh mengubah ekspresi pertanyaan baru. */
  P._aiBegin = function () {
    if (this._aiGateT) { clearTimeout(this._aiGateT); this._aiGateT = 0; }
    return ++this._aiSeq;
  };
  P._aiSettle = function (seq, fn) {
    var self = this;
    if (seq !== this._aiSeq) return;
    var wait = 0;
    if (this.cur.name === 'think' && this._thinkAt)
      wait = Math.max(0, this._thinkAt + (POSE_FLOW.askMs || 0) + (POSE_FLOW.readMinMs || 0) - now());
    if (wait <= 0) { fn(); return; }
    this._aiGateT = setTimeout(function () { self._aiGateT = 0; if (seq === self._aiSeq) fn(); }, wait);
  };
  P._clearTimers = function () { this.timers.forEach(clearTimeout); this.timers = []; };
  /* Pose (lily_poses.js): _pose() = false bila pose tidak tersedia -> sprite lama tetap tampil. */
  P._pose = function (name, holdMs) { return !!(this.poses && this.poses.show(name, holdMs)); };
  P._poseOff = function (delayMs) { if (this.poses) this.poses.hide(delayMs || 0); };
  /* Pose penutup proses AI dari data balasan nyata: 'menemukan_jawaban' hanya untuk jawaban AI sukses; data tidak ditemukan -> 'curious'; gagal -> 'lost'; lainnya null. */
  P._answerPose = function (d) {
    if (!d) return null;
    var t = String(d.message_type || '');
    if (/exhaust/i.test(t)) return null;                                          // token habis: ekspresi lama (concerned) saja
    if (d.success === false || (t && t !== 'assistant_ai')) return POSE_FLOW.lost ? 'lost' : null;   // gagal / jawaban pengganti lokal
    if (d.mood === 'uncertain' || d.mood === 'confused') return POSE_FLOW.curious ? 'curious' : null;   // AI menjawab tapi datanya tidak ditemukan
    if (STRESS[d.mood] || SOFT_NEG[d.mood]) return null;                          // jawaban empatik: bukan momen "ketemu ide"
    return POSE_FLOW.menemukan_jawaban ? 'menemukan_jawaban' : null;
  };
 
  /* ---------------- idle: mikro-animasi acak ---------------- */
  P._idleLoop = function () {
    var self = this;
    var schedule = function () {
      // jeda tidak seragam: kadang cepat, kadang lama
      var d = Math.random() < 0.2 ? rnd(1200, 2500) : rnd(2800, 8500);
      setTimeout(function () { self._idleTick(); schedule(); }, d);
    };
    schedule();
  };
 
  /* blink/halfBlink dipindah ke sistem kedip sendiri (_blinkLoop) agar timing tidak ganda */
  var IDLE_ACTS = [
    { name: 'glance', w: 3, cd: 6000 },
    { name: 'lookUser', w: 1, cd: 9000 },
    { name: 'headMove', w: 2, cd: 12000 },
    { name: 'scan', w: 1, cd: 25000 }
  ];
 
  P._idleTick = function () {
    if (document.hidden || this.sleeping) return;
    if (this.cur.name !== 'idle') return;                       // hanya saat benar-benar idle
    var t = now(), self = this;
    var opts = IDLE_ACTS.filter(function (a) { return a.name !== self.lastIdleAct && (self.idleCool[a.name] || 0) <= t; });
    if (!opts.length) return;
    var total = opts.reduce(function (s, a) { return s + a.w; }, 0), r = Math.random() * total, act = opts[0];
    for (var i = 0; i < opts.length; i++) { r -= opts[i].w; if (r <= 0) { act = opts[i]; break; } }
    this.lastIdleAct = act.name; this.idleCool[act.name] = t + act.cd * rnd(0.8, 1.4);
    this['_idle_' + act.name]();
  };
 
  P._guard = function () { return this.cur.name === 'idle' && !this.sleeping; };
 
  /* ---------------- sistem kedip (acak, bukan interval tetap) ----------------
   * Jenis: normal, quick, slow, double. Jeda minimal 1.1 dtk antar kedip; jeda acak tidak boleh
   * nyaris sama dengan jeda sebelumnya. Kedip tambahan: setelah pindah fokus dan setelah selesai bicara. */
  P._blinkLoop = function () {
    var self = this;
    var next = function () {
      self._blinkT = setTimeout(function () { self._blink(); next(); }, self._nextBlinkDelay());
    };
    next();
  };
  P._nextBlinkDelay = function () {
    var r = Math.random(), d;
    if (r < 0.2) d = rnd(1800, 2600); else if (r < 0.75) d = rnd(2600, 4800); else d = rnd(4800, 7600);
    if (Math.abs(d - this._lastBlinkDelay) < 400) d += rnd(500, 900);
    this._lastBlinkDelay = d;
    return d;
  };
  P._blink = function (kind) {
    if (document.hidden || this.sleeping || NO_BLINK[this.mood]) return;
    if (this.poses && this.poses.active) return;                  // sprite sedang tertutup pose: tidak perlu kedip
    var t = now(), self = this;
    if (t - this.lastBlinkAt < 1100) return;
    this.lastBlinkAt = t;
    if (!kind) { var r = Math.random(); kind = r < 0.62 ? 'normal' : r < 0.8 ? 'quick' : r < 0.92 ? 'slow' : 'double'; }
    if (kind === 'double') {
      this._blinkOnce('quick');
      setTimeout(function () { if (!NO_BLINK[self.mood]) self._blinkOnce('quick'); }, rnd(190, 280));
    } else this._blinkOnce(kind);
  };
  P._blinkSoon = function () {
    var self = this;
    clearTimeout(this._soonT);
    this._soonT = setTimeout(function () { self._blink('quick'); }, rnd(120, 260));
  };
  P._blinkOnce = function (kind) {
    var self = this, s = this.sprites;
    if (!this.sprite) return;
    var dur = kind === 'quick' ? rnd(60, 90) : kind === 'slow' ? rnd(200, 300) : rnd(90, 150);
    if (this.layered) {                                           // 9 frame kedip dari rig; bila belum ada -> kedip CSS (bukan sprite full-character)
      if (!this.rig.blink(dur)) this._anim(kind === 'slow' ? 'blinkslow' : 'blinkfx');
      return;
    }
    var src = kind === 'slow' && s.halfBlink ? s.halfBlink : s.blink;
    if (src) {
      this.sprite.setAttribute('src', src); this._blinking = true;
      setTimeout(function () { self._blinking = false; if (self._curSrc) self.sprite.setAttribute('src', self._curSrc); }, dur);
    } else { this._anim(kind === 'slow' ? 'blinkslow' : 'blinkfx'); }   // cadangan bila sprite blink belum ada
  };
  P._idle_blink = function () { this._blink(); };          // kompatibilitas v1
  P._idle_halfBlink = function () { this._blink('slow'); };  // kompatibilitas v1
  P._idle_glance = function () {
    var self = this, dir = pick(['left', 'right', 'left', 'right', 'up', 'down']);
    this._render(this.mood, dir);
    setTimeout(function () { if (self._guard()) self._render(self.mood, 'user'); }, rnd(900, 2000));
  };
  P._idle_lookUser = function () { this._render(this.mood, 'user'); };
  P._idle_headMove = function () {
    var self = this, r = this.root;
    r.style.setProperty('--lily-head-x', rnd(-2.5, 2.5).toFixed(1) + 'px');
    r.style.setProperty('--lily-head-r', rnd(-1.8, 1.8).toFixed(1) + 'deg');
    setTimeout(function () { r.style.setProperty('--lily-head-x', '0px'); r.style.setProperty('--lily-head-r', '0deg'); }, rnd(1800, 3200));
  };
  P._idle_scan = function () {          // lirik kiri lalu kanan, lalu kembali ke pengguna
    var self = this;
    this._render(this.mood, 'left');
    setTimeout(function () { if (self._guard()) self._render(self.mood, 'right'); }, 1000);
    setTimeout(function () { if (self._guard()) self._render(self.mood, 'user'); }, 2300);
  };
 
  /* ======================================================================================
   * v4 -- KEPEKAAN KONTEKS (Needs Engine)
   *   aktivitas + konteks -> pahami kebutuhan -> solusi tercepat -> ekspresi sesuai
   *
   * Prinsip:
   *  - Tidak mengarang data: teks hanya memakai fakta yang dibawa sinyal (judul tugas, label kolom, pesan validasi
   *    browser). Tidak yakin -> tawaran singkat "Mau aku bantu?" (bukan jawaban tebakan).
   *  - Tidak membaca ISI kolom form (hanya kosong/tidak, dan hash pendek untuk mendeteksi pencarian diulang).
   *    Kolom password & elemen ber-atribut data-lily-ignore diabaikan.
   *  - Semua deteksi lokal. AI hanya setelah guru menekan "Ya" dan sinyal membawa fakta (reason:true).
   *  - Pemutaran tetap lewat emit() lama, jadi prioritas, cooldown, dedup, dan anti-spam yang ada tetap berlaku.
   *
   * Sinyal dari halaman/modul lain (semua opsional):
   *   lily.sense({ type:'struggle',  key, what, el, text, facts:[...], reason:true, solution:{text,label,run} })
   *   lily.sense({ type:'mistake',   key, el, solution:{ text, label?, run? } })     // solusi langsung
   *   lily.sense({ type:'lost',      key, el, text })                                // cari sesuatu tapi belum ketemu
   *   lily.sense({ type:'hesitate',  key, what, el })
   *   lily.sense({ type:'pending',   key, count, nearest:{ title, dueInMs | dueAt }, open:fn, openLabel })
   *   lily.sense({ type:'teaching_soon', key, minutes, title, prepare:['3 tugas belum dinilai', ...] })
   *   lily.setContext({ focusMode:true })   // mode fokus: semua tawaran ditunda sampai false
   * ====================================================================================== */
  var NEED_DEF = {
    mistake:       { urgency: 'now',  cd: 60000 },     // kesalahan: arahkan langsung, tidak menunggu
    teaching_soon: { urgency: 'now',  cd: 600000 },    // sensitif waktu
    struggle:      { urgency: 'calm', cd: 300000 },
    lost:          { urgency: 'calm', cd: 240000 },
    pending:       { urgency: 'calm', cd: 1800000 },
    hesitate:      { urgency: 'low',  cd: 600000 },
    /* v7 */
    error:         { urgency: 'calm', cd: 120000 },    // gagal/error berulang; dengan solusi nyata -> langsung
    repeat:        { urgency: 'low',  cd: 900000 },    // aksi sama diulang; hanya bila ada pintasan nyata
    confusion:     { urgency: 'calm', cd: 600000 },    // berpindah-pindah menu tanpa progres
    success:       { urgency: 'now',  cd: 30000 }      // berhasil SETELAH tadi ada kendala/bantuan
  };
  var NEED_RANK = { now: 3, calm: 2, low: 1 };
  /* Nama kategori (huruf besar/kecil) -> tipe sinyal. Tipe lama tidak dipetakan ulang. */
  var SENSE_ALIAS = { error: 'error', stuck: 'hesitate', repeat: 'repeat', searching: 'lost', confusion: 'confusion', success: 'success' };
  /* Sinyal kecil (level:1) -> mikro-ekspresi. Concerned hanya untuk kegagalan nyata (error/mistake). */
  var MICRO_BEH = { error: 'microConcerned', mistake: 'microConcerned', lost: 'microCurious', confusion: 'microCurious',
                    hesitate: 'microAttentive', struggle: 'microAttentive' };
  var NAV_SEL = 'nav, [role=navigation], aside, [data-lily-nav]';
 
  P._needInit = function () {
    this._needSeen = {};     // kunci -> waktu terakhir tampil (cooldown per kunci)
    this._needSnooze = {};   // kunci -> waktu boleh muncul lagi ("Nanti" / diabaikan)
    this._lastNeedAt = 0;    // anggaran proaktif: jarak minimum antar tawaran/pengingat
    this._ignored = 0; this._ignoredAt = 0;
    this._deferred = null; this._flushT = 0;
    this._pendingOffer = null;
    this._errs = []; this._srch = [];
    this._hesN = 0; this._hesT = 0; this._srchT = 0;
    this._wasOffline = false;
    this._act = { keys: [], clicks: [], lastKey: 0 };
    this._microAt = 0; this._microN = 0; this._lastHelpAt = 0; this._lastOffer = null; this._ackAt = 0; this._hesMT = 0;
    this._navN = this._navLoad().length;
  };
 
  /* Guru sedang sibuk? (mode fokus, tab tak terlihat, baru mengetik, atau kerja cepat). strict = syarat tenang lebih panjang. */
  P._isBusy = function (strict) {
    var t = now(), a = this._act;
    if (this.ctx.focusMode || document.hidden) return true;
    if (!a) return false;
    if (t - a.lastKey < (strict ? 4000 : 2500)) return true;
    var recent = function (x) { return t - x < 6000; };
    return a.keys.filter(recent).length + a.clicks.filter(recent).length >= this.cfg.busyRate;
  };
 
  /* Anggaran proaktif: setiap tawaran yang diabaikan memperpanjang jeda (maks x5,5) sampai guru terlihat menerima bantuan. */
  P._gapOk = function () {
    var t = now();
    if (this._ignored && t - this._ignoredAt > 1200000) this._ignored = 0;
    var mult = 1 + Math.min(this._ignored, 3) * 1.5;
    return t - this._lastNeedAt >= this.cfg.needGap * mult;
  };
 
  /* ---------- pintu masuk ---------- */
  P.sense = function (sig) {
    if (!sig || typeof sig !== 'object') return false;
    var low = String(sig.type || '').toLowerCase(), type = SENSE_ALIAS[low] || low;
    var def = NEED_DEF[type];
    if (!def) return false;
    if (type !== sig.type) sig = Object.assign({}, sig, { type: type });
    if (this.isVisible) { var vis = true; try { vis = !!this.isVisible(); } catch (e) {} if (!vis) return false; }
    var t = now(), base = type + '|' + (sig.key || ''), micro = sig.level === 1 && !!MICRO_BEH[type], key = micro ? base + '|m' : base;
    if (this._needSnooze[base] && t < this._needSnooze[base]) return false;                 // "Nanti"/diabaikan: tidak ada tawaran, tidak ada mikro
    if (this._needSeen[key] && t - this._needSeen[key] < (micro ? this.cfg.microCd : def.cd)) return false;
    if (micro && this._needSeen[base] && t - this._needSeen[base] < this.cfg.microCd) return false;   // baru saja ditawari: tidak perlu melirik lagi
    var need = this._understand(sig);                       // pahami kebutuhan; null = tidak relevan -> diam
    if (!need) return false;
    if (need.micro) {                                       // sinyal kecil: hanya bila Lily benar-benar senggang; tidak pernah ditunda (mikro basi = aneh)
      if (this.sleeping || this._microN >= this.cfg.microMax || t - this._microAt < this.cfg.microGap) return false;
      if (this._isBusy() || this.cur.name !== 'idle' || this._pendingOffer || (this._bubbleUntil || 0) > t) return false;
      return this._deliver(sig, need, key);
    }
    if (need.ev === 'need_good') {                          // berhasil: balasan singkat; guru sibuk -> diam, tidak ditunda
      if (this._isBusy()) return false;
      return this._deliver(sig, need, key);
    }
    var immediate = need.ev === 'need_fix' || (def.urgency === 'now' && need.ev !== 'need_offer');
    if (!immediate) {
      if (this._isBusy() || !this._calm() || !this._gapOk()) { this._defer(sig); return false; }
    }
    return this._deliver(sig, need, key);
  };
 
  /* Tunda satu sinyal (slot tunggal) sampai guru tenang; kedaluwarsa agar tidak muncul basi. */
  P._defer = function (sig) {
    var self = this, t = now(), d = this._deferred;
    if (d && d.exp > t && NEED_RANK[NEED_DEF[d.sig.type].urgency] >= NEED_RANK[NEED_DEF[sig.type].urgency]) return;
    this._deferred = { sig: sig, exp: t + this.cfg.deferTtl };
    clearInterval(this._flushT);
    this._flushT = setInterval(function () {
      var x = self._deferred, n = now();
      if (!x || x.exp <= n) { clearInterval(self._flushT); self._deferred = null; return; }
      if (self._isBusy(true) || !self._calm() || !self._gapOk()) return;
      clearInterval(self._flushT); self._deferred = null;
      if (typeof x.sig.stillRelevant === 'function') { try { if (!x.sig.stillRelevant()) return; } catch (e) {} }
      self.sense(x.sig);
    }, 2000);
  };
 
  /* ---------- pahami kebutuhan -> {ev, behavior, mood, intensity, acts, text} ---------- */
  P._understand = function (sig) {
    var type = sig.type, txt = sig.text ? String(sig.text) : '';
    var what = sig.what ? String(sig.what).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (sig.level === 1 && MICRO_BEH[type])                  // v7: sinyal kecil = mikro-ekspresi saja, tanpa teks
      return { ev: 'need_micro', behavior: MICRO_BEH[type], intensity: 0.3, micro: true };
    var offerQ = function (s, mood, inten, o) {              // tawaran singkat: wajah + kalimat + intensitas dari satu tempat
      return { ev: 'need_offer', behavior: 'senseOffer', mood: mood || 'concerned', intensity: inten || 0.4,
               acts: ['help', 'later'], helpLabel: o && o.helpLabel, text: s };
    };
    var fix = function (s) {                                 // solusi langsung: fokus, bukan khawatir
      return { ev: 'need_fix', behavior: 'senseFix', mood: 'focused', intensity: 0.6,
               acts: (sig.solution && typeof sig.solution.run === 'function') ? ['run'] : [], text: s };
    };
    var o, ms, title, sol;
    switch (type) {
      case 'mistake':
        sol = (sig.solution && sig.solution.text) ? String(sig.solution.text) : txt;
        if (!sol) return offerQ('Sepertinya ada yang belum sesuai. Mau aku bantu?');         // tidak tahu solusinya -> jangan menebak
        return fix(sol);
      case 'error':                                          // v7: gagal/error berulang
        if (sig.solution && sig.solution.text) return fix(String(sig.solution.text));
        return offerQ(txt || pick(LINES.offerError));
      case 'struggle':
        return offerQ(txt || (what ? 'Sepertinya "' + what + '" belum berjalan lancar. Mau aku bantu?' : pick(LINES.offerFail)));
      case 'hesitate':                                       // = STUCK: bertanya, tidak berasumsi guru bingung
        return offerQ(txt || (what ? 'Ada bagian "' + what + '" yang bikin ragu? Kalau mau, aku bantu.' : 'Ada bagian yang bikin ragu?'), 'attentive', 0.35);
      case 'lost':                                           // = SEARCHING
        return offerQ(txt || (sig.empty ? 'Belum ada hasilnya ya. Kalau mau, aku bisa bantu cari jalurnya.' : 'Kalau mau, aku bisa bantu cari jalurnya.'), 'curious', 0.4);
      case 'confusion':                                      // tanya tujuan secara singkat
        return offerQ(txt || pick(LINES.offerGoal), 'curious', 0.4, { helpLabel: 'Bantu cari' });
      case 'repeat':                                         // tawarkan pintasan yang SUDAH ADA; tidak ada pintasan -> diam (mengulang itu wajar)
        var sc = this._shortcutOf(sig);
        if (!sc) return null;
        return { ev: 'need_offer', behavior: 'senseOffer', mood: 'attentive', intensity: 0.35, acts: ['shortcut', 'later'], shortcut: sc,
                 text: txt || sc.text || ('Ini sudah beberapa kali diulang. Mau pakai pintasan "' + sc.label + '"?') };
      case 'success':                                        // balasan positif hanya setelah tadi ada kendala/bantuan (bukan tiap aksi normal)
        if (!sig.force && !(this._lastHelpAt && now() - this._lastHelpAt < 240000)) return null;
        return { ev: 'need_good', behavior: 'senseGood', mood: 'happy', intensity: 0.45, acts: [], text: txt || pick(LINES.good) };
      case 'pending':                                         // ingatkan HANYA bila relevan
        var n = +sig.count;
        if (!(n > 0)) return null;
        title = sig.nearest && sig.nearest.title ? String(sig.nearest.title).slice(0, 50) : '';
        ms = null;
        if (sig.nearest) {
          if (sig.nearest.dueInMs != null && isFinite(sig.nearest.dueInMs)) ms = +sig.nearest.dueInMs;       // dari waktu server (disarankan)
          else if (sig.nearest.dueAt) { var dt = new Date(sig.nearest.dueAt).getTime(); if (isFinite(dt)) ms = dt - now(); }
        }
        var urgent = ms != null && ms <= 86400000;               // lewat tenggat atau <= 24 jam
        if (!urgent && n < 4) return null;                       // tidak mendesak & sedikit: diam
        var text;
        if (title && ms != null) {
          if (ms < 0) text = '"' + title + '" sudah lewat tenggat.';
          else if (ms < 3600000) text = '"' + title + '" tenggatnya kurang dari sejam lagi.';
          else if (ms <= 86400000) text = '"' + title + '" tenggatnya sekitar ' + Math.round(ms / 3600000) + ' jam lagi.';
        }
        if (!text) text = urgent ? 'Ada tugas yang mendekati tenggat.' : n + ' tugas belum selesai.';
        var canOpen = typeof sig.open === 'function';
        return { ev: 'need_remind', behavior: 'remind', mood: 'attentive', intensity: 0.5,
                 acts: canOpen ? ['open', 'later'] : [], text: canOpen ? text + ' Mau dibuka?' : text };
      case 'teaching_soon':                                    // siapkan info: hanya dari data nyata yang dikirim pemanggil
        var pr = Array.isArray(sig.prepare) ? sig.prepare.filter(function (x) { return x; }).slice(0, 3).map(String) : [];
        if (!pr.length) return null;
        var m = isFinite(sig.minutes) ? Math.round(sig.minutes) : null;
        var head = (m != null ? 'Mengajar ' + (m <= 0 ? 'sekarang' : m + ' menit lagi') + (sig.title ? ' (' + sig.title + ')' : '') + ': '
                              : (sig.title ? sig.title + ': ' : ''));
        return { ev: (m != null && m <= 5) ? 'sched_5' : 'sched_10', acts: [], text: head + pr.join(' \u00B7 ') };
    }
    return null;
  };
 
  /* Pintasan NYATA yang diberikan halaman (sig.shortcut atau opts.shortcutFor). Lily tidak pernah mengarang pintasan. */
  P._shortcutOf = function (sig) {
    var sc = sig.shortcut;
    if (!sc && this.shortcutFor) { try { sc = this.shortcutFor(sig); } catch (e) { sc = null; } }
    return (sc && typeof sc.run === 'function' && sc.label) ? { label: String(sc.label).slice(0, 24), run: sc.run, text: sc.text ? String(sc.text) : '' } : null;
  };
 
  /* ---------- sampaikan lewat emit() lama ---------- */
  P._deliver = function (sig, need, key) {
    var self = this, offer = { key: key, sig: sig, type: sig.type }, acts = [];
    (need.acts || []).forEach(function (a) {
      if (a === 'help') acts.push({ label: need.helpLabel || 'Ya, bantu', on: function () { self._accept(offer); } });
      else if (a === 'run') acts.push({ label: (sig.solution && sig.solution.label) || 'Perbaiki', on: function () { self._accept(offer); } });
      else if (a === 'open') acts.push({ label: sig.openLabel || 'Buka', on: function () { self._hideBubble(); try { sig.open(); } catch (e) {} } });
      else if (a === 'shortcut' && need.shortcut) acts.push({ label: need.shortcut.label, on: function () {      // menekan = persetujuan guru
        self._hideBubble(); self._ignored = 0; self._lastHelpAt = now(); try { need.shortcut.run(); } catch (e) {} } });
      else if (a === 'later') acts.push({ label: 'Nanti', on: function () { self._snooze(offer); } });
    });
    /* Quick action: tombol kontekstual dari pemanggil, HANYA fungsi nyata yang diserahkan ({label, run}). Menekan tombol = persetujuan guru. */
    if (!need.micro) (Array.isArray(sig.actions) ? sig.actions : []).forEach(function (a) {
      if (acts.length < 3 && a && a.label && typeof a.run === 'function')
        acts.push({ label: String(a.label).slice(0, 24), on: function () { self._hideBubble(); try { a.run(); } catch (e) {} } });
    });
    var data = { key: key, behavior: need.behavior,
                 intensity: sig.intensity != null ? sig.intensity : need.intensity };   // sinyal boleh membawa ekspresinya sendiri
    if (!need.micro) { data.response = this._sapa(need.text); data.mood = sig.mood || need.mood; }
    if (sig.el) { data.targetEl = sig.el; data.attention = 'target'; } else data.attention = 'user';
    if (acts.length) { acts._offer = offer; data.actions = acts; }
    var ok = this.emit(need.ev, data);
    if (ok) {
      var t = now();
      this._needSeen[key] = t;
      if (need.micro) { this._microAt = t; this._microN++; }                        // mikro tidak memakai anggaran tawaran
      else {
        if (need.ev === 'need_offer' || need.ev === 'need_remind') { this._lastNeedAt = t; this._lastOffer = { key: key, at: t }; }   // hanya yang proaktif memakai anggaran
        if (need.ev === 'need_offer' || need.ev === 'need_fix') this._lastHelpAt = t;
      }
    }
    return ok;
  };
 
  P._hideBubble = function () {
    this._pendingOffer = null;
    if (!this.bubble) return;
    clearTimeout(this._bubbleT);
    this.bubble.classList.remove('show');
  };
  P._snooze = function (offer) {
    this._hideBubble();
    this._needSnooze[offer.key] = now() + this.cfg.snoozeMs;
    this._lastNeedAt = now();
    this._ignored = Math.min(this._ignored + 1, 3); this._ignoredAt = now();   // v7: menolak = beri ruang lebih lama untuk tawaran berikutnya
    this._ackDecline();
  };
  /* v7: balasan tenang SEKALI saat bantuan ditolak ("Nanti"). Tidak membujuk, tidak menawarkan lagi. */
  P._ackDecline = function () {
    var t = now();
    if (t - (this._ackAt || 0) < 8000) return false;
    this._ackAt = t;
    return this.emit('need_ack', { key: 'ack' + t, behavior: 'senseCalm', mood: 'calm', intensity: 0.3, attention: 'user',
                                   response: this._sapa(pick(LINES.declined)) });
  };
  P._accept = function (offer) {
    this._hideBubble(); this._ignored = 0; this._lastHelpAt = now();
    this._assist(offer);
  };
 
  P._mountActions = function (b, actions) {
    var self = this, wrap = document.createElement('div');
    wrap.className = 'lily-offer';
    wrap.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:auto';
    actions.forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'lily-offer-btn'; btn.textContent = a.label;
      btn.style.cssText = 'font:inherit;font-size:.85em;padding:3px 10px;border-radius:12px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer';
      btn.addEventListener('click', function (e) { e.stopPropagation(); self._pendingOffer = null; try { a.on(); } catch (err) {} });
      wrap.appendChild(btn);
    });
    b.appendChild(wrap);
  };
 
  /* Guru menekan "Ya": solusi tercepat dulu (lokal), AI paling akhir. */
  P._assist = function (offer) {
    var self = this, sig = offer.sig;
    if (sig.solution && typeof sig.solution.run === 'function') {                    // 1) solusi sudah disediakan halaman
      var show = function (v) {
        if (typeof v === 'string' && v) self.applyAI({ mood: 'focused', behavior: 'senseFix', attention: 'user', response: self._sapa(v), intensity: 0.6 });
        else if (v === true) self.applyAI({ mood: 'happy', behavior: 'senseGood', attention: 'user', response: self._sapa(pick(LINES.good)), intensity: 0.45 });
        else if (v === false) self.applyAI({ mood: 'apologetic', behavior: 'observe', attention: 'user', response: self._sapa('Maaf, Pak/Bu, itu belum berhasil. Coba sekali lagi ya.') });
      };
      var r; try { r = sig.solution.run(); } catch (e) { r = false; }
      if (r && typeof r.then === 'function') r.then(show, function () { show(false); }); else show(r);
      return;
    }
    if (this.onHelp) { try { if (this.onHelp(sig) !== false) return; } catch (e) {} }   // 2) halaman yang menangani (mis. buka chat/pencarian)
    if (sig.reason === true && Array.isArray(sig.facts) && sig.facts.length) {       // 3) perlu reasoning, ada fakta nyata -> AI (1x, cache & kuota ikut aturan lama)
      var head = { struggle: 'Guru tampak kesulitan', hesitate: 'Guru ragu saat mengisi', lost: 'Guru sedang mencari sesuatu',
                   mistake: 'Guru mengalami kendala', pending: 'Guru punya tugas belum selesai' }[sig.type] || 'Guru butuh bantuan';
      var facts = sig.facts.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 5);
      if (facts.length) { this.reactToText(head + (sig.what ? ' (' + String(sig.what).slice(0, 40) + ')' : '') + '. ' + facts.join('. ') + '. Bantu singkat.'); return; }
    }
    var ask = { confusion: 'Boleh sebut tujuannya, Pak/Bu? Nanti Lily bantu cari jalurnya.',
                lost: 'Lagi cari apa, Pak/Bu? Sebut saja kata kuncinya, nanti Lily bantu.' }[sig.type];
    this.applyAI({ mood: 'curious', behavior: 'observe', attention: 'user',          // 4) belum cukup info: tanya, jangan menebak
                   response: this._sapa(ask || 'Aku belum yakin bagian mana yang kamu maksud. Mau aku bantu cari?') });
  };
 
  /* ---------- sensor lokal ---------- */
  P._labelOf = function (el) {
    try {
      var s = el.getAttribute('aria-label') || '';
      if (!s && el.id) { var l = document.querySelector('label[for="' + (global.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) s = l.textContent; }
      if (!s && el.closest) { var cl = el.closest('label'); if (cl) s = cl.textContent; }
      if (!s) s = el.getAttribute('placeholder') || el.getAttribute('title') || '';
      if (!s && /^(BUTTON|A)$/.test(el.tagName)) s = el.textContent;
      return String(s).replace(/\s+/g, ' ').trim().slice(0, 40);
    } catch (e) { return ''; }
  };
  P._elKey = function (el) { return el.getAttribute('data-lily-key') || el.id || (el.tagName + ':' + this._labelOf(el).toLowerCase()); };
  P._ignoredEl = function (el) {
    if (!el || !el.closest) return true;
    if (this.root && this.root.contains(el)) return true;             // jangan menilai tombol Lily sendiri
    return !!el.closest('[data-lily-ignore]');
  };
  P._isSearchField = function (el) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
    if (el.type === 'password') return false;
    if (el.type === 'search' || (el.closest && el.closest('[role=search]'))) return true;
    return /cari|search|temukan/i.test([el.id, el.name, el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' '));
  };
  P._eligibleField = function (el) {
    if (this._ignoredEl(el) || el.disabled || el.readOnly || this._isSearchField(el)) return false;
    if (el.tagName === 'SELECT') return true;
    if (el.tagName === 'TEXTAREA') return !!el.required;               // menulis bebas wajar lama; hanya yang wajib diisi
    if (el.tagName !== 'INPUT') return false;
    return !/^(button|submit|reset|checkbox|radio|hidden|password|file|range|color|image)$/i.test(el.type || 'text');
  };
 
  P._hesClear = function () { clearTimeout(this._hesT); clearTimeout(this._hesMT); this._hesT = 0; this._hesMT = 0; };
 
  /* Lily senggang: idle, atau hanya sedang memainkan mikro-ekspresi (tawaran boleh menggantikannya langsung). */
  P._calm = function () { return this.cur.name === 'idle' || /^micro/.test(this.cur.name); };
 
  /* Tombol yang wajar ditekan berulang (halaman berikut, +/-, tambah baris): bukan kesulitan, bukan pengulangan yang perlu pintasan. */
  P._benignRepeat = function (el) {
    try {
      if (el.closest('[data-lily-repeat-ok],[rel=next],[rel=prev],.pagination,[role=tablist],[aria-pressed],[aria-expanded],[role=switch]')) return true;
      var lb = (this._labelOf(el) || '').toLowerCase();
      return /^(\+|-|\u2212|tambah|kurang|next|prev|berikut|sebelum|lanjut|kembali|\u203A|\u2039|\u00BB|\u00AB|<|>)/.test(lb);
    } catch (e) { return false; }
  };
 
  /* Jejak menu untuk CONFUSION: hanya hash tujuan + waktu (sessionStorage, per tab), tanpa isi halaman/kolom. Halaman penuh yang
   * berpindah tidak menghapus jejak; yang menghapusnya: mengetik di kolom, mengirim form, atau jeda lama (kedaluwarsa). */
  P._navLoad = function () {
    try { var a = JSON.parse(global.sessionStorage.getItem('lily_nav_v1') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };
  P._navSave = function (a) {
    a = a.slice(-8); this._navN = a.length;
    try { global.sessionStorage.setItem('lily_nav_v1', JSON.stringify(a)); } catch (e) {}
  };
  P._navClear = function () {
    if (!this._navN) return;
    this._navN = 0;
    try { global.sessionStorage.removeItem('lily_nav_v1'); } catch (e) {}
  };
  P._navNote = function (el, t) {
    var self = this;
    try {
      if (!el.closest || !el.closest(NAV_SEL)) return;
      var a = el.closest('a'), href = a ? String(a.getAttribute('href') || '') : '';
      var k = fnv((href || this._labelOf(el)).split(/[?#]/)[0], 2166136261).toString(36);
      var tr = this._navLoad().filter(function (x) { return t - x.t < self.cfg.navWindow; });
      tr.push({ k: k, t: t });
      this._navSave(tr);
      setTimeout(function () { self._navEval(); }, 400);   // SPA: dievaluasi di sini; halaman penuh yang pindah: dievaluasi saat halaman baru dimuat
    } catch (e) {}
  };
  P._navEval = function () {
    var c = this.cfg, t = now(), tr = this._navLoad().filter(function (x) { return t - x.t < c.navWindow; });
    if (tr.length < c.navMin - 1) return;
    var run = [], prev = null, j, seen = {}, n = 0;
    for (j = tr.length - 1; j >= 0; j--) {                  // hanya rangkaian terakhir yang rapat (jeda <= navGap); jeda lama = sedang membaca
      if (prev !== null && prev - tr[j].t > c.navGap) break;
      run.unshift(tr[j]); prev = tr[j].t;
    }
    run.forEach(function (x) { if (!seen[x.k]) { seen[x.k] = 1; n++; } });
    if (this._act && this._act.lastKey > run[0].t) return;   // mengetik setelah mulai berpindah = ada progres
    if (n >= c.navMin) { this._navClear(); this.sense({ type: 'confusion', key: 'nav' }); }
    else if (n === c.navMin - 1) this.sense({ type: 'confusion', level: 1, key: 'nav' });
  };
 
  P._trackErr = function () {
    var self = this, t = now();
    this._errs = this._errs.filter(function (x) { return t - x < 180000; }).concat(t);
    if (this._errs.length >= 3) {
      this._errs = [];
      setTimeout(function () {                                         // tunggu reaksi 'apologize' selesai dulu
        self.sense({ type: 'error', key: 'errors' });
      }, 6000);
    }
  };
 
  P._onSearchInput = function (el) {
    var self = this;
    this.emit('teacher_searching', { targetEl: el, attention: 'target', key: 'srch_' + Math.floor(now() / 20000) });   // menatap kolom, diam
    clearTimeout(this._srchT);
    this._srchT = setTimeout(function () {
      var v = normText(el.value);
      if (v.length < 2) return;
      var t = now(), h = fnv(v, 2166136261).toString(36);               // hanya hash, isi pencarian tidak disimpan
      self._srch = self._srch.filter(function (x) { return t - x.t < 45000; });
      if (!self._srch.some(function (x) { return x.h === h; })) self._srch.push({ h: h, t: t });
      if (self._srch.length >= 3) { self._srch = []; self.sense({ type: 'lost', key: 'search', el: el }); }   // 3 kata kunci beda dalam 45 dtk
      else if (self._srch.length === 2) self.sense({ type: 'searching', level: 1, key: 'search', el: el });   // v7: kata kunci ke-2 = sinyal kecil, hanya melirik
    }, 1500);
  };
 
  P._sensors = function () {
    if (typeof document === 'undefined') return;
    var self = this, ac = this._act, clicksBy = {}, repBy = {};
    var trim = function (a, t) { while (a.length && t - a[0] > 6000) a.shift(); };
 
    document.addEventListener('keydown', function () {
      var t = now(); ac.lastKey = t; ac.keys.push(t); trim(ac.keys, t); self._hesClear();
    }, true);
 
    document.addEventListener('click', function (e) {
      var t = now(); ac.clicks.push(t); trim(ac.clicks, t);
      var el = e.target && e.target.closest ? e.target.closest('button,a,[role=button],input[type=submit],input[type=button]') : null;
      if (!el || self._ignoredEl(el)) return;
      self._navNote(el, t);                                             // v7: jejak menu (CONFUSION)
      if (self._benignRepeat(el)) return;                               // v7: tombol yang wajar ditekan berulang bukan masalah
      var kk = self._elKey(el), lab = self._labelOf(el);
      var arr = (clicksBy[kk] || []).filter(function (x) { return t - x < 3000; }); arr.push(t); clicksBy[kk] = arr;
      if (arr.length >= self.cfg.clickBurst) {                          // klik berulang di tombol yang sama = kemungkinan tidak merespons
        clicksBy[kk] = [];
        self.sense({ type: 'struggle', key: 'click|' + kk, el: el, what: lab });
      } else if (arr.length === self.cfg.clickMicro) {                  // v7: baru 3 klik cepat = sinyal kecil, hanya melirik
        self.sense({ type: 'struggle', level: 1, key: 'click|' + kk, el: el });
      }
      var rp = (repBy[kk] || []).filter(function (x) { return t - x < self.cfg.repeatWindow; });   // v7: REPEAT = diulang pelan-pelan dalam waktu lama
      if (!rp.length || t - rp[rp.length - 1] >= 700) rp.push(t);       // klik cepat itu urusan 'struggle', bukan 'repeat'
      repBy[kk] = rp;
      if (rp.length >= self.cfg.repeatMin) { repBy[kk] = []; self.sense({ type: 'repeat', key: 'rep|' + kk, el: el, what: lab }); }
    }, true);
 
    document.addEventListener('focusin', function (e) {
      var el = e.target;
      self._hesClear();
      if (!el || !el.tagName || !self._eligibleField(el) || self._hesN >= self.cfg.hesitateMax) return;
      self._hesMT = setTimeout(function () {                            // v7: diam agak lama di kolom kosong = sinyal kecil, hanya memperhatikan
        if (document.hidden || el !== document.activeElement || String(el.value || '') !== '') return;
        self.sense({ type: 'stuck', level: 1, key: 'f|' + self._elKey(el), el: el });
      }, self.cfg.stuckMicroAfter);
      self._hesT = setTimeout(function () {
        if (document.hidden || el !== document.activeElement || String(el.value || '') !== '') return;   // sudah diisi / pindah: bukan bingung
        self._hesN++;
        self.sense({ type: 'hesitate', key: 'f|' + self._elKey(el), el: el, what: self._labelOf(el) });
      }, self.cfg.hesitateAfter);
    }, true);
    document.addEventListener('focusout', function () { self._hesClear(); }, true);
 
    document.addEventListener('input', function (e) {
      var el = e.target;
      self._hesClear(); self._navClear();                               // mengetik = ada progres
      if (el && !self._ignoredEl(el) && self._isSearchField(el)) self._onSearchInput(el);
    }, true);
    document.addEventListener('submit', function () { self._navClear(); }, true);
 
    /* validasi form gagal: pesan resmi dari browser (nyata, bukan karangan) + tatapan ke kolomnya */
    document.addEventListener('invalid', function (e) {
      var el = e.target;
      if (!el || !el.validationMessage || self._ignoredEl(el)) return;
      var lb = self._labelOf(el);
      self.sense({ type: 'mistake', key: 'invalid|' + self._elKey(el), el: el,
                   solution: { text: (lb ? 'Bagian "' + lb + '": ' : '') + el.validationMessage },
                   actions: [{ label: 'Ke kolomnya', run: function () {          // hanya memindahkan fokus; tidak mengirim/mengubah isi form
                     try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); } catch (e) {}
                   } }] });
    }, true);
 
    global.addEventListener('offline', function () {
      self._wasOffline = true;
      self.sense({ type: 'mistake', key: 'offline', solution: { text: 'Koneksi internet terputus, Pak/Bu. Coba cek Wi-Fi atau data selulernya.' } });
    });
    global.addEventListener('online', function () {
      if (!self._wasOffline) return;
      self._wasOffline = false;
      self.applyAI({ mood: 'relieved', behavior: 'relieved', attention: 'user', response: self._sapa('Sudah tersambung lagi, Pak/Bu.') });
    });
    setTimeout(function () { self._navEval(); }, 1800);                 // v7: halaman baru dimuat -> baca jejak menu dari halaman sebelumnya
  };
 
  /* ---------------- integrasi AI (backend /api/scorus-ai/lily) ---------------- */
  var KEY_FALLBACK = [
    [/terima kasih|makasih|thanks/i, { mood: 'grateful', behavior: 'thank' }],
    [/selesai|beres|berhasil|lulus|tercapai/i, { mood: 'excited', behavior: 'celebrate' }],
    [/error|gagal|rusak|tidak bisa|ga bisa|gak bisa/i, { mood: 'concerned', behavior: 'apologize' }],
    [/banyak|numpuk|deadline|pusing|lelah|capek/i, { mood: 'concerned', behavior: 'encourage' }],
    [/\?$|bingung|maksudnya/i, { mood: 'curious', behavior: 'observe' }]
  ];
  /* Metadata balasan untuk chat history: source = local | cache | ai; message_type = assistant_local | assistant_ai | api_exhausted. */
  P._reply = function (meta) {
    this.lastReply = meta;
    if (this.onReply) { try { this.onReply(meta); } catch (e) {} }
  };
  P._exhaustedReply = function () {
    this._reply({ source: 'local', message_type: 'api_exhausted', lily_expression: 'concerned', counts_as_usage: false });
    return { mood: 'concerned', behavior: 'apologize', attention: 'user', response: API_STATE.text || EXHAUSTED_TEXT };
  };
  P.apiExhausted = function () { return !!apiExhausted(); };
  P.setApiExhausted = function (on) { API_STATE.exhaustedAt = on ? now() : 0; };   // mis. dari status server saat halaman dimuat
 
  P.reactToText = function (text) {
    var self = this, norm = normText(text);
    var fallback = function () {
      for (var i = 0; i < KEY_FALLBACK.length; i++) if (KEY_FALLBACK[i][0].test(text)) return KEY_FALLBACK[i][1];
      return { mood: 'normal', behavior: 'observe' };
    };
    // 0) v7: guru menolak tawaran yang barusan muncul ("nanti", "belum", "tidak usah dulu"): hormati, jangan ditawari lagi, tanpa AI
    var lo = this._lastOffer;
    if (lo && now() - lo.at < 90000 && DECLINE_RE.test(norm.replace(/[,;.!]/g, '').replace(/\s+/g, ' ').trim())) {
      this._lastOffer = null; this._hideBubble();
      this._needSnooze[lo.key] = now() + this.cfg.snoozeMs; this._lastNeedAt = now();
      this._ignored = Math.min(this._ignored + 1, 3); this._ignoredAt = now();
      this._aiBegin();
      this._reply({ source: 'local', message_type: 'assistant_local', lily_expression: 'calm', counts_as_usage: false });
      this.applyAI({ mood: 'calm', behavior: 'senseCalm', attention: 'user', response: this._sapa(pick(LINES.declined)), intensity: 0.3 });
      return Promise.resolve();
    }
    // 1) intent lokal (greeting/terima kasih): tanpa fetch, tanpa Gemini
    var li = localIntent(norm);
    if (li) {
      this._aiBegin();
      this._reply({ source: 'local', message_type: 'assistant_local', lily_expression: li.mood, counts_as_usage: false });
      this.applyAI({ mood: li.mood, behavior: li.behavior, attention: 'user', response: this._sapa(pick(li.lines)) });
      return Promise.resolve();
    }
    // 2) cache sesi (exact match, hasil yang sama persis). Dicek SEBELUM status API habis, sama seperti server:
    //    jawaban cache gratis, jadi tidak perlu dibalas "token habis".
    var hit = this._txtCache[norm];
    if (hit && now() - hit.at < CACHE_TTL) {
      this._aiBegin();
      this._reply({ source: 'cache', message_type: hit.d.message_type || 'assistant_ai', lily_expression: hit.d.mood, counts_as_usage: false });
      this.applyAI(hit.d);
      return Promise.resolve();
    }
    // 3) API habis: langsung fallback lokal (concerned), jangan menghubungi server lagi sampai TTL lewat
    if (apiExhausted()) { this._aiBegin(); this.applyAI(this._exhaustedReply()); return Promise.resolve(); }
    // 4) backend, satu kali (tanpa retry); request identik yang sedang berjalan dibagi
    if (this._txtInflight[norm]) return this._txtInflight[norm];
    if (this.cur.pri === PRI.ai) this._finish(this.cur.id);   // pertanyaan baru: reaksi jawaban sebelumnya selesai (prioritas 'ai' > 'processing' akan membuang alur proses)
    var seq = this._aiBegin();
    this.emit('ai_start', { key: 'q' + now() });   // key unik: tanpa ini, pertanyaan ke-2 dalam 30 dtk dibuang filter duplikat -> tanpa animasi proses
    var finish = function (r, pose) { self._aiSettle(seq, function () { self.emit('ai_done'); self.applyAI(r, pose ? { pose: pose } : null); }); };
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    var pr = fetch(this.endpoint, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, d: j }; },
                           function () { return { ok: r.ok, status: r.status, d: null }; });
    }).then(function (x) {
      clearTimeout(to);
      if (isExhausted(x.d, x.status)) { API_STATE.exhaustedAt = now(); API_STATE.text = (x.d && typeof x.d.response === 'string') ? x.d.response : ''; finish(self._exhaustedReply()); return; }
      if (x.ok && x.d && x.d.mood) {
        var fromCache = !!(x.d.cached || x.d.cache_hit);
        self._reply({ source: fromCache ? 'cache' : 'ai', message_type: x.d.message_type || 'assistant_ai', lily_expression: x.d.mood, counts_as_usage: !fromCache });
        if (!x.d.no_cache && !x.d.personal) {            // jangan simpan balasan yang ditandai personal / no_cache
          var ks = Object.keys(self._txtCache);
          if (ks.length >= CACHE_MAX) delete self._txtCache[ks[0]];
          self._txtCache[norm] = { d: x.d, at: now() };
        }
        finish(x.d, self._answerPose(x.d));
      } else {
        self._reply({ source: 'local', message_type: 'assistant_local', lily_expression: fallback().mood, counts_as_usage: false });
        finish(fallback(), POSE_FLOW.lost ? 'lost' : null);
      }
    }).catch(function () {
      clearTimeout(to);
      var fb = fallback();
      self._reply({ source: 'local', message_type: 'assistant_local', lily_expression: fb.mood, counts_as_usage: false });
      finish(fb, POSE_FLOW.lost ? 'lost' : null);
    }).then(function () { delete self._txtInflight[norm]; });
    this._txtInflight[norm] = pr;
    return pr;
  };
 
  /* Terima {mood, attention, behavior, response, intensity?} dari AI. Prioritas 'ai'.
   * API hanya mengirim state semantik; frontend yang memetakan mood -> ekspresi -> mata -> gesture -> animasi. */
  P.applyAI = function (d, opt) {
    if (!d) return;
    var beh = BEH_ALIAS[d.behavior] || d.behavior;
    if (!BEHAVIORS[beh] || beh === 'think') beh = 'observe';
    var name = '__ai_' + now();
    if (STRESS[d.mood]) this.ctx.stressedAt = now();   // hanya dari sinyal AI nyata, bukan memori karangan
    EVENTS[name] = { pri: 'ai', cd: 0, behavior: beh };
    this.emit(name, { mood: d.mood, attention: d.attention || 'user', response: d.response, behavior: beh,
                      intensity: d.intensity, pose: opt && opt.pose, key: name });
    delete EVENTS[name];
  };
 
  /* ---------------- foto profil: Lily "melihat" foto lewat backend; gagal -> kalimat lokal ---------------- */
  P._postPhoto = function (body, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 16000);
    return fetch(this.photoEndpoint, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(to);
      return r.json().then(function (j) {
        if (isExhausted(j, r.status)) { API_STATE.exhaustedAt = now(); API_STATE.text = (j && typeof j.response === 'string') ? j.response : ''; return { success: false, exhausted: true }; }
        if (r.ok) return j;
        return { success: false, status: r.status, kode: (j && j.kode) || '' };   // gagal biasa (429/400/502): pemanggil memilih kalimat yang jujur
      }, function () { return r.ok ? null : { success: false, status: r.status, kode: '' }; });
    }).catch(function () { clearTimeout(to); return null; });
  };
 
  /* ---- Analisis foto LOKAL (browser saja, tanpa server/API AI): profile_photo_analyzer.js + lily_photo_reactions.js.
   * Dimuat malas saat foto pertama kali diganti; bila gagal dimuat -> resolve(null) dan kalimat lokal lama dipakai. ---- */
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var el = document.createElement('script');
      el.src = src; el.async = true; el.onload = ok;
      el.onerror = function () { el.remove(); fail(new Error('load ' + src)); };
      document.head.appendChild(el);
    });
  }
  var _photoLibP = null;
  P._loadPhotoLib = function () {
    if (global.ProfilePhotoAnalyzer && global.LilyPhotoReaction) return Promise.resolve(true);
    if (!_photoLibP) {
      _photoLibP = loadScript(SCRIPT_BASE + 'profile_photo_analyzer.js')
        .then(function () { return loadScript(SCRIPT_BASE + 'lily_photo_reactions.js'); })
        .then(function () { return true; })
        .catch(function () { _photoLibP = null; return false; });
    }
    return _photoLibP;
  };
  P._analyzePhotoLocal = function (img) {
    var self = this;
    return this._loadPhotoLib().then(function (ok) {
      return ok ? global.ProfilePhotoAnalyzer.analyze(img, { debug: self.debug }) : null;
    }).catch(function () { return null; });
  };
 
  /* ---- Riwayat foto RINGAN (localStorage, per browser; opsional per akun lewat o.userKey).
   * Yang disimpan hanya metadata: photoFingerprint -> {firstSeen, lastSeen, timesUsed, category, spokeAt}. Foto asli tidak disimpan. ---- */
  P._photoLoad = function (userKey) {
    var key = PHOTO_KEY + (userKey ? ':' + userKey : '');
    if (this._photoHist && this._photoHistKey === key) return this._photoHist;
    var h = null;
    try { h = JSON.parse(global.localStorage.getItem(key) || 'null'); } catch (e) {}
    if (!h || typeof h !== 'object' || !h.items) h = { items: {}, lastFp: null, lastChangeAt: 0, lastSpokeAt: 0, recent: [], cool: {} };
    h.recent = h.recent || []; h.cool = h.cool || {};
    this._photoHist = h; this._photoHistKey = key;
    return h;
  };
  P._photoSave = function () {
    var h = this._photoHist; if (!h) return;
    var ks = Object.keys(h.items);
    if (ks.length > PHOTO_MAX) {                       // buang yang paling lama tidak terlihat
      ks.sort(function (a, b) { return h.items[a].lastSeen - h.items[b].lastSeen; });
      ks.slice(0, ks.length - PHOTO_MAX).forEach(function (k) { delete h.items[k]; });
    }
    try { global.localStorage.setItem(this._photoHistKey, JSON.stringify(h)); } catch (e) {}   // gagal simpan = aman, hanya tanpa riwayat
  };
 
  /* Catat bahwa foto ini baru dipasang. Hasil: {fp, kind: pertama|baru|balik|langganan, times, cat, gantiLagi, sama}. */
  P._photoVisit = function (img, o) {
    var h = this._photoLoad(o.userKey), t = now();
    var fp = o.fingerprint || o.fp || o.hash || fingerprintOf(img);
    var v = { fp: fp, kind: o.pertama ? 'pertama' : 'baru', times: 1, cat: null, gantiLagi: false, sama: false };
    if (!fp) return v;                                  // tanpa fingerprint: tetap bereaksi, hanya tanpa riwayat
    if (fp === h.lastFp) { v.sama = true; v.kind = 'baru'; var i0 = h.items[fp]; if (i0) v.cat = i0.category || null; return v; }   // foto sama dengan yang terpasang: tetap dikomentari (kalimat 'sama'), hanya tanpa analisis ulang
    v.gantiLagi = !!o.lagi || (h.lastChangeAt && t - h.lastChangeAt < 600000);
    var it = h.items[fp];
    if (it) {
      it.timesUsed = (it.timesUsed || 1) + 1; it.lastSeen = t;
      v.times = it.timesUsed; v.cat = it.category || null;
      v.kind = v.times >= 3 ? 'langganan' : 'balik';
    } else {
      h.items[fp] = { firstSeen: t, lastSeen: t, timesUsed: 1, category: null };
    }
    h.lastFp = fp; h.lastChangeAt = t;
    this._photoSave();
    return v;
  };
 
  /* Pilih kalimat sesuai riwayat + kategori. SELALU mengembalikan kalimat: riwayat/cooldown hanya dipakai agar kalimat tidak berulang
   * (same_response_cooldown), bukan untuk membuat Lily diam. */
  P._photoLine = function (v, cat) {
    var h = this._photoHist || this._photoLoad(), t = now();
    var it = v.fp ? h.items[v.fp] : null;
    if (it && cat && cat !== 'unknown') it.category = cat;
    var pool, pn, r = Math.random();
    /* Catatan: kalimat 'booster' (mis. "jangan lupa minum") tidak dipakai di sini lagi -- reaksi foto harus tentang fotonya. */
    if (cat === 'maskot') {
      pn = 'maskot';
    } else if (v.sama) {
      pn = 'sama';
    } else if (v.kind === 'langganan' && r < 0.45 && t - (h.cool.langganan || 0) > 600000) {
      pn = 'langganan'; h.cool.langganan = t;
    } else if (v.kind === 'balik' && r < 0.7) {
      pn = 'balik';
    } else if (v.kind === 'pertama' && r < 0.6) {
      pn = 'pertama';
    } else if (v.gantiLagi && Math.random() < 0.45) {
      pn = 'gantiLagi';
    } else if (!cat || cat === 'unknown' || !PHOTO_LINES[cat]) {
      pn = Math.random() < 0.5 ? 'unknown' : 'baru';
    } else {
      pn = Math.random() < 0.75 ? cat : 'baru';
    }
    pool = PHOTO_LINES[pn];
    this._photoPool = pn;                                                                  // dibaca _photoMood: mood mengikuti nada kalimat yang terpilih
    var fresh = pool.filter(function (x) { return h.recent.indexOf(x) < 0; });
    var line;
    if (fresh.length) line = pick(fresh);
    else {                                                                                 // semua pernah dipakai baru-baru ini: ambil yang paling lama
      line = pool[0]; pool.forEach(function (x) { if (h.recent.indexOf(x) < h.recent.indexOf(line)) line = x; });
    }
    h.recent = h.recent.filter(function (x) { return x !== line; }); h.recent.push(line);
    if (h.recent.length > 14) h.recent.shift();
    h.lastSpokeAt = t; if (it) it.spokeAt = t;
    this._photoSave();
    return line;
  };
 
  /* Guru memasang foto baru. Dipanggil UI saat foto benar-benar terpasang = tahap SUCCESS dari lifecycle.
   * img = data-URL kecil; o = {targetEl, pertama, lagi, ukur, fingerprint?, userKey?, onData(d), useVisionAI, maskot?, fileName?}.
   * Analisis foto 100% lokal. Jalur AI-vision lama HANYA aktif bila o.useVisionAI === true atau window.LILY_PHOTO_VISION_AI === true.
   * Setiap foto baru WAJIB menghasilkan reaksi + kalimat (tidak ada cooldown yang membuat Lily diam). Foto maskot Lily sendiri -> respons khusus
   * (dikenali dari o.maskot / nama file / kemiripan piksel dengan sprite Lily).
   * Bila lifecycle (photoFlow) sudah berjalan, hasilnya diputar sebagai tahap 'success'; bila tidak: menatap avatar -> komentar. */
  P.reactToPhoto = function (img, o) {
    o = o || {};
    var self = this, t0 = now(), el = o.targetEl || null, att = el ? 'avatar' : 'user';
    var useAI = o.useVisionAI === true || global.LILY_PHOTO_VISION_AI === true;
    var flow = this._pfActive();
    if (el) this._pfEl = el;
    var v;
    try { v = this._photoVisit(img, o); } catch (e) { v = { fp: null, kind: o.pertama ? 'pertama' : 'baru', cat: null, gantiLagi: !!o.lagi, sama: false }; }
    var ctx = this._photoCtx = { fp: v.fp, cat: v.cat || null, ukur: o.ukur || null, kind: v.kind, at: t0 };   // dasar jawaban lokal askPhoto (tanpa mengarang)
 
    // satu-satunya yang boleh diam: pemicu GANDA dari UI untuk foto yang sama, sementara reaksi untuk perubahan itu baru saja dimulai (<3 dtk)
    if (v.sama && !flow && this._photoReactAt && t0 - this._photoReactAt < 3000) { this._log('pemicu ganda foto sama diabaikan'); return Promise.resolve(); }
    this._photoReactAt = t0;
    var tok = this._photoTok = (this._photoTok || 0) + 1;   // foto yang lebih baru menggantikan reaksi yang masih menunggu (bukan saling timpa)
 
    if (!flow) this.emit('photo_look', { key: 'look_' + t0, targetEl: el || undefined, attention: att });
    // tanpa lifecycle: beri waktu tatapan ~2 dtk sebelum komentar; dengan lifecycle: tahap sebelumnya sudah dijaga photoFlow
    var wait = flow ? 0 : 2200;
    var later = function (fn) { setTimeout(function () { if (tok === self._photoTok) fn(); }, Math.max(0, wait - (now() - t0))); };
    // kirim satu reaksi: lewat lifecycle bila (masih) aktif, kalau tidak / ditolak -> event langsung. Tidak ada jalur yang berakhir tanpa reaksi.
    var kirim = function (d) {
      var cat = d.cat || ctx.cat || 'unknown';
      var resp = self._sapa(String(d.response));
      // mood = fungsi dari KONTEKS (kategori, pool kalimat/riwayat, data terukur, kalimat itu sendiri) -- bukan acak
      var mood = self._photoMood(cat, d.mood, { pool: d.pool, line: d.response, ukur: o.ukur, rx: d.moods, rxKat: d.rxKat, trust: d.trust });
      var khusus = cat === 'maskot' ? 'photoMascot' : undefined;                       // maskot sendiri: perilaku khusus juga lewat lifecycle
      if (self._pfActive() && self.photoFlow('success', { response: resp, mood: mood, behavior: khusus, targetEl: el || undefined })) return;
      var beh = khusus || self._photoBehavior(d.behavior, cat), name = '__foto_' + now() + '_' + (++self._pfN);
      EVENTS[name] = { pri: 'interaction', cd: 0, behavior: beh, flow: 'photo' };
      self.emit(name, { mood: mood, response: resp, behavior: beh, attention: att, targetEl: el || undefined, key: name });
      delete EVENTS[name];
    };
    // pilih kalimat; mood/animasi dari sistem reaksi yang sudah ada (rx) bila tersedia, divariasikan agar tidak sama terus
    var ucap = function (cat, rx) {
      var line = null, pool;
      self._photoPool = null;
      try { line = self._photoLine(v, cat); } catch (e) {}
      if (!line) { line = pick(PHOTO_LINES.baru); self._photoPool = 'baru'; }
      pool = self._photoPool;                           // dicatat sekarang: kirim() berjalan setelah jeda tatapan
      ctx.cat = cat;
      later(function () { kirim({ cat: cat, pool: pool, moods: rx && rx.moods, rxKat: rx && rx.kategori, behavior: rx && rx.behavior, response: line }); });
    };
    var fallbackLama = function () {                    // analyzer gagal/tidak ada: kalimat dari bank + riwayat; isi foto tak diketahui -> mood penasaran/memperhatikan
      ucap(v.sama && v.cat ? v.cat : 'unknown', null);
    };
 
    // foto yang kategorinya sudah tersimpan (balik/langganan/sama): tak perlu dianalisis ulang
    var cached = v.cat === 'maskot';
    var skip = (v.kind === 'balik' || v.kind === 'langganan' || v.sama) && !!v.cat;
    // analyzer yang tak kunjung selesai (script gagal dimuat/hang) tidak boleh membuat Lily menunggu selamanya
    var batas = new Promise(function (ok) { setTimeout(function () { ok(null); }, 4000); });
    var pLily = cached ? Promise.resolve(true) : this._isLilyPhoto(img, o);
    var pRes = (skip || cached) ? Promise.resolve(null) : Promise.race([this._analyzePhotoLocal(img), batas]);
    return Promise.all([pLily, pRes]).then(function (a) {
      if (a[0]) return { lily: true };
      if (!useAI || skip || apiExhausted()) return { res: a[1], d: null };
      return self._postPhoto({ mode: 'kesan', image: img, ukur: o.ukur || null, sebelumnya: o.sebelumnya || [] })
        .then(function (d) { return { res: a[1], d: d }; });
    }).then(function (r) {
      var d = r.d;
      if (r.lily) {                                         // foto = maskot Lily sendiri: respons khusus
        self._log('foto = maskot Lily');
        ucap('maskot', null);
      } else if (d && d.success && d.response) {            // (opsional, default MATI) jawaban AI-vision
        if (typeof o.onData === 'function') { try { o.onData(d); } catch (e) {} }
        later(function () { kirim({ cat: 'unknown', mood: d.mood, trust: true, response: d.response, behavior: 'photoReact' }); });
      } else if (skip) {
        ucap(v.cat, null);
      } else if (r.res && global.LilyPhotoReaction) {       // hasil analisis lokal -> mood + animasi (sistem lama) + kalimat (bank baru)
        var rx = null;
        try { rx = global.LilyPhotoReaction.build(r.res); } catch (e) {}
        var cat = kategoriLily(r.res);
        if (cat === 'unknown') rx = null;                // keyakinan rendah/tak dikenal: jangan pakai mood/animasi dari kategori mentah (tidak menebak isi foto)
        self._log('photo local', r.res.kategori, r.res.sumber, '->', cat, 'kind', v.kind);
        ucap(cat, rx);
      } else {
        fallbackLama();
      }
    }).catch(function () { fallbackLama(); });
  };
 
  /* Mood foto: ditentukan KONTEKS, bukan acak.
   * ctx = {pool: nama pool kalimat dari _photoLine, line: kalimat mentah, ukur: data warna terukur, rx: daftar mood dari analyzer (berurutan), rxKat: kategori analyzer (kunci putaran), trust: pref = mood AI-vision}.
   * Sumber kandidat (berurutan): kalimat maskot > pool riwayat (sama/balik/langganan/...) > daftar mood analyzer (kategori terperinci) > CAT_MOOD[kategori].
   * Lalu: (1) data terukur menggeser mood yang cocok ke depan (hanya satu/dua/alam), (2) mood yang bertentangan dengan kalimat dibuang (coherentMood),
   * (3) dipilih lewat putaran per-konteks yang melewati mood foto sebelumnya: konteks sama -> bergantian lewat semua mood yang cocok, tanpa Math.random. */
  P._photoMood = function (cat, pref, ctx) {
    ctx = ctx || {};
    var last = this._lastPhotoMood, line = ctx.line ? String(ctx.line) : '';
    var ok = function (m) { return MOODS.indexOf(m) >= 0; };
    var list, key = (ctx.pool && POOL_MOOD[ctx.pool]) ? ctx.pool : (ctx.rxKat || cat || 'unknown'), mi = cat === 'maskot' || ctx.pool === 'maskot' ? PHOTO_LINES.maskot.indexOf(line) : -1;
    if (cat === 'maskot' || ctx.pool === 'maskot') {
      list = (mi >= 0 ? [MASKOT_MOOD[mi]] : []).concat(CAT_MOOD.maskot);
      key = 'maskot';
    } else if (ctx.pool && POOL_MOOD[ctx.pool]) {
      list = POOL_MOOD[ctx.pool].slice();
    } else {
      var rxl = (cat !== 'unknown' && ctx.rx && ctx.rx.length) ? ctx.rx.filter(ok) : [];
      list = (rxl.length ? rxl : (CAT_MOOD[cat] || CAT_MOOD.unknown)).slice();
      var um = ukurMood(ctx.ukur);
      if ((cat === 'satu' || cat === 'dua' || cat === 'alam') && um && list.indexOf(um) > 0) { list.splice(list.indexOf(um), 1); list.unshift(um); }
    }
    if (ctx.trust && ok(pref)) list.unshift(pref);
    var f = list.filter(function (m, i) { return ok(m) && list.indexOf(m) === i && coherentMood(line, m) === m; });
    if (!f.length) f = [coherentMood(line, list[0]) || 'warm'];
    var rot = this._photoRot = this._photoRot || {}, n = key === 'maskot' ? 0 : (rot[key] || 0), m = f[n % f.length], i;   // maskot: mood terikat kalimatnya, bukan putaran
    for (i = 0; i < f.length; i++) { var c = f[(n + i) % f.length]; if (c !== last || f.length === 1) { m = c; break; } }
    rot[key] = n + 1;
    return (this._lastPhotoMood = m);
  };
  /* Animasi foto: dari analyzer bila ada, kalau tidak dari kategori; bila sama dengan yang terakhir dipakai bergantian (deterministik). */
  P._photoBehavior = function (pref, cat) {
    var b = (pref && BEHAVIORS[pref] && pref !== 'photoMascot') ? pref : ((cat === 'banyak' || cat === 'alam' || cat === 'objek' || cat === 'unknown') ? 'photoNotice' : 'photoReact');
    if (b === this._lastPhotoBeh && (b === 'photoReact' || b === 'photoNotice')) b = b === 'photoReact' ? 'photoNotice' : 'photoReact';
    return (this._lastPhotoBeh = b);
  };
 
  /* Gambar Lily sendiri untuk dibandingkan: layer rig yang sedang tampil (body+head+visor+face+eyes+mouth) dan sprite legacy (maks 6). */
  P._lilyImg = function (u) {
    var c = this._lilyImgs = this._lilyImgs || {};
    return c[u] || (c[u] = loadImg(u).catch(function (e) { delete c[u]; throw e; }));
  };
  P._lilyCandidates = function () {
    var self = this, out = [], seen = {}, urls = [], S = this.sprites || {};
    var e = this.rig && this.rig.layered && this.rig._el;
    if (e && e.body && e.head) {
      var ls = [e.body, e.head, e.visor, e.face, e.eyes, e.mouth].filter(function (x) { return x && (x.naturalWidth || 0) > 0 && !(x.style && x.style.opacity === '0'); });
      if (ls.length >= 2) out.push(Promise.resolve(ls));
    }
    ['normal', 'happy', 'wink', 'thinking', 'surprised', 'warm'].concat(Object.keys(S)).forEach(function (k) {
      var u = S[k];
      if (typeof u === 'string' && u && !seen[u] && urls.length < 6) { seen[u] = 1; urls.push(u); }
    });
    if (this.sprite && this.sprite.src && !seen[this.sprite.src] && urls.length < 6) urls.push(this.sprite.src);
    urls.forEach(function (u) { out.push(self._lilyImg(u).then(function (im) { return [im]; }, function () { return null; })); });
    return Promise.all(out).then(function (a) { return a.filter(Boolean); });
  };
  /* Resolve true bila foto = maskot Lily. Tidak pernah reject; batas 2,5 dtk (lewat = bukan maskot, Lily tetap bereaksi lewat jalur biasa). */
  P._isLilyPhoto = function (img, o) {
    o = o || {};
    var self = this;
    if (o.maskot === true || o.isLily === true || o.sumber === 'lily') return Promise.resolve(true);          // petunjuk eksplisit dari UI (mis. memilih avatar bawaan Lily)
    var nm = [o.fileName, o.filename, o.name, o.src].filter(function (x) { return typeof x === 'string'; }).join(' ');
    if (/maskot|mascot|lily[_\-. ]?(sprite|normal|happy|body|head|avatar|rig)/i.test(nm)) return Promise.resolve(true);   // nama "lily.jpg" saja tidak cukup (bisa nama orang)
    if (typeof img !== 'string' || !img || typeof document === 'undefined') return Promise.resolve(false);
    var work = loadImg(img).then(function (pe) {
      var P32 = drawTo([pe], 32, 32, 'stretch'), bs = P32 && borderStat(P32, 32), ph = P32 && hueHist(P32, bs.flat ? bs.rgb : null);
      if (!ph) return false;
      var bg = borderBg(P32, 32), p9 = drawTo([pe], 9, 8, 'stretch');
      if (!p9) return false;
      var pb = dBits(p9);
      return self._lilyCandidates().then(function (cands) {
        var hit = false, best = null;
        cands.forEach(function (els) {
          var S32 = drawTo(els, 32, 32, 'contain'), sh = S32 && hueHist(S32);
          if (!sh) return;
          var sim = histSim(ph, sh), dist = 99;
          ['stretch', 'cover', 'contain'].forEach(function (m) { var dd = drawTo(els, 9, 8, m, bg); if (dd) dist = Math.min(dist, hamming(pb, dBits(dd))); });
          if (!best || sim - dist / 64 > best.sim - best.dist / 64) best = { sim: +sim.toFixed(2), dist: dist };
          if (mascotMatch(dist, sim)) hit = true;
        });
        self._log('maskot?', hit, best);
        return hit;
      });
    });
    var to = new Promise(function (ok) { setTimeout(function () { ok(false); }, 2500); });
    return Promise.race([work, to]).catch(function () { return false; });
  };
 
  /* Varian mikro-ekspresi foto: tidak sama dua kali berturut-turut. */
  P._quietVariant = function () {
    var self = this;
    var pool = ['photoQuiet', 'photoQuietB', 'photoQuietC'].filter(function (x) { return x !== self._lastQuiet; });
    return (this._lastQuiet = pick(pool));
  };
 
  /* ---------------- LIFECYCLE foto profil ----------------
   * open -> selected -> preview -> saving -> success | cancel | error.
   * - Tiap tahap = event sendiri (perilaku + mikro-ekspresi). Tanpa dialog kecuali teks nyata (hasil analisis / pesan error UI).
   * - Tahap yang datang terlalu cepat digabung: yang terbaru menang setelah tahap sebelumnya sempat terlihat (min).
   *   Tahap penutup (success/cancel/error) tidak menunggu lebih dari 700 ms.
   * - Tahap mundur (mis. 'preview' setelah 'saving') dan pemicu ganda <600 ms diabaikan; 'cancel' tanpa sesi diabaikan.
   * - Lifecycle foto dihitung aktivitas guru: Lily tidak tidur / menyapa "Masih di sana?" saat dialog file terbuka. */
  var PF = {
    open:     { ev: 'photo_open',     rank: 1, min: 1400 },
    selected: { ev: 'photo_selected', rank: 2, min: 1800 },
    preview:  { ev: 'photo_preview',  rank: 3, min: 1800 },
    saving:   { ev: 'photo_saving',   rank: 4, min: 1500 },
    success:  { ev: 'photo_done',     rank: 5, term: 1 },
    cancel:   { ev: 'photo_cancel',   rank: 5, term: 1 },
    error:    { ev: 'photo_error',    rank: 5, term: 1 }
  };
  var PF_STALE = 120000;
 
  P._pfActive = function () {
    var p = this._pf;
    return !!(p && !p.term && now() - p.at < PF_STALE);
  };
 
  P.photoFlow = function (stage, data) {
    var def = PF[stage], self = this;
    if (!def) return false;
    data = data || {};
    if (this.isVisible) { var vis = true; try { vis = !!this.isVisible(); } catch (e) {} if (!vis) return false; }
    var t = now(), p = this._pf, live = !!(p && !p.term && t - p.at < PF_STALE);
    if (def.term && stage !== 'success' && p && p.term && t - p.at < 4000) return false;   // cancel/error tepat setelah penutup lain = noise. 'success' (foto baru) TIDAK pernah dibuang
    if (stage === 'cancel' && !live) return false;                                // batal tanpa sesi: tidak ada konteks
    if (live && p.stage === stage && t - p.at < 600) return false;                // pemicu ganda
    if (live && stage !== 'open' && !def.term && def.rank < p.rank) return false; // tahap mundur
    this.ctx.lastActivity = t; this.nudged = false; this.sleeping = false;
    if (data.targetEl) this._pfEl = data.targetEl;
 
    var sess = (stage === 'open' || !live) ? (this._pf = { stage: stage, rank: def.rank, at: t, term: false, shownAt: 0, shownStage: '', pend: null, pt: 0 }) : p;
    clearTimeout(sess.pt);
    sess.stage = stage; sess.rank = def.rank; sess.at = t; sess.term = !!def.term;
    sess.pend = { stage: stage, data: data };                                      // yang terbaru menggantikan yang antre
 
    var shown = PF[sess.shownStage];
    var rem = (sess.shownAt && shown && shown.min) ? Math.max(0, shown.min - (t - sess.shownAt)) : 0;
    var delay = def.term ? Math.min(rem, 700) : rem;
    if (delay <= 0) this._pfPlay(sess);
    else sess.pt = setTimeout(function () { if (self._pf === sess) self._pfPlay(sess); }, delay);
    return true;
  };
 
  P._pfPlay = function (sess) {
    var q = sess.pend; sess.pend = null;
    if (!q) return false;
    var def = PF[q.stage], d = q.data || {}, el = d.targetEl || this._pfEl || null;
    sess.shownAt = now(); sess.shownStage = q.stage;
    var payload = { key: q.stage + '_' + (++this._pfN), targetEl: el || undefined, attention: el ? 'avatar' : 'user' };
    // dialog hanya dari teks nyata: kalimat hasil analisis foto (success) atau pesan error dari UI; selain itu mikro-ekspresi saja
    if (q.stage === 'success' && !d.quiet && d.response) payload.response = String(d.response);
    if (q.stage === 'error' && (d.text || d.response)) payload.response = this._sapa(String(d.text || d.response));
    if (d.mood && MOODS.indexOf(d.mood) >= 0 && (q.stage === 'success' || q.stage === 'error')) payload.mood = d.mood;
    if (q.stage === 'success' && d.behavior && BEHAVIORS[d.behavior]) payload.behavior = d.behavior;   // mis. 'photoMascot'; selain itu tetap photoDone
    return this.emit(def.ev, payload);
  };
 
  /* Sensor DOM opsional untuk lifecycle foto. HANYA selector yang diberikan; tanpa `input` tidak memasang apa pun.
   *   lily.watchPhotoUI({ input:'#fotoInput', trigger:'#btnGantiFoto', preview:'#fotoPreview', save:'#btnSimpanFoto',
   *                       form:'#formFoto', cancel:'#btnBatalFoto, .modal-foto .close', avatar:'#avatarGuru' })
   * Tahap yang tak bisa dideteksi DOM (mis. hasil simpan dari server) dikirim UI:
   *   document.dispatchEvent(new CustomEvent('lily:photo', { detail: { stage: 'error', text: 'Ukuran foto terlalu besar.' } }))
   * Sukses cukup lewat reactToPhoto() yang sudah dipanggil UI. Mengembalikan fungsi untuk melepas semua listener. */
  P.watchPhotoUI = function (o) {
    o = o || {};
    var self = this, L = [], fb = 0, pickT = 0;
    if (!o.input) { this._log('watchPhotoUI: selector input wajib'); return function () {}; }
    var hit = function (e, sel) { return !!(sel && e.target && e.target.closest && e.target.closest(sel)); };
    var on = function (tg, type, fn) { tg.addEventListener(type, fn, true); L.push([tg, type, fn]); };
    var ex = function () { var a = o.avatar ? document.querySelector(o.avatar) : null; return a ? { targetEl: a } : {}; };
    var canSave = function () { return self._pfActive() && self._pf.rank >= 2; };      // simpan tanpa foto terpilih = bukan 'saving'
 
    on(document, 'click', function (e) {
      if (hit(e, o.input) || hit(e, o.trigger)) { pickT = now(); self.photoFlow('open', ex()); }
      else if (hit(e, o.save)) { if (canSave()) self.photoFlow('saving', ex()); }
      else if (hit(e, o.cancel)) self.photoFlow('cancel', ex());
    });
    on(document, 'change', function (e) {
      if (!hit(e, o.input)) return;
      var f = e.target.files && e.target.files[0];
      if (f) self.photoFlow('selected', ex()); else self.photoFlow('cancel', ex());
    });
    on(document, 'cancel', function (e) { if (hit(e, o.input)) self.photoFlow('cancel', ex()); });
    // peramban tanpa event 'cancel' pada input file: jendela kembali fokus tetapi tidak ada pilihan -> batal
    on(global, 'focus', function () {
      var p = self._pf;
      if (!p || p.term || p.stage !== 'open' || now() - pickT < 400) return;
      clearTimeout(fb);
      fb = setTimeout(function () { var p2 = self._pf; if (p2 && !p2.term && p2.stage === 'open') self.photoFlow('cancel', ex()); }, 1200);
    });
    if (o.preview) on(document, 'load', function (e) {
      if (!hit(e, o.preview)) return;
      var p = self._pf;
      if (p && !p.term && p.rank < 3 && now() - p.at < 30000) self.photoFlow('preview', ex());
    });
    if (o.form) on(document, 'submit', function (e) { if (hit(e, o.form) && canSave()) self.photoFlow('saving', ex()); });
    on(document, 'lily:photo', function (e) { var d = e.detail || {}; self.photoFlow(d.stage, d); });
    return function () { clearTimeout(fb); L.forEach(function (x) { x[0].removeEventListener(x[1], x[2], true); }); L = []; };
  };
 
  /* Jawaban LOKAL dari data yang benar-benar ada (warna/kecerahan/nuansa terukur + kategori analyzer). null = tidak bisa dijawab lokal.
   * Pertanyaan tentang pakaian/latar/benda/teks TIDAK dijawab dari sini (datanya tidak ada) -> lanjut ke catatan/AI atau jujur tidak tahu. */
  P._photoLocalAnswer = function (norm) {
    var c = this._photoCtx;
    if (!c || now() - c.at > 3600000) return null;
    if (/(baju|pakaian|kemeja|jilbab|hijab|dasi|topi|kacamata|latar|belakang|background|tas|benda|tulisan|teks|dimana|di mana|lokasi|siapa)/.test(norm)) return null;
    var u = c.ukur || {}, T = null;
    if (/(warna)/.test(norm) && u.warna) {
      T = u.warna === 'netral' ? { mood: 'curious', text: 'Warnanya cenderung netral, tidak ada satu warna yang menonjol di foto ini.' }
                               : { mood: 'warm', text: 'Warna yang paling dominan di foto ini ' + u.warna + ', Pak/Bu.' };
    } else if (/(terang|cerah|gelap|redup|cahaya|pencahayaan)/.test(norm) && u.terang) {
      T = { mood: 'warm', text: u.terang === 'cerah' ? 'Fotonya cerah, Pak/Bu.' : u.terang === 'redup' ? 'Fotonya cukup redup dan teduh.' : 'Pencahayaannya sedang, tidak terlalu terang dan tidak terlalu gelap.' };
    } else if (/(suasana|nuansa|kesan|hangat|sejuk)/.test(norm) && u.nuansa) {
      T = { mood: 'warm', text: u.nuansa === 'hangat' ? 'Nuansanya hangat, Pak/Bu.' : u.nuansa === 'sejuk' ? 'Nuansanya sejuk dan tenang.' : 'Nuansanya netral dan bersih.' };
    } else if (/(berapa orang|ada orang|wajah|sendiri|berdua|ramai|pemandangan)/.test(norm) && c.cat && c.cat !== 'unknown') {
      var K = { satu: 'Sepertinya fotonya berisi satu orang, tapi Lily tidak bisa memastikan lebih jauh.',
                dua: 'Sepertinya ada dua orang di foto ini, tapi Lily tidak bisa memastikan lebih jauh.',
                banyak: 'Sepertinya ada beberapa orang di foto ini, tapi Lily tidak bisa memastikan jumlahnya.',
                alam: 'Sepertinya ini pemandangan, bukan foto orang.',
                objek: 'Sepertinya ini bukan foto wajah, lebih ke gambar atau benda.' };
      if (K[c.cat]) T = { mood: 'uncertain', text: K[c.cat] };
    }
    return T;
  };
 
  /* Guru bertanya soal fotonya. o = {ciri (catatan tersimpan) ATAU image (data-URL kecil), onData(d)}.
   * Urutan: sapaan lokal -> jawaban dari data terukur lokal -> (tanpa catatan & tanpa gambar: jujur, tanpa fetch) -> AI. */
  P.askPhoto = function (text, o) {
    o = o || {};
    var self = this, norm = normText(text), ik = 'foto|' + norm;
    var reply = function (mood, txt, type) {
      self._aiBegin();
      self._reply({ source: 'local', message_type: type || 'assistant_local', lily_expression: mood, counts_as_usage: false });
      self.applyAI({ mood: mood, behavior: 'observe', attention: 'user', response: self._sapa(txt) });
    };
    // sapaan / terima kasih: jawab lokal, tidak perlu OpenAI (aturan sama dengan reactToText)
    var li = localIntent(norm);
    if (li) { reply(li.mood, pick(li.lines)); return Promise.resolve(); }
    var lokal = this._photoLocalAnswer(norm);
    if (lokal) { reply(lokal.mood, lokal.text); return Promise.resolve(); }
    if (!o.ciri && !o.image) {                                   // tidak ada catatan maupun gambar: server pasti menolak, jangan fetch
      reply('uncertain', 'Lily belum menyimpan detail foto ini, Pak/Bu, jadi belum bisa memastikan. Coba pasang ulang fotonya, nanti Lily lihat lagi.');
      return Promise.resolve();
    }
    if (apiExhausted()) { this._aiBegin(); this.applyAI(this._exhaustedReply()); return Promise.resolve(); }   // tanpa fetch
    if (this._txtInflight[ik]) return this._txtInflight[ik];     // pertanyaan identik yang masih berjalan dipakai bersama (klik ganda)
    if (this.cur.pri === PRI.ai) this._finish(this.cur.id);   // pertanyaan baru: reaksi jawaban sebelumnya selesai (prioritas 'ai' > 'processing' akan membuang alur proses)
    var seq = this._aiBegin();
    this.emit('ai_start', { key: 'q' + now() });   // key unik: tanpa ini, pertanyaan ke-2 dalam 30 dtk dibuang filter duplikat -> tanpa animasi proses
    var done = function (d, pose) { self._aiSettle(seq, function () { self.emit('ai_done'); self.applyAI(d, pose ? { pose: pose } : null); }); };
    var pr = this._postPhoto({ mode: 'tanya', tanya: text, ciri: o.ciri || '', image: o.ciri ? '' : (o.image || ''), ukur: o.ciri ? null : (o.ukur || null) }).then(function (d) {
      if (d && d.success && d.response) {
        if (typeof o.onData === 'function') { try { o.onData(d); } catch (e) {} }
        done({ mood: d.mood, behavior: 'observe', attention: 'user', response: self._sapa(String(d.response)) },
             self._answerPose({ mood: d.mood }));
      } else if (d && d.exhausted) {
        done(self._exhaustedReply());
      } else {
        var kode = d && d.kode, st = d && d.status;
        if (kode === 'rate_limit' || st === 429) {
          done({ mood: 'apologetic', behavior: 'observe', attention: 'user', response: self._sapa('Lily perlu jeda sebentar, Pak/Bu. Tanyakan lagi beberapa menit lagi ya.') });
        } else if (kode === 'data_kurang' || kode === 'gambar_wajib') {
          done({ mood: 'uncertain', behavior: 'observe', attention: 'user', response: self._sapa('Lily belum punya catatan foto ini, Pak/Bu. Coba pasang ulang fotonya dulu ya.') },
               POSE_FLOW.curious ? 'curious' : null);
        } else {
          done({ mood: 'apologetic', behavior: 'observe', attention: 'user',
                 response: self._sapa('Maaf, Pak/Bu, Lily belum bisa melihat fotonya sekarang. Coba tanya lagi sebentar ya.') },
               POSE_FLOW.lost ? 'lost' : null);
        }
      }
    }).then(function () { delete self._txtInflight[ik]; });
    this._txtInflight[ik] = pr;
    return pr;
  };
 
  /* =====================================================================================================
   *  v6 -- KONTEKS GURU MEMBERI TUGAS (tambahan murni; memakai emit(), _isBusy(), cfg, lastEventAt yang sudah ada)
   *
   *  Alur:  noteTaskGiven -> catat lokal -> klaster (jeda <= taskGap = satu aktivitas) -> taskDecide (fungsi murni)
   *         -> mikro-ekspresi | komentar | tahan (guru sibuk) -> emit('task_given') lewat pipeline & prioritas biasa.
   *  Prinsip: jumlah tugas = tingkat PERHATIAN Lily, bukan penilaian atas guru. Observasi -> apresiasi ringan -> beri ruang.
   * ===================================================================================================== */
  var TASK_LINES = {
    single: ['Wah, {kelas} lagi dapat perhatian ekstra nih \u{1F604}', 'Lumayan produktif hari ini, Pak/Bu.',
             'Wah, hari ini {kelas} lumayan padat ya \u{1F604}'],
    pair:   ['Lumayan produktif hari ini, Pak/Bu.', 'Lagi produktif nih, Pak/Bu. \u{1F604}'],
    multi:  ['Wah, hari ini banyak kelas yang kebagian tugas ya \u{1F604}', 'Lagi produktif banget hari ini, Pak/Bu.'],
    burst:  ['Wah, lagi borong tugas nih \u{1F604}', 'Wah, produktif banget hari ini \u{1F604}'],
    wrap:   ['Tugas-tugasnya sudah terkirim semua ya, Pak/Bu. Silakan tarik napas sebentar.', 'Sudah beres membagikan tugasnya, Pak/Bu. Lily ikut senang.']
  };
  var TASK_OFFER = ' Kalau mau, aku bisa bantu cek rekap tugasnya.';       // hanya bila halaman memasang setTaskRecapOpener
  var TASK_RANK = { single: 1, wrap: 1, pair: 1, multi: 2, burst: 2 };
  /* Event penting yang baru lewat -> Lily tidak menumpuk komentar tugas di atasnya (jadwal mengajar, error, AI, foto). */
  var TASK_QUIET_EVENTS = ['sched_late_notask', 'sched_ongoing', 'sched_5', 'sched_10', 'grading', 'error', 'critical', 'teacher_mistake',
                           'ai_start', 'ai_confused', 'notification', 'photo_error', 'photo_changed'];
 
  /* FUNGSI MURNI (tanpa timer/DOM). cl = {n, kelas:[unik], ev:[{t}], commented}; f = {now, busy, playable, recentQuiet, recentSay,
   * lastCommentAt, lastTier, cfg}; wrap=true saat aktivitas sudah reda. Hasil: {act:'none'|'micro'|'comment'|'hold', behavior, micro, tier, why}. */
  function taskDecide(cl, f, wrap) {
    var out = { act: 'none', behavior: null, micro: null, tier: 'single', why: '' };
    if (!cl || cl.commented) { out.why = 'sudah komentar di klaster ini'; return out; }
    var t = f.now, n = cl.n, kc = Math.max(1, cl.kelas.length);
    var burstN = cl.ev.filter(function (e) { return t - e.t <= f.cfg.taskBurstWindow; }).length;
    var burst = burstN >= 5;
    var want, tier;
    if (wrap) { want = n >= 3; tier = kc >= 3 ? 'multi' : kc === 2 ? 'pair' : 'wrap'; }
    else      { want = burst || (kc === 1 && n >= 4); tier = burst ? 'burst' : 'single'; }
    out.tier = tier;
    var microName = n <= 1 ? 'taskGlance' : n === 2 ? 'taskNod' : 'taskCurious';
    var micro = (!wrap && n <= 3) ? microName : null;
    if (want) {
      var since = f.lastCommentAt ? t - f.lastCommentAt : Infinity;
      var cdOk = since >= f.cfg.taskCommentCd ||
                 ((TASK_RANK[tier] || 1) > (TASK_RANK[f.lastTier] || 1) && since >= f.cfg.taskRankGap);   // konteks naik tingkat = boleh lebih cepat
      if (cdOk) {
        out.behavior = tier === 'burst' ? 'taskSayBurst' : tier === 'multi' ? 'taskSayMulti' : 'taskSaySoft';
        if (f.busy || f.recentQuiet || f.recentSay || !f.playable) {
          out.act = 'hold'; out.micro = wrap ? null : (micro || 'taskCurious');
          out.why = f.busy ? 'guru sibuk' : f.recentQuiet ? 'ada event penting barusan' : f.recentSay ? 'Lily baru bicara' : 'Lily sedang bereaksi';
        } else { out.act = 'comment'; out.why = tier; }
        return out;
      }
      out.why = 'cooldown komentar';
    }
    if (micro) { out.act = 'micro'; out.micro = micro; out.why = out.why || 'mikro-ekspresi'; }
    return out;
  }
 
  P._taskInit = function () {
    var self = this;
    this._tk = { cl: null, seq: 0, lastMicroAt: 0, lastCommentAt: 0, lastTier: '', evalT: 0, wrapT: 0, flushT: 0, pending: null, opener: null, formUntil: 0 };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('lily:task', function (e) { self.noteTaskGiven(e && e.detail); });
      /* form beri/ubah tugas terbuka = guru sedang bekerja (tanpa membaca isinya). Kedaluwarsa sendiri bila event 'tutup' hilang. */
      document.addEventListener('lily:taskform', function (e) { self._tk.formUntil = (e && e.detail && e.detail.open) ? now() + 600000 : 0; });
    }
  };
  P.setTaskRecapOpener = function (fn) { if (this._tk) this._tk.opener = typeof fn === 'function' ? fn : null; };
 
  /* Kolom teks yang sedang aktif dan terlihat = guru sedang mengisi/berpindah field. Isinya TIDAK dibaca. */
  P._fieldActive = function () {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    var tag = a.tagName;
    var textual = tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable ||
                  (tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|file|image|color)$/i.test(a.type || 'text'));
    if (!textual) return false;
    var shown = a.offsetParent !== null || (a.getClientRects && a.getClientRects().length > 0);
    return !!shown;
  };
  P._taskBusy = function () { return this._isBusy(true) || (this._tk.formUntil || 0) > now() || this._fieldActive(); };
  P._taskGone = function () {
    if (document.hidden) return true;
    if (this.isVisible) { try { if (!this.isVisible()) return true; } catch (e) {} }
    return false;
  };
  P._taskFlags = function () {
    var t = now(), self = this, c = this.cfg;
    var quiet = TASK_QUIET_EVENTS.some(function (n) { return self.lastEventAt[n] && t - self.lastEventAt[n] < c.taskQuietAfter; }) || !!this._pendingOffer;
    var say = (this._bubbleUntil || 0) > t || (this.lastSayAt && t - this.lastSayAt < c.taskSayGap);
    var playable = !this.sleeping && (this.cur.name === 'idle' || this.cur.pri > PRI.task_ctx);
    return { now: t, busy: this._taskBusy(), playable: playable, recentQuiet: quiet, recentSay: !!say,
             lastCommentAt: this._tk.lastCommentAt, lastTier: this._tk.lastTier, cfg: c };
  };
 
  /* Catat satu tugas baru (atau beberapa kelas sekaligus). Tidak langsung bereaksi: menunggu taskSettle agar event beruntun
   * dari satu aksi dibaca sebagai satu aktivitas. Mengembalikan true bila tercatat. */
  P.noteTaskGiven = function (info) {
    info = info || {};
    if (!this._tk || info.edit || (info.jenis && info.jenis !== 'tugas')) return false;      // edit/catatan bukan "memberi tugas"
    var self = this, tk = this._tk, c = this.cfg, t = now();
    var ks = (Array.isArray(info.kelas) ? info.kelas : [info.kelas]).map(function (k) { return k == null ? '' : String(k).replace(/\s+/g, ' ').trim().slice(0, 40); });
    if (!ks.length) ks = [''];
    if (!tk.cl || t - tk.cl.last > c.taskGap) tk.cl = { first: t, last: t, n: 0, kelas: [], per: {}, ev: [], commented: false, heldMicro: false };
    var cl = tk.cl, busy = this._taskBusy(), spoke = !!this.lastSayAt && t - this.lastSayAt < c.taskSayGap;
    ks.forEach(function (k) {
      cl.n++; cl.last = t;
      cl.ev.push({ t: t, kelas: k, busy: busy, afterSay: spoke });
      if (k) { cl.per[k] = (cl.per[k] || 0) + 1; if (cl.kelas.indexOf(k) < 0) cl.kelas.push(k); }
    });
    if (cl.ev.length > 40) cl.ev = cl.ev.slice(-40);
    clearTimeout(tk.evalT); tk.evalT = setTimeout(function () { self._taskEval(); }, c.taskSettle);
    clearTimeout(tk.wrapT); tk.wrapT = setTimeout(function () { self._taskWrap(); }, c.taskWrapAfter);
    return true;
  };
 
  P._taskEval = function () {
    var tk = this._tk, cl = tk.cl;
    if (!cl || this._taskGone()) return;
    this._taskAct(taskDecide(cl, this._taskFlags(), false), cl, false);
  };
  P._taskWrap = function () {
    var tk = this._tk, cl = tk.cl;
    if (!cl || cl.commented || this._taskGone()) return;
    this._taskAct(taskDecide(cl, this._taskFlags(), true), cl, true);
  };
 
  P._taskAct = function (d, cl, wrap) {
    var tk = this._tk;
    this._log('task', d.act, d.why, 'n=' + cl.n);
    if (d.act === 'comment') return this._taskSay(d, cl, wrap);
    if (d.act === 'hold') {
      if (d.micro && !cl.heldMicro) { cl.heldMicro = true; this._taskMicro(d.micro); }        // sibuk: hanya mikro-ekspresi
      tk.pending = { cl: cl, wrap: wrap, exp: now() + this.cfg.taskHoldMs };
      this._taskFlushStart();
      return;
    }
    if (d.act === 'micro') this._taskMicro(d.micro);
  };
 
  P._taskMicro = function (name) {
    var tk = this._tk, t = now();
    if (!name || t - tk.lastMicroAt < this.cfg.taskMicroGap) return false;
    var f = this._taskFlags();
    if (!f.playable) return false;                                 // jangan antre: mikro-ekspresi basi tidak berguna
    tk.lastMicroAt = t;
    return this.emit('task_given', { key: 'tk' + (++tk.seq), behavior: name, intensity: 0.3 }, { exp: t + 1500 });
  };
 
  P._taskLine = function (tier, cl) {
    var pool = (TASK_LINES[tier] || TASK_LINES.single).slice();
    var top = '', best = 0;
    Object.keys(cl.per).forEach(function (k) { if (cl.per[k] > best) { best = cl.per[k]; top = k; } });
    pool = pool.filter(function (x) { return top || x.indexOf('{kelas}') < 0; });
    if (!pool.length) pool = TASK_LINES.pair;
    var k = 'task:' + tier, tx, tries = 0;
    do { tx = pick(pool); tries++; } while (tx === this.lastLine[k] && pool.length > 1 && tries < 4);
    this.lastLine[k] = tx;
    return tx.replace('{kelas}', top);
  };
 
  P._taskSay = function (d, cl, wrap) {
    var self = this, tk = this._tk, t = now(), text = this._taskLine(d.tier, cl), acts = null;
    if (wrap && typeof tk.opener === 'function') {                 // tawaran bantuan: hanya tombol, tidak membuka apa pun sendiri
      text += TASK_OFFER;
      acts = [{ label: 'Lihat rekap', on: function () { if (typeof self._hideBubble === 'function') self._hideBubble(); try { tk.opener(); } catch (e) {} } }];
    }
    var data = { key: 'tk' + (++tk.seq), behavior: d.behavior, response: this._sapa(text), intensity: 0.6 };
    if (acts) data.actions = acts;
    var ok = this.emit('task_given', data, { exp: t + 2500 });
    if (ok || (this.queued && this.queued.name === 'task_given')) {
      cl.commented = true; tk.lastCommentAt = t; tk.lastTier = d.tier; tk.pending = null;
      clearInterval(tk.flushT); tk.flushT = 0;
    }
    return ok;
  };
 
  /* Komentar yang ditahan karena guru sibuk: dicoba lagi tiap 2 dtk sampai tenang, kedaluwarsa taskHoldMs (lalu dibuang -- tidak basi). */
  P._taskFlushStart = function () {
    var self = this, tk = this._tk;
    if (tk.flushT) return;
    tk.flushT = setInterval(function () {
      var p = tk.pending, t = now();
      if (!p || p.exp <= t || p.cl.commented || tk.cl !== p.cl) { clearInterval(tk.flushT); tk.flushT = 0; tk.pending = null; return; }
      if (self._taskGone()) return;
      var d = taskDecide(p.cl, self._taskFlags(), p.wrap);
      if (d.act === 'comment') self._taskSay(d, p.cl, p.wrap);
      else if (d.act === 'none' || d.act === 'micro') { clearInterval(tk.flushT); tk.flushT = 0; tk.pending = null; }
    }, 2000);
  };
 
 
  global.Lily = Lily;
  global.Lily.PRIORITY = PRI;
  global.Lily.POSE_FLOW = POSE_FLOW;           // v8: saklar/durasi pose (mis. Lily.POSE_FLOW.lost = false)
  global.Lily.MOODS = MOODS;
  global.Lily._maskot = { hueHist: hueHist, histSim: histSim, dBits: dBits, hamming: hamming, match: mascotMatch };   // hanya untuk uji
  global.Lily.FALLBACK_MOOD = FALLBACK_MOOD;   // dipakai LilyRig untuk rantai fallback face
  global.Lily._spec = { PROFILE: PROFILE, BEHAVIORS: BEHAVIORS, EVENTS: EVENTS, BEH_STATE: BEH_STATE, GESTURE_ANIM: GESTURE_ANIM, FALLBACK_MOOD: FALLBACK_MOOD, NEEDS: NEED_DEF, TASK_LINES: TASK_LINES, SENSE_ALIAS: SENSE_ALIAS, MICRO_BEH: MICRO_BEH };
  global.Lily.coherentMood = coherentMood;   // fungsi murni: dipakai tes
  global.Lily.taskDecide = taskDecide;       // fungsi murni (tanpa timer/DOM): dipakai tes
})(window);
 