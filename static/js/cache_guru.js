/* =====================================================================
   cache_guru.js -- Cache sisi-browser untuk Dashboard Guru
   ---------------------------------------------------------------------
   Muat SEBELUM dashboard_guru.js:
       <script src="../static/js/cache_guru.js"></script>

   Dua lapis:
     1. Memori (Map)   -> instan, hilang saat halaman di-refresh.
     2. localStorage   -> bertahan antar refresh / buka-tutup tab.
   Setiap entri punya waktu kedaluwarsa (TTL). Selama belum kedaluwarsa,
   ambil() mengembalikan data cache TANPA menembak server.

   Sifat penting:
     - Cache dipisah per guru (diambil dari body[data-nama-guru-login]),
       jadi guru lain yang login di browser yang sama tidak membaca cache ini.
     - Request untuk kunci yang sama yang sedang berjalan dipakai bersama
       (tidak menembak dobel).
     - Kalau server gagal (offline / 429 / error) dan masih ada cache lama,
       data lama itu dipakai -- gagal ambil TIDAK PERNAH dianggap "data kosong".
     - Kalau localStorage penuh, otomatis turun ke memori saja (tidak error).
   ===================================================================== */
(function (global) {
    'use strict';

    const VERSI = 'v1'; // naikkan kalau bentuk data cache berubah -> cache lama otomatis dibuang
    const guru = ((document.body && document.body.dataset && document.body.dataset.namaGuruLogin) || 'anon')
        .trim().toLowerCase().replace(/\s+/g, '_');
    const NS = 'cg:' + VERSI + ':' + guru + ':';

    // Sesuaikan dengan seberapa sering datanya berubah.
    const TTL = Object.freeze({
        ROSTER: 30 * 60 * 1000,  // foto/border/title siswa: jarang berubah
        TUGAS: 5 * 60 * 1000,    // tugas per kelas: guru lain bisa menambah dari perangkat lain
        DEFAULT: 15 * 60 * 1000,
    });

    const memori = new Map();   // key -> { v, t, exp, p }
    const berjalan = new Map(); // key -> Promise (request yang sedang berjalan)

    /* ---------- Level rendah ---------- */

    function baca(key) {
        let e = memori.get(key);
        if (e) return e;
        try {
            const raw = localStorage.getItem(NS + key);
            if (!raw) return null;
            e = JSON.parse(raw);
            if (!e || typeof e.exp !== 'number' || typeof e.t !== 'number') return null;
            memori.set(key, e);
            return e;
        } catch (_) {
            return null;
        }
    }

    function tulisLocal(key, entri) {
        const raw = JSON.stringify(entri);
        try {
            localStorage.setItem(NS + key, raw);
        } catch (_) {
            // Kuota penuh: buang yang kedaluwarsa, coba sekali lagi.
            // Kalau tetap gagal, biarkan di memori saja.
            bersihkanKadaluarsa();
            try { localStorage.setItem(NS + key, raw); } catch (__) { /* memori saja */ }
        }
    }

    function simpan(key, value, ttl, persist) {
        const t = Date.now();
        const entri = { v: value, t: t, exp: t + ttl, p: persist !== false };
        memori.set(key, entri);
        if (entri.p) {
            tulisLocal(key, entri);
        } else {
            try { localStorage.removeItem(NS + key); } catch (_) { /* abaikan */ }
        }
    }

    // Ambil entri; entri kedaluwarsa dianggap tidak ada kecuali izinkanBasi = true.
    function ambilEntri(key, izinkanBasi) {
        const e = baca(key);
        if (!e) return null;
        if (!izinkanBasi && e.exp <= Date.now()) return null;
        return e;
    }

    /* ---------- API utama ---------- */

    /**
     * Cek cache dulu; kalau belum ada / sudah kedaluwarsa, panggil fetcher().
     * opsi: { ttl, force, persist, validasi }
     *   ttl      : umur cache dalam ms (default TTL.DEFAULT)
     *   force    : true -> lewati cache, ambil langsung dari server
     *   persist  : false -> simpan di memori saja (untuk data besar, mis. base64)
     *   validasi : fungsi(data) -> boolean; kalau false, data ditolak & tidak di-cache
     * fetcher harus melempar error kalau gagal (lihat fetchJSON di bawah).
     */
    function ambil(key, fetcher, opsi) {
        const o = opsi || {};
        const ttl = o.ttl || TTL.DEFAULT;

        if (!o.force) {
            const e = ambilEntri(key, false);
            if (e) return Promise.resolve(e.v);
        }
        if (berjalan.has(key)) return berjalan.get(key);

        const p = (async () => {
            try {
                const data = await fetcher();
                if (o.validasi && !o.validasi(data)) throw new Error('Respons tidak valid: ' + key);
                simpan(key, data, ttl, o.persist);
                return data;
            } catch (err) {
                const basi = ambilEntri(key, true);
                if (basi) {
                    console.warn('[CacheGuru] Gagal ambil "' + key + '" dari server, pakai cache lama:', err);
                    return basi.v;
                }
                throw err;
            }
        })();
        berjalan.set(key, p);
        // Dibersihkan SETELAH set() di atas (aman walau fetcher melempar error sinkron).
        p.then(() => berjalan.delete(key), () => berjalan.delete(key));
        return p;
    }

    /**
     * Write-through: ubah isi cache yang sudah ada tanpa menyentuh waktu
     * kedaluwarsanya. Panggil setelah guru menyimpan/mengubah data, supaya
     * refresh halaman berikutnya tidak membaca versi lama.
     * Kalau kuncinya belum ada di cache, tidak melakukan apa-apa.
     */
    function perbarui(key, fungsiUbah) {
        const e = baca(key);
        if (!e) return false;
        const baru = { v: fungsiUbah(e.v), t: e.t, exp: e.exp, p: e.p };
        memori.set(key, baru);
        if (baru.p) tulisLocal(key, baru);
        return true;
    }

    function segar(key) { return !!ambilEntri(key, false); }

    // Umur data cache dalam ms (null kalau belum ada) -- untuk label "diperbarui X menit lalu".
    function umurMs(key) {
        const e = baca(key);
        return e ? Date.now() - e.t : null;
    }

    function hapus(key) {
        memori.delete(key);
        try { localStorage.removeItem(NS + key); } catch (_) { /* abaikan */ }
    }

    function hapusPrefix(prefix) {
        prefix = prefix || '';
        Array.from(memori.keys()).forEach(k => { if (k.indexOf(prefix) === 0) memori.delete(k); });
        try {
            const target = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf(NS + prefix) === 0) target.push(k);
            }
            target.forEach(k => localStorage.removeItem(k));
        } catch (_) { /* abaikan */ }
    }

    // Buang entri yang kedaluwarsa, rusak, atau dari versi lama (semua guru).
    function bersihkanKadaluarsa() {
        try {
            const awalVersi = 'cg:' + VERSI + ':';
            const target = [];
            const sekarang = Date.now();
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || k.indexOf('cg:') !== 0) continue;
                if (k.indexOf(awalVersi) !== 0) { target.push(k); continue; }
                try {
                    const e = JSON.parse(localStorage.getItem(k));
                    if (!e || typeof e.exp !== 'number' || e.exp <= sekarang) target.push(k);
                } catch (_) { target.push(k); }
            }
            target.forEach(k => localStorage.removeItem(k));
        } catch (_) { /* abaikan */ }
    }

    /**
     * fetch + parse JSON yang MELEMPAR error kalau HTTP bukan 2xx (mis. 429)
     * atau server membalas {ok:false} / {success:false}. Ini yang membuat
     * ambil() tahu bahwa "gagal" berbeda dengan "datanya memang kosong".
     */
    async function fetchJSON(url, init) {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' untuk ' + url);
        const json = await res.json();
        if (json && (json.ok === false || json.success === false)) {
            throw new Error((json.error || json.message || 'Server menolak') + ' (' + url + ')');
        }
        return json;
    }

    bersihkanKadaluarsa(); // sekali saat script dimuat

    global.CacheGuru = {
        TTL: TTL,
        ambil: ambil,
        perbarui: perbarui,
        segar: segar,
        umurMs: umurMs,
        hapus: hapus,
        hapusPrefix: hapusPrefix,
        bersihkanSemua: function () { hapusPrefix(''); },
        bersihkanKadaluarsa: bersihkanKadaluarsa,
        fetchJSON: fetchJSON,
    };
})(typeof window !== 'undefined' ? window : globalThis);
