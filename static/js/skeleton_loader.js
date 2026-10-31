/* ============================================================
   SKELETON LOADER -- Dashboard Siswa
   Dipakai bareng static/css/skeleton_loader.css

   API:
     SkeletonLoader.tampil(target, { jumlah: 5, varian: 'komentar' })
     SkeletonLoader.hapus(target)
   "target" boleh elemen DOM atau selector (mis. '#list-bell-dropdown').

   Cara pakai di kode fetch yang sudah ada:
     SkeletonLoader.tampil('#list-kotak-saran-admin', { jumlah: 6 });
     const data = await fetch('/api/saran/list').then(r => r.json());
     // lalu render seperti biasa (innerHTML = ...) -> skeleton otomatis
     // tergantikan. Kalau fetch GAGAL / hasilnya kosong dan kamu tidak
     // me-render apa-apa, panggil SkeletonLoader.hapus(...) di catch/finally.

   Otomatis (tanpa JS tambahan): beri atribut pada wadah di HTML
     data-skeleton="6"            -> tampil 6 baris saat halaman dibuka
     data-skeleton-varian="..."   -> 'komentar' (default) | 'kartu' | 'baris'
   Skeleton otomatis dilepas sendiri setelah 10 detik kalau wadahnya
   belum diisi apa pun (jaga-jaga fetch gagal / tidak pernah selesai).
   ============================================================ */
(function () {
    'use strict';

    var TANDA = 'data-sk-aktif';
    var BATAS_WAKTU_MS = 10000;

    var VARIAN_BARIS = [
        ['sk-line--short', 'sk-line--long'],
        ['sk-line--short', 'sk-line--mid'],
        ['sk-line--short', 'sk-line--long']
    ];

    function ambil(target) {
        if (!target) return null;
        return typeof target === 'string' ? document.querySelector(target) : target;
    }

    function buatItem(varian, i) {
        var li = document.createElement('li');
        li.className = 'sk-item';
        li.setAttribute('aria-hidden', 'true');

        var avatar = document.createElement('div');
        avatar.className = 'sk-avatar sk-shimmer' + (varian === 'baris' ? ' sk-avatar--sm' : '');
        li.appendChild(avatar);

        var body = document.createElement('div');
        body.className = 'sk-body';
        var pola = VARIAN_BARIS[i % VARIAN_BARIS.length];
        var jumlahGaris = varian === 'baris' ? 1 : 2;
        for (var k = 0; k < jumlahGaris; k++) {
            var garis = document.createElement('div');
            garis.className = 'sk-line sk-shimmer ' + (varian === 'baris' ? 'sk-line--mid' : pola[k]);
            body.appendChild(garis);
        }
        li.appendChild(body);
        return li;
    }

    function tampil(target, opsi) {
        var el = ambil(target);
        if (!el) return;
        opsi = opsi || {};
        var jumlah = Math.max(1, parseInt(opsi.jumlah, 10) || 5);
        var varian = opsi.varian || 'komentar';

        var ul = document.createElement('ul');
        ul.className = 'sk-list';
        ul.setAttribute('role', 'presentation');
        for (var i = 0; i < jumlah; i++) ul.appendChild(buatItem(varian, i));

        var sr = document.createElement('span');
        sr.className = 'sk-sr-only';
        sr.textContent = 'Memuat…';

        el.replaceChildren(sr, ul);
        el.setAttribute(TANDA, '1');
        el.setAttribute('aria-busy', 'true');

        // Jaring pengaman: kalau tidak ada yang mengisi wadah, lepas sendiri
        clearTimeout(el._skTimer);
        el._skTimer = setTimeout(function () {
            if (el.getAttribute(TANDA) === '1' && el.querySelector(':scope > .sk-list')) {
                hapus(el);
            }
        }, opsi.batasWaktu || BATAS_WAKTU_MS);
    }

    function hapus(target) {
        var el = ambil(target);
        if (!el) return;
        clearTimeout(el._skTimer);
        if (el.getAttribute(TANDA) === '1') {
            var sisa = el.querySelector(':scope > .sk-list');
            if (sisa) {
                var sr = el.querySelector(':scope > .sk-sr-only');
                if (sr) sr.remove();
                sisa.remove();
            }
        }
        el.removeAttribute(TANDA);
        el.setAttribute('aria-busy', 'false');
    }

    window.SkeletonLoader = { tampil: tampil, hapus: hapus };

    // Inisialisasi otomatis untuk wadah ber-atribut data-skeleton
    document.addEventListener('DOMContentLoaded', function () {
        var daftar = document.querySelectorAll('[data-skeleton]');
        for (var i = 0; i < daftar.length; i++) {
            tampil(daftar[i], {
                jumlah: daftar[i].getAttribute('data-skeleton'),
                varian: daftar[i].getAttribute('data-skeleton-varian') || 'komentar'
            });
        }
    });
})();
