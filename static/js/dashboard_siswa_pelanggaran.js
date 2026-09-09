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

           ------------------------------------------------------------
           TAMBAHAN: "Harus Ada Tombol Aksi Nyata" + "Tampil Tiap Login".
           Overlay ini sekarang:
             1) Menampilkan KETERANGAN pelanggaran yang sebenarnya (diisi
                guru saat "Kasih Pelanggaran", bukan cuma pesan generik).
             2) Punya 2 tombol aksi nyata: "Saya Mengerti" (tutup overlay,
                tugas tetap terkunci sampai guru mencabut) & "Ajukan
                Banding" (buka chat WhatsApp guru yang menandai
                pelanggaran ini, nomor & pesan sudah otomatis terisi).
             3) Overlay tampil SEKALI SETIAP SESI/LOGIN (bukan cuma sekali
                sampai diklik lalu tidak pernah lagi) selama status
                pelanggarannya masih AKTIF -- jadi siswa tetap diingatkan
                tiap kali login/refresh, dan overlay ini otomatis berhenti
                muncul begitu guru MENCABUT pelanggarannya (bukan begitu
                siswa klik tombol). Klik tombol tetap dicatat ke server
                (/api/pelanggaran/dilihat) untuk arsip guru, tapi catatan
                itu TIDAK LAGI dipakai untuk menyembunyikan overlay di
                login berikutnya.

           CATATAN MARKUP HTML YANG DIPERLUKAN (lihat overview jawaban):
           file ini butuh beberapa elemen baru di modal overlay pada
           dashboard_siswa.html yang belum tentu ada di markup lama kamu:
             - #overlay-pelanggaran-keterangan  (teks jenis pelanggaran)
             - #overlay-pelanggaran-oleh        (teks "Dicatat oleh: ...")
             - #tombol-overlay-pelanggaran-banding (tombol "Ajukan Banding")
             - #overlay-pelanggaran-hitung-mundur-banding (span countdown
               tombol banding, pola sama seperti punya tombol mengerti)
           Elemen yang belum ada di markup akan otomatis DILEWATI (script
           ini defensif, tidak error) -- tapi fitur terkait elemen itu
           (mis. tombol banding) baru akan MUNCUL & jalan setelah markupnya
           ditambahkan.
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
            // ternyata punya pelanggaran aktif yang belum pernah dia ACC
            // (klik salah satu tombol aksi), modal langsung muncul jelas di
            // awal & TETAP terbuka lagi tiap login/refresh berikutnya SAMPAI
            // dia benar-benar mengklik salah satu tombol. Begitu diklik,
            // kemunculannya "dicatat" ke server (/api/pelanggaran/dilihat).
            // Setelah tercatat, modal TIDAK akan muncul lagi selama
            // pelanggaran yang SAMA belum dicabut guru -- yang tetap jalan
            // cuma penguncian tugasnya (lihat pelanggaranSiswaSedangAktif(),
            // murni ikut 'aktif', tidak peduli sudah dicatat/di-acc atau
            // belum). Kalau guru menandai pelanggaran BARU (lihat reset
            // dilihat_at=None di /api/pelanggaran/set), siklus "tampil
            // sekali" ini mulai dari nol lagi.
            var _statusSudahDilihatCache = false; // salinan lokal dari 'sudah_dilihat' hasil poll terakhir (masih dicatat ke server utk arsip guru, tidak lagi dipakai buat gating tampil)
            var _sedangMencatatDilihat = false;   // guard biar tidak POST dobel selagi request pertama masih jalan
            var _detailPelanggaranTerakhir = null; // {keterangan, oleh, oleh_whatsapp, updated_at} dari poll terakhir

            // GANTI PERILAKU: overlay sekarang tampil SEKALI SETIAP SESI/LOGIN
            // (bukan lagi menunggu 'sudah_dilihat' dari server) selama status
            // masih aktif -- jadi siswa tetap diingatkan tiap kali dia login,
            // dan otomatis berhenti muncul begitu guru mencabut pelanggarannya.
            // Flag ini di memori JS saja (reset tiap kali halaman dimuat ulang
            // alias "login"/refresh baru), TIDAK disimpan ke localStorage/server.
            var _sudahTampilkanOverlaySesiIni = false;

            function statusPelanggaranSedangAktif() {
                return _statusPelanggaranAktifCache;
            }

            // Bagian "Dicatat" -- lapor ke server TEPAT SAAT siswa mengklik
            // salah satu tombol aksi (bukan otomatis saat overlay tampil),
            // supaya /api/pelanggaran/status berikutnya balikin
            // sudah_dilihat=true dan modal ini tidak muncul lagi berulang.
            // `aksi` ('mengerti'/'banding') ikut dikirim biar tercatat siswa
            // pilih jalur mana saat menanggapi peringatannya.
            function catatDilihatPelanggaranKeServer(aksi) {
                if (_sedangMencatatDilihat || _statusSudahDilihatCache) return;
                _sedangMencatatDilihat = true;
                _statusSudahDilihatCache = true; // optimistic, ditolak balik kalau request gagal
                fetch('/api/pelanggaran/dilihat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ aksi: aksi || null })
                })
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
                        _detailPelanggaranTerakhir = {
                            keterangan: json.keterangan || '',
                            oleh: json.oleh || '',
                            oleh_whatsapp: json.oleh_whatsapp || '',
                            updated_at: json.updated_at || ''
                        };

                        if (!_statusPelanggaranAktifCache) {
                            // Tidak/tidak lagi aktif -- tutup overlay kalau kebetulan
                            // lagi kebuka (guru baru saja mencabutnya), buka kunci
                            // tugas. Reset juga flag "sudah tampil sesi ini" supaya
                            // KALAU nanti guru kasih pelanggaran baru lagi selagi
                            // siswa masih di sesi/tab yang sama, overlay-nya tetap
                            // muncul (bukan dianggap "sudah pernah tampil sesi ini").
                            if (sebelumnyaAktif) {
                                tutupOverlayPelanggaranAktif();
                                try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) {}
                            }
                            _sudahTampilkanOverlaySesiIni = false;
                            return;
                        }

                        // Aktif -- tugas ikut terkunci otomatis lewat
                        // pelanggaranSiswaSedangAktif() di renderKartuTugas()/
                        // kirimTugasSiswa(), terlepas dari modal ditampilkan atau
                        // tidak. Modalnya sendiri tampil SEKALI PER SESI/LOGIN
                        // (bukan lagi menunggu 'sudah_dilihat' dari server) --
                        // begitu halaman ini dimuat (login/refresh) dan pelanggaran
                        // masih aktif, overlay langsung tampil sekali; setelah itu
                        // (dalam sesi yang sama) tidak dipaksa muncul ulang tiap
                        // tick poll supaya tidak mengganggu siswa yang sudah
                        // menutupnya. Login/refresh berikutnya akan memicu tampil
                        // lagi selama pelanggarannya belum dicabut guru.
                        if (!_sudahTampilkanOverlaySesiIni) {
                            _sudahTampilkanOverlaySesiIni = true;
                            tampilkanOverlayPelanggaranAktif(_detailPelanggaranTerakhir);
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

            // Diperluas supaya bisa mengunci LEBIH dari satu tombol sekaligus
            // (sekarang ada "Saya Mengerti" & "Ajukan Banding") -- keduanya
            // dikunci bareng selama LAMA_TOMBOL_TERKUNCI_DETIK supaya siswa
            // kebaca dulu pesannya sebelum bisa ambil tindakan apa pun.
            // `pasangan` = array of {tombol, elHitungMundur} -- entri dengan
            // tombol/elHitungMundur null (elemen belum ada di markup) otomatis
            // dilewati, jadi aman dipanggil walau tombol banding belum dipasang
            // di HTML.
            function mulaiHitungMundurTombol(pasangan) {
                var aktifSaja = pasangan.filter(function (p) { return p.tombol && p.elHitungMundur; });
                if (!aktifSaja.length) return;

                var sisaDetik = LAMA_TOMBOL_TERKUNCI_DETIK;
                aktifSaja.forEach(function (p) {
                    p.tombol.disabled = true;
                    p.elHitungMundur.textContent = ' (' + sisaDetik + ')';
                });
                var interval = setInterval(function () {
                    sisaDetik--;
                    aktifSaja.forEach(function (p) {
                        if (sisaDetik <= 0) {
                            p.elHitungMundur.textContent = '';
                            p.tombol.disabled = false;
                        } else {
                            p.elHitungMundur.textContent = ' (' + sisaDetik + ')';
                        }
                    });
                    if (sisaDetik <= 0) clearInterval(interval);
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

            // Bangun link wa.me dengan pesan pembuka yang sudah otomatis terisi
            // konteks pelanggarannya -- siswa tinggal klik "Kirim" di WhatsApp,
            // tidak perlu ketik ulang jelaskan pelanggaran apa dari awal.
            function buatLinkWhatsappBanding(nomorWa, keterangan) {
                var namaSiswa = (typeof USERNAME_SISWA_ASLI !== 'undefined' && USERNAME_SISWA_ASLI) || '';
                var pesan = 'Assalamualaikum, saya ' + namaSiswa +
                    ' ingin mengajukan banding terkait pelanggaran yang tercatat: "' +
                    (keterangan || '-') + '". Mohon penjelasan/kesempatan klarifikasi. Terima kasih.';
                return 'https://wa.me/' + nomorWa + '?text=' + encodeURIComponent(pesan);
            }

            function tampilkanOverlayPelanggaranAktif(detail) {
                var overlay = document.getElementById('overlay-pelanggaran-aktif');
                var elPesan = document.getElementById('overlay-pelanggaran-pesan');
                var tombolMengerti = document.getElementById('tombol-overlay-pelanggaran-mengerti');
                var elHitungMundurMengerti = document.getElementById('overlay-pelanggaran-hitung-mundur');
                if (!overlay || !elPesan || !tombolMengerti || !elHitungMundurMengerti) return;

                // Elemen TAMBAHAN (opsional) -- info pelanggaran & tombol banding.
                // Kalau belum ada di markup HTML, cukup dilewati (tidak error),
                // tapi bagian ini baru benar-benar tampil setelah markupnya
                // ditambahkan (lihat catatan di kepala file).
                var elKeterangan = document.getElementById('overlay-pelanggaran-keterangan');
                var elOleh = document.getElementById('overlay-pelanggaran-oleh');
                var tombolBanding = document.getElementById('tombol-overlay-pelanggaran-banding');
                var elHitungMundurBanding = document.getElementById('overlay-pelanggaran-hitung-mundur-banding');

                if (elKeterangan) elKeterangan.textContent = (detail && detail.keterangan) || '';
                if (elOleh) elOleh.textContent = detail && detail.oleh ? ('Dicatat oleh: ' + detail.oleh) : '';

                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('pelanggaran-aktif-blur');

                requestAnimationFrame(function () {
                    overlay.classList.add('overlay-pelanggaran--tampil');
                });

                ketikPesanOverlayPelanggaran(elPesan, PESAN_OVERLAY_PELANGGARAN);
                mulaiHitungMundurTombol([
                    { tombol: tombolMengerti, elHitungMundur: elHitungMundurMengerti },
                    { tombol: tombolBanding, elHitungMundur: elHitungMundurBanding }
                ]);

                // TOMBOL AKSI NYATA #1: "Saya Mengerti" -- tutup overlay & catat
                // acknowledge. Tugas TETAP terkunci sampai guru mencabut status
                // pelanggarannya (lihat pelanggaranSiswaSedangAktif()).
                tombolMengerti.onclick = function () {
                    if (tombolMengerti.disabled) return;
                    catatDilihatPelanggaranKeServer('mengerti');
                    tutupOverlayPelanggaranAktif();
                };

                // TOMBOL AKSI NYATA #2: "Ajukan Banding" -- buka chat WhatsApp
                // guru yang menandai pelanggaran ini (nomor & pesan pembuka
                // sudah otomatis terisi), sambil tetap mencatat acknowledge &
                // menutup overlay-nya (siswa dianggap sudah membaca & memilih
                // jalur bandingnya).
                if (tombolBanding) {
                    var nomorWa = detail && detail.oleh_whatsapp;
                    if (!nomorWa) {
                        // Guru yang menandai belum punya nomor WA tersimpan di
                        // server (lihat field 'whatsapp' di users['guru'] pada
                        // app.py) -- sembunyikan tombolnya drpd buka link rusak.
                        tombolBanding.classList.add('hidden');
                    } else {
                        tombolBanding.classList.remove('hidden');
                        tombolBanding.onclick = function () {
                            if (tombolBanding.disabled) return;
                            catatDilihatPelanggaranKeServer('banding');
                            window.open(buatLinkWhatsappBanding(nomorWa, detail && detail.keterangan), '_blank', 'noopener');
                            tutupOverlayPelanggaranAktif();
                        };
                    }
                }
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
