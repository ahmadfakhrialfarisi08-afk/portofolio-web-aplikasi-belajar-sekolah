/* ============================================================
   SKELETON LOADING — SISI SISWA (skeleton_siswa.js)
   API (semua aman dipanggil walau elemennya tidak ada):
     SkSiswa.tampil(el, preset, n)   -> isi el dengan n skeleton
     SkSiswa.html(preset, n)         -> markup string (untuk <tbody> dll)
     SkSiswa.lapisan(preset)         -> lapisan penuh; return fungsi penutup
     SkSiswa.ubin(el, n)             -> n ubin foto placeholder di grid
     SkSiswa.field(els, aktif)       -> shimmer pada input
     SkSiswa.unggah(el, aktif)       -> sapuan kilau di atas ubin foto
   Preset: guru | perangkat | teman | leaderboard | kartu | statistik
   Gambar <img> otomatis dapat shimmer sampai selesai dimuat.
   ============================================================ */
(function () {
    'use strict';
    function baris(avatar, w1, w2, kanan) {
        return '<div class="sk-baris" aria-hidden="true">' +
            (avatar ? '<div class="sk-circle" style="width:' + avatar + 'px;height:' + avatar + 'px"></div>' : '') +
            '<div class="sk-kolom"><div class="sk-line ' + w1 + '"></div><div class="sk-line ' + w2 + '" style="height:8px"></div></div>' +
            (kanan ? '<div class="sk-line" style="width:44px;height:22px;border-radius:8px"></div>' : '') + '</div>';
    }
    var PRESET = {
        guru:        function () { return baris(40, 'sk-w60', 'sk-w45', false); },
        perangkat:   function () { return baris(0, 'sk-w60', 'sk-w80', true); },
        teman:       function () { return baris(42, 'sk-w45', 'sk-w30', false); },
        leaderboard: function () { return baris(36, 'sk-w60', 'sk-w30', true); },
        statistik:   function () { return '<div class="sk-rect" style="height:64px" aria-hidden="true"></div>'; },
        kartu:       function () {
            return '<div class="sk-kartu" aria-hidden="true">' +
                '<div class="sk-baris" style="padding:0"><div class="sk-circle" style="width:56px;height:56px"></div>' +
                '<div class="sk-kolom"><div class="sk-line sk-w60" style="height:12px"></div><div class="sk-line sk-w30"></div></div></div>' +
                '<div class="sk-rect" style="height:72px"></div><div class="sk-line sk-w80"></div><div class="sk-line sk-w45"></div></div>';
        }
    };
    function html(preset, n) {
        var f = PRESET[preset] || PRESET.guru, out = '';
        for (var i = 0; i < (n || 3); i++) out += f();
        return out;
    }
    var SkSiswa = {
        html: html,
        tampil: function (el, preset, n) {
            if (!el) return;
            el.innerHTML = html(preset, n);
        },
        lapisan: function (preset) {
            var d = document.createElement('div');
            d.className = 'sk-lapisan';
            d.setAttribute('role', 'status');
            d.setAttribute('aria-label', 'Memuat');
            d.innerHTML = html(preset || 'kartu', 1);
            document.body.appendChild(d);
            return function () { if (d.parentNode) d.parentNode.removeChild(d); };
        },
        ubin: function (el, n) {
            if (!el) return;
            var s = '';
            for (var i = 0; i < (n || 1); i++) s += '<div class="sk-rect" style="height:56px;border-radius:8px" aria-hidden="true"></div>';
            el.classList.remove('hidden');
            el.insertAdjacentHTML('beforeend', s);
        },
        field: function (els, aktif) {
            (els || []).forEach(function (e) { if (e) e.classList.toggle('sk-field-loading', !!aktif); });
        },
        unggah: function (el, aktif) { if (el) el.classList.toggle('sk-mengunggah', !!aktif); }
    };
    window.SkSiswa = SkSiswa;

    /* ---- shimmer otomatis untuk <img> yang belum selesai dimuat ---- */
    function tandai(img) {
        if (!img || img.__skPantau || img.complete) return;
        img.__skPantau = true;
        img.classList.add('sk-img-loading');
        var selesai = function () { img.classList.remove('sk-img-loading'); };
        img.addEventListener('load', selesai, { once: true });
        img.addEventListener('error', selesai, { once: true });
    }
    function pindai(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.tagName === 'IMG') { tandai(root); return; }
        var imgs = root.querySelectorAll ? root.querySelectorAll('img') : [];
        for (var i = 0; i < imgs.length; i++) tandai(imgs[i]);
    }
    function mulai() {
        pindai(document.body);
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                for (var j = 0; j < m.addedNodes.length; j++) pindai(m.addedNodes[j]);
                if (m.type === 'attributes' && m.target.tagName === 'IMG') {
                    m.target.__skPantau = false; // src diganti -> pantau lagi
                    tandai(m.target);
                }
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    if (document.body) mulai(); else document.addEventListener('DOMContentLoaded', mulai);
})();
