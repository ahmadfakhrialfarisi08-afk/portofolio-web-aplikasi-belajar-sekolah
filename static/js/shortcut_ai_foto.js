/* ============================================================
   SHORTCUT CTRL+U -- langsung buka pemilih foto di AI Support
   ------------------------------------------------------------
   File BERDIRI SENDIRI (IIFE), tidak mengubah file JS lain.
   Muat SETELAH dashboard_siswa*.js:
     <script src="../static/js/shortcut_ai_foto.js"></script>

   >>> GANTI selektor di bawah sesuai id asli di dashboard_siswa.html <<<
   Cara cari: klik kanan ikon klip -> Inspect, lihat id <input type="file">
   dan id <button> klip-nya.
   ============================================================ */
(function () {
    // Urutan dicoba dari atas; yang pertama ketemu + sedang tampil dipakai.
    var SELEKTOR_INPUT_FILE = [
        '#ai-file-input',
        '#ai-input-file',
        '#ai-foto-input',
        '#ai-support-file',
        '#tab-ai-support input[type="file"]',
        '#ai-support input[type="file"]'
    ];
    // Cadangan: kalau input file-nya dibuat/dipicu lewat tombol klip.
    var SELEKTOR_TOMBOL_KLIP = [
        '#ai-btn-attach',
        '#ai-attach-btn',
        '#btn-ai-attach',
        '#tab-ai-support button[title*="oto" i]',
        '#tab-ai-support button[aria-label*="oto" i]'
    ];
    var LABEL_TOOLTIP = 'Tambah foto (Ctrl+U)';

    // Elemen dianggap "tampil" kalau tab AI Support-nya sedang terbuka.
    function tampil(el) {
        return !!el && el.getClientRects().length > 0;
    }

    function cariInputFile() {
        for (var i = 0; i < SELEKTOR_INPUT_FILE.length; i++) {
            var el = document.querySelector(SELEKTOR_INPUT_FILE[i]);
            // input file biasanya hidden, jadi cek induknya yang tampil
            if (el && tampil(el.parentElement)) return el;
        }
        // Cadangan otomatis: input file gambar apa pun yang induknya sedang tampil
        // (input di modal/tab lain yang tersembunyi otomatis tidak ikut terhitung).
        var semua = document.querySelectorAll('input[type="file"]');
        for (var j = 0; j < semua.length; j++) {
            var f = semua[j];
            var accept = (f.getAttribute('accept') || '').toLowerCase();
            if ((!accept || accept.indexOf('image') !== -1) && tampil(f.parentElement)) return f;
        }
        return null;
    }

    function cariTombolKlip() {
        for (var i = 0; i < SELEKTOR_TOMBOL_KLIP.length; i++) {
            var el = document.querySelector(SELEKTOR_TOMBOL_KLIP[i]);
            if (el && tampil(el)) return el;
        }
        return null;
    }

    function bukaPemilihFoto() {
        var input = cariInputFile();
        if (input && !input.disabled) { input.click(); return true; }
        var tombol = cariTombolKlip();
        if (tombol && !tombol.disabled) { tombol.click(); return true; }
        return false;
    }

    document.addEventListener('keydown', function (e) {
        var kunciU = (e.key || '').toLowerCase() === 'u';
        if (!kunciU || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        // Cuma ambil alih kalau AI Support memang sedang terbuka;
        // di tab lain Ctrl+U tetap "view source" bawaan browser.
        if (!(cariInputFile() || cariTombolKlip())) return;
        e.preventDefault();
        e.stopPropagation();
        bukaPemilihFoto();
    }, true); // capture: dijalankan lebih dulu dari handler lain

    // Tooltip di tombol klip supaya user tahu ada shortcut-nya.
    function pasangTooltip() {
        var tombol = cariTombolKlip();
        if (tombol && tombol.title !== LABEL_TOOLTIP) tombol.title = LABEL_TOOLTIP;
    }
    document.addEventListener('DOMContentLoaded', pasangTooltip);
    setInterval(pasangTooltip, 3000);
})();
