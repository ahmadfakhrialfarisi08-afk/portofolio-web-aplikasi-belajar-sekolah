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
    const TIMEOUT_PING_MS = 2500;
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
    function muatkan(teks) {
        let r = null;
        try { r = hitungRuang(); } catch (e) { r = null; }
        if (!r) return teks;                                   // di bawah header: ruang longgar, pakai teks penuh
        return taksirLebar(teks) <= r.lebar ? teks : pendekkan(teks);
    }
    function posisikan() {
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
        posisikan();
        clearTimeout(S.tTutup);
        S.tTutup = null;
        if (S.mode === 'tersembunyi') {
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
    function sembunyi() {
        S.mode = 'tersembunyi';
        if (wadah) wadah.dataset.mode = 'tersembunyi';
        // menciut jadi titik sambil memudar (lalu width di-reset saat muncul lagi di ukurLebar)
        if (pil) { try { pil.style.width = Math.min(pil.offsetWidth, pil.offsetHeight || 30) + 'px'; } catch (e) { pil.style.width = ''; } }
        S.teks = '';
        S.ikon = '';
    }
    function lebarSedangTampil() { return S.mode === 'lebar' && !!S.tTutup; }
 
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
                setOnline(ok);
                jadwalkan();
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
    }
 
    function ketukPil() {
        if (!dapatTap()) return;
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
        status: () => ({ online: S.online, mode: S.mode, teks: S.teks, antrian: total() })
    };
})();
 