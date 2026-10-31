/* ============================================================
   SISTEM RELEASE NOTES - modal changelog otomatis
   ============================================================
   Versi FIX (v3):
   - Tombol X dihapus (cuma pakai "Oke, Mengerti" & klik backdrop)
   - Fix error: baris card.querySelector('.close-btn') dihapus

   Versi FIX (v4):
   - Delay buatan 300ms sebelum cek release dihapus -> modal langsung
     dicek begitu script ini jalan (script sudah di posisi akhir body,
     jadi DOM sudah siap), biar gak kerasa lama muncul
   - Modal ditunda kalau siswa lagi buka tab Quiz (#tab-quiz) -- baru
     otomatis dimunculkan begitu siswa pindah tab lain / keluar dari
     Quiz, supaya gak nimpa/ganggu siswa yang lagi ngerjain soal

   Versi FIX (v5):
   - BUG: animasi masuk modal kepUTER ULANG kalau siswa pindah ke
     halaman/tab lain lalu balik lagi -- padahal release-nya SAMA dan
     SUDAH pernah ditampilkan sebelumnya di sesi browsing ini. Ini
     kejadian di 2 skenario:
     a) Ganti tab BROWSER (bukan reload) lalu balik lagi setelah >5
        detik -- tampilkanModal() lama SELALU hapus lalu bikin ulang
        elemen modal dari nol, walau modalnya masih kebuka & belum
        diklik "Oke, Mengerti" sama sekali. Sekarang: kalau modal
        MASIH ADA di DOM dan semua release yg mau ditampilkan sudah
        tercatat "pernah terbuka" di sesi ini, tampilkanModal() TIDAK
        menyentuh apa-apa lagi (return lebih awal) -- modal yang
        sedang tampil dibiarkan apa adanya, jadi 0 animasi karena
        memang tidak ada elemen baru yang dibuat sama sekali.
     b) Pindah ke HALAMAN lain (reload penuh) lalu balik lagi cepat --
        elemen modal lama otomatis hilang (dihapus browser), jadi
        modal baru TETAP harus dibuat dari nol. Class "active" sudah
        disematkan sejak awal (trik lama), tapi itu cuma ampuh kalau
        CSS entrance effect-nya pakai *transition*. Kalau CSS-nya pakai
        @keyframes, animasi tetap jalan di elemen baru walau class
        sudah ada sejak lahir. Sekarang ditambah class penanda
        "tanpa-animasi" yang otomatis dicopot lagi ~150ms kemudian --
        tinggal tambahkan rule CSS berikut SEKALI di stylesheet
        (lihat juga catatan di dalam fungsi tampilkanModal):
          .modal-overlay-release.tanpa-animasi,
          .modal-overlay-release.tanpa-animasi * {
              animation: none !important;
              transition: none !important;
          }
   ============================================================ */
(function () {
    'use strict';

    var STORAGE_KEY = 'release_dilihat_' + (window.USERNAME_SISWA_ASLI || 'guest');

    // ------------------------------------------------------------
    // TOMBOL BACK (HP/browser) NUTUP MODAL -- BARU
    // ------------------------------------------------------------
    // Referensi listener 'popstate' yang lagi aktif punya modal yang
    // SEDANG kebuka. Disimpan di level modul (bukan cuma di dalam
    // tampilkanModal()) supaya kalau modal lama dibuang tanpa lewat
    // tutup() (lihat "if (lama) lama.remove()" di tampilkanModal --
    // kejadian langka: release baru masuk pas modal lama masih kebuka),
    // listener lama itu bisa dicopot dulu, gak numpuk/nyangkut ke
    // overlay yang sudah gak ada di DOM.
    var _popstateModalHandler = null;

    // ------------------------------------------------------------
    // SESI "SEDANG TERBUKA" -- BARU
    // ------------------------------------------------------------
    // STORAGE_KEY (localStorage) di atas cuma dicatat begitu user KLIK
    // "Oke, Mengerti" (lihat tutup() di bawah) -- jadi selama modal masih
    // kebuka (belum diklik), release ID-nya BELUM ada di situ. Masalahnya:
    // kalau user pindah halaman (navigasi penuh, bukan cuma ganti tab
    // dalam satu halaman) lalu balik lagi SEBELUM sempat klik "Oke,
    // Mengerti", script ini jalan dari awal lagi (DOMContentLoaded baru),
    // ketemu release yang SAMA masih "belum dilihat" dari localStorage,
    // terus animasi masuknya keputer ULANG -- kesannya kayak modal baru
    // muncul dari nol, padahal user sudah pernah lihat sebelumnya.
    //
    // Solusinya: catat SECARA TERPISAH (pakai sessionStorage -- otomatis
    // ke-reset kalau tab browser bener-bener ditutup, beda dari
    // localStorage yang permanen) ID release yang SUDAH SEMPAT
    // ditampilkan dengan animasi di sesi browsing ini. Begitu balik ke
    // halaman yang sama dalam sesi yang sama, kalau ID-nya sudah ada di
    // daftar ini, modal langsung ditampilkan DALAM KONDISI SUDAH TERBUKA
    // (tanpa animasi masuk sama sekali) -- baru dihapus dari daftar ini
    // begitu user resmi menutup modalnya lewat "Oke, Mengerti".
    var SESI_TERBUKA_KEY = 'release_sesi_terbuka_' + (window.USERNAME_SISWA_ASLI || 'guest');

    function ambilSesiTerbuka() {
        try {
            var raw = sessionStorage.getItem(SESI_TERBUKA_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (e) { return new Set(); }
    }
    function simpanSesiTerbuka(setIds) {
        try { sessionStorage.setItem(SESI_TERBUKA_KEY, JSON.stringify(Array.from(setIds))); } catch (e) {}
    }
    function tandaiSesiTerbuka(daftarRelease) {
        var sesi = ambilSesiTerbuka();
        daftarRelease.forEach(function(r){ if (r && r.id) sesi.add(r.id); });
        simpanSesiTerbuka(sesi);
    }
    function hapusDariSesiTerbuka(daftarRelease) {
        var sesi = ambilSesiTerbuka();
        daftarRelease.forEach(function(r){ if (r && r.id) sesi.delete(r.id); });
        simpanSesiTerbuka(sesi);
    }
    // True HANYA kalau SEMUA release di daftar ini sudah pernah
    // ditampilkan (dengan animasi) di sesi browsing ini -- kalau ada
    // release BARU yang belum pernah ditampilkan sama sekali (mis. admin
    // baru saja toggle OFF maintenance lagi selagi user masih di
    // halaman), tetap dianggap "baru" supaya animasinya tetap muncul
    // buat release yang memang baru itu.
    function semuaSudahTerbukaSesiIni(daftarRelease) {
        var sesi = ambilSesiTerbuka();
        return daftarRelease.length > 0 && daftarRelease.every(function(r){
            return r && r.id && sesi.has(r.id);
        });
    }

    function ambilReleaseDilihat() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (e) { return new Set(); }
    }
    function simpanReleaseDilihat(setIds) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(setIds))); } catch (e) {}
    }

    var BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];
    function formatJam(ms) {
        var d = new Date(ms);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function formatTanggalLengkap(ms) {
        var d = new Date(ms);
        return d.getDate() + ' ' + BULAN_ID[d.getMonth()] + ' ' + d.getFullYear();
    }
    function formatDurasi(menit) {
        if (menit >= 60) {
            var jam = Math.floor(menit / 60);
            var sisa = menit % 60;
            return sisa > 0 ? jam + ' jam ' + sisa + ' menit' : jam + ' jam';
        }
        return menit + ' menit';
    }
    function escapeHtml(s) {
        var div = document.createElement('div');
        div.textContent = String(s == null ? '' : s);
        return div.innerHTML;
    }

    function renderBlokRelease(release) {
        var blok = document.createElement('div');
        blok.className = 'release-blok';

        var tgl = release.tanggal_tampil || formatTanggalLengkap(release.selesai || Date.now());
        var jm = formatJam(release.mulai || Date.now());
        var js = formatJam(release.selesai || Date.now());
        var dur = formatDurasi(release.durasi_menit || 1);

        var baris = '';
        (release.fitur_baru || []).forEach(function(f){
            baris += '<tr>' +
                '<td><span class="badge-baru">Baru</span></td>' +
                '<td><strong>' + escapeHtml(f.nama || '') + '</strong></td>' +
                '<td>' + escapeHtml(f.desc || '') + '</td>' +
                '</tr>';
        });
        (release.perbaikan || []).forEach(function(p){
            baris += '<tr>' +
                '<td><span class="badge-fix">Fix</span></td>' +
                '<td><strong>' + escapeHtml(p.nama || '') + '</strong></td>' +
                '<td>' + escapeHtml(p.desc || '') + '</td>' +
                '</tr>';
        });
        if (!baris) {
            baris = '<tr>' +
                '<td><span class="badge-fix">Fix</span></td>' +
                '<td><strong>' + escapeHtml(release.fitur_nama || 'Sistem') + '</strong></td>' +
                '<td>Perbaikan & pemeliharaan rutin.</td>' +
                '</tr>';
        }

        blok.innerHTML =
            '<div class="release-header">' +
                '<div class="release-header-kiri">' +
                    '<span class="release-versi">' + escapeHtml(release.versi || '') + '</span>' +
                    '<span class="release-fitur-tag">' + escapeHtml(release.fitur_nama || '') + '</span>' +
                '</div>' +
                '<div class="release-waktu">' +
                    escapeHtml(tgl) + ' - ' + jm + ' s/d ' + js + ' WIB' +
                    '<span class="release-durasi">(durasi ' + dur + ')</span>' +
                '</div>' +
            '</div>' +
            '<table class="changelog-table">' +
                '<thead><tr><th>Tipe</th><th>Fitur</th><th>Keterangan</th></tr></thead>' +
                '<tbody>' + baris + '</tbody>' +
            '</table>';
        return blok;
    }

    // ------------------------------------------------------------
    // PENUNDA KHUSUS TAB QUIZ
    // ------------------------------------------------------------
    // Modal changelog TIDAK BOLEH nongol nimpa siswa yang lagi
    // ngerjain quiz (mengganggu fokus/bisa ke-anggep jawaban ke-klik
    // ke tombol modal). Begitu tab Quiz (#tab-quiz) ketahuan lagi
    // TERBUKA, daftar release yang belum dilihat cuma "ditahan" dulu
    // (bukan dibatalkan) -- begitu siswa pindah tab lain / keluar
    // dari Quiz (elemen #tab-quiz dikasih class "hidden" oleh
    // switchTab() di dashboard_siswa.js), modal langsung dimunculkan.
    // Dipantau lewat MutationObserver ke atribut class-nya, jadi tidak
    // perlu ubah/sentuh kode switchTab() di file lain sama sekali.
    var _releaseTertunda = null;
    var _observerTabQuiz = null;

    function tabQuizSedangTerbuka() {
        var tabQuiz = document.getElementById('tab-quiz');
        return !!(tabQuiz && !tabQuiz.classList.contains('hidden'));
    }

    function tampilkanAtauTundaSaatQuiz(daftarRelease) {
        if (!daftarRelease || daftarRelease.length === 0) return;

        var tabQuiz = document.getElementById('tab-quiz');
        if (!tabQuiz || !tabQuizSedangTerbuka()) {
            tampilkanModal(daftarRelease);
            return;
        }

        // Simpan/update daftar yang mau ditampilkan begitu siswa keluar
        // dari tab Quiz. Kalau observer sebelumnya masih aktif (mis. dari
        // pengecekan visibilitychange sebelumnya), cukup update datanya,
        // tidak perlu pasang observer baru yang dobel.
        _releaseTertunda = daftarRelease;
        if (_observerTabQuiz) return;

        _observerTabQuiz = new MutationObserver(function () {
            if (tabQuiz.classList.contains('hidden')) {
                _observerTabQuiz.disconnect();
                _observerTabQuiz = null;
                var siapTampil = _releaseTertunda;
                _releaseTertunda = null;
                if (siapTampil) tampilkanModal(siapTampil);
            }
        });
        _observerTabQuiz.observe(tabQuiz, { attributes: true, attributeFilter: ['class'] });
    }

    function tampilkanModal(daftarRelease) {
        var lama = document.getElementById('modal-release-notes');

        // Dihitung DULU sebelum modal lama disentuh -- dipakai buat 2
        // keputusan sekaligus di bawah.
        var tanpaAnimasiMasuk = semuaSudahTerbukaSesiIni(daftarRelease);

        // BARU (v5): kalau modal lama MASIH ADA di DOM (berarti masih
        // kebuka, user belum klik "Oke, Mengerti") DAN semua release
        // yang mau ditampilkan sudah tercatat "pernah terbuka" di sesi
        // ini -- modal yang sekarang SUDAH PAS, JANGAN diapa-apakan
        // sama sekali (jangan dihapus, jangan dibuat ulang). Ini yang
        // memperbaiki bug animasi keputer ulang pas ganti-ganti tab
        // browser lalu balik lagi.
        if (lama && tanpaAnimasiMasuk) return;
        if (lama) {
            lama.remove();
            if (_popstateModalHandler) {
                window.removeEventListener('popstate', _popstateModalHandler);
                _popstateModalHandler = null;
            }
        }

        // Kalau daftar release ini SEMUA sudah pernah ditampilkan
        // (dengan animasi) di sesi ini -- tampilkan LANGSUNG dalam
        // kondisi terbuka (class 'active' langsung disematkan SEBELUM
        // elemen dimasukkan ke DOM), supaya TIDAK ADA transisi/animasi
        // masuk yang keputer -- persis kelihatan seperti modal yang
        // "masih terbuka dari tadi", bukan baru muncul. Kalau belum
        // pernah (release baru), animasi masuk tetap jalan seperti biasa
        // & langsung dicatat ke sesi supaya kalau nanti balik lagi ke
        // halaman ini (masih dalam sesi yang sama, belum diklik "Oke,
        // Mengerti") tidak animasi ulang lagi.
        if (!tanpaAnimasiMasuk) tandaiSesiTerbuka(daftarRelease);

        var overlay = document.createElement('div');
        overlay.id = 'modal-release-notes';
        // "tanpa-animasi": class penanda TAMBAHAN (di luar "active"),
        // khusus buat kasus modal DIBUAT ULANG dari nol (mis. abis
        // reload/pindah halaman lalu balik cepat). Ini jaga-jaga kalau
        // CSS entrance effect-nya pakai @keyframes -- karena keyframe
        // animation tetap jalan di elemen yang BARU dibuat walau class
        // "active" sudah ada sejak lahir (beda sama transition biasa
        // yang memang bisa "dilewatin" dgn trik pre-set class begini).
        // Class ini otomatis dicopot lagi ~150ms kemudian (lihat bawah)
        // supaya transisi/animasi LAIN di dalam modal (mis. hover
        // tombol) tidak ikut mati permanen. Supaya class ini benar-benar
        // ampuh, tambahkan rule berikut SEKALI di CSS:
        //   .modal-overlay-release.tanpa-animasi,
        //   .modal-overlay-release.tanpa-animasi * {
        //       animation: none !important;
        //       transition: none !important;
        //   }
        overlay.className = 'modal-overlay-release' +
            (tanpaAnimasiMasuk ? ' active tanpa-animasi' : '');

        var jumlah = daftarRelease.length;
        var card = document.createElement('div');
        card.className = 'changelog-card';
        card.innerHTML =
            '<div class="changelog-header">' +
                '<div>' +
                    '<h2>Maintenance Selesai</h2>' +
                    '<p class="subtitle">' +
                        (jumlah === 1 ? 'Ada update terbaru buat kamu' : jumlah + ' update yang belum kamu lihat') +
                    '</p>' +
                '</div>' +
            '</div>' +
            '<div class="changelog-body-wrap" id="release-body-wrap"></div>' +
            '<div class="changelog-footer">' +
                '<span>Coba fitur barunya sekarang!</span>' +
                '<button class="btn-ok" type="button">Oke, Mengerti</button>' +
            '</div>';

        overlay.appendChild(card);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        var bodyWrap = card.querySelector('#release-body-wrap');
        var terurut = daftarRelease.slice().sort(function(a,b){
            return (a.selesai || 0) - (b.selesai || 0);
        });
        terurut.forEach(function(r){ bodyWrap.appendChild(renderBlokRelease(r)); });

        requestAnimationFrame(function(){ overlay.classList.add('active'); });
        // ^ Kalau tanpaAnimasiMasuk sudah True, class 'active' ini sudah
        // ikut di className sejak awal (lihat atas) -- baris di atas
        // cuma no-op (nge-add class yang sudah ada), aman dipanggil terus
        // tanpa perlu percabangan if/else tambahan di sini.

        // BARU (v5): copot lagi class "tanpa-animasi" begitu elemen
        // sudah sempat dirender sekali (150ms cukup, jauh dari waktu
        // reaksi klik user) -- supaya cuma animasi MASUK-nya saja yang
        // diredam, bukan bikin semua transisi di dalam modal (mis.
        // hover tombol "Oke, Mengerti") mati permanen selama modal itu
        // kebuka.
        if (tanpaAnimasiMasuk) {
            setTimeout(function(){ overlay.classList.remove('tanpa-animasi'); }, 150);
        }

        // === BARU: tombol back (tombol fisik/gestur HP, atau tombol back
        // browser) nutup modal ini aja, BUKAN pindah/keluar dari halaman
        // dashboard. Caranya: begitu modal kebuka, kita "titip" 1 entry
        // history kosong (URL-nya sama persis, gak ada navigasi beneran).
        // Kalau user pencet back selagi modal masih kebuka, browser
        // mengonsumsi entry titipan itu & memicu event 'popstate' --
        // kita tangkap itu buat nutup modal (bukan biarkan browser
        // lanjut mundur ke halaman sebelum dashboard).
        var tutupDipicuTombolBack = false;
        history.pushState({ modalReleaseNotes: true }, '', location.href);
        _popstateModalHandler = function () {
            tutupDipicuTombolBack = true;
            tutup();
        };
        window.addEventListener('popstate', _popstateModalHandler);

        function tutup() {
            var sudah = ambilReleaseDilihat();
            terurut.forEach(function(r){ if (r && r.id) sudah.add(r.id); });
            simpanReleaseDilihat(sudah);
            hapusDariSesiTerbuka(terurut);
            overlay.classList.remove('active');

            window.removeEventListener('popstate', _popstateModalHandler);
            _popstateModalHandler = null;

            // Kalau tutup() ini dipicu tombol "Oke, Mengerti"/backdrop/Esc
            // (BUKAN dari popstate/tombol back), berarti entry history yang
            // kita titipkan di atas masih "nyangkut" di riwayat browser --
            // buang balik supaya sekali pencet back nanti user LANGSUNG
            // keluar dashboard, gak perlu 2x pencet gara-gara ada entry
            // kosong sisa modal ini.
            if (!tutupDipicuTombolBack) {
                history.back();
            }

            setTimeout(function(){
                overlay.remove();
                document.body.style.overflow = '';
            }, 300);
        }

        // PENTING: baris card.querySelector('.close-btn') DIHAPUS
        // karena tombol X udah nggak ada. Kalau tetap ada, error
        // "Cannot read properties of null" muncul & fungsi tutup()
        // nggak ke-pasang ke tombol "Oke, Mengerti".
        card.querySelector('.btn-ok').addEventListener('click', tutup);
        overlay.addEventListener('click', function(e){
            if (e.target === overlay) tutup();
        });

        function escHandler(e) {
            if (e.key === 'Escape') {
                tutup();
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('keydown', escHandler);
    }

    // ------------------------------------------------------------
    // URUTAN "PELANGGARAN DULU, BARU CHANGELOG" -- BARU
    // ------------------------------------------------------------
    // SEBELUMNYA script ini langsung cek & tampilkan modal changelog begitu
    // DOM siap (mulaiCekRelease() dipanggil otomatis di bawah), JALAN
    // BARENGAN/duluan dari overlay peringatan pelanggaran
    // (dashboard_siswa_pelanggaran.js) -- dua modal itu bisa numpuk/rebutan
    // tampil di layar yang sama waktu login.
    // Sekarang pengecekan PERTAMA (saat dashboard baru dibuka/login) SENGAJA
    // TIDAK otomatis jalan sendiri lagi -- window.__cekReleaseNotes() di
    // bawah baru dipanggil oleh dashboard_siswa_pelanggaran.js SETELAH semua
    // pelanggaran aktif (kalau ada) selesai di-ACC satu-per-satu, ATAU
    // langsung (tanpa jeda) kalau siswa itu memang tidak sedang punya
    // pelanggaran aktif sama sekali. Pengecekan LANJUTAN (mis. tab
    // browser kembali aktif setelah lama di-minimize) TETAP jalan otomatis
    // seperti biasa lewat listener 'visibilitychange' di bawah -- tidak ada
    // yang berubah dari sisi itu.
    var sedangCek = false;
    function cekDanTampilkanRelease() {
        if (sedangCek) return;
        sedangCek = true;
        fetch('/api/releases/list')
            .then(function(res){ return res.ok ? res.json() : null; })
            .then(function(json){
                if (!json || !json.success || !Array.isArray(json.data)) return;
                var sudah = ambilReleaseDilihat();
                var belum = [];
                var idPakai = new Set();
                json.data.forEach(function(r){
                    if (!r || !r.id) return;
                    if (sudah.has(r.id)) return;
                    if (idPakai.has(r.id)) return;
                    idPakai.add(r.id);
                    belum.push(r);
                });
                if (belum.length === 0) return;
                tampilkanAtauTundaSaatQuiz(belum);
            })
            .catch(function(e){ console.warn('[release-notes] gagal:', e); })
            .then(function(){ sedangCek = false; });
    }

    // BARU: pengecekan pertama TIDAK lagi dipicu otomatis di sini (lihat
    // catatan besar di atas fungsi cekDanTampilkanRelease). Dipicu dari luar
    // lewat window.__cekReleaseNotes(), oleh dashboard_siswa_pelanggaran.js
    // setelah antrian pelanggaran (kalau ada) selesai. Kalau file itu belum
    // dipasang/gagal load (mis. markup lama), sediakan fallback: tetap cek
    // sendiri begitu DOM siap, ditunda dikit supaya tidak nabrak animasi
    // transisi masuk dashboard, TAPI cuma kalau ternyata belum sempat
    // dipicu manual sama sekali dalam beberapa detik pertama -- supaya
    // changelog tidak pernah "ketelan"/tidak pernah tampil sama sekali
    // kalau script pelanggaran ternyata tidak ada di halaman ini.
    var FALLBACK_TUNGGU_TRIGGER_MANUAL_MS = 2000;
    function jalankanFallbackJikaBelumDipicu() {
        setTimeout(function () {
            if (!sedangCek && !window.__releaseNotesSudahDipicuManual) {
                cekDanTampilkanRelease();
            }
        }, FALLBACK_TUNGGU_TRIGGER_MANUAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', jalankanFallbackJikaBelumDipicu, { once: true });
    } else {
        jalankanFallbackJikaBelumDipicu();
    }

    var _terakhirCekRelease = 0;
    document.addEventListener('visibilitychange', function(){
        if (document.visibilityState !== 'visible') return;
        var sekarang = Date.now();
        if (sekarang - _terakhirCekRelease < 5000) return;
        _terakhirCekRelease = sekarang;
        cekDanTampilkanRelease();
    });

    window.__cekReleaseNotes = function () {
        window.__releaseNotesSudahDipicuManual = true;
        cekDanTampilkanRelease();
    };
    window.__resetReleaseDilihat = function(){
        try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
        console.log('[release-notes] reset. Refresh halaman.');
    };
})();