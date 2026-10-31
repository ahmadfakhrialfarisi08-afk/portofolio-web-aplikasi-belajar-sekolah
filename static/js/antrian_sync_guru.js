/* ============================================================
   ANTRIAN SINKRON TUGAS GURU OFFLINE  ->  window.AntrianSyncGuru
   ------------------------------------------------------------
   Masalah lama: setSync() di Dashboard Guru menulis ke localStorage
   lalu fetch() "fire and forget". Kalau internet guru putus, fetch
   gagal cuma console.warn -> di HP guru tugas tampak tersimpan, tapi
   server TIDAK pernah menerimanya (hilang saat halaman dimuat ulang,
   siswa tidak pernah melihatnya).

   Solusi: yang diantrikan adalah OPERASI per tugas, bukan seluruh
   array tasks_<KELAS>:
     - upsert : tambah / edit 1 tugas (by id; id dibuat di sisi klien)
     - hapus  : tarik 1 tugas (by id)
     - notif  : tambah 1 notifikasi (tugas ditarik / tambahan waktu)
   Saat dikirim, modul BACA versi terbaru dari server, TERAPKAN operasi
   ke versi itu, baru POST ke /api/sync/<kunci>. Jadi array lama yang
   tertinggal tidak menimpa/menghapus tugas guru yang sama dari
   perangkat lain. Semua operasi idempoten (id tugas/notif tetap sama),
   jadi aman dikirim ulang.

   Server TIDAK perlu diubah: /api/sync/<kunci> sudah menggabungkan
   tugas guru lain dengan aman (_gabung_tasks_guru).
   ============================================================ */
(function () {
    'use strict';

    const DB_NAME = 'antrian_sync_guru_v1';
    const STORE = 'op';
    const MAKS_TUNDA_MS = 3 * 60 * 60 * 1000;   // BATAS MAKSIMAL tanpa internet: 3 jam, lewat itu perubahan dibatalkan
    const TIMEOUT_MS = 30000;
    const BACKOFF_AWAL_MS = 5000;
    const BACKOFF_MAKS_MS = 5 * 60 * 1000;
    const INTERVAL_CEK_MS = 30000;
    const JEDA_ONLINE_MAKS_MS = 5000;
    const MAKS_NOTIF = 30;                 // sama dengan batas di dashboard_guru.js

    const memori = new Map();              // cadangan kalau IndexedDB tidak ada
    let dbPromise = null;
    let flushBerjalan = false;
    let urutan = 0;

    /* ---------------- util ---------------- */
    function pemilikSekarang() {
        try { return String((document.body && document.body.dataset.namaGuruLogin) || '').trim().toLowerCase(); }
        catch (e) { return ''; }
    }
    function kunciKelas(namaKelas) { return String(namaKelas).replace(/\s+/g, '_'); }
    function buatId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }
    function toast(judul, pesan) {
        try {
            if (typeof tampilkanToastSuksesKirimTugas === 'function') tampilkanToastSuksesKirimTugas(judul, pesan);
            else console.log('[AntrianSyncGuru]', judul, pesan);
        } catch (e) { /* UI belum siap */ }
    }
    function renderUlang() {
        const fn = ['renderBerandaKelasBerurutan', 'renderSeluruhKelas', 'renderRekapSemuaTugas', 'renderAktivitasTugasTerbaruBeranda'];
        fn.forEach(n => { try { if (typeof window[n] === 'function') window[n](); } catch (e) { } });
    }

    /* ---------------- penyimpanan ---------------- */
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
    async function simpanOp(op) {
        try { await dbOp('readwrite', s => s.put(op)); memori.delete(op.id); }
        catch (e) { console.warn('IndexedDB gagal, antrian guru hanya di memori:', e); memori.set(op.id, op); }
    }
    async function hapusOp(id) {
        memori.delete(id);
        try { await dbOp('readwrite', s => s.delete(id)); } catch (e) { }
    }
    async function semuaOpMilikku() {
        let dariDB = [];
        try { dariDB = (await dbOp('readonly', s => s.getAll())) || []; } catch (e) { }
        const me = pemilikSekarang();
        return dariDB.concat(Array.from(memori.values()))
            .filter(o => o.pemilik === me)
            .sort((a, b) => a.urut - b.urut);
    }

    function kedaluwarsa(op) { return Date.now() - op.dibuatPada > MAKS_TUNDA_MS; }

    /* ---------------- indikator ---------------- */
    function perbaruiIndikator(n) {
        let el = document.getElementById('indikator-antrian-guru');
        if (window.StatusKoneksi) {
            // status_koneksi.js dimuat: tampilkan lewat "pulau" di tengah atas, pil oranye tidak dipakai.
            if (el) el.remove();
            window.StatusKoneksi.setAntrian('guru', n, 'perubahan', () => flush(true).catch(console.warn));
            return;
        }
        if (!n) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'indikator-antrian-guru';
            el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:9999;' +
                'background:#f59e0b;color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:8px 14px;' +
                'border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer;';
            el.title = 'Ketuk untuk mencoba kirim sekarang';
            el.addEventListener('click', () => flush(true).catch(console.warn));
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = n + ' perubahan tugas menunggu internet \u2014 ketuk untuk coba kirim';
    }
    async function segarkanIndikator() {
        try { perbaruiIndikator((await semuaOpMilikku()).length); } catch (e) { }
    }

    /* ---------------- menerapkan operasi ke data server ---------------- */
    function targetKunci(op) {
        return (op.jenis === 'notif' ? 'notif_tugas_' : 'tasks_') + kunciKelas(op.kelas);
    }
    function terapkan(op, daftar) {
        let arr = Array.isArray(daftar) ? daftar.slice() : [];
        if (op.jenis === 'upsert') {
            const t = op.payload;
            const i = arr.findIndex(x => x && x.id === t.id);
            if (i >= 0) arr[i] = Object.assign({}, arr[i], t);   // edit: field server yang tak disentuh tetap
            else arr.push(t);
        } else if (op.jenis === 'hapus') {
            arr = arr.filter(x => !(x && x.id === op.payload.taskId));
        } else if (op.jenis === 'notif') {
            if (!arr.some(n => n && n.id === op.payload.id)) arr.unshift(op.payload);
            arr = arr.slice(0, MAKS_NOTIF);
        }
        return arr;
    }

    /* ---------------- kirim 1 kelompok operasi (1 kunci = 1 GET + 1 POST) ---------------- */
    function hitungBackoff(percobaan, retryAfter) {
        if (retryAfter > 0) return retryAfter * 1000 * (0.85 + Math.random() * 0.3);
        const dasar = Math.min(BACKOFF_MAKS_MS, BACKOFF_AWAL_MS * Math.pow(2, Math.max(0, percobaan - 1)));
        return dasar * (0.5 + Math.random());
    }
    async function tundaKelompok(ops, jenis, retryAfter) {
        for (const op of ops) {
            op.percobaan = (op.percobaan || 0) + 1;
            op.berikutnya = Date.now() + hitungBackoff(op.percobaan, retryAfter);
            await simpanOp(op);
        }
        return { hasil: jenis };
    }
    async function fetchBatas(url, opts) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try { return await fetch(url, Object.assign({ credentials: 'same-origin', signal: ctrl.signal }, opts || {})); }
        finally { clearTimeout(timer); }
    }
    // Hasil: {hasil:'ok'} | {hasil:'ditolak', pesan} | {hasil:'jaringan'|'tunda'|'sesi'}
    async function kirimKelompok(kunci, ops) {
        let res;
        try { res = await fetchBatas('/api/sync/' + encodeURIComponent(kunci)); }
        catch (e) { return tundaKelompok(ops, 'jaringan'); }
        if (res.status === 401) return tundaKelompok(ops, 'sesi');
        if (res.status === 429 || res.status >= 500) {
            const ra = parseInt(res.headers.get('Retry-After'), 10);
            return tundaKelompok(ops, 'tunda', isNaN(ra) ? 0 : ra);
        }
        let json = null;
        try { json = await res.json(); } catch (e) { }
        if (!json) return tundaKelompok(ops, 'sesi');
        if (!json.ok) return { hasil: 'ditolak', pesan: json.error || 'server menolak.' };

        let data = json.data;
        for (const op of ops) data = terapkan(op, data);

        try {
            res = await fetchBatas('/api/sync/' + encodeURIComponent(kunci), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            });
        } catch (e) { return tundaKelompok(ops, 'jaringan'); }
        if (res.status === 401) return tundaKelompok(ops, 'sesi');
        if (res.status === 429 || res.status >= 500) {
            const ra = parseInt(res.headers.get('Retry-After'), 10);
            return tundaKelompok(ops, 'tunda', isNaN(ra) ? 0 : ra);
        }
        json = null;
        try { json = await res.json(); } catch (e) { }
        if (json && json.ok) return { hasil: 'ok' };
        if (!json) return tundaKelompok(ops, 'sesi');
        return { hasil: 'ditolak', pesan: json.error || 'server menolak.' };
    }

    /* ---------------- pengirim antrian ---------------- */
    async function jalankanFlush(paksa) {
        let semua = await semuaOpMilikku();
        const basi = semua.filter(kedaluwarsa);
        if (basi.length) {
            for (const op of basi) await hapusOp(op.id);
            semua = semua.filter(o => !kedaluwarsa(o));
            try { alert(basi.length + ' perubahan tugas dibatalkan karena tertunda lebih dari 3 jam tanpa internet. Silakan buat/ubah ulang tugasnya.'); } catch (e) { }
            try { if (typeof muatCacheTugasSemuaKelas === 'function') await muatCacheTugasSemuaKelas(); } catch (e) { }
            renderUlang();
        }
        perbaruiIndikator(semua.length);
        // Kelompokkan per kunci, urutan kelompok mengikuti op tertua.
        const kelompok = new Map();
        for (const op of semua) {
            const k = targetKunci(op);
            if (!kelompok.has(k)) kelompok.set(k, []);
            kelompok.get(k).push(op);
        }
        let adaDitolak = false, adaTerkirim = 0;
        for (const [kunci, ops] of kelompok) {
            if (!paksa && ops.some(o => o.berikutnya > Date.now())) break;
            const h = await kirimKelompok(kunci, ops);
            if (h.hasil === 'ok') {
                for (const op of ops) await hapusOp(op.id);
                adaTerkirim += ops.length;
            } else if (h.hasil === 'ditolak') {
                for (const op of ops) await hapusOp(op.id);
                adaDitolak = true;
                try { alert('Perubahan tugas untuk ' + ops[0].kelas + ' ditolak server: ' + h.pesan); } catch (e) { }
            } else {
                break;     // jaringan/server bermasalah: sisanya hampir pasti gagal juga
            }
            await tunggu(300 * (0.5 + Math.random()));
        }
        if (adaTerkirim) toast('Terkirim ke Server', adaTerkirim + ' perubahan tugas yang tertunda berhasil dikirim.');
        if (adaDitolak) {
            // Kembalikan tampilan guru ke kebenaran di server.
            try { if (typeof muatCacheTugasSemuaKelas === 'function') await muatCacheTugasSemuaKelas(); } catch (e) { }
            renderUlang();
        }
        await segarkanIndikator();
    }
    async function flush(paksa) {
        if (navigator.locks && navigator.locks.request) {
            return navigator.locks.request('antrian-sync-guru-flush', { ifAvailable: true }, async (lock) => {
                if (lock) await jalankanFlush(!!paksa);
            });
        }
        if (flushBerjalan) return;
        flushBerjalan = true;
        try { await jalankanFlush(!!paksa); } finally { flushBerjalan = false; }
    }

    /* ---------------- API untuk dashboard_guru.js ---------------- */
    // op: {jenis:'upsert', task} | {jenis:'hapus', taskId}
    async function antri(namaKelas, op) {
        const rekam = {
            id: buatId(),
            urut: Date.now() * 1000 + (urutan++ % 1000),
            pemilik: pemilikSekarang(),
            jenis: op.jenis,
            kelas: namaKelas,
            payload: op.jenis === 'upsert' ? op.task : { taskId: op.taskId },
            dibuatPada: Date.now(), percobaan: 0, berikutnya: 0
        };
        await simpanOp(rekam);
        return coba(rekam);
    }
    async function antriNotif(namaKelas, notif) {
        const rekam = {
            id: buatId(),
            urut: Date.now() * 1000 + (urutan++ % 1000),
            pemilik: pemilikSekarang(),
            jenis: 'notif', kelas: namaKelas, payload: notif,
            dibuatPada: Date.now(), percobaan: 0, berikutnya: 0
        };
        await simpanOp(rekam);
        return coba(rekam);
    }
    // Percobaan pertama langsung, supaya guru yang online tidak menunggu timer.
    async function coba(rekam) {
        await segarkanIndikator();
        flush(true).then(async () => {
            const sisa = (await semuaOpMilikku()).filter(o => o.id === rekam.id);
            if (sisa.length && sisa[0].percobaan > 0 && rekam.jenis !== 'notif') {
                toast('Tersimpan di Perangkat', 'Internet belum tersambung. Perubahan tugas akan dikirim ke server otomatis begitu tersambung (maksimal 3 jam, lewat dari itu dibatalkan). Jangan hapus data browser ya.');
            }
        }).catch(console.warn);
    }

    // Dipanggil setelah cache tugas dimuat dari server: tampilkan lagi perubahan yang masih antri.
    async function terapkanKeCache(cache) {
        const ops = (await semuaOpMilikku()).filter(o => o.jenis !== 'notif' && !kedaluwarsa(o));
        for (const op of ops) {
            if (!cache || !Array.isArray(cache[op.kelas])) continue;
            cache[op.kelas] = terapkan(op, cache[op.kelas]);
        }
        return cache;
    }

    /* ---------------- pemicu ---------------- */
    window.addEventListener('online', () => setTimeout(() => flush(true).catch(console.warn), Math.random() * JEDA_ONLINE_MAKS_MS));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(() => flush(false).catch(console.warn), Math.random() * 2000);
    });
    window.addEventListener('load', () => {
        segarkanIndikator();
        setTimeout(() => flush(false).catch(console.warn), 1500 + Math.random() * 3000);
    });
    (function tick() {
        setTimeout(() => {
            if (navigator.onLine !== false) flush(false).catch(console.warn);
            tick();
        }, INTERVAL_CEK_MS * (0.85 + Math.random() * 0.3));
    })();

    window.AntrianSyncGuru = { antri, antriNotif, terapkanKeCache, flush, jumlahAntri: async () => (await semuaOpMilikku()).length };
})();
