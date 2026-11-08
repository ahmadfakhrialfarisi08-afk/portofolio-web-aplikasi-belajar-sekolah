// ----------------------------------------------------
// AI SUPPORT -- kolom ketik tetap di atas keyboard HP
// Satu file untuk dashboard SISWA & GURU, semua browser HP.
// ----------------------------------------------------
// Cara pakai: cukup satu tag <script src=".../ai_support_keyboard.js"></script>
// di halaman manapun yang punya AI Support. CSS-nya disuntikkan sendiri
// oleh file ini (tidak tergantung ai_support_full.css / halaman tertentu).
//
// Cara kerja:
//  - Aktif HANYA saat kolom ketik AI Support difokus & keyboard terbuka.
//  - Chrome/Edge/Samsung/Safari/Firefox modern: pakai visualViewport.
//  - Browser lama tanpa visualViewport: fallback ke window.innerHeight + resize.
//  - Kalau selector input di dashboard guru beda, set sebelum script ini:
//      window.AI_SUPPORT_INPUT_SELECTOR = '#id-input-guru';
(function () {
    'use strict';
    var root = document.documentElement;
    var vv = window.visualViewport || null;

    var SELECTOR = (window.AI_SUPPORT_INPUT_SELECTOR || '') +
        ',#input-ai-support,#scorus-input,[data-ai-input],' +
        '[id*="ai-support"] textarea,[id*="ai-support"] input[type="text"],' +
        '#tab-scorus-ai textarea,' +
        '.ai-full-wrap textarea,.ai-full-wrap input[type="text"]';

    var LOG_SELECTOR = '#ai-support-chat-log,#scorus-log,[data-ai-log],.ai-full-log';
    var SHELL_SELECTOR = '.scorus-shell,.ai-full-wrap,[data-ai-shell]';

    // ---- CSS (disuntik, aktif hanya saat html.keyboard-open) ----
    var css =
        '@media (max-width:1023px){' +
        // 16px mencegah iOS Safari zoom otomatis saat input difokus
        '#input-ai-support,#scorus-input,[data-ai-input],[id*="ai-support"] textarea,.ai-full-wrap textarea,' +
        '[id*="ai-support"] input[type="text"],.ai-full-wrap input[type="text"]{font-size:16px !important}' +
        'html.keyboard-open,html.keyboard-open body{height:var(--vvh) !important;overflow:hidden !important}' +
        'html.keyboard-open .h-screen,html.keyboard-open .scroll-sembunyi-quiz{height:100% !important}' +
        'html.keyboard-open #bottom-nav-mobile,html.keyboard-open .guru-bottom-nav,html.keyboard-open [data-bottom-nav],' +
        'html.keyboard-open .ai-full-catatan,html.keyboard-open .scorus-foot{display:none !important}' +
        'html.keyboard-open #main-content,html.keyboard-open #main-scroll-container{padding-bottom:0 !important}' +
        'html.keyboard-open #main-content:has(#tab-ai-support:not(.hidden)){padding-bottom:0 !important}' +
        // dashboard guru: kotak chat mengisi area di atas keyboard
        'html.keyboard-open #tab-scorus-ai .scorus-shell{height:calc(var(--vvh) - 12px) !important;min-height:0 !important}' +
        '}';
    var st = document.createElement('style');
    st.setAttribute('data-ai-keyboard', '');
    st.appendChild(document.createTextNode(css));
    (document.head || root).appendChild(st);

    function cocok(el) {
        try { return !!(el && el.matches && el.matches(SELECTOR)); } catch (e) { return false; }
    }

    var fokus = false;
    var baseline = 0;   // tinggi layar saat keyboard tertutup
    var antre = 0;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

    function tinggiTerlihat() {
        return vv ? vv.height : window.innerHeight;
    }

    function ukurBaseline() {
        // Ambil yang terbesar selama keyboard tidak aktif (tahan rotasi layar).
        var h = Math.max(window.innerHeight, vv ? vv.height + (vv.offsetTop || 0) : 0);
        if (!fokus || !baseline) baseline = h;
        else if (h > baseline) baseline = h;
    }

    function perbarui() {
        antre = 0;
        ukurBaseline();
        var tinggi = tinggiTerlihat();
        var buka = fokus && (baseline - tinggi) > 120;
        if (buka) {
            root.style.setProperty('--vvh', Math.round(tinggi) + 'px');
            root.classList.add('keyboard-open');
            window.scrollTo(0, 0); // cegah halaman terdorong (iOS)
            var shell = document.querySelector(SHELL_SELECTOR);
            if (shell && shell.scrollIntoView) { try { shell.scrollIntoView({ block: 'end' }); } catch (e) {} }
            var log = document.querySelector(LOG_SELECTOR);
            if (log) log.scrollTop = log.scrollHeight;
        } else {
            root.classList.remove('keyboard-open');
            root.style.removeProperty('--vvh');
        }
    }

    function jadwalkan() { if (!antre) antre = raf(perbarui); }

    function setelahFokus() {
        // Keyboard butuh waktu animasi; cek beberapa kali supaya tidak terlewat.
        jadwalkan();
        setTimeout(jadwalkan, 150);
        setTimeout(jadwalkan, 400);
        setTimeout(jadwalkan, 800);
    }

    document.addEventListener('focusin', function (e) {
        if (!cocok(e.target)) return;
        baseline = Math.max(window.innerHeight, vv ? vv.height : 0);
        fokus = true;
        setelahFokus();
    });
    document.addEventListener('focusout', function (e) {
        if (!cocok(e.target)) return;
        fokus = false;
        setTimeout(jadwalkan, 100);
        setTimeout(jadwalkan, 400); // iOS: tombol "Selesai" kadang tanpa event resize
    });

    if (vv) {
        vv.addEventListener('resize', jadwalkan);
        vv.addEventListener('scroll', jadwalkan);
    }
    window.addEventListener('resize', jadwalkan);
    window.addEventListener('orientationchange', function () { baseline = 0; setTimeout(jadwalkan, 300); });
})();
