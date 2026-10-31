/* ============================================================
   REMINDER ACC GURU -- banner "menunggu ACC >3 hari"
   ------------------------------------------------------------
   File BERDIRI SENDIRI (IIFE terpisah). Fetch sekali saat dashboard
   dibuka dari GET /api/pelanggaran/reminder -- balikin
     { success, jumlah, daftar: [{ id, username, nama_siswa, jenis,
       hari_menunggu, dikirim_at_formatted }, ...] }
   khusus milik guru yang sedang login.

   Tampil SEKALI per sesi tab (sessionStorage, bukan localStorage --
   sengaja, supaya muncul lagi kalau guru buka tab/sesi baru, tapi
   tidak muncul berulang-ulang tiap reload di sesi yang sama).
   ============================================================ */
(function () {
    var SESSION_KEY = 'reminder_acc_sudah_tampil_sesi_ini';
    var STYLE_ID = 'gaya-reminder-acc-guru';
    var BANNER_ID = 'banner-reminder-acc-guru';

    function pastikanGayaCSS() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '#' + BANNER_ID + ' {' +
            '  display: flex;' +
            '  align-items: center;' +
            '  justify-content: space-between;' +
            '  gap: 12px;' +
            '  flex-wrap: wrap;' +
            '  background: #eff6ff;' +
            '  border: 1px solid #bfdbfe;' +
            '  color: #1e3a8a;' +
            '  border-radius: 14px;' +
            '  padding: 12px 16px;' +
            '  margin: 12px 0;' +
            '  font-size: 13px;' +
            '  font-weight: 600;' +
            '  animation: reminderAccGuruMasuk 0.25s ease-out;' +
            '}' +
            '@keyframes reminderAccGuruMasuk {' +
            '  from { opacity: 0; transform: translateY(-6px); }' +
            '  to { opacity: 1; transform: translateY(0); }' +
            '}' +
            '#' + BANNER_ID + ' .reminder-acc-aksi {' +
            '  display: flex;' +
            '  align-items: center;' +
            '  gap: 8px;' +
            '  flex-shrink: 0;' +
            '}' +
            '#' + BANNER_ID + ' button.reminder-acc-lihat {' +
            '  background: #2563eb;' +
            '  color: #fff;' +
            '  border: none;' +
            '  border-radius: 9999px;' +
            '  padding: 6px 14px;' +
            '  font-size: 12px;' +
            '  font-weight: 700;' +
            '  cursor: pointer;' +
            '}' +
            '#' + BANNER_ID + ' button.reminder-acc-lihat:hover {' +
            '  background: #1d4ed8;' +
            '}' +
            '#' + BANNER_ID + ' button.reminder-acc-tutup {' +
            '  background: transparent;' +
            '  border: none;' +
            '  color: #1e3a8a;' +
            '  font-size: 18px;' +
            '  line-height: 1;' +
            '  cursor: pointer;' +
            '  padding: 0 4px;' +
            '}';
        document.head.appendChild(style);
    }

    function cariIndukBanner() {
        // Ditaruh paling atas area konten utama -- pola sama dgn
        // #main-scroll-container yang dipakai file pelanggaran lain,
        // fallback ke <main>/<body> kalau strukturnya beda.
        return document.querySelector('#main-scroll-container') ||
            document.querySelector('main') ||
            document.body;
    }

    function tutupBanner() {
        var el = document.getElementById(BANNER_ID);
        if (el) el.remove();
    }

    function bukaHalamanPelanggaran() {
        tutupBanner();
        if (typeof window.switchTab === 'function') {
            window.switchTab('pelanggaran');
        }
    }

    function tampilkanBanner(jumlah) {
        pastikanGayaCSS();
        if (document.getElementById(BANNER_ID)) return; // sudah tampil

        var induk = cariIndukBanner();
        var banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.innerHTML =
            '<span>⏰ Ada ' + jumlah + ' pelanggaran menunggu ACC kamu lebih dari 3 hari</span>' +
            '<span class="reminder-acc-aksi">' +
            '  <button type="button" class="reminder-acc-lihat">Lihat</button>' +
            '  <button type="button" class="reminder-acc-tutup" aria-label="Tutup">&times;</button>' +
            '</span>';

        induk.insertBefore(banner, induk.firstChild);

        banner.querySelector('.reminder-acc-lihat').onclick = bukaHalamanPelanggaran;
        banner.querySelector('.reminder-acc-tutup').onclick = tutupBanner;
    }

    function mulai() {
        if (sessionStorage.getItem(SESSION_KEY) === '1') return;

        fetch('/api/pelanggaran/reminder')
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (!json || !json.success) return;
                var jumlah = json.jumlah || 0;
                if (jumlah <= 0) return;
                tampilkanBanner(jumlah);
                sessionStorage.setItem(SESSION_KEY, '1');
            })
            .catch(function () { /* diam-diam gagal -- coba lagi sesi berikutnya */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mulai);
    } else {
        mulai();
    }
})();
