/* ============================================================
   FITUR "PELANGGARAN + PENEBUS" -- DASHBOARD GURU
   ------------------------------------------------------------
   File ini BERDIRI SENDIRI (IIFE terpisah, gaya sama persis dgn
   dashboard_siswa_pelanggaran.js) -- TIDAK mengubah/menghapus fungsi,
   variabel, atau logika apa pun yang sudah ada di dashboard_guru.js.
   Dipasang PALING AKHIR (setelah dashboard_guru.js) via <script src>
   tambahan di dashboard_guru.html.

   CATATAN PENTING (karena dashboard_guru.js/.html tidak ikut diupload
   ke sesi ini, jadi saya tidak tahu markup card siswa/sidebar asli
   kamu) -- 1 BARIS ASUMSI PER BAGIAN, SEMUA BISA DISESUAIKAN:

   1) BADGE DI CARD SISWA BERANDA: script ini otomatis mencari elemen
      yang punya attribute `data-siswa-username="<username>"` di DOM
      (mis. tiap card siswa di Beranda) dan menyuntik badge ⚠️ ke
      dalamnya + pasang onclick buka modal detail. Kalau card siswa
      kamu BELUM punya attribute ini, tinggal tambahkan
      `data-siswa-username="${username}"` di root elemen card pas
      di-render (1 baris HTML), ATAU panggil manual:
        window.PelanggaranGuru.pasangKartu(username, elemenKartuDom)
      dari fungsi render card kamu sendiri.

   2) HALAMAN PELANGGARAN (tabel + filter + form manual): script ini
      cari <section id="tab-pelanggaran"> (pola sama seperti
      #tab-about-us/#tab-maintenance yang sudah ada) -- kalau BELUM
      ada, section-nya DIBUATKAN OTOMATIS & disisipkan sebelum
      penutup <main>/di akhir <body>, PLUS tombol menu baru ditambah
      ke #sidebar-menu (kalau elemen itu ada) yang manggil
      switchTab('pelanggaran') (fungsi generik switchTab() yang sudah
      ada, tidak diubah). Kalau sidebar/switchTab kamu namanya beda,
      sesuaikan konstanta SELEKTOR_SIDEBAR_MENU & panggilan
      switchTab('pelanggaran') di bawah.

   3) Warna badge: merah = ada 'aktif', biru = ada 'menunggu_acc'
      (tanpa aktif), kuning = cuma 'menunggu_tugas' -- angka badge =
      total entri BELUM selesai (aktif+menunggu_tugas+menunggu_acc),
      sesuai ringkasan dari server (bangun_ringkasan_semua_siswa()).
   ============================================================ */
(function () {
    var JEDA_POLL_MS = 15000;
    var SELEKTOR_SIDEBAR_MENU = '#sidebar-menu';
    var _ringkasanTerkini = {};       // username -> {jumlah_belum_selesai, warna_badge, ...}
    var _modalSiswaSedangDibuka = null; // username yang modalnya lagi kebuka (buat refresh setelah aksi)

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

    var LABEL_STATUS = {
        aktif: 'Aktif',
        menunggu_tugas: 'Menunggu Tugas Dikerjakan',
        menunggu_acc: 'Menunggu ACC Guru',
        menunggu_bk: 'Menunggu Persetujuan BK',
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

    /* ============================================================
       BAGIAN A -- BADGE DI CARD SISWA BERANDA
       ============================================================ */
    function htmlBadge(ringkasanSiswa) {
        if (!ringkasanSiswa || !ringkasanSiswa.jumlah_belum_selesai) return '';
        return '<button type="button" class="pel-badge pel-badge-' + ringkasanSiswa.warna_badge + '" ' +
            'title="Ada pelanggaran belum selesai">⚠️ ' + ringkasanSiswa.jumlah_belum_selesai + '</button>';
    }

    function pasangKartu(username, elKartu) {
        if (!elKartu) return;
        var slot = elKartu.querySelector('.pel-badge-slot');
        if (!slot) {
            slot = document.createElement('span');
            slot.className = 'pel-badge-slot';
            elKartu.appendChild(slot);
        }
        slot.innerHTML = htmlBadge(_ringkasanTerkini[username]);
        var tombol = slot.querySelector('.pel-badge');
        if (tombol) {
            tombol.onclick = function (ev) {
                ev.stopPropagation(); // jangan ikut memicu onclick card itu sendiri (kalau ada)
                bukaModalDetail(username);
            };
        }
        // Card itu sendiri juga boleh diklik buat buka modal (di luar badge),
        // TIDAK menimpa onclick asli card kalau kamu sudah punya sendiri --
        // cukup tambah listener kedua yang cuma jalan kalau klik bukan di
        // dalam badge (biar tidak tabrakan/double-fire).
        elKartu.addEventListener('click', function (ev) {
            if (ev.target.closest('.pel-badge')) return;
            if (elKartu.dataset.pelAbaikanKlikKartu === 'true') return;
            bukaModalDetail(username);
        });
    }

    function segarkanSemuaBadgeKartu() {
        document.querySelectorAll('[data-siswa-username]').forEach(function (el) {
            pasangKartu(el.getAttribute('data-siswa-username'), el);
        });
    }

    function muatRingkasanDariServer() {
        return fetchJSON('/api/pelanggaran/semua').then(function (json) {
            if (!json || !json.success) return;
            _ringkasanTerkini = json.ringkasan || {};
            _dataDetailTerkini = json.data || {};
            segarkanSemuaBadgeKartu();
            if (document.getElementById('tab-pelanggaran')) renderTabelHalamanPelanggaran();
            if (_modalSiswaSedangDibuka) renderIsiModal(_modalSiswaSedangDibuka);
            segarkanModalDaftarDanDetail();
        }).catch(function () { /* offline sesaat -- coba lagi poll berikutnya */ });
    }

    var _dataDetailTerkini = {}; // username -> [daftar pelanggaran, sudah urut dari server]

    /* ============================================================
       BAGIAN B -- MODAL DETAIL PELANGGARAN SISWA
       ============================================================ */
    function pastikanMarkupModal() {
        if (document.getElementById('modal-detail-pelanggaran-v2')) return;
        var wrap = document.createElement('div');
        wrap.id = 'modal-detail-pelanggaran-v2';
        wrap.className = 'pel-modal-overlay hidden';
        wrap.innerHTML =
            '<div class="pel-modal-box">' +
            '  <div class="pel-modal-head">' +
            '    <h3 id="pel-modal-judul">Detail Pelanggaran</h3>' +
            '    <button type="button" class="pel-btn-close" id="pel-modal-tutup">&times;</button>' +
            '  </div>' +
            '  <div class="pel-modal-body" id="pel-modal-list"></div>' +
            '</div>';
        document.body.appendChild(wrap);
        document.getElementById('pel-modal-tutup').onclick = tutupModal;
        wrap.addEventListener('click', function (ev) { if (ev.target === wrap) tutupModal(); });
    }

    function tutupModal() {
        var el = document.getElementById('modal-detail-pelanggaran-v2');
        if (el) el.classList.add('hidden');
        _modalSiswaSedangDibuka = null;
    }

    function bukaModalDetail(username) {
        pastikanMarkupModal();
        _modalSiswaSedangDibuka = username;
        var u = (window._daftarSiswaPelanggaran || {})[username];
        document.getElementById('pel-modal-judul').textContent =
            'Detail Pelanggaran -- ' + (u && u.nama ? u.nama : username);
        document.getElementById('modal-detail-pelanggaran-v2').classList.remove('hidden');
        // Selalu tarik data TERBARU langsung dari server saat modal dibuka
        // (jangan cuma andalkan cache polling 15 detik) supaya guru tidak
        // lihat data basi begitu buka modal.
        fetchJSON('/api/pelanggaran/daftar?username=' + encodeURIComponent(username)).then(function (json) {
            if (!json || !json.success) return;
            _dataDetailTerkini[username] = json.daftar;
            renderIsiModal(username);
        });
    }

    function htmlBukti(bukti) {
        if (!bukti || !bukti.length) return '';
        return '<div class="pel-bukti-grid">' + bukti.map(function (b) {
            return '<img src="' + esc(b) + '" class="pel-bukti-thumb" onclick="window.open(this.src, \'_blank\')">';
        }).join('') + '</div>';
    }

    function renderIsiModal(username) {
        if (_modalSiswaSedangDibuka !== username) return;
        var list = document.getElementById('pel-modal-list');
        if (!list) return;
        var daftar = _dataDetailTerkini[username] || [];
        if (!daftar.length) {
            list.innerHTML = '<p class="pel-kosong">Belum ada pelanggaran tercatat.</p>';
            return;
        }
        list.innerHTML = daftar.map(function (e) { return htmlItemModal(username, e); }).join('');
        pasangHandlerAksi(username, daftar);
    }

    function htmlItemModal(username, e) {
        var audit = '';
        if (e.dilaporkan_oleh_nama) {
            audit += '<div class="pel-audit">Dilaporkan oleh: ' + esc(e.dilaporkan_oleh_nama) + '</div>';
        }
        if (e.ditinjau_oleh_nama) {
            audit += '<div class="pel-audit">Ditinjau oleh: ' + esc(e.ditinjau_oleh_nama) + '</div>';
        }
        if (e.dibatalkan_oleh_nama) {
            audit += '<div class="pel-audit">Dibatalkan oleh: ' + esc(e.dibatalkan_oleh_nama) + '</div>';
        }
        // audit KOSONG total kalau guru yang buka BUKAN pelapor/admin --
        // backend (pelanggaran_untuk_response) memang tidak mengirim field
        // ini sama sekali kalau bukan berhak (bukan cuma disembunyikan di
        // frontend), jadi aman dari akal-akalan DevTools juga.

        var aksi = '';
        if (e.status === 'aktif') {
            aksi = '<button type="button" class="pel-btn pel-btn-kasih-tugas" data-id="' + e.id + '">Kasih Tugas Penebus</button>';
        } else if (e.status === 'menunggu_acc') {
            aksi = '<button type="button" class="pel-btn pel-btn-acc" data-id="' + e.id + '">ACC</button>' +
                '<button type="button" class="pel-btn pel-btn-tolak" data-id="' + e.id + '">Tolak</button>';
        }
        // menunggu_tugas & selesai/dibatalkan: tidak ada tombol aksi utama
        // (bola di siswa / entri sudah final) -- kecuali tombol Batalkan
        // Manual di bawah, tersedia selama belum final.
        var btnBatalkan = (e.status !== 'selesai' && e.status !== 'dibatalkan')
            ? '<button type="button" class="pel-btn pel-btn-batalkan" data-id="' + e.id + '">Batalkan</button>'
            : '';

        return '' +
            '<div class="pel-item pel-item-' + WARNA_STATUS[e.status] + '" data-id="' + e.id + '">' +
            '  <div class="pel-item-head">' +
            '    <span class="pel-item-jenis">' + esc(e.jenis) + '</span>' +
            '    <span class="pel-status-pill pel-status-' + WARNA_STATUS[e.status] + '">' + LABEL_STATUS[e.status] + '</span>' +
            '  </div>' +
            '  <div class="pel-item-keterangan">' + esc(e.keterangan || '-') + '</div>' +
            (e.instruksi_penebus ? '<div class="pel-item-instruksi"><b>Instruksi penebus:</b> ' + esc(e.instruksi_penebus) + '</div>' : '') +
            (e.deadline_formatted ? '<div class="pel-item-deadline"><b>Deadline:</b> ' + esc(e.deadline_formatted) + '</div>' : '') +
            (e.catatan_siswa ? '<div class="pel-item-catatan-siswa"><b>Catatan siswa:</b> ' + esc(e.catatan_siswa) + '</div>' : '') +
            (e.catatan_penolakan ? '<div class="pel-item-catatan-tolak"><b>Alasan ditolak sebelumnya:</b> ' + esc(e.catatan_penolakan) + '</div>' : '') +
            (e.alasan_banding ? '<div class="pel-item-banding"><b>Banding siswa:</b> ' + esc(e.alasan_banding) + '</div>' : '') +
            htmlBukti(e.bukti) +
            audit +
            '  <div class="pel-item-aksi">' + aksi + btnBatalkan + '</div>' +
            '  <div class="pel-form-tugaskan hidden" data-id="' + e.id + '">' +
            '    <textarea class="pel-input-instruksi" placeholder="Instruksi penebus...">' + esc(e.instruksi_penebus || '') + '</textarea>' +
            '    <input type="datetime-local" class="pel-input-deadline">' +
            '    <button type="button" class="pel-btn pel-btn-kirim-tugaskan" data-id="' + e.id + '">Simpan &amp; Kirim ke Siswa</button>' +
            '  </div>' +
            '  <div class="pel-form-tolak hidden" data-id="' + e.id + '">' +
            '    <textarea class="pel-input-catatan-tolak" placeholder="Alasan ditolak (opsional)..."></textarea>' +
            '    <button type="button" class="pel-btn pel-btn-kirim-tolak" data-id="' + e.id + '">Kirim Penolakan</button>' +
            '  </div>' +
            '</div>';
    }

    function pasangHandlerAksi(username, daftar) {
        var list = document.getElementById('pel-modal-list');

        list.querySelectorAll('.pel-btn-kasih-tugas').forEach(function (btn) {
            btn.onclick = function () {
                var id = btn.dataset.id;
                list.querySelectorAll('.pel-form-tugaskan').forEach(function (f) {
                    f.classList.toggle('hidden', f.dataset.id !== id);
                });
            };
        });
        list.querySelectorAll('.pel-btn-kirim-tugaskan').forEach(function (btn) {
            btn.onclick = function () {
                var id = btn.dataset.id;
                var form = list.querySelector('.pel-form-tugaskan[data-id="' + id + '"]');
                var instruksi = form.querySelector('.pel-input-instruksi').value.trim();
                var deadline = form.querySelector('.pel-input-deadline').value || null;
                if (!instruksi) { alert('Instruksi penebus tidak boleh kosong.'); return; }
                btn.disabled = true;
                postJSON('/api/pelanggaran/tugaskan', { username: username, id: id, instruksi_penebus: instruksi, deadline: deadline })
                    .then(function (json) {
                        btn.disabled = false;
                        if (!json.success) { alert(json.message || 'Gagal menyimpan.'); return; }
                        bukaModalDetail(username);
                        muatRingkasanDariServer();
                    });
            };
        });

        list.querySelectorAll('.pel-btn-acc').forEach(function (btn) {
            btn.onclick = function () {
                if (!confirm('ACC bukti tugas penebus ini? Pelanggaran akan ditandai Selesai.')) return;
                btn.disabled = true;
                postJSON('/api/pelanggaran/acc', { username: username, id: btn.dataset.id })
                    .then(function (json) {
                        btn.disabled = false;
                        if (!json.success) { alert(json.message || 'Gagal ACC.'); return; }
                        bukaModalDetail(username);
                        muatRingkasanDariServer();
                    });
            };
        });
        list.querySelectorAll('.pel-btn-tolak').forEach(function (btn) {
            btn.onclick = function () {
                var id = btn.dataset.id;
                list.querySelectorAll('.pel-form-tolak').forEach(function (f) {
                    f.classList.toggle('hidden', f.dataset.id !== id);
                });
            };
        });
        list.querySelectorAll('.pel-btn-kirim-tolak').forEach(function (btn) {
            btn.onclick = function () {
                var id = btn.dataset.id;
                var form = list.querySelector('.pel-form-tolak[data-id="' + id + '"]');
                var catatan = form.querySelector('.pel-input-catatan-tolak').value.trim();
                btn.disabled = true;
                postJSON('/api/pelanggaran/tolak', { username: username, id: id, catatan_penolakan: catatan })
                    .then(function (json) {
                        btn.disabled = false;
                        if (!json.success) { alert(json.message || 'Gagal menolak.'); return; }
                        bukaModalDetail(username);
                        muatRingkasanDariServer();
                    });
            };
        });

        list.querySelectorAll('.pel-btn-batalkan').forEach(function (btn) {
            btn.onclick = function () {
                if (!confirm('Batalkan pelanggaran ini? Aksi tidak bisa diurungkan.')) return;
                btn.disabled = true;
                postJSON('/api/pelanggaran/batalkan-manual', { username: username, id: btn.dataset.id })
                    .then(function (json) {
                        btn.disabled = false;
                        if (!json.success) { alert(json.message || 'Gagal membatalkan.'); return; }
                        bukaModalDetail(username);
                        muatRingkasanDariServer();
                    });
            };
        });
    }

    /* ============================================================
       BAGIAN C -- HALAMAN PELANGGARAN (tabel + filter + tambah manual)
       ============================================================ */
    var _presetJenis = {};
    var _siswaSemua = [];
    var _filterStatusAktif = 'semua';

    function pastikanHalamanPelanggaran() {
        if (document.getElementById('tab-pelanggaran')) return;

        var section = document.createElement('section');
        section.id = 'tab-pelanggaran';
        section.className = 'tab-content hidden pel-halaman'; // 'tab-content' wajib: switchTab() cuma menyembunyikan elemen ber-class ini
        section.innerHTML =
            '<div class="pel-halaman-head">' +
            '  <h2>Pelanggaran &amp; Penebus</h2>' +
            '  <div class="pel-halaman-toolbar">' +
            '    <select id="pel-filter-status">' +
            '      <option value="semua">Semua Status</option>' +
            '      <option value="aktif">Aktif</option>' +
            '      <option value="menunggu_tugas">Menunggu Tugas</option>' +
            '      <option value="menunggu_acc">Menunggu ACC</option>' +
            '      <option value="selesai">Selesai</option>' +
            '      <option value="dibatalkan">Dibatalkan</option>' +
            '    </select>' +
            '    <button type="button" id="pel-btn-tambah-manual" class="pel-btn pel-btn-primer">+ Tambah Pelanggaran Manual</button>' +
            '  </div>' +
            '</div>' +
            '<table class="pel-tabel">' +
            '  <thead><tr><th>Siswa</th><th>Kelas</th><th>Jenis</th><th>Kategori</th><th>Status</th><th>Deadline</th><th></th></tr></thead>' +
            '  <tbody id="pel-tabel-body"></tbody>' +
            '</table>';

        var induk = document.querySelector('#main-scroll-container') || document.querySelector('main') || document.body;
        induk.appendChild(section);

        document.getElementById('pel-filter-status').onchange = function (ev) {
            _filterStatusAktif = ev.target.value;
            renderTabelHalamanPelanggaran();
        };
        document.getElementById('pel-btn-tambah-manual').onclick = bukaFormTambahManual;

        // Tombol menu sidebar (kalau ada #sidebar-menu, pola sama seperti
        // menu "Fitur Maintenance"/"About Us" yang sudah ada) -- kalau
        // sidebar kamu markup-nya beda, tinggal tambah tombol manual yang
        // manggil switchTab('pelanggaran').
        var sidebar = document.querySelector(SELEKTOR_SIDEBAR_MENU);
        if (sidebar && !sidebar.querySelector('[data-pel-nav]')) {
            var btnNav = document.createElement('button');
            btnNav.type = 'button';
            btnNav.id = 'btn-pelanggaran'; // pola 'btn-' + tabId, dipakai switchTab() untuk highlight aktif
            btnNav.className = 'nav-btn w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium transition-all';
            btnNav.setAttribute('data-pel-nav', '1');
            btnNav.innerHTML = '<div class="flex items-center gap-3"><i class="fa-solid fa-triangle-exclamation w-5 text-center"></i> Pelanggaran</div>';
            btnNav.onclick = function () {
                if (typeof window.switchTab === 'function') window.switchTab('pelanggaran');
                else section.classList.remove('hidden');
            };
            sidebar.appendChild(btnNav);
            // badge langsung disegarkan begitu tombol ada (tanpa nunggu poll 30 detik)
            if (window.BadgeSidebarGuru && typeof window.BadgeSidebarGuru.refresh === 'function') {
                window.BadgeSidebarGuru.refresh();
            }
        }
    }

    function renderTabelHalamanPelanggaran() {
        var tbody = document.getElementById('pel-tabel-body');
        if (!tbody) return;
        var baris = [];
        Object.keys(_dataDetailTerkini).forEach(function (username) {
            var siswaInfo = (window._daftarSiswaPelanggaran || {})[username] || {};
            (_dataDetailTerkini[username] || []).forEach(function (e) {
                if (_filterStatusAktif !== 'semua' && e.status !== _filterStatusAktif) return;
                baris.push('' +
                    '<tr>' +
                    '<td>' + esc(siswaInfo.nama || username) + '</td>' +
                    '<td>' + esc(siswaInfo.kelas || '-') + '</td>' +
                    '<td>' + esc(e.jenis) + '</td>' +
                    '<td>' + esc(e.kategori) + '</td>' +
                    '<td><span class="pel-status-pill pel-status-' + WARNA_STATUS[e.status] + '">' + LABEL_STATUS[e.status] + '</span></td>' +
                    '<td>' + esc(e.deadline_formatted || '-') + '</td>' +
                    '<td><button type="button" class="pel-btn pel-btn-lihat" data-username="' + esc(username) + '">Lihat</button></td>' +
                    '</tr>');
            });
        });
        tbody.innerHTML = baris.join('') || '<tr><td colspan="7" class="pel-kosong">Tidak ada data.</td></tr>';
        tbody.querySelectorAll('.pel-btn-lihat').forEach(function (btn) {
            btn.onclick = function () { bukaModalDetail(btn.dataset.username); };
        });
    }

    function muatDataAwalHalamanSiswa() {
        // Cache ringan {username: {nama, kelas}} dipakai tabel + judul modal.
        return fetchJSON('/api/pelanggaran/siswa-semua').then(function (json) {
            if (!json || !json.success) return;
            _siswaSemua = json.siswa || [];
            window._daftarSiswaPelanggaran = {};
            _siswaSemua.forEach(function (s) { window._daftarSiswaPelanggaran[s.username] = s; });
        });
    }

    /* ---------- FORM TAMBAH MANUAL ---------- */
    function pastikanMarkupFormTambah() {
        if (document.getElementById('modal-tambah-pelanggaran')) return;
        var wrap = document.createElement('div');
        wrap.id = 'modal-tambah-pelanggaran';
        wrap.className = 'pel-modal-overlay hidden';
        var opsiJenis = Object.keys(_presetJenis).map(function (j) {
            return '<option value="' + esc(j) + '">' + esc(j) + '</option>';
        }).join('');
        var opsiSiswa = _siswaSemua.map(function (s) {
            return '<option value="' + esc(s.username) + '">' + esc(s.nama) + ' (' + esc(s.kelas) + ')</option>';
        }).join('');
        wrap.innerHTML =
            '<div class="pel-modal-box">' +
            '  <div class="pel-modal-head">' +
            '    <h3>Tambah Pelanggaran Manual</h3>' +
            '    <button type="button" class="pel-btn-close" id="pel-form-tutup">&times;</button>' +
            '  </div>' +
            '  <div class="pel-modal-body pel-form-tambah">' +
            '    <label>Siswa</label>' +
            '    <select id="pel-f-siswa"><option value="">-- pilih siswa --</option>' + opsiSiswa + '</select>' +
            '    <label>Jenis Pelanggaran</label>' +
            '    <select id="pel-f-jenis"><option value="">-- pilih jenis --</option>' + opsiJenis + '</select>' +
            '    <label>Kategori</label>' +
            '    <input type="text" id="pel-f-kategori" readonly>' +
            '    <label>Keterangan</label>' +
            '    <textarea id="pel-f-keterangan" placeholder="Detail kejadian..."></textarea>' +
            '    <label>Instruksi Penebus <span id="pel-f-wajib-instruksi" class="pel-tanda-wajib hidden">*wajib utk kategori berat</span></label>' +
            '    <textarea id="pel-f-instruksi" placeholder="Instruksi tugas penebus..."></textarea>' +
            '    <label>Deadline (opsional)</label>' +
            '    <input type="datetime-local" id="pel-f-deadline">' +
            '    <button type="button" id="pel-f-submit" class="pel-btn pel-btn-primer">Simpan Pelanggaran</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(wrap);
        document.getElementById('pel-form-tutup').onclick = function () { wrap.classList.add('hidden'); };
        wrap.addEventListener('click', function (ev) { if (ev.target === wrap) wrap.classList.add('hidden'); });

        document.getElementById('pel-f-jenis').onchange = function (ev) {
            var preset = _presetJenis[ev.target.value];
            document.getElementById('pel-f-kategori').value = preset ? preset.kategori : '';
            document.getElementById('pel-f-instruksi').value = preset ? (preset.instruksi_penebus_default || '') : '';
            document.getElementById('pel-f-wajib-instruksi').classList.toggle('hidden', !(preset && preset.kategori === 'berat'));
        };

        document.getElementById('pel-f-submit').onclick = function () {
            var username = document.getElementById('pel-f-siswa').value;
            var jenis = document.getElementById('pel-f-jenis').value;
            var kategori = document.getElementById('pel-f-kategori').value || 'ringan';
            var keterangan = document.getElementById('pel-f-keterangan').value.trim();
            var instruksi = document.getElementById('pel-f-instruksi').value.trim();
            var deadline = document.getElementById('pel-f-deadline').value || null;

            if (!username) { alert('Pilih siswa dulu.'); return; }
            if (!jenis) { alert('Pilih jenis pelanggaran dulu.'); return; }
            if (kategori === 'berat' && !instruksi) {
                alert('Kategori berat wajib diisi instruksi penebus, tidak boleh kosong.');
                return;
            }
            var btn = document.getElementById('pel-f-submit');
            btn.disabled = true;
            postJSON('/api/pelanggaran/tambah', {
                username: username, jenis: jenis, kategori: kategori,
                keterangan: keterangan, instruksi_penebus: instruksi, deadline: deadline
            }).then(function (json) {
                btn.disabled = false;
                if (!json.success) { alert(json.message || 'Gagal menyimpan.'); return; }
                document.getElementById('modal-tambah-pelanggaran').classList.add('hidden');
                document.getElementById('pel-f-keterangan').value = '';
                document.getElementById('pel-f-instruksi').value = '';
                muatRingkasanDariServer();
            });
        };
    }

    function bukaFormTambahManual(usernameAwal) {
        pastikanMarkupFormTambah();
        if (typeof usernameAwal === 'string' && usernameAwal) {
            document.getElementById('pel-f-siswa').value = usernameAwal;
        }
        document.getElementById('modal-tambah-pelanggaran').classList.remove('hidden');
    }

    /* ============================================================
       BAGIAN D -- DAFTAR SISWA (kelas) -> DETAIL PELANGGARAN SISWA
       ------------------------------------------------------------
       Memakai modal bawaan dashboard_guru.html:
         #modal-daftar-siswa-pelanggaran  (daftar siswa 1 kelas)
         #modal-detail-pelanggaran-siswa  (detail, isi di #pel-detail-isi)
       Alur: klik card siswa -> tutup modal daftar -> buka modal detail
       -> tarik data TERBARU dari /api/pelanggaran/daftar -> render.
       Aksi (tugaskan/acc/tolak/batalkan-manual) HANYA lewat endpoint
       workflow baru; endpoint lama tidak dipakai sama sekali.
       Username guru login dibaca dari <body data-login-username>.
       ============================================================ */
    var ID_MODAL_DAFTAR = 'modal-daftar-siswa-pelanggaran';
    var ID_MODAL_DETAIL = 'modal-detail-pelanggaran-siswa';
    var URUTAN_AKTIF = ['aktif', 'menunggu_acc', 'menunggu_bk', 'menunggu_tugas'];
    var STATUS_ARSIP_UI = ['selesai', 'dibatalkan'];
    var _detailSiswaSedangDibuka = null; // username siswa yang detailnya lagi terbuka

    function usernameGuruLogin() {
        return (document.body && document.body.getAttribute('data-login-username')) || '';
    }

    function modalTerbuka(id) {
        var el = document.getElementById(id);
        return !!el && !el.classList.contains('hidden');
    }

    function normKelas(t) {
        return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function pisahDaftar(daftar) {
        var aktif = [], arsip = [];
        (daftar || []).forEach(function (e) {
            (STATUS_ARSIP_UI.indexOf(e.status) >= 0 ? arsip : aktif).push(e);
        });
        return { aktif: aktif, arsip: arsip };
    }

    // Terbaru di atas. String ISO aman dibandingkan secara leksikal.
    function bandingkanTerbaru(a, b, ambil) {
        var x = ambil(a) || '', y = ambil(b) || '';
        return x < y ? 1 : (x > y ? -1 : 0);
    }

    function urutkanAktif(list) {
        return list.slice().sort(function (a, b) {
            var pa = URUTAN_AKTIF.indexOf(a.status), pb = URUTAN_AKTIF.indexOf(b.status);
            if (pa < 0) pa = URUTAN_AKTIF.length;
            if (pb < 0) pb = URUTAN_AKTIF.length;
            if (pa !== pb) return pa - pb;
            return bandingkanTerbaru(a, b, function (e) { return e.dibuat_at; });
        });
    }

    function urutkanArsip(list) {
        return list.slice().sort(function (a, b) {
            return bandingkanTerbaru(a, b, function (e) {
                return e.diselesaikan_at || e.dibatalkan_at || e.dibuat_at;
            });
        });
    }

    function segarkanModalDaftarDanDetail() {
        if (modalTerbuka(ID_MODAL_DAFTAR)) renderDaftarSiswaPelanggaran();
        if (_detailSiswaSedangDibuka && modalTerbuka(ID_MODAL_DETAIL)) {
            var isi = document.getElementById('pel-detail-isi');
            // Jangan timpa form (instruksi/alasan tolak) yang sedang diisi guru.
            var adaFormTerbuka = isi && isi.querySelector('.pel-form-tugaskan:not(.hidden), .pel-form-tolak:not(.hidden)');
            if (!adaFormTerbuka) renderDetailSiswa(_detailSiswaSedangDibuka);
        }
    }

    /* ---------- 1. DAFTAR SISWA (card bisa diklik) ---------- */
    function htmlRingkasDaftarCard(daftar) {
        var pisah = pisahDaftar(daftar);
        if (!pisah.aktif.length && !pisah.arsip.length) {
            return '<span class="pel-daftar-aman">✅ Belum ada pelanggaran</span>';
        }
        if (!pisah.aktif.length) {
            return '<span class="pel-daftar-aman">✅ Tidak ada pelanggaran aktif</span>' +
                '<span class="pel-daftar-arsip">' + pisah.arsip.length + ' arsip</span>';
        }
        var hitung = {};
        pisah.aktif.forEach(function (e) { hitung[e.status] = (hitung[e.status] || 0) + 1; });
        return URUTAN_AKTIF.filter(function (st) { return hitung[st]; }).map(function (st) {
            return '<span class="pel-status-pill pel-status-' + WARNA_STATUS[st] + '">' +
                esc(LABEL_STATUS[st]) + ': ' + hitung[st] + '</span>';
        }).join('') + (pisah.arsip.length ? '<span class="pel-daftar-arsip">' + pisah.arsip.length + ' arsip</span>' : '');
    }

    function renderDaftarSiswaPelanggaran() {
        var list = document.getElementById('list-siswa-pelanggaran');
        if (!list) return;

        if (!_siswaSemua.length) {
            list.innerHTML = '<p class="pel-kosong">Memuat daftar siswa...</p>';
            muatDataAwalHalamanSiswa().then(function () {
                if (_siswaSemua.length) renderDaftarSiswaPelanggaran();
                else list.innerHTML = '<p class="pel-kosong">Data siswa belum bisa dimuat.</p>';
            }).catch(function () {
                list.innerHTML = '<p class="pel-kosong">Data siswa belum bisa dimuat.</p>';
            });
            return;
        }

        var elKelas = document.getElementById('modal-daftar-siswa-nama-kelas');
        var kelas = elKelas ? normKelas(elKelas.textContent) : '';
        var elCari = document.getElementById('input-cari-siswa-pelanggaran');
        var kata = elCari ? elCari.value.trim().toLowerCase() : '';

        var siswaKelas = _siswaSemua.filter(function (s) {
            if (kelas && normKelas(s.kelas) !== kelas) return false;
            if (!kata) return true;
            return String(s.nama || '').toLowerCase().indexOf(kata) >= 0 ||
                String(s.username || '').toLowerCase().indexOf(kata) >= 0;
        });

        if (!siswaKelas.length) {
            list.innerHTML = '<p class="pel-kosong">' + (kata ? 'Siswa tidak ditemukan.' : 'Belum ada siswa di kelas ini.') + '</p>';
            return;
        }

        list.innerHTML = siswaKelas.map(function (s) {
            return '<button type="button" class="pel-daftar-card" data-username="' + esc(s.username) + '">' +
                '<span class="pel-daftar-info">' +
                '<span class="pel-daftar-nama">' + esc(s.nama || s.username) + '</span>' +
                '<span class="pel-daftar-ringkas">' + htmlRingkasDaftarCard(_dataDetailTerkini[s.username]) + '</span>' +
                '</span><span class="pel-daftar-panah" aria-hidden="true">&rsaquo;</span></button>';
        }).join('');

        list.onclick = function (ev) {
            var kartu = ev.target.closest('.pel-daftar-card');
            if (kartu) bukaDetailDariDaftar(kartu.getAttribute('data-username'));
        };
    }

    /* ---------- 2. BUKA DETAIL DARI DAFTAR ---------- */
    function isiHeaderDetail(username) {
        var info = (window._daftarSiswaPelanggaran || {})[username] || {};
        var elNama = document.getElementById('detailpel-nama-siswa');
        var elKelas = document.getElementById('detailpel-kelas-siswa');
        if (elNama) elNama.textContent = info.nama || username;
        if (elKelas) elKelas.textContent = info.kelas || '';
    }

    function muatDetailTerbaru(username) {
        return fetchJSON('/api/pelanggaran/daftar?username=' + encodeURIComponent(username)).then(function (json) {
            if (!json || !json.success) throw new Error((json && json.message) || 'Gagal memuat data pelanggaran.');
            _dataDetailTerkini[username] = json.daftar || [];
            renderDetailSiswa(username);
        });
    }

    function bukaDetailDariDaftar(username) {
        if (!username) return;
        var modalDetail = document.getElementById(ID_MODAL_DETAIL);
        if (!modalDetail) return;
        var modalDaftar = document.getElementById(ID_MODAL_DAFTAR);
        if (modalDaftar) modalDaftar.classList.add('hidden');

        _detailSiswaSedangDibuka = username;
        isiHeaderDetail(username);
        modalDetail.classList.remove('hidden');

        var isi = document.getElementById('pel-detail-isi');
        var adaCache = Object.prototype.hasOwnProperty.call(_dataDetailTerkini, username);
        if (adaCache) {
            renderDetailSiswa(username); // cache dulu, langsung ditimpa data terbaru di bawah
        } else if (isi) {
            isi.innerHTML = '<p class="pel-detail-memuat">Memuat data pelanggaran...</p>';
        }

        muatDetailTerbaru(username).catch(function (err) {
            if (_detailSiswaSedangDibuka !== username || !isi || adaCache) return;
            isi.innerHTML = '<div class="pel-detail-status pel-detail-status-err">' +
                esc(err && err.message ? err.message : 'Gagal memuat data pelanggaran.') + '</div>';
        });
    }

    /* ---------- 3. RENDER DETAIL (3 skenario) ---------- */
    function htmlRingkasanDetail(aktif, jumlahArsip) {
        var hitung = {};
        aktif.forEach(function (e) { hitung[e.status] = (hitung[e.status] || 0) + 1; });
        var chips = URUTAN_AKTIF.filter(function (st) { return hitung[st]; }).map(function (st) {
            return '<span class="pel-status-pill pel-status-' + WARNA_STATUS[st] + '">' +
                esc(LABEL_STATUS[st]) + ': ' + hitung[st] + '</span>';
        }).join('');
        return '<div class="pel-detail-ringkasan">' +
            '<div class="pel-detail-ringkasan-teks"><b>' + aktif.length + '</b> pelanggaran belum selesai' +
            (jumlahArsip ? ' &middot; ' + jumlahArsip + ' di arsip' : '') + '</div>' +
            '<div class="pel-detail-ringkasan-chip">' + chips + '</div></div>';
    }

    function htmlDetailSiswa(daftar, muridInfo) {
        var pisah = pisahDaftar(daftar);
        var aktif = urutkanAktif(pisah.aktif);
        var arsip = urutkanArsip(pisah.arsip);
        var user = usernameGuruLogin();
        var namaSiswa = muridInfo && muridInfo.nama ? muridInfo.nama : '';

        // Skenario A -- tidak punya riwayat sama sekali
        if (!aktif.length && !arsip.length) {
            return '<div class="pel-detail-status pel-detail-status-ok">✅ Belum Ada Pelanggaran' +
                (namaSiswa ? '<span class="pel-detail-status-sub">' + esc(namaSiswa) + ' belum punya catatan pelanggaran.</span>' : '') +
                '</div>';
        }

        var html = '';
        if (!aktif.length) {
            // Skenario B -- hanya arsip
            html += '<div class="pel-detail-status pel-detail-status-ok">✅ Tidak ada pelanggaran aktif</div>';
        } else {
            // Skenario C -- ada yang belum selesai
            html += htmlRingkasanDetail(aktif, arsip.length);
            html += '<section class="pel-detail-seksi">' +
                '<h4 class="pel-detail-judul">Pelanggaran Aktif <span class="pel-detail-jumlah">' + aktif.length + '</span></h4>' +
                '<div class="pel-detail-list">' +
                aktif.map(function (e) {
                    return htmlEntriPelanggaran(e, !!user && e.dilaporkan_oleh === user);
                }).join('') +
                '</div></section>';
        }

        if (arsip.length) {
            html += '<section class="pel-detail-seksi">' +
                '<h4 class="pel-detail-judul">Riwayat Arsip <span class="pel-detail-jumlah">' + arsip.length + '</span></h4>' +
                '<div class="pel-detail-list">' + arsip.map(htmlEntriArsip).join('') + '</div></section>';
        }
        return html;
    }

    function htmlEntriArsip(e) {
        var tanggal = e.status === 'selesai'
            ? (e.diselesaikan_at_formatted || e.dibuat_at_formatted)
            : (e.dibatalkan_at_formatted || e.dibuat_at_formatted);
        var guruAcc = '';
        if (e.status === 'selesai') {
            if (e.ditinjau_oleh_nama) guruAcc = 'Di-ACC oleh: ' + esc(e.ditinjau_oleh_nama);
            else if (e.auto_acc) guruAcc = 'Disetujui otomatis oleh sistem';
        }
        return '<div class="pel-entri pel-entri-arsip pel-entri-' + esc(e.status) + '" data-id="' + esc(e.id) + '">' +
            '<div class="pel-entri-head">' +
            '<span class="pel-entri-jenis">' + esc(e.jenis) + '</span>' +
            '<span class="pel-status-pill pel-status-' + (WARNA_STATUS[e.status] || 'abu') + '">' + esc(LABEL_STATUS[e.status] || e.status) + '</span>' +
            '</div>' +
            (tanggal ? '<div class="pel-entri-meta">Tanggal: ' + esc(tanggal) + '</div>' : '') +
            (guruAcc ? '<div class="pel-entri-meta">' + guruAcc + '</div>' : '') +
            '<div class="pel-entri-keterangan">' + esc(e.keterangan || '-') + '</div>' +
            (e.catatan_bk ? '<div class="pel-item-catatan-bk"><b>Catatan BK:</b> ' + esc(e.catatan_bk) + '</div>' : '') +
            '</div>';
    }

    function htmlEntriPelanggaran(entri, bolehAksi) {
        var st = entri.status;
        var id = esc(entri.id);
        var h = '<div class="pel-entri pel-entri-' + esc(st) + '" data-id="' + id + '">' +
            '<div class="pel-entri-head">' +
            '<span class="pel-entri-jenis">' + esc(entri.jenis) + '</span>' +
            '<span class="pel-status-pill pel-status-' + (WARNA_STATUS[st] || 'abu') + '">' + esc(LABEL_STATUS[st] || st) + '</span>' +
            '</div>' +
            '<div class="pel-entri-meta">Kategori: <b>' + esc(entri.kategori) + '</b>' +
            (entri.dibuat_at_formatted ? ' &middot; Dicatat ' + esc(entri.dibuat_at_formatted) : '') + '</div>' +
            '<div class="pel-entri-keterangan">' + esc(entri.keterangan || '-') + '</div>' +
            (entri.instruksi_penebus ? '<div class="pel-entri-blok"><b>Instruksi penebus:</b> ' + esc(entri.instruksi_penebus) + '</div>' : '') +
            (entri.deadline_formatted ? '<div class="pel-entri-blok"><b>Deadline:</b> ' + esc(entri.deadline_formatted) + '</div>' : '') +
            htmlBukti(entri.bukti) +
            (entri.catatan_siswa ? '<div class="pel-entri-blok"><b>Catatan siswa:</b> ' + esc(entri.catatan_siswa) + '</div>' : '') +
            (entri.catatan_penolakan ? '<div class="pel-entri-blok pel-entri-blok-tolak"><b>Alasan ditolak:</b> ' + esc(entri.catatan_penolakan) + '</div>' : '') +
            (entri.catatan_bk ? '<div class="pel-item-catatan-bk"><b>Catatan BK:</b> ' + esc(entri.catatan_bk) + '</div>' : '');

        if (!bolehAksi) {
            // Nama pelapor cuma ada kalau server mengirimnya (audit); guru lain tidak dikirimi.
            return h + '<div class="pel-entri-pelapor">Dilaporkan oleh ' +
                esc(entri.dilaporkan_oleh_nama || 'guru lain') + ' &middot; hanya bisa dilihat</div></div>';
        }

        var btnBatalkan = '<button type="button" class="pel-btn pel-btn-secondary pel-aksi-batalkan" data-id="' + id + '">Batalkan</button>';
        var aksi = '', form = '';
        if (st === 'aktif') {
            aksi = '<button type="button" class="pel-btn pel-btn-primary pel-aksi-tugaskan" data-id="' + id + '">Kasih Tugas Penebus</button>' + btnBatalkan;
            form = '<div class="pel-form-tugaskan hidden" data-id="' + id + '">' +
                '<textarea class="pel-input-instruksi" placeholder="Instruksi penebus...">' + esc(entri.instruksi_penebus || '') + '</textarea>' +
                '<input type="datetime-local" class="pel-input-deadline">' +
                '<button type="button" class="pel-btn pel-btn-primary pel-aksi-kirim-tugaskan" data-id="' + id + '">Simpan &amp; Kirim ke Siswa</button>' +
                '</div>';
        } else if (st === 'menunggu_tugas') {
            aksi = btnBatalkan;
        } else if (st === 'menunggu_acc') {
            aksi = '<button type="button" class="pel-btn pel-btn-primary pel-aksi-acc" data-id="' + id + '">ACC</button>' +
                '<button type="button" class="pel-btn pel-btn-danger pel-aksi-tolak" data-id="' + id + '">Tolak</button>' + btnBatalkan;
            form = '<div class="pel-form-tolak hidden" data-id="' + id + '">' +
                '<textarea class="pel-input-catatan-tolak" placeholder="Alasan ditolak (opsional)..."></textarea>' +
                '<button type="button" class="pel-btn pel-btn-danger pel-aksi-kirim-tolak" data-id="' + id + '">Kirim Penolakan</button>' +
                '</div>';
        } else if (st === 'menunggu_bk') {
            aksi = '<span class="pel-entri-info-bk">Menunggu persetujuan BK</span>' + btnBatalkan;
        }
        return h + '<div class="pel-entri-aksi">' + aksi + '</div>' + form + '</div>';
    }

    function renderDetailSiswa(username) {
        if (_detailSiswaSedangDibuka !== username) return;
        var isi = document.getElementById('pel-detail-isi');
        if (!isi) return;
        var info = (window._daftarSiswaPelanggaran || {})[username] || { username: username, nama: username };
        var daftar = _dataDetailTerkini[username] || [];
        isi.innerHTML = htmlDetailSiswa(daftar, info);

        var user = usernameGuruLogin();
        var saya = daftar.filter(function (e) { return !!user && e.dilaporkan_oleh === user; }).length;
        var setTeks = function (idEl, nilai) { var el = document.getElementById(idEl); if (el) el.textContent = nilai; };
        setTeks('detailpel-total', daftar.length);
        setTeks('detailpel-total-saya', saya);
        setTeks('detailpel-total-lain', daftar.length - saya);

        pasangHandlerAksiDetail(username);
    }

    /* ---------- 4. AKSI (endpoint workflow baru) ---------- */
    function kirimAksiDetail(username, url, body, btn, pesanGagal) {
        btn.disabled = true;
        return postJSON(url, body).then(function (json) {
            if (!json || !json.success) {
                btn.disabled = false;
                alert((json && json.message) || pesanGagal);
                return;
            }
            // Sukses: tarik ulang data terbaru, render ulang detail, lalu segarkan badge/tabel global.
            return muatDetailTerbaru(username).catch(function () { /* poll berikutnya menyusul */ })
                .then(function () { muatRingkasanDariServer(); });
        }).catch(function () {
            btn.disabled = false;
            alert(pesanGagal + ' Periksa koneksi lalu coba lagi.');
        });
    }

    function pasangHandlerAksiDetail(username) {
        var isi = document.getElementById('pel-detail-isi');
        if (!isi) return;

        function toggleForm(kelasForm, id) {
            isi.querySelectorAll('.pel-form-tugaskan, .pel-form-tolak').forEach(function (f) {
                if (f.dataset.id === id && f.classList.contains(kelasForm)) f.classList.toggle('hidden');
                else f.classList.add('hidden');
            });
        }
        function cariForm(kelasForm, id) {
            var hasil = null;
            isi.querySelectorAll('.' + kelasForm).forEach(function (f) { if (f.dataset.id === id) hasil = f; });
            return hasil;
        }

        // Delegasi event: satu handler di container, diganti (bukan ditumpuk) tiap render.
        isi.onclick = function (ev) {
            var btn = ev.target.closest('button.pel-btn');
            if (!btn || !isi.contains(btn)) return;
            var id = btn.dataset.id;

            if (btn.classList.contains('pel-aksi-tugaskan')) {
                toggleForm('pel-form-tugaskan', id);
            } else if (btn.classList.contains('pel-aksi-kirim-tugaskan')) {
                var fTugas = cariForm('pel-form-tugaskan', id);
                if (!fTugas) return;
                var instruksi = fTugas.querySelector('.pel-input-instruksi').value.trim();
                var deadline = fTugas.querySelector('.pel-input-deadline').value || null;
                if (!instruksi) { alert('Instruksi penebus tidak boleh kosong.'); return; }
                kirimAksiDetail(username, '/api/pelanggaran/tugaskan',
                    { username: username, id: id, instruksi_penebus: instruksi, deadline: deadline },
                    btn, 'Gagal menyimpan tugas penebus.');
            } else if (btn.classList.contains('pel-aksi-acc')) {
                if (!confirm('ACC bukti tugas penebus ini? Pelanggaran akan ditandai Selesai.')) return;
                kirimAksiDetail(username, '/api/pelanggaran/acc', { username: username, id: id }, btn, 'Gagal ACC.');
            } else if (btn.classList.contains('pel-aksi-tolak')) {
                toggleForm('pel-form-tolak', id);
            } else if (btn.classList.contains('pel-aksi-kirim-tolak')) {
                var fTolak = cariForm('pel-form-tolak', id);
                if (!fTolak) return;
                var catatan = fTolak.querySelector('.pel-input-catatan-tolak').value.trim();
                kirimAksiDetail(username, '/api/pelanggaran/tolak',
                    { username: username, id: id, catatan_penolakan: catatan },
                    btn, 'Gagal menolak.');
            } else if (btn.classList.contains('pel-aksi-batalkan')) {
                if (!confirm('Batalkan pelanggaran ini? Aksi tidak bisa diurungkan.')) return;
                kirimAksiDetail(username, '/api/pelanggaran/batalkan-manual', { username: username, id: id }, btn, 'Gagal membatalkan.');
            }
        };
    }

    /* ---------- 5. KAIT KE FUNGSI GLOBAL YANG DIPANGGIL HTML / dashboard_guru.js ---------- */
    // Dipanggil lewat nama global oleh oninput="renderDaftarSiswaPelanggaran()" dan
    // bukaDaftarSiswaPelanggaran() di dashboard_guru.js -- file ini dimuat sesudahnya,
    // jadi versi di sini yang dipakai.
    window.renderDaftarSiswaPelanggaran = renderDaftarSiswaPelanggaran;
    window.bukaDetailDariDaftar = bukaDetailDariDaftar;

    var _tutupDetailAsli = window.tutupDetailPelanggaranSiswa;
    window.tutupDetailPelanggaranSiswa = function () {
        _detailSiswaSedangDibuka = null;
        if (typeof _tutupDetailAsli === 'function') return _tutupDetailAsli.apply(this, arguments);
        var m = document.getElementById(ID_MODAL_DETAIL);
        if (m) m.classList.add('hidden');
    };

    // Tombol "Kasih Pelanggaran Baru" di modal detail: endpoint lama (/set) sudah tidak ada
    // di app.py, jadi diarahkan ke form Tambah Manual (/api/pelanggaran/tambah), siswa terpilih.
    window.klikTambahPelanggaranBaru = function () {
        bukaFormTambahManual(_detailSiswaSedangDibuka);
    };

    /* ============================================================
       INISIALISASI
       ============================================================ */
    function mulai() {
        Promise.all([
            fetchJSON('/api/pelanggaran/preset-jenis').then(function (json) {
                if (json && json.success) _presetJenis = json.preset || {};
            }),
            muatDataAwalHalamanSiswa()
        ]).then(function () {
            pastikanHalamanPelanggaran();
            muatRingkasanDariServer();
            setInterval(function () { if (!document.hidden) muatRingkasanDariServer(); }, JEDA_POLL_MS);
        });
    }

    // Diekspos supaya kode render card siswa kamu sendiri bisa manggil
    // manual kalau attribute data-siswa-username belum/tidak dipasang.
    window.PelanggaranGuru = {
        pasangKartu: pasangKartu,
        bukaModalDetail: bukaModalDetail,
        bukaDetailDariDaftar: bukaDetailDariDaftar,
        renderDaftarSiswa: renderDaftarSiswaPelanggaran,
        htmlDetailSiswa: htmlDetailSiswa,
        htmlEntriPelanggaran: htmlEntriPelanggaran,
        pasangHandlerAksiDetail: pasangHandlerAksiDetail,
        refresh: muatRingkasanDariServer
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mulai);
    } else {
        mulai();
    }
})();
