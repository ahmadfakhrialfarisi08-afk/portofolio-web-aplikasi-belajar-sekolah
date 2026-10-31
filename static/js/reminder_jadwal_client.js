/* ================================================================
   REMINDER JADWAL MENGAJAR -- TAMPILAN (status 100% dari server)
   Muat SETELAH dashboard_guru.js:
     <script src="{{ url_for('static', filename='reminder_jadwal_client.js') }}"></script>

   Browser tidak menghitung waktu apa pun. Ia hanya bertanya ke
   GET /api/reminder/jadwal/aktif lalu menampilkan hasilnya, sehingga refresh
   dan pindah halaman tidak mereset apa pun. Memakai ulang fungsi yang sudah ada:
   switchTab, sorotKartuKelasGuru (scroll + highlight), bukaModalBeriTugas,
   mulaiBunyikanBel, daftarSeluruhKelasDummy.
   ================================================================ */
(function () {
    'use strict';
    window.REMINDER_JADWAL_SERVER = true;   // mematikan 3 sistem lama berbasis browser (lihat patch)

    var URL_AKTIF = '/api/reminder/jadwal/aktif';
    var URL_AKSI = '/api/reminder/jadwal/aksi';
    var timer = null, berjalan = false, berhenti = false, tundaBunyi = false;
    var tampil = {}; // "sesi_id|tahap" -> elemen

    /* ---------- gaya ---------- */
    var st = document.createElement('style');
    st.textContent = [
        '.rjs-banner{position:fixed;z-index:70;left:12px;top:calc(12px + env(safe-area-inset-top,0px));width:min(420px,calc(100vw - 24px));display:flex;gap:10px;align-items:center;cursor:pointer;background:#1e3a8a;color:#fff;border-radius:16px;padding:12px 14px;box-shadow:0 14px 34px -10px rgba(30,64,175,.6);animation:rjs-kanan .6s cubic-bezier(.22,.8,.3,1) both}',
        '.rjs-banner.rjs-keluar{animation:rjs-kiri .3s ease-in both}',
        '@keyframes rjs-kanan{from{transform:translateX(-115%);opacity:0}to{transform:translateX(0);opacity:1}}',
        '@keyframes rjs-kiri{from{transform:translateX(0);opacity:1}to{transform:translateX(-115%);opacity:0}}',
        '.rjs-banner p{margin:0;flex:1;font-size:13px;font-weight:800;line-height:1.4}',
        '.rjs-banner small{display:block;font-weight:600;opacity:.8;font-size:11px;margin-top:2px}',
        '.rjs-x{border:0;background:rgba(255,255,255,.15);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;line-height:1}',
        '.rjs-tab{position:fixed;z-index:65;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));width:min(340px,calc(100vw - 24px));background:#fff;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:14px;padding:10px 12px;box-shadow:0 10px 28px -10px rgba(217,119,6,.45)}',
        '.rjs-tab p,.rjs-mulai p{margin:0 0 8px;font-size:12.5px;font-weight:800;color:#0f172a;line-height:1.4}',
        '.rjs-mulai{position:fixed;z-index:75;left:50%;transform:translateX(-50%);top:calc(12px + env(safe-area-inset-top,0px));width:min(440px,calc(100vw - 24px));background:#fff;border:1px solid #fecdd3;border-left:4px solid #e11d48;border-radius:16px;padding:12px 14px;box-shadow:0 16px 40px -10px rgba(225,29,72,.5)}',
        '.rjs-aksi{display:flex;flex-wrap:wrap;gap:6px}',
        '.rjs-btn{border:0;border-radius:999px;padding:7px 13px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;background:#eff6ff;color:#1d4ed8}',
        '.rjs-btn.rjs-utama{background:#2563eb;color:#fff}',
        '.rjs-hint{margin:6px 0 0;font-size:10.5px;color:#64748b}',
        'html.dark .rjs-tab,html.dark .rjs-mulai{background:#1e293b;border-color:#334155}',
        'html.dark .rjs-tab p,html.dark .rjs-mulai p{color:#f1f5f9}',
        '@media (prefers-reduced-motion:reduce){.rjs-banner,.rjs-banner.rjs-keluar{animation:none}}'
    ].join('\n');
    document.head.appendChild(st);

    /* ---------- util ---------- */
    function el(tag, cls, teks) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (teks != null) e.textContent = teks;   // textContent: aman dari injeksi HTML
        return e;
    }
    function tombol(label, cls, fn) {
        var b = el('button', 'rjs-btn ' + (cls || ''), label);
        b.type = 'button';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
        return b;
    }
    function kirimAksi(sesiId, aksi) {
        return fetch(URL_AKSI, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sesi_id: sesiId, aksi: aksi })
        }).catch(function () { /* status akan dibaca ulang saat polling berikutnya */ });
    }
    function kelasAda(nama) {
        return typeof daftarSeluruhKelasDummy !== 'undefined' && daftarSeluruhKelasDummy.some(function (k) { return k.nama === nama; });
    }
    function lepas(e) {
        if (!e || e._keluar) return;
        e._keluar = true;
        e.classList.add('rjs-keluar');
        setTimeout(function () { e.remove(); }, 320);
    }

    /* ---------- aksi ---------- */
    function keKartuKelas(kelas) {
        // Alur klik banner: Beranda Guru -> scroll ke kartu kelas -> highlight
        if (typeof switchTab === 'function') switchTab('beranda');
        setTimeout(function () { if (typeof sorotKartuKelasGuru === 'function') sorotKartuKelasGuru(kelas); }, 80);
    }
    function bukaTugas(it) {
        kirimAksi(it.sesi_id, 'beri_tugas_dibuka');
        if (kelasAda(it.kelas) && typeof bukaModalBeriTugas === 'function') bukaModalBeriTugas(it.kelas);
    }

    /* ---------- tampilan per tahap ---------- */
    function buatBanner(it) {
        var b = el('div', 'rjs-banner');
        b.setAttribute('role', 'status');
        var p = el('p', null, '🔔 10 menit lagi Anda mengajar ' + it.kelas);
        p.appendChild(el('small', null, it.mapel + ' • ' + it.jam));
        var x = el('button', 'rjs-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Tutup');
        x.addEventListener('click', function (ev) { ev.stopPropagation(); kirimAksi(it.sesi_id, 'banner_ditutup'); lepas(b); });
        b.addEventListener('click', function () { kirimAksi(it.sesi_id, 'banner_diklik'); lepas(b); keKartuKelas(it.kelas); });
        b.appendChild(p); b.appendChild(x);
        return b;
    }
    function buatTab(it) {
        var t = el('div', 'rjs-tab'); t.setAttribute('role', 'status');
        t.appendChild(el('p', null, '⏰ 5 menit lagi mengajar ' + it.kelas));
        var a = el('div', 'rjs-aksi');
        a.appendChild(tombol('Mengajar di Kelas', 'rjs-utama', function () {
            kirimAksi(it.sesi_id, 'mengajar_langsung').then(function () { muat(); });   // hanya mencatat pilihan
        }));
        a.appendChild(tombol('Beri Tugas/Catatan', '', function () { bukaTugas(it); }));
        t.appendChild(a);
        return t;
    }
    function buatMulai(it) {
        var m = el('div', 'rjs-mulai'); m.setAttribute('role', 'alert');
        m.appendChild(el('p', null, '🔔 Waktu mengajar ' + it.kelas + ' sudah dimulai. Silakan masuk ke kelas atau berikan tugas/catatan.'));
        var a = el('div', 'rjs-aksi');
        a.appendChild(tombol('Mengajar di Kelas', 'rjs-utama', function () {
            kirimAksi(it.sesi_id, 'mengajar_langsung').then(function () { muat(); });
        }));
        a.appendChild(tombol('Beri Tugas/Catatan', '', function () { bukaTugas(it); }));
        a.appendChild(tombol('Ke Kartu Kelas', '', function () { keKartuKelas(it.kelas); }));
        m.appendChild(a);
        return m;
    }

    /* ---------- bunyi (hanya jika browser mengizinkan; volume tidak dipaksa) ---------- */
    function bunyikan() {
        try {
            if (typeof mulaiBunyikanBel === 'function') mulaiBunyikanBel();   // fungsi bel yang sudah ada
            if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
            var ctx = (typeof audioCtxBel !== 'undefined') ? audioCtxBel : null;
            if (ctx && ctx.state === 'suspended') {
                tundaBunyi = true;   // autoplay diblokir: bunyi saat guru pertama kali menyentuh layar
                var ulang = function () {
                    document.removeEventListener('pointerdown', ulang, true);
                    if (tundaBunyi) { tundaBunyi = false; try { mulaiBunyikanBel(); } catch (e) {} }
                };
                document.addEventListener('pointerdown', ulang, true);
            }
        } catch (e) { console.warn('Bunyi pengingat tidak dapat diputar:', e); }
    }

    /* ---------- sinkron dengan server ---------- */
    function terapkan(daftar) {
        var perlu = {};
        daftar.forEach(function (it) { perlu[it.sesi_id + '|' + it.tahap] = it; });
        Object.keys(tampil).forEach(function (k) {          // yang tidak relevan lagi dilepas
            if (!perlu[k]) { lepas(tampil[k]); delete tampil[k]; }
        });
        daftar.forEach(function (it) {
            var k = it.sesi_id + '|' + it.tahap;
            if (!tampil[k]) {                                // tidak pernah membuat dobel
                var e = it.tahap === 'sepuluh' ? buatBanner(it) : it.tahap === 'lima' ? buatTab(it) : buatMulai(it);
                document.body.appendChild(e);
                tampil[k] = e;
            }
            if (it.bunyi) bunyikan();                        // server menandai: sekali per sesi
        });
    }

    function jadwalkan(detik) {
        clearTimeout(timer);
        if (berhenti) return;
        timer = setTimeout(muat, Math.max(2, Math.min(30, detik || 20)) * 1000);
    }

    function muat() {
        if (berhenti) return;
        if (berjalan) return;
        if (document.hidden) { jadwalkan(30); return; }
        berjalan = true;
        fetch(URL_AKTIF, { credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) {
                if (r.status === 401 || r.status === 403) { berhenti = true; return null; }
                if (r.status === 429) { jadwalkan(30); return null; }
                return r.json();
            })
            .then(function (d) {
                if (d && d.ok) { terapkan(d.pengingat || []); jadwalkan(d.poll_lagi_detik); }
            })
            .catch(function () { jadwalkan(30); })
            .then(function () { berjalan = false; });
    }

    window.ReminderJadwal = {
        segarkan: muat,
        // Dipanggil setelah guru mengirim tugas. Simpan tugas ke server tidak ditunggu oleh
        // alur lama (fire-and-forget), jadi cek ulang sedikit tertunda lalu sekali lagi.
        segarkanSetelahTugas: function () { setTimeout(muat, 1500); setTimeout(muat, 5000); }
    };

    document.addEventListener('visibilitychange', function () { if (!document.hidden) muat(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', muat); else muat();
})();
