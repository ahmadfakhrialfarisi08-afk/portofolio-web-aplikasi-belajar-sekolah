        let selectedKelasBeriTugas = '';
        let editingTaskId = null; // null = lagi bikin tugas baru, terisi = lagi edit tugas dgn id ini
        let jenisKontenAktif = 'tugas';
        let mediaRecorder;
        let audioChunks = [];
        let audioBlob = null;
        let audioMimeType = 'audio/webm';
        let audioDataUrl = null; // hasil rekaman dalam bentuk base64, biar gak hilang & bisa disimpan
        let isRecording = false;
        let teacherImageBase64 = null;

        // ===== Penyimpanan Tugas Multi (Banyak Tugas per Kelas) =====
        // Setiap kelas punya ARRAY tugas (bukan 1 objek tunggal), jadi kalau guru
        // kirim tugas baru ke kelas yang sama, tugas lama TIDAK ketimpa/ke-replace.
        // ===== Helper sinkron ke server (menggantikan localStorage-only) =====
        // getSync() sengaja pakai XMLHttpRequest SYNCHRONOUS (bukan fetch async)
        // supaya getTasksKelas() tetap bisa dipanggil langsung dan return array
        // seketika seperti localStorage dulu, tanpa perlu ubah SEMUA pemanggilnya
        // jadi async/await. Kalau server lagi tidak bisa dihubungi (mis. offline),
        // otomatis fallback ke localStorage biar dashboard tidak nge-blank.
        function getSync(kunci, fallback) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', `/api/sync/${encodeURIComponent(kunci)}`, false);
                xhr.send(null);
                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText);
                    if (res.ok) return (res.data === null || res.data === undefined) ? fallback : res.data;
                }
            } catch (e) {
                console.warn('Gagal ambil data dari server, pakai cadangan lokal:', kunci, e);
            }
            const raw = localStorage.getItem(kunci);
            return raw ? JSON.parse(raw) : fallback;
        }
        function setSync(kunci, data) {
            // Tetap simpan salinan di localStorage sebagai cadangan offline,
            // tapi sumber utama sekarang di server (data/sync_store.json).
            localStorage.setItem(kunci, JSON.stringify(data));
            fetch(`/api/sync/${encodeURIComponent(kunci)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            }).catch(e => console.warn('Gagal simpan data ke server:', kunci, e));
        }

        // ===== PERBAIKAN TRAFFIC: cache tugas SEMUA kelas, diisi 1x lewat
        // /api/sync/bulk =====
        // Dulu getTasksKelas() manggil getSync() (1 request KE SERVER per
        // kelas) SETIAP KALI dipanggil -- dan dipanggil di dalam forEach yang
        // loop ke SEMUA 21 kelas, di banyak fungsi render berbeda (beranda,
        // daftar kelas, rekap semua tugas, dst). Efeknya: 1x render bisa
        // memicu puluhan request sinkron (blocking) ke server, dan render
        // itu sendiri terpicu berkali-kali (tiap load halaman, tiap ganti
        // filter, tiap buka tab rekap) -- ini sumber traffic paling besar.
        //
        // Perbaikannya BUKAN mengubah data/skema, cuma mengubah CARA
        // AMBILNYA: sekarang semua kelas diambil SEKALIGUS dalam 1 request
        // (lihat muatCacheTugasSemuaKelas()), disimpan di cache memori ini,
        // dan getTasksKelas() baca dari cache tsb -- tanpa request baru.
        // Cache di-refresh otomatis tiap kali guru menyimpan/mengubah tugas
        // (lihat saveTasksKelas()), jadi datanya tetap selalu up to date.
        let _cacheTugasSemuaKelas = null; // null = belum pernah dimuat sama sekali

        function _kunciTugasKelas(namaKelas) {
            return `tasks_${namaKelas.replace(/\s+/g, '_')}`;
        }

        async function muatCacheTugasSemuaKelas() {
            const semuaKunci = daftarSeluruhKelasDummy.map(k => _kunciTugasKelas(k.nama));
            try {
                const res = await fetch(`/api/sync/bulk?kunci=${encodeURIComponent(semuaKunci.join(','))}`);
                const json = await res.json();
                if (json.ok) {
                    const cacheBaru = {};
                    daftarSeluruhKelasDummy.forEach(k => {
                        const kunci = _kunciTugasKelas(k.nama);
                        cacheBaru[k.nama] = json.data[kunci] || [];
                    });
                    _cacheTugasSemuaKelas = cacheBaru;
                    return;
                }
            } catch (e) {
                console.warn('Gagal muat cache tugas semua kelas dari server, pakai cadangan lokal:', e);
            }
            // Fallback offline: bangun cache dari localStorage kalau server
            // tidak bisa dihubungi, biar dashboard tidak nge-blank.
            const cacheFallback = {};
            daftarSeluruhKelasDummy.forEach(k => {
                const raw = localStorage.getItem(_kunciTugasKelas(k.nama));
                cacheFallback[k.nama] = raw ? JSON.parse(raw) : [];
            });
            _cacheTugasSemuaKelas = cacheFallback;
        }

        function getTasksKelas(namaKelas) {
            // Cache belum pernah dimuat (mis. ada interaksi super cepat
            // sebelum muatCacheTugasSemuaKelas() di DOMContentLoaded selesai)
            // -- fallback baca localStorage SAJA, TANPA bikin request baru
            // ke server, supaya tidak balik lagi ke pola lama yang boros.
            //
            // PERBAIKAN PERFORMA (PENTING): sebelum ini, baris di bawah malah
            // manggil getSync() -- yang di dalamnya pakai XMLHttpRequest
            // SYNCHRONOUS (xhr.open(..., false)). XHR sinkron itu MEMBEKUKAN
            // SELURUH TAB (bukan cuma fungsi ini) sampai server selesai
            // membalas -- scroll, klik, bahkan animasi CSS ikut berhenti.
            // Fungsi ini dipanggil tiap 5 detik lewat
            // setInterval(cekBelJamMengajarOtomatis, 5000) untuk SETIAP kelas
            // yang jadwalnya lagi "ONGOING" -- jadi kalau pas dipanggil
            // _cacheTugasSemuaKelas belum sempat selesai dimuat (async, baru
            // beres beberapa saat setelah halaman dibuka) DAN server lagi
            // agak lambat balas (mis. PythonAnywhere free tier), tab bisa
            // beku berkali-kali, berulang tiap 5 detik -- inilah sumber
            // "berat"/macet yang kerasa walau modal Rekap cuma isi 7 murid.
            // Sekarang cuma baca localStorage (instan, tanpa network sama
            // sekali) selama cache belum siap; begitu
            // muatCacheTugasSemuaKelas() selesai di background, pemanggilan
            // berikutnya otomatis dapat data fresh dari cache memori.
            if (_cacheTugasSemuaKelas === null) {
                const raw = localStorage.getItem(_kunciTugasKelas(namaKelas));
                return raw ? JSON.parse(raw) : [];
            }
            return _cacheTugasSemuaKelas[namaKelas] || [];
        }
        function saveTasksKelas(namaKelas, tasks) {
            const key = _kunciTugasKelas(namaKelas);
            setSync(key, tasks);
            // Perbarui cache di memori langsung (optimistic update) supaya
            // pemanggilan getTasksKelas() berikutnya di sesi ini langsung
            // dapat data terbaru tanpa perlu fetch ulang ke server.
            if (_cacheTugasSemuaKelas !== null) {
                _cacheTugasSemuaKelas[namaKelas] = tasks;
            }
        }
        function buatIDTugasBaru() {
            return 'tgs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        }
        // Nama guru pengampu suatu kelas diambil dari data "wali" kelas tsb,
        // dipakai supaya kartu tugas di Dashboard Siswa & notifikasi tugas ditarik
        // menampilkan nama guru yang benar (bukan cuma "Guru Mata Pelajaran").
        function cariNamaGuruKelas(namaKelas) {
            const k = daftarSeluruhKelasDummy.find(x => x.nama === namaKelas);
            return (k && k.wali) ? k.wali : 'Guru Mata Pelajaran';
        }

        // PERBAIKAN BUG: sebelumnya tugas/catatan BARU yang dikirim guru selalu
        // dicatat atas nama "wali" statis kelas tsb (lihat cariNamaGuruKelas di
        // atas) -- padahal wali kelas ITU BUKAN berarti dialah yang login &
        // menekan tombol kirim. Akibatnya kalau guru LAIN (mis. Pak Joel) yang
        // login dan mengirim tugas ke kelas XII TKJ 3 (wali: Ahmad, S.T), tugas
        // itu tetap tercatat & tampil sebagai "Ahmad, S.T" -- bukan "Pak Joel"
        // yang sebenarnya mengirim. Sekarang nama guru diambil dari akun yang
        // BENAR-BENAR sedang login (dikirim server lewat data-nama-guru-login
        // di <body>, sama seperti pola data-login-username), baru fallback ke
        // wali kelas kalau karena suatu hal data login itu kosong.
        const NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA = document.body.dataset.namaGuruLogin || '';
        function namaGuruYangSedangLogin(namaKelasFallback) {
            return NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || cariNamaGuruKelas(namaKelasFallback);
        }

        // PERMINTAAN: guru A tidak boleh utak-atik (edit/hapus/atur waktu) tugas
        // yang dibuat guru B, begitu juga sebaliknya -- siapa pun cuma boleh
        // ngutak-ngatik tugas buatannya sendiri. Guru lain tetap BOLEH lihat
        // tugas itu, tapi cuma lewat "Denah Kelas" (bukaDetailKelas -> render di
        // list-tugas-aktif-kelas, sudah read-only dari awal, tanpa tombol aksi).
        // Dipakai dua tempat: (1) nyaring tombol edit/hapus di kartu ringkas
        // Beranda supaya tidak nongol buat tugas guru lain, (2) jaga-jaga di
        // dalam bukaModalEditTugas() & hapusTugasByID() sendiri, andai suatu
        // saat ada tombol lain yang manggil fungsi itu tanpa lewat filter kartu.
        function tugasIniMilikGuruLogin(data) {
            if (!data) return false;
            const namaGuruLogin = NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA.trim().toLowerCase();
            if (!namaGuruLogin) return false;
            // Tugas lama (dibuat sebelum perbaikan atribusi namaGuru) mungkin
            // belum punya field namaGuru sama sekali -- supaya tugas lama itu
            // tidak "terkunci" tak bisa diapa-apakan siapa pun, anggap
            // pemiliknya wali kelas tsb (perilaku lama, sebelum ada Pak Joel
            // dkk. yang bisa kirim tugas ke kelas orang lain).
            const namaGuruTugas = (data.namaGuru || cariNamaGuruKelas(data.kelas)).trim().toLowerCase();
            return namaGuruTugas === namaGuruLogin;
        }

        const daftarSeluruhKelasDummy = [
            { nama: 'X TKJ 1', jurusan: 'TKJ', tingkat: 'X', mapel: 'Dasar-Dasar TKI', wali: 'Hendra, S.Kom', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TKJ 2', jurusan: 'TKJ', tingkat: 'X', mapel: 'Dasar-Dasar TKI', wali: 'Siti, S.T', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TKJ 3', jurusan: 'TKJ', tingkat: 'X', mapel: 'Dasar-Dasar TKI', wali: 'Rudi, S.Kom', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TKR 1', jurusan: 'TKR', tingkat: 'X', mapel: 'Gambar Teknik Otomotif', wali: 'Joko, S.Pd', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TKR 2', jurusan: 'TKR', tingkat: 'X', mapel: 'Gambar Teknik Otomotif', wali: 'Agus, S.T', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TAV 1', jurusan: 'TAV', tingkat: 'X', mapel: 'Dasar Listrik & Elektronika', wali: 'Dedi, S.T', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' },
            { nama: 'X TAV 2', jurusan: 'TAV', tingkat: 'X', mapel: 'Dasar Listrik & Elektronika', wali: 'Eko, S.Pd', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' },

            { nama: 'XI TKJ 1', jurusan: 'TKJ', tingkat: 'XI', mapel: 'Teknologi WAN', wali: 'Fitri, S.Kom', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TKJ 2', jurusan: 'TKJ', tingkat: 'XI', mapel: 'Teknologi WAN', wali: 'Bayu, S.T', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TKJ 3', jurusan: 'TKJ', tingkat: 'XI', mapel: 'Teknologi WAN', wali: 'Yudi, S.Kom', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TKR 1', jurusan: 'TKR', tingkat: 'XI', mapel: 'Pemeliharaan Sasis Kendaraan', wali: 'Bambang, S.Pd', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TKR 2', jurusan: 'TKR', tingkat: 'XI', mapel: 'Pemeliharaan Sasis Kendaraan', wali: 'Yanto, S.T', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TAV 1', jurusan: 'TAV', tingkat: 'XI', mapel: 'Mikroprosesor & Mikrokontroler', wali: 'Suryana, S.T', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XI TAV 2', jurusan: 'TAV', tingkat: 'XI', mapel: 'Mikroprosesor & Mikrokontroler', wali: 'Tukiman, S.Pd', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' },

            { nama: 'XII TKJ 1', jurusan: 'TKJ', tingkat: 'XII', mapel: 'Administrasi Server', wali: 'Dian, S.Kom', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TKJ 2', jurusan: 'TKJ', tingkat: 'XII', mapel: 'Administrasi Server', wali: 'Oky, S.T', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TKJ 3', jurusan: 'TKJ', tingkat: 'XII', mapel: 'Administrasi Infrastruktur Jaringan', wali: 'Ahmad, S.T', img: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TKR 1', jurusan: 'TKR', tingkat: 'XII', mapel: 'Pemeliharaan Mesin Kendaraan Ringan', wali: 'Dadan, S.Pd', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TKR 2', jurusan: 'TKR', tingkat: 'XII', mapel: 'Pemeliharaan Kelistrikan Kendaraan', wali: 'Toto, S.T', img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TAV 1', jurusan: 'TAV', tingkat: 'XII', mapel: 'Audio Video Sistem', wali: 'Yana, S.T', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' },
            { nama: 'XII TAV 2', jurusan: 'TAV', tingkat: 'XII', mapel: 'Audio Video Sistem', wali: 'Heri, S.Pd', img: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&q=80&w=800' }
        ];

        // Roster kelas XII TKJ 3/TAV SEKARANG disinkronkan dari akun siswa ASLI yang
        // terdaftar di backend (lihat users{} di app.py: siswa/syam/waldi/fadzri),
        // bukan di-generate acak lagi. Urutan array ini sengaja disamakan sama urutan
        // SISWA_KELAS_INI supaya gampang di-mapping saat sinkron border dari server.
        const SISWA_KELAS_INI = [
            { id: 1, username: 'siswa', nama: 'AHMAD FAKHRI AL FARISI' },
            { id: 2, username: 'syam', nama: 'SYAM KHOERATUL MUKMIN' },
            { id: 3, username: 'waldi', nama: 'WALDI WAHIDIN' },
            { id: 4, username: 'fadzri', nama: 'MUHAMMAD FADZRI' },
            { id: 5, username: 'setiawan', nama: 'SETIAWAN SAPUTRA' },
            { id: 6, username: 'jibril', nama: 'MUHAMMAD JIBRIL AL MANAFI' },
            { id: 7, username: 'afrizal', nama: 'AFRIZAL MUSTAQIM' }
        ];

        const sampleMurid30 = SISWA_KELAS_INI.map((s, index) => {
            const avatars = [
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120",
                "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=120"
            ];
            return {
                id: s.id,
                username: s.username,
                meja: s.id,
                nama: s.nama,
                kelas: "XII TKJ 3",
                foto: avatars[index % avatars.length],
                // Default sebelum sinkron border dari server selesai (lihat
                // sinkronBorderRosterDariServer() di bawah) -- polos dulu, ringan.
                border: 'Border Polos',
                title: 'Siswa',
                efek: '',
                sudahMengumpulkan: s.id === 1,
                waktuKirim: s.id === 1 ? "08:30 WIB" : null,
                nilai: s.id === 1 ? "92" : null,
                fotoTugas: s.id === 1 ? "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=800" : null
            };
        });

        // Foto siswa ID #1 (akun DEV yang lagi dipakai login) tetap disinkron dari
        // localStorage foto profil miliknya sendiri, sama seperti sebelumnya --
        // satu-satunya foto yang memang bisa diakses langsung dari browser guru ini.
        // Fungsi ini juga dipakai ulang di bukaIDCardSiswa() buat tarik foto terbaru.
        function getProfilSiswaAktif() {
            const defaultAvatar = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120";
            return { foto: localStorage.getItem('student_profile_photo') || defaultAvatar };
        }
        (function sinkronkanFotoSiswaId1() {
            const siswa1 = sampleMurid30.find(s => s.id === 1);
            if (siswa1) siswa1.foto = getProfilSiswaAktif().foto;
        })();

        // Terjemahkan id border ASLI (dari DAFTAR_BORDER_* di Dashboard Siswa, mis.
        // 'admin_dev', 'quiz_medium_emas', 'prestasi_pink') ke representasi ringan
        // yang dipakai Dashboard Guru ini. SENGAJA TIDAK dikasih animasi
        // shimmer/glow kayak di Dashboard Siswa (kecuali akun DEV yang memang sudah
        // ada dari awal) -- Denah Kelas bisa nampilin banyak siswa sekaligus, jadi
        // dijaga tetap ringan/statis biar gak berat di HP atau laptop kentang.
        function mapBorderIdKeTampilanGuru(borderId) {
            const id = borderId || 'starter_pemula';
            if (id === 'admin_dev') return { border: 'border_emas', efek: 'gold-name', title: 'DEV' };
            if (id.includes('pink') || id.includes('permata')) return { border: 'Border Cyberpunk', efek: '', title: 'Legenda' };
            if (id.includes('emas') || id.includes('gold')) return { border: 'Border Emas Klasik', efek: '', title: 'Master Quiz' };
            if (id.includes('perak') || id.includes('silver')) return { border: 'Border Neon Biru', efek: '', title: 'Pelajar Rajin' };
            if (id.includes('perunggu') || id.includes('bronze')) return { border: 'Border Gradasi Api', efek: '', title: 'Berprestasi' };
            return { border: 'Border Polos', efek: '', title: 'Siswa' };
        }

        // Ambil border yang BENERAN sedang dipakai tiap siswa dari server (lihat
        // /api/kelas/roster & /api/profil/border di app.py) lalu terapkan ke
        // sampleMurid30. Kalau Denah Kelas XII TKJ 3 kebetulan lagi kebuka pas
        // data ini datang, render ulang biar avatarnya langsung ke-update.
        async function sinkronBorderRosterDariServer() {
            try {
                const res = await fetch(`/api/kelas/roster?kelas=${encodeURIComponent('XII TKJ 3/TAV')}`);
                const json = await res.json();
                if (!json.success) return;
                json.siswa.forEach(u => {
                    const m = sampleMurid30.find(s => s.username === u.username);
                    if (!m) return;
                    const tampilan = mapBorderIdKeTampilanGuru(u.border);
                    m.border = tampilan.border;
                    m.efek = tampilan.efek;
                    m.title = tampilan.title;
                    // Foto profil ASLI tiap siswa (dari server, lewat /api/profil/foto
                    // yang mereka simpan sendiri) -- kalau siswa belum pernah upload
                    // foto (null), biarkan avatar dummy default yang sudah ke-assign
                    // di sampleMurid30 tetap dipakai, jangan ditimpa jadi kosong.
                    if (u.foto) m.foto = u.foto;
                });
                if (typeof kelasAktifDipilih !== 'undefined' && kelasAktifDipilih === 'XII TKJ 3' && typeof bukaanganUlangDetailKelas === 'function') {
                    bukaanganUlangDetailKelas();
                }
                // Kalau jendela "Rekap Pengumpulan per Tugas" kebetulan lagi kebuka
                // buat kelas XII TKJ 3 pas data terbaru ini datang, render ulang juga
                // -- biar foto/border/efek/title-nya ikut ke-update tanpa guru perlu
                // tutup-buka ulang jendelanya.
                if (typeof taskAktifDipilihUntukRekap !== 'undefined' && taskAktifDipilihUntukRekap && taskAktifDipilihUntukRekap.namaKelas === 'XII TKJ 3') {
                    bukaRekapPengumpulanTugas(taskAktifDipilihUntukRekap.namaKelas, taskAktifDipilihUntukRekap.taskId, true);
                }
            } catch (e) {
                console.error('Gagal sinkron border roster kelas:', e);
            }
        }
        sinkronBorderRosterDariServer();

        const jadwalMengajar = [
            { jam: "07:00 - 08:30", start: "07:00", end: "08:30", kelas: "XII TKJ 3", mapel: "Administrasi Infrastruktur Jaringan" },
            { jam: "08:30 - 10:00", start: "08:30", end: "10:00", kelas: "XI TKJ 1", mapel: "Teknologi WAN" },
            { jam: "10:15 - 11:45", start: "10:15", end: "11:45", kelas: "X TKJ 2", mapel: "Dasar-Dasar TKI" },
            { jam: "12:30 - 14:00", start: "12:30", end: "14:00", kelas: "XII TAV 1", mapel: "Audio Video Sistem" }
        ];

        /* ================= SIDEBAR MOBILE (hamburger) ================= */
        function toggleSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            if (!sidebar || !overlay) return;
            sidebar.classList.toggle('-translate-x-full');
            overlay.classList.toggle('hidden');
        }

        function closeSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            if (!sidebar || !overlay) return;
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        }

        // Kalau layar di-resize jadi ukuran desktop, pastikan overlay & state mobile ke-reset
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) {
                document.getElementById('sidebar-overlay')?.classList.add('hidden');
            }
        });

        let activeTab = 'beranda';
        function switchTab(tabId) {
            closeSidebarMobile(); // otomatis tutup sidebar mobile setelah pilih menu
            activeTab = tabId;
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById(`tab-${tabId}`).classList.remove('hidden');
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.className = "nav-btn w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium transition-all";
            });
            const activeBtn = document.getElementById(`btn-${tabId}`);
            if(activeBtn) {
                activeBtn.className = "nav-btn w-full flex items-center justify-between px-4 py-3 rounded-xl bg-blue-50 text-blue-600 font-semibold transition-all";
            }
            if (tabId === 'rekap-tugas') renderRekapSemuaTugas();
            if (tabId === 'absensi') renderAbsensiSiswa();
            if (tabId === 'nilai') renderPenilaianTugas();
            if (tabId === 'prestasi') renderKonfirmasiPrestasi();
            if (tabId === 'evaluasi') renderEvaluasiGuru();
            const mainContainer = document.getElementById('main-scroll-container');
            if(mainContainer) mainContainer.scrollTop = 0;
        }

        function updateHeaderClock() {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const jamText = `${hours}:${minutes}:${seconds} WIB`;
            const clockEl = document.getElementById('header-realtime-clock');
            if (clockEl) clockEl.innerText = jamText;

            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const dateStr = now.toLocaleDateString('id-ID', options);
            const dateEl = document.getElementById('header-realtime-date');
            if (dateEl) dateEl.innerText = dateStr;

            // Duplikat ke bar jam khusus tampilan HP (di bawah header)
            const clockElMobile = document.getElementById('header-realtime-clock-mobile');
            if (clockElMobile) clockElMobile.innerText = jamText;
            const dateElMobile = document.getElementById('header-realtime-date-mobile');
            if (dateElMobile) dateElMobile.innerText = dateStr;
        }

        function renderBerandaKelasBerurutan() {
            renderContainerKelasTingkat('X', 'container-beranda-X');
            renderContainerKelasTingkat('XI', 'container-beranda-XI');
            renderContainerKelasTingkat('XII', 'container-beranda-XII');
        }

        // Jumlah kartu kelas yang langsung tampil di Beranda sebelum guru perlu
        // menekan "Tampilkan N Kelas Lainnya" -- biar di HP nggak numpuk banyak
        // kartu di atas "Jadwal Mengajar Hari Ini".
        const BATAS_AWAL_KARTU_KELAS_BERANDA = 4;

        // Dipakai bareng oleh renderContainerKelasTingkat() & filterBerandaCepatByJurusan()
        // supaya markup kartu kelas di Beranda selalu konsisten satu sumber.
        function buildKartuKelasBerandaHTML(k) {
            const tasksKelasIni = getTasksKelas(k.nama);
            let badgeJurusanColor = "bg-blue-50 text-blue-600";
            if (k.jurusan === 'TKR') badgeJurusanColor = "bg-orange-50 text-orange-600";
            if (k.jurusan === 'TAV') badgeJurusanColor = "bg-purple-50 text-purple-600";

            // Tugas yang sudah lewat deadline dianggap usai -- sama seperti pola
            // yang sudah dipakai di renderSeluruhKelas() -- supaya kartu di
            // Beranda ini tidak terus menampilkan tugas basi yang tenggatnya
            // sudah lama lewat. Tugas ini TIDAK dihapus dari data (masih bisa
            // dilihat lewat "Atur Tugas"/rekap) -- cuma disembunyikan dari sini.
            // Begitu guru mengatur ulang deadline-nya jadi ke depan lagi lewat
            // bukaModalEditTugas() -> kirimTugasKeKelas(), fungsi ini otomatis
            // dipanggil ulang dan tugasnya muncul lagi di kartu Beranda.
            const cekWaktuKelasIni = new Date().getTime();
            const tugasAktifKelasIni = tasksKelasIni.filter(t => !t.deadlineTimestamp || cekWaktuKelasIni < t.deadlineTimestamp || t.studentSubmitted);

            let activeTaskHTML = "";
            if (tugasAktifKelasIni.length > 0) {
                // PERMINTAAN: kartu ringkas di Beranda ini TIDAK BOLEH jadi
                // tempat guru A ngutak-ngatik (atur waktu/hapus) tugas buatan
                // guru B. Jadi tugas dipilah dua: milik guru yang sedang login
                // (tampil lengkap + tombol aksi, seperti sebelumnya), dan milik
                // guru lain (cuma ditandai ringkas "ada tugas dari guru lain",
                // TANPA judul/isi/tombol apa pun -- guru harus buka "Denah
                // Kelas" kalau mau lihat detailnya, dan di sana pun read-only).
                const tugasMilikSendiri = tugasAktifKelasIni.filter(t => tugasIniMilikGuruLogin(t));
                const jumlahTugasGuruLain = tugasAktifKelasIni.length - tugasMilikSendiri.length;

                activeTaskHTML = tugasMilikSendiri.map(data => `
                    <div class="mt-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between" onclick="event.stopPropagation()">
                        <div class="text-xs">
                            <span class="font-bold text-blue-700 block">${data.judul || data.tipe || '📌 Tugas'}</span>
                            <span class="text-[10px] text-slate-500 block">${data.teks ? data.teks.substring(0, 20) + '...' : 'Instruksi Suara'}</span>
                            <span class="text-[9px] font-bold text-amber-600 block mt-0.5">Tenggat: ${data.deadline || '-'}</span>
                        </div>
                        <div class="flex items-center gap-1">
                            <button onclick="bukaModalEditTugas('${k.nama}', '${data.id}'); event.stopPropagation();" class="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold transition-all shadow" title="Atur/Ubah Waktu">
                                <i class="fa-solid fa-clock"></i>
                            </button>
                            <button onclick="hapusTugasByID('${k.nama}', '${data.id}'); event.stopPropagation();" class="px-2 py-1 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-[10px] font-bold transition-all shadow" title="Hapus Tugas">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                `).join('');

                if (jumlahTugasGuruLain > 0) {
                    activeTaskHTML += `
                        <div class="mt-2 p-2.5 bg-slate-50 border border-dashed border-slate-300 rounded-xl flex items-center gap-2 text-[10px] text-slate-500 italic">
                            <i class="fa-solid fa-lock text-slate-400"></i>
                            ${jumlahTugasGuruLain} tugas dari guru lain -- klik kartu ini untuk lihat lewat Denah Kelas
                        </div>
                    `;
                }
            }

            return `
                <div onclick="bukaDetailKelas('${k.nama}', '${k.jurusan}', '${k.mapel}', '${k.jurusan}', '${k.img}')" class="kartu-kelas-beranda bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between space-y-3 group">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="px-2.5 py-1 font-extrabold text-[11px] rounded-lg ${badgeJurusanColor}">${k.jurusan}</span>
                            <span class="text-xs text-slate-400 font-medium">30 Siswa</span>
                        </div>
                        <h4 class="font-extrabold text-slate-900 text-base group-hover:text-blue-600 transition-colors">${k.nama}</h4>
                        <p class="text-xs text-slate-500 mt-0.5">${k.mapel}</p>
                        ${activeTaskHTML}
                    </div>
                    <div class="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                        <span class="text-slate-400">Wali: <b class="text-slate-700">${k.wali}</b></span>
                        <button onclick="bukaModalBeriTugas('${k.nama}'); event.stopPropagation();" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full text-xs transition-all shadow-sm">
                            <i class="fa-solid fa-plus mr-1"></i> Beri Tugas
                        </button>
                    </div>
                </div>
            `;
        }

        // Render daftar kartu kelas ke containerId, dengan BATAS_AWAL_KARTU_KELAS_BERANDA
        // kartu pertama langsung tampil dan sisanya disembunyikan dulu di balik tombol
        // "Tampilkan N Kelas Lainnya" (ditaruh di elemen sibling `${containerId}-tombol`).
        function renderKelasListWithCollapse(containerId, filtered) {
            const container = document.getElementById(containerId);
            const tombolWrap = document.getElementById(containerId + '-tombol');
            if (!container) return;

            const tampil = filtered.slice(0, BATAS_AWAL_KARTU_KELAS_BERANDA);
            const sisanya = filtered.slice(BATAS_AWAL_KARTU_KELAS_BERANDA);

            let html = tampil.map(k => buildKartuKelasBerandaHTML(k)).join('');

            const idSisa = containerId + '-sisa';
            if (sisanya.length > 0) {
                html += `<div id="${idSisa}" class="kartu-kelas-sisa-wrapper kartu-kelas-tersembunyi">${sisanya.map(k => buildKartuKelasBerandaHTML(k)).join('')}</div>`;
            }
            container.innerHTML = html;

            if (tombolWrap) {
                if (sisanya.length > 0) {
                    tombolWrap.innerHTML = `
                        <button id="${idSisa}-btn" onclick="tampilkanSisaKelasBeranda('${idSisa}')" class="mt-4 w-full py-2.5 rounded-2xl border border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/50 text-xs font-bold transition-all">
                            <i class="fa-solid fa-plus mr-1"></i> Tampilkan ${sisanya.length} Kelas Lainnya
                        </button>
                    `;
                } else {
                    tombolWrap.innerHTML = "";
                }
            }
        }

        function tampilkanSisaKelasBeranda(idSisa) {
            const el = document.getElementById(idSisa);
            const btn = document.getElementById(idSisa + '-btn');
            if (el) el.classList.remove('kartu-kelas-tersembunyi');
            if (btn) btn.remove();
        }

        // Dipicu tombol "Lihat Semua" di header tiap section tingkat Beranda --
        // pindah ke tab "Kelola Kelas" dengan filter tingkat yang sesuai.
        function bukaSemuaKelasTingkat(tingkat) {
            switchTab('kelas');
            const selTingkat = document.getElementById('filter-tingkat');
            const selJurusan = document.getElementById('filter-jurusan');
            if (selTingkat) selTingkat.value = tingkat;
            if (selJurusan) selJurusan.value = 'ALL';
            renderSeluruhKelas();
        }

        function renderContainerKelasTingkat(tingkat, containerId) {
            const filtered = daftarSeluruhKelasDummy.filter(k => k.tingkat === tingkat);
            renderKelasListWithCollapse(containerId, filtered);
        }

        function filterBerandaCepat(tingkat) {
            ['ALL', 'X', 'XI', 'XII'].forEach(t => {
                const btn = document.getElementById(`btn-fast-${t}`);
                if (btn) {
                    btn.className = "btn-fast-filter px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-all";
                }
            });
            const activeBtn = document.getElementById(`btn-fast-${tingkat}`);
            if (activeBtn) {
                activeBtn.className = "btn-fast-filter px-4 py-2 rounded-xl text-xs font-extrabold bg-blue-600 text-white shadow-md transition-all";
            }

            ['X', 'XI', 'XII'].forEach(t => {
                const sec = document.getElementById(`section-beranda-${t}`);
                if (sec) {
                    if (tingkat === 'ALL' || tingkat === t) sec.classList.remove('hidden');
                    else sec.classList.add('hidden');
                }
            });
        }

        function filterBerandaCepatByJurusan(jurusan) {
            ['X', 'XI', 'XII'].forEach((tingkat) => {
                let filtered = daftarSeluruhKelasDummy.filter(k => k.tingkat === tingkat);
                if (jurusan !== 'ALL') {
                    filtered = filtered.filter(k => k.jurusan === jurusan);
                }
                renderKelasListWithCollapse(`container-beranda-${tingkat}`, filtered);
            });
        }

        function renderSeluruhKelas() {
            const container = document.getElementById('grid-seluruh-kelas');
            if(!container) return;
            container.innerHTML = "";
            const fTingkat = document.getElementById('filter-tingkat').value;
            const fJurusan = document.getElementById('filter-jurusan').value;

            let filtered = daftarSeluruhKelasDummy;
            if (fTingkat !== 'ALL') filtered = filtered.filter(k => k.tingkat === fTingkat);
            if (fJurusan !== 'ALL') filtered = filtered.filter(k => k.jurusan === fJurusan);

            filtered.forEach(k => {
                const tasksKelasIni = getTasksKelas(k.nama);
                let badgeJurusanColor = "bg-blue-50 text-blue-700";
                if (k.jurusan === 'TKR') badgeJurusanColor = "bg-rose-50 text-rose-700 border border-rose-200";
                if (k.jurusan === 'TAV') badgeJurusanColor = "bg-purple-50 text-purple-600";

                // Tugas yang sudah lewat deadline dianggap usai (lihat catatan yang
                // sama di bukaDetailKelas()) -- supaya badge "Tugas Aktif" di kartu
                // kelas ini juga tidak nyangkut terus walau tugasnya sudah lama lewat
                // tenggat & tidak ada yang baru dikirim guru.
                const cekWaktuKelasIni = new Date().getTime();
                const tugasAktifKelasIni = tasksKelasIni.filter(t => !t.deadlineTimestamp || cekWaktuKelasIni < t.deadlineTimestamp || t.studentSubmitted);
                let statusBadgeTugas = `<span class="text-xs text-amber-500 font-semibold italic">Belum Ada Tugas Aktif</span>`;
                if (tugasAktifKelasIni.length > 0) {
                    statusBadgeTugas = `<span class="text-xs text-emerald-600 font-bold"><i class="fa-solid fa-check mr-1"></i> ${tugasAktifKelasIni.length} Tugas/Catatan Aktif</span>`;
                }

                container.innerHTML += `
                    <div onclick="bukaDetailKelas('${k.nama}', '${k.jurusan}', '${k.mapel}', '${k.jurusan}', '${k.img}')" class="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer p-6 space-y-4 group">
                        <div class="flex justify-between items-start">
                            <span class="px-3 py-1 font-black text-xs rounded-lg ${badgeJurusanColor}">${k.jurusan}</span>
                            <span class="text-xs text-slate-400 font-semibold">30 Siswa</span>
                        </div>
                        <div>
                            <h4 class="font-extrabold text-slate-900 text-lg group-hover:text-blue-600 transition-colors">${k.nama}</h4>
                            <p class="text-xs text-slate-500 mt-1">${k.mapel}</p>
                            <div class="mt-2">${statusBadgeTugas}</div>
                        </div>
                        <div class="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                            <span class="text-slate-400">Wali: <b class="text-slate-700">${k.wali}</b></span>
                            <span class="text-blue-600 font-bold group-hover:underline">Denah Kelas &rarr;</span>
                        </div>
                    </div>
                `;
            });
        }

        function filterDaftarKelas() {
            renderSeluruhKelas();
        }

        function resetTombolKirimTugasGuru() {
            const btn = document.getElementById('btn-kirim-tugas-guru');
            if (!btn) return;
            btn.classList.remove('mengirim');
            btn.disabled = false;
        }

        function bukaModalBeriTugas(namaKelas) {
            // Selalu membuat TUGAS BARU. Tugas-tugas lain yang sudah aktif di kelas
            // ini tidak disentuh/dihapus — form ini cuma menambah satu tugas baru lagi.
            selectedKelasBeriTugas = namaKelas;
            editingTaskId = null;
            resetTombolKirimTugasGuru();
            document.getElementById('target-kelas-nama').innerText = namaKelas;
            document.getElementById('modal-tugas-title').innerText = "Beri Tugas / Catatan Baru";

            document.getElementById('input-judul-tugas').value = '';
            document.getElementById('input-konten-tugas').value = '';
            document.getElementById('input-tanggal-tenggat').value = new Date().toISOString().split('T')[0];
            document.getElementById('input-jam-tenggat').value = '12:00';
            teacherImageBase64 = null;
            document.getElementById('foto-tugas-preview-container').classList.add('hidden');

            document.getElementById('audio-preview-container').classList.add('hidden');
            audioBlob = null;
            audioDataUrl = null;
            document.getElementById('modal-beri-tugas').classList.remove('hidden');
        }

        function bukaModalEditTugas(namaKelas, taskId) {
            // Edit satu tugas TERTENTU (berdasarkan id) tanpa mempengaruhi tugas lain di kelas ini.
            selectedKelasBeriTugas = namaKelas;
            editingTaskId = taskId;
            resetTombolKirimTugasGuru();
            const tasks = getTasksKelas(namaKelas);
            const data = tasks.find(t => t.id === taskId);
            if (!data) { bukaModalBeriTugas(namaKelas); return; }

            // JAGA-JAGA (selain kartu Beranda yang sudah menyaring tombolnya):
            // tugas buatan guru lain tidak boleh dibuka lewat form edit ini.
            if (!tugasIniMilikGuruLogin(data)) {
                alert(`Tugas ini dibuat oleh ${data.namaGuru || cariNamaGuruKelas(namaKelas)}, jadi Anda tidak bisa mengatur/mengubahnya. Anda cuma bisa mengatur tugas yang Anda buat sendiri.`);
                return;
            }

            document.getElementById('target-kelas-nama').innerText = namaKelas;
            document.getElementById('modal-tugas-title').innerText = "Edit / Atur Waktu Tugas Ini";

            document.getElementById('input-judul-tugas').value = data.judul || '';
            document.getElementById('input-konten-tugas').value = data.teks || '';
            const inputTgl = document.getElementById('input-tanggal-tenggat');
            const inputJam = document.getElementById('input-jam-tenggat');
            if (data.deadlineTimestamp) {
                const dObj = new Date(data.deadlineTimestamp);
                inputTgl.value = dObj.toISOString().split('T')[0];
                inputJam.value = `${String(dObj.getHours()).padStart(2,'0')}:${String(dObj.getMinutes()).padStart(2,'0')}`;
            } else {
                inputTgl.value = new Date().toISOString().split('T')[0];
                inputJam.value = '12:00';
            }

            if (data.teacherImage) {
                teacherImageBase64 = data.teacherImage;
                document.getElementById('foto-tugas-preview').src = data.teacherImage;
                document.getElementById('foto-tugas-preview-container').classList.remove('hidden');
            } else {
                teacherImageBase64 = null;
                document.getElementById('foto-tugas-preview-container').classList.add('hidden');
            }

            audioBlob = null;
            if (data.audioDataUrl) {
                // Tugas ini sebelumnya sudah punya voice note tersimpan -> tampilkan lagi supaya bisa didengar/diganti.
                audioDataUrl = data.audioDataUrl;
                document.getElementById('audio-preview').src = data.audioDataUrl;
                document.getElementById('audio-preview-container').classList.remove('hidden');
            } else {
                audioDataUrl = null;
                document.getElementById('audio-preview-container').classList.add('hidden');
            }
            document.getElementById('modal-beri-tugas').classList.remove('hidden');
        }

        function tutupModalBeriTugas() {
            if (isRecording) stopVoiceRecord();
            document.getElementById('modal-beri-tugas').classList.add('hidden');
        }

        function handleUploadFotoTugasGuru(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                teacherImageBase64 = e.target.result;
                document.getElementById('foto-tugas-preview').src = teacherImageBase64;
                document.getElementById('foto-tugas-preview-container').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
            event.target.value = '';
        }

        function hapusFotoTugasGuru() {
            teacherImageBase64 = null;
            document.getElementById('foto-tugas-preview-container').classList.add('hidden');
        }

        function setJenisKonten(type) {
            jenisKontenAktif = type;
            const btnTugas = document.getElementById('tab-opt-tugas');
            const btnCatatan = document.getElementById('tab-opt-catatan');
            // Cukup toggle class 'aktif' — lebih ringan daripada ganti
            // className penuh tiap klik, terutama kerasa di HP.
            btnTugas.classList.toggle('aktif', type === 'tugas');
            btnCatatan.classList.toggle('aktif', type === 'catatan');
        }

        async function toggleVoiceRecord() {
            if (!isRecording) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                    // Penting: paksa Blob pakai tipe 'audio/mp3' padahal browser sebenarnya
                    // merekam dalam format lain (webm/opus, ogg, dst) bikin <audio> gagal
                    // decode -> makanya rekaman gak bisa diputar pas diklik. Di sini kita
                    // pilih format yang MEMANG didukung browser, lalu Blob-nya dikasih
                    // tipe yang SAMA PERSIS dengan format rekaman aslinya.
                    const kandidatMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
                    const mimeTerpilih = kandidatMime.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
                    mediaRecorder = mimeTerpilih ? new MediaRecorder(stream, { mimeType: mimeTerpilih }) : new MediaRecorder(stream);
                    audioMimeType = mediaRecorder.mimeType || mimeTerpilih || 'audio/webm';

                    audioChunks = [];
                    mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
                    mediaRecorder.onstop = () => {
                        // Matikan akses mikrofon setelah selesai rekam.
                        stream.getTracks().forEach(track => track.stop());

                        audioBlob = new Blob(audioChunks, { type: audioMimeType });
                        const audioUrl = URL.createObjectURL(audioBlob);
                        const audioPreview = document.getElementById('audio-preview');
                        audioPreview.src = audioUrl;
                        document.getElementById('audio-preview-container').classList.remove('hidden');

                        // Simpan juga sebagai base64 supaya rekamannya gak hilang begitu
                        // modal ditutup / halaman direfresh (blob: URL sifatnya sementara).
                        const reader = new FileReader();
                        reader.onload = () => { audioDataUrl = reader.result; };
                        reader.readAsDataURL(audioBlob);
                    };
                    mediaRecorder.start();
                    isRecording = true;
                    document.getElementById('btn-record-voice').className = "px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md animate-pulse";
                    document.getElementById('text-btn-record').innerText = "Berhenti Merekam";
                    document.getElementById('voice-timer').classList.remove('hidden');
                } catch (e) {
                    alert("Gagal mengakses mikrofon browser. Pastikan izin mikrofon aktif.");
                }
            } else {
                stopVoiceRecord();
            }
        }

        function stopVoiceRecord() {
            if (mediaRecorder && isRecording) {
                mediaRecorder.stop();
                isRecording = false;
                document.getElementById('btn-record-voice').className = "px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-blue-200";
                document.getElementById('text-btn-record').innerText = "Rekam Ulang Suara";
                document.getElementById('voice-timer').classList.add('hidden');
            }
        }

        // Memutar animasi ikon di tombol Kirim Tugas: ikon buku geser ke kanan &
        // menghilang, disusul ceklis hijau muncul di tempatnya. `callback` (proses
        // simpan data yang sebenarnya) baru dijalankan SETELAH animasi ini kelar,
        // supaya guru sempat lihat animasinya sebelum modal tertutup/alert muncul.
        function mainkanAnimasiKirimTugasGuru(callback) {
            const btn = document.getElementById('btn-kirim-tugas-guru');
            if (!btn || btn.classList.contains('mengirim')) { callback(); return; }

            btn.disabled = true;
            btn.classList.add('mengirim');

            setTimeout(() => {
                callback();
                // Reset ikon balik ke "buku" untuk kesiapan lain kali modal dibuka lagi.
                btn.classList.remove('mengirim');
                btn.disabled = false;
            }, 750);
        }

        // Pengganti confirm() bawaan browser (yang tampilannya kaku, tidak bisa
        // distyling, dan judulnya selalu nampilin domain seperti "el0fakhri.
        // pythonanywhere.com says"). Modal ini dibuka lewat bukaModalKonfirmasiGenerik(),
        // judul/pesan/tombol diisi dinamis, dan callback-nya baru dijalankan kalau
        // guru benar-benar menekan tombol aksi (bukan Batal / klik luar modal).
        let _callbackKonfirmasiGenerikAktif = null;

        // FITUR TAMBAHAN: parameter `tampilkanInputKeterangan` (opsional) & `keteranganAwal`
        // (opsional, nilai default yang sudah keisi di textarea). Kalau
        // tampilkanInputKeterangan true, textarea #konfirmasi-generik-input-keterangan
        // ditampilkan & WAJIB diisi sebelum tombol aksi bisa diklik (guru harus
        // menjelaskan pelanggarannya apa -- prinsip "Harus Ada Tombol Aksi Nyata"
        // dari sisi siswa dimulai dari sini). `onKonfirmasi` sekarang dipanggil
        // dengan 1 argumen: teks keterangan yang diisi guru (string kosong kalau
        // tampilkanInputKeterangan tidak dipakai sama sekali).
        function bukaModalKonfirmasiGenerik({ judul = 'Konfirmasi', pesan = '', teksTombol = 'Ya, Lanjutkan', ikon = 'fa-triangle-exclamation', warnaTombol = 'rose', tampilkanInputKeterangan = false, keteranganAwal = '', onKonfirmasi }) {
            const modal = document.getElementById('modal-konfirmasi-generik');
            if (!modal) { if (onKonfirmasi) onKonfirmasi(keteranganAwal || ''); return; }

            document.getElementById('konfirmasi-generik-judul').querySelector('span').textContent = judul;
            document.getElementById('konfirmasi-generik-ikon').className = `fa-solid ${ikon} text-${warnaTombol === 'rose' ? 'rose' : 'amber'}-500`;
            document.getElementById('konfirmasi-generik-pesan').textContent = pesan;

            const wrapKeterangan = document.getElementById('konfirmasi-generik-wrap-keterangan');
            const inputKeterangan = document.getElementById('konfirmasi-generik-input-keterangan');
            const btnAksi = document.getElementById('konfirmasi-generik-btn-aksi');

            if (wrapKeterangan && inputKeterangan) {
                if (tampilkanInputKeterangan) {
                    wrapKeterangan.classList.remove('hidden');
                    inputKeterangan.value = keteranganAwal || '';
                    // Tombol aksi baru aktif kalau keterangan sudah diisi -- guru
                    // tidak bisa asal klik tanpa menjelaskan pelanggarannya apa.
                    const perbaruiStatusTombol = () => {
                        btnAksi.disabled = !inputKeterangan.value.trim();
                        btnAksi.classList.toggle('opacity-50', btnAksi.disabled);
                        btnAksi.classList.toggle('cursor-not-allowed', btnAksi.disabled);
                    };
                    inputKeterangan.oninput = perbaruiStatusTombol;
                    perbaruiStatusTombol();
                    setTimeout(() => inputKeterangan.focus(), 50);
                } else {
                    wrapKeterangan.classList.add('hidden');
                    inputKeterangan.value = '';
                    inputKeterangan.oninput = null;
                    btnAksi.disabled = false;
                    btnAksi.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }

            btnAksi.querySelector('span').textContent = teksTombol;
            btnAksi.className = `px-6 py-2.5 bg-${warnaTombol}-600 hover:bg-${warnaTombol}-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-${warnaTombol}-500/20 flex items-center gap-2`;

            _callbackKonfirmasiGenerikAktif = onKonfirmasi || null;
            btnAksi.onclick = function () {
                if (btnAksi.disabled) return;
                const cb = _callbackKonfirmasiGenerikAktif;
                const teksKeterangan = (tampilkanInputKeterangan && inputKeterangan) ? inputKeterangan.value.trim() : '';
                tutupModalKonfirmasiGenerik();
                if (cb) cb(teksKeterangan);
            };

            modal.classList.remove('hidden');
        }

        function tutupModalKonfirmasiGenerik() {
            const modal = document.getElementById('modal-konfirmasi-generik');
            if (modal) modal.classList.add('hidden');
            _callbackKonfirmasiGenerikAktif = null;
            const wrapKeterangan = document.getElementById('konfirmasi-generik-wrap-keterangan');
            const inputKeterangan = document.getElementById('konfirmasi-generik-input-keterangan');
            if (wrapKeterangan) wrapKeterangan.classList.add('hidden');
            if (inputKeterangan) { inputKeterangan.value = ''; inputKeterangan.oninput = null; }
        }

        // Menampilkan toast sukses (tab kecil di pojok kanan atas) sebagai pengganti
        // alert() bawaan browser yang kaku & memblokir tampilan. Ceklis hijaunya pakai
        // SVG dengan stroke-dasharray supaya efeknya "digambar" pelan-pelan, bukan
        // muncul instan. Toast otomatis hilang sendiri, atau bisa ditutup manual.
        function tampilkanToastSuksesKirimTugas(judul, pesan) {
            const container = document.getElementById('toast-sukses-container');
            if (!container) return;

            const idToast = 'toast-sukses-' + Date.now();
            const toast = document.createElement('div');
            toast.id = idToast;
            toast.className = 'toast-sukses-kirim';
            toast.innerHTML = `
                <svg class="toast-check-svg" viewBox="0 0 52 52">
                    <circle class="toast-check-circle" cx="26" cy="26" r="23"/>
                    <path class="toast-check-mark" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
                <div class="flex-1 min-w-0">
                    <p class="toast-teks-judul">${judul}</p>
                    <p class="toast-teks-pesan">${pesan}</p>
                </div>
                <button class="toast-btn-tutup" onclick="tutupToastSuksesKirimTugas('${idToast}')">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            container.appendChild(toast);

            setTimeout(() => tutupToastSuksesKirimTugas(idToast), 5000);
        }

        function tutupToastSuksesKirimTugas(idToast) {
            const toast = document.getElementById(idToast);
            if (!toast) return;
            toast.classList.add('toast-keluar');
            setTimeout(() => toast.remove(), 300);
        }

        function kirimTugasKeKelas() {
            const judul = document.getElementById('input-judul-tugas').value.trim();
            const teks = document.getElementById('input-konten-tugas').value;
            const tglVal = document.getElementById('input-tanggal-tenggat').value;
            const jamVal = document.getElementById('input-jam-tenggat').value;

            if (!judul) {
                alert("Harap isi Judul Tugas terlebih dahulu.");
                return;
            }

            if (!tglVal || !jamVal) {
                alert("Harap tentukan tanggal dan jam batas waktu (deadline) tugas.");
                return;
            }

            mainkanAnimasiKirimTugasGuru(() => {
                const deadlineTimestamp = new Date(`${tglVal}T${jamVal}:00`).getTime();
                const deadlineFormatted = `${tglVal} Pukul ${jamVal} WIB`;

                const tasks = getTasksKelas(selectedKelasBeriTugas);

                if (editingTaskId) {
                    // MODE EDIT: cuma memperbarui 1 tugas yang sedang dipilih (by id).
                    // Tugas-tugas lain di kelas yang sama tetap utuh, tidak ke-replace.
                    const idx = tasks.findIndex(t => t.id === editingTaskId);
                    if (idx !== -1) {
                        const deadlineLamaTimestamp = tasks[idx].deadlineTimestamp || null;

                        tasks[idx] = {
                            ...tasks[idx],
                            judul: judul,
                            tipe: jenisKontenAktif === 'tugas' ? 'Tugas Utama' : 'Catatan Guru',
                            teks: teks || "Instruksi Pesan Suara dari Guru.",
                            deadline: deadlineFormatted,
                            deadlineTimestamp: deadlineTimestamp,
                            hasVN: !!audioBlob,
                            audioDataUrl: audioBlob ? (audioDataUrl || tasks[idx].audioDataUrl || null) : null,
                            teacherImage: teacherImageBase64 || null,
                            namaGuru: namaGuruYangSedangLogin(selectedKelasBeriTugas),
                        };

                        // Kalau deadline barunya lebih MUNDUR/lama dari sebelumnya, berarti
                        // guru menambah waktu -> kirim notif ke siswa berisi berapa menit
                        // tambahannya. Kalau deadline malah dipercepat/dikurangi, tidak usah
                        // kirim notif "tambahan waktu" (itu bukan tambahan waktu).
                        if (deadlineLamaTimestamp && deadlineTimestamp > deadlineLamaTimestamp) {
                            const menitDitambah = Math.round((deadlineTimestamp - deadlineLamaTimestamp) / 60000);
                            if (menitDitambah > 0) {
                                simpanNotifTambahanWaktu(selectedKelasBeriTugas, tasks[idx], menitDitambah);
                            }
                        }
                    }
                    saveTasksKelas(selectedKelasBeriTugas, tasks);
                    tampilkanToastSuksesKirimTugas('Berhasil Diperbarui!', `Tugas terpilih di kelas ${selectedKelasBeriTugas} berhasil diperbarui.`);
                } else {
                    // MODE TAMBAH BARU: tugas baru ditambahkan ke daftar, tugas-tugas
                    // yang sudah ada di kelas ini sebelumnya TIDAK dihapus/ditimpa.
                    const dataTugasBaru = {
                        id: buatIDTugasBaru(),
                        kelas: selectedKelasBeriTugas,
                        judul: judul,
                        tipe: jenisKontenAktif === 'tugas' ? 'Tugas Utama' : 'Catatan Guru',
                        teks: teks || "Instruksi Pesan Suara dari Guru.",
                        deadline: deadlineFormatted,
                        deadlineTimestamp: deadlineTimestamp,
                        hasVN: !!audioBlob,
                        audioDataUrl: audioBlob ? audioDataUrl : null,
                        teacherImage: teacherImageBase64 || null,
                        namaGuru: namaGuruYangSedangLogin(selectedKelasBeriTugas),
                        waktuKirimGuru: Date.now(),
                        isViewedByStudent: false,
                        studentSubmitted: false,
                        studentTime: null,
                        studentImage: null,
                        grade: null
                    };
                    tasks.push(dataTugasBaru);
                    saveTasksKelas(selectedKelasBeriTugas, tasks);
                    tampilkanToastSuksesKirimTugas('Berhasil!', `Tugas baru untuk kelas ${selectedKelasBeriTugas} berhasil dikirim. Kini ada ${tasks.length} tugas/catatan aktif di kelas ini.`);
                }

                // Kalau bel otomatis lagi bunyi untuk kelas yang baru saja dikasih tugas ini, matikan.
                matikanBelMengajar();

                tutupModalBeriTugas();
                renderBerandaKelasBerurutan();
                renderSeluruhKelas();
                renderRekapSemuaTugas();
                renderAktivitasTugasTerbaruBeranda();
            });
        }

        function hapusTugasByID(namaKelas, taskId) {
            // JAGA-JAGA (selain kartu Beranda yang sudah menyaring tombolnya):
            // guru cuma boleh hapus/tarik tugas buatannya sendiri.
            const tasksCek = getTasksKelas(namaKelas);
            const tugasCek = tasksCek.find(t => t.id === taskId);
            if (tugasCek && !tugasIniMilikGuruLogin(tugasCek)) {
                alert(`Tugas ini dibuat oleh ${tugasCek.namaGuru || cariNamaGuruKelas(namaKelas)}, jadi Anda tidak bisa menghapus/menariknya. Anda cuma bisa menghapus tugas yang Anda buat sendiri.`);
                return;
            }

            bukaModalKonfirmasiGenerik({
                judul: 'Tarik / Hapus Tugas?',
                pesan: `Apakah Anda yakin ingin menarik/menghapus tugas ini dari kelas ${namaKelas}?`,
                teksTombol: 'Ya, Hapus',
                ikon: 'fa-trash-can',
                warnaTombol: 'rose',
                onKonfirmasi: function () {
                    let tasks = getTasksKelas(namaKelas);
                    const tugasDitarik = tasks.find(t => t.id === taskId);
                    tasks = tasks.filter(t => t.id !== taskId);
                    saveTasksKelas(namaKelas, tasks);

                    if (tugasDitarik) {
                        simpanNotifTugasDitarik(namaKelas, tugasDitarik);
                    }

                    tampilkanToastSuksesKirimTugas('Tugas Ditarik', `Tugas terpilih di kelas ${namaKelas} berhasil ditarik. Tugas lain di kelas ini (jika ada) tetap aman dan tidak ikut terhapus.`);
                    renderBerandaKelasBerurutan();
                    renderSeluruhKelas();
                    renderRekapSemuaTugas();
                    renderAktivitasTugasTerbaruBeranda();
                }
            });
        }

        // Notifikasi "tugas ditarik" untuk Dashboard Siswa. Disimpan per kelas supaya
        // saat guru menarik tugas, siswa di kelas tsb dapat notif berisi nama guru
        // dan pesan bahwa tugas tersebut ditarik/tidak perlu dikerjakan lagi.
        //
        // PERBAIKAN PERFORMA: dulu di sini pakai getSync() (XHR SINKRON, bisa
        // membekukan seluruh tab beberapa detik). Sekarang pakai fetch() async
        // biasa -- fungsi jadi async, tapi pemanggilnya (hapusTugasByID) TIDAK
        // perlu nunggu (await) fungsi ini, karena efeknya cuma nambah notif
        // buat siswa, tidak ada tampilan guru yang bergantung ke hasilnya.
        async function simpanNotifTugasDitarik(namaKelas, tugasDitarik) {
            const key = `notif_tugas_${namaKelas.replace(/\s+/g, '_')}`;
            let daftarNotif = [];
            try {
                const res = await fetch(`/api/sync/${encodeURIComponent(key)}`);
                const json = await res.json();
                if (json.ok && json.data) daftarNotif = json.data;
            } catch (e) {
                const raw = localStorage.getItem(key);
                daftarNotif = raw ? JSON.parse(raw) : [];
            }

            const namaGuru = tugasDitarik.namaGuru || cariNamaGuruKelas(namaKelas);
            const judulTugas = tugasDitarik.judul || tugasDitarik.tipe || 'Tugas Pembelajaran';

            daftarNotif.unshift({
                id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                tipe: 'tugas_ditarik',
                namaGuru: namaGuru,
                judulTugas: judulTugas,
                pesan: `${namaGuru} menarik tugas "${judulTugas}". Tugas ini tidak perlu dikerjakan/dikumpulkan lagi.`,
                waktu: Date.now(),
                dibaca: false
            });

            // Batasi maksimal 30 notifikasi tersimpan per kelas biar data tidak membengkak.
            setSync(key, daftarNotif.slice(0, 30));
        }

        // Notifikasi "tambahan waktu" untuk Dashboard Siswa. Dipicu otomatis dari mode
        // edit tugas (kirimTugasKeKelas) begitu guru mengubah deadline jadi lebih mundur
        // dari sebelumnya. Disimpan di kunci localStorage yang SAMA dengan notif tugas
        // ditarik (satu kotak notif per kelas), cuma beda `tipe` supaya Dashboard Siswa
        // bisa menampilkannya dengan tema hijau (kabar baik) alih-alih merah.
        function simpanNotifTambahanWaktu(namaKelas, tugasData, menitDitambah) {
            simpanNotifTambahanWaktuAsync(namaKelas, tugasData, menitDitambah);
        }
        async function simpanNotifTambahanWaktuAsync(namaKelas, tugasData, menitDitambah) {
            const key = `notif_tugas_${namaKelas.replace(/\s+/g, '_')}`;
            let daftarNotif = [];
            try {
                const res = await fetch(`/api/sync/${encodeURIComponent(key)}`);
                const json = await res.json();
                if (json.ok && json.data) daftarNotif = json.data;
            } catch (e) {
                const raw = localStorage.getItem(key);
                daftarNotif = raw ? JSON.parse(raw) : [];
            }

            const namaGuru = tugasData.namaGuru || cariNamaGuruKelas(namaKelas);
            const judulTugas = tugasData.judul || tugasData.tipe || 'Tugas Pembelajaran';

            daftarNotif.unshift({
                id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                tipe: 'tambahan_waktu',
                namaGuru: namaGuru,
                judulTugas: judulTugas,
                pesan: `${namaGuru} menambahkan ${menitDitambah} menit untuk tugas "${judulTugas}". Deadline baru: ${tugasData.deadline}.`,
                waktu: Date.now(),
                dibaca: false
            });

            setSync(key, daftarNotif.slice(0, 30));
        }

        // Tugas yang deadline-nya sudah lewat TIDAK dihapus dari sistem -- baris di
        // rekap ini tetap ada, cuma "Status Tugas"-nya otomatis bergeser jadi
        // "Kedaluwarsa" (merah). Dipakai bareng kolom "Pengumpulan Siswa" di bawah
        // supaya guru punya rekam jejak jelas siapa yang gagal mengumpulkan tepat waktu.
        function cekStatusTugasKedaluwarsaGuru(data) {
            if (data.deadlineTimestamp) return Date.now() > data.deadlineTimestamp;
            if (!data.deadline) return false;
            const cleanDeadline = String(data.deadline).trim();
            if (cleanDeadline.includes("Pukul")) {
                const parts = cleanDeadline.split("Pukul");
                const datePart = parts[0].trim();
                const timePart = parts[1].replace("WIB", "").trim();
                const targetDateTime = new Date(`${datePart}T${timePart}:00`);
                return !isNaN(targetDateTime.getTime()) && Date.now() > targetDateTime.getTime();
            }
            const t = new Date(cleanDeadline).getTime();
            return !isNaN(t) && Date.now() > t;
        }

        function renderRekapSemuaTugas() {
            const tbody = document.getElementById('tabel-rekap-tugas-body');
            if(!tbody) return;
            tbody.innerHTML = "";
            let totalTugasAktif = 0;

            // PERBAIKAN: "Rekap Semua Tugas" itu artinya "semua tugas YANG SAYA
            // KASIH", bukan tugas satu sekolah dicampur jadi satu. Jadi rekap
            // guru A dan rekap guru B dipisah -- masing-masing cuma lihat
            // baris tugas yang DIA sendiri yang buat/kirim (pembatasan
            // edit/hapus di kartu ringkas Beranda TIDAK berlaku di sini,
            // karena di sini semua baris yang tampil memang sudah pasti
            // miliknya sendiri).
            daftarSeluruhKelasDummy.forEach(k => {
                const tasksKelasIni = getTasksKelas(k.nama).filter(t => tugasIniMilikGuruLogin(t));
                tasksKelasIni.forEach(data => {
                    totalTugasAktif++;

                    const kedaluwarsa = cekStatusTugasKedaluwarsaGuru(data);
                    const sudahDikumpulkan = !!data.studentSubmitted;

                    const badgeStatusTugas = kedaluwarsa
                        ? `<span class="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[11px] rounded-lg"><i class="fa-solid fa-hourglass-end mr-1"></i>Kedaluwarsa</span>`
                        : `<span class="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold text-[11px] rounded-lg"><i class="fa-solid fa-circle-dot mr-1"></i>Aktif</span>`;

                    let badgePengumpulan;
                    if (sudahDikumpulkan) {
                        badgePengumpulan = `<span class="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold text-[11px] rounded-lg"><i class="fa-solid fa-check mr-1"></i>Terkumpul</span>`;
                    } else if (kedaluwarsa) {
                        badgePengumpulan = `<span class="px-2.5 py-1 bg-rose-100 text-rose-700 border border-rose-300 font-bold text-[11px] rounded-lg" title="Tercatat sebagai rekam jejak kedisiplinan"><i class="fa-solid fa-xmark mr-1"></i>Tidak Dikumpulkan (Lewat Waktu)</span>`;
                    } else {
                        badgePengumpulan = `<span class="px-2.5 py-1 bg-slate-100 text-slate-500 font-medium text-[11px] rounded-lg">Menunggu</span>`;
                    }
                    // Baris ini KLIK-ABLE (klik di mana saja pada baris, bukan cuma satu
                    // badge): begitu diklik, muncul jendela mirip Denah Kelas tapi khusus
                    // buat tugas ini -- rekap semua murid di kelas tsb, siapa yg sudah/
                    // belum kumpul, & jam berapa kumpulnya. Tombol Atur/Hapus & badge
                    // status tugas sengaja stopPropagation supaya tidak ikut kebuka.
                    const badgePengumpulanKlikable = `<span class="inline-flex items-center gap-1.5">${badgePengumpulan}<i class="fa-solid fa-chevron-right text-[9px] text-slate-300"></i></span>`;

                    tbody.innerHTML += `
                        <tr onclick="bukaRekapPengumpulanTugas('${k.nama}', '${data.id}')" class="hover:bg-blue-50/60 cursor-pointer transition-colors" title="Klik untuk lihat rekap pengumpulan tiap siswa">
                            <td class="py-3.5 px-6 font-extrabold text-blue-600">${k.nama}</td>
                            <td class="py-3.5 px-6 font-semibold text-slate-600">${data.namaGuru || 'Guru Mata Pelajaran'}</td>
                            <td class="py-3.5 px-6 font-semibold text-slate-700">${data.tipe}</td>
                            <td class="py-3.5 px-6 font-bold text-slate-900">${data.judul || '-'}</td>
                            <td class="py-3.5 px-6 text-slate-600">${data.teks}</td>
                            <td class="py-3.5 px-6 font-mono text-xs text-amber-600 font-bold">${data.deadline}</td>
                            <td class="py-3.5 px-6" onclick="event.stopPropagation()">${badgeStatusTugas}</td>
                            <td class="py-3.5 px-6">${badgePengumpulanKlikable}</td>
                            <td class="py-3.5 px-6 text-right" onclick="event.stopPropagation()">
                                <button onclick="bukaModalEditTugas('${k.nama}', '${data.id}')" class="px-3 py-1 bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white rounded-lg text-xs font-bold transition-all mr-1">Atur</button>
                                <button onclick="hapusTugasByID('${k.nama}', '${data.id}')" class="px-3 py-1 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-lg text-xs font-bold transition-all">Hapus</button>
                            </td>
                        </tr>
                    `;
                });
            });

            if (totalTugasAktif === 0) {
                tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-400 italic">Anda belum mengirimkan tugas atau catatan ke kelas manapun.</td></tr>`;
            }
        }

        // ============================================================
        // CARD BERANDA "Aktivitas Tugas Terbaru": daftar ringkas siapa
        // (guru mana) yang PALING BARU ngasih tugas/catatan ke kelas mana,
        // diurutkan dari yang paling baru (waktuKirimGuru). Tujuannya
        // supaya guru yang login (mis. Ahmad, S.T) langsung lihat jelas
        // kalau tugas terbaru itu dikirim OLEH GURU LAIN (mis. PAK JOEL)
        // ke kelasnya sendiri -- bukan seolah-olah tercatat sebagai
        // aktivitas akun yang sedang login.
        // ============================================================
        function formatWaktuRelatifSingkat(timestamp) {
            if (!timestamp) return '';
            const detik = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
            if (detik < 60) return 'Baru saja';
            const menit = Math.floor(detik / 60);
            if (menit < 60) return `${menit} menit lalu`;
            const jam = Math.floor(menit / 60);
            if (jam < 24) return `${jam} jam lalu`;
            const hari = Math.floor(jam / 24);
            return `${hari} hari lalu`;
        }

        function renderAktivitasTugasTerbaruBeranda() {
            const container = document.getElementById('list-aktivitas-tugas-terbaru');
            if (!container) return;

            // Kumpulkan tugas dari SEMUA kelas jadi satu daftar rata (flat),
            // masing-masing dilengkapi nama kelasnya, lalu urutkan dari yang
            // paling baru dikirim/diubah.
            let semuaAktivitas = [];
            daftarSeluruhKelasDummy.forEach(k => {
                const tasksKelasIni = getTasksKelas(k.nama);
                tasksKelasIni.forEach(data => {
                    semuaAktivitas.push({ ...data, kelas: k.nama });
                });
            });
            semuaAktivitas.sort((a, b) => (b.waktuKirimGuru || 0) - (a.waktuKirimGuru || 0));
            semuaAktivitas = semuaAktivitas.slice(0, 5);

            if (semuaAktivitas.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-4">Belum ada tugas yang dikirimkan.</p>`;
                return;
            }

            container.innerHTML = semuaAktivitas.map(item => {
                const namaGuru = item.namaGuru || 'Guru Mata Pelajaran';
                const inisial = namaGuru.trim().charAt(0).toUpperCase() || 'G';
                return `
                    <div class="flex items-start gap-3 pb-3 border-b border-slate-100 last:border-b-0 last:pb-0">
                        <div class="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-extrabold text-xs flex-shrink-0">${inisial}</div>
                        <div class="min-w-0 flex-1">
                            <p class="text-xs text-slate-700 leading-snug">
                                <span class="font-bold text-slate-900">${namaGuru}</span>
                                memberi <span class="font-semibold">${item.tipe || 'tugas'}</span>
                                untuk <span class="font-bold text-blue-600">${item.kelas}</span>
                            </p>
                            <p class="text-[11px] text-slate-500 truncate mt-0.5" title="${item.judul || ''}">${item.judul || '(tanpa judul)'}</p>
                            <p class="text-[10px] text-slate-400 mt-1"><i class="fa-regular fa-clock mr-1"></i>${formatWaktuRelatifSingkat(item.waktuKirimGuru)}</p>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ============================================================
        // CARD BERANDA "Perlu Dinilai": dulu angkanya statis "0" (hardcode
        // di HTML, tidak pernah diisi apa pun). Sekarang dihubungkan ke
        // data pengumpulan ASLI di SEMUA Rekap Tugas (semua kelas & semua
        // tugas) -- setiap tugas yang sudah dikumpulkan siswa (kapan pun,
        // selama dikumpulkan sebelum/sesuai batas waktu -- lihat catatan di
        // ambilSubmisiTugasServer/statusPengumpulanUntukTugas soal ini) TAPI
        // belum diberi nilai, dihitung 1. Jadi makin banyak siswa yang
        // mengumpulkan, angka ini otomatis makin banyak -- dan berkurang
        // lagi begitu guru memberi nilai (lihat pemanggilan ulang fungsi ini
        // di simpanNilaiSiswa()).
        //
        // Sengaja HANYA melihat kelas yang di sampleMurid30 benar-benar
        // punya murid ASLI (sekarang cuma "XII TKJ 3", lihat SISWA_KELAS_INI)
        // -- kelas lain di daftarSeluruhKelasDummy belum tersambung ke akun
        // siswa sungguhan, jadi tidak ada "pengumpulan" nyata yang bisa
        // dihitung di sana. Begitu roster kelas lain disambungkan ke akun
        // asli (pola yang sama seperti komentar di sampleMurid30), fungsi
        // ini otomatis ikut menghitung kelas itu juga tanpa perlu diubah.
        async function hitungDanTampilkanPerluDinilai() {
            const elBadge = document.getElementById('stat-perlu-dinilai');
            if (!elBadge) return;

            const kelasDenganMuridAsli = [...new Set(sampleMurid30.map(m => m.kelas))];
            const semuaTugasRelevan = [];
            kelasDenganMuridAsli.forEach(namaKelas => {
                getTasksKelas(namaKelas).forEach(task => {
                    semuaTugasRelevan.push({ namaKelas, task });
                });
            });

            if (semuaTugasRelevan.length === 0) {
                elBadge.innerHTML = `0 <span class="text-xs font-normal text-slate-400">Berkas</span>`;
                return;
            }

            let totalPerluDinilai = 0;

            // Semua tugas dicek PARALEL (Promise.all), bukan satu-satu berurutan
            // -- sama seperti perbaikan performa di ambilHasilPeriksaBulkServer
            // & muatCacheTugasSemuaKelas -- supaya tidak lambat walau tugasnya
            // banyak, dan tidak memblokir render lain di halaman.
            await Promise.all(semuaTugasRelevan.map(async ({ namaKelas, task }) => {
                const submisi = await ambilSubmisiTugasServer(task.id);
                window._cacheSubmisiTugas[task.id] = submisi;

                const muridKelasIni = sampleMurid30.filter(m => m.kelas === namaKelas);
                const idSudahKumpul = muridKelasIni
                    .filter(m => submisi[m.username] && submisi[m.username].submitted)
                    .map(m => m.id);
                if (idSudahKumpul.length === 0) return;

                const hasilPeriksaBulk = await ambilHasilPeriksaBulkServer(task.id, idSudahKumpul);

                muridKelasIni.forEach(m => {
                    const entri = submisi[m.username];
                    if (!entri || !entri.submitted) return;
                    const tersimpan = hasilPeriksaBulk[kunciHasilPeriksaTugas(task.id, m.id)] || null;
                    const sudahDinilai =
                        (entri.nilai !== undefined && entri.nilai !== null && entri.nilai !== '') ||
                        (tersimpan && tersimpan.nilai !== undefined && tersimpan.nilai !== null && tersimpan.nilai !== '');
                    if (!sudahDinilai) totalPerluDinilai++;
                });
            }));

            elBadge.innerHTML = `${totalPerluDinilai} <span class="text-xs font-normal text-slate-400">Berkas</span>`;
        }

        // ============================================================
        // MODAL "Rekap Pengumpulan per Tugas" (dibuka dari badge klik-able
        // di kolom "Pengumpulan Siswa" pada tabel Rekap Semua Tugas).
        // ============================================================

        // PERBAIKAN: dulu cuma Siswa ID#1 (akun DEV) yang punya data pengumpulan
        // ASLI; siswa lain di roster statusnya DISIMULASIKAN dari hash(id+taskId)
        // -- termasuk foto acak dari picsum.photos -- walau belum pernah ada
        // satupun dari mereka yang login/kirim apa pun. Sekarang SEMUA siswa
        // (lihat statusPengumpulanUntukTugas() & ambilSubmisiTugasServer() di
        // atas) dibaca dari /api/tugas/submissions/<taskId>, yaitu data ASLI
        // yang cuma bisa terisi lewat POST /api/tugas/submit dari sesi login
        // siswa ybs sendiri.
        // Kunci (server, lewat getSync/setSync) tempat nilai + pesan/catatan
        // guru buat kombinasi
        // (tugas, siswa) tertentu disimpan -- supaya begitu guru kasih nilai
        // dari "Rekap Pengumpulan per Tugas", hasilnya tetap ada walau kartu
        // dirender ulang / halaman dibuka lagi nanti.
        function kunciHasilPeriksaTugas(taskId, idSiswa) {
            return `hasilPeriksaTugas_${taskId}_${idSiswa}`;
        }
        function ambilHasilPeriksaTersimpan(taskId, idSiswa) {
            try {
                return getSync(kunciHasilPeriksaTugas(taskId, idSiswa), null);
            } catch (e) { return null; }
        }

        // PERBAIKAN PERFORMA (PENTING): statusPengumpulanUntukTugas() dipanggil
        // di dalam forEach ke SEMUA murid sekelas (lihat bukaRekapPengumpulanTugas()
        // & klikKasihPelanggaranSemuaBelumKerja()) -- kalau tiap panggilan
        // memicu ambilHasilPeriksaTersimpan() sendiri-sendiri, itu berarti
        // SEBANYAK JUMLAH MURID request XHR SYNCHRONOUS (blocking, lihat
        // getSync() di atas) berturut-turut, jadi makin banyak murid = makin
        // lama & makin sering tab freeze -- inilah sumber utama jendela Rekap
        // kerasa berat walau muridnya cuma segelintir.
        // Fungsi ini menarik SEMUA kunci hasilPeriksaTugas_<taskId>_<idSiswa>
        // sekaligus dalam SATU request lewat /api/sync/bulk (pola yang sama
        // dengan muatCacheTugasSemuaKelas()), jadi berapa pun jumlah murid,
        // tetap cuma 1 request non-blocking.
        async function ambilHasilPeriksaBulkServer(taskId, daftarIdSiswa) {
            const daftarKunci = daftarIdSiswa.map(idSiswa => kunciHasilPeriksaTugas(taskId, idSiswa));
            try {
                const res = await fetch(`/api/sync/bulk?kunci=${encodeURIComponent(daftarKunci.join(','))}`);
                const json = await res.json();
                if (json.ok) return json.data || {};
            } catch (e) {
                console.warn('Gagal ambil hasil periksa tugas (bulk) dari server:', taskId, e);
            }
            return {};
        }

        /* ============================================================
           FITUR TAMBAHAN — "KASIH PELANGGARAN" dari Rekap Pengumpulan per Tugas
           SEBELUMNYA status ditulis ke localStorage browser guru (key
           `pelanggaran_aktif_${username}`) -- tapi ternyata itu artinya
           status ini TIDAK PERNAH sampai ke siswa kalau guru & siswa buka
           dashboard di PERANGKAT YANG BERBEDA (localStorage tidak dibagi
           antar perangkat/browser), reload di sisi siswa pun percuma.
           Sekarang status disimpan di SERVER (lihat /api/pelanggaran/set,
           /api/pelanggaran/semua di app.py, tabel pelanggaran_store).
           _cachePelanggaranAktifServer di bawah cuma SALINAN LOKAL biar
           render kartu tetap instan (tidak perlu network tiap kartu
           dirender) -- disegarkan dari server tiap kali jendela Rekap ini
           dibuka (lihat muatPelanggaranAktifDariServer(), dipanggil dari
           bukaRekapPengumpulanTugas()). Di sisi siswa, status di-polling
           berkala (lihat dashboard_siswa.html) supaya overlay peringatan &
           penguncian tugas langsung berubah tanpa reload manual, walau
           beda perangkat dengan guru. Karena roster di sini memakai
           username akun login ASLI (siswa/syam/waldi/dst -- lihat
           SISWA_KELAS_INI), begitu murid terkait buka dashboard-nya
           sendiri (di perangkat manapun), overlay peringatan "Pelanggaran
           Aktif" otomatis muncul di sana.
           ============================================================ */
        let _cachePelanggaranAktifServer = {}; // salinan lokal { username: true } dari /api/pelanggaran/semua

        async function muatPelanggaranAktifDariServer() {
            try {
                const res = await fetch('/api/pelanggaran/semua');
                const json = await res.json();
                if (json && json.success) _cachePelanggaranAktifServer = json.aktif || {};
            } catch (e) {
                // Gagal/offline -- biarkan cache lokal yang lama dulu, jangan
                // sampai jendela Rekap gagal kebuka gara-gara ini.
            }
        }

        function siswaPunyaPelanggaranAktif(username) {
            return !!_cachePelanggaranAktifServer[username];
        }

        // Kirim perubahan status ke SERVER (bukan localStorage lagi -- lihat
        // catatan besar di atas). Cache lokal diupdate SEBELUM network
        // selesai (baris² sebelum `await fetch` di bawah jalan sinkron)
        // supaya pemanggil (klikTogglePelanggaranSatuMurid dkk) bisa
        // langsung render ulang kartu tanpa nunggu -- kalau ternyata
        // requestnya GAGAL, cache dibalikin lagi & guru diberi tahu.
        async function setPelanggaranAktifUntukUsername(username, aktif, keterangan = '') {
            if (aktif) _cachePelanggaranAktifServer[username] = true;
            else delete _cachePelanggaranAktifServer[username];

            try {
                const res = await fetch('/api/pelanggaran/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // 'keterangan' cuma relevan waktu aktif=true (lihat api_pelanggaran_set
                    // di app.py -- diabaikan server saat mencabut/aktif=false). Inilah teks
                    // yang bakal ditampilkan APA ADANYA di overlay peringatan siswa, jadi
                    // guru WAJIB mengisinya lewat modal di klikTogglePelanggaranSatuMurid()/
                    // klikKasihPelanggaranSemuaBelumKerja() sebelum sampai ke sini.
                    body: JSON.stringify({ username, aktif, keterangan })
                });
                const json = await res.json();
                if (!json || !json.success) throw new Error((json && json.message) || 'Gagal menyimpan.');
            } catch (e) {
                // Server menolak/gagal -- balikin cache lokal ke keadaan semula
                // supaya tampilan guru tidak "bohong" bilang sudah tersimpan.
                if (aktif) delete _cachePelanggaranAktifServer[username];
                else _cachePelanggaranAktifServer[username] = true;
                tampilkanToastSuksesKirimTugas('Gagal Tersimpan', 'Perubahan status pelanggaran gagal disimpan ke server. Coba lagi.');
                if (taskAktifDipilihUntukRekap) {
                    bukaRekapPengumpulanTugas(taskAktifDipilihUntukRekap.namaKelas, taskAktifDipilihUntukRekap.taskId, true);
                }
            }
        }

        // Toggle status utk SATU murid, dipanggil dari tombol kecil di kartu
        // rekap (cuma tampil buat murid yang belum mengerjakan tugas ini).
        //
        // PERBAIKAN PERFORMA (PENTING): dulu di akhir fungsi ini manggil ulang
        // bukaRekapPengumpulanTugas(..., true) secara PENUH cuma buat update
        // 1 tombol -- itu artinya SETIAP klik toggle pelanggaran memicu 2
        // request network lagi (ambilSubmisiTugasServer + ambilHasilPeriksaBulkServer)
        // DAN membongkar+merender ulang SELURUH grid kartu murid lewat
        // gridContainer.innerHTML = ... (bukan cuma kartu yang diklik). Ini
        // sumber utama scroll jendela Rekap kerasa "berat"/patah tiap habis
        // klik tombol -- padahal cuma warna & teks 1 tombol yang berubah.
        // Sekarang cukup update tombolnya sendiri langsung di DOM (lihat
        // perbaruiTombolPelanggaranDiKartu di bawah), tanpa network & tanpa
        // menyentuh kartu murid lain sama sekali -- posisi scroll & kartu
        // lain tidak lagi ke-reset/dibangun ulang.
        // FITUR TAMBAHAN: mengaktifkan pelanggaran sekarang WAJIB lewat modal
        // konfirmasi berisi input "Keterangan Pelanggaran" -- guru harus
        // menjelaskan pelanggarannya apa dulu sebelum tersimpan ke server,
        // supaya overlay siswa tidak lagi menampilkan kotak keterangan kosong.
        // Mencabut pelanggaran (sudahAktif=true -> mau dibatalkan) TETAP instan
        // tanpa modal, karena tidak butuh keterangan apa pun.
        function klikTogglePelanggaranSatuMurid(muridId) {
            const murid = sampleMurid30.find(m => m.id === muridId);
            if (!murid || !taskAktifDipilihUntukRekap) return;

            const sudahAktif = siswaPunyaPelanggaranAktif(murid.username);

            if (sudahAktif) {
                setPelanggaranAktifUntukUsername(murid.username, false);
                tampilkanToastSuksesKirimTugas('Dibatalkan', `Status Pelanggaran Aktif untuk ${murid.nama} sudah dibatalkan.`);
                perbaruiTombolPelanggaranDiKartu(muridId, false);
                return;
            }

            const task = getTasksKelas(taskAktifDipilihUntukRekap.namaKelas).find(t => t.id === taskAktifDipilihUntukRekap.taskId);
            bukaModalKonfirmasiGenerik({
                judul: 'Kasih Pelanggaran',
                pesan: `Jelaskan pelanggaran ${murid.nama} secara spesifik -- teks ini akan langsung dilihat siswa di dashboard-nya.`,
                teksTombol: 'Ya, Kasih Pelanggaran',
                ikon: 'fa-triangle-exclamation',
                warnaTombol: 'rose',
                tampilkanInputKeterangan: true,
                keteranganAwal: task ? `Belum mengerjakan tugas "${task.judul || 'tugas ini'}".` : '',
                onKonfirmasi: function (keterangan) {
                    setPelanggaranAktifUntukUsername(murid.username, true, keterangan);
                    tampilkanToastSuksesKirimTugas('Pelanggaran Diberikan', `${murid.nama} ditandai Pelanggaran Aktif. Overlay peringatan akan muncul saat dashboard-nya dibuka.`);
                    perbaruiTombolPelanggaranDiKartu(muridId, true);
                }
            });
        }

        // Update tampilan SATU tombol "Kasih Pelanggaran" langsung di DOM
        // (warna + teks), tanpa membongkar/merender ulang kartu murid lain
        // ataupun grid secara keseluruhan. Kalau request ke server ternyata
        // gagal, setPelanggaranAktifUntukUsername() di atas sudah menangani
        // rollback-nya sendiri lewat render ulang penuh (jalur error, jarang
        // terjadi) -- jadi jalur normal (sukses) di sini boleh tetap ringan.
        function perbaruiTombolPelanggaranDiKartu(muridId, aktif) {
            const tombol = document.querySelector(
                `#rekap-tugas-grid-bangku button[onclick*="klikTogglePelanggaranSatuMurid(${muridId})"]`
            );
            if (!tombol) return;

            tombol.classList.toggle('bg-rose-600', aktif);
            tombol.classList.toggle('hover:bg-rose-700', aktif);
            tombol.classList.toggle('text-white', aktif);
            tombol.classList.toggle('bg-rose-50', !aktif);
            tombol.classList.toggle('hover:bg-rose-100', !aktif);
            tombol.classList.toggle('text-rose-700', !aktif);
            tombol.classList.toggle('border', !aktif);
            tombol.classList.toggle('border-rose-300', !aktif);
            tombol.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${aktif ? 'Pelanggaran Aktif · Batalkan' : 'Kasih Pelanggaran'}`;
        }

        // Beri pelanggaran ke SEMUA murid di kelas ini yang belum mengerjakan
        // tugas yang sedang dibuka di jendela rekap -- dalam satu klik.
        async function klikKasihPelanggaranSemuaBelumKerja() {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;

            const tasksKelasIni = getTasksKelas(namaKelas);
            const task = tasksKelasIni.find(t => t.id === taskId);
            if (!task) return;

            const kedaluwarsa = cekStatusTugasKedaluwarsaGuru(task);
            const muridKelasIni = sampleMurid30.filter(m => m.kelas === namaKelas);
            // PERBAIKAN PERFORMA: sama seperti di bukaRekapPengumpulanTugas() --
            // tarik hasil periksa semua murid dalam 1 request, bukan 1 per murid.
            const hasilPeriksaBulk = await ambilHasilPeriksaBulkServer(taskId, muridKelasIni.map(m => m.id));
            const belumKerja = muridKelasIni.filter(m => !statusPengumpulanUntukTugas(m, task, kedaluwarsa, hasilPeriksaBulk).submitted);

            if (belumKerja.length === 0) {
                tampilkanToastSuksesKirimTugas('Tidak Ada', 'Semua murid di kelas ini sudah mengerjakan tugas ini.');
                return;
            }

            bukaModalKonfirmasiGenerik({
                judul: 'Kasih Pelanggaran ke Semua yang Belum Kerja?',
                pesan: `Tindakan ini akan menandai ${belumKerja.length} murid yang belum mengerjakan "${task.judul || 'tugas ini'}" sebagai Pelanggaran Aktif. Overlay peringatan akan muncul saat masing-masing membuka dashboard-nya.`,
                teksTombol: 'Ya, Kasih Pelanggaran',
                ikon: 'fa-triangle-exclamation',
                warnaTombol: 'rose',
                tampilkanInputKeterangan: true,
                keteranganAwal: `Belum mengerjakan tugas "${task.judul || 'tugas ini'}" sampai batas waktu yang ditentukan.`,
                onKonfirmasi: function (keterangan) {
                    belumKerja.forEach(m => {
                        setPelanggaranAktifUntukUsername(m.username, true, keterangan);
                        perbaruiTombolPelanggaranDiKartu(m.id, true);
                    });
                    tampilkanToastSuksesKirimTugas('Pelanggaran Diberikan', `${belumKerja.length} murid yang belum mengerjakan tugas ini sudah ditandai Pelanggaran Aktif.`);
                }
            });
        }

        // CATATAN PERBAIKAN: dulu fungsi ini cuma baca data ASLI (task.studentSubmitted)
        // buat murid.id === 1 (akun DEV yang lagi dipakai login browser ini), dan
        // untuk SEMUA murid lain nge-generate status "kumpul" dari hash(id+taskId)
        // -- ~60% peluang, lengkap dengan foto ACAK dari picsum.photos. Akibatnya
        // siswa yang belum pernah login/kirim apa pun bisa muncul "Sudah Kumpul" di
        // Dashboard Guru. Sekarang SEMUA murid (termasuk id #1) dibaca dari data ASLI
        // hasil POST /api/tugas/submit siswa ybs -- lihat ambilSubmisiTugasServer().
        window._cacheSubmisiTugas = window._cacheSubmisiTugas || {};
        // PERBAIKAN PERFORMA (PENTING): versi lama fungsi ini pakai XMLHttpRequest
        // SYNCHRONOUS (xhr.open(..., false)) -- itu bikin SELURUH TAB BROWSER
        // BENAR-BENAR FREEZE (klik, animasi, render kartu murid semuanya macet)
        // selama menunggu balasan server. Karena bukaRekapPengumpulanTugas()
        // dipanggil ulang OTOMATIS lewat 2 callback async begitu jendela ini
        // dibuka (muatPelanggaranAktifDariServer() & sinkronBorderRosterDariServer()
        // di atas), freeze ini bisa terjadi berturut-turut sampai 3x tiap kali
        // jendela dibuka -- inilah yang bikin jendela ini kerasa berat walau
        // jumlah muridnya sedikit (bukan soal jumlah data, tapi network blocking).
        // Sekarang pakai fetch() biasa (non-blocking, async/await) -- sama
        // pola dengan perbaikan getSync() di Dashboard Siswa.
        async function ambilSubmisiTugasServer(taskId) {
            try {
                const res = await fetch(`/api/tugas/submissions/${encodeURIComponent(taskId)}`);
                if (res.ok) {
                    const resJson = await res.json();
                    if (resJson.success) return resJson.submissions || {};
                }
            } catch (e) {
                console.warn('Gagal ambil data pengumpulan tugas dari server:', taskId, e);
            }
            return {};
        }

        function statusPengumpulanUntukTugas(murid, task, kedaluwarsa, hasilPeriksaBulk) {
            // hasilPeriksaBulk (opsional): kalau pemanggil sudah menarik data
            // hasil periksa SEMUA murid sekaligus lewat ambilHasilPeriksaBulkServer()
            // (lihat catatan besar di sana), pakai itu -- supaya TIDAK perlu
            // panggil ambilHasilPeriksaTersimpan() (blocking) lagi per murid.
            const tersimpan = hasilPeriksaBulk
                ? (hasilPeriksaBulk[kunciHasilPeriksaTugas(task.id, murid.id)] || null)
                : ambilHasilPeriksaTersimpan(task.id, murid.id);
            const submisiSemua = window._cacheSubmisiTugas[task.id] || {};
            const entri = submisiSemua[murid.username];

            if (!entri || !entri.submitted) {
                return { submitted: false, waktu: null, nilai: null, catatan: null, fotoTugasList: [] };
            }

            let fotoList = [];
            if (Array.isArray(entri.images) && entri.images.length > 0) fotoList = entri.images;

            return {
                submitted: true,
                waktu: entri.waktu || null,
                nilai: (entri.nilai !== undefined && entri.nilai !== null) ? entri.nilai : (tersimpan ? tersimpan.nilai : null),
                catatan: entri.catatan || (tersimpan ? tersimpan.catatan : null),
                fotoTugasList: fotoList
            };
        }

        // Format timestamp waktuKirimGuru (Date.now() saat tugas dikirim/diedit guru)
        // jadi teks tanggal+jam yang gampang dibaca, mis. "4 September 2026, Pukul
        // 09:15 WIB". Kalau tugas ini tugas lama yang belum punya waktuKirimGuru
        // (dibuat sebelum fitur ini ada), tampilkan keterangan netral.
        function formatWaktuKirimTugasGuru(task) {
            if (!task.waktuKirimGuru) return 'Tidak tercatat';
            const d = new Date(task.waktuKirimGuru);
            if (isNaN(d.getTime())) return 'Tidak tercatat';
            const namaBulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
            const tanggal = d.getDate();
            const bulan = namaBulan[d.getMonth()];
            const tahun = d.getFullYear();
            const jam = String(d.getHours()).padStart(2, '0');
            const menit = String(d.getMinutes()).padStart(2, '0');
            return `${tanggal} ${bulan} ${tahun}, Pukul ${jam}:${menit} WIB`;
        }

        let taskAktifDipilihUntukRekap = null;
        async function bukaRekapPengumpulanTugas(namaKelas, taskId, _dariSinkron) {
            taskAktifDipilihUntukRekap = { namaKelas, taskId };

            // Setiap kali jendela ini dibuka (bukan pas dipanggil ulang dari callback
            // sinkron di atas), tarik dulu data foto/border/efek/title TERBARU tiap
            // siswa dari server -- supaya kalau ada siswa yang baru saja ganti foto
            // profil / border sebelum guru buka rekap ini, tampilannya langsung
            // mengikuti perubahan itu, bukan data lama yang nyangkut di memori.
            if (!_dariSinkron && namaKelas === 'XII TKJ 3') sinkronBorderRosterDariServer();

            const tasksKelasIni = getTasksKelas(namaKelas);
            const task = tasksKelasIni.find(t => t.id === taskId);
            if (!task) {
                alert('Tugas ini tidak ditemukan (mungkin sudah dihapus).');
                return;
            }

            const muridKelasIni = sampleMurid30.filter(m => m.kelas === namaKelas);
            const kelasInfo = daftarSeluruhKelasDummy.find(k => k.nama === namaKelas);

            // PERBAIKAN RESPONSIVITAS (PENTING): dulu jendela ini baru KELIHATAN
            // (classList.remove('hidden')) di paling akhir fungsi, SETELAH kedua
            // fetch di bawah (+ fetch pelanggaran yang terpisah) selesai -- jadi
            // dari klik sampai modal kelihatan, guru cuma lihat layar diam,
            // padahal info kelas/tugas/deadline ini semua sudah ada di memori
            // lokal (getTasksKelas() sudah dari cache, tidak butuh network sama
            // sekali). Sekarang info ini + jendelanya langsung ditampilkan
            // DULUAN (dengan skeleton loading di grid), baru status tiap murid
            // menyusul begitu network selesai -- klik jadi terasa instan.
            document.getElementById('rekap-tugas-badge-kelas').innerText = namaKelas;
            document.getElementById('rekap-tugas-badge-tipe').innerText = task.tipe || 'Tugas';
            document.getElementById('rekap-tugas-text-dikirim').innerText = formatWaktuKirimTugasGuru(task);
            document.getElementById('rekap-tugas-text-deadline').innerText = task.deadline || 'Belum Ditentukan';
            document.getElementById('rekap-tugas-judul').innerText = task.judul || (kelasInfo ? kelasInfo.mapel : '-');
            document.getElementById('rekap-tugas-instruksi').innerText = task.teks || '-';

            const gridContainer = document.getElementById('rekap-tugas-grid-bangku');
            if (!_dariSinkron) {
                gridContainer.innerHTML = Array.from({ length: Math.max(muridKelasIni.length, 1) })
                    .map(() => `<div class="p-3 rounded-2xl border-2 border-slate-200 bg-slate-100 animate-pulse h-28"></div>`)
                    .join('');
            }
            document.getElementById('modal-rekap-pengumpulan-tugas').classList.remove('hidden');

            // Tarik status Pelanggaran Aktif TERBARU (lihat catatan besar di
            // _cachePelanggaranAktifServer di atas) + data pengumpulan tugas ASLI
            // semua siswa + hasil periksa (nilai/catatan) semua siswa SEKALIGUS
            // dalam SATU putaran Promise.all. Dulu status Pelanggaran ditarik
            // TERPISAH lewat pemanggilan ulang seluruh fungsi ini setelah
            // selesai -- artinya 2 putaran network BERURUTAN (nunggu 2x).
            // Sekarang cuma 1 putaran paralel, jadi total waktu tunggu kira-kira
            // cuma selama request yang paling lambat, bukan dua kali lipat.
            const [, submisiTugasHasil, hasilPeriksaBulk] = await Promise.all([
                _dariSinkron ? Promise.resolve() : muatPelanggaranAktifDariServer(),
                ambilSubmisiTugasServer(taskId),
                ambilHasilPeriksaBulkServer(taskId, muridKelasIni.map(m => m.id))
            ]);
            window._cacheSubmisiTugas[taskId] = submisiTugasHasil;

            // Guard anti stale-response: kalau selagi nunggu network di atas,
            // guru sudah keburu tutup jendela ini atau pindah buka tugas LAIN,
            // buang saja hasilnya -- supaya data tugas lama tidak nyelonong
            // render ke jendela yang sekarang sudah beda/tertutup.
            if (!taskAktifDipilihUntukRekap || taskAktifDipilihUntukRekap.taskId !== taskId || taskAktifDipilihUntukRekap.namaKelas !== namaKelas) {
                return;
            }

            const kedaluwarsa = cekStatusTugasKedaluwarsaGuru(task);

            let hitungSudah = 0;
            let hitungBelum = 0;

            if (muridKelasIni.length === 0) {
                gridContainer.innerHTML = `<p class="col-span-full text-center text-slate-400 italic py-6 text-sm">Belum ada data murid untuk kelas ini.</p>`;
            }

            // PERBAIKAN PERFORMA (PENTING): sebelumnya di sini pakai
            // `gridContainer.innerHTML += ...` LANGSUNG di dalam forEach --
            // itu artinya SETIAP iterasi, browser membongkar ulang SEMUA
            // kartu yang sudah dirender (termasuk foto yang sudah ada),
            // lalu parse ULANG semuanya dari nol + kartu baru. Untuk N murid,
            // itu kerjanya ~N kali N (bukan cuma N), dan tiap foto (base64)
            // ikut di-decode ulang tiap kali dibongkar -- inilah sumber utama
            // jendela Rekap kerasa berat & scroll patah-patah, apalagi makin
            // banyak murid di kelas. Sekarang tiap kartu cuma dikumpulkan ke
            // array dulu, baru innerHTML di-set SEKALI di akhir (lihat bawah)
            // -- DOM & semua foto cuma dibangun 1x, bukan N kali.
            const potonganKartuHTML = [];

            muridKelasIni.forEach(m => {
                const status = statusPengumpulanUntukTugas(m, task, kedaluwarsa, hasilPeriksaBulk);
                if (status.submitted) hitungSudah++; else hitungBelum++;

                const penandaPintu = (m.meja === 1) ? `<span class="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">Pintu</span>` : '';
                let cardBangkuStyle, badgeStatusBangku, statusLabelText;

                if (status.submitted) {
                    cardBangkuStyle = 'border-emerald-300 bg-emerald-50/90 hover:bg-emerald-100 text-emerald-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-check"></i></span>`;
                    statusLabelText = `<span class="text-emerald-700 font-bold">${status.nilai ? 'Nilai: ' + status.nilai : status.waktu}</span>`;
                } else if (kedaluwarsa) {
                    cardBangkuStyle = 'border-rose-300 bg-rose-50/70 text-rose-900 shadow-sm opacity-90';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-xmark"></i></span>`;
                    statusLabelText = `<span class="text-rose-600 font-bold italic">Tidak Kumpul</span>`;
                } else {
                    cardBangkuStyle = 'border-blue-200 bg-blue-50/60 text-blue-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-xs shadow-md animate-pulse"><i class="fa-solid fa-hourglass-half"></i></span>`;
                    statusLabelText = `<span class="text-blue-600 font-semibold italic">Belum Kumpul</span>`;
                }

                const bisaDiperiksa = status.submitted;

                // FITUR TAMBAHAN: tombol "Kasih Pelanggaran" -- cuma ditampilkan
                // buat murid yang BELUM mengerjakan tugas ini (baik yang masih
                // aktif "Belum Kumpul" maupun yang sudah lewat "Tidak Kumpul").
                // Warna & teks tombol berubah kalau status pelanggarannya sudah aktif,
                // supaya guru bisa lihat sekilas & batalkan lagi kalau perlu.
                let tombolPelanggaranHTML = '';
                if (!status.submitted) {
                    const sudahPelanggaranAktif = siswaPunyaPelanggaranAktif(m.username);
                    tombolPelanggaranHTML = `
                        <button onclick="event.stopPropagation(); klikTogglePelanggaranSatuMurid(${m.id})" class="w-full py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${sudahPelanggaranAktif ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300'}">
                            <i class="fa-solid fa-triangle-exclamation"></i> ${sudahPelanggaranAktif ? 'Pelanggaran Aktif · Batalkan' : 'Kasih Pelanggaran'}
                        </button>
                    `;
                }

                potonganKartuHTML.push(`
                    <div ${bisaDiperiksa ? `onclick="bukaPeriksaTugasDariRekap(${m.id})"` : ''} class="kartu-rekap-tugas-siswa ${bisaDiperiksa ? 'bisa-diperiksa' : ''} p-3 rounded-2xl border-2 ${cardBangkuStyle} ${bisaDiperiksa ? 'cursor-pointer' : ''} transition-all flex flex-col justify-between space-y-2 relative group overflow-hidden">
                        <div class="flex items-center justify-between gap-1">
                            <span class="text-[10px] font-mono font-bold text-slate-500 truncate">${m.title} ${penandaPintu}</span>
                            ${badgeStatusBangku}
                        </div>
                        <div class="flex items-center gap-2">
                            ${avatarWrapperHTML(m, 'w-8 h-8')}
                            <div class="overflow-hidden">
                                <h5 class="text-xs font-bold truncate">${namaEfekHTML(m)}</h5>
                            </div>
                        </div>
                        <div class="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[10px] font-bold">
                            <span class="text-slate-400">${status.submitted ? 'Kumpul:' : 'Status:'}</span> ${statusLabelText}
                        </div>
                        ${tombolPelanggaranHTML}
                        ${bisaDiperiksa ? `
                        <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/5 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
                            <span class="text-[9px] font-bold text-white bg-slate-900/85 px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
                                <i class="fa-solid fa-image"></i> Lihat Foto & Beri Nilai
                            </span>
                        </div>` : ''}
                    </div>
                `);
            });

            // Satu-satunya penulisan innerHTML untuk seluruh grid -- DOM &
            // semua foto cuma dibangun sekali, tidak peduli berapa jumlah murid.
            if (muridKelasIni.length > 0) {
                gridContainer.innerHTML = potonganKartuHTML.join('');
            }

            document.getElementById('rekap-tugas-badge-sudah').innerText = hitungSudah;
            document.getElementById('rekap-tugas-badge-belum').innerText = hitungBelum;
            document.getElementById('modal-rekap-pengumpulan-tugas').classList.remove('hidden');
        }

        function tutupRekapPengumpulanTugas() {
            document.getElementById('modal-rekap-pengumpulan-tugas').classList.add('hidden');
            // Reset supaya fetch sinkronBorderRosterDariServer() yang masih berjalan
            // di background (dipicu waktu jendela ini dibuka) tidak membuka ulang
            // jendela ini begitu selesai -- sama seperti pola di tutupDetailKelas().
            taskAktifDipilihUntukRekap = null;
        }

        function renderAbsensiSiswa() {
            const tbody = document.getElementById('tabel-absensi-body');
            if(!tbody) return;
            tbody.innerHTML = "";
            sampleMurid30.forEach(m => {
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-6 font-bold text-slate-500">Meja #${m.meja}</td>
                        <td class="py-3 px-6 font-bold text-slate-800">${m.nama}</td>
                        <td class="py-3 px-6 text-center">
                            <input type="radio" name="absensi_${m.id}" value="H" checked class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                        </td>
                        <td class="py-3 px-6 text-center">
                            <input type="radio" name="absensi_${m.id}" value="I" class="w-4 h-4 text-amber-600 focus:ring-amber-500">
                        </td>
                        <td class="py-3 px-6 text-center">
                            <input type="radio" name="absensi_${m.id}" value="S" class="w-4 h-4 text-blue-600 focus:ring-blue-500">
                        </td>
                        <td class="py-3 px-6 text-center">
                            <input type="radio" name="absensi_${m.id}" value="A" class="w-4 h-4 text-rose-600 focus:ring-rose-500">
                        </td>
                    </tr>
                `;
            });
        }

        function simpanAbsensi() {
            const selectKelas = document.getElementById('absensi-select-kelas').value;
            alert(`Presensi harian untuk kelas ${selectKelas} berhasil disimpan ke sistem sekolah!`);
        }

        // Supaya foto tugas yang sudah dikirim siswa TETAP bisa dilihat guru kapan saja
        // (bukan cuma pas baru dikirim), data submission asli (khusus siswa ID#1, yang
        // memang tersambung ke Dashboard Siswa lewat localStorage) selalu ditarik ulang
        // dari tugas yang sungguhan tersimpan, bukan dari data dummy awal. Diambil tugas
        // TERBARU yang sudah dikumpulkan, dicari lintas semua kelas.
        function sinkronkanSubmissionAsliSiswaID1() {
            const m = sampleMurid30.find(s => s.id === 1);
            if (!m) return;

            let ketemu = false;
            let waktuKirimTerbaru = null;
            let nilaiTerbaru = null;
            let fotoTerbaru = [];
            let penandaTerbaru = -Infinity;
            // Kalau ada minimal 1 tugas aktif yang sudah DIBUKA siswa (isViewedByStudent)
            // tapi belum dikirim, berarti tugas itu berstatus "Sedang Dikerjakan" --
            // dipakai renderPenilaianTugas()/bukaIDCardSiswa() untuk status 3-tahap.
            let adaYangSedangDikerjakan = false;

            daftarSeluruhKelasDummy.forEach(k => {
                const tasks = getTasksKelas(k.nama);
                tasks.forEach(t => {
                    if (t.isViewedByStudent && !t.studentSubmitted) adaYangSedangDikerjakan = true;
                    if (!t.studentSubmitted) return;
                    const penanda = t.waktuKirimGuru || 0;
                    if (penanda >= penandaTerbaru) {
                        penandaTerbaru = penanda;
                        ketemu = true;
                        waktuKirimTerbaru = t.waktuKirim || t.studentTime || null;
                        nilaiTerbaru = t.grade || null;
                        if (Array.isArray(t.studentImages) && t.studentImages.length > 0) {
                            fotoTerbaru = t.studentImages;
                        } else if (t.studentImage) {
                            fotoTerbaru = [t.studentImage];
                        } else {
                            fotoTerbaru = [];
                        }
                    }
                });
            });

            m.sudahMengumpulkan = ketemu;
            m.waktuKirim = ketemu ? waktuKirimTerbaru : null;
            m.nilai = ketemu ? nilaiTerbaru : null;
            m.fotoTugasList = ketemu ? fotoTerbaru : [];
            // Status 3-tahap: 'selesai' kalau sudah pernah mengumpulkan salah satu
            // tugas aktif, 'sedang' kalau belum pernah kumpul tapi setidaknya 1 tugas
            // aktif sudah dibuka siswa, selain itu 'belum' (dikirim guru tapi belum
            // pernah dibuka sama sekali oleh siswa).
            m.statusPengerjaan = ketemu ? 'selesai' : (adaYangSedangDikerjakan ? 'sedang' : 'belum');
        }

        function renderPenilaianTugas() {
            sinkronkanSubmissionAsliSiswaID1();
            const tbody = document.getElementById('tabel-penilaian-body');
            if(!tbody) return;
            tbody.innerHTML = "";
            // Status 3-tahap: Belum Dikerjakan (belum pernah dibuka siswa) ->
            // Sedang Dikerjakan (sudah dibuka tapi belum dikirim) -> Sudah Dikerjakan
            // (sudah dikirim, jam kirimnya kebaca di kolom "Waktu Kirim").
            const PETA_BADGE_STATUS_TUGAS = {
                selesai: `<span class="px-3 py-1 bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl"><i class="fa-solid fa-check mr-1"></i> Sudah Dikerjakan</span>`,
                sedang: `<span class="px-3 py-1 bg-blue-100 text-blue-700 font-bold text-xs rounded-xl"><i class="fa-solid fa-pen mr-1"></i> Sedang Dikerjakan</span>`,
                belum: `<span class="px-3 py-1 bg-slate-100 text-slate-500 font-medium text-xs rounded-xl">Belum Dikerjakan</span>`
            };
            const PETA_AKSI_STATUS_TUGAS = {
                sedang: `<span class="text-xs text-blue-500 italic">Sedang dikerjakan siswa...</span>`,
                belum: `<span class="text-xs text-slate-400 italic">Belum dikerjakan</span>`
            };

            sampleMurid30.forEach(m => {
                // Murid selain ID#1 cuma dummy (tidak tersambung ke Dashboard Siswa
                // sungguhan), jadi statusPengerjaan mereka disimpulkan dari
                // sudahMengumpulkan saja (tidak ada data "sedang dikerjakan" untuk dummy).
                const status = m.statusPengerjaan || (m.sudahMengumpulkan ? 'selesai' : 'belum');
                const statusBadge = PETA_BADGE_STATUS_TUGAS[status] || PETA_BADGE_STATUS_TUGAS.belum;

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="py-3 px-6">
                            <div class="font-bold text-slate-800">${m.nama}</div>
                            <div class="text-[10px] text-slate-400">Meja #${m.meja}</div>
                        </td>
                        <td class="py-3 px-6 text-xs text-slate-500 font-mono">${m.waktuKirim || '-'}</td>
                        <td class="py-3 px-6 text-center">${statusBadge}</td>
                        <td class="py-3 px-6 text-center font-extrabold text-blue-600">${m.nilai ? m.nilai : '-'}</td>
                        <td class="py-3 px-6 text-right">
                            ${m.sudahMengumpulkan 
                                ? `<button onclick="periksaSiswa(${m.id})" class="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white font-bold text-xs rounded-lg transition-all">Buka / Beri Nilai</button>` 
                                : (PETA_AKSI_STATUS_TUGAS[status] || PETA_AKSI_STATUS_TUGAS.belum)}
                        </td>
                    </tr>
                `;
            });
        }

        /* ================================================================
           BEL OTOMATIS JAM MENGAJAR
           Begitu guru login & jam saat ini masuk salah satu slot di
           jadwalMengajar, sistem otomatis "connect" ke jadwal itu:
           - Kalau guru BELUM kasih tugas ke kelas itu HARI INI -> dering
             alarm volume full + banner notifikasi muncul.
           - Kalau guru SUDAH kasih tugas ke kelas itu HARI INI -> tidak
             usah dering (dianggap sudah ditangani).
           Catatan: browser modern kadang memblokir audio otomatis sebelum
           ada interaksi user sama sekali di halaman (autoplay policy),
           tapi begitu guru sempat klik apa pun di dashboard, bel ini
           akan bisa bunyi normal.
           ================================================================ */
        let audioCtxBel = null;
        let belOscillators = [];
        let belTimeoutId = null;

        // Cek apakah guru sudah mengirim tugas ke kelas tsb pada tanggal hari ini
        function sudahAdaTugasHariIniUntukKelas(namaKelas) {
            const tasks = getTasksKelas(namaKelas);
            const now = new Date();
            return tasks.some(t => {
                if (!t.waktuKirimGuru) return false;
                const d = new Date(t.waktuKirimGuru);
                return d.getFullYear() === now.getFullYear() &&
                       d.getMonth() === now.getMonth() &&
                       d.getDate() === now.getDate();
            });
        }

        function getTanggalHariIniKey() {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        }

        // Supaya 1 sesi jadwal cuma dicek/dibunyikan SEKALI per hari
        // (bukan tiap detik selama sesi itu masih ONGOING), disimpan ke
        // localStorage yang otomatis "reset" tiap ganti tanggal.
        function getSesiBelSudahDicekHariIni() {
            const raw = localStorage.getItem(`bel_sesi_dicek_${getTanggalHariIniKey()}`);
            return raw ? JSON.parse(raw) : [];
        }
        function tandaiSesiBelSudahDicek(kunci) {
            const list = getSesiBelSudahDicekHariIni();
            if (!list.includes(kunci)) {
                list.push(kunci);
                localStorage.setItem(`bel_sesi_dicek_${getTanggalHariIniKey()}`, JSON.stringify(list));
            }
        }

        function mulaiBunyikanBel() {
            try {
                if (!audioCtxBel) audioCtxBel = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtxBel.state === 'suspended') audioCtxBel.resume();

                let kali = 0;
                const totalDering = 6;
                function bunyiSatuKali() {
                    const osc = audioCtxBel.createOscillator();
                    const gain = audioCtxBel.createGain();
                    osc.type = 'square';
                    osc.frequency.value = 880;
                    gain.gain.value = 1.0; // volume dering full/maksimal
                    osc.connect(gain);
                    gain.connect(audioCtxBel.destination);
                    osc.start();
                    osc.stop(audioCtxBel.currentTime + 0.35);
                    belOscillators.push(osc);
                    kali++;
                    if (kali < totalDering) belTimeoutId = setTimeout(bunyiSatuKali, 500);
                }
                bunyiSatuKali();
            } catch (e) {
                console.warn('Gagal memutar bel otomatis:', e);
            }
        }

        function matikanBelMengajar() {
            if (belTimeoutId) clearTimeout(belTimeoutId);
            belOscillators.forEach(o => { try { o.stop(); } catch (e) {} });
            belOscillators = [];
            const banner = document.getElementById('banner-bel-mengajar');
            if (banner) banner.classList.add('hidden');
        }

        function tampilkanBannerBel(item) {
            const banner = document.getElementById('banner-bel-mengajar');
            const detail = document.getElementById('banner-bel-detail');
            if (detail) detail.innerText = `${item.kelas} • ${item.mapel} • ${item.jam}`;
            if (banner) banner.classList.remove('hidden');
        }

        function cekBelJamMengajarOtomatis() {
            const sudahDicek = getSesiBelSudahDicekHariIni();
            jadwalMengajar.forEach(item => {
                if (getScheduleStatus(item.start, item.end) !== "ONGOING") return;

                const kunci = `${item.kelas}|${item.jam}`;
                if (sudahDicek.includes(kunci)) return;
                tandaiSesiBelSudahDicek(kunci);

                // Guru sudah kasih tugas ke kelas ini hari ini -> tidak usah dering
                if (sudahAdaTugasHariIniUntukKelas(item.kelas)) return;

                tampilkanBannerBel(item);
                mulaiBunyikanBel();
            });
        }

        function getScheduleStatus(startStr, endStr) {
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            let [sH, sM] = startStr.split(':').map(Number);
            let [eH, eM] = endStr.split(':').map(Number);
            const startMins = sH * 60 + sM;
            const endMins = eH * 60 + eM;

            if (currentMins >= startMins && currentMins <= endMins) return "ONGOING";
            if (currentMins > endMins) return "FINISHED";
            return "UPCOMING";
        }

        function renderTeacherSchedule() {
            const container = document.getElementById('today-teacher-schedule');
            if (!container) return;
            const now = new Date();
            const namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][now.getDay()];
            const dayBadge = document.getElementById('current-day-badge');
            if(dayBadge) dayBadge.innerText = namaHari;
            const daySubtitle = document.getElementById('current-day-subtitle');
            if(daySubtitle) daySubtitle.innerText = `Hari ${namaHari} (Aktif)`;
            container.innerHTML = "";

            jadwalMengajar.forEach(item => {
                const status = getScheduleStatus(item.start, item.end);
                let cardStyle = "", badgeStyle = "", statusLabel = "";
                if (status === "ONGOING") {
                    cardStyle = "border-emerald-200 bg-emerald-50";
                    badgeStyle = "bg-emerald-100 text-emerald-700 font-extrabold";
                    statusLabel = `<span class="text-[10px] font-extrabold uppercase text-emerald-700">Sedang Berlangsung</span>`;
                } else if (status === "FINISHED") {
                    cardStyle = "border-slate-200 bg-white opacity-75";
                    badgeStyle = "bg-slate-100 text-slate-500 font-bold";
                    statusLabel = `<span class="text-[10px] font-extrabold uppercase text-slate-400"><i class="fa-solid fa-check mr-1"></i> Selesai</span>`;
                } else {
                    cardStyle = "border-slate-200 bg-white";
                    badgeStyle = "bg-blue-50 text-blue-600 font-bold";
                    statusLabel = `<span class="text-[10px] font-extrabold uppercase text-slate-500">Akan Datang</span>`;
                }

                container.innerHTML += `
                    <div class="p-3.5 rounded-xl border ${cardStyle} transition-all space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-mono font-bold ${badgeStyle} px-2.5 py-1 rounded-lg">${item.jam}</span>
                            ${statusLabel}
                        </div>
                        <h4 class="font-bold text-slate-900 text-sm">${item.kelas}</h4>
                        <p class="text-[11px] text-slate-500">${item.mapel}</p>
                    </div>
                `;
            });
        }

        let kelasAktifDipilih = '';
        function bukaDetailKelas(namaKelas, jurusan, mapel, badgeJurusan, imgUrl) {
            kelasAktifDipilih = namaKelas;
            // Sinkron ulang border/foto/title dari server tiap kali Denah Kelas XII TKJ 3
            // dibuka (bukan cuma sekali pas awal load halaman) -- supaya kalau ada murid
            // yang baru saja ganti border/foto sebelum guru buka jendela ini, datanya
            // ikut fresh. Cuma 1x fetch ringan (4 siswa), bukan polling terus-menerus,
            // jadi tetap murah/tidak bikin berat.
            if (namaKelas === 'XII TKJ 3') sinkronBorderRosterDariServer();
            document.getElementById('modal-nama-kelas').innerText = namaKelas;
            document.getElementById('modal-mapel').innerText = mapel;
            document.getElementById('modal-badge-jurusan').innerText = jurusan;
            document.getElementById('modal-img-kelas').src = imgUrl;

            // Mini header di dalam kartu "Tabel Siswa" (versi kartu bertumpuk) --
            // dibikin terpisah dari header utama modal supaya konteks kelas/mapel
            // tetap kebaca meski guru sudah scroll jauh ke bawah daftar murid.
            const tsmMiniNama = document.getElementById('tsm-mini-nama-kelas');
            if (tsmMiniNama) tsmMiniNama.innerText = namaKelas;
            const tsmMiniMapel = document.getElementById('tsm-mini-mapel');
            if (tsmMiniMapel) tsmMiniMapel.innerText = mapel;

            const tasksKelasIni = getTasksKelas(namaKelas);
            let deadlineText = "Belum Ditentukan";
            let deadlineTimestamp = null;
            let statusSiswa1 = false;
            let waktuSiswa1 = null;
            let nilaiSiswa1 = null;
            let fotoSiswa1 = [];

            // Tugas yang sudah LEWAT deadline & TIDAK dikumpulkan dianggap "usai/hangus"
            // buat penentuan status di Denah Kelas ini -- riwayatnya tetap tercatat
            // "Tidak Dikerjakan" di Riwayat Pengumpulan Dashboard Siswa, tapi begitu
            // deadline-nya lewat, tugas itu TIDAK lagi dihitung sebagai "tugas aktif"
            // di sini. Efeknya: begitu deadline lewat tanpa dikumpulkan, status siswa
            // otomatis balik jadi "Belum Ada Tugas" (bukan nyangkut selamanya di status
            // "Terlambat") -- kecuali memang masih ada tugas LAIN (dari guru yang sama
            // atau guru lain) yang belum expired, statusnya ikut tugas itu.
            // Tugas yang SUDAH dikumpulkan tetap dihitung relevan apapun waktunya,
            // supaya nilai/waktu kirimnya tetap kebaca guru.
            const cekMasihExpiredSaatIni = new Date().getTime();
            const tugasRelevan = tasksKelasIni.filter(t => {
                if (t.studentSubmitted) return true;
                if (!t.deadlineTimestamp) return true;
                return cekMasihExpiredSaatIni < t.deadlineTimestamp;
            });
            let hasActiveTask = tugasRelevan.length > 0;

            if (hasActiveTask) {
                deadlineText = tugasRelevan.length > 1
                    ? `${tugasRelevan.length} tugas aktif`
                    : (tugasRelevan[0].deadline || "Belum Ditentukan");

                // Deadline buat cek keterlambatan cuma diambil dari tugas yang BELUM
                // dikumpulkan (yang sudah dikumpulkan tidak relevan buat penentuan
                // "masih dikerjakan/sudah expired") -- dan karena tugasRelevan di atas
                // sudah menyaring tugas expired-tak-dikumpulkan, deadline di sini
                // dipastikan selalu masih berlaku (belum lewat).
                const belum = tugasRelevan.filter(t => !t.studentSubmitted);
                const timestampsBelum = belum.map(t => t.deadlineTimestamp).filter(Boolean);
                if (timestampsBelum.length) deadlineTimestamp = Math.min(...timestampsBelum);

                statusSiswa1 = belum.length === 0;
                const sudahList = tugasRelevan.filter(t => t.studentSubmitted);
                if (sudahList.length) {
                    const terakhir = sudahList[sudahList.length - 1];
                    waktuSiswa1 = terakhir.studentTime || "08:15 WIB";
                    nilaiSiswa1 = terakhir.grade || null;
                    // Siswa sekarang bisa kirim banyak foto sekaligus (studentImages), jadi
                    // semuanya ditampung di sini supaya bisa dilihat guru di modal periksa.
                    if (Array.isArray(terakhir.studentImages) && terakhir.studentImages.length > 0) {
                        fotoSiswa1 = terakhir.studentImages;
                    } else if (terakhir.studentImage) {
                        fotoSiswa1 = [terakhir.studentImage];
                    }
                }
            }

            document.getElementById('modal-text-tenggat').innerText = deadlineText;
            const tsmMiniBadge = document.getElementById('tsm-mini-badge');
            if (tsmMiniBadge) tsmMiniBadge.innerText = deadlineText;
            const currentTime = new Date().getTime();
            const isExpired = (deadlineTimestamp && currentTime >= deadlineTimestamp);

            // Isi daftar tugas aktif kelas ini (guru pemberi + judul + deadline)
            // -- tugasRelevan di atas sudah difilter cuma yang masih aktif/belum
            // expired (atau sudah dikumpulkan), jadi ini persis daftar yang
            // relevan buat guru lihat "siapa ngasih apa" di kelas ini.
            const containerTugasAktif = document.getElementById('list-tugas-aktif-kelas');
            if (containerTugasAktif) {
                if (tugasRelevan.length === 0) {
                    containerTugasAktif.innerHTML = `<p class="sm:col-span-2 text-xs text-slate-400 italic py-2">Belum ada tugas aktif di kelas ini.</p>`;
                } else {
                    containerTugasAktif.innerHTML = tugasRelevan.map(t => {
                        const namaGuruTugas = t.namaGuru || 'Guru Mata Pelajaran';
                        const sudahLewat = t.deadlineTimestamp && cekMasihExpiredSaatIni >= t.deadlineTimestamp && !t.studentSubmitted;
                        return `
                            <div class="bg-white border border-slate-200 rounded-xl p-3">
                                <p class="text-[10px] font-extrabold text-blue-600 uppercase tracking-wide"><i class="fa-solid fa-chalkboard-user mr-1"></i>${namaGuruTugas}</p>
                                <p class="text-sm font-bold text-slate-900 mt-1 truncate" title="${t.judul || ''}">${t.judul || '(tanpa judul)'}</p>
                                <p class="text-[11px] text-slate-500 mt-0.5">${t.tipe || 'Tugas'}</p>
                                <p class="text-[11px] font-mono mt-1.5 ${sudahLewat ? 'text-rose-600 font-bold' : 'text-amber-600 font-bold'}">
                                    <i class="fa-regular fa-clock mr-1"></i>${t.deadline || 'Belum Ditentukan'}
                                </p>
                            </div>
                        `;
                    }).join('');
                }
            }

            let hitungSudah = 0;
            let hitungBelum = 0;
            const gridContainer = document.getElementById('modal-grid-bangku');
            const tbodyContainer = document.getElementById('modal-tabel-murid');

            // Roster murid cuma ditampilkan kalau memang terdaftar di kelas yang
            // sedang dibuka (m.kelas === namaKelas). Untuk saat ini cuma AHMAD &
            // SYAM yang punya "kelas" (XII TKJ 3), jadi kalau guru buka kelas lain
            // (mis. XII TAV 1), daftar muridnya kosong dulu.
            const muridKelasIni = sampleMurid30.filter(m => m.kelas === namaKelas);

            if (muridKelasIni.length === 0) {
                gridContainer.innerHTML = `<p class="col-span-full text-center text-slate-400 italic py-6 text-sm">Belum ada data murid untuk kelas ini.</p>`;
                tbodyContainer.innerHTML = `<p class="text-center text-slate-400 italic py-6 text-sm">Belum ada data murid untuk kelas ini.</p>`;
            }

            // PERBAIKAN PERFORMA (PENTING, buat HP & laptop low-end): dulu di
            // bawah ini dua kontainer (grid kursi + tabel murid) ditulis pakai
            // `.innerHTML += ...` LANGSUNG di dalam forEach yang sama -- artinya
            // SETIAP murid, browser membongkar ulang SEMUA kartu+baris+foto yang
            // sudah dirender sebelumnya lalu parse ulang semua dari nol. Untuk N
            // murid itu kerjanya ~N kali N, DAN dobel (grid maupun tabel sama-sama
            // kena), plus tiap foto avatar ikut didekode ulang tiap kali dibongkar
            // -- makin banyak murid di kelas, makin lama & makin nge-lag/nyendat
            // waktu modal Denah Kelas ini dibuka (paling kerasa di HP/laptop
            // low-end). Sekarang tiap kartu/baris cuma dikumpulkan ke array dulu,
            // baru innerHTML di-set SEKALI di akhir loop (pola sama seperti
            // bukaRekapPengumpulanTugas()) -- DOM & semua foto cuma dibangun 1x.
            const potonganGridHTML = [];
            const potonganTabelHTML = [];

            muridKelasIni.forEach((m) => {
                let isCheck = m.sudahMengumpulkan;
                let waktuKirim = m.waktuKirim;
                let nilaiSiswa = m.nilai;

                if (m.id === 1) {
                    isCheck = statusSiswa1;
                    waktuKirim = waktuSiswa1;
                    nilaiSiswa = nilaiSiswa1;
                    m.sudahMengumpulkan = isCheck;
                    m.waktuKirim = waktuKirim;
                    m.nilai = nilaiSiswa;
                    m.fotoTugasList = fotoSiswa1;
                }

                if (isCheck) hitungSudah++;
                else hitungBelum++;

                const penandaPintu = (m.meja === 1) ? `<span class="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">Pintu</span>` : '';
                let cardBangkuStyle = "";
                let badgeStatusBangku = "";
                let statusLabelText = "";

                if (isCheck) {
                    cardBangkuStyle = 'border-emerald-300 bg-emerald-50/90 hover:bg-emerald-100 text-emerald-900 cursor-pointer shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-check"></i></span>`;
                    statusLabelText = `<span class="text-emerald-700 font-bold">${nilaiSiswa ? 'Nilai: ' + nilaiSiswa : waktuKirim}</span>`;
                } else if (isExpired) {
                    cardBangkuStyle = 'border-rose-300 bg-rose-50/70 text-rose-900 cursor-pointer shadow-sm opacity-90';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-lock"></i></span>`;
                    statusLabelText = `<span class="text-rose-600 font-bold italic">Terlambat</span>`;
                } else if (hasActiveTask) {
                    cardBangkuStyle = 'border-blue-200 bg-blue-50/60 text-blue-900 cursor-pointer shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-xs shadow-md animate-pulse"><i class="fa-solid fa-spinner"></i></span>`;
                    statusLabelText = `<span class="text-blue-600 font-semibold italic">Mengerjakan</span>`;
                } else {
                    cardBangkuStyle = 'border-slate-200 bg-white text-slate-700 cursor-pointer shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-amber-400 text-white flex items-center justify-center font-black text-xs shadow-md">-</span>`;
                    statusLabelText = `<span class="text-slate-400 italic">Standby</span>`;
                }

                // Render Denah Grid Card
                potonganGridHTML.push(`
                    <div onclick="periksaSiswa(${m.id})" class="p-3 rounded-2xl border-2 ${cardBangkuStyle} transition-all flex flex-col justify-between space-y-2 relative group">
                        <div class="flex items-center justify-between gap-1">
                            <span class="text-[10px] font-mono font-bold text-slate-500 truncate">${m.title} ${penandaPintu}</span>
                            ${badgeStatusBangku}
                        </div>
                        <div class="flex items-center gap-2">
                            ${avatarWrapperHTML(m, 'w-8 h-8')}
                            <div class="overflow-hidden">
                                <h5 class="text-xs font-bold truncate">${namaEfekHTML(m)}</h5>
                            </div>
                        </div>
                        <div class="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[10px] font-bold">
                            <span class="text-slate-400">Status:</span> ${statusLabelText}
                        </div>
                    </div>
                `);

                // Render Tabel Khusus Siswa -- versi kartu bertumpuk (tsm-row).
                // "#" nomor urut TIDAK dipakai lagi di sini -- diganti foto profil
                // + border siswa yang sedang dipakai (avatarWrapperHTML), nomor
                // meja cuma jadi badge kecil nempel di sudut foto biar tetap ada
                // infonya tanpa jadi elemen utama. Satu tugas = satu status
                // singkat, dan seluruh baris bisa diklik langsung buka
                // periksaSiswa() (gantiin tombol "Periksa & Nilai" yang panjang).
                let statusPillTabel = "";
                if (isCheck) {
                    statusPillTabel = `<span class="tsm-status-pill tsm-status-hijau"><i class="fa-solid fa-circle-check"></i> ${nilaiSiswa ? 'Nilai ' + nilaiSiswa : 'Terkumpul'}</span>`;
                } else if (isExpired) {
                    statusPillTabel = `<span class="tsm-status-pill tsm-status-merah"><i class="fa-solid fa-circle-xmark"></i> Terlambat</span>`;
                } else if (hasActiveTask) {
                    statusPillTabel = `<span class="tsm-status-pill tsm-status-biru"><i class="fa-solid fa-spinner fa-spin"></i> Mengerjakan</span>`;
                } else {
                    statusPillTabel = `<span class="tsm-status-pill tsm-status-kuning"><i class="fa-solid fa-info-circle"></i> Belum Ada Tugas</span>`;
                }

                const lencanaEkstra = [];
                if (m.title === 'DEV') lencanaEkstra.push(`<span class="tsm-badge-dev badge-dev"><i class="fa-solid fa-crown"></i> DEV</span>`);
                if (m.meja === 1) lencanaEkstra.push(`<span class="tsm-badge-pintu">Pintu</span>`);
                if (m.efek === 'gold-name') lencanaEkstra.push(`<span class="tsm-badge-efek"><i class="fa-solid fa-wand-magic-sparkles"></i> Emas</span>`);

                potonganTabelHTML.push(`
                    <div class="tsm-row" onclick="periksaSiswa(${m.id})">
                        <div class="tsm-avatar-wrap">
                            ${avatarWrapperHTML(m, 'w-10 h-10')}
                        </div>
                        <div class="tsm-main">
                            ${lencanaEkstra.length ? `<div class="tsm-badges">${lencanaEkstra.join('')}</div>` : ''}
                            <div class="tsm-nama">${namaEfekHTML(m)}</div>
                            <div class="tsm-id">MURID-${m.id}</div>
                        </div>
                        <div class="tsm-status">
                            ${statusPillTabel}
                        </div>
                        <i class="fa-solid fa-chevron-right tsm-chevron"></i>
                    </div>
                `);
            });

            // Satu-satunya penulisan innerHTML untuk grid & tabel -- DOM & semua
            // foto cuma dibangun sekali, tidak peduli berapa jumlah murid.
            if (muridKelasIni.length > 0) {
                gridContainer.innerHTML = potonganGridHTML.join('');
                tbodyContainer.innerHTML = potonganTabelHTML.join('');
            }

            document.getElementById('badge-count-sudah').innerText = hitungSudah;
            document.getElementById('badge-count-belum').innerText = hitungBelum;
            document.getElementById('modal-detail-kelas').classList.remove('hidden');
        }

        function tutupDetailKelas() {
            document.getElementById('modal-detail-kelas').classList.add('hidden');
            // Reset supaya fetch sinkronBorderRosterDariServer() yang masih berjalan
            // di background (dipicu waktu modal ini dibuka) tidak buka ulang jendela
            // ini begitu selesai -- itu penyebab bug "tutup jendela lalu muncul lagi".
            kelasAktifDipilih = '';
        }

        function setModeView(mode) {
            const btnDenah = document.getElementById('btn-view-denah');
            const btnTabel = document.getElementById('btn-view-tabel');
            const denahCont = document.getElementById('view-denah-container');
            const tabelCont = document.getElementById('view-tabel-container');

            if (mode === 'denah') {
                btnDenah.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-white text-slate-900 shadow";
                btnTabel.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-200 hover:text-white";
                denahCont.classList.remove('hidden');
                tabelCont.classList.add('hidden');
            } else {
                btnTabel.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-white text-slate-900 shadow";
                btnDenah.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all text-slate-200 hover:text-white";
                tabelCont.classList.remove('hidden');
                denahCont.classList.add('hidden');
            }
        }

        let siswaAktifDiPeriksa = null;
        // Dua "pintu masuk" berbeda pakai modal #modal-periksa yang sama:
        // - 'detail'  -> dibuka dari Denah Bangku di tab Detail Kelas (periksaSiswa)
        // - 'rekap'   -> dibuka dari kartu siswa di "Rekap Pengumpulan per Tugas"
        //                (bukaPeriksaTugasDariRekap), scoped ke SATU tugas spesifik
        let periksaModeAktif = 'detail';
        let rekapAktifDiPeriksa = null; // { namaKelas, taskId, idSiswa }

        // Dibuka dari kartu siswa di modal "Rekap Pengumpulan per Tugas" (grid
        // hasil bukaRekapPengumpulanTugas). Beda dari periksaSiswa() di bawah,
        // ini scoped ke SATU tugas yang sedang dibuka (taskAktifDipilihUntukRekap),
        // jadi foto/nilai/pesan yang tampil & disimpan memang benar-benar milik
        // tugas itu, bukan status umum siswa di kelas.
        async function bukaPeriksaTugasDariRekap(idSiswa) {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;
            const tasksKelasIni = getTasksKelas(namaKelas);
            const task = tasksKelasIni.find(t => t.id === taskId);
            const murid = sampleMurid30.find(m => m.id === idSiswa);
            if (!task || !murid) return;

            const kedaluwarsa = cekStatusTugasKedaluwarsaGuru(task);
            // PERBAIKAN PERFORMA: dulu di sini manggil statusPengumpulanUntukTugas()
            // TANPA hasilPeriksaBulk -- itu artinya jatuh ke
            // ambilHasilPeriksaTersimpan() yang pakai getSync() (XHR SINKRON,
            // bisa membekukan seluruh tab). Sekarang ambil hasil periksa murid
            // ini dulu lewat fetch async biasa (bulk isi 1 murid, pola sama
            // dengan ambilHasilPeriksaBulkServer di bukaRekapPengumpulanTugas).
            const hasilPeriksaBulk = await ambilHasilPeriksaBulkServer(taskId, [murid.id]);
            const status = statusPengumpulanUntukTugas(murid, task, kedaluwarsa, hasilPeriksaBulk);
            if (!status.submitted) {
                alert(`⚠️ INFO: ${murid.nama} belum/tidak mengumpulkan tugas ini.`);
                return;
            }

            periksaModeAktif = 'rekap';
            rekapAktifDiPeriksa = { namaKelas, taskId, idSiswa };

            document.getElementById('periksa-nama-siswa').innerText = `${murid.nama} (Meja #${murid.meja})`;
            document.getElementById('input-nilai-angka').value = status.nilai || '';
            document.getElementById('input-catatan-guru').value = status.catatan || '';

            const previewContainer = document.getElementById('periksa-preview-berkas');
            const daftarFoto = status.fotoTugasList || [];
            if (daftarFoto.length > 0) {
                previewContainer.innerHTML = `
                    <div class="w-full h-full overflow-y-auto p-2.5">
                        <p class="text-[10px] font-bold text-slate-500 mb-2">${daftarFoto.length} foto dikirim — klik salah satu untuk lihat ukuran penuh</p>
                        <div class="grid grid-cols-3 gap-2">
                            ${daftarFoto.map(src => `<img src="${src}" onclick="window.open(this.src, '_blank')" class="w-full h-24 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-all" alt="Tugas Siswa" loading="lazy" decoding="async">`).join('')}
                        </div>
                    </div>`;
            } else {
                previewContainer.innerHTML = `<span class="text-xs text-slate-400 italic">File dikirim dalam bentuk teks/dokumen digital.</span>`;
            }
            document.getElementById('modal-periksa').classList.remove('hidden');
        }

        function periksaSiswa(idSiswa) {
            periksaModeAktif = 'detail';
            rekapAktifDiPeriksa = null;
            if (idSiswa === 1) sinkronkanSubmissionAsliSiswaID1();
            const siswa = sampleMurid30.find(s => s.id === idSiswa);
            if (!siswa) return;
            if (!siswa.sudahMengumpulkan) {
                alert(`⚠️ INFO: ${siswa.nama} belum/tidak mengumpulkan tugas.`);
                return;
            }
            siswaAktifDiPeriksa = siswa;
            document.getElementById('periksa-nama-siswa').innerText = `${siswa.nama} (Meja #${siswa.meja})`;
            document.getElementById('input-nilai-angka').value = siswa.nilai || '';
            
            const previewContainer = document.getElementById('periksa-preview-berkas');
            const daftarFoto = (Array.isArray(siswa.fotoTugasList) && siswa.fotoTugasList.length > 0)
                ? siswa.fotoTugasList
                : (siswa.fotoTugas ? [siswa.fotoTugas] : []);

            if (daftarFoto.length > 0) {
                previewContainer.innerHTML = `
                    <div class="w-full h-full overflow-y-auto p-2.5">
                        <p class="text-[10px] font-bold text-slate-500 mb-2">${daftarFoto.length} foto dikirim — klik salah satu untuk lihat ukuran penuh</p>
                        <div class="grid grid-cols-3 gap-2">
                            ${daftarFoto.map(src => `<img src="${src}" onclick="window.open(this.src, '_blank')" class="w-full h-24 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-all" alt="Tugas Siswa" loading="lazy" decoding="async">`).join('')}
                        </div>
                    </div>`;
            } else {
                previewContainer.innerHTML = `<span class="text-xs text-slate-400 italic">File dikirim dalam bentuk teks/dokumen digital.</span>`;
            }
            document.getElementById('modal-periksa').classList.remove('hidden');
        }

        function tutupPeriksaSiswa() {
            document.getElementById('modal-periksa').classList.add('hidden');
            periksaModeAktif = 'detail';
            rekapAktifDiPeriksa = null;
        }

        function simpanNilaiSiswa() {
            const nilaiVal = document.getElementById('input-nilai-angka').value;
            const catatanVal = document.getElementById('input-catatan-guru').value.trim();
            if (!nilaiVal) {
                alert("Harap masukkan nilai angka untuk siswa ini.");
                return;
            }

            // Mode 'rekap': nilai & pesan disimpan scoped ke (tugas, siswa) yang
            // sedang dibuka dari "Rekap Pengumpulan per Tugas", lalu grid-nya
            // di-refresh supaya "Kumpul: ..." langsung berubah jadi "Nilai: ...".
            if (periksaModeAktif === 'rekap' && rekapAktifDiPeriksa) {
                const { namaKelas, taskId, idSiswa } = rekapAktifDiPeriksa;
                setSync(kunciHasilPeriksaTugas(taskId, idSiswa), { nilai: nilaiVal, catatan: catatanVal });

                // Siswa ID #1 adalah akun asli yang benar-benar kirim tugas dari
                // Dashboard Siswa -- nilainya disinkronkan juga ke field `grade`
                // pada objek tugas itu sendiri (pola lama), supaya tempat lain
                // yang baca task.grade tetap konsisten.
                if (idSiswa === 1) {
                    const tasks = getTasksKelas(namaKelas);
                    const idx = tasks.findIndex(t => t.id === taskId);
                    if (idx > -1) {
                        tasks[idx].grade = nilaiVal;
                        saveTasksKelas(namaKelas, tasks);
                    }
                }

                alert(`✅ Nilai (${nilaiVal}) berhasil disimpan${catatanVal ? ' beserta pesan untuk siswa' : ''}.`);
                tutupPeriksaSiswa();
                bukaRekapPengumpulanTugas(namaKelas, taskId, true);
                hitungDanTampilkanPerluDinilai();
                return;
            }

            if (siswaAktifDiPeriksa) {
                siswaAktifDiPeriksa.nilai = nilaiVal;
                if (siswaAktifDiPeriksa.id === 1) {
                    const tasks = getTasksKelas(kelasAktifDipilih);
                    const sudahList = tasks.filter(t => t.studentSubmitted);
                    if (sudahList.length) {
                        const terakhir = sudahList[sudahList.length - 1];
                        const idx = tasks.findIndex(t => t.id === terakhir.id);
                        tasks[idx].grade = nilaiVal;
                        saveTasksKelas(kelasAktifDipilih, tasks);
                    }
                }
            }
            alert(`Nilai Berhasil Disimpan! Siswa telah diberi nilai ${nilaiVal}.`);
            tutupPeriksaSiswa();
            bukaanganUlangDetailKelas();
            hitungDanTampilkanPerluDinilai();
        }

        function bukaanganUlangDetailKelas() {
            const k = daftarSeluruhKelasDummy.find(item => item.nama === kelasAktifDipilih);
            if (k) {
                bukaDetailKelas(k.nama, k.jurusan, k.mapel, k.jurusan, k.img);
            }
        }

        // ============ HELPER RENDER: Avatar / Nama Efek / Title Badge ============
        // Untuk siswa "border_emas" (AHMAD FAKHRI AL FARISI), pakai markup & class PERSIS
        // sama seperti di dashboard_siswa.html (.profile-wrapper/.user-avatar/.user-border/.gold-name/.badge-dev)
        // supaya border & efek namanya benar-benar identik, bukan tiruan warna saja.
        // Untuk 29 siswa dummy lainnya, dipakai style umum karena mereka data simulasi.
        function avatarWrapperHTML(m, sizeClass) {
            if (m.border === 'border_emas') {
                return `
                    <div class="border-emas-avatar ${sizeClass}">
                        <img src="${m.foto}" alt="Foto ${m.nama}" loading="lazy" decoding="async">
                    </div>`;
            }
            const genericBorderMap = {
                "Border Neon Biru": "ring-2 ring-blue-400",
                "Border Emas Klasik": "ring-2 ring-amber-400",
                "Border Cyberpunk": "ring-2 ring-fuchsia-500",
                "Border Polos": "ring-2 ring-slate-300",
                "Border Neon Ungu": "ring-2 ring-purple-400",
                "Border Gradasi Api": "ring-2 ring-orange-400"
            };
            const ring = genericBorderMap[m.border] || "ring-2 ring-slate-300";
            return `<img src="${m.foto}" class="${sizeClass} rounded-full object-cover shadow-sm ${ring} flex-shrink-0" alt="Foto ${m.nama}" loading="lazy" decoding="async">`;
        }

        function namaEfekHTML(m) {
            if (m.efek === 'gold-name') {
                return `<span class="gold-name-text">${m.nama}</span>`;
            }
            return `<span>${m.nama}</span>`;
        }

        function titleBadgeHTML(m) {
            if (m.title === 'DEV') {
                return `<span class="badge-dev px-2 py-0.5 text-[10px] font-bold bg-amber-400 text-slate-900 rounded-md shadow-sm"><i class="fa-solid fa-crown text-[8px] mr-0.5"></i> DEV</span>`;
            }
            return `<span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-extrabold border border-amber-200">${m.title}</span>`;
        }

        function labelBorder(m) {
            return m.border === 'border_emas' ? 'Border Emas' : m.border;
        }
        function labelEfek(m) {
            return m.efek === 'gold-name' ? 'Efek Emas (Gold Name)' : m.efek;
        }

        // ============ PENCARIAN GLOBAL (Header) ============
        function daftarSiswaUnikUntukPencarian() {
            const seen = new Set();
            const hasil = [];
            sampleMurid30.forEach(m => {
                if (!seen.has(m.nama)) {
                    seen.add(m.nama);
                    hasil.push(m);
                }
            });
            return hasil;
        }

        function renderHasilPencarianGlobal(query) {
            const dropdown = document.getElementById('dropdown-hasil-pencarian');
            const q = (query || '').trim().toLowerCase();

            if (!q) {
                dropdown.classList.add('hidden');
                dropdown.innerHTML = '';
                return;
            }

            const daftarUnik = daftarSiswaUnikUntukPencarian();
            const hasilCocok = daftarUnik.filter(m => m.nama.toLowerCase().includes(q)).slice(0, 8);

            if (hasilCocok.length === 0) {
                dropdown.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 font-medium">Tidak ada siswa dengan nama "${query}" ditemukan.</div>`;
                dropdown.classList.remove('hidden');
                return;
            }

            dropdown.innerHTML = hasilCocok.map(m => `
                <div onclick="pilihHasilPencarian(${m.id})" class="flex items-center gap-3 p-2.5 rounded-xl hover:bg-blue-50 cursor-pointer transition-all">
                    ${avatarWrapperHTML(m, 'w-10 h-10')}
                    <div class="flex-1 overflow-hidden">
                        <p class="text-xs font-extrabold truncate">${namaEfekHTML(m)}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                            ${titleBadgeHTML(m)}
                            <span class="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded font-bold border border-purple-100">${labelEfek(m)}</span>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-slate-300 text-xs"></i>
                </div>
            `).join('');
            dropdown.classList.remove('hidden');
        }

        function pilihHasilPencarian(idSiswa) {
            document.getElementById('dropdown-hasil-pencarian').classList.add('hidden');
            document.getElementById('input-pencarian-global').value = '';
            bukaIDCardSiswa(idSiswa);
        }

        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('wrapper-pencarian-global');
            if (wrapper && !wrapper.contains(e.target)) {
                document.getElementById('dropdown-hasil-pencarian').classList.add('hidden');
            }
        });

        // ============ ID CARD SISWA (Klik Hasil Pencarian) ============
        function bukaIDCardSiswa(idSiswa) {
            const m = sampleMurid30.find(s => s.id === idSiswa);
            if (!m) return;

            // Untuk siswa ID #1, tarik ulang foto terbaru dari localStorage (kalau baru saja diganti di Dashboard Siswa)
            if (m.id === 1) {
                const profilTerbaru = getProfilSiswaAktif();
                m.foto = profilTerbaru.foto;
            }

            document.getElementById('idcard-avatar-slot').innerHTML = avatarWrapperHTML(m, 'w-24 h-24');
            document.getElementById('idcard-nama').innerHTML = namaEfekHTML(m);
            document.getElementById('idcard-kelas').innerText = m.kelas ? `Siswa • ${m.kelas}` : '';
            document.getElementById('idcard-title-slot').innerHTML = titleBadgeHTML(m);
            document.getElementById('idcard-idnumber').innerText = `MURID-${m.id}`;

            const listSudah = document.getElementById('idcard-list-sudah');
            const listSedang = document.getElementById('idcard-list-sedang');
            const listBelum = document.getElementById('idcard-list-belum');
            listSudah.innerHTML = '';
            listSedang.innerHTML = '';
            listBelum.innerHTML = '';

            daftarSeluruhKelasDummy.forEach(k => {
                const tasksKelasIni = getTasksKelas(k.nama);
                if (tasksKelasIni.length === 0) return; // kelas ini tidak sedang punya tugas aktif

                // Setiap tugas aktif di kelas ini ditampilkan sebagai baris terpisah
                // (bukan cuma tugas terakhir), supaya semua tugas tetap tercatat.
                tasksKelasIni.forEach(data => {
                    // Status 3-tahap per tugas: 'selesai' (sudah dikirim), 'sedang'
                    // (sudah dibuka siswa tapi belum dikirim), 'belum' (belum pernah
                    // dibuka). Untuk murid selain ID#1 (dummy, tidak tersambung ke
                    // Dashboard Siswa sungguhan) dipakai fallback biner seperti semula.
                    let status = m.sudahMengumpulkan ? 'selesai' : 'belum';
                    let nilai = m.nilai;
                    if (m.id === 1) {
                        status = data.studentSubmitted ? 'selesai' : (data.isViewedByStudent ? 'sedang' : 'belum');
                        nilai = data.grade || null;
                    }

                    const judulTugas = data.judul || (data.teks ? (data.teks.length > 40 ? data.teks.slice(0, 40) + '...' : data.teks) : 'Tugas');
                    const jamKirim = data.waktuKirim || data.studentTime || null;

                    if (status === 'selesai') {
                        listSudah.innerHTML += `
                            <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                                <p class="text-xs font-bold text-slate-900">${k.nama} <span class="text-slate-400 font-normal">&middot; ${k.mapel}</span></p>
                                <p class="text-[11px] text-emerald-700 font-semibold mt-0.5">${judulTugas} ${nilai ? '&middot; Nilai: ' + nilai : ''}</p>
                                ${jamKirim ? `<p class="text-[10px] text-emerald-600 mt-0.5"><i class="fa-solid fa-clock mr-1"></i> Dikirim: ${jamKirim}</p>` : ''}
                            </div>`;
                    } else if (status === 'sedang') {
                        listSedang.innerHTML += `
                            <div class="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                                <p class="text-xs font-bold text-slate-900">${k.nama} <span class="text-slate-400 font-normal">&middot; ${k.mapel}</span></p>
                                <p class="text-[11px] text-blue-600 font-semibold mt-0.5">${judulTugas} &middot; Sedang dikerjakan</p>
                            </div>`;
                    } else {
                        listBelum.innerHTML += `
                            <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                                <p class="text-xs font-bold text-slate-900">${k.nama} <span class="text-slate-400 font-normal">&middot; ${k.mapel}</span></p>
                                <p class="text-[11px] text-rose-600 font-semibold mt-0.5">${judulTugas} &middot; Belum dikerjakan</p>
                            </div>`;
                    }
                });
            });

            if (!listSudah.innerHTML) listSudah.innerHTML = `<p class="text-xs text-slate-400 italic">Belum ada tugas yang dikerjakan.</p>`;
            if (!listSedang.innerHTML) listSedang.innerHTML = `<p class="text-xs text-slate-400 italic">Tidak ada tugas yang sedang dikerjakan.</p>`;
            if (!listBelum.innerHTML) listBelum.innerHTML = `<p class="text-xs text-slate-400 italic">Tidak ada tugas yang tertunda saat ini.</p>`;

            document.getElementById('modal-id-card').classList.remove('hidden');
        }

        function tutupIDCardSiswa() {
            document.getElementById('modal-id-card').classList.add('hidden');
        }

        // ============ PROFIL GURU (Foto Kotak + Bio) ============
        // Sama pola-nya dengan Dashboard Siswa (foto profil + bio tersimpan
        // di localStorage), bedanya foto guru ditampilkan kotak (rounded-xl),
        // bukan bulat seperti avatar siswa.
        function toggleProfileDropdownGuru(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('profile-dropdown-guru');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('profile-dropdown-guru');
            const trigger = document.getElementById('profile-menu-trigger-guru');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });

        function openExpandedPhotoGuru(event) {
            event.stopPropagation();
            const dropdownAvatar = document.getElementById('dropdown-user-avatar-guru');
            const expandedImg = document.getElementById('expanded-foto-guru-img');
            const modal = document.getElementById('modal-expanded-foto-guru');
            if (dropdownAvatar && expandedImg && modal) {
                expandedImg.src = dropdownAvatar.src;
                modal.classList.remove('hidden');
            }
        }

        function closeExpandedPhotoGuru() {
            document.getElementById('modal-expanded-foto-guru').classList.add('hidden');
        }

        // ---- Atur Posisi & Zoom Foto (sebelum disimpan) ----
        let aturFotoState = { natW: 0, natH: 0, baseScale: 1, zoom: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0 };
        const ATUR_FOTO_VIEWPORT_SIZE = 280;
        const ATUR_FOTO_OUTPUT_SIZE = 500;

        function updateProfilePhotoGuru(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById('atur-foto-img');
                img.onload = function() {
                    aturFotoState.natW = img.naturalWidth;
                    aturFotoState.natH = img.naturalHeight;
                    aturFotoState.baseScale = Math.max(ATUR_FOTO_VIEWPORT_SIZE / img.naturalWidth, ATUR_FOTO_VIEWPORT_SIZE / img.naturalHeight);
                    aturFotoState.zoom = 1;
                    document.getElementById('atur-foto-zoom').value = 100;
                    aturFotoState.tx = (ATUR_FOTO_VIEWPORT_SIZE - img.naturalWidth * aturFotoState.baseScale) / 2;
                    aturFotoState.ty = (ATUR_FOTO_VIEWPORT_SIZE - img.naturalHeight * aturFotoState.baseScale) / 2;
                    terapkanTransformFotoGuru();
                    document.getElementById('modal-atur-foto-guru').classList.remove('hidden');
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
            event.target.value = '';
        }

        function terapkanTransformFotoGuru() {
            const img = document.getElementById('atur-foto-img');
            const scale = aturFotoState.baseScale * aturFotoState.zoom;
            img.style.width = (aturFotoState.natW * scale) + 'px';
            img.style.height = (aturFotoState.natH * scale) + 'px';
            img.style.transform = `translate(${aturFotoState.tx}px, ${aturFotoState.ty}px)`;
        }

        function clampAturFotoPosisi() {
            const scale = aturFotoState.baseScale * aturFotoState.zoom;
            const dispW = aturFotoState.natW * scale;
            const dispH = aturFotoState.natH * scale;
            const minTx = Math.min(0, ATUR_FOTO_VIEWPORT_SIZE - dispW);
            const minTy = Math.min(0, ATUR_FOTO_VIEWPORT_SIZE - dispH);
            aturFotoState.tx = Math.max(minTx, Math.min(0, aturFotoState.tx));
            aturFotoState.ty = Math.max(minTy, Math.min(0, aturFotoState.ty));
        }

        function onZoomAturFotoGuru(val) {
            aturFotoState.zoom = val / 100;
            clampAturFotoPosisi();
            terapkanTransformFotoGuru();
        }

        (function setupDragAturFotoGuru() {
            document.addEventListener('DOMContentLoaded', () => {
                const viewport = document.getElementById('atur-foto-viewport');
                if (!viewport) return;

                const startDrag = (x, y) => {
                    aturFotoState.dragging = true;
                    aturFotoState.startX = x - aturFotoState.tx;
                    aturFotoState.startY = y - aturFotoState.ty;
                    viewport.classList.add('cursor-grabbing');
                };
                const moveDrag = (x, y) => {
                    if (!aturFotoState.dragging) return;
                    aturFotoState.tx = x - aturFotoState.startX;
                    aturFotoState.ty = y - aturFotoState.startY;
                    clampAturFotoPosisi();
                    terapkanTransformFotoGuru();
                };
                const endDrag = () => {
                    aturFotoState.dragging = false;
                    viewport.classList.remove('cursor-grabbing');
                };

                viewport.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
                window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
                window.addEventListener('mouseup', endDrag);

                viewport.addEventListener('touchstart', (e) => {
                    const t = e.touches[0];
                    startDrag(t.clientX, t.clientY);
                }, { passive: true });
                viewport.addEventListener('touchmove', (e) => {
                    const t = e.touches[0];
                    moveDrag(t.clientX, t.clientY);
                }, { passive: true });
                viewport.addEventListener('touchend', endDrag);
            });
        })();

        /* ================================================================
           GESTUR "TAHAN LALU GESER" DI KARTU KELAS BERANDA (drag-highlight)
           Begitu jari MULAI menekan salah satu .kartu-kelas-beranda dan
           lalu digeser (bukan cuma tap diam), halaman SENGAJA dikunci
           supaya TIDAK ikut ke-scroll -- persis seperti drag-select foto
           di galeri HP. Selama jari masih ditahan & digeser, kartu yang
           ada tepat di bawah jari itu yang ditandai "terpilih"
           (kartu-tersentuh), pindah-pindah mengikuti jari.
           Begitu jari dilepas, kuncian discroll otomatis lepas lagi dan
           kartu terakhir yang "terpilih" itu dianggap yang mau dibuka
           (bukaDetailKelas dipicu manual dari sini, KARENA event click
           asli browser TIDAK muncul kalau sempat ada preventDefault di
           tengah sentuhan yang sama).
           Kalau jari cuma tap diam tanpa digeser sama sekali, tidak ada
           preventDefault yang jalan sama sekali -- jadi tap normal tetap
           lewat jalur click asli seperti biasa.
           ================================================================ */
        (function setupDragHighlightKartuKelasBeranda() {
            let kartuAwalSentuh = null;   // kartu tempat jari pertama kali menyentuh
            let kartuTersentuh = null;    // kartu yang sedang "terpilih" saat ini
            let modeDragAktif = false;    // baru true begitu jari terbukti digeser

            function lepaskanHighlight() {
                if (kartuTersentuh) {
                    kartuTersentuh.classList.remove('kartu-tersentuh');
                    kartuTersentuh = null;
                }
            }

            function tandaiKartuDiTitik(x, y) {
                const elDiBawahJari = document.elementFromPoint(x, y);
                const kartuBaru = elDiBawahJari ? elDiBawahJari.closest('.kartu-kelas-beranda') : null;
                if (kartuBaru === kartuTersentuh) return;
                lepaskanHighlight();
                if (kartuBaru) {
                    kartuBaru.classList.add('kartu-tersentuh');
                    kartuTersentuh = kartuBaru;
                }
            }

            document.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                if (!t) return;
                kartuAwalSentuh = e.target.closest ? e.target.closest('.kartu-kelas-beranda') : null;
                modeDragAktif = false;
                // Belum menandai apa-apa & belum mengunci scroll di sini --
                // baru dipastikan begitu touchmove pertama membuktikan jari
                // memang digeser (lihat listener touchmove di bawah).
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!kartuAwalSentuh) return;
                const t = e.touches[0];
                if (!t) return;
                // Begitu terbukti ada gerakan sambil jari masih ditahan dari
                // kartu, kunci scroll halaman (preventDefault) & mulai mode
                // drag-highlight. Ini listener HARUS { passive: false } biar
                // preventDefault-nya benar-benar mempan.
                modeDragAktif = true;
                e.preventDefault();
                tandaiKartuDiTitik(t.clientX, t.clientY);
            }, { passive: false });

            document.addEventListener('touchend', () => {
                // Kalau tadi sempat masuk mode drag (scroll dikunci), tap asli
                // browser tidak akan kepicu -- jadi kita yang buka kelasnya
                // secara manual, persis kartu terakhir yang "terpilih".
                if (modeDragAktif && kartuTersentuh) {
                    kartuTersentuh.click();
                }
                lepaskanHighlight();
                kartuAwalSentuh = null;
                modeDragAktif = false;
            }, { passive: true });

            document.addEventListener('touchcancel', () => {
                lepaskanHighlight();
                kartuAwalSentuh = null;
                modeDragAktif = false;
            }, { passive: true });
        })();

        function batalAturFotoGuru() {
            document.getElementById('modal-atur-foto-guru').classList.add('hidden');
        }

        function simpanFotoAturGuru() {
            const img = document.getElementById('atur-foto-img');
            const canvas = document.createElement('canvas');
            canvas.width = ATUR_FOTO_OUTPUT_SIZE;
            canvas.height = ATUR_FOTO_OUTPUT_SIZE;
            const ctx = canvas.getContext('2d');
            const outScaleFactor = ATUR_FOTO_OUTPUT_SIZE / ATUR_FOTO_VIEWPORT_SIZE;
            const scale = aturFotoState.baseScale * aturFotoState.zoom;
            const dw = aturFotoState.natW * scale * outScaleFactor;
            const dh = aturFotoState.natH * scale * outScaleFactor;
            const dx = aturFotoState.tx * outScaleFactor;
            const dy = aturFotoState.ty * outScaleFactor;
            ctx.drawImage(img, dx, dy, dw, dh);

            const base64Image = canvas.toDataURL('image/jpeg', 0.92);
            localStorage.setItem('guru_profile_photo', base64Image);

            const headerAvatar = document.getElementById('header-user-avatar-guru');
            const headerAvatarMobile = document.getElementById('header-user-avatar-guru-mobile');
            const dropdownAvatar = document.getElementById('dropdown-user-avatar-guru');
            if (headerAvatar) headerAvatar.src = base64Image;
            if (headerAvatarMobile) headerAvatarMobile.src = base64Image;
            if (dropdownAvatar) dropdownAvatar.src = base64Image;

            document.getElementById('modal-atur-foto-guru').classList.add('hidden');
            alert('Foto profil berhasil diperbarui!');
        }

        function loadSavedProfilePhotoGuru() {
            const savedPhoto = localStorage.getItem('guru_profile_photo');
            if (savedPhoto) {
                const headerAvatar = document.getElementById('header-user-avatar-guru');
                const headerAvatarMobile = document.getElementById('header-user-avatar-guru-mobile');
                const dropdownAvatar = document.getElementById('dropdown-user-avatar-guru');
                if (headerAvatar) headerAvatar.src = savedPhoto;
                if (headerAvatarMobile) headerAvatarMobile.src = savedPhoto;
                if (dropdownAvatar) dropdownAvatar.src = savedPhoto;
            }
        }

        function simpanBioGuru() {
            const inputBio = document.getElementById('input-bio-guru');
            if (!inputBio) return;
            const bioText = inputBio.value.trim();
            localStorage.setItem('guru_bio', bioText);
            alert('Bio berhasil disimpan!');
        }

        function loadBioGuru() {
            const inputBio = document.getElementById('input-bio-guru');
            if (!inputBio) return;
            inputBio.value = localStorage.getItem('guru_bio') || '';
        }

        /* ============================================================
           FITUR KONFIRMASI PRESTASI (sertifikat/piala siswa)
           Membaca localStorage key `pengajuan_prestasi_<KELAS>` yang
           sama dengan yang ditulis oleh siswa di Dashboard Siswa (mis.
           `pengajuan_prestasi_XII_TKJ_3` untuk kelas "XII TKJ 3"), lalu
           guru bisa Setujui/Tolak dari sini. Perubahan status disimpan
           balik ke key yang sama sehingga Dashboard Siswa langsung
           mendeteksinya lewat event 'storage' dan menampilkan nama
           admin/guru yang mengonfirmasi.
           ============================================================ */

        function keyPrestasiKelas(namaKelas) {
            return `pengajuan_prestasi_${namaKelas.replace(/\s+/g, '_')}`;
        }

        function getPengajuanPrestasiKelas(namaKelas) {
            const raw = localStorage.getItem(keyPrestasiKelas(namaKelas));
            return raw ? JSON.parse(raw) : [];
        }

        function savePengajuanPrestasiKelas(namaKelas, daftar) {
            localStorage.setItem(keyPrestasiKelas(namaKelas), JSON.stringify(daftar));
        }

        // Kumpulkan semua pengajuan dari seluruh kelas jadi satu daftar datar,
        // masing-masing entri ditandai kelas asalnya supaya bisa difilter &
        // supaya waktu disimpan kembali tahu harus ditulis ke key kelas mana.
        function getSemuaPengajuanPrestasi() {
            const semua = [];
            daftarSeluruhKelasDummy.forEach(k => {
                getPengajuanPrestasiKelas(k.nama).forEach(p => {
                    semua.push({ ...p, _kelas: k.nama });
                });
            });
            // Terbaru duluan
            semua.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
            return semua;
        }

        function isiFilterKelasPrestasi() {
            const sel = document.getElementById('filter-kelas-prestasi');
            if (!sel || sel.dataset.terisi) return;
            daftarSeluruhKelasDummy.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k.nama;
                opt.innerText = k.nama;
                sel.appendChild(opt);
            });
            sel.dataset.terisi = '1';
        }

        function updateBadgePrestasiMenunggu() {
            const semua = getSemuaPengajuanPrestasi();

            const jumlahMenunggu = semua.filter(p => p.status === 'menunggu').length;
            const badge = document.getElementById('badge-prestasi-menunggu');
            if (badge) {
                if (jumlahMenunggu > 0) {
                    badge.innerText = String(jumlahMenunggu);
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }

            // Notifikasi: keputusan guru yang dibatalkan oleh guru LAIN, belum dibaca.
            const jumlahNotifPembatalan = semua.filter(p => p.notifikasiPembatalan && !p.notifikasiPembatalan.dibaca).length;
            const badgeNotif = document.getElementById('badge-notif-pembatalan-prestasi');
            const badgeNotifJumlah = document.getElementById('badge-notif-pembatalan-prestasi-jumlah');
            if (badgeNotif && badgeNotifJumlah) {
                if (jumlahNotifPembatalan > 0) {
                    badgeNotifJumlah.innerText = String(jumlahNotifPembatalan);
                    badgeNotif.classList.remove('hidden');
                    badgeNotif.classList.add('inline-flex');
                } else {
                    badgeNotif.classList.add('hidden');
                    badgeNotif.classList.remove('inline-flex');
                }
            }
        }

        function renderKonfirmasiPrestasi() {
            isiFilterKelasPrestasi();
            updateBadgePrestasiMenunggu();

            const filterStatus = document.getElementById('filter-status-prestasi')?.value || 'menunggu';
            const filterKelas = document.getElementById('filter-kelas-prestasi')?.value || 'ALL';

            let daftar = getSemuaPengajuanPrestasi();
            if (filterStatus !== 'ALL') daftar = daftar.filter(p => p.status === filterStatus);
            if (filterKelas !== 'ALL') daftar = daftar.filter(p => p._kelas === filterKelas);

            const container = document.getElementById('grid-konfirmasi-prestasi');
            if (!container) return;

            if (daftar.length === 0) {
                container.innerHTML = `<div class="lg:col-span-2 text-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-200/80"><i class="fa-solid fa-medal text-3xl mb-2 block"></i>Tidak ada pengajuan prestasi untuk filter ini.</div>`;
                return;
            }

            container.innerHTML = daftar.map(p => {
                let badge, info;
                if (p.status === 'disetujui') {
                    badge = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0"><i class="fa-solid fa-circle-check"></i>Disetujui</span>`;
                    info = `<p class="text-[11px] text-emerald-600 font-semibold mt-1.5"><i class="fa-solid fa-user-shield mr-1"></i>Dikonfirmasi oleh ${p.adminPenyetuju || 'Admin'} &middot; ${p.tanggalKonfirmasi || ''}</p>`;
                    if (p.rewardDiberikan) {
                        info += `<p class="text-[11px] text-amber-600 font-semibold mt-1"><i class="fa-solid fa-award mr-1"></i>Reward diberikan: +${p.poinReward || 0} Poin & Border</p>`;
                    }
                } else if (p.status === 'ditolak') {
                    badge = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-100 text-rose-700 flex items-center gap-1 flex-shrink-0"><i class="fa-solid fa-circle-xmark"></i>Ditolak</span>`;
                    info = `<p class="text-[11px] text-rose-600 font-semibold mt-1.5"><i class="fa-solid fa-user-shield mr-1"></i>Ditolak oleh ${p.adminPenyetuju || 'Admin'}${p.catatanAdmin ? ' &middot; ' + p.catatanAdmin : ''}</p>`;
                } else {
                    badge = `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-700 flex items-center gap-1 flex-shrink-0"><i class="fa-solid fa-hourglass-half"></i>Menunggu</span>`;
                    info = `<p class="text-[11px] text-slate-400 mt-1.5">Diajukan ${p.tanggalAjukan}</p>`;
                    // Kalau baris ini pernah disetujui/ditolak lalu dibatalkan (mis. salah
                    // pencet), tampilkan jejaknya supaya guru lain yang mau memproses ulang
                    // tahu riwayatnya, bukan mengira ini pengajuan baru.
                    if (p.pembatalanTerakhir) {
                        const statusSebelum = p.pembatalanTerakhir.statusSebelum === 'disetujui' ? 'disetujui' : 'ditolak';
                        info += `<p class="text-[11px] text-orange-500 font-semibold mt-1"><i class="fa-solid fa-rotate-left mr-1"></i>Sebelumnya ${statusSebelum}, dibatalkan oleh ${p.pembatalanTerakhir.oleh} &middot; ${p.pembatalanTerakhir.tanggal}</p>`;
                        if (p.pembatalanTerakhir.statusSebelum === 'disetujui') {
                            info += `<p class="text-[11px] text-orange-500 mt-0.5"><i class="fa-solid fa-award mr-1"></i>Reward yang sudah diberikan otomatis dicabut.</p>`;
                        }
                    }
                }

                // Notifikasi: keputusan guru ini dibatalkan oleh guru LAIN. Ditampilkan
                // sampai guru pemilik keputusan awal menekan "Tandai sudah dibaca".
                const notifPembatalan = (p.notifikasiPembatalan && !p.notifikasiPembatalan.dibaca) ? `
                    <div class="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                        <p class="text-[11px] font-bold text-rose-700"><i class="fa-solid fa-bell mr-1"></i>Untuk ${p.notifikasiPembatalan.untuk}: keputusanmu dibatalkan oleh ${p.notifikasiPembatalan.oleh}</p>
                        <p class="text-[11px] text-rose-600 mt-1">Alasan: ${p.notifikasiPembatalan.alasan} &middot; ${p.notifikasiPembatalan.timestamp}</p>
                        <button onclick="tandaiNotifPembatalanDibaca('${p._kelas}', '${p.id}')" class="mt-2 text-[10px] font-bold text-rose-500 hover:text-rose-700 underline">Tandai sudah dibaca</button>
                    </div>` : '';

                const tombolUtama = p.status === 'menunggu' ? `
                    <div class="flex gap-2 mt-3">
                        <button onclick="bukaModalKonfirmasiPrestasi('${p._kelas}', '${p.id}', 'disetujui')" class="flex-1 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all">
                            <i class="fa-solid fa-check mr-1"></i>Setujui
                        </button>
                        <button onclick="bukaModalKonfirmasiPrestasi('${p._kelas}', '${p.id}', 'ditolak')" class="flex-1 py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-all">
                            <i class="fa-solid fa-xmark mr-1"></i>Tolak
                        </button>
                    </div>` : `
                    <div class="mt-3">
                        <button onclick="bukaModalKonfirmasiPrestasi('${p._kelas}', '${p.id}', 'batalkan')" class="w-full py-2 rounded-xl text-xs font-bold bg-slate-50 hover:bg-orange-50 text-slate-500 hover:text-orange-600 border border-slate-200 hover:border-orange-200 transition-all">
                            <i class="fa-solid fa-rotate-left mr-1"></i>Tarik Kembali / Ubah Keputusan
                        </button>
                    </div>`;

                const jumlahRiwayat = (p.riwayat && p.riwayat.length) || 0;
                const tombolAksi = tombolUtama + `
                    <div class="mt-2">
                        <button onclick="bukaModalRiwayatPrestasi('${p._kelas}', '${p.id}')" class="w-full py-1.5 rounded-xl text-[11px] font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-clock-rotate-left"></i>Riwayat Perubahan${jumlahRiwayat ? ` (${jumlahRiwayat})` : ''}
                        </button>
                    </div>`;

                return `
                <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex gap-4">
                    <img src="${p.foto}" class="w-20 h-20 rounded-xl object-cover border border-slate-200 flex-shrink-0 cursor-pointer" onclick="bukaModalBuktiPrestasi('${p._kelas}', '${p.id}')" alt="Bukti prestasi" loading="lazy" decoding="async">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2 flex-wrap">
                            <div>
                                <p class="text-[10px] font-bold text-blue-600 uppercase tracking-wide">${p._kelas} &middot; ${p.namaSiswa || 'Siswa'}</p>
                                <h5 class="text-sm font-bold text-slate-800 mt-0.5">${p.judul}</h5>
                            </div>
                            ${badge}
                        </div>
                        ${p.keterangan ? `<p class="text-xs text-slate-500 mt-1.5">${p.keterangan}</p>` : ''}
                        ${info}
                        ${notifPembatalan}
                        ${tombolAksi}
                    </div>
                </div>`;
            }).join('');
        }

        let _buktiPrestasiAktif = null; // { kelas, id } - konteks foto yang lagi dibuka, dipakai scanner

        function bukaModalBuktiPrestasi(namaKelas, idPengajuan) {
            const daftar = getPengajuanPrestasiKelas(namaKelas);
            const p = daftar.find(x => x.id === idPengajuan);
            if (!p) return;
            _buktiPrestasiAktif = { kelas: namaKelas, id: idPengajuan };
            document.getElementById('img-bukti-prestasi-besar').src = p.foto;
            document.getElementById('hasil-scan-keaslian-bukti').innerHTML = '';
            document.getElementById('modal-lihat-bukti-prestasi').classList.remove('hidden');
        }

        function tutupModalBuktiPrestasi() {
            document.getElementById('modal-lihat-bukti-prestasi').classList.add('hidden');
            _buktiPrestasiAktif = null;
        }

        // =====================================================================
        // STEGANOGRAFI LSB (Least Significant Bit)
        // Menyisipkan data rahasia (Nama, NISN, Timestamp) ke bit terakhir tiap
        // channel warna (R, G, B) piksel gambar bukti prestasi, supaya keaslian
        // file bisa diverifikasi kembali (dan manipulasi/edit bisa terdeteksi).
        //
        // PENTING - batasan yang wajib dipahami:
        // 1. Hasil sisip WAJIB disimpan sebagai PNG (lossless). Kalau file
        //    dikompres ulang ke JPEG, di-resize, di-crop, atau diedit di aplikasi
        //    editor foto, bit LSB akan rusak/hilang -- ini justru jadi SINYAL
        //    bahwa file sudah "disentuh" pihak lain (magic marker tidak ditemukan
        //    lagi / checksum tidak cocok).
        // 2. ID untuk menyisipkan data (sisipkanDataRahasiaLSB) dipanggil di sisi
        //    SISWA, tepat saat file bukti prestasi selesai dipilih/diupload --
        //    SEBELUM disimpan. Fungsi ini disiapkan di sini supaya siap dipakai;
        //    untuk pemasangannya di alur upload siswa, sambungkan Dashboard Guru
        //    ini dengan Dashboard Siswa (upload file yang sama).
        // 3. Ini BUKAN enkripsi -- data tersembunyi masih bisa diekstrak siapa pun
        //    yang tahu skemanya. Checksum di sini untuk deteksi manipulasi/corrupt,
        //    bukan untuk kerahasiaan data.
        // =====================================================================

        const STEGO_MAGIC = 'STG1'; // penanda 4-byte bahwa gambar mengandung data tersembunyi

        function _stegoStrToBytes(str) { return Array.from(new TextEncoder().encode(str)); }
        function _stegoBytesToStr(bytes) { return new TextDecoder().decode(new Uint8Array(bytes)); }

        // djb2 hash sederhana (32-bit) -- cukup untuk deteksi perubahan/corrupt,
        // BUKAN untuk keamanan kriptografis.
        function _stegoHash32(bytes) {
            let h = 5381;
            for (const b of bytes) h = ((h * 33) ^ b) >>> 0;
            return h >>> 0;
        }
        function _stegoUint32ToBytes(n) {
            return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
        }
        function _stegoBytesToUint32(bytes) {
            return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        }
        function _stegoBytesToBits(bytes) {
            const bits = [];
            bytes.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
            return bits;
        }
        function _stegoBitsToBytes(bits) {
            const bytes = [];
            for (let i = 0; i < bits.length; i += 8) {
                let b = 0;
                for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
                bytes.push(b);
            }
            return bytes;
        }

        // Sisipkan {nama, nisn, timestamp} ke dalam gambar (data URL) via LSB.
        // Dipanggil saat siswa upload bukti prestasi, SEBELUM file disimpan.
        // Return: Promise<string> -> data URL PNG hasil sisip.
        function sisipkanDataRahasiaLSB(dataUrlGambar, { nama, nisn, timestamp }) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const pixels = imageData.data;

                        const payloadObj = { nama: nama || '', nisn: nisn || '', timestamp: timestamp || '' };
                        const payloadBytes = _stegoStrToBytes(JSON.stringify(payloadObj));
                        const hashBytes = _stegoUint32ToBytes(_stegoHash32(payloadBytes));
                        const blob = payloadBytes.concat(hashBytes); // payload + checksum 4 byte
                        const header = _stegoStrToBytes(STEGO_MAGIC).concat(_stegoUint32ToBytes(blob.length)); // MAGIC(4) + LEN(4)
                        const semuaBytes = header.concat(blob);
                        const bits = _stegoBytesToBits(semuaBytes);

                        const kapasitasBit = Math.floor(pixels.length / 4) * 3; // 3 channel (R,G,B) per piksel, alpha dilewati
                        if (bits.length > kapasitasBit) {
                            reject(new Error('Ukuran gambar terlalu kecil untuk menyisipkan data rahasia.'));
                            return;
                        }

                        let bitIdx = 0;
                        for (let i = 0; i < pixels.length && bitIdx < bits.length; i += 4) {
                            for (let ch = 0; ch < 3 && bitIdx < bits.length; ch++) {
                                pixels[i + ch] = (pixels[i + ch] & 0xFE) | bits[bitIdx];
                                bitIdx++;
                            }
                        }

                        ctx.putImageData(imageData, 0, 0);
                        resolve(canvas.toDataURL('image/png')); // WAJIB PNG -- JPEG akan merusak data LSB
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('Gagal memuat gambar untuk disisipi data.'));
                img.src = dataUrlGambar;
            });
        }

        // Baca & validasi data rahasia dari gambar (data URL).
        // Return: Promise<{ ditemukan, valid, nama, nisn, timestamp, pesan }>
        function ekstrakDataRahasiaLSB(dataUrlGambar) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const pixels = imageData.data;

                        const bacaBits = (jumlahBit, offsetBit) => {
                            const bits = [];
                            let dilewati = 0;
                            for (let i = 0; i < pixels.length && bits.length < jumlahBit; i += 4) {
                                for (let ch = 0; ch < 3 && bits.length < jumlahBit; ch++) {
                                    if (dilewati < offsetBit) { dilewati++; continue; }
                                    bits.push(pixels[i + ch] & 1);
                                }
                            }
                            return bits;
                        };

                        // Header: MAGIC (4 byte) + LEN (4 byte) = 64 bit
                        const headerBits = bacaBits(64, 0);
                        if (headerBits.length < 64) {
                            resolve({ ditemukan: false, valid: false, pesan: 'Gambar terlalu kecil / tidak mengandung data tersembunyi.' });
                            return;
                        }
                        const headerBytes = _stegoBitsToBytes(headerBits);
                        const magic = _stegoBytesToStr(headerBytes.slice(0, 4));
                        if (magic !== STEGO_MAGIC) {
                            resolve({ ditemukan: false, valid: false, pesan: 'Tidak ditemukan watermark tersembunyi. Kemungkinan foto ini tidak diupload lewat sistem (tanpa watermark), atau watermark sudah rusak/hilang karena gambar diedit, di-crop, atau dikompres ulang.' });
                            return;
                        }
                        const panjangBlob = _stegoBytesToUint32(headerBytes.slice(4, 8));
                        const kapasitasBit = Math.floor(pixels.length / 4) * 3;
                        if (panjangBlob <= 0 || 64 + panjangBlob * 8 > kapasitasBit) {
                            resolve({ ditemukan: true, valid: false, pesan: 'Watermark ditemukan tapi datanya rusak (ukuran tidak masuk akal) -- indikasi kuat gambar telah dimanipulasi.' });
                            return;
                        }

                        const blobBits = bacaBits(panjangBlob * 8, 64);
                        const blobBytes = _stegoBitsToBytes(blobBits);
                        const hashBytes = blobBytes.slice(-4);
                        const payloadBytes = blobBytes.slice(0, -4);
                        const hashTersimpan = _stegoBytesToUint32(hashBytes);
                        const hashDihitung = _stegoHash32(payloadBytes);

                        let payloadObj = null;
                        try { payloadObj = JSON.parse(_stegoBytesToStr(payloadBytes)); } catch (e) { payloadObj = null; }

                        if (!payloadObj || hashTersimpan !== hashDihitung) {
                            resolve({
                                ditemukan: true, valid: false,
                                nama: payloadObj ? payloadObj.nama : null,
                                nisn: payloadObj ? payloadObj.nisn : null,
                                timestamp: payloadObj ? payloadObj.timestamp : null,
                                pesan: 'Watermark ditemukan TAPI checksum tidak cocok -- indikasi kuat gambar telah diedit/dimanipulasi setelah watermark disisipkan.'
                            });
                            return;
                        }

                        resolve({
                            ditemukan: true, valid: true,
                            nama: payloadObj.nama, nisn: payloadObj.nisn, timestamp: payloadObj.timestamp,
                            pesan: 'Watermark ditemukan dan valid -- gambar konsisten dengan data asli saat diupload, tidak terdeteksi manipulasi.'
                        });
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('Gagal memuat gambar untuk dipindai.'));
                img.src = dataUrlGambar;
            });
        }

        // Tombol "Scan Keaslian Bukti" di modal foto -- dipakai guru saat
        // memverifikasi bukti prestasi sebelum menyetujui.
        function jalankanScanKeaslianBukti() {
            const hasilEl = document.getElementById('hasil-scan-keaslian-bukti');
            const btn = document.getElementById('btn-scan-keaslian-bukti');
            const foto = document.getElementById('img-bukti-prestasi-besar').src;
            if (!foto) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memindai...';
            hasilEl.innerHTML = '';

            ekstrakDataRahasiaLSB(foto).then(hasil => {
                let namaSiswaHarapan = null;
                if (_buktiPrestasiAktif) {
                    const daftar = getPengajuanPrestasiKelas(_buktiPrestasiAktif.kelas);
                    const p = daftar.find(x => x.id === _buktiPrestasiAktif.id);
                    if (p) namaSiswaHarapan = p.namaSiswa || null;
                }

                let warnaKotak, ikon, judul;
                if (hasil.ditemukan && hasil.valid) {
                    warnaKotak = 'bg-emerald-50 border-emerald-200 text-emerald-700';
                    ikon = 'fa-shield-halved';
                    judul = 'Watermark valid, tidak ada indikasi manipulasi';
                } else if (hasil.ditemukan && !hasil.valid) {
                    warnaKotak = 'bg-rose-50 border-rose-200 text-rose-700';
                    ikon = 'fa-triangle-exclamation';
                    judul = 'Terindikasi dimanipulasi!';
                } else {
                    warnaKotak = 'bg-slate-100 border-slate-200 text-slate-600';
                    ikon = 'fa-circle-question';
                    judul = 'Watermark tidak ditemukan';
                }

                let cekNama = '';
                if (hasil.valid && namaSiswaHarapan && hasil.nama && hasil.nama.trim().toLowerCase() !== namaSiswaHarapan.trim().toLowerCase()) {
                    cekNama = `<p class="mt-1.5 font-bold text-rose-600"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Nama di watermark ("${hasil.nama}") beda dengan nama pengaju ("${namaSiswaHarapan}")!</p>`;
                }

                hasilEl.innerHTML = `
                    <div class="${warnaKotak} border rounded-xl p-3">
                        <p class="font-bold"><i class="fa-solid ${ikon} mr-1.5"></i>${judul}</p>
                        <p class="mt-1 text-[11px] opacity-90">${hasil.pesan}</p>
                        ${hasil.ditemukan ? `
                        <div class="mt-2 pt-2 border-t border-current/20 text-[11px] space-y-0.5">
                            <p><b>Nama (dari watermark):</b> ${hasil.nama || '-'}</p>
                            <p><b>NISN (dari watermark):</b> ${hasil.nisn || '-'}</p>
                            <p><b>Timestamp upload:</b> ${hasil.timestamp || '-'}</p>
                        </div>` : ''}
                        ${cekNama}
                    </div>`;
            }).catch(err => {
                hasilEl.innerHTML = `<div class="bg-slate-100 border border-slate-200 text-slate-600 rounded-xl p-3"><i class="fa-solid fa-circle-exclamation mr-1"></i>Gagal memindai: ${err.message}</div>`;
            }).finally(() => {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Scan Keaslian Bukti (Cek Watermark Tersembunyi)';
            });
        }

        let _prosesPrestasiAktif = null; // { kelas, id, aksi }
        const POIN_REWARD_PRESTASI = 10; // Poin default yang diberikan saat prestasi disetujui

        function buatTimestampSekarang() {
            const now = new Date();
            const bulanSingkat = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
            return now.getDate() + ' ' + bulanSingkat[now.getMonth()] + ' ' + now.getFullYear() + ', ' +
                   String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' WIB';
        }

        // Mencatat setiap perubahan status prestasi ke log riwayat transparan.
        // Setiap entri WAJIB berisi: Nama Guru, Jenis Aksi, Alasan Revisi, dan Timestamp.
        function catatRiwayatPrestasi(pengajuan, { namaGuru, aksi, alasanRevisi, statusSebelum, statusSesudah }) {
            if (!pengajuan.riwayat) pengajuan.riwayat = [];
            pengajuan.riwayat.push({
                namaGuru: namaGuru,
                aksi: aksi,
                alasanRevisi: alasanRevisi || null,
                statusSebelum: statusSebelum || null,
                statusSesudah: statusSesudah || null,
                timestamp: buatTimestampSekarang()
            });
        }

        function bukaModalKonfirmasiPrestasi(namaKelas, idPengajuan, aksi) {
            const daftar = getPengajuanPrestasiKelas(namaKelas);
            const p = daftar.find(x => x.id === idPengajuan);
            if (!p) return;

            _prosesPrestasiAktif = { kelas: namaKelas, id: idPengajuan, aksi: aksi };

            document.getElementById('ringkasan-prestasi-siswa').innerText = `${p.namaSiswa || 'Siswa'} · ${namaKelas}`;
            document.getElementById('input-nama-admin-prestasi').value = cariNamaGuruKelas(namaKelas);
            document.getElementById('input-catatan-tolak-prestasi').value = '';

            const judulModal = document.getElementById('judul-modal-konfirmasi-prestasi');
            const wrapperCatatan = document.getElementById('wrapper-catatan-tolak-prestasi');
            const labelCatatan = document.getElementById('label-catatan-tolak-prestasi');
            const inputCatatan = document.getElementById('input-catatan-tolak-prestasi');
            const wrapperTargetBatal = document.getElementById('wrapper-target-batal');
            const selectTargetBatal = document.getElementById('select-target-batal');
            const tombolProses = document.getElementById('btn-proses-konfirmasi-prestasi');
            const labelNamaAdmin = document.getElementById('label-nama-admin-prestasi');

            if (aksi === 'disetujui') {
                document.getElementById('ringkasan-prestasi-judul').innerText = p.judul;
                judulModal.innerHTML = '<i class="fa-solid fa-trophy text-amber-500 mr-1.5"></i> Setujui Prestasi';
                if (labelNamaAdmin) labelNamaAdmin.innerText = 'Nama Admin/Guru yang Mengonfirmasi:';
                wrapperCatatan.classList.add('hidden');
                wrapperTargetBatal.classList.add('hidden');
                tombolProses.className = "px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-500/20 flex items-center gap-2";
                tombolProses.innerHTML = '<i class="fa-solid fa-check"></i> Setujui';
            } else if (aksi === 'ditolak') {
                document.getElementById('ringkasan-prestasi-judul').innerText = p.judul;
                judulModal.innerHTML = '<i class="fa-solid fa-circle-xmark text-rose-500 mr-1.5"></i> Tolak Prestasi';
                if (labelNamaAdmin) labelNamaAdmin.innerText = 'Nama Admin/Guru yang Mengonfirmasi:';
                if (labelCatatan) labelCatatan.innerText = 'Catatan Penolakan (opsional):';
                if (inputCatatan) inputCatatan.placeholder = 'Contoh: Foto bukti kurang jelas, mohon upload ulang.';
                wrapperCatatan.classList.remove('hidden');
                wrapperTargetBatal.classList.add('hidden');
                tombolProses.className = "px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-rose-500/20 flex items-center gap-2";
                tombolProses.innerHTML = '<i class="fa-solid fa-xmark"></i> Tolak';
            } else {
                // aksi === 'batalkan' -> guru menarik kembali / mengubah keputusan yang
                // sudah diambil (mis. salah pencet, atau bukti ternyata bermasalah).
                // Guru memilih status baru: Ditolak atau Pending (Menunggu). Kalau status
                // sebelumnya Disetujui, reward (poin/border) yang sudah diberikan otomatis
                // dicabut. Alasan revisi WAJIB diisi supaya tercatat transparan di riwayat.
                const statusSekarang = p.status === 'disetujui' ? 'Disetujui' : 'Ditolak';
                document.getElementById('ringkasan-prestasi-judul').innerText = `${p.judul} (status saat ini: ${statusSekarang})`;
                judulModal.innerHTML = '<i class="fa-solid fa-rotate-left text-orange-500 mr-1.5"></i> Tarik Kembali / Ubah Keputusan';
                if (labelNamaAdmin) labelNamaAdmin.innerText = 'Nama Guru yang Membatalkan:';
                if (labelCatatan) labelCatatan.innerText = 'Alasan Revisi (wajib diisi):';
                if (inputCatatan) inputCatatan.placeholder = 'Contoh: Salah pencet, atau bukti prestasi ternyata tidak valid.';
                wrapperCatatan.classList.remove('hidden');
                wrapperTargetBatal.classList.remove('hidden');
                if (selectTargetBatal) selectTargetBatal.value = p.status === 'disetujui' ? 'ditolak' : 'menunggu';
                tombolProses.className = "px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-orange-500/20 flex items-center gap-2";
                tombolProses.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Simpan Perubahan';
            }

            document.getElementById('modal-konfirmasi-prestasi').classList.remove('hidden');
        }

        function tutupModalKonfirmasiPrestasi() {
            document.getElementById('modal-konfirmasi-prestasi').classList.add('hidden');
            _prosesPrestasiAktif = null;
        }

        function prosesKonfirmasiPrestasi() {
            if (!_prosesPrestasiAktif) return;
            const { kelas, id, aksi } = _prosesPrestasiAktif;

            const namaAdmin = document.getElementById('input-nama-admin-prestasi').value.trim();
            if (!namaAdmin) { alert('Nama guru yang memproses wajib diisi.'); return; }
            const catatan = document.getElementById('input-catatan-tolak-prestasi').value.trim();

            // Alasan revisi WAJIB diisi saat menarik kembali/mengubah keputusan,
            // supaya riwayat tetap transparan dan bisa dipertanggungjawabkan.
            if (aksi === 'batalkan' && !catatan) {
                alert('Alasan revisi wajib diisi saat menarik kembali/mengubah keputusan.');
                return;
            }

            const daftar = getPengajuanPrestasiKelas(kelas);
            const idx = daftar.findIndex(x => x.id === id);
            if (idx === -1) { tutupModalKonfirmasiPrestasi(); return; }
            const p = daftar[idx];

            if (aksi === 'batalkan') {
                const statusSebelum = p.status;
                const guruPengambilKeputusanAwal = p.adminPenyetuju; // guru yang set status saat ini
                const selectTargetBatal = document.getElementById('select-target-batal');
                const statusBaru = (selectTargetBatal && selectTargetBatal.value) || 'menunggu';

                // Reward (poin/border) otomatis dicabut kalau statusnya sebelumnya Disetujui.
                const rewardDicabut = statusSebelum === 'disetujui' && p.rewardDiberikan;
                if (rewardDicabut) {
                    p.rewardDiberikan = false;
                }

                // Kalau yang membatalkan BUKAN guru yang mengambil keputusan awal,
                // pembatalan tetap langsung berlaku, tapi guru pemilik keputusan awal
                // diberi notifikasi (tercatat) supaya tahu keputusannya diubah guru lain.
                const bedaGuru = guruPengambilKeputusanAwal &&
                    guruPengambilKeputusanAwal.trim().toLowerCase() !== namaAdmin.trim().toLowerCase();
                if (bedaGuru) {
                    p.notifikasiPembatalan = {
                        untuk: guruPengambilKeputusanAwal,
                        oleh: namaAdmin,
                        statusSebelum: statusSebelum,
                        statusBaru: statusBaru,
                        alasan: catatan,
                        timestamp: buatTimestampSekarang(),
                        dibaca: false
                    };
                }

                p.pembatalanTerakhir = {
                    oleh: namaAdmin,
                    statusSebelum: statusSebelum,
                    tanggal: buatTimestampSekarang()
                };

                p.status = statusBaru;
                if (statusBaru === 'ditolak') {
                    p.adminPenyetuju = namaAdmin;
                    p.tanggalKonfirmasi = buatTimestampSekarang();
                    p.catatanAdmin = catatan;
                } else {
                    p.adminPenyetuju = null;
                    p.tanggalKonfirmasi = null;
                    p.catatanAdmin = null;
                }

                catatRiwayatPrestasi(p, {
                    namaGuru: namaAdmin,
                    aksi: `Tarik kembali/ubah keputusan (dari ${statusSebelum === 'disetujui' ? 'Disetujui' : 'Ditolak'} menjadi ${statusBaru === 'ditolak' ? 'Ditolak' : 'Pending'})${rewardDicabut ? ' — reward dicabut otomatis' : ''}${bedaGuru ? ` — notifikasi dikirim ke ${guruPengambilKeputusanAwal} (pengambil keputusan awal)` : ''}`,
                    alasanRevisi: catatan,
                    statusSebelum: statusSebelum,
                    statusSesudah: statusBaru
                });
            } else {
                const statusSebelum = p.status;
                p.status = aksi;
                p.adminPenyetuju = namaAdmin;
                p.tanggalKonfirmasi = buatTimestampSekarang();
                p.catatanAdmin = aksi === 'ditolak' ? (catatan || null) : null;

                if (aksi === 'disetujui') {
                    // Sistem otomatis memberi reward (poin/border) saat prestasi disetujui.
                    p.rewardDiberikan = true;
                    p.poinReward = p.poinReward || POIN_REWARD_PRESTASI;
                }

                catatRiwayatPrestasi(p, {
                    namaGuru: namaAdmin,
                    aksi: aksi === 'disetujui' ? `Menyetujui prestasi (reward +${p.poinReward} poin diberikan)` : 'Menolak prestasi',
                    alasanRevisi: catatan || null,
                    statusSebelum: statusSebelum,
                    statusSesudah: aksi
                });
            }

            savePengajuanPrestasiKelas(kelas, daftar);

            tutupModalKonfirmasiPrestasi();
            renderKonfirmasiPrestasi();
        }

        // ===== Modal Riwayat Perubahan (log transparan) =====
        function bukaModalRiwayatPrestasi(namaKelas, idPengajuan) {
            const daftar = getPengajuanPrestasiKelas(namaKelas);
            const p = daftar.find(x => x.id === idPengajuan);
            if (!p) return;

            document.getElementById('riwayat-prestasi-subjudul').innerText = `${p.judul} — ${p.namaSiswa || 'Siswa'} · ${namaKelas}`;

            const container = document.getElementById('daftar-riwayat-prestasi');
            const riwayat = (p.riwayat || []).slice().reverse(); // terbaru di atas

            if (riwayat.length === 0) {
                container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs"><i class="fa-solid fa-inbox text-2xl mb-2 block"></i>Belum ada riwayat perubahan untuk pengajuan ini.</div>`;
            } else {
                container.innerHTML = riwayat.map(r => `
                    <div class="border border-slate-200 rounded-xl p-3">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-xs font-bold text-slate-800"><i class="fa-solid fa-user mr-1.5 text-blue-500"></i>${r.namaGuru}</p>
                            <p class="text-[10px] text-slate-400 flex-shrink-0">${r.timestamp}</p>
                        </div>
                        <p class="text-[11px] text-slate-600 mt-1.5">${r.aksi}</p>
                        ${r.alasanRevisi ? `<p class="text-[11px] text-slate-500 mt-1 bg-slate-50 border border-slate-100 rounded-lg p-2"><i class="fa-solid fa-quote-left mr-1 text-slate-300"></i>${r.alasanRevisi}</p>` : ''}
                    </div>`).join('');
            }

            document.getElementById('modal-riwayat-prestasi').classList.remove('hidden');
        }

        function tutupModalRiwayatPrestasi() {
            document.getElementById('modal-riwayat-prestasi').classList.add('hidden');
        }

        // Menandai notifikasi "keputusan dibatalkan guru lain" sebagai sudah dibaca.
        function tandaiNotifPembatalanDibaca(namaKelas, idPengajuan) {
            const daftar = getPengajuanPrestasiKelas(namaKelas);
            const p = daftar.find(x => x.id === idPengajuan);
            if (!p || !p.notifikasiPembatalan) return;
            p.notifikasiPembatalan.dibaca = true;
            savePengajuanPrestasiKelas(namaKelas, daftar);
            renderKonfirmasiPrestasi();
        }

        window.addEventListener('storage', (e) => {
            if (e.key && e.key.startsWith('pengajuan_prestasi_')) {
                updateBadgePrestasiMenunggu();
                if (activeTab === 'prestasi') renderKonfirmasiPrestasi();
            }
            if (e.key === 'evaluasi_guru') {
                updateBadgeEvaluasiGuru();
                if (activeTab === 'evaluasi') renderEvaluasiGuru();
            }
        });

        // ============================================================
        // TAB "Saran & Evaluasi": daftar rating + pesan anonim yang
        // dikirim siswa lewat modal "Beri Saran" di Dashboard Siswa
        // (localStorage key 'evaluasi_guru'). Tidak ada field identitas
        // siswa apapun di datanya -- memang sengaja tidak pernah dikirim.
        // ============================================================
        function ambilSemuaEvaluasiGuru() {
            try {
                return JSON.parse(localStorage.getItem('evaluasi_guru') || '[]');
            } catch (e) {
                return [];
            }
        }

        function updateBadgeEvaluasiGuru() {
            const badge = document.getElementById('badge-evaluasi-jumlah');
            if (!badge) return;
            const jumlah = ambilSemuaEvaluasiGuru().length;
            if (jumlah > 0) {
                badge.textContent = jumlah > 99 ? '99+' : String(jumlah);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        function warnaKategoriEvaluasi(kategori) {
            if (kategori === 'Metode Mengajar') return 'bg-cyan-50 text-cyan-700 border-cyan-100';
            if (kategori === 'Keadilan & Beban Tugas') return 'bg-amber-50 text-amber-700 border-amber-100';
            return 'bg-violet-50 text-violet-700 border-violet-100'; // Komunikasi
        }

        function renderBintangEvaluasi(rating) {
            let out = '';
            for (let i = 1; i <= 5; i++) {
                out += `<i class="fa-solid fa-star ${i <= rating ? 'text-amber-400' : 'text-slate-200'}"></i>`;
            }
            return out;
        }

        // Baris mini "label + bintang" untuk salah satu dari 3 aspek penilaian
        // (Penjelasan Materi, Keadilan Nilai, Komunikasi) yang dikirim siswa.
        function renderBarisAspekEvaluasi(label, rating) {
            return `
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-bold text-slate-500">${label}</span>
                    <span class="text-xs">${renderBintangEvaluasi(rating || 0)}</span>
                </div>
            `;
        }

        function renderEvaluasiGuru() {
            const grid = document.getElementById('grid-evaluasi-guru');
            const emptyState = document.getElementById('evaluasi-kosong-state');
            const selectGuru = document.getElementById('filter-guru-evaluasi');
            const selectIdentitas = document.getElementById('filter-identitas-evaluasi');
            if (!grid) return;

            const semua = ambilSemuaEvaluasiGuru();
            updateBadgeEvaluasiGuru();

            // Isi ulang dropdown daftar guru (dari data evaluasi yang benar-benar ada),
            // sambil pertahankan pilihan filter yang sedang aktif kalau masih relevan.
            if (selectGuru) {
                const namaTerpilihSebelumnya = selectGuru.value;
                const namaUnik = [...new Set(semua.map(x => x.guruNama))].sort();
                selectGuru.innerHTML = '<option value="ALL">Semua Guru</option>' +
                    namaUnik.map(n => `<option value="${n}">${n}</option>`).join('');
                if (namaUnik.includes(namaTerpilihSebelumnya)) selectGuru.value = namaTerpilihSebelumnya;
            }

            const filterGuru = selectGuru ? selectGuru.value : 'ALL';
            const filterIdentitas = selectIdentitas ? selectIdentitas.value : 'ALL';

            const hasil = semua
                .filter(x => filterGuru === 'ALL' || x.guruNama === filterGuru)
                .filter(x => {
                    if (filterIdentitas === 'ALL') return true;
                    const anonim = x.anonim !== false && !x.namaPengirim; // data lama (tanpa field ini) dianggap anonim
                    if (filterIdentitas === 'ANONIM') return anonim;
                    return !anonim; // 'NAMA'
                })
                .slice()
                .reverse(); // terbaru di atas

            if (hasil.length === 0) {
                grid.innerHTML = '';
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }
            if (emptyState) emptyState.classList.add('hidden');

            grid.innerHTML = hasil.map(x => {
                const tampilkanNama = x.anonim === false && x.namaPengirim;
                const badgeIdentitas = tampilkanNama
                    ? `<span class="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-50 border border-violet-100 text-violet-600 text-[10px] font-bold"><i class="fa-solid fa-user"></i> ${x.namaPengirim}</span>`
                    : `<span class="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-50 border border-slate-100 text-slate-500 text-[10px] font-bold"><i class="fa-solid fa-lock"></i> Anonim</span>`;

                // Data lama (sebelum fitur 3 aspek) masih pakai x.rating tunggal;
                // data baru pakai ratingPenjelasan/ratingKeadilan/ratingKomunikasi.
                const punyaAspekBaru = x.ratingPenjelasan || x.ratingKeadilan || x.ratingKomunikasi;
                const isiRating = punyaAspekBaru
                    ? `<div class="space-y-1">
                        ${renderBarisAspekEvaluasi('Penjelasan Materi', x.ratingPenjelasan)}
                        ${renderBarisAspekEvaluasi('Keadilan Nilai', x.ratingKeadilan)}
                        ${renderBarisAspekEvaluasi('Komunikasi', x.ratingKomunikasi)}
                       </div>`
                    : `<div class="text-sm">${renderBintangEvaluasi(x.rating)}</div>`;

                return `
                <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-2.5">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">Untuk</p>
                            <h4 class="font-extrabold text-slate-900 text-sm">${x.guruNama}</h4>
                            ${x.guruMapel ? `<p class="text-[10px] text-slate-400">${x.guruMapel}</p>` : ''}
                        </div>
                        ${badgeIdentitas}
                    </div>
                    ${isiRating}
                    <p class="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3">${x.pesan}</p>
                    <p class="text-[10px] text-slate-400"><i class="fa-solid fa-clock mr-1"></i>${x.waktu}</p>
                </div>
            `;
            }).join('');
        }

        // ===== Deteksi "Sesi Berubah" (akun lain login di tab/perangkat
        // lain pada browser yang sama) =====
        // Flask cuma punya 1 cookie session per BROWSER, bukan per tab.
        // Jadi kalau tab ini login sebagai Guru A, lalu di tab lain
        // (browser sama) login sebagai Guru B, cookie session browser
        // berubah jadi milik Guru B untuk SEMUA tab -- tapi tab ini (yang
        // sudah lebih dulu ter-render) tidak otomatis ikut berubah
        // tampilannya sampai di-refresh, jadi kelihatan seperti "akun A
        // dan B jadi satu". USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA merekam
        // username asli yang login SAAT halaman ini pertama kali
        // dirender (dikirim server lewat data-login-username di <body>),
        // lalu dibandingkan berkala ke /api/sesi/whoami yang selalu
        // membaca session AKTUAL saat itu juga.
        const USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA = document.body.dataset.loginUsername || '';
        let sesiTabIniSudahDitandaiBeda = false;

        async function pengecekSesiBerubahGuru() {
            // Sekali ketahuan beda & modalnya sudah tampil, tidak perlu
            // terus-terusan cek lagi -- guru tinggal klik "Muat Ulang".
            if (sesiTabIniSudahDitandaiBeda) return;
            try {
                const res = await fetch('/api/sesi/whoami');
                const json = await res.json();
                if (!json.success) return;
                const sesiMasihSama = json.logged_in && json.username === USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA;
                if (!sesiMasihSama) {
                    sesiTabIniSudahDitandaiBeda = true;
                    tampilkanModalSesiBerubahGuru(json.logged_in ? json.nama : null);
                }
            } catch (e) {
                // Koneksi lagi bermasalah -- jangan ganggu guru dengan
                // modal palsu, biar dicoba lagi di pengecekan berikutnya.
                console.warn('Gagal cek status sesi login:', e);
            }
        }

        function tampilkanModalSesiBerubahGuru(namaAkunYangSekarangAktif) {
            const modal = document.getElementById('modal-sesi-berubah');
            const pesan = document.getElementById('sesi-berubah-pesan');
            if (pesan) {
                pesan.textContent = namaAkunYangSekarangAktif
                    ? `Sepertinya akun "${namaAkunYangSekarangAktif}" baru saja login di tab atau perangkat lain pada browser ini. Muat ulang halaman ini supaya tampilan & datanya sesuai akun yang benar-benar aktif sekarang.`
                    : 'Sesi login Anda di browser ini sudah berakhir (kemungkinan logout dari tab lain). Muat ulang halaman untuk masuk kembali.';
            }
            if (modal) {
                modal.classList.remove('hidden');
            } else {
                // Fallback kalau markup modalnya entah kenapa belum ada di
                // halaman -- tetap kasih tahu & langsung reload, jangan
                // biarkan guru diam-diam lanjut di tab yang sudah basi.
                alert('Sesi login di browser ini sudah berubah. Halaman akan dimuat ulang.');
                location.reload();
            }
        }

        function muatUlangKarenaSesiBerubah() {
            location.reload();
        }

        document.addEventListener('DOMContentLoaded', async () => {
            updateHeaderClock();
            setInterval(updateHeaderClock, 1000);

            // PERBAIKAN TRAFFIC: ambil tugas SEMUA kelas dalam 1 request
            // (lihat muatCacheTugasSemuaKelas()) SEBELUM render yang
            // butuh data itu, supaya renderBerandaKelasBerurutan() dan
            // renderSeluruhKelas() di bawah ini baca dari cache -- bukan
            // memicu puluhan request satu-satu seperti sebelumnya.
            await muatCacheTugasSemuaKelas();
            renderBerandaKelasBerurutan();
            renderSeluruhKelas();
            hitungDanTampilkanPerluDinilai();
            // Polling ringan (bukan tiap detik) supaya angka "Perlu Dinilai" di
            // Beranda otomatis naik sendiri kalau ada siswa lain yang baru saja
            // mengumpulkan tugas dari perangkatnya -- tanpa guru perlu reload
            // manual. Dihentikan saat tab browser sedang tidak aktif, sama
            // seperti pola renderTeacherSchedule() di bawah, biar tidak boros.
            setInterval(() => { if (!document.hidden) hitungDanTampilkanPerluDinilai(); }, 30000);

            // Sama halnya: refresh berkala card "Aktivitas Tugas Terbaru" di
            // Beranda, supaya kalau GURU LAIN (login di perangkat/tab lain)
            // baru saja ngasih tugas, itu ikut muncul di sini tanpa guru yang
            // sedang lihat Beranda ini perlu reload manual.
            renderAktivitasTugasTerbaruBeranda();
            setInterval(() => { if (!document.hidden) renderAktivitasTugasTerbaruBeranda(); }, 30000);

            // Refresh berkala "Daftar Kelas X/XI/XII" di Beranda & grid di tab
            // "Kelola Kelas" -- sebelumnya cache tugas (_cacheTugasSemuaKelas)
            // cuma dimuat SEKALI pas halaman dibuka, jadi kalau guru lain
            // kirim tugas baru ke kelas yang lagi ditampilkan di sini, kartu
            // kelasnya nggak ikut update sampai di-reload manual. Sekarang
            // cache-nya ditarik ulang dari server tiap 30 detik (bareng
            // muatCacheTugasSemuaKelas()), baru dirender ulang -- sama pola
            // "berhenti kalau tab lagi tidak aktif" seperti polling lain di
            // atas, biar tidak boros request.
            setInterval(async () => {
                if (document.hidden) return;
                await muatCacheTugasSemuaKelas();
                renderBerandaKelasBerurutan();
                renderSeluruhKelas();
            }, 30000);

            renderTeacherSchedule();
            // PERBAIKAN TRAFFIC: hentikan polling saat tab sedang tidak
            // aktif/di-minimize (document.hidden) -- tidak ada gunanya
            // terus render jadwal & cek bel kalau guru sedang tidak
            // melihat halaman ini sama sekali.
            setInterval(() => { if (!document.hidden) renderTeacherSchedule(); }, 30000);
            loadSavedProfilePhotoGuru();
            loadBioGuru();
            updateBadgePrestasiMenunggu();
            updateBadgeEvaluasiGuru();

            // Begitu guru masuk, langsung dicek apakah saat ini sudah masuk
            // jam mengajarnya hari ini (lalu terus dipantau tiap 5 detik,
            // kecuali saat tab sedang tidak aktif).
            cekBelJamMengajarOtomatis();
            setInterval(() => { if (!document.hidden) cekBelJamMengajarOtomatis(); }, 5000);

            // Cek sesi tiap 15 detik selama tab ini kebuka (kecuali tab
            // sedang tidak aktif/di-minimize, biar tidak boros)...
            setInterval(() => { if (!document.hidden) pengecekSesiBerubahGuru(); }, 15000);
            // ...dan langsung cek ULANG begitu guru balik lagi ke tab ini
            // (mis. abis buka tab lain buat login sebagai guru lain, terus
            // balik ke tab ini) -- supaya ketahuan LEBIH CEPAT daripada
            // nunggu interval 15 detik berikutnya.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') pengecekSesiBerubahGuru();
            });
            window.addEventListener('focus', pengecekSesiBerubahGuru);
        });
