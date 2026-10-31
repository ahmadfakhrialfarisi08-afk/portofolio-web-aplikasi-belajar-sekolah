/* SCORUS AI -- tampilan riwayat chat + penyimpanan ke database.
   Dimuat SESUDAH skrip chat inline di dashboard_guru.html. Skrip ini:
   - menambah tombol "Riwayat" + panel daftar chat di dalam kartu SCORUS AI
   - mengganti window.scorusKirim agar memakai /api/scorus/chat (tersimpan di database)
   - membungkus window.scorusChatBaru agar chat baru benar-benar terpisah dari chat lama */
(function () {
    'use strict';
    var Api = window.ScorusHistoryClient;
    if (!Api) { console.warn('SCORUS riwayat: scorus_history_client.js belum termuat.'); return; }
    if (window.__scorusRiwayatAktif) return;   // aman kalau skrip ini terpasang dua kali
    window.__scorusRiwayatAktif = true;

    var aktifId = null;        // id chat yang sedang dibuka (null = chat baru, belum tersimpan)
    var sedangKirim = false;
    var tokenBuka = 0;         // membatalkan hasil buka-chat yang sudah basi
    var daftar = [];
    var statusDaftar = 'memuat'; // memuat | siap | gagal
    var pesanGagal = '';
    var chatBaruAsli = window.scorusChatBaru;

    function el(id) { return document.getElementById(id); }
    function buat(tag, kelas, teks) {
        var e = document.createElement(tag);
        if (kelas) e.className = kelas;
        if (teks != null) e.textContent = teks;
        return e;
    }

    /* ---------- format pesan (sama dengan skrip chat inline) ---------- */
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function format(teks) {
        var out = esc(teks);
        out = out.replace(/```([\s\S]*?)```/g, function (_, k) { return '<pre><code>' + k.replace(/^\w*\n/, '') + '</code></pre>'; });
        out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        return out.replace(/\n/g, '<br>');
    }
    function bubble(peran, teks, htmlMentah) {
        var log = el('scorus-log'); if (!log) return null;
        var w = log.querySelector('.scorus-welcome'); if (w) w.remove();
        var row = buat('div', 'scorus-msg ' + peran);
        var b = buat('div', 'scorus-bubble');
        if (htmlMentah) b.innerHTML = htmlMentah;
        else if (peran === 'user' || peran === 'error') b.textContent = teks;
        else b.innerHTML = format(teks);
        row.appendChild(b); log.appendChild(row); log.scrollTop = log.scrollHeight;
        return row;
    }
    function setKirim(aktif) {
        sedangKirim = !aktif;
        var b = el('scorus-send'); if (b) b.disabled = !aktif;
    }

    /* ---------- waktu (WIB) ---------- */
    function waktuTampil(iso) {
        var d = new Date(iso); if (isNaN(d)) return '';
        var opsi = { timeZone: 'Asia/Jakarta' };
        var tgl = function (x) { return x.toLocaleDateString('en-CA', opsi); };
        var jam = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).replace('.', ':');
        var sekarang = new Date();
        if (tgl(d) === tgl(sekarang)) return 'Hari ini, ' + jam;
        if (tgl(d) === tgl(new Date(sekarang.getTime() - 86400000))) return 'Kemarin, ' + jam;
        return d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' });
    }

    /* ---------- panel ---------- */
    var panel, backdrop, tombolRiwayat, listEl;

    function bangunUI() {
        var shell = document.querySelector('#tab-scorus-ai .scorus-shell');
        var head = shell && shell.querySelector('.scorus-head');
        var chatBaru = head && head.querySelector('.scorus-newchat');
        if (!shell || !head || !chatBaru) return false;

        var aksi = buat('div', 'scorus-head-actions');
        tombolRiwayat = buat('button', 'scorus-histbtn');
        tombolRiwayat.type = 'button';
        tombolRiwayat.setAttribute('aria-expanded', 'false');
        tombolRiwayat.setAttribute('aria-controls', 'scorus-hist-panel');
        tombolRiwayat.title = 'Lihat riwayat chat';
        tombolRiwayat.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i><span>Riwayat</span>';
        tombolRiwayat.addEventListener('click', function () { panelTerbuka() ? tutupPanel() : bukaPanel(); });
        head.insertBefore(aksi, chatBaru);
        aksi.appendChild(tombolRiwayat);
        aksi.appendChild(chatBaru);   // Chat Baru dipindah ke grup yang sama, kelas & onclick tetap

        backdrop = buat('div', 'scorus-hist-backdrop');
        backdrop.addEventListener('click', tutupPanel);

        panel = buat('aside', 'scorus-hist-panel');
        panel.id = 'scorus-hist-panel';
        panel.setAttribute('aria-label', 'Riwayat chat');
        var ph = buat('div', 'scorus-hist-head');
        ph.appendChild(buat('h3', null, 'Riwayat Chat'));
        var x = buat('button', 'scorus-hist-tutup'); x.type = 'button'; x.setAttribute('aria-label', 'Tutup riwayat');
        x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        x.addEventListener('click', tutupPanel);
        ph.appendChild(x);
        listEl = buat('div', 'scorus-hist-list');
        panel.appendChild(ph); panel.appendChild(listEl);

        shell.appendChild(backdrop); shell.appendChild(panel);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panelTerbuka()) tutupPanel(); });
        return true;
    }

    function panelTerbuka() { return panel && panel.classList.contains('terbuka'); }
    function bukaPanel() {
        panel.classList.add('terbuka'); backdrop.classList.add('terbuka');
        tombolRiwayat.setAttribute('aria-expanded', 'true');
        muatDaftar();   // selalu segar saat dibuka
    }
    function tutupPanel() {
        panel.classList.remove('terbuka'); backdrop.classList.remove('terbuka');
        tombolRiwayat.setAttribute('aria-expanded', 'false');
    }

    function renderDaftar() {
        if (!listEl) return;
        listEl.textContent = '';
        if (statusDaftar === 'memuat' && !daftar.length) { listEl.appendChild(buat('p', 'scorus-hist-info', 'Memuat riwayat...')); return; }
        if (statusDaftar === 'gagal' && !daftar.length) {
            var p = buat('p', 'scorus-hist-info', pesanGagal || 'Riwayat tidak bisa dimuat.');
            var ulang = buat('button', null, 'Coba lagi'); ulang.type = 'button'; ulang.addEventListener('click', muatDaftar);
            p.appendChild(document.createElement('br')); p.appendChild(ulang);
            listEl.appendChild(p); return;
        }
        if (!daftar.length) { listEl.appendChild(buat('p', 'scorus-hist-info', 'Belum ada riwayat. Chat yang Anda kirim akan tersimpan di sini.')); return; }
        daftar.forEach(function (c) {
            var item = buat('div', 'scorus-hist-item' + (c.id === aktifId ? ' aktif' : ''));
            var buka = buat('button', 'scorus-hist-buka'); buka.type = 'button';
            buka.appendChild(buat('span', 'scorus-hist-judul', c.title || 'Chat Baru'));
            buka.appendChild(buat('span', 'scorus-hist-waktu', waktuTampil(c.updated_at)));
            buka.addEventListener('click', function () { bukaChat(c.id); });
            var hapus = buat('button', 'scorus-hist-hapus'); hapus.type = 'button';
            hapus.setAttribute('aria-label', 'Hapus chat: ' + (c.title || ''));
            hapus.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
            hapus.addEventListener('click', function () { hapusChat(c); });
            item.appendChild(buka); item.appendChild(hapus);
            listEl.appendChild(item);
        });
    }

    function muatDaftar() {
        statusDaftar = 'memuat'; renderDaftar();
        return Api.daftar().then(function (d) { daftar = d; statusDaftar = 'siap'; renderDaftar(); })
            .catch(function (e) { statusDaftar = 'gagal'; pesanGagal = e.message; renderDaftar(); });
    }

    /* ---------- aksi ---------- */
    function bukaChat(id) {
        if (sedangKirim) return;
        var token = ++tokenBuka;
        var log = el('scorus-log');
        if (log) { log.textContent = ''; bubble('bot', '', '<span class="scorus-typing"><i></i><i></i><i></i></span>'); }
        tutupPanel();
        Api.buka(id).then(function (d) {
            if (token !== tokenBuka) return;
            aktifId = id;
            log.textContent = '';
            (d.messages || []).forEach(function (m) { bubble(m.role === 'user' ? 'user' : 'bot', m.content); });
            renderDaftar();
        }).catch(function (e) {
            if (token !== tokenBuka) return;
            log.textContent = '';
            bubble('error', e.status === 404 ? 'Chat ini sudah tidak ada.' : e.message);
            if (e.status === 404) muatDaftar();
        });
    }

    function hapusChat(c) {
        if (!window.confirm('Hapus chat "' + (c.title || 'Chat Baru') + '"? Tindakan ini tidak bisa dibatalkan.')) return;
        Api.hapus(c.id).then(function () {
            daftar = daftar.filter(function (x) { return x.id !== c.id; });
            if (aktifId === c.id) mulaiBaru();
            renderDaftar();
        }).catch(function (e) {
            if (e.status === 404) { daftar = daftar.filter(function (x) { return x.id !== c.id; }); renderDaftar(); return; }
            window.alert(e.message);
        });
    }

    function mulaiBaru() {
        tokenBuka++;             // batalkan pembukaan chat yang masih berjalan
        aktifId = null;
        if (typeof chatBaruAsli === 'function') chatBaruAsli(); // tampilan sambutan + fokus input
        renderDaftar();
    }

    window.scorusChatBaru = function () {
        if (sedangKirim) return;
        mulaiBaru(); tutupPanel();
    };

    window.scorusKirim = function () {
        if (sedangKirim) return;
        var inp = el('scorus-input'); if (!inp) return;
        var teks = inp.value.trim(); if (!teks) return;
        inp.value = ''; inp.style.height = 'auto';

        bubble('user', teks);
        var ketik = bubble('bot', '', '<span class="scorus-typing"><i></i><i></i><i></i></span>');
        setKirim(false);
        var idKirim = aktifId;

        Api.kirim(idKirim, teks).then(function (d) {
            if (ketik) ketik.remove();
            bubble('bot', d.reply);
            if (d.tersimpan && d.conversation) {
                if (aktifId === idKirim) aktifId = d.conversation.id;   // chat baru jadi aktif
                muatDaftar();
            } else if (d.tersimpan === false) {
                bubble('error', 'Jawaban ini belum tersimpan di riwayat.');
            }
        }).catch(function (e) {
            if (ketik) ketik.remove();
            bubble('error', e.message || 'SCORUS AI sedang tidak bisa dihubungi. Coba lagi nanti.');
            inp.value = teks;   // teks dikembalikan supaya tidak perlu mengetik ulang
        }).then(function () { setKirim(true); });
    };

    var sudahMulai = false;
    function mulai() {
        if (sudahMulai) return;                 // DOMContentLoaded dipicu ulang -> jangan bangun dua kali
        sudahMulai = true;
        if (!bangunUI()) { console.warn('SCORUS riwayat: elemen kartu SCORUS AI tidak ditemukan.'); return; }
        muatDaftar();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai); else mulai();
})();
