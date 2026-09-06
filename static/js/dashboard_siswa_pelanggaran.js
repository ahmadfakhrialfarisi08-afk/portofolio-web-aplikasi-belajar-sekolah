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
            // NAIKKAN INTERVAL POLLING: sebelumnya 5000ms (tiap 5 detik). Status
            // pelanggaran tidak butuh nyaris-realtime -- 15 detik masih cukup
            // cepat supaya overlay peringatan muncul dalam hitungan detik begitu
            // guru menandai, tapi memangkas ~3x jumlah request ke server.
            var JEDA_POLL_PELANGGARAN_MS = 15000; // cek ke server tiap 15 detik

            var _statusPelanggaranAktifCache = false; // salinan lokal, diupdate tiap poll
            // PRINSIP "SEKALI TAMPIL DAN DICATAT": modal/overlay peringatan cuma
            // BOLEH tampil SEKALI per pelanggaran -- begitu siswa login dan
            // ternyata punya pelanggaran aktif yang belum pernah dia lihat sama
            // sekali, modal langsung muncul jelas di awal, LALU kemunculannya
            // dicatat ke server (/api/pelanggaran/dilihat). Selama pelanggaran
            // yang SAMA belum dicabut guru, modal TIDAK akan muncul lagi tiap
            // siswa login/refresh ulang -- yang tetap jalan cuma penguncian
            // tugasnya (lihat pelanggaranSiswaSedangAktif(), murni ikut 'aktif',
            // tidak peduli sudah dicatat/dilihat atau belum). Kalau guru
            // menandai pelanggaran BARU (lihat reset dilihat_at=None di
            // /api/pelanggaran/set), siklus "tampil sekali" ini mulai dari nol
            // lagi -- modal akan muncul sekali lagi utk pelanggaran barunya.
            var _statusSudahDilihatCache = false; // salinan lokal dari 'sudah_dilihat' hasil poll terakhir
            var _sedangMencatatDilihat = false;   // guard biar tidak POST dobel selagi request pertama masih jalan

            function statusPelanggaranSedangAktif() {
                return _statusPelanggaranAktifCache;
            }

            // Bagian "Dicatat" -- lapor ke server begitu modal ditampilkan,
            // supaya /api/pelanggaran/status berikutnya balikin sudah_dilihat=true
            // dan modal ini tidak muncul lagi berulang. Update cache lokal
            // SEBELUM request selesai (optimistic) supaya poll berikutnya yang
            // kebetulan nembak sebelum response ini balik tidak ikut memicu
            // modal tampil dobel.
            function catatDilihatPelanggaranKeServer() {
                if (_sedangMencatatDilihat || _statusSudahDilihatCache) return;
                _sedangMencatatDilihat = true;
                _statusSudahDilihatCache = true;
                fetch('/api/pelanggaran/dilihat', { method: 'POST' })
                    .catch(function () {
                        // Gagal (mis. offline sesaat) -- biarkan saja, longgar:
                        // paling modal berpotensi muncul lagi di poll berikutnya
                        // kalau ternyata server belum sempat mencatatnya. Lebih
                        // aman siswa lihat peringatan 1x lebih banyak drpd tidak
                        // pernah tercatat sama sekali.
                        _statusSudahDilihatCache = false;
                    })
                    .finally(function () { _sedangMencatatDilihat = false; });
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
                        var sebelumnyaAktif = _statusPelanggaranAktifCache;
                        _statusPelanggaranAktifCache = !!json.aktif;
                        _statusSudahDilihatCache = !!json.sudah_dilihat;

                        if (!_statusPelanggaranAktifCache) {
                            // Tidak/tidak lagi aktif -- tutup overlay kalau kebetulan
                            // lagi kebuka (guru baru saja mencabutnya), buka kunci
                            // tugas. Tidak ada apa pun yang perlu "dicatat" di sini.
                            if (sebelumnyaAktif) {
                                tutupOverlayPelanggaranAktif();
                                try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) {}
                            }
                            return;
                        }

                        // Aktif -- tugas ikut terkunci otomatis lewat
                        // pelanggaranSiswaSedangAktif() di renderKartuTugas()/
                        // kirimTugasSiswa(), terlepas dari modal ditampilkan atau
                        // tidak. Modalnya sendiri CUMA muncul kalau server bilang
                        // belum pernah dicatat terlihat (prinsip "Sekali Tampil").
                        if (!_statusSudahDilihatCache) {
                            tampilkanOverlayPelanggaranAktif();
                            catatDilihatPelanggaranKeServer();
                        }
                        if (!sebelumnyaAktif) {
                            try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) {}
                        }
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
