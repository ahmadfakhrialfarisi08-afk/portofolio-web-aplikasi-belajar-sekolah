        /* ============================================================
           FITUR TAMBAHAN — OVERLAY PERINGATAN "PELANGGARAN AKTIF"
           Script ini BERDIRI SENDIRI (IIFE terpisah) dan HANYA menambah
           fitur baru -- tidak mengubah/menghapus fungsi, variabel, atau
           logika apa pun yang sudah ada di atas. Dipasang paling akhir
           supaya ID_SISWA_AKTIF (dideklarasikan jauh di atas) sudah pasti
           ada saat script ini jalan.

           SEBELUMNYA status "aktif/tidak" pelanggaran cuma disimpan di
           localStorage browser ini sendiri -- artinya kalau guru menandai
           dari PERANGKAT LAIN (kondisi sungguhan di sekolah: guru & siswa
           pasti beda HP/laptop), status itu TIDAK PERNAH sampai ke sini
           sama sekali, reload manual pun percuma karena localStorage
           memang tidak pernah dibagi antar perangkat.
           Sekarang status diambil dari SERVER (endpoint
           /api/pelanggaran/status di app.py, lihat tabel pelanggaran_store
           di sana) lewat POLLING berkala (lihat JEDA_POLL_PELANGGARAN_MS
           di bawah) -- supaya begitu guru "Kasih Pelanggaran"/"Batalkan"
           dari perangkatnya, dalam hitungan detik overlay peringatan di
           sini otomatis muncul/hilang sendiri TANPA siswa perlu reload
           manual (jadi tidak bisa "pura-pura tidak lihat" nunggu reload).
           _statusPelanggaranAktifCache di bawah cuma salinan lokal hasil
           poll terakhir, dipakai fungsi-fungsi lain di file ini yang
           butuh cek status ini secara SINKRON (lewat
           window.pelanggaranSiswaSedangAktif(), lihat 2 pemakaiannya di
           renderKartuTugas()/kirimTugasSiswa() jauh di atas).
           ============================================================ */
        (function () {
            var PESAN_OVERLAY_PELANGGARAN = 'Opps, kamu ada pelanggaran! Segera selesaikan, jika tidak kamu tidak bisa membereskan tugas yang lain.';
            var LAMA_TOMBOL_TERKUNCI_DETIK = 5;
            var JEDA_POLL_PELANGGARAN_MS = 5000; // cek ke server tiap 5 detik

            var _statusPelanggaranAktifCache = false; // salinan lokal, diupdate tiap poll

            function statusPelanggaranSedangAktif() {
                return _statusPelanggaranAktifCache;
            }

            // Tarik status TERBARU dari server (bukan localStorage lagi -- lihat
            // catatan besar di atas). Dipanggil sekali saat dashboard dibuka,
            // lalu berulang tiap JEDA_POLL_PELANGGARAN_MS lewat setInterval di
            // bawah -- ini yang bikin perubahan dari guru "kelihatan" di sini
            // tanpa reload, walau guru & siswa beda perangkat.
            function cekStatusPelanggaranKeServer() {
                // Hemat resource: kalau tab ini sedang tidak dilihat (tab lain
                // aktif/window di-minimize), skip -- tidak ada gunanya menampilkan
                // overlay peringatan di tab yang tidak sedang dilihat siapa pun,
                // dan ini yang paling banyak menyumbang request kalau siswa lupa
                // menutup tab dashboard berjam-jam. Listener visibilitychange di
                // bawah memicu 1x cek langsung begitu tab aktif lagi, jadi tidak
                // ada delay yang terasa oleh siswa.
                if (document.hidden) return;
                fetch('/api/pelanggaran/status')
                    .then(function (res) { return res.json(); })
                    .then(function (json) {
                        if (!json || !json.success) return;
                        var sebelumnya = _statusPelanggaranAktifCache;
                        _statusPelanggaranAktifCache = !!json.aktif;
                        if (_statusPelanggaranAktifCache === sebelumnya) return; // tidak berubah, tidak perlu apa-apa

                        if (_statusPelanggaranAktifCache) {
                            // Baru saja ditandai guru -- langsung tampilkan overlay
                            // peringatan kalau belum kelihatan.
                            tampilkanOverlayPelanggaranAktif();
                        } else {
                            // Baru saja dicabut/dibatalkan guru -- tutup overlay
                            // otomatis kalau kebetulan lagi kebuka, dan buka kunci
                            // tugas yang tadinya terkunci.
                            tutupOverlayPelanggaranAktif();
                        }
                        try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) {}
                    })
                    .catch(function () {
                        // Offline/gagal sesaat -- biarkan cache lama dipakai dulu,
                        // dicoba lagi di tick poll berikutnya.
                    });
            }

            // FITUR (lock tugas): diekspos ke window supaya bisa dibaca dari
            // renderKartuTugas()/kirimTugasSiswa() yang letaknya jauh di atas
            // (deklarasi function di sini cuma lokal ke IIFE ini) -- lihat dua
            // fungsi tsb utk logika kunci tugas selama status masih aktif.
            window.pelanggaranSiswaSedangAktif = statusPelanggaranSedangAktif;

            function ketikPesanOverlayPelanggaran(elPesan, teks, selesai) {
                elPesan.innerHTML = '';
                var kursor = document.createElement('span');
                kursor.className = 'overlay-pelanggaran-kursor';
                var i = 0;
                var kecepatanMs = 22;

                function langkahBerikutnya() {
                    if (i < teks.length) {
                        elPesan.textContent = teks.slice(0, i + 1);
                        elPesan.appendChild(kursor);
                        i++;
                        setTimeout(langkahBerikutnya, kecepatanMs);
                    } else {
                        kursor.remove();
                        if (typeof selesai === 'function') selesai();
                    }
                }
                langkahBerikutnya();
            }

            function mulaiHitungMundurTombolMengerti(tombol, elHitungMundur) {
                var sisaDetik = LAMA_TOMBOL_TERKUNCI_DETIK;
                tombol.disabled = true;
                elHitungMundur.textContent = ' (' + sisaDetik + ')';
                var interval = setInterval(function () {
                    sisaDetik--;
                    if (sisaDetik <= 0) {
                        clearInterval(interval);
                        elHitungMundur.textContent = '';
                        tombol.disabled = false;
                    } else {
                        elHitungMundur.textContent = ' (' + sisaDetik + ')';
                    }
                }, 1000);
            }

            function tutupOverlayPelanggaranAktif() {
                var overlay = document.getElementById('overlay-pelanggaran-aktif');
                if (!overlay) return;
                overlay.classList.remove('overlay-pelanggaran--tampil');
                document.body.classList.remove('pelanggaran-aktif-blur');
                setTimeout(function () {
                    overlay.classList.add('hidden');
                    overlay.setAttribute('aria-hidden', 'true');
                }, 180);
                // Render ulang daftar tugas supaya kartu tugas langsung tampil
                // dalam kondisi terkunci (status pelanggaran TETAP aktif setelah
                // overlay ditutup -- cuma guru/wali kelas yang bisa membebaskannya,
                // lihat renderKartuTugas()/kirimTugasSiswa() di atas).
                try {
                    if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent();
                } catch (e) { /* abaikan kalau daftar tugas belum siap dirender */ }
            }

            function tampilkanOverlayPelanggaranAktif() {
                var overlay = document.getElementById('overlay-pelanggaran-aktif');
                var elPesan = document.getElementById('overlay-pelanggaran-pesan');
                var tombol = document.getElementById('tombol-overlay-pelanggaran-mengerti');
                var elHitungMundur = document.getElementById('overlay-pelanggaran-hitung-mundur');
                if (!overlay || !elPesan || !tombol || !elHitungMundur) return;

                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('pelanggaran-aktif-blur');

                requestAnimationFrame(function () {
                    overlay.classList.add('overlay-pelanggaran--tampil');
                });

                ketikPesanOverlayPelanggaran(elPesan, PESAN_OVERLAY_PELANGGARAN);
                mulaiHitungMundurTombolMengerti(tombol, elHitungMundur);

                tombol.onclick = function () {
                    if (tombol.disabled) return;
                    tutupOverlayPelanggaranAktif();
                };
            }

            // Poll PERTAMA sengaja ditunda dulu (biar tidak tumpang tindih sama
            // animasi transisi masuk dashboard yang butuh ~450-650ms -- lihat
            // IIFE "layar transisi masuk dashboard" tepat di atas) -- kalau
            // hasilnya aktif=true, tampilkanOverlayPelanggaranAktif() otomatis
            // dipanggil dari dalam cekStatusPelanggaranKeServer() di atas.
            // Setelah itu, polling jalan terus tiap JEDA_POLL_PELANGGARAN_MS
            // via setInterval -- inilah yang bikin "Kasih Pelanggaran"/
            // "Batalkan" dari guru (di perangkat manapun) kelihatan di sini
            // dalam hitungan detik, TANPA siswa perlu reload manual.
            function mulaiPollingStatusPelanggaran() {
                cekStatusPelanggaranKeServer();
                setInterval(cekStatusPelanggaranKeServer, JEDA_POLL_PELANGGARAN_MS);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) cekStatusPelanggaranKeServer();
                });
            }

            if (document.readyState === 'complete') {
                setTimeout(mulaiPollingStatusPelanggaran, 700);
            } else {
                window.addEventListener('load', function () {
                    setTimeout(mulaiPollingStatusPelanggaran, 700);
                });
            }
        })();
