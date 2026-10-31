/* ============================================================
   ANTRIAN KIRIM TUGAS OFFLINE  ->  window.AntrianTugas
   ------------------------------------------------------------
   Tujuan: kalau internet siswa putus saat menekan "Kirim Tugas",
   tugas TETAP tampil terkirim di layar HP, tapi request aslinya
   disimpan di antrian (IndexedDB) dan baru dikirim ke server
   begitu internet kembali.

   Alur:
     1. kirim() -> simpan item ke IndexedDB DULU (tahan refresh /
        tab ketutup), baru coba kirim ke /api/tugas/submit.
     2. Sukses            -> item dihapus, status 'terkirim'.
        Gagal jaringan/429/5xx/timeout -> item tetap di antrian,
        status 'antri' (UI menampilkan "tersimpan, menunggu internet").
        Ditolak server (deadline lewat, tugas ditarik, dst)
        -> item dihapus, status 'ditolak'.
     3. Pengiriman ulang otomatis: event 'online', tab aktif lagi,
        halaman dibuka lagi, dan timer berkala (backoff + jitter).
        Satu request per kali, urut FIFO, dengan jeda acak supaya
        banyak siswa yang tersambung bareng TIDAK membanjiri server.

   Server menerima `client_id` (idempoten, aman dikirim ulang) dan
   `client_waktu` (ms epoch saat tombol ditekan di HP).
   ============================================================ */
(function () {
    'use strict';

    const DB_NAME = 'antrian_tugas_offline_v1';
    const STORE = 'antrian';
    const URL_SUBMIT = '/api/tugas/submit';

    const MAKS_TUNDA_MS = 3 * 60 * 60 * 1000;   // BATAS MAKSIMAL tanpa internet: 3 jam (samakan dengan server)
    const TIMEOUT_KIRIM_MS = 60000;       // batas 1 request (foto bisa besar)
    const BATAS_TUNGGU_UI_MS = 10000;     // lewat ini, UI dianggap "antri"
    const BACKOFF_AWAL_MS = 5000;
    const BACKOFF_MAKS_MS = 5 * 60 * 1000;
    const INTERVAL_CEK_MS = 30000;
    const JEDA_ONLINE_MAKS_MS = 8000;     // jitter saat internet balik
    const JEDA_ANTAR_KIRIM_MS = 600;      // jeda lembut antar item

    const sedangDikirim = new Set();      // id item yang request-nya sedang jalan
    const cadanganMemori = new Map();     // dipakai kalau IndexedDB tidak tersedia
    let dbPromise = null;
    let flushBerjalan = false;            // fallback kalau navigator.locks tidak ada
    let sudahToastSesi = false;

    /* ---------------- util ---------------- */
    function pemilikSekarang() {
        return String(window.USERNAME_SISWA_ASLI || '');
    }
    function buatId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    function formatWIB(d) {
        const p = n => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' WIB';
    }
    function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }
    function toast(pesan, tipe, durasi) {
        try { if (typeof tampilkanToast === 'function') tampilkanToast(pesan, tipe, durasi); } catch (e) { /* UI belum siap */ }
    }
    function judulTugas(taskId) {
        try {
            const t = (typeof getTasksSiswa === 'function' ? getTasksSiswa() : []).find(x => x.id === taskId);
            return (t && (t.judul || t.title)) || 'Tugas';
        } catch (e) { return 'Tugas'; }
    }
    function renderUlang() {
        try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) { }
        try { if (typeof updateGlobalCountdown === 'function') updateGlobalCountdown(); } catch (e) { }
    }

    /* ---------------- penyimpanan (IndexedDB + cadangan memori) ---------------- */
    function bukaDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB tidak tersedia'));
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }
    async function dbOp(mode, fn) {
        const db = await bukaDB();
        return new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            let hasil;
            const r = fn(t.objectStore(STORE));
            if (r) r.onsuccess = () => { hasil = r.result; };
            t.oncomplete = () => resolve(hasil);
            t.onerror = t.onabort = () => reject(t.error);
        });
    }
    async function simpanItem(item) {
        try { await dbOp('readwrite', s => s.put(item)); cadanganMemori.delete(item.id); }
        catch (e) {
            console.warn('IndexedDB gagal, antrian hanya di memori (hilang kalau tab ditutup):', e);
            cadanganMemori.set(item.id, item);
        }
    }
    async function hapusItem(id) {
        cadanganMemori.delete(id);
        try { await dbOp('readwrite', s => s.delete(id)); } catch (e) { /* abaikan */ }
    }
    async function semuaItemMilikku() {
        let dariDB = [];
        try { dariDB = (await dbOp('readonly', s => s.getAll())) || []; } catch (e) { /* pakai memori saja */ }
        const gabung = dariDB.concat(Array.from(cadanganMemori.values()));
        const me = pemilikSekarang();
        return gabung.filter(i => i.pemilik === me).sort((a, b) => a.dibuatPada - b.dibuatPada);
    }

    /* ---------------- indikator "N tugas menunggu internet" ---------------- */
    function perbaruiIndikator(jumlah) {
        let el = document.getElementById('indikator-antrian-tugas');
        if (window.StatusKoneksi) {
            // status_koneksi.js dimuat: tampilkan lewat "pulau" di tengah atas, pil oranye tidak dipakai.
            if (el) el.remove();
            window.StatusKoneksi.setAntrian('siswa', jumlah, 'tugas', () => flush(true).catch(console.warn));
            return;
        }
        if (!jumlah) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'indikator-antrian-tugas';
            el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:9999;' +
                'background:#f59e0b;color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:8px 14px;' +
                'border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;';
            el.title = 'Ketuk untuk mencoba kirim sekarang';
            el.addEventListener('click', () => flush(true).catch(console.warn));
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = jumlah + ' tugas menunggu internet \u2014 ketuk untuk coba kirim';
    }
    async function segarkanIndikator() {
        try { perbaruiIndikator((await semuaItemMilikku()).length); } catch (e) { }
    }

    /* ---------------- 1 request ke server ---------------- */
    function hitungBackoff(percobaan, retryAfterDetik) {
        if (retryAfterDetik > 0) return retryAfterDetik * 1000 * (0.85 + Math.random() * 0.3);
        const dasar = Math.min(BACKOFF_MAKS_MS, BACKOFF_AWAL_MS * Math.pow(2, Math.max(0, percobaan - 1)));
        return dasar * (0.5 + Math.random());
    }
    async function tundaItem(item, jenis, retryAfterDetik) {
        item.percobaan = (item.percobaan || 0) + 1;
        item.berikutnya = Date.now() + hitungBackoff(item.percobaan, retryAfterDetik);
        await simpanItem(item);
        return { hasil: jenis };
    }

    // Hasil: {hasil:'ok', waktu} | {hasil:'ditolak', pesan} | {hasil:'jaringan'|'tunda'|'sesi'}
    async function kirimSatu(item) {
        // Sudah lebih dari 3 jam di antrian: jangan dikirim lagi (server juga akan menolak).
        if (Date.now() - item.dibuatPada > MAKS_TUNDA_MS) {
            await hapusItem(item.id);
            return { hasil: 'ditolak', pesan: 'tertunda lebih dari 3 jam tanpa internet sehingga tidak bisa dikirim lagi. Hubungi gurumu.' };
        }
        sedangDikirim.add(item.id);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_KIRIM_MS);
        try {
            let res;
            try {
                res = await fetch(URL_SUBMIT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    signal: ctrl.signal,
                    body: JSON.stringify({
                        task_id: item.taskId,
                        images: item.images,
                        client_id: item.id,
                        client_waktu: item.dibuatPada
                    })
                });
            } catch (e) {
                return await tundaItem(item, 'jaringan');      // offline / timeout / DNS gagal
            }
            if (res.status === 429 || res.status >= 500) {
                const ra = parseInt(res.headers.get('Retry-After'), 10);
                return await tundaItem(item, 'tunda', isNaN(ra) ? 0 : ra);
            }
            if (res.status === 401) {
                // Sesi login habis (server balas JSON success:false + 401): JANGAN buang antrian.
                return await tundaItem(item, 'sesi');
            }
            let data = null;
            try { data = await res.json(); } catch (e) { /* bukan JSON */ }
            if (!data) {
                if (res.status === 413) {
                    await hapusItem(item.id);
                    return { hasil: 'ditolak', pesan: 'ukuran foto terlalu besar untuk server.' };
                }
                // Biasanya sesi login habis (redirect ke halaman login) -> simpan, coba lagi nanti.
                return await tundaItem(item, 'sesi');
            }
            await hapusItem(item.id);
            if (data.success) return { hasil: 'ok', waktu: data.waktu };
            return { hasil: 'ditolak', pesan: data.message || 'terjadi kesalahan di server.' };
        } finally {
            clearTimeout(timer);
            sedangDikirim.delete(item.id);
        }
    }

    /* ---------------- efek ke UI untuk hasil yang datang belakangan ---------------- */
    function sesudahTerkirim(item, waktuServer) {
        window._statusTugasSendiri = window._statusTugasSendiri || {};
        const lama = window._statusTugasSendiri[item.taskId] || {};
        window._statusTugasSendiri[item.taskId] = Object.assign({}, lama, {
            submitted: true, waktu: waktuServer || item.waktuTampil, images: item.images, menunggu: false
        });
        toast('"' + judulTugas(item.taskId) + '" yang tertunda berhasil terkirim ke server.', 'sukses', 5000);
        renderUlang();
    }
    function cabutRiwayat(taskId) {
        try {
            const k = 'riwayat_pengumpulan_' + ID_SISWA_AKTIF;
            const arr = JSON.parse(localStorage.getItem(k) || '[]');
            const baru = arr.filter(r => r.taskId !== taskId);
            if (baru.length !== arr.length) {
                localStorage.setItem(k, JSON.stringify(baru));
                if (typeof renderRiwayatPengumpulan === 'function') renderRiwayatPengumpulan();
            }
        } catch (e) { /* abaikan */ }
    }
    function sesudahDitolak(item, pesan) {
        if (window._statusTugasSendiri) delete window._statusTugasSendiri[item.taskId];
        window._fotoTugasSementara = window._fotoTugasSementara || {};
        window._fotoTugasSementara[item.taskId] = item.images;   // foto tidak hilang, bisa dicoba lagi
        cabutRiwayat(item.taskId);
        toast('"' + judulTugas(item.taskId) + '" ditolak: ' + pesan + ' Fotomu masih tersimpan.', 'error', 8000);
        renderUlang();
    }
    function tanganiHasilLatar(item, h) {
        if (h.hasil === 'ok') sesudahTerkirim(item, h.waktu);
        else if (h.hasil === 'ditolak') sesudahDitolak(item, h.pesan);
        else if (h.hasil === 'sesi' && !sudahToastSesi) {
            sudahToastSesi = true;
            toast('Ada tugas tertunda, tapi sesi login habis. Login ulang dan tugas akan terkirim otomatis.', 'warning', 8000);
        }
        segarkanIndikator();
    }

    /* ---------------- pengirim antrian (FIFO, 1 per 1) ---------------- */
    async function jalankanFlush(paksa) {
        const daftar = await semuaItemMilikku();
        perbaruiIndikator(daftar.length);
        for (const item of daftar) {
            if (sedangDikirim.has(item.id)) continue;
            if (!paksa && item.berikutnya > Date.now()) break;   // jaga urutan FIFO
            const h = await kirimSatu(item);
            tanganiHasilLatar(item, h);
            if (h.hasil !== 'ok' && h.hasil !== 'ditolak') break; // jaringan/server bermasalah: berhenti dulu
            await tunggu(JEDA_ANTAR_KIRIM_MS * (0.5 + Math.random()));
        }
        await segarkanIndikator();
    }
    async function flush(paksa) {
        if (navigator.locks && navigator.locks.request) {
            // Banyak tab terbuka -> cuma satu yang boleh mengirim.
            return navigator.locks.request('antrian-tugas-flush', { ifAvailable: true }, async (lock) => {
                if (lock) await jalankanFlush(!!paksa);
            });
        }
        if (flushBerjalan) return;
        flushBerjalan = true;
        try { await jalankanFlush(!!paksa); } finally { flushBerjalan = false; }
    }

    /* ---------------- API utama dipakai simpanDataTugasFinal() ---------------- */
    // Balikan: {status:'terkirim', waktu} | {status:'antri', waktu} | {status:'ditolak', pesan}
    async function kirim(taskId, images, nowObj) {
        const item = {
            id: buatId(),
            pemilik: pemilikSekarang(),
            taskId: taskId,
            images: images,
            dibuatPada: Date.now(),
            waktuTampil: formatWIB(nowObj || new Date()),
            percobaan: 0,
            berikutnya: 0
        };

        // Kirim ulang tugas yang sama -> yang lama di antrian diganti yang terbaru.
        const lama = (await semuaItemMilikku()).filter(i => i.taskId === taskId && !sedangDikirim.has(i.id));
        for (const l of lama) await hapusItem(l.id);

        await simpanItem(item);
        segarkanIndikator();

        const percobaan = kirimSatu(item);
        const batas = new Promise(r => setTimeout(() => r({ hasil: 'lambat' }), BATAS_TUNGGU_UI_MS));
        const h = await Promise.race([percobaan, batas]);

        if (h.hasil === 'lambat') {
            // Koneksi jelek: biar UI tidak menggantung, request tetap lanjut di latar.
            percobaan.then(h2 => tanganiHasilLatar(item, h2)).catch(console.warn);
            return { status: 'antri', waktu: item.waktuTampil };
        }
        if (h.hasil === 'ok') { segarkanIndikator(); return { status: 'terkirim', waktu: h.waktu }; }
        if (h.hasil === 'ditolak') { segarkanIndikator(); return { status: 'ditolak', pesan: h.pesan }; }
        segarkanIndikator();
        return { status: 'antri', waktu: item.waktuTampil };
    }

    // Setelah refresh/buka ulang: tampilkan lagi tugas yang masih antri sebagai "terkirim (menunggu)".
    async function pulihkanStatusUI() {
        const items = await semuaItemMilikku();
        perbaruiIndikator(items.length);
        if (!items.length) return;
        window._statusTugasSendiri = window._statusTugasSendiri || {};
        items.forEach(i => {
            window._statusTugasSendiri[i.taskId] = { submitted: true, waktu: i.waktuTampil, images: i.images, menunggu: true };
        });
        renderUlang();
    }

    /* ---------------- pemicu pengiriman ulang ---------------- */
    window.addEventListener('online', () => {
        setTimeout(() => flush(true).catch(console.warn), Math.random() * JEDA_ONLINE_MAKS_MS);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(() => flush(false).catch(console.warn), Math.random() * 2000);
    });
    window.addEventListener('load', async () => {
        try { await pulihkanStatusUI(); } catch (e) { console.warn(e); }
        setTimeout(() => flush(false).catch(console.warn), 1000 + Math.random() * 4000);
    });
    (function tick() {
        setTimeout(() => {
            if (navigator.onLine !== false) flush(false).catch(console.warn);
            tick();
        }, INTERVAL_CEK_MS * (0.85 + Math.random() * 0.3));
    })();

    window.AntrianTugas = { kirim, flush, cabutRiwayat, jumlahAntri: async () => (await semuaItemMilikku()).length };
})();
