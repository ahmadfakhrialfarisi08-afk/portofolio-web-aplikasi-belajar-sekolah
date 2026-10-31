/* ============================================================
   BADGE SIDEBAR GURU -- "Beranda Guru" (desktop) & bottom-nav (HP)
   ------------------------------------------------------------
   File BERDIRI SENDIRI (IIFE terpisah), tidak mengubah file JS lain.
   Target elemen (salah satu/lebih harus ada di DOM):
     - #menu-pelanggaran         (sidebar desktop, versi HTML statis)
     - #btn-pelanggaran          (sidebar desktop, dibuat oleh
                                  dashboard_guru_pelanggaran.js)
     - #menu-pelanggaran-mobile  (bottom-nav HP)

   Sumber data: GET /api/pelanggaran/butuh-aksi -- balikin
     { success, aktif, menunggu_acc, menunggu_bk, total, warna }
   dihitung KHUSUS utk guru yang sedang login (pelanggaran yang DIA
   laporkan sendiri).

   Warna badge:
     - aktif > 0            -> MERAH #e11d48 + pulse (butuh aksi segera)
     - cuma menunggu_acc > 0 -> BIRU #2563eb diam (tinggal ACC)
     - cuma menunggu_bk > 0  -> UNGU #7e22ce + pulse halus (menunggu BK)
     - total == 0            -> badge dihapus/disembunyikan
   Angka > 9 ditampilkan "9+".
   ============================================================ */
(function () {
    var JEDA_POLL_MS = 30000;
    var ID_TARGET = ['menu-pelanggaran', 'btn-pelanggaran', 'menu-pelanggaran-mobile'];
    var MAKS_RETRY_ELEMEN = 6;   // nunggu tombol yang dibuat JS lain
    var JEDA_RETRY_MS = 1000;
    var retryElemen = 0;
    var STYLE_ID = 'gaya-badge-sidebar-guru';
    var BADGE_CLASS = 'badge-sidebar-pelanggaran';

    function pastikanGayaCSS() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '@keyframes pulseBadgeSidebarGuru {' +
            '  0% { box-shadow: 0 0 0 0 rgba(225,29,72,0.55); }' +
            '  70% { box-shadow: 0 0 0 6px rgba(225,29,72,0); }' +
            '  100% { box-shadow: 0 0 0 0 rgba(225,29,72,0); }' +
            '}' +
            '@keyframes pulseBadgeSidebarGuruUngu {' +
            '  0% { box-shadow: 0 0 0 0 rgba(126,34,206,0.45); }' +
            '  70% { box-shadow: 0 0 0 5px rgba(126,34,206,0); }' +
            '  100% { box-shadow: 0 0 0 0 rgba(126,34,206,0); }' +
            '}' +
            '.' + BADGE_CLASS + ' {' +
            '  position: absolute;' +
            '  top: 4px;' +
            '  right: 8px;' +
            '  min-width: 18px;' +
            '  height: 18px;' +
            '  padding: 0 4px;' +
            '  border-radius: 9999px;' +
            '  font-size: 10px;' +
            '  font-weight: 800;' +
            '  line-height: 18px;' +
            '  text-align: center;' +
            '  color: #fff;' +
            '  z-index: 5;' +
            '  pointer-events: none;' +
            '}' +
            '.' + BADGE_CLASS + '.warna-merah {' +
            '  background: #e11d48;' +
            '  animation: pulseBadgeSidebarGuru 1.6s infinite;' +
            '}' +
            '.' + BADGE_CLASS + '.warna-biru {' +
            '  background: #2563eb;' +
            '}' +
            '.' + BADGE_CLASS + '.warna-ungu {' +
            '  background: #7e22ce;' +
            '  animation: pulseBadgeSidebarGuruUngu 2.4s infinite;' +
            '}' +
            '@media (prefers-reduced-motion: reduce) {' +
            '  .' + BADGE_CLASS + '.warna-merah, .' + BADGE_CLASS + '.warna-ungu { animation: none; }' +
            '}';
        document.head.appendChild(style);
    }

    function pastikanPosisiRelatif(el) {
        // Badge posisinya absolute -- elemen target wajib position:relative
        // biar nempel di pojoknya sendiri, bukan pojok dokumen.
        var posisi = window.getComputedStyle(el).position;
        if (posisi === 'static' || !posisi) {
            el.style.position = 'relative';
        }
    }

    // Return true kalau elemen target ketemu (dipakai untuk logika retry).
    function pasangBadge(el, jumlah, warna) {
        if (!el) return false;
        pastikanPosisiRelatif(el);
        var badge = el.querySelector('.' + BADGE_CLASS);
        if (!jumlah || jumlah <= 0) {
            if (badge) badge.remove();
            return true;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = BADGE_CLASS;
            el.appendChild(badge);
        }
        badge.className = BADGE_CLASS + ' warna-' + warna;
        badge.textContent = jumlah > 9 ? '9+' : String(jumlah);
        return true;
    }

    function segarkanBadge() {
        fetch('/api/pelanggaran/butuh-aksi')
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (!json || !json.success) return;
                var total = json.total || 0;
                // Warna utama dari server (merah > biru > ungu); fallback hitung lokal
                // kalau field 'warna' tidak ada di response.
                var warna = json.warna ||
                    (json.aktif > 0 ? 'merah' :
                        (json.menunggu_acc > 0 ? 'biru' :
                            (json.menunggu_bk > 0 ? 'ungu' : null)));
                var adaTarget = false;
                ID_TARGET.forEach(function (id) {
                    if (pasangBadge(document.getElementById(id), total, warna)) adaTarget = true;
                });
                // Tombol sidebar dibuat JS lain dan bisa muncul setelah fetch ini selesai:
                // ulangi sebentar sampai elemennya ada, jangan nunggu poll 30 detik.
                if (total > 0 && !adaTarget && retryElemen < MAKS_RETRY_ELEMEN) {
                    retryElemen++;
                    setTimeout(segarkanBadge, JEDA_RETRY_MS);
                }
            })
            .catch(function () { /* offline sesaat -- coba lagi poll berikutnya */ });
    }

    function mulai() {
        pastikanGayaCSS();
        segarkanBadge();
        setInterval(function () {
            if (!document.hidden) segarkanBadge();
        }, JEDA_POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mulai);
    } else {
        mulai();
    }

    // Diekspos jaga-jaga kalau ada aksi lain (mis. setelah ACC dari modal)
    // yang mau langsung memicu refresh badge tanpa nunggu poll 30 detik.
    window.BadgeSidebarGuru = {
        refresh: function () { retryElemen = 0; segarkanBadge(); }
    };
})();
