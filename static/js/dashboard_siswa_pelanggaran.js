/* ============================================================
   FITUR "PELANGGARAN + PENEBUS" -- DASHBOARD SISWA
   ------------------------------------------------------------
   File ini BERDIRI SENDIRI (IIFE terpisah, gaya sama persis dgn
   dashboard_guru_pelanggaran.js) -- TIDAK mengubah/menghapus fungsi,
   variabel, atau logika apa pun yang sudah ada di dashboard_siswa.js
   atau dashboard_siswa_2.js.

   PENTING -- INI PENGGANTI FILE LAMA YANG SALAH COPY:
   File static/js/dashboard_siswa_pelanggaran.js yang lama isinya
   COPY-AN FILE GURU (header komentarnya sendiri masih tertulis
   "DASHBOARD GURU", dan manggil endpoint khusus guru: /semua,
   /daftar, /tugaskan, /acc, /tolak, /batalkan-manual, /siswa-semua,
   /tambah, /preset-jenis). Itu sebabnya siswa yang login dapat 401
   di endpoint2 tsb -- endpoint itu memang di-block utk role != guru.
   File INI hanya manggil endpoint SISWA:
     GET  /api/pelanggaran/status
     POST /api/pelanggaran/kirim-bukti
     POST /api/pelanggaran/banding

   CATATAN MARKUP (PENTING, BACA DULU SEBELUM PASANG):
   1) OVERLAY: HTML kamu SUDAH punya markup overlay bawaan
      #overlay-pelanggaran-aktif (lihat dashboard_siswa.html, dekat
      #efek-transisi-tema) lengkap dengan id #overlay-pelanggaran-judul,
      #overlay-pelanggaran-pesan, #overlay-pelanggaran-keterangan,
      #overlay-pelanggaran-oleh, #tombol-overlay-pelanggaran-mengerti
      (+ #overlay-pelanggaran-hitung-mundur), dan tombol WA lama
      #tombol-overlay-pelanggaran-banding. Markup itu didesain utk
      kasus SEDERHANA (cuma status 'aktif' + banding via WhatsApp).
      Sekarang statusnya lebih banyak (menunggu_tugas butuh form
      upload bukti, menunggu_bk cuma info, banding sekarang lewat
      form ke server bukan WA) -- jadi file ini TETAP PAKAI shell
      overlay bawaan itu (judul/pesan/keterangan/oleh/tombol mengerti,
      supaya style dashboard_siswa_overlay.css yg sudah ada tetap
      kepakai), TAPI menyuntik div tambahan (id #pel-overlay-extra) di
      dalam kartu buat form upload bukti / form banding baru, dan
      SENGAJA MENYEMBUNYIKAN tombol WA lama (#tombol-overlay-pelanggaran-
      banding) karena sudah digantikan form banding baru yang lebih
      benar (POST ke server, bukan buka WhatsApp). Kalau tombol WA lama
      itu memang masih mau dipakai untuk kasus lain, tinggal hapus baris
      yang nge-hidden dia di bawah.
   2) ARSIP: script ini otomatis membuat <div id="pel-arsip-siswa-wrap">
      dan menyisipkannya ke akhir <section id="tab-profil"> (kalau
      section itu ada). Kalau kamu mau taruh di tempat lain, ganti
      SELEKTOR_ARSIP_PARENT di bawah.
   3) DATA AWAL: script ini baca <script id="data-pelanggaran-awal"
      type="application/json"> yang sudah disematkan server (isi:
      pelanggaran_awal dari app.py) SEBELUM fetch pertama, supaya
      penguncian (window.pelanggaranSiswaSedangAktif) efektif sejak
      halaman dimuat -- baru setelah itu polling normal jalan.
   ============================================================ */
(function () {
    var JEDA_POLL_MS = 15000;
    var DETIK_COUNTDOWN_TOMBOL = 3;
    var SELEKTOR_ARSIP_PARENT = '#tab-profil';

    // [FIX] Sempat ditulis sebagai boolean langsung -- ternyata
    // dashboard_siswa.js manggilnya sebagai FUNGSI:
    //   (typeof window.pelanggaranSiswaSedangAktif === 'function') &&
    //   window.pelanggaranSiswaSedangAktif()
    // (lihat baris ~5231 & ~5471 di dashboard_siswa.js). Kalau ditulis
    // sebagai boolean, typeof-nya 'boolean' bukan 'function' -> cek itu
    // SELALU false -> penguncian tugas gak pernah aktif walau siswa lagi
    // ada pelanggaran mengunci. Jadi HARUS fungsi yang balikin boolean,
    // bukan boolean itu sendiri.
    var _mengunciTerkini = false;
    window.pelanggaranSiswaSedangAktif = function () { return _mengunciTerkini; };

    var _antrian = [];           // daftar_aktif (selain menunggu_acc) yg BELUM ditampilkan/diproses
    var _itemSedangTampil = null;
    var _sudahDitampilkanSekaliSet = {}; // id -> true, khusus status info (aktif/menunggu_bk) biar gak muncul ulang tiap poll
    var _overlayLagiDibuka = false;
    var _arsipTerkini = [];

    var _elOverlay, _elKartu, _elJudul, _elPesan, _elKeterangan, _elOleh;
    var _elBtnMengerti, _elCountdownMengerti, _elBtnBandingLama;
    var _elExtra;

    /* ---------- UTIL ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function fetchJSON(url, opsi) {
        return fetch(url, opsi).then(function (r) { return r.json(); });
    }

    function postJSON(url, body) {
        return fetchJSON(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
    }

    function bacaFileSebagaiDataURL(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function pesanSingkat(pesan) {
        if (typeof window.tampilkanToast === 'function') {
            window.tampilkanToast(pesan);
            return;
        }
        var el = document.createElement('div');
        el.textContent = pesan;
        el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
            'max-width:90vw;width:340px;background:rgba(17,24,39,.94);color:#fff;font-size:13px;' +
            'line-height:1.4;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);' +
            'z-index:100000;opacity:0;transition:opacity .25s ease;';
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.style.opacity = '1'; });
        setTimeout(function () {
            el.style.opacity = '0';
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        }, 3500);
    }

    var LABEL_STATUS = {
        aktif: 'Pelanggaran Aktif',
        menunggu_tugas: 'Tugas Penebus',
        menunggu_acc: 'Menunggu ACC Guru',
        menunggu_bk: 'Ditinjau BK',
        selesai: 'Selesai',
        dibatalkan: 'Dibatalkan'
    };
    var WARNA_STATUS = {
        aktif: 'merah',
        menunggu_tugas: 'kuning',
        menunggu_acc: 'biru',
        menunggu_bk: 'ungu',
        selesai: 'hijau',
        dibatalkan: 'abu'
    };
    var KONFIG_OVERLAY = {
        aktif: {
            judul: 'Pelanggaran Aktif',
            pesan: 'Kamu tercatat melakukan pelanggaran. Baca keterangannya, lalu tekan tombol di bawah kalau sudah paham.'
        },
        menunggu_bk: {
            judul: 'Sedang Ditinjau BK',
            pesan: 'Pelanggaran ini sedang ditinjau oleh Guru BK. Kamu akan diberi tahu lewat halaman ini setelah ada keputusan.'
        },
        menunggu_tugas: {
            judul: 'Tugas Penebus Pelanggaran',
            pesan: 'Selesaikan tugas penebus di bawah sebelum batas waktu supaya penguncian dibuka.'
        }
    };

    /* ============================================================
       BAGIAN A -- CACHE DOM & OVERLAY SHELL
       ============================================================ */
    function cacheDom() {
        _elOverlay = document.getElementById('overlay-pelanggaran-aktif');
        if (!_elOverlay) return false;
        _elKartu = _elOverlay.querySelector('.p-6.text-center') || _elOverlay;
        _elJudul = document.getElementById('overlay-pelanggaran-judul');
        _elPesan = document.getElementById('overlay-pelanggaran-pesan');
        _elKeterangan = document.getElementById('overlay-pelanggaran-keterangan');
        _elOleh = document.getElementById('overlay-pelanggaran-oleh');
        _elBtnMengerti = document.getElementById('tombol-overlay-pelanggaran-mengerti');
        _elCountdownMengerti = document.getElementById('overlay-pelanggaran-hitung-mundur');
        _elBtnBandingLama = document.getElementById('tombol-overlay-pelanggaran-banding');

        // Tombol WA lama disembunyikan permanen -- digantikan form banding baru
        // (lihat catatan header). Kalau mau dipakai lagi, hapus baris ini.
        if (_elBtnBandingLama) _elBtnBandingLama.classList.add('hidden');

        if (!_elExtra) {
            _elExtra = document.createElement('div');
            _elExtra.id = 'pel-overlay-extra';
            _elExtra.className = 'mt-3 text-left hidden';
            _elExtra.style.display = 'flex';
            _elExtra.style.flexDirection = 'column';
            _elExtra.style.gap = '8px';
            if (_elBtnMengerti && _elBtnMengerti.parentNode) {
                _elBtnMengerti.parentNode.insertBefore(_elExtra, _elBtnMengerti.nextSibling);
            } else {
                _elKartu.appendChild(_elExtra);
            }
        }

        return !!(_elJudul && _elPesan && _elBtnMengerti);
    }

    function bersihkanExtra() {
        if (_elExtra) {
            _elExtra.innerHTML = '';
            _elExtra.classList.add('hidden');
        }
        if (_elBtnMengerti) {
            _elBtnMengerti.classList.remove('hidden');
            _elBtnMengerti.disabled = true;
            _elBtnMengerti.onclick = null;
        }
        if (_elCountdownMengerti) _elCountdownMengerti.textContent = '';
        clearInterval(_elBtnMengerti && _elBtnMengerti._timerId);
    }

    function mulaiCountdownTombol(btn, spanCountdown, kirimCallback) {
        clearInterval(btn._timerId);
        var sisa = DETIK_COUNTDOWN_TOMBOL;
        btn.disabled = true;
        if (spanCountdown) spanCountdown.textContent = ' (' + sisa + ')';
        btn._timerId = setInterval(function () {
            sisa--;
            if (sisa <= 0) {
                clearInterval(btn._timerId);
                if (spanCountdown) spanCountdown.textContent = '';
                btn.disabled = false;
                btn.onclick = kirimCallback;
            } else if (spanCountdown) {
                spanCountdown.textContent = ' (' + sisa + ')';
            }
        }, 1000);
    }

    function bukaOverlayDom() {
        _elOverlay.classList.remove('hidden');
        _elOverlay.classList.add('flex');
        // [FIX BUG OVERLAY INVISIBLE-TAPI-NGUNCI] Class ini yang dipegang
        // dashboard_siswa_overlay.css buat opacity fade -- sebelumnya gak
        // pernah ditambahkan di sini, jadi overlay ke-render display:flex
        // (menutupi & mengunci seluruh halaman) TAPI opacity tetap 0
        // (invisible), karena CSS itu defaultnya opacity:0 dan cuma jadi 1
        // kalau class ini ada. Efeknya: overlay full-screen, gak keliatan,
        // tapi tetap makan semua klik & scroll.
        _elOverlay.classList.add('overlay-pelanggaran--tampil');
        _elOverlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pelanggaran-aktif-blur');
    }

    function tutupOverlayDom() {
        _elOverlay.classList.add('hidden');
        _elOverlay.classList.remove('flex');
        _elOverlay.classList.remove('overlay-pelanggaran--tampil');
        _elOverlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pelanggaran-aktif-blur');
    }

    /* ============================================================
       BAGIAN B -- RENDER OVERLAY PER STATUS
       ============================================================ */
    function tampilkanOverlayPelanggaranAktif(item) {
        _overlayLagiDibuka = true;
        _itemSedangTampil = item;
        bersihkanExtra();

        var cfg = KONFIG_OVERLAY[item.status] || { judul: 'Pelanggaran', pesan: '' };
        _elJudul.textContent = cfg.judul;
        _elPesan.textContent = cfg.pesan;
        _elKeterangan.textContent = item.keterangan || '-';
        _elOleh.textContent = 'Jenis: ' + (item.jenis || '-') + (item.kategori ? ' • Kategori: ' + item.kategori : '');

        if (item.status === 'aktif') {
            mulaiCountdownTombol(_elBtnMengerti, _elCountdownMengerti, function () {
                tutupOverlayLanjut(item.id, true);
            });
            tampilkanTombolBandingToggle(item);
        } else if (item.status === 'menunggu_bk') {
            mulaiCountdownTombol(_elBtnMengerti, _elCountdownMengerti, function () {
                tutupOverlayLanjut(item.id, true);
            });
        } else if (item.status === 'menunggu_tugas') {
            _elBtnMengerti.classList.add('hidden');
            tampilkanFormUploadBukti(item);
        }

        bukaOverlayDom();
    }

    function tampilkanTombolBandingToggle(item) {
        if (!_elExtra) return;
        var html = '<div class="pel-banding-wrap">';
        html += '<button type="button" class="pel-btn pel-btn-banding-toggle" id="pel-btn-toggle-banding">Ajukan Banding</button>';
        html += '<div class="pel-form-banding hidden" id="pel-form-banding">';
        html += '<textarea id="pel-input-banding-alasan" placeholder="Jelaskan alasan banding kamu..."></textarea>';
        html += '<button type="button" class="pel-btn pel-btn-kirim-banding" id="pel-btn-submit-banding">Kirim Banding</button>';
        html += '</div></div>';
        _elExtra.innerHTML = html;
        _elExtra.classList.remove('hidden');

        document.getElementById('pel-btn-toggle-banding').onclick = function () {
            document.getElementById('pel-form-banding').classList.toggle('hidden');
        };
        document.getElementById('pel-btn-submit-banding').onclick = function () {
            prosesKirimBanding(item);
        };
    }

    function tampilkanFormUploadBukti(item) {
        if (!_elExtra) return;
        var html = '';
        if (item.instruksi_penebus) html += '<div class="pel-overlay-instruksi">' + esc(item.instruksi_penebus) + '</div>';
        if (item.deadline_formatted) html += '<div class="pel-overlay-deadline">Batas waktu: ' + esc(item.deadline_formatted) + '</div>';
        if (item.catatan_penolakan) html += '<div class="pel-overlay-ditolak">Ditolak guru: ' + esc(item.catatan_penolakan) + ' -- silakan upload ulang.</div>';
        html += '<div class="pel-upload-bukti">';
        html += '<input type="file" id="pel-input-bukti-file" accept="image/*" multiple>';
        html += '<textarea id="pel-input-bukti-catatan" placeholder="Catatan (opsional)..."></textarea>';
        html += '<button type="button" class="pel-btn pel-btn-kirim-bukti" id="pel-btn-submit-bukti">Upload Bukti</button>';
        html += '</div>';
        _elExtra.innerHTML = html;
        _elExtra.classList.remove('hidden');

        document.getElementById('pel-btn-submit-bukti').onclick = function () {
            prosesKirimBukti(item);
        };
    }

    /* ============================================================
       BAGIAN C -- AKSI SISWA (kirim bukti / banding)
       ============================================================ */
    function prosesKirimBukti(item) {
        var inputFile = document.getElementById('pel-input-bukti-file');
        var inputCatatan = document.getElementById('pel-input-bukti-catatan');
        var files = inputFile && inputFile.files ? Array.prototype.slice.call(inputFile.files) : [];

        if (!files.length) {
            pesanSingkat('Pilih minimal 1 foto bukti dulu.');
            return;
        }

        var tombol = document.getElementById('pel-btn-submit-bukti');
        if (tombol) { tombol.disabled = true; tombol.textContent = 'Mengirim...'; }

        Promise.all(files.map(bacaFileSebagaiDataURL)).then(function (listBase64) {
            return postJSON('/api/pelanggaran/kirim-bukti', {
                id: item.id,
                catatan: inputCatatan ? inputCatatan.value : '',
                bukti: listBase64
            });
        }).then(function (json) {
            if (json && json.success) {
                pesanSingkat('Bukti berhasil dikirim, menunggu ACC guru.');
                tutupOverlayLanjut(item.id, false);
            } else {
                pesanSingkat((json && json.message) || 'Gagal mengirim bukti.');
                if (tombol) { tombol.disabled = false; tombol.textContent = 'Upload Bukti'; }
            }
        }).catch(function () {
            pesanSingkat('Gagal mengirim bukti, coba lagi.');
            if (tombol) { tombol.disabled = false; tombol.textContent = 'Upload Bukti'; }
        });
    }

    function prosesKirimBanding(item) {
        var ta = document.getElementById('pel-input-banding-alasan');
        var alasan = ta ? ta.value.trim() : '';

        if (!alasan) {
            pesanSingkat('Isi alasan banding dulu.');
            return;
        }

        var tombol = document.getElementById('pel-btn-submit-banding');
        if (tombol) { tombol.disabled = true; tombol.textContent = 'Mengirim...'; }

        postJSON('/api/pelanggaran/banding', { id: item.id, alasan_banding: alasan }).then(function (json) {
            if (json && json.success) {
                pesanSingkat('Banding terkirim, ditunggu peninjauan.');
                tutupOverlayLanjut(item.id, true);
            } else {
                pesanSingkat((json && json.message) || 'Gagal kirim banding.');
                if (tombol) { tombol.disabled = false; tombol.textContent = 'Kirim Banding'; }
            }
        }).catch(function () {
            pesanSingkat('Gagal kirim banding, coba lagi.');
            if (tombol) { tombol.disabled = false; tombol.textContent = 'Kirim Banding'; }
        });
    }

    /* ============================================================
       BAGIAN D -- ANTRIAN OVERLAY (bisa > 1 pelanggaran aktif)
       ============================================================ */
    function tutupOverlayLanjut(id, tandaiSudahDilihat) {
        if (tandaiSudahDilihat) _sudahDitampilkanSekaliSet[id] = true;
        _antrian = _antrian.filter(function (e) { return e.id !== id; });
        tutupOverlayDom();
        _itemSedangTampil = null;
        _overlayLagiDibuka = false;
        setTimeout(tampilkanBerikutnyaDariAntrian, 250);
    }

    function tampilkanBerikutnyaDariAntrian() {
        if (_overlayLagiDibuka || !_elOverlay) return;
        if (!_antrian.length) return;
        tampilkanOverlayPelanggaranAktif(_antrian[0]);
    }

    /* ============================================================
       BAGIAN E -- ARSIP (read-only, di tab profil)
       ============================================================ */
    function buatWrapArsip() {
        var parent = document.querySelector(SELEKTOR_ARSIP_PARENT);
        if (!parent) return null;
        var wrap = document.createElement('div');
        wrap.id = 'pel-arsip-siswa-wrap';
        wrap.className = 'bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm';
        parent.appendChild(wrap);
        return wrap;
    }

    function renderArsip() {
        var wrap = document.getElementById('pel-arsip-siswa-wrap') || buatWrapArsip();
        if (!wrap) return;

        var html = '<h4 class="font-bold text-sm text-slate-800 mb-2">Riwayat Pelanggaran</h4>';

        if (!_arsipTerkini.length) {
            html += '<p class="pel-kosong">Belum ada riwayat pelanggaran.</p>';
            wrap.innerHTML = html;
            return;
        }

        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        _arsipTerkini.forEach(function (e) {
            var warna = WARNA_STATUS[e.status] || 'abu';
            html += '<div class="pel-item pel-item-' + warna + '">';
            html += '<div class="pel-item-head"><span class="pel-item-jenis">' + esc(e.jenis) + '</span>' +
                '<span class="pel-status-pill pel-status-' + warna + '">' + esc(LABEL_STATUS[e.status] || e.status) + '</span></div>';
            if (e.keterangan) html += '<div class="pel-item-keterangan">' + esc(e.keterangan) + '</div>';
            if (e.catatan_bk) html += '<div class="pel-item-catatan-bk">Catatan BK: ' + esc(e.catatan_bk) + '</div>';
            html += '<div class="pel-item-tanggal">' + esc(e.dibuat_at_formatted || '') + '</div>';
            html += '</div>';
        });
        html += '</div>';

        wrap.innerHTML = html;
    }

    /* ============================================================
       BAGIAN F -- SINKRONISASI STATUS (polling + data awal)
       ============================================================ */
    function cekDanTampilkanOverlayPelanggaranAktif() {
        prosesResponseStatus(_dataTerakhirUntukProses);
    }
    var _dataTerakhirUntukProses = null;

    function prosesResponseStatus(json) {
        if (!json || !('daftar_aktif' in json)) return;
        _dataTerakhirUntukProses = json;

        _mengunciTerkini = !!json.mengunci;

        _arsipTerkini = json.arsip || [];
        renderArsip();

        var daftarBaru = (json.daftar_aktif || []).filter(function (e) {
            return e.status !== 'menunggu_acc' && !_sudahDitampilkanSekaliSet[e.id];
        });
        _antrian = daftarBaru;

        if (_overlayLagiDibuka && _itemSedangTampil) {
            var masihAda = (json.daftar_aktif || []).some(function (e) { return e.id === _itemSedangTampil.id; });
            if (!masihAda) {
                tutupOverlayDom();
                _overlayLagiDibuka = false;
                _itemSedangTampil = null;
            }
        }

        tampilkanBerikutnyaDariAntrian();
    }

    function ambilStatus() {
        return fetchJSON('/api/pelanggaran/status').then(prosesResponseStatus).catch(function () { /* diam -- coba lagi poll berikutnya */ });
    }

    function bacaDataAwal() {
        var el = document.getElementById('data-pelanggaran-awal');
        if (!el) return null;
        try {
            return JSON.parse(el.textContent || el.innerText || 'null');
        } catch (err) {
            return null;
        }
    }

    /* ============================================================
       INIT
       ============================================================ */
    function init() {
        if (!cacheDom()) return; // markup overlay gak ada -- skip aman, jangan error

        var awal = bacaDataAwal();
        if (awal && 'daftar_aktif' in awal) {
            prosesResponseStatus(awal);
        } else {
            ambilStatus();
        }

        setInterval(ambilStatus, JEDA_POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Diekspos buat dipanggil manual dari console/debug kalau perlu.
    window.PelanggaranSiswa = {
        cekDanTampilkanOverlayPelanggaranAktif: cekDanTampilkanOverlayPelanggaranAktif,
        tampilkanOverlayPelanggaranAktif: tampilkanOverlayPelanggaranAktif,
        ambilStatus: ambilStatus
    };
})();
