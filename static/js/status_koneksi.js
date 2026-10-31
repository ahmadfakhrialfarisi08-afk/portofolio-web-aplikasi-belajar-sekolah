/* ============================================================
   STATUS KONEKSI ala "Dynamic Island"  ->  window.StatusKoneksi
   ------------------------------------------------------------
   Pil hitam kecil melayang di TENGAH ATAS layar (position: fixed,
   pointer-events: none, tidak memengaruhi layout apa pun) yang
   melebar/menciut dengan halus:
 
     online -> offline : melebar "Mode offline · data disimpan di
                         perangkat", lalu menciut jadi pil kecil
                         "Offline" yang tetap ada selama offline
                         (menampilkan "· N tugas menunggu" kalau ada
                         antrian).
     offline -> online : melebar "Kembali online" (atau "mengirim N
                         tugas…" kalau ada antrian), lalu "Semua
                         terkirim ke server" dan menghilang.
     online tapi antrian macet (server sibuk / koneksi jelek) : pil
                         kecil "N tugas menunggu kirim".
 
   Deteksi koneksi (tanpa request tambahan / ping):
     - event 'online' / 'offline' browser, dan
     - fetch() ke server SENDIRI yang sudah dilakukan aplikasi:
       berhasil dapat respons -> online; gagal jaringan 2x
       beruntun -> offline (menangkap "wifi nyambung tapi tak ada
       internet"). fetch ke domain lain & AbortError diabaikan.
 
   Dipakai oleh antrian_tugas_offline.js (siswa) dan
   antrian_sync_guru.js (guru) lewat setAntrian(); keduanya otomatis
   kembali ke pil oranye lama kalau file ini tidak dimuat.
   Muat file ini PALING AWAL di HTML (sebelum script lain).

   TAMPILAN: status offline = IKON wifi-off tetap di header (di sebelah
   lonceng; ketuk -> kartu kecil berisi detail + tombol periksa/kirim).
   Perubahan status (offline, kembali online, terkirim) tetap tampil
   dengan animasi "Dynamic Island" khas: pil hitam muncul sejajar jam,
   melebar, lalu menciut. Kalau lonceng tidak ditemukan di header, ikon
   jatuh ke pojok kanan atas layar.

   PEMULIH HALAMAN: file CSS/JS/gambar yang gagal dimuat (internet putus
   di tengah loading) dicatat. Begitu koneksi terbukti pulih, gambar &
   CSS dimuat ulang di tempat; kalau ada JS yang gagal, halaman di-reload
   otomatis (maks 2x per menit supaya tidak looping).
   ============================================================ */
(function () {
    'use strict';
    if (window.StatusKoneksi) return;
 
    const MS_LEBAR_OFFLINE = 2600;
    const MS_LEBAR_ONLINE = 1700;
    const MS_LEBAR_SUKSES = 1900;
    const MS_LEBAR_KIRIM = 3500;
    const TUNDA_MENUNGGU_ONLINE_MS = 3000;   // antrian < 3 dtk (kirim normal) tidak perlu ditampilkan
    const GAGAL_BERUNTUN_OFFLINE = 2;
    // true  : kalau antrian tertahan saat ONLINE (server sibuk/koneksi jelek), tampilkan pil kecil
    //         "N tugas menunggu kirim" + "Semua terkirim" -- supaya pengguna tahu datanya belum sampai.
    // false : island HANYA muncul saat berpindah online->offline dan offline->online.
    const TAMPILKAN_ANTRIAN_SAAT_ONLINE = true;
    // Pengecekan koneksi NYATA (bukan hanya navigator.onLine / event browser).
    const URL_PING = '/ping';              // route ringan di server sendiri (404 pun dianggap "server terjangkau")
    const TIMEOUT_PING_MS = 8000;         // sinyal lambat (3G) bisa butuh 3-6 dtk; 2,5 dtk terlalu ketat -> salah dibaca offline
    const INTERVAL_OFFLINE_MS = 6000;      // saat offline: cek tiap 4 dtk supaya cepat sadar kalau internet kembali
    const INTERVAL_ONLINE_MS = 45000;      // saat online: cek tiap 10 dtk supaya sadar kalau internet putus
    const JEDA_MIN_PROBE_MS = 8000;
    // Server di laptop sendiri (127.0.0.1 / localhost / IP jaringan lokal) SELALU terjangkau walau internet mati,
    // jadi di situ status online harus dibuktikan lewat situs luar. Di server internet sungguhan, /ping sudah cukup.
    // 'auto' : otomatis (pakai situs luar hanya kalau alamat halaman lokal) | true : selalu | false : tidak pernah
    const CEK_INTERNET_LUAR = 'auto';
    const URL_INTERNET_LUAR = [
        'https://www.gstatic.com/generate_204',
        'https://cp.cloudflare.com/generate_204',
        'https://www.google.com/generate_204'
    ];
    function alamatLokal() {
        const h = location.hostname;
        return h === 'localhost' || h === '::1' || h === '[::1]' || /\.local$/.test(h) ||
            /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    }
    function pakaiInternetLuar() { return CEK_INTERNET_LUAR === true || (CEK_INTERNET_LUAR === 'auto' && alamatLokal()); }
 
    const S = {
        online: navigator.onLine !== false,
        gagal: 0,
        sumber: {},                 // {siswa:{n,label,aksi}, guru:{...}}
        menungguTampil: false,
        mode: 'tersembunyi',        // tersembunyi | kompak | lebar
        ikon: '',
        teks: '',
        tTutup: null,
        tMenunggu: null,
        probe: null,
        tProbe: null,
        probeTerakhir: 0,
        okTerakhir: 0,              // kapan terakhir fetch aplikasi sendiri BERHASIL (bukti online gratis, tanpa ping)
        tMuncul: null
    };
    let wadah = null, pil = null, elIkon = null, elTeks = null;
    let ikonHdr = null, popover = null, popoverTerbuka = false;
 
    /* ---------------- DOM + CSS ---------------- */
    const CSS = [
        '#pulau-koneksi{position:fixed;top:max(10px,calc(env(safe-area-inset-top,0px) + 6px));left:0;right:0;',
        'display:flex;justify-content:center;z-index:2147483000;pointer-events:none;',
        'transition:opacity .15s ease}',
        '#pulau-koneksi.pk-turun{transform:translateY(56px)}',
        '#pulau-koneksi .pk-pill{display:inline-flex;align-items:center;gap:9px;height:30px;box-sizing:border-box;',
        'padding:0 14px;border-radius:999px;background:#08080a;color:#f5f5f7;',
        'font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;',
        'white-space:nowrap;overflow:hidden;max-width:calc(100vw - 24px);',
        'box-shadow:0 10px 30px rgba(0,0,0,.30),inset 0 0 0 1px rgba(255,255,255,.07);',
        'opacity:0;visibility:hidden;transform:translateY(-10px) scale(.55);',
        'transition:width .25s cubic-bezier(.2,.9,.25,1.05),height .2s cubic-bezier(.2,.9,.25,1.05),',
        'opacity .14s ease,transform .24s cubic-bezier(.2,.9,.25,1.05),visibility 0s linear .24s}',
        '#pulau-koneksi[data-mode="kompak"] .pk-pill,#pulau-koneksi[data-mode="lebar"] .pk-pill{',
        'opacity:1;visibility:visible;transform:none;transition-delay:0s}',
        '#pulau-koneksi[data-mode="lebar"] .pk-pill{height:38px;padding:0 18px;font-size:13px}',
        // Animasi MUNCUL (dari tersembunyi): pil turun dari atas sebagai titik kecil, lalu melebar membal ke ukuran penuh,
        // teksnya menyusul fade-in. Hanya aktif sebentar (class dilepas setelah selesai).
        '#pulau-koneksi .pk-pill.pk-muncul{transition:width .42s cubic-bezier(.18,.95,.25,1.12),height .3s cubic-bezier(.2,.9,.25,1.05),',
        'opacity .18s ease,transform .42s cubic-bezier(.18,.95,.25,1.25),visibility 0s}',
        '#pulau-koneksi .pk-pill.pk-muncul .pk-teks{animation:pk-teks-masuk .3s ease .12s both}',
        '#pulau-koneksi .pk-pill[data-tap="1"]{pointer-events:auto;cursor:pointer}',
        '#pulau-koneksi .pk-ikon{flex:none;width:9px;height:9px;border-radius:50%;display:inline-flex;',
        'align-items:center;justify-content:center}',
        '#pulau-koneksi .pk-ikon[data-jenis="offline"]{background:#f59e0b;animation:pk-denyut 1.6s ease-out infinite}',
        '#pulau-koneksi .pk-ikon[data-jenis="online"]{background:#22c55e}',
        '#pulau-koneksi .pk-ikon[data-jenis="kirim"]{width:13px;height:13px;background:none;',
        'border:2px solid rgba(255,255,255,.22);border-top-color:#38bdf8;animation:pk-putar .8s linear infinite}',
        '#pulau-koneksi .pk-ikon[data-jenis="cek"]{width:15px;height:15px;background:#22c55e;color:#08080a}',
        '#pulau-koneksi .pk-ikon[data-jenis="menunggu"]{background:#f59e0b}',
        '#pulau-koneksi .pk-teks{transition:opacity .08s ease}',
        '#pulau-koneksi .pk-pill.pk-ganti .pk-teks{opacity:0}',
        '@keyframes pk-denyut{0%{box-shadow:0 0 0 0 rgba(245,158,11,.55)}100%{box-shadow:0 0 0 8px rgba(245,158,11,0)}}',
        '@keyframes pk-putar{to{transform:rotate(360deg)}}',
        '@keyframes pk-teks-masuk{from{opacity:0}to{opacity:1}}',
        '#pulau-koneksi.pk-nol{display:none}',
        '#pulau-koneksi.pk-inline{position:relative;top:auto;left:auto;right:auto;bottom:auto;height:auto;width:auto;flex:0 1 auto;',
        'min-width:0;margin:0 8px;z-index:auto;align-self:center}',
        '#pulau-koneksi.pk-inline .pk-pill{max-width:100%}',
        '#pk-ikon-hdr{flex:none;display:inline-flex;align-items:center;justify-content:center;position:relative;box-sizing:border-box;',
        'width:38px;height:38px;border-radius:12px;padding:0;margin:0 4px;cursor:pointer;color:#d97706;',
        'background:rgba(245,158,11,.16);border:1px solid rgba(245,158,11,.45);transition:transform .15s ease}',
        '#pk-ikon-hdr[hidden]{display:none}',
        '#pk-ikon-hdr svg{width:18px;height:18px;display:block}',
        '#pk-ikon-hdr:active{transform:scale(.94)}',
        '#pk-ikon-hdr .pk-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;',
        'border-radius:8px;background:#d97706;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center}',
        '#pk-ikon-hdr .pk-badge:empty{display:none}',
        '#pk-ikon-hdr.pk-fix{position:fixed;top:max(10px,calc(env(safe-area-inset-top,0px) + 6px));right:12px;z-index:2147483000;margin:0}',
        '@keyframes pk-ikon-masuk{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
        '#pk-ikon-hdr.pk-baru{animation:pk-ikon-masuk .28s cubic-bezier(.2,.9,.25,1.2)}',
        '#pk-popover{position:fixed;z-index:2147483001;width:230px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:12px 14px;',
        'border-radius:14px;background:#fff;color:#111827;box-shadow:0 8px 28px rgba(0,0,0,.16),inset 0 0 0 1px rgba(0,0,0,.08);',
        'font:400 13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateY(-6px);',
        'pointer-events:none;transition:opacity .15s ease,transform .18s ease}',
        '#pk-popover.pk-buka{opacity:1;transform:none;pointer-events:auto}',
        '#pk-popover .pk-pt{font-weight:600;font-size:13px;margin:0 0 2px}',
        '#pk-popover .pk-pb{margin:0 0 10px;color:#4b5563}',
        '#pk-popover button{width:100%;height:34px;border-radius:10px;border:0;cursor:pointer;background:#d97706;color:#fff;font:600 12.5px/1 system-ui,sans-serif}',
        '#pk-popover.pk-gelap{background:#1f2937;color:#f3f4f6;box-shadow:0 8px 28px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.1)}',
        '#pk-popover.pk-gelap .pk-pb{color:#9ca3af}',
        '@media (prefers-reduced-motion:reduce){#pulau-koneksi,#pulau-koneksi .pk-pill{transition:opacity .2s ease !important;',
        'transform:none !important}#pulau-koneksi .pk-ikon,#pulau-koneksi .pk-pill .pk-teks{animation:none !important}}'
    ].join('');
    const SVG_CEK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="4" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
 
    // Penempatan: SEJAJAR header, di samping JAM, tepat di tengah ruang kosong antara jam dan item terdekat
    // (lonceng/tombol di sebelah kanan jam; kalau kanan sempit -> di kiri jam). Kalau tidak ada ruang cukup
    // (mis. HP), jatuh ke tengah area konten tepat di bawah header.
    const HEADER_SELECTOR = '#header-utama-guru, #header-utama, header.sticky';
    const JAM_SELECTOR = '#header-clock-container, .guru-header-center';
    const SIDEBAR_SELECTOR = '#sidebar-utama';
    const JARAK_BAWAH_HEADER = 10;
    const JARAK_DARI_ITEM = 12;
    const RUANG_MIN = 96;                  // ruang minimal agar pil kompak "Offline" muat
    function hitungRuang() {
        // -> {kiri, lebar} dalam px layar, atau null kalau tidak ada ruang di header
        const header = document.querySelector(HEADER_SELECTOR);
        const jam = document.querySelector(JAM_SELECTOR);
        if (!header || !jam) return null;
        const hr = header.getBoundingClientRect(), jr = jam.getBoundingClientRect();
        if (hr.height <= 0 || jr.width <= 0 || jr.height <= 0 || hr.bottom > window.innerHeight * 0.5) return null;
        let kiriMax = hr.left + 8, kananMin = hr.right - 8;
        header.querySelectorAll('button,a,input,select,img,#dynamic-notification-island').forEach(el => {
            if (jam.contains(el) || el.closest('#dropdown-hasil-pencarian') || el.closest('#pulau-koneksi')) return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            if (r.bottom <= jr.top || r.top >= jr.bottom) return;           // tidak sebaris dengan jam
            if (r.left >= jr.right - 2) kananMin = Math.min(kananMin, r.left);
            else if (r.right <= jr.left + 2) kiriMax = Math.max(kiriMax, r.right);
        });
        const kanan = { kiri: jr.right + JARAK_DARI_ITEM, lebar: kananMin - JARAK_DARI_ITEM - (jr.right + JARAK_DARI_ITEM) };
        const kiriR = { kiri: kiriMax + JARAK_DARI_ITEM, lebar: jr.left - JARAK_DARI_ITEM - (kiriMax + JARAK_DARI_ITEM) };
        let pilih = null;
        if (kanan.lebar >= RUANG_MIN) pilih = kanan; else if (kiriR.lebar >= RUANG_MIN) pilih = kiriR;
        if (!pilih) return null;
        pilih.atas = hr.top; pilih.tinggi = hr.height;
        return pilih;
    }
    // Perkiraan lebar pil untuk sebuah teks (dipakai memilih versi singkat sebelum diukur).
    function taksirLebar(teks) { return (wadah && wadah.dataset.mode === 'lebar' ? 6.7 : 6.2) * teks.length + 58; }
    function pendekkan(t) {
        return t
            .replace(/^Mode offline \u00b7 .*$/, 'Mode offline')
            .replace(/^Kembali online \u00b7 mengirim (\d+) (.+)\u2026$/, 'Mengirim $1 $2\u2026')
            .replace(/^Semua terkirim ke server$/, 'Terkirim')
            .replace(/^Offline \u00b7 (\d+) (.+) menunggu$/, 'Offline \u00b7 $1')
            .replace(/^(\d+) (.+) menunggu kirim$/, '$1 menunggu')
            .replace(/^Masih offline \u00b7 .*$/, 'Masih offline');
    }
    // Ruang kosong (px) di baris header untuk pil inline: lebar baris dikurangi semua item lain.
    function ruangInline() {
        const row = wadah.parentElement;
        if (!row) return null;
        const cs = getComputedStyle(row);
        let pakai = 0, n = 0;
        Array.prototype.forEach.call(row.children, c => {
            if (c === wadah) return;
            const w = c.getBoundingClientRect().width;
            if (w > 0) { pakai += w; n++; }
        });
        const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const gap = (parseFloat(cs.columnGap) || 0) * n;
        return row.clientWidth - pad - pakai - gap - 16;
    }
    function muatkan(teks) {
        let lebar = null;
        try {
            if (wadah && wadah.classList.contains('pk-inline')) lebar = ruangInline();
            else { const r = hitungRuang(); lebar = r ? r.lebar : null; }
        } catch (e) { lebar = null; }
        if (lebar === null) return teks;
        return taksirLebar(teks) <= lebar ? teks : pendekkan(teks);
    }
    // Cari JAM: lewat selector, atau lewat teks "hh:mm:ss" di bagian atas halaman.
    function cariJam() {
        if (S.jamEl && S.jamEl.isConnected && S.jamEl.getBoundingClientRect().width > 0) return S.jamEl;
        S.jamEl = null;
        let el = document.querySelector(JAM_SELECTOR);
        if (!el || el.getBoundingClientRect().width <= 0) {
            el = null;
            const akar = document.querySelector(HEADER_SELECTOR) || document.body;
            const tw = document.createTreeWalker(akar, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = tw.nextNode())) {
                if (!/\d{1,2}:\d{2}:\d{2}/.test(n.nodeValue)) continue;
                const t = n.parentElement;
                if (!t || t.closest('#pulau-koneksi')) continue;
                const r = t.getBoundingClientRect();
                if (r.width > 0 && r.top < 160) { el = t; break; }
            }
        }
        S.jamEl = el;
        return el;
    }
    // Tempat pil INLINE: tepat setelah item jam di baris header (flex) -> jam bergeser ke kiri,
    // lonceng dkk ke kanan saat pil melebar. null kalau struktur header tidak memungkinkan.
    function cariTempatInline() {
        const jam = cariJam();
        if (!jam) return null;
        const header = document.querySelector(HEADER_SELECTOR);
        const lebarMin = window.innerWidth * 0.55;
        let el = jam;
        while (el.parentElement && el.parentElement !== document.body) {
            const p = el.parentElement;
            if (p === header) break;
            const cs = getComputedStyle(p);
            const anak = Array.prototype.filter.call(p.children, c => c !== wadah && c.getBoundingClientRect().width > 0);
            const baris = /flex/.test(cs.display) && !/column/.test(cs.flexDirection);
            if (baris && anak.length >= 2 && p.getBoundingClientRect().width >= lebarMin) break;
            el = p;
        }
        const parent = el.parentElement;
        if (!parent || parent === document.body) return null;
        if (!/flex|grid/.test(getComputedStyle(parent).display)) return null;
        return { parent: parent, setelah: el };
    }
    function posisikanFixed() {
        if (!wadah) return;
        try {
            const r = hitungRuang();
            if (r && (!S.lebarTarget || S.lebarTarget <= r.lebar + 2)) {
                wadah.style.left = Math.round(r.kiri) + 'px';
                wadah.style.right = Math.round(window.innerWidth - (r.kiri + r.lebar)) + 'px';
                wadah.style.top = Math.round(r.atas) + 'px';
                wadah.style.height = Math.round(r.tinggi) + 'px';
                wadah.style.alignItems = 'center';
                return;
            }
            // Cadangan: tengah area konten, tepat di bawah header.
            wadah.style.height = '';
            wadah.style.alignItems = '';
            const header = document.querySelector(HEADER_SELECTOR);
            const hr = header && header.getBoundingClientRect();
            wadah.style.top = (hr && hr.height > 0 && hr.bottom >= 0 && hr.bottom < window.innerHeight * 0.5)
                ? Math.round(hr.bottom + JARAK_BAWAH_HEADER) + 'px' : '';
            const sb = document.querySelector(SIDEBAR_SELECTOR);
            const sr = sb && sb.getBoundingClientRect();
            const kiri = (window.innerWidth >= 768 && sr && sr.width > 0 && sr.left >= 0 && sr.left < 8 &&
                sr.right < window.innerWidth * 0.5) ? Math.round(sr.right) : 0;
            wadah.style.left = kiri + 'px';
            wadah.style.right = '0px';
        } catch (e) { /* abaikan */ }
    }
    function posisikanPil() {
        if (!wadah) return;
        let tempat = null;
        try { tempat = cariTempatInline(); } catch (e) { tempat = null; }
        if (tempat) {
            if (wadah.parentNode !== tempat.parent || wadah.previousElementSibling !== tempat.setelah) {
                tempat.parent.insertBefore(wadah, tempat.setelah.nextSibling);
            }
            wadah.classList.add('pk-inline');
            wadah.style.left = wadah.style.right = wadah.style.top = wadah.style.height = wadah.style.alignItems = '';
            return;
        }
        wadah.classList.remove('pk-inline');
        if (wadah.parentNode !== document.body) document.body.appendChild(wadah);
        posisikanFixed();
    }
    function posisikan() {
        // ikon di header dipasang DULU supaya ruang kosong di samping jam dihitung setelah ikon ada
        try { if (ikonHdr && !ikonHdr.hidden) { pastikanIkon(); if (popoverTerbuka) isiPopover(); } } catch (e) { /* abaikan */ }
        posisikanPil();
    }
    function siapkanDOM() {
        if (wadah) return true;
        if (!document.body) return false;
        if (!document.getElementById('pk-gaya')) {
            const st = document.createElement('style');
            st.id = 'pk-gaya';
            st.textContent = CSS;
            (document.head || document.documentElement).appendChild(st);
        }
        wadah = document.createElement('div');
        wadah.id = 'pulau-koneksi';
        wadah.setAttribute('role', 'status');
        wadah.setAttribute('aria-live', 'polite');
        wadah.dataset.mode = 'tersembunyi';
        wadah.classList.add('pk-nol');
        wadah.innerHTML = '<div class="pk-pill"><span class="pk-ikon"></span><span class="pk-teks"></span></div>';
        document.body.appendChild(wadah);
        pil = wadah.querySelector('.pk-pill');
        elIkon = wadah.querySelector('.pk-ikon');
        elTeks = wadah.querySelector('.pk-teks');
        pil.addEventListener('click', ketukPil);
 
        posisikan();
        window.addEventListener('resize', posisikan);
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(posisikan);
            [HEADER_SELECTOR, SIDEBAR_SELECTOR, JAM_SELECTOR].forEach(sel => { const el = document.querySelector(sel); if (el) ro.observe(el); });
        }
        return true;
    }
 
    /* ---------------- tampilan ---------------- */
    function ukurLebar(muncul) {
        // Animasikan lebar pil dari lebar sekarang ke lebar isi barunya (width:auto tidak bisa dianimasikan).
        // muncul=true (kemunculan dari tersembunyi): mulai dari titik kecil (selebar tinggi pil) lalu melebar membal.
        // CATATAN: jangan set inline transition:'none' di sini -- itu MEMBATALKAN animasi opacity/transform
        // (turun + membesar) yang baru saja dimulai oleh perubahan data-mode.
        try {
            const w0 = pil.offsetWidth;
            pil.style.width = 'auto';
            const w1 = pil.offsetWidth;
            S.lebarTarget = w1;
            if (!w0 || !w1) { pil.style.width = ''; posisikan(); return; }
            const awal = muncul ? Math.min(w1, pil.offsetHeight || 30) : w0;
            pil.style.width = awal + 'px';
            void pil.offsetWidth;
            pil.style.width = w1 + 'px';
            posisikan();
        } catch (e) { /* abaikan */ }
    }
    function setIkon(jenis) {
        if (S.ikon === jenis) return;
        S.ikon = jenis;
        elIkon.dataset.jenis = jenis;
        elIkon.innerHTML = jenis === 'cek' ? SVG_CEK : '';
    }
    function setTeks(teks) {
        teks = muatkan(teks);
        if (S.teks === teks) return;
        const awal = !S.teks;
        S.teks = teks;
        if (awal || S.mode === 'tersembunyi') { elTeks.textContent = teks; ukurLebar(true); return; }
        pil.classList.add('pk-ganti');
        setTimeout(() => {
            elTeks.textContent = teks;
            pil.classList.remove('pk-ganti');
            ukurLebar();
        }, 70);
    }
    function dapatTap() {
        return total() > 0;
    }
    function tampil(o) {
        if (!siapkanDOM()) { document.addEventListener('DOMContentLoaded', () => tampil(o), { once: true }); return; }
        clearTimeout(S.tTutup);
        S.tTutup = null;
        perbaruiIkon();
        if (o.mode === 'kompak') {
            // status menetap = IKON di header; pil menciut (animasi asli) lalu hilang
            if (S.mode === 'lebar') sembunyiPil();
            S.mode = 'kompak';
            posisikan();
            return;
        }
        clearTimeout(S.tNol);
        wadah.classList.remove('pk-nol');      // harus tampil (punya ukuran) sebelum diukur
        posisikan();
        void pil.offsetWidth;                  // paksa reflow: keadaan awal (tersembunyi) tercatat dulu, baru animasi muncul jalan
        if (S.mode === 'tersembunyi' || S.mode === 'kompak') {
            // kemunculan baru -> aktifkan animasi muncul (harus dipasang SEBELUM data-mode berubah)
            pil.classList.add('pk-muncul');
            clearTimeout(S.tMuncul);
            S.tMuncul = setTimeout(() => { if (pil) pil.classList.remove('pk-muncul'); }, 650);
        }
        wadah.dataset.mode = o.mode;   // pasang gaya mode DULU supaya lebar pil diukur dengan font/padding yang benar
        setIkon(o.ikon);
        setTeks(o.teks);
        S.mode = o.mode;
        if (dapatTap()) { pil.dataset.tap = '1'; pil.title = 'Ketuk untuk coba kirim sekarang'; }
        else { delete pil.dataset.tap; pil.removeAttribute('title'); }
        if (o.tahanMs) S.tTutup = setTimeout(() => { S.tTutup = null; (o.lalu || kembaliKeDasar)(); }, o.tahanMs);
    }
    function sembunyiPil() {
        if (wadah) wadah.dataset.mode = 'tersembunyi';
        // menciut jadi titik sambil memudar (lalu width di-reset saat muncul lagi di ukurLebar)
        if (pil) { try { pil.style.width = Math.min(pil.offsetWidth, pil.offsetHeight || 30) + 'px'; } catch (e) { pil.style.width = ''; } }
        S.teks = '';
        S.ikon = '';
        clearTimeout(S.tNol);
        S.tNol = setTimeout(() => {
            if (wadah && wadah.dataset.mode === 'tersembunyi') wadah.classList.add('pk-nol');
        }, 380);
    }
    function sembunyi() {
        S.mode = 'tersembunyi';
        sembunyiPil();
        perbaruiIkon();
    }
    function lebarSedangTampil() { return S.mode === 'lebar' && !!S.tTutup; }
 
    /* ---------------- ikon status di header ---------------- */
    const SVG_WIFI_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>' +
        '<path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/>' +
        '<path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/></svg>';
    const SVG_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
        '<path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
    function temaGelap() {
        try {
            const cls = document.documentElement.className + ' ' + (document.body ? document.body.className : '');
            if (/(^|[\s_-])dark([\s_-]|$)/i.test(cls) || /dark/i.test(document.documentElement.getAttribute('data-theme') || '') ||
                /dark/i.test(document.documentElement.getAttribute('data-mode') || '')) return true;
            for (let el = document.body; el; el = el.parentElement) {
                const m = getComputedStyle(el).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) < 110;
            }
        } catch (e) { /* abaikan */ }
        return false;
    }
    // Kalau ikon tidak muncul di sebelah lonceng, isi selector tombol lonceng di sini, mis. '#btn-notifikasi'.
    const BELL_SELECTOR = '';
    const BELL_KANDIDAT = '[class*="bell"],[data-lucide="bell"],[data-icon*="bell"],[aria-label*="otif" i],[title*="otif" i],' +
        '[id*="notif"],[id*="bell"],[class*="notif"],[onclick*="otif" i]';
    function bellValid(el) {
        if (!el || el.closest('#dynamic-notification-island') || el.closest('#pulau-koneksi') || el.closest('#pk-ikon-hdr') ||
            el.closest('#pk-popover') || el.closest('#dropdown-hasil-pencarian')) return null;
        const btn = el.closest('button,a,[role="button"]') || el;
        const r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top > 160 || r.width > 120) return null;   // lonceng: kecil & di bagian atas
        return btn;
    }
    function cariBell() {
        if (BELL_SELECTOR) {
            const el = document.querySelector(BELL_SELECTOR);
            if (el) return el;
        }
        const header = document.querySelector(HEADER_SELECTOR);
        // 1) cari di dalam header, 2) kalau tidak ada, cari di seluruh halaman (bagian atas saja)
        const lingkup = header ? [header, document] : [document];
        for (let k = 0; k < lingkup.length; k++) {
            const kand = lingkup[k].querySelectorAll(BELL_KANDIDAT);
            for (let i = 0; i < kand.length; i++) {
                const btn = bellValid(kand[i]);
                if (btn && !btn.contains(document.body) && btn.tagName !== 'HEADER') return btn;
            }
        }
        return null;
    }
    function pastikanIkon() {
        if (!document.body) return null;
        if (!ikonHdr) {
            ikonHdr = document.createElement('button');
            ikonHdr.id = 'pk-ikon-hdr';
            ikonHdr.type = 'button';
            ikonHdr.hidden = true;
            ikonHdr.setAttribute('aria-haspopup', 'dialog');
            ikonHdr.innerHTML = '<span class="pk-svg" style="display:flex"></span><span class="pk-badge"></span>';
            ikonHdr.addEventListener('click', e => { e.stopPropagation(); if (popoverTerbuka) tutupPopover(); else bukaPopover(); });
        }
        const bell = cariBell();
        if (bell && bell.parentNode) {
            if (ikonHdr.parentNode !== bell.parentNode || ikonHdr.nextSibling !== bell) {
                ikonHdr.classList.remove('pk-fix');
                bell.parentNode.insertBefore(ikonHdr, bell);
            }
            const r = bell.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                const u = Math.max(30, Math.min(44, Math.round(Math.min(r.width, r.height)))) + 'px';
                if (ikonHdr.style.width !== u) { ikonHdr.style.width = u; ikonHdr.style.height = u; }
            }
            const rad = getComputedStyle(bell).borderRadius;
            if (rad && ikonHdr.style.borderRadius !== rad) ikonHdr.style.borderRadius = rad;
        } else if (ikonHdr.parentNode !== document.body) {
            ikonHdr.classList.add('pk-fix');
            document.body.appendChild(ikonHdr);
        }
        return ikonHdr;
    }
    function perluIkon() { return !S.online || (S.menungguTampil && total() > 0); }
    function perbaruiIkon() {
        if (!perluIkon()) {
            if (ikonHdr) ikonHdr.hidden = true;
            tutupPopover();
            return;
        }
        const el = pastikanIkon();
        if (!el) return;
        const n = total();
        const jenis = S.online ? 'sync' : 'offline';
        if (el.dataset.jenis !== jenis) {
            el.dataset.jenis = jenis;
            el.querySelector('.pk-svg').innerHTML = jenis === 'sync' ? SVG_SYNC : SVG_WIFI_OFF;
        }
        el.querySelector('.pk-badge').textContent = n > 0 ? (n > 99 ? '99+' : String(n)) : '';
        el.setAttribute('aria-label', S.online ? n + ' ' + labelAntrian() + ' menunggu kirim' : 'Offline');
        if (el.hidden) {
            el.hidden = false;
            el.classList.remove('pk-baru'); void el.offsetWidth; el.classList.add('pk-baru');
        }
        if (popoverTerbuka) isiPopover();
    }
    function siapkanPopover() {
        if (popover) return popover;
        popover = document.createElement('div');
        popover.id = 'pk-popover';
        popover.setAttribute('role', 'dialog');
        popover.innerHTML = '<p class="pk-pt"></p><p class="pk-pb"></p><button type="button"></button>';
        document.body.appendChild(popover);
        popover.querySelector('button').addEventListener('click', aksiPeriksa);
        return popover;
    }
    function isiPopover() {
        if (!ikonHdr) return;
        const p = siapkanPopover(), n = total(), lb = labelAntrian();
        p.querySelector('.pk-pt').textContent = S.online ? 'Menunggu kirim' : 'Mode offline';
        p.querySelector('.pk-pb').textContent = S.online
            ? n + ' ' + lb + ' belum terkirim ke server.'
            : (n > 0 ? 'Data disimpan di perangkat. ' + n + ' ' + lb + ' menunggu kirim.'
                     : 'Data disimpan di perangkat dan dikirim saat kembali online.');
        p.querySelector('button').textContent = S.online ? 'Kirim sekarang' : 'Periksa koneksi';
        p.classList.toggle('pk-gelap', temaGelap());
        const r = ikonHdr.getBoundingClientRect();
        p.style.top = Math.round(r.bottom + 8) + 'px';
        p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    }
    function bukaPopover() {
        if (!ikonHdr || ikonHdr.hidden) return;
        popoverTerbuka = true;
        isiPopover();
        popover.classList.add('pk-buka');
    }
    function tutupPopover() {
        popoverTerbuka = false;
        if (popover) popover.classList.remove('pk-buka');
    }
    document.addEventListener('click', e => {
        if (!popoverTerbuka) return;
        if ((popover && popover.contains(e.target)) || (ikonHdr && ikonHdr.contains(e.target))) return;
        tutupPopover();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') tutupPopover(); });

    /* ---------------- keadaan ---------------- */
    function total() { return Object.values(S.sumber).reduce((a, s) => a + (s.n || 0), 0); }
    function labelAntrian() {
        const s = Object.values(S.sumber).find(x => x.n > 0);
        return (s && s.label) || 'data';
    }
    function kembaliKeDasar() {
        const n = total(), lb = labelAntrian();
        if (!S.online) {
            tampil({ mode: 'kompak', ikon: 'offline', teks: n > 0 ? 'Offline \u00b7 ' + n + ' ' + lb + ' menunggu' : 'Offline' });
        } else if (n > 0 && S.menungguTampil) {
            tampil({ mode: 'kompak', ikon: 'menunggu', teks: n + ' ' + lb + ' menunggu kirim' });
        } else if (S.mode !== 'tersembunyi') {
            if (siapkanDOM()) sembunyi();
        }
    }
    function setOnline(nilai) {
        if (nilai === S.online) return;
        S.online = nilai;
        if (!nilai) {
            S.pernahOffline = true;
            tampil({ mode: 'lebar', ikon: 'offline', teks: 'Mode offline \u00b7 data disimpan di perangkat', tahanMs: MS_LEBAR_OFFLINE });
            return;
        }
        const n = total(), lb = labelAntrian();
        if (n > 0) {
            S.menungguTampil = true;
            tampil({ mode: 'lebar', ikon: 'kirim', teks: 'Kembali online \u00b7 mengirim ' + n + ' ' + lb + '\u2026', tahanMs: MS_LEBAR_KIRIM });
            setTimeout(jalankanAksi, 0);   // internet pulih tanpa event 'online' (wifi tetap nyambung) -> antrian tetap dikirim
        } else {
            tampil({ mode: 'lebar', ikon: 'online', teks: 'Kembali online', tahanMs: MS_LEBAR_ONLINE });
        }
    }
    function jalankanAksi() {
        Object.values(S.sumber).forEach(x => { try { if (x.n > 0 && x.aksi) x.aksi(); } catch (e) { console.warn(e); } });
    }
    // Laporan pasif dari fetch() aplikasi. Keberhasilan saat status offline TIDAK langsung dipercaya
    // (bisa jawaban palsu dari service worker/cache) -> diverifikasi dengan probe nyata.
    function laporJaringan(berhasil, status) {
        if (berhasil && status !== 503 && status !== 504) {
            if (S.online) { S.gagal = 0; S.okTerakhir = Date.now(); } else periksaKoneksi();
            return;
        }
        S.gagal++;
        if (navigator.onLine === false) { setOnline(false); return; }
        periksaKoneksi();
    }
    let fetchAsli = null;
    function periksaKoneksi(paksa) {
        if (S.probe) return S.probe;
        const sekarang = Date.now();
        if (!paksa && sekarang - S.probeTerakhir < JEDA_MIN_PROBE_MS) return Promise.resolve(S.online);
        const f = fetchAsli || (typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
        if (!f) return Promise.resolve(navigator.onLine !== false);
        S.probeTerakhir = sekarang;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const tm = setTimeout(() => { if (ctl) ctl.abort(); }, TIMEOUT_PING_MS);
        const opsi = { method: 'GET', cache: 'no-store', signal: ctl ? ctl.signal : undefined };
        const ping = () => f(URL_PING + (URL_PING.indexOf('?') < 0 ? '?' : '&') + '_=' + sekarang,
            Object.assign({ credentials: 'same-origin' }, opsi))
            .then(res => res.status !== 503 && res.status !== 504 && res.status !== 0);
        // no-cors: respons "opaque" sudah cukup sebagai bukti ada internet; gagal jaringan -> reject.
        const satuLuar = u => f(u + '?_=' + sekarang, Object.assign({ mode: 'no-cors', credentials: 'omit' }, opsi)).then(() => true);
        // hemat request: coba 1 host dulu; baru kalau gagal, cadangan lainnya (dulu 3 request paralel tiap cek)
        const luar = () => satuLuar(URL_INTERNET_LUAR[0]).catch(() => Promise.any(URL_INTERNET_LUAR.slice(1).map(satuLuar)));
        const cek = pakaiInternetLuar() && typeof Promise.any === 'function' ? luar() : ping();
        S.probe = cek
            .catch(() => false)
            .then(ok => {
                clearTimeout(tm);
                S.probe = null;
                S.gagal = ok ? 0 : S.gagal + 1;
                // Satu kali gagal (timeout / sinyal lambat) BELUM berarti offline: cek ulang dulu.
                // Offline baru ditetapkan setelah GAGAL_BERUNTUN_OFFLINE kali gagal beruntun,
                // atau langsung kalau browser sendiri bilang offline.
                if (ok || !S.online || S.gagal >= GAGAL_BERUNTUN_OFFLINE || navigator.onLine === false) {
                    setOnline(ok);
                } else {
                    setTimeout(() => periksaKoneksi(true), 1500);
                }
                jadwalkan();
                if (ok) pulihkanAset();
                return ok;
            });
        return S.probe;
    }
    function jadwalkan() {
        clearTimeout(S.tProbe);
        S.tProbe = setTimeout(() => {
            if (document.hidden) { jadwalkan(); return; }
            // fetch aplikasi sendiri baru saja sukses -> sudah terbukti online, tidak perlu ping lagi
            if (S.online && Date.now() - S.okTerakhir < INTERVAL_ONLINE_MS) { jadwalkan(); return; }
            periksaKoneksi(true);
        }, S.online ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS);
    }
 
    // sumber: 'siswa' | 'guru'; n: jumlah antrian; label: 'tugas' | 'perubahan'; aksi: fungsi "kirim sekarang"
    function setAntrian(sumber, n, label, aksi) {
        const lama = total();
        S.sumber[sumber] = { n: n || 0, label: label || 'data', aksi: aksi || null };
        const baru = total();
 
        if (baru > 0 && lama === 0) {
            if (!S.online) {
                S.menungguTampil = true;
                if (!lebarSedangTampil()) kembaliKeDasar();
            } else {
                if (!TAMPILKAN_ANTRIAN_SAAT_ONLINE) return;
                clearTimeout(S.tMenunggu);
                S.tMenunggu = setTimeout(() => {
                    S.tMenunggu = null;
                    if (total() > 0) { S.menungguTampil = true; if (!lebarSedangTampil()) kembaliKeDasar(); }
                }, TUNDA_MENUNGGU_ONLINE_MS);
            }
        } else if (baru === 0) {
            clearTimeout(S.tMenunggu);
            S.tMenunggu = null;
            const adaYangDitampilkan = S.menungguTampil;
            S.menungguTampil = false;
            if (adaYangDitampilkan && S.online) {
                tampil({ mode: 'lebar', ikon: 'cek', teks: 'Semua terkirim ke server', tahanMs: MS_LEBAR_SUKSES });
            } else if (!lebarSedangTampil()) {
                kembaliKeDasar();
            }
        } else {
            // jumlah berubah (masih ada sisa): perbarui teks yang sedang tampil
            if (S.mode === 'lebar' && S.ikon === 'kirim') {
                setTeks('Kembali online \u00b7 mengirim ' + baru + ' ' + labelAntrian() + '\u2026');
            } else if (!lebarSedangTampil()) {
                kembaliKeDasar();
            }
        }
        perbaruiIkon();
    }
 
    function aksiPeriksa() {
        tutupPopover();
        const sebelum = S.online;
        tampil({ mode: 'lebar', ikon: 'kirim', teks: 'Memeriksa koneksi\u2026', tahanMs: 8000 });
        periksaKoneksi(true).then(ok => {
            if (!ok) {
                // Kalau tadinya online, setOnline(false) sudah menampilkan notifikasi offline.
                if (!sebelum) tampil({ mode: 'lebar', ikon: 'offline', teks: 'Masih offline \u00b7 data tetap aman di perangkat', tahanMs: 2800 });
                return;
            }
            // Kalau tadinya offline, setOnline(true) sudah menampilkan "Kembali online" dan memulai kirim.
            if (sebelum) {
                jalankanAksi();
                tampil({ mode: 'lebar', ikon: 'kirim', teks: 'Mencoba mengirim\u2026', tahanMs: 2000 });
            }
        });
    }
    function ketukPil() {
        if (!dapatTap()) return;
        aksiPeriksa();
    }

    /* ---------------- pemulih aset yang gagal dimuat ---------------- */
    const gagalAset = [];                      // elemen <link>/<script>/<img> yang gagal dimuat
    function urlAset(el) { return el.tagName === 'LINK' ? el.href : el.src; }
    function asetPenting(el) {
        if (!el || !el.tagName || el === window) return false;
        if (el.closest && el.closest('#pulau-koneksi')) return false;
        const u = urlAset(el);
        if (!u || /^(data|blob):/i.test(u)) return false;
        if (el.tagName === 'LINK') return /stylesheet/i.test(el.rel || '');
        return el.tagName === 'SCRIPT' || el.tagName === 'IMG';
    }
    // fase capture: error load resource tidak bubbling, jadi harus ditangkap di window
    window.addEventListener('error', e => {
        const el = e.target;
        if (el && el !== window && asetPenting(el) && gagalAset.indexOf(el) < 0) {
            gagalAset.push(el);
            if (navigator.onLine === false) S.pernahOffline = true;   // gagal karena memang sedang offline
        }
    }, true);
    function bolehMuatUlang() {
        try {
            const sekarang = Date.now();
            let n = parseInt(sessionStorage.getItem('pk_reload_n'), 10) || 0;
            const t = parseInt(sessionStorage.getItem('pk_reload_t'), 10) || 0;
            if (sekarang - t > 60000) n = 0;
            if (n >= 2) return false;
            sessionStorage.setItem('pk_reload_n', String(n + 1));
            sessionStorage.setItem('pk_reload_t', String(sekarang));
            return true;
        } catch (e) { return false; }
    }
    function bustUrl(u) { return u + (u.indexOf('?') < 0 ? '?' : '&') + 'r=' + Date.now(); }
    // Cek apakah file itu SEKARANG bisa diambil. File yang memang tidak ada di server (404)
    // bukan korban internet putus, jadi tidak boleh dipulihkan / memicu reload.
    function cekBisaDimuat(u) {
        const f = fetchAsli || (typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
        if (!f) return Promise.resolve(false);
        let sama = false;
        try { sama = new URL(u, location.href).origin === location.origin; } catch (e) { sama = false; }
        return f(u, { method: 'GET', cache: 'no-store', mode: sama ? 'same-origin' : 'no-cors', credentials: sama ? 'same-origin' : 'omit' })
            .then(res => (sama ? res.ok : true))
            .catch(() => false);
    }
    function pulihkanAset() {
        if (!gagalAset.length) return;
        // Pemulih HANYA bekerja setelah ada kejadian offline. File gagal karena sebab lain (mis. 404) diabaikan.
        if (!S.pernahOffline) { gagalAset.length = 0; return; }
        S.pernahOffline = false;
        const daftar = gagalAset.splice(0, gagalAset.length).filter(el => !el.__pkCoba);
        daftar.forEach(el => { el.__pkCoba = true; });          // tiap elemen hanya dicoba sekali
        if (!daftar.length) return;
        Promise.all(daftar.map(el => cekBisaDimuat(urlAset(el)).then(ok => (ok ? el : null)))).then(hasil => {
            const pulih = hasil.filter(Boolean);
            if (!pulih.length) return;                         // semuanya 404/permanen -> diam saja
            let perluReload = false;
            pulih.forEach(el => {
                try {
                    if (el.tagName === 'SCRIPT') { perluReload = true; return; }   // JS tidak bisa dieksekusi ulang dengan aman
                    if (el.tagName === 'IMG') { el.src = bustUrl(el.src); return; }
                    if (el.tagName === 'LINK') {
                        const baru = document.createElement('link');
                        baru.rel = 'stylesheet';
                        baru.href = bustUrl(el.href);
                        baru.onload = () => { try { el.remove(); } catch (e) { /* abaikan */ } };
                        el.parentNode && el.parentNode.insertBefore(baru, el.nextSibling);
                    }
                } catch (e) { /* abaikan */ }
            });
            if (perluReload && bolehMuatUlang()) {
                tampil({ mode: 'lebar', ikon: 'kirim', teks: 'Memulihkan halaman\u2026', tahanMs: 2500 });
                setTimeout(() => location.reload(), 700);
            }
        });
    }

    /* ---------------- deteksi koneksi ---------------- */
    function sameOrigin(input) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input);
            return new URL(url, location.href).origin === location.origin;
        } catch (e) { return false; }
    }
    if (typeof window.fetch === 'function') {
        fetchAsli = window.fetch.bind(window);
        window.fetch = function (input, init) {
            const p = fetchAsli(input, init);
            if (!sameOrigin(input)) return p;
            return p.then(
                res => { laporJaringan(true, res && res.status); return res; },
                err => { if (!err || err.name !== 'AbortError') laporJaringan(false); throw err; }
            );
        };
    }
    // Event 'online' hanya berarti "ada jaringan lokal", bukan "ada internet" -> wajib diverifikasi.
    window.addEventListener('online', () => { periksaKoneksi(true); });
    window.addEventListener('offline', () => setOnline(false));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) periksaKoneksi(!S.online); });
    window.addEventListener('focus', () => { if (!S.online) periksaKoneksi(); });
    function inisialisasi() {
        siapkanDOM();
        if (!S.online) tampil({ mode: 'lebar', ikon: 'offline', teks: 'Mode offline \u00b7 data disimpan di perangkat', tahanMs: MS_LEBAR_OFFLINE });
        periksaKoneksi(true);
        jadwalkan();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inisialisasi);
    else inisialisasi();
 
    window.StatusKoneksi = {
        setAntrian: setAntrian,
        laporJaringan: laporJaringan,
        periksa: () => periksaKoneksi(true),
        pulihkan: pulihkanAset,
        status: () => ({ online: S.online, mode: S.mode, teks: S.teks, antrian: total() })
    };
})();
 