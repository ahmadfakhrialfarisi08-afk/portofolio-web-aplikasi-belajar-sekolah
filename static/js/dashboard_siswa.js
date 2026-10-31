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
        // ============================================================
        // KONTROL BEBAN POLLING BERKALA (skala 600+ siswa bersamaan)
        // ------------------------------------------------------------
        // Dipakai bareng oleh SEMUA fetch polling otomatis di dashboard
        // ini (badge pertemanan, badge perangkat, status maintenance --
        // lihat pemakaiannya di dashboard_siswa.js & dashboard_siswa_2.js,
        // keduanya jalan di scope global yang sama). Dua masalah yang
        // diperbaiki lewat modul kecil ini:
        //
        // 1) BACKOFF BERSAMA saat server kena rate-limit (429): sebelumnya
        //    tiap fungsi polling gagal sendiri-sendiri (catch & diam) tapi
        //    tetap nyoba lagi di tick berikutnya dengan jeda yang SAMA
        //    persis -- kalau 600 siswa serentak kena 429 (mis. abis lonjakan
        //    beban), semuanya bakal terus saling menghajar ulang server
        //    tiap tick tanpa pernah mereda. Sekarang begitu SATU fetch
        //    polling kena 429, SEMUA polling lain ikut skip dulu (tidak ada
        //    fetch sama sekali) sampai jeda "Retry-After" dari server lewat
        //    -- kasih waktu server pulih dulu.
        // 2) JITTER (+-15%) di tiap putaran interval: kalau semua siswa
        //    load halaman hampir bersamaan (mis. pas bel masuk kelas),
        //    setInterval biasa bikin request mereka numpuk presis di
        //    detik yang sama tiap kelipatan jeda. jadwalkanBerkala() di
        //    bawah me-random ulang jedanya tiap putaran (bukan cuma
        //    sekali di awal) supaya request 600+ siswa itu nyebar lebih
        //    rata sepanjang waktu, bukan meledak bareng tiap N detik.
        let _pollingTundaSampai = 0;
        function pollingSedangDitunda() {
            return Date.now() < _pollingTundaSampai;
        }
        function tandaiPollingKena429(res) {
            const retryAfterDetik = parseInt(res && res.headers && res.headers.get('Retry-After'), 10);
            const jedaMs = (isNaN(retryAfterDetik) ? 10 : retryAfterDetik) * 1000;
            _pollingTundaSampai = Math.max(_pollingTundaSampai, Date.now() + jedaMs);
        }
        // Pembungkus fetch buat SEMUA polling otomatis (bukan aksi manual
        // siswa spt kirim tugas/submit quiz -- itu tetap pakai fetch biasa
        // apa adanya). Balikin null (tanpa nyoba fetch sama sekali) kalau
        // masih dalam masa tunda backoff, atau kalau responsnya 429 (sambil
        // otomatis mengaktifkan masa tunda itu buat polling lain).
        async function fetchDenganKontrolBeban(url, opts) {
            if (pollingSedangDitunda()) return null;
            const res = await fetch(url, opts);
            if (res.status === 429) tandaiPollingKena429(res);
            return res;
        }
        function jedaDenganJitter(basisMs) {
            return Math.floor(basisMs * (0.85 + Math.random() * 0.3));
        }
        function jadwalkanBerkala(fn, basisMs) {
            (function tick() {
                setTimeout(() => {
                    fn();
                    tick();
                }, jedaDenganJitter(basisMs));
            })();
        }

        function getAccurateNow() {
            return new Date();
        }

        // ============================================================
        // TOAST / FLOATING SNACKBAR -- PENGGANTI alert() BAWAAN BROWSER
        // ------------------------------------------------------------
        // Dulu SEMUA notifikasi error/sukses/peringatan (rate-limit server,
        // gagal kirim, gagal simpan, dst) pakai alert() bawaan browser --
        // muncul dialog BLOCKING di tengah layar dengan judul nama domain
        // ("el0fakhri.pythonanywheQre.com says") dan WAJIB diklik "OK" dulu
        // baru bisa lanjut, walau pesannya cuma info ringan (mis. "Terlalu
        // banyak request, coba lagi sebentar ya."). Sekarang diganti kotak
        // notifikasi melayang (floating snackbar) di pojok kanan atas, TIDAK
        // menutupi/mem-block layar sama sekali, dan otomatis pudar (fade out)
        // sendiri setelah beberapa detik -- user tidak perlu klik apa pun.
        // Beberapa toast sekaligus akan bertumpuk rapi ke bawah (bukan saling
        // menimpa), dibungkus sendiri-sendiri supaya bisa hilang independen.
        // ============================================================
        function tampilkanToast(pesan, tipe, durasiMs) {
            // tipe: 'error' (merah, default -- mayoritas pemanggilan lama
            // alert(json.message || '...') memang kasus gagal/error),
            // 'warning' (oranye, buat validasi ringan spt "isi dulu formnya"),
            // 'sukses' (hijau, buat konfirmasi berhasil).
            tipe = tipe || 'error';
            durasiMs = durasiMs || 3500;

            const gayaPerTipe = {
                error: { bg: 'bg-rose-50', border: 'border-rose-200', teks: 'text-rose-700', ikonBg: 'bg-rose-100', ikonWarna: 'text-rose-500', ikon: 'fa-circle-exclamation' },
                warning: { bg: 'bg-amber-50', border: 'border-amber-200', teks: 'text-amber-800', ikonBg: 'bg-amber-100', ikonWarna: 'text-amber-500', ikon: 'fa-triangle-exclamation' },
                sukses: { bg: 'bg-emerald-50', border: 'border-emerald-200', teks: 'text-emerald-700', ikonBg: 'bg-emerald-100', ikonWarna: 'text-emerald-500', ikon: 'fa-circle-check' }
            };
            const gaya = gayaPerTipe[tipe] || gayaPerTipe.error;

            let wadah = document.getElementById('wadah-toast-notifikasi');
            if (!wadah) {
                wadah = document.createElement('div');
                wadah.id = 'wadah-toast-notifikasi';
                // pointer-events-none di wadah supaya area kosong di sekitar
                // toast tidak ikut memblokir klik ke elemen di bawahnya --
                // tiap toast individual dikembalikan jadi pointer-events-auto.
                wadah.className = 'fixed top-4 right-4 z-[9999] flex flex-col items-end gap-2 pointer-events-none w-[calc(100%-2rem)] sm:w-auto';
                document.body.appendChild(wadah);
            }

            const toast = document.createElement('div');
            toast.className = `pointer-events-auto flex items-start gap-2.5 w-full sm:w-80 ${gaya.bg} border ${gaya.border} rounded-xl shadow-lg px-3.5 py-3 opacity-0 -translate-y-2 sm:translate-y-0 sm:translate-x-4 transition-all duration-300 ease-out`;
            toast.innerHTML = `
                <div class="w-7 h-7 shrink-0 rounded-full ${gaya.ikonBg} ${gaya.ikonWarna} flex items-center justify-center text-xs">
                    <i class="fa-solid ${gaya.ikon}"></i>
                </div>
                <p class="text-xs font-semibold ${gaya.teks} leading-snug pt-0.5 flex-1">${pesan}</p>
                <button type="button" class="shrink-0 ${gaya.teks} opacity-50 hover:opacity-100 transition-opacity text-xs mt-0.5" aria-label="Tutup">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            wadah.appendChild(toast);

            let sudahDitutup = false;
            const tutupToastIni = () => {
                if (sudahDitutup) return;
                sudahDitutup = true;
                toast.classList.add('opacity-0');
                toast.classList.add(window.innerWidth < 640 ? '-translate-y-2' : 'translate-x-4');
                setTimeout(() => toast.remove(), 300);
            };

            requestAnimationFrame(() => {
                toast.classList.remove('opacity-0', '-translate-y-2', 'sm:translate-x-4');
            });

            const tombolTutup = toast.querySelector('button');
            if (tombolTutup) tombolTutup.onclick = tutupToastIni;

            setTimeout(tutupToastIni, durasiMs);
        }

        function triggerDynamicIsland(messageText) {
            const notifIsland = document.getElementById('dynamic-notification-island');
            const notifText = document.getElementById('island-notification-text');
            const islandAvatar = document.getElementById('island-user-avatar');
            const headerAvatar = document.getElementById('header-user-avatar');
            const leftGroup = document.getElementById('header-left-group');
            const rightGroup = document.getElementById('header-right-group');

            if (islandAvatar && headerAvatar) {
                islandAvatar.src = headerAvatar.src;
            }

            if (notifText) {
                notifText.innerText = messageText;
            }

            if (!notifIsland) return;

            // batalin semua timer/animasi notif sebelumnya biar nggak numpuk & patah-patah
            if (notifIsland._islandOpenTimer) clearTimeout(notifIsland._islandOpenTimer);
            if (notifIsland._islandCloseTimer) clearTimeout(notifIsland._islandCloseTimer);
            if (notifIsland._islandPushOffTimer) clearTimeout(notifIsland._islandPushOffTimer);

            const pushApart = () => {
                if (leftGroup) leftGroup.classList.add('island-push-left');
                if (rightGroup) rightGroup.classList.add('island-push-right');
            };
            const pushTogether = () => {
                if (leftGroup) leftGroup.classList.remove('island-push-left');
                if (rightGroup) rightGroup.classList.remove('island-push-right');
            };

            // kalau notif lagi ciut/nutup (masih di tengah proses nutup), lanjut mulus dari sana
            const alreadyOpen = notifIsland.classList.contains('island-active');

            if (!alreadyOpen) {
                // 1) celahnya kebuka dulu (search bar & jam mulai kebelah)
                pushApart();
                // 2) sedikit setelahnya, pil notifnya baru mekar ngisi celah
                notifIsland._islandOpenTimer = setTimeout(() => {
                    notifIsland.classList.add('island-active');
                }, 120);
            }

            notifIsland._islandCloseTimer = setTimeout(() => {
                // nutup: pil ciut duluan...
                notifIsland.classList.remove('island-active');
                // ...baru search bar & jam balik nempel normal, biar nggak nabrak
                notifIsland._islandPushOffTimer = setTimeout(() => {
                    pushTogether();
                }, 200);
            }, 5000);
        }

        // ============================================================
        // FILTER KATA KASAR — dipakai bareng oleh kirimSaranSiswa() &
        // kirimSaranGuru() supaya SEMUA jalur "kirim saran" disaring
        // sebelum tersimpan. Menangkap:
        //   1) bentuk baku & non-baku/gaul ("goblok" & "goblokk", dst)
        //   2) singkatan umum di chat ("anj", "bgst", "kntl", dst)
        //   3) trik "dipisah/disingkat" pakai spasi/simbol/angka mirip
        //      huruf, mis. "a n j i n g", "a.n.j.i.n.g", "4njing"
        // Tinggal tambah/kurangi kata di DAFTAR_KATA_KASAR kalau perlu.
        // ============================================================
        const DAFTAR_KATA_KASAR = [
            // umpatan umum (baku & non-baku)
            'anjing', 'anjir', 'anjrit', 'anjay', 'anjrot', 'asu',
            'bangsat', 'bangke', 'bajingan', 'brengsek', 'kampret',
            'keparat', 'sialan', 'kunyuk', 'monyet', 'babi',
            'jancok', 'jancuk', 'diancuk', 'coeg',
            'tai', 'taik', 'kontol', 'memek', 'ngentot', 'jembut',
            'pepek', 'peler', 'pantek', 'titit', 'itil',
            'lonte', 'pelacur', 'sundal', 'sundel', 'jalang',
            'goblok', 'goblog', 'tolol', 'idiot', 'bego', 'dungu',
            'bebal', 'bloon', 'pekok', 'gila lu', 'sinting',
            // singkatan umum di chat/media sosial
            'anj', 'anjg', 'bgst', 'bgsd', 'bjr', 'kntl', 'kntol',
            'ngntd', 'mmk', 'pltk', 'sndl', 'gblk', 'gbl', 'tll',
            'jncok', 'jncuk', 'wtf', 'fck', 'fuck', 'fucking', 'shit',
            'bitch', 'asshole', 'bastard',
        ];

        // Ubah huruf yang sering "disamarkan" pakai angka/simbol supaya
        // ikut kena filter, mis. "4njing" / "@njing" / "b4ngsat".
        function _samarkanKeHurufAsli(teks) {
            const peta = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };
            return teks.replace(/[4@31!05\$7]/g, (ch) => peta[ch] || ch);
        }

        // Regex per-kata yang tetap kena walau hurufnya disisipi spasi/titik/
        // strip/dsb (mis. "a n j i n g"), TAPI tidak salah tangkap kata wajar
        // yang kebetulan mengandung potongan huruf yang sama (mis. "santai"
        // tidak ikut kena filter kata "tai") karena tetap butuh batas kata
        // (bukan huruf) tepat sebelum & sesudah polanya.
        function _buatRegexKataKasar(kata) {
            const huruf = kata.toLowerCase().split('').filter((h) => /[a-z]/.test(h));
            if (huruf.length === 0) return null;
            const pola = huruf.join('[^a-z]*');
            return new RegExp('(?:^|[^a-z])' + pola + '(?:[^a-z]|$)', 'i');
        }
        const _REGEX_KATA_KASAR = DAFTAR_KATA_KASAR
            .map((kata) => ({ kata, regex: _buatRegexKataKasar(kata) }))
            .filter((x) => x.regex);

        // Mengembalikan { terdeteksi, kata } — kata yang cocok TIDAK ditampilkan
        // ke user di pesan peringatan (cukup kasih tahu bahwa teksnya kasar),
        // biar pesannya tetap sopan.
        function periksaKataKasar(teks) {
            if (!teks) return { terdeteksi: false };
            const teksDisamarkan = _samarkanKeHurufAsli(teks.toLowerCase());
            for (const { regex } of _REGEX_KATA_KASAR) {
                if (regex.test(teksDisamarkan)) return { terdeteksi: true };
            }
            return { terdeteksi: false };
        }

        // Modal peringatan (bukan alert() bawaan browser) yang muncul kalau
        // kata kasar terdeteksi saat kirim saran. SENGAJA TIDAK auto-close --
        // cuma hilang kalau tombol "Tutup" diklik manual.
        function tampilkanModalKataKasar() {
            const modal = document.getElementById('modal-kata-kasar');
            if (!modal) return;

            // Restart animasi X & ring (satu kali putar, BUKAN infinite) tiap
            // kali modal dibuka lagi (kalau cuma classList show, animasi CSS-nya
            // tidak akan replay dari awal).
            modal.querySelectorAll('.crossmark-circle, .crossmark-x1, .crossmark-x2, .modal-kata-kasar-ring').forEach(el => {
                el.style.animation = 'none';
                void el.offsetWidth; // paksa reflow
                el.style.animation = '';
            });

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }

        function tutupModalKataKasar() {
            const modal = document.getElementById('modal-kata-kasar');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }

        const KEY_SARAN_SISWA = 'student_suggestions';

        // Cache di memori (bukan cuma localStorage) buat daftar saran versi
        // admin -- dipakai renderDaftarSaranAdmin()/cariSaranAdmin()/
        // gantiHalamanSaranAdmin() supaya bisa saring (search) & paginasi
        // TANPA fetch ulang ke server tiap kali siswa admin ketik di kolom
        // pencarian atau pindah halaman. Perlu ada paginasi krn saran yang
        // masuk bisa 1000+ -- render semuanya sekaligus ke DOM bakal berat.
        let _saranAdminDataCache = [];
        let _saranAdminHalamanSekarang = 1;
        const SARAN_ADMIN_PER_HALAMAN = 20;

        function getSaranSiswaLokal() {
            try {
                const raw = localStorage.getItem(KEY_SARAN_SISWA);
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }



        function kirimSaranSiswa() {
            const inputSaran = document.getElementById('input-saran-siswa');
            if (!inputSaran) return;
            const textSaran = inputSaran.value.trim();

            if (!textSaran) {
                tampilkanToast('Silakan ketik saran atau masukan terlebih dahulu!', 'warning');
                return;
            }

            if (periksaKataKasar(textSaran).terdeteksi) {
                tampilkanModalKataKasar();
                return;
            }

            const checkboxAnonim = document.getElementById('checkbox-anonim-saran-siswa');
            // Kalau dicentang: nama & kelas pengirim SENGAJA tidak ikut disimpan
            // sama sekali (bukan cuma disembunyikan di tampilan), supaya benar-benar
            // anonim -- sama seperti prinsip modal "Beri Saran/Evaluasi" untuk guru.
            const kirimAnonim = checkboxAnonim ? checkboxAnonim.checked : false;

            const daftarSaran = getSaranSiswaLokal();
            const now = getAccurateNow();
            const timestamp = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + 
                              String(now.getHours()).padStart(2, '0') + ':' + 
                              String(now.getMinutes()).padStart(2, '0') + ' WIB';

            const saranBaru = {
                id: `saran_${Date.now()}`,
                anonim: kirimAnonim,
                nama: kirimAnonim ? null : NAMA_SISWA_AKTIF,
                kelas: kirimAnonim ? null : getKelasAktifQuiz(),
                saran: textSaran,
                waktu: timestamp
            };
            daftarSaran.push(saranBaru);
            localStorage.setItem(KEY_SARAN_SISWA, JSON.stringify(daftarSaran));
            simpanSaranKeServer(saranBaru, saranBaru.id);

            inputSaran.value = '';
            if (checkboxAnonim) checkboxAnonim.checked = false;
            tampilkanToast('Terima kasih! Saran Anda telah berhasil dikirim ke sistem.', 'sukses');
            triggerDynamicIsland("Saran berhasil dikirim!");
            renderDaftarSaranAdmin(daftarSaran);
        }

        // ============================================================
        // SINKRONISASI KOTAK SARAN KE SERVER (endpoint SENDIRI, /api/saran/...
        // -- pola fire-and-forget + retry 1x SAMA persis ditiru dari
        // simpanPrestasiKeServer, supaya kirim saran tetap coba jalan walau
        // tab langsung ditinggal/pindah halaman setelah tombol "Kirim Saran"
        // ditekan. Server MEMBUAT ULANG id (bukan percaya id kiriman client,
        // lihat api_saran_kirim di app.py) supaya 2 saran dari pengirim beda
        // tidak pernah kebetulan bentrok id -- makanya begitu server balas
        // sukses, id lokal (idSementara) ditimpa dengan id resmi dari server
        // supaya sinkronkanSaranDenganServer() nanti tidak menganggapnya 2
        // saran yang beda (dobel).
        // ============================================================
        function simpanSaranKeServer(saranBaru, idSementara, percobaanUlang) {
            fetch('/api/saran/kirim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({ data: saranBaru, expected_username: USERNAME_SISWA_ASLI })
            })
                .then(res => res.json())
                .then(hasil => {
                    if (hasil && hasil.session_mismatch) tampilkanPeringatanSesiBerubah();
                    if (hasil && hasil.success && hasil.data && hasil.data.id) {
                        const daftar = getSaranSiswaLokal();
                        const idx = daftar.findIndex(item => item.id === idSementara);
                        if (idx !== -1) {
                            daftar[idx] = hasil.data;
                            localStorage.setItem(KEY_SARAN_SISWA, JSON.stringify(daftar));
                            renderDaftarSaranAdmin(daftar);
                        }
                    }
                })
                .catch(() => {
                    if (!percobaanUlang) {
                        setTimeout(() => simpanSaranKeServer(saranBaru, idSementara, true), 1500);
                    }
                });
        }

        // Tarik SEMUA saran (lintas siswa/kelas/perangkat) dari server lalu
        // render ke panel Kotak Saran -- panel ini sendiri HANYA dimunculkan
        // buat akun 'siswa' (AHMAD FAKHRI AL FARISI), jadi daftar saran yang
        // masuk kebaca SAMA persis baik dibuka dari HP maupun laptop, tidak
        // cuma nyangkut di localStorage 1 browser doang seperti versi lama.
        async function sinkronkanSaranDenganServer() {
            try {
                const res = await fetch('/api/saran/list');
                const hasil = await res.json();
                if (!hasil || !hasil.success) return;
                const dariServer = Array.isArray(hasil.data) ? hasil.data : [];

                // Gabung dengan yang ada di lokal (mis. baru saja kirim tapi
                // belum sempat ke-fetch balik dari server) -- pola sama
                // seperti sinkronkanPrestasiDenganServer.
                const dariLokal = getSaranSiswaLokal();
                const peta = new Map();
                dariServer.forEach(item => peta.set(item.id, item));
                dariLokal.forEach(item => { if (!peta.has(item.id)) peta.set(item.id, item); });
                const gabungan = Array.from(peta.values());
                localStorage.setItem(KEY_SARAN_SISWA, JSON.stringify(gabungan));

                renderDaftarSaranAdmin(gabungan);
            } catch (e) {
                // Offline/endpoint belum ada -> tetap tampilkan yang ada di lokal
                renderDaftarSaranAdmin(getSaranSiswaLokal());
            }
        }

        // Render daftar "Saran Masuk" (khusus admin) dengan pencarian +
        // paginasi -- dipanggil dengan ARGUMEN (array data baru dari server/
        // lokal) setiap kali ada data baru masuk (lewat sinkronkanSaranDenganServer,
        // kirimSaranSiswa, atau callback simpanSaranKeServer), dan TANPA
        // ARGUMEN (pakai _saranAdminDataCache yang sudah ada) setiap kali
        // cuma ganti halaman atau ganti kata kunci pencarian, supaya tidak
        // perlu fetch ulang ke server berkali-kali.
        function renderDaftarSaranAdmin(daftarSaranBaru) {
            if (Array.isArray(daftarSaranBaru)) {
                _saranAdminDataCache = daftarSaranBaru;
            }

            const listEl = document.getElementById('list-kotak-saran-admin');
            const elKosong = document.getElementById('kotak-saran-admin-kosong');
            const elJumlah = document.getElementById('kotak-saran-admin-jumlah');
            const elPaginasi = document.getElementById('pagination-kotak-saran-admin');
            if (!listEl) return;

            const kataKunci = (document.getElementById('input-cari-saran-admin')?.value || '').trim().toLowerCase();

            // Terbaru di atas -- diurutkan dari timestamp yang disisipkan di
            // id tiap saran (saran_<ts>), sama seperti pola id di prestasi.
            let terurut = [..._saranAdminDataCache].sort((a, b) => {
                const idA = Number(String(a.id || '').split('_')[1]) || 0;
                const idB = Number(String(b.id || '').split('_')[1]) || 0;
                return idB - idA;
            });

            if (kataKunci) {
                terurut = terurut.filter(item => {
                    const nama = (item.anonim ? 'anonim' : (item.nama || 'anonim')).toLowerCase();
                    const kelas = String(item.kelas || '').toLowerCase();
                    const isi = String(item.saran || '').toLowerCase();
                    return nama.includes(kataKunci) || kelas.includes(kataKunci) || isi.includes(kataKunci);
                });
            }

            if (elJumlah) {
                elJumlah.textContent = kataKunci
                    ? `${terurut.length} saran cocok dari total ${_saranAdminDataCache.length} saran masuk`
                    : `${_saranAdminDataCache.length} saran masuk`;
            }

            if (terurut.length === 0) {
                listEl.innerHTML = '';
                if (elKosong) {
                    elKosong.textContent = kataKunci ? 'Tidak ada saran yang cocok dengan pencarian.' : 'Belum ada saran yang masuk.';
                    elKosong.classList.remove('hidden');
                }
                if (elPaginasi) { elPaginasi.classList.add('hidden'); elPaginasi.innerHTML = ''; }
                return;
            }
            if (elKosong) elKosong.classList.add('hidden');

            // ---- Paginasi: jumlah saran bisa 1000+, jadi TIDAK dirender
            // sekaligus semua -- cuma SARAN_ADMIN_PER_HALAMAN item per halaman.
            const totalHalaman = Math.max(1, Math.ceil(terurut.length / SARAN_ADMIN_PER_HALAMAN));
            if (_saranAdminHalamanSekarang > totalHalaman) _saranAdminHalamanSekarang = totalHalaman;
            if (_saranAdminHalamanSekarang < 1) _saranAdminHalamanSekarang = 1;
            const mulai = (_saranAdminHalamanSekarang - 1) * SARAN_ADMIN_PER_HALAMAN;
            const halamanIni = terurut.slice(mulai, mulai + SARAN_ADMIN_PER_HALAMAN);

            listEl.innerHTML = halamanIni.map(item => {
                const namaTampil = item.anonim ? 'Anonim' : (item.nama || 'Anonim');
                const kelasTampil = (!item.anonim && item.kelas) ? ` • ${item.kelas}` : '';
                return `
                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                        <div class="flex items-center justify-between mb-1 gap-2">
                            <span class="text-xs font-bold text-slate-700 truncate">${namaTampil}${kelasTampil}</span>
                            <span class="text-[10px] text-slate-400 flex-shrink-0">${item.waktu || ''}</span>
                        </div>
                        <p class="text-xs text-slate-600 leading-relaxed break-words">${item.saran || ''}</p>
                    </div>
                `;
            }).join('');

            if (elPaginasi) {
                if (totalHalaman <= 1) {
                    elPaginasi.classList.add('hidden');
                    elPaginasi.innerHTML = '';
                } else {
                    elPaginasi.classList.remove('hidden');
                    elPaginasi.innerHTML = `
                        <button onclick="gantiHalamanSaranAdmin(-1)" ${_saranAdminHalamanSekarang <= 1 ? 'disabled' : ''} aria-label="Halaman sebelumnya" class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <i class="fa-solid fa-chevron-left text-[10px]"></i>
                        </button>
                        <span class="text-xs text-slate-500 font-medium px-2">Halaman ${_saranAdminHalamanSekarang} dari ${totalHalaman}</span>
                        <button onclick="gantiHalamanSaranAdmin(1)" ${_saranAdminHalamanSekarang >= totalHalaman ? 'disabled' : ''} aria-label="Halaman berikutnya" class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <i class="fa-solid fa-chevron-right text-[10px]"></i>
                        </button>
                    `;
                }
            }
        }

        // Dipanggil dari kolom pencarian (oninput) -- ganti kata kunci selalu
        // balik ke halaman 1 dulu, supaya tidak nyangkut di halaman kosong
        // kalau hasil pencarian sebelumnya lebih sedikit halamannya.
        function cariSaranAdmin() {
            _saranAdminHalamanSekarang = 1;
            renderDaftarSaranAdmin();
        }

        function gantiHalamanSaranAdmin(delta) {
            _saranAdminHalamanSekarang += delta;
            renderDaftarSaranAdmin();
        }

        // ============================================================
        // Reveal bagian "Saran Masuk" (daftar saran, khusus admin) didaftarkan
        // lewat listener DOMContentLoaded TERPISAH dari listener
        // /* ================= INIT ================= */ yang besar di bawah
        // (tempat Panel Akun Dummy & Panel Dummy Leaderboard di-reveal).
        // SENGAJA dipisah + dibungkus try/catch: browser tetap memanggil
        // SEMUA listener 'DOMContentLoaded' yang terdaftar sekalipun salah
        // satunya lempar error di tengah jalan -- tapi baris-baris SETELAH
        // baris yang error di listener yang SAMA tidak akan pernah jalan.
        // Berarti kalau ada error tak terduga di suatu tempat SEBELUM baris
        // reveal ini di listener utama, bagian admin (yang taruhannya di
        // akhir urutan) ikut gak pernah kebuka -- padahal error itu sama
        // sekali bukan salah kode panel ini. Listener sendiri begini bikin
        // reveal-nya kebal dari masalah di bagian lain script.
        //
        // Kotak "Kirim Saran" sendiri TIDAK perlu di-reveal di sini karena
        // sudah tampil default untuk semua siswa (lihat HTML). Yang
        // di-reveal cuma sub-bagian daftar "Saran Masuk" -- dan
        // sinkronkanSaranDenganServer() (yang menarik SEMUA saran dari
        // server) HANYA dipanggil untuk akun admin.
        // ============================================================
        document.addEventListener('DOMContentLoaded', function () {
            try {
                if (typeof USERNAME_SISWA_ASLI !== 'undefined' && USERNAME_SISWA_ASLI === 'siswa') {
                    const wrapperDaftarSaran = document.getElementById('wrapper-daftar-saran-admin');
                    if (wrapperDaftarSaran) wrapperDaftarSaran.classList.remove('hidden');
                    sinkronkanSaranDenganServer();
                }
            } catch (e) {
                console.error('Gagal memunculkan daftar Saran Masuk (admin):', e);
            }
        });

        function toggleProfileDropdown(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('profile-dropdown');
            const moreDropdown = document.getElementById('dropdown-more-header');
            const btnProfilBawah = document.querySelector('.bottom-nav-item[data-bottom-tab="profil"]');
            if (moreDropdown) moreDropdown.classList.add('hidden');
            if (dropdown) {
                const akanTampil = dropdown.classList.contains('hidden');
                dropdown.classList.toggle('hidden');
                if (btnProfilBawah) btnProfilBawah.classList.toggle('bottom-nav-item--active', akanTampil);
                if (akanTampil) {
                    // Pastikan panel selalu mulai kebaca dari atas (foto profil dulu),
                    // bukan langsung ke bagian tengah/bawah. Header sudah "sticky top-0",
                    // jadi dropdown TIDAK perlu di-scrollIntoView ke halaman -- itu justru
                    // yang bikin panel ke-scroll turun & foto profil ke-geser ke luar layar.
                    dropdown.scrollTop = 0;
                }
            }
        }

        // Diklik dari avatar/tombol "Lihat ID Card & Bio Kamu" di dropdown profil.
        // Sengaja pakai modal ID Card yang SAMA dengan yang dipakai untuk lihat
        // profil teman (bukaIdCardTeman) -- supaya foto profil+border, efek nama,
        // title/badge, dan kotak sosmed (kuning) tampil identik persis seperti
        // sketsa, bukan modal foto polos yang terpisah seperti sebelumnya.
        // Statusnya otomatis kebaca 'diri_sendiri' oleh backend (username yang
        // dikirim = akun yang lagi login sendiri), jadi tombol aksi di bawah
        // otomatis jadi "Ini Kamu" & bagian Bio Singkat ikut dimunculkan.
        function lihatProfilSendiri(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('profile-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
            bukaIdCardTeman(USERNAME_SISWA_AKTIF);
        }

        // Fungsi (bukan const) supaya aman dari urutan deklarasi ID_SISWA_AKTIF.
        function keyStudentBio() { return `student_bio_${ID_SISWA_AKTIF}`; }

        function simpanBioSiswa() {
            const inputBio = document.getElementById('input-bio-siswa');
            if (!inputBio) return;
            const bioText = inputBio.value.trim();
            localStorage.setItem(keyStudentBio(), bioText);
            triggerDynamicIsland('Bio berhasil disimpan!');
        }

        function loadBioSiswa() {
            const inputBio = document.getElementById('input-bio-siswa');
            if (!inputBio) return;
            inputBio.value = localStorage.getItem(keyStudentBio()) || '';
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('profile-dropdown');
            const trigger = document.getElementById('profile-menu-trigger');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });

        function keyStudentProfilePhoto() { return `student_profile_photo_${ID_SISWA_AKTIF}`; }

        // Foto profil dikompres dulu lewat canvas sebelum disimpan (sisi terpanjang
        // dibatasi 400px, JPEG kualitas 0.8) -- sama prinsipnya dengan
        // kompresGambarUntukTugas(), tapi ukurannya dibuat lebih kecil lagi karena
        // foto profil cuma tampil sebagai avatar bulat kecil, tidak perlu resolusi
        // tinggi.
        //
        // BUG YANG DIPERBAIKI: sebelum ini, foto profil disimpan MENTAH-MENTAH dari
        // hasil reader.readAsDataURL(file) -- kalau diambil langsung dari kamera HP
        // bisa beberapa MB. Foto ini disisipkan PENUH ke setiap entri leaderboard
        // (lihat sinkronkanLeaderboardDenganPoinTerbaik: foto: getFotoProfilAktifQuiz()),
        // dikali 3 level (easy/medium/hard) -- jadi payload yang dikirim ke
        // Foto profil sekarang TIDAK langsung dipakai apa adanya begitu siswa
        // pilih file -- dibuka dulu di modal "Atur Foto Profil" (#modal-crop-foto)
        // supaya siswa bisa geser posisi & zoom, milih sendiri bagian mana dari
        // fotonya yang mau jadi foto profil, baru di-crop persegi ~400px lewat
        // simpanCropFoto() (nilai 400px & JPEG 0.85 dipilih senada dengan
        // kompresi lama, supaya hasil akhirnya tetap kecil -- lihat catatan lama
        // di prosesFotoProfilBaru() soal batas ukuran request keepalive:true).
        let cropState = null;
        let cropDragState = null;

        async function updateProfilePhoto(event) {
            const file = event.target.files[0];
            const inputEl = event.target;
            if (!file) return;

            let dataUrl;
            try {
                dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Gagal membaca file'));
                    reader.readAsDataURL(file);
                });
            } catch (err) {
                tampilkanToast('Gagal membuka foto. Coba pilih file lain.', 'error');
                inputEl.value = '';
                return;
            }

            const img = new Image();
            img.onload = () => {
                inputEl.value = ''; // reset supaya bisa pilih file yang sama lagi nanti
                bukaModalCropFoto(img);
            };
            img.onerror = () => {
                tampilkanToast('Gagal memuat gambar. Coba pilih file lain.', 'error');
                inputEl.value = '';
            };
            img.src = dataUrl;
        }

        // ===== PREVIEW FOTO PROFIL (klik foto -> lihat foto yang SEDANG dipakai) =====
        // Ini SENGAJA dipisah dari updateProfilePhoto(). Klik foto profil sekarang
        // cuma menampilkan foto yang lagi aktif dalam ukuran besar (preview), TIDAK
        // langsung membuka galeri/kamera HP. Untuk ganti foto, siswa tetap harus
        // klik tombol/ikon "Ganti Foto" terpisah yang baru memicu input file
        // (lihat updateProfilePhoto di atas) -- supaya tidak ke-trigger galeri HP
        // tanpa sengaja cuma gara-gara mau lihat foto profilnya sendiri dulu.
        function bukaPreviewFotoProfilSendiri(event) {
            if (event) event.stopPropagation();
            const fotoAktif = (typeof getFotoProfilAktifQuiz === 'function')
                ? getFotoProfilAktifQuiz()
                : (document.getElementById('dropdown-user-avatar')?.src
                    || document.getElementById('header-user-avatar')?.src);
            if (!fotoAktif) return;

            let modal = document.getElementById('modal-preview-foto-profil');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'modal-preview-foto-profil';
                modal.className = 'fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-6';
                modal.innerHTML = `
                    <div class="relative max-w-sm w-full">
                        <button type="button" onclick="tutupPreviewFotoProfilSendiri()"
                            class="absolute -top-10 right-0 text-white text-3xl leading-none w-10 h-10 flex items-center justify-center">&times;</button>
                        <img id="img-preview-foto-profil-sendiri" src="" alt="Foto profil kamu"
                            class="w-full aspect-square object-cover rounded-2xl shadow-2xl bg-slate-800">
                    </div>`;
                // Klik area gelap di luar foto -> tutup modal
                modal.addEventListener('click', (e) => { if (e.target === modal) tutupPreviewFotoProfilSendiri(); });
                document.body.appendChild(modal);
            }
            document.getElementById('img-preview-foto-profil-sendiri').src = fotoAktif;
            modal.classList.remove('hidden');
        }

        function tutupPreviewFotoProfilSendiri() {
            const modal = document.getElementById('modal-preview-foto-profil');
            if (modal) modal.classList.add('hidden');
        }

        function bukaModalCropFoto(img) {
            const viewport = document.getElementById('crop-viewport');
            const imgEl = document.getElementById('crop-img');
            const zoomSlider = document.getElementById('crop-zoom');
            const vpSize = viewport.clientWidth || 320;

            // minScale: skala minimum supaya gambar SELALU menutupi penuh
            // viewport persegi (object-fit: cover, versi manual) -- jadi
            // waktu di-drag, tidak akan pernah ada celah kosong kelihatan.
            const minScale = Math.max(vpSize / img.naturalWidth, vpSize / img.naturalHeight);

            cropState = {
                img,
                naturalW: img.naturalWidth,
                naturalH: img.naturalHeight,
                vpSize,
                minScale,
                scale: minScale,
                translateX: (vpSize - img.naturalWidth * minScale) / 2,
                translateY: (vpSize - img.naturalHeight * minScale) / 2
            };

            imgEl.src = img.src;
            zoomSlider.value = 100;
            document.getElementById('modal-crop-foto').classList.remove('hidden');
            renderCropTransform();
            initCropDragHandlersSekali();
        }

        function tutupModalCropFoto() {
            document.getElementById('modal-crop-foto').classList.add('hidden');
            cropState = null;
            cropDragState = null;
        }

        function updateCropTransform() {
            if (!cropState) return;
            const zoomSlider = document.getElementById('crop-zoom');
            const mult = (parseFloat(zoomSlider.value) || 100) / 100;
            cropState.scale = cropState.minScale * mult;
            clampCropTranslate();
            renderCropTransform();
        }

        function clampCropTranslate() {
            const s = cropState;
            if (!s) return;
            const dispW = s.naturalW * s.scale;
            const dispH = s.naturalH * s.scale;
            const minX = s.vpSize - dispW;
            const minY = s.vpSize - dispH;
            s.translateX = Math.min(0, Math.max(minX, s.translateX));
            s.translateY = Math.min(0, Math.max(minY, s.translateY));
        }

        function renderCropTransform() {
            if (!cropState) return;
            const imgEl = document.getElementById('crop-img');
            imgEl.style.width = `${cropState.naturalW * cropState.scale}px`;
            imgEl.style.height = `${cropState.naturalH * cropState.scale}px`;
            imgEl.style.transform = `translate(${cropState.translateX}px, ${cropState.translateY}px)`;
        }

        // Drag (geser posisi) pakai Pointer Events -- kepasang SEKALI saja ke
        // viewport (bukan tiap kali modal dibuka), supaya listener tidak
        // dobel-dobel numpuk tiap ganti foto berkali-kali dalam satu sesi.
        let _cropDragHandlersTerpasang = false;
        function initCropDragHandlersSekali() {
            if (_cropDragHandlersTerpasang) return;
            _cropDragHandlersTerpasang = true;
            const viewport = document.getElementById('crop-viewport');

            viewport.addEventListener('pointerdown', (e) => {
                if (!cropState) return;
                cropDragState = { startX: e.clientX, startY: e.clientY, origX: cropState.translateX, origY: cropState.translateY };
                viewport.setPointerCapture(e.pointerId);
            });
            viewport.addEventListener('pointermove', (e) => {
                if (!cropDragState || !cropState) return;
                cropState.translateX = cropDragState.origX + (e.clientX - cropDragState.startX);
                cropState.translateY = cropDragState.origY + (e.clientY - cropDragState.startY);
                clampCropTranslate();
                renderCropTransform();
            });
            const stopDrag = () => { cropDragState = null; };
            viewport.addEventListener('pointerup', stopDrag);
            viewport.addEventListener('pointercancel', stopDrag);
            viewport.addEventListener('pointerleave', stopDrag);
        }

        function simpanCropFoto() {
            if (!cropState) return;
            const OUT = 400; // ukuran akhir foto profil, senada dengan kompresi lama
            const canvas = document.createElement('canvas');
            canvas.width = OUT;
            canvas.height = OUT;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Gambar penuh digambar ulang ke canvas OUT x OUT, diskalakan &
            // digeser mengikuti transform yang lagi kelihatan di viewport --
            // jadi persis area yang siswa lihat di dalam lingkaran itulah yang
            // ke-crop jadi foto profil akhirnya.
            const factor = OUT / cropState.vpSize;
            ctx.drawImage(
                cropState.img,
                0, 0, cropState.naturalW, cropState.naturalH,
                cropState.translateX * factor, cropState.translateY * factor,
                cropState.naturalW * cropState.scale * factor, cropState.naturalH * cropState.scale * factor
            );

            const base64Image = canvas.toDataURL('image/jpeg', 0.85);
            tutupModalCropFoto();
            prosesFotoProfilBaru(base64Image);
        }

        async function prosesFotoProfilBaru(base64Image) {
            localStorage.setItem(keyStudentProfilePhoto(), base64Image);

            const headerAvatar = document.getElementById('header-user-avatar');
            const dropdownAvatar = document.getElementById('dropdown-user-avatar');
            const islandAvatar = document.getElementById('island-user-avatar');
            const greetingAvatar = document.getElementById('greeting-card-avatar');
            if (headerAvatar) headerAvatar.src = base64Image;
            if (dropdownAvatar) { dropdownAvatar.src = base64Image; dropdownAvatar.style.display = ''; }
            if (islandAvatar) islandAvatar.src = base64Image;
            if (greetingAvatar) greetingAvatar.src = base64Image;

            // Foto baru langsung disebar ke SEMUA entri leaderboard milik
            // siswa ini (bukan cuma foto di header/dropdown) supaya foto
            // di leaderboard tersinkron realtime, tanpa perlu main quiz
            // ulang. renderLeaderboardQuiz() aman dipanggil walau tab Quiz
            // sedang tidak aktif (elemennya tetap ada di DOM, cuma disembunyikan).
            if (typeof renderLeaderboardQuiz === 'function') renderLeaderboardQuiz();

            // BUG YANG DIPERBAIKI: renderLeaderboardQuiz() di atas cuma
            // memperbarui TAMPILAN foto untuk entri "milik saya sendiri" saat
            // dilihat DI BROWSER INI (lihat renderLeaderboardQuiz: iniSayaSendiri
            // ? getFotoProfilAktifQuiz() : entri.foto). Untuk siswa LAIN yang
            // melihat leaderboard (mis. Ahmad melihat leaderboard-nya Syam),
            // yang dipakai adalah entri.foto -- snapshot foto yang dibekukan
            // di data.leaderboard sejak TERAKHIR KALI quiz itu diselesaikan &
            // disimpan ke server. Tanpa langkah di bawah ini, snapshot lama itu
            // tidak pernah ikut berubah sampai siswa main quiz lagi -- jadi
            // siswa lain tetap melihat foto LAMA walau siswa ini sudah ganti
            // foto profilnya. Di sini kita update field "foto" pada SEMUA
            // entri leaderboard milik siswa ini (baik jenis Pilihan Ganda
            // maupun Essay) lalu simpan ulang ke localStorage & server, supaya
            // foto baru langsung kelihatan oleh siswa lain juga.
            sebarkanFotoTerbaruKeSnapshotLeaderboard();

            triggerDynamicIsland("Foto profil diperbarui!");

            // Simpan juga ke server (pola sama seperti border_aktif via
            // /api/profil/border) -- supaya siswa LAIN yang pakai "Cari Teman"
            // bisa lihat foto profil asli yang beneran lagi dipakai, bukan
            // placeholder generik. Responsnya dicek eksplisit (bukan cuma
            // .catch error jaringan) supaya kalau gagal tersimpan di server
            // (mis. sesi kadaluarsa), siswa langsung tahu -- bukan diam-diam
            // gagal & baru ketauan belakangan pas orang lain bilang fotonya
            // nggak muncul. Notifnya TIDAK auto-hilang (beda dari toast lain
            // yang 8 detik ilang sendiri) -- sengaja, karena info kesimpan-nya-
            // di-server-atau-tidak ini penting untuk tidak terlewat, jadi
            // siswa harus klik X sendiri buat nutup.
            try {
                const res = await fetch('/api/profil/foto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ foto: base64Image })
                });
                const json = await res.json().catch(() => null);
                if (!res.ok || !json || !json.success) {
                    console.error('Gagal menyimpan foto profil ke server:', res.status, json);
                    tampilkanToastFotoProfil(false);
                } else {
                    tampilkanToastFotoProfil(true);
                }
            } catch (e) {
                console.error('Gagal menyimpan foto profil ke server:', e);
                tampilkanToastFotoProfil(false);
            }
        }

        // Toast konfirmasi ganti foto profil -- SENGAJA tidak auto-hilang
        // sendiri (beda dari toast lain di aplikasi ini yang pakai
        // setTimeout ~8 detik), harus ditutup manual lewat tombol X supaya
        // info berhasil/gagal tersimpan ke server tidak gampang kelewat.
        function tampilkanToastFotoProfil(berhasil) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            const toastId = `toast-foto-profil-${Date.now()}`;
            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik' + (berhasil ? ' notif-toast-hijau' : '');
            toast.id = toastId;

            const iconWrapClass = berhasil ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
            const iconClass = berhasil ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
            const judul = berhasil ? 'Foto Profil Diperbarui!' : 'Foto Gagal Tersimpan ke Server';
            const warnaKelas = berhasil ? 'text-emerald-600' : 'text-rose-600';
            const pesan = berhasil
                ? 'Foto barumu sudah tersimpan & langsung kelihatan oleh siswa lain lewat "Cari Teman".'
                : 'Foto berhasil diganti di perangkat ini, tapi GAGAL disimpan ke server -- siswa lain yang mencarimu lewat "Cari Teman" belum akan melihat foto barumu. Coba ganti ulang atau hubungi admin kalau terus gagal.';

            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg ${iconWrapClass} flex items-center justify-center flex-shrink-0">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">${judul}</p>
                        <p class="text-[11px] ${warnaKelas} mt-1 leading-relaxed font-semibold">${pesan}</p>
                    </div>
                    <button onclick="document.getElementById('${toastId}')?.remove()" class="text-slate-300 hover:text-slate-500 flex-shrink-0" title="Tutup">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);
            // TIDAK ADA setTimeout di sini -- toast ini sengaja tetap nongol
            // sampai siswa klik tombol X sendiri.
        }

        function sebarkanFotoTerbaruKeSnapshotLeaderboard() {
            const fotoBaru = getFotoProfilAktifQuiz();

            try {
                const dataPg = getQuizData();
                if (dataPg && Array.isArray(dataPg.leaderboard)) {
                    let berubah = false;
                    dataPg.leaderboard.forEach(entri => {
                        if (entri.nama === NAMA_PEMAIN_QUIZ && entri.foto !== fotoBaru) {
                            entri.foto = fotoBaru;
                            berubah = true;
                        }
                    });
                    if (berubah) saveQuizData(dataPg);
                }
            } catch (e) { console.error('Gagal sebar foto ke leaderboard PG:', e); }

            try {
                const dataEssay = getQuizEssayData();
                if (dataEssay && Array.isArray(dataEssay.leaderboard)) {
                    let berubah = false;
                    dataEssay.leaderboard.forEach(entri => {
                        if (entri.nama === NAMA_PEMAIN_QUIZ && entri.foto !== fotoBaru) {
                            entri.foto = fotoBaru;
                            berubah = true;
                        }
                    });
                    if (berubah) saveQuizEssayData(dataEssay);
                }
            } catch (e) { console.error('Gagal sebar foto ke leaderboard Essay:', e); }
        }

        // BUG YANG DIPERBAIKI: dulu fungsi ini malah nimpa foto yang sudah
        // dirender SERVER (lewat src="{{ foto_profil }}" di header/dropdown/
        // island -- sudah otomatis kepasang sejak HTML awal dimuat, jadi
        // sudah paling akurat & terbaru) pakai foto LAMA yang kebetulan
        // ke-cache di localStorage PERANGKAT INI. Akibatnya foto profil bisa
        // beda-beda antar perangkat (HP vs laptop) walau login pakai akun
        // yang sama persis -- masing-masing perangkat nampilin cache lokalnya
        // sendiri-sendiri, bukan data server yang sesungguhnya.
        //
        // Sekarang dibalik: server dianggap sumber kebenaran (sesuai foto
        // yang barusan dirender ke elemen avatar), dan localStorage
        // perangkat ini yang disamakan supaya IKUT foto server itu -- bukan
        // sebaliknya. localStorage tetap kepakai (mis. oleh
        // getFotoProfilAktifQuiz() saat submit skor quiz), tapi sekarang
        // isinya selalu disegarkan dulu mengikuti server tiap kali halaman
        // dibuka, sehingga otomatis konsisten di semua perangkat begitu
        // login ulang / reload.
        function loadSavedProfilePhoto() {
            const headerAvatar = document.getElementById('header-user-avatar');
            const fotoDariServer = headerAvatar ? headerAvatar.getAttribute('src') : null;
            if (fotoDariServer) {
                localStorage.setItem(keyStudentProfilePhoto(), fotoDariServer);
            }
        }

        // ===== Identitas akun yang sedang login (dikirim dari Flask session) =====
        // Dipakai supaya nama yang tampil & data progres (quiz/border/prestasi)
        // benar-benar ikut akun yang login, bukan data dummy/akun lain yang
        // kebetulan pernah login di browser yang sama.
        const NAMA_SISWA_ASLI = window.NAMA_SISWA_ASLI;
        const USERNAME_SISWA_ASLI = window.USERNAME_SISWA_ASLI;

        // ===== PROFIL AKUN DUMMY (khusus mode "coba sebagai akun lain") =====
        // Kalau user sedang "memakai" salah satu profil dummy (lewat Panel Akun
        // Dummy di sidebar), identitas efektif di-override DI SINI, SEBELUM
        // ID_SISWA_AKTIF dihitung. Karena SEMUA key localStorage progres pribadi
        // (quiz, essay, border, prestasi, riwayat, bell, dst) di bawah diturunkan
        // dari ID_SISWA_AKTIF, otomatis tiap profil dummy punya "kotak" save
        // sendiri-sendiri, terpisah dari akun asli maupun dummy lain — tanpa
        // perlu ubah 1 pun key yang sudah ada. Akun asli (session Flask) TIDAK
        // pernah ikut berubah oleh ini, cuma tampilan & localStorage di browser.
        const DUMMY_PROFILES_KEY = 'akun_dummy_profil_list';
        const ACTIVE_DUMMY_KEY = 'akun_dummy_aktif';

        function getDaftarAkunDummy() {
            try {
                return JSON.parse(localStorage.getItem(DUMMY_PROFILES_KEY) || '[]');
            } catch (e) { return []; }
        }
        function simpanDaftarAkunDummy(list) {
            localStorage.setItem(DUMMY_PROFILES_KEY, JSON.stringify(list));
        }
        function getAkunDummyAktif() {
            try {
                // sessionStorage (bukan localStorage) SENGAJA dipakai di sini supaya
                // "akun dummy aktif" itu unik per-TAB, bukan kepakai bareng ke semua
                // tab dalam 1 browser. Jadi tab 1 bisa jadi Ahmad, tab 2 bisa jadi
                // Syam, tanpa saling timpa nama pas salah satu di-refresh. Daftar
                // profil dummy (DUMMY_PROFILES_KEY) & data kelas (tasks_XII_TKJ_3)
                // tetap di localStorage karena memang harus dibagi ke semua tab.
                const raw = sessionStorage.getItem(ACTIVE_DUMMY_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        }

        // BUG YANG DIPERBAIKI: ACTIVE_DUMMY_KEY di localStorage itu punya
        // browser (bukan punya akun), jadi kalau browser ini PERNAH dipakai
        // "coba sebagai akun dummy" (mis. bernama Syam), status dummy itu
        // nyangkut terus -- bahkan setelah logout dan login lagi pakai akun
        // ASLI yang berbeda (mis. akun 'siswa' / AHMAD FAKHRI AL FARISI).
        // Makanya nama yang tampil bisa "ketiban" nama dummy lama walau
        // login-nya sudah benar di sisi server.
        //
        // Fix: simpan username akun ASLI (dari session Flask) yang terakhir
        // dipakai login DI BROWSER INI. Begitu login berikutnya pakai akun
        // asli yang BEDA dari yang tersimpan, otomatis keluar dari mode
        // dummy (sisa punya login sebelumnya) sebelum identitas dihitung.
        const KEY_AKUN_ASLI_TERAKHIR = 'akun_asli_login_terakhir';
        (function bersihkanSisaModeDummyJikaGantiAkun() {
            const terakhir = localStorage.getItem(KEY_AKUN_ASLI_TERAKHIR);
            if (terakhir !== USERNAME_SISWA_ASLI) {
                sessionStorage.removeItem(ACTIVE_DUMMY_KEY);
                localStorage.setItem(KEY_AKUN_ASLI_TERAKHIR, USERNAME_SISWA_ASLI);
            }
        })();

        const AKUN_DUMMY_AKTIF = getAkunDummyAktif();

        const NAMA_SISWA_AKTIF = AKUN_DUMMY_AKTIF ? AKUN_DUMMY_AKTIF.nama : NAMA_SISWA_ASLI;
        const USERNAME_SISWA_AKTIF = AKUN_DUMMY_AKTIF ? AKUN_DUMMY_AKTIF.id : USERNAME_SISWA_ASLI;
        // Dipakai HANYA untuk namespace localStorage data pribadi siswa (quiz,
        // border, prestasi, dll). Kalau ada beberapa akun (asli maupun dummy)
        // login/dipakai gantian di browser yang sama, tiap akun tetap punya
        // "kotak" data sendiri-sendiri karena ID ini unik per akun.
        const ID_SISWA_AKTIF = USERNAME_SISWA_AKTIF || 'siswa';

        // ===== Border Admin/Developer: cuma untuk akun dev ASLI =====
        // Username 'siswa' di app.py adalah akun dev (AHMAD FAKHRI AL FARISI).
        // Border kategori "admin" HARUS selalu terbuka untuk dia, tapi TIDAK
        // PERNAH untuk akun lain (mis. 'syam' / SYAM KHOERATUL MUKMIN) maupun
        // untuk mode akun dummy manapun — walau browser yang sama pernah
        // dipakai login sebagai dev. Dicek dari USERNAME_SISWA_ASLI (session
        // Flask sungguhan), BUKAN dari nama tampilan, supaya tidak bisa
        // "ditipu" cuma dengan bikin dummy bernama sama.
        function akunIniAdminDev() {
            return !AKUN_DUMMY_AKTIF && USERNAME_SISWA_ASLI === 'siswa';
        }

        function pakaiAkunDummy(id) {
            const profil = getDaftarAkunDummy().find(p => p.id === id);
            if (!profil) return;
            sessionStorage.setItem(ACTIVE_DUMMY_KEY, JSON.stringify(profil));
            location.reload();
        }

        function kembaliKeAkunAsli() {
            sessionStorage.removeItem(ACTIVE_DUMMY_KEY);
            location.reload();
        }

        function buatAkunDummy(event) {
            event.preventDefault();
            const inputNama = document.getElementById('dummy-profil-nama');
            const inputKelas = document.getElementById('dummy-profil-kelas');
            const nama = inputNama.value.trim();
            const kelas = inputKelas.value.trim() || '-';
            if (!nama) return;

            const list = getDaftarAkunDummy();
            const profilBaru = {
                id: `dummy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                nama,
                kelas
            };
            list.push(profilBaru);
            simpanDaftarAkunDummy(list);
            inputNama.value = '';
            inputKelas.value = '';
            renderDaftarAkunDummy();
        }

        function hapusAkunDummy(id) {
            const list = getDaftarAkunDummy().filter(p => p.id !== id);
            simpanDaftarAkunDummy(list);
            // Kalau yang dihapus lagi dipakai, otomatis balik ke akun asli.
            if (AKUN_DUMMY_AKTIF && AKUN_DUMMY_AKTIF.id === id) {
                sessionStorage.removeItem(ACTIVE_DUMMY_KEY);
                location.reload();
                return;
            }
            renderDaftarAkunDummy();
        }

        function renderDaftarAkunDummy() {
            const container = document.getElementById('list-akun-dummy-profil');
            if (!container) return;
            const list = getDaftarAkunDummy();

            if (!list.length) {
                container.innerHTML = `<p class="text-[10px] text-slate-400 text-center py-2">Belum ada akun dummy. Buat lewat form di atas.</p>`;
            } else {
                container.innerHTML = '';
                list.forEach(profil => {
                    const aktif = AKUN_DUMMY_AKTIF && AKUN_DUMMY_AKTIF.id === profil.id;
                    const row = document.createElement('div');
                    row.className = `flex items-center justify-between gap-2 p-2 bg-white border rounded-lg ${aktif ? 'border-purple-400 ring-1 ring-purple-300' : 'border-slate-200'}`;
                    row.innerHTML = `
                        <div class="min-w-0">
                            <p class="text-[11px] font-bold text-slate-800 truncate">${profil.nama} ${aktif ? '<span class="text-purple-600">(sedang dipakai)</span>' : ''}</p>
                            <p class="text-[9px] text-slate-400 truncate">${profil.kelas}</p>
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">
                            ${aktif ? '' : `<button class="btn-pakai-dummy text-purple-600 hover:text-purple-800 px-1.5 py-1" title="Login sebagai akun dummy ini"><i class="fa-solid fa-right-to-bracket text-[11px]"></i></button>`}
                            <button class="btn-hapus-dummy text-rose-500 hover:text-rose-700 px-1.5 py-1" title="Hapus akun dummy ini"><i class="fa-solid fa-trash text-[11px]"></i></button>
                        </div>
                    `;
                    if (!aktif) row.querySelector('.btn-pakai-dummy').addEventListener('click', () => pakaiAkunDummy(profil.id));
                    row.querySelector('.btn-hapus-dummy').addEventListener('click', () => hapusAkunDummy(profil.id));
                    container.appendChild(row);
                });
            }

            const banner = document.getElementById('banner-mode-dummy');
            if (banner) banner.classList.toggle('hidden', !AKUN_DUMMY_AKTIF);
            const bannerNama = document.getElementById('banner-mode-dummy-nama');
            if (bannerNama && AKUN_DUMMY_AKTIF) bannerNama.textContent = AKUN_DUMMY_AKTIF.nama;
        }

        function terapkanIdentitasEfektif() {
            // Timpa semua tempat yang nampilin nama supaya konsisten dengan
            // profil yang sedang aktif (asli atau dummy), tanpa perlu render
            // ulang dari server.
            document.querySelectorAll('.nama-siswa-efektif').forEach(el => {
                el.textContent = NAMA_SISWA_AKTIF;
            });
        }

        // ===== Penyimpanan Tugas Multi (Banyak Tugas per Kelas) =====
        // Kelas ini nyimpen ARRAY tugas, bukan 1 objek tunggal, jadi tugas baru dari
        // guru MENAMBAH ke daftar dan tugas lama yang belum dikerjakan tetap muncul.
        // CATATAN: tugas & notifikasi tugas SENGAJA tetap dinamespace per KELAS
        // (bukan per akun) karena memang data ini dibagikan bersama ke satu kelas.
        const KELAS_AKTIF_SISWA = 'XII_TKJ_3';

        // ===== Helper sinkron ke server (menggantikan localStorage-only) =====
        // Sama seperti di Dashboard Guru: kunci yang dipakai SAMA PERSIS dengan
        // kunci localStorage lama, cuma sekarang datanya betulan disimpan &
        // dibaca dari server (data/sync_store.json) supaya tugas yang diinput
        // guru dari device manapun langsung muncul juga di device siswa manapun.
        //
        // PERBAIKAN PERFORMA (PENTING): versi lama fungsi ini pakai
        // XMLHttpRequest SYNCHRONOUS (xhr.open(..., false)) -- itu bikin
        // SELURUH TAB BROWSER BENAR-BENAR FREEZE (jam berhenti, animasi
        // macet, klik tidak direspons) selama menunggu balasan server,
        // dan fungsi ini dipanggil lewat getTasksSiswa() di BELASAN tempat
        // termasuk tiap 3 detik lewat polling -- jadi tiap server sedikit
        // lambat (wajar di hosting 1 worker), seluruh dashboard ikut freeze.
        // Sekarang: getSync() SELALU balik nilai secara instan dari cache/
        // localStorage (tidak pernah menunggu network sama sekali), sambil
        // diam-diam nge-refresh cache-nya di background pakai fetch() biasa
        // (non-blocking) supaya pemanggilan BERIKUTNYA sudah dapat data
        // paling baru. Data yang ditampilkan bisa saja sepersekian detik
        // "tertinggal" dari server, tapi UI tidak akan pernah freeze lagi.
        const _cacheSync = {};
        // PERBAIKAN PERFORMA (PENTING): getSync() dipanggil lewat getTasksSiswa()
        // dari BELASAN fungsi render berbeda (updateTaskCounter, hitungStreakTugas,
        // cekPembaruanTugasRealtime, renderTugasTerdekat, dll). Sebelumnya TIAP
        // panggilan getSync() -- tidak peduli sudah berapa kali dipanggil dalam
        // satu detik yang sama -- SELALU memicu fetch baru ke server lewat
        // _refreshSyncDiBackground(), walau kunci yang sama baru saja (bahkan
        // sepersekian detik lalu) selesai di-fetch. Karena banyak fungsi itu
        // dipanggil beruntun dalam satu tick sinkronisasi 3 detik (lihat
        // jalankanSinkronisasiBerkalaDashboard), ini membanjiri server dengan
        // request duplikat ke endpoint yang sama persis sampai kena 429 (Too
        // Many Requests) -- inilah sumber utama dashboard kerasa berat.
        // Sekarang: setiap kunci punya jeda minimum JEDA_MIN_REFRESH_SYNC_MS
        // antar fetch, dan kalau fetch untuk kunci itu masih berjalan (belum
        // selesai), panggilan baru untuk kunci yang sama di-skip dulu (tidak
        // menumpuk request paralel). Data yang ditampilkan tetap maksimal
        // seusia jeda ini, jadi tidak terasa bedanya buat siswa.
        // NAIKKAN INTERVAL POLLING: sebelumnya 2500ms. Dinaikkan ke 8000ms
        // supaya sejalan dengan interval jalankanSinkronisasiBerkalaDashboard
        // (lihat dashboard_siswa_2.js) yang juga dinaikkan ke 8 detik -- kalau
        // jeda ini dibiarkan lebih pendek dari tick pemanggilnya, angkanya
        // percuma karena tidak akan pernah kepakai.
        const _lastFetchAtSync = {};
        const _pendingFetchSync = {};
        const JEDA_MIN_REFRESH_SYNC_MS = 8000;
        // PERFORMANCE OPTIMIZATION: 'tasks_<KELAS>' & 'notif_tugas_<KELAS>' HAMPIR
        // SELALU dibutuhkan bareng dalam tick yang sama (lihat
        // jalankanSinkronisasiBerkalaDashboard di dashboard_siswa_2.js), jadi
        // digabung jadi SATU request lewat /api/sync/bulk alih-alih 2 request
        // /api/sync/<kunci> terpisah. Kunci lain (di luar 2 ini) TIDAK disentuh,
        // tetap lewat jalur fetch satuan seperti semula.
        const KUNCI_BULK_TUGAS = [`tasks_${KELAS_AKTIF_SISWA}`, `notif_tugas_${KELAS_AKTIF_SISWA}`];
        function getSync(kunci, fallback) {
            _refreshSyncDiBackground(kunci, fallback);
            if (kunci in _cacheSync) return _cacheSync[kunci];
            const raw = localStorage.getItem(kunci);
            const nilaiLokal = raw ? JSON.parse(raw) : fallback;
            _cacheSync[kunci] = nilaiLokal;
            return nilaiLokal;
        }
        function _refreshSyncDiBackground(kunci, fallback) {
            if (_pendingFetchSync[kunci]) return; // masih ada fetch kunci ini yang berjalan, jangan tumpuk lagi
            const terakhirDifetch = _lastFetchAtSync[kunci] || 0;
            if (Date.now() - terakhirDifetch < JEDA_MIN_REFRESH_SYNC_MS) return; // masih terlalu baru, skip dulu

            // PERFORMANCE OPTIMIZATION: kunci yang termasuk grup KUNCI_BULK_TUGAS
            // dialihkan ke _refreshSyncBulkTugasDiBackground() (pakai
            // /api/sync/bulk, gabung 1 request) -- TTL 8 detik, _pendingFetchSync,
            // & _lastFetchAtSync tetap dihormati PER-KUNCI persis seperti jalur
            // fetch satuan di bawah, cuma network request-nya yang digabung.
            if (KUNCI_BULK_TUGAS.includes(kunci)) {
                _refreshSyncBulkTugasDiBackground();
                return;
            }

            _pendingFetchSync[kunci] = true;
            fetch(`/api/sync/${encodeURIComponent(kunci)}`)
                .then(res => res.ok ? res.json() : null)
                .then(res => {
                    if (!res || !res.ok) return;
                    const data = (res.data === null || res.data === undefined) ? fallback : res.data;
                    _cacheSync[kunci] = data;
                    localStorage.setItem(kunci, JSON.stringify(data));
                    // FIX: begitu notif tugas selesai di-refresh dari server, langsung
                    // hitung ulang toast & badge lonceng -- jangan nunggu poll tugas
                    // berikutnya (lihat cekPembaruanTugasRealtime) yang bisa telat/
                    // tidak ke-trigger sama sekali kalau field tugas kebetulan sama.
                    if (kunci === NOTIF_TUGAS_DITARIK_KEY) cekNotifBaruTugasDitarik();
                })
                .catch(e => console.warn('Gagal ambil data dari server, pakai cadangan lokal:', kunci, e))
                .finally(() => {
                    _lastFetchAtSync[kunci] = Date.now();
                    _pendingFetchSync[kunci] = false;
                });
        }
        // PERFORMANCE OPTIMIZATION: versi /api/sync/bulk dari
        // _refreshSyncDiBackground() di atas, khusus untuk KUNCI_BULK_TUGAS.
        // Cuma minta kunci yang memang BENAR-BENAR sedang due (belum pending &
        // sudah lewat JEDA_MIN_REFRESH_SYNC_MS) -- kalau kedua kunci due
        // bareng (kasus paling umum, dipanggil beruntun dari getTasksSiswa() &
        // getNotifTugasDitarik() dalam tick yang sama), keduanya ketarik dalam
        // 1 request. Kalau cuma satu yang due, tetap 1 request tapi cuma
        // minta kunci itu -- tidak pernah memaksa fetch kunci yang belum due
        // (jadi TTL & jeda per-kunci tetap persis seperti sebelumnya, fallback
        // aman kalau format response tidak sesuai dugaan).
        let _pendingFetchBulkTugas = false;
        function _refreshSyncBulkTugasDiBackground() {
            if (_pendingFetchBulkTugas) return; // request bulk sebelumnya masih berjalan
            const kunciPerluDifetch = KUNCI_BULK_TUGAS.filter(k => {
                if (_pendingFetchSync[k]) return false;
                const terakhir = _lastFetchAtSync[k] || 0;
                return (Date.now() - terakhir) >= JEDA_MIN_REFRESH_SYNC_MS;
            });
            if (kunciPerluDifetch.length === 0) return;

            _pendingFetchBulkTugas = true;
            kunciPerluDifetch.forEach(k => { _pendingFetchSync[k] = true; });

            fetch(`/api/sync/bulk?kunci=${kunciPerluDifetch.map(encodeURIComponent).join(',')}`)
                .then(res => res.ok ? res.json() : null)
                .then(res => {
                    // Jaga-jaga kalau response tidak sesuai format yang diharapkan
                    // (mis. server lama/belum update) -- jangan sampai error,
                    // biarkan saja data lokal/cache lama yang tetap dipakai.
                    if (!res || !res.ok || !res.data || typeof res.data !== 'object') return;
                    kunciPerluDifetch.forEach(k => {
                        const nilaiServer = res.data[k];
                        const data = (nilaiServer === null || nilaiServer === undefined) ? [] : nilaiServer;
                        _cacheSync[k] = data;
                        localStorage.setItem(k, JSON.stringify(data));
                    });
                    // FIX: sama seperti jalur satuan di atas -- kalau notif tugas ikut
                    // ke-refresh lewat request bulk ini, langsung hitung ulang badge.
                    if (kunciPerluDifetch.includes(NOTIF_TUGAS_DITARIK_KEY)) cekNotifBaruTugasDitarik();
                })
                .catch(e => console.warn('Gagal ambil data bulk tugas dari server, pakai cadangan lokal:', e))
                .finally(() => {
                    kunciPerluDifetch.forEach(k => {
                        _lastFetchAtSync[k] = Date.now();
                        _pendingFetchSync[k] = false;
                    });
                    _pendingFetchBulkTugas = false;
                });
        }
        function setSync(kunci, data) {
            localStorage.setItem(kunci, JSON.stringify(data));
            fetch(`/api/sync/${encodeURIComponent(kunci)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            }).catch(e => console.warn('Gagal simpan data ke server:', kunci, e));
        }

        function getTasksSiswa() {
            const tasks = getSync(`tasks_${KELAS_AKTIF_SISWA}`, []);
            // Status pengumpulan (studentSubmitted/studentImages) di tasks_<KELAS>
            // adalah data tugas itu sendiri (judul, deskripsi, deadline, dst) yang
            // memang dibagi sekelas -- TAPI siapa-sudah-kumpul harus per akun, jadi
            // ditimpa di sini pakai status ASLI milik akun yang sedang login saja.
            return mergeStatusTugasSendiri(tasks);
        }
        function saveTasksSiswa(tasks) {
            setSync(`tasks_${KELAS_AKTIF_SISWA}`, tasks);
        }

        /* ================= 4. NOTIFIKASI TUGAS DITARIK GURU =================
           Kunci localStorage 'notif_tugas_XII_TKJ_3' diisi oleh Dashboard Guru
           setiap kali sebuah tugas ditarik/dihapus. Di sini kita baca notif yang
           belum ditampilkan, munculkan sebagai toast berisi nama guru + pesan,
           lalu tandai sudah dibaca supaya tidak muncul berulang. */
        const NOTIF_TUGAS_DITARIK_KEY = `notif_tugas_${KELAS_AKTIF_SISWA}`;

        function getNotifTugasDitarik() {
            return getSync(NOTIF_TUGAS_DITARIK_KEY, []);
        }

        function tandaiNotifTugasDibaca(notifId) {
            const daftarNotif = getNotifTugasDitarik();
            const notif = daftarNotif.find(n => n.id === notifId);
            if (notif) notif.dibaca = true;
            setSync(NOTIF_TUGAS_DITARIK_KEY, daftarNotif);
        }

        function tampilkanToastTugasDitarik(notif) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            // Notif ini dipakai bareng untuk 2 jenis kabar dari guru: tugas ditarik
            // (kabar buruk -> tema merah) dan tambahan waktu deadline (kabar baik ->
            // tema hijau), dibedakan lewat notif.tipe yang dikirim dari Dashboard Guru.
            const isTambahanWaktu = notif.tipe === 'tambahan_waktu';
            const iconClass = isTambahanWaktu ? 'fa-solid fa-hourglass-end' : 'fa-solid fa-triangle-exclamation';
            const iconWrapClass = isTambahanWaktu ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
            const judulToast = isTambahanWaktu ? 'Tambahan Waktu dari Guru' : 'Tugas Ditarik oleh Guru';
            const namaGuruClass = isTambahanWaktu ? 'text-emerald-600' : 'text-rose-600';

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik' + (isTambahanWaktu ? ' notif-toast-hijau' : '');
            toast.id = `toast-${notif.id}`;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg ${iconWrapClass} flex items-center justify-center flex-shrink-0">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">${judulToast}</p>
                        <p class="text-[11px] font-bold ${namaGuruClass} mt-0.5"><i class="fa-solid fa-chalkboard-user mr-1"></i>${notif.namaGuru}</p>
                        <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">${notif.pesan}</p>
                    </div>
                    <button onclick="tutupToastTugasDitarik('${notif.id}')" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);
            tandaiNotifTugasDibaca(notif.id);

            // Otomatis hilang sendiri setelah 8 detik kalau tidak ditutup manual.
            setTimeout(() => tutupToastTugasDitarik(notif.id), 8000);
        }

        // Notif "Segera Kumpulkan" -- muncul sekali waktu sisa waktu tugas baru
        // masuk 10 menit (zona kuning), dipicu dari updateGlobalCountdown().
        function tampilkanToastSegeraKumpulkan(data, breakdown) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            const sisaText = breakdown ? `${String(breakdown.minutes).padStart(2, '0')} menit ${String(breakdown.seconds).padStart(2, '0')} detik` : '10 menit';
            const judulTugas = data.judul || data.title || 'Tugas';
            const toastId = `segera-kumpulkan-${data.id}`;

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik notif-toast-kuning';
            toast.id = `toast-${toastId}`;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">Segera Kumpulkan!</p>
                        <p class="text-[11px] font-bold text-amber-600 mt-0.5"><i class="fa-solid fa-file-pen mr-1"></i>${judulTugas}</p>
                        <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">Sisa waktu pengumpulan tinggal ${sisaText} lagi.</p>
                    </div>
                    <button onclick="tutupToastTugasDitarik('${toastId}')" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);

            // Otomatis hilang sendiri setelah 8 detik kalau tidak ditutup manual.
            setTimeout(() => tutupToastTugasDitarik(toastId), 8000);
        }

        function tutupToastTugasDitarik(notifId) {
            const toast = document.getElementById(`toast-${notifId}`);
            if (!toast) return;
            toast.classList.add('notif-keluar');
            setTimeout(() => toast.remove(), 300);
        }

        // Notif "Wussh! Salip Peringkat!" -- kabar baik, ditampilkan waktu siswa
        // berhasil MENYALIP orang lain di leaderboard (kebalikan dari toast ungu
        // "ditikung" di atas). Panggil fungsi ini dari mana saja setelah skor siswa
        // berubah -- misalnya di dalam event submit kuis atau fungsi penambahan skor:
        //
        //   tampilkanToastSalipPeringkat(jumlahOrangDisalip, posisiRankingBaru);
        //
        // Contoh: kalau siswa tadinya #7 terus naik jadi #3 (melewati 4 orang),
        // panggil: tampilkanToastSalipPeringkat(4, 3);
        function tampilkanToastSalipPeringkat(jumlahDisalip, posisiBaru) {
            const container = document.getElementById('notif-toast-container');
            if (!container || !jumlahDisalip || jumlahDisalip <= 0) return;

            const toastId = `salip-peringkat-${Date.now()}`;
            const orangText = jumlahDisalip === 1 ? '1 orang' : `${jumlahDisalip} orang`;

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik notif-toast-salip';
            toast.id = `toast-${toastId}`;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0 text-base">
                        🚀
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">Wussh! Salip Peringkat!</p>
                        <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">Kamu berhasil melewati ${orangText}. Posisi mu sekarang #${posisiBaru}.</p>
                    </div>
                    <button onclick="tutupToastTugasDitarik('${toastId}')" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);

            // Otomatis hilang sendiri setelah 5 detik kalau tidak ditutup manual.
            setTimeout(() => tutupToastTugasDitarik(toastId), 5000);
        }

        function cekNotifBaruTugasDitarik() {
            const daftarNotif = getNotifTugasDitarik();
            const belumDitampilkan = daftarNotif.filter(n => !n.dibaca);
            // Ditampilkan berurutan dengan jeda kecil biar tidak numpuk kalau lebih dari satu.
            belumDitampilkan.forEach((notif, i) => {
                setTimeout(() => tampilkanToastTugasDitarik(notif), i * 400);
            });
            updateBadgeLonceng();
        }

        // Titik merah di menu "Tugas & Catatan" (sidebar) sengaja dibuat TERPISAH
        // dari isViewedByStudent (status per-tugas yang dipakai Dashboard Guru
        // buat status "Sedang Dikerjakan" -- lihat catatan di switchTab()).
        // Titik merah ini cuma nandain "ada tugas yang belum sempat dilihat
        // daftarnya", jadi cukup HILANG begitu siswa membuka tab Tugas &
        // Catatan (diklik), tanpa perlu buka tugasnya satu-satu.
        const KEY_BADGE_TUGAS_DILIHAT = `badge_tugas_dilihat_${ID_SISWA_AKTIF}`;

        function getIdTugasBadgeDilihat() {
            const raw = localStorage.getItem(KEY_BADGE_TUGAS_DILIHAT);
            return raw ? JSON.parse(raw) : [];
        }

        // Dipanggil begitu tab "Tugas & Catatan" dibuka -- tandai SEMUA tugas
        // yang ada sekarang sebagai "sudah dilihat daftarnya" supaya titik
        // merah langsung hilang. Kalau nanti ada tugas baru lagi (id baru yang
        // belum ada di daftar ini), titik merah otomatis muncul lagi.
        function tandaiBadgeTugasDilihat() {
            try {
                const idSemuaTugas = getTasksSiswa().map(t => t.id);
                localStorage.setItem(KEY_BADGE_TUGAS_DILIHAT, JSON.stringify(idSemuaTugas));
            } catch (err) {
                console.warn('Gagal menandai badge tugas sudah dilihat:', err);
            }
            checkTaskBadgeStatus();
        }

        function checkTaskBadgeStatus() {
            const tasks = getTasksSiswa();
            const badgeEl = document.getElementById('badge-tugas-baru');
            if (!badgeEl) return;

            const idSudahDilihat = new Set(getIdTugasBadgeDilihat());
            const adaYangBelumDilihat = tasks.some(t => !idSudahDilihat.has(t.id));
            if (adaYangBelumDilihat) {
                badgeEl.classList.remove('hidden');
            } else {
                badgeEl.classList.add('hidden');
            }
            updateBadgeLonceng();
        }

        /* ================= PUSAT NOTIFIKASI (LONCENG) =================
           Toast (#notif-toast-container) cuma nongol kalau siswa SEDANG buka
           aplikasi saat kejadiannya (tugas ditarik, tambahan waktu, tugas
           baru). Kalau aplikasi lagi ditutup, kabar itu tetap harus bisa
           dilihat — makanya di sini kabar yang sama disimpan & ditampilkan
           lagi lewat ikon lonceng, dengan titik merah yang baru hilang
           setelah lonceng dibuka. Sumber datanya dipakai bareng dgn notif
           toast (notif_tugas_XII_TKJ_3) & status isViewedByStudent tugas,
           jadi tidak perlu data baru dari Dashboard Guru. */
        const KEY_BELL_SEEN = `lonceng_dilihat_${ID_SISWA_AKTIF}`;

        function getBellSeenIds() {
            const raw = localStorage.getItem(KEY_BELL_SEEN);
            return raw ? JSON.parse(raw) : [];
        }

        function tandaiSemuaLoncengDilihat(ids) {
            const seen = new Set(getBellSeenIds());
            ids.forEach(id => seen.add(id));
            localStorage.setItem(KEY_BELL_SEEN, JSON.stringify([...seen]));
        }

        // FITUR TAMBAHAN: hapus notifikasi SATU-PER-SATU dari Pusat Notifikasi
        // (tombol X). Sengaja HANYA menyimpan daftar id yang "disembunyikan"
        // secara personal di localStorage (pola sama seperti KEY_BELL_SEEN) --
        // BUKAN menghapus entri asli dari notif_tugas_<KELAS> atau tasks_<KELAS>,
        // karena keduanya data BERSAMA sekelas (lihat catatan di
        // KELAS_AKTIF_SISWA) -- kalau dihapus beneran, notifikasi ikut hilang
        // buat SEMUA siswa sekelas, bukan cuma yang menekan tombol X.
        const KEY_BELL_DIHAPUS = `lonceng_dihapus_${ID_SISWA_AKTIF}`;

        function getBellDihapusIds() {
            const raw = localStorage.getItem(KEY_BELL_DIHAPUS);
            return raw ? JSON.parse(raw) : [];
        }

        function tandaiLoncengDihapus(id) {
            const dihapus = new Set(getBellDihapusIds());
            dihapus.add(id);
            localStorage.setItem(KEY_BELL_DIHAPUS, JSON.stringify([...dihapus]));
        }

        // Gabungan 2 sumber kabar guru jadi satu daftar notifikasi terurut,
        // masing-masing ditandai sudah/belum dilihat di lonceng (independen
        // dari status "dibaca" milik toast, supaya lonceng tidak ikut
        // otomatis kesilep begitu toast-nya lewat 8 detik).
        function getDaftarNotifikasiLonceng() {
            const seen = new Set(getBellSeenIds());

            const notifGuru = getNotifTugasDitarik().map(n => {
                const waktu = parseInt(String(n.id || '').replace(/\D/g, '').slice(-13), 10) || 0;
                const isTambahanWaktu = n.tipe === 'tambahan_waktu';
                return {
                    id: n.id,
                    kategori: isTambahanWaktu ? 'tambahan_waktu' : 'ditarik',
                    judul: isTambahanWaktu ? 'Tambahan Waktu dari Guru' : 'Tugas Ditarik oleh Guru',
                    keterangan: `${n.namaGuru || 'Guru'}${n.pesan ? ' • ' + n.pesan : ''}`,
                    dilihat: seen.has(n.id),
                    _waktu: waktu
                };
            });

            const tugasBaru = getTasksSiswa()
                .filter(t => !t.isViewedByStudent)
                .map(t => {
                    const bellId = `tugasbaru-${t.id}`;
                    const namaGuruTugas = t.namaGuru || t.guru || t.teacher || t.pengajar || 'Guru Mata Pelajaran';
                    return {
                        id: bellId,
                        kategori: 'tugas_baru',
                        judul: 'Tugas Baru Diberikan',
                        keterangan: `${namaGuruTugas} • ${t.judul || t.tipe || 'Tugas Pembelajaran'}`,
                        dilihat: seen.has(bellId),
                        _waktu: t.waktuKirimGuru || 0
                    };
                });

            const dihapus = new Set(getBellDihapusIds());
            return [...notifGuru, ...tugasBaru]
                .filter(n => !dihapus.has(n.id))
                .sort((a, b) => (b._waktu || 0) - (a._waktu || 0));
        }

        function updateBadgeLonceng() {
            const badge = document.getElementById('badge-bell-dot');
            if (!badge) return;
            const jumlahBelumDilihat = getDaftarNotifikasiLonceng().filter(n => !n.dilihat).length;
            if (jumlahBelumDilihat > 0) {
                badge.innerText = jumlahBelumDilihat > 9 ? '9+' : String(jumlahBelumDilihat);
                badge.classList.remove('hidden');
                badge.classList.add('flex');
            } else {
                badge.classList.add('hidden');
                badge.classList.remove('flex');
            }
        }

        function renderBellDropdown() {
            const container = document.getElementById('list-bell-dropdown');
            const teksKosong = document.getElementById('bell-dropdown-kosong');
            if (!container) return;

            const daftar = getDaftarNotifikasiLonceng();
            container.innerHTML = '';
            container.classList.toggle('hidden', daftar.length === 0);
            if (teksKosong) teksKosong.classList.toggle('hidden', daftar.length > 0);
            if (daftar.length === 0) return;

            const tampilan = {
                ditarik: { icon: 'fa-triangle-exclamation', wrap: 'bg-rose-100 text-rose-600' },
                tambahan_waktu: { icon: 'fa-hourglass-end', wrap: 'bg-emerald-100 text-emerald-600' },
                tugas_baru: { icon: 'fa-book-open', wrap: 'bg-blue-100 text-blue-600' }
            };

            daftar.forEach(n => {
                const meta = tampilan[n.kategori] || tampilan.ditarik;
                const row = document.createElement('div');
                row.className = `flex items-start gap-3 p-2.5 rounded-xl ${n.dilihat ? '' : 'bg-blue-50/70'}`;
                row.innerHTML = `
                    <div class="w-9 h-9 rounded-lg ${meta.wrap} flex items-center justify-center flex-shrink-0 text-xs">
                        <i class="fa-solid ${meta.icon}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-slate-800">${n.judul}</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">${n.keterangan}</p>
                    </div>
                    ${n.dilihat ? '' : '<span class="w-2 h-2 bg-blue-600 rounded-full mt-1.5 flex-shrink-0"></span>'}
                    <button onclick="klikHapusNotifikasiLonceng(event, '${n.id}')" title="Hapus notifikasi ini" class="text-slate-300 hover:text-rose-500 flex-shrink-0 -mt-1 -mr-1 p-1">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                `;
                container.appendChild(row);
            });
        }

        // Dipanggil dari tombol X di tiap baris #list-bell-dropdown -- tandai
        // notif itu "dihapus" (personal, lihat KEY_BELL_DIHAPUS di atas), lalu
        // render ulang dropdown & badge supaya baris itu langsung lenyap tanpa
        // perlu menutup/buka ulang lonceng.
        function klikHapusNotifikasiLonceng(event, id) {
            if (event) event.stopPropagation(); // jangan sampai ikut menutup dropdown
            tandaiLoncengDihapus(id);
            renderBellDropdown();
            updateBadgeLonceng();
        }

        /* ================= CARI TEMAN: PERMINTAAN PERTEMANAN (BACKEND) =================
           Beda dari fitur "Akun Dummy (Profil Login)" di atas (yang cuma efek lokal di
           browser sendiri), pertemanan di sini BENERAN nyambung ke server (lihat
           /api/teman/* di app.py) memakai akun ASLI yang login (USERNAME_SISWA_ASLI) --
           jadi 2 akun beneran (mis. akun 'siswa' & akun 'syam', login di
           browser/tab/perangkat BERBEDA) bisa saling kirim & terima permintaan
           pertemanan, dan hasilnya kelihatan di kedua sisi begitu masing-masing buka
           tab "Cari Teman" / dropdown permintaan pertemanan.
           CATATAN: sengaja pakai USERNAME_SISWA_ASLI (bukan ID_SISWA_AKTIF) karena
           pertemanan adalah relasi antar akun sungguhan, bukan antar profil dummy
           lokal yang cuma efek tampilan. */

        let JUMLAH_PERMINTAAN_MASUK_TERAKHIR = 0;

        function updateBadgePermintaanTeman(jumlah) {
            const badge = document.getElementById('badge-permintaan-teman');
            const badgeNav = document.getElementById('badge-permintaan-teman-nav');
            JUMLAH_PERMINTAAN_MASUK_TERAKHIR = jumlah;

            if (badge) {
                if (jumlah > 0) {
                    badge.innerText = String(jumlah);
                    badge.classList.remove('hidden');
                    badge.classList.add('flex');
                } else {
                    badge.classList.add('hidden');
                    badge.classList.remove('flex');
                }
            }

            // Titik merah kecil di menu sidebar "Cari Teman" -- munculnya di sinilah
            // yang bikin siswa penerima (mis. Syam) langsung tahu ada permintaan
            // pertemanan baru MASUK (mis. dari Ahmad) tanpa harus buka tab itu dulu.
            if (badgeNav) badgeNav.classList.toggle('hidden', jumlah <= 0);
        }

        // Versi ringan dari renderPermintaanTeman(): cuma fetch + update badge
        // titik merah (sidebar & dropdown), TIDAK menulis ulang daftar
        // permintaan (yang berarti bikin elemen DOM + gambar avatar/border baru
        // tiap baris). Dipakai polling berkala tiap 3 detik supaya siswa di
        // tab MANAPUN tetap lihat notifikasi permintaan teman baru, tanpa
        // ikut menanggung biaya render list yang cuma kepakai kalau tab
        // "Cari Teman" memang sedang dibuka (lihat jalankanSinkronisasiBerkalaDashboard).
        async function updateBadgePermintaanTemanSaja() {
            try {
                const { permintaan_masuk: pending } = await ambilRelasiPertemanan();
                updateBadgePermintaanTeman(pending.length);
            } catch (e) {
                console.error('Gagal cek badge permintaan teman:', e);
            }
        }

        // Hemat request: kalau renderPermintaanTeman() dan renderDaftarTeman()
        // dipanggil hampir bersamaan (mis. dari polling berkala tiap 3 detik di
        // bawah), keduanya butuh data yang PERSIS SAMA dari /api/teman/relasi.
        // Daripada fetch 2x buat data identik, panggilan yang datang selagi
        // masih ada fetch yang berjalan cukup "menumpang" promise yang sama
        // (in-flight de-dupe) -- bukan cache berjangka waktu, jadi tidak bikin
        // data basi setelah aksi seperti terima/tolak pertemanan.
        let _janjiRelasiPertemananBerjalan = null;
        async function ambilRelasiPertemanan() {
            if (_janjiRelasiPertemananBerjalan) return _janjiRelasiPertemananBerjalan;
            _janjiRelasiPertemananBerjalan = (async () => {
                try {
                    const res = await fetchDenganKontrolBeban('/api/teman/relasi');
                    if (!res) return null; // lagi masa tunda (backoff 429) -- skip fetch
                    const json = await res.json();
                    // PERBAIKAN: dulu balikin array kosong di sini kalau gagal --
                    // jadinya "gagal ambil data" ketimpang dianggap sama dengan
                    // "memang belum ada teman/permintaan", padahal beda kasus.
                    // Sekarang balikin null biar pemanggilnya (renderDaftarTeman /
                    // renderPermintaanTeman) bisa bedain & tidak menimpa tampilan
                    // yang sudah benar cuma gara-gara satu request lagi gagal.
                    if (!json.success) return null;
                    return json;
                } catch (e) {
                    console.error('Gagal ambil data pertemanan:', e);
                    return null;
                } finally {
                    _janjiRelasiPertemananBerjalan = null;
                }
            })();
            return _janjiRelasiPertemananBerjalan;
        }

        async function renderPermintaanTeman() {
            const list = document.getElementById('list-permintaan-teman');
            const kosong = document.getElementById('permintaan-teman-kosong');
            if (!list) return;

            const dataRelasi = await ambilRelasiPertemanan();
            if (!dataRelasi) return; // fetch gagal -> biarkan dropdown/badge yang sudah ada, jangan ditimpa kosong
            const { permintaan_masuk: pending } = dataRelasi;
            list.innerHTML = '';

            if (pending.length === 0) {
                if (kosong) kosong.classList.remove('hidden');
                updateBadgePermintaanTeman(0);
                return;
            }
            if (kosong) kosong.classList.add('hidden');

            pending.forEach(item => {
                // Petakan border yang dipakai pengirim permintaan -- persis pola
                // yang sama dengan hasil pencarian "Cari Teman" & Leaderboard Quiz --
                // supaya avatar+border+efek nama gradasi+title ikut tampil di sini juga.
                // TAHAP 2: efek nama & title dipetakan dari field terpisah
                // (item.efekNama/item.title, server /api/teman/relasi) --
                // BUKAN lagi selalu ikut borderItem, supaya kombinasi
                // mix-and-match siswa ini kelihatan bener di sini juga.
                const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                const efekNamaBorderItem = getSemuaBorder().find(b => b.id === item.efekNama) || borderItem;
                const titleBorderItem = getSemuaBorder().find(b => b.id === item.title) || borderItem;
                const efekNamaItem = getEfekNamaClass(efekNamaBorderItem);
                const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                const badgeDevItem = getBadgeDevHtml(titleBorderItem);
                const rankLabelItem = getRankLabelHtml(titleBorderItem);
                // badgeDevItem (mis. "❄ COLLECTOR") dipindah ke baris sendiri
                // di bawah nama, di atas teks kelas -- kalau ditaruh sebaris
                // dengan nama, untuk nama yang panjang badge-nya kepotong di
                // tepi dropdown (sempit). Baris ini juga jadi tempat
                // rankLabelItem kalau ada, biar keduanya rapi di baris yang sama.
                const fotoItem = item.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120`;

                const row = document.createElement('div');
                row.className = 'flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 transition-colors';
                row.innerHTML = `
                    <button class="btn-lihat-idcard profile-wrapper w-10 h-10 flex-shrink-0" title="Lihat statistik">
                        <img loading="lazy" decoding="async" src="${fotoItem}" class="user-avatar" alt="Avatar ${item.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120'">
                        <img loading="lazy" decoding="async" src="${borderItem.file}" class="user-border" alt="Border ${item.nama}">
                    </button>
                    <button class="btn-lihat-idcard flex-1 min-w-0 text-left">
                        <p class="text-xs font-bold truncate ${efekNamaItem || 'text-slate-800'}">${item.nama}</p>
                        ${(badgeDevItem || rankLabelItem) ? `<div class="flex items-center gap-1 mt-0.5 flex-wrap">${badgeDevItem}${rankLabelItem ? `<span class="inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${rankLabelItem}</span>` : ''}</div>` : ''}
                        <p class="text-[10px] text-slate-400 truncate mt-0.5">${item.kelas}</p>
                    </button>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                        <button class="btn-terima-teman w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 flex items-center justify-center transition-colors" title="Terima">
                            <i class="fa-solid fa-check text-[10px]"></i>
                        </button>
                        <button class="btn-tolak-teman w-7 h-7 rounded-lg bg-rose-100 text-rose-600 hover:bg-rose-200 flex items-center justify-center transition-colors" title="Tolak">
                            <i class="fa-solid fa-xmark text-[10px]"></i>
                        </button>
                    </div>`;
                row.querySelectorAll('.btn-lihat-idcard').forEach(el => {
                    el.addEventListener('click', () => bukaIdCardTeman(item.username));
                });
                row.querySelector('.btn-terima-teman').addEventListener('click', () => tanggapiPermintaanTeman(item.username, 'terima'));
                row.querySelector('.btn-tolak-teman').addEventListener('click', () => tanggapiPermintaanTeman(item.username, 'tolak'));
                list.appendChild(row);
            });

            updateBadgePermintaanTeman(pending.length);
        }

        async function tanggapiPermintaanTeman(fromUsername, aksi) {
            try {
                const res = await fetch('/api/teman/tanggapi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from_username: fromUsername, aksi })
                });
                const json = await res.json();
                if (!json.success) {
                    tampilkanToast(json.message || 'Gagal menanggapi permintaan pertemanan.', 'error');
                }
            } catch (e) {
                console.error('Gagal menanggapi permintaan pertemanan:', e);
            }
            renderPermintaanTeman();
            // Kalau yang diterima itu permintaan pertemanan, orangnya langsung
            // masuk daftar "Teman" di bawah search bar -- refresh juga di sini.
            renderDaftarTeman();
        }

        /* ---------- Daftar Teman (yang sudah saling add) ---------- */
        // Ditaro di bawah search bar "Cari Teman". Datanya diambil dari field
        // "teman" hasil ambilRelasiPertemanan() (endpoint /api/teman/relasi) --
        // field ini sebelumnya sudah dikirim server tapi belum pernah dirender
        // di mana pun, jadi tinggal dipakai di sini.
        async function renderDaftarTeman() {
            const list = document.getElementById('daftar-teman-list');
            const kosong = document.getElementById('daftar-teman-kosong');
            const jumlahEl = document.getElementById('daftar-teman-jumlah');
            if (!list) return;

            const dataRelasi = await ambilRelasiPertemanan();
            if (!dataRelasi) return; // fetch gagal -> biarkan daftar teman yang sudah tampil, jangan ditimpa kosong
            const { teman: daftarTeman } = dataRelasi;

            list.innerHTML = '';
            if (jumlahEl) jumlahEl.textContent = `(${daftarTeman.length})`;

            if (daftarTeman.length === 0) {
                if (kosong) kosong.classList.remove('hidden');
                return;
            }
            if (kosong) kosong.classList.add('hidden');

            daftarTeman.forEach(item => {
                // Pola sama dengan hasil "Cari Teman" & dropdown permintaan masuk --
                // avatar+border, efek nama gradasi, & title ikut ditampilkan.
                // TAHAP 2: efek nama & title dipetakan terpisah dari border
                // (item.efekNama/item.title), sama pola dengan
                // renderPermintaanTeman() di atas.
                const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                const efekNamaBorderItem = getSemuaBorder().find(b => b.id === item.efekNama) || borderItem;
                const titleBorderItem = getSemuaBorder().find(b => b.id === item.title) || borderItem;
                const efekNamaItem = getEfekNamaClass(efekNamaBorderItem);
                const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                const badgeDevItem = getBadgeDevHtml(titleBorderItem);
                const rankLabelItem = getRankLabelHtml(titleBorderItem);
                const fotoItem = item.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120`;

                const row = document.createElement('div');
                row.className = 'w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 transition-colors cursor-pointer';
                row.setAttribute('role', 'button');
                row.setAttribute('tabindex', '0');
                row.innerHTML = `
                    <div class="profile-wrapper w-11 h-11 flex-shrink-0">
                        <img loading="lazy" decoding="async" src="${fotoItem}" class="user-avatar" alt="Avatar ${item.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120'">
                        <img loading="lazy" decoding="async" src="${borderItem.file}" class="user-border" alt="Border ${item.nama}">
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold truncate ${efekNamaItem || 'text-slate-800'}">${item.nama}${badgeDevItem ? ' ' + badgeDevItem : ''}</p>
                        ${rankLabelItem ? `<span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${rankLabelItem}</span>` : ''}
                        <p class="text-[11px] text-slate-400 truncate mt-0.5">${item.kelas}</p>
                    </div>
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 flex-shrink-0">Teman</span>
                `;
                row.addEventListener('click', () => bukaIdCardTeman(item.username));
                row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bukaIdCardTeman(item.username); } });

                list.appendChild(row);
            });
        }

        /* ================= PERANGKAT (Master Device & Approval Device Kedua) ================= */
        function updateBadgePerangkatNav(jumlahPending) {
            const badgeNav = document.getElementById('badge-perangkat-pending-nav');
            if (badgeNav) badgeNav.classList.toggle('hidden', jumlahPending <= 0);
        }

        function formatWaktuPerangkat(iso) {
            if (!iso) return '-';
            try {
                return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                return '-';
            }
        }

        function badgeStatusPerangkat(status) {
            if (status === 'approved') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Disetujui</span>';
            if (status === 'pending') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Menunggu</span>';
            return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">Ditolak</span>';
        }

        async function renderPerangkat() {
            const tbody = document.getElementById('list-perangkat');
            const listMobile = document.getElementById('list-perangkat-mobile');
            const kosong = document.getElementById('perangkat-kosong');
            const infoBukanMaster = document.getElementById('perangkat-bukan-master-info');
            if (!tbody || !listMobile) return;

            // Skeleton hanya saat daftar masih kosong (load pertama), supaya tidak berkedip tiap refresh.
            const _skKosong = !tbody.children.length && !listMobile.children.length && !!window.SkSiswa;
            if (_skKosong) {
                tbody.innerHTML = '<tr><td colspan="6">' + SkSiswa.html('perangkat', 3) + '</td></tr>';
                listMobile.innerHTML = SkSiswa.html('perangkat', 3);
            }
            let json;
            try {
                const res = await fetch('/api/perangkat/list');
                json = await res.json();
            } catch (e) {
                console.error('Gagal ambil data perangkat:', e);
                if (_skKosong) { tbody.innerHTML = ''; listMobile.innerHTML = ''; }
                return;
            }
            if (!json || !json.success) {
                if (_skKosong) { tbody.innerHTML = ''; listMobile.innerHTML = ''; }
                return;
            }

            const { is_master: sayaMaster, devices: daftar } = json;
            if (infoBukanMaster) infoBukanMaster.classList.toggle('hidden', sayaMaster);

            const jumlahPending = daftar.filter(d => d.status === 'pending').length;
            updateBadgePerangkatNav(jumlahPending);

            tbody.innerHTML = '';
            listMobile.innerHTML = '';
            if (daftar.length === 0) {
                kosong?.classList.remove('hidden');
                return;
            }
            kosong?.classList.add('hidden');

            daftar.forEach(d => {
                const aksiHtml = tombolAksiPerangkat(d, sayaMaster);

                // ---- Baris tabel (tablet ke atas) ----
                const tr = document.createElement('tr');
                tr.className = 'border-b border-slate-50 last:border-0';
                tr.innerHTML = `
                    <td class="py-2.5 pr-3 align-top">
                        <p class="text-xs font-semibold text-slate-800 max-w-[220px] truncate" title="${d.nama}">${d.nama}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                            ${d.is_master ? '<span class="inline-flex items-center gap-1 text-[9px] font-bold text-blue-600"><i class="fa-solid fa-crown"></i> Master Device</span>' : ''}
                            ${d.perangkat_ini ? '<span class="text-[9px] font-semibold text-slate-400">(perangkat ini)</span>' : ''}
                        </div>
                    </td>
                    <td class="py-2.5 pr-3 align-top text-xs text-slate-500">${d.ip || '-'}</td>
                    <td class="py-2.5 pr-3 align-top">${badgeStatusPerangkat(d.status)}</td>
                    <td class="py-2.5 pr-3 align-top text-[10px] text-slate-400">${formatWaktuPerangkat(d.created_at)}</td>
                    <td class="py-2.5 pl-3 align-top text-right">${aksiHtml.tabel}</td>`;
                pasangHandlerAksiPerangkat(tr, d);
                tbody.appendChild(tr);

                // ---- Kartu (khusus HP) ----
                const card = document.createElement('div');
                card.className = 'p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60';
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-xs font-semibold text-slate-800 truncate" title="${d.nama}">${d.nama}</p>
                            <div class="flex items-center flex-wrap gap-1.5 mt-1">
                                ${d.is_master ? '<span class="inline-flex items-center gap-1 text-[9px] font-bold text-blue-600"><i class="fa-solid fa-crown"></i> Master Device</span>' : ''}
                                ${d.perangkat_ini ? '<span class="text-[9px] font-semibold text-slate-400">(perangkat ini)</span>' : ''}
                            </div>
                        </div>
                        <div class="flex-shrink-0">${badgeStatusPerangkat(d.status)}</div>
                    </div>
                    <div class="flex items-center justify-between gap-2 mt-2 text-[10px] text-slate-400">
                        <span>${d.ip || '-'}</span>
                        <span>${formatWaktuPerangkat(d.created_at)}</span>
                    </div>
                    <div class="mt-2.5">${aksiHtml.kartu}</div>`;
                pasangHandlerAksiPerangkat(card, d);
                listMobile.appendChild(card);
            });
        }

        function tombolAksiPerangkat(d, sayaMaster) {
            if (!sayaMaster || d.is_master) {
                return { tabel: '<span class="text-slate-300 text-xs">&mdash;</span>', kartu: '' };
            }
            if (d.status === 'pending') {
                return {
                    tabel: `<div class="flex items-center justify-end gap-1.5">
                                <button class="btn-setujui-perangkat px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-[10px] font-bold transition-colors">Setujui</button>
                                <button class="btn-tolak-perangkat px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-[10px] font-bold transition-colors">Tolak</button>
                            </div>`,
                    kartu: `<div class="flex items-center gap-2">
                                <button class="btn-setujui-perangkat flex-1 py-2 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs font-bold transition-colors">Setujui</button>
                                <button class="btn-tolak-perangkat flex-1 py-2 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-xs font-bold transition-colors">Tolak</button>
                            </div>`
                };
            }
            if (d.status === 'approved') {
                return {
                    tabel: `<div class="flex justify-end"><button class="btn-tolak-perangkat px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-[10px] font-bold transition-colors">Cabut Akses</button></div>`,
                    kartu: `<button class="btn-tolak-perangkat w-full py-2 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 text-xs font-bold transition-colors">Cabut Akses</button>`
                };
            }
            return {
                tabel: `<div class="flex justify-end"><button class="btn-setujui-perangkat px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-[10px] font-bold transition-colors">Setujui</button></div>`,
                kartu: `<button class="btn-setujui-perangkat w-full py-2 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs font-bold transition-colors">Setujui</button>`
            };
        }

        function pasangHandlerAksiPerangkat(container, d) {
            const btnSetujui = container.querySelector('.btn-setujui-perangkat');
            if (btnSetujui) btnSetujui.addEventListener('click', () => tanggapiPerangkat(d.token, 'approve'));
            const btnTolak = container.querySelector('.btn-tolak-perangkat');
            if (btnTolak) btnTolak.addEventListener('click', () => tanggapiPerangkat(d.token, 'reject'));
        }

        async function updateBadgePerangkatNavSaja() {
            // Versi ringan dari renderPerangkat(): cuma update titik merah di
            // sidebar, tidak menulis ulang isi tabel supaya tidak mengganggu
            // kalau Master Device sedang lihat/klik tabel Perangkat tiap 3 detik.
            try {
                const res = await fetchDenganKontrolBeban('/api/perangkat/list');
                if (!res) return; // lagi masa tunda (backoff 429) -- skip fetch
                const json = await res.json();
                if (!json || !json.success) return;
                const jumlahPending = json.devices.filter(d => d.status === 'pending').length;
                updateBadgePerangkatNav(jumlahPending);
            } catch (e) {
                console.error('Gagal cek badge perangkat:', e);
            }
        }

        async function tanggapiPerangkat(token, aksi) {
            if (aksi === 'reject' && !confirm('Yakin mau menolak/mencabut akses perangkat ini?')) return;
            try {
                const res = await fetch(`/api/perangkat/${aksi}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const json = await res.json();
                if (!json.success) tampilkanToast(json.message || 'Gagal memproses perangkat.', 'error');
            } catch (e) {
                console.error('Gagal menanggapi perangkat:', e);
            }
            renderPerangkat();
        }

        function toggleDropdownPermintaanTeman(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('dropdown-permintaan-teman');
            const trigger = document.getElementById('btn-permintaan-teman');
            if (!dropdown) return;

            const akanDibuka = dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', String(akanDibuka));

            if (akanDibuka) renderPermintaanTeman();
        }

        /* ---------- Search bar "Cari Teman" ---------- */
        let TIMER_DEBOUNCE_CARI_TEMAN = null;

        function onInputCariTeman(nilai) {
            clearTimeout(TIMER_DEBOUNCE_CARI_TEMAN);
            const q = nilai.trim();
            const kosongState = document.getElementById('hasil-cari-teman-kosong');
            const listState = document.getElementById('hasil-cari-teman-list');
            const daftarTemanWrapper = document.getElementById('daftar-teman-wrapper');

            if (!q) {
                // Kolom kosong -> sembunyikan area hasil pencarian, tampilkan
                // lagi daftar teman yang sudah saling add di bawahnya.
                kosongState.classList.add('hidden');
                listState.classList.add('hidden');
                listState.innerHTML = '';
                if (daftarTemanWrapper) daftarTemanWrapper.classList.remove('hidden');
                return;
            }

            // Lagi mencari -> daftar teman disembunyikan dulu supaya nggak
            // dobel sama hasil pencarian di bawahnya.
            if (daftarTemanWrapper) daftarTemanWrapper.classList.add('hidden');
            TIMER_DEBOUNCE_CARI_TEMAN = setTimeout(() => jalankanPencarianTeman(q), 250);
        }

        async function jalankanPencarianTeman(q) {
            const kosongState = document.getElementById('hasil-cari-teman-kosong');
            const listState = document.getElementById('hasil-cari-teman-list');
            const _skTeman = !!(window.SkSiswa && listState && kosongState);
            if (_skTeman) {
                kosongState.classList.add('hidden');
                listState.classList.remove('hidden');
                SkSiswa.tampil(listState, 'teman', 3);
            }
            try {
                const res = await fetch(`/api/teman/cari?q=${encodeURIComponent(q)}`);
                const json = await res.json();

                // GUARD RACE CONDITION: request ini butuh waktu ke server, dan selama
                // nunggu itu user bisa aja udah ubah/hapus teks di kolom pencarian
                // (lihat onInputCariTeman). Kalau pas hasil ini balik ternyata teks
                // di kolom sudah beda dari q atau malah sudah dikosongkan, hasil ini
                // sudah basi -- buang aja, jangan dipaksa render (ini yang bikin
                // hasil pencarian lama kelihatan "nyangkut" walau kolom sudah kosong).
                const inputSaatIni = document.getElementById('input-cari-teman');
                if (!inputSaatIni || inputSaatIni.value.trim() !== q) return;

                const hasil = json.success ? json.hasil : [];

                if (hasil.length === 0) {
                    listState.classList.add('hidden');
                    listState.innerHTML = '';
                    kosongState.classList.remove('hidden');
                    kosongState.querySelector('p').textContent = `Tidak ada siswa dengan nama "${q}".`;
                    return;
                }

                kosongState.classList.add('hidden');
                listState.classList.remove('hidden');
                listState.innerHTML = '';

                hasil.forEach(item => {
                    // Petakan id border yang sedang dipakai siswa ini (dikirim server,
                    // lihat /api/teman/cari) ke objek border lengkap di frontend supaya
                    // hasil pencarian ikut nampilin border, efek nama gradasi, & title
                    // -- persis pola yang sama dengan entri Leaderboard Quiz.
                    // TAHAP 2: efek nama & title dipetakan dari field terpisah
                    // (item.efekNama/item.title), bukan lagi selalu ikut border.
                    const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                    const efekNamaBorderItem = getSemuaBorder().find(b => b.id === item.efekNama) || borderItem;
                    const titleBorderItem = getSemuaBorder().find(b => b.id === item.title) || borderItem;
                    const efekNamaItem = getEfekNamaClass(efekNamaBorderItem);
                    const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                    const badgeDevItem = getBadgeDevHtml(titleBorderItem);
                    const rankLabelItem = getRankLabelHtml(titleBorderItem);
                    const fotoItem = item.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120`;

                    const row = document.createElement('div');
                    row.className = 'w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 transition-colors cursor-pointer';
                    row.setAttribute('role', 'button');
                    row.setAttribute('tabindex', '0');
                    row.innerHTML = `
                        <div class="profile-wrapper w-11 h-11 flex-shrink-0">
                            <img loading="lazy" decoding="async" src="${fotoItem}" class="user-avatar" alt="Avatar ${item.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120'">
                            <img loading="lazy" decoding="async" src="${borderItem.file}" class="user-border" alt="Border ${item.nama}">
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-bold truncate ${efekNamaItem || 'text-slate-800'}">${item.nama}${badgeDevItem ? ' ' + badgeDevItem : ''}</p>
                            ${rankLabelItem ? `<span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${rankLabelItem}</span>` : ''}
                            <p class="text-[11px] text-slate-400 truncate mt-0.5">${item.kelas}</p>
                        </div>
                        ${labelStatusPertemanan(item.status, item.username)}
                    `;
                    row.addEventListener('click', () => bukaIdCardTeman(item.username));
                    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bukaIdCardTeman(item.username); } });

                    // Tombol "orang+" (status belum berteman): klik LANGSUNG kirim
                    // permintaan pertemanan di tempat (tanpa buka ID card dulu),
                    // lalu ikonnya berubah jadi ceklis abu-abu dengan animasi pop-in
                    // sebagai tanda permintaan sudah terkirim ke siswa itu.
                    const btnTambahInline = row.querySelector('.btn-tambah-teman-inline');
                    if (btnTambahInline) {
                        btnTambahInline.addEventListener('click', (e) => {
                            e.stopPropagation();
                            kirimPermintaanTemanInline(item.username, btnTambahInline);
                        });
                    }

                    listState.appendChild(row);
                });
            } catch (e) {
                console.error('Gagal mencari teman:', e);
                if (_skTeman) listState.innerHTML = '';
            }
        }

        function labelStatusPertemanan(status, username) {
            if (status === 'belum') {
                return `<button type="button" class="btn-tambah-teman-inline w-9 h-9 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 flex items-center justify-center flex-shrink-0 transition-colors" data-username="${username}" title="Tambah teman">
                    <i class="fa-solid fa-user-plus text-xs icon-tambah-teman"></i>
                </button>`;
            }
            const peta = {
                berteman: '<span class="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 flex-shrink-0">Teman</span>',
                // Sudah pernah dikirim (baik baru saja diklik atau dari sesi sebelumnya)
                // -> tampil sebagai ceklis abu-abu, menandakan "sudah terkirim, tinggal tunggu".
                menunggu_dikirim: '<span class="w-9 h-9 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0" title="Permintaan sudah terkirim, menunggu direspon"><i class="fa-solid fa-check text-xs"></i></span>',
                menunggu_diterima: '<span class="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">Merespon</span>'
            };
            return peta[status] || peta.berteman;
        }

        async function kirimPermintaanTemanInline(username, btnEl) {
            if (btnEl.disabled) return;
            btnEl.disabled = true;
            btnEl.classList.add('opacity-60', 'cursor-wait');

            try {
                const res = await fetch('/api/teman/kirim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to_username: username })
                });
                const json = await res.json();

                if (!json.success) {
                    // Gagal (mis. sudah berteman/sudah dikirim dari tab lain) -> kembalikan
                    // tombol seperti semula supaya siswa bisa lihat pesan errornya, lalu
                    // muat ulang hasil pencarian biar status ikut sinkron ke kondisi terbaru.
                    btnEl.disabled = false;
                    btnEl.classList.remove('opacity-60', 'cursor-wait');
                    tampilkanToast(json.message || 'Gagal mengirim permintaan pertemanan.', 'error');
                    const inputCari = document.getElementById('input-cari-teman');
                    if (inputCari && inputCari.value.trim()) jalankanPencarianTeman(inputCari.value.trim());
                    return;
                }

                // Berhasil terkirim -> ganti ikon orang+ jadi ceklis abu-abu dengan
                // animasi pop-in singkat sebagai tanda "sudah terkirim ke siswa ini".
                // Kalau ternyata langsung jadi teman (siswa itu sudah lebih dulu ngirim
                // ke kita), tampilkan badge "Teman" alih-alih ceklis.
                btnEl.classList.remove('opacity-60', 'cursor-wait', 'hover:bg-blue-100', 'hover:text-blue-600');
                if (json.status === 'berteman') {
                    btnEl.outerHTML = '<span class="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 flex-shrink-0 animasi-ceklis-terkirim">Teman</span>';
                } else {
                    btnEl.title = 'Permintaan sudah terkirim, menunggu direspon';
                    btnEl.innerHTML = '<i class="fa-solid fa-check text-xs animasi-ceklis-terkirim icon-tambah-teman"></i>';
                }

                renderPermintaanTeman(); // sinkronkan badge dropdown juga (buat sisi siswa ini)
            } catch (e) {
                console.error('Gagal mengirim permintaan pertemanan:', e);
                btnEl.disabled = false;
                btnEl.classList.remove('opacity-60', 'cursor-wait');
            }
        }

        /* ---------- ID Card statistik siswa ---------- */
        let USERNAME_ID_CARD_TERBUKA = null;

        // Efek "muncul" per-bagian di ID Card (header, karya, statistik, skor
        // quiz, tombol aksi) -- SAMA PERSIS dengan .guru-card-reveal di Daftar
        // Guru (opacity 0 -> 1 + translateY 28px -> 0), tapi dipicu saat modal
        // dibuka, bukan saat discroll. Tiap bagian dikasih transition-delay
        // bertingkat (stagger) biar keliatan muncul satu-satu susul-menyusul,
        // bukan langsung tampil semua sekaligus. Class-nya dilepas & dipasang
        // ulang tiap dipanggil (pakai reflow trick seperti animasi lain di
        // file ini) supaya animasinya selalu replay dari awal tiap ID Card
        // dibuka -- baik pas buka ID Card teman maupun ID Card sendiri.
        function aktifkanRevealIdCard() {
            const modal = document.getElementById('modal-id-card-teman');
            if (!modal) return;
            const bagianBagian = modal.querySelectorAll('.idcard-reveal');
            bagianBagian.forEach((el, i) => {
                el.classList.remove('revealed');
                el.style.transitionDelay = `${i * 30}ms`;
            });
            void modal.offsetWidth; // paksa reflow, supaya transisi replay dari awal tiap dibuka
            bagianBagian.forEach(el => el.classList.add('revealed'));
        }

        async function bukaIdCardTeman(username) {
            const tutupSk = window.SkSiswa ? SkSiswa.lapisan('kartu') : function () {};
            try {
                const res = await fetch(`/api/teman/profil/${encodeURIComponent(username)}`);
                const json = await res.json();
                if (!json.success) {
                    tutupSk();
                    tampilkanToast(json.message || 'Gagal memuat statistik siswa.', 'error');
                    return;
                }
                tutupSk();
                renderIdCardTeman(json.profil);
                document.getElementById('modal-id-card-teman').classList.remove('hidden');
                document.getElementById('modal-id-card-teman').classList.add('flex');
                aktifkanRevealIdCard();

                // BARU: dorong 1 entry history khusus modal ini -- supaya
                // tombol back HP/browser (atau swipe-back) yang ditekan
                // SELAGI ID Card ini kebuka akan MENUTUP ID CARD INI DULU,
                // bukan langsung pindah tab/keluar app. Pola sama persis
                // dengan modalGuruHistoryAktif di Modal "Detail Penilaian
                // Guru" (lihat dorongHistoryTampilan & popstate listener).
                modalIdCardHistoryAktif = true;
                dorongHistoryTampilan({ type: 'modal', modal: 'id-card-teman' });
            } catch (e) {
                tutupSk();
                console.error('Gagal memuat ID card teman:', e);
            }
        }

        function renderIdCardTeman(profil) {
            USERNAME_ID_CARD_TERBUKA = profil.username;

            // Border, foto, efek nama & title -- petakan id border dari server
            // (profil.border) ke objek border lengkap di frontend, pola yang
            // sama dengan hasil pencarian & entri Leaderboard Quiz.
            // TAHAP 2: efek nama & title punya field server sendiri
            // (profil.efekNama/profil.title), dipetakan terpisah dari
            // borderProfil supaya kombinasi mix-and-match siswa ini ikut
            // tampil bener di ID Card, bukan cuma ikut border-nya.
            const borderProfil = getSemuaBorder().find(b => b.id === profil.border) || DAFTAR_BORDER_STARTER[0];
            const efekNamaBorderProfil = getSemuaBorder().find(b => b.id === profil.efekNama) || borderProfil;
            const titleBorderProfil = getSemuaBorder().find(b => b.id === profil.title) || borderProfil;
            const efekNamaProfil = getEfekNamaClass(efekNamaBorderProfil);
            const fotoProfil = profil.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(profil.nama)}&background=e0e7ff&color=3730a3&size=120`;

            const elFoto = document.getElementById('idcard-avatar-foto');
            const elBorder = document.getElementById('idcard-avatar-border');
            if (elFoto) {
                elFoto.src = fotoProfil;
                elFoto.onerror = () => { elFoto.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(profil.nama)}&background=e0e7ff&color=3730a3&size=120`; };
            }
            if (elBorder) {
                elBorder.src = borderProfil.file;
                elBorder.alt = `Border_${borderProfil.nama}`;
            }

            const elTitleBadge = document.getElementById('idcard-title-badge');
            // Badge utama (di sebelah nama) sudah mewakili title -- pill title di bawah
            // nama cuma dirender kalau badge utama kosong, supaya tidak tampil dobel.
            const badgeUtamaAda = !!getBadgeDevHtml(titleBorderProfil);
            if (elTitleBadge) {
                const rankLabelProfil = badgeUtamaAda ? '' : getRankLabelHtml(titleBorderProfil);
                if (rankLabelProfil) {
                    // innerHTML (bukan textContent) -- getRankLabelHtml() bisa
                    // mengembalikan tag <i> ikon, kalau dipasang lewat textContent
                    // tag-nya akan tampil sbg teks mentah, bukan ikon.
                    elTitleBadge.innerHTML = rankLabelProfil;
                    elTitleBadge.className = `inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${getTitleBadgeClass(efekNamaProfil)}`;
                } else {
                    // Border Ice -- getRankLabelHtml() sengaja balikin string
                    // kosong. Badge "❄ COLLECTOR" (dengan ikon salju) sudah
                    // tampil sendiri di #idcard-badge-dev, sebelah nama --
                    // cukup satu itu saja, versi polos tanpa ikon di sini
                    // tidak dirender. Disembunyikan TOTAL (className diganti
                    // ke 'hidden' saja, bukan cuma innerHTML dikosongkan)
                    // supaya tidak nongol sbg "pil" badge kosong-melompong.
                    elTitleBadge.innerHTML = '';
                    elTitleBadge.className = 'hidden';
                }
            }

            const elNama = document.getElementById('idcard-nama');
            elNama.textContent = profil.nama;
            elNama.className = `font-extrabold text-sm sm:text-base leading-tight truncate max-w-full ${efekNamaProfil || 'text-slate-900'}`.trim();
            const badgeDevProfil = getBadgeDevHtml(titleBorderProfil);
            const elBadgeDev = document.getElementById('idcard-badge-dev');
            if (elBadgeDev) elBadgeDev.innerHTML = badgeDevProfil || '';

            renderSosmedIdCard(profil.sosmed || {});
            renderKaryaIdCard(profil.karya || []);

            document.getElementById('idcard-kelas').textContent = `Siswa • ${profil.kelas}`;
            document.getElementById('idcard-poin-pg').textContent = profil.quiz_pg_total_poin;
            document.getElementById('idcard-jumlah-teman').textContent = profil.jumlah_teman;

            const bestEssay = Object.values(profil.quiz_essay_best_by_level || {});
            document.getElementById('idcard-best-essay').textContent = bestEssay.length ? Math.max(...bestEssay) : 0;

            const pgBest = profil.quiz_pg_best_by_level || {};
            document.getElementById('idcard-pg-easy').textContent = pgBest.easy || 0;
            document.getElementById('idcard-pg-medium').textContent = pgBest.medium || 0;
            document.getElementById('idcard-pg-hard').textContent = pgBest.hard || 0;

            const btn = document.getElementById('idcard-btn-aksi');
            const pesan = document.getElementById('idcard-pesan');
            pesan.classList.add('hidden');

            const konfigStatus = {
                diri_sendiri: { teks: 'Ini Kamu', kelas: 'bg-slate-100 text-slate-400 cursor-not-allowed', nonaktif: true, ikon: 'fa-solid fa-id-badge' },
                berteman: { teks: 'Sudah Berteman', kelas: 'bg-emerald-50 text-emerald-600 cursor-default', nonaktif: true, ikon: 'fa-solid fa-user-check' },
                menunggu_dikirim: { teks: 'Menunggu Direspon', kelas: 'bg-amber-50 text-amber-600 cursor-default', nonaktif: true, ikon: 'fa-solid fa-clock' },
                menunggu_diterima: { teks: 'Terima Permintaan', kelas: 'bg-blue-600 hover:bg-blue-700 text-white', nonaktif: false, ikon: 'fa-solid fa-user-check' },
                belum: { teks: 'Tambah Teman', kelas: 'bg-blue-600 hover:bg-blue-700 text-white', nonaktif: false, ikon: 'fa-solid fa-user-plus' }
            };
            const cfg = konfigStatus[profil.status_pertemanan] || konfigStatus.belum;
            btn.className = `w-full py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 ${cfg.kelas}`;
            btn.innerHTML = `<i class="${cfg.ikon} text-[10px]"></i> <span>${cfg.teks}</span>`;
            btn.disabled = cfg.nonaktif;
            btn.dataset.status = profil.status_pertemanan;

            // Bio Singkat cuma relevan & bisa diedit kalau ID Card yang lagi
            // dibuka ini punya kita sendiri -- untuk ID Card teman, bagian ini
            // tetap disembunyikan.
            const bioWrapper = document.getElementById('idcard-bio-wrapper');
            if (bioWrapper) {
                const iniDiriSendiri = profil.status_pertemanan === 'diri_sendiri';
                bioWrapper.classList.toggle('hidden', !iniDiriSendiri);
                if (iniDiriSendiri) loadBioSiswa();
            }
        }

        // Ikon sosmed di ID Card teman. Data diharapkan datang dari backend
        // lewat profil.sosmed (mis. { instagram: "namaakun", tiktok: "@namaakun" }).
        // Kalau field/endpoint itu belum ada di server, objeknya otomatis
        // kosong ({}) sehingga kontainer tetap disembunyikan (class "hidden")
        // -- jadi fitur ini aman dipasang duluan di frontend, tidak akan
        // menampilkan kotak kosong/rusak sebelum backend menambah datanya.
        const PLATFORM_SOSMED_IDCARD = {
            instagram: { label: 'Instagram', ikon: 'fa-brands fa-instagram', warna: 'bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400', url: v => /^https?:\/\//i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, '')}` },
            tiktok:    { label: 'TikTok',    ikon: 'fa-brands fa-tiktok',    warna: 'bg-slate-900',   url: v => /^https?:\/\//i.test(v) ? v : `https://tiktok.com/@${v.replace(/^@/, '')}` },
            youtube:   { label: 'YouTube',   ikon: 'fa-brands fa-youtube',   warna: 'bg-red-600',     url: v => /^https?:\/\//i.test(v) ? v : `https://youtube.com/@${v.replace(/^@/, '')}` },
            twitter:   { label: 'X',         ikon: 'fa-brands fa-x-twitter', warna: 'bg-slate-800',   url: v => /^https?:\/\//i.test(v) ? v : `https://x.com/${v.replace(/^@/, '')}` },
            facebook:  { label: 'Facebook',  ikon: 'fa-brands fa-facebook-f',warna: 'bg-blue-600',    url: v => /^https?:\/\//i.test(v) ? v : `https://facebook.com/${v.replace(/^@/, '')}` },
            whatsapp:  { label: 'WhatsApp',  ikon: 'fa-brands fa-whatsapp',  warna: 'bg-emerald-500', url: v => /^https?:\/\//i.test(v) ? v : `https://wa.me/${v.replace(/[^0-9]/g, '')}` }
        };

        function renderSosmedIdCard(sosmed) {
            const box = document.getElementById('idcard-sosmed-box');
            const kontainer = document.getElementById('idcard-sosmed');
            if (!kontainer || !box) return;

            const entri = Object.entries(sosmed || {}).filter(([platform, nilai]) => PLATFORM_SOSMED_IDCARD[platform] && nilai);

            if (!entri.length) {
                kontainer.innerHTML = '';
                box.classList.add('hidden');
                return;
            }

            kontainer.innerHTML = entri.map(([platform, nilai]) => {
                const p = PLATFORM_SOSMED_IDCARD[platform];
                return `<a href="${p.url(nilai)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="${p.label}" class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${p.warna} text-white flex items-center justify-center shadow-sm hover:shadow-lg hover:-translate-y-1 hover:scale-110 transition-all duration-200">
                    <i class="${p.ikon} text-sm sm:text-base"></i>
                </a>`;
            }).join('');
            box.classList.remove('hidden');
        }

        // ===== Modal "Atur Sosial Media" (profil sendiri) =====
        // Dipicu dari dropdown profil pojok kanan atas. Formnya dibangun
        // dinamis dari daftar PLATFORM_SOSMED_IDCARD yang sama dengan yang
        // dipakai untuk menampilkan sosmed di ID Card teman -- jadi kalau
        // suatu saat ada platform baru ditambahkan, cukup ubah di satu
        // tempat itu saja.
        async function bukaModalAturSosmed() {
            // Tutup dropdown profil dulu biar tidak numpuk (langsung manipulasi
            // class, bukan panggil toggleProfileDropdown() yang butuh objek
            // event asli dari klik pemicunya).
            const dropdown = document.getElementById('profile-dropdown');
            if (dropdown) dropdown.classList.add('hidden');

            const form = document.getElementById('form-atur-sosmed');
            form.innerHTML = Object.entries(PLATFORM_SOSMED_IDCARD).map(([platform, p]) => `
                <label class="flex items-center gap-2.5">
                    <span class="w-9 h-9 rounded-lg ${p.warna} text-white flex items-center justify-center shrink-0">
                        <i class="${p.ikon} text-sm"></i>
                    </span>
                    <input type="text" id="sosmed-input-${platform}" placeholder="${p.label} (username atau link)" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                </label>
            `).join('');

            const modal = document.getElementById('modal-atur-sosmed');
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Muat data yang sudah tersimpan sebelumnya dari server (best-effort
            // -- kalau endpoint/datanya belum ada, form dibiarkan kosong saja,
            // bukan dianggap error yang mengganggu).
            const _skSosmed = Array.from(document.querySelectorAll('#modal-atur-sosmed input[id^="sosmed-input-"]'));
            if (window.SkSiswa) SkSiswa.field(_skSosmed, true);
            try {
                const res = await fetch('/api/profil/sosmed');
                const json = await res.json().catch(() => null);
                const sosmedTersimpan = (json && json.sosmed) || {};
                Object.entries(sosmedTersimpan).forEach(([platform, nilai]) => {
                    const input = document.getElementById(`sosmed-input-${platform}`);
                    if (input) input.value = nilai;
                });
            } catch (e) {
                console.error('Gagal memuat sosial media tersimpan:', e);
            }
            if (window.SkSiswa) SkSiswa.field(_skSosmed, false);
        }

        function tutupModalAturSosmed() {
            const modal = document.getElementById('modal-atur-sosmed');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        async function simpanSosmedSaya() {
            const btn = document.getElementById('btn-simpan-sosmed');
            const sosmed = {};
            Object.keys(PLATFORM_SOSMED_IDCARD).forEach(platform => {
                const input = document.getElementById(`sosmed-input-${platform}`);
                const nilai = input ? input.value.trim() : '';
                if (nilai) sosmed[platform] = nilai;
            });

            const teksAsli = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[10px]"></i> <span>Menyimpan...</span>';

            try {
                const res = await fetch('/api/profil/sosmed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sosmed })
                });
                const json = await res.json().catch(() => null);
                if (!res.ok || !json || !json.success) {
                    throw new Error('Respons server tidak sukses');
                }
                triggerDynamicIsland('Sosial media berhasil disimpan!');
                tutupModalAturSosmed();
            } catch (e) {
                console.error('Gagal menyimpan sosial media ke server:', e);
                triggerDynamicIsland('Gagal menyimpan, coba lagi ya.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = teksAsli;
            }
        }

        // Karya (portofolio) teman -- dibangun dinamis dari profil.karya.
        // Diharapkan berupa array objek, mis:
        // [{ judul: "Desain Poster", gambar: "url_gambar.jpg" }, ...]
        // Kalau field/endpoint itu belum ada di server, arraynya otomatis
        // kosong sehingga tampil pesan "Belum ada karya" -- jadi bagian ini
        // aman dipasang duluan di frontend, tidak akan menampilkan kotak
        // rusak sebelum backend menambah datanya.
        function renderKaryaIdCard(karya) {
            const kontainer = document.getElementById('idcard-karya');
            const pesanKosong = document.getElementById('idcard-karya-kosong');
            if (!kontainer) return;

            const daftar = Array.isArray(karya) ? karya.filter(k => k && (k.gambar || k.judul)) : [];

            if (!daftar.length) {
                kontainer.innerHTML = '';
                if (pesanKosong) pesanKosong.classList.remove('hidden');
                return;
            }

            if (pesanKosong) pesanKosong.classList.add('hidden');
            kontainer.innerHTML = daftar.map(k => {
                const gambar = k.gambar || `https://ui-avatars.com/api/?name=${encodeURIComponent(k.judul || 'Karya')}&background=fef3c7&color=92400e&size=120`;
                const judul = k.judul || 'Karya';
                return `<a href="${k.url || gambar}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="${judul}" class="group block rounded-lg overflow-hidden border border-amber-100 bg-white aspect-square relative">
                    <img loading="lazy" decoding="async" src="${gambar}" alt="${judul}" class="w-full h-full object-cover group-hover:scale-105 transition-transform">
                    <span class="absolute inset-x-0 bottom-0 bg-black/50 text-white text-[9px] px-1.5 py-1 truncate">${judul}</span>
                </a>`;
            }).join('');
        }

        // dariTombolBack: true kalau dipanggil DARI handler popstate (tombol
        // back HP/browser sudah ditekan, history sudah otomatis mundur
        // sendiri). false/kosong kalau ditutup manual lewat tombol X atau
        // klik area gelap (backdrop) -- sama pola dengan tutupModalDetailGuru().
        function tutupIdCardTeman(dariTombolBack) {
            const modal = document.getElementById('modal-id-card-teman');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            USERNAME_ID_CARD_TERBUKA = null;

            if (!dariTombolBack && modalIdCardHistoryAktif) {
                modalIdCardHistoryAktif = false;
                history.back();
            } else {
                modalIdCardHistoryAktif = false;
            }
        }

        // Lightbox foto profil ID Card -- dibuka DI ATAS ID Card yang sudah
        // terbuka (lihat #idcard-avatar-foto di HTML). Cuma menampilkan foto
        // ukuran penuh dari foto yang sedang dipakai ID Card, tidak fetch data
        // baru ke server. Mengikuti pola history yang sama seperti ID Card &
        // Modal "Detail Penilaian Guru" -- back pertama menutup lightbox ini
        // dulu (karena selalu dibuka di atas ID Card), back kedua baru
        // menutup ID Card di baliknya.
        let modalIdCardHistoryAktif = false;
        let modalLightboxIdCardHistoryAktif = false;

        function bukaLightboxFotoIdCard() {
            const fotoSumber = document.getElementById('idcard-avatar-foto');
            const fotoLightbox = document.getElementById('lightbox-idcard-foto');
            if (!fotoSumber || !fotoLightbox || !fotoSumber.src) return;
            fotoLightbox.src = fotoSumber.src;
            const modal = document.getElementById('modal-lightbox-foto-idcard');
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            modalLightboxIdCardHistoryAktif = true;
            dorongHistoryTampilan({ type: 'modal', modal: 'lightbox-idcard' });
        }

        function tutupLightboxFotoIdCard(dariTombolBack) {
            const modal = document.getElementById('modal-lightbox-foto-idcard');
            modal.classList.add('hidden');
            modal.classList.remove('flex');

            if (!dariTombolBack && modalLightboxIdCardHistoryAktif) {
                modalLightboxIdCardHistoryAktif = false;
                history.back();
            } else {
                modalLightboxIdCardHistoryAktif = false;
            }
        }

        async function klikAksiIdCardTeman() {
            const btn = document.getElementById('idcard-btn-aksi');
            const pesan = document.getElementById('idcard-pesan');
            if (!USERNAME_ID_CARD_TERBUKA || btn.disabled) return;

            const status = btn.dataset.status;
            try {
                let json;
                if (status === 'menunggu_diterima') {
                    const res = await fetch('/api/teman/tanggapi', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ from_username: USERNAME_ID_CARD_TERBUKA, aksi: 'terima' })
                    });
                    json = await res.json();
                } else {
                    const res = await fetch('/api/teman/kirim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ to_username: USERNAME_ID_CARD_TERBUKA })
                    });
                    json = await res.json();
                }

                if (!json.success) {
                    pesan.textContent = json.message || 'Terjadi kesalahan.';
                    pesan.classList.remove('hidden');
                    return;
                }

                pesan.classList.add('hidden');
                const usernameAktif = USERNAME_ID_CARD_TERBUKA;
                await bukaIdCardTeman(usernameAktif); // refresh tampilan tombol sesuai status terbaru
                renderPermintaanTeman();
                const inputCari = document.getElementById('input-cari-teman');
                if (inputCari && inputCari.value.trim()) jalankanPencarianTeman(inputCari.value.trim());
            } catch (e) {
                console.error('Gagal memproses aksi pertemanan:', e);
            }
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('dropdown-permintaan-teman');
            const trigger = document.getElementById('btn-permintaan-teman');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        // Menu "More" khusus header versi HP -- cuma wadah ringkas berisi
        // shortcut ke Rahasia & Warna Aksen (fungsi aslinya tidak berubah,
        // cuma dikumpulkan biar header gak padat di layar sempit).
        function toggleMoreHeaderDropdown(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('dropdown-more-header');
            const trigger = document.getElementById('btn-more-header');
            const profileDropdown = document.getElementById('profile-dropdown');
            const bellDropdown = document.getElementById('bell-dropdown');
            const aksenDropdown = document.getElementById('panel-aksen-tema');
            if (!dropdown) return;

            if (profileDropdown) profileDropdown.classList.add('hidden');
            if (bellDropdown) bellDropdown.classList.add('hidden');
            if (aksenDropdown) aksenDropdown.classList.add('hidden');

            const akanDibuka = dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', String(akanDibuka));
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('dropdown-more-header');
            const trigger = document.getElementById('btn-more-header');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        function toggleBellDropdown(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('bell-dropdown');
            const trigger = document.getElementById('btn-bell');
            const profileDropdown = document.getElementById('profile-dropdown');
            const moreDropdown = document.getElementById('dropdown-more-header');
            if (!dropdown) return;

            if (profileDropdown) profileDropdown.classList.add('hidden'); // biar gak numpuk 2 dropdown sekaligus
            if (moreDropdown) moreDropdown.classList.add('hidden');

            const akanDibuka = dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', String(akanDibuka));

            if (akanDibuka) {
                renderBellDropdown();
                // Baru dianggap "dilihat" begitu lonceng dibuka & isinya sempat
                // tampil — sebelum diklik, titik merah tetap menyala.
                tandaiSemuaLoncengDilihat(getDaftarNotifikasiLonceng().map(n => n.id));
                updateBadgeLonceng();
            }
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('bell-dropdown');
            const trigger = document.getElementById('btn-bell');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        /* ================= SIDEBAR MOBILE (hamburger) = BOTTOM SHEET "MENU LAINNYA" (HP) =================
           Di HP, #sidebar-utama berperan sebagai bottom sheet MODAL: tampil di atas SELURUH
           antarmuka (termasuk #bottom-nav-mobile) dengan backdrop #sidebar-overlay. Posisi,
           z-index, animasi & prefers-reduced-motion diatur di CSS (blok "BOTTOM SHEET MENU
           LAINNYA - MODAL OVERLAY"); file ini mengurus STATE + perilaku:
             - buka/tutup lewat class "translate-y-full" (sheet) & "hidden" (backdrop) --
               mekanisme lama dipertahankan, jadi switchTab(), drag-to-close, dsb tetap jalan
             - kunci scroll halaman belakang & pulihkan ke kondisi SEBELUMNYA (bukan paksa '')
               supaya tidak menimpa modal lain yang kebetulan sudah mengunci scroll
             - semantik dialog (role/aria-modal/label) hanya di HP; di desktop #sidebar-utama
               adalah sidebar statis biasa, jadi atribut dialog dilepas lagi
             - fokus: pindah ke dalam sheet saat dibuka, kembali ke pemicu saat ditutup
             - Escape, klik backdrop & focus-trap Tab dipasang di setupModalSheetMenuLainnya()
           Di desktop (>=768px) fungsi buka/tutup ini tidak berpengaruh apa pun. */
        let sheetMenuLainnyaTerbuka = false;
        let sheetPemicuFokus = null;
        let sheetSnapshotOverflow = null;

        function kunciScrollHalaman() {
            if (sheetSnapshotOverflow) return;
            sheetSnapshotOverflow = {
                body: document.body.style.overflow,
                html: document.documentElement.style.overflow
            };
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
        }

        function bukaKunciScrollHalaman() {
            if (!sheetSnapshotOverflow) return;
            document.body.style.overflow = sheetSnapshotOverflow.body;
            document.documentElement.style.overflow = sheetSnapshotOverflow.html;
            sheetSnapshotOverflow = null;
        }

        function ambilElemenFokusSheet(sidebar) {
            const kandidat = sidebar.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            return Array.from(kandidat).filter(el => el.getClientRects().length > 0);
        }

        // role="dialog" + aria-modal + label HANYA di HP (saat sheet memang jadi modal).
        function sinkronkanSemantikSheet() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            if (!sidebar) return;
            if (window.innerWidth < 768) {
                sidebar.setAttribute('role', 'dialog');
                sidebar.setAttribute('aria-modal', 'true');
                if (!sidebar.hasAttribute('aria-label') && !sidebar.hasAttribute('aria-labelledby')) {
                    sidebar.setAttribute('aria-label', 'Menu Lainnya');
                    sidebar.setAttribute('data-aria-label-sheet', '1');
                }
                if (!sidebar.hasAttribute('tabindex')) sidebar.setAttribute('tabindex', '-1');
                if (overlay) overlay.setAttribute('aria-hidden', 'true');
                // Tombol tutup (X) di header sheet: pastikan punya label aksesibel.
                const header = document.getElementById('menu-lainnya-drag-header');
                if (header) {
                    header.querySelectorAll('button').forEach(btn => {
                        const adaLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby') || btn.textContent.trim() !== '';
                        if (!adaLabel) btn.setAttribute('aria-label', 'Tutup Menu Lainnya');
                    });
                }
            } else {
                if (sidebar.getAttribute('role') === 'dialog') sidebar.removeAttribute('role');
                sidebar.removeAttribute('aria-modal');
                if (sidebar.hasAttribute('data-aria-label-sheet')) {
                    sidebar.removeAttribute('aria-label');
                    sidebar.removeAttribute('data-aria-label-sheet');
                }
            }
        }

        function bukaSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            const tombolLainnya = document.getElementById('btn-bottom-lainnya');
            if (!sidebar || !overlay) return;
            if (window.innerWidth >= 768 || sheetMenuLainnyaTerbuka) return;

            sheetMenuLainnyaTerbuka = true;
            const aktif = document.activeElement;
            sheetPemicuFokus = (aktif && aktif !== document.body) ? aktif : tombolLainnya;

            sinkronkanSemantikSheet();
            sidebar.style.transform = ''; // buang sisa transform inline dari drag sebelumnya
            sidebar.classList.remove('translate-y-full');
            overlay.classList.remove('hidden');
            if (tombolLainnya) tombolLainnya.setAttribute('aria-expanded', 'true');
            kunciScrollHalaman();

            // Fokus dipindah 1 frame kemudian: sheet baru saja berubah dari visibility:hidden.
            requestAnimationFrame(() => {
                if (!sheetMenuLainnyaTerbuka) return;
                const target = ambilElemenFokusSheet(sidebar)[0] || sidebar;
                target.focus({ preventScroll: true });
            });
        }

        function toggleSidebarMobile() {
            if (sheetMenuLainnyaTerbuka) closeSidebarMobile();
            else bukaSidebarMobile();
        }

        function closeSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            const tombolLainnya = document.getElementById('btn-bottom-lainnya');
            if (!sidebar || !overlay) return;
            const barusajaTerbuka = sheetMenuLainnyaTerbuka;
            sheetMenuLainnyaTerbuka = false;
            sidebar.classList.add('translate-y-full');
            overlay.classList.add('hidden');
            if (tombolLainnya) tombolLainnya.setAttribute('aria-expanded', 'false');
            bukaKunciScrollHalaman();

            if (barusajaTerbuka) {
                const pemicu = (sheetPemicuFokus && document.contains(sheetPemicuFokus)) ? sheetPemicuFokus : tombolLainnya;
                sheetPemicuFokus = null;
                if (pemicu && typeof pemicu.focus === 'function') pemicu.focus({ preventScroll: true });
            }
        }

        /* Interaksi modal: portal ke <body> (di HP), klik backdrop, Escape, focus-trap Tab.
           Portal: #sidebar-utama & #sidebar-overlay dipindah jadi anak langsung <body> selama
           layar HP, supaya z-index-nya dibandingkan langsung dengan #bottom-nav-mobile dan tidak
           terjebak stacking context pembungkus (transform/opacity/z-index di wrapper layout).
           Di desktop keduanya dikembalikan persis ke posisi DOM semula (lewat penanda komentar),
           karena di sana #sidebar-utama adalah sidebar statis bagian dari layout. */
        (function setupModalSheetMenuLainnya() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            if (!sidebar || !overlay) return;

            const penandaAsal = new Map();
            function pindahKeBody() {
                [overlay, sidebar].forEach(el => { // overlay dulu, supaya sheet selalu di atasnya
                    if (el.parentNode === document.body || penandaAsal.has(el)) return;
                    const penanda = document.createComment('portal-asal:' + el.id);
                    el.parentNode.insertBefore(penanda, el);
                    penandaAsal.set(el, penanda);
                    document.body.appendChild(el);
                });
            }
            function kembalikanKeAsal() {
                penandaAsal.forEach((penanda, el) => {
                    if (penanda.parentNode) {
                        penanda.parentNode.insertBefore(el, penanda);
                        penanda.parentNode.removeChild(penanda);
                    }
                });
                penandaAsal.clear();
            }
            const mq = window.matchMedia('(max-width: 767.98px)');
            function sinkronkanPortal() {
                if (mq.matches) pindahKeBody(); else kembalikanKeAsal();
            }
            sinkronkanPortal();
            if (mq.addEventListener) mq.addEventListener('change', sinkronkanPortal);
            else if (mq.addListener) mq.addListener(sinkronkanPortal);

            sinkronkanSemantikSheet();

            // Klik backdrop = tutup. Klik di dalam panel tidak sampai ke sini (target harus overlay-nya).
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && sheetMenuLainnyaTerbuka) closeSidebarMobile();
            });

            document.addEventListener('keydown', (e) => {
                if (!sheetMenuLainnyaTerbuka) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSidebarMobile();
                    return;
                }
                if (e.key !== 'Tab') return;
                const daftar = ambilElemenFokusSheet(sidebar);
                if (daftar.length === 0) {
                    e.preventDefault();
                    sidebar.focus({ preventScroll: true });
                    return;
                }
                const pertama = daftar[0];
                const terakhir = daftar[daftar.length - 1];
                const aktif = document.activeElement;
                if (!sidebar.contains(aktif)) {
                    e.preventDefault();
                    pertama.focus();
                } else if (e.shiftKey && (aktif === pertama || aktif === sidebar)) {
                    e.preventDefault();
                    terakhir.focus();
                } else if (!e.shiftKey && aktif === terakhir) {
                    e.preventDefault();
                    pertama.focus();
                }
            });
        })();

        /* ================= ANIMASI "SEOLAH KEPILIH" SAAT SCROLL SIDEBAR DI HP =================
           Selama nav sidebar lagi discroll (jari nempel/geser ke atas-bawah),
           menu yang posisinya paling dekat ke tengah area sidebar dikasih efek
           picker-wheel (sedikit membesar + tint biru) sebagai feedback visual
           sementara. Begitu scroll berhenti, efeknya hilang lagi -- tidak ikut
           mengubah tab yang beneran aktif. */
        (function setupAnimasiPickerSidebar() {
            const sidebar = document.getElementById('sidebar-utama');
            const nav = document.getElementById('sidebar-menu');
            if (!sidebar || !nav) return;

            let idleTimerPicker = null;

            // Klik tombol menu (bukan scroll asli jari) kadang ikut memicu
            // browser auto-scroll sidebar buat fokus tombolnya -- ini bikin
            // event 'scroll' di bawah ikut jalan padahal user cuma nge-klik,
            // dan tombol yang posisinya kebetulan paling dekat ke tengah
            // (mis. "Tugas & Catatan" di antara "Koleksi Border" & "Daftar
            // Guru") jadi kena tint efek picker meski tidak sedang discroll.
            // Selama flag ini aktif, efek picker sengaja tidak dipasang.
            let suppressPicker = false;
            nav.addEventListener('click', () => {
                suppressPicker = true;
                clearTimeout(idleTimerPicker);
                ambilTombolNav().forEach(tombol => tombol.classList.remove('nav-btn-picking'));
                setTimeout(() => { suppressPicker = false; }, 400);
            }, true);

            function ambilTombolNav() {
                return Array.from(nav.querySelectorAll('.nav-btn'));
            }

            function sorotTombolTerdekatKeTengah() {
                const tombolList = ambilTombolNav();
                if (tombolList.length === 0) return;

                const rectSidebar = sidebar.getBoundingClientRect();
                const titikTengah = rectSidebar.top + (rectSidebar.height / 2);

                let terdekat = null;
                let jarakTerdekat = Infinity;

                tombolList.forEach(tombol => {
                    const rect = tombol.getBoundingClientRect();
                    const tengahTombol = rect.top + (rect.height / 2);
                    const jarak = Math.abs(tengahTombol - titikTengah);
                    if (jarak < jarakTerdekat) {
                        jarakTerdekat = jarak;
                        terdekat = tombol;
                    }
                    tombol.classList.remove('nav-btn-picking');
                });

                if (terdekat) terdekat.classList.add('nav-btn-picking');
            }

            function saatAdaAktivitasScroll() {
                if (suppressPicker) return;
                sorotTombolTerdekatKeTengah();
                clearTimeout(idleTimerPicker);
                idleTimerPicker = setTimeout(() => {
                    // Scroll berhenti -> lepas semua efek sorot sementara
                    ambilTombolNav().forEach(tombol => tombol.classList.remove('nav-btn-picking'));
                }, 350);
            }

            sidebar.addEventListener('scroll', saatAdaAktivitasScroll, { passive: true });
        })();

        /* ================= DRAG-TO-SELECT BOTTOM NAV =================
           Tahan salah satu ikon bottom nav, geser jari/mouse ke ikon lain TANPA
           dilepas -> ikon di bawah pointer disorot real-time (class SEMENTARA
           "bottom-nav-item--picking", terpisah dari tab aktif permanen
           "bottom-nav-item--active" yang cuma diubah oleh switchTab()).

           Navigasi BARU terjadi saat pointer dilepas di atas ikon yang valid,
           lewat item.click() -> memanggil onclick asli tombol (switchTab /
           toggleSidebarMobile), jadi gerbang maintenance, tutup-sidebar, dsb.
           tetap jalan persis seperti klik biasa.

           Kenapa tidak cukup mengandalkan "klik bawaan browser": setelah drag,
           browser menembakkan click ke tombol AWAL (touch: implicit pointer
           capture) atau ke elemen induk (mouse), BUKAN ke tombol tujuan -- dan
           bisa juga menembak walau jari dilepas di luar nav. Karena itu, kalau
           gestur sudah berupa drag, click bawaan diblok sekali (capture) dan
           keputusan navigasi dibuat manual di pointerup.

           Tap/klik biasa (pointer tidak pernah meninggalkan tombol awal) sama
           sekali tidak disentuh -> klik bawaan tetap jalan.
           Batal: pointercancel, tombol Escape, window blur, tab disembunyikan,
           atau dilepas di luar nav -> semua highlight dibersihkan, tidak pindah. */
        (function setupDragToSelectBottomNav() {
            const nav = document.getElementById('bottom-nav-mobile');
            if (!nav) return;

            const KELAS_SOROT = 'bottom-nav-item--picking';
            const AMBANG_GESER_PX = 6;
            let gestur = null; // { id, awal, x, y, drag }
            let itemTersorot = null;

            function cariItem(x, y) {
                const el = document.elementFromPoint(x, y);
                const item = el ? el.closest('.bottom-nav-item') : null;
                return item && nav.contains(item) ? item : null;
            }
            function sorot(item) {
                if (itemTersorot === item) return;
                if (itemTersorot) itemTersorot.classList.remove(KELAS_SOROT);
                itemTersorot = item;
                if (item) item.classList.add(KELAS_SOROT);
            }
            // Blok SATU click bawaan susulan (maks. 400 ms) supaya tidak terjadi
            // navigasi ganda / navigasi ke tombol awal setelah drag.
            function blokClickBawaan() {
                const handler = (ev) => { ev.stopPropagation(); ev.preventDefault(); lepas(); };
                const lepas = () => { window.removeEventListener('click', handler, true); clearTimeout(t); };
                const t = setTimeout(lepas, 400);
                window.addEventListener('click', handler, true);
            }
            function bersihkan() {
                sorot(null);
                gestur = null;
            }

            nav.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                if (!e.isPrimary) return;
                const item = e.target.closest('.bottom-nav-item');
                if (!item) return;
                gestur = { id: e.pointerId, awal: item, x: e.clientX, y: e.clientY, drag: false };
                sorot(item);
            });

            // Di document (bukan nav) supaya tetap menerima event walau pointer
            // (mouse) sudah keluar dari area nav.
            document.addEventListener('pointermove', (e) => {
                if (!gestur || e.pointerId !== gestur.id) return;
                const item = cariItem(e.clientX, e.clientY);
                if (!gestur.drag) {
                    const jauh = Math.hypot(e.clientX - gestur.x, e.clientY - gestur.y) > AMBANG_GESER_PX;
                    if (item !== gestur.awal || jauh) gestur.drag = true;
                }
                sorot(item); // null kalau di luar nav -> highlight hilang
            });

            document.addEventListener('pointerup', (e) => {
                if (!gestur || e.pointerId !== gestur.id) return;
                const { drag } = gestur;
                const tujuan = cariItem(e.clientX, e.clientY);
                bersihkan();
                if (!drag) return;           // tap/klik biasa -> biarkan klik bawaan
                // drag -> keputusan navigasi di tangan kita. URUTAN PENTING: click
                // manual dulu (sinkron), baru pasang pemblok click bawaan -- kalau
                // dibalik, click manual ini ikut terblokir.
                if (tujuan) tujuan.click();  // valid: pindah tab lewat onclick aslinya
                blokClickBawaan();
                // di luar nav: tidak melakukan apa-apa (halaman tetap)
            });

            document.addEventListener('pointercancel', (e) => {
                if (gestur && e.pointerId === gestur.id) {
                    const adaDrag = gestur.drag;
                    bersihkan();
                    if (adaDrag) blokClickBawaan();
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && gestur) { const d = gestur.drag; bersihkan(); if (d) blokClickBawaan(); }
            });
            window.addEventListener('blur', bersihkan);
            document.addEventListener('visibilitychange', () => { if (document.hidden) bersihkan(); });
            nav.addEventListener('contextmenu', (e) => { if (gestur) e.preventDefault(); }); // long-press menu
        })();

        /* ================= ANIMASI "SEOLAH DIPILIH" SAAT MENU PENGATURAN AKUN DITAHAN =================
           Perilaku sama persis dengan setupAnimasiPickerBottomNav &
           setupAnimasiPickerMenuLainnya di atas, tapi untuk daftar menu
           "Pengaturan Akun & Preferensi" (Edit Profil/Notifikasi/Pusat
           Bantuan/Keluar dari Akun): begitu jari nempel di salah satu menu
           lalu digeser ke atas/bawah TANPA dilepas, sorotannya (warna latar
           item-sedang-ditekan) ikut pindah mengikuti jari ke menu yang ada
           tepat di bawahnya -- persis gestur geser-pilih di menu native
           Android/iOS. Ini murni feedback visual; begitu jari dilepas, klik
           tetap otomatis jatuh ke menu yang sedang disorot (perilaku bawaan
           browser untuk pointerup), jadi tidak perlu memicu aksinya manual
           dari sini. touch-action:none dipasang di CSS (.menu-list-touch-fix)
           supaya geser jari di sini tidak dianggap gestur scroll biasa. */
        (function setupAnimasiPickerMenuAkun() {
            const container = document.querySelector('.menu-list-touch-fix');
            if (!container) return;

            const KELAS_TEKAN = 'item-sedang-ditekan';
            const SELECTOR_ITEM = '.menu-list-touch-fix > *, .menu-list-touch-fix-rose';
            let sedangMenahan = false;
            let itemTersorot = null;

            function ambilItem(el) {
                return el ? el.closest(SELECTOR_ITEM) : null;
            }

            function sorotItem(item) {
                if (itemTersorot === item) return;
                if (itemTersorot) itemTersorot.classList.remove(KELAS_TEKAN);
                itemTersorot = item;
                if (itemTersorot) itemTersorot.classList.add(KELAS_TEKAN);
            }

            function lepasSorotan() {
                sorotItem(null);
                sedangMenahan = false;
            }

            container.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse') return; // biar laptop/mouse tetap pakai :hover normal
                const item = ambilItem(e.target);
                if (!item) return;
                sedangMenahan = true;
                sorotItem(item);
            });

            container.addEventListener('pointermove', (e) => {
                if (!sedangMenahan) return;
                const elDiBawahJari = document.elementFromPoint(e.clientX, e.clientY);
                const item = ambilItem(elDiBawahJari);
                sorotItem(item && container.contains(item) ? item : null);
            });

            container.addEventListener('pointerup', lepasSorotan);
            container.addEventListener('pointercancel', lepasSorotan);
            container.addEventListener('pointerleave', () => {
                if (sedangMenahan) sorotItem(null);
            });
        })();

        /* ================= ANIMASI "SEOLAH DIPILIH" SAAT MENU LAINNYA DITAHAN =================
           Perilaku sama persis dengan setupAnimasiPickerBottomNav di atas, tapi
           untuk daftar menu di dalam sheet "Menu Lainnya" (Koleksi Prestasi,
           Daftar Guru, Cari Teman, Perangkat, AI Support, IT Support, dst).
           Dipisah dari IIFE picker-scroll yang sudah ada (setupAnimasiPickerSidebar)
           supaya keduanya tetap bisa jalan berdampingan tanpa saling mengganggu. */
        (function setupAnimasiPickerMenuLainnya() {
            const nav = document.getElementById('sidebar-menu');
            if (!nav) return;

            let sedangMenahan = false;
            let itemTersorot = null;

            function sorotItem(item) {
                if (itemTersorot === item) return;
                if (itemTersorot) itemTersorot.classList.remove('nav-btn-picking');
                itemTersorot = item;
                if (itemTersorot) itemTersorot.classList.add('nav-btn-picking');
            }

            function lepasSorotan() {
                sorotItem(null);
                sedangMenahan = false;
            }

            nav.addEventListener('pointerdown', (e) => {
                const item = e.target.closest('.nav-btn, #btn-it-support');
                if (!item) return;
                sedangMenahan = true;
                sorotItem(item);
            });

            nav.addEventListener('pointermove', (e) => {
                if (!sedangMenahan) return;
                const elDiBawahJari = document.elementFromPoint(e.clientX, e.clientY);
                const item = elDiBawahJari ? elDiBawahJari.closest('.nav-btn, #btn-it-support') : null;
                sorotItem(item && nav.contains(item) ? item : null);
            });

            nav.addEventListener('pointerup', lepasSorotan);
            nav.addEventListener('pointercancel', lepasSorotan);
            nav.addEventListener('pointerleave', () => {
                if (sedangMenahan) sorotItem(null);
            });
        })();

        /* ================= DRAG-TO-CLOSE + RUBBER-BAND BOTTOM SHEET "MENU LAINNYA" (HP) =================
           User bisa tarik ke bawah dari handle (grip kecil) atau header (judul
           + tombol X) buat menutup sheet -- panel mengikuti jari secara
           real-time (transform: translateY), lalu snap-back kalau tarikannya
           belum cukup jauh/cepat, atau lanjut slide-down menutup kalau sudah
           melewati ambang batas.

           Kalau jari ditarik ke ATAS (panel sudah di posisi paling atas),
           panel TETAP ikut bergerak tapi dengan "tahanan" (rubber-band, mirip
           overscroll bounce native iOS/Android) -- makin ditarik makin berat,
           bukan langsung mandek kaku di posisi 0. Waktu dilepas, panel balik
           ke posisi semula pakai easing spring/bounce (bukan easing
           decelerating biasa yang dipakai buat animasi buka/tutup).

           Sengaja HANYA dipasang di handle & header (BUKAN di seluruh isi
           #sidebar-menu) supaya:
           1) tidak bentrok dengan gestur tahan+geser punya
              setupAnimasiPickerMenuLainnya di atas (yang sudah pakai
              pointer events + touch-action:none di #sidebar-menu), dan
           2) scroll daftar menu (kalau isinya lebih tinggi dari layar) tetap
              berjalan seperti semula, tidak mungkin ke-trigger jadi
              drag-to-close secara tidak sengaja. */
        (function setupDragTutupMenuLainnya() {
            const sidebar = document.getElementById('sidebar-utama');
            const handle = document.getElementById('menu-lainnya-drag-handle');
            const header = document.getElementById('menu-lainnya-drag-header');
            if (!sidebar || (!handle && !header)) return;

            const AMBANG_PERSEN_TINGGI = 0.3; // tarik > ~30% tinggi panel -> dianggap CLOSE
            const AMBANG_KECEPATAN = 0.5; // px/ms ke bawah -> swipe cepat juga dianggap CLOSE
            const KONSTANTA_KARET = 0.55; // makin kecil = makin "berat"/kaku tahanannya (formula rubber-band standar iOS)

            // Formula rubber-band (dipakai UIScrollView iOS): efeknya tarikan
            // awal masih kerasa ringan, lalu makin jauh ditarik makin berat
            // & mendekati batas asimtot -- tidak akan lari jauh tak terbatas.
            function efekKaret(jarakTarik, dimensiPanel, konstanta) {
                return (jarakTarik * dimensiPanel * konstanta) / (dimensiPanel + konstanta * jarakTarik);
            }

            let drag = null;

            function pasangZonaDrag(zona) {
                zona.addEventListener('pointerdown', (e) => {
                    if (window.innerWidth >= 768) return; // fitur ini cuma untuk tampilan HP, desktop tidak kepakai
                    drag = {
                        startY: e.clientY,
                        tinggiPanel: sidebar.offsetHeight,
                        lastY: e.clientY,
                        lastT: e.timeStamp,
                        kecepatan: 0,
                        deltaYTerakhir: 0
                    };
                    sidebar.classList.remove('menu-lainnya-snapback');
                    sidebar.classList.add('menu-lainnya-dragging');
                    zona.setPointerCapture(e.pointerId);
                });

                zona.addEventListener('pointermove', (e) => {
                    if (!drag) return;
                    const rawDeltaY = e.clientY - drag.startY;
                    let deltaY;
                    if (rawDeltaY >= 0) {
                        deltaY = rawDeltaY; // tarik ke bawah: ikut jari 1:1 seperti biasa
                    } else {
                        // tarik ke atas: jangan mandek di 0, kasih efek karet/elastis
                        deltaY = -efekKaret(-rawDeltaY, drag.tinggiPanel, KONSTANTA_KARET);
                    }
                    sidebar.style.transform = `translateY(${deltaY}px)`;

                    const deltaT = e.timeStamp - drag.lastT;
                    if (deltaT > 0) drag.kecepatan = (e.clientY - drag.lastY) / deltaT;
                    drag.lastY = e.clientY;
                    drag.lastT = e.timeStamp;
                    drag.deltaYTerakhir = deltaY;
                });

                const selesaiDrag = () => {
                    if (!drag) return;
                    const { deltaYTerakhir, tinggiPanel, kecepatan } = drag;
                    const harusTutup = deltaYTerakhir > tinggiPanel * AMBANG_PERSEN_TINGGI || kecepatan > AMBANG_KECEPATAN;
                    drag = null;

                    requestAnimationFrame(() => {
                        sidebar.classList.remove('menu-lainnya-dragging');
                        void sidebar.offsetHeight; // paksa reflow biar transition kepasang sebelum transform berubah
                        if (harusTutup) {
                            sidebar.style.transform = 'translateY(100%)';
                            const onSelesaiAnimasi = (ev) => {
                                if (ev.target !== sidebar || ev.propertyName !== 'transform') return;
                                sidebar.removeEventListener('transitionend', onSelesaiAnimasi);
                                sidebar.style.transform = '';
                                closeSidebarMobile();
                            };
                            sidebar.addEventListener('transitionend', onSelesaiAnimasi);
                        } else {
                            // Snap-back (baik dari tarikan ke bawah yang kurang jauh,
                            // maupun dari tarikan ke atas/karet) -- pakai easing
                            // spring/bounce sebentar biar kerasa lentur, bukan kaku.
                            sidebar.classList.add('menu-lainnya-snapback');
                            sidebar.style.transform = '';
                            const bersihkanSnapback = (ev) => {
                                if (ev.target !== sidebar || ev.propertyName !== 'transform') return;
                                sidebar.removeEventListener('transitionend', bersihkanSnapback);
                                sidebar.classList.remove('menu-lainnya-snapback');
                            };
                            sidebar.addEventListener('transitionend', bersihkanSnapback);
                        }
                    });
                };

                zona.addEventListener('pointerup', selesaiDrag);
                zona.addEventListener('pointercancel', selesaiDrag);
            }

            if (handle) pasangZonaDrag(handle);
            if (header) pasangZonaDrag(header);
        })();

        // Kalau layar di-resize jadi ukuran desktop, pastikan overlay & state mobile ke-reset
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) {
                // Ke desktop: tutup sheet tuntas (state + class + kunci scroll) supaya
                // balik lagi ke HP tidak muncul sheet terbuka tanpa backdrop.
                sheetMenuLainnyaTerbuka = false;
                sheetPemicuFokus = null;
                document.getElementById('sidebar-overlay')?.classList.add('hidden');
                const sidebarUtama = document.getElementById('sidebar-utama');
                if (sidebarUtama) {
                    sidebarUtama.style.transform = '';
                    sidebarUtama.classList.add('translate-y-full');
                }
                document.getElementById('btn-bottom-lainnya')?.setAttribute('aria-expanded', 'false');
                bukaKunciScrollHalaman();
            }
            sinkronkanSemantikSheet();
        });

        // FIX BUG RESPONSIVE "Menu Akun" (tab Profil) KOSONG setelah F12 mobile -> desktop:
        // #tab-profil adalah halaman KHUSUS HP -- di HTML class-nya "hidden sm:hidden"
        // (di desktop siswa memakai dropdown profil di header, bukan tab ini, dan
        // sidebar desktop memang tidak punya tombol Profil). switchTab('profil') cuma
        // membuang class "hidden", sedangkan "sm:hidden" (display:none mulai >=640px)
        // tetap menempel -- jadi begitu viewport melebar lewat breakpoint sm sementara
        // Profil masih jadi tab aktif, section-nya langsung display:none dan TIDAK ADA
        // tab lain yang tampil => konten kosong. Tidak ada kode yang memperbarui state
        // tab saat viewport berubah, makanya muncul bug ini.
        // Solusi: pantau breakpoint sm yang SAMA dengan Tailwind lewat matchMedia
        // (bukan hardcode ukuran layar di tempat lain). Melebar ke desktop -> pindah ke
        // Beranda (ingat bahwa tadinya di Profil). Kembali ke HP -> buka Profil lagi
        // selama siswa belum pindah ke tab lain. Perpindahan otomatis ini TIDAK
        // menambah entri history (tombol back tidak terganggu).
        (function sinkronkanTabProfilDenganViewport() {
            if (!window.matchMedia) return;
            const mqDesktop = window.matchMedia('(min-width: 640px)'); // = breakpoint "sm" Tailwind
            let profilDitinggalkanKarenaDesktop = false;

            function pindahTanpaHistory(tab) {
                sedangMemprosesPopStateApp = true;
                try {
                    switchTab(tab);
                } finally {
                    sedangMemprosesPopStateApp = false;
                }
                stateTampilanTerakhirApp = { type: 'tab', tab: tab };
            }

            function sinkronkan() {
                const tabProfil = document.getElementById('tab-profil');
                if (!tabProfil) return;
                if (mqDesktop.matches) {
                    if (!tabProfil.classList.contains('hidden')) {
                        profilDitinggalkanKarenaDesktop = true;
                        pindahTanpaHistory('beranda');
                    }
                } else if (profilDitinggalkanKarenaDesktop) {
                    profilDitinggalkanKarenaDesktop = false;
                    const tabBeranda = document.getElementById('tab-beranda');
                    if (tabBeranda && !tabBeranda.classList.contains('hidden')) {
                        pindahTanpaHistory('profil');
                    }
                }
            }

            if (mqDesktop.addEventListener) mqDesktop.addEventListener('change', sinkronkan);
            else if (mqDesktop.addListener) mqDesktop.addListener(sinkronkan); // Safari lama
            // Kasus lain: tombol back/forward me-replay state "profil" saat viewport
            // sudah desktop -- dicek ulang setelah handler popstate utama selesai.
            window.addEventListener('popstate', () => setTimeout(sinkronkan, 0));
        })();

        // Header sub-halaman khusus HP: dipakai supaya halaman yang diakses lewat
        // menu "Lainnya" (mis. Koleksi Prestasi) terasa seperti halaman tersendiri
        // di HP -- header jam diganti sementara jadi judul halaman. Cuma berlaku
        // di HP (lihat aturan CSS "header--sub-halaman-mobile" di <style>), di
        // layar sm+ tidak berubah apa-apa.
        function aktifkanHeaderMobileSubHalaman(judul) {
            const header = document.getElementById('header-utama');
            const teks = document.getElementById('judul-halaman-mobile-teks');
            if (teks) teks.innerText = judul;
            if (header) header.classList.add('header--sub-halaman-mobile');
        }

        function nonaktifkanHeaderMobileSubHalaman() {
            const header = document.getElementById('header-utama');
            if (header) header.classList.remove('header--sub-halaman-mobile');
        }

        /* ================= TOMBOL "BACK" HP / BROWSER MENGIKUTI URUTAN KLIK =================
           Setiap kali user pindah tab utama (switchTab) ATAU pindah tahap alur Quiz
           (tampilkanViewQuiz), state-nya didorong ke history browser lewat
           history.pushState(). Saat tombol back HP/browser ditekan, event 'popstate'
           menangkapnya dan mengembalikan tampilan PERSIS sesuai urutan klik
           sebelumnya -- bukan cuma satu langkah tetap, tapi urutan asli yang user
           klik, sampai akhirnya mentok di Beranda (state paling awal). Begitu di
           Beranda & back ditekan sekali lagi, tidak ada lagi state app yang
           tersisa di stack -- browser otomatis lanjut ke perilaku back bawaan
           (keluar aplikasi / balik ke halaman sebelumnya), sesuai yang diminta.

           CATATAN CAKUPAN: sistem ini menangani navigasi tab utama & alur pilih
           jenis/kategori/mapel/tingkat kesulitan Quiz. Tahap SEDANG MENGERJAKAN
           quiz ('play') & halaman hasil ('result') SENGAJA tidak didorong ke
           history -- supaya tombol back HP tidak sengaja memutus soal yang lagi
           dikerjakan siswa atau menampilkan ulang hasil yang sudah lewat. Modal
           (mis. Kelola Guru, Crop Foto, dsb) juga belum tercakup di sistem ini. */
        let sedangMemprosesPopStateApp = false; // true selagi lagi replay dari tombol back (anti-loop)
        let stateTampilanTerakhirApp = { type: 'tab', tab: 'beranda' };

        // true selagi Modal "Detail Penilaian Guru" kebuka LEWAT dorongHistoryTampilan
        // (lihat bukaModalDetailGuru) -- dicek duluan di listener 'popstate' di bawah
        // supaya tombol back HP/browser MENUTUP MODAL INI DULU, bukan langsung
        // memproses navigasi tab/quiz seperti biasa.
        let modalGuruHistoryAktif = false;

        function dorongHistoryTampilan(state) {
            if (sedangMemprosesPopStateApp) return; // lagi replay dari back -> jangan didorong lagi
            if (JSON.stringify(state) === JSON.stringify(stateTampilanTerakhirApp)) return; // state identik, jangan dobel
            stateTampilanTerakhirApp = state;
            try {
                history.pushState(Object.assign({ appNav: true }, state), '', location.href);
            } catch (err) {
                console.error('Gagal mendorong history tampilan:', err);
            }
        }

        function terapkanStateHistoryTampilan(state) {
            if (!state || !state.appNav) return; // bukan state dari sistem navigasi app ini
            sedangMemprosesPopStateApp = true;
            stateTampilanTerakhirApp = state;
            try {
                if (state.type === 'tab') {
                    switchTab(state.tab);
                } else if (state.type === 'quizView') {
                    switchTab('quiz'); // pastikan tab utama Quiz aktif dulu (bisa saja user sempat pindah tab lain)
                    if (state.jenis) {
                        quizJenisDipilih = state.jenis;
                        const label = document.getElementById('quiz-kategori-jenis-badge');
                        if (label) label.innerText = state.jenis === 'essay' ? 'Essay' : 'Pilihan Ganda';
                    }
                    if (state.view === 'pilih-mapel' && state.kategori) {
                        quizMapelState.kategori = state.kategori;
                        renderDaftarPilihMapelQuiz(state.kategori);
                    }
                    tampilkanViewQuiz(state.view);
                }
            } finally {
                sedangMemprosesPopStateApp = false;
            }
        }

        window.addEventListener('popstate', (event) => {
            // Urutan cek SENGAJA dari modal paling "atas" ke paling "bawah",
            // karena lightbox foto ID Card selalu dibuka DI ATAS ID Card yang
            // sudah terbuka -- back pertama harus menutup lightbox dulu,
            // BUKAN langsung tembus menutup ID Card di baliknya sekaligus.
            if (modalLightboxIdCardHistoryAktif) {
                modalLightboxIdCardHistoryAktif = false;
                tutupLightboxFotoIdCard(true);
                return;
            }
            // ID Card (punya sendiri maupun teman) ikut ditutup otomatis
            // kalau tombol back HP/browser (atau swipe-back) ditekan selagi
            // modal ini masih kebuka -- pola sama seperti Modal "Detail
            // Penilaian Guru" di bawah.
            if (modalIdCardHistoryAktif) {
                modalIdCardHistoryAktif = false;
                tutupIdCardTeman(true);
                return;
            }
            // Modal "Detail Penilaian Guru" ikut ditutup otomatis kalau tombol
            // back HP/browser (atau swipe-back) ditekan selagi modal ini masih
            // kebuka -- konsisten dengan ekspektasi umum navigasi mobile
            // (tombol back menutup dialog yang lagi kebuka duluan, BUKAN
            // langsung pindah tab/keluar app). Begitu ditutup, langsung
            // `return` -- TIDAK lanjut ke terapkanStateHistoryTampilan(),
            // supaya tab yang sedang aktif di baliknya tidak ikut berubah.
            if (modalGuruHistoryAktif) {
                modalGuruHistoryAktif = false;
                tutupModalDetailGuru(true);
                return;
            }
            // Modal detail tugas (dibuka dari Tugas Terdekat): back menutup modal dulu,
            // tab Tugas di baliknya tetap; back berikutnya baru kembali ke halaman sebelumnya.
            if (modalTugasHistoryAktif) {
                modalTugasHistoryAktif = false;
                if (event.state && event.state.appNav) stateTampilanTerakhirApp = event.state;
                tutupBulatTugas(null, true);
                return;
            }
            terapkanStateHistoryTampilan(event.state);
        });

        // State awal (root): Beranda dianggap dasar tumpukan -- pakai replaceState
        // (bukan pushState) supaya tekanan back pertama dari Beranda langsung
        // lanjut ke perilaku back bawaan, bukan nyangkut di entry kosong.
        history.replaceState({ appNav: true, type: 'tab', tab: 'beranda' }, '', location.href);

        /* ================= PUSAT BANTUAN (Halaman Profil, khusus HP) =================
           Tombol "Pusat Bantuan" mengarah ke WhatsApp Admin/IT Support, tapi
           dikasih konfirmasi dulu (window.confirm) sebelum benar-benar pindah
           ke WA -- supaya siswa tidak "kepencet" langsung keluar dari aplikasi
           kalau sebenarnya cuma mau lihat-lihat menu. */
        function konfirmasiPusatBantuanWA() {
            const mauLanjut = window.confirm('Kamu akan diarahkan ke WhatsApp Admin/IT Support untuk bantuan. Lanjutkan?');
            if (!mauLanjut) return;
            window.open('https://wa.me/6283181977131?text=Halo%20Admin%2C%20saya%20butuh%20bantuan%20terkait%20aplikasi%20Sekolah.', '_blank', 'noopener,noreferrer');
        }

        function switchTab(tabName) {
            // GERBANG FITUR MAINTENANCE: kalau tab ini sedang dikunci admin
            // (lihat panel "Fitur Maintenance" di sidebar) DAN yang buka
            // BUKAN akun admin, batalkan pindah tab sama sekali -- siswa
            // tetap di tab lamanya, cuma dikasih notif toast singkat.
            // Fungsi fiturSedangMaintenance() ada di dashboard_siswa_2.js.
            // PENTING: "return" di bawah ini terjadi SEBELUM baris mana pun
            // yang menyentuh className tombol/overlay (baris reset nav-btn
            // & tab-content ada di bawah sini) -- jadi klik ke fitur yang
            // lagi maintenance TIDAK memicu reset/restart apa pun ke overlay
            // & animasi garis kuning-hitamnya. Overlay tetap looping terus
            // persis seperti sebelum diklik, cuma nambah toast peringatan.
            if (typeof fiturSedangMaintenance === 'function' && fiturSedangMaintenance(tabName)) {
                if (typeof tampilkanToast === 'function') {
                    // Nama fitur asli (mis. "Tugas & Catatan") diambil dari
                    // labelFiturMaintenance() di dashboard_siswa_2.js supaya
                    // pesannya jelas fitur mana yang dimaksud, bukan generik.
                    const namaFitur = (typeof labelFiturMaintenance === 'function') ? labelFiturMaintenance(tabName) : 'Fitur ini';
                    tampilkanToast(`"${namaFitur}" sedang dalam maintenance/perbaikan.`, 'warning', 3500);
                }
                return;
            }
            // Halaman "Fitur Maintenance" itu sendiri (tab-maintenance) cuma
            // boleh dibuka akun admin asli -- jaga-jaga kalau ada yang coba
            // switchTab('maintenance') manual lewat console/DevTools, walau
            // tombol menunya memang sudah disembunyikan buat siswa biasa
            // (endpoint toggle di server juga sudah menggerbangi hal yang
            // sama, jadi ini murni soal kerapian UI).
            if (tabName === 'maintenance' && typeof akunIniAdminDev === 'function' && !akunIniAdminDev()) {
                return;
            }
            closeSidebarMobile(); // otomatis tutup sidebar mobile setelah pilih menu
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.nav-btn').forEach(btn => {
                // Sengaja pertahankan class "relative" (dipakai badge titik
                // notifikasi di beberapa tombol) & "nav-btn-picking" kalau
                // ada -- className diganti utuh sebelumnya ikut menghapus
                // class-class ini tiap kali pindah tab, bukan cuma warnanya.
                const extraClasses = Array.from(btn.classList).filter(c => c === 'relative' || c === 'nav-btn-picking');
                const hoverClass = btn.id === 'btn-ai-support' ? 'hover:bg-blue-500/20 hover:text-blue-700' : 'hover:bg-amber-500/20 hover:text-amber-700';
                btn.className = `nav-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-slate-500 ${hoverClass} font-medium text-sm transition-colors duration-150${extraClasses.length ? ' ' + extraClasses.join(' ') : ''}`;
                btn.removeAttribute('aria-current');
            });

            const targetTab = document.getElementById(`tab-${tabName}`);
            const targetBtn = document.getElementById(`btn-${tabName}`);

            if (targetTab) targetTab.classList.remove('hidden');
            // Buka tab AI Support -> langsung loncat ke pesan paling bawah (tanpa animasi)
            // supaya siswa bisa langsung lanjut ngetik prompt. Lihat aturScrollAwalAISupport().
            if (tabName === 'ai-support' && typeof aturScrollAwalAISupport === 'function') aturScrollAwalAISupport();
            if (targetBtn) {
                const extraClasses = Array.from(targetBtn.classList).filter(c => c === 'relative' || c === 'nav-btn-picking');
                targetBtn.className = `nav-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm shadow-sm shadow-blue-500/25 transition-colors duration-150${extraClasses.length ? ' ' + extraClasses.join(' ') : ''}`;
                targetBtn.setAttribute('aria-current', 'page');
            }

            // Sinkronkan status aktif Bottom Navigation Bar (khusus HP) dengan tab
            // yang sedang dibuka. Menu di luar 5 item bottom nav (mis. Akademik,
            // Guru, Cari Teman, Perangkat, AI Support -- diakses lewat tombol
            // "Lainnya") akan otomatis memindahkan warna aktif ke tombol
            // "Lainnya" itu sendiri, persis seperti Beranda/Tugas/Quiz/
            // Pengumuman yang nyala warnanya waktu dibuka.
            // PERBAIKAN: bagian ini sengaja diletakkan DI SINI (sebelum kode
            // khusus per-tab di bawah, bukan di paling akhir fungsi) -- supaya
            // kalau salah satu kode khusus per-tab di bawah sempat error,
            // status warna "Lainnya" tetap sudah terlanjur disinkronkan duluan
            // dan tidak ikut gagal ke-set.
            document.querySelectorAll('.bottom-nav-item[data-bottom-tab]').forEach(btn => {
                btn.classList.toggle('bottom-nav-item--active', btn.dataset.bottomTab === tabName);
            });
            const tombolLainnyaBawah = document.getElementById('btn-bottom-lainnya');
            if (tombolLainnyaBawah) {
                const adaTombolLangsungDiBawah = !!document.querySelector(`.bottom-nav-item[data-bottom-tab="${tabName}"]`);
                tombolLainnyaBawah.classList.toggle('bottom-nav-item--active', !adaTombolLangsungDiBawah);
            }

            // FIX: header sub-halaman (judul menggantikan jam realtime) DIMATIKAN --
            // sebelumnya tab 'akademik' (Koleksi Prestasi/Border) mengganti header
            // jam jadi teks judul halaman lewat aktifkanHeaderMobileSubHalaman(), beda
            // sendiri dari tab lain yang tetap menampilkan jam realtime. Sekarang
            // SEMUA tab (termasuk akademik) konsisten tetap menampilkan jam.
            nonaktifkanHeaderMobileSubHalaman();

            if (tabName === 'tugas') {
                // Titik merah di sidebar (badge-tugas-baru) hilang begitu tab ini
                // dibuka/diklik -- lihat catatan di tandaiBadgeTugasDilihat().
                // Ini TIDAK sama dengan penandaan isViewedByStudent per-tugas di
                // bawah (yang memang sengaja baru per-tugas, bukan blanket).
                tandaiBadgeTugasDilihat();
                try {
                    // CATATAN PERUBAHAN: dulu SEMUA tugas otomatis ditandai
                    // isViewedByStudent = true begitu tab ini dibuka (blanket mark),
                    // jadi status di Dashboard Guru langsung loncat ke "Sedang
                    // Dikerjakan" walau siswa belum benar-benar buka tugasnya
                    // satu-satu. Sekarang penandaan dipindah ke level PER-TUGAS lewat
                    // tandaiTugasDibukaJikaPerlu() yang dipanggil dari dalam
                    // renderKartuTugas() -- jadi cuma tugas yang KONTENnya benar-benar
                    // ditampilkan (kartu langsung kalau <=2 tugas, atau modal ikon
                    // bulat kalau >2 tugas) yang berubah status; sisanya tetap
                    // "Belum Dikerjakan" sampai benar-benar dibuka siswa.
                    renderLiveTaskContent();
                } catch (err) {
                    console.error('Gagal memuat konten tab Tugas:', err);
                }
            }

            // Setiap kali tab "Kotak Saran" dibuka DAN akun ini admin (bagian
            // #wrapper-daftar-saran-admin sudah di-reveal, lihat
            // DOMContentLoaded), tarik ulang daftar saran terbaru dari server
            // -- siswa biasa tidak kena baris ini sama sekali karena
            // wrapper-nya tetap "hidden" buat mereka.
            if (tabName === 'kotak-saran') {
                try {
                    const wrapperDaftarSaran = document.getElementById('wrapper-daftar-saran-admin');
                    if (wrapperDaftarSaran && !wrapperDaftarSaran.classList.contains('hidden')) {
                        sinkronkanSaranDenganServer();
                    }
                } catch (err) {
                    console.error('Gagal memuat daftar Saran Masuk:', err);
                }
            }

            // Setiap kali halaman "Fitur Maintenance" dibuka, tarik ulang
            // status terbaru dari server (siapa tahu admin sempat toggle
            // dari perangkat lain) lalu render ulang daftarnya.
            if (tabName === 'maintenance') {
                try {
                    if (typeof ambilStatusMaintenanceFitur === 'function') ambilStatusMaintenanceFitur();
                } catch (err) {
                    console.error('Gagal memuat status Fitur Maintenance:', err);
                }
            }

            // Setiap kali tab "Cari Teman" dibuka, refresh daftar teman yang
            // sudah saling add (biar update terbaru -- mis. abis nerima
            // permintaan pertemanan di sesi/tab lain -- langsung kelihatan).
            if (tabName === 'cari-teman') {
                try {
                    // PERFORMANCE OPTIMIZATION: renderPermintaanTeman() dulu cuma
                    // dipanggil sekali di initial load (dashboard_siswa_2.js).
                    // Sekarang digabung ke sini, jalan bareng renderDaftarTeman()
                    // tiap kali tab Cari Teman dibuka -- badge/titik merah
                    // permintaan pertemanan tetap ke-update dalam <=8 detik lewat
                    // sinkronisasi berkala walau tab ini belum pernah dibuka.
                    renderPermintaanTeman();
                    renderDaftarTeman();
                } catch (err) {
                    console.error('Gagal memuat daftar teman:', err);
                }
            }

            // Setiap kali halaman "Profil" (HP) dibuka, refresh statistik
            // (streak/tugas) & grid Lencana supaya datanya selalu terbaru.
            if (tabName === 'profil') {
                try {
                    updateTaskCounter();
                    renderLencanaProfilTab();
                } catch (err) {
                    console.error('Gagal memuat halaman Profil:', err);
                }
            }

            dorongHistoryTampilan({ type: 'tab', tab: tabName });
        }

        /* ================= RIWAYAT CHAT AI SUPPORT (tersimpan di server, per akun) =================
           Percakapan disimpan backend (api/gemini_routes.py -> services/chat_history_service.py)
           dan SELALU difilter berdasarkan akun yang sedang login -- percakapan akun lain
           tidak bisa dibuka (dijawab 404). Browser cuma mengingat ID percakapan yang sedang
           dibuka (sessionStorage) supaya refresh halaman tidak mengosongkan chat; ID itu
           dihapus saat logout. Foto lampiran tidak ikut tersimpan (hanya penanda teks). */
        const KUNCI_CID_AI_SUPPORT = 'ai_support_cid_aktif';
        let cidAISupport = null;            // null = percakapan baru (belum ada di server)
        let daftarRiwayatAISupport = [];    // [{id, judul, dibuat, diperbarui}]
        let kataCariRiwayatAISupport = '';  // kolom "Cari percakapan" (laci riwayat di HP)

        function aiSupportResetCariRiwayat() {
            kataCariRiwayatAISupport = '';
            const el = document.getElementById('ai-rw-cari-input');
            if (el) el.value = '';
        }

        // Dipertahankan supaya pemanggil lama tidak error; backend yang menyimpan pesan.
        function simpanRiwayatAISupport() {}

        function hapusRiwayatAISupport() {
            cidAISupport = null;
            try { sessionStorage.removeItem(KUNCI_CID_AI_SUPPORT); } catch (e) {}
        }

        function aiSupportSetCid(cid) {
            cidAISupport = cid || null;
            try {
                if (cidAISupport) sessionStorage.setItem(KUNCI_CID_AI_SUPPORT, cidAISupport);
                else sessionStorage.removeItem(KUNCI_CID_AI_SUPPORT);
            } catch (e) {}
        }

        // sedangKirimAISupport dideklarasikan lebih bawah; bungkus supaya aman dipanggil kapan saja.
        function aiSupportSedangKirim() {
            try { return !!sedangKirimAISupport; } catch (e) { return false; }
        }

        function aiSupportApi(url, opsi) {
            return fetch(url, Object.assign({ credentials: 'same-origin' }, opsi || {}))
                .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, status: res.status, data: data || {} })));
        }

        function aiSupportKosongkanLog() {
            const log = document.getElementById('ai-support-chat-log');
            if (log) Array.from(log.children).forEach(el => { if (!el.classList.contains('ai-welcome')) el.remove(); });
            return log;
        }

        function aiSupportTampilkanPesan(daftar) {
            const log = aiSupportKosongkanLog();
            if (!log) return;
            (Array.isArray(daftar) ? daftar : []).forEach(m => {
                const peran = m.role || m.peran;
                const teks = m.text != null ? m.text : (m.teks != null ? m.teks : m.content);
                if (typeof teks !== 'string' || !teks) return;
                if (peran === 'user') {
                    const bubbleUser = document.createElement('div');
                    bubbleUser.className = 'flex items-start gap-2.5 justify-end';
                    bubbleUser.innerHTML = '<div class="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs max-w-[80%]"></div>';
                    bubbleUser.querySelector('div.bg-blue-600').innerText = teks;
                    log.appendChild(bubbleUser);
                } else {
                    tambahBubbleBotAISupport(teks, false, m.id);
                }
            });
            log.scrollTop = log.scrollHeight;
        }

        function aiSupportAmbilPesan(data) {
            return data.pesan || data.messages || data.baris || [];
        }

        /* ---------- daftar riwayat (panel kiri) ---------- */
        function aiSupportTanggal(v) {
            if (v == null || v === '') return null;
            const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
            return isNaN(d.getTime()) ? null : d;
        }

        function aiSupportNamaGrup(d) {
            if (!d) return 'Sebelumnya';
            const awalHari = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
            const selisih = Math.round((awalHari(new Date()) - awalHari(d)) / 86400000);
            if (selisih <= 0) return 'Hari ini';
            if (selisih === 1) return 'Kemarin';
            if (selisih <= 7) return '7 hari terakhir';
            return 'Lebih lama';
        }

        function aiSupportTombolAksi(ikon, label, kelas, aksi) {
            const b = document.createElement('button');
            b.type = 'button';
            if (kelas) b.className = kelas;
            b.title = label;
            b.setAttribute('aria-label', label);
            b.innerHTML = '<i class="fa-solid ' + ikon + '"></i>';
            b.addEventListener('click', (e) => { e.stopPropagation(); aksi(); });
            return b;
        }

        function aiSupportRenderDaftar() {
            const wadah = document.getElementById('ai-riwayat-daftar');
            if (!wadah) return;
            wadah.textContent = '';
            const tombolSemua = document.getElementById('ai-riwayat-hapus-semua');
            if (tombolSemua) tombolSemua.hidden = daftarRiwayatAISupport.length === 0;

            if (daftarRiwayatAISupport.length === 0) {
                const kosong = document.createElement('p');
                kosong.className = 'ai-rw-kosong';
                kosong.textContent = 'Belum ada riwayat. Percakapanmu muncul di sini setelah kamu mengirim pertanyaan.';
                wadah.appendChild(kosong);
                return;
            }

            const kata = kataCariRiwayatAISupport.trim().toLowerCase();
            const urut = daftarRiwayatAISupport.filter(p => !kata || String(p.judul || 'Percakapan baru').toLowerCase().includes(kata)).sort((a, b) => {
                const ta = aiSupportTanggal(a.diperbarui), tb = aiSupportTanggal(b.diperbarui);
                return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
            });

            if (urut.length === 0) {
                const kosongCari = document.createElement('p');
                kosongCari.className = 'ai-rw-kosong';
                kosongCari.textContent = 'Tidak ada percakapan yang cocok.';
                wadah.appendChild(kosongCari);
                return;
            }

            let grupTerakhir = null;
            urut.forEach(p => {
                const namaGrup = aiSupportNamaGrup(aiSupportTanggal(p.diperbarui));
                if (namaGrup !== grupTerakhir) {
                    const h = document.createElement('div');
                    h.className = 'ai-rw-grup';
                    h.textContent = namaGrup;
                    wadah.appendChild(h);
                    grupTerakhir = namaGrup;
                }
                const judulTeks = p.judul || 'Percakapan baru';
                const item = document.createElement('div');
                item.className = 'ai-rw-item' + (p.id === cidAISupport ? ' aktif' : '');

                const buka = document.createElement('button');
                buka.type = 'button';
                buka.className = 'ai-rw-buka';
                buka.title = judulTeks;
                if (p.id === cidAISupport) buka.setAttribute('aria-current', 'true');
                const judul = document.createElement('span');
                judul.className = 'ai-rw-judul';
                judul.textContent = judulTeks;
                buka.appendChild(judul);
                buka.addEventListener('click', () => aiSupportBukaPercakapan(p.id));

                const aksi = document.createElement('div');
                aksi.className = 'ai-rw-aksi';
                aksi.appendChild(aiSupportTombolAksi('fa-pen', 'Ubah judul', '', () => aiSupportGantiJudul(p.id)));
                aksi.appendChild(aiSupportTombolAksi('fa-trash', 'Hapus percakapan', 'hapus', () => aiSupportHapusPercakapan(p.id)));

                item.appendChild(buka);
                item.appendChild(aksi);
                wadah.appendChild(item);
            });
        }

        function aiSupportMuatDaftar() {
            return aiSupportApi('/api/gemini/riwayat')
                .then(({ ok, data }) => {
                    if (!ok || !data.success) return;
                    daftarRiwayatAISupport = Array.isArray(data.percakapan) ? data.percakapan : [];
                    aiSupportRenderDaftar();
                })
                .catch(() => {});
        }

        /* ---------- aksi ---------- */
        function aiSupportToggleRiwayat(buka) {
            const panel = document.getElementById('ai-riwayat-panel');
            if (!panel) return;
            const tombol = document.getElementById('ai-riwayat-toggle');

            // Laptop/desktop: panel menciut ke kiri / melebar lagi
            if (window.matchMedia('(min-width: 900px)').matches) {
                // panggilan otomatis (Chat Baru, buka percakapan) tidak menutup panel di desktop
                if (typeof buka === 'boolean') return;
                const body = panel.closest('.ai-full-body');
                if (!body) return;
                const tutup = !body.classList.contains('riwayat-tutup');
                body.classList.toggle('riwayat-tutup', tutup);
                if (tombol) tombol.setAttribute('aria-expanded', String(!tutup));
                try { localStorage.setItem('ai_support_riwayat_tutup', tutup ? '1' : '0'); } catch (e) {}
                return;
            }

            // HP/tablet kecil: laci geser dari kiri
            const tampil = typeof buka === 'boolean' ? buka : !panel.classList.contains('terbuka');
            panel.classList.toggle('terbuka', tampil);
            if (tampil) {
                try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
            } else if (kataCariRiwayatAISupport) {
                aiSupportResetCariRiwayat();
                aiSupportRenderDaftar();
            }
            const latar = document.getElementById('ai-riwayat-latar');
            if (latar) latar.classList.toggle('terbuka', tampil);
            if (tombol) tombol.setAttribute('aria-expanded', String(tampil));
        }

        // samakan keadaan panel dengan ukuran layar (dipanggil saat load & saat layar berubah ukuran)
        function aiSupportSinkronPanelRiwayat() {
            const panel = document.getElementById('ai-riwayat-panel');
            const body = panel && panel.closest('.ai-full-body');
            const tombol = document.getElementById('ai-riwayat-toggle');
            if (!panel || !body) return;
            if (window.matchMedia('(min-width: 900px)').matches) {
                let tutup = false;
                try { tutup = localStorage.getItem('ai_support_riwayat_tutup') === '1'; } catch (e) {}
                body.classList.toggle('riwayat-tutup', tutup);
                panel.classList.remove('terbuka');
                const latar = document.getElementById('ai-riwayat-latar');
                if (latar) latar.classList.remove('terbuka');
                if (tombol) tombol.setAttribute('aria-expanded', String(!tutup));
            } else {
                body.classList.remove('riwayat-tutup');
                if (tombol) tombol.setAttribute('aria-expanded', String(panel.classList.contains('terbuka')));
            }
        }

        function aiSupportBukaPercakapan(cid) {
            if (aiSupportSedangKirim()) return;
            if (cid === cidAISupport) { aiSupportToggleRiwayat(false); return; }
            aiSupportApi('/api/gemini/riwayat/' + encodeURIComponent(cid)).then(({ ok, data }) => {
                if (!ok || !data.success) { aiSupportMuatDaftar(); return; } // sudah tidak ada -> segarkan daftar
                aiSupportSetCid(cid);
                aiSupportTampilkanPesan(aiSupportAmbilPesan(data));
                aiSupportRenderDaftar();
                aiSupportToggleRiwayat(false);
                aiSupportMuatTujuan(); // progres terakhir chat ini
            }).catch(() => {});
        }

        function aiSupportMulaiBaru() {
            aiSupportSetCid(null);
            aiSupportRenderTujuan(null); // chat baru belum punya tujuan
            const log = aiSupportKosongkanLog();
            if (typeof bersihkanDraftGambarAISupport === 'function') bersihkanDraftGambarAISupport();
            const input = document.getElementById('input-ai-support');
            if (input) input.value = '';
            if (log) log.scrollTop = 0;
            aiSupportRenderDaftar();
        }

        function aiSupportGantiJudul(cid) {
            const p = daftarRiwayatAISupport.find(x => x.id === cid);
            const baru = window.prompt('Judul percakapan:', (p && p.judul) || '');
            if (baru === null) return;
            const judul = baru.trim().slice(0, 80);
            if (!judul) return;
            aiSupportApi('/api/gemini/riwayat/' + encodeURIComponent(cid), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ judul })
            }).then(({ ok }) => {
                if (!ok) window.alert('Gagal mengubah judul. Coba lagi.');
                aiSupportMuatDaftar();
            }).catch(() => window.alert('Gagal mengubah judul. Coba lagi.'));
        }

        function aiSupportHapusPercakapan(cid) {
            if (aiSupportSedangKirim()) return;
            if (!window.confirm('Hapus percakapan ini? Riwayatnya tidak bisa dikembalikan.')) return;
            aiSupportApi('/api/gemini/riwayat/' + encodeURIComponent(cid), { method: 'DELETE' }).then(({ ok, status }) => {
                if (!ok && status !== 404) { window.alert('Gagal menghapus percakapan. Coba lagi.'); return; }
                if (cid === cidAISupport) aiSupportMulaiBaru();
                aiSupportMuatDaftar();
            }).catch(() => window.alert('Gagal menghapus percakapan. Coba lagi.'));
        }

        function aiSupportHapusSemua() {
            if (aiSupportSedangKirim()) return;
            if (!window.confirm('Hapus SEMUA riwayat chat AI Support? Ini tidak bisa dikembalikan.')) return;
            aiSupportApi('/api/gemini/riwayat', { method: 'DELETE' }).then(({ ok }) => {
                if (!ok) { window.alert('Gagal menghapus riwayat. Coba lagi.'); return; }
                aiSupportMulaiBaru();
                aiSupportMuatDaftar();
            }).catch(() => window.alert('Gagal menghapus riwayat. Coba lagi.'));
        }

        // Dipanggil sekali saat script dimuat (lihat pemanggilan di bawah tambahBubbleBotAISupport):
        // muat daftar riwayat, lalu buka lagi percakapan yang terakhir dibuka di tab ini.
        function muatRiwayatAISupportDariSession() {
            try { sessionStorage.removeItem('ai_support_riwayat_sesi'); } catch (e) {} // sisa versi lama
            let cid = null;
            try { cid = sessionStorage.getItem(KUNCI_CID_AI_SUPPORT); } catch (e) {}
            aiSupportMuatDaftar();
            if (!cid) return;
            aiSupportApi('/api/gemini/riwayat/' + encodeURIComponent(cid)).then(({ ok, data }) => {
                if (!ok || !data.success) { aiSupportSetCid(null); aiSupportRenderDaftar(); aiSupportRenderTujuan(null); return; }
                aiSupportSetCid(cid);
                aiSupportTampilkanPesan(aiSupportAmbilPesan(data));
                aiSupportRenderDaftar();
                aiSupportMuatTujuan(); // progres terakhir chat yang dibuka lagi
            }).catch(() => {});
        }

        // Bersihkan ID percakapan aktif begitu tautan/tombol logout diklik, supaya tidak
        // nyangkut ke akun lain yang login di tab yang sama. Delegasi ke document supaya
        // tetap kepasang di mana pun tautan logout berada (yang penting href menuju /logout).
        document.addEventListener('click', (e) => {
            const tautanLogout = e.target.closest('a[href="/logout"], a[href*="/logout"]');
            if (tautanLogout) hapusRiwayatAISupport();
        });

        /* ================= AI SUPPORT (chat ke Google Gemini, + fallback kata kunci) =================
           kirimChatAISupport() di bawah manggil backend Flask (/api/gemini/chat) yang
           diteruskan ke Google Gemini. balasAISupport() di bawah ini SEKARANG cuma
           dipakai sebagai FALLBACK -- kalau request ke Gemini gagal (mis. API key
           belum diisi, kuota habis, atau tidak ada koneksi), baru jawaban template
           berbasis kata kunci ini yang dipakai supaya chat tetap kebalas. */
        function balasAISupport(pertanyaan) {
            const teks = pertanyaan.toLowerCase();
            if (teks.includes('tugas')) return 'Tugas & catatan kamu ada di menu "Tugas & Catatan" di sidebar. Di sana kelihatan status: belum dikumpulkan, sudah dikumpulkan, sampai nilainya.';
            if (teks.includes('quiz') || teks.includes('kuis') || teks.includes('leaderboard')) return 'Menu "Quiz & Leaderboard" berisi kuis harian dan peringkat kamu dibanding teman sekelas. Skor kuis ikut ngaruh ke posisi di leaderboard.';
            if (teks.includes('border') || teks.includes('prestasi') || teks.includes('piala') || teks.includes('sertifikat')) return 'Border avatar bisa dibuka dengan mengajukan bukti prestasi (piala/sertifikat) di menu "Koleksi Border". Bukti kamu bakal ditinjau dulu sama guru/admin sebelum disetujui.';
            if (teks.includes('jadwal')) return 'Jadwal pelajaran lengkap bisa dilihat di kartu jadwal pada halaman Beranda, tinggal klik untuk buka jadwal per hari.';
            if (teks.includes('guru')) return 'Daftar guru dan wali kelas ada di menu "Daftar Guru" di sidebar.';
            if (teks.includes('bk') || teks.includes('bimbingan') || teks.includes('konseling')) return 'Untuk konsultasi bimbingan, klik tombol "Hubungi BK" di bagian bawah sidebar ya.';
            return 'Hmm, pertanyaan itu belum ada di daftar aku. Coba tanya soal tugas, quiz, border/prestasi, jadwal, atau guru — atau hubungi IT Support lewat tombol di sidebar buat bantuan langsung.';
        }

        // Escape teks biasa jadi aman buat ditaruh lewat innerHTML (bukan
        // innerHTML mentah dari balasan AI -- ini buat cegah XSS kalau
        // suatu saat balasan Gemini kena prompt-injection berisi tag aneh).
        function escapeHtmlAISupport(teks) {
            const div = document.createElement('div');
            div.textContent = teks;
            return div.innerHTML;
        }

        // ------------------------------------------------------------
        // RENDER MARKDOWN RINGKAS UNTUK BALASAN AI SUPPORT
        // ------------------------------------------------------------
        // Dulu balasan cuma di-escape lalu dipasang lewat innerHTML, jadi tanda
        // **tebal**, "* " daftar, dan baris baru tampil mentah/menyatu jadi satu
        // paragraf. Sekarang teks diubah jadi paragraf, daftar bernomor, daftar
        // poin (boleh bertingkat), judul, tebal, miring, dan kode -- rapi seperti
        // Gemini/ChatGPT. AMAN dari XSS: SETIAP teks di-escape dulu, baru tag
        // buatan sendiri (strong/em/code/p/ul/ol/li) ditambahkan; tidak ada HTML
        // dari balasan AI yang ikut ter-render mentah.
        function formatInlineAISupport(teks) {
            let h = escapeHtmlAISupport(teks);
            h = h.replace(/`([^`\n]+)`/g, '<code class="ai-md-code">$1</code>');
            h = h.replace(/\*\*([^*\n][^\n]*?)\*\*/g, '<strong>$1</strong>');
            h = h.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>');
            return h;
        }

        function renderTeksMarkdownAISupport(teks) {
            const baris = String(teks == null ? '' : teks).replace(/\r\n/g, '\n').replace(/\t/g, '    ').split('\n');
            const polaItem = /^(\s*)([*\-\u2022]|\d+[.)])\s+(.*)$/;
            const polaJudul = /^\s*#{1,4}\s+(.*)$/;
            let html = '';
            let paragraf = [];
            const tumpukan = []; // { tag, indent } -- daftar yang sedang terbuka

            function tutupParagraf() {
                if (paragraf.length) {
                    html += '<p class="ai-md-p">' + paragraf.join('<br>') + '</p>';
                    paragraf = [];
                }
            }
            function tutupDaftarSampai(indent) {
                while (tumpukan.length && tumpukan[tumpukan.length - 1].indent > indent) {
                    html += '</li></' + tumpukan.pop().tag + '>';
                }
            }
            function tutupSemuaDaftar() { tutupDaftarSampai(-1); }

            baris.forEach(function (mentah) {
                if (/^\s*$/.test(mentah)) { tutupParagraf(); return; }
                if (/^\s*([-*_])\1{2,}\s*$/.test(mentah)) { tutupParagraf(); tutupSemuaDaftar(); return; }

                const judul = mentah.match(polaJudul);
                if (judul) {
                    tutupParagraf(); tutupSemuaDaftar();
                    html += '<p class="ai-md-judul"><strong>' + formatInlineAISupport(judul[1]) + '</strong></p>';
                    return;
                }

                const item = mentah.match(polaItem);
                if (item) {
                    tutupParagraf();
                    const indent = item[1].length;
                    const ordered = /\d/.test(item[2]);
                    const tag = ordered ? 'ol' : 'ul';
                    tutupDaftarSampai(indent);
                    const atas = tumpukan[tumpukan.length - 1];
                    if (atas && atas.indent === indent) {
                        if (atas.tag === tag) {
                            html += '</li><li>';
                        } else {
                            html += '</li></' + tumpukan.pop().tag + '>';
                            const mulai0 = ordered ? ' start="' + parseInt(item[2], 10) + '"' : '';
                            html += '<' + tag + mulai0 + ' class="ai-md-daftar"><li>';
                            tumpukan.push({ tag: tag, indent: indent });
                        }
                    } else {
                        const mulai = ordered ? ' start="' + parseInt(item[2], 10) + '"' : '';
                        html += '<' + tag + mulai + ' class="ai-md-daftar"><li>';
                        tumpukan.push({ tag: tag, indent: indent });
                    }
                    html += formatInlineAISupport(item[3]);
                    return;
                }

                // Baris biasa. Kalau menjorok dan masih di dalam daftar = lanjutan item.
                if (tumpukan.length && /^\s+\S/.test(mentah)) {
                    html += '<br>' + formatInlineAISupport(mentah.trim());
                    return;
                }
                tutupSemuaDaftar();
                paragraf.push(formatInlineAISupport(mentah.trim()));
            });
            tutupParagraf();
            tutupSemuaDaftar();
            return html;
        }

        // Gaya balasan AI (disuntik sekali) -- Tailwind mereset list-style, jadi
        // titik/nomor daftar harus dikembalikan manual di sini.
        (function suntikGayaMarkdownAISupport() {
            if (document.getElementById('gaya-ai-support-markdown')) return;
            const style = document.createElement('style');
            style.id = 'gaya-ai-support-markdown';
            style.textContent = `
                .ai-md { line-height: 1.65; word-break: break-word; }
                .ai-md .ai-md-p { margin: 0 0 0.65em; }
                .ai-md .ai-md-judul { margin: 0.9em 0 0.35em; color: #0f172a; }
                .ai-md > :first-child { margin-top: 0; }
                .ai-md > :last-child { margin-bottom: 0; }
                .ai-md .ai-md-daftar { margin: 0.2em 0 0.7em; padding-left: 1.3rem; }
                .ai-md ul.ai-md-daftar { list-style: disc; }
                .ai-md ol.ai-md-daftar { list-style: decimal; }
                .ai-md .ai-md-daftar .ai-md-daftar { margin: 0.25em 0 0.15em; }
                .ai-md ul.ai-md-daftar ul.ai-md-daftar { list-style: circle; }
                .ai-md li { margin: 0.25em 0; padding-left: 0.15rem; }
                .ai-md li::marker { color: #64748b; }
                .ai-md strong { color: #0f172a; font-weight: 700; }
                .ai-md .ai-md-code { background: #e2e8f0; padding: 0.05em 0.35em; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.92em; }
            `;
            document.head.appendChild(style);
        })();


        // Ubah pola markdown gambar ![alt](url) di balasan Gemini jadi tag
        // <img> ASLI -- tapi HANYA kalau url-nya dari domain resmi sekolah
        // (banjarasri.com). Teks di luar pola gambar ini tetap di-escape,
        // jadi tidak ada HTML/skrip sembarangan dari balasan AI yang bisa
        // ikut ke-render mentah-mentah.
        function renderBalasanAISupport(teks) {
            // Domain yang diizinkan buat dirender jadi <img> sungguhan:
            // - banjarasri.com -- domain web sekolah sendiri
            // - <project-ref>.supabase.co -- tempat foto_url prestasi
            //   ASLI disimpan (lihat SUPABASE_PRESTASI_URL & foto_url di
            //   gemini_service.py). Sengaja dikunci ke project ref PERSIS
            //   ini (zysijvixttoharonjfdc), BUKAN "supabase.co" secara umum,
            //   supaya prompt-injection tidak bisa nyuruh Gemini nampilkan
            //   gambar dari project Supabase siapa pun.
            const polaGambar = /!\[([^\]]*)\]\((https:\/\/(?:(?:www\.)?banjarasri\.com|zysijvixttoharonjfdc\.supabase\.co)[^\s)]+)\)/g;
            let hasil = '';
            let posisiTerakhir = 0;
            let match;
            let indexFoto = 0; // urutan foto dalam 1 balasan -- dipakai buat stagger delay reveal di bawah
            while ((match = polaGambar.exec(teks)) !== null) {
                hasil += renderTeksMarkdownAISupport(teks.slice(posisiTerakhir, match.index));
                const alt = escapeHtmlAISupport(match[1] || 'gambar prestasi');
                const url = match[2].replace(/"/g, '&quot;');
                // Pola sama seperti #detail-guru-foto-wrap di Daftar Guru:
                // 2 lapis foto yang SAMA di kotak yang sama -- lapis belakang
                // (aria-hidden) di-blur+diperbesar supaya ngisi penuh kotak
                // tanpa celah kosong (apapun rasio asli foto prestasinya),
                // lapis depan (class ai-support-gambar-prestasi) tetap
                // object-contain supaya foto tetap utuh gak kepotong. Klik
                // tetap ditangkap di lapis depan -- class & data-full-src
                // dipertahankan persis, jadi bukaLightboxGambarAISupport()
                // di bawah tidak perlu diubah sama sekali. src yang dipakai
                // di lightbox PERSIS sama dengan src lapis depan di sini
                // (file asli, bukan thumbnail terpisah), jadi tidak ada
                // proses upscale yang bikin gambar pecah saat dibuka lebih
                // besar.
                // class "ai-support-foto-reveal" -- dipasangi efek fade-in-on-scroll
                // (fade + geser naik) POLA SAMA seperti kartu guru (guru-card-reveal +
                // aktifkanScrollRevealGuru()) lewat aktifkanScrollRevealFotoAISupport()
                // di bawah, cuma root observer-nya di-set ke div #ai-support-chat-log
                // (bukan default viewport) karena yang discroll di sini adalah chat
                // log-nya sendiri, bukan seluruh halaman. transition-delay dikasih
                // stagger persis pola `(i % 9) * 70ms` di renderDaftarGuru() -- jadi
                // kalau AI munculin beberapa foto prestasi sekaligus dalam 1 balasan
                // (mis. beberapa juara), foto-fotonya reveal gantian satu-satu, bukan
                // barengan semua.
                // Wrapper SENGAJA tidak dikasih aspect-ratio tetap (dulu 4/3) --
                // tinggi kotak sekarang ngikutin ukuran ASLI foto (lapis foto depan
                // dibiarkan `position:relative;height:auto` supaya tetap ada di alur
                // normal & menentukan tinggi wrapper-nya sendiri), bukan dipaksa satu
                // rasio buat semua ukuran layar. Ini yang bikin kotaknya pas di HP
                // (bubble sempit) MAUPUN di laptop (bubble max-w-[340px]) -- kalau
                // dipaksa 4/3 dan fotonya potret, box jadi kegedean/kepanjangan dengan
                // bilah blur kosong di kanan-kiri pas bubble-nya lebih lebar. Lapis
                // blur belakang tetap `position:absolute` mengisi persis ukuran
                // wrapper ini (yang sekarang = ukuran foto depan), jadi blur-nya tetap
                // pas nutup kotak, cuma kotaknya sendiri sekarang seukuran fotonya.
                const delayFoto = (indexFoto % 9) * 90;
                hasil += `<div class="ai-support-foto-wrap ai-support-foto-reveal" style="position:relative;width:100%;border-radius:8px;overflow:hidden;margin-top:6px;cursor:zoom-in;background:#0f172a;transition-delay:${delayFoto}ms;">
                    <img src="${url}" alt="" aria-hidden="true" style="position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;filter:blur(18px) brightness(0.65) saturate(1.15);transform:scale(1.1);">
                    <img src="${url}" alt="${alt}" class="ai-support-gambar-prestasi" data-full-src="${url}" style="position:relative;width:100%;height:auto;display:block;">
                </div>`;
                indexFoto++;
                posisiTerakhir = match.index + match[0].length;
            }
            hasil += renderTeksMarkdownAISupport(teks.slice(posisiTerakhir));
            return hasil;
        }

        // Gaya CSS buat efek fade-in-on-scroll foto AI Support -- disuntik SEKALI
        // lewat <style> (bukan taruh di file CSS terpisah), karena file HTML
        // dashboard_siswa.html tidak ikut direvisi di sini. Nilai opacity/translateY
        // & durasi transisi sengaja disamakan rasanya dengan animasi kartu guru
        // (fade + geser naik) di guru-card-reveal/.revealed.
        (function suntikGayaFotoRevealAISupport() {
            if (document.getElementById('gaya-ai-support-foto-reveal')) return;
            const style = document.createElement('style');
            style.id = 'gaya-ai-support-foto-reveal';
            style.textContent = `
                .ai-support-foto-reveal { opacity: 0; transform: translateY(16px); transition: opacity 0.5s ease, transform 0.5s ease; }
                .ai-support-foto-reveal.revealed { opacity: 1; transform: translateY(0); }
            `;
            document.head.appendChild(style);
        })();

        // Observer fade-in-on-scroll khusus foto AI Support -- pola SAMA seperti
        // getObserverRevealGuru()/aktifkanScrollRevealGuru() di Daftar Guru (1
        // observer dipakai ulang terus, bukan dibuat baru tiap ada bubble baru,
        // biar tidak numpuk di memori). Bedanya: root di-set ke div
        // #ai-support-chat-log (bukan default viewport/null) karena area yang
        // discroll siswa di sini adalah chat log itu sendiri (overflow-y auto),
        // bukan seluruh halaman seperti grid guru.
        let _observerRevealFotoAISupport = null;
        function getObserverRevealFotoAISupport() {
            if (_observerRevealFotoAISupport || !('IntersectionObserver' in window)) return _observerRevealFotoAISupport;
            _observerRevealFotoAISupport = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('revealed');
                        _observerRevealFotoAISupport.unobserve(entry.target);
                    }
                });
            }, { root: document.getElementById('ai-support-chat-log') || null, threshold: 0.12 });
            return _observerRevealFotoAISupport;
        }

        function aktifkanScrollRevealFotoAISupport(bubbleBaru) {
            const daftarFoto = bubbleBaru.querySelectorAll('.ai-support-foto-reveal:not(.revealed)');
            if (daftarFoto.length === 0) return;
            const observer = getObserverRevealFotoAISupport();
            if (!observer) {
                daftarFoto.forEach(el => el.classList.add('revealed'));
                return;
            }
            daftarFoto.forEach(el => observer.observe(el));
        }

        // Scroll chat log AI Support ke paling bawah dengan animasi HALUS (bukan
        // langsung "loncat" instan seperti scrollTop = scrollHeight biasa) --
        // ini juga yang bikin efek fade-in-on-scroll foto (ai-support-foto-reveal)
        // di atas kerasa/kelihatan mainnya, karena foto sempat "lewat" area yang
        // discroll pelan-pelan, bukan langsung nongol di posisi akhir dalam 1
        // frame. Kalau browser tidak dukung { behavior: 'smooth' } (sangat jarang),
        // otomatis fallback ke instan lewat try/catch di bawah.
        function scrollKeBawahAISupport(log) {
            if (!log) return;
            try {
                log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
            } catch (e) {
                log.scrollTop = log.scrollHeight;
            }
        }

        // Dipanggil dari switchTab() tiap kali tab AI Support dibuka. Kenapa perlu:
        // riwayat chat dirender saat halaman load, ketika tab ini masih hidden
        // (display:none) sehingga scroll-nya tidak berefek -- makanya siswa selalu
        // mendarat di bagian ATAS chat. Di sini scroll dilakukan SETELAH tab tampil:
        //  1) log chat -> paling bawah (instan, bukan smooth, biar tidak "melayang");
        //  2) kolom ketik dibawa ke area layar (kalau kartu chat lebih tinggi dari layar);
        //  3) diulang sebentar lagi, jaga-jaga tinggi konten baru stabil setelah layout
        //     (font/gambar/markdown) selesai.
        // SENGAJA tidak auto-fokus ke kolom ketik: di HP itu langsung memunculkan
        // keyboard yang menutupi chat.
        function aturScrollAwalAISupport() {
            const loncat = () => {
                const log = document.getElementById('ai-support-chat-log');
                if (!log || log.getClientRects().length === 0) return; // tab tidak sedang tampil
                log.scrollTop = log.scrollHeight;
                const input = document.getElementById('input-ai-support');
                const komposer = input ? (input.closest('.ai-composer') || input) : null;
                if (komposer && komposer.scrollIntoView) {
                    try { komposer.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (e) {}
                }
            };
            loncat();
            requestAnimationFrame(loncat);
            setTimeout(loncat, 150);
            setTimeout(loncat, 500);
        }

        // Chip saran di layar sambutan: isi kolom ketik lalu kirim seperti biasa.
        function aiSupportPakaiSaran(tombol) {
            const input = document.getElementById('input-ai-support');
            if (!input || input.disabled) return;
            input.value = (tombol && tombol.dataset.q) || (tombol ? tombol.textContent.trim() : '');
            const form = input.closest('form');
            if (!form) return;
            if (form.requestSubmit) form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }

        // Tombol "Chat Baru": percakapan yang sedang dibuka tetap tersimpan di riwayat;
        // layar dikosongkan dan pesan berikutnya membuka percakapan baru di server.
        function aiSupportChatBaru() {
            if (aiSupportSedangKirim()) return;
            aiSupportMulaiBaru();
            aiSupportToggleRiwayat(false);
            const input = document.getElementById('input-ai-support');
            // Di HP jangan auto-fokus: keyboard langsung menutupi layar sambutan.
            if (input && window.matchMedia('(min-width: 900px)').matches) input.focus();
        }

        /* ---------- penilaian balasan AI (jempol + alasan) ----------
           Baris kecil di bawah bubble AI. Menilai = kirim ke /api/gemini/feedback;
           jempol bawah langsung terkirim, alasan menyusul kalau siswa memilih
           (boleh dilewati) supaya siswa tidak dipaksa mengetik. */
        const AI_SUPPORT_ALASAN_NILAI = [
            ['tidak_nyambung', 'Tidak nyambung'],
            ['terlalu_panjang', 'Terlalu panjang'],
            ['terlalu_umum', 'Saran terlalu umum'],
            ['salah', 'Jawabannya salah']
        ];

        /* ---------- TUJUAN BELAJAR + PETA LANGKAH ----------
           Kartu di atas chat: jalur titik (selesai / sekarang / belum), langkah sekarang
           + alasannya, dan 3 aksi. Semua data dari server (SQLite, tanpa Gemini):
           dimuat saat halaman dibuka dan setelah tiap balasan AI, jadi siswa yang
           kembali besok langsung melihat "kamu di langkah ke-3". Titik hanya jadi
           selesai lewat tombol "Lancar" yang divalidasi server. */
        let aiSupportDariTujuan = false;   // true = pesan berikutnya dikirim dari tombol kartu tujuan
        const KUNCI_TUJUAN_RINGKAS = 'ai_tujuan_ringkas';

        // Tujuan belajar TERIKAT PER CHAT: Chat Baru (cid null) -> kartu disembunyikan;
        // membuka chat lama -> tampilkan progres terakhir chat itu.
        function aiSupportMuatTujuan() {
            const cid = cidAISupport;
            if (!cid) { aiSupportRenderTujuan(null); return Promise.resolve(); }
            return aiSupportApi('/api/gemini/tujuan?conversation_id=' + encodeURIComponent(cid)).then(({ ok, data }) => {
                if (cid !== cidAISupport) return; // pindah chat saat menunggu respons -> abaikan yang basi
                if (ok && data && data.success) aiSupportRenderTujuan(data.tujuan || null);
            }).catch(() => {});
        }

        function aiSupportKirimDariTujuan(teks) {
            if (aiSupportSedangKirim()) return;
            const input = document.getElementById('input-ai-support');
            const form = input && input.closest('form');
            if (!input || input.disabled || !form) return;
            input.value = teks;
            aiSupportDariTujuan = true;
            if (form.requestSubmit) form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            aiSupportDariTujuan = false;
        }

        function aiSupportAksiTujuan(aksi, tujuan, ekstra) {
            return aiSupportApi('/api/gemini/tujuan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ aksi: aksi, tujuan_id: tujuan.id, conversation_id: cidAISupport || '' }, ekstra || {}))
            }).then(({ ok, data }) => (ok && data && data.success) ? data : null).catch(() => null);
        }

        function aiSupportRenderTujuan(t) {
            const wadah = document.getElementById('ai-tujuan');
            if (!wadah) return;
            if (!t) { wadah.hidden = true; wadah.replaceChildren(); return; }
            wadah.hidden = false;
            let ringkas = false;
            try { ringkas = sessionStorage.getItem(KUNCI_TUJUAN_RINGKAS) === '1'; } catch (e) {}
            wadah.classList.toggle('ringkas', ringkas);

            const el = (tag, kelas, teks) => {
                const e = document.createElement(tag);
                if (kelas) e.className = kelas;
                if (teks != null) e.textContent = teks;
                return e;
            };
            const tombol = (label, kelas, aksi) => {
                const b = el('button', 'ai-tj-btn' + (kelas ? ' ' + kelas : ''), label);
                b.type = 'button';
                b.addEventListener('click', aksi);
                return b;
            };
            const selesai = t.status === 'selesai';

            const kepala = el('div', 'ai-tj-kepala');
            kepala.appendChild(el('div', 'ai-tj-judul', (selesai ? 'Tujuan tuntas: ' : 'Tujuanmu: ') + t.judul));
            const lipat = el('button', 'ai-tj-lipat');
            lipat.type = 'button';
            lipat.setAttribute('aria-label', ringkas ? 'Tampilkan detail tujuan' : 'Ringkas tujuan');
            lipat.setAttribute('aria-expanded', String(!ringkas));
            lipat.innerHTML = '<i class="fa-solid fa-chevron-' + (ringkas ? 'down' : 'up') + '"></i>';
            lipat.addEventListener('click', () => {
                try { sessionStorage.setItem(KUNCI_TUJUAN_RINGKAS, ringkas ? '0' : '1'); } catch (e) {}
                aiSupportRenderTujuan(t);
            });
            kepala.appendChild(lipat);

            const jalur = el('div', 'ai-tj-jalur');
            t.langkah.forEach((l, i) => {
                const status = l.status === 'selesai' ? 'selesai' : (!selesai && i === t.sekarang ? 'sekarang' : 'belum');
                const titik = el('div', 'ai-tj-titik ' + status);
                titik.title = l.judul + (status === 'selesai' ? ' (selesai)' : '');
                const bulat = el('div', 'ai-tj-bulat');
                if (status === 'selesai') bulat.innerHTML = '<i class="fa-solid fa-check"></i>';
                else bulat.textContent = String(i + 1);
                titik.append(bulat, el('div', 'ai-tj-label', l.judul));
                jalur.appendChild(titik);
            });
            wadah.replaceChildren(kepala, jalur);

            if (selesai) {
                const blok = el('div', 'ai-tj-sekarang');
                blok.appendChild(el('div', '', 'Semua langkah selesai. Seberapa terbantu kamu?'));
                const bintang = el('div', 'ai-tj-bintang');
                for (let n = 1; n <= 5; n++) {
                    const b = el('button', 'ai-tj-bintang-btn');
                    b.type = 'button';
                    b.setAttribute('aria-label', n + ' dari 5');
                    b.innerHTML = '<i class="fa-solid fa-star"></i>';
                    b.addEventListener('click', () => {
                        bintang.querySelectorAll('button').forEach(x => { x.disabled = true; });
                        aiSupportAksiTujuan('bintang', t, { bintang: n }).then(d => {
                            if (!d) { bintang.querySelectorAll('button').forEach(x => { x.disabled = false; }); return; }
                            blok.replaceChildren(el('div', '', 'Terima kasih! Tanya lagi kapan saja untuk tujuan berikutnya.'));
                            setTimeout(() => aiSupportRenderTujuan(d.tujuan || null), 1800);
                        });
                    });
                    bintang.appendChild(b);
                }
                blok.appendChild(bintang);
                wadah.appendChild(blok);
                const aksi = el('div', 'ai-tj-aksi');
                aksi.appendChild(tombol('Tutup', '', () => {
                    aiSupportAksiTujuan('tutup', t).then(d => { if (d) aiSupportRenderTujuan(d.tujuan || null); });
                }));
                wadah.appendChild(aksi);
                return;
            }

            const l = t.langkah[t.sekarang];
            const sekarang = el('div', 'ai-tj-sekarang');
            sekarang.appendChild(el('div', '', 'Langkah ' + (t.sekarang + 1) + ' dari ' + t.langkah.length + ': ' + l.judul));
            sekarang.appendChild(el('div', 'ai-tj-alasan', l.alasan));
            const aksi = el('div', 'ai-tj-aksi');
            const tampilAwal = () => {
                aksi.replaceChildren(
                    tombol('Bantu langkah ini', 'utama', () => aiSupportKirimDariTujuan('Bantu aku mengerjakan langkah ini: ' + l.judul + ' (' + t.topik + ')')),
                    tombol('Sudah kukerjakan', '', tampilHasil),
                    tombol('Ganti tujuan', 'teks', () => {
                        if (!window.confirm('Ganti tujuan belajar? Tujuan ini tidak dilanjutkan.')) return;
                        aiSupportAksiTujuan('ganti', t).then(d => { if (d) aiSupportRenderTujuan(d.tujuan || null); });
                    })
                );
            };
            const tampilHasil = () => {
                aksi.replaceChildren(
                    el('span', 'ai-tj-tanya', 'Bagaimana hasilnya?'),
                    tombol('Lancar', 'utama', (e) => {
                        aksi.querySelectorAll('button').forEach(x => { x.disabled = true; });
                        aiSupportAksiTujuan('lancar', t, { urutan: l.urutan }).then(d => {
                            if (d && d.tujuan) aiSupportRenderTujuan(d.tujuan);
                            else tampilHasil();
                        });
                    }),
                    tombol('Masih bingung', '', () => aiSupportKirimDariTujuan('Aku masih bingung di langkah: ' + l.judul + '. Tolong jelaskan lebih sederhana.')),
                    tombol('Batal', 'teks', tampilAwal)
                );
            };
            tampilAwal();
            const bawah = el('div', 'ai-tj-bawah');
            bawah.append(sekarang, aksi);
            wadah.appendChild(bawah);
        }

        /* ---------- PILIHAN JAWABAN CEPAT (saat coach bertanya) ----------
           Backend mengirim `pilihan` (daftar teks) kalau coach sedang bertanya
           level / waktu / target. Tampil sebagai tombol bernomor di bawah
           balasan; di laptop tekan angka 1..N di keyboard. "Ketik sendiri"
           (nomor terakhir) memfokuskan kolom tulis. Hilang begitu siswa membalas. */
        function aiSupportHapusPilihan() {
            document.querySelectorAll('#ai-support-chat-log .ai-pilihan').forEach(e => e.remove());
        }

        function aiSupportPilih(opsi) {
            const input = document.getElementById('input-ai-support');
            const form = input && input.closest('form');
            if (!input || !form) return;
            if (!opsi.kirim) { aiSupportHapusPilihan(); input.focus(); return; }
            if (aiSupportSedangKirim() || input.disabled) return;
            input.value = opsi.teks;
            if (form.requestSubmit) form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }

        function aiSupportTampilPilihan(daftar) {
            aiSupportHapusPilihan();
            if (!Array.isArray(daftar) || !daftar.length) return;
            const log = document.getElementById('ai-support-chat-log');
            if (!log) return;
            const baris = document.createElement('div');
            baris.className = 'ai-pilihan';
            baris.setAttribute('role', 'group');
            baris.setAttribute('aria-label', 'Pilihan jawaban cepat');
            const semua = daftar.slice(0, 8).map(t => ({ teks: String(t), kirim: true }))
                .concat([{ teks: 'Ketik sendiri', kirim: false }]);
            semua.forEach((opsi, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ai-pilihan-btn' + (opsi.kirim ? '' : ' ai-pilihan-lain');
                const no = document.createElement('span');
                no.className = 'ai-pil-no';
                no.textContent = String(i + 1);
                const tx = document.createElement('span');
                tx.textContent = opsi.teks;
                b.append(no, tx);
                b.addEventListener('click', () => aiSupportPilih(opsi));
                baris.appendChild(b);
            });
            const petunjuk = document.createElement('span');
            petunjuk.className = 'ai-pil-petunjuk';
            petunjuk.textContent = 'atau tekan angka 1-' + semua.length;
            baris.appendChild(petunjuk);
            log.appendChild(baris);
            scrollKeBawahAISupport(log);
        }

        // satu pendengar keyboard saja: angka 1..9 memilih tombol bernomor di bawah balasan terakhir
        if (!window.__aiPilihanKeyboard) {
            window.__aiPilihanKeyboard = true;
            document.addEventListener('keydown', function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
                if (!/^[1-9]$/.test(e.key)) return;
                const baris = document.querySelector('#ai-support-chat-log .ai-pilihan');
                const tab = document.getElementById('tab-ai-support');
                if (!baris || !tab || tab.classList.contains('hidden')) return;
                const input = document.getElementById('input-ai-support');
                const el = e.target;
                const sedangMengetik = el && el.matches &&
                    el.matches('input, textarea, select, [contenteditable="true"]') &&
                    !(el === input && !input.value);
                if (sedangMengetik) return;
                const tombol = baris.querySelectorAll('.ai-pilihan-btn')[Number(e.key) - 1];
                if (!tombol) return;
                e.preventDefault();
                tombol.click();
            });
        }

        function aiSupportKirimPenilaian(cid, pesanId, nilai, alasan) {
            return aiSupportApi('/api/gemini/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: cid, pesan_id: pesanId, nilai: nilai, alasan: alasan || null })
            }).then(({ ok, data }) => !!(ok && data && data.success)).catch(() => false);
        }

        function aiSupportPasangPenilaian(log, pesanId, cid) {
            if (!log || typeof pesanId !== 'number' || !cid) return;
            const baris = document.createElement('div');
            baris.className = 'ai-rate-row';

            const buatTombol = (ikon, label, nilai) => {
                const t = document.createElement('button');
                t.type = 'button';
                t.className = 'ai-rate-btn';
                t.setAttribute('aria-label', label);
                t.title = label;
                t.innerHTML = '<i class="fa-regular ' + ikon + '"></i>';
                t.addEventListener('click', () => pilih(nilai));
                return t;
            };
            const teksKecil = (teks) => {
                const sp = document.createElement('span');
                sp.className = 'ai-rate-teks';
                sp.textContent = teks;
                return sp;
            };
            const tampilAwal = () => {
                baris.replaceChildren(
                    teksKecil('Terbantu?'),
                    buatTombol('fa-thumbs-up', 'Jawaban ini membantu', 1),
                    buatTombol('fa-thumbs-down', 'Jawaban ini kurang membantu', -1)
                );
            };
            const tampilTerima = (pesan) => { baris.replaceChildren(teksKecil(pesan)); };
            const tampilAlasan = () => {
                const items = [teksKecil('Apa yang kurang?')];
                AI_SUPPORT_ALASAN_NILAI.forEach(([kode, label]) => {
                    const c = document.createElement('button');
                    c.type = 'button';
                    c.className = 'ai-rate-chip';
                    c.textContent = label;
                    c.addEventListener('click', () => {
                        c.disabled = true;
                        aiSupportKirimPenilaian(cid, pesanId, -1, kode).then(ok => {
                            tampilTerima(ok ? 'Terima kasih, masukanmu terkirim.' : 'Gagal mengirim, coba lagi nanti.');
                        });
                    });
                    items.push(c);
                });
                const lewati = document.createElement('button');
                lewati.type = 'button';
                lewati.className = 'ai-rate-chip ai-rate-lewati';
                lewati.textContent = 'Lewati';
                lewati.addEventListener('click', () => tampilTerima('Terima kasih, masukanmu terkirim.'));
                items.push(lewati);
                baris.replaceChildren(...items);
            };
            const pilih = (nilai) => {
                baris.querySelectorAll('button').forEach(t => { t.disabled = true; });
                aiSupportKirimPenilaian(cid, pesanId, nilai, null).then(ok => {
                    if (!ok) { tampilAwal(); return; }
                    if (nilai === 1) tampilTerima('Senang bisa membantu!');
                    else tampilAlasan();
                });
            };

            tampilAwal();
            log.appendChild(baris);
        }

        function tambahBubbleBotAISupport(teks, simpanKeSesi, pesanId) {
            if (simpanKeSesi !== false) simpanRiwayatAISupport('model', teks);
            const log = document.getElementById('ai-support-chat-log');
            const bubbleBot = document.createElement('div');
            bubbleBot.className = 'flex items-start gap-2.5';
            bubbleBot.innerHTML = `
                <div class="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] flex-shrink-0"><i class="fa-solid fa-robot"></i></div>
                <div class="bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs text-slate-700 max-w-[80%] sm:max-w-[340px]"></div>
            `;
            const elIsiBubble = bubbleBot.querySelector('div.bg-slate-100');
            const htmlBalasan = renderBalasanAISupport(teks);
            elIsiBubble.innerHTML = htmlBalasan;
            elIsiBubble.classList.add('ai-md');
            // Bubble tanpa foto dilebarkan di layar besar supaya jawaban panjang tidak
            // terlalu sempit; bubble berfoto tetap 340px (layout foto dirancang segitu).
            if (htmlBalasan.indexOf('ai-support-foto-wrap') === -1) {
                elIsiBubble.classList.remove('sm:max-w-[340px]');
                elIsiBubble.style.maxWidth = 'min(80%, 600px)';
            }
            log.appendChild(bubbleBot);
            if (typeof pesanId === 'number' && cidAISupport) aiSupportPasangPenilaian(log, pesanId, cidAISupport);
            aktifkanScrollRevealFotoAISupport(bubbleBot);

            // SENGAJA TIDAK auto-scroll kalau balasannya ada foto (ai-support-foto-reveal) --
            // supaya efek fade-in-on-scroll di atas benar-benar kepakai: foto baru
            // "reveal" pas SISWA SENDIRI yang scroll ke bawah buat lihatnya (persis
            // seperti kartu guru yang reveal pas discroll manual di Daftar Guru), bukan
            // langsung nongol duluan gara-gara auto-scroll ke bawah otomatis. Balasan
            // TANPA foto tetap auto-scroll seperti biasa (teks biasa gak ada efek scroll
            // yang perlu "dijaga" momennya).
            const adaFotoDiBalasan = bubbleBot.querySelector('.ai-support-foto-reveal');
            if (!adaFotoDiBalasan) {
                scrollKeBawahAISupport(log);
            }
        }

        // Restore riwayat chat AI Support dari sessionStorage (kalau ada)
        // begitu script ini dimuat -- lihat catatan lengkap di
        // muatRiwayatAISupportDariSession() di atas.
        muatRiwayatAISupportDariSession();
        aiSupportSinkronPanelRiwayat();
        aiSupportMuatTujuan();
        window.matchMedia('(min-width: 900px)').addEventListener('change', aiSupportSinkronPanelRiwayat);

        // ----------------------------------------------------
        // LIGHTBOX -- lihat foto prestasi ukuran penuh saat diklik
        // ----------------------------------------------------
        // PENTING soal kualitas gambar: src yang dipakai di sini PERSIS
        // sama dengan src thumbnail kecil di chat (lihat data-full-src di
        // renderBalasanAISupport) -- jadi ini BUKAN upscale dari gambar
        // kecil (yang pasti bikin pecah/blur), melainkan file ASLI yang
        // sama, cuma ditampilkan di ukuran lebih besar. object-fit:contain
        // juga menjaga rasio gambar supaya tidak gepeng/stretch.
        let elLightboxAISupport = null;

        function bukaLightboxGambarAISupport(url, alt) {
            tutupLightboxGambarAISupport(); // jaga-jaga kalau ada sisa lightbox lama

            const overlay = document.createElement('div');
            overlay.id = 'ai-support-lightbox';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(15,23,42,0.9);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;';
            overlay.innerHTML = `
                <img src="${url}" alt="${alt}" style="max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.5);">
                <button type="button" aria-label="Tutup" style="position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:9999px;background:rgba(255,255,255,0.15);color:#fff;border:none;font-size:20px;cursor:pointer;line-height:1;">&times;</button>
            `;

            // Klik di mana saja (backdrop ATAU tombol X) menutup lightbox.
            // Klik langsung di gambar TIDAK ditutup dulu di sini karena
            // gambar mengisi area tengah -- kalau mau bisa juga ditutup,
            // tapi dibiarkan begini supaya user bisa klik gambar buat
            // interaksi lain nanti (mis. pinch-zoom bawaan browser di HP)
            // tanpa keklik-tutup tanpa sengaja.
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.closest('button')) {
                    tutupLightboxGambarAISupport();
                }
            });

            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden'; // cegah scroll di belakang lightbox
            elLightboxAISupport = overlay;
        }

        function tutupLightboxGambarAISupport() {
            if (elLightboxAISupport) {
                elLightboxAISupport.remove();
                elLightboxAISupport = null;
                document.body.style.overflow = '';
            }
        }

        // Tutup lightbox pakai tombol Esc di keyboard.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') tutupLightboxGambarAISupport();
        });

        // Event delegation: satu listener di chat log, nangkep klik ke
        // gambar prestasi manapun (termasuk yang baru ditambahkan setelah
        // listener ini dipasang) -- lebih ringan daripada pasang listener
        // baru di tiap <img> satu-satu.
        document.getElementById('ai-support-chat-log')?.addEventListener('click', (e) => {
            const img = e.target.closest('img.ai-support-gambar-prestasi');
            if (img) bukaLightboxGambarAISupport(img.dataset.fullSrc, img.alt);
        });

        // GUARD ANTI-SPAM: mencegah pertanyaan yang sama dikirim berkali-kali
        // dalam sepersekian detik gara-gara user nge-klik/nge-Enter berkali-kali.
        // - sedangKirimAISupport: true selagi ada request yang masih berjalan
        //   (submit baru diabaikan total selama ini, BUKAN cuma ditunda).
        // - JEDA_MINIMAL_KIRIM_MS: jeda tambahan SETELAH jawaban selesai
        //   sebelum tombol kirim aktif lagi, jaga-jaga user main klik cepat
        //   begitu jawaban baru muncul.
        let sedangKirimAISupport = false;
        const JEDA_MINIMAL_KIRIM_MS = 800;

        function kirimChatAISupport(event) {
            event.preventDefault();

            if (sedangKirimAISupport) return;

            const input = document.getElementById('input-ai-support');
            const pertanyaan = input.value.trim();

            // Kalau sedang menunggu hasil kompresi gambar, tahan submit dulu
            // -- jangan kirim base64 kosong ke backend.
            if (gambarTerpilihAISupport === null && document.getElementById('ai-support-gambar-status')) {
                return;
            }
            // Boleh kirim kalau ada teks ATAU ada gambar terlampir (dulu wajib ada teks).
            if (!pertanyaan && !gambarTerpilihAISupport) return;

            const gambarTerlampir = gambarTerpilihAISupport; // simpan referensi sebelum di-reset

            const tombolKirim = event.target.querySelector('button[type="submit"]');

            sedangKirimAISupport = true;
            if (tombolKirim) tombolKirim.disabled = true;
            input.disabled = true;

            const log = document.getElementById('ai-support-chat-log');
            aiSupportHapusPilihan();

            const bubbleUser = document.createElement('div');
            bubbleUser.className = 'flex items-start gap-2.5 justify-end';
            bubbleUser.innerHTML = `
                <div class="flex flex-col items-end gap-1 max-w-[80%]">
                    ${gambarTerlampir ? `<img src="${gambarTerlampir.previewUrl}" class="rounded-2xl max-h-40 w-auto border border-slate-200">` : ''}
                    ${pertanyaan ? '<div class="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs"></div>' : ''}
                </div>
            `;
            const bubbleTeks = bubbleUser.querySelector('div.bg-blue-600');
            if (bubbleTeks) bubbleTeks.innerText = pertanyaan;
            log.appendChild(bubbleUser);
            // Riwayat sesi (sessionStorage) cuma simpan teksnya -- lihat
            // catatan di atas fungsi bersihkanDraftGambarAISupport().
            if (pertanyaan) simpanRiwayatAISupport('user', pertanyaan);

            input.value = '';
            bersihkanDraftGambarAISupport();
            scrollKeBawahAISupport(log);

            // Bubble "sedang mengetik..." selama menunggu balasan dari Ollama
            const bubbleTyping = document.createElement('div');
            bubbleTyping.id = 'ai-support-typing';
            bubbleTyping.className = 'flex items-start gap-2.5';
            bubbleTyping.innerHTML = `
                <div class="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] flex-shrink-0"><i class="fa-solid fa-robot"></i></div>
                <div class="bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs text-slate-400 max-w-[80%] italic">mengetik...</div>
            `;
            log.appendChild(bubbleTyping);
            scrollKeBawahAISupport(log);

            // Panggil backend Flask (/api/gemini/chat), yang meneruskan ke Google Gemini.
            // Kalau Gemini belum siap / error (mis. API key belum diisi), fallback
            // otomatis ke balasAISupport() (jawaban keyword-matching client-side lama)
            // supaya chat tetap kebalas.
            fetch('/api/gemini/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pesan: pertanyaan,
                    // null = percakapan baru; backend membalas conversation_id yang dipakai berikutnya.
                    conversation_id: cidAISupport,
                    // Field baru, cuma dikirim kalau ada lampiran gambar --
                    // base64 di sini SUDAH hasil kompresi sadis (bukan file asli).
                    ...(gambarTerlampir ? { gambar_base64: gambarTerlampir.base64, gambar_mime: gambarTerlampir.mime } : {}),
                    // true = pesan ini dikirim dari tombol kartu tujuan belajar (backend menyertakan konteks tujuan)
                    ...(aiSupportDariTujuan ? { dari_tujuan: true } : {})
                })
            })
                .then(res => res.json().then(data => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    document.getElementById('ai-support-typing')?.remove();
                    if (ok && data && data.success && data.conversation_id) {
                        aiSupportSetCid(data.conversation_id);
                        aiSupportMuatDaftar(); // segarkan panel riwayat (judul baru / urutan terbaru)
                    }
                    if (ok && data.success && data.balasan) {
                        tambahBubbleBotAISupport(data.balasan, undefined, data.pesan_id);
                        aiSupportMuatTujuan(); // tujuan mungkin baru dibuat / langkah berubah
                        aiSupportTampilPilihan(data.pilihan); // tombol bernomor kalau coach sedang bertanya
                    } else if (data && data.quota_habis) {
                        // Quota harian AI Support BENERAN sudah habis (dicek &
                        // dicatat di backend, lihat _cek_dan_tambah_quota_ai di
                        // gemini_routes.py) -- JANGAN fallback ke keyword-
                        // matching di sini, supaya siswa tidak salah kira
                        // jatahnya masih ada padahal sebenarnya sudah habis.
                        tambahBubbleBotAISupport(data.message || 'Jatah tanya AI Support kamu hari ini sudah habis. Coba lagi besok, ya.');
                    } else {
                        // Sebelumnya pesan error asli dari Gemini (data.message,
                        // mis. soal API key/kuota/model) ketelen diam-diam di sini
                        // -- jadi susah didebug kenapa fallback keyword-matching
                        // yang muncul padahal harusnya Gemini yang jawab.
                        console.warn('Gemini gagal menjawab, fallback ke keyword-matching. Pesan error:', data && data.message);
                        tambahBubbleBotAISupport(balasAISupport(pertanyaan));
                    }
                })
                .catch(() => {
                    document.getElementById('ai-support-typing')?.remove();
                    tambahBubbleBotAISupport(balasAISupport(pertanyaan));
                })
                .finally(() => {
                    input.disabled = false;
                    input.focus();
                    // Jeda tambahan sebelum tombol kirim aktif lagi (lihat
                    // komentar JEDA_MINIMAL_KIRIM_MS di atas).
                    setTimeout(() => {
                        sedangKirimAISupport = false;
                        if (tombolKirim) tombolKirim.disabled = false;
                    }, JEDA_MINIMAL_KIRIM_MS);
                });
        }

        /* ================= AI SUPPORT - LAMPIRAN GAMBAR =================
           Siswa bisa lampirkan 1 gambar (mis. foto soal/tugas) ke AI Support.
           PRINSIP: preview yang siswa lihat di bubble chat dibuat dari file
           ASLI lewat URL.createObjectURL (kualitas penuh) -- jadi tetap
           kelihatan tajam di layar siswa. Yang benar-benar dikirim ke
           backend/Gemini adalah salinan hasil KOMPRESI SADIS yang terpisah
           (resize ke sisi terpanjang AI_SUPPORT_GAMBAR_MAX_DIMENSI + JPEG
           quality diturunkan bertahap sampai di bawah target ukuran) --
           supaya hemat token Gemini tanpa mengurangi ketajaman yang
           kelihatan di sisi siswa.
           CATATAN: lampiran gambar TIDAK ikut disimpan ke riwayat sesi
           (simpanRiwayatAISupport hanya simpan teks) -- kalau halaman
           di-refresh, bubble gambar yang sudah terkirim tidak akan muncul
           lagi saat riwayat dimuat ulang dari sessionStorage. */

        const AI_SUPPORT_GAMBAR_MAX_DIMENSI = 768;   // px, sisi terpanjang setelah resize
        const AI_SUPPORT_GAMBAR_TARGET_KB   = 120;   // target ukuran akhir base64 setelah kompresi
        const AI_SUPPORT_GAMBAR_QUALITY_MIN = 0.3;   // jangan turunkan quality JPEG di bawah ini

        let gambarTerpilihAISupport = null; // { previewUrl, base64, mime } | null

        // Dipakai saat user BATAL lampiran (tombol x) atau kompresi gagal --
        // revoke object URL karena preview-nya tidak dipakai di mana pun lagi.
        function batalkanGambarAISupport() {
            if (gambarTerpilihAISupport && gambarTerpilihAISupport.previewUrl) {
                URL.revokeObjectURL(gambarTerpilihAISupport.previewUrl);
            }
            gambarTerpilihAISupport = null;
            const preview = document.getElementById('ai-support-preview-gambar');
            if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
            const inputFile = document.getElementById('ai-support-input-gambar');
            if (inputFile) inputFile.value = '';
        }

        // Dipakai SETELAH gambar berhasil terkirim -- object URL-nya SENGAJA
        // TIDAK di-revoke di sini karena masih dipakai sebagai <img> di
        // bubble chat yang baru saja ditambahkan ke log.
        function bersihkanDraftGambarAISupport() {
            gambarTerpilihAISupport = null;
            const preview = document.getElementById('ai-support-preview-gambar');
            if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
            const inputFile = document.getElementById('ai-support-input-gambar');
            if (inputFile) inputFile.value = '';
        }

        function kompresGambarAISupport(file) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const urlSementara = URL.createObjectURL(file);
                img.onload = () => {
                    URL.revokeObjectURL(urlSementara);

                    let { width, height } = img;
                    const sisiTerpanjang = Math.max(width, height);
                    if (sisiTerpanjang > AI_SUPPORT_GAMBAR_MAX_DIMENSI) {
                        const skala = AI_SUPPORT_GAMBAR_MAX_DIMENSI / sisiTerpanjang;
                        width = Math.round(width * skala);
                        height = Math.round(height * skala);
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Turunkan quality JPEG bertahap sampai di bawah target
                    // ukuran, atau sampai mentok AI_SUPPORT_GAMBAR_QUALITY_MIN
                    // (jangan sampai rusak parah sampai tidak kebaca Gemini).
                    let quality = 0.6;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    while (dataUrl.length * 0.75 / 1024 > AI_SUPPORT_GAMBAR_TARGET_KB && quality > AI_SUPPORT_GAMBAR_QUALITY_MIN) {
                        quality = Math.round((quality - 0.1) * 10) / 10;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }

                    resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
                };
                img.onerror = () => { URL.revokeObjectURL(urlSementara); reject(new Error('Gagal membaca gambar')); };
                img.src = urlSementara;
            });
        }

        async function pilihGambarAISupport(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                alert('File yang dipilih bukan gambar.');
                event.target.value = '';
                return;
            }

            batalkanGambarAISupport();

            const previewUrl = URL.createObjectURL(file); // kualitas penuh -- buat preview siswa
            const preview = document.getElementById('ai-support-preview-gambar');
            if (preview) {
                preview.classList.remove('hidden');
                preview.innerHTML = `
                    <div class="ai-preview-foto relative inline-block">
                        <img src="${previewUrl}" class="h-20 w-20 object-cover rounded-xl border border-slate-200">
                        <button type="button" id="ai-support-batal-gambar" class="ai-preview-x" title="Hapus gambar" aria-label="Hapus gambar"><i class="fa-solid fa-xmark"></i></button>
                        <span class="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl text-white text-[9px]" id="ai-support-gambar-status">mengompres...</span>
                    </div>
                `;
                document.getElementById('ai-support-batal-gambar')?.addEventListener('click', batalkanGambarAISupport);
            }

            try {
                const hasil = await kompresGambarAISupport(file);
                gambarTerpilihAISupport = { previewUrl, base64: hasil.base64, mime: hasil.mime };
                document.getElementById('ai-support-gambar-status')?.remove();
            } catch (e) {
                console.warn('Kompresi gambar AI Support gagal:', e);
                batalkanGambarAISupport();
                alert('Gagal memproses gambar, coba gambar lain.');
            }
        }

        // Suntik tombol lampirkan gambar + input file tersembunyi ke form AI
        // Support. Form aslinya ada di template HTML (bukan di file JS ini),
        // jadi elemen barunya dibuat & disuntik lewat JS supaya tidak perlu
        // ubah file HTML terpisah -- ditaruh persis di sebelah tombol kirim.
        (function suntikTombolGambarAISupport() {
            const input = document.getElementById('input-ai-support');
            if (!input) return;
            const form = input.closest('form');
            if (!form || document.getElementById('ai-support-input-gambar')) return;

            const tombolSubmit = form.querySelector('button[type="submit"]');

            const inputFile = document.createElement('input');
            inputFile.type = 'file';
            inputFile.accept = 'image/*';
            inputFile.id = 'ai-support-input-gambar';
            inputFile.className = 'hidden';
            inputFile.addEventListener('change', pilihGambarAISupport);

            const tombolLampir = document.createElement('button');
            tombolLampir.type = 'button';
            tombolLampir.id = 'ai-support-tombol-lampir';
            tombolLampir.title = 'Lampirkan gambar';
            tombolLampir.className = 'ai-composer-lampir';
            tombolLampir.innerHTML = '<i class="fa-solid fa-plus"></i>';
            tombolLampir.addEventListener('click', () => inputFile.click());

            // LAYOUT COMPOSER (gaya Claude/ChatGPT): satu kartu berisi
            //   [ preview gambar (muncul di ATAS, hanya kalau ada lampiran) ]
            //   [ kolom ketik selebar kartu                                ]
            //   [ tombol "+" di kiri bawah ............ tombol kirim kanan ]
            // Semua id lama dipertahankan (input-ai-support, ai-support-input-gambar,
            // ai-support-tombol-lampir, ai-support-preview-gambar), jadi fungsi
            // kirim/pilih gambar/shortcut tidak perlu diubah.
            const previewWrap = document.createElement('div');
            previewWrap.id = 'ai-support-preview-gambar';
            previewWrap.className = 'hidden ai-composer-preview';

            const kartu = document.createElement('div');
            kartu.className = 'ai-composer';
            const barisBawah = document.createElement('div');
            barisBawah.className = 'ai-composer-baris';

            input.className = 'ai-composer-input';

            // Tombol DIKTE (mic) -- ditaruh persis di sebelah kiri tombol kirim.
            // Logika Web Speech API-nya ada di pasangDikteAISupport() di bawah.
            const tombolDikte = document.createElement('button');
            tombolDikte.type = 'button';
            tombolDikte.id = 'ai-support-tombol-dikte';
            tombolDikte.title = 'Dikte (bicara untuk mengetik)';
            tombolDikte.setAttribute('aria-label', 'Dikte');
            tombolDikte.className = 'ai-composer-dikte';
            tombolDikte.innerHTML = '<i class="fa-solid fa-microphone"></i>';

            barisBawah.appendChild(tombolLampir);
            barisBawah.appendChild(inputFile);
            barisBawah.appendChild(input);
            barisBawah.appendChild(tombolDikte);
            if (tombolSubmit) barisBawah.appendChild(tombolSubmit);

            kartu.appendChild(previewWrap);
            kartu.appendChild(barisBawah);
            // klik area kosong kartu -> fokus ke kolom ketik
            kartu.addEventListener('click', (e) => {
                if (!e.target.closest('button, img, a')) input.focus();
            });

            form.className = 'p-4 border-t border-slate-100';
            form.appendChild(kartu);

            if (!document.getElementById('gaya-ai-composer')) {
                const style = document.createElement('style');
                style.id = 'gaya-ai-composer';
                style.textContent = `
                    .ai-composer { border: 1px solid #e2e8f0; background: #fff; border-radius: 9999px; padding: 6px 8px 6px 12px; box-shadow: 0 1px 6px rgba(15,23,42,.08); transition: border-color .15s, box-shadow .15s; cursor: text; }
                    .ai-composer:has(.ai-composer-preview:not(.hidden)) { border-radius: 20px; }
                    .ai-composer:focus-within { border-color: #94a3b8; box-shadow: 0 1px 8px rgba(15,23,42,.14); }
                    .ai-composer-preview { margin: 4px 0 8px; }
                    .ai-composer-input { display: block; flex: 1 1 auto; min-width: 0; width: auto; border: 0 !important; outline: none !important; box-shadow: none !important; background: transparent !important; padding: 8px 6px !important; font-size: .8rem; }
                    .ai-composer-baris { display: flex; align-items: center; gap: 4px; margin: 0; }
                    .ai-composer-lampir { width: 36px; height: 36px; flex-shrink: 0; border: 0; background: transparent; color: #0f172a; font-size: 16px; padding: 0; margin: 0; display: flex; align-items: center; justify-content: center; border-radius: 9999px; cursor: pointer; transition: background .15s, transform .15s; }
                    .ai-composer-lampir:hover { background: #f1f5f9; }
                    .ai-composer-dikte { width: 36px; height: 36px; flex-shrink: 0; border: 0; background: transparent; color: #0f172a; font-size: 16px; padding: 0; margin: 0; display: flex; align-items: center; justify-content: center; border-radius: 9999px; cursor: pointer; transition: background .15s, color .15s; }
                    .ai-composer-dikte:hover { background: #f1f5f9; }
                    .ai-composer-dikte.merekam { background: #fee2e2; color: #dc2626; animation: ai-dikte-denyut 1.2s ease-in-out infinite; }
                    .ai-composer-dikte:disabled { opacity: .4; cursor: not-allowed; }
                    @keyframes ai-dikte-denyut { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,.35); } 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0); } }
                    /* Tombol kirim: TANPA biru -- bulat netral gelap (slate), abu-abu saat nonaktif. */
                    .ai-composer-baris button[type="submit"] { width: 36px !important; height: 36px !important; flex-shrink: 0; padding: 0 !important; margin: 0 !important; border-radius: 9999px !important; background: #0f172a !important; color: #fff !important; border: 0 !important; display: flex; align-items: center; justify-content: center; box-shadow: none !important; transition: background .15s, opacity .15s; }
                    .ai-composer-baris button[type="submit"]:hover:not(:disabled) { background: #334155 !important; }
                    .ai-composer-baris button[type="submit"]:disabled { background: #cbd5e1 !important; cursor: not-allowed; }
                    /* Tombol X hapus gambar: di DALAM pojok kanan atas foto, muncul saat kursor
                       masuk ke foto (atau tombol difokus keyboard). Di layar sentuh (tanpa hover)
                       selalu terlihat supaya tetap bisa dipakai di HP. */
                    .ai-preview-foto { position: relative; display: inline-block; }
                    .ai-preview-x { position: absolute; top: 5px; right: 5px; z-index: 3; width: 22px; height: 22px; border-radius: 9999px; border: 1px solid #cbd5e1; background: rgba(255,255,255,.95); color: #475569; font-size: 11px; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 3px rgba(15,23,42,.18); opacity: 0; transform: scale(.85); transition: opacity .15s ease, transform .15s ease, background .15s, color .15s; }
                    .ai-preview-foto:hover .ai-preview-x, .ai-preview-x:focus-visible { opacity: 1; transform: scale(1); }
                    .ai-preview-x:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
                    @media (hover: none) { .ai-preview-x { opacity: 1; transform: none; } }
                `;
                document.head.appendChild(style);
            }
        })();

        /* ================= AI SUPPORT - UX HP =================
           1) Laci riwayat PENUH LAYAR di HP (seperti Gemini): tombol tutup (X),
              baris "Percakapan baru", dan kolom "Cari percakapan".
           2) Saat mengetik di HP, kolom ketik NAIK tepat di atas keyboard (pakai
              visualViewport; Chrome/Android modern tidak mengecilkan layout saat
              keyboard muncul sehingga kolom ketik tertutup). Hanya aktif di layar
              < 900px; di laptop/desktop tidak mengubah apa pun. */
        (function pasangUxHpAISupport() {
            const adaHp = () => window.matchMedia('(max-width: 899px)').matches;

            if (!document.getElementById('gaya-ai-hp')) {
                const st = document.createElement('style');
                st.id = 'gaya-ai-hp';
                st.textContent = `
                    .ai-rw-hp-kepala, .ai-rw-baru-hp, .ai-rw-cari { display: none; }
                    @media (max-width: 899px) {
                        #ai-riwayat-panel { width: 100% !important; max-width: 100% !important; }
                        #ai-riwayat-panel.terbuka { z-index: 2000 !important; }
                        #ai-riwayat-latar.terbuka { z-index: 1999 !important; }
                        .ai-rw-hp-kepala { display: flex; align-items: center; justify-content: flex-end; padding: 10px 12px 2px; }
                        .ai-rw-hp-tutup { width: 40px; height: 40px; border: 0; border-radius: 9999px; background: transparent; color: #0f172a; font-size: 18px; cursor: pointer; }
                        .ai-rw-hp-tutup:active { background: #f1f5f9; }
                        .ai-rw-baru-hp { display: flex; align-items: center; gap: 12px; width: calc(100% - 24px); margin: 2px 12px 8px; padding: 12px 16px; border: 0; border-radius: 9999px; background: #f1f5f9; color: #0f172a; font-weight: 600; font-size: 15px; cursor: pointer; text-align: left; }
                        .ai-rw-cari { display: flex; align-items: center; gap: 10px; margin: 0 12px 8px; padding: 0 14px; height: 42px; border-radius: 9999px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; }
                        .ai-rw-cari input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 16px; color: #0f172a; }
                        .ai-form-di-atas-keyboard { position: fixed !important; left: 0; right: 0; z-index: 1500; background: #fff; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important; box-shadow: 0 -2px 10px rgba(15,23,42,.08); }
                    }
                `;
                document.head.appendChild(st);
            }

            // ---- laci riwayat: X, Percakapan baru, Cari ----
            const panel = document.getElementById('ai-riwayat-panel');
            if (panel && !document.getElementById('ai-rw-cari-input')) {
                const kepala = document.createElement('div');
                kepala.className = 'ai-rw-hp-kepala';
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'ai-rw-hp-tutup';
                x.setAttribute('aria-label', 'Tutup riwayat');
                x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                x.addEventListener('click', () => aiSupportToggleRiwayat(false));
                kepala.appendChild(x);

                const baru = document.createElement('button');
                baru.type = 'button';
                baru.className = 'ai-rw-baru-hp';
                baru.innerHTML = '<i class="fa-regular fa-pen-to-square"></i><span>Percakapan baru</span>';
                baru.addEventListener('click', () => { aiSupportMulaiBaru(); aiSupportToggleRiwayat(false); });

                const cari = document.createElement('div');
                cari.className = 'ai-rw-cari';
                cari.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
                const kolom = document.createElement('input');
                kolom.type = 'search';
                kolom.id = 'ai-rw-cari-input';
                kolom.placeholder = 'Cari percakapan';
                kolom.autocomplete = 'off';
                kolom.setAttribute('aria-label', 'Cari percakapan');
                kolom.addEventListener('input', () => {
                    kataCariRiwayatAISupport = kolom.value;
                    aiSupportRenderDaftar();
                });
                cari.appendChild(kolom);

                panel.insertBefore(cari, panel.firstChild);
                panel.insertBefore(baru, panel.firstChild);
                panel.insertBefore(kepala, panel.firstChild);
            }

            // ---- kolom ketik di atas keyboard ----
            const input = document.getElementById('input-ai-support');
            const form = input && input.closest('form');
            const vv = window.visualViewport;
            if (!input || !form || !vv) return;
            const log = document.getElementById('ai-support-chat-log');
            let aktif = false;
            let paddingAsli = '';

            function terapkan() {
                const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
                const perlu = adaHp() && document.activeElement === input && kb > 80;
                if (perlu) {
                    const baruAktif = !aktif;
                    if (baruAktif) {
                        aktif = true;
                        paddingAsli = log ? log.style.paddingBottom : '';
                        form.classList.add('ai-form-di-atas-keyboard');
                    }
                    form.style.bottom = kb + 'px';
                    if (log) log.style.paddingBottom = form.offsetHeight + 'px'; // jangan tertutup kolom ketik
                    if (baruAktif && log) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
                } else if (aktif) {
                    aktif = false;
                    form.classList.remove('ai-form-di-atas-keyboard');
                    form.style.bottom = '';
                    if (log) log.style.paddingBottom = paddingAsli;
                }
            }

            vv.addEventListener('resize', terapkan);
            vv.addEventListener('scroll', terapkan);
            window.addEventListener('orientationchange', () => setTimeout(terapkan, 300));
            input.addEventListener('focus', () => { setTimeout(terapkan, 150); setTimeout(terapkan, 450); });
            input.addEventListener('blur', () => setTimeout(terapkan, 120));
        })();

        /* ================= AI SUPPORT - DIKTE (SUARA -> TEKS) =================
           Pakai Web Speech API bawaan browser (Chrome/Edge/Safari), bahasa
           Indonesia. Klik mic -> mulai merekam, klik lagi -> berhenti. Hasil
           ucapan dimasukkan ke kolom ketik (TIDAK otomatis terkirim), jadi
           siswa masih bisa cek/edit dulu sebelum menekan tombol kirim.
           Butuh HTTPS (atau localhost) dan izin mikrofon dari browser. */
        (function pasangDikteAISupport() {
            const tombol = document.getElementById('ai-support-tombol-dikte');
            const input = document.getElementById('input-ai-support');
            if (!tombol || !input) return;

            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                tombol.addEventListener('click', () => alert('Browser ini belum mendukung dikte. Coba pakai Chrome, Edge, atau Safari.'));
                return;
            }

            const placeholderAsli = input.placeholder;
            let recognizer = null;
            let merekam = false;
            let teksAwal = '';
            let adaHasil = false;
            let audioMulai = false;     // mikrofon berhasil dibuka
            let suaraTerdeteksi = false; // ada suara masuk dari mikrofon
            let errorTerakhir = '';
            let timerPesan = null;

            // Pesan status singkat di placeholder kolom ketik (dan console) --
            // supaya kalau dikte gagal, siswa/dev tahu KENAPA (dulu error-nya ketelen diam-diam).
            function tampilPesan(teks, ms) {
                clearTimeout(timerPesan);
                input.placeholder = teks;
                if (ms) timerPesan = setTimeout(() => { input.placeholder = placeholderAsli; }, ms);
            }

            function setMerekam(status) {
                merekam = status;
                tombol.classList.toggle('merekam', status);
                tombol.title = status ? 'Berhenti dikte' : 'Dikte (bicara untuk mengetik)';
                const ikon = tombol.querySelector('i');
                if (ikon) ikon.className = status ? 'fa-solid fa-stop' : 'fa-solid fa-microphone';
            }

            const PESAN_ERROR = {
                'not-allowed': 'Izin mikrofon ditolak. Klik ikon gembok di address bar > izinkan Mikrofon.',
                'service-not-allowed': 'Dikte diblokir browser. Buka lewat HTTPS atau localhost.',
                'no-speech': 'Suara tidak terdeteksi. Coba bicara lebih dekat ke mikrofon.',
                'audio-capture': 'Mikrofon tidak ditemukan / sedang dipakai aplikasi lain.',
                'network': 'Dikte butuh internet (layanan suara browser tidak bisa dihubungi).',
                'language-not-supported': 'Bahasa Indonesia belum didukung di browser ini.'
            };

            function mulai() {
                if (input.disabled) return;
                adaHasil = false;
                audioMulai = false;
                suaraTerdeteksi = false;
                errorTerakhir = '';
                recognizer = new SR();
                recognizer.lang = 'id-ID';
                recognizer.interimResults = true;
                recognizer.continuous = false; // lebih stabil di Chrome/Edge/Android; klik mic lagi untuk lanjut

                teksAwal = input.value ? input.value.replace(/\s+$/, '') + ' ' : '';

                recognizer.onstart = () => { tampilPesan('Mendengarkan... silakan bicara', 0); };
                recognizer.onaudiostart = () => { audioMulai = true; console.log('Dikte: mikrofon terbuka'); };
                recognizer.onsoundstart = () => { suaraTerdeteksi = true; console.log('Dikte: ada suara masuk'); };
                recognizer.onspeechstart = () => { console.log('Dikte: ucapan terdeteksi'); };
                recognizer.onresult = (e) => {
                    let hasil = '';
                    for (let i = 0; i < e.results.length; i++) hasil += e.results[i][0].transcript;
                    if (hasil) adaHasil = true;
                    input.value = teksAwal + hasil;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                recognizer.onerror = (e) => {
                    errorTerakhir = e.error || 'unknown';
                    console.warn('Dikte error:', errorTerakhir, e.message || '');
                    if (errorTerakhir === 'aborted') return;
                    tampilPesan(PESAN_ERROR[errorTerakhir] || ('Dikte gagal: ' + errorTerakhir), 6000);
                };
                recognizer.onend = () => {
                    setMerekam(false);
                    recognizer = null;
                    // Tidak ada hasil & tidak ada error -> biasanya suara terlalu pelan / browser tidak dukung penuh.
                    if (!adaHasil && !errorTerakhir) {
                        if (!audioMulai) tampilPesan('Mikrofon tidak bisa dibuka oleh browser ini. Coba Chrome/Edge (bukan Brave).', 7000);
                        else if (!suaraTerdeteksi) tampilPesan('Mikrofon aktif tapi tidak ada suara masuk. Cek perangkat INPUT mikrofon di pengaturan suara.', 7000);
                        else tampilPesan('Suara terdengar tapi gagal jadi teks. Coba Chrome/Edge & pastikan internet aktif.', 7000);
                    }
                    else if (!errorTerakhir) tampilPesan(placeholderAsli, 0);
                    input.focus();
                };

                try { recognizer.start(); setMerekam(true); }
                catch (err) { console.warn('Dikte gagal dimulai:', err); setMerekam(false); tampilPesan('Dikte gagal dimulai: ' + err.message, 5000); }
            }

            function berhenti() { if (recognizer) recognizer.stop(); }

            tombol.addEventListener('click', () => { merekam ? berhenti() : mulai(); });

            // Kalau pesan dikirim (tombol kirim/Enter), hentikan dikte dulu.
            const form = input.closest('form');
            if (form) form.addEventListener('submit', berhenti, true);
        })();

        // SHORTCUT CTRL+U -- langsung buka pemilih foto di AI Support (sama dengan
        // klik ikon klip). Cuma aktif kalau form AI Support sedang tampil; di tab
        // lain Ctrl+U tetap 'view source' bawaan browser. Capture phase supaya
        // dijalankan sebelum handler lain, preventDefault mencegah view-source.
        (function pasangShortcutFotoAISupport() {
            const tombol = document.getElementById('ai-support-tombol-lampir');
            if (tombol && tombol.title.indexOf('Ctrl+U') === -1) tombol.title = 'Lampirkan gambar (Ctrl+U) atau tempel screenshot (Ctrl+V)';
            document.addEventListener('keydown', function (e) {
                if ((e.key || '').toLowerCase() !== 'u') return;
                if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
                const inputFile = document.getElementById('ai-support-input-gambar');
                const inputTeks = document.getElementById('input-ai-support');
                if (!inputFile || !inputTeks) return;
                if (inputTeks.getClientRects().length === 0) return; // tab AI Support tidak sedang terbuka
                if (inputFile.disabled) return;
                e.preventDefault();
                e.stopPropagation();
                inputFile.click();
            }, true);
        })();

        // SHORTCUT CTRL+V -- tempel gambar dari clipboard (mis. hasil screenshot
        // Win+Shift+S / PrtSc) langsung jadi lampiran AI Support, tanpa simpan file
        // dulu. Gambarnya diserahkan ke alur yang SAMA dengan pilih file
        // (pilihGambarAISupport: kompres + preview), jadi perilakunya identik.
        // Aturan aman:
        //  - hanya aktif kalau kolom AI Support sedang tampil;
        //  - tidak mengganggu paste di kolom teks lain (modal/form lain);
        //  - kalau clipboard juga berisi TEKS (mis. salin dari Excel/Word), paste
        //    dibiarkan normal supaya teks tetap bisa ditempel.
        (function pasangPasteGambarAISupport() {
            document.addEventListener('paste', function (e) {
                const inputFile = document.getElementById('ai-support-input-gambar');
                const inputTeks = document.getElementById('input-ai-support');
                if (!inputFile || !inputTeks || inputFile.disabled) return;
                if (inputTeks.getClientRects().length === 0) return; // tab AI Support tidak sedang terbuka

                // Jangan ganggu kolom ketik lain (selain kolom chat AI Support itu sendiri).
                const sasaran = e.target;
                const bisaDiketik = sasaran && (sasaran.isContentEditable ||
                    /^(INPUT|TEXTAREA|SELECT)$/.test(sasaran.tagName));
                if (bisaDiketik && sasaran !== inputTeks) return;

                const cb = e.clipboardData;
                if (!cb || !cb.items) return;
                if ((cb.getData('text/plain') || '').trim() !== '') return; // ada teks -> paste normal

                let fileGambar = null;
                for (let i = 0; i < cb.items.length; i++) {
                    const it = cb.items[i];
                    if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
                        fileGambar = it.getAsFile();
                        break;
                    }
                }
                if (!fileGambar) return;

                e.preventDefault();
                try {
                    const dt = new DataTransfer();
                    dt.items.add(fileGambar);
                    inputFile.files = dt.files;
                    inputFile.dispatchEvent(new Event('change', { bubbles: true }));
                    inputTeks.focus();
                } catch (err) {
                    console.warn('Tempel gambar ke AI Support gagal:', err);
                }
            });
        })();

        function updateTaskCounter(tasksInput) {
            // PERFORMANCE OPTIMIZATION: tasks yang sudah diambil di sini
            // diteruskan ke renderStreakTugas()/hitungStreakTugas() supaya
            // tidak panggil getTasksSiswa() lagi (dulu dipanggil 2x dalam satu
            // tick lewat updateTaskCounter -> renderStreakTugas ->
            // hitungStreakTugas). Parameter opsional -- kalau dipanggil tanpa
            // argumen (semua pemanggil lama di file ini), tetap ambil sendiri
            // lewat getTasksSiswa() seperti sebelumnya, jadi tidak ada
            // pemanggil lama yang perlu diubah.
            const tasks = tasksInput || getTasksSiswa();
            const elPending = document.getElementById('count-pending-tasks');
            const elCompleted = document.getElementById('count-completed-tasks');

            const completed = tasks.filter(t => t.studentSubmitted || t.sudahMengumpulkan || t.grade !== null).length;
            const pending = tasks.length - completed;

            if (elPending) elPending.innerText = String(pending);
            if (elCompleted) elCompleted.innerText = String(completed);

            // Salinan angka yang sama di halaman "Profil" (HP) -- elemen ini
            // opsional (halaman lain tidak punya id ini), makanya dicek dulu.
            const elPendingProfil = document.getElementById('profil-count-pending-tasks');
            const elCompletedProfil = document.getElementById('profil-count-completed-tasks');
            if (elPendingProfil) elPendingProfil.innerText = String(pending);
            if (elCompletedProfil) elCompletedProfil.innerText = String(completed);

            renderStreakTugas(tasks);
        }

        /* ================= STREAK TUGAS (menggantikan "Kehadiran Bulan Ini") =================
           Streak = jumlah tugas BERUNTUN yang berhasil dikumpulkan siswa, dihitung
           mundur dari tugas paling baru. Tugas yang deadline-nya sudah lewat TAPI
           belum dikumpulkan (bolong) memutus streak di titik itu. Tugas yang belum
           jatuh tempo (masih berjalan) dilewati saja -- tidak menambah atau memutus,
           karena belum bisa dinilai berhasil/gagalnya. */
        function hitungStreakTugas(tasksInput) {
            // PERFORMANCE OPTIMIZATION: terima tasks dari pemanggil (lihat
            // renderStreakTugas()) kalau ada, supaya tidak panggil
            // getTasksSiswa() ulang. Parameter opsional -- fallback ambil
            // sendiri kalau dipanggil tanpa argumen, sama seperti sebelumnya.
            const tasks = tasksInput || getTasksSiswa();
            const now = getAccurateNow();

            const daftar = tasks.map(t => {
                const batasWaktu = t.deadline || t.deadlineDate || '';
                return {
                    selesai: !!(t.studentSubmitted || t.sudahMengumpulkan),
                    kedaluwarsa: cekTugasSudahKedaluwarsa(batasWaktu, now),
                    waktu: parseDeadlineTugas(batasWaktu)
                };
            });

            // Urutkan dari tugas paling lama ke paling baru (berdasar deadline).
            // Tugas tanpa deadline yang valid ditaruh paling akhir (dianggap paling baru).
            daftar.sort((a, b) => {
                if (!a.waktu && !b.waktu) return 0;
                if (!a.waktu) return 1;
                if (!b.waktu) return -1;
                return a.waktu - b.waktu;
            });

            let streak = 0;
            for (let i = daftar.length - 1; i >= 0; i--) {
                const t = daftar[i];
                if (t.selesai) { streak++; continue; }
                if (t.kedaluwarsa) break; // tugas bolong -> streak putus persis di sini
                // belum jatuh tempo -> lewati, cek tugas sebelumnya
            }
            return streak;
        }

        // Tier menentukan warna kartu & seberapa "membara" karakter apinya.
        // Ambang batasnya sengaja dibuat rendah supaya progresnya cepat terasa.
        function getStreakTierInfo(streak) {
            if (streak <= 0) return { tier: 0, label: 'Belum Ada', sub: 'Yuk kumpulkan tugas pertamamu!' };
            if (streak <= 2) return { tier: 1, label: 'Beruntun', sub: 'Baru mulai, terus jaga ya!' };
            if (streak <= 5) return { tier: 2, label: 'Beruntun', sub: 'Makin panas nih, lanjutkan!' };
            if (streak <= 9) return { tier: 3, label: 'Beruntun', sub: 'Membara! Jangan sampai putus.' };
            return { tier: 4, label: 'Beruntun', sub: 'Legend! Streak-mu sedang membara-bara 🔥' };
        }

        function renderStreakTugas(tasksInput) {
            const kartu = document.getElementById('kartu-streak-tugas');
            const elJumlah = document.getElementById('streak-jumlah');
            const elLabelBawah = document.getElementById('streak-label-bawah');
            if (!kartu || !elJumlah || !elLabelBawah) return;

            // PERFORMANCE OPTIMIZATION: teruskan tasks yang sudah diambil
            // updateTaskCounter() (kalau ada) ke hitungStreakTugas(), supaya
            // getTasksSiswa() tidak dipanggil ulang untuk data yang sama.
            const streak = hitungStreakTugas(tasksInput);
            const info = getStreakTierInfo(streak);

            for (let i = 0; i <= 4; i++) kartu.classList.remove(`streak-tier-${i}`);
            kartu.classList.add(`streak-tier-${info.tier}`);
            kartu.title = info.sub;

            elJumlah.innerText = String(streak);
            elLabelBawah.innerText = info.label;

            // CATATAN: kartu "Streak (Hari)" di tab Profil (profil-kartu-streak)
            // DULU ikut disamakan dengan streak tugas di sini. Sekarang dipisah
            // -- kartu itu representasi STREAK LOGIN HARIAN (lihat
            // renderStreakLoginHarian() di bawah), bukan streak tugas, jadi
            // TIDAK lagi disentuh dari sini supaya dua streak yang beda konsep
            // tidak saling menimpa angkanya.
        }

        /* ================= STREAK LOGIN HARIAN (kartu "Streak (Hari)" di tab Profil) =================
           Beda dari streak tugas di atas: ini menghitung berapa HARI KALENDER
           BERTURUT-TURUT siswa membuka/masuk akunnya -- bukan soal tugas sama
           sekali. Naik otomatis sekali tiap kali siswa pertama kali membuka
           dashboard di hari kalender yang baru, dan RESET total ke 1 kalau ada
           satu hari saja yang kelewat tanpa dibuka. Datanya disimpan per akun
           (namespace ID_SISWA_AKTIF, sama seperti data pribadi siswa lainnya)
           supaya tidak ketuker kalau ada beberapa akun dipakai gantian di
           browser yang sama. */
        const KEY_STREAK_LOGIN_HARIAN = `streak_login_harian_${ID_SISWA_AKTIF}`;

        // Format tanggal ke "YYYY-MM-DD" (dibulatkan ke hari kalender, bukan
        // jam/menit) -- dipakai supaya perbandingan "sudah ganti hari belum"
        // tidak kepengaruh jam berapa siswa buka dashboardnya.
        function formatTanggalYMD(tanggal) {
            const y = tanggal.getFullYear();
            const m = String(tanggal.getMonth() + 1).padStart(2, '0');
            const d = String(tanggal.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        // Dipanggil SEKALI tiap dashboard dibuka. Membaca catatan login
        // terakhir, lalu:
        // - kalau hari ini SAMA dgn tanggal login terakhir -> tidak ngapa2in
        //   (dashboard dibuka berkali-kali di hari yang sama tidak dobel nambah)
        // - kalau hari ini PERSIS 1 hari setelah login terakhir -> streak +1
        //   (siswa login berturut-turut tanpa putus)
        // - selain itu (lompat lebih dari 1 hari, atau jam perangkat mundur)
        //   -> streak di-reset ke 1, dianggap "lupa login" minimal sehari.
        function perbaruiStreakLoginHarian() {
            const hariIni = formatTanggalYMD(getAccurateNow());
            let data = null;
            try {
                data = JSON.parse(localStorage.getItem(KEY_STREAK_LOGIN_HARIAN) || 'null');
            } catch (e) {
                data = null;
            }

            if (!data || !data.tanggalTerakhir || !data.jumlah) {
                data = { jumlah: 1, tanggalTerakhir: hariIni };
            } else if (data.tanggalTerakhir === hariIni) {
                // sudah kehitung hari ini, biarkan apa adanya
            } else {
                const tglTerakhir = new Date(data.tanggalTerakhir + 'T00:00:00');
                const tglSekarang = new Date(hariIni + 'T00:00:00');
                const selisihHari = Math.round((tglSekarang - tglTerakhir) / 86400000);
                data.jumlah = (selisihHari === 1) ? (data.jumlah + 1) : 1;
                data.tanggalTerakhir = hariIni;
            }

            localStorage.setItem(KEY_STREAK_LOGIN_HARIAN, JSON.stringify(data));
            return data.jumlah;
        }

        // Tier warna api streak login: sengaja BEDA dari streak tugas (yang
        // tetap satu keluarga warna ambar/oranye) -- di sini warnanya beneran
        // "berjalan" makin lama makin dijaga: kuning -> merah -> biru -> ungu.
        function getTierStreakLoginHarian(jumlahHari) {
            if (jumlahHari <= 0) return { tier: 0, sub: 'Buka & login tiap hari biar streak-mu mulai jalan!' };
            if (jumlahHari <= 19) return { tier: 1, sub: '🟡 Kuning — baru mulai, terus login tiap hari ya!' };
            if (jumlahHari <= 39) return { tier: 2, sub: '🔴 Merah — makin panas, jangan sampai lupa login!' };
            if (jumlahHari <= 59) return { tier: 3, sub: '🔵 Biru — keren, konsistensimu makin terjaga!' };
            return { tier: 4, sub: '🟣 Ungu — legend! Streak login-mu luar biasa panjang 🔥' };
        }

        function renderStreakLoginHarian() {
            const kartu = document.getElementById('profil-kartu-streak');
            const elJumlah = document.getElementById('profil-streak-jumlah');
            if (!kartu || !elJumlah) return;

            const jumlahHari = perbaruiStreakLoginHarian();
            const info = getTierStreakLoginHarian(jumlahHari);

            // Bersihkan sisa class streak-tier-* lama (peninggalan sebelum
            // dipisah dari streak tugas) supaya tidak numpuk/bentrok dgn
            // login-streak-tier-* yang baru.
            for (let i = 0; i <= 4; i++) kartu.classList.remove(`streak-tier-${i}`, `login-streak-tier-${i}`);
            kartu.classList.add(`login-streak-tier-${info.tier}`);
            kartu.title = info.sub;

            elJumlah.innerText = String(jumlahHari);
        }

        // Grid "Lencana & Pencapaian" di halaman Profil (HP) -- menampilkan
        // border/lencana yang SUDAH dimiliki siswa (pakai sistem border yang
        // sama dengan menu Koleksi Border), bukan data terpisah baru.
        //
        // SEMENTARA: dulu badge di sini ditampilkan pakai file gambar border
        // asli (border.file, mis. border_admin.jpg) -- tapi file-file itu
        // belum/tidak ke-load dengan benar di banyak perangkat, jadi badge-nya
        // tampil sebagai kotak hitam polos. Untuk sementara diganti ikon
        // bulat berwarna (gaya sama seperti referensi desain: lingkaran
        // pastel + ikon + sub-label kecil), supaya badge-nya tetap kebaca
        // rapi selagi aset gambar border yang sebenarnya belum diperbaiki.
        // Sistem border/koleksi border di tab lain TIDAK diubah -- ini
        // hanya khusus tampilan grid lencana di tab Profil HP ini.
        function ikonLencanaProfilSementara(border) {
            const PETA_IKON = {
                starter: { icon: 'fa-seedling', bg: 'bg-slate-100', warna: 'text-slate-500' },
                admin: { icon: 'fa-crown', bg: 'bg-amber-50', warna: 'text-amber-500' },
                quiz: {
                    1: { icon: 'fa-book-open', bg: 'bg-sky-50', warna: 'text-sky-500' },
                    2: { icon: 'fa-brain', bg: 'bg-purple-50', warna: 'text-purple-500' },
                    3: { icon: 'fa-crown', bg: 'bg-amber-50', warna: 'text-amber-500' }
                },
                prestasi: {
                    1: { icon: 'fa-medal', bg: 'bg-orange-50', warna: 'text-orange-500' },
                    2: { icon: 'fa-medal', bg: 'bg-slate-100', warna: 'text-slate-500' },
                    3: { icon: 'fa-trophy', bg: 'bg-amber-50', warna: 'text-amber-500' },
                    4: { icon: 'fa-crown', bg: 'bg-pink-50', warna: 'text-pink-500' }
                },
                khusus: { icon: 'fa-gem', bg: 'bg-violet-50', warna: 'text-violet-500' }
            };
            const fallback = { icon: 'fa-award', bg: 'bg-slate-100', warna: 'text-slate-500' };
            if (border.kategori === 'quiz' || border.kategori === 'prestasi') {
                return PETA_IKON[border.kategori][border.tierRank] || fallback;
            }
            return PETA_IKON[border.kategori] || fallback;
        }

        function renderLencanaProfilTab() {
            const grid = document.getElementById('profil-grid-lencana');
            const kosong = document.getElementById('profil-lencana-kosong');
            const badgeJumlah = document.getElementById('profil-lencana-jumlah');
            if (!grid) return;

            const semua = getSemuaBorder();
            const dimiliki = semua.filter(isBorderTerbuka);

            if (badgeJumlah) badgeJumlah.innerText = `${dimiliki.length}/${semua.length}`;
            grid.classList.toggle('hidden', dimiliki.length === 0);
            if (kosong) kosong.classList.toggle('hidden', dimiliki.length > 0);

            grid.innerHTML = dimiliki.map(border => {
                // Badge Admin sudah punya aset gambar asli (achivement_admin.jpg),
                // jadi khusus kategori ini pakai gambar itu -- bukan lagi ikon
                // sementara. Kategori lain (starter/quiz/prestasi) masih pakai
                // ikon sementara sampai aset gambarnya masing-masing tersedia.
                if (border.kategori === 'admin') {
                    return `
                    <div class="flex flex-col items-center text-center gap-1" title="${border.nama} — ${border.rank}">
                        <div class="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-amber-50 flex items-center justify-center text-base text-amber-500">
                            <img src="../static/img/achivement_admin.jpg" class="w-full h-full object-cover" alt="Lencana ${border.nama}" onerror="this.replaceWith(Object.assign(document.createElement('i'), {className: 'fa-solid fa-crown'}))">
                        </div>
                        <p class="text-[9px] font-bold text-slate-700 leading-tight truncate w-full">${border.nama}</p>
                        <p class="text-[8px] text-slate-400 leading-tight truncate w-full">${border.rank}</p>
                    </div>
                `;
                }
                // Badge "Kristal Imortal" (khusus akun IMO) sekarang juga punya
                // aset gambar logo asli (achivement_imortal.png, logo naga emas
                // IMO) -- sama seperti Admin di atas, jadi tidak lagi pakai ikon
                // permata generik (fa-gem) begitu border ini dimiliki siswa.
                if (border.id === 'border_imortal') {
                    return `
                    <div class="flex flex-col items-center text-center gap-1" title="${border.nama} — ${border.rank}">
                        <div class="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-violet-50 flex items-center justify-center text-base text-violet-500">
                            <img src="../static/img/achivement_imortal.png" class="w-full h-full object-cover" alt="Lencana ${border.nama}" onerror="this.replaceWith(Object.assign(document.createElement('i'), {className: 'fa-solid fa-gem'}))">
                        </div>
                        <p class="text-[9px] font-bold text-slate-700 leading-tight truncate w-full">${border.nama}</p>
                        <p class="text-[8px] text-slate-400 leading-tight truncate w-full">${border.rank}</p>
                    </div>
                `;
                }
                const gaya = ikonLencanaProfilSementara(border);
                return `
                <div class="flex flex-col items-center text-center gap-1" title="${border.nama} — ${border.rank}">
                    <div class="w-12 h-12 rounded-full ${gaya.bg} ${gaya.warna} flex items-center justify-center text-base flex-shrink-0" aria-hidden="true">
                        <i class="fa-solid ${gaya.icon}"></i>
                    </div>
                    <p class="text-[9px] font-bold text-slate-700 leading-tight truncate w-full">${border.nama}</p>
                    <p class="text-[8px] text-slate-400 leading-tight truncate w-full">${border.rank}</p>
                </div>
            `;
            }).join('');
        }

        // Cek apakah sebuah deadline tugas sudah lewat, dipakai renderTugasTerdekat
        // supaya konsisten dengan logika kedaluwarsa di kartu tugas (tab Tugas & Catatan).
        function cekTugasSudahKedaluwarsa(batasWaktu, now) {
            if (!batasWaktu) return false;
            let cleanDeadline = batasWaktu.trim();
            if (cleanDeadline.includes("Pukul")) {
                let parts = cleanDeadline.split("Pukul");
                let datePart = parts[0].trim();
                let timePart = parts[1].replace("WIB", "").trim();
                let targetDateTime = new Date(`${datePart}T${timePart}:00`);
                return !isNaN(targetDateTime.getTime()) && now.getTime() > targetDateTime.getTime();
            } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(":")) {
                const currentHours = String(now.getHours()).padStart(2, '0');
                const currentMinutes = String(now.getMinutes()).padStart(2, '0');
                const currentSeconds = String(now.getSeconds()).padStart(2, '0');
                return `${currentHours}:${currentMinutes}:${currentSeconds}` >= `${cleanDeadline}:00`;
            } else {
                const deadlineTime = new Date(cleanDeadline).getTime();
                return !isNaN(deadlineTime) && now.getTime() > deadlineTime;
            }
        }

        // Hitung deadline tugas jadi timestamp (ms), dipakai renderTugasTerdekat()
        // buat nyortir kartu "Tugas Terdekat" di beranda supaya yang PALING
        // MENDESAK (deadline paling dekat) yang tampil duluan -- bukan cuma
        // "yang paling baru dikirim guru" seperti sebelumnya. Format string
        // deadline-nya macam-macam (lihat komentar cekTugasSudahKedaluwarsa di
        // atas), jadi logika parsing-nya sengaja disamakan biar konsisten.
        // Tugas tanpa deadline valid dianggap PALING TIDAK mendesak (Infinity)
        // supaya tidak nyerobot ke depan tugas yang beneran punya batas waktu.
        function getDeadlineTimestampTugas(batasWaktu, now) {
            if (!batasWaktu) return Infinity;
            let cleanDeadline = batasWaktu.trim();
            if (cleanDeadline.includes("Pukul")) {
                let parts = cleanDeadline.split("Pukul");
                let datePart = parts[0].trim();
                let timePart = parts[1].replace("WIB", "").trim();
                let targetDateTime = new Date(`${datePart}T${timePart}:00`);
                return isNaN(targetDateTime.getTime()) ? Infinity : targetDateTime.getTime();
            } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(":")) {
                const [jam, menit] = cleanDeadline.split(':').map(Number);
                const targetDateTime = new Date(now);
                targetDateTime.setHours(jam, menit, 0, 0);
                return targetDateTime.getTime();
            } else {
                const deadlineTime = new Date(cleanDeadline).getTime();
                return isNaN(deadlineTime) ? Infinity : deadlineTime;
            }
        }

        // FITUR TAMBAHAN: "Batas Waktu Revisi" otomatis kedaluwarsa.
        // Sebelumnya, kalau guru memberi status "Perlu Revisi" + batas waktu
        // (batas_revisi), begitu batas waktu itu LEWAT tanpa siswa kirim
        // ulang, tugas tetap nyangkut selamanya di status "Perlu Revisi" --
        // formulir kirim ulang tetap terbuka & tidak ada yang menandainya
        // sebagai "Tidak Dikerjakan". Fungsi ini dipakai di semua tempat
        // yang perlu tahu apakah jendela revisi sudah lewat, dihitung LIVE
        // dari jam sekarang (sama seperti isExpired utk deadline tugas biasa
        // di renderKartuTugas/kirimTugasSiswa) -- jadi begitu waktunya lewat,
        // status otomatis berubah sendiri pada render/polling berikutnya
        // (maks. 8 detik, lihat interval polling di atas), TANPA perlu
        // refresh halaman ataupun restart server sama sekali. Dua hasil:
        //   1) Siswa sempat kirim ulang SEBELUM batas revisi lewat -> field
        //      keputusanGuru sudah otomatis di-reset jadi null oleh server
        //      begitu submit (lihat api_tugas_submit() di app.py), jadi
        //      fungsi ini otomatis mengembalikan false & tugas dihitung
        //      normal sudah "Terkumpul"/beres.
        //   2) Batas revisi lewat TANPA siswa kirim ulang -> fungsi ini
        //      mengembalikan true, dipakai pemanggil untuk mengunci form &
        //      menghitung tugas sebagai "Tidak Dikerjakan" (belum
        //      mengerjakan), sama seperti tugas biasa yang kedaluwarsa.
        function revisiSudahKedaluwarsa(data, now) {
            if (!data || data.keputusanGuru !== 'revisi') return false;
            const batasRevisiMs = Number(data.batasRevisiGuru);
            if (!batasRevisiMs || isNaN(batasRevisiMs)) return false;
            return (now || getAccurateNow()).getTime() > batasRevisiMs;
        }

        // ================= KATEGORI STATUS TUGAS (Tabs / Segmented Control) =================
        // Satu tugas dikelompokkan ke salah satu dari 3 kategori supaya siswa nggak perlu
        // menyisir satu daftar panjang buat nemuin tugas yang beneran butuh aksi hari ini:
        //   - 'belum'   : belum dikumpulkan, belum ada draft foto yang diunggah, & belum lewat deadline.
        //   - 'draft'   : belum dikumpulkan TAPI sudah ada foto yang dipilih/diunggah di form
        //                 (belum ditekan tombol "Kirim Tugas Sekarang").
        //   - 'selesai' : sudah dikumpulkan, ATAU sudah dinilai guru (field `grade` terisi --
        //                 field ini sama dengan yang dipakai updateTaskCounter() di atas),
        //                 ATAU sudah lewat deadline & terkunci. Ketiganya digabung jadi satu
        //                 kategori "Riwayat/Selesai" (diarsipkan) supaya tugas lama yang sudah
        //                 tuntas/kadaluwarsa tidak numpuk lagi di layar utama harian.
        function kategoriStatusTugas(data, now) {
            const sudahDikumpulkan = !!(data.studentSubmitted || data.sudahMengumpulkan);
            const sudahDinilaiGuru = data.grade !== null && data.grade !== undefined;
            const batasWaktu = data.deadline || data.deadlineDate || '';
            const sudahLewatDeadline = cekTugasSudahKedaluwarsa(batasWaktu, now);

            // FITUR "REVISI": kalau guru menandai pengumpulan TERAKHIR sebagai
            // "Perlu Revisi" (data.keputusanGuru === 'revisi'), tugas ini SENGAJA
            // TIDAK dianggap 'selesai' walau sudah pernah dikumpulkan/dinilai/
            // lewat deadline -- diarahkan balik ke 'draft' (tab "Sedang
            // Dikerjakan") supaya form upload foto muncul lagi & siswa bisa
            // kirim ulang. Begitu siswa kirim ulang, keputusanGuru otomatis
            // null lagi (di-reset server-side), jadi tugas balik normal ke
            // 'selesai' pada render berikutnya.
            //
            // PENGECUALIAN: kalau guru menentukan batas waktu revisi DAN
            // batas itu sudah lewat tanpa siswa kirim ulang, jangan lagi
            // dianggap 'draft' -- biarkan jatuh ke pengecekan di bawah
            // (sudahLewatDeadline dkk) supaya otomatis masuk 'selesai'
            // (diarsipkan sebagai "Tidak Dikerjakan"), lihat
            // revisiSudahKedaluwarsa() di atas.
            if (data.keputusanGuru === 'revisi' && !revisiSudahKedaluwarsa(data, now)) return 'draft';

            if (sudahDikumpulkan || sudahDinilaiGuru || sudahLewatDeadline) return 'selesai';

            const adaDraftFoto = window._fotoTugasSementara && Array.isArray(window._fotoTugasSementara[data.id]) && window._fotoTugasSementara[data.id].length > 0;
            if (adaDraftFoto) return 'draft';

            // FITUR: begitu siswa BENAR-BENAR sudah membuka/melihat detail tugas ini
            // (isViewedByStudent, ditandai oleh tandaiTugasDibukaJikaPerlu() pas kartu
            // tugas dirender), tugas langsung dianggap "Sedang Dikerjakan" walau belum
            // ada foto draft yang diunggah -- selaras dengan status yang juga berubah
            // di Dashboard Guru dari "Belum Dikerjakan" -> "Sedang Dikerjakan".
            const sudahDibukaSiswa = !!(data.isViewedByStudent ||
                (window._statusTugasSendiri && window._statusTugasSendiri[data.id] && window._statusTugasSendiri[data.id].dilihat));
            if (sudahDibukaSiswa) return 'draft';

            return 'belum';
        }

        // Ambil timestamp deadline (ms) khusus buat keperluan SORTING "deadline terdekat
        // duluan" -- sengaja dipisah dari cekTugasSudahKedaluwarsa() (yang cuma butuh
        // jawaban true/false) supaya logika kedaluwarsa yang sudah ada & sudah teruji
        // tidak perlu ikut disentuh/diubah sama sekali.
        function timestampDeadlineTugas(batasWaktu, now) {
            if (!batasWaktu) return Infinity;
            const cleanDeadline = batasWaktu.trim();
            if (cleanDeadline.includes("Pukul")) {
                const parts = cleanDeadline.split("Pukul");
                const datePart = parts[0].trim();
                const timePart = parts[1].replace("WIB", "").trim();
                const targetDateTime = new Date(`${datePart}T${timePart}:00`);
                return isNaN(targetDateTime.getTime()) ? Infinity : targetDateTime.getTime();
            } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(":")) {
                // Cuma format jam "HH:MM" (deadline hari ini) -- pakai tanggal hari ini.
                const [h, m] = cleanDeadline.split(':').map(Number);
                const target = new Date(now.getTime());
                target.setHours(h || 0, m || 0, 0, 0);
                return target.getTime();
            }
            const t = new Date(cleanDeadline).getTime();
            return isNaN(t) ? Infinity : t;
        }

        // Status tab aktif & status "sudah diperluas" (klik "Lihat Semua") per kategori --
        // disimpan di window supaya tidak reset tiap kali renderLiveTaskContent() dipanggil
        // ulang (mis. tiap ada tugas baru masuk / status berubah).
        window._subTabTugasAktif = window._subTabTugasAktif || 'belum';
        window._tugasPaginasiExpanded = window._tugasPaginasiExpanded || { belum: false, draft: false, selesai: false };
        const BATAS_TUGAS_PER_HALAMAN = 6; // Indikator Batasan Tampilan: 5-7 tugas terdekat

        function hitungKelompokTugas() {
            const tasks = getTasksSiswa();
            const now = getAccurateNow();
            const kelompok = { belum: [], draft: [], selesai: [] };
            tasks.forEach(data => kelompok[kategoriStatusTugas(data, now)].push(data));

            // Indikator Urutan Berdasarkan Prioritas (Sorting):
            // - 'belum' & 'draft': deadline TERDEKAT di posisi paling atas (ascending),
            //   jadi tugas yang harus dikerjakan hari ini selalu di atas tugas minggu depan.
            // - 'selesai': yang paling BARU diproses (dikirim/kedaluwarsa) di atas, supaya
            //   riwayat kebaca kronologis seperti biasa.
            const urutkanDeadlineTerdekat = (a, b) => timestampDeadlineTugas(a.deadline || a.deadlineDate || '', now) - timestampDeadlineTugas(b.deadline || b.deadlineDate || '', now);
            kelompok.belum.sort(urutkanDeadlineTerdekat);
            kelompok.draft.sort(urutkanDeadlineTerdekat);
            kelompok.selesai.sort((a, b) => (b.waktuKirimGuru || 0) - (a.waktuKirimGuru || 0));

            return kelompok;
        }

        function renderBadgeSubTabTugas(kelompok) {
            const petaBadge = { belum: 'badge-subtab-belum', draft: 'badge-subtab-draft', selesai: 'badge-subtab-selesai' };
            Object.entries(petaBadge).forEach(([kategori, id]) => {
                const el = document.getElementById(id);
                if (el) el.innerText = String(kelompok[kategori].length);
            });
        }

        // Dipanggil dari tambahFotoTugasSiswa()/hapusFotoTugasSementara() -- CUMA
        // memperbarui angka badge di segmented control (mis. badge "Sedang Dikerjakan"
        // naik begitu siswa mulai unggah foto). Kartu yang lagi aktif diisi siswa
        // SENGAJA tidak langsung dipindah/dirender ulang di sini, supaya form yang
        // sedang diisi (input file, preview foto) tidak tiba-tiba hilang dari layar
        // di tengah proses upload -- perpindahan tab baru kejadian pas ganti tab
        // atau setelah tugas benar-benar dikirim (lihat simpanDataTugasFinal()).
        function perbaruiBadgeTugasSaja() {
            const kelompok = hitungKelompokTugas();
            window._kelompokTugasTerkini = kelompok;
            renderBadgeSubTabTugas(kelompok);
        }

        function switchSubTabTugas(kategori) {
            window._subTabTugasAktif = kategori;
            renderSubTabTugasAktif();
        }

        function sembunyikanTombolLihatSemuaTugas() {
            const wrapBtn = document.getElementById('wrap-tombol-lihat-semua-tugas');
            if (wrapBtn) wrapBtn.classList.add('hidden');
        }

        function lihatSemuaTugasSubTab() {
            const kategori = window._subTabTugasAktif || 'belum';
            window._tugasPaginasiExpanded[kategori] = true;
            renderSubTabTugasAktif();
        }

        // ================= CARI TUGAS (sub-tab Riwayat/Selesai) =================
        // Kotak cari ini SENGAJA dibuat lewat JS (disisipkan tepat di atas
        // #container-live-tugas) supaya tidak perlu mengubah HTML, dan cuma
        // tampil di sub-tab "Riwayat/Selesai". Pencarian berdasarkan JUDUL tugas,
        // tidak peduli huruf besar/kecil & spasi berlebih; kalau diketik lebih dari
        // satu kata, SEMUA kata harus ada di judul (urutan bebas). Hasilnya dipakai
        // untuk dua daftar sekaligus: daftar tugas selesai (di sini) dan kartu
        // "Riwayat Pengumpulan" (lihat renderRiwayatPengumpulan() di file JS ke-2).
        window._kataCariTugasRiwayat = window._kataCariTugasRiwayat || '';

        function normalisasiKataCariTugas(teks) {
            return String(teks || '').toLowerCase().replace(/\s+/g, ' ').trim();
        }

        function cocokJudulTugas(judul, kataCariTernormalisasi) {
            if (!kataCariTernormalisasi) return true;
            const j = String(judul || '').toLowerCase();
            return kataCariTernormalisasi.split(' ').every(kata => j.includes(kata));
        }

        function escapeHtmlCariTugas(teks) {
            return String(teks).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        function terapkanPencarianRiwayatTugas() {
            renderSubTabTugasAktif();
            if (typeof renderRiwayatPengumpulan === 'function') renderRiwayatPengumpulan();
        }

        function bersihkanPencarianRiwayatTugas() {
            window._kataCariTugasRiwayat = '';
            terapkanPencarianRiwayatTugas();
        }

        function sinkronkanKotakCariRiwayatTugas(kategori, totalSemua, totalCocok) {
            const container = document.getElementById('container-live-tugas');
            if (!container || !container.parentNode) return;

            let wrap = document.getElementById('wrap-cari-tugas-riwayat');
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.id = 'wrap-cari-tugas-riwayat';
                wrap.className = 'hidden mb-3';
                wrap.innerHTML = `
                    <div class="relative">
                        <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"></i>
                        <input id="input-cari-tugas-riwayat" type="text" inputmode="search" enterkeyhint="search"
                            autocomplete="off" spellcheck="false" placeholder="Cari tugas berdasarkan judul..."
                            aria-label="Cari tugas berdasarkan judul"
                            class="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                        <button id="btn-hapus-cari-tugas-riwayat" type="button" aria-label="Hapus pencarian"
                            class="hidden absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 flex items-center justify-center">
                            <i class="fa-solid fa-xmark text-xs"></i>
                        </button>
                    </div>
                    <p id="info-hasil-cari-tugas" class="hidden mt-1.5 text-[11px] text-slate-400" aria-live="polite"></p>`;
                container.parentNode.insertBefore(wrap, container);

                const input = wrap.querySelector('#input-cari-tugas-riwayat');
                const btnHapus = wrap.querySelector('#btn-hapus-cari-tugas-riwayat');
                input.addEventListener('input', () => {
                    window._kataCariTugasRiwayat = input.value;
                    terapkanPencarianRiwayatTugas();
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape' && input.value) { e.preventDefault(); bersihkanPencarianRiwayatTugas(); }
                });
                btnHapus.addEventListener('click', () => {
                    bersihkanPencarianRiwayatTugas();
                    input.focus();
                });
            }

            const input = wrap.querySelector('#input-cari-tugas-riwayat');
            const btnHapus = wrap.querySelector('#btn-hapus-cari-tugas-riwayat');
            const info = wrap.querySelector('#info-hasil-cari-tugas');
            // Nilai input cuma ditimpa kalau memang beda (mis. dibersihkan lewat
            // kode), supaya kursor tidak loncat saat siswa sedang mengetik.
            if (input.value !== window._kataCariTugasRiwayat) input.value = window._kataCariTugasRiwayat;

            wrap.classList.toggle('hidden', !(kategori === 'selesai' && totalSemua > 0));
            const mencari = kategori === 'selesai' && normalisasiKataCariTugas(window._kataCariTugasRiwayat) !== '';
            btnHapus.classList.toggle('hidden', !mencari);
            info.classList.toggle('hidden', !mencari);
            if (mencari) info.textContent = `Ditemukan ${totalCocok} dari ${totalSemua} tugas`;
        }

        function renderSubTabTugasAktif() {
            const kategori = window._subTabTugasAktif || 'belum';
            const container = document.getElementById('container-live-tugas');
            if (!container) return;

            ['belum', 'draft', 'selesai'].forEach(k => {
                const btn = document.getElementById(`subtab-btn-${k}`);
                if (!btn) return;
                btn.className = 'subtab-btn-tugas flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-bold transition-all ' +
                    (k === kategori ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700');
            });

            // Kartu "Riwayat Pengumpulan" (log bukti kirim tugas) sebelumnya selalu
            // tampil di ketiga sub-tab sekaligus (Belum Selesai, Sedang Dikerjakan,
            // Riwayat/Selesai) -- sekarang digabung jadi cuma muncul di sub-tab
            // "Riwayat/Selesai" saja supaya tidak dobel.
            const kartuRiwayatPengumpulan = document.getElementById('kartu-riwayat-pengumpulan');
            if (kartuRiwayatPengumpulan) {
                kartuRiwayatPengumpulan.classList.toggle('hidden', kategori !== 'selesai');
            }

            const kelompok = window._kelompokTugasTerkini || { belum: [], draft: [], selesai: [] };
            const daftarSemua = kelompok[kategori] || [];

            // Pencarian judul cuma berlaku di sub-tab Riwayat/Selesai.
            const kataCari = (kategori === 'selesai') ? normalisasiKataCariTugas(window._kataCariTugasRiwayat) : '';
            const sedangMencari = kataCari !== '';
            const daftar = sedangMencari ? daftarSemua.filter(d => cocokJudulTugas(d.judul || d.tipe, kataCari)) : daftarSemua;
            sinkronkanKotakCariRiwayatTugas(kategori, daftarSemua.length, daftar.length);

            if (daftar.length === 0) {
                if (sedangMencari && daftarSemua.length > 0) {
                    container.innerHTML = `
                        <div class="p-5 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                            <i class="fa-solid fa-magnifying-glass text-3xl mb-2"></i>
                            <p class="text-xs font-medium">Tidak ada tugas dengan judul &ldquo;${escapeHtmlCariTugas(String(window._kataCariTugasRiwayat).trim())}&rdquo;.</p>
                        </div>`;
                    sembunyikanTombolLihatSemuaTugas();
                    return;
                }
                const pesanKosong = {
                    belum: 'Belum ada tugas terdekat. Semua aman!',
                    draft: 'Belum ada tugas yang sedang kamu kerjakan (foto belum diunggah).',
                    selesai: 'Belum ada tugas yang selesai/diarsipkan.'
                };
                container.innerHTML = `
                    <div class="p-5 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                        <p class="text-xs font-medium">${pesanKosong[kategori]}</p>
                    </div>`;
                sembunyikanTombolLihatSemuaTugas();
                return;
            }

            // Batasan Tampilan (Pagination / Load More): tampilkan maksimal
            // BATAS_TUGAS_PER_HALAMAN tugas dulu; sisanya baru dimuat kalau siswa
            // menekan "Lihat Semua". Status "sudah diperluas" dijaga per kategori
            // supaya pindah-pindah tab tidak reset paginasi tab lain.
            // Saat mencari, semua hasil cocok ditampilkan (tanpa batas per halaman).
            const sudahDiperluas = sedangMencari || !!window._tugasPaginasiExpanded[kategori];
            const daftarTampil = sudahDiperluas ? daftar : daftar.slice(0, BATAS_TUGAS_PER_HALAMAN);

            // Kalau tugas dalam kategori yang lagi aktif ini lebih dari 2, jangan
            // ditumpuk sebagai kartu panjang ke bawah (kesannya kayak "tabel") --
            // tampilkan sebagai baris ikon bulat kecil ke samping (bisa digeser),
            // 1 ikon = 1 tugas. Tap salah satu ikon baru kartu detailnya muncul di
            // modal dengan animasi pop-in (lihat renderBarisBulatTugas()).
            // Kalau cuma 1-2 tugas, tetap ditampilkan langsung sebagai kartu penuh
            // seperti sebelumnya -- tidak perlu diciutkan.
            window._tugasKategoriTerakhirDirender = kategori;
            // Saat mencari SELALU pakai ikon bulat (walau hasilnya cuma 1-2): kartu
            // penuh memanggil tandaiTugasDibukaJikaPerlu() yang mengirim status
            // "dibuka" ke server -- tidak boleh kejadian hanya karena siswa mengetik
            // di kotak cari. Kartu baru dirender saat ikonnya diketuk.
            if (daftarTampil.length > 2 || sedangMencari) {
                container.innerHTML = renderBarisBulatTugas(daftarTampil, kategori);
            } else {
                container.innerHTML = daftarTampil.map(data => renderKartuTugas(data)).join('');
            }

            const sisa = daftar.length - daftarTampil.length;
            const wrapBtn = document.getElementById('wrap-tombol-lihat-semua-tugas');
            const labelSisa = document.getElementById('label-sisa-tugas');
            if (wrapBtn) {
                if (sisa > 0) {
                    wrapBtn.classList.remove('hidden');
                    if (labelSisa) labelSisa.innerText = `(${sisa} tugas lagi)`;
                } else {
                    wrapBtn.classList.add('hidden');
                }
            }
        }

        // Warna & ikon bulat tugas berdasarkan status pengerjaannya saat ini --
        // dipakai renderBarisBulatTugas() supaya siswa langsung kebaca progressnya
        // dari warna tanpa perlu buka satu-satu (amber = belum dibuka sama sekali,
        // biru = sudah dibuka tapi belum dikirim, hijau = sudah dikirim).
        function gayaBulatTugas(data) {
            if (data.studentSubmitted || data.sudahMengumpulkan) {
                return { bg: 'bg-emerald-500', ring: 'ring-emerald-100', icon: 'fa-check' };
            }
            if (data.isViewedByStudent) {
                return { bg: 'bg-blue-500', ring: 'ring-blue-100', icon: 'fa-pen' };
            }
            return { bg: 'bg-amber-500', ring: 'ring-amber-100', icon: 'fa-book-open' };
        }

        // Baris ikon bulat (dipakai kalau tugas dalam 1 kategori > 2) menggantikan
        // tumpukan kartu panjang ke bawah. Titik merah kecil di pojok ikon menandakan
        // tugas itu belum pernah dibuka sama sekali oleh siswa.
        function renderBarisBulatTugas(list, kategori) {
            // bukaBulatTugas() mengambil tugas dari daftar LENGKAP kategori, jadi
            // index yang dikirim harus index aslinya (bukan urutan di hasil cari).
            const daftarAsli = (window._kelompokTugasTerkini && window._kelompokTugasTerkini[kategori]) || list;
            const bubbles = list.map((data, iTampil) => {
                const idxAsli = daftarAsli.indexOf(data);
                const i = idxAsli >= 0 ? idxAsli : iTampil;
                const gaya = gayaBulatTugas(data);
                const judul = String(data.judul || data.tipe || 'Tugas');
                const belumPernahDibuka = !(data.studentSubmitted || data.sudahMengumpulkan) && !data.isViewedByStudent;
                return `
                    <button type="button"
                        onclick="bukaBulatTugas('${kategori}', ${i})"
                        class="relative flex-shrink-0 w-16 flex flex-col items-center gap-1.5 focus:outline-none group">
                        <span class="w-14 h-14 rounded-full ${gaya.bg} text-white flex items-center justify-center text-lg shadow-sm ring-4 ${gaya.ring} transition-transform group-active:scale-90 group-hover:-translate-y-0.5">
                            <i class="fa-solid ${gaya.icon}"></i>
                        </span>
                        ${belumPernahDibuka ? `<span class="absolute top-0 right-1.5 w-3 h-3 rounded-full bg-rose-500 border-2 border-white"></span>` : ''}
                        <span class="text-[10px] font-semibold text-slate-600 leading-tight text-center line-clamp-2 w-full">${judul}</span>
                    </button>`;
            }).join('');

            return `
                <div class="flex items-center gap-1.5 mb-1 text-[11px] text-slate-400">
                    <i class="fa-solid fa-hand-pointer"></i> Ketuk salah satu untuk buka detail tugasnya
                </div>
                <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 tugas-bulat-scroll">${bubbles}</div>`;
        }

        // Dipanggil saat siswa tap salah satu ikon bulat tugas. Kartu detailnya
        // ditaruh di modal statis #modal-bulat-tugas (di luar container-live-tugas)
        // supaya animasi pop-in-nya tidak keganggu kalau daftar ikon bulat
        // dirender ulang di belakang layar.
        function bukaBulatTugas(kategori, index) {
            const kelompok = window._kelompokTugasTerkini || { belum: [], draft: [], selesai: [] };
            const daftar = kelompok[kategori] || [];
            const data = daftar[index];
            const overlay = document.getElementById('modal-bulat-tugas');
            const isi = document.getElementById('modal-bulat-tugas-isi');
            if (!data || !overlay || !isi) return;

            // renderKartuTugas() di dalamnya juga memanggil tandaiTugasDibukaJikaPerlu()
            // -- jadi tepat saat kartu ini ditampilkan, status tugas di Dashboard Guru
            // otomatis berubah dari "Belum Dikerjakan" -> "Sedang Dikerjakan" (kalau
            // belum pernah dibuka & belum dikirim sebelumnya).
            isi.innerHTML = renderKartuTugas(data);

            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
            requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('modal-bulat-tugas--tampil')));

            // Refresh baris ikon bulat di belakang modal supaya warna/titik indikator
            // langsung ikut update begitu status tugas ini berubah -- aman dipanggil
            // ulang karena modalnya sudah dipisah dari container-live-tugas.
            if (window._subTabTugasAktif === kategori) renderSubTabTugasAktif();
        }

        function tutupBulatTugas(e, dariTombolBack) {
            if (e && e.target !== e.currentTarget) return;
            const overlay = document.getElementById('modal-bulat-tugas');
            if (!overlay) return;
            // Modal yang dibuka dari Tugas Terdekat punya 1 entry history (lihat
            // bukaTugasTerdekatById) -- pola sama dengan tutupIdCardTeman().
            if (!dariTombolBack && modalTugasHistoryAktif) {
                modalTugasHistoryAktif = false;
                history.back();
            } else {
                modalTugasHistoryAktif = false;
            }
            overlay.classList.remove('modal-bulat-tugas--tampil');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('flex');
                const isi = document.getElementById('modal-bulat-tugas-isi');
                if (isi) isi.innerHTML = '';
            }, 220);
        }

        // Tandai sebuah tugas sebagai "sudah dibuka siswa" TEPAT SAAT konten
        // lengkapnya benar-benar ditampilkan (dipanggil dari dalam renderKartuTugas()) --
        // bukan lagi cuma karena tab "Tugas & Catatan" dibuka. Efeknya status tugas
        // ini di Dashboard Guru berubah dari "Belum Dikerjakan" -> "Sedang Dikerjakan"
        // persis pas siswa benar-benar melihat instruksinya, baik lewat kartu
        // langsung (kalau <=2 tugas) maupun lewat modal ikon bulat (kalau >2 tugas).
        //
        // PERBAIKAN: versi sebelumnya menulis isViewedByStudent=true dengan
        // memanggil ulang saveTasksSiswa(tasks) -- yaitu MENIMPA SELURUH
        // daftar tugas sekelas (tasks_<KELAS>) dengan salinan gabungan milik
        // akun ini. Itu berisiko: kalau ada tugas BARU dari guru masuk di
        // antara waktu tasks di sini diambil & disimpan ulang, tugas baru
        // itu bisa ikut hilang/tertimpa. Sekarang dipindah ke server, per
        // siswa-per-tugas (skema SAMA seperti status pengumpulan tugas di
        // /api/tugas/submit) lewat /api/tugas/dibaca -- TIDAK PERNAH
        // menyentuh tasks_<KELAS> sama sekali.
        function tandaiTugasDibukaJikaPerlu(data) {
            if (!data || !data.id) return;
            if (data.studentSubmitted || data.sudahMengumpulkan) return; // sudah selesai, tak perlu diubah
            if (data.isViewedByStudent) return; // sudah pernah ditandai terbuka sebelumnya
            data.isViewedByStudent = true; // optimistic (di objek yang lagi dipegang render) + cegah POST dobel
            window._statusTugasSendiri = window._statusTugasSendiri || {};
            window._statusTugasSendiri[data.id] = Object.assign(
                {}, window._statusTugasSendiri[data.id], { dilihat: true }
            );
            fetch('/api/tugas/dibaca', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: data.id })
            }).catch(e => console.warn('Gagal menandai tugas sebagai dibuka:', data.id, e));
            try {
                if (typeof checkTaskBadgeStatus === 'function') checkTaskBadgeStatus();
            } catch (e) {
                console.error('Gagal memperbarui badge status tugas:', e);
            }
        }

        // ---- Helper kecil untuk kartu "Tugas Terdekat" (aman XSS + label waktu) ----
        function escTT(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        // Sisa waktu relatif ("2 jam lagi", "Besok", "3 hari lagi"). Tugas yang
        // sudah lewat deadline TIDAK sampai sini (sudah difilter jadi Terkunci).
        // `mendesak` = true kalau kurang dari 24 jam -> dipakai buat tag merah "Segera".
        function labelSisaWaktuTT(ts, now) {
            if (!isFinite(ts)) return { teks: '', mendesak: false };
            const selisih = ts - now.getTime();
            const menit = Math.round(selisih / 60000);
            const jam = Math.floor(selisih / 3600000);
            const hari = Math.floor(selisih / 86400000);
            if (menit < 60) return { teks: Math.max(1, menit) + ' menit lagi', mendesak: true };
            if (jam < 24) return { teks: jam + ' jam lagi', mendesak: true };
            if (hari === 1) return { teks: 'Besok', mendesak: false };
            return { teks: hari + ' hari lagi', mendesak: false };
        }
        function htmlKosongTT(judul, sub) {
            return `
                <div class="fg-empty">
                    <svg class="fg-empty-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="m9.5 15 2 2 3.5-3.5"/></svg>
                    <div class="fg-empty-text">
                        <p class="fg-empty-title">${judul}</p>
                        <p class="fg-empty-sub">${sub}</p>
                    </div>
                </div>`;
        }

        // ================= TUGAS TERDEKAT: 2 MODE URUTAN =================
        // Mode 'deadline' (default) = "Deadline Mepet": deadline paling dekat duluan,
        //   seri -> publikasi (waktuKirimGuru) terbaru.
        // Mode 'terbaru' = "Tugas Terbaru": publikasi terbaru duluan, deadline cuma
        //   info tambahan; seri -> deadline paling dekat.
        // Ganti mode HANYA mengubah urutan tampilan -- tidak menyentuh data tugas,
        // status pengumpulan, ataupun localStorage/server.
        window._modeTugasTerdekat = window._modeTugasTerdekat || 'deadline';

        function timestampPublikasiTugasTT(t) {
            const ts = Number(t && t.waktuKirimGuru);
            return isFinite(ts) && ts > 0 ? ts : 0;
        }

        // Fungsi MURNI (tanpa DOM, tanpa mengubah array asli): hasilnya salinan terurut.
        function urutkanTugasTerdekat(daftar, mode, now) {
            const dl = t => getDeadlineTimestampTugas(t.deadline || t.deadlineDate || '', now);
            const cmpDeadline = (a, b) => { const x = dl(a), y = dl(b); return x === y ? 0 : (x < y ? -1 : 1); };
            const cmpTerbaru = (a, b) => timestampPublikasiTugasTT(b) - timestampPublikasiTugasTT(a);
            return daftar.slice().sort(mode === 'terbaru'
                ? (a, b) => cmpTerbaru(a, b) || cmpDeadline(a, b)
                : (a, b) => cmpDeadline(a, b) || cmpTerbaru(a, b));
        }

        // Satu sumber urutan untuk Hero Card & mini list: hero = urutan ke-1,
        // mini list = urutan ke-2 dan ke-3, sisanya cuma dihitung (tidak ditampilkan).
        function susunTampilanTugasTerdekat(tugasAktif, mode, now) {
            const terurut = urutkanTugasTerdekat(tugasAktif, mode, now);
            const sudahAda = new Set();
            const unik = [];
            terurut.forEach(t => {
                if (t && t.id != null) {
                    const kunci = String(t.id);
                    if (sudahAda.has(kunci)) return; // jangan tampilkan tugas yang sama 2x
                    sudahAda.add(kunci);
                }
                unik.push(t);
            });
            return { terurut: unik, hero: unik[0] || null, berikutnya: unik.slice(1, 3), sisa: Math.max(0, unik.length - 3) };
        }

        function formatBatasTugasTT(t, now) {
            const raw = t.deadline || t.deadlineDate || '';
            if (!raw) return 'Tanpa batas waktu';
            const ts = getDeadlineTimestampTugas(raw, now);
            if (!isFinite(ts)) return escTT(raw);
            const d = new Date(ts);
            const tgl = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
            const jam = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            return `${tgl} • ${jam} WIB`;
        }

        function labelPublikasiTT(t, now) {
            const ts = timestampPublikasiTugasTT(t);
            if (ts < 1e11) return ''; // bukan timestamp ms yang valid -> jangan ditebak
            const selisih = now.getTime() - ts;
            const menit = Math.floor(selisih / 60000);
            const jam = Math.floor(selisih / 3600000);
            const hari = Math.floor(selisih / 86400000);
            if (menit < 1) return 'baru saja';
            if (menit < 60) return menit + ' menit lalu';
            if (jam < 24) return jam + ' jam lalu';
            return hari + ' hari lalu';
        }

        function statusTugasTT(data) {
            const dibuka = !!(data.isViewedByStudent ||
                (window._statusTugasSendiri && window._statusTugasSendiri[data.id] && window._statusTugasSendiri[data.id].dilihat));
            if (data.keputusanGuru === 'revisi') {
                return { label: 'Perlu Revisi', badge: 'text-orange-700 bg-orange-100', teks: 'text-orange-700', dot: 'bg-orange-500', kartu: 'bg-orange-50 border-orange-200', btn: 'bg-orange-600 hover:bg-orange-700', tombol: 'Lanjutkan' };
            }
            if (dibuka) {
                return { label: 'Sedang Dikerjakan', badge: 'text-blue-700 bg-blue-100', teks: 'text-blue-700', dot: 'bg-blue-500', kartu: 'bg-blue-50 border-blue-200', btn: 'bg-blue-600 hover:bg-blue-700', tombol: 'Lanjutkan' };
            }
            return { label: 'Belum Dikerjakan', badge: 'text-amber-700 bg-amber-100', teks: 'text-amber-700', dot: 'bg-amber-500', kartu: 'bg-amber-50 border-amber-200', btn: 'bg-amber-600 hover:bg-amber-700', tombol: 'Kerjakan' };
        }

        function aksiBukaTugasTT(data) {
            return `bukaTugasTerdekatById(${escTT(JSON.stringify(String(data.id)))})`;
        }

        function htmlHeroTT(data, mode, now) {
            const st = statusTugasTT(data);
            const sisa = labelSisaWaktuTT(getDeadlineTimestampTugas(data.deadline || data.deadlineDate || '', now), now);
            const judul = escTT(data.judul || data.tipe || 'Tugas Pembelajaran');
            const guru = escTT(data.namaGuru || data.guru || data.teacher || data.pengajar || 'Guru Mata Pelajaran');
            const mapel = escTT(data.mapel || data.mataPelajaran || data.pelajaran || '');
            const batas = formatBatasTugasTT(data, now);
            const pub = labelPublikasiTT(data, now);
            const info = (mode === 'terbaru' && pub ? `Diberikan ${pub} • ` : '') + `Batas: ${batas}`;
            const kelasKartu = sisa.mendesak ? 'bg-red-50 border-red-300' : st.kartu;
            const pil = sisa.teks
                ? `<span class="tt-sisa ${sisa.mendesak ? 'text-red-700 bg-red-100' : 'text-slate-500 bg-white'}"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escTT(sisa.mendesak ? 'Segera • ' + sisa.teks : sisa.teks)}</span>`
                : '';
            return `
                <div class="tt-hero border ${kelasKartu}">
                    <div class="tt-hero-top">
                        <span class="tt-badge ${st.badge}">${st.label}</span>
                        ${pil}
                    </div>
                    <h4 class="tt-hero-judul font-bold text-slate-800">${judul}</h4>
                    <p class="tt-meta text-slate-500"><i class="fa-regular fa-user" aria-hidden="true"></i> ${guru}${mapel ? ' • ' + mapel : ''}</p>
                    <div class="tt-hero-foot">
                        <p class="tt-info text-slate-500">${info}</p>
                        <button type="button" onclick="${aksiBukaTugasTT(data)}" class="tt-btn ${st.btn} text-white font-bold">${st.tombol} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
                    </div>
                </div>`;
        }

        function htmlItemTT(data, mode, now) {
            const st = statusTugasTT(data);
            const sisa = labelSisaWaktuTT(getDeadlineTimestampTugas(data.deadline || data.deadlineDate || '', now), now);
            const judulPlain = data.judul || data.tipe || 'Tugas Pembelajaran';
            const judul = escTT(judulPlain);
            const mapelAtauGuru = escTT(data.mapel || data.mataPelajaran || data.pelajaran || data.namaGuru || data.guru || data.teacher || data.pengajar || 'Guru Mata Pelajaran');
            const pub = labelPublikasiTT(data, now);
            let indikator;
            if (mode === 'terbaru') {
                indikator = pub ? `<span>Diberikan ${pub}</span>` : `<span>${formatBatasTugasTT(data, now)}</span>`;
            } else {
                indikator = sisa.teks
                    ? `<span class="${sisa.mendesak ? 'text-red-600 font-bold' : ''}">${escTT(sisa.teks)}</span>`
                    : `<span>${formatBatasTugasTT(data, now)}</span>`;
            }
            return `
                <div class="tt-item border border-slate-200 bg-white" role="listitem">
                    <span class="tt-dot ${st.dot}" aria-hidden="true"></span>
                    <div class="tt-item-body">
                        <p class="tt-item-judul font-bold text-slate-800">${judul}</p>
                        <p class="tt-item-meta text-slate-500">${mapelAtauGuru} • ${indikator}</p>
                        <p class="tt-item-status ${st.teks}">${st.label}</p>
                    </div>
                    <button type="button" onclick="${aksiBukaTugasTT(data)}" aria-label="${escTT(st.tombol + ': ' + judulPlain)}" class="tt-aksi bg-slate-700 hover:bg-slate-800 text-white"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
                </div>`;
        }

        function sinkronkanToggleTugasTerdekat(tampil, mode) {
            const wrap = document.getElementById('tt-filter');
            if (!wrap) return;
            wrap.hidden = !tampil;
            wrap.querySelectorAll('[data-tt-mode]').forEach(btn => {
                const aktif = btn.getAttribute('data-tt-mode') === mode;
                btn.classList.toggle('tt-seg-btn--aktif', aktif);
                btn.setAttribute('aria-selected', aktif ? 'true' : 'false');
            });
        }

        function setModeTugasTerdekat(mode) {
            if (mode !== 'deadline' && mode !== 'terbaru') return;
            if (window._modeTugasTerdekat === mode) return;
            window._modeTugasTerdekat = mode;
            renderTugasTerdekat();
            const container = document.getElementById('container-tugas-terdekat');
            if (container) {
                container.classList.remove('tt-ganti');
                void container.offsetWidth; // restart animasi (dimatikan CSS saat prefers-reduced-motion)
                container.classList.add('tt-ganti');
            }
        }

        function renderTugasTerdekat() {
            const container = document.getElementById('container-tugas-terdekat');
            if (!container) return;
            const tasks = getTasksSiswa();
            const now = getAccurateNow();
            const mode = window._modeTugasTerdekat === 'terbaru' ? 'terbaru' : 'deadline';

            // EMPTY STATE #1: guru memang belum memberi tugas apa pun.
            if (tasks.length === 0) {
                sinkronkanToggleTugasTerdekat(false, mode);
                container.innerHTML = htmlKosongTT('Belum ada tugas terdekat.', 'Semua aman!');
                return;
            }

            // Tugas AKTIF = belum dikumpulkan (atau sedang diminta revisi) & belum
            // lewat deadline. Tugas yang lewat deadline otomatis Terkunci dan
            // dikeluarkan dari kartu ini (aturan lama dipertahankan).
            const tugasAktif = tasks.filter(t => {
                if ((t.studentSubmitted || t.sudahMengumpulkan) && (t.keputusanGuru !== 'revisi' || revisiSudahKedaluwarsa(t, now))) return false;
                const batasWaktu = t.deadline || t.deadlineDate || '';
                return !cekTugasSudahKedaluwarsa(batasWaktu, now);
            });

            if (tugasAktif.length > 0) {
                const tampilan = susunTampilanTugasTerdekat(tugasAktif, mode, now);
                // Disimpan sesuai urutan mode aktif -- dipakai bukaTugasTerdekatLain(index).
                window._tugasAktifTerdekat = tampilan.terurut;
                sinkronkanToggleTugasTerdekat(true, mode);

                const daftarMini = tampilan.berikutnya.length > 0
                    ? `<div class="tt-list" role="list">${tampilan.berikutnya.map(t => htmlItemTT(t, mode, now)).join('')}</div>`
                    : '';
                const lihatSemua = tampilan.sisa > 0
                    ? `<button type="button" onclick="switchTab('tugas')" class="tt-lainnya text-slate-500"><span><strong class="text-slate-800">+${tampilan.sisa} tugas lainnya</strong> menunggu</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
                    : '';
                container.innerHTML = htmlHeroTT(tampilan.hero, mode, now) + daftarMini + lihatSemua;
                return;
            }

            // EMPTY STATE #2: ada tugas, tapi tidak ada yang aktif.
            // Bedakan "semua sudah beres" dengan "sisanya terlewat".
            sinkronkanToggleTugasTerdekat(false, mode);
            const jumlahTerlewat = tasks.filter(t => {
                if (t.studentSubmitted || t.sudahMengumpulkan) return false;
                const batasWaktu = t.deadline || t.deadlineDate || '';
                return !!batasWaktu && cekTugasSudahKedaluwarsa(batasWaktu, now);
            }).length;
            container.innerHTML = jumlahTerlewat > 0
                ? htmlKosongTT('Tidak ada tugas yang bisa dikerjakan.', 'Sisanya sudah lewat batas waktu.')
                : htmlKosongTT('Semua tugas sudah beres 🎉', 'Tidak ada yang menunggu.');
        }

        // ---- Navigasi dari Hero Card / mini list ke detail tugas yang benar ----
        // Memakai mekanisme yang SUDAH ada (tidak ada halaman/modal/route baru):
        //   1) switchTab('tugas')  -> tab + bottom nav aktif, history, gerbang maintenance
        //   2) sub-tab diarahkan ke kategori tugas itu (belum / draft)
        //   3) kategori > 2 tugas  -> modal #modal-bulat-tugas via bukaBulatTugas()
        //      kategori <= 2 tugas -> kartu sudah tampil langsung, cukup digulir & disorot
        // Data tugas tersimpan lokal (getTasksSiswa) jadi tidak ada fetch/loading;
        // yang ditangani adalah tugas hilang/selesai/terlewat dan error tak terduga.
        let modalTugasHistoryAktif = false; // true selagi modal detail dibuka dari sini (lihat popstate)

        function sorotKartuTugasInline(id) {
            const wadah = document.getElementById('container-live-tugas');
            if (!wadah) return;
            const idStr = String(id);
            let kartu = Array.from(wadah.querySelectorAll('[data-task-id]')).find(el => el.getAttribute('data-task-id') === idStr);
            if (!kartu) {
                const btnKirim = document.getElementById('btn-kirim-tugas-' + idStr);
                kartu = btnKirim ? btnKirim.closest('.rounded-2xl') : null;
            }
            if (!kartu) return;
            const kurangiGerak = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            kartu.style.scrollMarginTop = '88px';
            kartu.scrollIntoView({ behavior: kurangiGerak ? 'auto' : 'smooth', block: 'start' });
            kartu.classList.add('tt-sorot');
            setTimeout(() => kartu.classList.remove('tt-sorot'), 2200);
        }

        function bukaTugasTerdekatById(id) {
            try {
                const now = getAccurateNow();
                // Validasi dari data TERBARU (bukan salinan di layar yang mungkin basi).
                const data = getTasksSiswa().find(t => String(t.id) === String(id));
                if (!data) {
                    tampilkanToast('Tugas ini sudah tidak tersedia (mungkin ditarik guru).', 'warning', 3500);
                    renderTugasTerdekat();
                    return;
                }
                const kategori = kategoriStatusTugas(data, now);
                if (kategori === 'selesai') {
                    // Sudah dikumpulkan / dinilai / lewat deadline -> form tidak boleh dibuka.
                    tampilkanToast('Tugas ini sudah selesai atau lewat batas waktu, jadi tidak bisa dikerjakan lagi.', 'warning', 4000);
                    renderTugasTerdekat();
                    return;
                }

                switchTab('tugas');
                const tabTugas = document.getElementById('tab-tugas');
                // switchTab membatalkan diri kalau fitur Tugas sedang maintenance (toast sudah muncul).
                if (!tabTugas || tabTugas.classList.contains('hidden')) return;

                window._subTabTugasAktif = kategori;
                renderSubTabTugasAktif();

                const daftar = (window._kelompokTugasTerkini && window._kelompokTugasTerkini[kategori]) || [];
                const index = daftar.findIndex(t => String(t.id) === String(id));
                if (index === -1) {
                    tampilkanToast('Detail tugas tidak ditemukan. Coba buka dari daftar Tugas.', 'warning', 3500);
                    return;
                }
                if (daftar.length > 2) {
                    bukaBulatTugas(kategori, index);
                    if (!modalTugasHistoryAktif) {
                        modalTugasHistoryAktif = true;
                        dorongHistoryTampilan({ type: 'modal', modal: 'detail-tugas' }); // tombol back menutup modal dulu
                    }
                } else {
                    requestAnimationFrame(() => sorotKartuTugasInline(id));
                }
            } catch (err) {
                console.error('Gagal membuka detail tugas dari Tugas Terdekat:', err);
                if (typeof tampilkanToast === 'function') tampilkanToast('Gagal membuka detail tugas. Coba lagi.', 'error', 3500);
            }
        }

        // Dipanggil saat siswa ketuk ikon "+N" di sebelah ikon utama kartu
        // "Tugas Terdekat" di beranda (lihat renderTugasTerdekat() -- ikon ini
        // cuma muncul kalau tugas aktif dari guru LEBIH DARI SATU). "index"
        // menunjuk ke posisi tugas di window._tugasAktifTerdekat -- dipanggil
        // dengan 1 dari markup supaya yang kebuka tugas AKTIF BERIKUTNYA
        // setelah yang sudah tampil sebagai kartu utama (index 0).
        //
        // Kartu detailnya ditampilkan lewat modal statis #modal-bulat-tugas --
        // modal YANG SAMA dipakai ikon bulat di tab "Tugas & Catatan" (lihat
        // bukaBulatTugas()) -- supaya tampilan & perilakunya konsisten di
        // seluruh dashboard, bukan modal baru yang terpisah.
        function bukaTugasTerdekatLain(index) {
            const daftar = window._tugasAktifTerdekat || [];
            const data = daftar[index];
            const overlay = document.getElementById('modal-bulat-tugas');
            const isi = document.getElementById('modal-bulat-tugas-isi');
            if (!data || !overlay || !isi) return;

            // renderKartuTugas() di dalamnya memanggil tandaiTugasDibukaJikaPerlu()
            // -- jadi tepat saat kartu tugas ke-2 ini ditampilkan, statusnya
            // otomatis berubah dari "Belum Dikerjakan" -> "Sedang Dikerjakan"
            // (di dashboard siswa maupun di Dashboard Guru), sama seperti tugas
            // utama & ikon bulat di tab Tugas & Catatan.
            isi.innerHTML = renderKartuTugas(data);

            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
            requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('modal-bulat-tugas--tampil')));

            // Render ulang kartu "Tugas Terdekat" di belakang modal supaya badge
            // status & label "+N tugas lain menunggu" ikut update begitu status
            // tugas ke-2 ini berubah jadi "Sedang Dikerjakan".
            renderTugasTerdekat();
        }

        const jadwalPelajaran = {
            "Senin": [{ start: "06:30", end: "07:30", mapel: "Upacara Bendera", guru: "Semua Guru • Lapangan Sekolah" }],
            "Selasa": [{ start: "07:30", end: "09:00", mapel: "Administrasi Jaringan", guru: "Ahmad, S.T • Lab TKJ 1" }],
            "Rabu": [{ start: "07:30", end: "09:00", mapel: "Matematika Peminatan", guru: "Drs. Eko Prasetyo • Lab Komputer 1" }],
            "Kamis": [{ start: "07:30", end: "09:00", mapel: "Pemrograman Web", guru: "Ahmad Fakhri • Lab Komputer 2" }],
            "Jumat": [{ start: "07:30", end: "09:00", mapel: "Olahraga", guru: "Pak Ade, S.Pd • Lapangan" }]
        };
        const namaHariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

        function renderTodaySchedule() {
            const container = document.getElementById('today-schedule-list');
            if (!container) return;

            const now = getAccurateNow();
            const hariIni = namaHariIndo[now.getDay()];
            const hariLibur = hariIni === "Minggu" || hariIni === "Sabtu";
            const listJadwal = hariLibur ? [] : (jadwalPelajaran[hariIni] || []);

            if (listJadwal.length === 0) {
                container.innerHTML = `
                    <div class="fg-empty">
                        <svg class="fg-empty-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10h11v5.5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4V10Z"/><path d="M15.5 11.5h1.5a2.5 2.5 0 0 1 0 5h-1.5"/><path d="M8 3.5v2M10.5 3v2.5M13 3.5v2" stroke-dasharray="0.1 2.2"/></svg>
                        <div class="fg-empty-text">
                            <p class="fg-empty-title">${hariLibur ? `Hari ${hariIni} libur` : 'Tidak ada jadwal pelajaran hari ini'}</p>
                            ${hariLibur ? '<p class="fg-empty-sub">Tidak ada jadwal pelajaran.</p>' : ''}
                        </div>
                    </div>`;
                return;
            }

            const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

            let html = '';
            listJadwal.forEach((item) => {
                const [startH, startM] = item.start.split(':').map(Number);
                const [endH, endM] = item.end.split(':').map(Number);
                const startTotalMinutes = startH * 60 + startM;
                const endTotalMinutes = endH * 60 + endM;

                let cardStyle = "border-slate-200 bg-white";
                let timeBadgeStyle = "bg-blue-50 text-blue-700";
                let statusLabel = `<span class="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-extrabold uppercase tracking-wide rounded-md">Akan Datang</span>`;

                if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes) {
                    cardStyle = "border-emerald-500 bg-emerald-50/50 shadow-sm";
                    timeBadgeStyle = "bg-emerald-500 text-white animate-pulse";
                    statusLabel = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-extrabold uppercase tracking-wide rounded-md animate-pulse">Berlangsung</span>`;
                } else if (currentTotalMinutes > endTotalMinutes) {
                    cardStyle = "border-slate-200 bg-slate-50 opacity-75";
                    timeBadgeStyle = "bg-blue-50 text-blue-700";
                    statusLabel = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-extrabold uppercase tracking-wide rounded-md">Selesai</span>`;
                }

                html += `
                    <div class="p-3.5 border rounded-xl transition-all ${cardStyle}">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-xs font-bold px-2.5 py-1 rounded-lg ${timeBadgeStyle}">${item.start} - ${item.end}</span>
                            ${statusLabel}
                        </div>
                        <h4 class="font-bold text-slate-800 text-sm">${item.mapel}</h4>
                        <p class="text-xs text-slate-400">${item.guru}</p>
                    </div>`;
            });
            container.innerHTML = html;
        }

        function openModalJadwal() { 
            document.getElementById('modalJadwal').classList.remove('hidden'); 
            const now = getAccurateNow();
            let hariIni = namaHariIndo[now.getDay()];
            if (hariIni === "Minggu" || hariIni === "Sabtu") hariIni = "Senin";
            renderModalSchedule(hariIni);
        }
        
        function closeModalJadwal() { 
            document.getElementById('modalJadwal').classList.add('hidden'); 
        }

        function renderModalSchedule(day) {
            document.querySelectorAll('#day-tabs button').forEach(btn => {
                btn.className = "tab-btn px-4 py-2 text-xs font-bold rounded-xl transition-all bg-slate-100 text-slate-600 hover:bg-slate-200";
            });
            const activeBtn = document.querySelector(`#day-tabs button[data-day="${day}"]`);
            if (activeBtn) activeBtn.className = "tab-btn px-4 py-2 text-xs font-bold rounded-xl transition-all bg-blue-600 text-white";

            const container = document.getElementById('modal-schedule-list');
            const list = jadwalPelajaran[day] || [];
            if (list.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Tidak ada jadwal.</p>`;
                return;
            }
            container.innerHTML = list.map(i => `
                <div class="flex items-center justify-between p-3 border rounded-xl bg-slate-50">
                    <span class="text-xs font-bold bg-white px-2.5 py-1 rounded-lg shadow-sm">${i.start} - ${i.end}</span>
                    <div class="text-right">
                        <h4 class="font-bold text-slate-800 text-xs">${i.mapel}</h4>
                        <p class="text-[11px] text-slate-400">${i.guru}</p>
                    </div>
                </div>
            `).join('');
        }

        function renderLiveTaskContent() {
            const tasks = getTasksSiswa();
            const container = document.getElementById('container-live-tugas');
            if (!container) return;

            if (tasks.length === 0) {
                const kartuRiwayatPengumpulanKosong = document.getElementById('kartu-riwayat-pengumpulan');
                if (kartuRiwayatPengumpulanKosong) {
                    kartuRiwayatPengumpulanKosong.classList.toggle('hidden', (window._subTabTugasAktif || 'belum') !== 'selesai');
                }
                container.innerHTML = `
                    <div class="p-5 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                        <p class="text-xs font-medium">Belum ada tugas/catatan baru dikirimkan oleh guru.</p>
                    </div>`;
                window._kelompokTugasTerkini = { belum: [], draft: [], selesai: [] };
                renderBadgeSubTabTugas(window._kelompokTugasTerkini);
                sinkronkanKotakCariRiwayatTugas(window._subTabTugasAktif || 'belum', 0, 0);
                sembunyikanTombolLihatSemuaTugas();
                updateTaskCounter();
                renderTugasTerdekat();
                return;
            }

            // Tugas dipecah jadi 3 kategori (Belum Selesai / Sedang Dikerjakan (Draft) /
            // Riwayat & Selesai) lewat segmented control di atas -- lihat
            // hitungKelompokTugas() & kategoriStatusTugas() untuk logika pengelompokan,
            // pengurutan berdasar deadline terdekat, dan arsip otomatis-nya. Tugas baru
            // dari guru tetap MENAMBAH ke daftar (bukan menimpa), cuma sekarang
            // ditempatkan di kategori yang sesuai statusnya.
            const kelompok = hitungKelompokTugas();
            window._kelompokTugasTerkini = kelompok;
            renderBadgeSubTabTugas(kelompok);
            renderSubTabTugasAktif();

            updateTaskCounter();
            renderTugasTerdekat();
        }

        // Bangun markup satu ubin foto lampiran guru di dalam galeri. `overlaySisa`
        // (kalau diisi angka > 0) menaruh lapisan gelap + teks "+N" di atas foto --
        // dipakai khusus untuk ubin terakhir yang terlihat saat foto > 4.
        function ubinGaleriFotoGuruTugas(taskId, idx, src, kelasTinggi, overlaySisa) {
            const overlayHTML = (overlaySisa && overlaySisa > 0)
                ? `<div class="absolute inset-0 bg-slate-900/60 flex items-center justify-center"><span class="text-white text-lg font-extrabold">+${overlaySisa}</span></div>`
                : '';
            return `
                <div class="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-zoom-in ${kelasTinggi}" onclick="bukaGaleriFotoGuruTugas('${taskId}', ${idx})">
                    <img loading="lazy" decoding="async" src="${src}" class="w-full h-full object-cover" alt="Lampiran Guru ${idx + 1}">
                    ${overlayHTML}
                </div>
            `;
        }

        // Render galeri foto lampiran guru mengikuti pola tampilan WhatsApp:
        // 1 foto penuh, 2 foto berdampingan, 3 foto (1 besar + 2 kecil),
        // 4 foto grid 2x2, dan >4 foto grid 2x2 dengan ubin terakhir diberi
        // badge "+N" (N = sisa foto yang tidak terlihat di grid).
        function renderGaleriFotoGuruTugas(taskId, images) {
            const total = images.length;

            if (total === 1) {
                return `<img loading="lazy" decoding="async" src="${images[0]}" onclick="bukaGaleriFotoGuruTugas('${taskId}', 0)" class="max-h-64 rounded-xl border border-slate-200 object-contain shadow-sm cursor-zoom-in" alt="Lampiran Guru">`;
            }

            if (total === 2) {
                return `
                    <div class="grid grid-cols-2 gap-1.5 h-40">
                        ${ubinGaleriFotoGuruTugas(taskId, 0, images[0], 'h-full')}
                        ${ubinGaleriFotoGuruTugas(taskId, 1, images[1], 'h-full')}
                    </div>`;
            }

            if (total === 3) {
                return `
                    <div class="grid grid-cols-2 grid-rows-2 gap-1.5 h-48">
                        ${ubinGaleriFotoGuruTugas(taskId, 0, images[0], 'row-span-2')}
                        ${ubinGaleriFotoGuruTugas(taskId, 1, images[1], '')}
                        ${ubinGaleriFotoGuruTugas(taskId, 2, images[2], '')}
                    </div>`;
            }

            // 4 foto, atau >4 foto (ubin ke-4 dikasih badge "+N" berisi sisanya)
            const sisaTidakTerlihat = total > 4 ? (total - 4) : 0;
            return `
                <div class="grid grid-cols-2 grid-rows-2 gap-1.5 h-48">
                    ${ubinGaleriFotoGuruTugas(taskId, 0, images[0], '')}
                    ${ubinGaleriFotoGuruTugas(taskId, 1, images[1], '')}
                    ${ubinGaleriFotoGuruTugas(taskId, 2, images[2], '')}
                    ${ubinGaleriFotoGuruTugas(taskId, 3, images[3], '', sisaTidakTerlihat)}
                </div>`;
        }

        // ---- Pemutar voice note ala redesain (pil navy + gelombang) ----
        // <audio> asli tetap ada (disembunyikan) supaya transkrip otomatis
        // (IIFE "TRANSKRIP VOICE NOTE" di bawah) tetap menempel & tersinkron.
        function dtVnFmt(d) { d = Math.max(0, Math.floor(d || 0)); return Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0'); }
        function dtVnToggle(id) {
            const a = document.getElementById('dt-vn-audio-' + id);
            if (!a) return;
            if (a.paused) {
                document.querySelectorAll('audio.dt-vn-audio').forEach(x => { if (x !== a) x.pause(); });
                a.play().catch(() => {});
            } else { a.pause(); }
        }
        function dtVnSeek(ev, id) {
            const a = document.getElementById('dt-vn-audio-' + id);
            if (!a || !isFinite(a.duration)) return;
            const r = ev.currentTarget.getBoundingClientRect();
            a.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * a.duration;
        }
        function dtVnSync(id) {
            const a = document.getElementById('dt-vn-audio-' + id);
            const box = document.getElementById('dt-vn-' + id);
            if (!a || !box) return;
            const dur = isFinite(a.duration) ? a.duration : 0;
            const bars = box.querySelectorAll('.dt-wave i');
            const aktif = dur ? Math.round((a.currentTime / dur) * bars.length) : 0;
            bars.forEach((b, i) => b.classList.toggle('on', i < aktif));
            box.classList.toggle('playing', !a.paused);
            const t = box.querySelector('.dt-time');
            if (t) t.textContent = dtVnFmt(a.paused && a.currentTime === 0 ? dur : (a.paused ? dur - a.currentTime : a.currentTime));
        }
        window.dtVnToggle = dtVnToggle; window.dtVnSeek = dtVnSeek; window.dtVnSync = dtVnSync;

        function renderKartuTugas(data) {
            // Kartu ini adalah tempat KONTEN LENGKAP tugas benar-benar ditampilkan ke
            // siswa (baik dirender langsung kalau <=2 tugas, atau di dalam modal ikon
            // bulat kalau >2 tugas) -- jadi di sinilah titik yang tepat untuk menandai
            // tugas sebagai "sudah dibuka" (lihat tandaiTugasDibukaJikaPerlu()).
            tandaiTugasDibukaJikaPerlu(data);

            const deskripsiTugas = data.teks || data.deskripsi || 'Tidak ada instruksi.';
            const batasWaktuTugas = data.deadline || data.deadlineDate || '16:51';
            const tipeKonten = data.tipe || '📌 Tugas Utama';
            const judulTugas = data.judul || 'Instruksi Tugas Pembelajaran';
            const namaGuruTugas = data.namaGuru || data.guru || data.teacher || data.pengajar || 'Guru Mata Pelajaran';

            // FITUR TAMBAHAN: galeri foto lampiran guru ala WhatsApp -- 1 foto
            // tetap tampil penuh seperti sebelumnya (kompatibel dgn data lama
            // "teacherImage" tunggal), tapi kalau guru melampirkan BANYAK foto
            // ("teacherImages", array -- urutan sesuai urutan guru unggah/susun,
            // TIDAK diacak lagi di sini), tampilannya menyesuaikan jumlah foto:
            // 2 foto -> berdampingan, 3 foto -> 1 besar + 2 kecil, 4 foto -> grid
            // 2x2, >4 foto -> grid 2x2 dengan foto ke-4 diberi overlay "+N" berisi
            // sisa jumlah foto yang belum kelihatan. Klik foto manapun membuka
            // galeri (lihat bukaGaleriFotoGuruTugas & bukaZoomGaleriFoto di
            // dashboard_siswa_2.js) yang bisa digeser maju/mundur mengikuti
            // urutan foto yang sama, mulai dari foto yang diklik.
            let teacherImageHTML = '';
            const teacherImages = Array.isArray(data.teacherImages) && data.teacherImages.length > 0
                ? data.teacherImages
                : (data.teacherImage ? [data.teacherImage] : []);

            if (teacherImages.length > 0) {
                window._galeriFotoGuruTugas = window._galeriFotoGuruTugas || {};
                window._galeriFotoGuruTugas[data.id] = teacherImages;

                teacherImageHTML = teacherImages.map((src, idx) => `
                    <button type="button" class="dt-file" onclick="bukaGaleriFotoGuruTugas('${data.id}', ${idx})">
                        <span class="dt-thumb"><img loading="lazy" decoding="async" src="${src}" alt=""></span>
                        <span class="dt-file-info"><span class="dt-file-nm">Lampiran guru${teacherImages.length > 1 ? ' ' + (idx + 1) : ''}</span><span class="dt-file-sz">Gambar &middot; ketuk untuk memperbesar</span></span>
                        <svg class="dt-dl" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/></svg>
                    </button>`).join('');
            }

            let voiceNoteHTML = '';
            if (data.audioDataUrl) {
                const _vnBars = Array.from({ length: 44 }, (_, i) => `<i style="height:${Math.round(22 + 78 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)))}%"></i>`).join('');
                voiceNoteHTML = `
                    <div class="dt-vn-wrap">
                        <div class="dt-vn" id="dt-vn-${data.id}">
                            <button type="button" class="dt-play" aria-label="Putar suara" onclick="dtVnToggle('${data.id}')">
                                <svg class="dt-ico-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>
                                <svg class="dt-ico-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>
                            </button>
                            <div class="dt-wave" onclick="dtVnSeek(event, '${data.id}')" aria-label="Posisi suara">${_vnBars}</div>
                            <span class="dt-time">0:00</span>
                        </div>
                        <audio id="dt-vn-audio-${data.id}" class="dt-vn-audio" preload="metadata" src="${data.audioDataUrl}" data-vn="1" data-vn-id="${data.vnId || ''}"
                            onloadedmetadata="dtVnSync('${data.id}')" ontimeupdate="dtVnSync('${data.id}')" onplay="dtVnSync('${data.id}')" onpause="dtVnSync('${data.id}')" onended="dtVnSync('${data.id}')"></audio>
                    </div>
                `;
            }

            const now = getAccurateNow();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentSeconds = String(now.getSeconds()).padStart(2, '0');
            const currentTimeString = `${currentHours}:${currentMinutes}`;
            const currentFullTimeString = `${currentTimeString}:${currentSeconds}`;

            let isExpired = false;
            if (batasWaktuTugas) {
                let cleanDeadline = batasWaktuTugas.trim();
                if (cleanDeadline.includes("Pukul")) {
                    let parts = cleanDeadline.split("Pukul");
                    let datePart = parts[0].trim();
                    let timePart = parts[1].replace("WIB", "").trim();
                    let targetDateTime = new Date(`${datePart}T${timePart}:00`);
                    if (!isNaN(targetDateTime.getTime()) && now.getTime() > targetDateTime.getTime()) {
                        isExpired = true;
                    }
                } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(":")) {
                    if (currentFullTimeString >= `${cleanDeadline}:00`) isExpired = true;
                } else {
                    const deadlineTime = new Date(cleanDeadline).getTime();
                    if (!isNaN(deadlineTime) && now.getTime() > deadlineTime) isExpired = true;
                }
            }

            // FITUR TAMBAHAN: batas waktu revisi yang sudah lewat tanpa siswa
            // kirim ulang -- lihat revisiSudahKedaluwarsa() di atas. Dihitung
            // live dari `now` yang sama dgn isExpired supaya konsisten.
            const isRevisiExpired = revisiSudahKedaluwarsa(data, now);

            let statusActionHTML = '';
            // FITUR TAMBAHAN: kunci tugas selama siswa masih berstatus "Pelanggaran
            // Aktif" (lihat overlay & window.pelanggaranSiswaSedangAktif() di script
            // dekat penutup </body>). Hanya berlaku utk tugas yang BELUM
            // dikumpulkan/belum kedaluwarsa -- tugas yang sudah terkirim atau sudah
            // lewat deadline tetap tampil seperti biasa (statusnya sudah final).
            // Batas revisi yang sudah lewat juga dianggap final (isRevisiExpired).
            const pelanggaranAktifSekarang = (!(data.studentSubmitted || data.sudahMengumpulkan) || data.keputusanGuru === 'revisi') && !isExpired && !isRevisiExpired &&
                (typeof window.pelanggaranSiswaSedangAktif === 'function') && window.pelanggaranSiswaSedangAktif();

            // FITUR "REVISI": banner alasan dari guru, ditampilkan di ATAS form
            // upload foto revisi (bukan menggantikan form) -- baik saat tugas ini
            // sudah pernah dikumpulkan (kasus normal) maupun (jaga-jaga) saat
            // belum sempat tercatat 'submitted' di cache lokal.
            const revisiBannerHTML = (data.keputusanGuru === 'revisi') ? `
                <div class="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold flex items-start gap-2.5 shadow-sm w-full mb-3">
                    <i class="fa-solid fa-rotate-left text-sm mt-0.5 shrink-0"></i>
                    <span class="leading-relaxed">
                        <u class="font-bold">Perlu Revisi</u> dari ${namaGuruTugas}${data.alasanKeputusanGuru ? `: "${data.alasanKeputusanGuru}"` : '.'}
                        Unggah ulang foto tugas yang benar di bawah ini -- foto lama otomatis diganti begitu kamu kirim ulang.
                        ${data.batasRevisiGuruFormatted ? `<br><span class="inline-flex items-center gap-1 mt-1.5 font-bold text-rose-600"><i class="fa-regular fa-clock"></i> Batas waktu revisi: ${data.batasRevisiGuruFormatted}</span>` : ''}
                    </span>
                </div>` : '';

            if ((data.studentSubmitted || data.sudahMengumpulkan) && data.keputusanGuru !== 'revisi') {
                let studentImagePreview = '';
                if (Array.isArray(data.studentImages) && data.studentImages.length > 0) {
                    // Sama seperti registry teacherImages di atas -- dipakai
                    // bukaGaleriFotoTugasSiswa() (dashboard_siswa_2.js) supaya
                    // klik foto buka lightbox zoom, bukan tab baru kosong.
                    window._galeriFotoTugasSiswa = window._galeriFotoTugasSiswa || {};
                    window._galeriFotoTugasSiswa[data.id] = data.studentImages;
                    studentImagePreview = `
                        <div class="mt-2">
                            <span class="text-[10px] text-slate-400">Foto Tugas Dikirim (${data.studentImages.length}):</span>
                            <div class="grid grid-cols-4 gap-1.5 mt-1">
                                ${data.studentImages.map((src, idx) => `<img loading="lazy" decoding="async" src="${src}" onclick="bukaGaleriFotoTugasSiswa('${data.id}', ${idx})" class="w-full h-14 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in">`).join('')}
                            </div>
                        </div>`;
                } else if (data.studentImage) {
                    // Data lama (sebelum fitur kirim banyak foto) cuma nyimpen 1 foto.
                    studentImagePreview = `<div class="mt-2"><span class="text-[10px] text-slate-400">Foto Tugas Dikirim:</span><br><img loading="lazy" decoding="async" src="${data.studentImage}" class="max-h-32 rounded-lg border mt-1 shadow-sm"></div>`;
                }
                statusActionHTML = `
                    <div class="space-y-2 text-right">
                        <span class="inline-block text-xs text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 shadow-sm">
                            <i class="fa-solid fa-check mr-1"></i> Tugas Berhasil Dikirim (${data.waktuKirim || '-'})
                        </span>
                        ${studentImagePreview}
                    </div>`;
            } else if (pelanggaranAktifSekarang) {
                // Pesan terkunci ditampilkan oleh kotak .dt-lock di kartu (redesain).
                statusActionHTML = '';
            } else if (isRevisiExpired) {
                // FITUR TAMBAHAN: batas waktu revisi sudah lewat tanpa siswa
                // kirim ulang -- form kirim ulang OTOMATIS ditutup (dihitung
                // live dari jam sekarang, lihat revisiSudahKedaluwarsa()),
                // tugas dihitung final sebagai "Tidak Dikerjakan"/belum
                // mengerjakan, sama seperti tugas biasa yang kedaluwarsa.
                // Tidak perlu guru klik apa pun ataupun restart web/app --
                // begitu waktunya lewat, tampilan ini otomatis muncul sendiri
                // pada render/polling berikutnya.
                statusActionHTML = `
                    <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-start gap-2.5 shadow-sm w-full">
                        <i class="fa-solid fa-lock text-sm mt-0.5 shrink-0"></i>
                        <span class="leading-relaxed">Batas waktu revisi (${data.batasRevisiGuruFormatted || '-'}) sudah lewat. Tugas ini kini berstatus <u class="font-bold">Kedaluwarsa</u> &amp; tercatat "Tidak Dikerjakan" di riwayatmu -- tidak dapat dikirim lagi.</span>
                    </div>`;
            } else if (data.keputusanGuru === 'revisi') {
                // FITUR "REVISI" (skenario lengkap):
                //  1) Siswa kirim foto pertama -> tersimpan normal di server.
                //  2) Guru menandai "Perlu Revisi" + nulis catatan -- endpoint
                //     /api/tugas/keputusan CUMA mengubah field keputusan/alasan,
                //     TIDAK menyentuh 'images' sama sekali -- jadi foto pertama
                //     tadi (data.studentImages, dari cache.images) masih UTUH di
                //     server & sengaja ditampilkan lagi di sini sbg panduan
                //     visual, supaya siswa inget persis bagian mana yang guru
                //     maksud di catatan (bukan cuma teks doang).
                //  3) Siswa baca catatan, foto ulang, tekan Kirim Ulang.
                //  4) Begitu foto baru itu sampai ke /api/tugas/submit, dict
                //     lama (isinya foto pertama) langsung DITIMPA TOTAL --
                //     foto pertama otomatis tidak tersimpan lagi di mana pun
                //     di server (lihat catatan di api_tugas_submit(), app.py)
                //     -- baru di titik INI foto lama benar-benar terhapus.
                let fotoSebelumnyaHTML = '';
                if (Array.isArray(data.studentImages) && data.studentImages.length > 0) {
                    window._galeriFotoTugasSiswa = window._galeriFotoTugasSiswa || {};
                    window._galeriFotoTugasSiswa[data.id] = data.studentImages;
                    fotoSebelumnyaHTML = `
                        <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wide"><i class="fa-solid fa-clock-rotate-left mr-1"></i> Foto Sebelumnya (Panduan Revisi -- akan diganti begitu kamu kirim foto baru):</span>
                            <div class="grid grid-cols-4 gap-1.5 mt-1.5">
                                ${data.studentImages.map((src, idx) => `<img loading="lazy" decoding="async" src="${src}" onclick="bukaGaleriFotoTugasSiswa('${data.id}', ${idx})" class="w-full h-14 object-cover rounded-lg border border-slate-300 shadow-sm cursor-zoom-in opacity-90">`).join('')}
                            </div>
                        </div>`;
                }
                // FITUR TAMBAHAN: foto yang sudah dicoret/dilingkari guru dengan
                // warna (lihat fotoAnotasiRevisi di atas) -- ditampilkan LEBIH
                // menonjol daripada foto polos di atas, supaya siswa langsung
                // lihat persis bagian mana yang dimaksud guru, bukan cuma teks
                // alasan. Kalau kosong (guru tidak menandai foto sama sekali,
                // cuma isi alasan teks), bagian ini otomatis tidak muncul.
                let fotoAnotasiHTML = '';
                if (Array.isArray(data.fotoAnotasiRevisi) && data.fotoAnotasiRevisi.length > 0) {
                    window._galeriFotoAnotasiRevisi = window._galeriFotoAnotasiRevisi || {};
                    window._galeriFotoAnotasiRevisi[data.id] = data.fotoAnotasiRevisi;
                    fotoAnotasiHTML = `
                        <div class="p-2.5 bg-amber-50 border-2 border-amber-300 rounded-xl">
                            <span class="text-[10px] font-bold text-amber-700 uppercase tracking-wide"><i class="fa-solid fa-pen-nib mr-1"></i> Ditandai Guru -- Perhatikan Bagian Berwarna:</span>
                            <div class="grid grid-cols-4 gap-1.5 mt-1.5">
                                ${data.fotoAnotasiRevisi.map((src, idx) => `<img loading="lazy" decoding="async" src="${src}" onclick="bukaGaleriFotoTugasSiswa('${data.id}', ${idx}, true)" class="w-full h-14 object-cover rounded-lg border-2 border-amber-400 shadow-sm cursor-zoom-in">`).join('')}
                            </div>
                        </div>`;
                }
                statusActionHTML = `
                    <div class="space-y-3 w-full sm:w-auto bg-white p-4 rounded-xl border border-amber-200 shadow-sm">
                        ${revisiBannerHTML}
                        ${fotoAnotasiHTML}
                        ${fotoSebelumnyaHTML}
                        <div class="flex flex-col gap-1">
                            <label class="text-[11px] font-bold text-slate-700"><i class="fa-solid fa-camera mr-1 text-amber-600"></i> Unggah Ulang Foto Tugas / Catatan:</label>
                            <input type="file" id="input-foto-siswa-${data.id}" accept="image/*" multiple onchange="tambahFotoTugasSiswa('${data.id}', this)" class="text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer">
                            <span id="label-jumlah-foto-${data.id}" class="text-[10px] text-slate-400"></span>
                        </div>
                        <div id="preview-foto-siswa-${data.id}" class="grid grid-cols-4 gap-1.5 hidden"></div>
                        <div id="peringatan-foto-${data.id}" class="peringatan-foto-kosong hidden">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <span>Foto tugas belum dipilih. Unggah foto dulu sebelum mengirim!</span>
                        </div>
                        <button onclick="kirimTugasSiswa('${data.id}')" id="btn-kirim-tugas-${data.id}" class="w-full sm:w-auto px-5 py-2.5 bg-amber-600 text-white font-bold text-xs rounded-xl shadow-md hover:bg-amber-700 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i> Kirim Ulang Tugas
                        </button>
                    </div>`;
            } else if (isExpired) {
                statusActionHTML = `
                    <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-start gap-2.5 shadow-sm w-full">
                        <i class="fa-solid fa-lock text-sm mt-0.5 shrink-0"></i>
                        <span class="leading-relaxed">Waktu Habis (${batasWaktuTugas}). Tugas kini berstatus <u class="font-bold">Kedaluwarsa</u> &amp; tercatat "Tidak Dikerjakan" di riwayatmu -- tidak dapat dikirim lagi, tapi tugasnya tetap tersimpan (bukan dihapus).</span>
                    </div>`;
            } else {
                statusActionHTML = `
                    <div class="space-y-3 w-full sm:w-auto bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                        <div class="flex flex-col gap-1">
                            <label class="text-[11px] font-bold text-slate-700"><i class="fa-solid fa-camera mr-1 text-blue-600"></i> Unggah Foto Tugas / Catatan (boleh pilih banyak sekaligus, atau tambah bertahap):</label>
                            <input type="file" id="input-foto-siswa-${data.id}" accept="image/*" multiple onchange="tambahFotoTugasSiswa('${data.id}', this)" class="text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer">
                            <span id="label-jumlah-foto-${data.id}" class="text-[10px] text-slate-400"></span>
                        </div>
                        <div id="preview-foto-siswa-${data.id}" class="grid grid-cols-4 gap-1.5 hidden"></div>
                        <div id="peringatan-foto-${data.id}" class="peringatan-foto-kosong hidden">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <span>Foto tugas belum dipilih. Unggah foto dulu sebelum mengirim!</span>
                        </div>
                        <button onclick="kirimTugasSiswa('${data.id}')" id="btn-kirim-tugas-${data.id}" class="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-md hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i> Kirim Tugas Sekarang
                        </button>
                    </div>`;
            }

            const _dtSudahKirim = !!(data.studentSubmitted || data.sudahMengumpulkan);
            const _dtStatusKelas = pelanggaranAktifSekarang ? 'bad' : (isRevisiExpired ? 'bad' : (data.keputusanGuru === 'revisi' ? 'warn' : (_dtSudahKirim ? 'ok' : (isExpired ? 'bad' : (data.isViewedByStudent ? 'info' : 'warn')))));
            const _dtStatusTeks = pelanggaranAktifSekarang ? 'Terkunci (Pelanggaran Aktif)' : (isRevisiExpired ? 'Kedaluwarsa (Tidak Dikerjakan)' : (data.keputusanGuru === 'revisi' ? 'Perlu Revisi' : (_dtSudahKirim ? 'Sudah Dikirim' : (isExpired ? 'Kedaluwarsa (Tidak Dikerjakan)' : (data.isViewedByStudent ? 'Sedang Dikerjakan' : 'Belum Dikerjakan')))));
            const _dtInisial = String(namaGuruTugas || '?').replace(/<[^>]*>/g, '').trim().charAt(0).toUpperCase() || '?';
            const _dtKunciHTML = pelanggaranAktifSekarang ? `
                <div class="dt-lock" role="status">
                    <span class="dt-lock-pill"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/></svg> Terkunci &middot; Pelanggaran aktif</span>
                    <p>Pelanggaran aktif kamu masih berjalan, jadi tugas ini belum bisa dikumpulkan. <b>Hubungi Guru atau Wali Kelas</b> agar kamu bisa mengumpulkannya kembali.</p>
                </div>` : '';

            return `
                <div class="dt-card" data-task-id="${data.id}">
                    <span class="dt-tag">${tipeKonten}</span>
                    <h4 class="dt-title">${judulTugas}</h4>
                    <div class="dt-by"><span class="dt-av"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7z"/></svg></span><span>Diberikan oleh <b>${namaGuruTugas}</b></span></div>
                    <div class="dt-chips">
                        <span class="dt-chip dt-due"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg> Batas: ${batasWaktuTugas}${/wib\s*$/i.test(batasWaktuTugas.trim()) ? '' : ' WIB'}</span>
                        ${(!_dtSudahKirim && !isExpired) ? `
                        <span id="inline-countdown-tugas-${data.id}" class="inline-countdown-tugas-item dt-chip dt-left countdown-aman state-ok">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                            <span id="inline-countdown-time-${data.id}" class="dt-left-time">Menghitung...</span>
                            <span id="inline-countdown-dot-${data.id}" class="countdown-dot countdown-aman dt-dot"></span>
                        </span>` : ''}
                    </div>
                    <section class="dt-brief">
                        <h5 class="dt-brief-h"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/></svg> Instruksi tugas</h5>
                        <p class="dt-brief-text">${deskripsiTugas}</p>
                        ${teacherImageHTML}
                        ${voiceNoteHTML}
                    </section>
                    ${_dtKunciHTML}
                    <div class="dt-foot">
                        <span class="dt-status dt-status-${_dtStatusKelas}">Status: ${_dtStatusTeks}</span>
                        ${statusActionHTML}
                    </div>
                </div>
            `;
        }

        function kirimTugasSiswa(taskId) {
            const tasks = getTasksSiswa();
            const data = tasks.find(t => t.id === taskId);
            if (!data) return;

            const now = getAccurateNow();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentSeconds = String(now.getSeconds()).padStart(2, '0');
            const currentTimeString = `${currentHours}:${currentMinutes}`;
            const currentFullTimeString = `${currentTimeString}:${currentSeconds}`;
            const batasWaktuTugas = data.deadline || data.deadlineDate || '16:51';

            let isExpired = false;
            if (batasWaktuTugas) {
                let cleanDeadline = batasWaktuTugas.trim();
                if (cleanDeadline.includes("Pukul")) {
                    let parts = cleanDeadline.split("Pukul");
                    let datePart = parts[0].trim();
                    let timePart = parts[1].replace("WIB", "").trim();
                    let targetDateTime = new Date(`${datePart}T${timePart}:00`);
                    if (!isNaN(targetDateTime.getTime()) && now.getTime() > targetDateTime.getTime()) {
                        isExpired = true;
                    }
                } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(":")) {
                    if (currentFullTimeString >= `${cleanDeadline}:00`) isExpired = true;
                } else {
                    const deadlineTime = new Date(cleanDeadline).getTime();
                    if (!isNaN(deadlineTime) && now.getTime() > deadlineTime) isExpired = true;
                }
            }

            if (isExpired) {
                tampilkanToast('Gagal! Batas waktu pengumpulan ("' + batasWaktuTugas + '") sudah lewat. Tugas otomatis terkunci.', 'error');
                renderLiveTaskContent();
                return;
            }

            // FITUR TAMBAHAN: guard kedua -- selain di renderKartuTugas() yang
            // sudah mengganti formulir jadi pesan terkunci begitu batas waktu
            // revisi lewat (lihat revisiSudahKedaluwarsa()), cek ulang di sini
            // supaya kiriman TIDAK bisa lolos lewat cara apa pun kalau batas
            // revisinya sudah lewat.
            if (revisiSudahKedaluwarsa(data, now)) {
                tampilkanToast('Gagal! Batas waktu revisi (' + (data.batasRevisiGuruFormatted || '-') + ') sudah lewat. Tugas ini otomatis dihitung "Tidak Dikerjakan".', 'error');
                renderLiveTaskContent();
                return;
            }

            // FITUR TAMBAHAN: guard pertahanan kedua -- selain tombol kirim yang
            // sudah diganti jadi pesan terkunci di renderKartuTugas() saat status
            // Pelanggaran Aktif, cek ulang di sini juga supaya tugas TIDAK bisa
            // kekirim lewat cara apa pun selama statusnya masih aktif.
            if ((typeof window.pelanggaranSiswaSedangAktif === 'function') && window.pelanggaranSiswaSedangAktif()) {
                tampilkanToast('Gagal! Tugas ini terkunci karena kamu masih berstatus Pelanggaran Aktif. Selesaikan dulu dengan guru/wali kelas.', 'error');
                renderLiveTaskContent();
                return;
            }

            const daftarFotoTerpilih = (window._fotoTugasSementara && window._fotoTugasSementara[taskId]) || [];

            if (daftarFotoTerpilih.length === 0) {
                // Belum ada foto -> jangan lanjut kirim, TITIK. Guard ini dicek ulang
                // dari nol setiap kali tombol diklik, jadi diklik berapa kali pun tugas
                // TIDAK akan pernah terkirim selama foto belum diunggah.
                tampilkanPeringatanFotoKosong(taskId);
                return;
            }

            sembunyikanPeringatanFotoKosong(taskId);
            simpanDataTugasFinal(taskId, daftarFotoTerpilih, now);
        }

        // Menampilkan kotak peringatan merah "foto belum dipilih" di kartu tugas terkait,
        // plus animasi getar singkat supaya kelihatan jelas kalau tombolnya beneran diklik
        // tapi ditolak. Timer auto-hide sebelumnya (kalau ada, dari klik-klik beruntun)
        // dibatalkan dulu supaya durasi tampilnya konsisten tiap kali diklik ulang.
        window._timerPeringatanFotoKosong = window._timerPeringatanFotoKosong || {};
        function tampilkanPeringatanFotoKosong(taskId) {
            const el = document.getElementById(`peringatan-foto-${taskId}`);
            if (!el) return;

            el.classList.remove('hidden');
            el.classList.remove('goyang-peringatan');
            void el.offsetWidth; // trik restart animasi CSS walau class-nya sama
            el.classList.add('goyang-peringatan');

            if (window._timerPeringatanFotoKosong[taskId]) {
                clearTimeout(window._timerPeringatanFotoKosong[taskId]);
            }
            window._timerPeringatanFotoKosong[taskId] = setTimeout(() => {
                sembunyikanPeringatanFotoKosong(taskId);
            }, 4000);
        }

        function sembunyikanPeringatanFotoKosong(taskId) {
            const el = document.getElementById(`peringatan-foto-${taskId}`);
            if (el) el.classList.add('hidden');
            if (window._timerPeringatanFotoKosong && window._timerPeringatanFotoKosong[taskId]) {
                clearTimeout(window._timerPeringatanFotoKosong[taskId]);
                delete window._timerPeringatanFotoKosong[taskId];
            }
        }

        // Foto yang sudah dipilih siswa (sebelum tombol "Kirim" ditekan) ditampung di sini per
        // taskId, supaya siswa bisa milih foto berkali-kali (nambah bertahap) tanpa foto
        // sebelumnya ke-reset, dan jumlah foto yang bisa dikirim tidak dibatasi.
        window._fotoTugasSementara = window._fotoTugasSementara || {};

        // Foto dikompres lewat canvas sebelum disimpan: sisi terpanjang dibatasi ke 2000px dan
        // dieksport sebagai JPEG kualitas 0.90. Ini jauh mengecilkan ukuran file dibanding foto
        // asli kamera HP (yang bisa 3000-4000px & beberapa MB), tapi resolusi & kualitasnya masih
        // cukup tinggi supaya tulisan tangan/teks di foto tugas tetap kebaca jelas -- termasuk
        // saat guru zoom sampai 4x di lightbox (dashboard_guru.js), 2000px kasih "ruang napas"
        // lebih lega dibanding 1600px sebelum mulai terasa soft/upscaled.
        function kompresGambarUntukTugas(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const SISI_MAKS = 2000;
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
                        resolve(canvas.toDataURL('image/jpeg', 0.90));
                    };
                    img.onerror = () => reject(new Error('Gagal memuat gambar'));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error('Gagal membaca file'));
                reader.readAsDataURL(file);
            });
        }

        async function tambahFotoTugasSiswa(taskId, inputEl) {
            const files = Array.from((inputEl && inputEl.files) || []).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) return;

            if (!window._fotoTugasSementara[taskId]) window._fotoTugasSementara[taskId] = [];

            const labelEl = document.getElementById(`label-jumlah-foto-${taskId}`);
            const btnKirim = document.getElementById(`btn-kirim-tugas-${taskId}`);
            if (labelEl) labelEl.innerText = `Memproses ${files.length} foto...`;
            if (btnKirim) btnKirim.disabled = true;
            if (window.SkSiswa) SkSiswa.ubin(document.getElementById(`preview-foto-siswa-${taskId}`), files.length);

            for (const file of files) {
                try {
                    const hasilKompres = await kompresGambarUntukTugas(file);
                    window._fotoTugasSementara[taskId].push(hasilKompres);
                } catch (err) {
                    console.error('Gagal memproses salah satu foto:', err);
                }
            }

            if (inputEl) inputEl.value = ''; // supaya siswa bisa pilih lagi buat nambah foto lain
            if (btnKirim) btnKirim.disabled = false;
            if (window._fotoTugasSementara[taskId].length > 0) sembunyikanPeringatanFotoKosong(taskId);
            renderPreviewFotoTugasSiswa(taskId);
            perbaruiBadgeTugasSaja(); // badge "Sedang Dikerjakan (Draft)" ikut naik tanpa ganggu form yang sedang diisi
        }

        function renderPreviewFotoTugasSiswa(taskId) {
            const container = document.getElementById(`preview-foto-siswa-${taskId}`);
            const labelEl = document.getElementById(`label-jumlah-foto-${taskId}`);
            const daftarFoto = window._fotoTugasSementara[taskId] || [];

            if (labelEl) labelEl.innerText = daftarFoto.length > 0 ? `${daftarFoto.length} foto siap dikirim` : '';
            if (!container) return;

            if (daftarFoto.length === 0) {
                container.innerHTML = '';
                container.classList.add('hidden');
                return;
            }
            container.classList.remove('hidden');
            container.innerHTML = daftarFoto.map((src, i) => `
                <div class="relative group">
                    <img loading="lazy" decoding="async" src="${src}" class="w-full h-14 object-cover rounded-lg border border-slate-200 shadow-sm">
                    <button type="button" onclick="hapusFotoTugasSementara('${taskId}', ${i})" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center shadow-md">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `).join('');
        }

        function hapusFotoTugasSementara(taskId, index) {
            if (!window._fotoTugasSementara[taskId]) return;
            window._fotoTugasSementara[taskId].splice(index, 1);
            renderPreviewFotoTugasSiswa(taskId);
            perbaruiBadgeTugasSaja(); // badge "Sedang Dikerjakan (Draft)" ikut turun kalau foto draft dihapus semua
        }

        // CATATAN PERBAIKAN: dulu fungsi ini nulis studentSubmitted/studentImages
        // langsung ke OBJEK TUGAS di daftar tasks_<KELAS> -- yaitu SATU flag yang
        // dibagi rata ke SELURUH siswa sekelas. Akibatnya begitu SATU siswa kirim
        // tugas, siswa lain di kelas yang sama (dan Dashboard Guru) ikut kebaca
        // "sudah kumpul" walau mereka belum pernah login/upload apa pun.
        // Sekarang pengumpulan dikirim ke /api/tugas/submit yang menyimpan status
        // PER AKUN (per username, lihat tugas_submission_store di app.py) --
        // supaya kirim tugas oleh satu siswa TIDAK PERNAH menandai siswa lain.
        function simpanDataTugasFinal(taskId, imagesArray, nowObj) {
            const btnKirim = document.getElementById(`btn-kirim-tugas-${taskId}`);
            if (btnKirim) btnKirim.disabled = true;

            const _prevKirim = document.getElementById(`preview-foto-siswa-${taskId}`);
            if (window.SkSiswa) SkSiswa.unggah(_prevKirim, true);

            // ANTRIAN OFFLINE (antrian_tugas_offline.js): kiriman disimpan dulu di
            // IndexedDB lalu dikirim ke /api/tugas/submit. Kalau internet putus /
            // server sibuk (429, 5xx) / koneksi terlalu lambat, hasilnya 'antri':
            // layar HP tetap menampilkan tugas terkirim, tapi request-nya menunggu
            // dan dikirim otomatis begitu internet kembali. Kalau modul tidak
            // termuat, jatuh ke kirim langsung seperti versi lama.
            const proses = window.AntrianTugas
                ? window.AntrianTugas.kirim(taskId, imagesArray, nowObj)
                : fetch('/api/tugas/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId, images: imagesArray })
                })
                    .then(res => res.json())
                    .then(h => (h && h.success)
                        ? { status: 'terkirim', waktu: h.waktu }
                        : { status: 'ditolak', pesan: (h && h.message) || 'terjadi kesalahan di server.' })
                    .catch(() => ({ status: 'ditolak', pesan: 'Cek koneksi lalu coba lagi.' }));

            proses
                .then(hasil => {
                    if (window.SkSiswa) SkSiswa.unggah(_prevKirim, false);
                    if (btnKirim) btnKirim.disabled = false;

                    if (hasil.status === 'ditolak') {
                        if (window.AntrianTugas) window.AntrianTugas.cabutRiwayat(taskId);
                        tampilkanToast('Gagal mengirim tugas: ' + hasil.pesan, 'error');
                        return;
                    }

                    const jamDetail = hasil.waktu || (String(nowObj.getHours()).padStart(2, '0') + ':' +
                        String(nowObj.getMinutes()).padStart(2, '0') + ':' +
                        String(nowObj.getSeconds()).padStart(2, '0') + ' WIB');
                    const masihAntri = hasil.status === 'antri';

                    // Cache status pengumpulan MILIK SENDIRI di memori supaya render
                    // kartu tugas langsung update tanpa perlu fetch ulang; sumber
                    // kebenarannya tetap server (lihat mergeStatusTugasSendiri()).
                    // `menunggu: true` = masih di antrian offline, belum sampai server.
                    window._statusTugasSendiri = window._statusTugasSendiri || {};
                    window._statusTugasSendiri[taskId] = {
                        submitted: true,
                        waktu: jamDetail,
                        images: imagesArray,
                        menunggu: masihAntri
                    };

                    if (masihAntri) {
                        tampilkanToast('Tugas tersimpan di HP (' + jamDetail + '). Internet belum stabil, tugas akan dikirim otomatis begitu tersambung (maksimal 3 jam, lewat dari itu tidak diterima). Jangan hapus data browser ya.', 'warning', 7000);
                        triggerDynamicIsland("Tugas Masuk Antrian");
                    } else {
                        tampilkanToast('Tugas berhasil dikirim pada pukul ' + jamDetail + '!', 'sukses');
                        triggerDynamicIsland("Tugas Berhasil Dikirim!");
                    }

                    // Bersihkan foto sementara di memori (fotonya sudah aman di server
                    // atau di antrian IndexedDB).
                    if (window._fotoTugasSementara) delete window._fotoTugasSementara[taskId];

                    // Tutup modal bulat tugas (kalau terbuka) lalu arahkan siswa ke
                    // sub-tab "Riwayat/Selesai" di tab Tugas & Catatan. Sub-tab di-set
                    // DULU sebelum switchTab('tugas') karena render pertama di dalam
                    // switchTab() memakai window._subTabTugasAktif.
                    const overlayBulatTugasSetelahKirim = document.getElementById('modal-bulat-tugas');
                    if (overlayBulatTugasSetelahKirim && !overlayBulatTugasSetelahKirim.classList.contains('hidden')) {
                        tutupBulatTugas();
                    }
                    window._subTabTugasAktif = 'selesai';
                    switchTab('tugas');
                });
        }

        // Ambil status pengumpulan tugas MILIK SENDIRI dari server (per akun,
        // bukan flag sekelas) dan "timpakan" ke objek tugas sebelum dirender,
        // supaya kartu tugas menampilkan status ASLI akun yang sedang login.
        // Sekarang ikut menyertakan 'dilihat' (isViewedByStudent) -- lihat
        // tandaiTugasDibukaJikaPerlu() & /api/tugas/dibaca -- supaya status
        // "Sedang Dikerjakan" juga akurat & bertahan lintas refresh/perangkat,
        // bukan cuma status "Sudah Dikirim" seperti sebelumnya.
        window._statusTugasSendiri = window._statusTugasSendiri || {};
        function mergeStatusTugasSendiri(tasks) {
            return tasks.map(t => {
                const cache = window._statusTugasSendiri[t.id];
                if (cache && cache.submitted) {
                    return Object.assign({}, t, {
                        studentSubmitted: true,
                        sudahMengumpulkan: true,
                        waktuKirim: cache.waktu,
                        studentImages: cache.images,
                        studentImage: cache.images && cache.images[0],
                        isViewedByStudent: true, // sudah kirim otomatis berarti sudah pernah dibaca
                        // FITUR "REVISI": keputusan guru ('ditolak'/'revisi'/null) atas
                        // pengumpulan ini, dikirim server bareng field submitted/images
                        // di atas (lihat /api/tugas/submission/<id> & tugas_submission_store
                        // di app.py). Kalau 'revisi', kartu tugas dibuka lagi buat upload
                        // ulang (lihat kategoriStatusTugas() & renderKartuTugas()) --
                        // begitu siswa kirim ulang, field ini otomatis kosong lagi karena
                        // di-reset server-side di api_tugas_submit().
                        keputusanGuru: cache.keputusan || null,
                        alasanKeputusanGuru: cache.alasanKeputusan || null,
                        // FITUR TAMBAHAN: batas waktu revisi (opsional, diisi guru
                        // lewat "Minta Revisi" di Dashboard Guru) -- null berarti
                        // tidak ada batas waktu khusus buat revisi ini. Dibaca
                        // dari field yang sama persis dgn app.py (batas_revisi/
                        // batas_revisi_formatted).
                        batasRevisiGuru: cache.batas_revisi || null,
                        batasRevisiGuruFormatted: cache.batas_revisi_formatted || null,
                        // FITUR TAMBAHAN: foto tugas yang sudah dicoret/dilingkari
                        // guru dengan warna (lewat kanvas di modal "Minta Revisi &
                        // Tandai Foto" di Dashboard Guru) -- dibaca dari field yang
                        // sama persis dgn app.py (foto_anotasi_revisi). null/[]
                        // berarti guru tidak menandai foto apa pun, cuma alasan teks
                        // biasa -- ditampilkan menggantikan foto polos di banner
                        // revisi (lihat revisiBannerHTML) kalau ADA isinya.
                        fotoAnotasiRevisi: Array.isArray(cache.foto_anotasi_revisi) ? cache.foto_anotasi_revisi : null
                    });
                }
                if (cache && cache.dilihat) {
                    // Sudah pernah dibuka tapi belum dikirim -> "Sedang Dikerjakan".
                    return Object.assign({}, t, {
                        studentSubmitted: false,
                        sudahMengumpulkan: false,
                        studentImages: undefined,
                        studentImage: undefined,
                        isViewedByStudent: true
                    });
                }
                // Belum ada cache di memori -> tanya server di BACKGROUND (bukan
                // sinkron/blocking lagi -- lihat catatan besar di getSync() soal
                // kenapa XHR synchronous berbahaya). Fungsi ini tetap balik nilai
                // "belum dikumpulkan/belum dibuka" SEKARANG JUGA (instan, tidak
                // menunggu), dan kalau ternyata server bilang sudah pernah
                // dikumpulkan ATAU dibuka, hasilnya disimpan ke cache + dashboard
                // di-render ulang sekali begitu datanya sampai -- jadi tetap
                // akurat, cuma tidak nge-freeze.
                // PERBAIKAN EFISIENSI REQUEST: sebelumnya hasil "belum dikumpulkan/
                // belum dibuka" tidak pernah disimpan, jadi tugas yang sama ditanyakan
                // ULANG ke server tiap kali fungsi ini dipanggil (termasuk tiap tick
                // polling 8 detik) selama tugasnya belum dikerjakan siswa -- ini sumber
                // utama banjir request /api/tugas/submission/<id> yang bikin 429.
                // Sekarang dikasih jeda minimum JEDA_CEK_ULANG_STATUS_TUGAS_MS antar
                // pengecekan buat tugas ID yang sama, TIDAK mengubah hasil/logika status
                // yang ditampilkan -- cuma menunda seberapa sering server ditanya ulang.
                if (!window._sedangCekStatusTugas) window._sedangCekStatusTugas = {};
                if (!window._terakhirCekStatusTugas) window._terakhirCekStatusTugas = {};
                const JEDA_CEK_ULANG_STATUS_TUGAS_MS = 60000;
                const terakhirDicekTugasIni = window._terakhirCekStatusTugas[t.id] || 0;
                const barusanDicekTugasIni = (Date.now() - terakhirDicekTugasIni) < JEDA_CEK_ULANG_STATUS_TUGAS_MS;
                if (!window._sedangCekStatusTugas[t.id] && !barusanDicekTugasIni) {
                    window._sedangCekStatusTugas[t.id] = true;
                    fetch(`/api/tugas/submission/${encodeURIComponent(t.id)}`)
                        .then(res => res.ok ? res.json() : null)
                        .then(res => {
                            window._terakhirCekStatusTugas[t.id] = Date.now();
                            if (res && res.ok !== false && res.data && (res.data.submitted || res.data.dilihat)) {
                                window._statusTugasSendiri[t.id] = res.data;
                                try { if (typeof renderLiveTaskContent === 'function') renderLiveTaskContent(); } catch (e) {}
                            }
                        })
                        .catch(e => console.warn('Gagal cek status pengumpulan tugas milik sendiri:', t.id, e))
                        .finally(() => { delete window._sedangCekStatusTugas[t.id]; });
                }
                // Belum pernah dikirim/dibuka akun ini -> pastikan tidak kebawa
                // flag lama dari skema sekelas (tasks_<KELAS>) yang mungkin
                // masih ada di data.
                return Object.assign({}, t, {
                    studentSubmitted: false,
                    sudahMengumpulkan: false,
                    studentImages: undefined,
                    studentImage: undefined,
                    isViewedByStudent: false
                });
            });
        }

        // Catatan optimasi performa:
        // Dulu fungsi ini (jalan tiap 1 detik) ikut memanggil renderTodaySchedule()
        // DAN renderLiveTaskContent() setiap detik. renderLiveTaskContent() membangun
        // ulang seluruh innerHTML kartu tugas (termasuk elemen <input>, <img>, <audio>)
        // — kalau ini terjadi tiap detik SAAT siswa sedang scroll/mengisi form di tab
        // Tugas, browser harus terus reflow & re-paint sehingga terasa patah-patah/lag,
        // scroll ikut "tersentak", dan foto/preview yang sedang diproses bisa hilang.
        // Sekarang: jam tetap update tiap detik (murah, cuma ganti teks), sedangkan
        // render berat lainnya di-throttle supaya cuma jalan saat benar-benar perlu:
        // - renderTodaySchedule(): cukup tiap pergantian menit (status jadwal cuma
        //   berubah per menit, bukan per detik).
        // - renderLiveTaskContent(): TIDAK lagi dipanggil di sini. Countdown per-kartu
        //   sudah ditangani terpisah oleh updateGlobalCountdown() yang meng-update
        //   teks/kelas secara langsung tanpa membangun ulang DOM. Render penuh tetap
        //   terjadi otomatis saat: buka tab Tugas, ada tugas baru/ditarik guru
        //   (event 'storage' & sinkronisasi berkala), atau tugas berhasil dikirim.
        // ===== Sapaan banner beranda ("Selamat Pagi/Siang/Sore/Malam") ngikutin
        // jam realtime (getAccurateNow(), sumber jam yang sama dgn jam header) —
        // jadi otomatis ganti teks pas jam device lewat batas antar sapaan,
        // tanpa perlu refresh halaman. 4 kategori: 00:00-10:59 Pagi,
        // 11:00-14:59 Siang, 15:00-17:59 Sore, 18:00-23:59 Malam.
        function dapatkanSapaanWaktu(now) {
            const jam = now.getHours();
            if (jam < 11) return 'Selamat Pagi';
            if (jam < 15) return 'Selamat Siang';
            if (jam < 18) return 'Selamat Sore';
            return 'Selamat Malam';
        }

        let _sapaanTerakhirDitampilkan = null;
        function updateSapaanBanner(now) {
            const sapaan = dapatkanSapaanWaktu(now);
            if (sapaan === _sapaanTerakhirDitampilkan) return;
            _sapaanTerakhirDitampilkan = sapaan;
            document.querySelectorAll('.teks-sapaan-waktu-efektif').forEach(el => { el.textContent = sapaan; });
        }

        let _menitTerakhirDitampilkan = null;
        function updateHeaderClock() {
            const now = getAccurateNow();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const clockEl = document.getElementById('header-realtime-clock');
            if (clockEl) clockEl.innerText = `${hours}:${minutes}:${seconds} WIB`;
            updateSapaanBanner(now);

            if (minutes !== _menitTerakhirDitampilkan) {
                _menitTerakhirDitampilkan = minutes;

                const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                const teksTanggal = now.toLocaleDateString('id-ID', options);

                const dateEl = document.getElementById('header-realtime-date');
                if (dateEl) dateEl.innerText = teksTanggal;

                // Teks di kartu "Jadwal Hari Ini" disinkronkan dari sumber jam yang
                // sama (getAccurateNow) supaya harinya tidak pernah beda dgn jam
                // realtime di header, walau device dibiarkan terbuka lewat tengah malam.
                const currentDateEl = document.getElementById('current-date-text');
                if (currentDateEl) currentDateEl.innerText = teksTanggal;

                renderTodaySchedule();
                checkTaskBadgeStatus();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            loadSavedProfilePhoto();
            updateHeaderClock();
            updateTaskCounter();
            renderStreakLoginHarian();
            renderTugasTerdekat();
            checkTaskBadgeStatus();
            setInterval(updateHeaderClock, 1000);
        });

        


/* ============================================================================
   TRANSKRIP VOICE NOTE TUGAS (Voice-to-Text) -- SISI SISWA
   ============================================================================
   Setiap <audio data-vn> (voice note di kartu tugas, lihat voiceNoteHTML di
   atas) otomatis diberi kotak "Transkrip Suara" di bawahnya -- SELALU muncul,
   supaya jelas statusnya (menyiapkan / siap / gagal / voice note lama).
   Teks diambil dari GET /api/vn-tugas/<id>/transkrip; kalimat yang sedang
   diucapkan disorot mengikuti audio, dan bisa diklik untuk loncat ke bagian
   itu -- jadi kalau suara guru kecil, isinya tetap bisa dibaca.
   Pemasangan dilakukan lewat MutationObserver, jadi kartu tugas yang dirender
   ulang tetap dapat transkripnya tanpa perlu memanggil apa pun manual.
   Voice note lama (tanpa id transkrip) menampilkan keterangan, bukan kotak kosong.
   ============================================================================ */
(function () {
    'use strict';

    var cacheSelesai = {}; // vnId -> transkrip (hindari fetch ulang saat kartu dirender ulang)

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmt(detik) {
        detik = Math.max(0, Math.floor(detik || 0));
        return Math.floor(detik / 60) + ':' + String(detik % 60).padStart(2, '0');
    }

    function pasangCSS() {
        if (document.getElementById('vn-transkrip-css')) return;
        var st = document.createElement('style');
        st.id = 'vn-transkrip-css';
        st.textContent = [
            '.vn-tr{margin-top:8px;border:1px solid #bfdbfe;border-radius:12px;background:#fff;overflow:hidden;}',
            '.vn-tr-head{display:flex;align-items:center;gap:6px;padding:7px 12px;font-size:11px;font-weight:700;color:#1d4ed8;border-bottom:1px solid #dbeafe;}',
            '.vn-tr-body{max-height:150px;overflow-y:auto;padding:6px;position:relative;}',
            '.vn-tr-info{padding:8px 10px;font-size:12px;color:#64748b;}',
            '.vn-tr-seg{display:flex;gap:8px;padding:6px 8px;border-radius:8px;font-size:13px;line-height:1.45;color:#475569;cursor:pointer;transition:background .15s,color .15s;}',
            '.vn-tr-seg:hover{background:#eff6ff;}',
            '.vn-tr-seg.aktif{background:#dbeafe;color:#1e3a8a;font-weight:600;}',
            '.vn-tr-t{flex-shrink:0;font-size:11px;color:#94a3b8;font-variant-numeric:tabular-nums;padding-top:2px;min-width:30px;}',
            '.vn-tr-seg.aktif .vn-tr-t{color:#2563eb;}',
            '.vn-tr-kata{border-radius:4px;transition:background .1s,color .1s;}',
            '.vn-tr-kata.kata-aktif{background:#60a5fa;color:#fff;padding:0 2px;}',
            '.vn-tr-kata-ragu{color:#94a3b8;font-style:italic;}'
        ].join('');
        document.head.appendChild(st);
    }

    function pasang(audioEl) {
        var vnId = audioEl.getAttribute('data-vn-id');
        if (audioEl.__vnTerpasang) return;
        audioEl.__vnTerpasang = true;
        pasangCSS();

        var kotak = document.createElement('div');
        kotak.className = 'vn-tr';
        kotak.innerHTML =
            '<div class="vn-tr-head"><i class="fa-solid fa-closed-captioning"></i> Transkrip Suara</div>' +
            '<div class="vn-tr-body"><div class="vn-tr-info" role="status" aria-label="Menyiapkan transkrip"><div class="sk-line sk-w80"></div><div class="sk-line sk-w60" style="margin-top:8px"></div><div class="sk-line sk-w45" style="margin-top:8px"></div></div></div>';
        audioEl.insertAdjacentElement('afterend', kotak);
        var body = kotak.querySelector('.vn-tr-body');

        var segmen = [], elSeg = [], aktif = -1;
        var elKataPerSeg = [], aktifKata = -1; // highlight halus per-kata DI DALAM kalimat aktif

        if (!vnId) {
            body.innerHTML = '<div class="vn-tr-info">Voice note ini belum punya transkrip teks (dibuat sebelum fitur ini ada, atau upload transkrip gagal saat dikirim). Minta guru merekam ulang voice note-nya.</div>';
            return;
        }

        function info(teks) { body.innerHTML = '<div class="vn-tr-info">' + esc(teks) + '</div>'; }

        function render() {
            if (!segmen.length) { info('Tidak ada ucapan yang terdeteksi pada rekaman ini.'); return; }
            body.innerHTML = segmen.map(function (s, i) {
                // Kalau ada timestamp per-kata (words), pecah jadi <span> per kata supaya
                // bisa disorot halus satu-satu; kalau tidak ada (mis. segmen yg diblok penuh
                // krn ragu, atau data lama sebelum fitur ini ada), tampilkan teks polos --
                // tetap jalan normal, cuma tanpa highlight per-kata.
                var isiTeks = (s.words && s.words.length)
                    ? s.words.map(function (w, j) {
                        var kls = 'vn-tr-kata' + (w.text === '[...]' ? ' vn-tr-kata-ragu' : '');
                        return '<span class="' + kls + '" data-w="' + j + '">' + esc(w.text) + '</span>';
                    }).join(' ')
                    : esc(s.text);
                return '<div class="vn-tr-seg" data-i="' + i + '"><span class="vn-tr-t">' + fmt(s.start) + '</span><span class="vn-tr-teks">' + isiTeks + '</span></div>';
            }).join('');
            elSeg = Array.prototype.slice.call(body.querySelectorAll('.vn-tr-seg'));
            elKataPerSeg = elSeg.map(function (el) { return Array.prototype.slice.call(el.querySelectorAll('.vn-tr-kata')); });
            aktifKata = -1;
            body.onclick = function (e) {
                var elKata = e.target.closest('.vn-tr-kata');
                var elBlok = e.target.closest('.vn-tr-seg');
                if (!elBlok) return;
                var i = Number(elBlok.getAttribute('data-i'));
                var s = segmen[i];
                if (!s) return;
                // Klik kata spesifik -> loncat ke waktu kata itu (lebih presisi);
                // klik area lain di kalimat -> tetap loncat ke awal kalimat seperti biasa.
                var waktuTuju = s.start;
                if (elKata && s.words) {
                    var w = s.words[Number(elKata.getAttribute('data-w'))];
                    if (w) waktuTuju = w.start;
                }
                audioEl.currentTime = waktuTuju;
                audioEl.play().catch(function () {});
            };
        }

        // Kalimat = patokan UTAMA pindah blok/scroll (batasnya dari jeda hening/VAD,
        // paling stabil). Kata = cuma penegas visual DI DALAM kalimat yang lagi aktif,
        // supaya timestamp kata yg kadang meleset dikit gak bikin seluruh baris ikut
        // salah lompat. Semua dihitung dari currentTime audio yang sudah ada -- tidak
        // ada request/polling tambahan ke server sama sekali.
        function sorotKata(waktu, idxSeg) {
            var kataArr = (segmen[idxSeg] && segmen[idxSeg].words) || [];
            var elKata = elKataPerSeg[idxSeg] || [];
            if (!kataArr.length || !elKata.length) return;
            var idxKata = -1;
            for (var k = 0; k < kataArr.length; k++) {
                if (kataArr[k].start <= waktu + 0.05) idxKata = k; else break;
            }
            if (idxKata === aktifKata) return;
            if (aktifKata >= 0 && elKata[aktifKata]) elKata[aktifKata].classList.remove('kata-aktif');
            aktifKata = idxKata;
            if (aktifKata >= 0 && elKata[aktifKata]) elKata[aktifKata].classList.add('kata-aktif');
        }

        function sorot(waktu) {
            if (!segmen.length) return;
            var idx = -1;
            for (var i = 0; i < segmen.length; i++) {
                if (segmen[i].start <= waktu + 0.15) idx = i; else break;
            }
            if (idx !== aktif) {
                if (aktif >= 0 && elSeg[aktif]) elSeg[aktif].classList.remove('aktif');
                if (aktif >= 0 && aktifKata >= 0 && elKataPerSeg[aktif] && elKataPerSeg[aktif][aktifKata]) {
                    elKataPerSeg[aktif][aktifKata].classList.remove('kata-aktif');
                }
                aktifKata = -1;
                aktif = idx;
                if (aktif >= 0 && elSeg[aktif]) {
                    var el = elSeg[aktif];
                    el.classList.add('aktif');
                    // scroll di dalam kotak saja, halaman tidak ikut bergeser
                    body.scrollTop = Math.max(0, el.offsetTop - body.offsetTop - body.clientHeight / 2 + el.clientHeight / 2);
                }
            }
            if (aktif >= 0) sorotKata(waktu, aktif);
        }

        audioEl.addEventListener('timeupdate', function () { sorot(audioEl.currentTime); });
        audioEl.addEventListener('seeked', function () { sorot(audioEl.currentTime); });
        audioEl.addEventListener('ended', function () {
            if (aktif >= 0 && elSeg[aktif]) elSeg[aktif].classList.remove('aktif');
            aktif = -1;
        });

        if (cacheSelesai[vnId]) { segmen = cacheSelesai[vnId]; render(); return; }

        var jeda = [3000, 5000, 8000], percobaan = 0, MAKS = 30;
        function ambil() {
            if (!document.body.contains(audioEl)) return; // kartu sudah dibuang
            fetch('/api/vn-tugas/' + encodeURIComponent(vnId) + '/transkrip', { credentials: 'same-origin' })
                .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; }, function () { return { ok: false, status: res.status, j: {} }; }); })
                .then(function (r) {
                    if (r.status === 404) { kotak.remove(); return; } // sudah dihapus guru
                    if (!r.ok || !r.j.success) { info('Transkrip tidak bisa dibuka (kode ' + r.status + '): ' + ((r.j && r.j.message) || 'ditolak server')); return; }
                    if (r.j.status === 'selesai') {
                        segmen = r.j.transkrip || [];
                        cacheSelesai[vnId] = segmen;
                        render();
                        sorot(audioEl.currentTime || 0);
                    } else if (r.j.status === 'gagal') {
                        info('Transkrip teks tidak tersedia untuk rekaman ini. Kamu tetap bisa mendengarkan suaranya.');
                    } else if (++percobaan >= MAKS) {
                        info('Transkrip belum siap. Buka ulang tugas ini beberapa saat lagi.');
                    } else {
                        setTimeout(ambil, jeda[Math.min(percobaan - 1, jeda.length - 1)]);
                    }
                })
                .catch(function () {
                    if (++percobaan >= MAKS) { info('Transkrip tidak bisa dimuat (cek koneksi).'); return; }
                    setTimeout(ambil, 8000);
                });
        }
        ambil();
    }

    function pindai(root) {
        (root || document).querySelectorAll('audio[data-vn]').forEach(pasang);
    }

    function init() {
        pindai(document);
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].addedNodes.length) { pindai(document); break; }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
