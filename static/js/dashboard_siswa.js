        function getAccurateNow() {
            return new Date();
        }

        // ============================================================
        // TOAST / FLOATING SNACKBAR -- PENGGANTI alert() BAWAAN BROWSER
        // ------------------------------------------------------------
        // Dulu SEMUA notifikasi error/sukses/peringatan (rate-limit server,
        // gagal kirim, gagal simpan, dst) pakai alert() bawaan browser --
        // muncul dialog BLOCKING di tengah layar dengan judul nama domain
        // ("el0fakhri.pythonanywhere.com says") dan WAJIB diklik "OK" dulu
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

            _pendingFetchSync[kunci] = true;
            fetch(`/api/sync/${encodeURIComponent(kunci)}`)
                .then(res => res.ok ? res.json() : null)
                .then(res => {
                    if (!res || !res.ok) return;
                    const data = (res.data === null || res.data === undefined) ? fallback : res.data;
                    _cacheSync[kunci] = data;
                    localStorage.setItem(kunci, JSON.stringify(data));
                })
                .catch(e => console.warn('Gagal ambil data dari server, pakai cadangan lokal:', kunci, e))
                .finally(() => {
                    _lastFetchAtSync[kunci] = Date.now();
                    _pendingFetchSync[kunci] = false;
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

        function checkTaskBadgeStatus() {
            const tasks = getTasksSiswa();
            const badgeEl = document.getElementById('badge-tugas-baru');
            if (!badgeEl) return;

            const adaYangBelumDilihat = tasks.some(t => !t.isViewedByStudent);
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

            return [...notifGuru, ...tugasBaru].sort((a, b) => (b._waktu || 0) - (a._waktu || 0));
        }

        function updateBadgeLonceng() {
            const badge = document.getElementById('badge-bell-dot');
            if (!badge) return;
            const adaBelumDilihat = getDaftarNotifikasiLonceng().some(n => !n.dilihat);
            badge.classList.toggle('hidden', !adaBelumDilihat);
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
                `;
                container.appendChild(row);
            });
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
                    const res = await fetch('/api/teman/relasi');
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
                const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                const efekNamaItem = getEfekNamaClass(borderItem);
                const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                const badgeDevItem = getBadgeDevHtml(borderItem);
                const fotoItem = item.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120`;

                const row = document.createElement('div');
                row.className = 'flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 transition-colors';
                row.innerHTML = `
                    <button class="btn-lihat-idcard profile-wrapper w-10 h-10 flex-shrink-0" title="Lihat statistik">
                        <img loading="lazy" decoding="async" src="${fotoItem}" class="user-avatar" alt="Avatar ${item.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.nama)}&background=e0e7ff&color=3730a3&size=120'">
                        <img loading="lazy" decoding="async" src="${borderItem.file}" class="user-border" alt="Border ${item.nama}">
                    </button>
                    <button class="btn-lihat-idcard flex-1 min-w-0 text-left">
                        <p class="text-xs font-bold truncate ${efekNamaItem || 'text-slate-800'}">${item.nama}${badgeDevItem ? ' ' + badgeDevItem : ''}</p>
                        <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${borderItem.rank || '🔰 Pemula'}</span>
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
                const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                const efekNamaItem = getEfekNamaClass(borderItem);
                const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                const badgeDevItem = getBadgeDevHtml(borderItem);
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
                        <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${borderItem.rank || '🔰 Pemula'}</span>
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

            let json;
            try {
                const res = await fetch('/api/perangkat/list');
                json = await res.json();
            } catch (e) {
                console.error('Gagal ambil data perangkat:', e);
                return;
            }
            if (!json || !json.success) return;

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
                const res = await fetch('/api/perangkat/list');
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
                    const borderItem = getSemuaBorder().find(b => b.id === item.border) || DAFTAR_BORDER_STARTER[0];
                    const efekNamaItem = getEfekNamaClass(borderItem);
                    const titleBadgeClassItem = getTitleBadgeClass(efekNamaItem);
                    const badgeDevItem = getBadgeDevHtml(borderItem);
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
                            <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassItem} truncate max-w-full">${borderItem.rank || '🔰 Pemula'}</span>
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
            try {
                const res = await fetch(`/api/teman/profil/${encodeURIComponent(username)}`);
                const json = await res.json();
                if (!json.success) {
                    tampilkanToast(json.message || 'Gagal memuat statistik siswa.', 'error');
                    return;
                }
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
                console.error('Gagal memuat ID card teman:', e);
            }
        }

        function renderIdCardTeman(profil) {
            USERNAME_ID_CARD_TERBUKA = profil.username;

            // Border, foto, efek nama & title -- petakan id border dari server
            // (profil.border) ke objek border lengkap di frontend, pola yang
            // sama dengan hasil pencarian & entri Leaderboard Quiz.
            const borderProfil = getSemuaBorder().find(b => b.id === profil.border) || DAFTAR_BORDER_STARTER[0];
            const efekNamaProfil = getEfekNamaClass(borderProfil);
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
            if (elTitleBadge) {
                elTitleBadge.textContent = borderProfil.rank || '🔰 Pemula';
                elTitleBadge.className = `inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${getTitleBadgeClass(efekNamaProfil)}`;
            }

            const elNama = document.getElementById('idcard-nama');
            elNama.textContent = profil.nama;
            elNama.className = `font-extrabold text-sm sm:text-base leading-tight truncate max-w-full ${efekNamaProfil || 'text-slate-900'}`.trim();
            const badgeDevProfil = getBadgeDevHtml(borderProfil);
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

        /* ================= SIDEBAR MOBILE (hamburger) ================= */
        function toggleSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            const tombolLainnya = document.getElementById('btn-bottom-lainnya');
            if (!sidebar || !overlay) return;
            const sedangTerbuka = !sidebar.classList.contains('translate-y-full');
            sidebar.classList.toggle('translate-y-full');
            overlay.classList.toggle('hidden');
            if (tombolLainnya) tombolLainnya.setAttribute('aria-expanded', String(!sedangTerbuka));
        }

        function closeSidebarMobile() {
            const sidebar = document.getElementById('sidebar-utama');
            const overlay = document.getElementById('sidebar-overlay');
            const tombolLainnya = document.getElementById('btn-bottom-lainnya');
            if (!sidebar || !overlay) return;
            sidebar.classList.add('translate-y-full');
            overlay.classList.add('hidden');
            if (tombolLainnya) tombolLainnya.setAttribute('aria-expanded', 'false');
        }

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

        /* ================= ANIMASI "SEOLAH DIPILIH" SAAT BOTTOM NAV DITAHAN =================
           Saat jari menyentuh salah satu ikon bottom nav lalu digeser ke ikon
           lain TANPA dilepas, ikon yang ada di bawah jari langsung kena efek
           "picking" (membesar + tint) sebagai preview -- persis pola geser-pilih
           di menu native Android/iOS. Ini murni feedback visual; begitu jari
           dilepas, klik tetap otomatis jatuh ke tombol yang sedang disorot
           (perilaku bawaan browser untuk pointerup/touchend), jadi tidak perlu
           memicu switchTab/aksi lain secara manual dari sini. */
        (function setupAnimasiPickerBottomNav() {
            const nav = document.getElementById('bottom-nav-mobile');
            if (!nav) return;

            let sedangMenahan = false;
            let itemTersorot = null;

            function sorotItem(item) {
                if (itemTersorot === item) return;
                if (itemTersorot) itemTersorot.classList.remove('bottom-nav-item--picking');
                itemTersorot = item;
                if (itemTersorot) itemTersorot.classList.add('bottom-nav-item--picking');
            }

            function lepasSorotan() {
                sorotItem(null);
                sedangMenahan = false;
            }

            nav.addEventListener('pointerdown', (e) => {
                const item = e.target.closest('.bottom-nav-item');
                if (!item) return;
                sedangMenahan = true;
                sorotItem(item);
            });

            nav.addEventListener('pointermove', (e) => {
                if (!sedangMenahan) return;
                const elDiBawahJari = document.elementFromPoint(e.clientX, e.clientY);
                const item = elDiBawahJari ? elDiBawahJari.closest('.bottom-nav-item') : null;
                sorotItem(item && nav.contains(item) ? item : null);
            });

            nav.addEventListener('pointerup', lepasSorotan);
            nav.addEventListener('pointercancel', lepasSorotan);
            nav.addEventListener('pointerleave', () => {
                if (sedangMenahan) sorotItem(null);
            });
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

        // Kalau layar di-resize jadi ukuran desktop, pastikan overlay & state mobile ke-reset
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) {
                document.getElementById('sidebar-overlay')?.classList.add('hidden');
            }
        });

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

            // Judul halaman di header (khusus HP) -- lihat aktifkanHeaderMobileSubHalaman().
            if (tabName === 'akademik') {
                aktifkanHeaderMobileSubHalaman('Koleksi Prestasi');
            } else {
                nonaktifkanHeaderMobileSubHalaman();
            }

            if (tabName === 'tugas') {
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

            // Setiap kali tab "Cari Teman" dibuka, refresh daftar teman yang
            // sudah saling add (biar update terbaru -- mis. abis nerima
            // permintaan pertemanan di sesi/tab lain -- langsung kelihatan).
            if (tabName === 'cari-teman') {
                try {
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

        /* ================= AI SUPPORT (chat bantuan berbasis kata kunci) =================
           Belum tersambung ke API AI beneran -- ini asisten ringan client-side yang
           mencocokkan kata kunci pertanyaan siswa ke jawaban template seputar fitur
           portal. Kalau tidak ada kata kunci yang cocok, arahkan ke IT Support (WA). */
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

        function tambahBubbleBotAISupport(teks) {
            const log = document.getElementById('ai-support-chat-log');
            const bubbleBot = document.createElement('div');
            bubbleBot.className = 'flex items-start gap-2.5';
            bubbleBot.innerHTML = `
                <div class="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] flex-shrink-0"><i class="fa-solid fa-robot"></i></div>
                <div class="bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs text-slate-700 max-w-[80%]"></div>
            `;
            bubbleBot.querySelector('div.bg-slate-100').innerText = teks;
            log.appendChild(bubbleBot);
            log.scrollTop = log.scrollHeight;
        }

        function kirimChatAISupport(event) {
            event.preventDefault();
            const input = document.getElementById('input-ai-support');
            const pertanyaan = input.value.trim();
            if (!pertanyaan) return;

            const log = document.getElementById('ai-support-chat-log');

            const bubbleUser = document.createElement('div');
            bubbleUser.className = 'flex items-start gap-2.5 justify-end';
            bubbleUser.innerHTML = `
                <div class="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs max-w-[80%]"></div>
            `;
            bubbleUser.querySelector('div.bg-blue-600').innerText = pertanyaan;
            log.appendChild(bubbleUser);

            input.value = '';
            log.scrollTop = log.scrollHeight;

            // Bubble "sedang mengetik..." selama menunggu balasan dari Ollama
            const bubbleTyping = document.createElement('div');
            bubbleTyping.id = 'ai-support-typing';
            bubbleTyping.className = 'flex items-start gap-2.5';
            bubbleTyping.innerHTML = `
                <div class="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] flex-shrink-0"><i class="fa-solid fa-robot"></i></div>
                <div class="bg-slate-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs text-slate-400 max-w-[80%] italic">mengetik...</div>
            `;
            log.appendChild(bubbleTyping);
            log.scrollTop = log.scrollHeight;

            // Panggil backend Flask (/api/ai/chat), yang meneruskan ke Ollama lokal.
            // Kalau Ollama belum jalan / error, fallback otomatis ke balasAISupport()
            // (jawaban keyword-matching client-side lama) supaya chat tetap kebalas.
            fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pesan: pertanyaan })
            })
                .then(res => res.json().then(data => ({ ok: res.ok, data })))
                .then(({ ok, data }) => {
                    document.getElementById('ai-support-typing')?.remove();
                    if (ok && data.success && data.balasan) {
                        tambahBubbleBotAISupport(data.balasan);
                    } else {
                        tambahBubbleBotAISupport(balasAISupport(pertanyaan));
                    }
                })
                .catch(() => {
                    document.getElementById('ai-support-typing')?.remove();
                    tambahBubbleBotAISupport(balasAISupport(pertanyaan));
                });
        }

        function updateTaskCounter() {
            const tasks = getTasksSiswa();
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

            renderStreakTugas();
        }

        /* ================= STREAK TUGAS (menggantikan "Kehadiran Bulan Ini") =================
           Streak = jumlah tugas BERUNTUN yang berhasil dikumpulkan siswa, dihitung
           mundur dari tugas paling baru. Tugas yang deadline-nya sudah lewat TAPI
           belum dikumpulkan (bolong) memutus streak di titik itu. Tugas yang belum
           jatuh tempo (masih berjalan) dilewati saja -- tidak menambah atau memutus,
           karena belum bisa dinilai berhasil/gagalnya. */
        function hitungStreakTugas() {
            const tasks = getTasksSiswa();
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

        function renderStreakTugas() {
            const kartu = document.getElementById('kartu-streak-tugas');
            const elJumlah = document.getElementById('streak-jumlah');
            const elLabelBawah = document.getElementById('streak-label-bawah');
            if (!kartu || !elJumlah || !elLabelBawah) return;

            const streak = hitungStreakTugas();
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

            const kelompok = window._kelompokTugasTerkini || { belum: [], draft: [], selesai: [] };
            const daftar = kelompok[kategori] || [];

            if (daftar.length === 0) {
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
            const sudahDiperluas = !!window._tugasPaginasiExpanded[kategori];
            const daftarTampil = sudahDiperluas ? daftar : daftar.slice(0, BATAS_TUGAS_PER_HALAMAN);

            // Kalau tugas dalam kategori yang lagi aktif ini lebih dari 2, jangan
            // ditumpuk sebagai kartu panjang ke bawah (kesannya kayak "tabel") --
            // tampilkan sebagai baris ikon bulat kecil ke samping (bisa digeser),
            // 1 ikon = 1 tugas. Tap salah satu ikon baru kartu detailnya muncul di
            // modal dengan animasi pop-in (lihat renderBarisBulatTugas()).
            // Kalau cuma 1-2 tugas, tetap ditampilkan langsung sebagai kartu penuh
            // seperti sebelumnya -- tidak perlu diciutkan.
            window._tugasKategoriTerakhirDirender = kategori;
            if (daftarTampil.length > 2) {
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
            const bubbles = list.map((data, i) => {
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

        function tutupBulatTugas(e) {
            if (e && e.target !== e.currentTarget) return;
            const overlay = document.getElementById('modal-bulat-tugas');
            if (!overlay) return;
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

        function renderTugasTerdekat() {
            const container = document.getElementById('container-tugas-terdekat');
            if (!container) return;
            const tasks = getTasksSiswa();
            const now = getAccurateNow();

            if (tasks.length === 0) {
                container.innerHTML = `
                    <div class="p-4 sm:p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-calendar-check text-2xl mb-1 text-slate-300"></i>
                        <p class="text-xs font-medium">Belum ada tugas terdekat. Semua aman!</p>
                    </div>`;
                return;
            }

            // "Tugas Terdekat" di beranda cuma nampilin tugas yang MASIH AKTIF
            // (belum dikumpulkan & belum lewat deadline). Begitu deadline lewat &
            // tugas jadi Terkunci, tugas itu LANGSUNG DIHILANGKAN dari sini —
            // bukan malah ditampilkan status "Terkunci"-nya di halaman utama —
            // dan otomatis diganti tugas TERBARU dari guru yang masih aktif.
            const tugasAktif = tasks.filter(t => {
                if (t.studentSubmitted || t.sudahMengumpulkan) return false;
                const batasWaktu = t.deadline || t.deadlineDate || '';
                return !cekTugasSudahKedaluwarsa(batasWaktu, now);
            });

            if (tugasAktif.length > 0) {
                // Terbaru dari guru = urutkan berdasarkan waktu kirim guru, paling baru duluan.
                tugasAktif.sort((a, b) => (b.waktuKirimGuru || 0) - (a.waktuKirimGuru || 0));
                const data = tugasAktif[0];
                const jumlahTugasLain = tugasAktif.length - 1;
                const judulTugas = data.judul || data.tipe || 'Tugas Pembelajaran';
                const batasWaktu = data.deadline || data.deadlineDate || '-';
                const namaGuruTugas = data.namaGuru || data.guru || data.teacher || data.pengajar || 'Guru Mata Pelajaran';

                // Kartu "Tugas Terdekat" di beranda ini ikut disamakan dengan status
                // di tab Tugas & di Dashboard Guru -- kalau tugas SUDAH pernah dibuka
                // siswa (isViewedByStudent) tapi belum dikirim, tampilkan "Sedang
                // Dikerjakan" (biru), bukan tetap "Belum Dikerjakan" (amber).
                const sudahDibukaSiswaTerdekat = !!(data.isViewedByStudent ||
                    (window._statusTugasSendiri && window._statusTugasSendiri[data.id] && window._statusTugasSendiri[data.id].dilihat));
                const warnaTerdekat = sudahDibukaSiswaTerdekat
                    ? { bgCard: 'bg-blue-50', borderCard: 'border-blue-200', bgIcon: 'bg-blue-500', badgeText: 'text-blue-700', badgeBg: 'bg-blue-100', btnBg: 'bg-blue-600 hover:bg-blue-700', icon: 'fa-pen', label: 'Sedang Dikerjakan' }
                    : { bgCard: 'bg-amber-50', borderCard: 'border-amber-200', bgIcon: 'bg-amber-500', badgeText: 'text-amber-700', badgeBg: 'bg-amber-100', btnBg: 'bg-amber-600 hover:bg-amber-700', icon: 'fa-book-open', label: 'Belum Dikerjakan' };

                container.innerHTML = `
                    <div class="p-4 ${warnaTerdekat.bgCard} border ${warnaTerdekat.borderCard} rounded-2xl flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl ${warnaTerdekat.bgIcon} text-white flex items-center justify-center font-bold">
                                <i class="fa-solid ${warnaTerdekat.icon} text-lg"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold ${warnaTerdekat.badgeText} uppercase tracking-wider ${warnaTerdekat.badgeBg} px-2 py-0.5 rounded">${warnaTerdekat.label}</span>
                                <h4 class="font-bold text-slate-800 text-xs mt-0.5">${judulTugas}</h4>
                                <p class="text-[11px] text-slate-500">Dari: ${namaGuruTugas} • Batas: ${batasWaktu} WIB</p>
                                ${jumlahTugasLain > 0 ? `<p class="text-[10px] text-amber-600 font-bold mt-0.5">+${jumlahTugasLain} tugas lain menunggu</p>` : ''}
                            </div>
                        </div>
                        <button onclick="switchTab('tugas')" class="px-3 py-1.5 ${warnaTerdekat.btnBg} text-white font-bold text-xs rounded-xl">Kerjakan</button>
                    </div>`;
                return;
            }

            // Tidak ada tugas aktif tersisa. Kalau ternyata semuanya sudah
            // dikumpulkan, tampilkan info tugas terakhir yang dikirim sebagai
            // konfirmasi. Kalau sisanya cuma tugas yang lewat deadline & tidak
            // dikerjakan, tetap tampilkan "semua aman" (bukan status Terkunci).
            const sudahDikumpulkan = tasks.filter(t => t.studentSubmitted || t.sudahMengumpulkan);
            if (sudahDikumpulkan.length > 0) {
                sudahDikumpulkan.sort((a, b) => (b.waktuKirimGuru || 0) - (a.waktuKirimGuru || 0));
                const data = sudahDikumpulkan[0];
                container.innerHTML = `
                    <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold">
                                <i class="fa-solid fa-circle-check text-lg"></i>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider bg-emerald-100 px-2 py-0.5 rounded">Selesai</span>
                                <h4 class="font-bold text-slate-800 text-xs mt-0.5">Tugas Selesai Dikirim</h4>
                                <p class="text-[11px] text-slate-500">Waktu Kirim: ${data.waktuKirim || '-'}</p>
                            </div>
                        </div>
                        <button onclick="switchTab('tugas')" class="text-xs font-bold text-emerald-600 hover:underline">Buka</button>
                    </div>`;
                return;
            }

            container.innerHTML = `
                <div class="p-4 sm:p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                    <i class="fa-solid fa-calendar-check text-2xl mb-1 text-slate-300"></i>
                    <p class="text-xs font-medium">Belum ada tugas terdekat. Semua aman!</p>
                </div>`;
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
                    <div class="p-4 sm:p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-mug-hot text-2xl mb-1 text-slate-300"></i>
                        <p class="text-xs font-medium">${hariLibur ? `Hari ${hariIni} libur, tidak ada jadwal pelajaran.` : 'Tidak ada jadwal pelajaran hari ini.'}</p>
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
                container.innerHTML = `
                    <div class="p-5 sm:p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                        <p class="text-xs font-medium">Belum ada tugas/catatan baru dikirimkan oleh guru.</p>
                    </div>`;
                window._kelompokTugasTerkini = { belum: [], draft: [], selesai: [] };
                renderBadgeSubTabTugas(window._kelompokTugasTerkini);
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

            let teacherImageHTML = '';
            if (data.teacherImage) {
                teacherImageHTML = `
                    <div class="mt-3">
                        <p class="text-[11px] font-semibold text-slate-500 mb-1"><i class="fa-solid fa-image mr-1"></i> Lampiran Soal dari Guru:</p>
                        <img loading="lazy" decoding="async" src="${data.teacherImage}" class="max-h-64 rounded-xl border border-slate-200 object-contain shadow-sm" alt="Lampiran Guru">
                    </div>
                `;
            }

            let voiceNoteHTML = '';
            if (data.audioDataUrl) {
                voiceNoteHTML = `
                    <div class="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                        <p class="text-[11px] font-semibold text-blue-700 mb-1.5"><i class="fa-solid fa-microphone mr-1"></i> Voice Note Instruksi dari Guru:</p>
                        <audio controls preload="metadata" class="w-full h-9 rounded-lg" src="${data.audioDataUrl}"></audio>
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

            let statusActionHTML = '';
            // FITUR TAMBAHAN: kunci tugas selama siswa masih berstatus "Pelanggaran
            // Aktif" (lihat overlay & window.pelanggaranSiswaSedangAktif() di script
            // dekat penutup </body>). Hanya berlaku utk tugas yang BELUM
            // dikumpulkan/belum kedaluwarsa -- tugas yang sudah terkirim atau sudah
            // lewat deadline tetap tampil seperti biasa (statusnya sudah final).
            const pelanggaranAktifSekarang = !(data.studentSubmitted || data.sudahMengumpulkan) && !isExpired &&
                (typeof window.pelanggaranSiswaSedangAktif === 'function') && window.pelanggaranSiswaSedangAktif();

            if (data.studentSubmitted || data.sudahMengumpulkan) {
                let studentImagePreview = '';
                if (Array.isArray(data.studentImages) && data.studentImages.length > 0) {
                    studentImagePreview = `
                        <div class="mt-2">
                            <span class="text-[10px] text-slate-400">Foto Tugas Dikirim (${data.studentImages.length}):</span>
                            <div class="grid grid-cols-4 gap-1.5 mt-1">
                                ${data.studentImages.map(src => `<img loading="lazy" decoding="async" src="${src}" onclick="window.open(this.src, '_blank')" class="w-full h-14 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in">`).join('')}
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
            } else if (isExpired) {
                statusActionHTML = `
                    <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-start gap-2.5 shadow-sm w-full">
                        <i class="fa-solid fa-lock text-sm mt-0.5 shrink-0"></i>
                        <span class="leading-relaxed">Waktu Habis (${batasWaktuTugas}). Tugas kini berstatus <u class="font-bold">Kedaluwarsa</u> &amp; tercatat "Tidak Dikerjakan" di riwayatmu -- tidak dapat dikirim lagi, tapi tugasnya tetap tersimpan (bukan dihapus).</span>
                    </div>`;
            } else if (pelanggaranAktifSekarang) {
                statusActionHTML = `
                    <div class="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-start gap-2.5 shadow-sm w-full">
                        <i class="fa-solid fa-lock text-sm mt-0.5 shrink-0"></i>
                        <span class="leading-relaxed">Tugas ini terkunci -- kamu masih berstatus <u class="font-bold">Pelanggaran Aktif</u>. Selesaikan dulu dengan guru/wali kelas supaya bisa mengumpulkan tugas ini lagi.</span>
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

            return `
                <div class="p-4 sm:p-6 rounded-2xl border-2 border-blue-200 bg-blue-50/25 space-y-4 shadow-sm" data-task-id="${data.id}">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg uppercase">${tipeKonten}</span>
                        <span class="text-xs text-amber-800 font-extrabold font-mono bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl leading-snug">
                            <i class="fa-regular fa-clock mr-1"></i> Batas: ${batasWaktuTugas}${/wib\s*$/i.test(batasWaktuTugas.trim()) ? '' : ' WIB'}
                        </span>
                    </div>
                    <div class="space-y-1">
                        <h4 class="font-bold text-slate-900 text-base leading-snug">${judulTugas}</h4>
                        <p class="text-[11px] text-slate-500"><i class="fa-solid fa-chalkboard-user mr-1 text-blue-500"></i> Diberikan oleh: <span class="font-semibold text-slate-600">${namaGuruTugas}</span></p>
                    </div>
                    ${(!(data.studentSubmitted || data.sudahMengumpulkan) && !isExpired) ? `
                    <div id="inline-countdown-tugas-${data.id}" class="inline-countdown-tugas-item flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200">
                        <span id="inline-countdown-dot-${data.id}" class="countdown-dot countdown-aman"></span>
                        <span class="text-[10px] font-bold uppercase tracking-wider">Sisa Waktu Mengumpulkan</span>
                        <span id="inline-countdown-time-${data.id}" class="text-sm font-extrabold font-mono ml-auto">--:--:--</span>
                    </div>` : ''}
                    <p class="text-xs text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-200 whitespace-pre-line">${deskripsiTugas}</p>
                    ${teacherImageHTML}
                    ${voiceNoteHTML}
                    <div class="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-blue-100 gap-3">
                        <span class="text-xs font-bold ${data.studentSubmitted || data.sudahMengumpulkan ? 'text-emerald-600' : (isExpired ? 'text-rose-600' : (pelanggaranAktifSekarang ? 'text-rose-600' : (data.isViewedByStudent ? 'text-blue-600' : 'text-amber-600')))}">
                            Status: ${data.studentSubmitted || data.sudahMengumpulkan ? 'Sudah Dikirim' : (isExpired ? 'Kedaluwarsa (Tidak Dikerjakan)' : (pelanggaranAktifSekarang ? 'Terkunci (Pelanggaran Aktif)' : (data.isViewedByStudent ? 'Sedang Dikerjakan' : 'Belum Dikerjakan')))}
                        </span>
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

        // Foto dikompres lewat canvas sebelum disimpan: sisi terpanjang dibatasi ke 1600px dan
        // dieksport sebagai JPEG kualitas 0.85. Ini jauh mengecilkan ukuran file dibanding foto
        // asli kamera HP (yang bisa 3000-4000px & beberapa MB), tapi resolusi & kualitasnya masih
        // cukup tinggi supaya tulisan tangan/teks di foto tugas tetap kebaca jelas.
        function kompresGambarUntukTugas(file) {
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

        async function tambahFotoTugasSiswa(taskId, inputEl) {
            const files = Array.from((inputEl && inputEl.files) || []).filter(f => f.type.startsWith('image/'));
            if (files.length === 0) return;

            if (!window._fotoTugasSementara[taskId]) window._fotoTugasSementara[taskId] = [];

            const labelEl = document.getElementById(`label-jumlah-foto-${taskId}`);
            const btnKirim = document.getElementById(`btn-kirim-tugas-${taskId}`);
            if (labelEl) labelEl.innerText = `Memproses ${files.length} foto...`;
            if (btnKirim) btnKirim.disabled = true;

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

            fetch('/api/tugas/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: taskId, images: imagesArray })
            })
                .then(res => res.json())
                .then(hasil => {
                    if (btnKirim) btnKirim.disabled = false;
                    if (!hasil || !hasil.success) {
                        tampilkanToast('Gagal mengirim tugas: ' + ((hasil && hasil.message) || 'terjadi kesalahan di server.'), 'error');
                        return;
                    }

                    const jamDetail = hasil.waktu || (String(nowObj.getHours()).padStart(2, '0') + ':' +
                        String(nowObj.getMinutes()).padStart(2, '0') + ':' +
                        String(nowObj.getSeconds()).padStart(2, '0') + ' WIB');

                    // Cache status pengumpulan MILIK SENDIRI di memori supaya render
                    // kartu tugas langsung update tanpa perlu fetch ulang; sumber
                    // kebenarannya tetap server (lihat mergeStatusTugasSendiri()).
                    window._statusTugasSendiri = window._statusTugasSendiri || {};
                    window._statusTugasSendiri[taskId] = {
                        submitted: true,
                        waktu: jamDetail,
                        images: imagesArray
                    };

                    tampilkanToast('Tugas berhasil dikirim pada pukul ' + jamDetail + '!', 'sukses');
                    triggerDynamicIsland("Tugas Berhasil Dikirim!");

                    // Bersihkan foto sementara di memori setelah berhasil terkirim.
                    if (window._fotoTugasSementara) delete window._fotoTugasSementara[taskId];

                    renderLiveTaskContent();
                })
                .catch(err => {
                    if (btnKirim) btnKirim.disabled = false;
                    console.error('Gagal mengirim tugas ke server:', err);
                    tampilkanToast('Gagal mengirim tugas. Cek koneksi lalu coba lagi.', 'error');
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
                        isViewedByStudent: true // sudah kirim otomatis berarti sudah pernah dibaca
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
                if (!window._sedangCekStatusTugas) window._sedangCekStatusTugas = {};
                if (!window._sedangCekStatusTugas[t.id]) {
                    window._sedangCekStatusTugas[t.id] = true;
                    fetch(`/api/tugas/submission/${encodeURIComponent(t.id)}`)
                        .then(res => res.ok ? res.json() : null)
                        .then(res => {
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

        