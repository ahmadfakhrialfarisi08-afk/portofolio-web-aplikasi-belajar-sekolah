// ===== PULAU STATUS KONEKSI (status_koneksi.js) -- dipakai Dashboard Siswa & Guru =====
// Dimuat otomatis dari folder yang sama dengan file ini kalau belum dipasang lewat <script>
// di HTML (lebih baik tetap dipasang di HTML paling awal supaya aktif sebelum script lain).
(function () {
    try {
        if (window.StatusKoneksi || document.getElementById('skrip-status-koneksi')) return;
        var cs = document.currentScript;
        if (!cs || !cs.src) return;
        var s = document.createElement('script');
        s.id = 'skrip-status-koneksi';
        s.src = cs.src.replace(/[^\/]*$/, 'status_koneksi.js');
        (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* island tidak vital: abaikan */ }
})();
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
                    // Perubahan tugas yang masih antri (belum sampai server) ditampilkan lagi.
                    if (window.AntrianSyncGuru) { try { await window.AntrianSyncGuru.terapkanKeCache(cacheBaru); } catch (e) { console.warn(e); } }
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
            if (window.AntrianSyncGuru) { try { await window.AntrianSyncGuru.terapkanKeCache(cacheFallback); } catch (e) { console.warn(e); } }
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
        // `op` (opsional) = operasi per-tugas yang diantrikan lewat antrian_sync_guru.js:
        //   { jenis: 'upsert', task: <objek tugas> }  atau  { jenis: 'hapus', taskId: '...' }
        // Dengan op, yang dikirim ke server adalah OPERASI itu (dibaca-terapkan-tulis di
        // atas data server terbaru, tahan internet putus), bukan seluruh array lama.
        // Tanpa op (mis. simpan nilai), perilaku lama: kirim seluruh array.
        function saveTasksKelas(namaKelas, tasks, op) {
            const key = _kunciTugasKelas(namaKelas);
            if (op && window.AntrianSyncGuru) {
                localStorage.setItem(key, JSON.stringify(tasks)); // cadangan lokal seperti setSync()
                window.AntrianSyncGuru.antri(namaKelas, op);
            } else {
                setSync(key, tasks);
            }
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

        // Roster kelas-kelas yang SUDAH disambungkan ke akun siswa ASLI di backend
        // (lihat users{} di app.py) -- bukan di-generate acak lagi. Setiap entri di
        // sini artinya: begitu siswa tsb ganti border/foto di Dashboard Siswa-nya
        // sendiri, Dashboard Guru otomatis ikut update (lewat
        // sinkronBorderRosterDariServer() di bawah, yang looping SEMUA kelas di
        // sini, bukan cuma 1 kelas hardcoded lagi).
        //
        // 'kelasRoster'  -> nilai persis yang dikirim ke /api/kelas/roster?kelas=
        //                   (harus SAMA PERSIS dengan field 'kelas' di users{} app.py)
        // 'kelasTampil'  -> nama kelas yang dipakai di UI Dashboard Guru ini (field
        //                   'kelas' di sampleMurid30, harus cocok sama 'nama' di
        //                   daftarSeluruhKelasDummy supaya "Denah Kelas"-nya nyambung)
        //
        // Mau nambah kelas lain yang sudah punya murid asli lagi di masa depan?
        // Tinggal tambah 1 objek baru di array ini -- SEMUA logic lain (badge
        // "Perlu Dinilai", Rekap Pengumpulan, Denah Kelas, dst) otomatis ikut
        // menghitung kelas itu juga tanpa perlu diubah lagi (lihat
        // kelasDenganMuridAsli di hitungDanTampilkanPerluDinilai()).
        const KELAS_SISWA_ASLI = [
            {
                kelasRoster: 'XII TKJ 3/TAV',
                kelasTampil: 'XII TKJ 3',
                siswa: [
                    { username: 'siswa', nama: 'AHMAD FAKHRI AL FARISI' },
                    { username: 'syam', nama: 'SYAM KHOERATUL MUKMIN' },
                    { username: 'waldi', nama: 'WALDI WAHIDIN' },
                    { username: 'fadzri', nama: 'MUHAMMAD FADZRI' },
                    { username: 'setiawan', nama: 'SETIAWAN SAPUTRA' },
                    { username: 'jibril', nama: 'MUHAMMAD JIBRIL AL MANAFI' },
                    { username: 'afrizalmustaqim', nama: 'AFRIZAL MUSTAQIM' },
                    // A FAJRI (akun 'fajri') sudah lama terdaftar di users{} app.py
                    // dengan kelas XII TKJ 3/TAV, tapi kelewat belum dimasukkan ke
                    // sini -- akibatnya border/foto dia tidak ikut sinkron ke Denah
                    // Kelas & tidak ikut dihitung di Rekap Pengumpulan. Ditambahkan.
                    { username: 'fajri', nama: 'A FAJRI' }
                ]
            },
            {
                // WILDAN MAULANA DIENUL HAQ (akun 'Wildan') terdaftar di users{}
                // app.py dengan kelas 'XII TKJ 2' -- disambungkan ke sini supaya
                // masuk ke tabel/Denah Kelas XII TKJ 2 & ikut sinkron border/foto
                // otomatis, sama seperti murid-murid XII TKJ 3/TAV di atas.
                kelasRoster: 'XII TKJ 2',
                kelasTampil: 'XII TKJ 2',
                siswa: [
                    { username: 'Wildan', nama: 'WILDAN MAULANA DIENUL HAQ' }
                ]
            }
        ];

        const avatarDefaultMurid = [
            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
            "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120",
            "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120",
            "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=120"
        ];

        // 'id' harus UNIK GLOBAL (dipakai buat lookup lintas kelas, mis.
        // sampleMurid30.find(m => m.id === muridId)), makanya di-nomori berurutan
        // lintas semua kelas di KELAS_SISWA_ASLI, BUKAN diulang dari 1 tiap kelas.
        // 'meja' (nomor bangku) sengaja DIBIKIN ULANG dari 1 di tiap kelas (lihat
        // indexDiKelas) supaya penanda "Pintu" (bangku #1) di Denah Kelas tetap
        // masuk akal per ruang kelas, bukan ikut-ikutan nomor id global.
        let _idUrutBerikutnya = 1;
        const sampleMurid30 = KELAS_SISWA_ASLI.flatMap((kelasInfo) =>
            kelasInfo.siswa.map((s, indexDiKelas) => {
                const id = _idUrutBerikutnya++;
                return {
                    id,
                    username: s.username,
                    meja: indexDiKelas + 1,
                    nama: s.nama,
                    kelas: kelasInfo.kelasTampil,
                    foto: avatarDefaultMurid[indexDiKelas % avatarDefaultMurid.length],
                    // Default sebelum sinkron border dari server selesai (lihat
                    // sinkronBorderRosterDariServer() di bawah) -- polos dulu, ringan.
                    border: 'Border Polos',
                    title: 'Siswa',
                    efek: '',
                    // Ditandai true HANYA setelah sinkronBorderRosterDariServer()
                    // beneran memasukkan data ASLI dari server buat siswa ini --
                    // dipakai supaya kartu tidak menampilkan title/border sebelum
                    // datanya konfirmasi asli (bukan sekadar nilai default di atas).
                    borderTersinkron: false,
                    sudahMengumpulkan: id === 1,
                    waktuKirim: id === 1 ? "08:30 WIB" : null,
                    nilai: id === 1 ? "92" : null,
                    fotoTugas: id === 1 ? "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=800" : null
                };
            })
        );

        // Dipakai di beberapa tempat buat cek "apakah kelas ini sudah tersambung
        // ke murid asli" tanpa hardcode nama kelas satu-satu lagi.
        const NAMA_KELAS_DENGAN_MURID_ASLI = KELAS_SISWA_ASLI.map(k => k.kelasTampil);

        // ===== STATISTIK JUMLAH SISWA (SINGLE SOURCE OF TRUTH: sampleMurid30) =====
        // PERMINTAAN: angka "Total Semua Siswa" di Beranda & label "N Siswa" di
        // tiap kartu kelas SEBELUMNYA hardcode ("630", "30 Siswa" di semua kartu
        // tanpa terkecuali) -- tidak nyambung sama sekali ke data dummy siswa
        // yang sebenarnya dipakai Dashboard Guru ini (sampleMurid30, hasil
        // generate dari KELAS_SISWA_ASLI di atas). Sekarang SEMUA angka jumlah
        // siswa di bawah ini dihitung LANGSUNG dari sampleMurid30 -- kalau nanti
        // KELAS_SISWA_ASLI nambah/berkurang siswa atau kelas, angka-angka ini
        // otomatis ikut berubah tanpa perlu diutak-atik lagi manual.
        //
        // sampleMurid30 isinya SELALU murid saja (lihat cara dia di-generate dari
        // KELAS_SISWA_ASLI[].siswa di atas) -- tidak ada akun guru/admin yang
        // pernah masuk ke array ini, jadi tidak perlu filter role tambahan lagi.
        //
        // jumlahSiswaDiKelas(namaKelas) -> hitung berapa siswa (dari sampleMurid30)
        // yang field 'kelas'-nya cocok dengan nama kelas tsb. Kelas yang belum
        // punya murid asli tersambung (19 dari 21 kelas dummy, lihat
        // KELAS_SISWA_ASLI) otomatis dapat 0 -- BUKAN dibikin-bikin angka dummy
        // baru, sesuai permintaan "jangan bikin dummy data tambahan".
        function jumlahSiswaDiKelas(namaKelas) {
            return sampleMurid30.filter(m => m.kelas === namaKelas).length;
        }

        // hitungTotalSiswa({tingkat, jurusan}) -> total siswa dari SEMUA kelas
        // yang cocok filter Tingkat/Jurusan (opsional, default 'ALL' = tidak
        // difilter). Dipakai bareng oleh kartu statistik "Total Semua Siswa" DAN
        // Filter Cepat (Tingkat X/XI/XII, Jurusan) di Beranda supaya angkanya
        // selalu sesuai kelas-kelas yang sedang ditampilkan/difilter -- tanpa
        // perlu nyimpen angka terpisah, cukup jumlahkan jumlahSiswaDiKelas() tiap
        // kelas yang lolos filter dari daftarSeluruhKelasDummy (sumber Tingkat +
        // Jurusan per kelas).
        function hitungTotalSiswa({ tingkat = 'ALL', jurusan = 'ALL' } = {}) {
            return daftarSeluruhKelasDummy
                .filter(k => (tingkat === 'ALL' || k.tingkat === tingkat) && (jurusan === 'ALL' || k.jurusan === jurusan))
                .reduce((total, k) => total + jumlahSiswaDiKelas(k.nama), 0);
        }

        // Perbarui kartu statistik "Total Semua Siswa" di Beranda sesuai Filter
        // Cepat (Tingkat + Jurusan) yang sedang aktif. Dipanggil sekali saat
        // halaman dimuat (tanpa filter = total keseluruhan, sama dengan
        // sampleMurid30.length), dan dipanggil ulang tiap kali guru mengganti
        // Filter Cepat (lihat filterBerandaCepat() & filterBerandaCepatByJurusan()
        // di bawah) supaya angkanya selalu ikut mengikuti filter yang aktif.
        function perbaruiStatTotalSiswa(tingkat = filterCepatTingkatAktif, jurusan = filterCepatJurusanAktif) {
            const el = document.getElementById('stat-total-siswa');
            if (el) el.textContent = hitungTotalSiswa({ tingkat, jurusan });
        }

        // Ingat filter cepat mana yang lagi aktif (dua sumbernya terpisah:
        // tombol Tingkat & dropdown Jurusan, bisa dikombinasikan bareng), supaya
        // perbaruiStatTotalSiswa() bisa dipanggil ulang tanpa parameter (mis. dari
        // polling/refresh lain) dan tetap menghitung sesuai filter yang terakhir
        // dipilih guru, bukan balik ke "Semua" begitu saja.
        let filterCepatTingkatAktif = 'ALL';
        let filterCepatJurusanAktif = 'ALL';

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
        // id border -> file gambar bingkai (disamakan dgn DAFTAR_BORDER_* di dashboard_siswa_2.js).
        // Border baru di sisi siswa = tambah 1 baris di sini.
        const PETA_FILE_BORDER_GURU = (function () {
            const img = '../static/img/';
            const peta = {
                starter_pemula: img + 'border_pemula.png',
                admin_dev: img + 'border_admin.jpg',
                border_imortal: img + 'border_imortal.png',
                border_ice: img + 'border_ice.png',
                title_bug_hunter: img + 'border_admin.jpg',
                prestasi_perunggu: img + 'border_bronze.jpg',
                prestasi_perak: img + 'border_silver.jpg',
                prestasi_emas: img + 'border_gold.jpg',
                prestasi_pink: img + 'border_pink.jpg'
            };
            const tier = { perak: 'border_silver.jpg', emas: 'border_gold.jpg', permata: 'border_bronze.jpg' };
            ['easy', 'medium', 'hard'].forEach(lv => Object.keys(tier).forEach(t => { peta['quiz_' + lv + '_' + t] = img + tier[t]; }));
            return peta;
        })();
        function ukuranPxDariKelasTailwind(sizeClass) {
            const m = /w-(\d+)/.exec(sizeClass || '');
            return m ? Number(m[1]) * 4 : 40; // w-8 = 32px, w-10 = 40px, dst
        }

        // Efek nama & badge title per siswa (mengikuti slot efekNama/title yang
        // BENERAN mereka pakai di Dashboard Siswa -- bisa beda dari borderId).
        // Statis (tanpa animasi) supaya tetap ringan saat banyak siswa dirender.
        // Kelas .gefek-* / .gtitle-* disuntik dari JS sekali saja (tidak perlu
        // ubah CSS/HTML). Akun DEV tetap pakai .gold-name-text & .badge-dev lama.
        (function suntikStyleEfekSiswaGuru() {
            if (document.getElementById('style-efek-siswa-guru')) return;
            const st = document.createElement('style');
            st.id = 'style-efek-siswa-guru';
            const teks = (nama, grad) => `.${nama}{background:${grad};-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;font-weight:800}`;
            const badge = (nama, bg, fg, bd) => `.${nama}{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:800;line-height:1.3;white-space:nowrap;background:${bg};color:${fg};border:1px solid ${bd}}`;
            st.textContent = [
                teks('gefek-perak', 'linear-gradient(90deg,#64748b,#cbd5e1,#64748b)'),
                teks('gefek-emas', 'linear-gradient(90deg,#d97706,#fde047,#d97706)'),
                teks('gefek-permata', 'linear-gradient(90deg,#06b6d4,#a78bfa,#06b6d4)'),
                teks('gefek-pink', 'linear-gradient(90deg,#db2777,#f9a8d4,#db2777)'),
                teks('gefek-imortal', 'linear-gradient(90deg,#2563eb,#67e8f9,#2563eb)'),
                teks('gefek-collector', 'linear-gradient(90deg,#0891b2,#a5f3fc,#0891b2)'),
                teks('gefek-bug', 'linear-gradient(90deg,#7a0000,#ef4444,#7a0000)'),
                badge('gtitle-default', '#f1f5f9', '#475569', '#e2e8f0'),
                badge('gtitle-perak', '#f1f5f9', '#475569', '#cbd5e1'),
                badge('gtitle-emas', '#fef3c7', '#b45309', '#fcd34d'),
                badge('gtitle-permata', '#ecfeff', '#0e7490', '#a5f3fc'),
                badge('gtitle-pink', '#fdf2f8', '#be185d', '#f9a8d4'),
                badge('gtitle-imortal', '#eff6ff', '#1d4ed8', '#93c5fd'),
                badge('gtitle-collector', '#ecfeff', '#0e7490', '#67e8f9'),
                badge('gtitle-bug', 'linear-gradient(135deg,#3b0000,#7a0000 60%,#5a0000)', '#ffe1e1', '#8f0a0a')
            ].join('\n');
            document.head.appendChild(st);
        })();

        // id border acuan -> { efekClass, badgeClass, label }. Disamakan dgn
        // getEfekNamaClass()/getBadgeDevHtml()/rank di dashboard_siswa_2.js.
        function infoEfekTitleGuru(id) {
            id = id || 'starter_pemula';
            if (id === 'admin_dev') return { efekClass: '', badgeClass: '', label: 'DEV', dev: true };
            if (id === 'title_bug_hunter') return { efekClass: 'gefek-bug', badgeClass: 'gtitle-bug', label: '\uD83D\uDC1E BUG HUNTER' };
            if (id === 'border_imortal') return { efekClass: 'gefek-imortal', badgeClass: 'gtitle-imortal', label: '\uD83D\uDC8E IMMORTAL' };
            if (id === 'border_ice') return { efekClass: 'gefek-collector', badgeClass: 'gtitle-collector', label: '\u2744 COLLECTOR' };
            if (id === 'prestasi_pink') return { efekClass: 'gefek-pink', badgeClass: 'gtitle-pink', label: '\uD83D\uDC51 Queen' };
            if (id === 'prestasi_emas') return { efekClass: 'gefek-emas', badgeClass: 'gtitle-emas', label: '\uD83C\uDFC6 Bintang Sekolah' };
            if (id === 'prestasi_perak') return { efekClass: 'gefek-perak', badgeClass: 'gtitle-perak', label: '\uD83E\uDD48 Siswa Berbakat' };
            if (id === 'prestasi_perunggu') return { efekClass: '', badgeClass: 'gtitle-default', label: '\uD83E\uDD49 Berprestasi' };
            const q = /^quiz_(easy|medium|hard)_(perak|emas|permata)$/.exec(id);
            if (q) {
                const lv = q[1].charAt(0).toUpperCase() + q[1].slice(1);
                if (q[2] === 'permata') return { efekClass: 'gefek-permata', badgeClass: 'gtitle-permata', label: '\uD83D\uDC51 Legenda ' + lv };
                if (q[2] === 'emas') return { efekClass: 'gefek-emas', badgeClass: 'gtitle-emas', label: '\uD83E\uDDE0 Master Quiz ' + lv };
                return { efekClass: 'gefek-perak', badgeClass: 'gtitle-perak', label: '\uD83D\uDCD8 Pelajar Rajin ' + lv };
            }
            return { efekClass: '', badgeClass: 'gtitle-default', label: '\uD83D\uDD30 Pemula' };
        }

        // Tiap gambar bingkai punya ukuran & posisi lubang foto yang beda-beda, jadi
        // lubangnya dideteksi OTOMATIS dari area transparan gambar (sekali per file,
        // hasilnya di-cache) lalu foto dipasang persis mengisi lubang itu. Kalau
        // gambar bingkai tidak punya area transparan / canvas ditolak, dipakai
        // posisi default .guru-frame-dev-foto (ukuran bingkai admin).
        const CACHE_GEOMETRI_BINGKAI_GURU = {};
        function hitungGeometriBingkaiGuru(imgEl) {
            const N = 160;
            try {
                const cv = document.createElement('canvas');
                cv.width = N; cv.height = N;
                const cx = cv.getContext('2d', { willReadFrequently: true });
                cx.drawImage(imgEl, 0, 0, N, N);
                const d = cx.getImageData(0, 0, N, N).data;
                const kosong = (x, y) => d[(y * N + x) * 4 + 3] < 40;
                const mid = N >> 1;
                if (!kosong(mid, mid)) return null;
                const lihat = new Uint8Array(N * N);
                const antre = [mid, mid];
                lihat[mid * N + mid] = 1;
                let minX = mid, maxX = mid, minY = mid, maxY = mid;
                while (antre.length) {
                    const y = antre.pop(), x = antre.pop();
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    const tetangga = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
                    for (let i = 0; i < 4; i++) {
                        const nx = tetangga[i][0], ny = tetangga[i][1];
                        if (nx < 0 || ny < 0 || nx >= N || ny >= N || lihat[ny * N + nx] || !kosong(nx, ny)) continue;
                        lihat[ny * N + nx] = 1;
                        antre.push(nx, ny);
                    }
                }
                // Lubang menyentuh tepi kanvas = bingkai tidak tertutup -> tidak valid.
                if (minX === 0 || minY === 0 || maxX === N - 1 || maxY === N - 1) return null;
                const lebar = (maxX - minX + 1) / N * 100, tinggi = (maxY - minY + 1) / N * 100;
                if (lebar < 20 || tinggi < 20) return null;
                const lebih = 1.5; // selipan kecil di bawah bingkai supaya tidak ada celah putih
                return {
                    left: Math.max(0, minX / N * 100 - lebih),
                    top: Math.max(0, minY / N * 100 - lebih),
                    width: Math.min(100, lebar + lebih * 2),
                    height: Math.min(100, tinggi + lebih * 2)
                };
            } catch (e) {
                return null;
            }
        }
        function styleGeometriBingkaiGuru(g) {
            return g ? `left:${g.left}%;top:${g.top}%;width:${g.width}%;height:${g.height}%;` : '';
        }
        function terapkanGeometriBingkaiGuru(imgBingkai) {
            const foto = imgBingkai.previousElementSibling;
            if (!foto) return;
            const src = imgBingkai.getAttribute('src');
            if (!(src in CACHE_GEOMETRI_BINGKAI_GURU)) CACHE_GEOMETRI_BINGKAI_GURU[src] = hitungGeometriBingkaiGuru(imgBingkai);
            const g = CACHE_GEOMETRI_BINGKAI_GURU[src];
            if (g) {
                foto.style.left = g.left + '%';
                foto.style.top = g.top + '%';
                foto.style.width = g.width + '%';
                foto.style.height = g.height + '%';
            }
            foto.style.visibility = 'visible'; // foto baru muncul setelah posisinya final (anti "goyang")
        }
        function bingkaiGagalGuru(imgBingkai) {
            imgBingkai.parentNode.classList.add('frame-gagal');
            const foto = imgBingkai.previousElementSibling;
            if (foto) foto.style.visibility = 'visible';
        }
        // Pra-hitung geometri semua bingkai sekali di awal, jadi saat kartu dirender
        // (dan dirender ulang) posisinya sudah final langsung di HTML -- tidak ada
        // lompatan posisi foto setelah gambar bingkai selesai dimuat.
        (function praMuatBingkaiGuru() {
            Object.keys(PETA_FILE_BORDER_GURU).forEach(function (id) {
                const src = PETA_FILE_BORDER_GURU[id];
                if (src in CACHE_GEOMETRI_BINGKAI_GURU) return;
                const im = new Image();
                im.onload = function () { if (!(src in CACHE_GEOMETRI_BINGKAI_GURU)) CACHE_GEOMETRI_BINGKAI_GURU[src] = hitungGeometriBingkaiGuru(im); };
                im.onerror = function () { CACHE_GEOMETRI_BINGKAI_GURU[src] = null; };
                im.src = src;
            });
        })();

        // ===== Motion: buka/tutup modal + umpan balik tekan =====
        // Animasi buka murni CSS (lihat #modal-detail-kelas di <style> dashboard_guru.html):
        // begitu class "hidden" dilepas, overlay fade + panel "Pop & Snap". Untuk
        // TUTUP, class "hidden" ditunda ~200ms supaya animasi reverse sempat jalan.
        // Logic buka/tutup lain tidak berubah (kelasAktifDipilih tetap di-reset langsung).
        const DURASI_TUTUP_MODAL_GURU = 200;
        function bukaModalAnimasiGuru(modal) {
            if (!modal) return;
            if (modal._timerTutupAnimasi) { clearTimeout(modal._timerTutupAnimasi); modal._timerTutupAnimasi = null; }
            modal.classList.remove('modal-menutup');
            modal.classList.remove('hidden'); // sudah tampil = tidak memicu ulang animasi buka
        }
        function tutupModalAnimasiGuru(modal) {
            if (!modal || modal.classList.contains('hidden')) return;
            const kurangGerak = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (kurangGerak) { modal.classList.add('hidden'); return; }
            if (modal._timerTutupAnimasi) return; // sedang menutup
            modal.classList.add('modal-menutup');
            modal._timerTutupAnimasi = setTimeout(function () {
                modal.classList.add('hidden');
                modal.classList.remove('modal-menutup');
                modal._timerTutupAnimasi = null;
            }, DURASI_TUTUP_MODAL_GURU);
        }

        // Press feedback tombol filter (Semua / Tingkat X, XI, XII / Jurusan) dan kartu
        // kelas: class .ditekan dipasang saat jari/kursor menekan dan dilepas dengan
        // jeda minimal, jadi tap cepat di HP tetap terlihat. Tidak menyentuh
        // fungsi filter maupun onclick kartu yang sudah ada.
        (function pasangUmpanBalikTekanGuru() {
            const SEL_TOMBOL = '.btn-fast-filter, #select-fast-jurusan, #filter-tingkat, #filter-jurusan';
            const SEL_KARTU = '[onclick^="bukaDetailKelas("]';
            let elAktif = null, waktuMulai = 0, timerAman = null;

            function lepas() {
                if (!elAktif) return;
                const el = elAktif;
                elAktif = null;
                clearTimeout(timerAman);
                const jedaMin = Math.max(0, 90 - (Date.now() - waktuMulai));
                const tahanKartu = el.matches(SEL_KARTU) ? 200 : 0; // kartu tetap "terangkat" sebentar saat modal membuka
                setTimeout(function () { el.classList.remove('ditekan'); }, jedaMin + tahanKartu);
            }

            document.addEventListener('pointerdown', function (e) {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                if (!e.target || !e.target.closest) return;
                let el = e.target.closest(SEL_TOMBOL);
                if (!el) {
                    const kartu = e.target.closest(SEL_KARTU);
                    const tombolDalam = e.target.closest('button');
                    // Tekan tombol di dalam kartu (mis. "Beri Tugas") tidak mengangkat kartunya.
                    if (kartu && !(tombolDalam && kartu.contains(tombolDalam))) el = kartu;
                }
                if (!el) return;
                lepas();
                elAktif = el;
                waktuMulai = Date.now();
                el.classList.add('ditekan');
                // Pengaman: <select> yang membuka dropdown bisa tidak mengirim pointerup.
                timerAman = setTimeout(lepas, 700);
            }, { passive: true });
            document.addEventListener('pointerup', lepas, { passive: true });
            document.addEventListener('pointercancel', lepas, { passive: true });
            // iOS Safari: :active/pointer baru "hidup" kalau ada listener sentuh di dokumen.
            document.addEventListener('touchstart', function () {}, { passive: true });
        })();

        // ===== Tugas Aktif di Kelas Ini: geser ke samping =====
        // Scrollbar disembunyikan (CSS .tugas-aktif-scroller). Di laptop, daftar bisa
        // di-drag dengan kursor: kartu terangkat sedikit selama digeser (kesan
        // "dipegang"). Di HP tetap pakai swipe bawaan browser. Fade tipis di
        // tepi menandakan masih ada kartu di luar layar.
        // Gaya kartu Tugas Aktif: panel informasi read-only (tidak bisa diklik/dipilih).
        // Kursor tetap panah standar; efek hover (naik halus + bayangan menebal +
        // aksen border kebiruan) dipertahankan supaya tampilan tetap hidup. Disuntik dari
        // JS ke AKHIR <head> supaya selalu menang di cascade dan tidak bergantung pada
        // cache template HTML. Hover hanya dipasang di perangkat yang punya kursor
        // (@media hover:hover), jadi di HP tap tidak meninggalkan kartu "nyangkut" terangkat.
        (function suntikGayaKartuTugasAktifGuru() {
            if (document.getElementById('gaya-kartu-tugas-aktif-guru')) return;
            const S = 'html body #list-tugas-aktif-kelas.tugas-aktif-scroller > div';
            const st = document.createElement('style');
            st.id = 'gaya-kartu-tugas-aktif-guru';
            st.textContent =
                S + '{cursor:default;-webkit-user-select:none;user-select:none;' +
                    'transition:transform .3s ease-in-out,box-shadow .3s ease-in-out,border-color .3s ease-in-out !important;}' +
                '@media (hover:hover){' +
                    S + ':hover{transform:translateY(-6px) !important;border-color:#60a5fa !important;' +
                        'box-shadow:0 0 0 1px rgba(96,165,250,.55),0 4px 8px -2px rgba(30,64,175,.12),0 20px 32px -10px rgba(30,64,175,.30) !important;}' +
                '}' +
                '@media (prefers-reduced-motion:reduce){' + S + '{transition:none !important;}}';
            document.head.appendChild(st);
        })();

        function perbaruiFadeTugasAktifGuru() {
            const el = document.getElementById('list-tugas-aktif-kelas');
            if (!el) return;
            const maks = el.scrollWidth - el.clientWidth;
            el.classList.toggle('fade-kiri', el.scrollLeft > 4);
            el.classList.toggle('fade-kanan', maks > 4 && el.scrollLeft < maks - 4);
        }
        (function pasangGeserTugasAktifGuru() {
            const el = document.getElementById('list-tugas-aktif-kelas');
            if (!el) return;
            el.addEventListener('scroll', perbaruiFadeTugasAktifGuru, { passive: true });
            if (window.ResizeObserver) new ResizeObserver(perbaruiFadeTugasAktifGuru).observe(el); // ikut update saat modal baru tampil


        })();

        // ===== Override tampilan GURU: "Ubah Semua Siswa Menjadi Default" =====
        // Murni preferensi tampilan di akun guru ini (disimpan di localStorage
        // dengan key per-username guru). TIDAK menyentuh data/pengaturan siswa
        // maupun server -- di sisi siswa & di akun guru lain efeknya tetap normal.
        // Saat aktif: semua siswa dirender dengan border starter, nama polos, dan
        // tanpa badge title. Cukup dicek di helper render (avatarWrapperHTML,
        // namaEfekHTML, titleBadgeHTML), jadi berlaku di SEMUA kelas sekaligus.
        function kunciTampilanDefaultGuru() {
            return 'guru_tampilan_default_siswa_' + ((document.body && document.body.dataset.loginUsername) || 'guru');
        }
        let _tampilanDefaultGuruCache = null;
        function tampilanDefaultGuruAktif() {
            if (_tampilanDefaultGuruCache === null) {
                try { _tampilanDefaultGuruCache = localStorage.getItem(kunciTampilanDefaultGuru()) === '1'; }
                catch (e) { _tampilanDefaultGuruCache = false; }
            }
            return _tampilanDefaultGuruCache;
        }
        function perbaruiTombolTampilanDefaultGuru() {
            const aktif = tampilanDefaultGuruAktif();
            document.querySelectorAll('[data-toggle-default-siswa]').forEach(function (btn) {
                const label = btn.querySelector('.label-toggle-default-siswa');
                if (label) label.textContent = aktif ? 'Kembalikan Efek Siswa' : 'Ubah Semua Siswa Menjadi Default';
                const ikon = btn.querySelector('i');
                if (ikon) ikon.className = aktif ? 'fa-solid fa-rotate-left' : 'fa-solid fa-eye-slash';
                btn.classList.toggle('aktif', aktif);
                btn.setAttribute('aria-pressed', aktif ? 'true' : 'false');
            });
        }
        function toggleTampilanDefaultSiswaGuru() {
            _tampilanDefaultGuruCache = !tampilanDefaultGuruAktif();
            try { localStorage.setItem(kunciTampilanDefaultGuru(), _tampilanDefaultGuruCache ? '1' : '0'); } catch (e) { /* tampilan tetap berubah walau gagal simpan */ }
            perbaruiTombolTampilanDefaultGuru();
            // Render ulang tampilan yang sedang terbuka (semua kelas ikut karena
            // logikanya ada di helper render, bukan per kelas).
            try {
                const modalDetail = document.getElementById('modal-detail-kelas');
                if (modalDetail && !modalDetail.classList.contains('hidden') && typeof bukaanganUlangDetailKelas === 'function') bukaanganUlangDetailKelas();
                if (typeof taskAktifDipilihUntukRekap !== 'undefined' && taskAktifDipilihUntukRekap && typeof bukaRekapPengumpulanTugas === 'function') {
                    bukaRekapPengumpulanTugas(taskAktifDipilihUntukRekap.namaKelas, taskAktifDipilihUntukRekap.taskId, true);
                }
                const modalPel = document.getElementById('modal-daftar-siswa-pelanggaran');
                if (modalPel && !modalPel.classList.contains('hidden') && typeof renderDaftarSiswaPelanggaran === 'function') renderDaftarSiswaPelanggaran();
            } catch (e) { console.warn('Gagal render ulang setelah ganti tampilan default:', e); }
        }
        (function suntikStyleTombolDefaultGuru() {
            if (document.getElementById('style-tombol-default-guru')) return;
            const st = document.createElement('style');
            st.id = 'style-tombol-default-guru';
            st.textContent = '.btn-default-siswa-guru{background:#fff;color:#334155;border:1px solid #cbd5e1;box-shadow:0 1px 2px rgba(15,23,42,.06);cursor:pointer;transition:background-color .15s}.btn-default-siswa-guru:hover{background:#f8fafc}.btn-default-siswa-guru.aktif{background:#059669;color:#fff;border-color:#059669}.btn-default-siswa-guru.aktif:hover{background:#047857}';
            document.head.appendChild(st);
        })();
        perbaruiTombolTampilanDefaultGuru();

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
                // Semua kelas di KELAS_SISWA_ASLI di-fetch PARALEL (Promise.all) --
                // dulu cuma 1 kelas jadi 1 fetch cukup, sekarang bisa lebih dari 1
                // kelas (mis. XII TKJ 3/TAV & XII TKJ 2) jadi disamakan pola paralel
                // seperti fetch lain di file ini (submisi/hasil periksa per tugas).
                await Promise.all(KELAS_SISWA_ASLI.map(async (kelasInfo) => {
                    const res = await fetch(`/api/kelas/roster?kelas=${encodeURIComponent(kelasInfo.kelasRoster)}`);
                    const json = await res.json();
                    if (!json.success) return;
                    json.siswa.forEach(u => {
                        const m = sampleMurid30.find(s => s.username === u.username);
                        if (!m) return;
                        const tampilan = mapBorderIdKeTampilanGuru(u.border);
                        m.border = tampilan.border;
                        m.borderId = u.border || 'starter_pemula'; // id asli, dipakai avatarWrapperHTML() utk gambar bingkai
                        // Efek nama & title dari slot TERPISAH (u.efekNama / u.title dari
                        // server), bukan lagi selalu ikut border -- fallback ke border.
                        const idEfek = u.efekNama || u.border || 'starter_pemula';
                        const idTitle = u.title || u.border || 'starter_pemula';
                        const infoEfek = infoEfekTitleGuru(idEfek);
                        const infoTitle = infoEfekTitleGuru(idTitle);
                        m.efek = infoEfek.dev ? 'gold-name' : '';
                        m.efekClass = infoEfek.efekClass;
                        m.title = infoTitle.label;           // 'DEV' utk akun dev
                        m.titleClass = infoTitle.badgeClass;
                        m.borderTersinkron = true;
                        // Foto profil ASLI tiap siswa (dari server, lewat /api/profil/foto
                        // yang mereka simpan sendiri) -- kalau siswa belum pernah upload
                        // foto (null), biarkan avatar dummy default yang sudah ke-assign
                        // di sampleMurid30 tetap dipakai, jangan ditimpa jadi kosong.
                        if (u.foto) m.foto = u.foto;
                    });
                }));
                if (typeof kelasAktifDipilih !== 'undefined' && NAMA_KELAS_DENGAN_MURID_ASLI.includes(kelasAktifDipilih) && typeof bukaanganUlangDetailKelas === 'function') {
                    bukaanganUlangDetailKelas();
                }
                // Kalau jendela "Rekap Pengumpulan per Tugas" kebetulan lagi kebuka
                // buat salah satu kelas yang barusan disinkron pas data terbaru ini
                // datang, render ulang juga -- biar foto/border/efek/title-nya ikut
                // ke-update tanpa guru perlu tutup-buka ulang jendelanya.
                if (typeof taskAktifDipilihUntukRekap !== 'undefined' && taskAktifDipilihUntukRekap && NAMA_KELAS_DENGAN_MURID_ASLI.includes(taskAktifDipilihUntukRekap.namaKelas)) {
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
            if (tabId === 'nilai') {
                // Render instan dulu pakai cache yang ada (supaya tidak blank),
                // lalu segarkan window._cacheSubmisiTugas dari server dan render
                // ulang -- sama pola dengan hitungDanTampilkanPerluDinilai() --
                // supaya status "Sedang Dikerjakan"/"Sudah Dikerjakan" akurat
                // begitu guru membuka tab ini, bukan cuma dari cache 30 detik lalu.
                renderPenilaianTugas();
                hitungDanTampilkanPerluDinilai().then(renderPenilaianTugas);
            }
            if (tabId === 'beranda' || tabId === 'kelas') renderTabAktif(); // polling hanya merender tab aktif, jadi segarkan saat tab dibuka
            if (tabId === 'prestasi') renderKonfirmasiPrestasi();
            if (tabId === 'evaluasi') renderEvaluasiGuru();
            const mainContainer = document.getElementById('main-scroll-container');
            if(mainContainer) mainContainer.scrollTop = 0;
        }

        // Elemen jam di-cache sekali (bukan getElementById 4x tiap detik), tidak
        // jalan saat tab tersembunyi, dan tanggal hanya dihitung ulang saat
        // ganti hari (toLocaleDateString itu relatif mahal).
        let _elJamHeader = null, _elTglHeader = null, _hariJamTerakhir = -1;
        function updateHeaderClock() {
            if (document.hidden) return;
            if (!_elJamHeader || _elJamHeader.every(el => !el)) {
                _elJamHeader = ['header-realtime-clock', 'header-realtime-clock-mobile'].map(id => document.getElementById(id));
                _elTglHeader = ['header-realtime-date', 'header-realtime-date-mobile'].map(id => document.getElementById(id));
                _hariJamTerakhir = -1;
            }
            const now = new Date();
            const dua = n => String(n).padStart(2, '0');
            const jamText = `${dua(now.getHours())}:${dua(now.getMinutes())}:${dua(now.getSeconds())} WIB`;
            _elJamHeader.forEach(el => { if (el) el.textContent = jamText; });
            if (now.getDate() !== _hariJamTerakhir) {
                _hariJamTerakhir = now.getDate();
                const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                _elTglHeader.forEach(el => { if (el) el.textContent = dateStr; });
            }
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

            // FITUR TAMBAHAN: status pelanggaran LIVE kelas ini -- cuma
            // ditampilkan untuk kelas yang memang sudah punya murid asli
            // tersambung (lihat KELAS_SISWA_ASLI/jumlahSiswaDiKelas()), supaya
            // tidak menampilkan "✅ Bersih" palsu untuk 19 kelas dummy yang
            // memang belum ada datanya sama sekali. Diklik -> buka daftar
            // siswa kelas ini (lihat bukaDaftarSiswaPelanggaran()), sesuai
            // alur Beranda -> Daftar Siswa -> Detail Pelanggaran.
            let pelanggaranBadgeHTML = '';
            if (jumlahSiswaDiKelas(k.nama) > 0) {
                const ringkasanPel = ringkasanPelanggaranKelas(k.nama);
                pelanggaranBadgeHTML = ringkasanPel.jumlah > 0
                    ? `<button onclick="bukaDaftarSiswaPelanggaran('${k.nama}'); event.stopPropagation();" class="mt-2 w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg text-[11px] font-bold text-rose-600 transition-all">
                        <i class="fa-solid fa-triangle-exclamation"></i> ${ringkasanPel.jumlah} pelanggaran (dari ${ringkasanPel.jumlahGuru} guru)
                      </button>`
                    : `<button onclick="bukaDaftarSiswaPelanggaran('${k.nama}'); event.stopPropagation();" class="mt-2 w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-[11px] font-bold text-emerald-600 transition-all">
                        <i class="fa-solid fa-circle-check"></i> Bersih
                      </button>`;
            }

            return `
                <div onclick="bukaDetailKelas('${k.nama}', '${k.jurusan}', '${k.mapel}', '${k.jurusan}', '${k.img}')" class="kartu-kelas-beranda bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between space-y-3 group">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="px-2.5 py-1 font-extrabold text-[11px] rounded-lg ${badgeJurusanColor}">${k.jurusan}</span>
                            <span class="text-xs text-slate-400 font-medium">${jumlahSiswaDiKelas(k.nama)} Siswa</span>
                        </div>
                        <h4 class="font-extrabold text-slate-900 text-base group-hover:text-blue-600 transition-colors">${k.nama}</h4>
                        <p class="text-xs text-slate-500 mt-0.5">${k.mapel}</p>
                        ${activeTaskHTML}
                        ${pelanggaranBadgeHTML}
                        ${typeof ppjHTMLStatusKelas === 'function' ? ppjHTMLStatusKelas(k.nama) : ''}
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
        function renderKelasListWithCollapse(containerId, filtered, pertahankanBuka = false) {
            const container = document.getElementById(containerId);
            const tombolWrap = document.getElementById(containerId + '-tombol');
            if (!container) return;
            // Dipakai render otomatis dari sinkron berkala: kalau guru sudah menekan
            // "Tampilkan N Kelas Lainnya", jangan tutup lagi tiap data segar masuk.
            const sisaLama = pertahankanBuka ? container.querySelector('.kartu-kelas-sisa-wrapper') : null;
            const sudahDibuka = !!(sisaLama && !sisaLama.classList.contains('kartu-kelas-tersembunyi'));

            const tampil = filtered.slice(0, BATAS_AWAL_KARTU_KELAS_BERANDA);
            const sisanya = filtered.slice(BATAS_AWAL_KARTU_KELAS_BERANDA);

            let html = tampil.map(k => buildKartuKelasBerandaHTML(k)).join('');

            const idSisa = containerId + '-sisa';
            if (sisanya.length > 0) {
                html += `<div id="${idSisa}" class="kartu-kelas-sisa-wrapper${sudahDibuka ? '' : ' kartu-kelas-tersembunyi'}">${sisanya.map(k => buildKartuKelasBerandaHTML(k)).join('')}</div>`;
            }
            container.innerHTML = html;

            if (tombolWrap) {
                if (sisanya.length > 0 && !sudahDibuka) {
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
            filterCepatTingkatAktif = tingkat;
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

            perbaruiStatTotalSiswa();
        }

        function filterBerandaCepatByJurusan(jurusan) {
            filterCepatJurusanAktif = jurusan;
            ['X', 'XI', 'XII'].forEach((tingkat) => {
                let filtered = daftarSeluruhKelasDummy.filter(k => k.tingkat === tingkat);
                if (jurusan !== 'ALL') {
                    filtered = filtered.filter(k => k.jurusan === jurusan);
                }
                renderKelasListWithCollapse(`container-beranda-${tingkat}`, filtered);
            });
            perbaruiStatTotalSiswa();
            if (typeof sinkronChipJurusanGuru === 'function') sinkronChipJurusanGuru(); // sinkronkan chip jurusan
        }

        function renderSeluruhKelas() {
            const container = document.getElementById('grid-seluruh-kelas');
            if(!container) return;
            const _html = [];
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

                _html.push(`
                    <div onclick="bukaDetailKelas('${k.nama}', '${k.jurusan}', '${k.mapel}', '${k.jurusan}', '${k.img}')" class="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer p-6 space-y-4 group">
                        <div class="flex justify-between items-start">
                            <span class="px-3 py-1 font-black text-xs rounded-lg ${badgeJurusanColor}">${k.jurusan}</span>
                            <span class="text-xs text-slate-400 font-semibold">${jumlahSiswaDiKelas(k.nama)} Siswa</span>
                        </div>
                        <div>
                            <h4 class="font-extrabold text-slate-900 text-lg group-hover:text-blue-600 transition-colors">${k.nama}</h4>
                            <p class="text-xs text-slate-500 mt-1">${k.mapel}</p>
                            <div class="mt-2">${statusBadgeTugas}</div>
                            ${typeof ppjHTMLStatusKelas === 'function' ? ppjHTMLStatusKelas(k.nama) : ''}
                        </div>
                        <div class="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                            <span class="text-slate-400">Wali: <b class="text-slate-700">${k.wali}</b></span>
                            <span class="text-blue-600 font-bold group-hover:underline">Denah Kelas &rarr;</span>
                        </div>
                    </div>
                `);
            });
            container.innerHTML = _html.join('');
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

        // Kabar ke Lily (lily_brain.js, v6). Dibungkus try/catch: Lily gagal/tidak ada tidak boleh mengganggu alur tugas.
        function lilyTugasForm(buka) {
            try { document.dispatchEvent(new CustomEvent('lily:taskform', { detail: { open: !!buka } })); } catch (e) {}
        }
        function lilyTugasDibuat(kelas, jenis) {
            try { document.dispatchEvent(new CustomEvent('lily:task', { detail: { kelas: kelas, jenis: jenis } })); } catch (e) {}
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
            vnResetState();
            document.getElementById('modal-beri-tugas').classList.remove('hidden');
            lilyTugasForm(true);
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

            vnResetState();
            if (data.audioDataUrl) {
                // Tugas ini sebelumnya sudah punya voice note tersimpan -> tampilkan lagi supaya bisa didengar/diganti.
                audioDataUrl = data.audioDataUrl;
                vnIdAktif = data.vnId || null; // transkrip lama tetap dipakai selama rekamannya tidak diganti
                document.getElementById('audio-preview').src = data.audioDataUrl;
                document.getElementById('audio-preview-container').classList.remove('hidden');
                vnAturTombol('idle', 'Rekam Ulang Suara');
            } else {
                document.getElementById('audio-preview-container').classList.add('hidden');
            }
            document.getElementById('modal-beri-tugas').classList.remove('hidden');
            lilyTugasForm(true);
        }

        function tutupModalBeriTugas() {
            if (isRecording) stopVoiceRecord();
            document.getElementById('modal-beri-tugas').classList.add('hidden');
            lilyTugasForm(false);
        }

        // PERFORMANCE OPTIMIZATION: foto lampiran tugas dari guru dulu disimpan
        // MENTAH-MENTAH dari FileReader.readAsDataURL(file) tanpa kompresi sama
        // sekali -- kalau diambil langsung dari kamera HP bisa 3000-4000px &
        // beberapa MB, padahal foto ini ikut disimpan di data tugas yang
        // di-download ULANG oleh SETIAP siswa di kelas tiap kali mereka polling
        // tugas (lihat getTasksSiswa() di dashboard_siswa.js). Sekarang dikompres
        // dulu lewat kompresGambarUntukTugasGuru() -- pola & angka kompresinya
        // (sisi terpanjang 1600px, JPEG kualitas 0.85) SENGAJA disamakan persis
        // dengan kompresGambarUntukTugas() di sisi siswa (foto bukti kumpul
        // tugas) supaya konsisten, resolusi/kualitasnya masih cukup tinggi buat
        // teks/instruksi di foto tetap kebaca jelas, cuma ukuran filenya yang
        // jauh mengecil dibanding foto asli kamera HP.
        function kompresGambarUntukTugasGuru(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const SISI_MAKS = 1600;
                        let { width, height } = img;
                        if (width > SISI_MAKS || height > SISI_MAKS) {
                            if (width >= height) {
                                height = Math.round(height * (SISI_MAKS / width));
                                width = SISI_MAKS;
                            } else {
                                width = Math.round(width * (SISI_MAKS / height));
                                height = SISI_MAKS;
                            }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', 0.85));
                    };
                    img.onerror = () => reject(new Error('Gagal memuat gambar'));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error('Gagal membaca file'));
                reader.readAsDataURL(file);
            });
        }

        async function handleUploadFotoTugasGuru(event) {
            const file = event.target.files[0];
            event.target.value = '';
            if (!file) return;
            try {
                teacherImageBase64 = await kompresGambarUntukTugasGuru(file);
                document.getElementById('foto-tugas-preview').src = teacherImageBase64;
                document.getElementById('foto-tugas-preview-container').classList.remove('hidden');
            } catch (e) {
                console.error('Gagal memproses foto tugas:', e);
                alert('Gagal memproses foto. Coba pilih foto lain.');
            }
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

        /* =====================================================================
           VOICE NOTE TUGAS -- noise suppression + kompresi (<= 1 MB) + transkrip
           =====================================================================
           Rekaman di form "Beri Tugas" sekarang dilewatkan rantai Web Audio
           (highpass + DynamicsCompressor, di atas noiseSuppression/echoCancel-
           lation bawaan browser), lalu di-encode Opus bitrate rendah supaya
           hasil akhir <= 1 MB (bitrate diturunkan bertahap kalau masih kegedean;
           kalau tetap > 1 MB, DITOLAK -- tidak dipotong diam-diam).
           Saat tugas dikirim, audio ini juga di-upload ke server untuk
           di-transkrip (Whisper lokal, lihat stt_engine.py). Hasilnya diambil
           siswa lewat id transkrip (task.vnId) -- audio-nya sendiri tetap
           ikut di task.audioDataUrl seperti sebelumnya. */
        const VN_MAX_BYTES = 1024 * 1024; // sinkron dgn VN_TUGAS_MAX_BYTES di app.py
        const VN_TINGKATAN_BITRATE = [32000, 24000, 16000, 12000]; // dari paling bagus ke paling kecil
        const VN_BATAS_DURASI_MS = 480000; // 8 menit: 12kbps x 8 menit masih < 1 MB
        const VN_DIDUKUNG_WEBAUDIO = !!(window.AudioContext || window.webkitAudioContext);

        let vnStream = null;
        let vnAudioCtx = null;
        let vnAutoStopTimeout = null;
        let vnWaktuMulai = 0;
        let vnDurasiDetik = 0;
        let vnSedangMemproses = false;
        let vnBaruPerluUpload = false; // true = rekaman baru yang belum dikirim ke server utk STT
        let vnTokenSesi = 0;           // naik tiap form di-reset; hasil proses dari sesi lama diabaikan
        let vnIdAktif = null;          // id transkrip di server milik VN yang sedang dipakai form ini
        let vnAnalyser = null;         // AnalyserNode buat pantau level suara mentah (deteksi lingkungan berisik)
        let vnTimerInterval = null;    // detik berjalan di label "Berhenti Merekam"
        let vnNoiseInterval = null;    // cek berkala apakah level suara gak pernah "diam" (indikasi noise/musik terus-menerus)
        let vnBufferLevelNoise = [];   // jendela geser level RMS beberapa detik terakhir
        let vnMeterRaf = null;         // requestAnimationFrame loop buat meteran level real-time

        const VN_KELAS_TOMBOL_IDLE = "px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-blue-200";
        const VN_KELAS_TOMBOL_REKAM = "px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md animate-pulse";
        const VN_KELAS_TOMBOL_PROSES = "px-4 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-slate-200 opacity-70 cursor-wait";

        function vnAturTombol(mode, teks) {
            const btn = document.getElementById('btn-record-voice');
            const label = document.getElementById('text-btn-record');
            if (btn) {
                btn.className = mode === 'rekam' ? VN_KELAS_TOMBOL_REKAM : (mode === 'proses' ? VN_KELAS_TOMBOL_PROSES : VN_KELAS_TOMBOL_IDLE);
                btn.disabled = (mode === 'proses');
            }
            if (label && teks) label.innerText = teks;
        }

        // ---- Angka detik berjalan di "voice-timer" ------------------------
        // Elemen #voice-timer sebelumnya cuma di-toggle hidden/muncul, teksnya
        // gak pernah diupdate (makanya "detik rekamnya" gak jalan). Nempelin
        // <span id="vn-durasi-angka"> sebagai ANAK dari elemen itu (bukan
        // menimpa innerHTML-nya) supaya ikon/markup lain yang sudah ada di
        // dalamnya tetap utuh, lalu update teksnya tiap 250ms.
        function vnFormatDurasi(detik) {
            const d = Math.max(0, Math.floor(detik));
            return Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0');
        }
        function vnAngkaTimerEl() {
            const wrap = document.getElementById('voice-timer');
            if (!wrap) return null;
            let angka = document.getElementById('vn-durasi-angka');
            if (!angka) {
                angka = document.createElement('span');
                angka.id = 'vn-durasi-angka';
                wrap.appendChild(angka);
            }
            return angka;
        }
        function vnMulaiTimer() {
            // angka detik sengaja tidak ditampilkan; hanya tulisan "Merekam..."
            clearInterval(vnTimerInterval);
            vnTimerInterval = null;
            const el = document.getElementById('vn-durasi-angka');
            if (el) el.remove();
        }
        function vnHentikanTimer() {
            clearInterval(vnTimerInterval);
            vnTimerInterval = null;
        }

        // ---- Peringatan lingkungan berisik ---------------------------------
        // Heuristik ringan (tanpa model ML): rekam level volume mentah tiap
        // 200ms ke jendela geser ~3 detik terakhir. Ucapan manusia normal
        // SELALU ada jeda (napas, koma, jeda antar kalimat) yang bikin level
        // sempat turun ke "hening". Kalau levelnya TIDAK PERNAH turun ke
        // hening sepanjang jendela itu, itu ciri khas ada suara latar terus-
        // menerus (musik/obrolan lain/kipas keras) -- tidak sempurna, tapi
        // cukup buat kasih peringatan dini tanpa beban komputasi berat.
        const VN_AMBANG_HENING = 10;       // skala RMS 0-128 dari getByteTimeDomainData
        const VN_JENDELA_SAMPEL = 15;      // 15 x 200ms = 3 detik
        function vnPasangAnalyser(ctx, sourceNode) {
            vnAnalyser = ctx.createAnalyser();
            vnAnalyser.fftSize = 512;
            sourceNode.connect(vnAnalyser); // tap saja, tidak perlu diteruskan kemana pun
        }
        function vnPeringatanNoiseEl() {
            let el = document.getElementById('vn-peringatan-noise');
            if (!el) {
                const wrap = document.getElementById('voice-timer');
                el = document.createElement('div');
                el.id = 'vn-peringatan-noise';
                el.className = 'hidden mt-1 text-[11px] font-semibold text-amber-600 flex items-center gap-1';
                el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Lingkungan cukup berisik, coba pindah ke tempat lebih tenang';
                if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(el, wrap.nextSibling);
                else document.body.appendChild(el);
            }
            return el;
        }
        // ---- Meteran level suara real-time (indikator visual) -------------
        // Terpisah dari peringatan teks di atas: ini cuma MENAMPILKAN seberapa
        // besar gelombang suara di sekitar mic saat ini, update tiap frame,
        // dari AnalyserNode yang SAMA (cuma "nguping"/tap, tidak menyambung ke
        // mana pun) -- jadi tidak menyentuh atau mengubah rantai audio asli
        // sama sekali. Dimulai begitu izin mikrofon diberikan & graf audio
        // terpasang (lihat toggleVoiceRecord), bukan menunggu rekaman mulai.
        const VN_METER_MAKS_RMS = 45; // kalibrasi kasar skala RMS 0-128 -> dipetakan ke 0-100%
        function vnMeterEl() {
            let el = document.getElementById('vn-meter-level');
            if (!el) {
                const wrap = document.getElementById('voice-timer');
                el = document.createElement('div');
                el.id = 'vn-meter-level';
                el.className = 'hidden mt-1 h-1.5 w-full max-w-[160px] rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden';
                el.innerHTML = '<div id="vn-meter-fill" class="h-full rounded-full" style="width:0%;background:#22c55e;transition:width .08s linear,background-color .15s linear"></div>';
                if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(el, wrap.nextSibling);
                else document.body.appendChild(el);
            }
            return el;
        }
        function vnMulaiMeterLevel() {
            if (!vnAnalyser) return;
            const dataArray = new Uint8Array(vnAnalyser.fftSize);
            vnMeterEl().classList.remove('hidden');
            const elFill = document.getElementById('vn-meter-fill');
            cancelAnimationFrame(vnMeterRaf);
            const gambar = () => {
                if (!vnAnalyser) return; // mic sudah ditutup di tengah jalan -> hentikan loop dengan sendirinya
                vnAnalyser.getByteTimeDomainData(dataArray);
                let sumSq = 0;
                for (let i = 0; i < dataArray.length; i++) { const v = dataArray[i] - 128; sumSq += v * v; }
                const rms = Math.sqrt(sumSq / dataArray.length);
                const persen = Math.max(0, Math.min(100, (rms / VN_METER_MAKS_RMS) * 100));
                if (elFill) {
                    elFill.style.width = persen.toFixed(0) + '%';
                    elFill.style.background = persen > 70 ? '#ef4444' : (persen > 40 ? '#f59e0b' : '#22c55e');
                }
                vnMeterRaf = requestAnimationFrame(gambar);
            };
            vnMeterRaf = requestAnimationFrame(gambar);
        }
        function vnHentikanMeterLevel() {
            cancelAnimationFrame(vnMeterRaf);
            vnMeterRaf = null;
            const el = document.getElementById('vn-meter-level');
            if (el) el.classList.add('hidden');
            const elFill = document.getElementById('vn-meter-fill');
            if (elFill) elFill.style.width = '0%';
        }

        function vnMulaiPantauNoise() {
            if (!vnAnalyser) return;
            const dataArray = new Uint8Array(vnAnalyser.fftSize);
            vnBufferLevelNoise = [];
            const elPeringatan = vnPeringatanNoiseEl();
            elPeringatan.classList.add('hidden');
            clearInterval(vnNoiseInterval);
            vnNoiseInterval = setInterval(() => {
                vnAnalyser.getByteTimeDomainData(dataArray);
                let sumSq = 0;
                for (let i = 0; i < dataArray.length; i++) { const v = dataArray[i] - 128; sumSq += v * v; }
                const rms = Math.sqrt(sumSq / dataArray.length);
                vnBufferLevelNoise.push(rms);
                if (vnBufferLevelNoise.length > VN_JENDELA_SAMPEL) vnBufferLevelNoise.shift();
                if (vnBufferLevelNoise.length >= VN_JENDELA_SAMPEL) {
                    const levelTerendah = Math.min(...vnBufferLevelNoise);
                    elPeringatan.classList.toggle('hidden', levelTerendah <= VN_AMBANG_HENING);
                }
            }, 200);
        }
        function vnHentikanPantauNoise() {
            clearInterval(vnNoiseInterval);
            vnNoiseInterval = null;
            const el = document.getElementById('vn-peringatan-noise');
            if (el) el.classList.add('hidden');
        }

        // Reset semua state Voice Note (dipanggil saat form dibuka utk tugas BARU).
        function vnResetState() {
            vnTokenSesi++;
            if (vnAutoStopTimeout) { clearTimeout(vnAutoStopTimeout); vnAutoStopTimeout = null; }
            vnHentikanTimer();
            vnHentikanPantauNoise();
            vnHentikanMeterLevel();
            vnTutupMic();
            audioBlob = null;
            audioDataUrl = null;
            vnDurasiDetik = 0;
            vnBaruPerluUpload = false;
            vnIdAktif = null;
            vnSedangMemproses = false;
            vnAturTombol('idle', 'Mulai Rekam Suara');
        }

        function vnTutupMic() {
            vnHentikanMeterLevel();
            if (vnStream) { vnStream.getTracks().forEach(t => t.stop()); vnStream = null; }
            if (vnAudioCtx) { vnAudioCtx.close().catch(() => {}); vnAudioCtx = null; }
            vnAnalyser = null;
        }

        // Native browser audio constraints (echoCancellation/noiseSuppression/
        // autoGainControl bawaan getUserMedia, lihat toggleVoiceRecord) dipilih
        // sebagai peredam noise UTAMA -- paling stabil, tanpa AI/WASM eksternal
        // yang bisa "over-aktif" dan memutus suara. Di atasnya cuma ditambah
        // SATU BiquadFilterNode highpass sederhana: memotong dengung/gemuruh
        // frekuensi rendah (kipas, AC, desah mic) di bawah ~100Hz. Filter ini
        // TIDAK menyentuh rentang suara manusia sama sekali (>100Hz), jadi
        // vokal dijamin utuh 100% -- tidak ada gate/compressor/AI yang bisa
        // memutus atau meredam kata yang sedang diucapkan.
        function vnBangunRantai(ctx, sourceNode) {
            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 100; // di bawah ini: dengung kipas/AC/gemuruh -- di atas ini: suara manusia, dibiarkan lolos utuh
            highpass.Q.value = 0.707;       // Q netral (Butterworth) -- tidak ada penekanan/resonansi tambahan di titik potong
            sourceNode.connect(highpass);
            return highpass;
        }

        function vnMimeTerbaik() {
            const kandidat = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
            return kandidat.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
        }

        // Encode ulang AudioBuffer ke bitrate tertentu (tanpa rantai suppressi lagi --
        // audio yang sampai sini sudah melewatinya saat direkam, jangan diproses 2x).
        function vnEncodeUlang(audioBuffer, bitrate) {
            return new Promise((resolve, reject) => {
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    const src = ctx.createBufferSource();
                    src.buffer = audioBuffer;
                    const tujuan = ctx.createMediaStreamDestination();
                    src.connect(tujuan);
                    const mime = vnMimeTerbaik();
                    const rec = mime
                        ? new MediaRecorder(tujuan.stream, { mimeType: mime, audioBitsPerSecond: bitrate })
                        : new MediaRecorder(tujuan.stream);
                    const chunks = [];
                    rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
                    rec.onstop = () => {
                        ctx.close().catch(() => {});
                        resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
                    };
                    rec.onerror = e => { ctx.close().catch(() => {}); reject(e.error || e); };
                    rec.start();
                    src.start();
                    src.onended = () => setTimeout(() => { try { rec.stop(); } catch (e) {} }, 150);
                } catch (err) { reject(err); }
            });
        }

        // Pastikan hasil <= 1 MB. Kalau rekaman langsung sudah muat -> pakai apa adanya.
        // Kalau belum -> decode lalu encode ulang dgn bitrate makin rendah.
        // Lempar Error (pesan siap tampil) kalau tetap kegedean.
        async function vnKompresJikaPerlu(blobMentah, durasiPerkiraan) {
            if (blobMentah.size <= VN_MAX_BYTES) return { blob: blobMentah, durasi: durasiPerkiraan };
            if (!VN_DIDUKUNG_WEBAUDIO) {
                throw new Error('Rekaman lebih dari 1 MB dan browser ini tidak bisa mengompresnya. Rekam ulang dengan durasi lebih singkat.');
            }
            const ctxDecode = new (window.AudioContext || window.webkitAudioContext)();
            try {
                let audioBuffer;
                try {
                    audioBuffer = await ctxDecode.decodeAudioData((await blobMentah.arrayBuffer()).slice(0));
                } catch (e) {
                    throw new Error('Rekaman tidak bisa diproses. Coba rekam ulang.');
                }
                for (let i = 1; i < VN_TINGKATAN_BITRATE.length; i++) { // i=1: 32kbps sudah dipakai saat merekam
                    const hasil = await vnEncodeUlang(audioBuffer, VN_TINGKATAN_BITRATE[i]);
                    if (hasil.size <= VN_MAX_BYTES) return { blob: hasil, durasi: audioBuffer.duration };
                }
                const maxMenit = Math.floor(VN_MAX_BYTES * 8 / VN_TINGKATAN_BITRATE[VN_TINGKATAN_BITRATE.length - 1] / 60);
                throw new Error('Rekaman tetap lebih dari 1 MB walau sudah dikompres maksimal. Perpendek rekamannya (idealnya di bawah ' + maxMenit + ' menit) lalu rekam ulang.');
            } finally {
                ctxDecode.close().catch(() => {});
            }
        }

        function vnBlobKeDataURL(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        async function vnSelesaikanRekaman(blobMentah, durasiPerkiraan) {
            const tokenSaatIni = vnTokenSesi;
            vnSedangMemproses = true;
            vnAturTombol('proses', 'Memproses audio...');
            try {
                const { blob, durasi } = await vnKompresJikaPerlu(blobMentah, durasiPerkiraan);
                const dataUrl = await vnBlobKeDataURL(blob);
                if (tokenSaatIni !== vnTokenSesi) return; // form sudah ditutup/dibuka ulang -> buang hasil
                audioBlob = blob;
                audioMimeType = blob.type || audioMimeType;
                audioDataUrl = dataUrl;
                vnDurasiDetik = durasi || durasiPerkiraan || 0;
                vnBaruPerluUpload = true; // rekaman baru -> transkrip lama (kalau ada) sudah tidak cocok
                document.getElementById('audio-preview').src = dataUrl;
                document.getElementById('audio-preview-container').classList.remove('hidden');
                vnAturTombol('idle', 'Rekam Ulang Suara');
            } catch (err) {
                if (tokenSaatIni !== vnTokenSesi) return;
                alert(err && err.message ? err.message : 'Gagal memproses rekaman. Coba rekam ulang.');
                // Rekaman sebelumnya (kalau ada) tetap dipertahankan.
                vnAturTombol('idle', audioDataUrl ? 'Rekam Ulang Suara' : 'Mulai Rekam Suara');
            } finally {
                if (tokenSaatIni === vnTokenSesi) vnSedangMemproses = false;
            }
        }

        async function toggleVoiceRecord() {
            if (vnSedangMemproses) return;
            if (isRecording) { stopVoiceRecord(); return; }
            if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) {
                alert("Browser ini tidak mendukung perekaman suara. Gunakan Chrome/Edge terbaru.");
                return;
            }
            // Peredam noise UTAMA: native browser audio constraints bawaan
            // getUserMedia -- paling stabil, tanpa beban WASM/AI eksternal yang
            // bisa over-aktif dan memutus suara (lihat riwayat RNNoise di atas).
            try {
                vnStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
            } catch (e) {
                alert("Gagal mengakses mikrofon browser. Pastikan izin mikrofon aktif.");
                return;
            }

            // Tambahan manual: SATU highpass filter (lihat vnBangunRantai) buat
            // memotong dengung/gemuruh frekuensi rendah tanpa menyentuh suara
            // manusia sama sekali. Kalau Web Audio tidak ada, rekam stream mentah
            // (constraint noiseSuppression bawaan browser tetap aktif).
            let streamRekam = vnStream;
            if (VN_DIDUKUNG_WEBAUDIO) {
                vnAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const src = vnAudioCtx.createMediaStreamSource(vnStream);
                const tujuan = vnAudioCtx.createMediaStreamDestination();
                vnBangunRantai(vnAudioCtx, src).connect(tujuan);
                streamRekam = tujuan.stream;
                vnPasangAnalyser(vnAudioCtx, src); // tap suara MENTAH (sebelum filter) buat deteksi lingkungan berisik
                vnMulaiMeterLevel(); // indikator visual real-time, mulai begitu izin mic diberikan
            }

            // Blob HARUS bertipe sama dgn format rekaman asli, kalau tidak <audio> gagal decode.
            const mimeTerpilih = vnMimeTerbaik();
            try {
                mediaRecorder = mimeTerpilih
                    ? new MediaRecorder(streamRekam, { mimeType: mimeTerpilih, audioBitsPerSecond: VN_TINGKATAN_BITRATE[0] })
                    : new MediaRecorder(streamRekam);
            } catch (e) {
                mediaRecorder = new MediaRecorder(streamRekam);
            }
            audioMimeType = mediaRecorder.mimeType || mimeTerpilih || 'audio/webm';

            audioChunks = [];
            mediaRecorder.ondataavailable = event => { if (event.data && event.data.size > 0) audioChunks.push(event.data); };
            mediaRecorder.onstop = async () => {
                vnTutupMic(); // matikan akses mikrofon setelah selesai rekam
                const blobMentah = new Blob(audioChunks, { type: audioMimeType });
                const durasi = (Date.now() - vnWaktuMulai) / 1000;
                await vnSelesaikanRekaman(blobMentah, durasi);
            };
            mediaRecorder.start();
            vnWaktuMulai = Date.now();
            isRecording = true;
            vnAturTombol('rekam', 'Berhenti Merekam');
            document.getElementById('voice-timer').classList.remove('hidden');
            vnMulaiTimer();
            vnMulaiPantauNoise();

            clearTimeout(vnAutoStopTimeout);
            vnAutoStopTimeout = setTimeout(() => {
                if (isRecording) {
                    alert('Durasi maksimal rekaman (8 menit) tercapai, rekaman dihentikan otomatis.');
                    stopVoiceRecord();
                }
            }, VN_BATAS_DURASI_MS);
        }

        function stopVoiceRecord() {
            if (mediaRecorder && isRecording) {
                clearTimeout(vnAutoStopTimeout);
                vnAutoStopTimeout = null;
                isRecording = false;
                document.getElementById('voice-timer').classList.add('hidden');
                vnHentikanTimer();
                vnHentikanPantauNoise();
                vnHentikanMeterLevel();
                vnAturTombol('proses', 'Memproses audio...');
                try { mediaRecorder.stop(); } catch (e) { vnTutupMic(); vnAturTombol('idle', audioDataUrl ? 'Rekam Ulang Suara' : 'Mulai Rekam Suara'); }
            }
        }

        // Kirim audio ke server utk di-transkrip. Balikin { id } kalau sukses,
        // { error } kalau gagal -- TIDAK melempar error, supaya kegagalan STT
        // tidak menggagalkan pengiriman tugasnya sendiri.
        async function vnUploadUntukTranskrip(kelas) {
            try {
                const res = await fetch('/api/guru/vn-tugas/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kelas: kelas, audio_data_url: audioDataUrl, durasi_detik: vnDurasiDetik })
                });
                const data = await res.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
                if (!res.ok || !data.success) return { error: data.message || 'Server menolak audio.' };
                vnBaruPerluUpload = false;
                return { id: data.id };
            } catch (e) {
                return { error: 'Tidak bisa terhubung ke server.' };
            }
        }

        function vnHapusTranskripServer(vnId) {
            if (!vnId) return;
            fetch('/api/guru/vn-tugas/hapus/' + encodeURIComponent(vnId), { method: 'POST' }).catch(() => {});
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
        function bukaModalKonfirmasiGenerik({ judul = 'Konfirmasi', pesan = '', teksTombol = 'Ya, Lanjutkan', ikon = 'fa-triangle-exclamation', warnaTombol = 'rose', tampilkanInputKeterangan = false, keteranganAwal = '', tampilkanInputTanggal = false, onKonfirmasi }) {
            const modal = document.getElementById('modal-konfirmasi-generik');
            if (!modal) { if (onKonfirmasi) onKonfirmasi(keteranganAwal || '', null); return; }

            document.getElementById('konfirmasi-generik-judul').querySelector('span').textContent = judul;
            document.getElementById('konfirmasi-generik-ikon').className = `fa-solid ${ikon} text-${warnaTombol === 'rose' ? 'rose' : 'amber'}-500`;
            document.getElementById('konfirmasi-generik-pesan').textContent = pesan;

            const wrapKeterangan = document.getElementById('konfirmasi-generik-wrap-keterangan');
            const inputKeterangan = document.getElementById('konfirmasi-generik-input-keterangan');
            const btnAksi = document.getElementById('konfirmasi-generik-btn-aksi');

            // FITUR TAMBAHAN: input tanggal+jam batas waktu revisi -- opsional
            // (guru boleh kosongkan, tidak menghalangi tombol aksi, beda dengan
            // keterangan yang wajib diisi). Lihat mintaKeputusanTugasDariRekap().
            const wrapTanggal = document.getElementById('konfirmasi-generik-wrap-tanggal');
            const inputTanggal = document.getElementById('konfirmasi-generik-input-tanggal');
            const inputJamTanggal = document.getElementById('konfirmasi-generik-input-jam');
            if (wrapTanggal) {
                wrapTanggal.classList.toggle('hidden', !tampilkanInputTanggal);
                if (inputTanggal) inputTanggal.value = '';
                if (inputJamTanggal) inputJamTanggal.value = '';
            }

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
                // Batas revisi cuma dianggap terisi kalau TANGGAL-nya diisi guru
                // (jam boleh dikosongkan, default 23:59 -- akhir hari). Kalau
                // tanggal kosong, dikirim null ke pemanggil = "tidak ada batas".
                let batasRevisi = null;
                if (tampilkanInputTanggal && inputTanggal && inputTanggal.value) {
                    const tglVal = inputTanggal.value;
                    const jamVal = (inputJamTanggal && inputJamTanggal.value) ? inputJamTanggal.value : '23:59';
                    const ts = new Date(`${tglVal}T${jamVal}:00`).getTime();
                    if (!isNaN(ts)) {
                        batasRevisi = { timestamp: ts, formatted: `${tglVal} Pukul ${jamVal} WIB` };
                    }
                }
                tutupModalKonfirmasiGenerik();
                if (cb) cb(teksKeterangan, batasRevisi);
            };

            modal.classList.remove('hidden');
        }

        // PERBAIKAN BUG: sebelumnya foto bukti tugas dibuka lewat
        // window.open(this.src, '_blank') -- tapi src foto di sini SELALU
        // data URL base64 (bukan URL http/https biasa, lihat catatan
        // kompresi foto tugas), dan Chrome MEMBLOKIR navigasi tab baru yang
        // langsung ke data: URL demi keamanan -- diam-diam cuma membuka tab
        // kosong "about:blank" tanpa pesan error apa pun ke guru, seolah
        // fotonya tidak kebuka. Sekarang foto dibuka lewat lightbox DI DALAM
        // halaman ini (elemen dibuat dinamis lewat JS, tidak butuh markup
        // HTML tambahan apa pun) -- tidak ada navigasi tab baru sama sekali,
        // jadi tidak kena blokir tsb.
        // ===== Zoom di lightbox foto tugas siswa =====
        // Ditambahkan supaya guru bisa perbesar/perkecil foto bukti tugas
        // buat lihat detail (mis. tulisan tangan kecil) -- lewat tombol +/-,
        // scroll mouse (desktop), pinch 2 jari & double-tap (HP), lalu bisa
        // digeser (pan) begitu sedang di-zoom.
        let lightboxZoomState = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };
        const LIGHTBOX_ZOOM_MIN = 1;
        const LIGHTBOX_ZOOM_MAX = 4;
        const LIGHTBOX_ZOOM_STEP = 0.5;

        function terapkanZoomLightbox() {
            const img = document.getElementById('lightbox-foto-tugas-img');
            if (!img) return;
            img.style.transform = `translate(${lightboxZoomState.tx}px, ${lightboxZoomState.ty}px) scale(${lightboxZoomState.scale})`;
            img.style.cursor = lightboxZoomState.scale > LIGHTBOX_ZOOM_MIN ? 'grab' : 'zoom-in';
            const label = document.getElementById('lightbox-zoom-persen');
            if (label) label.textContent = Math.round(lightboxZoomState.scale * 100) + '%';
        }

        function clampZoomLightbox() {
            if (lightboxZoomState.scale < LIGHTBOX_ZOOM_MIN) lightboxZoomState.scale = LIGHTBOX_ZOOM_MIN;
            if (lightboxZoomState.scale > LIGHTBOX_ZOOM_MAX) lightboxZoomState.scale = LIGHTBOX_ZOOM_MAX;
            // Begitu balik ke skala 1x (paling kecil/normal), posisi geser
            // ikut direset supaya fotonya balik rapi ke tengah.
            if (lightboxZoomState.scale === LIGHTBOX_ZOOM_MIN) { lightboxZoomState.tx = 0; lightboxZoomState.ty = 0; }
        }

        function resetZoomLightbox() {
            lightboxZoomState.scale = LIGHTBOX_ZOOM_MIN;
            lightboxZoomState.tx = 0;
            lightboxZoomState.ty = 0;
            lightboxZoomState.dragging = false;
            terapkanZoomLightbox();
        }

        function ubahZoomLightbox(delta) {
            lightboxZoomState.scale += delta;
            clampZoomLightbox();
            terapkanZoomLightbox();
        }

        // Dipanggil SEKALI saja saat lightbox pertama kali dibuat -- pasang
        // semua listener kontrol zoom di sini (bukan di bukaFotoPreviewBesar)
        // supaya tidak numpuk listener duplikat tiap foto dibuka.
        function pasangKontrolZoomLightbox() {
            const img = document.getElementById('lightbox-foto-tugas-img');
            document.getElementById('lightbox-zoom-in').addEventListener('click', (e) => { e.stopPropagation(); ubahZoomLightbox(LIGHTBOX_ZOOM_STEP); });
            document.getElementById('lightbox-zoom-out').addEventListener('click', (e) => { e.stopPropagation(); ubahZoomLightbox(-LIGHTBOX_ZOOM_STEP); });
            document.getElementById('lightbox-zoom-persen').addEventListener('click', (e) => { e.stopPropagation(); resetZoomLightbox(); });

            // Scroll roda mouse buat zoom in/out (desktop).
            img.addEventListener('wheel', (e) => {
                e.preventDefault();
                ubahZoomLightbox(e.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP);
            }, { passive: false });

            // Double-click (desktop) / double-tap (HP): toggle zoom 1x <-> 2.5x.
            function toggleZoomGanda() {
                if (lightboxZoomState.scale > LIGHTBOX_ZOOM_MIN) {
                    resetZoomLightbox();
                } else {
                    lightboxZoomState.scale = 2.5;
                    terapkanZoomLightbox();
                }
            }
            img.addEventListener('dblclick', (e) => { e.stopPropagation(); toggleZoomGanda(); });
            let waktuTapTerakhir = 0;
            img.addEventListener('touchend', (e) => {
                const sekarang = Date.now();
                if (sekarang - waktuTapTerakhir < 300 && e.touches.length === 0) toggleZoomGanda();
                waktuTapTerakhir = sekarang;
            });

            // Geser (pan) pakai mouse begitu foto sedang di-zoom.
            img.addEventListener('mousedown', (e) => {
                if (lightboxZoomState.scale <= LIGHTBOX_ZOOM_MIN) return;
                lightboxZoomState.dragging = true;
                lightboxZoomState.startX = e.clientX;
                lightboxZoomState.startY = e.clientY;
                lightboxZoomState.startTx = lightboxZoomState.tx;
                lightboxZoomState.startTy = lightboxZoomState.ty;
                img.style.cursor = 'grabbing';
            });
            window.addEventListener('mousemove', (e) => {
                if (!lightboxZoomState.dragging) return;
                lightboxZoomState.tx = lightboxZoomState.startTx + (e.clientX - lightboxZoomState.startX);
                lightboxZoomState.ty = lightboxZoomState.startTy + (e.clientY - lightboxZoomState.startY);
                terapkanZoomLightbox();
            });
            window.addEventListener('mouseup', () => {
                if (lightboxZoomState.dragging) { lightboxZoomState.dragging = false; terapkanZoomLightbox(); }
            });

            // Pinch 2 jari buat zoom, geser 1 jari begitu sedang di-zoom (HP).
            let pinchJarakAwal = 0;
            let pinchSkalaAwal = 1;
            img.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) {
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    pinchJarakAwal = Math.hypot(dx, dy);
                    pinchSkalaAwal = lightboxZoomState.scale;
                } else if (e.touches.length === 1 && lightboxZoomState.scale > LIGHTBOX_ZOOM_MIN) {
                    lightboxZoomState.dragging = true;
                    lightboxZoomState.startX = e.touches[0].clientX;
                    lightboxZoomState.startY = e.touches[0].clientY;
                    lightboxZoomState.startTx = lightboxZoomState.tx;
                    lightboxZoomState.startTy = lightboxZoomState.ty;
                }
            }, { passive: true });
            img.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2 && pinchJarakAwal > 0) {
                    e.preventDefault();
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    const jarakSekarang = Math.hypot(dx, dy);
                    lightboxZoomState.scale = pinchSkalaAwal * (jarakSekarang / pinchJarakAwal);
                    clampZoomLightbox();
                    terapkanZoomLightbox();
                } else if (e.touches.length === 1 && lightboxZoomState.dragging) {
                    e.preventDefault();
                    lightboxZoomState.tx = lightboxZoomState.startTx + (e.touches[0].clientX - lightboxZoomState.startX);
                    lightboxZoomState.ty = lightboxZoomState.startTy + (e.touches[0].clientY - lightboxZoomState.startY);
                    terapkanZoomLightbox();
                }
            }, { passive: false });
            img.addEventListener('touchend', () => {
                pinchJarakAwal = 0;
                lightboxZoomState.dragging = false;
            }, { passive: true });
        }

        function bukaFotoPreviewBesar(src, alt) {
            let overlay = document.getElementById('lightbox-foto-tugas');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'lightbox-foto-tugas';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.92);display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;overflow:hidden;';
                overlay.innerHTML = `
                    <img id="lightbox-foto-tugas-img" style="max-width:min(92vw,1000px);max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);cursor:zoom-in;touch-action:none;transition:transform .06s ease-out;" alt="">
                    <div id="lightbox-foto-tugas-kontrol" style="position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);backdrop-filter:blur(6px);padding:6px;border-radius:9999px;">
                        <button id="lightbox-zoom-out" title="Perkecil" style="width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,.15);color:#fff;border:none;font-size:20px;line-height:1;cursor:pointer;">&minus;</button>
                        <button id="lightbox-zoom-persen" title="Reset ke 100%" style="min-width:56px;height:40px;border-radius:9999px;background:rgba(255,255,255,.15);color:#fff;border:none;font-size:13px;font-weight:600;cursor:pointer;padding:0 10px;">100%</button>
                        <button id="lightbox-zoom-in" title="Perbesar" style="width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,.15);color:#fff;border:none;font-size:20px;line-height:1;cursor:pointer;">&plus;</button>
                    </div>
                    <button id="lightbox-foto-tugas-tutup" style="position:absolute;top:20px;right:24px;width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,.15);color:#fff;border:none;font-size:22px;line-height:1;cursor:pointer;">&times;</button>
                `;
                // Klik di area gelap overlay ATAU tombol close menutup lightbox;
                // klik pada gambar/kontrol zoom itu sendiri TIDAK ikut menutup
                // (supaya guru bisa zoom/geser gambar besar tanpa sengaja
                // menutupnya).
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay || e.target.id === 'lightbox-foto-tugas-tutup') tutupFotoPreviewBesar();
                });
                document.body.appendChild(overlay);
                pasangKontrolZoomLightbox();
            }
            resetZoomLightbox();
            document.getElementById('lightbox-foto-tugas-img').src = src;
            document.getElementById('lightbox-foto-tugas-img').alt = alt || 'Bukti tugas';
            overlay.style.display = 'flex';
        }
        function tutupFotoPreviewBesar() {
            const overlay = document.getElementById('lightbox-foto-tugas');
            if (overlay) overlay.style.display = 'none';
        }

        function tutupModalKonfirmasiGenerik() {
            const modal = document.getElementById('modal-konfirmasi-generik');
            if (modal) modal.classList.add('hidden');
            _callbackKonfirmasiGenerikAktif = null;
            const wrapKeterangan = document.getElementById('konfirmasi-generik-wrap-keterangan');
            const inputKeterangan = document.getElementById('konfirmasi-generik-input-keterangan');
            if (wrapKeterangan) wrapKeterangan.classList.add('hidden');
            if (inputKeterangan) { inputKeterangan.value = ''; inputKeterangan.oninput = null; }
            const wrapTanggal = document.getElementById('konfirmasi-generik-wrap-tanggal');
            const inputTanggal = document.getElementById('konfirmasi-generik-input-tanggal');
            const inputJamTanggal = document.getElementById('konfirmasi-generik-input-jam');
            if (wrapTanggal) wrapTanggal.classList.add('hidden');
            if (inputTanggal) inputTanggal.value = '';
            if (inputJamTanggal) inputJamTanggal.value = '';
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

        // Toast "Sedang Mengerjakan" -- dipakai waktu guru klik kartu murid di
        // Denah Kelas tapi murid itu belum mengumpulkan PADAHAL ada tugas aktif
        // di kelas itu (baik dari guru yang sedang login MAUPUN dari guru lain).
        // Sengaja dibuat toast terpisah (bukan pakai alert() polos) supaya guru
        // langsung tahu nama mata pelajaran & judul tugasnya, bukan cuma "belum
        // mengumpulkan" yang bisa disalahartikan seolah murid tidak mengerjakan
        // apa-apa. Ikon & warnanya sengaja biru (bukan hijau seperti toast sukses
        // kirim tugas) supaya beda maknanya sekilas -- ini "sedang berjalan",
        // bukan "sudah selesai".
        function tampilkanToastSedangMengerjakan(namaSiswa, mapel, judulTugas) {
            const container = document.getElementById('toast-sukses-container');
            if (!container) return;

            const idToast = 'toast-info-' + Date.now();
            const toast = document.createElement('div');
            toast.id = idToast;
            toast.className = 'toast-sukses-kirim';
            const teksJudulTugas = judulTugas ? ` "${judulTugas}"` : '';
            toast.innerHTML = `
                <span class="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0 animate-pulse">
                    <i class="fa-solid fa-pen"></i>
                </span>
                <div class="flex-1 min-w-0">
                    <p class="toast-teks-judul">Sedang Mengerjakan</p>
                    <p class="toast-teks-pesan">${namaSiswa} sedang mengerjakan tugas${teksJudulTugas} (${mapel || 'Mapel'}).</p>
                </div>
                <button class="toast-btn-tutup" onclick="tutupToastSuksesKirimTugas('${idToast}')">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            container.appendChild(toast);

            setTimeout(() => tutupToastSuksesKirimTugas(idToast), 5000);
        }

        // Ambil status tugas aktif kelas untuk keperluan notifikasi kartu murid
        // (klik murid yang belum mengumpulkan di Denah Kelas) -- dipisah jadi
        // fungsi sendiri (bukan cuma dihitung sekali di dalam bukaDetailKelas)
        // supaya bisa dipanggil lagi dari periksaSiswa() tanpa gantung ke
        // variabel lokal punya bukaDetailKelas yang sudah keluar dari scope.
        // PERBAIKAN (PENTING): dulu fungsi ini (infoStatusTugasAktifKelas) sama
        // sekali TIDAK per-murid -- 1 hasil yang sama dipukul rata ke SEMUA murid
        // di kelas itu, dan dasarnya cuma baca t.studentSubmitted (field lama yang
        // TIDAK PERNAH diisi data asli, lihat catatan sinkronkanSubmissionSiswaAsli
        // di bawah). Efeknya: status "STATUS SISWA DI GURU" (modal detail dari
        // Denah Kelas) tidak pernah benar-benar mencerminkan tugas MANA yang sudah/
        // belum dikumpulkan MURID INI, dan kalau ada >1 tugas aktif di kelas yang
        // sama (dari guru berbeda ataupun guru yang sama), yang dipakai selalu
        // tugas yang PALING DULU DIBUAT (belum[0]) -- bukan yang paling mendesak.
        //
        // Sekarang diganti infoStatusTugasAktifSiswa(namaKelas, murid): per MURID,
        // baca status pengumpulan ASLI (window._cacheSubmisiTugas, sama sumber data
        // dengan Rekap Pengumpulan/"Perlu Dinilai"), dan pilih tugas yang jadi
        // acuan status pakai aturan ini (BUKAN urutan dibuat):
        //   1) Di antara tugas yang BELUM dikumpulkan murid ini & deadline-nya
        //      BELUM lewat, ambil yang deadline-nya PALING DEKAT (paling mendesak).
        //      Begitu 1 tugas lewat deadline tanpa dikumpulkan, tugas itu otomatis
        //      berhenti dianggap "aktif" di sini -- status murid pindah sendiri ke
        //      tugas lain yang masih berlaku (kalau ada), persis seperti murid
        //      "sudah masuk ke tugas berikutnya" begitu tugas sebelumnya kelewat.
        //   2) Kalau SEMUA tugas yang belum dikumpulkan sudah lewat deadline (tidak
        //      ada lagi yang masih berlaku), baru dianggap "Terlambat" -- diwakili
        //      tugas yang paling BARU lewat deadline-nya (paling relevan sekarang).
        //   3) Kalau semua tugas di kelas ini sudah dikumpulkan murid (atau memang
        //      belum ada tugas sama sekali), hasilnya "Belum Ada Tugas" -- KECUALI
        //      tugas TERAKHIR yang dikumpulkannya diputuskan "Perlu Revisi" oleh
        //      gurunya (dicek dari data ASLI /api/sync/bulk, bukan field
        //      siswa.keputusanTugasTerakhir lama yang tidak pernah diisi).
        async function infoStatusTugasAktifSiswa(namaKelas, murid) {
            const tasksKelasIni = getTasksKelas(namaKelas);
            const kelasInfo = daftarSeluruhKelasDummy.find(k => k.nama === namaKelas);
            const mapel = kelasInfo ? kelasInfo.mapel : '';

            const kosong = (statusKode) => ({ statusKode, hasActiveTask: false, isExpired: false, judul: '', namaGuru: '', mapel });

            if (tasksKelasIni.length === 0) return kosong('belum_ada_tugas');

            // Status di sini SENGAJA lintas guru (lihat catatan privasi di
            // periksaSiswa()) -- jadi tugas yang belum sempat ke-cache (mis. milik
            // guru lain yang belum pernah membuka "Perlu Dinilai"-nya sendiri) perlu
            // di-fetch dulu di sini, paralel, supaya tidak ketinggalan dihitung.
            await Promise.all(tasksKelasIni.map(async (t) => {
                if (window._cacheSubmisiTugas[t.id]) return;
                const { data, gagal } = await ambilSubmisiTugasServer(t.id);
                if (!gagal) window._cacheSubmisiTugas[t.id] = data;
            }));

            // hasilPeriksaBulk dikosongkan ({}) di sini SENGAJA -- kita cuma perlu
            // status submitted/dilihat murni dari cache submisi, BUKAN nilai/
            // catatan/keputusan (itu baru dicek belakangan, khusus kalau ternyata
            // semua tugas sudah dikumpulkan -- lihat di bawah), supaya tidak
            // memicu ambilHasilPeriksaTersimpan() yang masih pakai getSync()
            // (XHR sinkron/blocking) untuk tiap tugas.
            const semua = tasksKelasIni.map(t => ({
                t,
                kedaluwarsa: cekStatusTugasKedaluwarsaGuru(t),
                status: statusPengumpulanUntukTugas(murid, t, false, {})
            }));
            const belum = semua.filter(x => !x.status.submitted);

            if (belum.length > 0) {
                const masihAktif = belum.filter(x => !x.kedaluwarsa);
                if (masihAktif.length > 0) {
                    // Paling mendesak = deadline PALING DEKAT ke sekarang.
                    masihAktif.sort((a, b) => (a.t.deadlineTimestamp ?? Infinity) - (b.t.deadlineTimestamp ?? Infinity));
                    const terpilih = masihAktif[0];
                    return {
                        statusKode: terpilih.status.dilihat ? 'sedang' : 'belum_dikerjakan',
                        hasActiveTask: true,
                        isExpired: false,
                        judul: terpilih.t.judul || terpilih.t.tipe || '',
                        namaGuru: terpilih.t.namaGuru || 'Guru Mata Pelajaran',
                        mapel
                    };
                }
                // Semua yang belum dikumpulkan sudah lewat deadline -- wakili
                // dengan yang paling BARU lewat deadline-nya (deadlineTimestamp
                // terbesar di antara yang sudah kedaluwarsa).
                belum.sort((a, b) => (b.t.deadlineTimestamp || 0) - (a.t.deadlineTimestamp || 0));
                const terlambat = belum[0];
                return {
                    statusKode: 'terlambat',
                    hasActiveTask: true,
                    isExpired: true,
                    judul: terlambat.t.judul || terlambat.t.tipe || '',
                    namaGuru: terlambat.t.namaGuru || 'Guru Mata Pelajaran',
                    mapel
                };
            }

            // Semua tugas di kelas ini sudah dikumpulkan murid ini -- cek dulu
            // apakah tugas TERAKHIR (paling baru dikirim guru) yang dikumpulkannya
            // itu diputuskan "Perlu Revisi". status.keputusan di sini sudah
            // langsung datang dari tugas_submission_store (field yang sama
            // dgn submitted/images -- lihat statusPengumpulanUntukTugas()),
            // jadi TIDAK perlu request /api/sync/bulk terpisah lagi seperti
            // sebelumnya -- cache submisi yang sudah di-fetch di awal fungsi
            // ini (lihat window._cacheSubmisiTugas di atas) sudah cukup.
            const sudahList = semua.filter(x => x.status.submitted);
            sudahList.sort((a, b) => (b.t.waktuKirimGuru || 0) - (a.t.waktuKirimGuru || 0));
            const terakhir = sudahList[0];
            if (terakhir && terakhir.status.keputusan === 'revisi') {
                return {
                    statusKode: 'revisi',
                    hasActiveTask: true,
                    isExpired: false,
                    judul: terakhir.t.judul || terakhir.t.tipe || '',
                    namaGuru: terakhir.t.namaGuru || 'Guru Mata Pelajaran',
                    mapel
                };
            }

            return kosong('belum_ada_tugas');
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

            mainkanAnimasiKirimTugasGuru(async () => {
                const deadlineTimestamp = new Date(`${tglVal}T${jamVal}:00`).getTime();
                const deadlineFormatted = `${tglVal} Pukul ${jamVal} WIB`;

                // Voice Note baru -> upload dulu ke server utk di-transkrip (STT jalan di
                // background di server, guru tidak menunggu hasilnya). Kalau gagal, tugas
                // TETAP terkirim dengan audionya; hanya transkrip teksnya yang tidak ada.
                let vnIdFinal = vnIdAktif;
                let peringatanVN = '';
                if (audioDataUrl && vnBaruPerluUpload) {
                    const hasilUpload = await vnUploadUntukTranskrip(selectedKelasBeriTugas);
                    if (hasilUpload.id) {
                        vnIdFinal = hasilUpload.id;
                    } else {
                        vnIdFinal = null;
                        peringatanVN = 'Tugas tetap terkirim beserta voice note-nya, tetapi teks transkrip suara tidak bisa dibuat: ' + hasilUpload.error;
                    }
                } else if (!audioDataUrl) {
                    vnIdFinal = null;
                }
                let vnIdLamaDihapus = null;

                const tasks = getTasksKelas(selectedKelasBeriTugas);

                if (editingTaskId) {
                    // MODE EDIT: cuma memperbarui 1 tugas yang sedang dipilih (by id).
                    // Tugas-tugas lain di kelas yang sama tetap utuh, tidak ke-replace.
                    const idx = tasks.findIndex(t => t.id === editingTaskId);
                    if (idx !== -1) {
                        const deadlineLamaTimestamp = tasks[idx].deadlineTimestamp || null;
                        if (tasks[idx].vnId && tasks[idx].vnId !== vnIdFinal) vnIdLamaDihapus = tasks[idx].vnId;

                        tasks[idx] = {
                            ...tasks[idx],
                            judul: judul,
                            tipe: jenisKontenAktif === 'tugas' ? 'Tugas Utama' : 'Catatan Guru',
                            teks: teks || "Instruksi Pesan Suara dari Guru.",
                            deadline: deadlineFormatted,
                            deadlineTimestamp: deadlineTimestamp,
                            hasVN: !!audioDataUrl,
                            audioDataUrl: audioDataUrl || null,
                            vnId: vnIdFinal || null,
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
                    saveTasksKelas(selectedKelasBeriTugas, tasks, idx !== -1 ? { jenis: 'upsert', task: tasks[idx] } : undefined);
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
                        hasVN: !!audioDataUrl,
                        audioDataUrl: audioDataUrl || null,
                        vnId: vnIdFinal || null,
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
                    saveTasksKelas(selectedKelasBeriTugas, tasks, { jenis: 'upsert', task: dataTugasBaru });
                    lilyTugasDibuat(selectedKelasBeriTugas, jenisKontenAktif === 'tugas' ? 'tugas' : 'catatan'); // hanya tugas BARU (bukan edit) yang dihitung Lily
                    tampilkanToastSuksesKirimTugas('Berhasil!', `Tugas baru untuk kelas ${selectedKelasBeriTugas} berhasil dikirim. Kini ada ${tasks.length} tugas/catatan aktif di kelas ini.`);
                }

                // Kalau bel otomatis lagi bunyi untuk kelas yang baru saja dikasih tugas ini, matikan.
                matikanBelMengajar();
                perbaruiNotifJadwalGuru(); // notifikasi pengingat jadwal ikut hilang
                perbaruiPengingatPraJadwalGuru(); // pengingat 10/5 menit sebelum jadwal ikut hilang

                tutupModalBeriTugas();
                renderBerandaKelasBerurutan();
                renderSeluruhKelas();
                renderRekapSemuaTugas();
                renderAktivitasTugasTerbaruBeranda();

                vnHapusTranskripServer(vnIdLamaDihapus); // rekaman diganti -> transkrip lama dibuang
                if (peringatanVN) alert(peringatanVN);
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
                    saveTasksKelas(namaKelas, tasks, { jenis: 'hapus', taskId: taskId });

                    if (tugasDitarik && tugasDitarik.vnId) vnHapusTranskripServer(tugasDitarik.vnId);
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
            if (window.AntrianSyncGuru) {
                // Diantrikan (tahan internet putus); id notif dibuat di sini supaya idempoten.
                const namaGuruQ = tugasDitarik.namaGuru || cariNamaGuruKelas(namaKelas);
                const judulQ = tugasDitarik.judul || tugasDitarik.tipe || 'Tugas Pembelajaran';
                window.AntrianSyncGuru.antriNotif(namaKelas, {
                    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    tipe: 'tugas_ditarik',
                    namaGuru: namaGuruQ,
                    judulTugas: judulQ,
                    pesan: `${namaGuruQ} menarik tugas "${judulQ}". Tugas ini tidak perlu dikerjakan/dikumpulkan lagi.`,
                    waktu: Date.now(),
                    dibaca: false
                });
                return;
            }
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
            if (window.AntrianSyncGuru) {
                const namaGuruQ = tugasData.namaGuru || cariNamaGuruKelas(namaKelas);
                const judulQ = tugasData.judul || tugasData.tipe || 'Tugas Pembelajaran';
                window.AntrianSyncGuru.antriNotif(namaKelas, {
                    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    tipe: 'tambahan_waktu',
                    namaGuru: namaGuruQ,
                    judulTugas: judulQ,
                    pesan: `${namaGuruQ} menambahkan ${menitDitambah} menit untuk tugas "${judulQ}". Deadline baru: ${tugasData.deadline}.`,
                    waktu: Date.now(),
                    dibaca: false
                });
                return;
            }
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

        // ============================================================
        // REKAP SEMUA TUGAS -- SATU TABEL TERPADU
        //
        // Sebelumnya tab ini terdiri dari (1) deretan kartu "ringkasan per
        // kelas" dan (2) tabel 9 kolom yang terlalu lebar sehingga kolom
        // "Aksi" terpotong & harus digeser horizontal. Sekarang semuanya
        // dilebur jadi SATU tabel bersih:
        //   - Dropdown filter kelas (Semua Kelas / kelas yang punya tugas)
        //   - Search judul/nama tugas
        //   - Satu baris teks ringkasan: "<kelas> | Total Tugas: N"
        //   - Tabel 7 kolom: Kelas, Guru Pemberi, Jenis, Judul & Instruksi,
        //     Batas Waktu (+ badge Aktif/Kedaluwarsa), Pengumpulan Siswa,
        //     Aksi (Atur/Hapus)
        //
        // SEMUA angka dihitung LANGSUNG dari data yang sudah ada -- TIDAK
        // ada data dummy baru & TIDAK ada angka hardcode:
        //   - Total Tugas       : getTasksKelas() disaring tugasIniMilikGuruLogin()
        //   - Jumlah siswa      : sampleMurid30 (sumber tunggal, lewat
        //                         jumlahSiswaDiKelas()). Kelas yang belum tersambung
        //                         ke murid asli otomatis 0 -> baris menampilkan
        //                         "Belum ada siswa terdaftar", BUKAN angka karangan.
        //   - Sudah/Belum kumpul: ambilSubmisiTugasServer() (data asli server, sama
        //                         dengan "Perlu Dinilai" & Rekap Pengumpulan),
        //                         dipakai bareng lewat window._cacheSubmisiTugas.
        //                         Hitungannya PER TUGAS (bukan per kelas dikali
        //                         jumlah tugas), jadi mudah dibaca: "1 sudah, 7 belum
        //                         dari 8 siswa".
        //
        // Layout responsif TANPA horizontal overflow:
        //   - Lebar cukup  -> tabel table-layout:fixed, teks otomatis turun baris
        //   - Lebar sempit -> tiap baris jadi kartu (dideteksi lewat CSS container
        //                     query pada lebar tabel itu sendiri, bukan lebar layar,
        //                     jadi tetap benar walau sidebar sedang terbuka/tertutup)
        //
        // Elemen UI (toolbar, thead, CSS) dibuat lewat JS & disisipkan ke
        // tabel yang SUDAH ADA di HTML (id tabel-rekap-tugas-body), jadi
        // tidak perlu mengubah dashboard_guru.html/.css sama sekali.
        // ============================================================
        function escHTMLRekap(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        const CSS_REKAP_TERPADU = `
            .rekap-wrap { overflow-x: hidden !important; max-width: 100%; }
            .rekap-cq { container-type: inline-size; container-name: rekap; width: 100%; }
            .rekap-tabel { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: left; font-size: 13px; }
            .rekap-tabel thead th { padding: 14px 12px; font-size: 11px; font-weight: 700; line-height: 1.3; color: #94a3b8; border-bottom: 1px solid #e2e8f0; vertical-align: bottom; white-space: normal; background: transparent; }
            .rekap-tabel thead th:nth-child(1) { width: 8%; }
            .rekap-tabel thead th:nth-child(2) { width: 11%; }
            .rekap-tabel thead th:nth-child(3) { width: 10%; }
            .rekap-tabel thead th:nth-child(4) { width: 25%; }
            .rekap-tabel thead th:nth-child(5) { width: 16%; }
            .rekap-tabel thead th:nth-child(6) { width: 18%; }
            .rekap-tabel thead th:nth-child(7) { width: 12%; text-align: center; }
            .rekap-tabel tbody td { padding: 14px 12px; vertical-align: top; border-bottom: 1px solid #f1f5f9; min-width: 0; overflow-wrap: anywhere; }
            .rekap-tabel tbody tr[data-task] { cursor: pointer; transition: background-color .15s; }
            .rekap-tabel tbody tr[data-task]:hover { background: rgba(239, 246, 255, .65); }
            .rekap-tabel tbody tr[data-task]:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }
            .rekap-judul { display: block; font-weight: 700; line-height: 1.35; }
            .rekap-instruksi { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 3px; font-size: 12px; line-height: 1.45; color: #64748b; }
            .rekap-deadline { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; line-height: 1.45; color: #d97706; }
            .rekap-badge { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 2px 8px; border-radius: 8px; font-size: 11px; font-weight: 700; border: 1px solid transparent; }
            .rekap-badge.aktif { background: #ecfdf5; color: #059669; border-color: #a7f3d0; }
            .rekap-badge.lewat { background: #fff1f2; color: #e11d48; border-color: #fecdd3; }
            .rekap-kumpul-angka { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 12px; color: #64748b; }
            .rekap-kumpul-angka b { font-size: 14px; font-weight: 800; }
            .rekap-bar { height: 6px; margin-top: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
            .rekap-bar > i { display: block; height: 100%; border-radius: inherit; background: #10b981; transition: width .3s; }
            .rekap-kumpul-ket { margin-top: 4px; font-size: 11px; line-height: 1.4; color: #94a3b8; }
            .rekap-link { background: none; border: 0; padding: 0; margin-left: 4px; font-size: 12px; font-weight: 700; color: #2563eb; text-decoration: underline; cursor: pointer; }
            .rekap-aksi { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
            .rekap-aksi button { padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; transition: background-color .15s, color .15s; }
            .rekap-btn-atur { background: #fffbeb; color: #d97706; }
            .rekap-btn-atur:hover { background: #d97706; color: #fff; }
            .rekap-btn-hapus { background: #fff1f2; color: #e11d48; }
            .rekap-btn-hapus:hover { background: #e11d48; color: #fff; }
            .rekap-tabel td.rekap-td-kosong { padding: 32px 16px; text-align: center; font-style: italic; color: #94a3b8; }
            .rekap-ringkasan { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 16px; font-size: 13px; color: #64748b; }
            .rekap-ringkasan b { font-weight: 800; color: #1e293b; }
            .rekap-ringkasan-kelas { padding: 3px 10px; border-radius: 999px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 800; }

            html.dark .rekap-tabel thead th { border-color: #334155; }
            html.dark .rekap-tabel tbody td { border-color: #1e293b; }
            html.dark .rekap-tabel tbody tr[data-task]:hover { background: rgba(59, 130, 246, .12); }
            html.dark .rekap-instruksi, html.dark .rekap-kumpul-angka { color: #94a3b8; }
            html.dark .rekap-bar { background: #334155; }
            /* --- Kotak cari & dropdown kelas (Rekap Tugas) --- */
            .rekap-kontrol { display: flex; flex-wrap: wrap; align-items: stretch; gap: 12px; margin-bottom: 12px; }
            .rekap-kontrol-cari { position: relative; flex: 1 1 260px; min-width: 0; }
            .rekap-cari-ikon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 13px; color: #94a3b8; pointer-events: none; z-index: 1; }
            .rekap-input-cari, .rekap-select-kelas {
                box-sizing: border-box; height: 42px; margin: 0; border: 1px solid #e2e8f0; border-radius: 12px;
                font: inherit; font-size: 13px; color: #334155; background-color: #ffffff; outline: none;
            }
            .rekap-input-cari { display: block; width: 100%; padding: 0 12px 0 40px; -webkit-appearance: none; appearance: none; }
            .rekap-select-kelas { flex: 0 0 224px; width: 224px; max-width: 100%; padding: 0 12px; cursor: pointer; }
            .rekap-input-cari:focus, .rekap-select-kelas:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96, 165, 250, .25); }
            .rekap-input-cari::placeholder { color: #94a3b8; }
            .rekap-input-cari::-webkit-search-cancel-button { cursor: pointer; }
            @media (max-width: 639px) {
                .rekap-kontrol-cari, .rekap-select-kelas { flex: 1 1 100%; width: 100%; }
            }
            html.dark .rekap-input-cari, html.dark .rekap-select-kelas {
                background-color: #2a3550 !important; border-color: #3a4763 !important; color: #e2e8f0 !important;
                transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease;
            }
            html.dark .rekap-input-cari::placeholder { color: #8391a8 !important; }
            html.dark .rekap-cari-ikon { color: #8391a8; }
            html.dark .rekap-input-cari:focus, html.dark .rekap-select-kelas:focus {
                background-color: #313d59 !important; border-color: #60a5fa !important; box-shadow: 0 0 0 3px rgba(96, 165, 250, .22);
            }
            html.dark .rekap-select-kelas option { background-color: #232d42; color: #e2e8f0; }
            html.dark .rekap-input-cari::-webkit-search-cancel-button { filter: invert(.75); }
            html.dark .rekap-ringkasan { color: #94a3b8; }
            html.dark .rekap-ringkasan b { color: #e2e8f0; }
            html.dark .rekap-ringkasan-kelas { background: rgba(59, 130, 246, .15); border-color: rgba(96, 165, 250, .35); color: #93c5fd; }
            html.dark .rekap-badge.aktif { background: rgba(16, 185, 129, .15); border-color: rgba(16, 185, 129, .35); color: #34d399; }
            html.dark .rekap-badge.lewat { background: rgba(244, 63, 94, .15); border-color: rgba(244, 63, 94, .35); color: #fb7185; }
            html.dark .rekap-btn-atur { background: rgba(245, 158, 11, .15); color: #fbbf24; }
            html.dark .rekap-btn-hapus { background: rgba(244, 63, 94, .15); color: #fb7185; }

            /* ===== Elemen khusus mobile/tablet: default tersembunyi (desktop tidak berubah) ===== */
            .rekap-m { display: none; }
            .rekap-shell-head, .rekap-stat-grid, .rekap-daftar-head, .rekap-footer-info { display: none; }
            .rekap-bar-baris { display: block; }
            .rekap-kontrol-kelas { position: relative; flex: 0 0 224px; width: 224px; max-width: 100%; }
            .rekap-kontrol-kelas .rekap-select-kelas { flex: none; width: 100%; }
            .rekap-kontrol-ikon { display: none; position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 13px; color: #94a3b8; pointer-events: none; z-index: 1; }

            /* ===== Shell halaman (header, tombol perbarui, statistik, pencarian, footer):
                   tampil di layar < 1024px (tablet & HP) ===== */
            @media (max-width: 1023px) {
                .rekap-shell-head { display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px; }
                .rekap-shell-judul { margin: 0; font-size: 22px; font-weight: 800; line-height: 1.2; letter-spacing: -.01em; color: #0f172a; }
                .rekap-shell-desk { margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: #64748b; }
                .rekap-btn-perbarui { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 46px; padding: 0 20px; border: 0; border-radius: 12px; background: #2563eb; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: background-color .15s, transform .1s; -webkit-tap-highlight-color: transparent; }
                .rekap-btn-perbarui:hover { background: #1d4ed8; }
                .rekap-btn-perbarui:active { transform: scale(.98); }

                .rekap-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
                .rekap-stat { padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; }
                .rekap-stat b { display: block; font-size: 24px; font-weight: 800; line-height: 1.1; color: #0f172a; }
                .rekap-stat span { display: block; margin-top: 4px; font-size: 11px; font-weight: 600; color: #64748b; }

                .rekap-kontrol { flex-direction: column; flex-wrap: nowrap; gap: 10px; margin-bottom: 18px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; }
                .rekap-kontrol-cari, .rekap-kontrol-kelas { flex: 0 0 auto; width: 100%; }
                .rekap-input-cari, .rekap-select-kelas { height: 46px; font-size: 13px; }
                .rekap-kontrol-kelas .rekap-select-kelas { padding-left: 40px; }
                .rekap-kontrol-ikon { display: block; }
                .rekap-ringkasan { display: none; }

                .rekap-daftar-head { display: block; margin-bottom: 12px; padding: 0 2px; }
                .rekap-daftar-head b { display: block; font-size: 15px; font-weight: 800; color: #0f172a; }
                .rekap-daftar-head span { display: block; margin-top: 2px; font-size: 11px; color: #94a3b8; }

                .rekap-footer-info { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; padding: 12px 14px; border: 1px solid #bfdbfe; border-radius: 14px; background: #eff6ff; color: #1e40af; font-size: 12px; line-height: 1.5; }
                .rekap-footer-info i { margin-top: 2px; flex: none; }

                html.dark .rekap-shell-judul, html.dark .rekap-daftar-head b, html.dark .rekap-stat b { color: #f1f5f9; }
                html.dark .rekap-shell-desk, html.dark .rekap-stat span { color: #94a3b8; }
                html.dark .rekap-stat, html.dark .rekap-kontrol { background: rgba(15, 23, 42, .6); border-color: #334155; }
                html.dark .rekap-kontrol-ikon { color: #8391a8; }
                html.dark .rekap-footer-info { background: rgba(59, 130, 246, .12); border-color: rgba(96, 165, 250, .3); color: #93c5fd; }
            }

            /* Tablet (640-1023px): header sejajar dengan tombol, cari & filter satu baris */
            @media (min-width: 640px) and (max-width: 1023px) {
                .rekap-shell-head { flex-direction: row; align-items: flex-end; justify-content: space-between; gap: 20px; }
                .rekap-btn-perbarui { width: auto; flex: none; }
                .rekap-stat-grid { grid-template-columns: repeat(2, minmax(0, 240px)); }
                .rekap-kontrol { flex-direction: row; align-items: stretch; }
                .rekap-kontrol-cari { flex: 1 1 auto; width: auto; }
                .rekap-kontrol-kelas { flex: 0 0 260px; width: 260px; }
            }

            /* ===== Kartu tugas: aktif bila lebar TABEL < 860px (HP, tablet, atau desktop
                   dengan sidebar terbuka). >= 620px kartu tersusun 2 kolom (tablet),
                   di bawahnya 1 kolom penuh (HP). ===== */
            @container rekap (max-width: 860px) {
                .rekap-tabel, .rekap-tabel tbody, .rekap-tabel tr { display: block; width: 100%; }
                .rekap-tabel thead { display: none; }
                .rekap-tabel tbody { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 0; }
                .rekap-tabel tbody tr:not([data-task]) { grid-column: 1 / -1; }
                .rekap-tabel tbody tr[data-task] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; column-gap: 16px; row-gap: 12px; width: auto; min-width: 0; margin: 0; padding: 16px; border: 1px solid #e2e8f0; border-radius: 18px; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
                .rekap-tabel tbody td { display: block; min-width: 0; padding: 0; border: 0; }
                .rekap-tabel tbody td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 4px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; }

                .rekap-tabel tbody td.rekap-td-jenis { order: 1; grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
                .rekap-tabel tbody td.rekap-td-jenis::before { display: none; }
                .rekap-chip-jenis { display: inline-block; padding: 3px 10px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-size: 11px; font-weight: 700; line-height: 1.4; }
                .rekap-chip-status { display: inline-flex; }
                .rekap-chip-status .rekap-badge { margin-top: 0; }
                .rekap-tabel tbody td.rekap-td-deadline > .rekap-badge { display: none; }

                .rekap-tabel tbody td.rekap-td-judul { order: 2; grid-column: 1 / -1; }
                .rekap-judul { font-size: 17px; font-weight: 800; line-height: 1.3; }
                .rekap-instruksi { font-size: 12px; }
                .rekap-tabel tbody td.rekap-td-kelas { order: 3; font-size: 13px; }
                .rekap-tabel tbody td.rekap-td-guru { order: 4; font-size: 13px; }
                .rekap-m { display: inline; }
                .rekap-guru-ikon { margin-right: 6px; color: #94a3b8; }

                .rekap-tabel tbody td.rekap-td-deadline { order: 5; grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
                .rekap-tabel tbody td.rekap-td-deadline::before { flex: 0 0 100%; margin-bottom: 2px; }
                .rekap-deadline { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }

                .rekap-tabel tbody td.rekap-td-kumpul { order: 6; grid-column: 1 / -1; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
                .rekap-bar-baris { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
                .rekap-bar-baris .rekap-bar { flex: 1 1 auto; margin-top: 0; }
                .rekap-persen { flex: none; font-size: 11px; font-weight: 700; color: #64748b; }

                .rekap-tabel tbody td.rekap-td-aksi { order: 7; grid-column: 1 / -1; }
                .rekap-aksi { flex-direction: row; gap: 10px; }
                .rekap-aksi button { flex: 1 1 0; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: 12px; font-size: 13px; -webkit-tap-highlight-color: transparent; }
                .rekap-aksi button:active { transform: scale(.98); }
                .rekap-btn-atur { background: #f1f5f9; color: #334155; }
                .rekap-btn-atur:hover { background: #334155; color: #fff; }
                .rekap-tabel td.rekap-td-kosong { padding: 28px 16px; }

                html.dark .rekap-tabel tbody tr[data-task] { background: #0f172a; border-color: #1e293b; box-shadow: none; }
                html.dark .rekap-chip-jenis { background: rgba(59, 130, 246, .15); border-color: rgba(96, 165, 250, .35); color: #93c5fd; }
                html.dark .rekap-tabel tbody td.rekap-td-deadline, html.dark .rekap-tabel tbody td.rekap-td-kumpul { background: rgba(30, 41, 59, .55); border-color: #1e293b; }
                html.dark .rekap-btn-atur { background: #1e293b; color: #e2e8f0; }
                html.dark .rekap-btn-atur:hover { background: #334155; color: #fff; }
                html.dark .rekap-persen { color: #94a3b8; }
            }
            @container rekap (min-width: 620px) and (max-width: 860px) {
                .rekap-tabel tbody { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }

            /* Judul asli halaman (dari HTML) disembunyikan di tablet/HP karena
               sudah diganti header di atas -- desktop tetap memakai yang asli. */
            @media (max-width: 1023px) { .rekap-judul-asli { display: none !important; } }
        `;

        let _uiRekapSemuaTugasSudahDisiapkan = false;
        function pastikanUIRekapSemuaTugasSiap() {
            if (_uiRekapSemuaTugasSudahDisiapkan) return;
            const tbody = document.getElementById('tabel-rekap-tugas-body');
            if (!tbody) return;
            const tabel = tbody.closest('table');
            if (!tabel) return;
            const wrapperTabel = tabel.closest('.overflow-x-auto') || tabel.parentElement;
            if (!wrapperTabel || !wrapperTabel.parentElement) return;

            if (!document.getElementById('rekap-tugas-terpadu-style')) {
                const style = document.createElement('style');
                style.id = 'rekap-tugas-terpadu-style';
                style.textContent = CSS_REKAP_TERPADU;
                document.head.appendChild(style);
            }

            // Toolbar: search + dropdown kelas, lalu satu baris teks ringkasan.
            const kontrol = document.createElement('div');
            kontrol.id = 'rekap-tugas-kontrol-wrapper';
            kontrol.innerHTML = `
                <div class="rekap-shell-head">
                    <div>
                        <h2 class="rekap-shell-judul">Rekap Daftar Tugas Aktif &amp; Terkirim</h2>
                        <p class="rekap-shell-desk">Kelola tugas yang telah dikirimkan oleh guru ke berbagai kelas beserta informasi dan batas waktunya.</p>
                    </div>
                    <button type="button" id="rekap-btn-perbarui" class="rekap-btn-perbarui"><i class="fa-solid fa-arrows-rotate"></i>Perbarui data tugas</button>
                </div>
                <div class="rekap-stat-grid">
                    <div class="rekap-stat"><b id="rekap-stat-total">0</b><span>Total tugas</span></div>
                    <div class="rekap-stat"><b id="rekap-stat-tampil">0</b><span>Ditampilkan</span></div>
                </div>
                <div class="rekap-kontrol">
                    <div class="rekap-kontrol-cari">
                        <i class="fa-solid fa-magnifying-glass rekap-cari-ikon"></i>
                        <input type="search" id="rekap-tugas-search" aria-label="Cari judul tugas" placeholder="Cari judul tugas..." autocomplete="off" class="rekap-input-cari">
                    </div>
                    <div class="rekap-kontrol-kelas">
                        <i class="fa-solid fa-user-group rekap-kontrol-ikon"></i>
                        <select id="rekap-tugas-filter-kelas" aria-label="Filter kelas" class="rekap-select-kelas">
                            <option value="ALL">Semua Kelas</option>
                        </select>
                    </div>
                </div>
                <div id="rekap-tugas-ringkasan-teks" class="rekap-ringkasan" aria-live="polite"></div>
                <div class="rekap-daftar-head"><b>Daftar tugas</b><span id="rekap-daftar-info">0 dari 0 tugas</span></div>
            `;
            wrapperTabel.parentElement.insertBefore(kontrol, wrapperTabel);

            const footerInfo = document.createElement('div');
            footerInfo.className = 'rekap-footer-info';
            footerInfo.innerHTML = '<i class="fa-solid fa-circle-info"></i><span>Status pengumpulan diperbarui otomatis saat siswa mengirim jawaban.</span>';
            wrapperTabel.parentElement.insertBefore(footerInfo, wrapperTabel.nextSibling);

            // Sembunyikan judul/deskripsi lama halaman ini (dari HTML) di tablet/HP
            // supaya tidak dobel dengan header baru. Hanya heading/paragraf yang
            // berada SEBELUM toolbar di dalam tab yang sama.
            (function () {
                const tabRoot = document.getElementById('tab-rekap-tugas') || tabel.closest('[id^="tab-"]');
                if (!tabRoot) return;
                let node = kontrol;
                while (node && node !== tabRoot) {
                    let sib = node.previousElementSibling;
                    while (sib) {
                        if (/^(H1|H2|H3|P|HEADER)$/.test(sib.tagName)) sib.classList.add('rekap-judul-asli');
                        sib = sib.previousElementSibling;
                    }
                    node = node.parentElement;
                }
            })();

            // Tabel: bungkus dengan container (dasar CSS container query),
            // ganti kelas lama yang memaksa lebar minimum, dan tulis ulang
            // header jadi 7 kolom.
            wrapperTabel.classList.add('rekap-wrap');
            const cq = document.createElement('div');
            cq.className = 'rekap-cq';
            tabel.parentNode.insertBefore(cq, tabel);
            cq.appendChild(tabel);
            tabel.className = 'rekap-tabel';
            tbody.className = '';
            const thead = tabel.tHead || tabel.createTHead();
            thead.className = '';
            thead.innerHTML = `
                <tr>
                    <th scope="col">Kelas</th>
                    <th scope="col">Guru Pemberi</th>
                    <th scope="col">Jenis Tugas</th>
                    <th scope="col">Judul &amp; Instruksi</th>
                    <th scope="col">Batas Waktu</th>
                    <th scope="col">Pengumpulan Siswa</th>
                    <th scope="col">Aksi</th>
                </tr>
            `;

            document.getElementById('rekap-tugas-search').addEventListener('input', () => renderRekapSemuaTugas());
            document.getElementById('rekap-tugas-filter-kelas').addEventListener('change', () => renderRekapSemuaTugas());
            document.getElementById('rekap-btn-perbarui').addEventListener('click', () => {
                Object.keys(_waktuFetchSubmisiRekap).forEach(k => delete _waktuFetchSubmisiRekap[k]);
                Object.keys(_gagalFetchSubmisiRekap).forEach(k => delete _gagalFetchSubmisiRekap[k]);
                renderRekapSemuaTugas();
            });

            // Satu listener untuk semua baris (event delegation): klik baris =
            // buka rekap pengumpulan per siswa; tombol Atur/Hapus tidak ikut
            // membuka rekap. Pakai data-attribute (bukan onclick inline) supaya
            // nama kelas/judul yang mengandung tanda kutip tidak merusak markup.
            tbody.addEventListener('click', (e) => {
                const tr = e.target.closest('tr[data-task]');
                if (!tr) return;
                const namaKelas = tr.dataset.kelas;
                const taskId = tr.dataset.task;
                const tombol = e.target.closest('[data-aksi]');
                if (tombol) {
                    e.stopPropagation();
                    const aksi = tombol.dataset.aksi;
                    if (aksi === 'atur') bukaModalEditTugas(namaKelas, taskId);
                    else if (aksi === 'hapus') hapusTugasByID(namaKelas, taskId);
                    else if (aksi === 'muat-ulang') {
                        delete _waktuFetchSubmisiRekap[taskId];
                        delete _gagalFetchSubmisiRekap[taskId];
                        renderRekapSemuaTugas();
                    }
                    return;
                }
                bukaRekapPengumpulanTugas(namaKelas, taskId);
            });
            tbody.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' || e.target.closest('[data-aksi]')) return;
                const tr = e.target.closest('tr[data-task]');
                if (tr) bukaRekapPengumpulanTugas(tr.dataset.kelas, tr.dataset.task);
            });

            _uiRekapSemuaTugasSudahDisiapkan = true;
        }

        // ---------- Data pengumpulan (sudah/belum) per tugas ----------
        // Cache submisi dipakai bareng modul lain (window._cacheSubmisiTugas).
        // Supaya angka tidak basi tapi juga tidak menembak server tiap kali
        // guru mengetik di kolom search (rentan kena rate limit 'burst'),
        // data yang lebih baru dari TTL dipakai langsung, yang lebih lama
        // diambil ulang di belakang layar. Request yang sedang berjalan untuk
        // tugas yang sama dipakai bersama (tidak menembak dobel).
        const TTL_SUBMISI_REKAP_MS = 20000;
        const _waktuFetchSubmisiRekap = {};
        const _gagalFetchSubmisiRekap = {};
        const _fetchBerjalanSubmisiRekap = {};

        function ambilSubmisiUntukRekap(taskId) {
            if (_fetchBerjalanSubmisiRekap[taskId]) return _fetchBerjalanSubmisiRekap[taskId];
            const p = ambilSubmisiTugasServer(taskId).then(({ data, gagal }) => {
                if (!gagal) {
                    window._cacheSubmisiTugas[taskId] = data;
                    _waktuFetchSubmisiRekap[taskId] = Date.now();
                    delete _gagalFetchSubmisiRekap[taskId];
                } else {
                    // Gagal ambil != kosong: cache lama (kalau ada) JANGAN ditimpa.
                    _gagalFetchSubmisiRekap[taskId] = true;
                }
                return gagal;
            }).finally(() => { delete _fetchBerjalanSubmisiRekap[taskId]; });
            _fetchBerjalanSubmisiRekap[taskId] = p;
            return p;
        }

        function htmlPengumpulanSiswaRekap(namaKelas, data, kedaluwarsa) {
            const totalSiswa = jumlahSiswaDiKelas(namaKelas);
            if (totalSiswa === 0) {
                return `<span class="text-xs text-slate-400 italic">Belum ada siswa terdaftar di kelas ini</span>`;
            }
            const submisi = window._cacheSubmisiTugas[data.id];
            if (!submisi) {
                return _gagalFetchSubmisiRekap[data.id]
                    ? `<span class="text-xs font-semibold text-rose-500">Gagal memuat data</span><button type="button" class="rekap-link" data-aksi="muat-ulang">Coba lagi</button>`
                    : `<span class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Menghitung...</span>`;
            }
            const sudah = sampleMurid30.filter(m => m.kelas === namaKelas && submisi[m.username] && submisi[m.username].submitted).length;
            const belum = Math.max(totalSiswa - sudah, 0);
            const persen = Math.round((sudah / totalSiswa) * 100);

            let ket = `dari ${totalSiswa} siswa (${persen}%)`;
            if (belum === 0) ket = `Semua dari ${totalSiswa} siswa sudah mengumpulkan`;
            else if (kedaluwarsa) ket += ` &bull; <span class="font-semibold text-rose-500">lewat batas waktu</span>`;

            return `
                <div class="rekap-kumpul-angka">
                    <span><b class="text-emerald-600">${sudah}</b> sudah</span>
                    <span><b class="text-rose-500">${belum}</b> belum</span>
                </div>
                <div class="rekap-bar-baris">
                    <div class="rekap-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${persen}"><i style="width:${persen}%"></i></div>
                    <span class="rekap-m rekap-persen">${persen}%</span>
                </div>
                <div class="rekap-kumpul-ket">${ket}</div>
            `;
        }

        // Perbarui sel "Pengumpulan Siswa" milik satu tugas (dipanggil begitu
        // fetch-nya selesai) tanpa merender ulang seluruh tabel.
        function perbaruiSelPengumpulanRekap(taskId) {
            document.querySelectorAll('#tabel-rekap-tugas-body [data-pengumpulan]').forEach(el => {
                if (el.dataset.pengumpulan !== taskId) return;
                const data = getTasksKelas(el.dataset.kelas).find(t => t.id === taskId);
                if (!data) return;
                el.innerHTML = htmlPengumpulanSiswaRekap(el.dataset.kelas, data, cekStatusTugasKedaluwarsaGuru(data));
            });
        }

        async function isiStatusPengumpulanRekap(daftarTampil) {
            const perluAmbil = [];
            daftarTampil.forEach(({ k, data }) => {
                if (jumlahSiswaDiKelas(k.nama) === 0) return; // tidak ada siswa -> tidak ada yang dihitung
                const segar = window._cacheSubmisiTugas[data.id] && (Date.now() - (_waktuFetchSubmisiRekap[data.id] || 0) < TTL_SUBMISI_REKAP_MS);
                if (!segar) perluAmbil.push(data.id);
            });
            await Promise.all([...new Set(perluAmbil)].map(async (taskId) => {
                await ambilSubmisiUntukRekap(taskId);
                // Aman dipanggil walau tabel sudah dirender ulang (mis. guru sedang
                // mengetik di search): hanya sel yang masih ada yang ikut diperbarui.
                perbaruiSelPengumpulanRekap(taskId);
            }));
        }

        // ---------- Render ----------
        function renderRekapSemuaTugas() {
            pastikanUIRekapSemuaTugasSiap();

            const tbody = document.getElementById('tabel-rekap-tugas-body');
            if (!tbody) return;

            const inputSearch = document.getElementById('rekap-tugas-search');
            const selectKelas = document.getElementById('rekap-tugas-filter-kelas');
            const kataKunci = (inputSearch?.value || '').trim().toLowerCase();

            // Opsi dropdown dibangun ulang tiap render dari kelas yang benar-benar
            // punya tugas milik guru yang sedang login -- otomatis ikut bertambah/
            // berkurang begitu tugas dikirim/dihapus, tanpa daftar kelas hardcode.
            // Pilihan sebelumnya dipertahankan selama kelasnya masih ada.
            if (selectKelas) {
                // Per kelas dihitung jumlah tugas milik guru yang sedang login di kelas
                // itu (bukan tugas semua guru), lalu ditampilkan di tiap opsi dropdown,
                // mis. "XII TKJ 3 (5)", supaya guru langsung lihat sebarannya tanpa
                // perlu klik satu-satu. "Semua Kelas" ikut menjumlahkan totalnya.
                const kelasTersedia = daftarSeluruhKelasDummy
                    .map(k => ({ nama: k.nama, jumlah: getTasksKelas(k.nama).filter(t => tugasIniMilikGuruLogin(t)).length }))
                    .filter(k => k.jumlah > 0);
                const totalSemuaKelas = kelasTersedia.reduce((total, k) => total + k.jumlah, 0);
                const nilaiSaatIni = selectKelas.value;
                selectKelas.innerHTML = `<option value="ALL">Semua Kelas (${totalSemuaKelas})</option>` +
                    kelasTersedia.map(k => `<option value="${escHTMLRekap(k.nama)}">${escHTMLRekap(k.nama)} (${k.jumlah})</option>`).join('');
                selectKelas.value = kelasTersedia.some(k => k.nama === nilaiSaatIni) ? nilaiSaatIni : 'ALL';
            }
            const kelasDipilih = selectKelas?.value || 'ALL';

            // "Rekap Semua Tugas" = semua tugas YANG SAYA KASIH: tiap guru hanya
            // melihat tugas buatannya sendiri (tugasIniMilikGuruLogin).
            const daftarTampil = [];
            let totalTugasKelasIni = 0;
            daftarSeluruhKelasDummy.forEach(k => {
                if (kelasDipilih !== 'ALL' && k.nama !== kelasDipilih) return;
                getTasksKelas(k.nama).filter(t => tugasIniMilikGuruLogin(t)).forEach(data => {
                    totalTugasKelasIni++;
                    const teksDicari = String(data.judul || '').toLowerCase(); // hanya judul tugas
                    if (kataKunci && !teksDicari.includes(kataKunci)) return;
                    daftarTampil.push({ k, data });
                });
            });

            if (daftarTampil.length === 0) {
                const pesanKosong = totalTugasKelasIni === 0
                    ? 'Anda belum mengirimkan tugas atau catatan ke kelas manapun.'
                    : 'Tidak ada judul tugas yang cocok dengan pencarian saat ini.';
                tbody.innerHTML = `<tr><td colspan="7" class="rekap-td-kosong">${pesanKosong}</td></tr>`;
            } else {
                tbody.innerHTML = daftarTampil.map(({ k, data }) => {
                    const kedaluwarsa = cekStatusTugasKedaluwarsaGuru(data);
                    const namaKelas = escHTMLRekap(k.nama);
                    const judul = escHTMLRekap(data.judul || '-');
                    const teks = escHTMLRekap(data.teks || '-');

                    // Deadline disimpan sebagai "2026-09-12 Pukul 20:22 WIB":
                    // dipecah jadi dua baris supaya rapi di kolom sempit.
                    const deadlineMentah = String(data.deadline || '').trim();
                    let deadlineHTML = '<span class="rekap-deadline">-</span>';
                    if (deadlineMentah) {
                        const bagian = deadlineMentah.split('Pukul');
                        deadlineHTML = bagian.length > 1
                            ? `<span class="rekap-deadline">${escHTMLRekap(bagian[0].trim())}</span><span class="rekap-deadline"><i class="fa-regular fa-clock rekap-m"></i>Pukul ${escHTMLRekap(bagian[1].trim())}</span>`
                            : `<span class="rekap-deadline">${escHTMLRekap(deadlineMentah)}</span>`;
                    }
                    const badgeStatus = kedaluwarsa
                        ? `<span class="rekap-badge lewat"><i class="fa-solid fa-hourglass-end"></i>Kedaluwarsa</span>`
                        : `<span class="rekap-badge aktif"><i class="fa-solid fa-circle-dot"></i>Aktif</span>`;

                    return `
                        <tr data-kelas="${namaKelas}" data-task="${escHTMLRekap(data.id)}" tabindex="0" title="Klik untuk lihat rekap pengumpulan tiap siswa">
                            <td data-label="Kelas" class="rekap-td-kelas font-extrabold text-blue-600">${namaKelas}</td>
                            <td data-label="Guru pemberi" class="rekap-td-guru font-semibold text-slate-600"><i class="fa-regular fa-user rekap-m rekap-guru-ikon"></i>${escHTMLRekap(data.namaGuru || 'Guru Mata Pelajaran')}</td>
                            <td data-label="Jenis tugas" class="rekap-td-jenis font-semibold text-slate-700"><span class="rekap-chip-jenis-wrap"><span class="rekap-chip-jenis">${escHTMLRekap(data.tipe || 'Tugas')}</span></span><span class="rekap-m rekap-chip-status">${badgeStatus}</span></td>
                            <td data-label="Judul &amp; instruksi" class="rekap-td-judul">
                                <span class="rekap-judul text-slate-900">${judul}</span>
                                <span class="rekap-instruksi" title="${teks}">${teks}</span>
                            </td>
                            <td data-label="Batas waktu" class="rekap-td-deadline">${deadlineHTML}${badgeStatus}</td>
                            <td data-label="Pengumpulan siswa" class="rekap-td-kumpul">
                                <div data-pengumpulan="${escHTMLRekap(data.id)}" data-kelas="${namaKelas}">${htmlPengumpulanSiswaRekap(k.nama, data, kedaluwarsa)}</div>
                            </td>
                            <td class="rekap-td-aksi">
                                <div class="rekap-aksi">
                                    <button type="button" data-aksi="atur" class="rekap-btn-atur"><i class="fa-solid fa-sliders rekap-m"></i><span>Atur<span class="rekap-m"> tugas</span></span></button>
                                    <button type="button" data-aksi="hapus" class="rekap-btn-hapus"><i class="fa-regular fa-trash-can rekap-m"></i><span>Hapus</span></button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            // Teks ringkasan otomatis: kelas yang dipilih + Total Tugas kelas itu
            // (dihitung sebelum disaring search, jadi angkanya tetap "total").
            const elStatTotal = document.getElementById('rekap-stat-total');
            if (elStatTotal) elStatTotal.textContent = totalTugasKelasIni;
            const elStatTampil = document.getElementById('rekap-stat-tampil');
            if (elStatTampil) elStatTampil.textContent = daftarTampil.length;
            const elDaftarInfo = document.getElementById('rekap-daftar-info');
            if (elDaftarInfo) elDaftarInfo.textContent = `${daftarTampil.length} dari ${totalTugasKelasIni} tugas`;

            const elRingkasan = document.getElementById('rekap-tugas-ringkasan-teks');
            if (elRingkasan) {
                const labelKelas = kelasDipilih === 'ALL' ? 'Semua Kelas' : kelasDipilih;
                elRingkasan.innerHTML =
                    `<span class="rekap-ringkasan-kelas">${escHTMLRekap(labelKelas)}</span>` +
                    `<span>Total Tugas: <b>${totalTugasKelasIni}</b></span>` +
                    (kataKunci ? `<span>Ditampilkan: <b>${daftarTampil.length}</b></span>` : '');
            }

            // Angka sudah/belum kumpul diambil dari server di belakang layar
            // supaya tabel tetap tampil instan; tiap sel diisi begitu datanya siap.
            isiStatusPengumpulanRekap(daftarTampil);
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
        async function hitungDanTampilkanPerluDinilai(_percobaanUlang = false) {
            const elBadge = document.getElementById('stat-perlu-dinilai');
            if (!elBadge) return;

            const kelasDenganMuridAsli = [...new Set(sampleMurid30.map(m => m.kelas))];
            const semuaTugasRelevan = [];
            kelasDenganMuridAsli.forEach(namaKelas => {
                // PERBAIKAN PRIVASI: badge "Perlu Dinilai" di Beranda cuma boleh
                // menghitung (dan otomatis fetch foto) tugas milik guru yang
                // sedang login -- sebelumnya semua tugas di kelas ini ikut
                // dihitung tanpa peduli siapa pembuatnya, jadi angkanya bisa
                // membocorkan "ada X tugas guru lain yang belum dinilai" dan
                // diam-diam menarik foto tugas guru lain ke cache browser.
                getTasksKelas(namaKelas).filter(t => tugasIniMilikGuruLogin(t)).forEach(task => {
                    semuaTugasRelevan.push({ namaKelas, task });
                });
            });

            if (semuaTugasRelevan.length === 0) {
                window.__lilyPerluDinilai = { n: 0, lengkap: true }; // dibaca Lily (LilyTeacherSource), angka sama dengan badge
                elBadge.innerHTML = `0 <span class="text-xs font-normal text-slate-400">Berkas</span>`;
                return;
            }

            let totalPerluDinilai = 0;
            let adaFetchGagal = false;

            // HEMAT REQUEST: 1 request ringkasan untuk SEMUA tugas (tanpa foto),
            // bukan 2 request per tugas. Foto lengkap hanya diambil untuk tugas
            // yang berubah / belum pernah ada di cache (lihat _submisiPerluFetchPenuh).
            const idTugas = semuaTugasRelevan.map(x => x.task.id);
            const { data: ringkasSemua, gagal: gagalRingkas } = await ambilSubmisiRingkasBulk(idTugas);
            if (gagalRingkas) {
                // Jangan timpa badge dengan angka undercount; coba sekali lagi sesaat lagi.
                if (!_percobaanUlang) setTimeout(() => hitungDanTampilkanPerluDinilai(true), 2000);
                return;
            }

            await Promise.all(semuaTugasRelevan.map(async ({ task }) => {
                if (!(task.id in ringkasSemua)) { adaFetchGagal = true; return; } // ditolak/tak dikenal server = perlakukan sbg gagal, cache lama tetap dipakai
                const baru = ringkasSemua[task.id] || {};
                const lama = window._cacheSubmisiTugas[task.id];
                if (_submisiPerluFetchPenuh(lama, baru)) {
                    const { data, gagal } = await ambilSubmisiTugasServer(task.id);
                    if (gagal) { adaFetchGagal = true; return; }
                    window._cacheSubmisiTugas[task.id] = data;
                } else {
                    const gabung = {};
                    Object.keys(baru).forEach(u => {
                        const sisa = {};
                        Object.keys(baru[u]).forEach(k => { if (!k.startsWith('jumlah_')) sisa[k] = baru[u][k]; });
                        gabung[u] = Object.assign({}, lama[u], sisa); // foto lama tetap terbawa dari cache
                    });
                    window._cacheSubmisiTugas[task.id] = gabung;
                }
            }));

            // Hasil periksa: 1x bulk untuk semua siswa yang sudah kumpul tapi
            // nilainya belum tercatat di entri submisi (yang sudah bernilai dilewati).
            const kandidat = [];
            semuaTugasRelevan.forEach(({ namaKelas, task }) => {
                const submisi = window._cacheSubmisiTugas[task.id];
                if (!submisi) return;
                sampleMurid30.filter(m => m.kelas === namaKelas).forEach(m => {
                    const entri = submisi[m.username];
                    if (!entri || !entri.submitted) return;
                    const sudahDinilai = entri.nilai !== undefined && entri.nilai !== null && entri.nilai !== '';
                    if (sudahDinilai) return;
                    kandidat.push(kunciHasilPeriksaTugas(task.id, m.id));
                });
            });
            const { data: hasilPeriksa, gagal: gagalPeriksa } = await ambilHasilPeriksaBulkBanyak(kandidat);
            if (gagalPeriksa) {
                adaFetchGagal = true;
            } else {
                kandidat.forEach(kunci => {
                    const t = hasilPeriksa[kunci];
                    const ada = t && t.nilai !== undefined && t.nilai !== null && t.nilai !== '';
                    if (!ada) totalPerluDinilai++;
                });
            }

            // PERBAIKAN: kalau ada bagian yang gagal diambil, angka totalPerluDinilai
            // di atas TIDAK LENGKAP (undercount) -- tampilkan tetap, tapi coba
            // sekali lagi otomatis sesaat kemudian (biasanya rate limit sudah
            // reda dalam &lt;2 detik) daripada membiarkan badge nyangkut di angka
            // yang salah sampai guru manual refresh lagi.
            window.__lilyPerluDinilai = { n: totalPerluDinilai, lengkap: !adaFetchGagal }; // dibaca Lily; tidak lengkap = tidak dipakai (hindari undercount)
            elBadge.innerHTML = `${totalPerluDinilai} <span class="text-xs font-normal text-slate-400">Berkas</span>`;
            if (adaFetchGagal && !_percobaanUlang) {
                setTimeout(() => hitungDanTampilkanPerluDinilai(true), 2000);
            }
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
        // PERBAIKAN: sama seperti ambilSubmisiTugasServer() -- sekarang
        // membedakan "hasil kosong yang memang valid" vs "gagal ambil" lewat
        // field `gagal`, supaya pemanggil tidak salah menganggap data hasil
        // periksa/nilai HILANG padahal cuma gagal diambil (mis. kena rate
        // limit saat banyak request paralel pas dashboard baru dibuka).
        async function ambilHasilPeriksaBulkServer(taskId, daftarIdSiswa) {
            const daftarKunci = daftarIdSiswa.map(idSiswa => kunciHasilPeriksaTugas(taskId, idSiswa));
            try {
                const res = await fetch(`/api/sync/bulk?kunci=${encodeURIComponent(daftarKunci.join(','))}`);
                const json = await res.json();
                if (json.ok) return { data: json.data || {}, gagal: false };
                console.warn('Gagal ambil hasil periksa tugas (bulk) dari server (respons tidak ok):', taskId);
            } catch (e) {
                console.warn('Gagal ambil hasil periksa tugas (bulk) dari server:', taskId, e);
            }
            return { data: {}, gagal: true };
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

        // [BARU -- SKEMA WORKFLOW] salinan lokal 'ringkasan' per username dari
        // /api/pelanggaran/semua: { jumlah_aktif, jumlah_menunggu_tugas,
        // jumlah_menunggu_acc, jumlah_selesai, jumlah_dibatalkan,
        // jumlah_belum_selesai, warna_badge }. Dihitung SERVER-SIDE oleh
        // bangun_ringkasan_semua_siswa() di app.py. Siswa yang SEMUA
        // pelanggarannya sudah 'selesai'/'dibatalkan' TIDAK ADA key-nya sama
        // sekali di sini (server sengaja tidak menyertakannya).
        let _cacheRingkasanPelanggaranServer = {};

        // FITUR TAMBAHAN: salinan lokal LENGKAP (bukan cuma boolean aktif)
        // { username: [ {id, oleh, oleh_username, keterangan, dibuat_at, ...} ] }
        // dari field 'data' /api/pelanggaran/semua -- dipakai buat: (1) badge
        // "N pelanggaran (dari M guru)" di kartu kelas Beranda (lihat
        // ringkasanPelanggaranKelas()), dan (2) daftar siswa + detail
        // pelanggaran per siswa (lihat bukaDaftarSiswaPelanggaran() &
        // bukaDetailPelanggaranSiswa()). Diisi bareng _cachePelanggaranAktifServer
        // di fungsi yang sama supaya tidak perlu request terpisah lagi.
        let _cacheDataPelanggaranServer = {};

        async function muatPelanggaranAktifDariServer() {
            try {
                const res = await fetch('/api/pelanggaran/semua');
                const json = await res.json();
                if (json && json.success) {
                    // [SKEMA BARU] endpoint ini sekarang balikin {success, ringkasan,
                    // data} -- field 'aktif' (boolean per username) SUDAH DIHAPUS dari
                    // response app.py, diganti 'ringkasan' (per username, sudah lewat
                    // aturan prioritas warna di bangun_ringkasan_semua_siswa()).
                    // 'data' bentuknya tetap sama (list detail entri per siswa).
                    _cacheRingkasanPelanggaranServer = json.ringkasan || {};
                    _cacheDataPelanggaranServer = json.data || {};
                    // Shim kompatibilitas: _cachePelanggaranAktifServer (boolean per
                    // username) DIPERTAHANKAN supaya siswaPunyaPelanggaranAktif() &
                    // kode lain yang masih membacanya tetap jalan tanpa disentuh --
                    // sekarang diisi ulang dari 'ringkasan' (yang sudah otomatis cuma
                    // berisi siswa dengan status belum-selesai).
                    _cachePelanggaranAktifServer = {};
                    Object.keys(_cacheRingkasanPelanggaranServer).forEach(u => {
                        _cachePelanggaranAktifServer[u] = true;
                    });
                }
            } catch (e) {
                // Gagal/offline -- biarkan cache lokal yang lama dulu, jangan
                // sampai jendela Rekap gagal kebuka gara-gara ini.
            }
        }

        // Ringkasan pelanggaran SATU kelas -- dipakai badge live di kartu
        // Beranda: total entri aktif semua siswa kelas ini + dari berapa
        // guru BERBEDA (Set username pemberi), sesuai contoh wireframe
        // "5 pelanggaran (dari 3 guru)". Cuma menghitung dari cache lokal
        // (_cacheDataPelanggaranServer), tanpa network baru -- pemanggil yang
        // bertanggung jawab memastikan cache itu sudah dimuat/disegarkan
        // (lihat muatPelanggaranAktifDariServer(), dipanggil di DOMContentLoaded
        // & polling 30 detik yang sama dengan tugas).
        function ringkasanPelanggaranKelas(namaKelas) {
            const muridKelasIni = sampleMurid30.filter(m => m.kelas === namaKelas);
            let jumlah = 0;
            const guruSet = new Set();
            muridKelasIni.forEach(m => {
                // [SKEMA BARU] jumlah dihitung dari 'ringkasan' (jumlah_belum_selesai)
                // -- BUKAN daftar.length lagi, supaya entri 'selesai'/'dibatalkan'
                // (yang tetap tersimpan permanen sebagai arsip) tidak ikut membuat
                // badge kelas ini kelihatan "aktif" terus-menerus.
                const ringkasanSiswa = _cacheRingkasanPelanggaranServer[m.username];
                jumlah += ringkasanSiswa ? ringkasanSiswa.jumlah_belum_selesai : 0;
                // CATATAN: field pelapor (dilaporkan_oleh) cuma tersedia utk entri
                // milikmu sendiri (privasi skema baru -- lihat pelanggaran_untuk_response()
                // di app.py), jadi hitungan "dari M guru" ini sekarang best-effort,
                // bisa lebih kecil dari jumlah guru sebenarnya kalau ada entri dari
                // guru lain.
                const daftar = _cacheDataPelanggaranServer[m.username] || [];
                daftar.forEach(e => { if (e.dilaporkan_oleh) guruSet.add(e.dilaporkan_oleh); });
            });
            return { jumlah, jumlahGuru: guruSet.size };
        }

        function siswaPunyaPelanggaranAktif(username) {
            return !!_cachePelanggaranAktifServer[username];
        }

        /* ============================================================
           FITUR TAMBAHAN -- ALUR "Beranda -> Daftar Siswa -> Detail
           Pelanggaran" (sesuai topologi wireframe): klik badge pelanggaran
           di kartu kelas Beranda membuka daftar SEMUA siswa kelas itu
           (bisa dicari), klik satu siswa membuka rincian pelanggarannya --
           dipilah "Dari Kamu" (Edit/Cabut aktif) vs "Dari Guru Lain"
           (read-only, Cabut disabled) -- backend sudah menegakkan
           kepemilikan ini sendiri (lihat api_pelanggaran_set/edit di
           app.py), frontend di sini cuma mengikuti & menampilkannya.
           ============================================================ */
        let _kelasAktifDaftarSiswaPelanggaran = '';
        let _muridAktifDetailPelanggaran = null;
        // [BARU -- SKEMA WORKFLOW] salinan lokal daftar LENGKAP hasil fetch
        // /api/pelanggaran/daftar?username=... utk siswa yang detailnya sedang
        // dibuka -- dipakai klikTugaskanPenebus()/klikAccBuktiPelanggaran()/
        // klikTolakBuktiPelanggaran() supaya tidak perlu fetch ulang cuma buat
        // ambil instruksi_penebus lama (mis. saat prefill form Tugaskan).
        let _daftarPelanggaranSiswaAktifDetail = [];

        async function bukaDaftarSiswaPelanggaran(namaKelas) {
            _kelasAktifDaftarSiswaPelanggaran = namaKelas;
            _tampilkanSiswaBersihDiDaftar = false; // collapse lagi tiap dibuka baru
            const elNamaKelas = document.getElementById('modal-daftar-siswa-nama-kelas');
            if (elNamaKelas) elNamaKelas.innerText = namaKelas;
            const inputCari = document.getElementById('input-cari-siswa-pelanggaran');
            if (inputCari) inputCari.value = '';

            // Sekalian disegarkan dari server tiap kali dibuka -- supaya kalau
            // guru lain baru saja kasih/cabut pelanggaran beberapa detik lalu
            // (belum sempat kena giliran polling 30 detik), jendela ini tetap
            // menampilkan data terbaru begitu dibuka.
            await muatPelanggaranAktifDariServer();
            renderDaftarSiswaPelanggaran();
            document.getElementById('modal-daftar-siswa-pelanggaran').classList.remove('hidden');
        }

        function tutupDaftarSiswaPelanggaran() {
            document.getElementById('modal-daftar-siswa-pelanggaran').classList.add('hidden');
        }

        // [BARU -- SKEMA WORKFLOW] Peta warna_badge (dari
        // bangun_ringkasan_semua_siswa() di app.py) ke tampilan kartu siswa.
        // Prioritas SUDAH ditentukan server: merah ('aktif' ada) > biru
        // ('menunggu_acc' ada, tanpa aktif) > kuning (cuma 'menunggu_tugas').
        // Siswa yang tidak muncul di ringkasan sama sekali artinya SEMUA
        // pelanggarannya sudah 'selesai'/'dibatalkan' (atau memang belum
        // pernah ada) -- badge "Bersih", TIDAK PERNAH dianggap masih aktif.
        const TAMPILAN_BADGE_PELANGGARAN = {
            merah: { kelasCard: 'border-rose-200 bg-rose-50/40', kelasTeks: 'text-rose-600', label: 'Ada Pelanggaran Aktif', emoji: '⚠️' },
            biru: { kelasCard: 'border-blue-200 bg-blue-50/40', kelasTeks: 'text-blue-600', label: 'Nunggu ACC Guru', emoji: '⏳' },
            kuning: { kelasCard: 'border-amber-200 bg-amber-50/40', kelasTeks: 'text-amber-600', label: 'Menunggu Tugas Penebus', emoji: '📝' },
        };
        const BADGE_PELANGGARAN_BERSIH = { kelasCard: 'border-slate-200 bg-white', kelasTeks: 'text-emerald-600', label: 'Bersih', emoji: '✅' };
        function tampilanBadgePelanggaranSiswa(username) {
            const r = _cacheRingkasanPelanggaranServer[username];
            if (!r || !r.jumlah_belum_selesai) return BADGE_PELANGGARAN_BERSIH;
            return TAMPILAN_BADGE_PELANGGARAN[r.warna_badge] || TAMPILAN_BADGE_PELANGGARAN.kuning;
        }

        // [BARU -- TAMPILAN PINTAR] toggle expand/collapse daftar "siswa
        // bersih" di Skenario B (default collapsed, cuma dihitung di footer).
        // Direset ke false tiap kali modal dibuka lagi (lihat bukaDaftarSiswaPelanggaran()).
        let _tampilkanSiswaBersihDiDaftar = false;
        function klikToggleSiswaBersihPelanggaran() {
            _tampilkanSiswaBersihDiDaftar = !_tampilkanSiswaBersihDiDaftar;
            renderDaftarSiswaPelanggaran();
        }

        // [BARU] Warna kartu siswa BERMASALAH berdasarkan JUMLAH pelanggaran
        // aktif (bukan warna_badge server / jenis status lagi) -- sesuai
        // permintaan tampilan baru: 1 = kuning, 2-3 = oranye, 4+ = merah.
        function warnaKartuByJumlahPelanggaran(jumlah) {
            if (jumlah >= 4) return { border: '#fee2e2', teks: '#b91c1c' };
            if (jumlah >= 2) return { border: '#ffedd5', teks: '#c2410c' };
            return { border: '#fef3c7', teks: '#b45309' };
        }

        // [BARU] Satu kartu siswa di daftar -- dipakai baik utk siswa
        // bermasalah (kartu besar, warna by jumlah) maupun siswa bersih
        // (kartu ringkas, cuma dipakai pas expand footer / hasil pencarian).
        function kartuSiswaPelanggaranHTML(d) {
            const { m, jumlah, dariKamu, dariGuruLain } = d;
            if (jumlah === 0) {
                return `
                    <div onclick="bukaDetailPelanggaranSiswa(${m.id})" class="p-2.5 rounded-xl border border-slate-200 bg-white cursor-pointer hover:shadow-sm transition-all flex items-center gap-3">
                        ${avatarWrapperHTML(m, 'w-8 h-8')}
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-700 truncate">✅ ${namaEfekHTML(m)}</p>
                            <p class="text-[10px] text-slate-400">${m.kelas} · Bersih</p>
                        </div>
                    </div>
                `;
            }
            const warna = warnaKartuByJumlahPelanggaran(jumlah);
            const rincian = [
                dariKamu > 0 ? `dari kamu: ${dariKamu}` : '',
                dariGuruLain > 0 ? `dari guru lain: ${dariGuruLain}` : ''
            ].filter(Boolean).join(' · ');
            return `
                <div onclick="bukaDetailPelanggaranSiswa(${m.id})" class="p-3 rounded-xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-3" style="border-color:${warna.border}; background-color:${warna.border}55;">
                    ${avatarWrapperHTML(m, 'w-10 h-10')}
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-bold text-slate-900 truncate">⚠️ ${namaEfekHTML(m)}</p>
                        <p class="text-[12px] text-slate-500">${m.kelas} · <span style="color:${warna.teks}" class="font-bold">${jumlah} pelanggaran aktif</span></p>
                        ${rincian ? `<p class="text-[11px] text-slate-400 mt-0.5">${rincian}</p>` : ''}
                    </div>
                </div>
            `;
        }

        // [BARU] Ringkasan footer modal -- total pelanggaran aktif, dari
        // berapa siswa, & berapa yang sudah kamu laporkan sendiri. Elemen
        // #footer-daftar-siswa-pelanggaran perlu ditambahkan di markup modal
        // (templates/dashboard_guru.html), tepat di bawah #list-siswa-pelanggaran.
        function renderFooterDaftarSiswaPelanggaran(bermasalah) {
            const footer = document.getElementById('footer-daftar-siswa-pelanggaran');
            if (!footer) return;
            const totalPelanggaran = bermasalah.reduce((acc, d) => acc + d.jumlah, 0);
            const totalDariKamu = bermasalah.reduce((acc, d) => acc + d.dariKamu, 0);
            footer.innerHTML = totalPelanggaran > 0
                ? `Total: <b>${totalPelanggaran}</b> pelanggaran aktif dari <b>${bermasalah.length}</b> siswa &nbsp;·&nbsp; Kamu sudah urus: <b>${totalDariKamu}</b>`
                : '';
        }

        function renderDaftarSiswaPelanggaran() {
            const namaKelas = _kelasAktifDaftarSiswaPelanggaran;
            const container = document.getElementById('list-siswa-pelanggaran');
            if (!container || !namaKelas) return;

            const keyword = (document.getElementById('input-cari-siswa-pelanggaran')?.value || '').trim().toLowerCase();
            const semuaMuridKelas = sampleMurid30.filter(m => m.kelas === namaKelas);

            // Hitung sekali di awal: jumlah aktif + rincian "dari kamu"/"dari
            // guru lain" per siswa -- dipakai buat sort, render kartu, & footer.
            const dataSiswa = semuaMuridKelas.map(m => {
                const ringkasanSiswa = _cacheRingkasanPelanggaranServer[m.username];
                const jumlah = ringkasanSiswa ? ringkasanSiswa.jumlah_belum_selesai : 0;
                const daftar = _cacheDataPelanggaranServer[m.username] || [];
                let dariKamu = 0, dariGuruLain = 0;
                daftar.forEach(e => {
                    if (e.dilaporkan_oleh === USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA) dariKamu++;
                    else dariGuruLain++;
                });
                return { m, jumlah, dariKamu, dariGuruLain };
            });

            const bermasalah = dataSiswa.filter(d => d.jumlah > 0).sort((a, b) => b.jumlah - a.jumlah);
            const bersih = dataSiswa.filter(d => d.jumlah === 0);

            // TUGAS #3 -- SEARCH: kalau ada keyword, abaikan skenario A/B/C,
            // cari dari SEMUA siswa (termasuk yang bersih & lagi disembunyikan
            // di Skenario B), diurutkan yang paling bermasalah dulu.
            if (keyword) {
                const hasil = dataSiswa.filter(d => d.m.nama.toLowerCase().includes(keyword));
                container.innerHTML = hasil.length === 0
                    ? `<p class="text-center text-slate-400 italic py-6 text-sm">Tidak ada siswa yang cocok.</p>`
                    : hasil.sort((a, b) => b.jumlah - a.jumlah).map(kartuSiswaPelanggaranHTML).join('');
                renderFooterDaftarSiswaPelanggaran(bermasalah);
                return;
            }

            // SKENARIO A: semua siswa bersih -- 1 kotak hijau, tanpa daftar panjang.
            if (bermasalah.length === 0) {
                container.innerHTML = `
                    <div class="flex flex-col items-center justify-center text-center py-10 px-4">
                        <div class="text-4xl mb-2">🎉</div>
                        <p class="font-bold text-emerald-700 text-sm">Semua siswa di kelas ini BERSIH</p>
                        <p class="text-xs text-slate-400 mt-1">Gak ada pelanggaran aktif.</p>
                    </div>
                `;
                renderFooterDaftarSiswaPelanggaran(bermasalah);
                return;
            }

            // SKENARIO C: semua siswa bermasalah -- tampilkan semua, tidak ada yang disembunyikan.
            if (bersih.length === 0) {
                container.innerHTML = bermasalah.map(kartuSiswaPelanggaranHTML).join('');
                renderFooterDaftarSiswaPelanggaran(bermasalah);
                return;
            }

            // SKENARIO B: campuran -- tampilkan yang bermasalah (urut terbanyak),
            // siswa bersih disembunyikan & cuma dihitung di 1 baris collapse/expand.
            let html = bermasalah.map(kartuSiswaPelanggaranHTML).join('');
            html += `
                <div onclick="klikToggleSiswaBersihPelanggaran()" class="mt-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 cursor-pointer flex items-center justify-between text-emerald-700 font-bold text-xs transition-all hover:bg-emerald-100">
                    <span>✅ ${bersih.length} siswa bersih</span>
                    <span class="text-emerald-500 font-semibold">${_tampilkanSiswaBersihDiDaftar ? 'sembunyikan ▲' : 'klik untuk lihat daftar ▼'}</span>
                </div>
            `;
            if (_tampilkanSiswaBersihDiDaftar) {
                html += `<div class="mt-2 space-y-2">${bersih.map(kartuSiswaPelanggaranHTML).join('')}</div>`;
            }
            container.innerHTML = html;
            renderFooterDaftarSiswaPelanggaran(bermasalah);
        }

        async function bukaDetailPelanggaranSiswa(muridId) {
            const murid = sampleMurid30.find(m => m.id === muridId);
            if (!murid) return;
            _muridAktifDetailPelanggaran = murid;

            document.getElementById('detailpel-nama-siswa').innerText = murid.nama;
            document.getElementById('detailpel-kelas-siswa').innerText = murid.kelas;
            document.getElementById('list-pelanggaran-dari-saya').innerHTML = `<p class="text-xs text-slate-400 italic py-2">Memuat...</p>`;
            document.getElementById('list-pelanggaran-dari-lain').innerHTML = '';
            document.getElementById('modal-detail-pelanggaran-siswa').classList.remove('hidden');

            try {
                const res = await fetch(`/api/pelanggaran/daftar?username=${encodeURIComponent(murid.username)}`);
                const json = await res.json();
                if (!json.success) throw new Error(json.message || 'Gagal memuat data pelanggaran.');
                renderDetailPelanggaranSiswa(json.daftar || []);
            } catch (e) {
                document.getElementById('list-pelanggaran-dari-saya').innerHTML = `<p class="text-xs text-rose-500 italic py-2">Gagal memuat: ${escHTMLRekap(e.message)}</p>`;
            }
        }

        function tutupDetailPelanggaranSiswa() {
            document.getElementById('modal-detail-pelanggaran-siswa').classList.add('hidden');
        }

        // isoformat() dari Python (dibuat_at) tidak menyertakan 'Z', tapi ISInya
        // memang selalu UTC (datetime.utcnow()) -- ditambahkan manual di sini
        // supaya new Date(...) mengurainya sebagai UTC, baru dikonversi ke WIB
        // lewat timeZone 'Asia/Jakarta' saat ditampilkan.
        function formatWaktuPelanggaranEntri(isoStr) {
            if (!isoStr) return '-';
            try {
                const iso = isoStr.includes('Z') ? isoStr : isoStr + 'Z';
                const d = new Date(iso);
                if (isNaN(d.getTime())) return isoStr;
                return d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
            } catch (e) {
                return isoStr;
            }
        }

        // [BARU -- SKEMA WORKFLOW] Label & warna pill per status, dipakai
        // render entri di modal Detail Pelanggaran Siswa (beda dari
        // TAMPILAN_BADGE_PELANGGARAN di atas yang untuk badge ringkas
        // kartu/kelas -- ini per-ENTRI, semua 5 status termasuk arsip).
        const LABEL_STATUS_PELANGGARAN = {
            aktif: 'Aktif', menunggu_tugas: 'Menunggu Tugas Dikerjakan', menunggu_acc: 'Menunggu ACC Guru',
            selesai: 'Selesai', dibatalkan: 'Dibatalkan'
        };
        const WARNA_PILL_STATUS_PELANGGARAN = {
            aktif: 'bg-rose-50 text-rose-600 border-rose-200',
            menunggu_tugas: 'bg-amber-50 text-amber-600 border-amber-200',
            menunggu_acc: 'bg-blue-50 text-blue-600 border-blue-200',
            selesai: 'bg-emerald-50 text-emerald-600 border-emerald-200',
            dibatalkan: 'bg-slate-100 text-slate-500 border-slate-200'
        };

        // Render SATU kartu entri pelanggaran di modal Detail -- tombol aksi
        // yang muncul menyesuaikan status (workflow tugaskan -> kirim bukti
        // (siswa) -> acc/tolak -> selesai), dan HANYA muncul kalau milikSaya
        // (server juga menegakkan ini sendiri di tiap endpoint -- lihat
        // _boleh_kelola_pelanggaran() di app.py, frontend di sini cuma
        // mengikuti supaya tombol tidak percuma dipencet lalu ditolak 403).
        function buatEntriPelanggaranHTML(e, milikSaya) {
            const pillClass = WARNA_PILL_STATUS_PELANGGARAN[e.status] || WARNA_PILL_STATUS_PELANGGARAN.aktif;
            const labelStatus = LABEL_STATUS_PELANGGARAN[e.status] || e.status;

            let detailHTML = '';
            if (e.status === 'menunggu_tugas' || e.status === 'menunggu_acc') {
                detailHTML += `<p class="text-[11px] text-slate-500 mt-1"><b>Instruksi Penebus:</b> ${escHTMLRekap(e.instruksi_penebus || '-')}</p>`;
                if (e.deadline_formatted) detailHTML += `<p class="text-[11px] text-slate-500"><b>Batas waktu:</b> ${escHTMLRekap(e.deadline_formatted)}</p>`;
            }
            if (e.status === 'menunggu_tugas' && e.catatan_penolakan) {
                detailHTML += `<p class="text-[11px] text-orange-600 mt-1"><b>Bukti sebelumnya ditolak:</b> ${escHTMLRekap(e.catatan_penolakan)}</p>`;
            }
            if (e.status === 'menunggu_acc') {
                if (e.catatan_siswa) detailHTML += `<p class="text-[11px] text-slate-500 mt-1"><b>Catatan siswa:</b> ${escHTMLRekap(e.catatan_siswa)}</p>`;
                if (e.bukti && e.bukti.length) {
                    detailHTML += `<div class="flex gap-1 flex-wrap mt-1">${e.bukti.map(b => `<img src="${b}" class="w-12 h-12 object-cover rounded-lg border border-slate-200 cursor-pointer" onclick="bukaFotoPreviewBesar('${b}', 'Bukti Tugas Penebus')">`).join('')}</div>`;
                }
            }
            if (e.alasan_banding) {
                detailHTML += `<p class="text-[11px] text-purple-600 mt-1"><b>Banding siswa:</b> ${escHTMLRekap(e.alasan_banding)}</p>`;
            }

            let aksiHTML = '';
            if (milikSaya) {
                if (e.status === 'aktif') {
                    aksiHTML += `<button onclick="klikTugaskanPenebus('${e.id}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-list-check mr-1"></i>Kasih Tugas Penebus</button>`;
                } else if (e.status === 'menunggu_acc') {
                    aksiHTML += `<button onclick="klikAccBuktiPelanggaran('${e.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-check mr-1"></i>ACC</button>`;
                    aksiHTML += `<button onclick="klikTolakBuktiPelanggaran('${e.id}')" class="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-300 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-rotate-left mr-1"></i>Tolak</button>`;
                }
                if (e.status !== 'selesai' && e.status !== 'dibatalkan') {
                    aksiHTML += `<button onclick="klikCabutPelanggaranEntri('${e.id}', true)" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-trash-can mr-1"></i>Cabut</button>`;
                }
            }

            return `
                <div class="p-3 rounded-xl border border-slate-200 bg-white">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <span class="text-sm font-bold text-slate-800">${escHTMLRekap(e.jenis || 'Pelanggaran')}</span>
                        <span class="px-2 py-0.5 rounded-full border text-[10px] font-bold ${pillClass}">${labelStatus}</span>
                    </div>
                    <p class="text-sm text-slate-700 mt-1">${escHTMLRekap(e.keterangan || '-')}</p>
                    ${detailHTML}
                    <p class="text-[11px] text-slate-400 mt-1">
                        ${escHTMLRekap(e.dibuat_at_formatted || formatWaktuPelanggaranEntri(e.dibuat_at))}${!milikSaya ? ' · dari guru lain' : ''}
                    </p>
                    ${aksiHTML ? `<div class="flex items-center gap-2 mt-2 flex-wrap">${aksiHTML}</div>` : ''}
                </div>
            `;
        }

        function renderDetailPelanggaranSiswa(daftar) {
            _daftarPelanggaranSiswaAktifDetail = daftar || [];
            // [SKEMA BARU] pemilahan "dari kamu" vs "dari guru lain" sekarang
            // pakai field 'dilaporkan_oleh' (bukan 'oleh_username' yang sudah
            // tidak ada lagi) -- field ini HANYA tersedia utk entri milikmu
            // sendiri (privasi -- lihat pelanggaran_untuk_response() di
            // app.py), jadi utk entri guru lain nilainya otomatis undefined
            // dan tetap jatuh ke 'dariLain' dengan benar.
            const dariSaya = daftar.filter(e => e.dilaporkan_oleh === USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA);
            const dariLain = daftar.filter(e => e.dilaporkan_oleh !== USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA);

            const elSaya = document.getElementById('list-pelanggaran-dari-saya');
            const elLain = document.getElementById('list-pelanggaran-dari-lain');
            elSaya.innerHTML = dariSaya.length ? dariSaya.map(e => buatEntriPelanggaranHTML(e, true)).join('') : `<p class="text-xs text-slate-400 italic py-2">Belum ada pelanggaran dari kamu.</p>`;
            elLain.innerHTML = dariLain.length ? dariLain.map(e => buatEntriPelanggaranHTML(e, false)).join('') : `<p class="text-xs text-slate-400 italic py-2">Tidak ada pelanggaran dari guru lain.</p>`;

            document.getElementById('detailpel-total').innerText = daftar.length;
            document.getElementById('detailpel-total-saya').innerText = dariSaya.length;
            document.getElementById('detailpel-total-lain').innerText = dariLain.length;
        }

        function klikTambahPelanggaranBaru() {
            const murid = _muridAktifDetailPelanggaran;
            if (!murid) return;
            bukaModalKonfirmasiGenerik({
                judul: 'Kasih Pelanggaran Baru',
                pesan: `Jelaskan pelanggaran ${murid.nama} secara spesifik -- teks ini akan langsung dilihat siswa di dashboard-nya.`,
                teksTombol: 'Ya, Kasih Pelanggaran',
                ikon: 'fa-triangle-exclamation',
                warnaTombol: 'rose',
                tampilkanInputKeterangan: true,
                onKonfirmasi: async function (keterangan) {
                    const hasil = await setPelanggaranAktifUntukUsername(murid.username, true, keterangan);
                    if (hasil.ok) {
                        tampilkanToastSuksesKirimTugas('Pelanggaran Diberikan', `${murid.nama} ditandai Pelanggaran Aktif. Overlay peringatan akan muncul saat dashboard-nya dibuka.`);
                        await muatPelanggaranAktifDariServer();
                        bukaDetailPelanggaranSiswa(murid.id);
                        renderDaftarSiswaPelanggaran();
                        if (activeTab === 'beranda') renderBerandaKelasBerurutan();
                    } else if (hasil.sesiHabis) {
                        tampilkanPeringatanSesiGuruHabis();
                    } else {
                        tampilkanToastSuksesKirimTugas('Gagal Tersimpan', `Pelanggaran ${murid.nama} gagal disimpan ke server: ${hasil.pesanError}. Coba lagi.`);
                    }
                }
            });
        }

        // [BARU -- SKEMA WORKFLOW, GANTIKAN klikEditPelanggaranEntri() LAMA]
        // Endpoint /api/pelanggaran/edit SUDAH TIDAK ADA di server -- "edit
        // keterangan" sebagai fitur berdiri sendiri digantikan total oleh alur
        // tugas penebus: kalau entri masih status 'aktif' (instruksi belum
        // diisi sama sekali), tombol yang tampil sekarang "Kasih Tugas
        // Penebus" (isi instruksi + deadline pertama kali, lewat
        // /api/pelanggaran/tugaskan -- HANYA valid dari status 'aktif').
        function klikTugaskanPenebus(id) {
            const murid = _muridAktifDetailPelanggaran;
            if (!murid) return;
            const entri = (_daftarPelanggaranSiswaAktifDetail || []).find(e => e.id === id);
            bukaModalKonfirmasiGenerik({
                judul: 'Kasih Tugas Penebus',
                pesan: `Tuliskan instruksi tugas penebus untuk ${murid.nama} -- teks ini akan langsung dilihat siswa. Batas waktu boleh dikosongkan kalau tidak ada.`,
                teksTombol: 'Simpan Instruksi',
                ikon: 'fa-list-check',
                warnaTombol: 'blue',
                tampilkanInputKeterangan: true,
                keteranganAwal: entri ? (entri.instruksi_penebus || '') : '',
                tampilkanInputTanggal: true,
                onKonfirmasi: async function (instruksiPenebus, batasRevisi) {
                    if (!instruksiPenebus) {
                        tampilkanToastSuksesKirimTugas('Belum Diisi', 'Instruksi tugas penebus tidak boleh kosong.');
                        return;
                    }
                    try {
                        const res = await fetch('/api/pelanggaran/tugaskan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                username: murid.username,
                                id,
                                instruksi_penebus: instruksiPenebus,
                                deadline: batasRevisi ? new Date(batasRevisi.timestamp).toISOString() : ''
                            })
                        });
                        const json = await res.json();
                        if (!res.ok || !json || !json.success) {
                            if (res.status === 401) { tampilkanPeringatanSesiGuruHabis(); return; }
                            throw new Error((json && json.message) || `Server menolak (status ${res.status}).`);
                        }
                        tampilkanToastSuksesKirimTugas('Tersimpan', `Instruksi tugas penebus untuk ${murid.nama} sudah dikirim -- siswa tinggal mengerjakan.`);
                        await muatPelanggaranAktifDariServer();
                        bukaDetailPelanggaranSiswa(murid.id);
                        renderDaftarSiswaPelanggaran();
                        if (activeTab === 'beranda') renderBerandaKelasBerurutan();
                    } catch (e) {
                        tampilkanToastSuksesKirimTugas('Gagal Tersimpan', e.message || 'Gagal menyimpan instruksi.');
                    }
                }
            });
        }

        // [BARU -- SKEMA WORKFLOW] ACC bukti tugas penebus yang sudah dikirim
        // siswa -- HANYA valid dari status 'menunggu_acc' (lihat
        // api_pelanggaran_acc() di app.py). Entri pindah ke 'selesai' & masuk
        // arsip; tidak butuh input apa pun, cukup konfirmasi.
        function klikAccBuktiPelanggaran(id) {
            const murid = _muridAktifDetailPelanggaran;
            if (!murid) return;
            bukaModalKonfirmasiGenerik({
                judul: 'ACC Bukti Tugas Penebus?',
                pesan: `Bukti tugas penebus ${murid.nama} akan ditandai selesai & masuk arsip. Kalau ini pelanggaran belum-selesai terakhirnya, penguncian tugasnya ikut terbuka.`,
                teksTombol: 'Ya, ACC',
                ikon: 'fa-check',
                warnaTombol: 'emerald',
                onKonfirmasi: async function () {
                    try {
                        const res = await fetch('/api/pelanggaran/acc', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: murid.username, id })
                        });
                        const json = await res.json();
                        if (!res.ok || !json || !json.success) {
                            if (res.status === 401) { tampilkanPeringatanSesiGuruHabis(); return; }
                            throw new Error((json && json.message) || `Server menolak (status ${res.status}).`);
                        }
                        tampilkanToastSuksesKirimTugas('Di-ACC', `Tugas penebus ${murid.nama} sudah di-ACC & masuk arsip.`);
                        await muatPelanggaranAktifDariServer();
                        bukaDetailPelanggaranSiswa(murid.id);
                        renderDaftarSiswaPelanggaran();
                        if (activeTab === 'beranda') renderBerandaKelasBerurutan();
                    } catch (e) {
                        tampilkanToastSuksesKirimTugas('Gagal', e.message || 'Gagal meng-ACC bukti.');
                    }
                }
            });
        }

        // [BARU -- SKEMA WORKFLOW] Tolak bukti tugas penebus yang belum
        // memenuhi instruksi -- HANYA valid dari status 'menunggu_acc' (lihat
        // api_pelanggaran_tolak() di app.py). Entri BALIK ke 'menunggu_tugas'
        // (bukti & catatan lama dihapus server, instruksi/deadline lama tetap
        // dipakai kecuali guru isi yang baru -- form ini sengaja cuma minta
        // catatan_penolakan, instruksi/deadline lama otomatis dipertahankan).
        function klikTolakBuktiPelanggaran(id) {
            const murid = _muridAktifDetailPelanggaran;
            if (!murid) return;
            bukaModalKonfirmasiGenerik({
                judul: 'Tolak Bukti Tugas Penebus',
                pesan: `Jelaskan kenapa bukti ${murid.nama} ditolak -- siswa akan diminta mengirim ulang bukti baru sesuai instruksi yang sama.`,
                teksTombol: 'Ya, Tolak',
                ikon: 'fa-rotate-left',
                warnaTombol: 'orange',
                tampilkanInputKeterangan: true,
                onKonfirmasi: async function (catatanPenolakan) {
                    if (!catatanPenolakan) {
                        tampilkanToastSuksesKirimTugas('Belum Diisi', 'Alasan penolakan tidak boleh kosong.');
                        return;
                    }
                    try {
                        const res = await fetch('/api/pelanggaran/tolak', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: murid.username, id, catatan_penolakan: catatanPenolakan })
                        });
                        const json = await res.json();
                        if (!res.ok || !json || !json.success) {
                            if (res.status === 401) { tampilkanPeringatanSesiGuruHabis(); return; }
                            throw new Error((json && json.message) || `Server menolak (status ${res.status}).`);
                        }
                        tampilkanToastSuksesKirimTugas('Ditolak', `Bukti ${murid.nama} ditolak -- siswa diminta kirim ulang.`);
                        await muatPelanggaranAktifDariServer();
                        bukaDetailPelanggaranSiswa(murid.id);
                        renderDaftarSiswaPelanggaran();
                        if (activeTab === 'beranda') renderBerandaKelasBerurutan();
                    } catch (e) {
                        tampilkanToastSuksesKirimTugas('Gagal', e.message || 'Gagal menolak bukti.');
                    }
                }
            });
        }

        // Cabut SATU entri pelanggaran by id -- beda dari setPelanggaranAktifUntukUsername()
        // (yang cabutnya "entri terbaru milikku di siswa itu", tanpa id, buat
        // kompatibel tombol lama di Rekap Pengumpulan). Di sini WAJIB kirim id
        // karena satu siswa bisa punya banyak entri sekaligus (lihat wireframe
        // "Nggak ngerjain tugas Matematika #1" & "#2" terpisah).
        async function cabutPelanggaranEntriById(username, id) {
            try {
                const res = await fetch('/api/pelanggaran/batalkan-manual', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, id })
                });
                const json = await res.json();
                if (!res.ok || !json || !json.success) {
                    return { ok: false, pesanError: (json && json.message) || `Server menolak (status ${res.status}).`, sesiHabis: res.status === 401 };
                }
                return { ok: true };
            } catch (e) {
                return { ok: false, pesanError: e.message || 'Gagal mencabut.' };
            }
        }

        function klikCabutPelanggaranEntri(id, milikSaya) {
            if (!milikSaya) return; // tombolnya memang tidak dirender kalau bukan milik sendiri, ini cuma jaga-jaga
            const murid = _muridAktifDetailPelanggaran;
            if (!murid) return;
            bukaModalKonfirmasiGenerik({
                judul: 'Cabut Pelanggaran Ini?',
                pesan: `Pelanggaran ini akan dibatalkan (masuk arsip) untuk ${murid.nama}. Overlay/tugas penebus terkait di dashboard siswa akan hilang.`,
                teksTombol: 'Ya, Cabut',
                ikon: 'fa-triangle-exclamation',
                warnaTombol: 'rose',
                onKonfirmasi: async function () {
                    const hasil = await cabutPelanggaranEntriById(murid.username, id);
                    if (hasil.ok) {
                        tampilkanToastSuksesKirimTugas('Dicabut', `Satu pelanggaran ${murid.nama} sudah dicabut.`);
                        await muatPelanggaranAktifDariServer();
                        bukaDetailPelanggaranSiswa(murid.id);
                        renderDaftarSiswaPelanggaran();
                        if (activeTab === 'beranda') renderBerandaKelasBerurutan();
                    } else if (hasil.sesiHabis) {
                        tampilkanPeringatanSesiGuruHabis();
                    } else {
                        tampilkanToastSuksesKirimTugas('Gagal', `Gagal mencabut: ${hasil.pesanError}`);
                    }
                }
            });
        }

        // Kirim perubahan status ke SERVER (bukan localStorage lagi -- lihat
        // catatan besar di atas). Cache lokal diupdate SEBELUM network
        // selesai (baris² sebelum `await fetch` di bawah jalan sinkron)
        // supaya pemanggil (klikTogglePelanggaranSatuMurid dkk) bisa
        // langsung render ulang kartu tanpa nunggu -- kalau ternyata
        // requestnya GAGAL, cache dibalikin lagi & guru diberi tahu.
        // PERBAIKAN: dulu fungsi ini tidak mengembalikan apa-apa (pemanggil
        // langsung anggap "sukses" tanpa nunggu hasil fetch beneran selesai
        // -- lihat catatan di klikTogglePelanggaranSatuMurid()). Sekarang
        // fungsi ini me-return { ok: boolean, pesanError? } supaya pemanggil
        // WAJIB `await` dan baru menampilkan toast SETELAH tahu hasil asli
        // dari server -- bukan optimis duluan.
        //
        // Juga: pesan error dari server (json.message) & alasan network asli
        // (e.message) sekarang dipakai/di-log -- sebelumnya error asli
        // ditelan begitu saja dan user cuma lihat pesan generik terus,
        // padahal penyebabnya bisa macam-macam (session habis, server error,
        // dsb) dan itu penting buat didiagnosis.
        // Cache preset jenis pelanggaran dari /api/pelanggaran/preset-jenis (fetch
        // sekali, dipakai supaya body /api/pelanggaran/tambah selalu kirim 'jenis'
        // & 'kategori' yang VALID di server -- bukan string tebakan yang bisa
        // ditolak validasi backend (skema_pelanggaran.py).
        let _presetJenisPelanggaranCache = null;
        async function ambilPresetJenisPelanggaranSekali() {
            if (_presetJenisPelanggaranCache) return _presetJenisPelanggaranCache;
            try {
                const res = await fetch('/api/pelanggaran/preset-jenis');
                const json = await res.json();
                _presetJenisPelanggaranCache = (json && json.success) ? (json.preset || {}) : {};
            } catch (e) {
                _presetJenisPelanggaranCache = {};
            }
            return _presetJenisPelanggaranCache;
        }

        // Pilih 'jenis' default paling relevan buat konteks Rekap Pengumpulan Tugas
        // ("belum mengerjakan tugas") -- cari key preset yg mengandung kata tugas/kerja,
        // fallback ke key PERTAMA supaya tetap valid dikirim (bukan string kosong/tebakan).
        function pilihJenisDefaultTugas(preset) {
            const keys = Object.keys(preset || {});
            if (keys.length === 0) return { jenis: '', kategori: 'ringan', instruksi_penebus_default: '' };
            const cocok = keys.find(k => /tugas|kerja/i.test(k));
            const jenisTerpilih = cocok || keys[0];
            const p = preset[jenisTerpilih] || {};
            return { jenis: jenisTerpilih, kategori: p.kategori || 'ringan', instruksi_penebus_default: p.instruksi_penebus_default || '' };
        }

        async function setPelanggaranAktifUntukUsername(username, aktif, keterangan = '') {
            if (aktif) _cachePelanggaranAktifServer[username] = true;
            else delete _cachePelanggaranAktifServer[username];

            try {
                // FIX: /api/pelanggaran/set sudah DIHAPUS -- diganti skema baru:
                //   aktif=true  -> POST /api/pelanggaran/tambah  (butuh jenis & kategori)
                //   aktif=false -> POST /api/pelanggaran/batalkan-manual (butuh id entri)
                // 'keterangan' tetap teks yang tampil APA ADANYA di overlay siswa (guru
                // wajib mengisinya lewat modal di klikTogglePelanggaranSatuMurid()/
                // klikKasihPelanggaranSemuaBelumKerja() sebelum sampai ke sini).
                let res;
                if (aktif) {
                    const preset = await ambilPresetJenisPelanggaranSekali();
                    const def = pilihJenisDefaultTugas(preset);
                    res = await fetch('/api/pelanggaran/tambah', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username,
                            jenis: def.jenis,
                            kategori: def.kategori,
                            keterangan,
                            instruksi_penebus: def.kategori === 'berat' ? (def.instruksi_penebus_default || keterangan) : '',
                            deadline: null
                        })
                    });
                } else {
                    // CATATAN ASUMSI: skema baru izinkan banyak entri per siswa, jadi cabut
                    // butuh id spesifik -- diambil dari entri TERBARU milik guru ini yang
                    // BELUM final (bukan 'selesai'/'dibatalkan') di cache
                    // _cacheDataPelanggaranServer (diisi dari /api/pelanggaran/semua lewat
                    // muatPelanggaranAktifDariServer()). Field 'oleh_username' lama sudah
                    // tidak ada -- diganti 'dilaporkan_oleh' (cuma terisi utk entri
                    // milikmu sendiri, lihat pelanggaran_untuk_response() di app.py).
                    const milikSaya = (_cacheDataPelanggaranServer[username] || [])
                        .filter(e => e.dilaporkan_oleh === USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA && e.status !== 'selesai' && e.status !== 'dibatalkan');
                    const entriTerbaru = milikSaya[milikSaya.length - 1];
                    if (!entriTerbaru) throw new Error('Tidak ditemukan entri pelanggaran milikmu (yang belum selesai) untuk dibatalkan.');
                    res = await fetch('/api/pelanggaran/batalkan-manual', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, id: entriTerbaru.id })
                    });
                }

                let json = null;
                try {
                    json = await res.json();
                } catch (parseErr) {
                    // Respons bukan JSON valid -- biasanya berarti server balikin
                    // halaman error HTML (mis. 500 Internal Server Error, atau
                    // 401/redirect ke halaman login kalau session sudah habis).
                    // res.status di sini yang jadi petunjuk asli penyebabnya.
                    throw new Error(`Server membalas status ${res.status} (bukan JSON) -- kemungkinan session habis atau error di server.`);
                }

                if (!res.ok || !json || !json.success) {
                    throw new Error((json && json.message) || `Server menolak (status ${res.status}).`, { cause: res.status });
                }

                return { ok: true };
            } catch (e) {
                // Server menolak/gagal -- balikin cache lokal ke keadaan semula
                // supaya tampilan guru tidak "bohong" bilang sudah tersimpan.
                if (aktif) delete _cachePelanggaranAktifServer[username];
                else _cachePelanggaranAktifServer[username] = true;
                // Dicatat ke console supaya gampang di-cek lewat DevTools kalau
                // masih terjadi lagi -- pesan toast sengaja tetap ringkas buat guru,
                // tapi detail teknisnya harus tetap bisa ditelusuri.
                console.error('Gagal menyimpan status pelanggaran:', e);
                if (taskAktifDipilihUntukRekap) {
                    bukaRekapPengumpulanTugas(taskAktifDipilihUntukRekap.namaKelas, taskAktifDipilihUntukRekap.taskId, true);
                }
                // PERBAIKAN: dulu kasus session guru sudah habis/tidak valid lagi
                // (server balas 401 "Belum login sebagai guru") diperlakukan SAMA
                // seperti error server biasa -- guru cuma lihat toast merah generik
                // dan kalau coba klik "Batalkan" lagi, GAGAL TERUS tanpa penjelasan
                // kenapa (padahal penyebabnya cuma perlu login ulang). Sekarang
                // kasus 401 ditandai lewat sesiHabis supaya pemanggil bisa kasih
                // tahu guru secara jelas & arahkan login ulang, bukan retry sia-sia.
                return { ok: false, pesanError: e.message || 'Gagal menyimpan.', sesiHabis: e.cause === 401 };
            }
        }

        // Dipanggil pemanggil setPelanggaranAktifUntukUsername() saat hasilnya
        // sesiHabis=true -- kasih tahu guru secara jelas bahwa penyebab gagalnya
        // BUKAN error acak, tapi session login guru sudah tidak valid lagi, lalu
        // arahkan ke halaman login supaya tidak coba klik ulang berkali-kali sia-sia.
        function tampilkanPeringatanSesiGuruHabis() {
            bukaModalKonfirmasiGenerik({
                judul: 'Sesi Login Berakhir',
                pesan: 'Sesi login guru Anda sudah tidak valid lagi (mungkin karena login ulang di perangkat/tab lain, atau sudah lama tidak aktif). Silakan login ulang untuk melanjutkan.',
                teksTombol: 'Login Ulang',
                ikon: 'fa-right-from-bracket',
                warnaTombol: 'rose',
                onKonfirmasi: function () { window.location.href = '/login'; }
            });
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
                // PERBAIKAN: dulu toast "Dibatalkan" & update tombol langsung
                // jalan tanpa nunggu hasil fetch (lihat catatan besar di
                // setPelanggaranAktifUntukUsername) -- sekarang di-await dulu,
                // toast sukses cuma muncul kalau memang beneran tersimpan.
                setPelanggaranAktifUntukUsername(murid.username, false).then(function (hasil) {
                    if (hasil.ok) {
                        tampilkanToastSuksesKirimTugas('Dibatalkan', `Status Pelanggaran Aktif untuk ${murid.nama} sudah dibatalkan.`);
                        perbaruiTombolPelanggaranDiKartu(muridId, false);
                    } else if (hasil.sesiHabis) {
                        tampilkanPeringatanSesiGuruHabis();
                    } else {
                        tampilkanToastSuksesKirimTugas('Gagal Tersimpan', `Gagal membatalkan pelanggaran ${murid.nama}: ${hasil.pesanError}`);
                    }
                });
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
                // PERBAIKAN UTAMA: onKonfirmasi sekarang `async` dan meng-`await`
                // setPelanggaranAktifUntukUsername() SEBELUM menampilkan toast
                // apa pun. Sebelumnya toast "Pelanggaran Diberikan" & update
                // tombol langsung jalan begitu tombol modal diklik, padahal
                // fetch ke server belum tentu selesai/berhasil -- itu sebabnya
                // toast sukses & toast gagal bisa muncul beruntun/tumpang
                // tindih walau permintaan sebenarnya gagal tersimpan.
                onKonfirmasi: async function (keterangan) {
                    const hasil = await setPelanggaranAktifUntukUsername(murid.username, true, keterangan);
                    if (hasil.ok) {
                        tampilkanToastSuksesKirimTugas('Pelanggaran Diberikan', `${murid.nama} ditandai Pelanggaran Aktif. Overlay peringatan akan muncul saat dashboard-nya dibuka.`);
                        perbaruiTombolPelanggaranDiKartu(muridId, true);
                    } else if (hasil.sesiHabis) {
                        tampilkanPeringatanSesiGuruHabis();
                    } else {
                        tampilkanToastSuksesKirimTugas('Gagal Tersimpan', `Pelanggaran ${murid.nama} gagal disimpan ke server: ${hasil.pesanError}. Coba lagi.`);
                    }
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
            const { data: hasilPeriksaBulk } = await ambilHasilPeriksaBulkServer(taskId, muridKelasIni.map(m => m.id));
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
                // PERBAIKAN: sama seperti klikTogglePelanggaranSatuMurid() --
                // dulu toast sukses & update tombol jalan untuk SEMUA murid
                // tanpa nunggu hasil fetch masing-masing, jadi kalau salah
                // satu (atau semua) gagal tersimpan, guru tetap dikasih tahu
                // "sudah ditandai" padahal belum tentu. Sekarang tiap request
                // di-await, dihitung berapa yang beneran sukses vs gagal, baru
                // toast akhirnya mencerminkan hasil sebenarnya.
                onKonfirmasi: async function (keterangan) {
                    const hasilSemua = await Promise.all(belumKerja.map(async (m) => {
                        const hasil = await setPelanggaranAktifUntukUsername(m.username, true, keterangan);
                        if (hasil.ok) perbaruiTombolPelanggaranDiKartu(m.id, true);
                        return hasil;
                    }));
                    // PERBAIKAN: kalau penyebab gagalnya session guru sudah habis,
                    // SEMUA murid pasti ikut gagal dengan alasan sama -- jadi cukup
                    // tampilkan SATU peringatan "login ulang" yang jelas, bukan toast
                    // "gagal tersimpan" yang menyuruh guru coba lagi berkali-kali sia-sia.
                    if (hasilSemua.some(h => h.sesiHabis)) {
                        tampilkanPeringatanSesiGuruHabis();
                        return;
                    }
                    const jumlahSukses = hasilSemua.filter(h => h.ok).length;
                    const jumlahGagal = hasilSemua.length - jumlahSukses;
                    if (jumlahGagal === 0) {
                        tampilkanToastSuksesKirimTugas('Pelanggaran Diberikan', `${jumlahSukses} murid yang belum mengerjakan tugas ini sudah ditandai Pelanggaran Aktif.`);
                    } else if (jumlahSukses === 0) {
                        tampilkanToastSuksesKirimTugas('Gagal Tersimpan', `Semua (${jumlahGagal}) pelanggaran gagal disimpan ke server. Coba lagi.`);
                    } else {
                        tampilkanToastSuksesKirimTugas('Sebagian Gagal', `${jumlahSukses} berhasil ditandai, tapi ${jumlahGagal} gagal disimpan ke server. Coba lagi untuk yang gagal.`);
                    }
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
        // PERBAIKAN BUG "status kumpul balik ke 0 / Belum Kumpul setelah hard
        // refresh": dulu SEMUA kegagalan (termasuk 429 rate limit & network
        // error) ditelan begitu saja lewat `return {}` -- baik pemanggil
        // (hitungDanTampilkanPerluDinilai, bukaRekapPengumpulanTugas, dst)
        // maupun guru TIDAK PERNAH tahu bedanya "memang belum ada yang
        // kumpul" vs "gagal ambil data, submisi aslinya ADA di server".
        // Sekarang fungsi ini membedakan lewat field `gagal`: true berarti
        // request-nya sendiri gagal (bukan datanya kosong) -- pemanggil WAJIB
        // cek ini dan JANGAN menimpa cache/tampilan lama dengan hasil kosong
        // kalau gagal=true, supaya data yang sudah benar tidak "hilang" cuma
        // gara-gara satu fetch kena rate limit di tengah banyaknya request
        // paralel saat dashboard baru dibuka/di-refresh.
        async function ambilSubmisiTugasServer(taskId) {
            try {
                const res = await fetch(`/api/tugas/submissions/${encodeURIComponent(taskId)}`);
                if (res.ok) {
                    const resJson = await res.json();
                    if (resJson.success) return { data: resJson.submissions || {}, gagal: false };
                }
                console.warn('Gagal ambil data pengumpulan tugas dari server (status bukan 200/sukses):', taskId, res.status);
            } catch (e) {
                console.warn('Gagal ambil data pengumpulan tugas dari server:', taskId, e);
            }
            return { data: {}, gagal: true };
        }

        // ============================================================
        // HELPER POLLING HEMAT: ringkasan submisi TANPA foto base64.
        // /api/tugas/submissions/<id> membawa seluruh foto semua siswa; untuk
        // badge "Perlu Dinilai" cukup status. Endpoint ringkas ini (lihat
        // app.py) mengembalikan status semua tugas dalam 1 request, dan foto
        // lengkap baru diambil untuk tugas yang benar-benar berubah.
        // ============================================================
        async function ambilSubmisiRingkasBulk(daftarIdTugas) {
            const potongan = [];
            for (let i = 0; i < daftarIdTugas.length; i += 60) potongan.push(daftarIdTugas.slice(i, i + 60));
            try {
                const hasil = await Promise.all(potongan.map(async (ids) => {
                    const res = await fetch(`/api/tugas/submissions-ringkas?ids=${encodeURIComponent(ids.join(','))}`);
                    if (!res.ok) throw new Error('status ' + res.status);
                    const json = await res.json();
                    if (!json.success) throw new Error('respons tidak sukses');
                    return json.submissions || {};
                }));
                return { data: Object.assign({}, ...hasil), gagal: false };
            } catch (e) {
                console.warn('Gagal ambil ringkasan submisi (bulk):', e);
                return { data: {}, gagal: true };
            }
        }

        // true kalau cache lokal belum cukup (belum ada / foto berubah) sehingga
        // perlu fetch penuh untuk tugas ini; selain itu cukup gabung field ringan.
        function _submisiPerluFetchPenuh(lama, baru) {
            if (!lama) return true;
            return Object.keys(baru).some(u => {
                const b = baru[u] || {}, l = lama[u];
                const jFoto = b.jumlah_foto || 0, jAnot = b.jumlah_foto_anotasi_revisi || 0;
                if (!l) return jFoto > 0 || jAnot > 0;
                if ((b.waktu_iso || null) !== (l.waktu_iso || null)) return true;
                if (jFoto !== (Array.isArray(l.images) ? l.images.length : 0)) return true;
                return jAnot !== (Array.isArray(l.foto_anotasi_revisi) ? l.foto_anotasi_revisi.length : 0);
            });
        }

        // Ambil hasil periksa untuk banyak kunci sekaligus (dipotong 60 kunci/request).
        async function ambilHasilPeriksaBulkBanyak(daftarKunci) {
            if (daftarKunci.length === 0) return { data: {}, gagal: false };
            const potongan = [];
            for (let i = 0; i < daftarKunci.length; i += 60) potongan.push(daftarKunci.slice(i, i + 60));
            try {
                const hasil = await Promise.all(potongan.map(async (kunci) => {
                    const res = await fetch(`/api/sync/bulk?kunci=${encodeURIComponent(kunci.join(','))}`);
                    const json = await res.json();
                    if (!json.ok) throw new Error('respons tidak ok');
                    return json.data || {};
                }));
                return { data: Object.assign({}, ...hasil), gagal: false };
            } catch (e) {
                console.warn('Gagal ambil hasil periksa (bulk):', e);
                return { data: {}, gagal: true };
            }
        }

        // FITUR TAMBAHAN: "Batas Waktu Revisi" otomatis kedaluwarsa (sisi
        // guru). Dulu kalau batas waktu revisi (batas_revisi) sudah lewat
        // tanpa siswa kirim ulang, status di Rekap Pengumpulan tetap
        // nyangkut "Perlu Revisi" selamanya -- guru harus klik "Batalkan
        // Revisi Ini" manual. Sekarang dihitung LIVE dari jam sekarang tiap
        // kali rekap dirender (sama pola dgn kedaluwarsa deadline tugas
        // biasa) -- begitu batasnya lewat, kartu murid tsb otomatis pindah
        // sendiri ke status "Tidak Kumpul" (dihitung belum mengerjakan)
        // pada render berikutnya, TANPA guru perlu klik apa pun ataupun
        // restart web/app. Kalau siswa sempat kirim ulang SEBELUM batas
        // lewat, status.keputusan sudah otomatis null (di-reset server saat
        // submit), jadi fungsi ini otomatis false & dihitung normal beres.
        function revisiSudahKedaluwarsaGuru(status, now) {
            if (!status || status.keputusan !== 'revisi') return false;
            const batasRevisiMs = Number(status.batasRevisi);
            if (!batasRevisiMs || isNaN(batasRevisiMs)) return false;
            return (now || new Date()).getTime() > batasRevisiMs;
        }

        function statusPengumpulanUntukTugas(murid, task, kedaluwarsa, hasilPeriksaBulk) {
            // hasilPeriksaBulk (opsional): kalau pemanggil sudah menarik data
            // hasil periksa SEMUA murid sekaligus lewat ambilHasilPeriksaBulkServer()
            // (lihat catatan besar di sana), pakai itu -- supaya TIDAK perlu
            // panggil ambilHasilPeriksaTersimpan() (blocking) lagi per murid.
            // Dipertahankan HANYA sebagai fallback buat data lama (dibuat
            // sebelum keputusan/alasanKeputusan dipindah ke
            // tugas_submission_store, lihat catatan di 'keputusan:' di bawah)
            // -- entri BARU sudah tidak lagi menulis ke sini sama sekali.
            const tersimpan = hasilPeriksaBulk
                ? (hasilPeriksaBulk[kunciHasilPeriksaTugas(task.id, murid.id)] || null)
                : ambilHasilPeriksaTersimpan(task.id, murid.id);
            const submisiSemua = window._cacheSubmisiTugas[task.id] || {};
            const entri = submisiSemua[murid.username];

            if (!entri || !entri.submitted) {
                // FITUR TAMBAHAN: bedakan "belum mengerjakan sama sekali" dari
                // "sedang mengerjakan" lewat field 'dilihat' -- diisi ASLI oleh
                // server (/api/tugas/dibaca) begitu siswa membuka halaman tugas
                // ini di Dashboard Siswa. Kalau belum pernah dibuka sama sekali
                // (dilihat=false), berarti murni belum mengerjakan; kalau sudah
                // dibuka tapi belum dikirim (dilihat=true), berarti sedang
                // dikerjakan.
                return { submitted: false, dilihat: !!(entri && entri.dilihat), waktu: null, nilai: null, catatan: null, fotoTugasList: [] };
            }

            let fotoList = [];
            if (Array.isArray(entri.images) && entri.images.length > 0) fotoList = entri.images;

            return {
                submitted: true,
                dilihat: true,
                waktu: entri.waktu || null,
                nilai: (entri.nilai !== undefined && entri.nilai !== null) ? entri.nilai : (tersimpan ? tersimpan.nilai : null),
                catatan: entri.catatan || (tersimpan ? tersimpan.catatan : null),
                // FITUR TAMBAHAN: keputusan guru atas tugas yang SUDAH dikumpulkan
                // -- 'ditolak' / 'revisi' / null (belum diputuskan apa-apa, dianggap
                // Terkumpul biasa). Sekarang disimpan LANGSUNG bareng nilai/catatan/
                // images di tugas_submission_store (lihat POST /api/tugas/keputusan
                // & mintaKeputusanTugasDariRekap()) -- entri.keputusan diutamakan;
                // `tersimpan` (skema lama, sync_store keyed idSiswa) cuma dipakai
                // sbg fallback kalau kebetulan ada data lama yang belum ketimpa.
                keputusan: (entri.keputusan !== undefined && entri.keputusan !== null) ? entri.keputusan : (tersimpan ? tersimpan.keputusan : null),
                alasanKeputusan: entri.alasanKeputusan || (tersimpan ? tersimpan.alasanKeputusan : null),
                // FITUR TAMBAHAN: batas waktu revisi (opsional, null kalau guru
                // tidak menentukan) -- dikirim guru lewat mintaKeputusanTugasDariRekap()
                // & POST /api/tugas/keputusan, disimpan server di field yang sama
                // (batas_revisi/batas_revisi_formatted) di tugas_submission_store.
                batasRevisi: (entri.batas_revisi !== undefined) ? entri.batas_revisi : null,
                batasRevisiFormatted: entri.batas_revisi_formatted || null,
                // FITUR TAMBAHAN: foto yang sudah dicoret/dilingkari guru dgn
                // warna lewat kanvas di modal "Minta Revisi & Tandai Foto"
                // (lihat _kirimRevisiDenganAnotasi()) -- null/[] kalau guru
                // tidak menandai foto sama sekali (cuma isi alasan teks).
                fotoAnotasiRevisi: Array.isArray(entri.foto_anotasi_revisi) ? entri.foto_anotasi_revisi : null,
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
        // Cache status pengumpulan tiap murid YANG SEDANG TAMPIL di grid kartu
        // rekap ini saat ini -- diisi ulang tiap kali grid dirender (lihat
        // bukaRekapPengumpulanTugas() di bawah), dipakai oleh
        // bukaPreviewStatusSiswaRekap() supaya klik kartu tidak perlu fetch
        // ulang ke server (datanya sudah ada dari render barusan).
        let _statusRekapPerMuridSaatIni = {};
        // FITUR TAMBAHAN (Rata-rata Nilai Kelas + Isi Otomatis Satu Kelas):
        // cache hasil periksa (nilai/catatan) mentah dari fetch terakhir di
        // bukaRekapPengumpulanTugas, dipakai ulang oleh
        // hitungRataRataNilaiKelas() & perbaruiHitungTerdampakBulkNilai()
        // supaya tidak perlu fetch ulang ke server tiap modal isi-otomatis
        // dibuka/diubah pilihannya.
        let _hasilPeriksaBulkRekapSaatIni = {};
        async function bukaRekapPengumpulanTugas(namaKelas, taskId, _dariSinkron) {
            taskAktifDipilihUntukRekap = { namaKelas, taskId };

            // Setiap kali jendela ini dibuka (bukan pas dipanggil ulang dari callback
            // sinkron di atas), tarik dulu data foto/border/efek/title TERBARU tiap
            // siswa dari server -- supaya kalau ada siswa yang baru saja ganti foto
            // profil / border sebelum guru buka rekap ini, tampilannya langsung
            // mengikuti perubahan itu, bukan data lama yang nyangkut di memori.
            if (!_dariSinkron && NAMA_KELAS_DENGAN_MURID_ASLI.includes(namaKelas)) sinkronBorderRosterDariServer();

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
            const [, hasilSubmisiTugas, hasilPeriksaBulkRes] = await Promise.all([
                _dariSinkron ? Promise.resolve() : muatPelanggaranAktifDariServer(),
                ambilSubmisiTugasServer(taskId),
                ambilHasilPeriksaBulkServer(taskId, muridKelasIni.map(m => m.id))
            ]);
            // PERBAIKAN BUG UTAMA "status Sudah Kumpul balik jadi Belum Kumpul
            // setelah refresh": dulu baris ini LANGSUNG menimpa
            // window._cacheSubmisiTugas[taskId] dengan hasil fetch di atas, APA
            // PUN hasilnya -- termasuk kalau fetch-nya GAGAL (mis. kena rate
            // limit karena banyak request paralel dilepas bersamaan pas jendela
            // Rekap ini baru dibuka/di-refresh; lihat catatan besar di
            // ambilSubmisiTugasServer()). Gagal fetch dulu balik sebagai objek
            // KOSONG `{}`, jadi cache yang tadinya sudah benar (berisi
            // "AHMAD FAKHRI AL FARISI sudah kumpul") ikut TERTIMPA KOSONG,
            // padahal datanya di server tetap ada -- itulah kenapa kartu yang
            // sebelumnya sempat hijau/"Sudah Kumpul" bisa balik jadi
            // "Belum Kumpul" cuma gara-gara guru refresh jendela ini. Sekarang
            // cache CUMA ditimpa kalau fetch-nya beneran berhasil; kalau gagal,
            // cache lama (kalau ada) dipertahankan supaya render di bawah tetap
            // pakai data terakhir yang valid, bukan kosong palsu.
            const submisiTugasHasil = hasilSubmisiTugas.gagal
                ? (window._cacheSubmisiTugas[taskId] || {})
                : hasilSubmisiTugas.data;
            if (!hasilSubmisiTugas.gagal) window._cacheSubmisiTugas[taskId] = submisiTugasHasil;
            const hasilPeriksaBulk = hasilPeriksaBulkRes.gagal ? {} : hasilPeriksaBulkRes.data;
            _hasilPeriksaBulkRekapSaatIni = hasilPeriksaBulk;
            // Kalau fetch submisi tadi gagal DAN memang belum ada cache lama sama
            // sekali, coba ambil ulang sekali lagi otomatis sesaat kemudian --
            // daripada guru melihat "Belum Kumpul" palsu dan harus sadar sendiri
            // untuk refresh manual berkali-kali.
            if (hasilSubmisiTugas.gagal && !window._cacheSubmisiTugas[taskId] && !_dariSinkron) {
                setTimeout(() => {
                    if (taskAktifDipilihUntukRekap && taskAktifDipilihUntukRekap.taskId === taskId && taskAktifDipilihUntukRekap.namaKelas === namaKelas) {
                        bukaRekapPengumpulanTugas(namaKelas, taskId, true);
                    }
                }, 1500);
            }

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

            // Reset cache status per murid tiap kali grid ini dirender ulang,
            // supaya bukaPreviewStatusSiswaRekap() (dipicu klik kartu) selalu
            // baca data yang sesuai dengan tugas/kelas yang SEDANG dibuka --
            // bukan data basi dari jendela rekap sebelumnya.
            _statusRekapPerMuridSaatIni = {};

            const _waktuSekarangRekap = new Date();
            muridKelasIni.forEach(m => {
                const status = statusPengumpulanUntukTugas(m, task, kedaluwarsa, hasilPeriksaBulk);
                // FITUR TAMBAHAN: kalau batas waktu revisi sudah lewat tanpa
                // kirim ulang, jangan dihitung "sudah" -- otomatis dihitung
                // "belum" (Tidak Kumpul), lihat revisiSudahKedaluwarsaGuru().
                const revisiExpiredGuru = status.submitted && revisiSudahKedaluwarsaGuru(status, _waktuSekarangRekap);
                if (status.submitted && !revisiExpiredGuru) hitungSudah++; else hitungBelum++;
                _statusRekapPerMuridSaatIni[m.id] = { murid: m, status, revisiExpiredGuru };

                let cardBangkuStyle, badgeStatusBangku, statusLabelText;

                if (revisiExpiredGuru) {
                    cardBangkuStyle = 'border-rose-300 bg-rose-50/70 text-rose-900 shadow-sm opacity-90';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-xmark"></i></span>`;
                    statusLabelText = `<span class="text-rose-600 font-bold italic">Tidak Kumpul (Batas Revisi Lewat)</span>`;
                } else if (status.submitted && status.keputusan === 'ditolak') {
                    cardBangkuStyle = 'border-rose-300 bg-rose-50/80 hover:bg-rose-100 text-rose-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-ban"></i></span>`;
                    statusLabelText = `<span class="text-rose-600 font-bold italic">Ditolak</span>`;
                } else if (status.submitted && status.keputusan === 'revisi') {
                    cardBangkuStyle = 'border-orange-300 bg-orange-50/80 hover:bg-orange-100 text-orange-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-rotate-left"></i></span>`;
                    statusLabelText = `<span class="text-orange-600 font-bold italic">Perlu Revisi</span>`;
                } else if (status.submitted) {
                    cardBangkuStyle = 'border-emerald-300 bg-emerald-50/90 hover:bg-emerald-100 text-emerald-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-check"></i></span>`;
                    statusLabelText = `<span class="text-emerald-700 font-bold">${status.nilai ? 'Nilai: ' + status.nilai : status.waktu}</span>`;
                } else if (kedaluwarsa) {
                    cardBangkuStyle = 'border-rose-300 bg-rose-50/70 text-rose-900 shadow-sm opacity-90';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-black text-xs shadow-md"><i class="fa-solid fa-xmark"></i></span>`;
                    statusLabelText = `<span class="text-rose-600 font-bold italic">Tidak Kumpul</span>`;
                } else if (status.dilihat) {
                    // FITUR TAMBAHAN: siswa sudah membuka tugas ini (dibaca di
                    // Dashboard Siswa) tapi belum mengirim jawabannya -- ditandai
                    // beda dari yang belum pernah dibuka sama sekali.
                    cardBangkuStyle = 'border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-amber-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-xs shadow-md animate-pulse"><i class="fa-solid fa-pen"></i></span>`;
                    statusLabelText = `<span class="text-amber-600 font-semibold italic">Sedang Mengerjakan</span>`;
                } else {
                    cardBangkuStyle = 'border-blue-200 bg-blue-50/60 text-blue-900 shadow-sm';
                    badgeStatusBangku = `<span class="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-xs shadow-md animate-pulse"><i class="fa-solid fa-hourglass-half"></i></span>`;
                    statusLabelText = `<span class="text-blue-600 font-semibold italic">Belum Mengerjakan</span>`;
                }

                // PERUBAHAN: dulu cuma kartu murid yang SUDAH kumpul yang bisa
                // diklik (langsung ke modal grading modal-periksa); murid yang
                // belum kumpul kartunya "mati" (tidak ada aksi apa pun kalau
                // diklik). Sekarang SEMUA kartu bisa diklik lewat
                // bukaPreviewStatusSiswaRekap() -- fungsi itu sendiri yang
                // membedakan tampilannya: popup info singkat kalau belum ada
                // tugas, atau pratinjau (nama + badge + foto) kalau sudah
                // kumpul. Jadi variabel ini sekarang cuma dipakai buat teks
                // overlay hover, bukan buat syarat bisa-klik-atau-tidak lagi.
                const bisaDiperiksa = status.submitted;

                // FITUR TAMBAHAN: tombol "Kasih Pelanggaran" -- cuma ditampilkan
                // buat murid yang BELUM mengerjakan tugas ini (baik yang masih
                // aktif "Belum Kumpul" maupun yang sudah lewat "Tidak Kumpul").
                // Warna & teks tombol berubah kalau status pelanggarannya sudah aktif,
                // supaya guru bisa lihat sekilas & batalkan lagi kalau perlu.
                // stopPropagation tetap dipertahankan supaya klik tombol ini
                // tidak ikut memicu onclick kartu (buka modal preview).
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
                    <div onclick="bukaPreviewStatusSiswaRekap(${m.id})" class="kartu-rekap-tugas-siswa bisa-diperiksa p-3 rounded-2xl border-2 ${cardBangkuStyle} cursor-pointer transition-all flex flex-col justify-between space-y-2 relative group overflow-hidden">
                        <div class="flex items-center justify-between gap-1">
                            <span class="text-[10px] font-mono font-bold text-slate-500 truncate">Siswa</span>
                            ${badgeStatusBangku}
                        </div>
                        <div class="flex items-center gap-2">
                            ${avatarWrapperHTML(m, 'w-8 h-8')}
                            <div class="overflow-hidden">
                                <h5 class="text-xs font-bold truncate">${namaEfekHTML(m)}</h5>
                                <div class="mt-0.5 flex items-center gap-1 flex-wrap">
                                    ${m.borderTersinkron ? `${titleBadgeHTML(m)}` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[10px] font-bold">
                            <span class="text-slate-400">${status.submitted ? 'Kumpul:' : 'Status:'}</span> ${statusLabelText}
                        </div>
                        ${tombolPelanggaranHTML}
                        <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/5 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
                            <span class="text-[9px] font-bold text-white bg-slate-900/85 px-2.5 py-1 rounded-full shadow-md flex items-center gap-1">
                                <i class="fa-solid ${bisaDiperiksa ? 'fa-image' : 'fa-circle-info'}"></i> ${bisaDiperiksa ? 'Lihat Foto & Bukti' : 'Lihat Info'}
                            </span>
                        </div>
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

            hitungRataRataNilaiKelas();
        }

        function tutupRekapPengumpulanTugas() {
            document.getElementById('modal-rekap-pengumpulan-tugas').classList.add('hidden');
            // Reset supaya fetch sinkronBorderRosterDariServer() yang masih berjalan
            // di background (dipicu waktu jendela ini dibuka) tidak membuka ulang
            // jendela ini begitu selesai -- sama seperti pola di tutupDetailKelas().
            taskAktifDipilihUntukRekap = null;
        }

        // ============================================================
        // FITUR TAMBAHAN: "Rata-rata Nilai Kelas" + "Isi Otomatis Satu Kelas"
        // -- ditampilkan di dalam jendela "Rekap Pengumpulan per Tugas".
        // Sumber kebenaran status "sudah kumpul" TETAP
        // _statusRekapPerMuridSaatIni (persis yang menentukan badge hijau di
        // grid kartu), dan nilai TETAP disimpan lewat setSync dengan kunci
        // kunciHasilPeriksaTugas() yang sama seperti penilaian satu-satu di
        // simpanNilaiSiswa() -- jadi kompatibel & langsung kelihatan di
        // tempat lain yang membaca sumber sama.
        // ============================================================

        // Hitung & tampilkan rata-rata nilai kelas untuk tugas yang SEDANG
        // dibuka di jendela Rekap. Cuma murid yang statusnya "sudah kumpul"
        // DAN sudah punya nilai (bukan cuma "Kumpul: <waktu>") yang dihitung.
        function hitungRataRataNilaiKelas() {
            const elNilai = document.getElementById('rekap-tugas-rata2-nilai');
            const elKet = document.getElementById('rekap-tugas-rata2-ket');
            if (!elNilai || !elKet) return;

            const daftarNilai = [];
            Object.values(_statusRekapPerMuridSaatIni).forEach(({ status, revisiExpiredGuru }) => {
                if (!status.submitted || revisiExpiredGuru) return;
                const nilaiTersimpan = status.nilai;
                if (nilaiTersimpan !== null && nilaiTersimpan !== undefined && nilaiTersimpan !== '' && !isNaN(Number(nilaiTersimpan))) {
                    daftarNilai.push(Number(nilaiTersimpan));
                }
            });

            if (daftarNilai.length === 0) {
                elNilai.innerText = '-';
                elKet.innerText = 'Belum ada siswa yang dinilai';
                return;
            }

            const rata2 = daftarNilai.reduce((a, b) => a + b, 0) / daftarNilai.length;
            elNilai.innerText = (Math.round(rata2 * 10) / 10).toString().replace('.', ',');
            elKet.innerText = `Dari ${daftarNilai.length} siswa yang sudah dinilai`;
        }

        // Ambil daftar {id, ...} murid yang cocok dengan opsi target yang
        // dipilih di modal isi-otomatis (belum_dinilai / semua_sudah_kumpul).
        // Dipakai bersama oleh perbaruiHitungTerdampakBulkNilai() (buat
        // ngitung jumlah) & terapkanIsiOtomatisSatuKelas() (buat nentuin
        // siapa aja yang disimpan) -- supaya angka yang ditampilkan di
        // preview SELALU sama persis dengan yang benar-benar diterapkan.
        function _daftarMuridTerdampakIsiOtomatis(targetOpsi) {
            const hasil = [];
            Object.values(_statusRekapPerMuridSaatIni).forEach(({ murid, status, revisiExpiredGuru }) => {
                if (!status.submitted || revisiExpiredGuru) return; // wajib sudah kumpul
                const sudahDinilai = status.nilai !== null && status.nilai !== undefined && status.nilai !== '';
                if (targetOpsi === 'belum_dinilai' && sudahDinilai) return; // jangan timpa yang sudah dinilai
                hasil.push(murid);
            });
            return hasil;
        }

        function bukaModalIsiOtomatisSatuKelas() {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;
            const task = getTasksKelas(namaKelas).find(t => t.id === taskId);
            document.getElementById('isiotomatis-judul-tugas').innerText = task ? (task.judul || 'Tugas ini') : 'Tugas ini';
            document.getElementById('isiotomatis-input-nilai').value = 80;
            document.querySelector('#modal-isi-otomatis-nilai input[name="isiotomatis-target"][value="belum_dinilai"]').checked = true;
            document.getElementById('modal-isi-otomatis-nilai').classList.remove('hidden');
            perbaruiHitungTerdampakBulkNilai();
        }

        function tutupModalIsiOtomatisSatuKelas() {
            document.getElementById('modal-isi-otomatis-nilai').classList.add('hidden');
        }

        function perbaruiHitungTerdampakBulkNilai() {
            const box = document.getElementById('isiotomatis-box-terdampak');
            const btnTerapkan = document.getElementById('isiotomatis-btn-terapkan');
            if (!box) return;

            const targetOpsi = document.querySelector('#modal-isi-otomatis-nilai input[name="isiotomatis-target"]:checked').value;
            const nilaiInput = document.getElementById('isiotomatis-input-nilai').value;
            const jumlah = _daftarMuridTerdampakIsiOtomatis(targetOpsi).length;

            if (jumlah === 0) {
                box.innerHTML = `<span class="text-slate-400">Tidak ada siswa yang cocok dengan pilihan ini.</span>`;
                if (btnTerapkan) btnTerapkan.disabled = true, btnTerapkan.classList.add('opacity-50', 'cursor-not-allowed');
                return;
            }
            if (btnTerapkan) btnTerapkan.disabled = false, btnTerapkan.classList.remove('opacity-50', 'cursor-not-allowed');
            box.innerHTML = `<span class="text-slate-700"><b class="text-amber-600">${jumlah} siswa</b> akan mendapat nilai <b class="text-amber-600">${nilaiInput || 0}</b>.</span>`;
        }

        // Simpan nilai ke server utk 1 kunci (mirip setSync tapi pakai fetch
        // ASYNC yang di-await, bukan fire-and-forget) -- supaya "Isi Otomatis
        // Satu Kelas" bisa menunggu SEMUA nilai beneran tersimpan di server
        // dulu sebelum bilang "berhasil" & me-refresh grid, tidak cuma
        // optimis di localStorage.
        function _simpanSyncAsync(kunci, data) {
            localStorage.setItem(kunci, JSON.stringify(data));
            return fetch(`/api/sync/${encodeURIComponent(kunci)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            }).then(res => res.ok).catch(() => false);
        }

        async function terapkanIsiOtomatisSatuKelas() {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;

            const nilaiVal = document.getElementById('isiotomatis-input-nilai').value;
            if (nilaiVal === '' || isNaN(Number(nilaiVal)) || Number(nilaiVal) < 0 || Number(nilaiVal) > 100) {
                alert('Harap masukkan nilai angka antara 0-100.');
                return;
            }
            const targetOpsi = document.querySelector('#modal-isi-otomatis-nilai input[name="isiotomatis-target"]:checked').value;
            const muridTerdampak = _daftarMuridTerdampakIsiOtomatis(targetOpsi);
            if (muridTerdampak.length === 0) return;

            const btnTerapkan = document.getElementById('isiotomatis-btn-terapkan');
            const teksAsliBtn = btnTerapkan.innerHTML;
            btnTerapkan.disabled = true;
            btnTerapkan.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan ${muridTerdampak.length} nilai...`;

            const hasilSimpan = await Promise.all(muridTerdampak.map(m => {
                const catatanLama = (_hasilPeriksaBulkRekapSaatIni[kunciHasilPeriksaTugas(taskId, m.id)] || {}).catatan || '';
                return _simpanSyncAsync(kunciHasilPeriksaTugas(taskId, m.id), { nilai: nilaiVal, catatan: catatanLama });
            }));

            // Sinkronkan juga field task.grade utk murid ID #1 (akun asli),
            // sama seperti pola di simpanNilaiSiswa().
            if (muridTerdampak.some(m => m.id === 1)) {
                const tasks = getTasksKelas(namaKelas);
                const idx = tasks.findIndex(t => t.id === taskId);
                if (idx > -1) { tasks[idx].grade = nilaiVal; saveTasksKelas(namaKelas, tasks); }
            }

            btnTerapkan.disabled = false;
            btnTerapkan.innerHTML = teksAsliBtn;

            const gagalCount = hasilSimpan.filter(ok => !ok).length;
            tutupModalIsiOtomatisSatuKelas();
            if (gagalCount > 0) {
                alert(`⚠️ Nilai berhasil diisikan ke ${muridTerdampak.length - gagalCount} dari ${muridTerdampak.length} siswa. ${gagalCount} gagal tersimpan (coba lagi).`);
            } else {
                alert(`✅ Nilai ${nilaiVal} berhasil diisikan ke ${muridTerdampak.length} siswa sekaligus.`);
            }
            bukaRekapPengumpulanTugas(namaKelas, taskId, true);
            hitungDanTampilkanPerluDinilai();
        }

        // ============================================================
        // MODAL "Preview Status Pengumpulan Siswa" -- KHUSUS dipakai di
        // dalam grid kartu murid pada jendela "Rekap Pengumpulan per
        // Tugas" (yang dibuka dari tab "Rekap Semua Tugas"). Markup
        // modalnya sengaja dibangun lewat JS (bukan ditaruh statis di
        // HTML) supaya fitur ini mandiri -- tidak perlu ubah file HTML
        // terpisah, cukup file JS ini saja.
        //
        // Satu modal, DUA tampilan berbeda tergantung status:
        // - Belum ada tugas / belum kumpul  -> popup info singkat: ikon
        //   peringatan, nama siswa, teks status, 1 tombol "Tutup".
        // - Sudah dikerjakan / mengumpulkan -> pratinjau: nama siswa,
        //   badge hijau "Terkumpul", & foto/bukti tugas yang dikirim
        //   (bisa diklik buat diperbesar di tab baru). Ditambah tombol
        //   "Beri Nilai" buat lanjut ke form penilaian penuh
        //   (modal-periksa / bukaPeriksaTugasDariRekap) kalau guru mau
        //   menilai dari sini juga.
        // ============================================================
        function _pastikanModalPreviewStatusSiswaAda() {
            if (document.getElementById('modal-preview-status-siswa')) return;
            const wrap = document.createElement('div');
            wrap.id = 'modal-preview-status-siswa';
            wrap.className = 'hidden fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm';
            // Klik di luar kotak putih (area backdrop) menutup modal, sama
            // seperti pola modal lain di dashboard ini; klik di DALAM kotak
            // putih di-stopPropagation supaya tidak ikut menutup.
            wrap.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onclick="event.stopPropagation()"><div id="preview-status-siswa-isi" class="p-5"></div></div>`;
            wrap.addEventListener('click', tutupPreviewStatusSiswa);
            document.body.appendChild(wrap);
        }

        function tutupPreviewStatusSiswa() {
            const modal = document.getElementById('modal-preview-status-siswa');
            if (modal) modal.classList.add('hidden');
        }

        function bukaPreviewStatusSiswaRekap(idSiswa) {
            // Data diambil dari cache hasil render grid barusan (lihat
            // _statusRekapPerMuridSaatIni di bukaRekapPengumpulanTugas), bukan
            // fetch ulang ke server -- supaya modal ini kebuka instan tanpa
            // jeda loading tiap kali kartu diklik.
            const data = _statusRekapPerMuridSaatIni[idSiswa];
            if (!data) return;
            const { murid, status, revisiExpiredGuru } = data;
            const task = taskAktifDipilihUntukRekap
                ? getTasksKelas(taskAktifDipilihUntukRekap.namaKelas).find(t => t.id === taskAktifDipilihUntukRekap.taskId)
                : null;
            const kedaluwarsa = task ? cekStatusTugasKedaluwarsaGuru(task) : false;

            _pastikanModalPreviewStatusSiswaAda();
            const isi = document.getElementById('preview-status-siswa-isi');

            if (revisiExpiredGuru) {
                // FITUR TAMBAHAN: batas waktu revisi murid ini sudah lewat
                // tanpa kirim ulang -- otomatis dihitung "Tidak Kumpul"
                // (belum mengerjakan). Foto lama (bukti revisi terakhir yang
                // diminta) tetap ditampilkan sbg arsip, plus tombol utk guru
                // yang tetap ingin membuka kembali jendela revisinya manual
                // kalau perlu (mis. mau kasih kelonggaran).
                const daftarFotoLama = status.fotoTugasList || [];
                const isiFotoLama = daftarFotoLama.length > 0
                    ? `<div class="grid grid-cols-3 gap-2 mt-3">${daftarFotoLama.map(src => `<img src="${src}" onclick="bukaFotoPreviewBesar(this.src, this.alt)" class="w-full h-20 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-all opacity-80" alt="Bukti Tugas ${murid.nama}" loading="lazy" decoding="async">`).join('')}</div>`
                    : '';
                isi.innerHTML = `
                    <div class="flex flex-col items-center text-center gap-3 py-2">
                        <div class="w-14 h-14 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center text-2xl">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div>
                            <h4 class="font-extrabold text-slate-800 text-sm">${namaEfekHTML(murid)}</h4>
                            <p class="text-xs text-slate-500 mt-1">Batas waktu revisi (${status.batasRevisiFormatted || '-'}) sudah lewat tanpa kirim ulang -- otomatis dihitung <u class="font-bold text-rose-600">Tidak Kumpul</u>.</p>
                        </div>
                        ${isiFotoLama}
                        <button onclick="batalkanKeputusanTugasDariRekap(${murid.id})" class="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800 text-xs font-bold rounded-xl transition-all border border-slate-200"><i class="fa-solid fa-rotate-left mr-1"></i>Buka Lagi Jendela Revisi (Beri Kelonggaran)</button>
                        <button onclick="tutupPreviewStatusSiswa()" class="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">Tutup</button>
                    </div>
                `;
            } else if (!status.submitted) {
                // FITUR TAMBAHAN: teks & ikon modal ini sekarang bedain 3 kondisi
                // -- lewat batas waktu (merah), sudah dibuka siswa tapi belum
                // dikirim alias sedang dikerjakan (kuning/pensil), atau belum
                // pernah dibuka sama sekali alias belum mengerjakan (kuning/jam).
                let teksStatus, ikonKelas, warnaBulatan;
                if (kedaluwarsa) {
                    teksStatus = `${murid.nama} tidak mengumpulkan tugas ini (sudah lewat batas waktu).`;
                    ikonKelas = 'fa-solid fa-triangle-exclamation';
                    warnaBulatan = 'bg-rose-50 text-rose-500';
                } else if (status.dilihat) {
                    teksStatus = `${murid.nama} sedang mengerjakan tugas ini (sudah dibuka, belum dikirim).`;
                    ikonKelas = 'fa-solid fa-pen';
                    warnaBulatan = 'bg-amber-50 text-amber-500';
                } else {
                    teksStatus = `${murid.nama} belum mengerjakan tugas ini.`;
                    ikonKelas = 'fa-solid fa-hourglass-half';
                    warnaBulatan = 'bg-amber-50 text-amber-500';
                }
                isi.innerHTML = `
                    <div class="flex flex-col items-center text-center gap-3 py-2">
                        <div class="w-14 h-14 rounded-full ${warnaBulatan} flex items-center justify-center text-2xl">
                            <i class="${ikonKelas}"></i>
                        </div>
                        <div>
                            <h4 class="font-extrabold text-slate-800 text-sm">${namaEfekHTML(murid)}</h4>
                            <p class="text-xs text-slate-500 mt-1">${teksStatus}</p>
                        </div>
                        <button onclick="tutupPreviewStatusSiswa()" class="mt-2 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">Tutup</button>
                    </div>
                `;
            } else {
                const daftarFoto = status.fotoTugasList || [];
                const isiFoto = daftarFoto.length > 0
                    ? `<div class="grid grid-cols-3 gap-2 mt-3">${daftarFoto.map(src => `<img src="${src}" onclick="bukaFotoPreviewBesar(this.src, this.alt)" class="w-full h-20 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-all" alt="Bukti Tugas ${murid.nama}" loading="lazy" decoding="async">`).join('')}</div>`
                    : `<p class="text-xs text-slate-400 italic mt-3">File dikirim dalam bentuk teks/dokumen digital.</p>`;

                // FITUR TAMBAHAN: badge berubah tergantung keputusan guru (kalau
                // ada) -- Terkumpul (hijau, default) / Ditolak (merah) / Perlu
                // Revisi (oranye) -- plus alasan yang guru isi ditampilkan di
                // bawah badge-nya supaya guru sendiri inget alasannya apa.
                let badgeKeputusanHTML = `<span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold text-[10px] rounded-lg"><i class="fa-solid fa-check"></i> Terkumpul</span>`;
                if (status.keputusan === 'ditolak') {
                    badgeKeputusanHTML = `<span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 font-bold text-[10px] rounded-lg"><i class="fa-solid fa-ban"></i> Ditolak</span>`;
                } else if (status.keputusan === 'revisi') {
                    badgeKeputusanHTML = `<span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-orange-50 text-orange-600 border border-orange-200 font-bold text-[10px] rounded-lg"><i class="fa-solid fa-rotate-left"></i> Perlu Revisi</span>`;
                }
                const alasanKeputusanHTML = (status.keputusan && status.alasanKeputusan)
                    ? `<p class="text-[11px] text-slate-500 mt-2 bg-slate-50 border border-slate-100 rounded-lg p-2"><i class="fa-solid fa-quote-left mr-1 text-slate-300"></i>${status.alasanKeputusan}</p>`
                    : '';
                // FITUR TAMBAHAN: kalau guru menentukan batas waktu revisi, tampilkan
                // di bawah alasan supaya guru sendiri inget deadline-nya kapan.
                const batasRevisiHTML = (status.keputusan === 'revisi' && status.batasRevisiFormatted)
                    ? `<p class="text-[11px] font-bold text-orange-600 mt-1.5"><i class="fa-regular fa-clock mr-1"></i>Batas revisi: ${status.batasRevisiFormatted}</p>`
                    : '';
                // FITUR TAMBAHAN: kalau guru sempat menandai/melingkari foto dgn
                // warna (lihat bukaModalAnotasiRevisi()), tampilkan lagi di sini
                // supaya guru sendiri bisa lihat ulang tanda yang sudah dibuat.
                const fotoAnotasiRevisiHTML = (status.keputusan === 'revisi' && Array.isArray(status.fotoAnotasiRevisi) && status.fotoAnotasiRevisi.length > 0)
                    ? `<div class="mt-2"><span class="text-[10px] font-bold text-orange-600 uppercase tracking-wide"><i class="fa-solid fa-pen-nib mr-1"></i>Foto yang Ditandai:</span><div class="grid grid-cols-3 gap-2 mt-1.5">${status.fotoAnotasiRevisi.map(src => `<img src="${src}" onclick="bukaFotoPreviewBesar(this.src, this.alt)" class="w-full h-20 object-cover rounded-lg border-2 border-orange-300 shadow-sm cursor-zoom-in hover:opacity-90 transition-all" alt="Foto Ditandai ${murid.nama}" loading="lazy" decoding="async">`).join('')}</div></div>`
                    : '';
                // FITUR TAMBAHAN: guru bisa menarik kembali keputusan 'ditolak'/
                // 'revisi' yang sudah diambil (mis. salah pencet, atau murid
                // ternyata sudah benar) -- balik ke status normal "Terkumpul"
                // TANPA menunggu siswa kirim ulang. Cuma muncul kalau memang
                // ada keputusan aktif. Lihat batalkanKeputusanTugasDariRekap().
                const tombolBatalkanKeputusanHTML = status.keputusan
                    ? `<button onclick="batalkanKeputusanTugasDariRekap(${murid.id})" class="w-full py-2 mt-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 text-[11px] font-bold rounded-xl transition-all border border-slate-200"><i class="fa-solid fa-rotate-left mr-1"></i>Batalkan ${status.keputusan === 'revisi' ? 'Revisi' : 'Penolakan'} Ini</button>`
                    : '';

                isi.innerHTML = `
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-3">
                            ${avatarWrapperHTML(murid, 'w-11 h-11')}
                            <div class="min-w-0">
                                <h4 class="font-extrabold text-slate-800 text-sm truncate">${namaEfekHTML(murid)}</h4>
                                ${badgeKeputusanHTML}
                            </div>
                        </div>
                        ${alasanKeputusanHTML}
                        ${batasRevisiHTML}
                        ${fotoAnotasiRevisiHTML}
                        ${isiFoto}
                        <div class="flex gap-2 mt-4">
                            <button onclick="tutupPreviewStatusSiswa()" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">Tutup</button>
                            <button onclick="tutupPreviewStatusSiswa(); bukaPeriksaTugasDariRekap(${murid.id})" class="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all">Beri Nilai</button>
                        </div>
                        <div class="flex gap-2 mt-2">
                            <button onclick="mintaKeputusanTugasDariRekap(${murid.id}, 'ditolak')" class="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl transition-all border border-rose-200"><i class="fa-solid fa-ban mr-1"></i>Tolak</button>
                            <button onclick="bukaModalAnotasiRevisi(${murid.id})" class="flex-1 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-600 text-xs font-bold rounded-xl transition-all border border-orange-200"><i class="fa-solid fa-pen-nib mr-1"></i>Minta Revisi</button>
                        </div>
                        ${tombolBatalkanKeputusanHTML}
                    </div>
                `;
            }

            document.getElementById('modal-preview-status-siswa').classList.remove('hidden');
        }

        // FITUR TAMBAHAN: guru menolak / minta revisi tugas yang SUDAH
        // dikumpulkan siswa, langsung dari modal preview di "Rekap Pengumpulan
        // per Tugas". Guru WAJIB isi alasan (dipakai pola bukaModalKonfirmasiGenerik
        // yang sama dengan "Kasih Pelanggaran"), lalu alasan itu dikirim ke
        // POST /api/tugas/keputusan dan disimpan LANGSUNG di
        // tugas_submission_store[taskId][username] (kunci yang sama dgn
        // nilai/catatan/images milik siswa ybs -- lihat catatan di app.py) --
        // dipakai username (murid.username), BUKAN lagi idSiswa dummy, supaya
        // begitu siswa kirim ulang tugas revisinya, status ini otomatis
        // ke-reset sendiri oleh server (lihat api_tugas_submit()), tanpa
        // perlu logic pembersihan tambahan apa pun di sini.
        async function mintaKeputusanTugasDariRekap(idSiswa, jenisKeputusan) {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;
            const murid = sampleMurid30.find(m => m.id === idSiswa);
            if (!murid) return;

            const judul = jenisKeputusan === 'ditolak' ? 'Tolak Tugas' : 'Minta Revisi Tugas';
            const teksTombol = jenisKeputusan === 'ditolak' ? 'Ya, Tolak Tugas Ini' : 'Ya, Minta Revisi';
            const labelAlasan = jenisKeputusan === 'ditolak' ? 'alasan ditolak' : 'alasan perlu direvisi';

            // Batas waktu revisi (tanggal+jam) cuma relevan buat jenisKeputusan
            // 'revisi' -- 'ditolak' tidak butuh, siswa memang tidak diminta
            // kirim ulang.
            bukaModalKonfirmasiGenerik({
                judul,
                pesan: `Jelaskan ${labelAlasan} tugas ${murid.nama} secara spesifik -- teks ini akan langsung dilihat siswa di dashboard-nya.`,
                teksTombol,
                ikon: jenisKeputusan === 'ditolak' ? 'fa-ban' : 'fa-rotate-left',
                warnaTombol: jenisKeputusan === 'ditolak' ? 'rose' : 'amber',
                tampilkanInputKeterangan: true,
                tampilkanInputTanggal: jenisKeputusan === 'revisi',
                onKonfirmasi: async function (keterangan, batasRevisi) {
                    try {
                        const res = await fetch('/api/tugas/keputusan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                task_id: taskId,
                                username: murid.username,
                                keputusan: jenisKeputusan,
                                alasan: keterangan,
                                // null kalau guru tidak isi tanggal (tidak ada batas
                                // waktu khusus buat revisi ini) -- backend WAJIB
                                // terima & simpan field ini apa adanya (lihat
                                // PANDUAN_TEMPEL_APP_PY.md).
                                batas_revisi: batasRevisi ? batasRevisi.timestamp : null,
                                batas_revisi_formatted: batasRevisi ? batasRevisi.formatted : null
                            })
                        });
                        const json = await res.json();
                        if (!json.success) {
                            alert(json.message || 'Gagal menyimpan keputusan ke server.');
                            return;
                        }
                    } catch (e) {
                        console.error('Gagal mengirim keputusan tugas ke server:', e);
                        alert('Gagal menyimpan keputusan. Cek koneksi lalu coba lagi.');
                        return;
                    }
                    // Cache submisi kelas ini di memori sudah basi (belum tahu
                    // keputusan barusan) -- hapus supaya dipanggil ulang segar
                    // dari server saat grid rekap dirender ulang di bawah.
                    if (window._cacheSubmisiTugas) delete window._cacheSubmisiTugas[taskId];
                    tampilkanToastSuksesKirimTugas(
                        jenisKeputusan === 'ditolak' ? 'Tugas Ditolak' : 'Revisi Diminta',
                        `${murid.nama} sudah ditandai "${jenisKeputusan === 'ditolak' ? 'Ditolak' : 'Perlu Revisi'}".`
                    );
                    tutupPreviewStatusSiswa();
                    // Refresh grid supaya kartu bangku ikut berubah warna/label
                    // TANPA nunjukin ulang skeleton loading (pola sama dengan
                    // _dariSinkron di tempat lain).
                    if (taskAktifDipilihUntukRekap && taskAktifDipilihUntukRekap.taskId === taskId && taskAktifDipilihUntukRekap.namaKelas === namaKelas) {
                        bukaRekapPengumpulanTugas(namaKelas, taskId, true);
                    }
                }
            });
        }

        // ============================================================
        // FITUR TAMBAHAN: Anotasi Foto Revisi -- guru bisa mencoret/
        // melingkari LANGSUNG di atas foto tugas siswa dengan warna pilihan
        // saat "Minta Revisi" (tombol di modal preview diganti dari
        // mintaKeputusanTugasDariRekap ke bukaModalAnotasiRevisi khusus utk
        // 'revisi' -- 'Tolak' tetap pakai modal generik lama karena tidak
        // butuh nunjuk foto). Markup modal dibangun dinamis lewat JS (pola
        // sama dgn _pastikanModalPreviewStatusSiswaAda() di atas) -- tidak
        // perlu ubah file HTML template sama sekali.
        //
        // Cara kerja kanvas: tiap foto dimuat ke <canvas> dgn resolusi PIXEL
        // yang SAMA dgn ukuran asli fotonya (supaya coretan tetap tajam),
        // ditampilkan mengecil lewat CSS (w-full) -- makanya posisi
        // klik/sentuh WAJIB diskalakan balik ke resolusi asli lewat
        // getBoundingClientRect() (lihat posisiDariEvent() di
        // _buatKanvasAnotasi()). Begitu guru tekan "Kirim ke Siswa", tiap
        // kanvas (foto asli + coretan, sudah jadi SATU gambar sejak awal
        // karena coretannya memang digambar di atas kanvas yg sama)
        // diekspor lewat canvas.toDataURL('image/png') & dikirim sbg list
        // 'foto_anotasi' ke POST /api/tugas/keputusan (lihat app.py).
        // ============================================================
        let _antrianAnotasiRevisi = { idSiswa: null, kanvasList: [], warna: '#ef4444', ukuranKuas: 6 };

        function _pastikanModalAnotasiRevisiAda() {
            if (document.getElementById('modal-anotasi-revisi')) return;
            const wrap = document.createElement('div');
            wrap.id = 'modal-anotasi-revisi';
            wrap.className = 'hidden fixed inset-0 z-[80] flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-sm';
            wrap.innerHTML = `
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden" onclick="event.stopPropagation()">
                    <div class="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <h3 class="font-extrabold text-slate-800 text-sm"><i class="fa-solid fa-pen-nib text-orange-500 mr-1.5"></i>Minta Revisi &amp; Tandai Foto</h3>
                        <button onclick="tutupModalAnotasiRevisi()" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="p-4 overflow-y-auto flex-1 space-y-4">
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-[11px] font-bold text-slate-700">Warna &amp; Ukuran Coretan</span>
                                <button onclick="_hapusCoretanAnotasiAktif()" class="text-[10px] font-bold text-slate-500 hover:text-rose-600"><i class="fa-solid fa-eraser mr-1"></i>Hapus Semua Coretan</button>
                            </div>
                            <div class="flex items-center gap-2 flex-wrap" id="anotasi-palet-warna"></div>
                            <label class="text-[10px] text-slate-400 flex items-center gap-2 mt-2">Ukuran kuas
                                <input type="range" id="anotasi-ukuran-kuas" min="2" max="18" value="6" class="flex-1" oninput="_antrianAnotasiRevisi.ukuranKuas = Number(this.value)">
                            </label>
                        </div>
                        <div>
                            <span class="text-[10px] text-slate-400">Coret/lingkari langsung di foto di bawah ini buat nunjuk bagian yang perlu direvisi:</span>
                            <div id="anotasi-daftar-kanvas" class="space-y-3 mt-2"></div>
                        </div>
                        <div>
                            <label class="text-[11px] font-bold text-slate-700 block mb-1">Alasan / Catatan Revisi</label>
                            <textarea id="anotasi-input-alasan" rows="3" class="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:ring-2 focus:ring-orange-400 focus:border-orange-400" placeholder="Jelaskan bagian yang perlu direvisi..."></textarea>
                        </div>
                        <div>
                            <label class="text-[11px] font-bold text-slate-700 block mb-1">Batas Waktu Revisi (opsional)</label>
                            <div class="flex gap-2">
                                <input type="date" id="anotasi-input-tanggal" class="flex-1 text-xs border border-slate-200 rounded-xl p-2.5">
                                <input type="time" id="anotasi-input-jam" class="w-28 text-xs border border-slate-200 rounded-xl p-2.5">
                            </div>
                        </div>
                    </div>
                    <div class="p-4 border-t border-slate-100 flex gap-2 shrink-0">
                        <button onclick="tutupModalAnotasiRevisi()" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all">Batal</button>
                        <button id="anotasi-btn-kirim" onclick="_kirimRevisiDenganAnotasi()" class="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl transition-all opacity-50 cursor-not-allowed" disabled><i class="fa-solid fa-paper-plane mr-1"></i>Kirim ke Siswa</button>
                    </div>
                </div>`;
            wrap.addEventListener('click', tutupModalAnotasiRevisi);
            document.body.appendChild(wrap);

            const palet = document.getElementById('anotasi-palet-warna');
            const warnaPreset = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];
            palet.innerHTML = warnaPreset.map(w => `<button type="button" onclick="_pilihWarnaAnotasi('${w}', this)" class="anotasi-swatch w-7 h-7 rounded-full border-2 border-white shadow ring-1 ring-slate-200" style="background:${w}"></button>`).join('')
                + `<input type="color" value="#ef4444" onchange="_pilihWarnaAnotasi(this.value, null)" class="w-7 h-7 rounded-full border-0 p-0 cursor-pointer" title="Warna custom">`;
        }

        function tutupModalAnotasiRevisi() {
            const modal = document.getElementById('modal-anotasi-revisi');
            if (modal) modal.classList.add('hidden');
            _antrianAnotasiRevisi = { idSiswa: null, kanvasList: [], warna: '#ef4444', ukuranKuas: 6 };
        }

        function _pilihWarnaAnotasi(warna, tombolEl) {
            _antrianAnotasiRevisi.warna = warna;
            document.querySelectorAll('.anotasi-swatch').forEach(b => b.classList.remove('ring-4', 'ring-offset-1', 'ring-slate-400'));
            if (tombolEl) tombolEl.classList.add('ring-4', 'ring-offset-1', 'ring-slate-400');
        }

        function _hapusCoretanAnotasiAktif() {
            _antrianAnotasiRevisi.kanvasList.forEach(k => {
                if (!k) return;
                k.ctx.clearRect(0, 0, k.canvas.width, k.canvas.height);
                if (k.img) k.ctx.drawImage(k.img, 0, 0, k.canvas.width, k.canvas.height);
            });
        }

        // FITUR TAMBAHAN: batas resolusi kanvas anotasi supaya ringan & tetap
        // responsif di HP kelas bawah -- foto HP siswa sering 3000-4000px,
        // kalau dipakai APA ADANYA sebagai resolusi <canvas>, coretan jadi
        // patah-patah/lag saat digambar (terutama di layar sentuh) dan hasil
        // toDataURL() jadi berat banget buat diupload. 1280px sisi terpanjang
        // sudah lebih dari cukup buat lingkaran/coretan penanda tetap kebaca
        // jelas oleh siswa. Foto yang sisi terpanjangnya sudah <=1280px TIDAK
        // di-upscale (dipakai ukuran aslinya apa adanya).
        const MAKS_DIMENSI_KANVAS_ANOTASI = 1280;

        function _buatKanvasAnotasi(src, idx) {
            const wrapperFoto = document.createElement('div');
            wrapperFoto.className = 'rounded-xl border border-slate-200 overflow-hidden bg-slate-50';
            const canvas = document.createElement('canvas');
            canvas.className = 'w-full block touch-none cursor-crosshair';
            wrapperFoto.appendChild(canvas);
            document.getElementById('anotasi-daftar-kanvas').appendChild(wrapperFoto);

            const ctx = canvas.getContext('2d');
            const img = new Image();
            const kanvasInfo = { canvas, ctx, img: null };
            _antrianAnotasiRevisi.kanvasList[idx] = kanvasInfo;

            img.onload = function () {
                // Skalakan turun kalau sisi terpanjang foto asli melebihi batas
                // -- resolusi kanvas jadi lebih kecil (ringan digambar & di-
                // ekspor), coretan tetap tajam relatif terhadap ukuran foto
                // yang ditampilkan karena skala X/Y dihitung ulang tiap event
                // lewat posisiDariEvent().
                const sisiTerpanjang = Math.max(img.naturalWidth, img.naturalHeight);
                const skalaTurun = sisiTerpanjang > MAKS_DIMENSI_KANVAS_ANOTASI ? (MAKS_DIMENSI_KANVAS_ANOTASI / sisiTerpanjang) : 1;
                canvas.width = Math.round(img.naturalWidth * skalaTurun);
                canvas.height = Math.round(img.naturalHeight * skalaTurun);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                kanvasInfo.img = img;
            };
            img.src = src;

            function posisiDariEvent(e) {
                const rect = canvas.getBoundingClientRect();
                const titik = (e.touches && e.touches[0]) ? e.touches[0] : e;
                const skalaX = canvas.width / rect.width;
                const skalaY = canvas.height / rect.height;
                return { x: (titik.clientX - rect.left) * skalaX, y: (titik.clientY - rect.top) * skalaY };
            }

            let menggambar = false;
            function mulai(e) {
                e.preventDefault();
                menggambar = true;
                const p = posisiDariEvent(e);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
            }
            function gambar(e) {
                if (!menggambar) return;
                e.preventDefault();
                const p = posisiDariEvent(e);
                const rect = canvas.getBoundingClientRect();
                const skala = canvas.width / (rect.width || canvas.width);
                ctx.lineTo(p.x, p.y);
                ctx.strokeStyle = _antrianAnotasiRevisi.warna;
                ctx.lineWidth = _antrianAnotasiRevisi.ukuranKuas * skala;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
            function selesai() { menggambar = false; }

            // Pointer events + setPointerCapture: mouse & sentuh ditangani satu jalur,
            // dan tidak perlu window.addEventListener('mouseup') yang dulu menumpuk
            // (tak pernah dilepas) tiap modal anotasi dibuka.
            canvas.style.touchAction = 'none';
            canvas.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
                mulai(e);
            });
            canvas.addEventListener('pointermove', gambar);
            canvas.addEventListener('pointerup', selesai);
            canvas.addEventListener('pointercancel', selesai);
        }

        function bukaModalAnotasiRevisi(idSiswa) {
            if (!taskAktifDipilihUntukRekap) return;
            const data = _statusRekapPerMuridSaatIni[idSiswa];
            if (!data) return;
            const { status } = data;

            _pastikanModalAnotasiRevisiAda();
            _antrianAnotasiRevisi.idSiswa = idSiswa;
            _antrianAnotasiRevisi.kanvasList = [];
            document.getElementById('anotasi-daftar-kanvas').innerHTML = '';
            document.getElementById('anotasi-input-alasan').value = '';

            // FITUR TAMBAHAN: tanggal & jam batas revisi otomatis default ke
            // SEKARANG (hari/bulan/tahun + jam saat modal ini dibuka, yaitu
            // saat guru mau mengirim revisi) -- guru tidak perlu isi manual
            // dari kosong tiap kali, tinggal geser majuin tanggal/jamnya kalau
            // mau kasih waktu lebih longgar ke siswa. Dihitung dari jam lokal
            // browser guru (WIB), bukan UTC.
            const inputTgl = document.getElementById('anotasi-input-tanggal');
            const inputJam = document.getElementById('anotasi-input-jam');
            const sekarang = new Date();
            const dua = (n) => String(n).padStart(2, '0');
            if (inputTgl) inputTgl.value = `${sekarang.getFullYear()}-${dua(sekarang.getMonth() + 1)}-${dua(sekarang.getDate())}`;
            if (inputJam) inputJam.value = `${dua(sekarang.getHours())}:${dua(sekarang.getMinutes())}`;
            if (inputTgl) inputTgl.min = inputTgl.value; // jaga-jaga: cegah guru pilih tanggal yang sudah lewat

            const daftarFoto = status.fotoTugasList || [];
            daftarFoto.forEach((src, idx) => _buatKanvasAnotasi(src, idx));
            if (daftarFoto.length === 0) {
                document.getElementById('anotasi-daftar-kanvas').innerHTML = '<p class="text-xs text-slate-400 italic">Tugas ini tidak berupa foto (teks/dokumen), jadi tidak bisa ditandai -- alasan tetap bisa diisi.</p>';
            }

            const btnKirim = document.getElementById('anotasi-btn-kirim');
            const inputAlasan = document.getElementById('anotasi-input-alasan');
            const perbaruiTombol = () => {
                btnKirim.disabled = !inputAlasan.value.trim();
                btnKirim.classList.toggle('opacity-50', btnKirim.disabled);
                btnKirim.classList.toggle('cursor-not-allowed', btnKirim.disabled);
            };
            inputAlasan.oninput = perbaruiTombol;
            perbaruiTombol();

            document.getElementById('modal-anotasi-revisi').classList.remove('hidden');
            setTimeout(() => {
                const swatchPertama = document.querySelector('.anotasi-swatch');
                if (swatchPertama) swatchPertama.classList.add('ring-4', 'ring-offset-1', 'ring-slate-400');
            }, 50);
        }

        async function _kirimRevisiDenganAnotasi() {
            const idSiswa = _antrianAnotasiRevisi.idSiswa;
            if (!idSiswa || !taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;
            const murid = sampleMurid30.find(m => m.id === idSiswa);
            if (!murid) return;

            const alasan = document.getElementById('anotasi-input-alasan').value.trim();
            if (!alasan) return;
            const tglVal = document.getElementById('anotasi-input-tanggal').value;
            const jamVal = document.getElementById('anotasi-input-jam').value || '23:59';
            let batasRevisi = null;
            if (tglVal) {
                const ts = new Date(`${tglVal}T${jamVal}:00`).getTime();
                if (!isNaN(ts)) batasRevisi = { timestamp: ts, formatted: `${tglVal} Pukul ${jamVal} WIB` };
            }

            // Gabungkan foto asli + coretan jadi 1 gambar per kanvas (sudah
            // otomatis "satu" sejak awal krn coretannya digambar langsung di
            // kanvas yg sama dgn fotonya), urutan SAMA dgn status.fotoTugasList.
            // FITUR TAMBAHAN: diekspor sebagai JPEG kualitas 0.82 (bukan PNG)
            // supaya ukuran file jauh lebih kecil -- PNG lossless jauh lebih
            // berat untuk foto (bukan ilustrasi/teks), padahal kanvas ini
            // sudah dibatasi resolusinya (lihat MAKS_DIMENSI_KANVAS_ANOTASI),
            // jadi kombinasi keduanya bikin upload jauh lebih ringan & cepat
            // di semua device, terutama koneksi HP yang lambat.
            const fotoAnotasi = _antrianAnotasiRevisi.kanvasList
                .filter(Boolean)
                .map(k => k.canvas.toDataURL('image/jpeg', 0.82));

            const btnKirim = document.getElementById('anotasi-btn-kirim');
            if (btnKirim) { btnKirim.disabled = true; btnKirim.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengirim...'; }

            try {
                const res = await fetch('/api/tugas/keputusan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task_id: taskId,
                        username: murid.username,
                        keputusan: 'revisi',
                        alasan,
                        batas_revisi: batasRevisi ? batasRevisi.timestamp : null,
                        batas_revisi_formatted: batasRevisi ? batasRevisi.formatted : null,
                        foto_anotasi: fotoAnotasi
                    })
                });
                const json = await res.json();
                if (!json.success) {
                    alert(json.message || 'Gagal menyimpan keputusan ke server.');
                    if (btnKirim) { btnKirim.disabled = false; btnKirim.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i>Kirim ke Siswa'; }
                    return;
                }
            } catch (e) {
                console.error('Gagal mengirim revisi beranotasi ke server:', e);
                alert('Gagal mengirim. Cek koneksi lalu coba lagi.');
                if (btnKirim) { btnKirim.disabled = false; btnKirim.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i>Kirim ke Siswa'; }
                return;
            }

            if (window._cacheSubmisiTugas) delete window._cacheSubmisiTugas[taskId];
            tutupModalAnotasiRevisi();
            tampilkanToastSuksesKirimTugas('Revisi Dikirim', `Catatan revisi (beserta tanda di foto) untuk ${murid.nama} sudah dikirim.`);
            tutupPreviewStatusSiswa();
            if (taskAktifDipilihUntukRekap && taskAktifDipilihUntukRekap.taskId === taskId && taskAktifDipilihUntukRekap.namaKelas === namaKelas) {
                bukaRekapPengumpulanTugas(namaKelas, taskId, true);
            }
        }

        // FITUR TAMBAHAN: guru MENARIK KEMBALI keputusan 'ditolak'/'revisi'
        // yang sudah diambil sebelumnya -- mis. salah pencet, atau ternyata
        // tugas murid itu sudah benar. Beda dengan mintaKeputusanTugasDariRekap(),
        // aksi ini TIDAK butuh alasan (cuma konfirmasi ya/tidak) -- dikirim ke
        // POST /api/tugas/keputusan dengan keputusan:'batal', yang di server
        // (app.py) mereset keputusan/alasanKeputusan/waktuKeputusan/batas_revisi
        // jadi null, TANPA menyentuh foto/nilai/catatan pengumpulan siswa sama
        // sekali -- statusnya otomatis balik ke "Terkumpul" biasa.
        async function batalkanKeputusanTugasDariRekap(idSiswa) {
            if (!taskAktifDipilihUntukRekap) return;
            const { namaKelas, taskId } = taskAktifDipilihUntukRekap;
            const murid = sampleMurid30.find(m => m.id === idSiswa);
            if (!murid) return;

            bukaModalKonfirmasiGenerik({
                judul: 'Batalkan Keputusan',
                pesan: `Tugas ${murid.nama} akan dikembalikan ke status "Terkumpul" biasa -- keputusan Tolak/Perlu Revisi sebelumnya dibatalkan. Foto & nilai yang sudah ada TIDAK ikut berubah.`,
                teksTombol: 'Ya, Batalkan',
                ikon: 'fa-rotate-left',
                warnaTombol: 'amber',
                onKonfirmasi: async function () {
                    try {
                        const res = await fetch('/api/tugas/keputusan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                task_id: taskId,
                                username: murid.username,
                                keputusan: 'batal'
                            })
                        });
                        const json = await res.json();
                        if (!json.success) {
                            alert(json.message || 'Gagal membatalkan keputusan di server.');
                            return;
                        }
                    } catch (e) {
                        console.error('Gagal membatalkan keputusan tugas ke server:', e);
                        alert('Gagal membatalkan keputusan. Cek koneksi lalu coba lagi.');
                        return;
                    }
                    if (window._cacheSubmisiTugas) delete window._cacheSubmisiTugas[taskId];
                    tampilkanToastSuksesKirimTugas('Keputusan Dibatalkan', `${murid.nama} sudah dikembalikan ke status Terkumpul.`);
                    tutupPreviewStatusSiswa();
                    if (taskAktifDipilihUntukRekap && taskAktifDipilihUntukRekap.taskId === taskId && taskAktifDipilihUntukRekap.namaKelas === namaKelas) {
                        bukaRekapPengumpulanTugas(namaKelas, taskId, true);
                    }
                }
            });
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
        // memang tersambung ke Dashboard Siswa lewat akun login sungguhan) selalu ditarik
        // ulang dari tugas yang sungguhan tersimpan, bukan dari data dummy awal. Diambil
        // tugas TERBARU yang sudah dikumpulkan, dicari lintas semua kelas.
        //
        // PERBAIKAN: versi sebelumnya baca t.studentSubmitted/t.isViewedByStudent dari
        // getTasksKelas() (tasks_<KELAS>) -- field itu TIDAK PERNAH benar-benar diisi
        // data asli (kirimTugasSiswa() menyimpan pengumpulan lewat /api/tugas/submit,
        // BUKAN ke tasks_<KELAS>), jadi status di sini selalu basi. Sekarang dibaca dari
        // window._cacheSubmisiTugas -- cache ASLI dari server (/api/tugas/submissions/<id>,
        // lihat ambilSubmisiTugasServer() & hitungDanTampilkanPerluDinilai() yang
        // menghangatkannya tiap load halaman + tiap 30 detik, dan sekarang juga tiap kali
        // tab "Nilai" dibuka -- lihat switchTab()) -- skema SAMA yang sudah dipakai benar
        // di "Rekap Pengumpulan per Tugas"/"Perlu Dinilai", termasuk field 'dilihat' baru
        // (lihat /api/tugas/dibaca di app.py) untuk status "Sedang Dikerjakan".
        function sinkronkanSubmissionAsliSiswaID1() {
            const m = sampleMurid30.find(s => s.id === 1);
            if (!m) return;

            let ketemu = false;
            let waktuKirimTerbaru = null;
            let nilaiTerbaru = null;
            let fotoTerbaru = [];
            let penandaTerbaru = -Infinity;
            // Kalau ada minimal 1 tugas aktif yang sudah DIBUKA siswa ('dilihat')
            // tapi belum dikirim, berarti tugas itu berstatus "Sedang Dikerjakan" --
            // dipakai renderPenilaianTugas()/bukaIDCardSiswa() untuk status 3-tahap.
            let adaYangSedangDikerjakan = false;

            daftarSeluruhKelasDummy.forEach(k => {
                const tasks = getTasksKelas(k.nama);
                tasks.forEach(t => {
                    const submisiEntri = (window._cacheSubmisiTugas[t.id] || {})[m.username];
                    const sudahDibuka = !!(submisiEntri && submisiEntri.dilihat);
                    const sudahKirim = !!(submisiEntri && submisiEntri.submitted);
                    if (sudahDibuka && !sudahKirim) adaYangSedangDikerjakan = true;
                    if (!sudahKirim) return;
                    const penanda = t.waktuKirimGuru || 0;
                    if (penanda >= penandaTerbaru) {
                        penandaTerbaru = penanda;
                        ketemu = true;
                        waktuKirimTerbaru = submisiEntri.waktu || null;
                        nilaiTerbaru = submisiEntri.nilai || null;
                        fotoTerbaru = Array.isArray(submisiEntri.images) ? submisiEntri.images : [];
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
            const _html = [];
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

                _html.push(`
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
                `);
            });
            tbody.innerHTML = _html.join('');
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
            const _html = [];

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

                _html.push(`
                    <div class="p-3.5 rounded-xl border ${cardStyle} transition-all space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-mono font-bold ${badgeStyle} px-2.5 py-1 rounded-lg">${item.jam}</span>
                            ${statusLabel}
                        </div>
                        <h4 class="font-bold text-slate-900 text-sm">${item.kelas}</h4>
                        <p class="text-[11px] text-slate-500">${item.mapel}</p>
                    </div>
                `);
            });
            container.innerHTML = _html.join('');
        }

        let kelasAktifDipilih = '';
        function bukaDetailKelas(namaKelas, jurusan, mapel, badgeJurusan, imgUrl, _dariSinkron) {
            kelasAktifDipilih = namaKelas;
            // Sinkron ulang border/foto/title dari server tiap kali Denah Kelas yang
            // sudah tersambung ke murid asli (lihat KELAS_SISWA_ASLI) dibuka (bukan
            // cuma sekali pas awal load halaman) -- supaya kalau ada murid yang baru
            // saja ganti border/foto sebelum guru buka jendela ini, datanya ikut
            // fresh. Cuma fetch ringan (jumlah siswa per kelas masih kecil), bukan
            // polling terus-menerus, jadi tetap murah/tidak bikin berat.
            // FIX LOOP: sinkronBorderRosterDariServer() memanggil bukaanganUlangDetailKelas() -> bukaDetailKelas() lagi.
            // Tanpa penanda _dariSinkron ini keduanya saling memanggil tanpa henti (ratusan request
            // /api/kelas/roster -> 429 TOO MANY REQUESTS, dan kartu di-render ulang terus sehingga
            // efek terangkat/terpilih hilang). Pola sama dengan bukaRekapPengumpulanTugas().
            if (!_dariSinkron && NAMA_KELAS_DENGAN_MURID_ASLI.includes(namaKelas)) sinkronBorderRosterDariServer();
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

            // PERBAIKAN PRIVASI: dari sini ke bawah dipakai buat isi FOTO/NILAI
            // yang muncul di modal periksaSiswa() -- itu data pengumpulan tugas
            // milik siswa, bukan sekadar "info siapa ngasih tugas apa" kayak
            // list-tugas-aktif-kelas di atas. Sebelumnya dihitung dari
            // `tugasRelevan` (SEMUA guru), jadi guru A yang buka Denah Kelas
            // & klik seorang siswa bisa ikut lihat foto tugas yang sebenarnya
            // dikirim untuk tugas BUATAN GURU B -- padahal kartu ringkas &
            // tombol edit/hapus tugas guru lain sudah sengaja disembunyikan di
            // tempat lain (lihat komentar tugasIniMilikGuruLogin()). Sekarang
            // disaring dulu supaya foto/nilai yang tampil di modal periksa
            // cuma bisa berasal dari tugas yang MEMANG dibuat guru yang sedang
            // login -- tugas dari guru lain tetap kebaca di ringkasan info
            // (read-only, tanpa foto) tapi tidak lagi bisa dibuka fotonya lewat
            // jalur ini.
            const tugasRelevanMilikSaya = tugasRelevan.filter(t => tugasIniMilikGuruLogin(t));

            if (hasActiveTask) {
                deadlineText = tugasRelevan.length > 1
                    ? `${tugasRelevan.length} tugas aktif`
                    : (tugasRelevan[0].deadline || "Belum Ditentukan");
            }

            if (tugasRelevanMilikSaya.length > 0) {
                // Deadline buat cek keterlambatan cuma diambil dari tugas MILIK
                // GURU INI yang belum dikumpulkan (yang sudah dikumpulkan tidak
                // relevan buat penentuan "masih dikerjakan/sudah expired") --
                // dan karena tugasRelevanMilikSaya di atas sudah menyaring tugas
                // expired-tak-dikumpulkan, deadline di sini dipastikan selalu
                // masih berlaku (belum lewat).
                const belum = tugasRelevanMilikSaya.filter(t => !t.studentSubmitted);
                const timestampsBelum = belum.map(t => t.deadlineTimestamp).filter(Boolean);
                if (timestampsBelum.length) deadlineTimestamp = Math.min(...timestampsBelum);

                statusSiswa1 = belum.length === 0;
                const sudahList = tugasRelevanMilikSaya.filter(t => t.studentSubmitted);
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
                    const geserSebelumnya = containerTugasAktif.scrollLeft; // jangan loncat ke awal saat render ulang
                    containerTugasAktif.innerHTML = tugasRelevan.map(t => {
                        const namaGuruTugas = t.namaGuru || 'Guru Mata Pelajaran';
                        const sudahLewat = t.deadlineTimestamp && cekMasihExpiredSaatIni >= t.deadlineTimestamp && !t.studentSubmitted;
                        return `
                            <div class="bg-white border border-slate-200 rounded-xl p-3" data-tugas-id="${t.id}">
                                <p class="text-[10px] font-extrabold text-blue-600 uppercase tracking-wide"><i class="fa-solid fa-chalkboard-user mr-1"></i>${namaGuruTugas}</p>
                                <p class="text-sm font-bold text-slate-900 mt-1 truncate" title="${t.judul || ''}">${t.judul || '(tanpa judul)'}</p>
                                <p class="text-[11px] text-slate-500 mt-0.5">${t.tipe || 'Tugas'}</p>
                                <p class="text-[11px] font-mono mt-1.5 ${sudahLewat ? 'text-rose-600 font-bold' : 'text-amber-600 font-bold'}">
                                    <i class="fa-regular fa-clock mr-1"></i>${t.deadline || 'Belum Ditentukan'}
                                </p>
                            </div>
                        `;
                    }).join('');
                    containerTugasAktif.scrollLeft = geserSebelumnya;
                }
                if (typeof perbaruiFadeTugasAktifGuru === 'function') perbaruiFadeTugasAktifGuru();
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
                            <span class="text-[10px] font-mono font-bold text-slate-500 truncate">Siswa</span>
                            ${badgeStatusBangku}
                        </div>
                        <div class="flex items-center gap-2">
                            ${avatarWrapperHTML(m, 'w-8 h-8')}
                            <div class="overflow-hidden">
                                <h5 class="text-xs font-bold truncate">${namaEfekHTML(m)}</h5>
                                <div class="mt-0.5 flex items-center gap-1 flex-wrap">
                                    ${m.borderTersinkron ? `${titleBadgeHTML(m)}` : ''}
                                </div>
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
                if (!tampilanDefaultGuruAktif() && m.title === 'DEV') lencanaEkstra.push(`<span class="tsm-badge-dev badge-dev"><i class="fa-solid fa-crown"></i> DEV</span>`);
                if (!tampilanDefaultGuruAktif() && m.efek === 'gold-name') lencanaEkstra.push(`<span class="tsm-badge-efek"><i class="fa-solid fa-wand-magic-sparkles"></i> Emas</span>`);

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
            bukaModalAnimasiGuru(document.getElementById('modal-detail-kelas'));
        }

        function tutupDetailKelas() {
            tutupModalAnimasiGuru(document.getElementById('modal-detail-kelas'));
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
            const { data: hasilPeriksaBulk } = await ambilHasilPeriksaBulkServer(taskId, [murid.id]);
            const status = statusPengumpulanUntukTugas(murid, task, kedaluwarsa, hasilPeriksaBulk);
            if (!status.submitted) {
                alert(`⚠️ INFO: ${murid.nama} belum/tidak mengumpulkan tugas ini.`);
                return;
            }

            periksaModeAktif = 'rekap';
            rekapAktifDiPeriksa = { namaKelas, taskId, idSiswa };

            // Mode 'rekap' = pemilik tugas ini sendiri yang buka (sudah lewat
            // bukaRekapPengumpulanTugas yang cuma nampilin tugas milik guru
            // login) -- jadi foto & form nilai lengkap boleh ditampilkan di sini.
            document.getElementById('periksa-status-saja').classList.add('hidden');
            document.getElementById('periksa-area-penilaian').classList.remove('hidden');
            document.getElementById('btn-simpan-nilai').classList.remove('hidden');
            document.getElementById('btn-buka-rekap-dari-status').classList.add('hidden');

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
                            ${daftarFoto.map(src => `<img src="${src}" onclick="bukaFotoPreviewBesar(this.src, this.alt)" class="w-full h-24 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-all" alt="Tugas Siswa" loading="lazy" decoding="async">`).join('')}
                        </div>
                    </div>`;
            } else {
                previewContainer.innerHTML = `<span class="text-xs text-slate-400 italic">File dikirim dalam bentuk teks/dokumen digital.</span>`;
            }
            document.getElementById('modal-periksa').classList.remove('hidden');
        }

        async function periksaSiswa(idSiswa) {
            periksaModeAktif = 'detail';
            rekapAktifDiPeriksa = null;
            const siswa = sampleMurid30.find(s => s.id === idSiswa);
            if (!siswa) return;

            // PERBAIKAN PRIVASI (PENTING): mode 'detail' ini dibuka dari Denah
            // Kelas / live roster -- tempat yang LINTAS GURU (siapa pun yang
            // login sebagai guru bisa buka kelas ini & lihat kartunya). Dulu di
            // sini foto tugas siswa (siswa.fotoTugasList, diisi ulang oleh
            // sinkronkanSubmissionAsliSiswaID1() TANPA peduli tugas itu punya
            // guru mana) ikut ditampilkan & bahkan bisa dinilai langsung --
            // artinya foto & nilai tugas guru B bisa kebuka/keubah oleh guru A
            // cuma lewat Denah Kelas. Sekarang mode 'detail' SENGAJA cuma
            // menampilkan STATUS (belum dikerjakan/sedang dikerjakan/sudah
            // selesai/terlambat/perlu revisi) + info tugas siapa & dari guru
            // siapa -- itu metadata yang memang wajar dilihat semua guru buat
            // pemantauan kelas. Foto & form nilai HANYA muncul di mode 'rekap'
            // (bukaPeriksaTugasDariRekap, dibuka dari "Rekap Semua Tugas" milik
            // guru yang bersangkutan sendiri, dan sudah dijaga juga di server
            // lewat _tolak_jika_bukan_pemilik_tugas di app.py).
            document.getElementById('periksa-nama-siswa').innerText = `${siswa.nama} (Meja #${siswa.meja})`;

            // Status di sini dihitung LANGSUNG per murid ini dari data submisi
            // ASLI (lihat infoStatusTugasAktifSiswa) -- termasuk otomatis pindah
            // ke tugas lain begitu tugas yang sedang berlaku lewat deadline
            // tanpa dikumpulkan, dan memprioritaskan tugas ber-deadline paling
            // mendesak kalau ada lebih dari 1 tugas aktif sekaligus.
            const info = await infoStatusTugasAktifSiswa(kelasAktifDipilih, siswa);

            // Kalau guru sudah pindah kartu/tutup modal SEBELUM fetch di atas
            // selesai, jangan timpa tampilan yang sudah tidak relevan lagi.
            if (periksaModeAktif !== 'detail' || document.getElementById('periksa-nama-siswa').innerText.indexOf(siswa.nama) !== 0) return;

            const PETA_STATUS_TEKS = {
                revisi: 'Perlu Revisi',
                terlambat: 'Terlambat',
                sedang: 'Sedang Mengerjakan',
                belum_dikerjakan: 'Belum Dikerjakan',
                belum_ada_tugas: 'Belum Ada Tugas'
            };
            const statusTeks = PETA_STATUS_TEKS[info.statusKode] || 'Belum Ada Tugas';

            let infoTugasTeks;
            if (info.statusKode === 'revisi') {
                infoTugasTeks = `Tugas <b>"${info.judul || '(tanpa judul)'}"</b> dari <b>${info.namaGuru || 'Guru Mata Pelajaran'}</b> perlu dikerjakan ulang.`;
            } else if (info.statusKode === 'terlambat') {
                infoTugasTeks = `Tugas <b>"${info.judul || '(tanpa judul)'}"</b> dari <b>${info.namaGuru || 'Guru Mata Pelajaran'}</b> sudah lewat batas waktu &amp; belum dikumpulkan.`;
            } else if (info.hasActiveTask) {
                infoTugasTeks = `Tugas <b>"${info.judul || '(tanpa judul)'}"</b> dari <b>${info.namaGuru || 'Guru Mata Pelajaran'}</b>.`;
            } else {
                infoTugasTeks = 'Belum ada tugas aktif dari guru manapun di kelas ini.';
            }

            document.getElementById('periksa-status-saja-isi').innerHTML = `
                <p class="font-extrabold text-slate-800 text-sm mb-1">${statusTeks}</p>
                <p>${infoTugasTeks}</p>
            `;
            document.getElementById('periksa-status-saja').classList.remove('hidden');
            document.getElementById('periksa-area-penilaian').classList.add('hidden');
            document.getElementById('btn-simpan-nilai').classList.add('hidden');

            // Tombol "Buka di Rekap Tugas" cuma muncul kalau tugas aktifnya
            // memang buatan guru yang sedang login -- guru lain cukup lihat
            // status di sini, tidak diarahkan ke rekap yang bukan miliknya.
            const btnBukaRekap = document.getElementById('btn-buka-rekap-dari-status');
            if (info.hasActiveTask && tugasIniMilikGuruLogin({ namaGuru: info.namaGuru })) {
                btnBukaRekap.classList.remove('hidden');
                btnBukaRekap.dataset.namaKelas = kelasAktifDipilih;
            } else {
                btnBukaRekap.classList.add('hidden');
            }

            document.getElementById('modal-periksa').classList.remove('hidden');
        }

        // Jembatan dari modal status (Denah Kelas) ke "Rekap Semua Tugas" --
        // guru pindah ke rekap tugasnya sendiri buat benar-benar lihat foto &
        // kasih nilai, bukan dari sini.
        function bukaRekapDariModalStatus() {
            const namaKelas = document.getElementById('btn-buka-rekap-dari-status').dataset.namaKelas;
            tutupPeriksaSiswa();
            tutupDetailKelas();
            const tasksKelasIni = getTasksKelas(namaKelas).filter(t => tugasIniMilikGuruLogin(t));
            if (tasksKelasIni.length > 0) {
                switchTab('rekap-tugas');
                bukaRekapPengumpulanTugas(namaKelas, tasksKelasIni[tasksKelasIni.length - 1].id);
            }
        }

        function tutupPeriksaSiswa() {
            document.getElementById('modal-periksa').classList.add('hidden');
            periksaModeAktif = 'detail';
            rekapAktifDiPeriksa = null;
        }

        function simpanNilaiSiswa() {
            // PERBAIKAN PRIVASI: mode 'detail' (dibuka dari Denah Kelas) SUDAH
            // TIDAK punya form nilai lagi di HTML (lihat periksaSiswa()), tapi
            // guard ini tetap dipasang sebagai jaga-jaga kedua supaya fungsi
            // ini TIDAK PERNAH bisa dipanggil dari luar mode 'rekap' -- satu-
            // satunya jalur sah menyimpan nilai adalah lewat Rekap Semua Tugas
            // milik guru yang bersangkutan sendiri.
            if (periksaModeAktif !== 'rekap' || !rekapAktifDiPeriksa) {
                alert('Untuk memberi nilai, buka tugasnya lewat tab "Rekap Semua Tugas".');
                return;
            }

            const nilaiVal = document.getElementById('input-nilai-angka').value;
            const catatanVal = document.getElementById('input-catatan-guru').value.trim();
            if (!nilaiVal) {
                alert("Harap masukkan nilai angka untuk siswa ini.");
                return;
            }

            // Nilai & pesan disimpan scoped ke (tugas, siswa) yang sedang dibuka
            // dari "Rekap Pengumpulan per Tugas", lalu grid-nya di-refresh
            // supaya "Kumpul: ..." langsung berubah jadi "Nilai: ...".
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
        }

        function bukaanganUlangDetailKelas() {
            const k = daftarSeluruhKelasDummy.find(item => item.nama === kelasAktifDipilih);
            if (k) {
                bukaDetailKelas(k.nama, k.jurusan, k.mapel, k.jurusan, k.img, true); // true = render ulang saja, jangan sinkron lagi
            }
        }

        // ============ HELPER RENDER: Avatar / Nama Efek / Title Badge ============
        // Untuk siswa "border_emas" (AHMAD FAKHRI AL FARISI), pakai markup & class PERSIS
        // sama seperti di dashboard_siswa.html (.profile-wrapper/.user-avatar/.user-border/.gold-name/.badge-dev)
        // supaya border & efek namanya benar-benar identik, bukan tiruan warna saja.
        // Untuk 29 siswa dummy lainnya, dipakai style umum karena mereka data simulasi.
        function avatarWrapperHTML(m, sizeClass) {
            if (tampilanDefaultGuruAktif()) m = Object.assign({}, m, { border: 'Border Polos', borderId: 'starter_pemula' });
            if (m.border === 'border_emas' && !(m.borderId && PETA_FILE_BORDER_GURU[m.borderId])) {
                return `
                    <div class="border-emas-avatar ${sizeClass}">
                        <img src="${m.foto}" alt="Foto ${m.nama}" loading="lazy" decoding="async">
                    </div>`;
            }
            // Siswa yang borderId-nya sudah tersinkron dari server: foto di bawah,
            // gambar bingkai yang SEDANG DIPAKAI siswa itu menimpa di atas
            // (class .guru-frame-dev sudah ada di dashboard_guru.html).
            if (m.borderId && PETA_FILE_BORDER_GURU[m.borderId]) {
                const px = ukuranPxDariKelasTailwind(sizeClass);
                const srcBingkai = PETA_FILE_BORDER_GURU[m.borderId];
                const sudahTahu = (srcBingkai in CACHE_GEOMETRI_BINGKAI_GURU);
                const gaya = styleGeometriBingkaiGuru(CACHE_GEOMETRI_BINGKAI_GURU[srcBingkai]) + (sudahTahu ? '' : 'visibility:hidden;');
                return `
                    <div class="guru-frame-dev flex-shrink-0" style="--ukuran:${px}px">
                        <img class="guru-frame-dev-foto" src="${m.foto}" alt="Foto ${m.nama}" decoding="async" style="${gaya}">
                        <img class="guru-frame-dev-bingkai" src="${PETA_FILE_BORDER_GURU[m.borderId]}" alt="" aria-hidden="true" decoding="async" onload="terapkanGeometriBingkaiGuru(this)" onerror="bingkaiGagalGuru(this)">
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
            if (tampilanDefaultGuruAktif()) return `<span>${m.nama}</span>`;
            if (m.efek === 'gold-name') {
                return `<span class="gold-name-text">${m.nama}</span>`;
            }
            if (m.efekClass) {
                return `<span class="${m.efekClass}">${m.nama}</span>`;
            }
            return `<span>${m.nama}</span>`;
        }

        function titleBadgeHTML(m) {
            if (tampilanDefaultGuruAktif()) return '';
            if (m.title === 'DEV') {
                return `<span class="badge-dev px-2 py-0.5 text-[10px] font-bold bg-amber-400 text-slate-900 rounded-md shadow-sm"><i class="fa-solid fa-crown text-[8px] mr-0.5"></i> DEV</span>`;
            }
            if (m.titleClass) {
                return `<span class="${m.titleClass}">${m.title}</span>`;
            }
            return `<span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-extrabold border border-amber-200">${m.title}</span>`;
        }

        function labelBorder(m) {
            return m.border === 'border_emas' ? 'Border Emas' : m.border;
        }
        function labelEfek(m) {
            if (tampilanDefaultGuruAktif()) return '';
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

        // Kabari Lily soal tahap alur ganti foto (dibaca lily_brain.js lewat event 'lily:photo').
        // Dibungkus try/catch: Lily gagal/tidak ada tidak boleh mengganggu alur foto.
        function lilyFotoTahap(stage, text) {
            try { document.dispatchEvent(new CustomEvent('lily:photo', { detail: text ? { stage: stage, text: text } : { stage: stage } })); } catch (e) { console.warn('[LILY PHOTO] dispatch gagal', e); }
        }

        function updateProfilePhotoGuru(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (!/^image\//.test(file.type)) {
                event.target.value = '';
                lilyFotoTahap('error', 'Itu bukan file gambar. Coba pilih foto JPG atau PNG.');
                alert('File yang dipilih bukan gambar. Pilih foto JPG atau PNG.');
                return;
            }
            lilyFotoTahap('selected');
            const reader = new FileReader();
            reader.onerror = function() {
                lilyFotoTahap('error', 'Fotonya gagal dibaca. Coba pilih foto lain.');
                alert('Foto gagal dibaca. Coba pilih foto lain.');
            };
            reader.onload = function(e) {
                const img = document.getElementById('atur-foto-img');
                img.onerror = function() {
                    lilyFotoTahap('error', 'Fotonya tidak bisa dibuka. Coba pilih foto lain.');
                    alert('Foto tidak bisa dibuka. Coba pilih foto lain.');
                };
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
                    lilyFotoTahap('preview');
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


        function batalAturFotoGuru() {
            document.getElementById('modal-atur-foto-guru').classList.add('hidden');
            lilyFotoTahap('cancel');
        }

        function simpanFotoAturGuru() {
            lilyFotoTahap('saving');
            try {
                _simpanFotoAturGuruInti();
            } catch (err) {
                console.error('Gagal menyimpan foto profil guru:', err);
                const penuh = err && (err.name === 'QuotaExceededError' || err.code === 22);
                const pesan = penuh ? 'Penyimpanan browser penuh, fotonya belum bisa disimpan.' : 'Foto gagal disimpan. Coba lagi.';
                lilyFotoTahap('error', pesan);
                alert(pesan);
            }
        }

        function _simpanFotoAturGuruInti() {
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
            const fotoLama = localStorage.getItem('guru_profile_photo'); // dibandingkan agar Lily notice foto baru
            localStorage.setItem('guru_profile_photo', base64Image);

            const headerAvatar = document.getElementById('header-user-avatar-guru');
            const headerAvatarMobile = document.getElementById('header-user-avatar-guru-mobile');
            const dropdownAvatar = document.getElementById('dropdown-user-avatar-guru');
            if (headerAvatar) headerAvatar.src = base64Image;
            if (headerAvatarMobile) headerAvatarMobile.src = base64Image;
            if (dropdownAvatar) dropdownAvatar.src = base64Image;

            document.getElementById('modal-atur-foto-guru').classList.add('hidden');
            alert('Foto profil berhasil diperbarui!');
            // Kabari Lily (didengar di init Lily, dashboard_guru.html). Dikirim SETELAH alert agar animasi tidak terlewat.
            if (fotoLama !== base64Image) {
                try { document.dispatchEvent(new CustomEvent('guru-foto-diganti', { detail: { lama: fotoLama, baru: base64Image } })); } catch (e) {}
            } else {
                // Foto hasil simpan identik dgn yang lama -> 'guru-foto-diganti' tidak dikirim, jadi tanpa ini
                // alur Lily macet di tahap 'saving'. Tutup alurnya dengan 'success'.
                lilyFotoTahap('success');
            }
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
            // Penanganan key 'evaluasi_guru' di sini SENGAJA sudah dihapus --
            // datanya sekarang di server (bukan localStorage lagi), jadi event
            // 'storage' (yang cuma nyala antar-tab di BROWSER YANG SAMA) tidak
            // relevan lagi. Update badge & daftar "Saran & Evaluasi" sekarang
            // lewat polling berkala (lihat updateBadgeEvaluasiGuru() &
            // setInterval-nya di DOMContentLoaded di bawah) -- supaya tetap
            // ter-update walau siswa mengirim dari PERANGKAT LAIN.
        });

        // ============================================================
        // TAB "Saran & Evaluasi": daftar rating + pesan anonim yang dikirim
        // siswa lewat modal "Beri Saran" di Dashboard Siswa. Tidak ada field
        // identitas siswa apapun di datanya kecuali siswa sendiri memilih
        // menampilkan nama -- memang sengaja tidak pernah dipaksa terkirim.
        //
        // SEBELUMNYA data ini cuma localStorage key 'evaluasi_guru' -- badge
        // jumlahnya juga cuma "total yang PERNAH masuk" (tidak ada konsep
        // "belum dibaca" sama sekali), dan tidak pernah otomatis nambah
        // sendiri kalau siswa mengirim dari perangkat lain.
        // Sekarang ditarik dari server (/api/evaluasi/list, sumber:
        // evaluasi_store.json di app.py, field 'dibaca' per entri) supaya:
        //   1) Badge di sini menghitung yang BELUM DIBACA saja (bukan total)
        //      -- sama seperti diminta: "kalau dibaca, angkanya hilang".
        //   2) Angkanya otomatis naik sendiri tanpa reload begitu ada siswa
        //      lain (dari perangkat manapun) yang baru saja mengirim --
        //      lewat polling ringan tiap 30 detik, pola SAMA PERSIS dengan
        //      hitungDanTampilkanPerluDinilai() ("Tugas Belum Dinilai").
        // ============================================================
        let _cacheEvaluasiGuru = [];

        async function ambilSemuaEvaluasiGuru() {
            try {
                const res = await fetch('/api/evaluasi/list');
                const hasil = await res.json();
                if (hasil && hasil.success && Array.isArray(hasil.data)) {
                    _cacheEvaluasiGuru = hasil.data;
                }
            } catch (e) {
                console.warn('Gagal memuat data Saran & Evaluasi:', e);
                // Offline/gagal fetch -> tetap pakai cache lama (kalau ada)
                // daripada tiba-tiba menampilkan badge/daftar kosong.
            }
            return _cacheEvaluasiGuru;
        }

        // Dipanggil berkala (setInterval, lihat DOMContentLoaded di bawah) DAN
        // tiap kali tab "Saran & Evaluasi" dibuka -- makanya cuma menghitung
        // jumlah yang !dibaca, TANPA menandai apapun sebagai dibaca (penandaan
        // "sudah dibaca" hanya terjadi lewat renderEvaluasiGuru(), begitu guru
        // benar-benar MELIHAT daftarnya, lihat komentar di sana).
        async function updateBadgeEvaluasiGuru() {
            const badge = document.getElementById('badge-evaluasi-jumlah');
            if (!badge) return;
            let jumlahBelumDibaca = null;
            try {
                // Endpoint ringan: hanya angka, bukan seluruh daftar evaluasi.
                const res = await fetch('/api/evaluasi/jumlah-belum-dibaca');
                if (res.ok) {
                    const json = await res.json();
                    if (json && json.success) jumlahBelumDibaca = Number(json.jumlah) || 0;
                }
            } catch (e) { /* jatuh ke cadangan di bawah */ }
            if (jumlahBelumDibaca === null) { // cadangan: cara lama
                const semua = await ambilSemuaEvaluasiGuru();
                jumlahBelumDibaca = semua.filter(x => !x.dibaca).length;
            }
            if (jumlahBelumDibaca > 0) {
                badge.textContent = jumlahBelumDibaca > 99 ? '99+' : String(jumlahBelumDibaca);
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

        async function renderEvaluasiGuru() {
            const grid = document.getElementById('grid-evaluasi-guru');
            const emptyState = document.getElementById('evaluasi-kosong-state');
            const selectGuru = document.getElementById('filter-guru-evaluasi');
            const selectIdentitas = document.getElementById('filter-identitas-evaluasi');
            if (!grid) return;

            const semua = await ambilSemuaEvaluasiGuru();

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

            // Guru benar-benar SEDANG MELIHAT tab ini sekarang -- tandai semua
            // evaluasi yang belum dibaca sebagai sudah dibaca di server, lalu
            // update cache lokal + badge supaya nol lagi TANPA perlu fetch
            // ulang (server sudah dipastikan berhasil menandai duluan).
            await tandaiEvaluasiGuruDibaca();
        }

        // Menandai SELURUH evaluasi yang belum dibaca sebagai sudah dibaca --
        // dipanggil dari renderEvaluasiGuru() (bukan dari updateBadgeEvaluasiGuru
        // saat polling biasa) supaya badge cuma nol ketika guru BENERAN membuka
        // & melihat tabnya, bukan cuma karena polling latar belakang jalan.
        async function tandaiEvaluasiGuruDibaca() {
            try {
                const res = await fetch('/api/evaluasi/tandai-dibaca', { method: 'POST' });
                const hasil = await res.json();
                if (hasil && hasil.success) {
                    _cacheEvaluasiGuru.forEach(x => { x.dibaca = true; });
                    const badge = document.getElementById('badge-evaluasi-jumlah');
                    if (badge) badge.classList.add('hidden');
                }
            } catch (e) {
                console.warn('Gagal menandai Saran & Evaluasi sebagai dibaca:', e);
                // Gagal (mis. offline sesaat) -> badge biarkan tampil sebagaimana
                // adanya, coba lagi otomatis di polling/pembukaan tab berikutnya.
            }
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

        /* ================================================================
           NOTIFIKASI PENGINGAT JADWAL MENGAJAR + AUTO-SCROLL & HIGHLIGHT
           ----------------------------------------------------------------
           Memakai data yang SUDAH ada: jadwalMengajar (jadwal), getTasksKelas()
           (status tugas), & identitas guru login (NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA).
           Tidak ada data baru, dan bel/banner lama (cekBelJamMengajarOtomatis)
           TIDAK disentuh.

           Kapan notifikasi muncul untuk sebuah sesi jadwal:
             1. ada guru yang login & sesi ini memang milik guru tsb;
             2. waktu sekarang SUDAH mencapai/melewati jam mulai (sebelum jam
                mulai -> tidak muncul);
             3. guru login BELUM memberi tugas/catatan ke kelas itu hari ini
                (hanya tugas buatannya sendiri yang dihitung, bukan tugas guru lain);
             4. sesi itu belum pernah ditutup/diselesaikan hari ini.
           Selama syarat 1-4 terpenuhi, notifikasi TETAP tampil sebagai pengingat
           (10:00, 10:05, dst) -- tapi hanya SATU kartu notifikasi per sesi, tidak
           dibuat berulang tiap pengecekan.

           Notifikasi hilang & tidak muncul lagi untuk sesi itu hari ini kalau:
             - guru sudah memberi tugas (status 'selesai'),
             - guru menekan tombol tutup / mengklik notifikasinya (status 'ditutup').
           Status disimpan di localStorage per akun guru + per tanggal, jadi
           reload halaman tidak memunculkan notifikasi yang sudah ditutup, dan
           otomatis "reset" besok.

           Saat notifikasi DIKLIK (hanya lewat klik -- tidak ada scroll/pindah
           halaman otomatis): tab/filter yang diperlukan dibuka dulu, lalu halaman
           di-scroll halus ke kartu kelas, dan kartu disorot sementara.
           ================================================================ */
        const NOTIF_JADWAL = {
            // false = kartu "Waktunya mengajar" lama tidak ditampilkan; perannya diganti tahap 3
            // pada sistem PENGINGAT JADWAL MENGAJAR (blok ppj di bawah) supaya tidak muncul ganda.
            AKTIF: false,
            INTERVAL_CEK_MS: 10000,
            DURASI_SOROT_MS: 2700,
            // false = pengingat hanya selama sesi berlangsung (mulai <= sekarang <= selesai),
            // sama seperti bel lama. true = tetap muncul sampai akhir hari kalau tugas belum diberikan.
            TAMPIL_SETELAH_SESI_SELESAI: false
        };

        (function suntikGayaNotifJadwalGuru() {
            if (document.getElementById('gaya-notif-jadwal-guru')) return;
            const st = document.createElement('style');
            st.id = 'gaya-notif-jadwal-guru';
            st.textContent = `
                #notif-jadwal-guru-wadah{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 32px));pointer-events:none}
                .njg-item{pointer-events:auto;display:flex;align-items:stretch;background:#fff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:14px;box-shadow:0 10px 30px -8px rgba(30,64,175,.35),0 2px 6px rgba(15,23,42,.08);animation:njg-masuk .5s cubic-bezier(.22,.8,.3,1) both}
                .njg-item.njg-keluar{animation:njg-keluar .3s ease-in both;pointer-events:none}
                @keyframes njg-masuk{from{opacity:0;transform:translateX(calc(100% + 24px))}to{opacity:1;transform:translateX(0)}}
                @keyframes njg-keluar{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(calc(100% + 24px))}}
                .njg-isi{flex:1;min-width:0;display:flex;align-items:flex-start;gap:12px;padding:12px 8px 12px 14px;background:none;border:0;text-align:left;cursor:pointer;font:inherit;color:inherit;border-radius:12px 0 0 12px}
                .njg-isi:hover{background:rgba(239,246,255,.85)}
                .njg-isi:focus-visible,.njg-tutup:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}
                .njg-ikon{flex:none;width:36px;height:36px;border-radius:999px;background:#dbeafe;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-size:15px}
                .njg-judul{display:block;font-size:13px;font-weight:800;line-height:1.3;color:#0f172a}
                .njg-detail{display:block;margin-top:2px;font-size:11px;line-height:1.4;color:#64748b}
                .njg-aksi{display:block;margin-top:6px;font-size:11px;font-weight:700;color:#2563eb}
                .njg-tutup{flex:none;align-self:flex-start;width:32px;height:32px;margin:6px 6px 0 0;border:0;border-radius:999px;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px}
                .njg-tutup:hover{background:#f1f5f9;color:#475569}
                html.dark .njg-item{background:#1e293b;border-color:#334155;border-left-color:#3b82f6}
                html.dark .njg-isi:hover{background:rgba(51,65,85,.6)}
                html.dark .njg-ikon{background:rgba(59,130,246,.2);color:#93c5fd}
                html.dark .njg-judul{color:#f1f5f9}
                html.dark .njg-detail{color:#94a3b8}
                html.dark .njg-aksi{color:#60a5fa}
                html.dark .njg-tutup:hover{background:#334155;color:#e2e8f0}

                /* Highlight kartu kelas: cincin biru + 3 denyut halo, lalu memudar
                   (kelas dilepas lewat JS sesudah DURASI_SOROT_MS, kartu kembali normal). */
                .njg-kartu-disorot{animation:njg-sorot 2.7s ease-in-out 1}
                @keyframes njg-sorot{
                    0%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 3px rgba(37,99,235,.5),0 12px 28px -10px rgba(37,99,235,.45)}
                    22%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 16px rgba(37,99,235,0),0 12px 28px -10px rgba(37,99,235,.45)}
                    33%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 3px rgba(37,99,235,.5),0 12px 28px -10px rgba(37,99,235,.45)}
                    55%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 16px rgba(37,99,235,0),0 12px 28px -10px rgba(37,99,235,.45)}
                    66%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 3px rgba(37,99,235,.5),0 12px 28px -10px rgba(37,99,235,.45)}
                    88%{box-shadow:0 0 0 3px rgba(37,99,235,1),0 0 0 16px rgba(37,99,235,0),0 12px 28px -10px rgba(37,99,235,.45)}
                    100%{box-shadow:0 0 0 3px rgba(37,99,235,0),0 0 0 16px rgba(37,99,235,0),0 12px 28px -10px rgba(37,99,235,0)}
                }
                @media (prefers-reduced-motion:reduce){
                    .njg-item,.njg-item.njg-keluar{animation:none}
                    .njg-kartu-disorot{animation:none;box-shadow:0 0 0 3px #2563eb,0 12px 28px -10px rgba(37,99,235,.45)}
                }
            `;
            document.head.appendChild(st);
        })();

        // ---------- Status per sesi (ditutup/selesai), disimpan per guru + per tanggal ----------
        function notifJadwalKunciSesi(item) { return `${item.kelas}|${item.jam}`; }
        function notifJadwalPrefixStorage() { return `notif_jadwal_guru_${USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA || 'guru'}_`; }
        function notifJadwalKunciStorage() { return notifJadwalPrefixStorage() + getTanggalHariIniKey(); }

        function notifJadwalBacaStatus() {
            try { return JSON.parse(localStorage.getItem(notifJadwalKunciStorage()) || '{}') || {}; }
            catch (e) { return {}; }
        }
        function notifJadwalTandai(kunciSesi, status) {
            try {
                const s = notifJadwalBacaStatus();
                s[kunciSesi] = status;
                localStorage.setItem(notifJadwalKunciStorage(), JSON.stringify(s));
            } catch (e) { /* storage penuh/diblokir: notifikasi tetap jalan, hanya tidak diingat antar reload */ }
        }
        // Buang catatan hari-hari sebelumnya supaya localStorage tidak menumpuk.
        function notifJadwalBersihkanHariLama() {
            try {
                const prefix = notifJadwalPrefixStorage();
                const hariIni = notifJadwalKunciStorage();
                Object.keys(localStorage).forEach(k => {
                    if (k !== hariIni && k.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(prefix.length))) localStorage.removeItem(k);
                });
            } catch (e) { /* abaikan */ }
        }

        // ---------- Syarat muncul ----------
        function notifJadwalMilikGuruLogin(item) {
            const guruLogin = (NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || '').trim().toLowerCase();
            if (!guruLogin) return false; // tidak ada guru login -> jangan tampilkan apa pun
            // jadwalMengajar saat ini tidak punya field guru (dianggap jadwal guru yang login).
            // Kalau suatu saat tiap item diberi field `guru`, otomatis dicocokkan dengan guru login.
            if (item.guru) return String(item.guru).trim().toLowerCase() === guruLogin;
            return true;
        }

        // Hanya tugas/catatan buatan guru yang login, dikirim HARI INI, ke kelas tsb.
        function notifGuruSudahBeriTugasHariIni(namaKelas) {
            const now = new Date();
            return getTasksKelas(namaKelas).some(t => {
                if (!t.waktuKirimGuru || !tugasIniMilikGuruLogin(t)) return false;
                const d = new Date(t.waktuKirimGuru);
                return d.getFullYear() === now.getFullYear() &&
                       d.getMonth() === now.getMonth() &&
                       d.getDate() === now.getDate();
            });
        }

        function notifJadwalSudahMulai(item) {
            const st = getScheduleStatus(item.start, item.end);
            if (st === 'ONGOING') return true;
            return st === 'FINISHED' && NOTIF_JADWAL.TAMPIL_SETELAH_SESI_SELESAI;
        }

        // ---------- Tampilan notifikasi ----------
        function notifJadwalWadah() {
            let w = document.getElementById('notif-jadwal-guru-wadah');
            if (w) return w;
            w = document.createElement('div');
            w.id = 'notif-jadwal-guru-wadah';
            w.setAttribute('aria-live', 'polite');
            document.body.appendChild(w);
            // Satu listener untuk semua notifikasi (delegation).
            w.addEventListener('click', (e) => {
                const tombol = e.target.closest('[data-njg]');
                const el = tombol && tombol.closest('.njg-item');
                if (!el) return;
                // Diklik/ditutup = sudah ditangani guru: jangan dimunculkan lagi untuk sesi ini.
                notifJadwalTandai(el.dataset.kunci, 'ditutup');
                notifJadwalHapusElemen(el);
                if (tombol.dataset.njg === 'buka') sorotKartuKelasGuru(el.dataset.kelas);
            });
            return w;
        }

        function notifJadwalBuatElemen(item, kunciSesi) {
            const el = document.createElement('div');
            el.className = 'njg-item';
            el.dataset.kunci = kunciSesi;
            el.dataset.kelas = item.kelas;
            el.setAttribute('role', 'status');
            el.innerHTML = `
                <button type="button" class="njg-isi" data-njg="buka" aria-label="Menuju kartu kelas ${escHTMLRekap(item.kelas)}">
                    <span class="njg-ikon"><i class="fa-solid fa-bell"></i></span>
                    <span>
                        <span class="njg-judul">Waktunya mengajar ${escHTMLRekap(item.kelas)}</span>
                        <span class="njg-detail">${escHTMLRekap(item.mapel)} &bull; ${escHTMLRekap(item.jam)}</span>
                        <span class="njg-aksi">Belum ada tugas untuk sesi ini &middot; klik untuk menuju kelas</span>
                    </span>
                </button>
                <button type="button" class="njg-tutup" data-njg="tutup" aria-label="Tutup pengingat"><i class="fa-solid fa-xmark"></i></button>
            `;
            return el;
        }

        function notifJadwalHapusElemen(el) {
            if (!el || el.classList.contains('njg-keluar')) return;
            el.classList.add('njg-keluar');
            setTimeout(() => el.remove(), 320);
        }

        // Dipanggil berkala + sesaat setelah guru mengirim tugas. Murah: hanya membaca
        // cache tugas di memori (tanpa request ke server).
        function perbaruiNotifJadwalGuru() {
            if (!NOTIF_JADWAL.AKTIF) return;
            if (_cacheTugasSemuaKelas === null) return; // data tugas belum siap -> jangan menebak "belum ada tugas"
            if (!(NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || '').trim()) return;

            const status = notifJadwalBacaStatus();
            const perluTampil = new Map();   // kunciSesi -> item
            const sudahDiberiTugas = new Set();

            jadwalMengajar.forEach(item => {
                if (!notifJadwalMilikGuruLogin(item)) return;
                if (!daftarSeluruhKelasDummy.some(k => k.nama === item.kelas)) return;
                const kunci = notifJadwalKunciSesi(item);
                if (status[kunci]) return;                 // sudah ditutup/selesai hari ini
                if (!notifJadwalSudahMulai(item)) return;  // belum mulai (atau sudah lewat) -> tidak ada notifikasi
                if (notifGuruSudahBeriTugasHariIni(item.kelas)) { sudahDiberiTugas.add(kunci); return; }
                perluTampil.set(kunci, item);
            });

            const wadah = notifJadwalWadah();
            const ada = new Set();
            wadah.querySelectorAll('.njg-item:not(.njg-keluar)').forEach(el => {
                const kunci = el.dataset.kunci;
                if (perluTampil.has(kunci)) { ada.add(kunci); return; }
                // Tidak perlu lagi: tugas sudah diberikan (catat selesai) atau sesi sudah usai.
                if (sudahDiberiTugas.has(kunci)) notifJadwalTandai(kunci, 'selesai');
                notifJadwalHapusElemen(el);
            });

            // Hanya buat kartu untuk sesi yang belum punya -> tidak ada notifikasi ganda.
            perluTampil.forEach((item, kunci) => {
                if (ada.has(kunci)) return;
                wadah.appendChild(notifJadwalBuatElemen(item, kunci));
            });
        }

        // ---------- Auto-scroll + highlight ----------
        // Pastikan kartu kelas benar-benar terlihat (buka tab/filter/"Tampilkan Kelas Lainnya"
        // yang diperlukan), lalu kembalikan elemen kartunya. Kartu dicari lewat atribut
        // onclick="bukaDetailKelas('<nama kelas>'..." -- pola yang sama dipakai di tempat lain
        // di file ini -- jadi render kartu yang sudah ada tidak perlu diubah.
        function notifJadwalCariKartu(root, namaKelas) {
            if (!root) return null;
            const awalan = `bukaDetailKelas('${namaKelas}'`;
            return Array.from(root.querySelectorAll('[onclick^="bukaDetailKelas("]'))
                .find(el => (el.getAttribute('onclick') || '').startsWith(awalan)) || null;
        }

        function pastikanKartuKelasTerlihat(namaKelas, opsi) {
            const k = daftarSeluruhKelasDummy.find(x => x.nama === namaKelas);
            if (!k) return null;

            // Guru sedang di "Kelola Kelas": pakai kartu di tab itu (reset filter kalau menyembunyikan kelasnya).
            if (activeTab === 'kelas' && !(opsi && opsi.keBeranda)) {
                const selT = document.getElementById('filter-tingkat');
                const selJ = document.getElementById('filter-jurusan');
                let berubah = false;
                if (selT && selT.value !== 'ALL' && selT.value !== k.tingkat) { selT.value = 'ALL'; berubah = true; }
                if (selJ && selJ.value !== 'ALL' && selJ.value !== k.jurusan) { selJ.value = 'ALL'; berubah = true; }
                if (berubah) renderSeluruhKelas();
                return notifJadwalCariKartu(document.getElementById('grid-seluruh-kelas'), namaKelas);
            }

            // Selain itu: kartu ada di Beranda.
            if (activeTab !== 'beranda') switchTab('beranda');
            if (filterCepatJurusanAktif !== 'ALL' && filterCepatJurusanAktif !== k.jurusan) {
                const selFast = document.getElementById('select-fast-jurusan');
                if (selFast) selFast.value = 'ALL';
                filterBerandaCepatByJurusan('ALL');
            }
            if (filterCepatTingkatAktif !== 'ALL' && filterCepatTingkatAktif !== k.tingkat) {
                filterBerandaCepat('ALL');
            }
            const kartu = notifJadwalCariKartu(document.getElementById(`container-beranda-${k.tingkat}`), namaKelas);
            if (kartu) {
                // Kartu bisa tersembunyi di balik tombol "Tampilkan N Kelas Lainnya".
                const sisa = kartu.closest('.kartu-kelas-sisa-wrapper.kartu-kelas-tersembunyi');
                if (sisa) tampilkanSisaKelasBeranda(sisa.id);
            }
            return kartu;
        }

        let _timerSorotKartuGuru = null, _kartuSedangDisorotGuru = null;
        function sorotKartuKelasGuru(namaKelas, opsi) {   // opsi.keBeranda: paksa pindah ke Beranda (dipakai klik notifikasi pengingat)
            const kartu = pastikanKartuKelasTerlihat(namaKelas, opsi);
            if (!kartu) return;

            const kurangGerak = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            kartu.scrollIntoView({ behavior: kurangGerak ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });

            // Highlight sementara: bersihkan sorotan sebelumnya, mulai ulang animasi, lalu lepas otomatis.
            if (_kartuSedangDisorotGuru) _kartuSedangDisorotGuru.classList.remove('njg-kartu-disorot');
            clearTimeout(_timerSorotKartuGuru);
            kartu.classList.remove('njg-kartu-disorot');
            void kartu.offsetWidth;
            kartu.classList.add('njg-kartu-disorot');
            _kartuSedangDisorotGuru = kartu;
            _timerSorotKartuGuru = setTimeout(() => {
                kartu.classList.remove('njg-kartu-disorot');
                if (_kartuSedangDisorotGuru === kartu) _kartuSedangDisorotGuru = null;
            }, NOTIF_JADWAL.DURASI_SOROT_MS + 60);
        }

        /* ================================================================
           PENGINGAT JADWAL MENGAJAR: 10 MENIT, 5 MENIT, DAN SAAT JAM MULAI
           ----------------------------------------------------------------
           Satu-satunya sistem reminder jadwal. Notifikasi lama "Waktunya mengajar"
           (blok NOTIFIKASI PENGINGAT JADWAL MENGAJAR di atas) dimatikan lewat
           NOTIF_JADWAL.AKTIF = false karena perannya kini dipegang tahap 3 di sini;
           kodenya tetap ada. Bel otomatis (cekBelJamMengajarOtomatis) tidak disentuh.

           Memakai data yang sama: jadwalMengajar, getTasksKelas() lewat
           notifGuruSudahBeriTugasHariIni(), dan guru login. Jam acuan = jam perangkat
           (new Date()), sama dengan getScheduleStatus(), bel & jam header.

           Tahap untuk sesi 10:00-11:30 (selisih dihitung dalam menit bulat):
             1. 09:50:00-09:54:59  "10 menit lagi"
             2. 09:55:00-09:59:59  "5 menit lagi"
             3. 10:00:00 - 11:30   "jam mengajar sudah dimulai" (selama sesi berjalan)
           Tidak ada yang muncul sebelum 09:50 atau setelah sesi berakhir.

           Aturan:
             - hanya guru login yang memang punya sesi itu, per sesi kelas;
             - tahap 1, 2 dan 3 hanya muncul kalau guru login BELUM memberi tugas ke
               kelas itu hari ini; begitu tugas dikirim, semua reminder sesi itu
               berhenti & kartu yang sedang tampil hilang;
             - tiap tahap hanya satu kartu per sesi dan tidak diulang setelah ditutup;
             - klik kartu / "Ke Kelas" = buka tab/filter yang diperlukan, scroll ke
               kartu kelas, sorot sementara; hanya menandai tahap itu sudah dilihat
               (tahap berikutnya tetap muncul selama tugas belum diberikan);
             - "Siapkan Tugas" = buka form beri tugas kelas itu; reminder baru berhenti
               setelah tugas BENAR-BENAR terkirim (menutup form tanpa kirim tidak menghentikan);
             - "Nanti" = tutup kartu tahap itu saja (tahap berikutnya tetap boleh muncul);
             - dibuka di tengah rentang -> langsung muncul (dicek saat halaman dimuat,
               tiap 5 dtk, dan saat tab aktif lagi).
           Tahap 3 (jam sudah mulai): kartu notifikasi diklik -> scroll + highlight kartu
           kelas, lalu di kartu itu muncul panel konfirmasi dua tombol: "Kirim Tugas Jadwal"
           (membuka form beri tugas kelas itu) dan "Saya Masuk Kelas Fisik" (status kartu
           jadi "Guru Berada di Kelas" & reminder sesi itu berhenti). Setelah tugas terkirim
           status kartu jadi "Diisi Tugas". Lihat ppjHTMLStatusKelas() di bawah.
           Status disimpan di localStorage per guru + per tanggal (reset otomatis besok).
           ================================================================ */
        const PENGINGAT_PRA_JADWAL = {
            TAHAP_1_MENIT: 10,
            TAHAP_2_MENIT: 5,
            INTERVAL_CEK_MS: 5000
        };

        (function suntikGayaPengingatPraJadwal() {
            if (document.getElementById('gaya-pengingat-pra-jadwal')) return;
            const st = document.createElement('style');
            st.id = 'gaya-pengingat-pra-jadwal';
            st.textContent = `
                #pengingat-pra-jadwal-wadah{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 32px));pointer-events:none}
                .ppj-item{pointer-events:auto;background:#fff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:16px;padding:12px 14px 12px;box-shadow:0 12px 32px -10px rgba(30,64,175,.38),0 2px 6px rgba(15,23,42,.08);animation:ppj-masuk 1.1s cubic-bezier(.22,.8,.3,1) both}
                .ppj-item.ppj-tahap-2{border-color:#fde68a;border-left-color:#f59e0b;box-shadow:0 12px 32px -10px rgba(217,119,6,.38),0 2px 6px rgba(15,23,42,.08)}
                .ppj-item{cursor:pointer}
                .ppj-item.ppj-tahap-3{border-color:#fecdd3;border-left-color:#e11d48;box-shadow:0 12px 32px -10px rgba(225,29,72,.35),0 2px 6px rgba(15,23,42,.08)}
                .ppj-tahap-3 .ppj-chip{background:#ffe4e6;color:#be123c}
                .ppj-item.ppj-keluar{animation:ppj-keluar .3s ease-in both;pointer-events:none}
                @keyframes ppj-masuk{0%{opacity:0;transform:translateX(-100vw)}12%{opacity:1}100%{opacity:1;transform:translateX(0)}} /* menyapu dari kiri layar ke kanan */
                @keyframes ppj-keluar{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(calc(100% + 24px))}}
                .ppj-kepala{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
                .ppj-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}
                .ppj-tahap-2 .ppj-chip{background:#fef3c7;color:#b45309}
                .ppj-jam{font-size:11px;font-weight:700;color:#64748b}
                .ppj-teks{margin:0;font-size:13px;font-weight:700;line-height:1.45;color:#0f172a}
                .ppj-detail{margin:4px 0 0;font-size:11px;line-height:1.4;color:#64748b}
                .ppj-aksi{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
                .ppj-btn{cursor:pointer;border:0;border-radius:999px;padding:7px 13px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;transition:background .15s,transform .1s}
                .ppj-btn:active{transform:scale(.97)}
                .ppj-btn:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
                .ppj-btn-utama{background:#2563eb;color:#fff}
                .ppj-btn-utama:hover{background:#1d4ed8}
                .ppj-btn-kedua{background:#eff6ff;color:#1d4ed8}
                .ppj-btn-kedua:hover{background:#dbeafe}
                .ppj-btn-nanti{background:transparent;color:#64748b;font-weight:700}
                .ppj-btn-nanti:hover{background:#f1f5f9;color:#334155}
                html.dark .ppj-item{background:#1e293b;border-color:#334155;border-left-color:#3b82f6}
                html.dark .ppj-item.ppj-tahap-2{border-color:#334155;border-left-color:#f59e0b}
                html.dark .ppj-item.ppj-tahap-3{border-color:#334155;border-left-color:#f43f5e}
                html.dark .ppj-tahap-3 .ppj-chip{background:rgba(244,63,94,.18);color:#fda4af}
                html.dark .ppj-chip{background:rgba(59,130,246,.2);color:#93c5fd}
                html.dark .ppj-tahap-2 .ppj-chip{background:rgba(245,158,11,.18);color:#fcd34d}
                html.dark .ppj-jam,html.dark .ppj-detail{color:#94a3b8}
                html.dark .ppj-teks{color:#f1f5f9}
                html.dark .ppj-btn-kedua{background:rgba(59,130,246,.18);color:#93c5fd}
                html.dark .ppj-btn-kedua:hover{background:rgba(59,130,246,.3)}
                html.dark .ppj-btn-nanti{color:#94a3b8}
                html.dark .ppj-btn-nanti:hover{background:#334155;color:#e2e8f0}
                /* Tahap 3 (jam sudah mulai): popup di TENGAH layar + latar agak blur supaya guru memilih tindakan. */
                .ppj-item.ppj-tahap-3{position:fixed;inset:0;margin:auto;width:min(420px,calc(100vw - 32px));height:fit-content;max-height:calc(100vh - 32px);overflow:auto;z-index:1;cursor:default;padding:18px 18px 16px;border-radius:20px;animation:ppj-tengah .35s cubic-bezier(.22,.8,.3,1) both}
                .ppj-item.ppj-tahap-3.ppj-keluar{animation:ppj-tengah-keluar .2s ease-in both}
                .ppj-item.ppj-tahap-3 ~ .ppj-item.ppj-tahap-3:not(.ppj-keluar){display:none} /* dua kelas bersamaan: satu per satu */
                .ppj-tahap-3 .ppj-teks{font-size:15px}
                .ppj-tahap-3 .ppj-aksi{flex-direction:column;align-items:stretch}
                .ppj-tahap-3 .ppj-btn{padding:10px 14px;font-size:13px}
                @keyframes ppj-tengah{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
                @keyframes ppj-tengah-keluar{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.94)}}
                @keyframes ppj-latar{from{opacity:0}to{opacity:1}}
                @supports selector(:has(a)){
                    #pengingat-pra-jadwal-wadah:has(.ppj-item.ppj-tahap-3:not(.ppj-keluar))::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:auto;background:rgba(15,23,42,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:ppj-latar .3s ease both}
                }
                @media (prefers-reduced-motion:reduce){.ppj-item,.ppj-item.ppj-keluar,.ppj-item.ppj-tahap-3,.ppj-item.ppj-tahap-3.ppj-keluar{animation:none}#pengingat-pra-jadwal-wadah::before{animation:none!important}}
            `;
            document.head.appendChild(st);
        })();

        // ---------- Status per sesi (per guru + per tanggal) ----------
        // Bentuk: { "<kelas>|<jam>": { t1: true, t2: true, selesai: true } }
        let _ppjStatusMemori = { tanggal: '', data: {} }; // cadangan kalau localStorage diblokir
        function ppjPrefixStorage() { return `pengingat_pra_jadwal_${USERNAME_LOGIN_SAAT_TAB_INI_DIBUKA || 'guru'}_`; }
        function ppjKunciStorage() { return ppjPrefixStorage() + getTanggalHariIniKey(); }
        function ppjBacaStatus() {
            try { return JSON.parse(localStorage.getItem(ppjKunciStorage()) || '{}') || {}; }
            catch (e) {
                return _ppjStatusMemori.tanggal === getTanggalHariIniKey() ? _ppjStatusMemori.data : {};
            }
        }
        function ppjTulisStatus(kunciSesi, perubahan) {
            const s = ppjBacaStatus();
            s[kunciSesi] = Object.assign({}, s[kunciSesi], perubahan);
            _ppjStatusMemori = { tanggal: getTanggalHariIniKey(), data: s };
            try { localStorage.setItem(ppjKunciStorage(), JSON.stringify(s)); } catch (e) { /* abaikan */ }
        }
        function ppjBersihkanHariLama() {
            try {
                const prefix = ppjPrefixStorage();
                const hariIni = ppjKunciStorage();
                Object.keys(localStorage).forEach(k => {
                    if (k !== hariIni && k.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(prefix.length))) localStorage.removeItem(k);
                });
            } catch (e) { /* abaikan */ }
        }

        // ---------- Waktu: 0 = tidak perlu, 1 = rentang 10 mnt, 2 = rentang 5 mnt, 3 = sesi sudah dimulai ----------
        function ppjMenitMenujuMulai(item, sekarang) {
            const now = sekarang || new Date();
            const menitSekarang = now.getHours() * 60 + now.getMinutes();
            const [jam, menit] = item.start.split(':').map(Number);
            return (jam * 60 + menit) - menitSekarang;
        }
        function ppjTahapSaatIni(item, sekarang) {
            const sisa = ppjMenitMenujuMulai(item, sekarang);
            if (sisa > PENGINGAT_PRA_JADWAL.TAHAP_1_MENIT) return 0; // belum masuk rentang 10 menit
            if (sisa <= 0) return getScheduleStatus(item.start, item.end) === 'ONGOING' ? 3 : 0; // sudah mulai (sesi masih berjalan)
            return sisa <= PENGINGAT_PRA_JADWAL.TAHAP_2_MENIT ? 2 : 1;
        }

        // ---------- Tampilan ----------
        let _ppjPengamatNotifLama = null;
        function ppjSesuaikanPosisi() {
            const w = document.getElementById('pengingat-pra-jadwal-wadah');
            if (!w) return;
            // Kalau notifikasi "Waktunya mengajar" (sesi lain) sedang tampil di pojok yang sama, naik di atasnya.
            const lama = document.getElementById('notif-jadwal-guru-wadah');
            const tinggiLama = lama ? lama.offsetHeight : 0;
            w.style.bottom = `calc(${16 + (tinggiLama ? tinggiLama + 10 : 0)}px + env(safe-area-inset-bottom,0px))`;
            if (lama && !_ppjPengamatNotifLama && 'ResizeObserver' in window) {
                _ppjPengamatNotifLama = new ResizeObserver(ppjSesuaikanPosisi);
                _ppjPengamatNotifLama.observe(lama);
            }
        }

        function ppjWadah() {
            let w = document.getElementById('pengingat-pra-jadwal-wadah');
            if (w) return w;
            w = document.createElement('div');
            w.id = 'pengingat-pra-jadwal-wadah';
            w.setAttribute('aria-live', 'polite');
            document.body.appendChild(w);
            // Satu listener untuk semua kartu (delegation).
            w.addEventListener('click', (e) => {
                const el = e.target.closest('.ppj-item');
                if (!el) return;
                const tombol = e.target.closest('[data-ppj]');
                const kunci = el.dataset.kunci, kelas = el.dataset.kelas;
                if (el.dataset.tahap === '3' && !tombol) return; // popup tengah: hanya tombol yang bekerja (cegah salah klik)
                const aksi = tombol ? tombol.dataset.ppj : 'kelas'; // klik di badan kartu = "Ke Kelas"
                if (aksi === 'nanti') {
                    // Hanya menutup kartu tahap ini; tahap berikutnya (kalau tugas masih belum ada) tetap boleh muncul.
                    ppjTulisStatus(kunci, { ['t' + el.dataset.tahap]: true });
                    ppjHapusKartu(el);
                    return;
                }
                // Tahap 3 (jam sudah mulai): klik -> menuju kartu kelas + tampilkan panel konfirmasi tindakan.
                if (aksi === 'hadir') { // hanya ada di popup tahap 3: guru menyatakan sudah masuk kelas fisik
                    ppjAksiKelas('hadir', kelas);
                    ppjHapusKartu(el);
                    return;
                }
                if (el.dataset.tahap === '3' && aksi === 'kelas') {
                    ppjHapusKartu(el);
                    ppjMenujuKelasKonfirmasi(kelas, kunci);
                    return;
                }
                // Tahap 1/2: "Siapkan Tugas" / "Ke Kelas" hanya menandai TAHAP ini sudah ditangani
                // (tidak muncul ulang). Tahap berikutnya (5 menit / jam mulai) tetap muncul selama
                // tugas belum diberikan -- sesi baru dianggap selesai saat tugas terkirim.
                ppjTulisStatus(kunci, { ['t' + el.dataset.tahap]: true });
                ppjHapusKartu(el);
                if (aksi === 'tugas') bukaModalBeriTugas(kelas);
                else if (aksi === 'kelas') sorotKartuKelasGuru(kelas, { keBeranda: true }); // pindah ke Beranda, buka filter yang diperlukan, scroll, sorot
            });
            ppjSesuaikanPosisi();
            return w;
        }

        function ppjHapusKartu(el) {
            if (!el || el.classList.contains('ppj-keluar')) return;
            el.classList.add('ppj-keluar');
            setTimeout(() => { el.remove(); ppjSesuaikanPosisi(); }, 320);
        }

        function ppjBuatKartu(item, kunciSesi, tahap) {
            const kelas = escHTMLRekap(item.kelas);
            const teks = tahap === 1
                ? `👋 ${PENGINGAT_PRA_JADWAL.TAHAP_1_MENIT} menit lagi Anda mengajar di ${kelas}. Mau siapkan tugas dulu atau langsung ke kelas?`
                : tahap === 2
                    ? `⏳ Tinggal ${PENGINGAT_PRA_JADWAL.TAHAP_2_MENIT} menit lagi, Pak/Bu! ${kelas} sudah hampir menunggu dan tugasnya belum siap. Mau dikebut sekarang atau langsung melangkah ke kelas?`
                    : `🔔 [Bel Jam Mengajar] Jadwal Anda di ${kelas} sudah dimulai dan tugas belum diberikan. Mau kirim tugas dulu, atau Anda sudah masuk kelas?`;
            const chip = tahap === 1 ? `${PENGINGAT_PRA_JADWAL.TAHAP_1_MENIT} menit lagi`
                : tahap === 2 ? `${PENGINGAT_PRA_JADWAL.TAHAP_2_MENIT} menit lagi` : 'Sudah dimulai';
            const el = document.createElement('div');
            el.className = `ppj-item ppj-tahap-${tahap}`;
            el.dataset.kunci = kunciSesi;
            el.dataset.kelas = item.kelas;
            el.dataset.tahap = String(tahap);
            el.setAttribute('role', 'status');
            el.innerHTML = `
                <div class="ppj-kepala">
                    <span class="ppj-chip"><i class="fa-regular fa-clock"></i> ${chip}</span>
                    <span class="ppj-jam">Mulai ${escHTMLRekap(item.start)}</span>
                </div>
                <p class="ppj-teks">${teks}</p>
                <p class="ppj-detail">${escHTMLRekap(item.mapel)} &bull; ${escHTMLRekap(item.jam)}${tahap === 3 ? '' : ' &bull; klik kartu untuk menuju kelas'}</p>
                <div class="ppj-aksi">
                    ${tahap === 3 ? `
                    <button type="button" class="ppj-btn ppj-btn-utama" data-ppj="tugas">📝 Kirim Tugas</button>
                    <button type="button" class="ppj-btn ppj-btn-kedua" data-ppj="hadir">🏃 Saya Masuk Kelas Fisik</button>
                    <button type="button" class="ppj-btn ppj-btn-kedua" data-ppj="kelas">👀 Lihat Kartu Kelas</button>
                    <button type="button" class="ppj-btn ppj-btn-nanti" data-ppj="nanti">Nanti</button>` : `
                    <button type="button" class="ppj-btn ppj-btn-utama" data-ppj="tugas">📝 Siapkan Tugas</button>
                    <button type="button" class="ppj-btn ppj-btn-kedua" data-ppj="kelas">🏃 Ke Kelas</button>
                    <button type="button" class="ppj-btn ppj-btn-nanti" data-ppj="nanti">Nanti</button>`}
                </div>
            `;
            return el;
        }

        // Dipanggil saat halaman dimuat, berkala, saat tab aktif lagi, dan sesaat setelah
        // guru mengirim tugas. Murah: hanya membaca cache tugas di memori (tanpa request).
        function perbaruiPengingatPraJadwalGuru() {
            if (_cacheTugasSemuaKelas === null) return; // data tugas belum siap -> jangan menebak "belum ada tugas"
            if (!(NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || '').trim()) return;

            const status = ppjBacaStatus();
            const perluTampil = new Map(); // kunciSesi -> { item, tahap }

            jadwalMengajar.forEach(item => {
                if (!notifJadwalMilikGuruLogin(item)) return;
                if (!daftarSeluruhKelasDummy.some(k => k.nama === item.kelas)) return;
                const kunci = notifJadwalKunciSesi(item);
                const st = status[kunci] || {};
                if (st.selesai) return;
                const tahap = ppjTahapSaatIni(item);
                if (!tahap) return;
                if (notifGuruSudahBeriTugasHariIni(item.kelas)) { ppjTulisStatus(kunci, { selesai: true }); return; }
                if (st['t' + tahap]) return; // tahap ini sudah ditutup guru
                perluTampil.set(kunci, { item, tahap });
            });

            const wadah = ppjWadah();
            const sudahTampil = new Set();
            wadah.querySelectorAll('.ppj-item:not(.ppj-keluar)').forEach(el => {
                const perlu = perluTampil.get(el.dataset.kunci);
                if (perlu && String(perlu.tahap) === el.dataset.tahap) { sudahTampil.add(el.dataset.kunci); return; }
                ppjHapusKartu(el); // sudah tidak relevan (tugas diberikan / pindah tahap / sesi berakhir)
            });

            // Hanya buat kartu yang belum ada -> tidak pernah dobel.
            perluTampil.forEach(({ item, tahap }, kunci) => {
                if (sudahTampil.has(kunci)) return;
                wadah.appendChild(ppjBuatKartu(item, kunci, tahap));
            });
            ppjSesuaikanPosisi();
        }

        // ---------- Status & konfirmasi tindakan di kartu kelas (setelah notifikasi tahap 3 diklik) ----------
        // Panel dua tombol muncul DI KARTU KELAS (Beranda & Kelola Kelas) lewat ppjHTMLStatusKelas(),
        // yang dipanggil dari buildKartuKelasBerandaHTML() & renderSeluruhKelas(). Isinya dihitung dari
        // status tersimpan, jadi tidak hilang saat kartu dirender ulang oleh sinkron berkala.
        (function suntikGayaPanelKelasPPJ() {
            if (document.getElementById('gaya-ppj-panel-kelas')) return;
            const st = document.createElement('style');
            st.id = 'gaya-ppj-panel-kelas';
            st.textContent = `
                .ppj-panel-kelas{margin-top:10px;padding:10px 11px;border-radius:12px;background:#fff1f2;border:1px solid #fecdd3;cursor:default}
                .ppj-panel-status{margin:0;font-size:11px;font-weight:700;line-height:1.4;color:#9f1239}
                .ppj-panel-catatan{margin:5px 0 0;font-size:10px;line-height:1.4;color:#64748b;font-style:italic}
                .ppj-panel-aksi{display:flex;flex-direction:column;gap:6px;margin-top:9px}
                .ppj-pbtn{width:100%;border:0;border-radius:10px;padding:8px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;text-align:center;transition:background .15s,transform .1s}
                .ppj-pbtn:active{transform:scale(.98)}
                .ppj-pbtn-tugas{background:#2563eb;color:#fff}
                .ppj-pbtn-tugas:hover{background:#1d4ed8}
                .ppj-pbtn-hadir{background:#059669;color:#fff}
                .ppj-pbtn-hadir:hover{background:#047857}
                .ppj-badge-status{display:flex;align-items:center;gap:6px;margin-top:10px;padding:7px 10px;border-radius:10px;font-size:11px;font-weight:800}
                .ppj-badge-hadir{background:#d1fae5;border:1px solid #6ee7b7;color:#047857}
                .ppj-badge-tugas{background:#dbeafe;border:1px solid #93c5fd;color:#1d4ed8}
                html.dark .ppj-panel-kelas{background:rgba(244,63,94,.12);border-color:rgba(244,63,94,.35)}
                html.dark .ppj-panel-status{color:#fda4af}
                html.dark .ppj-panel-catatan{color:#94a3b8}
                html.dark .ppj-badge-hadir{background:rgba(16,185,129,.16);border-color:rgba(16,185,129,.4);color:#6ee7b7}
                html.dark .ppj-badge-tugas{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.4);color:#93c5fd}
            `;
            document.head.appendChild(st);
        })();

        // Sesi milik guru login untuk kelas ini yang SEDANG berjalan (null kalau tidak ada).
        function ppjItemBerjalanUntukKelas(namaKelas) {
            return jadwalMengajar.find(i => i.kelas === namaKelas && notifJadwalMilikGuruLogin(i) &&
                getScheduleStatus(i.start, i.end) === 'ONGOING') || null;
        }

        // Nama guru lain yang mengirim tugas ke kelas ini HARI INI (null kalau tidak ada).
        function ppjNamaGuruLainHariIni(namaKelas) {
            const now = new Date();
            const t = getTasksKelas(namaKelas).find(x => {
                if (!x.waktuKirimGuru || tugasIniMilikGuruLogin(x)) return false;
                const d = new Date(x.waktuKirimGuru);
                return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
            });
            return t ? (t.namaGuru || cariNamaGuruKelas(namaKelas)) : null;
        }

        function ppjHTMLStatusKelas(namaKelas) {
            try {
                const item = ppjItemBerjalanUntukKelas(namaKelas);
                if (!item) return '';
                const st = ppjBacaStatus()[notifJadwalKunciSesi(item)] || {};
                if (!st.menunggu && !st.masuk) return '';
                const sudahTugas = notifGuruSudahBeriTugasHariIni(namaKelas);
                if (st.masuk) {
                    return `<div class="ppj-badge-status ppj-badge-hadir"><i class="fa-solid fa-person-chalkboard"></i> Guru Berada di Kelas${sudahTugas ? ' &bull; Tugas Diberikan' : ''}</div>`;
                }
                if (sudahTugas) {
                    return `<div class="ppj-badge-status ppj-badge-tugas"><i class="fa-solid fa-circle-check"></i> Diisi Tugas</div>`;
                }
                const kelas = escHTMLRekap(namaKelas);
                const guruLain = ppjNamaGuruLainHariIni(namaKelas);
                const catatan = guruLain
                    ? `<p class="ppj-panel-catatan">Catatan: kelas ini sedang menerima tugas mandiri dari ${escHTMLRekap(guruLain)}.</p>` : '';
                return `
                    <div class="ppj-panel-kelas" onclick="event.stopPropagation()">
                        <p class="ppj-panel-status">⚠️ Status: Anda belum tercatat masuk atau memberikan tugas di ${kelas}.</p>
                        ${catatan}
                        <div class="ppj-panel-aksi">
                            <button type="button" class="ppj-pbtn ppj-pbtn-tugas" onclick="ppjAksiKelas('tugas','${kelas}'); event.stopPropagation();">📝 Kirim Tugas Jadwal</button>
                            <button type="button" class="ppj-pbtn ppj-pbtn-hadir" onclick="ppjAksiKelas('hadir','${kelas}'); event.stopPropagation();">🏫 Saya Masuk Kelas Fisik</button>
                        </div>
                    </div>`;
            } catch (e) { return ''; }
        }

        // Notifikasi tahap 3 diklik: tandai "menunggu konfirmasi", buka tab/filter yang diperlukan,
        // gambar ulang kartu supaya panel muncul, lalu scroll + highlight kartunya.
        function ppjMenujuKelasKonfirmasi(namaKelas, kunciSesi) {
            ppjTulisStatus(kunciSesi, { t3: true, menunggu: true });
            pastikanKartuKelasTerlihat(namaKelas);
            renderKartuKelasTabAktif();
            sorotKartuKelasGuru(namaKelas);
        }

        function ppjAksiKelas(aksi, namaKelas) {
            const item = ppjItemBerjalanUntukKelas(namaKelas);
            if (!item) { renderKartuKelasTabAktif(); return; } // sesi sudah berakhir
            if (aksi === 'tugas') {
                // Memakai form beri tugas yang sudah ada. Status berubah jadi "Diisi Tugas"
                // otomatis begitu tugas benar-benar terkirim (kartu dirender ulang oleh alur kirim tugas).
                bukaModalBeriTugas(namaKelas);
            } else if (aksi === 'hadir') {
                ppjTulisStatus(notifJadwalKunciSesi(item), { masuk: true, selesai: true, waktuMasuk: Date.now() });
                renderKartuKelasTabAktif();
                perbaruiPengingatPraJadwalGuru(); // kartu pengingat sesi ini (kalau masih ada) ikut hilang
            }
        }

        /* ================================================================
           FILTER CEPAT BERANDA: JURUSAN (TKJ | TAV | TKR) BUKA/TUTUP
           ----------------------------------------------------------------
           Dropdown jurusan lama ("Hanya TKJ (1, 2, 3)") menampilkan NOMOR kelas,
           bukan pilihan yang berguna. Sekarang diganti tombol "Filter Jurusan"
           yang membuka panel berisi chip TKJ | TAV | TKR (slide-down) dan menutupnya
           lagi (slide-up). Filter Tingkat (Semua/X/XI/XII) tidak diubah.

           Logika filternya TIDAK ditulis ulang: chip memanggil
           filterBerandaCepatByJurusan() yang sudah ada, sehingga otomatis bekerja
           bersamaan dengan filterBerandaCepat() (tingkat), Total Siswa, polling
           render, dan reset filter dari notifikasi jadwal. <select> lama tetap ada
           di DOM (hanya disembunyikan) & nilainya selalu disinkronkan.
           Klik chip yang sedang aktif = batalkan filter jurusan (kembali Semua).
           ================================================================ */
        const DAFTAR_JURUSAN_FILTER_GURU = ['TKJ', 'TAV', 'TKR'];
        const KELAS_PILL_FILTER_GURU_NONAKTIF = 'btn-fast-filter px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-all';
        const KELAS_PILL_FILTER_GURU_AKTIF = 'btn-fast-filter px-4 py-2 rounded-xl text-xs font-extrabold bg-blue-600 text-white shadow-md transition-all';

        (function suntikGayaFilterJurusanGuru() {
            if (document.getElementById('gaya-filter-jurusan-guru')) return;
            const st = document.createElement('style');
            st.id = 'gaya-filter-jurusan-guru';
            st.textContent = `
                .fj-wrap{flex:0 0 100%;width:100%;margin-top:10px}
                .fj-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:0}
                .fj-chevron{font-size:10px;transition:transform .3s ease}
                .fj-toggle[aria-expanded="true"] .fj-chevron{transform:rotate(180deg)}
                /* Slide-down/up: tinggi panel dianimasikan 0fr <-> 1fr (tinggi otomatis, tanpa angka tetap). */
                .fj-panel{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;transition:grid-template-rows .3s ease,opacity .25s ease,visibility 0s linear .3s}
                .fj-panel.terbuka{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .3s ease,opacity .25s ease,visibility 0s}
                .fj-inner{min-height:0;overflow:hidden}
                .fj-chips{display:flex;flex-wrap:wrap;gap:8px;padding:10px 4px 4px;transform:translateY(-8px);transition:transform .3s ease}
                .fj-panel.terbuka .fj-chips{transform:translateY(0)}
                .fj-chip{cursor:pointer;border:0;min-width:64px;text-align:center}
                @media (max-width:480px){
                    .fj-toggle{width:100%;justify-content:center}
                    .fj-chip{flex:1 1 0}
                }
                @media (prefers-reduced-motion:reduce){
                    .fj-panel,.fj-panel.terbuka,.fj-chips,.fj-chevron{transition:none}
                }
            `;
            document.head.appendChild(st);
        })();

        // Samakan tampilan chip, label tombol & <select> lama dengan state filter yang sebenarnya.
        // Dipanggil dari akhir filterBerandaCepatByJurusan(), jadi siapa pun yang mengubah
        // filter jurusan (chip, select lama, notifikasi jadwal) otomatis tersinkron.
        function sinkronChipJurusanGuru() {
            const wrap = document.getElementById('fj-wrap');
            if (!wrap) return;
            const aktif = filterCepatJurusanAktif;
            wrap.querySelectorAll('[data-fj]').forEach(b => {
                const on = b.dataset.fj === aktif;
                b.className = (on ? KELAS_PILL_FILTER_GURU_AKTIF : KELAS_PILL_FILTER_GURU_NONAKTIF) + ' fj-chip';
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            const label = document.getElementById('fj-label');
            if (label) label.textContent = aktif === 'ALL' ? 'Filter Jurusan' : 'Jurusan: ' + aktif;
            const selLama = document.getElementById('select-fast-jurusan');
            if (selLama && selLama.value !== aktif) selLama.value = aktif;
        }

        function toggleFilterJurusanGuru(buka) {
            const panel = document.getElementById('fj-panel');
            const tombol = document.getElementById('fj-toggle');
            if (!panel || !tombol) return;
            const jadiBuka = (typeof buka === 'boolean') ? buka : !panel.classList.contains('terbuka');
            panel.classList.toggle('terbuka', jadiBuka);
            if (jadiBuka) panel.removeAttribute('inert'); else panel.setAttribute('inert', ''); // tertutup = tidak bisa difokus/di-tab
            tombol.setAttribute('aria-expanded', jadiBuka ? 'true' : 'false');
        }

        function pasangFilterJurusanBerandaGuru() {
            if (document.getElementById('fj-wrap')) return;
            const selLama = document.getElementById('select-fast-jurusan');
            if (!selLama || !selLama.parentElement) return;

            // Sembunyikan dropdown lama (tetap di DOM). Kalau pembungkusnya hanya berisi
            // dropdown itu, pembungkusnya ikut disembunyikan supaya tidak tersisa kotak kosong;
            // kalau pembungkusnya juga memuat tombol tingkat, cukup dropdown-nya saja.
            const host = selLama.parentElement;
            const sebaris = !!host.querySelector('.btn-fast-filter');
            const disembunyikan = sebaris ? selLama : host;
            disembunyikan.style.display = 'none';
            disembunyikan.setAttribute('aria-hidden', 'true');

            const wrap = document.createElement('div');
            wrap.id = 'fj-wrap';
            wrap.className = 'fj-wrap';
            wrap.innerHTML = `
                <button type="button" id="fj-toggle" class="${KELAS_PILL_FILTER_GURU_NONAKTIF} fj-toggle" aria-expanded="false" aria-controls="fj-panel">
                    <i class="fa-solid fa-layer-group"></i><span id="fj-label">Filter Jurusan</span><i class="fa-solid fa-chevron-down fj-chevron"></i>
                </button>
                <div id="fj-panel" class="fj-panel" inert>
                    <div class="fj-inner">
                        <div class="fj-chips" role="group" aria-label="Filter jurusan">
                            ${DAFTAR_JURUSAN_FILTER_GURU.map(j => `<button type="button" class="${KELAS_PILL_FILTER_GURU_NONAKTIF} fj-chip" data-fj="${j}" aria-pressed="false">${j}</button>`).join('')}
                        </div>
                    </div>
                </div>
            `;
            disembunyikan.insertAdjacentElement('afterend', wrap);

            wrap.addEventListener('click', (e) => {
                if (e.target.closest('#fj-toggle')) { toggleFilterJurusanGuru(); return; }
                const chip = e.target.closest('[data-fj]');
                if (!chip) return;
                // Klik chip aktif = batalkan filter jurusan.
                filterBerandaCepatByJurusan(filterCepatJurusanAktif === chip.dataset.fj ? 'ALL' : chip.dataset.fj);
            });
            sinkronChipJurusanGuru();
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasangFilterJurusanBerandaGuru);
        else pasangFilterJurusanBerandaGuru();

        // ============================================================
        // PENJADWAL SINKRON TUNGGAL (menggantikan 6 setInterval terpisah).
        // - Satu interval 15 dtk; tugas/pelanggaran/evaluasi disegarkan tiap 2
        //   tik (30 dtk), tab "Nilai" tiap tik (15 dtk).
        // - Tidak jalan saat tab tersembunyi, dan tidak menumpuk kalau server
        //   lambat (_sinkronBerjalan).
        // - Kartu kelas hanya dirender ulang kalau datanya BERUBAH dan hanya
        //   untuk tab yang sedang dibuka (tab lain dirender saat dibuka: switchTab).
        // ============================================================
        let _sinkronBerjalan = false, _tikSinkron = 0;
        let _tandaTugasTerakhir = '', _tandaPelanggaranTerakhir = '';

        function _tandaTugasSemuaKelas() {
            return daftarSeluruhKelasDummy.map(k =>
                getTasksKelas(k.nama)
                    .map(t => `${t.id}:${t.judul || ''}:${t.waktuKirimGuru || 0}:${t.deadlineTimestamp || 0}:${t.studentSubmitted ? 1 : 0}`)
                    .join(',')
            ).join('|');
        }

        // Tanda ringan (tanpa membawa bukti base64 ke dalam string).
        function _tandaPelanggaranServer() {
            const bagian = Object.keys(_cacheDataPelanggaranServer).sort().map(u =>
                u + ':' + (_cacheDataPelanggaranServer[u] || [])
                    .map(e => `${e.id}/${e.status}/${e.dikirim_at || ''}/${e.diselesaikan_at || ''}`).join(',')
            );
            return bagian.join('|') + JSON.stringify(_cacheRingkasanPelanggaranServer);
        }

        function renderKartuKelasTabAktif() {
            if (activeTab === 'beranda') {
                ['X', 'XI', 'XII'].forEach(t => {
                    let daftar = daftarSeluruhKelasDummy.filter(k => k.tingkat === t);
                    if (filterCepatJurusanAktif !== 'ALL') daftar = daftar.filter(k => k.jurusan === filterCepatJurusanAktif);
                    renderKelasListWithCollapse(`container-beranda-${t}`, daftar, true); // hormati filter & state "tampilkan lainnya"
                });
            } else if (activeTab === 'kelas') {
                renderSeluruhKelas();
            }
            perbaruiStatTotalSiswa();
        }

        function renderRinganBerandaAktif() {
            if (activeTab !== 'beranda') return;
            renderAktivitasTugasTerbaruBeranda();
            renderTeacherSchedule();
        }

        function renderTabAktif() {
            renderKartuKelasTabAktif();
            renderRinganBerandaAktif();
        }

        async function siklusSinkron(paksa = false) {
            if (document.hidden || _sinkronBerjalan) return;
            _tikSinkron++;
            const tikPenuh = paksa || _tikSinkron % 2 === 0;
            if (!tikPenuh && activeTab !== 'nilai') return;
            _sinkronBerjalan = true;
            try {
                if (tikPenuh) {
                    await Promise.all([muatCacheTugasSemuaKelas(), muatPelanggaranAktifDariServer()]);
                    const tT = _tandaTugasSemuaKelas(), tP = _tandaPelanggaranServer();
                    if (tT !== _tandaTugasTerakhir || tP !== _tandaPelanggaranTerakhir) {
                        _tandaTugasTerakhir = tT; _tandaPelanggaranTerakhir = tP;
                        renderTabAktif();
                        const m = document.getElementById('modal-daftar-siswa-pelanggaran');
                        if (_kelasAktifDaftarSiswaPelanggaran && m && !m.classList.contains('hidden')) renderDaftarSiswaPelanggaran();
                    } else {
                        renderRinganBerandaAktif(); // jadwal & waktu relatif tetap berjalan
                    }
                }
                if (activeTab === 'beranda' || activeTab === 'nilai') {
                    await hitungDanTampilkanPerluDinilai();
                    if (activeTab === 'nilai') renderPenilaianTugas();
                }
                if (tikPenuh) {
                    if (activeTab === 'evaluasi') await renderEvaluasiGuru(); // sekalian update badge & tandai dibaca
                    else await updateBadgeEvaluasiGuru();
                }
            } catch (e) {
                console.warn('Siklus sinkron gagal:', e);
            } finally {
                _sinkronBerjalan = false;
            }
        }

        document.addEventListener('DOMContentLoaded', async () => {
            updateHeaderClock();
            setInterval(updateHeaderClock, 1000);

            // Cache tugas semua kelas + status pelanggaran dimuat BARENGAN sebelum
            // render pertama (1 request bulk, bukan puluhan request per kelas).
            await Promise.all([muatCacheTugasSemuaKelas(), muatPelanggaranAktifDariServer()]);
            renderBerandaKelasBerurutan();
            renderSeluruhKelas();
            perbaruiStatTotalSiswa();
            _tandaTugasTerakhir = _tandaTugasSemuaKelas();
            _tandaPelanggaranTerakhir = _tandaPelanggaranServer();
            hitungDanTampilkanPerluDinilai();
            renderAktivitasTugasTerbaruBeranda();
            renderTeacherSchedule();
            loadSavedProfilePhotoGuru();
            loadBioGuru();
            updateBadgePrestasiMenunggu();
            updateBadgeEvaluasiGuru();

            setInterval(siklusSinkron, 15000);

            // Bel jam mengajar harus tetap jalan di tab mana pun, jadi terpisah dari
            // penjadwal di atas. Cukup tiap 15 dtk (sesi jadwal berdurasi 90 menit).
            cekBelJamMengajarOtomatis();
            setInterval(() => { if (!document.hidden) cekBelJamMengajarOtomatis(); }, 15000);

            // Notifikasi pengingat jadwal + auto-scroll/highlight (blok "NOTIFIKASI PENGINGAT
            // JADWAL MENGAJAR"). Cache tugas sudah termuat di atas, jadi aman langsung dicek.
            notifJadwalBersihkanHariLama();
            perbaruiNotifJadwalGuru();
            setInterval(() => { if (!document.hidden) perbaruiNotifJadwalGuru(); }, NOTIF_JADWAL.INTERVAL_CEK_MS);

            // Pengingat pra-jadwal (10 & 5 menit sebelum mulai) -- langsung dicek saat halaman dimuat.
            ppjBersihkanHariLama();
            perbaruiPengingatPraJadwalGuru();
            setInterval(() => { if (!document.hidden) perbaruiPengingatPraJadwalGuru(); }, PENGINGAT_PRA_JADWAL.INTERVAL_CEK_MS);

            // Kembali ke tab browser -> langsung segar (interval ditahan saat tersembunyi).
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) return;
                updateHeaderClock();
                cekBelJamMengajarOtomatis();
                perbaruiPengingatPraJadwalGuru();
                siklusSinkron(true);
            });

            // NONAKTIF: pengecekan "sesi berubah" sengaja dimatikan (modal
            // "Sesi Login Sudah Berubah" dulu suka muncul & minta reload
            // padahal guru tidak login ganda / tidak ganti akun). Fungsi
            // pengecekSesiBerubahGuru() & tampilkanModalSesiBerubahGuru()
            // di atas TETAP ada -- cukup un-comment 3 baris di bawah ini.
            //
            // setInterval(() => { if (!document.hidden) pengecekSesiBerubahGuru(); }, 15000);
            // document.addEventListener('visibilitychange', () => {
            //     if (document.visibilityState === 'visible') pengecekSesiBerubahGuru();
            // });
            // window.addEventListener('focus', pengecekSesiBerubahGuru);
        });

        /* ============================================================
           SUMBER DATA UNTUK LILY (lily_teacher.js)
           Hanya MEMBACA sumber yang SUDAH dipakai sistem pengingat mengajar -- tidak ada jadwal/data baru:
           jadwalMengajar, ppjTahapSaatIni()/ppjMenitMenujuMulai() (jam browser), notifGuruSudahBeriTugasHariIni()
           (tugas milik guru login, hari ini) dan angka "Perlu Dinilai" dari hitungDanTampilkanPerluDinilai().
           ============================================================ */
        window.LilyTeacherSource = {
            namaMentah: function () { return NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || ''; },
            snapshot: function () {
                const nama = NAMA_GURU_LOGIN_SAAT_TAB_INI_DIBUKA || '';
                const tugasSiap = _cacheTugasSemuaKelas !== null;   // belum siap -> status tugas "tidak diketahui", bukan "belum ada"
                const sesi = [];
                if (nama.trim()) {
                    const sekarang = new Date();
                    const statusTersimpan = ppjBacaStatus();
                    jadwalMengajar.forEach(item => {
                        if (!notifJadwalMilikGuruLogin(item)) return;
                        if (!daftarSeluruhKelasDummy.some(k => k.nama === item.kelas)) return;
                        const tahap = ppjTahapSaatIni(item, sekarang);
                        if (!tahap) return;
                        const kunci = notifJadwalKunciSesi(item);
                        const menit = ppjMenitMenujuMulai(item, sekarang);
                        sesi.push({
                            kunci: kunci, kelas: item.kelas, mapel: item.mapel, jam: item.jam, tahap: tahap,
                            menitMenuju: Math.max(0, menit), menitSejakMulai: Math.max(0, -menit),
                            sudahTugas: tugasSiap ? notifGuruSudahBeriTugasHariIni(item.kelas) : null,
                            ditutup: !!(statusTersimpan[kunci] && statusTersimpan[kunci]['t' + tahap])
                        });
                    });
                }
                const pd = window.__lilyPerluDinilai;
                return { nama: nama, tugasSiap: tugasSiap, sesi: sesi, perluDinilai: (pd && pd.lengkap) ? pd.n : null };
            }
        };

        /* ============================================================
           AKSI CEPAT LILY (tombol di balon Lily). Hanya MEMANGGIL fungsi/tombol yang SUDAH ada -- tidak ada logika baru:
             beriTugas    -> tombol "Siapkan Tugas" di kartu pengingat (menandai tahap itu selesai, sama seperti klik biasa);
                             bila kartu sudah tidak ada -> bukaModalBeriTugas(kelas)
             bukaKelas    -> tombol "Ke Kelas" di kartu pengingat; tahap 3 / tanpa kartu -> sorotKartuKelasGuru(kelas)
             mulaiMenilai -> switchTab('nilai')
             lihatTugas   -> switchTab('rekap-tugas')
           Semuanya hanya membuka modal/tab (aman); tidak ada yang mengirim, menghapus, atau menilai otomatis.
           tersedia() dicek dulu oleh Lily: bila fungsi/elemennya tidak ada, tombolnya tidak ditampilkan.
           ============================================================ */
        function _lilyKlikKartuPPJ(kunci, aksi) {
            const w = document.getElementById('pengingat-pra-jadwal-wadah');
            if (!w || !kunci) return false;
            const kartu = Array.from(w.querySelectorAll('.ppj-item:not(.ppj-keluar)')).find(el => el.dataset.kunci === kunci);
            const tombol = kartu && kartu.querySelector(`[data-ppj="${aksi}"]`);
            if (!tombol) return false;
            tombol.click();
            return true;
        }
        window.LilyTeacherSource.aksi = {
            tersedia: function (nama, sesi) {
                const kelasAda = !!(sesi && sesi.kelas && daftarSeluruhKelasDummy.some(k => k.nama === sesi.kelas));
                switch (nama) {
                    case 'beriTugas': return kelasAda && typeof bukaModalBeriTugas === 'function' && !!document.getElementById('modal-beri-tugas');
                    case 'bukaKelas': return kelasAda && typeof sorotKartuKelasGuru === 'function';
                    case 'mulaiMenilai': return typeof switchTab === 'function' && !!document.getElementById('tab-nilai');
                    case 'lihatTugas': return typeof switchTab === 'function' && !!document.getElementById('tab-rekap-tugas');
                }
                return false;
            },
            jalankan: function (nama, sesi) {
                if (!this.tersedia(nama, sesi)) return false;
                switch (nama) {
                    case 'beriTugas':
                        if (sesi.tahap !== 3 && _lilyKlikKartuPPJ(sesi.kunci, 'tugas')) return true;
                        bukaModalBeriTugas(sesi.kelas); return true;
                    case 'bukaKelas':
                        if (sesi.tahap !== 3 && _lilyKlikKartuPPJ(sesi.kunci, 'kelas')) return true;
                        sorotKartuKelasGuru(sesi.kelas); return true;
                    case 'mulaiMenilai': switchTab('nilai'); return true;
                    case 'lihatTugas': switchTab('rekap-tugas'); return true;
                }
                return false;
            }
        };
