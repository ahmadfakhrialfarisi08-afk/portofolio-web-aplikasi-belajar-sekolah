        /* ================= 1. MODE GELAP ================= */
        function toggleDarkMode() {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('ui_dark_mode', isDark ? 'true' : 'false');
            tampilkanTombolAksenTema(isDark);
        }

        function loadDarkModePreference() {
            const saved = localStorage.getItem('ui_dark_mode');
            const isDark = saved === 'true';
            if (isDark) {
                document.documentElement.classList.add('dark');
            }
            tampilkanTombolAksenTema(isDark);
        }

        // Tombol "Warna Aksen" cuma masuk akal saat Mode Terang aktif (di Mode
        // Gelap, palet warna terkunci ke Cyan Neon bawaan). SEBELUMNYA tombol ini
        // disembunyikan total saat Mode Gelap aktif -- sekarang tombolnya tetap
        // ditampilkan (biar siswa tahu opsinya ada), tapi begitu diklik saat Mode
        // Gelap aktif langsung dikasih toast pengingat pindah ke Mode Terang dulu
        // (lihat toggleDropdownAksenTema), bukan diam-diam disembunyikan.
        function tampilkanTombolAksenTema(isDark) {
            const wrapper = document.getElementById('wrapper-btn-aksen-tema');
            if (!wrapper) return;
            if (isDark) {
                const dropdown = document.getElementById('panel-aksen-tema');
                if (dropdown) dropdown.classList.add('hidden');
            }
        }

        /* ================= 1b. WARNA AKSEN (THEME SWITCHER) =================
           Panel swatch di header (tombol ikon palet). Transisi warnanya sendiri
           sudah diatur lewat CSS "html.dark, html.dark *" di atas -- di sini JS
           cuma perlu ganti atribut data-accent-theme, sisanya (animasi smooth)
           otomatis kejadian lewat CSS transition. */
        function toggleDropdownAksenTema(event) {
            if (event) event.stopPropagation();

            // Warna aksen terkunci ke Cyan Neon selama Mode Gelap aktif -- jangan
            // buka panelnya sama sekali, cukup kasih tahu lewat toast.
            if (document.documentElement.classList.contains('dark')) {
                tampilkanToastAksenTemaButuhModeTerang();
                return;
            }

            const dropdown = document.getElementById('panel-aksen-tema');
            const trigger = document.getElementById('btn-aksen-tema');
            const profileDropdown = document.getElementById('profile-dropdown');
            const bellDropdown = document.getElementById('bell-dropdown');
            const moreDropdown = document.getElementById('dropdown-more-header');
            if (!dropdown) return;

            // Tutup dropdown lain biar gak numpuk.
            if (profileDropdown) profileDropdown.classList.add('hidden');
            if (bellDropdown) bellDropdown.classList.add('hidden');
            if (moreDropdown) moreDropdown.classList.add('hidden');

            const akanDibuka = dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', String(akanDibuka));
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('panel-aksen-tema');
            const trigger = document.getElementById('btn-aksen-tema');
            if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        // Elemen-elemen yang warnanya BENAR-BENAR berubah saat aksen diganti (persis
        // selector yang di-override lewat var(--brand)/var(--brand-dark)/var(--brand-tint-*)
        // di layer "PALET BRAND BARU" di atas). Dipakai buat menghitung transition-delay
        // per elemen berdasarkan posisi horizontalnya, supaya warnanya kelihatan benar-benar
        // "disapu" bareng gelombang dari kanan ke kiri -- bukan berubah serempak di satu waktu.
        const SELEKTOR_ELEMEN_WARNA_AKSEN =
            '.bg-blue-600, .from-blue-600, .via-blue-600, .bg-blue-700, .bg-blue-50, ' +
            '.bg-blue-100, .text-blue-600, .text-blue-700, .text-blue-100, ' +
            '.border-blue-600, .border-blue-500, .border-blue-100, .shadow-blue-500, ' +
            '.bg-white, .bg-slate-50, .bg-slate-100, .border-slate-200, .border-slate-200\\/80, ' +
            '.border-slate-100, .nav-btn[aria-current="page"], .bg-white\\/90, .bg-white\\/70';

        // Durasi gelombang menyapu layar (samakan dgn animasi CSS "sapuanGelombangTema").
        const DURASI_SAPUAN_TEMA_MS = 1100;

        // Kasih tiap elemen transition-delay sebanding jaraknya dari kanan layar --
        // makin ke kanan (searah titik awal gelombang) makin cepat berubah, makin ke
        // kiri makin lama nunggu giliran, persis mengikuti arah gelombang menyapu.
        function terapkanDelaySapuanWarna() {
            const lebarLayar = window.innerWidth || document.documentElement.clientWidth || 1;
            document.querySelectorAll(SELEKTOR_ELEMEN_WARNA_AKSEN).forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return; // elemen tersembunyi, lewati
                const posisiTengah = rect.left + rect.width / 2;
                const rasioDariKanan = Math.min(1, Math.max(0, 1 - (posisiTengah / lebarLayar)));
                el.style.transitionDelay = `${(rasioDariKanan * DURASI_SAPUAN_TEMA_MS).toFixed(0)}ms`;
            });
        }

        // Bersihkan delay custom setelah sapuannya kelar, biar interaksi lain
        // (hover, dsb) balik ke durasi transisi normal seperti semula.
        function bersihkanDelaySapuanWarna() {
            document.querySelectorAll(SELEKTOR_ELEMEN_WARNA_AKSEN).forEach(el => {
                el.style.transitionDelay = '';
            });
        }

        function pilihAksenTema(nama) {
            mainkanEfekSapuanTema(nama);
            tandaiSwatchAksenAktif(nama);
            tandaiTombolRahasiaAktif(nama === 'rahasia');

            if (mainkanEfekSapuanTema.terakhirDimainkan) {
                // Efek gelombang lagi main -> warna UI beneran "diikutkan" jalannya
                // gelombang lewat delay per-elemen di atas, ganti atribut temanya
                // LANGSUNG (tanpa jeda tambahan) supaya delay per-elemen itulah yang
                // menentukan kapan tiap bagian layar berubah warna.
                // Nyalakan jendela transisi universal HANYA selama efek sapuan ini
                // benar-benar mainkan (lihat CSS ".sedang-ganti-aksen" di atas) --
                // supaya di luar momen ganti tema, elemen di seluruh dashboard tidak
                // ikut memikul watcher transisi 7-properti itu terus-menerus.
                document.documentElement.classList.add('sedang-ganti-aksen');
                terapkanDelaySapuanWarna();
                document.documentElement.setAttribute('data-accent-theme', nama);
                localStorage.setItem('ui_accent_theme', nama);
                clearTimeout(pilihAksenTema._timerBersihDelay);
                pilihAksenTema._timerBersihDelay = setTimeout(() => {
                    bersihkanDelaySapuanWarna();
                    document.documentElement.classList.remove('sedang-ganti-aksen');
                }, DURASI_SAPUAN_TEMA_MS + 500);
            } else {
                // Reduce Motion aktif / bukan Mode Terang -> ganti warna langsung tanpa efek.
                document.documentElement.setAttribute('data-accent-theme', nama);
                localStorage.setItem('ui_accent_theme', nama);
            }
        }

        function tandaiSwatchAksenAktif(nama) {
            document.querySelectorAll('.swatch-aksen-tema').forEach(el => {
                el.classList.toggle('aktif', el.getAttribute('data-aksen') === nama);
            });
        }

        // Dipicu oleh tombol "Rahasia" di header: kalau mode belum aktif,
        // munculin logo jurusan di tengah layar dengan animasi elegan lalu
        // ganti tema dashboard (sidebar + halaman utama) ke nuansa
        // biru-abu-putih yang "hidup" (blob melayang + kerlip, lihat
        // #dekorasi-tema-rahasia). Tema sebelumnya disimpan dulu supaya
        // kalau tombolnya diklik LAGI, mode ini mati dan tema balik lagi
        // ke yang dipakai sebelumnya dengan transisi warna yang mulus
        // (durasi transisinya sudah diatur global, lihat blok "Transisi
        // warna yang smooth" di CSS) -- tanpa nongolin logo lagi.
        // Helper BERSAMA -- dipakai oleh tombol "Rahasia" & tombol "Warna Aksen",
        // dua-duanya cuma masuk akal di Mode Terang (lihat selector CSS
        // "html:not(.dark)[data-accent-theme=...]" di atas: baik tema rahasia
        // maupun swatch warna aksen terkunci/gak berlaku sama sekali saat Mode
        // Gelap aktif). Daripada siswa klik tapi tampilannya diam saja (kelihatan
        // kayak tombolnya rusak), kasih toast pengingat suruh pindah ke Mode
        // Terang dulu, dengan judul/pesan yang bisa disesuaikan per fitur.
        //
        // idToast di sini SENGAJA tetap (bukan diberi akhiran timestamp seperti
        // toast lain di dashboard ini) -- soalnya kalau tombolnya di-spam klik
        // berkali-kali saat Mode Gelap masih aktif, kita CUMA mau satu toast yang
        // tampil (gak numpuk jadi banyak kartu identik). Klik berikutnya selama
        // toast yang sama masih ada cuma menggoyangnya + reset timer auto-hide,
        // supaya siswa tetap "kerasa" responsnya tiap klik walau toast-nya cuma satu.
        // Getar perangkat (kalau didukung, umumnya browser mobile) barengan efek
        // goyang toast -- pembatalan try/catch soalnya beberapa browser bisa
        // melempar error kalau dipanggil di luar interaksi pengguna langsung,
        // dan fitur ini murni pemanis, jadi gagal diam-diam saja tidak masalah.
        function _getarkanPerangkat() {
            try {
                if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    navigator.vibrate(60);
                }
            } catch (e) { /* abaikan -- getar cuma pemanis, bukan fitur inti */ }
        }

        function _tampilkanToastPerluModeTerang(idToast, judul, pesan) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            // Timer auto-hide disimpan PER toast (bukan satu variabel dibagi
            // semua toast) -- soalnya toast Rahasia & toast Warna Aksen bisa
            // saja tampil bersamaan (dua tombol beda), jadi timer salah satu
            // gak boleh ikut mereset/membatalkan timer punya toast yang lain.
            if (!_tampilkanToastPerluModeTerang._timers) {
                _tampilkanToastPerluModeTerang._timers = {};
            }
            const timers = _tampilkanToastPerluModeTerang._timers;

            const toastLama = document.getElementById(idToast);
            if (toastLama) {
                // Toast yang sama masih tampil -> jangan bikin baru, cukup goyangkan
                // lagi (restart animasi CSS-nya dari awal tiap dipanggil) & reset
                // timer auto-hide-nya seolah baru saja muncul.
                toastLama.classList.remove('notif-toast-goyang');
                void toastLama.offsetWidth; // reflow, paksa animasi replay dari awal
                toastLama.classList.add('notif-toast-goyang');
                _getarkanPerangkat();

                clearTimeout(timers[idToast]);
                timers[idToast] = setTimeout(() => {
                    toastLama.classList.add('notif-keluar');
                    setTimeout(() => toastLama.remove(), 300);
                }, 6000);
                return;
            }

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik notif-toast-kuning';
            toast.id = idToast;

            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-circle-exclamation"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">${judul}</p>
                        <p class="text-[11px] text-amber-600 mt-1 leading-relaxed font-semibold">${pesan}</p>
                    </div>
                    <button onclick="document.getElementById('${idToast}')?.remove()" class="text-slate-300 hover:text-slate-500 flex-shrink-0" title="Tutup">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);
            _getarkanPerangkat();
            clearTimeout(timers[idToast]);
            timers[idToast] = setTimeout(() => {
                toast.classList.add('notif-keluar');
                setTimeout(() => toast.remove(), 300);
            }, 6000);
        }

        function tampilkanToastRahasiaButuhModeTerang() {
            _tampilkanToastPerluModeTerang(
                'toast-rahasia-mode-terang',
                'Ganti ke Mode Terang Dulu',
                'Mode Rahasia cuma bisa dilihat di Mode Terang. Matikan Mode Gelap dulu, baru coba klik tombol Rahasia lagi ya.'
            );
        }

        function tampilkanToastAksenTemaButuhModeTerang() {
            _tampilkanToastPerluModeTerang(
                'toast-aksen-tema-mode-terang',
                'Ganti ke Mode Terang Dulu',
                'Pilihan Warna Aksen cuma berlaku di Mode Terang -- di Mode Gelap, palet warnanya terkunci ke Cyan Neon. Matikan Mode Gelap dulu buat ganti warna aksen ya.'
            );
        }

        function bukaRahasiaJurusan() {
            // Kalau Mode Gelap lagi aktif, tema "rahasia" gak akan pernah kelihatan
            // (lihat komentar di tampilkanToastRahasiaButuhModeTerang di atas) --
            // jadi hentikan di sini sebelum overlay/animasi apa pun sempat main,
            // dan minta siswa pindah ke Mode Terang dulu lewat toast.
            if (document.documentElement.classList.contains('dark')) {
                tampilkanToastRahasiaButuhModeTerang();
                return;
            }

            // Status "aktif/tidak" dipegang lewat flag sendiri (bukan cuma baca atribut
            // data-accent-theme) karena sekarang tema barunya baru benar-benar dipasang
            // belakangan (nunggu animasi reveal, lihat komentar di bawah). Kalau tombol
            // ini diklik lagi buat MATIIN sebelum tema sempat kepasang, cek yang cuma
            // ngandelin atribut bakal salah kira modenya "belum aktif" -> warnanya jadi
            // nyangkut di tengah, gak balik ke default. Flag ini gak nunggu animasi,
            // jadi klik ON/OFF selalu direspons dengan benar sesuai urutan klik terakhir.
            const sedangAktif = !!bukaRahasiaJurusan._modeAktif;

            if (sedangAktif) {
                bukaRahasiaJurusan._modeAktif = false;

                // Kalau lagi nunggu animasi reveal (tema belum sempat kepasang), batalkan
                // dulu semua timer & sembunyikan overlay-nya SEKARANG, supaya gak ada
                // animasi reveal yang lanjut jalan sendiri padahal mode-nya udah dimatikan.
                clearTimeout(bukaRahasiaJurusan._timerFadeOut);
                clearTimeout(bukaRahasiaJurusan._timerSembunyi);
                const overlayAktif = document.getElementById('overlay-logo-rahasia');
                if (overlayAktif && !overlayAktif.classList.contains('hidden')) {
                    overlayAktif.classList.add('hidden');
                    overlayAktif.classList.remove('overlay-rahasia-tampil', 'overlay-rahasia-fadeout');
                }

                const temaSebelum = localStorage.getItem('ui_accent_theme_sebelum_rahasia') || TEMA_AKSEN_DEFAULT;
                pilihAksenTema(temaSebelum);
                tandaiTombolRahasiaAktif(false);
                return;
            }

            bukaRahasiaJurusan._modeAktif = true;

            const temaSekarang = localStorage.getItem('ui_accent_theme') || TEMA_AKSEN_DEFAULT;
            if (temaSekarang !== 'rahasia') {
                localStorage.setItem('ui_accent_theme_sebelum_rahasia', temaSekarang);
            }
            tandaiTombolRahasiaAktif(true);

            const overlay = document.getElementById('overlay-logo-rahasia');
            if (!overlay) { pilihAksenTema('rahasia'); return; }

            clearTimeout(bukaRahasiaJurusan._timerFadeOut);
            clearTimeout(bukaRahasiaJurusan._timerSembunyi);

            // Tampilan dashboard di BELAKANG overlay sengaja DIBIARKAN dulu (tema lama)
            // selama animasi reveal logo main -- supaya nggak ada dua animasi (reveal +
            // sapuan warna tema) numpuk barengan dan kelihatan lag/berat. Tema baru cuma
            // diterapkan SEKALI, tepat begitu overlay ini selesai & hilang total, jadi
            // efek sapuannya "keliatan" geser pelan-pelan pas layar udah bersih dari kartu
            // reveal -- bukan nyelonong bareng animasinya.
            bukaRahasiaJurusan._temaDiterapkan = false;
            const terapkanTemaSekaliSaja = () => {
                if (bukaRahasiaJurusan._temaDiterapkan) return;
                // Kalau di antara delay ini pengguna sempat matiin lagi modenya, jangan
                // paksa terapin tema rahasia -- biarkan cabang OFF di atas yang menang.
                if (!bukaRahasiaJurusan._modeAktif) return;
                bukaRahasiaJurusan._temaDiterapkan = true;
                pilihAksenTema('rahasia');
            };
            bukaRahasiaJurusan._terapkanTemaSekaliSaja = terapkanTemaSekaliSaja;

            overlay.classList.remove('hidden', 'overlay-rahasia-fadeout');
            void overlay.offsetWidth; // reflow, supaya animasi masuk dari awal tiap diklik ulang
            overlay.classList.add('overlay-rahasia-tampil');

            bukaRahasiaJurusan._timerFadeOut = setTimeout(() => {
                overlay.classList.add('overlay-rahasia-fadeout');
                // Tema diterapkan di SINI (pas overlay baru mulai memudar), bukan
                // nunggu overlay-nya bener-bener hilang -- soalnya proses sapuan
                // warnanya sendiri makan waktu ~1.1 detik. Kalau baru dipicu setelah
                // overlay hilang total, sapuannya jadi keliatan sebagai "transisi
                // kedua" yang nongol belakangan (lag). Dengan dimulai barengan
                // fade-out overlay (yang masih menutupi layar), sapuannya kelar
                // SEMBUNYI di balik overlay -- begitu overlay hilang, warnanya udah
                // final, gak ada susulan lagi.
                terapkanTemaSekaliSaja();
            }, 2400);

            bukaRahasiaJurusan._timerSembunyi = setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('overlay-rahasia-tampil', 'overlay-rahasia-fadeout');
            }, 4000);
        }

        // Menutup kartu reveal logo lebih awal (dipicu tombol X atau klik area
        // gelap di luar kartu) tanpa mematikan Mode Jurusan itu sendiri --
        // temanya tetap biru-abu-putih sampai tombol "Rahasia" di header
        // diklik lagi. Timer auto fade-out/sembunyi yang lama dibatalkan dulu
        // supaya tidak tabrakan dengan penutupan manual ini.
        function tutupOverlayRahasiaDini() {
            const overlay = document.getElementById('overlay-logo-rahasia');
            if (!overlay || overlay.classList.contains('hidden')) return;

            clearTimeout(bukaRahasiaJurusan._timerFadeOut);
            clearTimeout(bukaRahasiaJurusan._timerSembunyi);

            // Ditutup manual sebelum animasi kelar sendiri -- tetap terapkan tema
            // barunya sekarang (kalau belum), jangan sampai macet di tema lama.
            if (bukaRahasiaJurusan._terapkanTemaSekaliSaja) {
                bukaRahasiaJurusan._terapkanTemaSekaliSaja();
            }

            overlay.classList.add('overlay-rahasia-fadeout');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('overlay-rahasia-tampil', 'overlay-rahasia-fadeout');
            }, 1000);
        }

        function tandaiTombolRahasiaAktif(aktif) {
            const btn = document.getElementById('btn-rahasia-jurusan');
            if (btn) btn.classList.toggle('rahasia-btn-aktif', aktif);
        }

        // Catatan: loadAksenTemaPreference() baru benar-benar DIPANGGIL belakangan
        // (DOMContentLoaded, lihat jauh di bawah -- setelah const TEMA_AKSEN_DEFAULT
        // didefinisikan), jadi walau fungsinya DIDEFINISIKAN di sini, referensi ke
        // TEMA_AKSEN_DEFAULT di bawah aman dari temporal-dead-zone.
        function loadAksenTemaPreference() {
            const saved = localStorage.getItem('ui_accent_theme') || TEMA_AKSEN_DEFAULT;
            document.documentElement.setAttribute('data-accent-theme', saved);
            tandaiSwatchAksenAktif(saved);
            tandaiTombolRahasiaAktif(saved === 'rahasia');
            bukaRahasiaJurusan._modeAktif = (saved === 'rahasia');
        }

        // Kode warna hex per tema -- dipakai buat mewarnai efek gelombang & kupu-kupu
        // (elemen efek ini murni JS-generated, jadi gak bisa nebeng var(--brand) CSS
        // langsung, harus dikasih tau warnanya lewat custom property inline).
        const PALET_AKSEN_HEX = {
            pink: '#ec4899', yellow: '#eab308', blue: '#3b82f6',
            green: '#22c55e', purple: '#a855f7', cyan: '#06b6d4',
            putih: '#0670b6', rahasia: '#123a5c', jurusan: '#0670b6'
        };

        // Tema default dashboard: kombinasi biru + kuning sesuai logo Jurusan TKJ.
        // Dipakai sebagai fallback tiap kali kode perlu tahu "tema bawaan" --
        // baik saat belum ada preferensi tersimpan di localStorage, maupun saat
        // Mode Jurusan ("Rahasia") dimatikan dan perlu balik ke tema sebelumnya.
        const TEMA_AKSEN_DEFAULT = 'jurusan';

        function pengaturanReduceMotionAktif() {
            return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }

        // Efek "gelombang energi neon + swarm kupu-kupu" yang menyapu layar dari
        // kanan ke kiri tiap kali warna aksen diganti. Cuma dimainkan di Mode Terang
        // (karena ganti warna aksen memang cuma tersedia di sana -- Mode Gelap
        // terkunci ke Cyan Neon) dan otomatis dimatikan kalau pengguna
        // mengaktifkan preferensi "Reduce Motion" di sistemnya.
        function mainkanEfekSapuanTema(nama) {
            mainkanEfekSapuanTema.terakhirDimainkan = false;
            if (document.documentElement.classList.contains('dark')) return;
            if (pengaturanReduceMotionAktif()) return;

            const panggung = document.getElementById('efek-transisi-tema');
            if (!panggung) return;
            mainkanEfekSapuanTema.terakhirDimainkan = true;

            const warna = PALET_AKSEN_HEX[nama] || '#06b6d4';
            panggung.style.setProperty('--glow-c', warna);
            panggung.innerHTML = '';

            const gelombang = document.createElement('div');
            gelombang.className = 'gelombang-tema';
            panggung.appendChild(gelombang);

            const tepiGelombang = document.createElement('div');
            tepiGelombang.className = 'garis-tepi-gelombang';
            panggung.appendChild(tepiGelombang);

            // Swarm kupu-kupu neon: masing-masing dapat ukuran, posisi vertikal,
            // jeda terbang, & pola "goyang" acak sendiri supaya kelihatan hidup
            // (bukan baris kupu-kupu yang seragam & kaku).
            const JUMLAH_KUPU = 7;
            const svgKupu = `<svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="8" cy="10" rx="7" ry="8" fill="currentColor" opacity="0.85"/>
                <ellipse cx="18" cy="10" rx="7" ry="8" fill="currentColor" opacity="0.85"/>
                <ellipse cx="8" cy="18" rx="5" ry="5.5" fill="currentColor" opacity="0.6"/>
                <ellipse cx="18" cy="18" rx="5" ry="5.5" fill="currentColor" opacity="0.6"/>
                <rect x="12" y="5" width="2" height="17" rx="1" fill="currentColor" opacity="0.9"/>
            </svg>`;
            for (let i = 0; i < JUMLAH_KUPU; i++) {
                const kupu = document.createElement('div');
                kupu.className = 'kupu-tema';
                const ukuran = 16 + Math.random() * 14;
                const posisiAtas = 8 + Math.random() * 78;
                const jedaTerbang = Math.random() * 300;
                const goyang = (Math.random() * 46 - 23).toFixed(1);
                kupu.style.cssText = `top:${posisiAtas}%; width:${ukuran}px; height:${ukuran}px; color:${warna}; animation-delay:${jedaTerbang}ms; --goyang:${goyang}px;`;
                kupu.innerHTML = svgKupu;
                panggung.appendChild(kupu);
            }

            // Bersihkan panggung setelah animasi selesai supaya DOM gak numpuk
            // kalau pengguna ganti-ganti warna dengan cepat berkali-kali.
            clearTimeout(mainkanEfekSapuanTema._timerBersih);
            mainkanEfekSapuanTema._timerBersih = setTimeout(() => {
                panggung.innerHTML = '';
            }, 1300);
        }

        /* ================= 2. COUNTDOWN TIMER TUGAS ================= */

        // Mengubah teks deadline (mis. "2026-08-10 Pukul 23:59 WIB" atau "23:59")
        // menjadi objek Date. Dipakai bareng oleh hitung ms sisa waktu & breakdown tahun/bulan/hari.
        function parseDeadlineTugas(batasWaktuTugas) {
            if (!batasWaktuTugas) return null;
            let cleanDeadline = batasWaktuTugas.trim();
            let target = null;

            if (cleanDeadline.includes('Pukul')) {
                let parts = cleanDeadline.split('Pukul');
                let datePart = parts[0].trim();
                let timePart = parts[1].replace('WIB', '').trim();
                let d = new Date(`${datePart}T${timePart}:00`);
                if (!isNaN(d.getTime())) target = d;
            } else if (cleanDeadline.length <= 5 && cleanDeadline.includes(':')) {
                let [hh, mm] = cleanDeadline.split(':').map(Number);
                let d = new Date();
                d.setHours(hh, mm, 0, 0);
                target = d;
            } else {
                let d = new Date(cleanDeadline);
                if (!isNaN(d.getTime())) target = d;
            }
            return target;
        }

        function hitungSisaWaktuTugas(batasWaktuTugas, now) {
            const target = parseDeadlineTugas(batasWaktuTugas);
            if (!target) return null;
            return target.getTime() - now.getTime();
        }

        // Breakdown sisa waktu jadi tahun/bulan/hari/jam/menit/detik, dihitung dari
        // kalender asli (bukan cuma dibagi 365/30 hari) supaya jumlah hari tiap bulan akurat.
        function hitungBreakdownSisaWaktu(targetDate, now) {
            if (!targetDate || now.getTime() >= targetDate.getTime()) return null;

            let years = targetDate.getFullYear() - now.getFullYear();
            let months = targetDate.getMonth() - now.getMonth();
            let days = targetDate.getDate() - now.getDate();
            let hours = targetDate.getHours() - now.getHours();
            let minutes = targetDate.getMinutes() - now.getMinutes();
            let seconds = targetDate.getSeconds() - now.getSeconds();

            if (seconds < 0) { seconds += 60; minutes--; }
            if (minutes < 0) { minutes += 60; hours--; }
            if (hours < 0) { hours += 24; days--; }
            if (days < 0) {
                const hariBulanSebelumnya = new Date(targetDate.getFullYear(), targetDate.getMonth(), 0).getDate();
                days += hariBulanSebelumnya;
                months--;
            }
            if (months < 0) { months += 12; years--; }

            return { years, months, days, hours, minutes, seconds };
        }

        function formatSisaWaktu(breakdown) {
            if (!breakdown) return 'Waktu habis';
            const { years, months, days, hours, minutes, seconds } = breakdown;
            const pad = (n) => String(n).padStart(2, '0');
            let parts = [];
            if (years > 0) parts.push(`${years}th`);
            if (years > 0 || months > 0) parts.push(`${months}bln`);
            if (years > 0 || months > 0 || days > 0) parts.push(`${days}hr`);
            parts.push(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
            return parts.join(' ');
        }

        // Nyimpen id tugas yang notif "Segera Kumpulkan"-nya udah ditampilkan, supaya
        // toast-nya cuma muncul SEKALI waktu tugas itu baru masuk zona kuning (10 menit),
        // bukan tiap detik selama updateGlobalCountdown() jalan. Direset lagi ke aman
        // (dihapus dari Set) kalau tugasnya balik ke zona hijau, mis. guru nambah waktu.
        const notifWaspadaSudahTampil = new Set();

        function updateGlobalCountdown() {
            // Countdown ditampilkan inline di dalam SETIAP kartu tugas yang masih aktif
            // (tab Tugas & Catatan) — jadi di-loop per tugas, bukan cuma satu widget.
            const tasks = getTasksSiswa();
            let perluRerender = false;

            // Ambang batas status berdasarkan sisa waktu.
            const BATAS_BAHAYA_MS = 5 * 60 * 1000;    // <= 5 menit -> merah, kedap-kedip (makin dekat 2 menit/0 detik, makin cepat kedipnya)
            const BATAS_WASPADA_MS = 10 * 60 * 1000;  // <= 10 menit -> kuning, solid + notif "Segera Kumpulkan"
            const KEDIP_LAMBAT = 1.2;  // detik, di awal zona bahaya (5 menit tersisa)
            const KEDIP_CEPAT = 0.25;  // detik, saat mendekati 0 detik

            tasks.forEach(data => {
                if (data.studentSubmitted || data.sudahMengumpulkan) return;

                const wrap = document.getElementById(`inline-countdown-tugas-${data.id}`);
                if (!wrap) return; // kartu tugas ini tidak sedang tampil

                const batasWaktuTugas = data.deadline || data.deadlineDate || '';
                const now = getAccurateNow();
                const targetDate = parseDeadlineTugas(batasWaktuTugas);
                const sisaMs = targetDate ? targetDate.getTime() - now.getTime() : null;

                const timeEl = document.getElementById(`inline-countdown-time-${data.id}`);
                const dot = document.getElementById(`inline-countdown-dot-${data.id}`);

                if (sisaMs === null || sisaMs <= 0) {
                    if (timeEl) timeEl.innerText = 'Waktu habis';
                    perluRerender = true; // paksa re-render supaya status tugas ini berubah jadi terkunci
                    return;
                }

                let statusClass = 'countdown-aman'; // masih jauh -> hijau solid
                if (sisaMs <= BATAS_BAHAYA_MS) statusClass = 'countdown-bahaya'; // <= 5 menit -> merah kedap-kedip
                else if (sisaMs <= BATAS_WASPADA_MS) statusClass = 'countdown-waspada'; // <= 10 menit -> kuning solid

                // Baru masuk zona kuning (10 menit tersisa) -> tampilkan notif "Segera
                // Kumpulkan" sekali aja. Kalau balik ke hijau (mis. guru nambah waktu),
                // hapus dari daftar supaya bisa notif lagi kalau nanti mepet lagi.
                if (statusClass === 'countdown-waspada' && !notifWaspadaSudahTampil.has(data.id)) {
                    notifWaspadaSudahTampil.add(data.id);
                    tampilkanToastSegeraKumpulkan(data, hitungBreakdownSisaWaktu(targetDate, now));
                } else if (statusClass === 'countdown-aman') {
                    notifWaspadaSudahTampil.delete(data.id);
                }

                wrap.classList.remove('countdown-aman', 'countdown-waspada', 'countdown-bahaya');
                wrap.classList.add(statusClass);

                if (dot) {
                    dot.classList.remove('countdown-aman', 'countdown-waspada', 'countdown-bahaya');
                    dot.classList.add(statusClass);
                }

                // Dorong warnanya lewat inline style juga (bukan cuma lewat class CSS di
                // atas) -- inline style itu prioritas TERTINGGI, jadi nggak mungkin kalah
                // ketiban utility class Tailwind (bg-slate-50, dll) apapun yang terjadi.
                // Ini yang benerin bug lama "kotaknya kelihatan pucat/putih terus".
                const WARNA_COUNTDOWN = {
                    'countdown-aman':    { bg: '#10b981', border: '#059669' },
                    'countdown-waspada': { bg: '#f59e0b', border: '#b45309' },
                    'countdown-bahaya':  { bg: '#f43f5e', border: '#be123c' }
                };
                const warna = WARNA_COUNTDOWN[statusClass];
                wrap.style.setProperty('background-color', warna.bg, 'important');
                wrap.style.setProperty('border-color', warna.border, 'important');
                wrap.querySelectorAll('span, i').forEach(el => el.style.setProperty('color', '#ffffff', 'important'));

                // Makin dekat ke deadline (di dalam zona bahaya), makin cepat kedapnya —
                // kecepatan kedip "mengikuti" berkurangnya waktu, bukan kecepatan tetap.
                if (statusClass === 'countdown-bahaya') {
                    const rasio = Math.max(0, Math.min(1, sisaMs / BATAS_BAHAYA_MS));
                    const durasiKedip = (KEDIP_CEPAT + rasio * (KEDIP_LAMBAT - KEDIP_CEPAT)).toFixed(2);
                    wrap.style.setProperty('--blink-speed', `${durasiKedip}s`);
                    if (dot) dot.style.setProperty('--blink-speed', `${durasiKedip}s`);
                } else {
                    wrap.style.removeProperty('--blink-speed');
                    if (dot) dot.style.removeProperty('--blink-speed');
                }

                const breakdown = hitungBreakdownSisaWaktu(targetDate, now);
                if (timeEl) timeEl.innerText = formatSisaWaktu(breakdown);
            });

            if (perluRerender) renderLiveTaskContent();
        }

        /* ================= 3. RIWAYAT PENGUMPULAN ================= */
        function getRiwayatPengumpulan() {
            return JSON.parse(localStorage.getItem(`riwayat_pengumpulan_${ID_SISWA_AKTIF}`) || '[]');
        }

        function tambahRiwayatPengumpulan(judul, tipe, waktuKirim, nowObj, taskId, status) {
            const riwayat = getRiwayatPengumpulan();
            const tanggalStr = nowObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

            riwayat.unshift({
                judul: judul || 'Tugas Pembelajaran',
                tipe: tipe || '📌 Tugas Utama',
                tanggal: tanggalStr,
                jam: waktuKirim,
                status: status || 'Berhasil Dikirim',
                timestamp: nowObj.getTime(),
                taskId: taskId || null
            });

            localStorage.setItem(`riwayat_pengumpulan_${ID_SISWA_AKTIF}`, JSON.stringify(riwayat));
            renderRiwayatPengumpulan();
        }

        function renderRiwayatPengumpulan() {
            const container = document.getElementById('container-riwayat-pengumpulan');
            if (!container) return;
            const riwayat = getRiwayatPengumpulan();

            if (riwayat.length === 0) {
                container.innerHTML = `
                    <div class="p-4 sm:p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400">
                        <i class="fa-solid fa-clock-rotate-left text-2xl mb-1 text-slate-300"></i>
                        <p class="text-xs font-medium">Belum ada riwayat pengumpulan tugas.</p>
                    </div>`;
                return;
            }

            // Entri riwayat berstatus 'Tidak Dikerjakan' (tugas kedaluwarsa yang tidak
            // sempat dikumpulkan) ditandai label MERAH -- berbeda dari entri berhasil
            // kirim (HIJAU) -- supaya tetap kelihatan jelas sebagai bagian dari riwayat,
            // bukan dihilangkan begitu saja dari arsip siswa.
            container.innerHTML = riwayat.map(item => {
                const terlambat = item.status === 'Tidak Dikerjakan' || item.status === 'Lewat Waktu';
                const iconWrapClass = terlambat ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600';
                const iconClass = terlambat ? 'fa-solid fa-xmark' : 'fa-solid fa-check';
                const badgeClass = terlambat ? 'text-rose-700 bg-rose-100' : 'text-emerald-700 bg-emerald-100';
                const badgeIcon = terlambat ? '❌' : '✅';
                const labelWaktu = terlambat ? `Batas Waktu ${item.jam}` : `Pukul ${item.jam}`;
                return `
                <div class="riwayat-item flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200 ${terlambat ? 'border-l-rose-500' : ''}">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-lg ${iconWrapClass} flex items-center justify-center flex-shrink-0">
                            <i class="${iconClass}"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-slate-800 text-xs">${item.judul}</h4>
                            <p class="text-[11px] text-slate-500">${item.tanggal} • ${labelWaktu}</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-extrabold ${badgeClass} px-2.5 py-1 rounded-lg whitespace-nowrap">${badgeIcon} ${item.status}</span>
                </div>
            `;
            }).join('');
        }

        // Backfill: kalau ada tugas yang sudah pernah dikumpulkan sebelum fitur ini ada,
        // catat dulu ke riwayat supaya buktinya tidak hilang. Sekarang loop semua tugas.
        function backfillRiwayatJikaPerlu() {
            const tasks = getTasksSiswa();
            tasks.forEach(data => {
                if (!(data.studentSubmitted || data.sudahMengumpulkan) || !data.waktuKirim) return;

                const riwayat = getRiwayatPengumpulan();
                const sudahAda = riwayat.some(r => r.judul === (data.judul || data.tipe) && r.jam === data.waktuKirim);
                if (!sudahAda) {
                    tambahRiwayatPengumpulan(data.judul, data.tipe, data.waktuKirim, getAccurateNow(), data.id);
                }
            });
        }

        // ============================================================
        // Pemisahan Kategori "Tugas Kedaluwarsa": begitu deadline sebuah tugas
        // lewat DAN siswa belum sempat mengumpulkan, tugas itu TIDAK dihapus dari
        // sistem -- tetap ada di 'tasks_<kelas>' seperti biasa (lihat kategoriStatusTugas
        // yang otomatis memindahkannya ke sub-tab "Riwayat/Selesai"). Fungsi di bawah
        // ini CUMA menambahkan jejak arsip permanen di riwayat pengumpulan siswa
        // dengan label merah "Tidak Dikerjakan", supaya riwayat itu tetap terikat ke
        // akun siswa walaupun nanti guru mengirim banyak tugas baru menumpuk di atasnya.
        function catatRiwayatTugasKedaluwarsaJikaPerlu() {
            const tasks = getTasksSiswa();
            const now = getAccurateNow();
            tasks.forEach(data => {
                if (data.studentSubmitted || data.sudahMengumpulkan) return; // sudah dikumpulkan, bukan kasus "kedaluwarsa"
                const batasWaktu = data.deadline || data.deadlineDate || '';
                if (!cekTugasSudahKedaluwarsa(batasWaktu, now)) return; // masih aktif, belum lewat deadline

                const riwayat = getRiwayatPengumpulan();
                const sudahAda = riwayat.some(r => r.taskId === data.id && (r.status === 'Tidak Dikerjakan' || r.status === 'Lewat Waktu'));
                if (!sudahAda) {
                    tambahRiwayatPengumpulan(data.judul, data.tipe, batasWaktu || '-', now, data.id, 'Tidak Dikerjakan');
                }
            });
        }

        // Kalau tugasnya sudah ditarik guru (id-nya udah gak ada lagi di daftar tugas
        // aktif kelas ini), riwayat pengumpulan buat tugas itu ikut dihapus juga.
        // Entri riwayat lama (sebelum fitur ini ada) yang belum punya taskId dibiarkan
        // apa adanya karena gak bisa dipastikan tugas aslinya masih ada atau tidak.
        function sinkronkanRiwayatDenganTugasAktif() {
            const idTugasAktif = new Set(getTasksSiswa().map(t => t.id));
            const riwayat = getRiwayatPengumpulan();
            const riwayatBaru = riwayat.filter(r => !r.taskId || idTugasAktif.has(r.taskId));
            if (riwayatBaru.length !== riwayat.length) {
                localStorage.setItem(`riwayat_pengumpulan_${ID_SISWA_AKTIF}`, JSON.stringify(riwayatBaru));
                renderRiwayatPengumpulan();
            }
        }

        /* ================= HOOK KE FUNGSI YANG SUDAH ADA (tanpa mengubah isinya) ================= */
        const _origSimpanDataTugasFinal = simpanDataTugasFinal;
        simpanDataTugasFinal = function(taskId, imageBase64, nowObj) {
            _origSimpanDataTugasFinal(taskId, imageBase64, nowObj);
            const tasks = getTasksSiswa();
            const data = tasks.find(t => t.id === taskId);
            if (!data) return;
            const jamDetail = String(nowObj.getHours()).padStart(2, '0') + ':' +
                              String(nowObj.getMinutes()).padStart(2, '0') + ':' +
                              String(nowObj.getSeconds()).padStart(2, '0') + ' WIB';
            tambahRiwayatPengumpulan(data.judul, data.tipe, jamDetail, nowObj, data.id);
            updateGlobalCountdown();
        };

        /* ================= DAFTAR GURU & TENAGA PENGAJAR ================= */
        // Data pengajar per kelas di seluruh jurusan & tingkat (X, XI, XII / TKJ, TKR, TAV).
        // BUG YANG DIPERBAIKI: dulu ini array statis hardcode di sini (const
        // daftarGuruSekolah = [...]) -- jadi kalau mau tambah/ubah/hapus guru,
        // harus edit langsung file HTML-nya satu-satu, dan siswa lain juga
        // tidak pernah ikut lihat perubahannya. Sekarang datanya diambil dari
        // server (/api/guru/list, sumber: data/guru_store.json), jadi begitu
        // Admin/Developer menambah/mengedit/menghapus guru lewat panel
        // "Kelola Guru", SEMUA siswa yang buka menu ini otomatis melihat versi
        // terbaru. Id tiap guru juga sekarang datang dari server (stabil,
        // tidak dihitung ulang dari urutan array di sini).
        let daftarGuruSekolah = [];

        // Status pemuatan data guru dari server, dipakai renderListKelolaGuru()
        // supaya bisa membedakan 3 kondisi berbeda:
        //   'idle'    -> belum pernah dicoba fetch sama sekali
        //   'loading' -> fetch sedang berjalan
        //   'error'   -> fetch terakhir GAGAL (mis. 429 Too Many Requests / network)
        //   'success' -> fetch terakhir berhasil (daftarGuruSekolah dipercaya valid,
        //                walau isinya bisa saja memang kosong)
        // BUG YANG DIPERBAIKI: sebelumnya tidak ada status ini sama sekali, jadi
        // begitu fetch gagal (server rate-limit dsb), daftarGuruSekolah cuma diam
        // di posisi [] dan modal "Kelola Guru" menampilkan "Belum ada data guru"
        // -- padahal aslinya "gagal ambil data", bukan "memang tidak ada data".
        let statusMuatGuru = 'idle';

        let filterGuruAktif = { tingkat: 'semua', jurusan: 'semua' };

        async function muatDaftarGuru(percobaan = 0) {
            statusMuatGuru = 'loading';
            try {
                const res = await fetch('/api/guru/list');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                if (json.success) {
                    daftarGuruSekolah = json.guru;
                    statusMuatGuru = 'success';
                    renderDaftarGuru();
                    // Panel "Kelola Guru" (kalau sedang terbuka, mis. abis
                    // simpan/hapus) ikut di-refresh supaya listnya juga sinkron.
                    renderListKelolaGuru();
                } else {
                    throw new Error('Response sukses=false dari /api/guru/list');
                }
            } catch (e) {
                console.error('Gagal memuat daftar guru:', e);
                // Server (terutama hosting gratisan) kadang balas 429 Too Many
                // Requests saat banyak fetch nyala bersamaan di awal load --
                // coba lagi 1x dengan jeda singkat sebelum benar-benar menyerah,
                // supaya kasus rate-limit sesaat tidak langsung dianggap "kosong".
                if (percobaan < 2) {
                    setTimeout(() => muatDaftarGuru(percobaan + 1), 1200 * (percobaan + 1));
                    return;
                }
                statusMuatGuru = 'error';
                // Modal "Kelola Guru" (kalau sedang terbuka) perlu tahu fetch-nya
                // gagal total, bukan cuma diam menampilkan list lama/kosong.
                renderListKelolaGuru();
            }
        }

        // Beberapa variasi tinggi & posisi foto supaya penataannya terasa "bebas" / tidak
        // kaku baris-per-baris (masonry), tetap konsisten setiap kali di-render ulang.
        const variasiFotoGuru = [
            { tinggi: 'h-56', posisi: 'object-top' },
            { tinggi: 'h-72', posisi: 'object-center' },
            { tinggi: 'h-64', posisi: 'object-center' },
            { tinggi: 'h-80', posisi: 'object-top' },
            { tinggi: 'h-60', posisi: 'object-center' }
        ];

        // Menghitung rata-rata rating seorang guru dari semua evaluasi anonim yang
        // masuk (localStorage 'evaluasi_guru'). Mendukung skema baru (3 rating per
        // aspek: Penjelasan/Keadilan Nilai/Komunikasi) maupun skema lama (1 rating
        // gabungan), supaya data lama yang sudah kepalang tersimpan tetap kehitung.
        function hitungRatingGuru(namaGuru) {
            let semua = [];
            try { semua = JSON.parse(localStorage.getItem('evaluasi_guru') || '[]'); } catch (e) { semua = []; }
            const milikGuru = semua.filter(x => x.guruNama === namaGuru);
            if (milikGuru.length === 0) return { rata: null, jumlah: 0 };
            const total = milikGuru.reduce((jumlah, x) => {
                const rataSatu = (typeof x.ratingPenjelasan === 'number')
                    ? (x.ratingPenjelasan + x.ratingKeadilan + x.ratingKomunikasi) / 3
                    : (x.rating || 0);
                return jumlah + rataSatu;
            }, 0);
            return { rata: total / milikGuru.length, jumlah: milikGuru.length };
        }

        // Badge status ringkas di card: hijau "Favorit" kalau rata-rata >= 4.5,
        // amber "Evaluasi" (perlu perhatian) kalau < 3.5, netral kalau di antara.
        function badgeStatusGuru(rata) {
            if (rata === null) return '';
            if (rata >= 4.5) {
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[9px] font-bold"><i class="fa-solid fa-circle text-[6px]"></i> Favorit</span>`;
            }
            if (rata < 3.5) {
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-bold"><i class="fa-solid fa-triangle-exclamation text-[8px]"></i> Evaluasi</span>`;
            }
            return '';
        }

        // Sama seperti hitungRatingGuru() (rata-rata gabungan buat kartu), tapi
        // hasilnya dipecah per-aspek (Penjelasan/Keadilan/Komunikasi) buat modal
        // detail. Skema lama (1 rating gabungan) tetap kehitung di ketiga aspek
        // supaya data lama nggak hilang dari rata-rata.
        function hitungRatingGuruPerAspek(namaGuru) {
            let semua = [];
            try { semua = JSON.parse(localStorage.getItem('evaluasi_guru') || '[]'); } catch (e) { semua = []; }
            const milikGuru = semua.filter(x => x.guruNama === namaGuru);
            const jumlah = milikGuru.length;
            if (jumlah === 0) return { penjelasan: null, keadilan: null, komunikasi: null, jumlah: 0 };

            const jumlahkan = (kunci) => milikGuru.reduce((total, x) => {
                const nilai = (typeof x.ratingPenjelasan === 'number') ? x[kunci] : (x.rating || 0);
                return total + nilai;
            }, 0);

            return {
                penjelasan: jumlahkan('ratingPenjelasan') / jumlah,
                keadilan: jumlahkan('ratingKeadilan') / jumlah,
                komunikasi: jumlahkan('ratingKomunikasi') / jumlah,
                jumlah
            };
        }

        // Render 5 ikon bintang (read-only) sesuai rata-rata: penuh kalau sisanya
        // >= 0.75, setengah kalau >= 0.25, sisanya bintang kosong. null (belum ada
        // yang menilai) dirender 5 bintang kosong semua.
        function renderBintangTampilan(rata) {
            let html = '';
            for (let i = 1; i <= 5; i++) {
                const sisa = rata === null ? -1 : rata - (i - 1);
                if (sisa >= 0.75) html += '<i class="fa-solid fa-star"></i>';
                else if (sisa >= 0.25) html += '<i class="fa-solid fa-star-half-stroke"></i>';
                else html += '<i class="fa-regular fa-star"></i>';
            }
            return html;
        }

        // Modal "Detail Penilaian Guru": dipicu klik di kartu guru (area foto/info),
        // BUKAN tombol "Beri Saran" -- tombol itu punya event.stopPropagation()
        // sendiri di renderDaftarGuru() supaya kedua aksi ini gak saling tabrak.
        function bukaModalDetailGuru(idGuru) {
            const g = daftarGuruSekolah.find(x => x.id === idGuru);
            if (!g) return;
            const r = hitungRatingGuruPerAspek(g.nama);
            // Skor gabungan (rata-rata dari SEMUA bintang di 3 aspek, bukan cuma
            // salah satu aspek) -- ini angka "total keseluruhan" yang ditampilkan
            // di header kanan foto, terpisah dari rincian per-aspek di bawahnya.
            const keseluruhan = hitungRatingGuru(g.nama);

            const elFoto = document.getElementById('detail-guru-foto');
            if (elFoto) { elFoto.src = g.foto; elFoto.alt = g.nama; }
            // detail-guru-foto-bg: lapisan blur di belakang foto utama (lihat
            // komentar HTML di #detail-guru-foto-wrap) -- isinya sengaja disamakan
            // persis dengan foto utama supaya warna latarnya senada, cuma di-blur+
            // di-zoom lewat CSS supaya ngisi penuh kotak tanpa ruang kosong.
            const elFotoBg = document.getElementById('detail-guru-foto-bg');
            if (elFotoBg) elFotoBg.src = g.foto;
            const elNama = document.getElementById('detail-guru-nama');
            if (elNama) elNama.innerText = g.nama;
            const elMapel = document.getElementById('detail-guru-mapel');
            if (elMapel) elMapel.innerText = g.mapel;

            const elBintangTotal = document.getElementById('detail-guru-total-bintang');
            if (elBintangTotal) elBintangTotal.innerHTML = renderBintangTampilan(keseluruhan.rata);
            const elSkorTotal = document.getElementById('detail-guru-skor-total');
            if (elSkorTotal) elSkorTotal.innerText = keseluruhan.rata !== null ? `${keseluruhan.rata.toFixed(1)}/5` : 'Belum ada nilai';
            const elJumlahSiswa = document.getElementById('detail-guru-jumlah-siswa');
            if (elJumlahSiswa) {
                elJumlahSiswa.innerText = keseluruhan.jumlah === 0
                    ? 'Belum ada siswa yang menilai'
                    : `Dari ${keseluruhan.jumlah} siswa yang menilai`;
            }

            const aspekList = [
                { label: 'Penjelasan Materi', nilai: r.penjelasan },
                { label: 'Keadilan Nilai', nilai: r.keadilan },
                { label: 'Komunikasi', nilai: r.komunikasi }
            ];
            const elAspek = document.getElementById('detail-guru-aspek-list');
            if (elAspek) {
                elAspek.innerHTML = aspekList.map(a => `
                    <div class="flex items-center justify-between gap-3">
                        <span class="text-sm font-semibold text-slate-600 whitespace-nowrap">${a.label}</span>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="text-amber-400 text-base tracking-tight whitespace-nowrap">${renderBintangTampilan(a.nilai)}</span>
                            <span class="text-sm font-bold text-slate-900 w-8 text-right">${a.nilai !== null ? a.nilai.toFixed(1) : '-'}</span>
                        </div>
                    </div>
                `).join('');
            }

            const modal = document.getElementById('modal-detail-guru');
            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Dorong 1 entry history khusus buat modal ini -- supaya tombol back
            // HP/browser (atau gesture swipe-back) yang ditekan SELAGI modal ini
            // kebuka akan MENUTUP MODAL INI DULU (lihat popstate & tutupModalDetailGuru
            // di bawah), bukan malah langsung pindah tab / keluar aplikasi seperti
            // sebelumnya (modal belum tercakup di sistem "tombol back mengikuti
            // klik" -- lihat catatan cakupan di atas dorongHistoryTampilan()).
            modalGuruHistoryAktif = true;
            dorongHistoryTampilan({ type: 'modal', modal: 'detail-guru' });

            // Replay animasi "foto masuk dari kanan ke kiri" tiap kali modal
            // dibuka: lepas dulu class-nya, paksa reflow (baca offsetWidth),
            // baru pasang lagi -- kalau tidak, browser menganggap class-nya
            // "sudah ada" dan animasi cuma jalan sekali di klik pertama.
            const fotoWrap = document.getElementById('detail-guru-foto-wrap');
            if (fotoWrap) {
                fotoWrap.classList.remove('foto-guru-masuk');
                void fotoWrap.offsetWidth;
                fotoWrap.classList.add('foto-guru-masuk');
            }

            // Replay animasi fade-up di kolom KANAN (nama/skor/rincian aspek),
            // pakai trik reflow yang sama seperti foto di atas supaya animasinya
            // selalu jalan ulang tiap kali modal dibuka, bukan cuma sekali.
            const infoWrap = document.getElementById('detail-guru-info-wrap');
            if (infoWrap) {
                infoWrap.classList.remove('info-guru-masuk');
                void infoWrap.offsetWidth;
                infoWrap.classList.add('info-guru-masuk');
            }
        }

        // dariTombolBack: true kalau fungsi ini dipanggil DARI handler popstate
        // (tombol back HP/browser sudah ditekan, history sudah otomatis mundur
        // sendiri oleh browser -- lihat listener 'popstate' di bawah). false/
        // kosong kalau ditutup manual lewat klik tombol X atau klik area gelap
        // di luar kartu (backdrop).
        function tutupModalDetailGuru(dariTombolBack) {
            const modal = document.getElementById('modal-detail-guru');
            modal.classList.add('hidden');
            modal.classList.remove('flex');

            // Kalau modal ini ditutup MANUAL (klik X/backdrop) & tadi memang
            // sempat mendorong 1 entry history (lihat bukaModalDetailGuru),
            // buang entry itu lewat history.back() -- supaya nanti pas user
            // BENERAN pencet tombol back, dia tidak "nyangkut" nyoba nutup
            // modal yang sebenarnya sudah ketutup duluan (efeknya: tombol back
            // kelihatan tidak berfungsi / harus dipencet 2x baru pindah tab).
            // Kalau dariTombolBack true, browser sendiri yang sudah mundurkan
            // history-nya -- jangan history.back() lagi di sini (bisa jadi
            // mundur 2x / salah sasaran).
            if (!dariTombolBack && modalGuruHistoryAktif) {
                modalGuruHistoryAktif = false;
                history.back();
            } else {
                modalGuruHistoryAktif = false;
            }
        }

        function renderDaftarGuru() {
            const grid = document.getElementById('grid-daftar-guru');
            const emptyState = document.getElementById('guru-kosong-state');
            const badge = document.getElementById('guru-jumlah-badge');
            if (!grid) return;

            // Tingkat & Jurusan tidak lagi diinput manual di form Kelola Guru --
            // g.tingkat (bisa multi-value dipisah koma, lihat simpanFormGuru())
            // dan g.jurusan (khusus guru Produktif) dipakai duluan kalau ada,
            // fallback ke deteksi otomatis dari teks "Kelas yang Diajar" untuk
            // data lama / guru mapel Biasa yang memang tidak dipatok 1 jurusan.
            const hasil = daftarGuruSekolah.filter(g => {
                const tingkatGuru = (g.tingkat ? g.tingkat.split(',').map(t => t.trim()).filter(Boolean) : []);
                const tingkatFinal = tingkatGuru.length > 0 ? tingkatGuru : ambilTingkatDariKelas(g.kelas);
                const cocokTingkat = filterGuruAktif.tingkat === 'semua' || tingkatFinal.includes(filterGuruAktif.tingkat);

                const jurusanFinal = (g.jenis === 'produktif' && g.jurusan) ? [g.jurusan] : ambilJurusanDariKelas(g.kelas);
                const cocokJurusan = filterGuruAktif.jurusan === 'semua' || jurusanFinal.length === 0 || jurusanFinal.includes(filterGuruAktif.jurusan);

                return cocokTingkat && cocokJurusan;
            });

            if (badge) badge.innerHTML = `<i class="fa-solid fa-users mr-1"></i> ${hasil.length} Guru`;

            if (hasil.length === 0) {
                grid.innerHTML = '';
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }
            if (emptyState) emptyState.classList.add('hidden');

            grid.innerHTML = hasil.map((g, i) => {
                const v = variasiFotoGuru[i % variasiFotoGuru.length];
                const r = hitungRatingGuru(g.nama);
                const ratingHtml = r.rata !== null
                    ? `<span class="inline-flex items-center gap-1 text-amber-500 text-[10px] font-bold"><i class="fa-solid fa-star"></i> ${r.rata.toFixed(1)}/5</span>`
                    : `<span class="text-[10px] text-slate-400 font-semibold">Belum ada rating</span>`;
                const badgeHtml = badgeStatusGuru(r.rata);
                return `
                <div class="guru-card-reveal mb-6 break-inside-avoid cursor-pointer" style="transition-delay: ${(i % 9) * 70}ms" onclick="bukaModalDetailGuru(${g.id})" role="button" tabindex="0" aria-label="Lihat detail penilaian ${g.nama}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();bukaModalDetailGuru(${g.id});}">
                    <div class="relative rounded-3xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100 ${v.tinggi} group">
                        <img loading="lazy" decoding="async" src="${g.foto}" class="w-full h-full object-cover ${v.posisi} group-hover:scale-105 transition-transform duration-500" alt="${g.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(g.nama)}&background=e0e7ff&color=3730a3&size=500'">
                    </div>
                    <div class="-mt-9 mx-3 relative z-10 bg-white border border-slate-200 rounded-2xl shadow-sm p-3.5 text-center">
                        <h4 class="font-bold text-slate-900 text-xs leading-tight">${g.nama}</h4>
                        <p class="lulusan-guru text-[10px] text-slate-500 mt-1 leading-snug"><i class="fa-solid fa-graduation-cap mr-1 text-blue-500"></i>${g.lulusan}</p>
                        <p class="text-[10px] text-slate-700 font-semibold mt-1.5"><i class="fa-solid fa-book mr-1 text-blue-500"></i>${g.mapel}</p>
                        <div class="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
                            ${ratingHtml}
                            ${badgeHtml}
                        </div>
                        <span class="inline-block mt-2 px-2.5 py-1 bg-blue-50/90 text-blue-700 text-[10px] font-bold rounded-lg border border-blue-100">Mengajar Kelas ${g.kelas}</span>
                        <button type="button" onclick="event.stopPropagation(); bukaModalSaranGuru(${g.id})" class="btn-beri-saran-guru mt-2 w-full py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-comment-dots"></i> Beri Saran
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            aktifkanScrollRevealGuru();
        }

        // ============================================================
        // MODAL "Kelola Guru" — KHUSUS Admin/Developer (tombol pemicu &
        // seluruh isi modal ini cuma dimunculkan buat akunIniAdminDev(),
        // TAPI proteksi sesungguhnya tetap di server: /api/guru/tambah,
        // /api/guru/edit, /api/guru/hapus semuanya cek session admin
        // sendiri-sendiri, jadi walau ada yang coba akses modal ini lewat
        // DevTools/console, request ke server tetap ditolak untuk siswa
        // biasa. Satu form (#form-kelola-guru) dipakai gantian untuk mode
        // tambah maupun edit, dibedakan lewat _idGuruDiedit (null = tambah).
        // ============================================================
        let _idGuruDiedit = null;

        function bukaModalKelolaGuru() {
            if (!akunIniAdminDev()) return; // jaga-jaga; tombolnya memang sudah disembunyikan
            tutupFormGuru();
            const modal = document.getElementById('modal-kelola-guru');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            // BUG YANG DIPERBAIKI: dulu di sini cuma renderListKelolaGuru() dari
            // cache lokal (daftarGuruSekolah) tanpa fetch ulang -- jadi kalau
            // fetch awal saat DOMContentLoaded sempat gagal/kena rate-limit
            // server, modal ini akan TERUS menampilkan "Belum ada data guru"
            // walau data guru aslinya ada di server, sampai halaman di-reload.
            // Sekarang tiap modal dibuka, data ditarik ulang dari server dulu --
            // renderListKelolaGuru() langsung dipanggil sekali (pakai data yang
            // ada di memori, biar modal tidak kosong-melompong nunggu network),
            // lalu dipanggil lagi otomatis dari dalam muatDaftarGuru() begitu
            // hasil fetch terbaru datang.
            renderListKelolaGuru();
            muatDaftarGuru();
        }

        function tutupModalKelolaGuru() {
            const modal = document.getElementById('modal-kelola-guru');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function renderListKelolaGuru() {
            const list = document.getElementById('list-kelola-guru');
            if (!list) return; // modal belum pernah dibuka / bukan akun admin

            // Kalau list masih kosong TAPI itu karena fetch masih berjalan atau
            // baru saja gagal, jangan tampilkan "Belum ada data guru" -- itu
            // pesan yang seharusnya cuma muncul kalau server memang konfirmasi
            // datanya kosong (statusMuatGuru === 'success' & array-nya kosong).
            if (daftarGuruSekolah.length === 0 && statusMuatGuru === 'loading') {
                list.innerHTML = '<p class="text-xs text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data guru\u2026</p>';
                return;
            }
            if (daftarGuruSekolah.length === 0 && statusMuatGuru === 'error') {
                list.innerHTML = '<p class="text-xs text-red-500 text-center py-4">Gagal memuat data guru dari server (koneksi/server sedang sibuk). <button type="button" onclick="muatDaftarGuru()" class="underline font-bold">Coba lagi</button></p>';
                return;
            }

            list.innerHTML = daftarGuruSekolah.map(g => {
                const jenisProduktif = g.jenis === 'produktif';
                const badgeJenis = jenisProduktif
                    ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-bold flex-shrink-0"><i class="fa-solid fa-screwdriver-wrench"></i> Produktif${g.jurusan ? ' · ' + g.jurusan : ''}</span>`
                    : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100 text-[9px] font-bold flex-shrink-0"><i class="fa-solid fa-book-open"></i> Biasa</span>`;
                return `
                <div class="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200">
                    <img loading="lazy" decoding="async" src="${g.foto}" alt="${g.nama}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-slate-100" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(g.nama)}&background=e0e7ff&color=3730a3&size=80'">
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-slate-800 truncate">${g.nama}</p>
                        <p class="text-[10px] text-slate-400 truncate">${g.mapel} • ${g.kelas}</p>
                    </div>
                    ${badgeJenis}
                    <button type="button" onclick="bukaFormEditGuru(${g.id})" class="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0" title="Edit" aria-label="Edit ${g.nama}">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" onclick="hapusGuru(${g.id})" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0" title="Hapus" aria-label="Hapus ${g.nama}">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            `;
            }).join('') || '<p class="text-xs text-slate-400 text-center py-4">Belum ada data guru.</p>';
        }

        // Toggle "Jenis Mata Pelajaran": update field hidden #input-guru-jenis
        // + styling aktif pada tombol yang dipilih (biru = Biasa, oranye = Produktif)
        // + field "Jurusan" cuma relevan (dan cuma ditampilkan) buat guru Produktif,
        // karena guru mapel biasa (Matematika, B. Indonesia, dst) umumnya ngajar
        // lintas jurusan jadi tidak perlu dipatok ke satu jurusan tertentu.
        function pilihJenisGuru(jenis) {
            document.getElementById('input-guru-jenis').value = jenis;
            const btnBiasa = document.getElementById('btn-jenis-guru-biasa');
            const btnProduktif = document.getElementById('btn-jenis-guru-produktif');
            if (btnBiasa) btnBiasa.classList.toggle('jenis-guru-aktif-biasa', jenis === 'biasa');
            if (btnProduktif) btnProduktif.classList.toggle('jenis-guru-aktif-produktif', jenis === 'produktif');
            const wrapJurusan = document.getElementById('wrap-guru-jurusan');
            if (wrapJurusan) wrapJurusan.classList.toggle('hidden', jenis !== 'produktif');
        }

        // Toggle "Jurusan" (khusus guru Mapel Produktif): update field hidden
        // #input-guru-jurusan + styling warna solid pada tombol yang dipilih
        // (TKJ biru, TKR hijau, TAV kuning), senada tombol "Lihat Kategori Mapel" di Quiz.
        function pilihJurusanGuru(jurusan) {
            document.getElementById('input-guru-jurusan').value = jurusan;
            const peta = { TKJ: 'btn-jurusan-guru-tkj', TKR: 'btn-jurusan-guru-tkr', TAV: 'btn-jurusan-guru-tav' };
            Object.entries(peta).forEach(([j, id]) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                btn.classList.toggle(`jurusan-guru-aktif-${j.toLowerCase()}`, j === jurusan);
            });
        }

        // Tingkat (X/XI/XII) TIDAK lagi diinput manual di form -- dulu ada field
        // terpisah "Tingkat" yang gampang tidak sinkron sama "Kelas yang Diajar"
        // (mis. admin pilih Tingkat "X" tapi isi kelas "XI TKJ 2"). Sekarang tingkat
        // dibaca otomatis dari teks "Kelas yang Diajar", dan dipakai baik saat
        // simpan (payload.tingkat) maupun saat filter chip Tingkat di Daftar Guru.
        // Mendukung banyak kelas sekaligus dipisah koma, mis. "X TKJ 1, XI TKJ 2".
        function ambilTingkatDariKelas(kelasStr) {
            const teks = (kelasStr || '').toUpperCase();
            const ditemukan = teks.match(/\bXII\b|\bXI\b|\bX\b/g) || [];
            return [...new Set(ditemukan)];
        }

        // Sama seperti ambilTingkatDariKelas() tapi untuk kode jurusan (TKJ/TKR/TAV)
        // -- dipakai sebagai fallback filter jurusan buat guru mapel biasa yang
        // memang tidak dipatok ke satu jurusan (field Jurusan disembunyikan).
        function ambilJurusanDariKelas(kelasStr) {
            const teks = (kelasStr || '').toUpperCase();
            const ditemukan = teks.match(/\bTKJ\b|\bTKR\b|\bTAV\b/g) || [];
            return [...new Set(ditemukan)];
        }

        function bukaFormTambahGuru() {
            _idGuruDiedit = null;
            document.getElementById('form-kelola-guru-judul').textContent = 'Tambah Guru Baru';
            document.getElementById('btn-submit-form-guru').textContent = 'Simpan';
            ['nama', 'lulusan', 'mapel', 'kelas'].forEach(f => { document.getElementById(`input-guru-${f}`).value = ''; });
            pilihJurusanGuru('TKJ');
            pilihJenisGuru('biasa');
            resetPreviewFotoGuru();
            document.getElementById('form-kelola-guru-pesan-gagal').classList.add('hidden');
            document.getElementById('form-kelola-guru').classList.remove('hidden');
        }

        function bukaFormEditGuru(idGuru) {
            const g = daftarGuruSekolah.find(x => x.id === idGuru);
            if (!g) return;
            _idGuruDiedit = idGuru;
            document.getElementById('form-kelola-guru-judul').textContent = `Edit Guru: ${g.nama}`;
            document.getElementById('btn-submit-form-guru').textContent = 'Simpan Perubahan';
            document.getElementById('input-guru-nama').value = g.nama || '';
            document.getElementById('input-guru-lulusan').value = g.lulusan || '';
            document.getElementById('input-guru-mapel').value = g.mapel || '';
            document.getElementById('input-guru-kelas').value = g.kelas || '';
            pilihJurusanGuru(g.jurusan || 'TKJ');
            pilihJenisGuru(g.jenis || 'biasa');
            // Foto lama tetap dipertahankan di field hidden (dan ditampilkan sebagai
            // pratinjau) sampai admin benar-benar pilih file baru lewat onPilihFotoGuru().
            document.getElementById('input-guru-foto').value = g.foto || '';
            tampilkanPreviewFotoGuru(g.foto || '');
            document.getElementById('form-kelola-guru-pesan-gagal').classList.add('hidden');
            document.getElementById('form-kelola-guru').classList.remove('hidden');
        }

        function resetPreviewFotoGuru() {
            document.getElementById('input-guru-foto').value = '';
            document.getElementById('input-guru-foto-file').value = '';
            document.getElementById('label-guru-foto-file').textContent = 'Pilih foto dari perangkat...';
            const preview = document.getElementById('preview-guru-foto');
            preview.src = '';
            preview.classList.add('hidden');
        }

        function tampilkanPreviewFotoGuru(src) {
            const preview = document.getElementById('preview-guru-foto');
            if (!src) {
                preview.src = '';
                preview.classList.add('hidden');
                return;
            }
            preview.src = src;
            preview.classList.remove('hidden');
        }

        // Baca file yang dipilih admin jadi base64 (data URL) lewat FileReader,
        // lalu taruh di field hidden #input-guru-foto -- sama persis pola
        // updateProfilePhoto() untuk foto profil siswa (base64 disimpan langsung
        // sebagai string di server, tidak perlu upload/host file terpisah).
        async function onPilihFotoGuru(event) {
            const file = event.target.files[0];
            if (!file) return;
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Gagal membaca file'));
                    reader.readAsDataURL(file);
                });
                document.getElementById('input-guru-foto').value = dataUrl;
                document.getElementById('label-guru-foto-file').textContent = file.name;
                tampilkanPreviewFotoGuru(dataUrl);
            } catch (e) {
                alert('Gagal membuka foto. Coba pilih file lain.');
                event.target.value = '';
            }
        }


        function tutupFormGuru() {
            _idGuruDiedit = null;
            resetPreviewFotoGuru();
            const form = document.getElementById('form-kelola-guru');
            if (form) form.classList.add('hidden');
        }

        async function simpanFormGuru(event) {
            event.preventDefault();
            const kelasNilai = document.getElementById('input-guru-kelas').value.trim();
            const jenisNilai = document.getElementById('input-guru-jenis').value;
            // Tingkat tidak diinput manual lagi -- dibaca otomatis dari teks
            // "Kelas yang Diajar" (lihat ambilTingkatDariKelas()). Kalau ada
            // beberapa tingkat sekaligus (mis. "X TKJ 1, XI TKJ 2"), simpan
            // semuanya dipisah koma supaya filter chip Tingkat di Daftar Guru
            // tetap bisa cocokkan salah satunya.
            const tingkatTerbaca = ambilTingkatDariKelas(kelasNilai).join(',');
            const payload = {
                nama: document.getElementById('input-guru-nama').value.trim(),
                lulusan: document.getElementById('input-guru-lulusan').value.trim(),
                mapel: document.getElementById('input-guru-mapel').value.trim(),
                kelas: kelasNilai,
                tingkat: tingkatTerbaca,
                // Jurusan cuma relevan buat guru Produktif -- guru Biasa dikirim
                // string kosong supaya filter jurusan otomatis fallback ke hasil
                // ambilJurusanDariKelas() (lihat renderDaftarGuru()).
                jurusan: jenisNilai === 'produktif' ? document.getElementById('input-guru-jurusan').value : '',
                jenis: jenisNilai,
                foto: document.getElementById('input-guru-foto').value.trim()
            };
            const pesanGagal = document.getElementById('form-kelola-guru-pesan-gagal');
            pesanGagal.classList.add('hidden');

            const url = _idGuruDiedit === null ? '/api/guru/tambah' : `/api/guru/edit/${_idGuruDiedit}`;
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (!json.success) {
                    pesanGagal.textContent = json.message || 'Gagal menyimpan data guru.';
                    pesanGagal.classList.remove('hidden');
                    return;
                }
                tutupFormGuru();
                await muatDaftarGuru(); // tarik ulang list terbaru dari server (sekaligus refresh grid & panel kelola)
                triggerDynamicIsland(_idGuruDiedit === null ? `Guru "${payload.nama}" berhasil ditambahkan.` : `Data "${payload.nama}" berhasil diperbarui.`);
            } catch (e) {
                console.error('Gagal menyimpan data guru:', e);
                pesanGagal.textContent = 'Gagal menghubungi server. Coba lagi.';
                pesanGagal.classList.remove('hidden');
            }
        }

        async function hapusGuru(idGuru) {
            const g = daftarGuruSekolah.find(x => x.id === idGuru);
            if (!g) return;
            if (!confirm(`Yakin mau hapus "${g.nama}" dari daftar guru? Tindakan ini tidak bisa dibatalkan.`)) return;
            try {
                const res = await fetch(`/api/guru/hapus/${idGuru}`, { method: 'POST' });
                const json = await res.json();
                if (!json.success) {
                    alert(json.message || 'Gagal menghapus guru.');
                    return;
                }
                await muatDaftarGuru();
                triggerDynamicIsland(`Guru "${g.nama}" berhasil dihapus.`);
            } catch (e) {
                console.error('Gagal menghapus guru:', e);
                alert('Gagal menghubungi server. Coba lagi.');
            }
        }

        // ============================================================
        // MODAL "Beri Saran / Evaluasi" untuk guru — 100% ANONIM.
        // Sengaja TIDAK pernah menyimpan nama/kelas/ID siswa pengirim ke
        // manapun (localStorage 'evaluasi_guru'), supaya guru cuma bisa
        // lihat isi & rating-nya, bukan siapa yang mengirim.
        // 3 aspek dinilai terpisah (Penjelasan, Keadilan Nilai, Komunikasi)
        // supaya masukannya lebih spesifik ketimbang 1 rating gabungan.
        // ============================================================
        let _guruSaranAktif = null;
        let _ratingSaranGuruAktif = { penjelasan: 0, keadilan: 0, komunikasi: 0 };

        function bukaModalSaranGuru(idGuru) {
            const g = daftarGuruSekolah.find(x => x.id === idGuru);
            if (!g) return;
            _guruSaranAktif = g;
            _ratingSaranGuruAktif = { penjelasan: 0, keadilan: 0, komunikasi: 0 };

            document.getElementById('saran-guru-nama-target').innerText = g.nama;
            const inputPesan = document.getElementById('saran-guru-pesan');
            if (inputPesan) inputPesan.value = '';
            perbaruiTampilanBintangSaranGuru();

            // Setiap modal dibuka, defaultkan lagi ke 100% Anonim (checkbox
            // "Tampilkan nama saya" dikosongkan) supaya siswa harus memilih
            // sadar tiap kali kalau mau menampilkan namanya.
            const checkboxNama = document.getElementById('checkbox-tampilkan-nama-saran-guru');
            if (checkboxNama) checkboxNama.checked = false;
            const badgeNamaTeks = document.getElementById('badge-nama-saran-guru-teks');
            if (badgeNamaTeks) badgeNamaTeks.innerText = NAMA_SISWA_AKTIF;
            perbaruiBadgeAnonimSaranGuru();

            const modal = document.getElementById('modal-saran-guru');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        // Tampilkan/sembunyikan badge "100% Anonim" vs "Terkirim atas nama: ..."
        // sesuai posisi checkbox "Tampilkan nama saya".
        function perbaruiBadgeAnonimSaranGuru() {
            const checkboxNama = document.getElementById('checkbox-tampilkan-nama-saran-guru');
            const tampilkanNama = checkboxNama ? checkboxNama.checked : false;
            const badgeAnonim = document.getElementById('badge-anonim-saran-guru');
            const badgeNama = document.getElementById('badge-nama-saran-guru');
            if (badgeAnonim) badgeAnonim.classList.toggle('hidden', tampilkanNama);
            if (badgeNama) {
                badgeNama.classList.toggle('hidden', !tampilkanNama);
                badgeNama.classList.toggle('inline-flex', tampilkanNama);
            }
        }

        function toggleTampilkanNamaSaranGuru() {
            perbaruiBadgeAnonimSaranGuru();
        }

        function tutupModalSaranGuru() {
            const modal = document.getElementById('modal-saran-guru');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            _guruSaranAktif = null;
        }

        function pilihRatingSaranGuru(dimensi, n) {
            _ratingSaranGuruAktif[dimensi] = n;
            perbaruiTampilanBintangSaranGuru();
        }

        function perbaruiTampilanBintangSaranGuru() {
            document.querySelectorAll('[data-grup-bintang]').forEach(grup => {
                const dimensi = grup.dataset.grupBintang;
                const aktif = _ratingSaranGuruAktif[dimensi] || 0;
                grup.querySelectorAll('.bintang-saran-guru').forEach(btn => {
                    const n = parseInt(btn.dataset.bintang, 10);
                    btn.classList.toggle('aktif', n <= aktif);
                });
            });
        }

        function kirimSaranGuru() {
            if (!_guruSaranAktif) return;
            const { penjelasan, keadilan, komunikasi } = _ratingSaranGuruAktif;
            if (!penjelasan || !keadilan || !komunikasi) {
                alert('Silakan beri rating bintang untuk ketiga aspek (Penjelasan Materi, Keadilan Nilai, Komunikasi) terlebih dahulu.');
                return;
            }
            const inputPesan = document.getElementById('saran-guru-pesan');
            const pesan = inputPesan.value.trim();
            if (!pesan) {
                alert('Silakan tulis pesan saran/evaluasi terlebih dahulu.');
                inputPesan.focus();
                return;
            }

            if (periksaKataKasar(pesan).terdeteksi) {
                tampilkanModalKataKasar();
                return;
            }

            const checkboxNama = document.getElementById('checkbox-tampilkan-nama-saran-guru');
            const tampilkanNama = checkboxNama ? checkboxNama.checked : false;

            const daftarEvaluasi = JSON.parse(localStorage.getItem('evaluasi_guru') || '[]');
            const now = getAccurateNow();
            const timestamp = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
                              String(now.getHours()).padStart(2, '0') + ':' +
                              String(now.getMinutes()).padStart(2, '0') + ' WIB';

            daftarEvaluasi.push({
                guruNama: _guruSaranAktif.nama,
                guruMapel: _guruSaranAktif.mapel,
                ratingPenjelasan: penjelasan,
                ratingKeadilan: keadilan,
                ratingKomunikasi: komunikasi,
                pesan: pesan,
                anonim: !tampilkanNama,
                namaPengirim: tampilkanNama ? NAMA_SISWA_AKTIF : null,
                waktu: timestamp
            });
            localStorage.setItem('evaluasi_guru', JSON.stringify(daftarEvaluasi));

            const namaGuruTarget = _guruSaranAktif.nama;
            tutupModalSaranGuru();
            triggerDynamicIsland(tampilkanNama ? 'Saran berhasil dikirim!' : 'Saran anonim berhasil dikirim!');
            tampilkanSuksesSaranGuru(`Saran & evaluasi kamu untuk ${namaGuruTarget} berhasil dikirim${tampilkanNama ? '' : ' secara anonim'}.`);
            // Rating & badge status di card guru langsung ikut ter-update.
            renderDaftarGuru();
        }

        // Fade In on Scroll: kartu guru baru "muncul" (fade + geser naik) begitu
        // masuk ke area layar saat siswa scroll, bukan langsung tampil semua sekaligus.
        //
        // Catatan optimasi: sebelumnya `new IntersectionObserver(...)` dibuat ulang
        // SETIAP kali fungsi ini dipanggil (yaitu tiap kali tab "Daftar Guru" dibuka
        // atau filter diganti). Observer lama tidak pernah di-disconnect, jadi makin
        // sering pindah-pindah tab/filter, makin banyak observer aktif menumpuk di
        // memori dan makin berat browser-nya lama-lama (termasuk saat scroll). Sekarang
        // cukup 1 observer yang dipakai ulang terus (lazy-initialized sekali saja).
        let _observerRevealGuru = null;
        function getObserverRevealGuru() {
            if (_observerRevealGuru || !('IntersectionObserver' in window)) return _observerRevealGuru;
            _observerRevealGuru = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('revealed');
                        _observerRevealGuru.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.12 });
            return _observerRevealGuru;
        }

        function aktifkanScrollRevealGuru() {
            const kartuKartu = document.querySelectorAll('#grid-daftar-guru .guru-card-reveal:not(.revealed)');
            if (kartuKartu.length === 0) return;

            const observer = getObserverRevealGuru();
            if (!observer) {
                kartuKartu.forEach(el => el.classList.add('revealed'));
                return;
            }

            kartuKartu.forEach(el => observer.observe(el));
        }

        function setFilterGuru(jenis, val) {
            filterGuruAktif[jenis] = val;
            const grup = document.getElementById(`filter-${jenis}-guru`);
            if (grup) {
                grup.querySelectorAll('.filter-chip-guru').forEach(btn => {
                    if (btn.dataset.val === val) {
                        btn.className = 'filter-chip-guru px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-blue-600 text-white border-blue-600';
                    } else {
                        btn.className = 'filter-chip-guru px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-white text-slate-600 border-slate-200 hover:bg-slate-100';
                    }
                });
            }
            renderDaftarGuru();
        }

        const _origSwitchTab = switchTab;
        switchTab = function(tabName) {
            _origSwitchTab(tabName);
            if (tabName === 'tugas') {
                sinkronkanRiwayatDenganTugasAktif();
                catatRiwayatTugasKedaluwarsaJikaPerlu();
                renderRiwayatPengumpulan();
            }
            if (tabName === 'guru') {
                renderDaftarGuru();
            }
            if (tabName === 'akademik') {
                renderKoleksiBorder();
            }
            if (tabName === 'quiz') {
                bukaQuizDariAwal();
                const badge = document.getElementById('badge-quiz-ditikung');
                if (badge) badge.classList.add('hidden');
            }
        };

        // Kalau guru menambah/mengubah/menarik tugas dari tab atau perangkat lain,
        // localStorage 'tasks_XII_TKJ_3', 'riwayat_pengumpulan_XII_TKJ_3', dan
        // 'notif_tugas_XII_TKJ_3' ikut berubah di sana. Event 'storage' ini menangkap
        // perubahan itu supaya tampilan tugas, riwayat, & notif tugas ditarik di sini
        // otomatis ikut ter-update (tugas baru langsung muncul, tugas ditarik langsung
        // dapat notif), tanpa siswa perlu me-refresh halaman secara manual.
        window.addEventListener('storage', (e) => {
            if (e.key === `tasks_${KELAS_AKTIF_SISWA}` || e.key === `riwayat_pengumpulan_${ID_SISWA_AKTIF}`) {
                sinkronkanRiwayatDenganTugasAktif();
                catatRiwayatTugasKedaluwarsaJikaPerlu();
                renderRiwayatPengumpulan();
                renderLiveTaskContent();
                updateGlobalCountdown();
                checkTaskBadgeStatus();
                updateTaskCounter();
            }
            if (e.key === NOTIF_TUGAS_DITARIK_KEY) {
                cekNotifBaruTugasDitarik();
            }
            if (e.key === KEY_QUIZ_DATA) {
                cekNotifDitikungQuiz();
                updateBerandaPoinQuiz();
                terapkanBorderKeAvatar();
                if (!document.getElementById('tab-quiz').classList.contains('hidden') &&
                    !document.getElementById('quiz-view-tingkat-pg').classList.contains('hidden')) {
                    renderMenuQuiz();
                    renderLeaderboardQuiz();
                }
                if (!document.getElementById('tab-akademik').classList.contains('hidden')) {
                    renderKoleksiBorder();
                }
            }
            if (e.key === KEY_QUIZ_ESSAY_DATA) {
                cekNotifDitikungQuizEssay();
                if (!document.getElementById('tab-quiz').classList.contains('hidden') &&
                    !document.getElementById('quiz-view-tingkat-essay').classList.contains('hidden')) {
                    renderTingkatEssay();
                    renderLeaderboardQuizEssay();
                }
            }
            if (e.key === KEY_PRESTASI_SISWA) {
                // Guru menyetujui/menolak/membatalkan pengajuan prestasi dari Dashboard
                // Guru. Border avatar langsung disesuaikan lagi di sini: kalau prestasi
                // yang membuka border itu dibatalkan, border yang sedang dipakai otomatis
                // turun ke border tertinggi yang MASIH terbuka — sama seperti siswa lain.
                cekNotifBaruStatusPrestasi();
                terapkanBorderKeAvatar();
                if (!document.getElementById('tab-akademik').classList.contains('hidden')) {
                    renderKoleksiBorder();
                }
            }
        });

        // Jaga-jaga kalau perubahan dari Dashboard Guru tidak sempat kepancar lewat
        // event 'storage' (mis. halaman ini dibuka lagi dari cache tombol back/forward,
        // atau tab ini balik aktif setelah sempat ditinggal) — di titik-titik ini kita
        // paksa cek ulang supaya tugas yang sudah ditarik guru pasti hilang dari riwayat.
        window.addEventListener('pageshow', () => {
            sinkronkanRiwayatDenganTugasAktif();
            catatRiwayatTugasKedaluwarsaJikaPerlu();
            renderRiwayatPengumpulan();
            renderLiveTaskContent();
            cekNotifBaruTugasDitarik();
            checkTaskBadgeStatus();
            cekNotifBaruStatusPrestasi();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                sinkronkanRiwayatDenganTugasAktif();
                catatRiwayatTugasKedaluwarsaJikaPerlu();
                renderRiwayatPengumpulan();
                cekNotifBaruStatusPrestasi();
            }
        });

        // Snapshot ringkas dari daftar tugas (id, kapan dikirim guru, status kumpul)
        // dipakai untuk mendeteksi ADA PERUBAHAN dari guru (tugas baru dikirim,
        // status berubah) walau perubahan itu terjadi di TAB/PERANGKAT INI SENDIRI.
        // Catatan: event 'storage' bawaan browser TIDAK PERNAH terpicu di tab yang
        // sama dengan yang melakukan localStorage.setItem — cuma kepancar ke tab
        // lain. Makanya "Tugas Terdekat" di beranda butuh polling sendiri di sini
        // supaya tetap kelihatan realtime (tugas baru muncul, tugas yang lewat
        // deadline otomatis kekunci) tanpa siswa perlu pindah tab atau refresh.
        let _snapshotTugasTerakhir = null;
        function cekPembaruanTugasRealtime() {
            const tasks = getTasksSiswa();
            const snapshot = JSON.stringify(tasks.map(t => [
                t.id, t.waktuKirimGuru || 0, t.deadline || t.deadlineDate || '',
                t.studentSubmitted || t.sudahMengumpulkan || false
            ]));
            if (snapshot !== _snapshotTugasTerakhir) {
                const adaSnapshotSebelumnya = _snapshotTugasTerakhir !== null;
                _snapshotTugasTerakhir = snapshot;
                if (adaSnapshotSebelumnya) {
                    renderLiveTaskContent();
                    checkTaskBadgeStatus();
                    cekNotifBaruTugasDitarik();
                }
            } else {
                // Tetap panggil renderTugasTerdekat saja (murah) supaya status
                // "Belum Dikerjakan" -> "Terkunci" ikut update begitu deadline lewat,
                // walau tidak ada tugas baru dari guru.
                renderTugasTerdekat();
            }
        }


        /* ================= INIT ================= */
        document.addEventListener('DOMContentLoaded', () => {
            terapkanIdentitasEfektif();
            renderDaftarAkunDummy();
            loadDarkModePreference();
            loadAksenTemaPreference();
            loadBioSiswa();
            muatDaftarGuru();
            // Tombol "+ Kelola Guru" cuma boleh kelihatan buat akun Admin/Developer
            // asli -- endpoint tambah/edit/hapus di server juga sudah menggerbangi
            // hal yang sama, jadi ini cuma soal kerapian UI (siswa biasa memang
            // tidak akan pernah bisa memakainya walau tombolnya dipaksa dimunculkan).
            const btnKelolaGuru = document.getElementById('btn-buka-kelola-guru');
            if (btnKelolaGuru && akunIniAdminDev()) btnKelolaGuru.classList.remove('hidden');
            // Sama seperti tombol "+ Kelola Guru" di atas, kedua panel testing
            // ini (Akun Dummy Profil Login & Panel Dummy Leaderboard) cuma
            // boleh kelihatan buat akun 'siswa' (AHMAD FAKHRI AL FARISI) --
            // BEDA dari akunIniAdminDev() (dipakai buat border Admin): di sini
            // SENGAJA tidak dicek AKUN_DUMMY_AKTIF, karena akun 'siswa' ini
            // dipakai dobel sebagai akun dev SEKALIGUS akun biasa sehari-hari
            // -- jadi panelnya harus TETAP kelihatan buat dia walau lagi
            // "coba sebagai akun dummy" buat keperluan testing, bukan cuma
            // pas di akun aslinya doang.
            if (USERNAME_SISWA_ASLI === 'siswa') {
                const wrapperAkunDummy = document.getElementById('wrapper-panel-akun-dummy-profil');
                const wrapperDummyLeaderboard = document.getElementById('wrapper-panel-dummy-leaderboard');
                if (wrapperAkunDummy) wrapperAkunDummy.classList.remove('hidden');
                if (wrapperDummyLeaderboard) wrapperDummyLeaderboard.classList.remove('hidden');
            }
            backfillRiwayatJikaPerlu();
            sinkronkanRiwayatDenganTugasAktif();
            catatRiwayatTugasKedaluwarsaJikaPerlu();
            renderRiwayatPengumpulan();
            renderLiveTaskContent(); // render awal: langsung munculin status tugas terdekat saat halaman baru dibuka
            checkTaskBadgeStatus();
            renderPermintaanTeman(); // sekalian isi badge dropdown pertemanan dari server saat halaman dibuka
            renderDaftarTeman(); // isi daftar teman yang sudah saling add di bawah search bar "Cari Teman"
            renderPerangkat(); // isi badge & tabel perangkat dari server saat halaman dibuka
            updateBerandaPoinQuiz();
            sinkronkanQuizDenganServer(); // tarik progress & leaderboard akun ini dari server
            sinkronkanPrestasiDenganServer(); // tarik & gabung pengajuan prestasi kelas ini dari server (endpoint terpisah, lihat catatan di app.py)
            renderPanelDummyLeaderboard();
            pastikanBaselineSeenIdsQuiz();
            pastikanBaselineSeenIdsQuizEssay();
            terapkanBorderKeAvatar();
            sinkronkanBorderAktifDariServer(); // tarik ulang border aktif dari server -- biar sinkron kalau baru diganti dari perangkat lain
            cekPembaruanTugasRealtime(); // set snapshot awal sebagai baseline
            updateGlobalCountdown();
            setInterval(updateGlobalCountdown, 1000);
            // NAIKKAN INTERVAL POLLING: sebelumnya tiap 3 detik. Dinaikkan jadi
            // 8 detik -- data di sini (badge pertemanan/perangkat, notif tugas)
            // tidak krusial real-time, jadi jeda beberapa detik lebih tidak
            // terasa oleh siswa, tapi memangkas jumlah request ke server hampir
            // 3x lipat saat banyak siswa buka dashboard bersamaan.
            // Sinkronisasi berkala (riwayat tugas, notif, badge pertemanan &
            // perangkat). PENTING buat hemat resource hosting:
            // kalau tab ini sedang tidak aktif dilihat (di-minimize/pindah
            // tab/laptop terkunci), tick ini di-skip total -- tidak ada fetch
            // sama sekali ke server selama tab tidak aktif, walau timer-nya
            // sendiri tetap jalan tiap 3 detik (murah, cuma timer JS lokal).
            // Begitu tab aktif lagi, listener visibilitychange di bawah
            // langsung memicu satu kali sinkronisasi supaya datanya tetap
            // terasa real-time buat siswa, tanpa perlu menunggu tick berikutnya.
            function jalankanSinkronisasiBerkalaDashboard() {
                if (document.hidden) return; // tab tidak sedang dilihat -- jangan buang request
                sinkronkanRiwayatDenganTugasAktif();
                catatRiwayatTugasKedaluwarsaJikaPerlu();
                cekPembaruanTugasRealtime();
                cekNotifBaruStatusPrestasi();
                updateTaskCounter(); // biar streak otomatis putus/berubah warna begitu deadline lewat, tanpa perlu refresh

                // PERBAIKAN PERFORMA: renderPermintaanTeman() & renderDaftarTeman()
                // itu MAHAL -- tiap panggil selalu fetch ke server LALU rebuild
                // total elemen DOM + gambar avatar/border utk tiap baris, padahal
                // isinya cuma kepakai kalau tab "Cari Teman" memang sedang dibuka.
                // Sebelumnya keduanya dipaksa jalan tiap 3 detik di SEMUA tab
                // (Beranda/Tugas/Quiz/dll) -- inilah salah satu penyebab utama
                // dashboard kerasa lag/nge-freeze sebentar tiap ~3 detik,
                // terutama kalau pas bertepatan sama tap/klik user & koneksi ke
                // server (pythonanywhere) lagi agak lambat.
                // Sekarang: kalau tab "Cari Teman" SEDANG dibuka -> tetap render
                // penuh spt biasa (datanya memang perlu selalu segar di situ).
                // Kalau tab lain yang dibuka -> cukup cek badge/titik merah
                // notifikasinya saja (1 fetch ringan, tanpa rebuild list),
                // list lengkapnya baru di-render pas tab itu benar-benar dibuka
                // (sudah ada pemicunya sendiri di switchTab()).
                const tabCariTemanEl = document.getElementById('tab-cari-teman');
                const tabCariTemanTerlihat = !!tabCariTemanEl && !tabCariTemanEl.classList.contains('hidden');
                if (tabCariTemanTerlihat) {
                    renderPermintaanTeman(); // cek permintaan pertemanan baru dari server -- biar titik merah di sidebar & badge dropdown langsung muncul di sisi penerima walau dashboard sudah kebuka duluan
                    renderDaftarTeman(); // biar daftar teman ikut update kalau ada pertemanan baru terbentuk dari sisi lain
                } else {
                    updateBadgePermintaanTemanSaja(); // versi ringan: badge doang, tanpa rebuild list yang lagi gak keliatan
                }

                updateBadgePerangkatNavSaja(); // cek ada tidaknya perangkat baru yang pending, tanpa nge-render ulang tabel penuh tiap 3 detik
            }
            setInterval(jalankanSinkronisasiBerkalaDashboard, 8000);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) jalankanSinkronisasiBerkalaDashboard();
            });
            cekNotifBaruTugasDitarik();
            cekNotifBaruStatusPrestasi();
        });

        /* ============================================================
           FITUR QUIZ & LEADERBOARD (menggantikan Pembayaran SPP)
           - 3 tingkat kesulitan: easy, medium, hard
           - Tiap sesi quiz mengambil 5 soal acak dari bank soal
           - Sistem poin: poin dasar per soal + bonus kecepatan jawab
           - Leaderboard (semua level & per level) tersimpan di localStorage
             sehingga tersinkron antar tab/perangkat yang berbagi origin
             yang sama, mengikuti pola sinkronisasi yang sudah dipakai
             fitur Tugas & Catatan di file ini.
           ============================================================ */

        const NAMA_PEMAIN_QUIZ = NAMA_SISWA_AKTIF;
        const KEY_QUIZ_DATA = `quiz_data_${ID_SISWA_AKTIF}`;
        const AVATAR_DEFAULT_QUIZ = window.AVATAR_DEFAULT_QUIZ;

        // Ambil foto profil siswa yang sedang aktif SEKARANG (biar snapshot yang
        // disimpan ke tiap entri leaderboard selalu sinkron sama foto terbaru,
        // bukan foto lama yang sudah diganti).
        function getFotoProfilAktifQuiz() {
            return localStorage.getItem(keyStudentProfilePhoto()) || AVATAR_DEFAULT_QUIZ;
        }

        // Ambil kelas LANGSUNG dari teks di kartu profil header (id="header-user-kelas"),
        // bukan angka yang ditulis ulang manual di sini — supaya kelas yang tersimpan
        // di tiap entri leaderboard selalu 100% sama dengan yang tampil di profil,
        // termasuk kalau formatnya "XII TKJ 3/TAV" (bukan cuma "XII TKJ 3").
        function getKelasAktifQuiz() {
            const el = document.getElementById('header-user-kelas');
            if (!el) return KELAS_AKTIF_SISWA.replace(/_/g, ' ');
            // Teksnya berformat "Siswa • XII TKJ 3/TAV" -> ambil bagian setelah "•" saja
            const teks = el.textContent || '';
            const bagian = teks.split('•');
            return (bagian[1] || teks).trim();
        }

        const QUIZ_CONFIG = {
            easy:   { label: 'Easy',   poinDasar: 10, waktu: 20, warnaBadge: 'bg-emerald-100 text-emerald-700', warnaBar: 'bg-emerald-500' },
            medium: { label: 'Medium', poinDasar: 20, waktu: 15, warnaBadge: 'bg-amber-100 text-amber-700',     warnaBar: 'bg-amber-500' },
            hard:   { label: 'Hard',   poinDasar: 35, waktu: 10, warnaBadge: 'bg-rose-100 text-rose-700',       warnaBar: 'bg-rose-500' }
        };

        const MAPEL_QUIZ = {
                    "produktif": [
                                {
                                            "id": "kk08",
                                            "kode": "KK08",
                                            "nama": "Mikrotik",
                                            "deskripsi": "Konfigurasi & administrasi jaringan router Mikrotik (RouterOS)",
                                            "icon": "fa-network-wired",
                                            "gambar": "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/mikrotik.svg",
                                            "warna": "sky"
                                },
                                {
                                            "id": "kk17",
                                            "kode": "KK17",
                                            "nama": "Access Point",
                                            "deskripsi": "Instalasi & konfigurasi jaringan nirkabel / Access Point",
                                            "icon": "fa-wifi",
                                            "warna": "cyan"
                                },
                                {
                                            "id": "kk06",
                                            "kode": "KK06",
                                            "nama": "Ubuntu Server",
                                            "deskripsi": "Instalasi & administrasi server berbasis Ubuntu (OVA)",
                                            "icon": "fa-server",
                                            "gambar": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/UbuntuCoF.svg/960px-UbuntuCoF.svg.png",
                                            "warna": "orange"
                                }
                    ],
                    "umum": [
                                {
                                            "id": "matematika",
                                            "kode": null,
                                            "nama": "Matematika",
                                            "deskripsi": "Soal seputar aritmatika, aljabar, hingga kalkulus dasar",
                                            "icon": "fa-calculator",
                                            "gambar": "https://i.pinimg.com/1200x/b1/00/03/b100033fad331b80b2251c30e606186b.jpg",
                                            "warna": "blue"
                                },
                                {
                                            "id": "bindo",
                                            "kode": null,
                                            "nama": "Bahasa Indonesia",
                                            "deskripsi": "Tata bahasa, jenis teks, dan kesusastraan Indonesia",
                                            "icon": "fa-book-open",
                                            "gambar": "https://img.magnific.com/free-vector/illustration-indonesia-flag_53876-27131.jpg",
                                            "warna": "rose"
                                },
                                {
                                            "id": "binggris",
                                            "kode": null,
                                            "nama": "Bahasa Inggris",
                                            "deskripsi": "Grammar, vocabulary, dan tenses dasar Bahasa Inggris",
                                            "icon": "fa-language",
                                            "gambar": "https://e7.pngegg.com/pngimages/1020/23/png-clipart-logo-primera-air-organization-business-english-language-british-flag-flag-logo.png",
                                            "warna": "indigo"
                                },
                                {
                                            "id": "ppkn",
                                            "kode": null,
                                            "nama": "PPKn",
                                            "deskripsi": "Pancasila, UUD 1945, dan kelembagaan negara",
                                            "icon": "fa-landmark",
                                            "gambar": "https://png.pngtree.com/png-vector/20211003/ourmid/pngtree-gold-garuda-pancasila-with-grain-effect-png-image_3968947.png",
                                            "warna": "red"
                                },
                                {
                                            "id": "ipas",
                                            "kode": null,
                                            "nama": "IPAS",
                                            "deskripsi": "Ilmu Pengetahuan Alam & Sosial dasar",
                                            "icon": "fa-flask",
                                            "warna": "emerald"
                                },
                                {
                                            "id": "pjok",
                                            "kode": null,
                                            "nama": "PJOK",
                                            "deskripsi": "Olahraga, kesehatan, dan cabang-cabang atletik",
                                            "icon": "fa-futbol",
                                            "warna": "lime"
                                },
                                {
                                            "id": "sejarah",
                                            "kode": null,
                                            "nama": "Sejarah",
                                            "deskripsi": "Sejarah kemerdekaan & perjuangan bangsa Indonesia",
                                            "icon": "fa-scroll",
                                            "warna": "amber"
                                },
                                {
                                            "id": "senibudaya",
                                            "kode": null,
                                            "nama": "Seni Budaya",
                                            "deskripsi": "Seni rupa, musik, dan tari tradisional Nusantara",
                                            "icon": "fa-palette",
                                            "warna": "fuchsia"
                                }
                    ]
        };

        const QUIZ_BANK_PG_BY_MAPEL = {"kk08": {"easy": [{"q": "Aplikasi resmi berbasis GUI untuk mengonfigurasi router Mikrotik dari komputer disebut?", "opsi": ["Winbox", "Photoshop", "Blender", "OBS Studio"], "jawaban": 0}, {"q": "Sistem operasi yang digunakan oleh perangkat router Mikrotik disebut?", "opsi": ["RouterOS", "Windows Server", "Ubuntu", "Android"], "jawaban": 0}, {"q": "Apa kepanjangan dari \"RB\" pada seri perangkat Mikrotik seperti RB750?", "opsi": ["RouterBoard", "Radio Broadcast", "Real Box", "Router Base"], "jawaban": 0}, {"q": "Untuk masuk ke Mikrotik lewat Winbox tanpa tahu IP, biasanya digunakan koneksi berdasarkan?", "opsi": ["MAC Address", "Nomor Seri", "Kode QR", "Nama WiFi"], "jawaban": 0}], "medium": [{"q": "Fitur Mikrotik yang digunakan untuk membagi & membatasi bandwidth tiap client disebut?", "opsi": ["Simple Queue", "Firewall", "DHCP Server", "NAT"], "jawaban": 0}, {"q": "Untuk memberi router Mikrotik akses internet otomatis dari ISP, biasanya diaktifkan fitur?", "opsi": ["DHCP Client", "DHCP Server", "Hotspot", "Bridge"], "jawaban": 0}, {"q": "Menu di Mikrotik yang digunakan untuk mengatur aturan lalu lintas data (blokir/izinkan) disebut?", "opsi": ["Firewall", "Queue", "Wireless", "Routes"], "jawaban": 0}, {"q": "Perintah dasar untuk melihat daftar interface pada Mikrotik lewat terminal adalah?", "opsi": ["interface print", "show interface", "ip config", "ls interface"], "jawaban": 0}], "hard": [{"q": "Fitur Mikrotik untuk menggabungkan beberapa koneksi internet (ISP) sekaligus disebut?", "opsi": ["Load Balancing", "Port Forwarding", "Bridging", "Bonding"], "jawaban": 0}, {"q": "Protokol routing dinamis yang didukung Mikrotik untuk jaringan skala besar contohnya?", "opsi": ["OSPF", "HTTP", "FTP", "SNMP"], "jawaban": 0}, {"q": "Fitur pada Mikrotik untuk membuat jaringan tunnel antar dua lokasi berbeda disebut?", "opsi": ["VPN (EoIP/PPTP)", "Hotspot", "Firewall NAT", "DHCP Relay"], "jawaban": 0}, {"q": "Teknik antrian di Mikrotik yang membagi bandwidth secara merata otomatis ke tiap koneksi disebut?", "opsi": ["PCQ (Per Connection Queue)", "Simple Queue", "Firewall Mangle", "Static Route"], "jawaban": 0}]}, "kk17": {"easy": [{"q": "Perangkat yang berfungsi memancarkan sinyal WiFi agar perangkat lain bisa terhubung ke jaringan disebut?", "opsi": ["Access Point", "Switch", "Modem ADSL", "Kabel LAN"], "jawaban": 0}, {"q": "Nama jaringan WiFi yang muncul saat kita mencari WiFi di HP/laptop disebut?", "opsi": ["SSID", "IP Address", "MAC Address", "Gateway"], "jawaban": 0}, {"q": "Kunci/kata sandi untuk masuk ke jaringan WiFi disebut?", "opsi": ["Password WiFi", "Username", "PIN ATM", "Kode OTP"], "jawaban": 0}, {"q": "Standar jaringan nirkabel yang umum dipakai untuk WiFi saat ini adalah standar?", "opsi": ["802.11", "802.3", "RS-232", "USB 3.0"], "jawaban": 0}], "medium": [{"q": "Mode Access Point yang berfungsi memperluas jangkauan sinyal WiFi dari AP utama disebut mode?", "opsi": ["Repeater/Bridge", "Router", "Gateway", "Firewall"], "jawaban": 0}, {"q": "Selain 2.4GHz, frekuensi lain yang umum digunakan jaringan WiFi rumahan adalah?", "opsi": ["5GHz", "10GHz", "900MHz", "1GHz"], "jawaban": 0}, {"q": "Metode keamanan WiFi yang lebih aman dibanding WEP adalah?", "opsi": ["WPA2", "Telnet", "FTP", "HTTP"], "jawaban": 0}, {"q": "Untuk menghubungkan dua gedung memakai Access Point tanpa kabel, biasanya dipakai mode?", "opsi": ["Point to Point (PtP)", "Hotspot", "Access Point Router", "Bridge LAN"], "jawaban": 0}], "hard": [{"q": "Kondisi banyak Access Point saling mengganggu sinyal di channel yang sama disebut?", "opsi": ["Interferensi Channel", "Bandwidth Limit", "Packet Loss", "Latency"], "jawaban": 0}, {"q": "Fitur pada Access Point yang memungkinkan perangkat berpindah AP tanpa putus koneksi disebut?", "opsi": ["Roaming", "Bridging", "Tunneling", "Forwarding"], "jawaban": 0}, {"q": "Standar keamanan WiFi terbaru yang menggantikan WPA2 disebut?", "opsi": ["WPA3", "WPA1", "WEP2", "TKIP"], "jawaban": 0}, {"q": "Teknik mengatur beberapa Access Point memakai satu SSID yang sama agar jaringan terasa menyatu disebut?", "opsi": ["ESSID / Seamless Roaming", "VLAN Trunking", "NAT Loopback", "Port Mirroring"], "jawaban": 0}]}, "kk06": {"easy": [{"q": "Ubuntu Server termasuk sistem operasi berbasis?", "opsi": ["Linux", "Windows", "macOS", "MS-DOS"], "jawaban": 0}, {"q": "Ekstensi file .ova pada virtualisasi biasanya digunakan untuk?", "opsi": ["Import/export virtual machine", "Menyimpan foto", "Memutar video", "Mengompres dokumen"], "jawaban": 0}, {"q": "Perintah dasar Linux untuk melihat daftar file & folder di suatu direktori adalah?", "opsi": ["ls", "cd", "mkdir", "rm"], "jawaban": 0}, {"q": "Perintah dasar Linux untuk berpindah direktori adalah?", "opsi": ["cd", "ls", "pwd", "cat"], "jawaban": 0}], "medium": [{"q": "Perintah di Ubuntu Server untuk memperbarui daftar paket sebelum instalasi software adalah?", "opsi": ["apt update", "apt install", "apt remove", "apt list"], "jawaban": 0}, {"q": "Perintah untuk menginstal aplikasi/paket di Ubuntu Server (berbasis Debian) adalah?", "opsi": ["apt install", "apt update", "apt search", "apt clean"], "jawaban": 0}, {"q": "Software virtualisasi yang bisa membuka file OVA contohnya adalah?", "opsi": ["VirtualBox", "Notepad", "Photoshop", "Winbox"], "jawaban": 0}, {"q": "Untuk melihat alamat IP di Ubuntu Server, perintah yang bisa digunakan adalah?", "opsi": ["ip addr", "cd ip", "ls ip", "open ip"], "jawaban": 0}], "hard": [{"q": "Perintah untuk memberi hak akses root sementara pada perintah biasa di Ubuntu adalah?", "opsi": ["sudo", "admin", "root-run", "superuser"], "jawaban": 0}, {"q": "File konfigurasi Netplan untuk mengatur IP statis di Ubuntu Server berformat?", "opsi": ["YAML", "JSON", "XML", "INI"], "jawaban": 0}, {"q": "Perintah untuk melihat status sebuah service yang berjalan di Ubuntu Server (systemd) adalah?", "opsi": ["systemctl status", "service view", "ps status", "ls status"], "jawaban": 0}, {"q": "Layanan yang harus aktif agar Ubuntu Server bisa diakses jarak jauh lewat terminal adalah?", "opsi": ["SSH", "FTP", "DNS", "DHCP"], "jawaban": 0}]}, "matematika": {"easy": [{"q": "Hasil dari 15 + 27 adalah?", "opsi": ["42", "41", "43", "52"], "jawaban": 0}, {"q": "Bentuk sederhana dari pecahan 4/8 adalah?", "opsi": ["1/2", "1/4", "2/3", "1/3"], "jawaban": 0}, {"q": "Keliling persegi dengan panjang sisi 5 cm adalah?", "opsi": ["20 cm", "25 cm", "15 cm", "10 cm"], "jawaban": 0}, {"q": "Hasil dari 8 x 9 adalah?", "opsi": ["72", "63", "81", "64"], "jawaban": 0}], "medium": [{"q": "Akar kuadrat dari 144 adalah?", "opsi": ["12", "14", "16", "11"], "jawaban": 0}, {"q": "Jika x + 5 = 12, maka nilai x adalah?", "opsi": ["7", "6", "8", "5"], "jawaban": 0}, {"q": "Luas lingkaran dengan jari-jari 7 cm (π = 22/7) adalah?", "opsi": ["154 cm²", "144 cm²", "164 cm²", "134 cm²"], "jawaban": 0}, {"q": "Hasil dari 2³ (2 pangkat 3) adalah?", "opsi": ["8", "6", "9", "4"], "jawaban": 0}], "hard": [{"q": "Turunan pertama dari f(x) = x² adalah?", "opsi": ["2x", "x", "2", "x²"], "jawaban": 0}, {"q": "Nilai dari log 100 (basis 10) adalah?", "opsi": ["2", "10", "100", "1"], "jawaban": 0}, {"q": "Hasil dari limit x mendekati 0 dari (sin x)/x adalah?", "opsi": ["1", "0", "tak terhingga", "-1"], "jawaban": 0}, {"q": "Determinan matriks [[2,1],[3,4]] adalah?", "opsi": ["5", "7", "-2", "10"], "jawaban": 0}]}, "bindo": {"easy": [{"q": "Kalimat yang berisi ajakan disebut kalimat?", "opsi": ["Ajakan (Imperatif)", "Berita", "Tanya", "Pengandaian"], "jawaban": 0}, {"q": "Kata yang menunjukkan nama orang, tempat, atau benda disebut?", "opsi": ["Kata Benda (Nomina)", "Kata Kerja", "Kata Sifat", "Kata Sambung"], "jawaban": 0}, {"q": "Karya tulis yang menceritakan kisah rekaan/khayalan disebut?", "opsi": ["Cerita Fiksi", "Biografi", "Laporan", "Eksposisi"], "jawaban": 0}, {"q": "Tanda baca untuk mengakhiri kalimat berita adalah?", "opsi": ["Titik (.)", "Koma (,)", "Tanya (?)", "Seru (!)"], "jawaban": 0}], "medium": [{"q": "Kalimat yang subjeknya dikenai suatu pekerjaan disebut kalimat?", "opsi": ["Kalimat Pasif", "Kalimat Aktif", "Kalimat Tanya", "Kalimat Seru"], "jawaban": 0}, {"q": "Teks yang bertujuan menggambarkan sesuatu secara rinci disebut teks?", "opsi": ["Deskripsi", "Narasi", "Eksposisi", "Argumentasi"], "jawaban": 0}, {"q": "Gaya bahasa yang membandingkan dua hal secara langsung dengan kata \"seperti/bagai\" disebut?", "opsi": ["Simile (Perumpamaan)", "Personifikasi", "Hiperbola", "Metafora"], "jawaban": 0}, {"q": "Bagian teks yang berisi kesimpulan biasanya disebut?", "opsi": ["Penutup/Simpulan", "Pembuka", "Orientasi", "Komplikasi"], "jawaban": 0}], "hard": [{"q": "Karya sastra berbentuk dialog dan biasa dipentaskan disebut?", "opsi": ["Drama", "Puisi", "Pantun", "Esai"], "jawaban": 0}, {"q": "Unsur intrinsik karya sastra yang berkaitan dengan waktu, tempat, dan suasana disebut?", "opsi": ["Latar (Setting)", "Tema", "Alur", "Amanat"], "jawaban": 0}, {"q": "Majas yang memberikan sifat manusia kepada benda mati disebut?", "opsi": ["Personifikasi", "Simile", "Metonimia", "Litotes"], "jawaban": 0}, {"q": "Jenis paragraf yang kalimat utamanya terletak di awal disebut paragraf?", "opsi": ["Deduktif", "Induktif", "Campuran", "Naratif"], "jawaban": 0}]}, "binggris": {"easy": [{"q": "\"Book\" dalam Bahasa Indonesia artinya?", "opsi": ["Buku", "Meja", "Pena", "Tas"], "jawaban": 0}, {"q": "Bentuk lampau (past tense) dari \"go\" adalah?", "opsi": ["went", "goes", "gone", "going"], "jawaban": 0}, {"q": "\"I ___ a student.\" Kata yang tepat untuk melengkapi adalah?", "opsi": ["am", "is", "are", "be"], "jawaban": 0}, {"q": "\"Good morning\" digunakan untuk menyapa pada waktu?", "opsi": ["Pagi hari", "Siang hari", "Sore hari", "Malam hari"], "jawaban": 0}], "medium": [{"q": "Bentuk kata kerja ketiga (past participle) dari \"eat\" adalah?", "opsi": ["eaten", "ate", "eating", "eats"], "jawaban": 0}, {"q": "Kalimat \"She is reading a book\" menggunakan tenses?", "opsi": ["Present Continuous Tense", "Simple Past Tense", "Future Tense", "Present Perfect Tense"], "jawaban": 0}, {"q": "Lawan kata (antonim) dari \"happy\" adalah?", "opsi": ["sad", "glad", "angry", "tired"], "jawaban": 0}, {"q": "Kata sifat (adjective) pada kalimat \"The cat is cute\" adalah?", "opsi": ["cute", "cat", "is", "the"], "jawaban": 0}], "hard": [{"q": "Kalimat pasif (passive voice) dari \"They clean the room\" adalah?", "opsi": ["The room is cleaned by them", "The room cleans them", "They is cleaned the room", "The room was clean them"], "jawaban": 0}, {"q": "Kata penghubung (conjunction) yang menyatakan sebab adalah?", "opsi": ["because", "although", "but", "or"], "jawaban": 0}, {"q": "Conditional sentence type 2 digunakan untuk menyatakan?", "opsi": ["Pengandaian yang tidak nyata saat ini", "Fakta ilmiah", "Kejadian di masa depan yang pasti", "Kejadian yang sudah pasti terjadi"], "jawaban": 0}, {"q": "Kata \"although\" termasuk jenis kata?", "opsi": ["Conjunction (kata hubung)", "Noun", "Verb", "Adverb"], "jawaban": 0}]}, "ppkn": {"easy": [{"q": "Dasar negara Indonesia adalah?", "opsi": ["Pancasila", "UUD 1945", "GBHN", "Tap MPR"], "jawaban": 0}, {"q": "Lambang sila pertama Pancasila adalah?", "opsi": ["Bintang", "Rantai", "Pohon Beringin", "Kepala Banteng"], "jawaban": 0}, {"q": "Hari Lahir Pancasila diperingati setiap tanggal?", "opsi": ["1 Juni", "17 Agustus", "28 Oktober", "10 November"], "jawaban": 0}, {"q": "Bendera negara Indonesia berwarna?", "opsi": ["Merah Putih", "Merah Kuning", "Putih Biru", "Kuning Hijau"], "jawaban": 0}], "medium": [{"q": "Undang-Undang Dasar negara Republik Indonesia disahkan pada tahun?", "opsi": ["1945", "1949", "1950", "1965"], "jawaban": 0}, {"q": "Sila Pancasila yang berbunyi \"Persatuan Indonesia\" adalah sila ke-?", "opsi": ["3", "1", "4", "5"], "jawaban": 0}, {"q": "Lembaga negara yang bertugas membuat undang-undang bersama presiden adalah?", "opsi": ["DPR", "MA", "BPK", "KY"], "jawaban": 0}, {"q": "Sikap yang mencerminkan pengamalan sila keempat Pancasila adalah?", "opsi": ["Musyawarah Mufakat", "Gotong Royong", "Toleransi Beragama", "Cinta Tanah Air"], "jawaban": 0}], "hard": [{"q": "Perubahan (amandemen) UUD 1945 sudah dilakukan sebanyak berapa kali?", "opsi": ["4 kali", "2 kali", "3 kali", "5 kali"], "jawaban": 0}, {"q": "Lembaga negara yang berwenang menguji undang-undang terhadap UUD adalah?", "opsi": ["Mahkamah Konstitusi", "Mahkamah Agung", "DPD", "Komisi Yudisial"], "jawaban": 0}, {"q": "Sistem pemerintahan yang dianut Indonesia adalah sistem?", "opsi": ["Presidensial", "Parlementer", "Monarki", "Federal"], "jawaban": 0}, {"q": "Hak asasi manusia diatur secara khusus dalam UUD 1945 pada bab?", "opsi": ["Bab XA", "Bab VII", "Bab III", "Bab IX"], "jawaban": 0}]}, "ipas": {"easy": [{"q": "Proses tumbuhan membuat makanan sendiri menggunakan cahaya matahari disebut?", "opsi": ["Fotosintesis", "Respirasi", "Transpirasi", "Fermentasi"], "jawaban": 0}, {"q": "Planet terbesar dalam tata surya adalah?", "opsi": ["Jupiter", "Saturnus", "Bumi", "Mars"], "jawaban": 0}, {"q": "Alat pernapasan utama pada manusia adalah?", "opsi": ["Paru-paru", "Jantung", "Hati", "Ginjal"], "jawaban": 0}, {"q": "Wujud air yang berubah menjadi es disebut peristiwa?", "opsi": ["Membeku", "Mencair", "Menguap", "Mengembun"], "jawaban": 0}], "medium": [{"q": "Gaya yang menyebabkan benda jatuh ke bumi disebut gaya?", "opsi": ["Gravitasi", "Gesek", "Magnet", "Pegas"], "jawaban": 0}, {"q": "Zat yang dapat menghantarkan arus listrik disebut?", "opsi": ["Konduktor", "Isolator", "Semikonduktor", "Resistor"], "jawaban": 0}, {"q": "Proses perubahan air menjadi uap disebut?", "opsi": ["Penguapan (Evaporasi)", "Pengembunan", "Pembekuan", "Pengendapan"], "jawaban": 0}, {"q": "Organ tubuh yang berfungsi memompa darah adalah?", "opsi": ["Jantung", "Paru-paru", "Ginjal", "Lambung"], "jawaban": 0}], "hard": [{"q": "Satuan yang digunakan untuk mengukur energi listrik adalah?", "opsi": ["Joule/Watt", "Newton", "Pascal", "Celcius"], "jawaban": 0}, {"q": "Proses pembelahan sel untuk menghasilkan sel anak yang identik disebut?", "opsi": ["Mitosis", "Meiosis", "Fertilisasi", "Fotosintesis"], "jawaban": 0}, {"q": "Lapisan atmosfer bumi yang melindungi dari radiasi ultraviolet adalah lapisan?", "opsi": ["Ozon", "Troposfer", "Ionosfer", "Mesosfer"], "jawaban": 0}, {"q": "Perubahan wujud dari gas langsung menjadi padat disebut?", "opsi": ["Deposisi", "Sublimasi", "Kondensasi", "Kristalisasi"], "jawaban": 0}]}, "pjok": {"easy": [{"q": "Induk organisasi sepak bola dunia adalah?", "opsi": ["FIFA", "PSSI", "AFC", "UEFA"], "jawaban": 0}, {"q": "Jumlah pemain dalam satu tim sepak bola yang berada di lapangan adalah?", "opsi": ["11", "10", "9", "12"], "jawaban": 0}, {"q": "Gerakan pemanasan sebelum olahraga bertujuan untuk?", "opsi": ["Mencegah cedera", "Menambah berat badan", "Mempercepat lelah", "Menahan napas"], "jawaban": 0}, {"q": "Cabang olahraga yang menggunakan raket dan shuttlecock adalah?", "opsi": ["Bulu tangkis", "Tenis meja", "Sepak takraw", "Voli"], "jawaban": 0}], "medium": [{"q": "Induk organisasi bola basket Indonesia adalah?", "opsi": ["PERBASI", "PSSI", "PBVSI", "PERPANI"], "jawaban": 0}, {"q": "Teknik dasar dalam bola voli untuk mengawali permainan disebut?", "opsi": ["Servis", "Smash", "Blok", "Passing"], "jawaban": 0}, {"q": "Lama waktu pertandingan sepak bola resmi (2 babak) adalah?", "opsi": ["90 menit", "60 menit", "80 menit", "100 menit"], "jawaban": 0}, {"q": "Cabang atletik yang berupa lari jarak pendek disebut?", "opsi": ["Lari Sprint", "Lari Maraton", "Lari Estafet", "Lari Gawang"], "jawaban": 0}], "hard": [{"q": "Induk organisasi atletik dunia disebut?", "opsi": ["World Athletics", "FIFA", "FINA", "IOC"], "jawaban": 0}, {"q": "Teknik pernapasan yang benar saat renang gaya bebas dilakukan dengan cara?", "opsi": ["Menoleh ke samping saat mengambil napas", "Menahan napas sepanjang renang", "Mengangkat kepala penuh ke depan", "Menyelam sebelum bernapas"], "jawaban": 0}, {"q": "Jumlah pemain dalam satu tim bola basket yang berada di lapangan adalah?", "opsi": ["5", "6", "7", "4"], "jawaban": 0}, {"q": "Cedera akibat peregangan otot yang berlebihan disebut?", "opsi": ["Strain", "Sprain", "Fraktur", "Dislokasi"], "jawaban": 0}]}, "sejarah": {"easy": [{"q": "Indonesia memproklamasikan kemerdekaan pada tanggal?", "opsi": ["17 Agustus 1945", "1 Juni 1945", "28 Oktober 1928", "10 November 1945"], "jawaban": 0}, {"q": "Proklamator kemerdekaan Indonesia adalah Soekarno dan?", "opsi": ["Mohammad Hatta", "Sutan Sjahrir", "Ahmad Soebardjo", "Sayuti Melik"], "jawaban": 0}, {"q": "Kerajaan maritim terbesar di Nusantara pada masa lampau adalah?", "opsi": ["Sriwijaya", "Mataram", "Demak", "Singasari"], "jawaban": 0}, {"q": "Organisasi pergerakan nasional pertama di Indonesia adalah?", "opsi": ["Budi Utomo", "Sarekat Islam", "Indische Partij", "Muhammadiyah"], "jawaban": 0}], "medium": [{"q": "Peristiwa penculikan Soekarno-Hatta sebelum proklamasi disebut peristiwa?", "opsi": ["Rengasdengklok", "Bandung Lautan Api", "Serangan Umum 1 Maret", "Pertempuran Surabaya"], "jawaban": 0}, {"q": "Kongres Pemuda II yang menghasilkan Sumpah Pemuda terjadi pada tahun?", "opsi": ["1928", "1908", "1945", "1949"], "jawaban": 0}, {"q": "Bangsa Eropa yang pertama kali mendarat di Indonesia mencari rempah-rempah adalah?", "opsi": ["Portugis", "Inggris", "Prancis", "Jerman"], "jawaban": 0}, {"q": "Konferensi yang mengakui kedaulatan Indonesia oleh Belanda dilaksanakan pada tahun?", "opsi": ["1949 (KMB)", "1945", "1947", "1950"], "jawaban": 0}], "hard": [{"q": "Peristiwa pemberontakan G30S terjadi pada tahun?", "opsi": ["1965", "1955", "1970", "1960"], "jawaban": 0}, {"q": "Kabinet pertama yang dibentuk setelah kemerdekaan Indonesia disebut?", "opsi": ["Kabinet Presidensial", "Kabinet Parlementer", "Kabinet Kerja", "Kabinet Ampera"], "jawaban": 0}, {"q": "Perjanjian yang mengakhiri konflik Indonesia-Belanda tahun 1949 dan mengakui kedaulatan RI adalah?", "opsi": ["Konferensi Meja Bundar", "Perjanjian Linggarjati", "Perjanjian Renville", "Perjanjian Roem-Royen"], "jawaban": 0}, {"q": "Tokoh yang mengetik naskah proklamasi kemerdekaan Indonesia adalah?", "opsi": ["Sayuti Melik", "Ahmad Soebardjo", "Fatmawati", "BM Diah"], "jawaban": 0}]}, "senibudaya": {"easy": [{"q": "Alat musik tradisional dari Jawa Barat yang dimainkan dengan cara digoyang adalah?", "opsi": ["Angklung", "Gamelan", "Sasando", "Kolintang"], "jawaban": 0}, {"q": "Warna yang termasuk warna primer adalah merah, kuning, dan?", "opsi": ["Biru", "Hijau", "Ungu", "Oranye"], "jawaban": 0}, {"q": "Tari tradisional dari Bali yang menggambarkan kisah Ramayana adalah?", "opsi": ["Tari Kecak", "Tari Saman", "Tari Piring", "Tari Jaipong"], "jawaban": 0}, {"q": "Alat untuk melukis di atas kanvas biasanya menggunakan?", "opsi": ["Kuas", "Pahat", "Cetok", "Gergaji"], "jawaban": 0}], "medium": [{"q": "Teknik menggambar dengan menyusun titik-titik disebut teknik?", "opsi": ["Pointilis", "Arsir", "Dussel", "Blok"], "jawaban": 0}, {"q": "Satu set alat musik tradisional Jawa yang terdiri dari gong, kenong, dan sejenisnya disebut?", "opsi": ["Gamelan", "Angklung", "Kolintang", "Sasando"], "jawaban": 0}, {"q": "Seni membuat batik dengan menuliskan malam menggunakan canting disebut batik?", "opsi": ["Batik Tulis", "Batik Cap", "Batik Printing", "Batik Jumputan"], "jawaban": 0}, {"q": "Tarian yang menggambarkan pergaulan muda-mudi khas Betawi adalah tari?", "opsi": ["Tari Yapong", "Tari Serimpi", "Tari Pendet", "Tari Gambyong"], "jawaban": 0}], "hard": [{"q": "Aliran seni lukis yang menonjolkan bentuk-bentuk geometris disebut aliran?", "opsi": ["Kubisme", "Realisme", "Naturalisme", "Romantisme"], "jawaban": 0}, {"q": "Wayang kulit merupakan seni pertunjukan yang berasal dari daerah?", "opsi": ["Jawa", "Sumatra", "Kalimantan", "Papua"], "jawaban": 0}, {"q": "Teknik mencampur warna dengan cara menumpuk sapuan kuas tipis secara berlapis disebut?", "opsi": ["Glazing", "Blocking", "Dussel", "Arsir"], "jawaban": 0}, {"q": "Musik dengan tangga nada pentatonis banyak dijumpai pada alat musik?", "opsi": ["Gamelan", "Biola", "Gitar", "Piano"], "jawaban": 0}]}};

        const QUIZ_BANK_ESSAY_BY_MAPEL = {"kk08": {"easy": [{"q": "Sebutkan aplikasi yang biasa dipakai untuk mengonfigurasi Mikrotik lewat tampilan grafis (GUI)!", "kunci": ["winbox"]}, {"q": "Apa nama sistem operasi router Mikrotik?", "kunci": ["routeros"]}, {"q": "Apa kepanjangan dari RB pada RouterBoard?", "kunci": ["routerboard"]}], "medium": [{"q": "Sebutkan fitur Mikrotik yang digunakan untuk membatasi bandwidth per client!", "kunci": ["simple queue", "queue"]}, {"q": "Apa nama fitur di Mikrotik yang mengatur izin/blokir lalu lintas data?", "kunci": ["firewall"]}, {"q": "Sebutkan fitur yang membuat Mikrotik otomatis mendapat IP dari ISP!", "kunci": ["dhcp client", "dhcp"]}], "hard": [{"q": "Sebutkan istilah untuk teknik menggabungkan beberapa jalur internet sekaligus di Mikrotik!", "kunci": ["load balancing"]}, {"q": "Apa nama protokol routing dinamis yang bisa dipakai di Mikrotik untuk jaringan besar?", "kunci": ["ospf"]}, {"q": "Sebutkan salah satu jenis tunnel/VPN yang didukung Mikrotik!", "kunci": ["pptp", "eoip", "l2tp", "ipsec", "sstp"]}]}, "kk17": {"easy": [{"q": "Apa nama alat yang memancarkan sinyal WiFi agar perangkat bisa terhubung ke jaringan?", "kunci": ["access point"]}, {"q": "Sebutkan istilah untuk nama jaringan WiFi yang muncul saat kita mencari WiFi!", "kunci": ["ssid"]}, {"q": "Apa istilah untuk kata sandi masuk ke jaringan WiFi?", "kunci": ["password", "passphrase", "password wifi"]}], "medium": [{"q": "Sebutkan salah satu frekuensi yang umum dipakai jaringan WiFi selain 2.4GHz!", "kunci": ["5ghz"]}, {"q": "Sebutkan metode keamanan WiFi yang lebih aman dibanding WEP!", "kunci": ["wpa2", "wpa3", "wpa"]}, {"q": "Sebutkan mode Access Point yang dipakai untuk memperluas jangkauan sinyal WiFi!", "kunci": ["repeater", "bridge"]}], "hard": [{"q": "Sebutkan istilah untuk kondisi banyak sinyal WiFi saling bertabrakan di channel yang sama!", "kunci": ["interferensi", "interferensi channel", "channel overlap"]}, {"q": "Apa nama standar keamanan WiFi terbaru pengganti WPA2?", "kunci": ["wpa3"]}, {"q": "Sebutkan istilah untuk kemampuan perangkat berpindah antar Access Point tanpa putus koneksi!", "kunci": ["roaming"]}]}, "kk06": {"easy": [{"q": "Ubuntu Server berbasis sistem operasi apa?", "kunci": ["linux"]}, {"q": "Sebutkan perintah dasar Linux untuk melihat isi folder!", "kunci": ["ls"]}, {"q": "Sebutkan perintah dasar Linux untuk berpindah folder/direktori!", "kunci": ["cd"]}], "medium": [{"q": "Sebutkan perintah di Ubuntu Server untuk menginstal software (berbasis apt)!", "kunci": ["apt install"]}, {"q": "Sebutkan software virtualisasi yang bisa dipakai untuk membuka file OVA!", "kunci": ["virtualbox", "vmware"]}, {"q": "Sebutkan perintah untuk melihat alamat IP di Ubuntu Server!", "kunci": ["ip addr", "ifconfig"]}], "hard": [{"q": "Sebutkan perintah untuk menjalankan perintah dengan hak akses root/administrator di Ubuntu!", "kunci": ["sudo"]}, {"q": "Sebutkan layanan yang dipakai supaya server bisa diakses dari jarak jauh lewat terminal!", "kunci": ["ssh"]}, {"q": "Sebutkan perintah untuk mengecek status suatu service di sistem systemd!", "kunci": ["systemctl status"]}]}, "matematika": {"easy": [{"q": "Berapa hasil dari 25 + 17?", "kunci": ["42"]}, {"q": "Sebutkan bentuk paling sederhana dari pecahan 6/9!", "kunci": ["2/3"]}, {"q": "Berapa hasil dari 9 x 6?", "kunci": ["54"]}], "medium": [{"q": "Berapa akar kuadrat dari 81?", "kunci": ["9"]}, {"q": "Jika 2x = 16, berapa nilai x?", "kunci": ["8"]}, {"q": "Berapa hasil dari 3 pangkat 3 (3³)?", "kunci": ["27"]}], "hard": [{"q": "Berapa turunan pertama dari f(x) = 3x²?", "kunci": ["6x"]}, {"q": "Berapa nilai log 1000 basis 10?", "kunci": ["3"]}, {"q": "Berapa determinan matriks [[1,2],[3,4]]?", "kunci": ["-2"]}]}, "bindo": {"easy": [{"q": "Sebutkan tanda baca yang digunakan untuk mengakhiri kalimat berita!", "kunci": ["titik", "."]}, {"q": "Apa istilah untuk kata yang menunjukkan nama orang, tempat, atau benda?", "kunci": ["kata benda", "nomina"]}, {"q": "Sebutkan istilah untuk cerita rekaan/khayalan!", "kunci": ["fiksi", "cerita fiksi"]}], "medium": [{"q": "Sebutkan istilah untuk kalimat yang subjeknya dikenai suatu pekerjaan!", "kunci": ["kalimat pasif"]}, {"q": "Sebutkan jenis teks yang bertujuan menggambarkan sesuatu secara rinci!", "kunci": ["deskripsi", "teks deskripsi"]}, {"q": "Sebutkan majas yang membandingkan dua hal memakai kata \"seperti\" atau \"bagai\"!", "kunci": ["simile", "perumpamaan"]}], "hard": [{"q": "Sebutkan istilah untuk majas yang memberi sifat manusia pada benda mati!", "kunci": ["personifikasi"]}, {"q": "Sebutkan istilah untuk latar waktu, tempat, dan suasana dalam sebuah cerita!", "kunci": ["latar", "setting"]}, {"q": "Sebutkan jenis paragraf yang kalimat utamanya berada di awal!", "kunci": ["deduktif"]}]}, "binggris": {"easy": [{"q": "Apa arti kata \"book\" dalam Bahasa Indonesia?", "kunci": ["buku"]}, {"q": "Sebutkan bentuk lampau (past tense) dari kata \"go\"!", "kunci": ["went"]}, {"q": "Lengkapi: \"I ___ a student.\"", "kunci": ["am"]}], "medium": [{"q": "Sebutkan bentuk past participle (kata kerja ketiga) dari \"eat\"!", "kunci": ["eaten"]}, {"q": "Sebutkan lawan kata (antonim) dari \"happy\"!", "kunci": ["sad"]}, {"q": "Tenses apa yang dipakai pada kalimat \"She is reading a book\"?", "kunci": ["present continuous", "present continuous tense"]}], "hard": [{"q": "Sebutkan kata penghubung (conjunction) dalam Bahasa Inggris yang berarti \"karena\"!", "kunci": ["because"]}, {"q": "Ubah kalimat \"They clean the room\" menjadi kalimat pasif!", "kunci": ["the room is cleaned by them", "the room is cleaned"]}, {"q": "Conditional sentence type 2 digunakan untuk menyatakan apa?", "kunci": ["pengandaian tidak nyata", "pengandaian yang tidak nyata"]}]}, "ppkn": {"easy": [{"q": "Sebutkan dasar negara Indonesia!", "kunci": ["pancasila"]}, {"q": "Sebutkan warna bendera negara Indonesia!", "kunci": ["merah putih"]}, {"q": "Tanggal berapa Hari Lahir Pancasila diperingati?", "kunci": ["1 juni"]}], "medium": [{"q": "Sebutkan lembaga negara yang bertugas membuat undang-undang bersama presiden!", "kunci": ["dpr"]}, {"q": "Sila keberapa yang berbunyi \"Persatuan Indonesia\"?", "kunci": ["3", "ketiga"]}, {"q": "Sebutkan tahun disahkannya UUD 1945!", "kunci": ["1945"]}], "hard": [{"q": "Sebutkan sistem pemerintahan yang dianut Indonesia!", "kunci": ["presidensial"]}, {"q": "Sebutkan lembaga negara yang berwenang menguji undang-undang terhadap UUD!", "kunci": ["mahkamah konstitusi"]}, {"q": "Berapa kali UUD 1945 sudah diamandemen?", "kunci": ["4", "empat"]}]}, "ipas": {"easy": [{"q": "Sebutkan proses tumbuhan membuat makanannya sendiri!", "kunci": ["fotosintesis"]}, {"q": "Sebutkan planet terbesar dalam tata surya!", "kunci": ["jupiter"]}, {"q": "Sebutkan organ pernapasan utama pada manusia!", "kunci": ["paru paru", "paruparu"]}], "medium": [{"q": "Sebutkan gaya yang menyebabkan benda jatuh ke bumi!", "kunci": ["gravitasi"]}, {"q": "Sebutkan istilah untuk zat yang bisa menghantarkan arus listrik!", "kunci": ["konduktor"]}, {"q": "Sebutkan organ yang berfungsi memompa darah!", "kunci": ["jantung"]}], "hard": [{"q": "Sebutkan proses pembelahan sel yang menghasilkan sel anak identik!", "kunci": ["mitosis"]}, {"q": "Sebutkan lapisan atmosfer yang melindungi bumi dari radiasi ultraviolet!", "kunci": ["ozon", "lapisan ozon"]}, {"q": "Sebutkan istilah perubahan wujud dari gas langsung menjadi padat!", "kunci": ["deposisi"]}]}, "pjok": {"easy": [{"q": "Sebutkan induk organisasi sepak bola dunia!", "kunci": ["fifa"]}, {"q": "Berapa jumlah pemain sepak bola dalam satu tim di lapangan?", "kunci": ["11"]}, {"q": "Sebutkan tujuan pemanasan sebelum berolahraga!", "kunci": ["mencegah cedera"]}], "medium": [{"q": "Sebutkan induk organisasi bola basket Indonesia!", "kunci": ["perbasi"]}, {"q": "Sebutkan teknik dasar bola voli untuk mengawali permainan!", "kunci": ["servis"]}, {"q": "Berapa lama waktu pertandingan sepak bola resmi (2 babak)?", "kunci": ["90 menit", "90menit"]}], "hard": [{"q": "Sebutkan induk organisasi atletik dunia!", "kunci": ["world athletics"]}, {"q": "Berapa jumlah pemain bola basket dalam satu tim di lapangan?", "kunci": ["5"]}, {"q": "Sebutkan istilah cedera akibat peregangan otot yang berlebihan!", "kunci": ["strain"]}]}, "sejarah": {"easy": [{"q": "Sebutkan tanggal proklamasi kemerdekaan Indonesia!", "kunci": ["17 agustus 1945"]}, {"q": "Sebutkan nama dua proklamator kemerdekaan Indonesia!", "kunci": ["soekarno dan hatta", "soekarno hatta"]}, {"q": "Sebutkan kerajaan maritim besar di Nusantara pada masa lampau!", "kunci": ["sriwijaya"]}], "medium": [{"q": "Sebutkan nama peristiwa penculikan Soekarno-Hatta sebelum proklamasi!", "kunci": ["rengasdengklok"]}, {"q": "Pada tahun berapa Sumpah Pemuda dikumandangkan?", "kunci": ["1928"]}, {"q": "Sebutkan bangsa Eropa yang pertama kali mendarat di Indonesia mencari rempah-rempah!", "kunci": ["portugis"]}], "hard": [{"q": "Sebutkan tahun terjadinya peristiwa G30S!", "kunci": ["1965"]}, {"q": "Sebutkan nama tokoh yang mengetik naskah proklamasi!", "kunci": ["sayuti melik"]}, {"q": "Sebutkan nama perjanjian yang mengakui kedaulatan Indonesia oleh Belanda tahun 1949!", "kunci": ["konferensi meja bundar", "kmb"]}]}, "senibudaya": {"easy": [{"q": "Sebutkan alat musik tradisional dari Jawa Barat yang dimainkan dengan cara digoyang!", "kunci": ["angklung"]}, {"q": "Sebutkan tiga warna primer!", "kunci": ["merah kuning biru"]}, {"q": "Sebutkan alat yang digunakan untuk melukis di atas kanvas!", "kunci": ["kuas"]}], "medium": [{"q": "Sebutkan nama teknik menggambar dengan menyusun titik-titik!", "kunci": ["pointilis"]}, {"q": "Sebutkan nama satu set alat musik tradisional Jawa (gong, kenong, dll)!", "kunci": ["gamelan"]}, {"q": "Sebutkan istilah batik yang dibuat dengan menuliskan malam pakai canting!", "kunci": ["batik tulis"]}], "hard": [{"q": "Sebutkan aliran seni lukis yang menonjolkan bentuk-bentuk geometris!", "kunci": ["kubisme"]}, {"q": "Wayang kulit berasal dari daerah mana?", "kunci": ["jawa"]}, {"q": "Sebutkan istilah teknik mencampur warna dengan menumpuk sapuan kuas tipis secara berlapis!", "kunci": ["glazing"]}]}};

        /* ============================================================
           JENIS QUIZ: ESSAY (terpisah dari Pilihan Ganda)
           - Essay TIDAK terhubung ke leaderboard & border koleksi (yang
             skemanya sudah kadung dibangun khusus utk 3 level Pilihan
             Ganda) -- Essay cuma nyimpen skor terbaik per level secara
             lokal, biar aman & tidak mengubah perilaku fitur lama.
           - Jawaban siswa dicocokkan OTOMATIS ke kunci jawaban (teks),
             lewat normalisasi huruf kecil + hilangkan tanda baca/spasi
             berlebih, supaya variasi kecil (kapital, spasi, titik)
             tetap dianggap benar.
           ============================================================ */
        const KEY_QUIZ_ESSAY_DATA = `quiz_essay_data_${ID_SISWA_AKTIF}`;
        const KEY_QUIZ_ESSAY_SEEN_IDS = `quiz_essay_seen_ids_${ID_SISWA_AKTIF}`;

        const QUIZ_CONFIG_ESSAY = {
            easy:   { label: 'Easy',   poinDasar: 15, waktu: 40, warnaBadge: 'bg-emerald-100 text-emerald-700', warnaBar: 'bg-emerald-500' },
            medium: { label: 'Medium', poinDasar: 25, waktu: 30, warnaBadge: 'bg-amber-100 text-amber-700',     warnaBar: 'bg-amber-500' },
            hard:   { label: 'Hard',   poinDasar: 40, waktu: 25, warnaBadge: 'bg-rose-100 text-rose-700',       warnaBar: 'bg-rose-500' }
        };

        function getQuizEssayData() {
            let data;
            try {
                const raw = localStorage.getItem(KEY_QUIZ_ESSAY_DATA);
                data = raw ? JSON.parse(raw) : { bestByLevel: { easy: 0, medium: 0, hard: 0 }, leaderboard: [] };
            } catch (e) {
                data = { bestByLevel: { easy: 0, medium: 0, hard: 0 }, leaderboard: [] };
            }

            // Sama seperti getQuizData() milik Pilihan Ganda: rapikan leaderboard
            // supaya cuma nyisain 1 entri (skor terbaik) per siswa per level.
            if (data.leaderboard && data.leaderboard.length) {
                const bersih = dedupLeaderboardQuiz(data.leaderboard);
                if (bersih.length !== data.leaderboard.length) {
                    data.leaderboard = bersih;
                    try { localStorage.setItem(KEY_QUIZ_ESSAY_DATA, JSON.stringify(data)); } catch (e) {}
                } else {
                    data.leaderboard = bersih;
                }
            }

            return data;
        }

        function saveQuizEssayData(data) {
            localStorage.setItem(KEY_QUIZ_ESSAY_DATA, JSON.stringify(data));
            simpanQuizKeServer('essay', data);
        }

        function acakSoalQuizEssay(mapelId, level, jumlah) {
            const bankMapel = (QUIZ_BANK_ESSAY_BY_MAPEL[mapelId] && QUIZ_BANK_ESSAY_BY_MAPEL[mapelId][level]) || [];
            const bank = [...bankMapel];
            for (let i = bank.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [bank[i], bank[j]] = [bank[j], bank[i]];
            }
            return bank.slice(0, Math.min(jumlah, bank.length));
        }

        // Normalisasi teks (huruf kecil, hilangkan tanda baca & spasi berlebih)
        // supaya jawaban siswa yg beda kapital/spasi/titik-koma tetap dianggap benar.
        function bersihkanTeksEssay(teks) {
            return (teks || '')
                .toLowerCase()
                .normalize('NFKD')
                .replace(/[^a-z0-9 ]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function cocokkanJawabanEssay(jawabanSiswa, daftarKunci) {
            const jawabanBersih = bersihkanTeksEssay(jawabanSiswa);
            if (!jawabanBersih) return false;
            return daftarKunci.some(k => bersihkanTeksEssay(k) === jawabanBersih);
        }

        function getConfigQuizAktif() {
            if (!quizState) return null;
            return quizState.jenis === 'essay' ? QUIZ_CONFIG_ESSAY[quizState.level] : QUIZ_CONFIG[quizState.level];
        }

        let quizState = null; // { jenis: 'pg'|'essay', level, soal[], index, skor, benar, waktuSisa, timerId }

        // ============================================================
        // SAFETY NET LOKAL UNTUK QUIZ YANG SEDANG DIKERJAKAN
        // ------------------------------------------------------------
        // Selama ini quizState di atas HANYA hidup di memori (variabel JS
        // biasa) selama quiz berjalan -- baru ditulis ke localStorage &
        // dikirim ke server (simpanQuizKeServer, SATU request besar/bulk)
        // pas soal TERAKHIR selesai dijawab, lewat selesaikanQuiz()/
        // selesaikanQuizEssay() di bawah. Kalau koneksi ngadat atau
        // tab/browser tertutup DI TENGAH quiz (belum sampai soal
        // terakhir), seluruh progres yang sudah dikerjakan hilang
        // percuma karena cuma ada di memori.
        //
        // Fungsi-fungsi di bawah ini menambah lapisan pengaman: setiap
        // kali siswa selesai menjawab 1 soal (dipanggil dari
        // pilihJawabanQuiz()/jawabEssayQuiz()), snapshot progres saat itu
        // (soal, index, skor, benar) langsung ditulis ke localStorage
        // secara INSTAN. Ini TIDAK mengubah alur pengiriman ke server --
        // server tetap cuma menerima SATU request bulk di akhir seperti
        // sebelumnya. Snapshot ini murni jaga-jaga di sisi browser saja,
        // dan otomatis ditawarkan untuk dilanjutkan lewat
        // bukaQuizDariAwal() (lihat listener switchTab tabName==='quiz')
        // kalau ketemu progres yang belum sempat tuntas.
        // ============================================================
        const KEY_QUIZ_INPROGRESS = `quiz_inprogress_${ID_SISWA_AKTIF}`;

        function simpanProgressQuizSementara() {
            if (!quizState) return;
            try {
                const snapshot = {
                    jenis: quizState.jenis,
                    level: quizState.level,
                    mapelId: quizState.mapelId,
                    mapelNama: quizState.mapelNama,
                    soal: quizState.soal,
                    index: quizState.index,
                    skor: quizState.skor,
                    benar: quizState.benar,
                    disimpanPada: Date.now()
                };
                localStorage.setItem(KEY_QUIZ_INPROGRESS, JSON.stringify(snapshot));
            } catch (e) {
                // localStorage penuh/nonaktif -- abaikan, quiz tetap jalan normal
                // di memori (quizState), cuma safety net-nya saja yang tidak aktif.
            }
        }

        function hapusProgressQuizSementara() {
            try { localStorage.removeItem(KEY_QUIZ_INPROGRESS); } catch (e) {}
        }

        // Dipanggil dari bukaQuizDariAwal() sebelum quiz baru direset ke menu.
        // Validasi ketat: snapshot cuma dianggap valid kalau soal-nya array
        // & index-nya masih di dalam batas (belum "selesai semua" secara
        // tidak sengaja tertinggal karena gagal terhapus).
        function ambilProgressQuizSementara() {
            try {
                const raw = localStorage.getItem(KEY_QUIZ_INPROGRESS);
                if (!raw) return null;
                const snap = JSON.parse(raw);
                if (!snap || !Array.isArray(snap.soal) || typeof snap.index !== 'number') return null;
                if (snap.index >= snap.soal.length) return null; // sudah kejawab semua, tidak perlu ditawarkan lagi
                return snap;
            } catch (e) {
                return null;
            }
        }

        // Merekonstruksi quizState persis dari snapshot localStorage & langsung
        // menampilkan soal berikutnya yang belum sempat dijawab -- dipakai
        // siswa memilih "Lanjutkan" di konfirmasi dalam bukaQuizDariAwal().
        // waktuSisa SENGAJA direset penuh (bukan dihitung mundur dari snapshot
        // lama) karena kita tidak tahu persis berapa detik yang sudah lewat
        // sejak snapshot terakhir disimpan (mis. baru dibuka lagi besoknya).
        function lanjutkanQuizDariSnapshot(snapshot) {
            quizJenisDipilih = snapshot.jenis === 'essay' ? 'essay' : 'pg';
            quizMapelState.mapelId = snapshot.mapelId;
            quizMapelState.mapelNama = snapshot.mapelNama;

            const cfg = snapshot.jenis === 'essay' ? QUIZ_CONFIG_ESSAY[snapshot.level] : QUIZ_CONFIG[snapshot.level];
            quizState = {
                jenis: snapshot.jenis,
                level: snapshot.level,
                mapelId: snapshot.mapelId,
                mapelNama: snapshot.mapelNama,
                soal: snapshot.soal,
                index: snapshot.index,
                skor: snapshot.skor,
                benar: snapshot.benar,
                waktuSisa: cfg.waktu,
                timerId: null
            };

            tampilkanViewQuiz('play');
            document.getElementById('quiz-play-total').innerText = String(snapshot.soal.length);
            const badge = document.getElementById('quiz-play-level-badge');
            if (badge) {
                badge.className = `px-3 py-1 rounded-lg text-xs font-bold ${cfg.warnaBadge}`;
                badge.innerText = snapshot.jenis === 'essay' ? `${cfg.label} · Essay` : cfg.label;
            }
            const mapelBadge = document.getElementById('quiz-play-mapel-badge');
            if (mapelBadge) mapelBadge.innerText = quizMapelState.mapelNama || '';

            renderSoalQuiz();
        }

        // ============================================================
        // STATE PEMILIHAN MAPEL QUIZ (kategori produktif/umum + mapel spesifik)
        // Dipilih di antara VIEW "jenis" (PG/Essay) dan VIEW "tingkat kesulitan".
        // Tingkat kesulitan (easy/medium/hard) TETAP ada di setiap mapel yang
        // dipilih -- mapel cuma menentukan bank soal mana yang dipakai, sistem
        // poin/leaderboard per tingkat kesulitan tidak diubah.
        // ============================================================
        let quizJenisDipilih = 'pg'; // 'pg' | 'essay', diset oleh pilihJenisQuiz()
        let quizMapelState = { kategori: null, mapelId: null, mapelNama: null };

        function getSemuaMapelQuiz() {
            return [...MAPEL_QUIZ.produktif, ...MAPEL_QUIZ.umum];
        }

        function getMapelByIdQuiz(mapelId) {
            return getSemuaMapelQuiz().find(m => m.id === mapelId) || null;
        }

        let quizFilterLeaderboardAktif = 'semua';
        let quizFilterLeaderboardEssayAktif = 'semua';

        function getQuizData() {
            let data;
            try {
                const raw = localStorage.getItem(KEY_QUIZ_DATA);
                data = raw ? JSON.parse(raw) : { totalPoin: 0, bestByLevel: { easy: 0, medium: 0, hard: 0 }, totalPoinByLevel: { easy: 0, medium: 0, hard: 0 }, leaderboard: [] };
            } catch (e) {
                data = { totalPoin: 0, bestByLevel: { easy: 0, medium: 0, hard: 0 }, totalPoinByLevel: { easy: 0, medium: 0, hard: 0 }, leaderboard: [] };
            }

            // Bersih-bersih data lama: kalau masih ada sisa beberapa entri leaderboard
            // untuk siswa+level yang sama (peninggalan sebelum aturan "cuma simpan
            // skor terbaik" berlaku), rapikan jadi cuma 1 entri per siswa per level
            // -- yang skornya paling tinggi. Berlaku otomatis untuk semua tingkat
            // kesulitan (easy/medium/hard) tiap kali data quiz dibaca.
            if (data.leaderboard && data.leaderboard.length) {
                const bersih = dedupLeaderboardQuiz(data.leaderboard);
                data.leaderboard = bersih;
            }

            // SELF-HEAL: kadang bestByLevel (poin tertinggi yang tercatat) sudah
            // lebih tinggi daripada entri milik siswa ini di data.leaderboard --
            // misalnya karena data lama sebelum leaderboard-array ini ada, atau
            // sinkronisasi ke server sempat gagal. Kalau dibiarkan, poin tertinggi
            // itu TIDAK akan muncul di leaderboard sampai siswa main quiz lagi.
            // Untuk itu, setiap kali data quiz dibaca, entri leaderboard milik
            // siswa ini disamakan otomatis dengan bestByLevel -- jadi poin
            // tertinggi yang SUDAH tercatat langsung kelihatan tanpa perlu
            // ngerjain ulang.
            const berubah = sinkronkanLeaderboardDenganPoinTerbaik(data);

            if (berubah) {
                try { localStorage.setItem(KEY_QUIZ_DATA, JSON.stringify(data)); } catch (e) {}
                simpanQuizKeServer('pg', data);
            }

            return data;
        }

        // Menyamakan data.leaderboard milik SISWA INI dengan data.bestByLevel:
        // kalau di suatu level bestByLevel-nya lebih tinggi dari skor yang ada
        // di leaderboard (atau entrinya belum ada sama sekali), entri leaderboard
        // dibuat/ditimpa pakai poin tertinggi yang sudah tercatat itu. Skor milik
        // siswa lain tidak disentuh. Mengembalikan true kalau ada perubahan.
        function sinkronkanLeaderboardDenganPoinTerbaik(data) {
            const best = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
            data.leaderboard = data.leaderboard || [];
            let berubah = false;

            ['easy', 'medium', 'hard'].forEach(level => {
                const poinTerbaik = best[level] || 0;
                if (poinTerbaik <= 0) return; // belum pernah main level ini sama sekali

                const entriLama = data.leaderboard.find(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === level);
                if (entriLama && entriLama.skor >= poinTerbaik) return; // sudah sinkron

                const borderAktif = getBorderTerpakai();
                const entriBaru = {
                    id: entriLama ? entriLama.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    nama: NAMA_PEMAIN_QUIZ,
                    kelas: getKelasAktifQuiz(),
                    foto: getFotoProfilAktifQuiz(),
                    border: borderAktif.file,
                    borderTitle: borderAktif.rank,
                    efekNama: getEfekNamaClass(borderAktif),
                    badgeDev: getBadgeDevHtml(borderAktif),
                    level,
                    skor: poinTerbaik,
                    // Detail jumlah soal benar tidak diketahui kalau entrinya baru
                    // dibuat dari bestByLevel (bukan dari sesi main barusan) --
                    // dibiarkan kosong, ditangani oleh tampilan (fallback "-").
                    benar: entriLama ? entriLama.benar : null,
                    total: entriLama ? entriLama.total : null,
                    tanggal: entriLama ? entriLama.tanggal : new Date().toISOString()
                };

                if (entriLama) {
                    Object.assign(entriLama, entriBaru);
                } else {
                    data.leaderboard.push(entriBaru);
                }
                berubah = true;
            });

            return berubah;
        }

        // Sisakan 1 entri per kombinasi nama+level di leaderboard, yaitu yang
        // skornya tertinggi (kalau skornya sama, ambil yang tanggalnya paling baru).
        function dedupLeaderboardQuiz(list) {
            const terbaikPerOrang = new Map();
            list.forEach(e => {
                const kunci = `${e.nama}||${e.level}`;
                const existing = terbaikPerOrang.get(kunci);
                if (!existing || e.skor > existing.skor ||
                    (e.skor === existing.skor && new Date(e.tanggal) > new Date(existing.tanggal))) {
                    terbaikPerOrang.set(kunci, e);
                }
            });
            return Array.from(terbaikPerOrang.values());
        }

        function saveQuizData(data) {
            localStorage.setItem(KEY_QUIZ_DATA, JSON.stringify(data));
            simpanQuizKeServer('pg', data);
        }

        // ============================================================
        // SINKRONISASI SERVER: dulu leaderboard cuma hidup di localStorage
        // (per browser, dan bahkan dinamespace per akun) sehingga akun lain
        // -- apalagi dari perangkat lain -- tidak akan pernah lihat entri
        // akun ini. Sekarang tiap kali data quiz disimpan, dikirim juga ke
        // server (per akun yang sedang login lewat session Flask) supaya:
        //   1) Progress akun ini ikut tersimpan di server (bukan cuma
        //      browser ini), dan
        //   2) Leaderboard bisa digabung dari SEMUA akun siswa lewat
        //      /api/quiz/leaderboard-global, jadi benar-benar keliatan
        //      lintas akun.
        // Dikirim "fire-and-forget" (tidak menghalangi UI) -- localStorage
        // tetap jadi cache lokal biar quiz tetap kerasa instan/responsif.
        // ============================================================
        function simpanQuizKeServer(jenis, data, percobaanUlang) {
            // slot_id: ID_SISWA_AKTIF (akun asli, ATAU id profil dummy kalau
            // sedang "coba sebagai akun dummy"). Ini yang bikin tiap profil
            // dummy punya slot penyimpanan sendiri di server -- kalau tidak
            // dikirim, semua profil dummy di 1 akun asli yang sama bakal
            // saling timpa (lihat _kunci_slot_quiz di app.py).
            //
            // BUG YANG DIPERBAIKI: request ini dulu "fire-and-forget" TANPA
            // keepalive & TANPA retry -- kalau tab langsung pindah halaman
            // (mis. klik "kembali ke beranda" langsung setelah selesai quiz)
            // atau server sempat restart di tengah jalan (lihat catatan
            // debug=True di app.py: reloader Flask auto-restart proses tiap
            // ada file berubah), request ini bisa ke-drop diam-diam. Efeknya:
            // skor sudah kesimpen di localStorage (jadi kelihatan di layar
            // hasil quiz), tapi TIDAK PERNAH nyampe ke server -- sehingga
            // (a) hilang lagi begitu sinkronkanQuizDenganServer() menarik
            // data server yang masih lama, dan (b) tidak pernah muncul di
            // leaderboard gabungan buat siswa lain. keepalive:true bikin
            // request tetap dicoba jalan walau halaman langsung ditinggal,
            // dan retry 1x menutup celah kalau percobaan pertama gagal
            // (mis. pas server pas restart).
            fetch('/api/quiz/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({ jenis, data, expected_username: USERNAME_SISWA_ASLI, slot_id: ID_SISWA_AKTIF })
            })
                .then(res => res.json())
                .then(hasil => {
                    if (hasil && hasil.session_mismatch) tampilkanPeringatanSesiBerubah();
                })
                .catch(() => {
                    if (!percobaanUlang) {
                        setTimeout(() => simpanQuizKeServer(jenis, data, true), 1500);
                    }
                    /* sudah retry & masih gagal juga -> data tetap aman di localStorage */
                });
        }

        // Ditampilkan kalau server nolak simpan karena akun yang login SEKARANG
        // (di browser ini) sudah beda dari akun yang tadinya buka halaman ini --
        // biasanya karena login akun lain di tab lain tanpa logout dulu. Skor
        // yang barusan dimainkan TIDAK ikut kesimpen ke akun yang salah, tapi
        // juga belum kesimpen ke server sama sekali sampai halaman dimuat ulang.
        function tampilkanPeringatanSesiBerubah() {
            if (document.getElementById('banner-sesi-berubah')) return; // jangan dobel
            const banner = document.createElement('div');
            banner.id = 'banner-sesi-berubah';
            banner.className = 'fixed top-0 left-0 right-0 z-[9999] bg-rose-600 text-white text-xs sm:text-sm font-semibold px-4 py-3 flex items-center justify-center gap-3 shadow-lg';
            banner.innerHTML = `
                <span><i class="fa-solid fa-triangle-exclamation mr-1.5"></i> Sesi login di browser ini sudah berubah (kemungkinan login akun lain di tab lain). Skor barusan belum tersimpan ke server. Muat ulang halaman untuk melanjutkan dengan akun yang benar.</span>
                <button onclick="location.reload()" class="bg-white text-rose-600 px-3 py-1 rounded-lg text-xs font-bold flex-shrink-0">Muat Ulang</button>
            `;
            document.body.appendChild(banner);
        }

        // Tarik data quiz milik akun yang sedang login dari server (dipanggil
        // sekali saat dashboard dibuka) supaya progress akun ini tetap nyambung
        // walau sebelumnya terakhir main di perangkat/browser lain.
        // Gabungkan data quiz LOKAL (localStorage) dengan data dari SERVER,
        // ambil yang lebih tinggi per level -- bukan timpa mentah-mentah.
        //
        // BUG YANG DIPERBAIKI: sebelum ini, sinkronkanQuizDenganServer()
        // langsung `localStorage.setItem(key, JSON.stringify(hasil.data))`
        // begitu server balas -- kalau kebetulan server BELUM sempat punya
        // skor terbaru (mis. request simpanQuizKeServer sebelumnya masih di
        // jalan / sempat gagal & belum retry), data lokal yang sudah BENAR
        // (baru saja selesai main quiz) ikut KETIMPA data server yang masih
        // lama. Ini yang bikin "abis quiz, poinnya ilang lagi begitu halaman
        // di-reload". Dengan merge (ambil skor tertinggi), data lokal yang
        // lebih baru tidak akan pernah kalah sama data server yang basi --
        // dan kalau hasil gabungan ternyata lebih tinggi dari punya server,
        // langsung dikirim ulang supaya server (dan siswa lain) ikut update.
        function gabungkanDataQuiz(dataLokal, dataServer, adaTotalPoin) {
            if (!dataServer) return dataLokal;
            if (!dataLokal) return dataServer;

            const hasil = { ...dataServer };

            if (adaTotalPoin) {
                hasil.totalPoin = Math.max(dataLokal.totalPoin || 0, dataServer.totalPoin || 0);
                hasil.totalPoinByLevel = {};
                ['easy', 'medium', 'hard'].forEach(level => {
                    hasil.totalPoinByLevel[level] = Math.max(
                        (dataLokal.totalPoinByLevel || {})[level] || 0,
                        (dataServer.totalPoinByLevel || {})[level] || 0
                    );
                });
            }

            hasil.bestByLevel = {};
            ['easy', 'medium', 'hard'].forEach(level => {
                hasil.bestByLevel[level] = Math.max(
                    (dataLokal.bestByLevel || {})[level] || 0,
                    (dataServer.bestByLevel || {})[level] || 0
                );
            });

            // Leaderboard: entri siswa LAIN ikut versi server (server = gabungan
            // semua siswa, lokal cuma tau dirinya sendiri). Entri milik SAYA
            // ambil yang skornya lebih tinggi antara lokal vs server.
            const gabunganLB = new Map();
            (dataServer.leaderboard || []).forEach(e => gabunganLB.set(`${e.nama}||${e.level}`, e));
            (dataLokal.leaderboard || []).forEach(e => {
                const kunci = `${e.nama}||${e.level}`;
                const existing = gabunganLB.get(kunci);
                if (!existing || e.skor > existing.skor) gabunganLB.set(kunci, e);
            });
            hasil.leaderboard = Array.from(gabunganLB.values());

            return hasil;
        }

        async function sinkronkanQuizDenganServer() {
            for (const jenis of ['pg', 'essay']) {
                try {
                    const res = await fetch(`/api/quiz/load?jenis=${jenis}&expected_username=${encodeURIComponent(USERNAME_SISWA_ASLI)}&slot_id=${encodeURIComponent(ID_SISWA_AKTIF)}`);
                    const hasil = await res.json();
                    if (hasil && hasil.session_mismatch) { tampilkanPeringatanSesiBerubah(); return; }
                    if (hasil && hasil.success) {
                        const key = jenis === 'essay' ? KEY_QUIZ_ESSAY_DATA : KEY_QUIZ_DATA;
                        let dataLokal = null;
                        try {
                            const raw = localStorage.getItem(key);
                            dataLokal = raw ? JSON.parse(raw) : null;
                        } catch (e) { /* data lokal korup -> anggap tidak ada, pakai punya server */ }

                        const gabungan = gabungkanDataQuiz(dataLokal, hasil.data, jenis === 'pg');
                        if (gabungan) {
                            localStorage.setItem(key, JSON.stringify(gabungan));
                            // Kalau hasil gabungan beda dari yang server tau (berarti
                            // lokal tadinya lebih unggul), kirim ulang biar server &
                            // siswa lain ikut ke-update -- nutup celah save yang
                            // sempat gagal/ke-drop sebelumnya.
                            if (JSON.stringify(gabungan) !== JSON.stringify(hasil.data)) {
                                simpanQuizKeServer(jenis, gabungan);
                            }
                        }
                    }
                } catch (e) { /* offline -> lanjut pakai data lokal yang ada */ }
            }

            // Refresh tampilan yang bergantung pada data quiz, setelah data
            // server (kalau ada) sudah dituang ke localStorage di atas.
            if (typeof renderMenuQuiz === 'function') renderMenuQuiz();
            if (typeof updateBerandaPoinQuiz === 'function') updateBerandaPoinQuiz();
            if (typeof renderLeaderboardQuiz === 'function') renderLeaderboardQuiz();
            if (typeof renderLeaderboardQuizEssay === 'function') renderLeaderboardQuizEssay();
        }

        // Ambil leaderboard GABUNGAN semua akun siswa dari server untuk satu
        // level tertentu. Kalau server tidak bisa dihubungi, balik ke entri
        // lokal (data.leaderboard) milik akun ini saja sebagai fallback.
        //
        // BUG YANG DIPERBAIKI: request ini dulu cuma dicoba SEKALI -- kalau
        // gagal (mis. server dev sempat auto-restart di tengah jalan gara-gara
        // debug=True, lihat catatan panjang soal ini di app.py & tempat lain
        // di file ini), langsung nyerah dan fallback ke leaderboard LOKAL
        // (cuma berisi entri milik akun sendiri). Ini yang bikin satu siswa
        // (mis. yang browsernya kena hiccup pas request ini) leaderboard-nya
        // kelihatan cuma nampilin dirinya sendiri, padahal siswa lain (yang
        // requestnya kebetulan mulus) leaderboard-nya normal berisi semua
        // orang -- backend-nya sendiri sudah benar & sudah dicoba langsung,
        // datanya memang sudah tergabung di server. Sekarang dicoba 2x (jeda
        // singkat di antaranya) sebelum benar-benar pasrah ke fallback lokal.
        async function ambilLeaderboardGabungan(jenis, level, dataLokal) {
            let daftar = [];
            let dariServer = false;
            for (let percobaan = 0; percobaan < 2 && !dariServer; percobaan++) {
                try {
                    if (percobaan > 0) await new Promise(r => setTimeout(r, 500));
                    const res = await fetch(`/api/quiz/leaderboard-global?jenis=${jenis}`);
                    if (!res.ok) throw new Error(`status ${res.status}`);
                    const hasil = await res.json();
                    if (hasil && hasil.success) {
                        daftar = hasil.leaderboard.filter(e => e.level === level);
                        dariServer = true;
                    }
                } catch (e) { /* coba lagi (kalau masih ada kesempatan), atau fallback di bawah */ }
            }

            if (!dariServer) {
                daftar = (dataLokal.leaderboard || []).filter(e => e.level === level);
            }

            // PENTING: entri milik akun yang SEDANG login harus selalu ikut
            // tampil pakai skor TERTINGGI yang sudah tercatat di localStorage
            // (dataLokal.leaderboard, sudah disinkronkan dengan bestByLevel
            // lewat sinkronkanLeaderboardDenganPoinTerbaik) -- bukan cuma
            // pasrah nunggu server. Ini yang bikin begitu siswa selesai quiz
            // & dapat skor tertinggi baru, langsung nongol di leaderboard
            // walau respons server belum/telat menyertakan entri terbaru itu
            // (server lagi lambat, race condition saat menyimpan, dsb).
            // Tanpa ini, "Skor terbaik" di kartu level bisa sudah kepakai
            // tapi tab Leaderboard-nya tetap kosong.
            const entriLokalSaya = (dataLokal.leaderboard || []).find(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === level);
            if (entriLokalSaya) {
                const idxServer = daftar.findIndex(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === level);
                if (idxServer === -1) {
                    daftar.push(entriLokalSaya);
                } else if (entriLokalSaya.skor > daftar[idxServer].skor) {
                    daftar[idxServer] = entriLokalSaya;
                }
            }

            return daftar;
        }

        // ============================================================
        // FOTO/BORDER LIVE UNTUK ENTRI SISWA LAIN DI LEADERBOARD QUIZ
        // ------------------------------------------------------------
        // BUG YANG DIPERBAIKI: sebelum ini, entri leaderboard milik siswa
        // LAIN (bukan diri sendiri) selalu pakai `entri.foto`/`entri.border`
        // -- snapshot yang dibekukan sejak terakhir kali siswa itu
        // menyimpan skor quiz ke server. Kalau siswa itu ganti foto profil
        // TAPI tidak pernah main quiz lagi setelahnya (atau mekanisme
        // sebarkanFotoTerbaruKeSnapshotLeaderboard() di device dia gagal/
        // belum sempat jalan), leaderboard tetap nampilin foto lama --
        // padahal fitur "Cari Teman" (lewat /api/teman/cari) sudah lebih
        // dulu benar: dia selalu tanya ke server "foto APA yang SEDANG
        // dipakai akun ini SEKARANG", bukan snapshot yang ikut nebeng di
        // data quiz. Di sinilah leaderboard Quiz (PG & Essay) disamakan
        // logikanya dengan Cari Teman: untuk tiap entri siswa lain, tanya
        // /api/teman/cari (endpoint yang sama dipakai Cari Teman) memakai
        // nama siswa itu, ambil foto+border yang beneran aktif sekarang,
        // dan itu yang dipakai buat render -- bukan snapshot beku. Kalau
        // request gagal (offline, dsb) atau nama tidak ketemu, baru fallback
        // ke snapshot lama (entri.foto/entri.border) supaya leaderboard
        // tidak blank/error.
        //
        // Dicache singkat (30 detik) per nama supaya render ulang yang
        // beruntun (mis. ganti filter Easy -> Medium -> Hard cepat-cepat,
        // atau leaderboard PG lalu Essay) tidak nembak /api/teman/cari
        // berkali-kali untuk nama yang sama dalam waktu singkat.
        // ============================================================
        const CACHE_PROFIL_LIVE_LEADERBOARD = new Map(); // nama -> { data, waktu }
        const TTL_CACHE_PROFIL_LIVE_LEADERBOARD = 30000;

        async function ambilProfilLiveUntukNamaLeaderboard(nama) {
            const cache = CACHE_PROFIL_LIVE_LEADERBOARD.get(nama);
            if (cache && (Date.now() - cache.waktu) < TTL_CACHE_PROFIL_LIVE_LEADERBOARD) {
                return cache.data;
            }
            let hasilCocok = null;
            try {
                const res = await fetch(`/api/teman/cari?q=${encodeURIComponent(nama)}`);
                const json = await res.json();
                if (json && json.success) {
                    // Cocokkan NAMA PERSIS -- /api/teman/cari bisa mengembalikan
                    // beberapa hasil untuk query parsial, jadi jangan asal ambil
                    // hasil pertama supaya tidak salah tempel foto siswa lain
                    // yang kebetulan namanya mirip/mengandung kata yang sama.
                    hasilCocok = (json.hasil || []).find(it => it.nama === nama) || null;
                }
            } catch (e) {
                // Biarkan null -- pemanggil akan fallback ke snapshot lama.
            }
            CACHE_PROFIL_LIVE_LEADERBOARD.set(nama, { data: hasilCocok, waktu: Date.now() });
            return hasilCocok;
        }

        async function ambilPetaProfilLiveLeaderboard(daftarNama) {
            const namaUnik = [...new Set(daftarNama)];
            const peta = new Map();
            await Promise.all(namaUnik.map(async (nama) => {
                const profil = await ambilProfilLiveUntukNamaLeaderboard(nama);
                if (profil) peta.set(nama, profil);
            }));
            return peta;
        }

        function getRankInfoQuiz(totalPoin) {
            if (totalPoin >= 500) return { label: '👑 Legenda Sekolah', warna: 'text-amber-200' };
            if (totalPoin >= 250) return { label: '🧠 Master Quiz', warna: 'text-white' };
            if (totalPoin >= 100) return { label: '📘 Pelajar Rajin', warna: 'text-white' };
            return { label: '🔰 Pemula', warna: 'text-white' };
        }

        function acakSoalQuiz(mapelId, level, jumlah) {
            const bankMapel = (QUIZ_BANK_PG_BY_MAPEL[mapelId] && QUIZ_BANK_PG_BY_MAPEL[mapelId][level]) || [];
            const bank = [...bankMapel];
            for (let i = bank.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [bank[i], bank[j]] = [bank[j], bank[i]];
            }
            return bank.slice(0, Math.min(jumlah, bank.length));
        }

        const SEMUA_VIEW_QUIZ = ['jenis', 'kategori-mapel', 'pilih-mapel', 'tingkat-pg', 'tingkat-essay', 'play', 'result'];
        function tampilkanViewQuiz(view) {
            SEMUA_VIEW_QUIZ.forEach(v => {
                const el = document.getElementById(`quiz-view-${v}`);
                if (el) el.classList.add('hidden');
            });
            document.getElementById(`quiz-view-${view}`).classList.remove('hidden');

            // Dorong ke history navigasi HP/browser -- KECUALI tahap 'play' (lagi
            // mengerjakan quiz) & 'result' (halaman hasil), lihat catatan cakupan
            // di atas fungsi switchTab.
            if (view !== 'play' && view !== 'result') {
                dorongHistoryTampilan({
                    type: 'quizView',
                    view,
                    kategori: quizMapelState.kategori,
                    jenis: quizJenisDipilih
                });
            }
        }

        // Kartu "Pilihan Ganda" / "Essay" di menu awal Quiz -> lanjut ke pemilihan
        // KATEGORI MAPEL (Produktif / Umum) dulu, baru nanti pilih mapel spesifik,
        // baru pilih tingkat kesulitan.
        function pilihJenisQuiz(jenis) {
            quizJenisDipilih = jenis;
            const label = document.getElementById('quiz-kategori-jenis-badge');
            if (label) label.innerText = jenis === 'essay' ? 'Essay' : 'Pilihan Ganda';
            tampilkanViewQuiz('kategori-mapel');
        }

        // Tombol "Kembali pilih jenis quiz" paling awal (dari halaman kategori mapel).
        function kembaliKeJenisQuiz() {
            tampilkanViewQuiz('jenis');
            renderMenuQuiz();
        }

        // Kartu "Mapel Produktif" / "Mapel Umum" -> tampilkan daftar mapel yang
        // termasuk kategori itu.
        function pilihKategoriMapelQuiz(kategori) {
            quizMapelState.kategori = kategori;
            renderDaftarPilihMapelQuiz(kategori);
            tampilkanViewQuiz('pilih-mapel');
        }

        // Tombol "Kembali pilih kategori mapel" di halaman daftar mapel.
        function kembaliKeKategoriMapelQuiz() {
            tampilkanViewQuiz('kategori-mapel');
        }

        // Tombol "Kembali pilih mapel" di halaman tingkat kesulitan.
        function kembaliKePilihMapelQuiz() {
            renderDaftarPilihMapelQuiz(quizMapelState.kategori);
            tampilkanViewQuiz('pilih-mapel');
        }

        function renderDaftarPilihMapelQuiz(kategori) {
            const daftarMapel = MAPEL_QUIZ[kategori] || [];
            const judul = document.getElementById('pilih-mapel-judul');
            const sub = document.getElementById('pilih-mapel-subjudul');
            if (judul) judul.innerText = kategori === 'produktif' ? 'Pilih Mapel Produktif' : 'Pilih Mapel';
            if (sub) sub.innerText = kategori === 'produktif'
                ? 'Mapel produktif untuk kelas XII TKJ 3/TAV.'
                : 'Mapel umum seperti biasa di SMK.';

            // Tombol "Pilih Tingkat Kesulitan" & warna hover border sengaja SATU
            // warna senada per kategori (bukan ikut-ikutan warna tiap mapel),
            // supaya tetap adem & serasi dengan warna navy tema "Rahasia" --
            // warna khas tiap mapel (m.warna) cukup tampil lembut di ikonnya saja.
            const aksenKategori = kategori === 'produktif' ? 'sky' : 'blue';

            const container = document.getElementById('pilih-mapel-list');
            if (!container) return;
            container.innerHTML = '';
            daftarMapel.forEach(m => {
                const warnaIkon = m.warna || aksenKategori;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `text-left bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-${aksenKategori}-200 transition-shadow p-2.5 sm:p-5 flex flex-col relative overflow-hidden`;

                const isiKartuMapel = `
                    <div class="w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-${warnaIkon}-50 text-${warnaIkon}-600 flex items-center justify-center text-xs sm:text-lg mb-2 sm:mb-3 overflow-hidden">${m.gambar ? `<img loading="lazy" decoding="async" src="${m.gambar}" alt="${m.nama}" class="w-5 h-5 sm:w-6 sm:h-6 object-contain">` : `<i class="fa-solid ${m.icon || 'fa-book'}"></i>`}</div>
                    <h3 class="font-bold text-xs sm:text-sm text-slate-900 leading-tight">${m.kode ? `${m.kode} · ` : ''}${m.nama}</h3>
                    <p class="text-[10px] sm:text-xs text-slate-400 mt-1 mb-2 sm:mb-3 flex-1 leading-snug">${m.deskripsi || ''}</p>
                    <span class="w-full py-1.5 sm:py-2 bg-${aksenKategori}-600 text-white rounded-lg text-[9px] sm:text-[11px] font-bold shadow-sm transition-all flex items-center justify-center gap-1 sm:gap-2 text-center">
                        Pilih Tingkat Kesulitan <i class="fa-solid fa-arrow-right text-[8px] sm:text-[9px]"></i>
                    </span>`;

                if (m.id === 'bindo') {
                    // Kartu "Bahasa Indonesia" khusus: dibungkus supaya kontennya bisa
                    // diredupkan + ditumpuk overlay animasi bendera Merah Putih berkibar
                    // saat di-long-press. Interaksi ini sengaja HANYA aktif di layar
                    // sentuh (HP/iPad) lewat aktifkanLongPressBenderaBindo() di bawah.
                    //
                    // Animasi "kain berkibar"-nya BUKAN bikin baru -- ini REUSE
                    // apa adanya dari container .kain-bendera-rahasia +
                    // .lipatan-cahaya-bendera yang sudah dipakai di overlay reveal
                    // logo jurusan (lihat #overlay-logo-rahasia), cuma isi latarnya
                    // diganti gradient merah-putih (.bindo-flag-latar) -- animasi
                    // goyangan 3D (rotateY/rotateZ/skewX) & sapuan cahayanya sama
                    // persis, sudah terbukti ringan di HP (murni CSS transform,
                    // bukan filter SVG feTurbulence yang berat).
                    btn.innerHTML = `
                        <div class="kartu-bindo-konten flex flex-col flex-1" style="transition:opacity .35s ease;">${isiKartuMapel}</div>
                        <div class="kartu-bindo-flag-overlay absolute inset-0 overflow-hidden flex flex-col items-center justify-center gap-1.5 sm:gap-2" style="opacity:0; transform:scale(0.94); pointer-events:none; transition:opacity .35s ease, transform .35s ease;">
                            <div class="kain-bendera-rahasia" aria-hidden="true">
                                <div class="bindo-flag-latar absolute inset-0"></div>
                                <div class="lipatan-cahaya-bendera absolute inset-0"></div>
                            </div>
                            <span class="relative text-[9px] sm:text-[11px] font-bold text-white drop-shadow-md">Bahasa Indonesia</span>
                        </div>`;
                    btn.onclick = () => {
                        if (btn.dataset.longPressTriggered === '1') { btn.dataset.longPressTriggered = ''; return; }
                        pilihMapelQuiz(m.id);
                    };
                    aktifkanLongPressBenderaBindo(btn);
                } else {
                    btn.innerHTML = isiKartuMapel;
                    btn.onclick = () => pilihMapelQuiz(m.id);
                }

                container.appendChild(btn);
            });
        }

        // Long-press (>300ms) KHUSUS kartu mapel "Bahasa Indonesia" & KHUSUS layar
        // sentuh (HP/iPad, dideteksi via matchMedia 'pointer: coarse' supaya tidak
        // mengganggu interaksi mouse di desktop). Saat ditekan-tahan: konten kartu
        // meredup sedikit lalu bertransisi halus (morphing) memunculkan animasi
        // bendera Merah Putih berkibar (reuse .kain-bendera-rahasia + goyangan 3D
        // CSS transform yang sama dengan overlay reveal logo jurusan, bukan filter
        // SVG feTurbulence yang berat). Saat jari dilepas: bendera fade out cepat,
        // kartu balik ke idle & siap ditap normal untuk lanjut ke pemilihan tingkat
        // kesulitan.
        function aktifkanLongPressBenderaBindo(btn) {
            if (!window.matchMedia('(pointer: coarse)').matches) return;

            const konten = btn.querySelector('.kartu-bindo-konten');
            const overlay = btn.querySelector('.kartu-bindo-flag-overlay');
            if (!konten || !overlay) return;

            let timerLongPress = null;
            let longPressAktif = false;

            const mulaiTekan = () => {
                longPressAktif = false;
                btn.dataset.longPressTriggered = '';
                clearTimeout(timerLongPress);
                timerLongPress = setTimeout(() => {
                    longPressAktif = true;
                    btn.dataset.longPressTriggered = '1';
                    overlay.style.transitionDuration = '.35s, .35s';
                    konten.style.transitionDuration = '.35s';
                    konten.style.opacity = '0.15';
                    overlay.style.opacity = '1';
                    overlay.style.transform = 'scale(1)';
                }, 300);
            };

            const lepasTekan = () => {
                clearTimeout(timerLongPress);
                if (longPressAktif) {
                    overlay.style.transitionDuration = '.15s, .15s';
                    konten.style.transitionDuration = '.15s';
                    overlay.style.opacity = '0';
                    overlay.style.transform = 'scale(0.94)';
                    konten.style.opacity = '1';
                }
                longPressAktif = false;
            };

            btn.addEventListener('touchstart', mulaiTekan, { passive: true });
            btn.addEventListener('touchend', lepasTekan);
            btn.addEventListener('touchcancel', lepasTekan);
            btn.addEventListener('contextmenu', (e) => { if (longPressAktif || timerLongPress) e.preventDefault(); });
        }

        // Kartu mapel dipilih -> lanjut ke halaman tingkat kesulitan sesuai jenis
        // quiz yang sudah dipilih sebelumnya (PG atau Essay). Tingkat kesulitan
        // (easy/medium/hard) tetap tersedia di sini seperti sebelumnya.
        function pilihMapelQuiz(mapelId) {
            const mapel = getMapelByIdQuiz(mapelId);
            if (!mapel) return;
            quizMapelState.mapelId = mapelId;
            quizMapelState.mapelNama = mapel.kode ? `${mapel.kode} · ${mapel.nama}` : mapel.nama;

            if (quizJenisDipilih === 'essay') {
                document.querySelectorAll('.quiz-mapel-badge-essay').forEach(el => el.innerText = quizMapelState.mapelNama);
                tampilkanViewQuiz('tingkat-essay');
                renderTingkatEssay();
                renderLeaderboardQuizEssay();
            } else {
                document.querySelectorAll('.quiz-mapel-badge-pg').forEach(el => el.innerText = quizMapelState.mapelNama);
                tampilkanViewQuiz('tingkat-pg');
                renderMenuQuiz();
                renderLeaderboardQuiz();
            }
        }

        function renderTingkatEssay() {
            const data = getQuizEssayData();
            const best = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
            document.getElementById('quiz-best-essay-easy').innerText = String(best.easy || 0);
            document.getElementById('quiz-best-essay-medium').innerText = String(best.medium || 0);
            document.getElementById('quiz-best-essay-hard').innerText = String(best.hard || 0);

            // Sama seperti renderMenuQuiz() versi Pilihan Ganda: badge "X Soal" pakai
            // jumlah soal ASLI di bank Essay mapel ini, bukan angka tetap.
            const bankMapelEssay = QUIZ_BANK_ESSAY_BY_MAPEL[quizMapelState.mapelId] || {};
            ['easy', 'medium', 'hard'].forEach(level => {
                const el = document.getElementById(`quiz-jumlah-soal-essay-${level}`);
                if (el) el.innerText = `${Math.min(5, (bankMapelEssay[level] || []).length)} Soal`;
            });
        }

        function startQuiz(jenis, level) {
            // Pastikan tidak ada sisa snapshot safety-net dari quiz lama yang
            // nyangkut (mestinya sudah ditangani lewat bukaQuizDariAwal() di
            // atas, ini cuma jaga-jaga tambahan supaya quiz baru selalu mulai
            // dari snapshot yang bersih).
            hapusProgressQuizSementara();
            const mapelId = quizMapelState.mapelId;
            const soal = jenis === 'essay' ? acakSoalQuizEssay(mapelId, level, 5) : acakSoalQuiz(mapelId, level, 5);
            const cfg = jenis === 'essay' ? QUIZ_CONFIG_ESSAY[level] : QUIZ_CONFIG[level];
            quizState = { jenis, level, mapelId, mapelNama: quizMapelState.mapelNama, soal, index: 0, skor: 0, benar: 0, waktuSisa: cfg.waktu, timerId: null, waktuMulaiSoal: null, beruntunJawabCepat: 0 };
            tampilkanViewQuiz('play');
            document.getElementById('quiz-play-total').innerText = String(soal.length);

            const badge = document.getElementById('quiz-play-level-badge');
            badge.className = `px-3 py-1 rounded-lg text-xs font-bold ${cfg.warnaBadge}`;
            badge.innerText = jenis === 'essay' ? `${cfg.label} · Essay` : cfg.label;
            const mapelBadge = document.getElementById('quiz-play-mapel-badge');
            if (mapelBadge) mapelBadge.innerText = quizMapelState.mapelNama || '';

            renderSoalQuiz();
        }

        function renderSoalQuiz() {
            const { jenis, level, soal, index } = quizState;
            const cfg = getConfigQuizAktif();
            const item = soal[index];

            document.getElementById('quiz-play-nomor').innerText = String(index + 1);
            document.getElementById('quiz-play-skor').innerText = String(quizState.skor);
            document.getElementById('quiz-progress-bar').style.width = `${((index) / soal.length) * 100}%`;
            document.getElementById('quiz-question-text').innerText = item.q;

            const containerOpsi = document.getElementById('quiz-options-container');
            const containerEssay = document.getElementById('quiz-essay-container');

            if (jenis === 'essay') {
                containerOpsi.classList.add('hidden');
                containerOpsi.innerHTML = '';
                containerEssay.classList.remove('hidden');

                const input = document.getElementById('quiz-essay-jawaban');
                input.value = '';
                input.disabled = false;
                input.focus();
                const tombolSubmit = document.getElementById('quiz-essay-submit-btn');
                if (tombolSubmit) tombolSubmit.disabled = false;
                const feedback = document.getElementById('quiz-essay-feedback');
                if (feedback) { feedback.classList.add('hidden'); feedback.innerHTML = ''; }
            } else {
                containerEssay.classList.add('hidden');
                containerOpsi.classList.remove('hidden');
                containerOpsi.innerHTML = '';
                item.opsi.forEach((teks, i) => {
                    const btn = document.createElement('button');
                    btn.className = 'quiz-opsi-btn text-left flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-0 px-2.5 py-2.5 sm:px-4 sm:py-3 rounded-lg sm:rounded-xl border-2 border-slate-200 bg-white hover:border-purple-400 hover:bg-purple-50 text-[11px] sm:text-sm font-semibold text-slate-700 transition-all leading-snug';
                    btn.innerHTML = `<span class="inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg bg-slate-100 text-slate-500 text-[10px] sm:text-xs font-bold sm:mr-2 align-middle flex-shrink-0">${String.fromCharCode(65 + i)}</span><span>${teks}</span>`;
                    btn.onclick = () => pilihJawabanQuiz(i);
                    containerOpsi.appendChild(btn);
                });
            }

            quizState.waktuSisa = cfg.waktu;
            // Dicatat SETIAP soal baru ditampilkan -- dipakai deteksiKlikCepatQuiz()
            // di bawah untuk menghitung berapa detik siswa benar-benar butuh
            // sebelum menjawab (bukan cuma dari sisa timer yang resolusinya per-detik).
            quizState.waktuMulaiSoal = Date.now();
            updateTimerBarQuiz();
            clearInterval(quizState.timerId);
            quizState.timerId = setInterval(() => {
                quizState.waktuSisa -= 1;
                updateTimerBarQuiz();
                if (quizState.waktuSisa <= 0) {
                    clearInterval(quizState.timerId);
                    if (quizState.jenis === 'essay') {
                        jawabEssayQuiz(true); // waktu habis, dianggap tidak menjawab
                    } else {
                        pilihJawabanQuiz(-1); // waktu habis, dianggap tidak menjawab
                    }
                }
            }, 1000);
        }

        function updateTimerBarQuiz() {
            const cfg = getConfigQuizAktif();
            const persen = Math.max(0, (quizState.waktuSisa / cfg.waktu) * 100);
            const bar = document.getElementById('quiz-timer-bar');
            bar.style.width = `${persen}%`;
            bar.className = `h-full transition-all duration-1000 ease-linear ${persen <= 30 ? 'bg-rose-500' : cfg.warnaBar}`;
            document.getElementById('quiz-timer-text').innerText = `${Math.max(0, quizState.waktuSisa)}s`;
        }

        /* ==========================================================
           DETEKSI JAWAB KUIS KELEWAT CEPAT (asal klak-klik tanpa baca)
           ==========================================================
           Kalau siswa menjawab beruntun di bawah 1 detik per soal (baik
           Pilihan Ganda maupun Essay) sebanyak AMBANG_BERUNTUN_JAWAB_CEPAT
           kali berturut-turut, munculkan notif "pelan-pelan" di TENGAH
           layar quiz. Selama notif ini tampil, soal berikutnya SENGAJA
           belum dirender (artinya timer/waktu soal berikutnya otomatis
           ikut berhenti dulu) -- baru lanjut setelah siswa menutup notif
           lewat tombol yang dikunci beberapa detik (hitung mundur) supaya
           bener-bener kepake buat jeda baca, bukan langsung diklik lagi
           refleks.
        */
        const AMBANG_JAWAB_CEPAT_MS = 1000;      // "Angka Aman" = 1,0 detik/soal. Manusia secepat apapun
                                                  // refleksnya tetap butuh jeda proses visual >= 1 detik --
                                                  // di bawah itu & terjadi BERUNTUN = indikasi bot/auto-clicker,
                                                  // bukan cuma siswa ngebut biasa.
        const AMBANG_BERUNTUN_JAWAB_CEPAT = 3;   // baru dianggap pelanggaran setelah cepat 3x BERUNTUN tanpa jeda
        const DURASI_COUNTDOWN_NOTIF_CEPAT = 3;  // detik, sebelum tombol tutup notif aktif

        // Mengembalikan true kalau beruntun-cepatnya baru saja mencapai ambang
        // (dan sekaligus mereset hitungannya, biar notif nggak numpuk tiap soal).
        function catatKecepatanJawabQuiz() {
            if (!quizState || !quizState.waktuMulaiSoal) return false;
            const elapsedMs = Date.now() - quizState.waktuMulaiSoal;

            if (elapsedMs < AMBANG_JAWAB_CEPAT_MS) {
                quizState.beruntunJawabCepat = (quizState.beruntunJawabCepat || 0) + 1;
            } else {
                quizState.beruntunJawabCepat = 0;
            }

            if (quizState.beruntunJawabCepat >= AMBANG_BERUNTUN_JAWAB_CEPAT) {
                quizState.beruntunJawabCepat = 0;
                return true;
            }
            return false;
        }

        // Notif peringatan di tengah layar + hitung mundur sebelum bisa ditutup.
        // Animasi kemunculannya SENGAJA dibikin bertahap (staggered fade + slide up),
        // pola yang sama persis dengan reveal kartu di Daftar Guru (.guru-card-reveal):
        // elemen mulai dari kondisi "belum ada" (opacity 0 + sedikit turun ke bawah),
        // lalu satu-satu muncul smooth ke posisi normalnya -- bukan langsung "nyentak"
        // sekali tampil semua.
        // lanjutkanCallback() baru dipanggil SETELAH siswa menutup notif -- ini yang
        // bikin progres/soal berikutnya (dan timernya) ikut "berhenti" sampai notifnya
        // beneran ditutup.
        function tampilkanNotifJawabTerlaluCepat(lanjutkanCallback) {
            const overlayLama = document.getElementById('overlay-notif-jawab-cepat');
            if (overlayLama) overlayLama.remove();

            const overlay = document.createElement('div');
            overlay.id = 'overlay-notif-jawab-cepat';
            overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 opacity-0 transition-opacity duration-300 ease-out';
            overlay.innerHTML = `
                <div id="kotak-notif-jawab-cepat" class="bg-white rounded-2xl shadow-2xl max-w-xs w-full p-5 text-center transform transition-all duration-300 ease-out scale-95">
                    <div id="ikon-notif-jawab-cepat" class="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center text-2xl opacity-0 translate-y-2 transition-all duration-500 ease-out">
                        <i class="fa-solid fa-bolt"></i>
                    </div>
                    <p id="teks-notif-jawab-cepat" class="text-sm font-bold text-slate-800 leading-snug mb-4 opacity-0 translate-y-2 transition-all duration-500 ease-out">
                        Eh, jarinya cepet banget kayak kilat. Pelan-pelan aja bacanya, nanti salah loh!
                    </p>
                    <button id="btn-tutup-notif-jawab-cepat" type="button" disabled
                        class="w-full py-2.5 rounded-xl bg-slate-200 text-slate-400 font-bold text-xs cursor-not-allowed transition-all duration-300 opacity-0 translate-y-2">
                        Mengerti (<span id="hitung-mundur-notif-cepat">${DURASI_COUNTDOWN_NOTIF_CEPAT}</span>)
                    </button>
                </div>`;
            document.body.appendChild(overlay);

            const kotak = document.getElementById('kotak-notif-jawab-cepat');
            const ikon = document.getElementById('ikon-notif-jawab-cepat');
            const teks = document.getElementById('teks-notif-jawab-cepat');
            const tombolTutup = document.getElementById('btn-tutup-notif-jawab-cepat');

            // Tahap 1 (langsung): backdrop + kartu fade-in duluan, masih kosong dulu.
            requestAnimationFrame(() => {
                overlay.classList.remove('opacity-0');
                if (kotak) kotak.classList.remove('scale-95');
            });

            // Tahap 2 (bertahap/staggered): ikon -> teks -> tombol, masing-masing
            // muncul smooth dari transparan+sedikit turun ke posisi normalnya --
            // delay-nya dibuat mirip transition-delay per item di .guru-card-reveal.
            const JADWAL_REVEAL_ISI_NOTIF = [
                { el: ikon, delay: 150 },
                { el: teks, delay: 260 },
                { el: tombolTutup, delay: 370 }
            ];
            JADWAL_REVEAL_ISI_NOTIF.forEach(({ el, delay }) => {
                if (!el) return;
                setTimeout(() => el.classList.remove('opacity-0', 'translate-y-2'), delay);
            });

            const teksHitung = document.getElementById('hitung-mundur-notif-cepat');
            let sisaHitung = DURASI_COUNTDOWN_NOTIF_CEPAT;

            const timerHitungMundur = setInterval(() => {
                sisaHitung -= 1;
                if (sisaHitung <= 0) {
                    clearInterval(timerHitungMundur);
                    if (tombolTutup) {
                        tombolTutup.disabled = false;
                        tombolTutup.innerText = 'Oke, aku baca pelan-pelan';
                        tombolTutup.className = 'w-full py-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-sm transition-all';
                    }
                } else if (teksHitung) {
                    teksHitung.innerText = String(sisaHitung);
                }
            }, 1000);

            if (tombolTutup) {
                tombolTutup.onclick = () => {
                    if (tombolTutup.disabled) return;
                    clearInterval(timerHitungMundur);
                    overlay.remove();
                    if (typeof lanjutkanCallback === 'function') lanjutkanCallback();
                };
            }
        }

        function pilihJawabanQuiz(indexDipilih) {
            if (!quizState) return;
            clearInterval(quizState.timerId);

            const cfg = QUIZ_CONFIG[quizState.level];
            const item = quizState.soal[quizState.index];
            const tombolTombol = document.querySelectorAll('#quiz-options-container .quiz-opsi-btn');

            tombolTombol.forEach((btn, i) => {
                btn.onclick = null;
                const dasarKelas = 'quiz-opsi-btn text-left flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-0 px-2.5 py-2.5 sm:px-4 sm:py-3 rounded-lg sm:rounded-xl border-2 text-[11px] sm:text-sm font-semibold transition-all leading-snug';
                if (i === item.jawaban) {
                    btn.className = `${dasarKelas} border-emerald-500 bg-emerald-50 text-emerald-700`;
                } else if (i === indexDipilih) {
                    btn.className = `${dasarKelas} border-rose-500 bg-rose-50 text-rose-700`;
                } else {
                    btn.className = `${dasarKelas} border-slate-200 bg-white text-slate-400 opacity-60`;
                }
            });

            if (indexDipilih === item.jawaban) {
                const bonusKecepatan = Math.round((quizState.waktuSisa / cfg.waktu) * (cfg.poinDasar * 0.5));
                quizState.skor += cfg.poinDasar + bonusKecepatan;
                quizState.benar += 1;
            }
            document.getElementById('quiz-play-skor').innerText = String(quizState.skor);

            function lanjutSetelahJawabPG() {
                quizState.index += 1;
                // Simpan snapshot progres ke localStorage SEGERA setiap kali 1 soal
                // selesai dijawab -- safety net kalau tab/koneksi/browser tiba-tiba
                // bermasalah sebelum soal terakhir (lihat catatan lengkap di
                // simpanProgressQuizSementara()). Server tetap TIDAK dikirimi apa-apa
                // di sini -- pengiriman ke server tetap cuma 1x lewat selesaikanQuiz().
                simpanProgressQuizSementara();
                if (quizState.index < quizState.soal.length) {
                    renderSoalQuiz();
                } else {
                    document.getElementById('quiz-progress-bar').style.width = '100%';
                    selesaikanQuiz();
                }
            }

            // Cek dulu apakah ini sudah beruntun ke-3 (dst) kalinya siswa jawab
            // di bawah 1 detik -- kalau iya, notif "pelan-pelan" muncul dulu di
            // tengah layar (soal berikutnya & timernya ikut nunggu sampai notif
            // ditutup), baru lanjut. Kalau nggak, alurnya tetap seperti biasa.
            if (catatKecepatanJawabQuiz()) {
                setTimeout(() => {
                    tampilkanNotifJawabTerlaluCepat(lanjutSetelahJawabPG);
                }, 700); // jeda dikit biar warna benar/salah sempat kebaca dulu
            } else {
                setTimeout(lanjutSetelahJawabPG, 1200);
            }
        }

        // Proses jawaban isian Essay: dicocokkan otomatis ke kunci jawaban lewat
        // bersihkanTeksEssay()/cocokkanJawabanEssay(). waktuHabis=true dipanggil
        // dari timer saat siswa tidak sempat menjawab (dianggap salah).
        function jawabEssayQuiz(waktuHabis) {
            if (!quizState) return;
            clearInterval(quizState.timerId);

            const cfg = QUIZ_CONFIG_ESSAY[quizState.level];
            const item = quizState.soal[quizState.index];
            const input = document.getElementById('quiz-essay-jawaban');
            const jawabanSiswa = waktuHabis === true ? '' : (input.value || '');
            const benar = waktuHabis !== true && cocokkanJawabanEssay(jawabanSiswa, item.kunci);

            input.disabled = true;
            const tombolSubmit = document.getElementById('quiz-essay-submit-btn');
            if (tombolSubmit) tombolSubmit.disabled = true;

            const feedback = document.getElementById('quiz-essay-feedback');
            if (feedback) {
                feedback.classList.remove('hidden');
                feedback.innerHTML = benar
                    ? `<p class="text-emerald-600 font-semibold text-sm flex items-center gap-2"><i class="fa-solid fa-circle-check"></i> Benar! Kunci jawaban: ${item.kunci[0]}</p>`
                    : `<p class="text-rose-600 font-semibold text-sm flex items-center gap-2"><i class="fa-solid fa-circle-xmark"></i> Kurang tepat. Kunci jawaban: ${item.kunci[0]}</p>`;
            }

            if (benar) {
                const bonusKecepatan = Math.round((quizState.waktuSisa / cfg.waktu) * (cfg.poinDasar * 0.5));
                quizState.skor += cfg.poinDasar + bonusKecepatan;
                quizState.benar += 1;
            }
            document.getElementById('quiz-play-skor').innerText = String(quizState.skor);

            function lanjutSetelahJawabEssay() {
                quizState.index += 1;
                // Sama seperti versi Pilihan Ganda: safety net lokal instan tiap 1
                // soal Essay selesai dijawab, TANPA mengirim apa pun ke server di
                // sini (bulk ke server tetap cuma 1x lewat selesaikanQuizEssay()).
                simpanProgressQuizSementara();
                if (quizState.index < quizState.soal.length) {
                    renderSoalQuiz();
                } else {
                    document.getElementById('quiz-progress-bar').style.width = '100%';
                    selesaikanQuizEssay();
                }
            }

            // Sama seperti versi Pilihan Ganda -- kalau waktuHabis=true, elapsed-nya
            // otomatis nggak akan kehitung "cepat" (lihat catatKecepatanJawabQuiz()),
            // jadi notif ini murni buat siswa yang beneran asal klik submit tanpa baca.
            if (catatKecepatanJawabQuiz()) {
                setTimeout(() => {
                    tampilkanNotifJawabTerlaluCepat(lanjutSetelahJawabEssay);
                }, 700);
            } else {
                setTimeout(lanjutSetelahJawabEssay, 1400);
            }
        }

        // Versi ringkas dari selesaikanQuiz() khusus Essay: cuma menyimpan skor
        // terbaik per level secara lokal, TANPA menyentuh leaderboard atau
        // sistem border koleksi (yang memang didesain khusus utk Pilihan Ganda).
        function selesaikanQuizEssay() {
            const { level, skor, benar, soal } = quizState;
            const cfg = QUIZ_CONFIG_ESSAY[level];

            // LANGKAH 1 (WAJIB, PALING DULU) -- lihat komentar panjang di
            // selesaikanQuiz() versi Pilihan Ganda: angka hasil quiz harus
            // selalu ke-render duluan sebelum simpan progres/leaderboard,
            // supaya layar hasil tidak blank kalau ada error di langkah 2.
            const persen = soal.length ? benar / soal.length : 0;
            document.getElementById('quiz-result-icon').innerText = persen >= 0.8 ? '🏆' : (persen >= 0.5 ? '🥈' : '💪');
            document.getElementById('quiz-result-subtitle').innerText = persen >= 0.8 ? 'Luar biasa, kamu jagoan quiz!' : (persen >= 0.5 ? 'Bagus, terus tingkatkan lagi!' : 'Tetap semangat, coba lagi yuk!');
            document.getElementById('quiz-result-benar').innerText = `${benar}/${soal.length}`;
            document.getElementById('quiz-result-poin').innerText = String(skor);
            document.getElementById('quiz-result-level').innerText = `${cfg.label} · Essay`;
            tampilkanViewQuiz('result');
            hapusProgressQuizSementara(); // quiz sudah tuntas -- snapshot safety-net tidak perlu lagi

            // LANGKAH 2: simpan progres & leaderboard, dibungkus try/catch
            // supaya error di sini tidak bikin layar hasil (langkah 1) blank.
            try {
                const data = getQuizEssayData();

                data.bestByLevel = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
                if (skor > (data.bestByLevel[level] || 0)) data.bestByLevel[level] = skor;

                // Leaderboard Essay: sistemnya SAMA persis dengan leaderboard Pilihan
                // Ganda -- cuma menyimpan SATU entri per siswa per level (skor
                // terbaiknya), lengkap dengan snapshot foto/border/title/efek nama.
                const borderAktif = getBorderTerpakai();
                data.leaderboard = data.leaderboard || [];
                const entriLamaSaya = data.leaderboard.find(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === level);

                const entriBaru = {
                    id: entriLamaSaya ? entriLamaSaya.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    nama: NAMA_PEMAIN_QUIZ,
                    kelas: getKelasAktifQuiz(),
                    foto: getFotoProfilAktifQuiz(),
                    border: borderAktif.file,
                    borderTitle: borderAktif.rank,
                    efekNama: getEfekNamaClass(borderAktif),
                    badgeDev: getBadgeDevHtml(borderAktif),
                    level,
                    skor,
                    benar,
                    total: soal.length,
                    tanggal: new Date().toISOString()
                };

                if (!entriLamaSaya) {
                    data.leaderboard.push(entriBaru);
                } else if (skor > entriLamaSaya.skor) {
                    Object.assign(entriLamaSaya, entriBaru);
                }

                saveQuizEssayData(data);
                tandaiIdSudahDilihatQuizEssay(entriBaru.id); // entri sendiri, jangan ikut memicu notif "ditikung"
                renderLeaderboardQuizEssay();
            } catch (err) {
                console.error('selesaikanQuizEssay: gagal simpan progres/leaderboard (hasil quiz di layar tetap aman):', err);
            }
        }

        function selesaikanQuiz() {
            const { level, skor, benar, soal } = quizState;
            const cfg = QUIZ_CONFIG[level];

            // ============================================================
            // LANGKAH 1 (WAJIB, PALING DULU, TIDAK BOLEH GAGAL):
            // Tampilkan angka hasil quiz (skor, benar/salah, jumlah soal)
            // duluan, SEBELUM hal-hal lain yang lebih rawan error (simpan ke
            // localStorage/server, hitung leaderboard, border, notifikasi).
            // Dulu urutannya kebalik -- kalau salah satu langkah "tambahan" di
            // bawah situ error/exception, seluruh fungsi berhenti di tengah
            // jalan SEBELUM sempat isi angka hasil, sehingga layar hasil quiz
            // muncul kosong/blank (skor, jumlah benar-salah, jumlah soal tidak
            // pernah ke-render). Dengan urutan baru ini, siswa SELALU lihat
            // hasil quiz-nya walau ada masalah di bagian lain.
            // ============================================================
            const persen = soal.length ? benar / soal.length : 0;
            document.getElementById('quiz-result-icon').innerText = persen >= 0.8 ? '🏆' : (persen >= 0.5 ? '🥈' : '💪');
            document.getElementById('quiz-result-subtitle').innerText = persen >= 0.8 ? 'Luar biasa, kamu jagoan quiz!' : (persen >= 0.5 ? 'Bagus, terus tingkatkan lagi!' : 'Tetap semangat, coba lagi yuk!');
            document.getElementById('quiz-result-benar').innerText = `${benar}/${soal.length}`;
            document.getElementById('quiz-result-poin').innerText = String(skor);
            document.getElementById('quiz-result-level').innerText = cfg.label;
            tampilkanViewQuiz('result');
            hapusProgressQuizSementara(); // quiz sudah tuntas -- snapshot safety-net tidak perlu lagi

            // ============================================================
            // LANGKAH 2: simpan progres, update leaderboard, border, & notif.
            // Dibungkus try/catch supaya kalau ADA yang error di sini, siswa
            // tetap sudah lihat hasil quiznya (langkah 1 di atas sudah aman),
            // errornya cuma dicatat ke console buat ditelusuri developer --
            // TIDAK bikin layar hasil jadi blank lagi.
            // ============================================================
            try {
                const data = getQuizData();

                data.totalPoin = (data.totalPoin || 0) + skor;
                data.bestByLevel = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
                if (skor > (data.bestByLevel[level] || 0)) data.bestByLevel[level] = skor;

                // Akumulasi total poin PER LEVEL (beda dari bestByLevel yang cuma nyimpen
                // skor tertinggi 1x main) -- ini yang dipakai buat syarat buka Border Quiz,
                // supaya makin sering & makin bagus main di level itu, poinnya kepakai/
                // kesinkron ke arah buka border, bukan cuma "mentok" di skor 1x main
                // (yang max-nya per level memang jauh di bawah 250/500).
                // Poin SEBELUM ditambah skor sesi ini disimpan dulu, supaya sesudahnya
                // kita bisa tahu border level ini mana saja yang BARU SAJA jadi cukup
                // poinnya (buat notif "Selamat! border X siap diklaim").
                data.totalPoinByLevel = data.totalPoinByLevel || { easy: 0, medium: 0, hard: 0 };
                const poinLevelSebelum = data.totalPoinByLevel[level] || 0;
                data.totalPoinByLevel[level] = poinLevelSebelum + skor;
                const poinLevelSesudah = data.totalPoinByLevel[level];

                // Border level ini yang tadinya BELUM cukup poin, dan sekarang (setelah
                // skor sesi ini ditambahkan) JADI cukup poin -- ini yang baru "kebuka"
                // syaratnya & siap diklaim siswa. Border minPoin 0 dilewati karena
                // memang selalu otomatis terbuka (bukan pencapaian yang perlu diklaim).
                const borderBaruBisaDiklaim = DAFTAR_BORDER_QUIZ.filter(b =>
                    b.level === level && b.minPoin > 0 &&
                    poinLevelSebelum < b.minPoin && poinLevelSesudah >= b.minPoin
                );

                // Simpan dulu skor terbaru SEBELUM ambil border, supaya kalau skor ini
                // baru saja membuka border/title tier berikutnya, entri leaderboard
                // langsung sinkron pakai border+title yang paling baru itu juga.
                saveQuizData(data);
                const borderAktif = getBorderTerpakai();

                data.leaderboard = data.leaderboard || [];

                // Leaderboard cuma menyimpan SATU entri per siswa per level, yaitu
                // skor terbaiknya. Kalau siswa main ulang & skornya lebih rendah
                // dari skor terbaik yang sudah tersimpan, skor itu TIDAK ditambah
                // sebagai baris baru maupun menimpa entri lama -- entri lama
                // (skor tertinggi) tetap bertahan di leaderboard.
                const entriLamaSaya = data.leaderboard.find(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === level);

                const entriBaru = {
                    id: entriLamaSaya ? entriLamaSaya.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    nama: NAMA_PEMAIN_QUIZ,
                    kelas: getKelasAktifQuiz(),
                    foto: getFotoProfilAktifQuiz(),
                    border: borderAktif.file,
                    borderTitle: borderAktif.rank,
                    efekNama: getEfekNamaClass(borderAktif),
                    badgeDev: getBadgeDevHtml(borderAktif),
                    level,
                    skor,
                    benar,
                    total: soal.length,
                    tanggal: new Date().toISOString()
                };

                if (!entriLamaSaya) {
                    // Belum pernah main quiz level ini -> catat sebagai entri baru.
                    data.leaderboard.push(entriBaru);
                } else if (skor > entriLamaSaya.skor) {
                    // Skor baru mengalahkan skor terbaik sebelumnya -> entri lama
                    // diganti (bukan ditambah baris baru) supaya leaderboard tetap
                    // cuma menampilkan satu baris berisi skor terbaik siswa ini.
                    Object.assign(entriLamaSaya, entriBaru);
                }
                // Kalau skor <= skor terbaik sebelumnya: sengaja tidak melakukan
                // apa-apa, biar entri lama (poin tertinggi) yang bertahan.

                saveQuizData(data);
                tandaiIdSudahDilihatQuiz(entriBaru.id); // entri sendiri, jangan ikut memicu notif "ditikung"
                updateBerandaPoinQuiz();
                terapkanBorderKeAvatar();

                // Notif "Selamat" kalau ada border baru yang syarat poinnya baru saja
                // terpenuhi dari sesi quiz ini -- selalu tampil apa pun jumlah border
                // yang baru bisa diklaim (1 atau lebih, nama-namanya digabung jadi satu).
                if (borderBaruBisaDiklaim.length > 0) {
                    const daftarNama = borderBaruBisaDiklaim.map(b => b.nama).join(', ');
                    setTimeout(() => {
                        triggerDynamicIsland(`🎉 Selamat! Border ${daftarNama} siap diklaim!`);
                    }, 600);
                }
            } catch (err) {
                console.error('selesaikanQuiz: gagal simpan progres/leaderboard/border (hasil quiz di layar tetap aman):', err);
            }
        }

        function ulangiQuizTerakhir() {
            if (!quizState) return;
            // Pastikan mapel yang dipakai sama dengan sesi quiz terakhir (jaga-jaga
            // kalau quizMapelState sempat berubah di antara sesi).
            quizMapelState.mapelId = quizState.mapelId;
            quizMapelState.mapelNama = quizState.mapelNama;
            startQuiz(quizState.jenis, quizState.level);
        }

        // Dipanggil dari tombol "Kembali ke Menu" di layar hasil quiz -> balik
        // ke daftar tingkat kesulitan sesuai jenis quiz yang barusan dimainkan
        // (bukan ke halaman pilih jenis paling awal).
        function backToQuizMenu() {
            if (quizState) clearInterval(quizState.timerId);
            if (quizState && quizState.jenis === 'essay') {
                tampilkanViewQuiz('tingkat-essay');
                renderTingkatEssay();
                renderLeaderboardQuizEssay();
            } else {
                tampilkanViewQuiz('tingkat-pg');
                renderMenuQuiz();
                renderLeaderboardQuiz();
            }
        }

        // Dipanggil setiap kali tab Quiz dibuka dari sidebar -> selalu mulai
        // dari halaman pilih jenis (Pilihan Ganda / Essay).
        function bukaQuizDariAwal() {
            if (quizState) clearInterval(quizState.timerId);

            // FITUR BARU: sebelum reset ke menu awal, cek dulu apakah ada
            // progres quiz yang sempat "kepotong" tersimpan di localStorage
            // (lihat simpanProgressQuizSementara(), dipanggil tiap kali siswa
            // menjawab 1 soal) -- baik karena tab sempat dipindah, koneksi
            // ngadat, atau browser/tab tertutup di tengah jalan sebelum
            // sampai soal terakhir. Kalau ketemu, tawarkan lanjut dulu lewat
            // confirm() SEBELUM quiz lama ini betul-betul dianggap hilang.
            const snapshotTerputus = ambilProgressQuizSementara();
            if (snapshotTerputus) {
                const mauLanjut = confirm(
                    `Kamu punya quiz "${snapshotTerputus.mapelNama || 'sebelumnya'}" yang belum selesai ` +
                    `(soal ${snapshotTerputus.index + 1} dari ${snapshotTerputus.soal.length}). Lanjutkan dari situ?`
                );
                if (mauLanjut) {
                    lanjutkanQuizDariSnapshot(snapshotTerputus);
                    return; // JANGAN reset ke menu awal -- quiz lama sudah dilanjutkan
                }
                hapusProgressQuizSementara(); // ditolak -> anggap dibuang, quiz baru mulai bersih
            }

            tampilkanViewQuiz('jenis');
            renderMenuQuiz();
        }

        function renderMenuQuiz() {
            const data = getQuizData();
            document.getElementById('quiz-total-poin-display').innerText = String(data.totalPoin || 0);
            const rank = getRankInfoQuiz(data.totalPoin || 0);
            document.getElementById('quiz-rank-display').innerText = rank.label;

            const best = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
            document.getElementById('quiz-best-easy').innerText = String(best.easy || 0);
            document.getElementById('quiz-best-medium').innerText = String(best.medium || 0);
            document.getElementById('quiz-best-hard').innerText = String(best.hard || 0);

            // Badge "X Soal" per level -- diambil dari jumlah soal ASLI yang tersedia
            // di bank mapel ini (bukan angka tetap "5"), karena startQuiz() memakai
            // Math.min(5, bank.length) -- kalau bank cuma 4 soal, ya cuma 4 yang main.
            const bankMapelPg = QUIZ_BANK_PG_BY_MAPEL[quizMapelState.mapelId] || {};
            ['easy', 'medium', 'hard'].forEach(level => {
                const el = document.getElementById(`quiz-jumlah-soal-${level}`);
                if (el) el.innerText = `${Math.min(5, (bankMapelPg[level] || []).length)} Soal`;
            });
        }

        function updateBerandaPoinQuiz() {
            const data = getQuizData();
            const el = document.getElementById('beranda-total-poin-quiz');
            if (el) el.innerText = String(data.totalPoin || 0);
        }

        function setFilterLeaderboardQuiz(val) {
            quizFilterLeaderboardAktif = val;
            document.querySelectorAll('.quiz-filter-chip').forEach(btn => {
                if (btn.dataset.val === val) {
                    btn.className = 'quiz-filter-chip px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-purple-600 text-white border-purple-600';
                } else {
                    btn.className = 'quiz-filter-chip px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-white text-slate-600 border-slate-200 hover:bg-slate-100';
                }
            });

            const subtitle = document.getElementById('quiz-leaderboard-subtitle');
            if (subtitle) {
                subtitle.innerText = val === 'semua'
                    ? 'Poin kamu di masing-masing quiz. Pilih level untuk lihat peringkat semua siswa.'
                    : 'Peringkat semua siswa berdasarkan total poin yang terkumpul.';
            }

            renderLeaderboardQuiz();
        }

        // Badge medali "buatan" (bukan cuma emoji polos) khusus juara 1/2/3:
        // 1 = emas, 2 = silver/perak, 3 = bronze/perunggu. Peringkat 4 dst
        // TIDAK dikasih medali sama sekali, cuma nomor urut biasa (lihat
        // pemanggilannya di renderLeaderboardQuiz).
        const GAYA_MEDALI = {
            1: { gradasi: 'from-yellow-400 via-amber-300 to-yellow-500', cincin: 'ring-amber-200', teks: 'text-amber-900' },
            2: { gradasi: 'from-slate-300 via-slate-100 to-slate-400',   cincin: 'ring-slate-200', teks: 'text-slate-700' },
            3: { gradasi: 'from-orange-400 via-orange-300 to-amber-600', cincin: 'ring-orange-200', teks: 'text-orange-900' }
        };
        function buatBadgeMedali(peringkat) {
            const gaya = GAYA_MEDALI[peringkat];
            if (!gaya) {
                // Peringkat 4 dan seterusnya: nomor urut biasa, tanpa medali.
                return `<span class="w-6 h-6 text-center font-bold text-sm text-slate-500 flex-shrink-0 flex items-center justify-center">${peringkat}</span>`;
            }
            return `
                <span class="relative w-6 h-6 flex-shrink-0 rounded-full bg-gradient-to-br ${gaya.gradasi} ring-2 ${gaya.cincin} shadow-sm flex items-center justify-center">
                    <i class="fa-solid fa-medal text-[11px] ${gaya.teks}"></i>
                </span>`;
        }

        // Tab "Poin Saya" (quizFilterLeaderboardAktif === 'semua') TIDAK menampilkan
        // leaderboard gabungan semua siswa lagi — cuma poin milik siswa yang lagi
        // login, dirinci per quiz (easy/medium/hard). Leaderboard berisi SEMUA
        // siswa baru muncul begitu salah satu level kesulitan dipilih.
        function renderLeaderboardQuizMilikSaya(data) {
            const container = document.getElementById('quiz-leaderboard-list');
            const kosongState = document.getElementById('quiz-leaderboard-kosong');
            container.innerHTML = '';
            kosongState.classList.add('hidden');

            const best = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
            const semuaEntriSaya = (data.leaderboard || []).filter(e => e.nama === NAMA_PEMAIN_QUIZ);

            ['easy', 'medium', 'hard'].forEach(level => {
                const cfg = QUIZ_CONFIG[level];
                const skorTerbaik = best[level] || 0;
                const entriTerakhir = semuaEntriSaya
                    .filter(e => e.level === level)
                    .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal))[0];

                const baris = document.createElement('div');
                baris.className = 'flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50';
                baris.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0 ${cfg.warnaBadge}">${cfg.label}</span>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-800 truncate">Poin terbaik kamu</p>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">${entriTerakhir ? `${entriTerakhir.benar}/${entriTerakhir.total} benar &middot; terakhir main ${new Date(entriTerakhir.tanggal).toLocaleDateString('id-ID')}` : 'Belum pernah main quiz ini'}</p>
                        </div>
                    </div>
                    <span class="text-sm font-extrabold text-slate-900 flex-shrink-0">${skorTerbaik}</span>
                `;
                container.appendChild(baris);
            });
        }

        async function renderLeaderboardQuiz() {
            const data = getQuizData();

            if (quizFilterLeaderboardAktif === 'semua') {
                renderLeaderboardQuizMilikSaya(data);
                return;
            }

            // Diambil dari server (gabungan SEMUA akun siswa), bukan cuma
            // entri lokal milik akun ini -- ini yang bikin siswa lain bisa
            // kelihatan di leaderboard siswa yang sedang login.
            let daftar = await ambilLeaderboardGabungan('pg', quizFilterLeaderboardAktif, data);

            // Skor sama -> yang lebih DULU mencapai skor itu (tanggal lebih awal)
            // naik lebih tinggi, bukan urutan acak dari hasil gabungan server.
            daftar.sort((a, b) => b.skor - a.skor || new Date(a.tanggal) - new Date(b.tanggal));
            daftar = daftar.slice(0, 10);

            const container = document.getElementById('quiz-leaderboard-list');
            const kosongState = document.getElementById('quiz-leaderboard-kosong');
            container.innerHTML = '';

            if (daftar.length === 0) {
                kosongState.classList.remove('hidden');
                return;
            }
            kosongState.classList.add('hidden');

            // Untuk semua entri siswa LAIN (bukan diri sendiri) di halaman ini,
            // tanya server foto+border yang BENERAN sedang aktif sekarang --
            // logika & endpoint yang sama persis dengan "Cari Teman" -- supaya
            // tidak lagi bergantung pada snapshot beku yang bisa basi (lihat
            // catatan di ambilProfilLiveUntukNamaLeaderboard di atas).
            const petaProfilLive = await ambilPetaProfilLiveLeaderboard(
                daftar.filter(e => e.nama !== NAMA_PEMAIN_QUIZ).map(e => e.nama)
            );

            daftar.forEach((entri, i) => {
                const cfg = QUIZ_CONFIG[entri.level];
                const namaEntri = entri.nama;
                const iniSayaSendiri = namaEntri === NAMA_PEMAIN_QUIZ;

                // Entri milik SAYA SENDIRI selalu ditampilkan REALTIME memakai data
                // profil yang aktif SEKARANG (foto, kelas, border/title, efek nama,
                // badge dev) — bukan snapshot beku dari saat quiz itu dimainkan dulu.
                // Entri milik siswa LAIN juga sekarang REALTIME (lihat petaProfilLive
                // di atas) -- persis pola yang sama dengan "Cari Teman": kalau siswa
                // itu ganti foto profil, leaderboard langsung ikut berubah begitu
                // dibuka lagi, TANPA dia perlu main quiz ulang dulu. Snapshot lama
                // (entri.foto/entri.border/dst, tersimpan di data quiz) cuma dipakai
                // sebagai FALLBACK kalau server lagi tidak bisa dihubungi atau nama
                // siswa itu tidak ketemu di pencarian.
                const borderLiveSaya = iniSayaSendiri ? getBorderTerpakai() : null;
                const profilLiveLain = iniSayaSendiri ? null : petaProfilLive.get(namaEntri);
                const borderLiveLain = profilLiveLain
                    ? (getSemuaBorder().find(b => b.id === profilLiveLain.border) || DAFTAR_BORDER_STARTER[0])
                    : null;
                const fotoEntri = iniSayaSendiri
                    ? getFotoProfilAktifQuiz()
                    : (profilLiveLain?.foto || entri.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(namaEntri)}&background=e0e7ff&color=3730a3&size=120`);
                const borderEntri = iniSayaSendiri ? borderLiveSaya.file : (borderLiveLain?.file || entri.border || '../static/img/border_pemula.png');
                const titleEntri = iniSayaSendiri ? borderLiveSaya.rank : (borderLiveLain?.rank || entri.borderTitle || '🔰 Pemula');
                const kelasEntri = iniSayaSendiri ? getKelasAktifQuiz() : (profilLiveLain?.kelas || entri.kelas || '-');
                const efekNamaEntri = iniSayaSendiri
                    ? getEfekNamaClass(borderLiveSaya)
                    : (borderLiveLain ? getEfekNamaClass(borderLiveLain) : (entri.efekNama || ''));
                const titleBadgeClassEntri = getTitleBadgeClass(efekNamaEntri);
                const badgeDevEntri = iniSayaSendiri
                    ? getBadgeDevHtml(borderLiveSaya)
                    : (borderLiveLain ? getBadgeDevHtml(borderLiveLain) : (entri.badgeDev || ''));
                const kelasNamaEntri = `text-xs font-bold truncate ${efekNamaEntri || 'text-slate-800'}`;

                const baris = document.createElement('div');
                baris.className = `flex items-center justify-between gap-3 p-3 rounded-xl border ${i < 3 ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 bg-slate-50'} ${iniSayaSendiri ? 'ring-1 ring-purple-300' : ''}`;
                baris.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        ${buatBadgeMedali(i + 1)}
                        <div class="profile-wrapper w-10 h-10 flex-shrink-0">
                            <img loading="lazy" decoding="async" src="${fotoEntri}" class="user-avatar avatar-leaderboard-zoom cursor-zoom-in transition-transform hover:scale-110" title="Klik untuk perbesar foto" alt="Avatar ${namaEntri}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(namaEntri)}&background=e0e7ff&color=3730a3&size=120'">
                            <img loading="lazy" decoding="async" src="${borderEntri}" class="user-border" alt="Border ${namaEntri}">
                        </div>
                        <div class="min-w-0">
                            <p class="${kelasNamaEntri}">${namaEntri}${badgeDevEntri ? ' ' + badgeDevEntri : ''}${iniSayaSendiri ? ' <span class="text-purple-500">(Kamu)</span>' : ''}</p>
                            <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassEntri} truncate max-w-full">${titleEntri}</span>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">Kelas ${kelasEntri}${(entri.benar != null && entri.total != null) ? ` &middot; ${entri.benar}/${entri.total} benar` : ''} &middot; ${new Date(entri.tanggal).toLocaleDateString('id-ID')}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${cfg.warnaBadge}">${cfg.label}</span>
                        <span class="text-sm font-extrabold text-slate-900">${entri.skor}</span>
                    </div>
                `;

                // Klik foto profil di leaderboard -> perbesar (pakai ulang modal zoom
                // yang sama dengan zoom foto bukti prestasi, cuma beda sumber foto).
                const imgAvatarLeaderboard = baris.querySelector('.avatar-leaderboard-zoom');
                if (imgAvatarLeaderboard) {
                    imgAvatarLeaderboard.addEventListener('click', (e) => {
                        e.stopPropagation();
                        bukaZoomFotoPrestasi(imgAvatarLeaderboard.src, namaEntri);
                    });
                }

                container.appendChild(baris);
            });
        }

        /* ============================================================
           LEADERBOARD ESSAY -- sistemnya SAMA PERSIS dengan leaderboard
           Pilihan Ganda di atas (filter chip, tab "Poin Saya", badge
           medali, sinkron foto/border realtime untuk entri sendiri),
           cuma sumber datanya dari KEY_QUIZ_ESSAY_DATA & QUIZ_CONFIG_ESSAY.
           ============================================================ */
        function setFilterLeaderboardQuizEssay(val) {
            quizFilterLeaderboardEssayAktif = val;
            document.querySelectorAll('.quiz-filter-chip-essay').forEach(btn => {
                if (btn.dataset.val === val) {
                    btn.className = 'quiz-filter-chip-essay px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-indigo-600 text-white border-indigo-600';
                } else {
                    btn.className = 'quiz-filter-chip-essay px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all bg-white text-slate-600 border-slate-200 hover:bg-slate-100';
                }
            });

            const subtitle = document.getElementById('quiz-leaderboard-essay-subtitle');
            if (subtitle) {
                subtitle.innerText = val === 'semua'
                    ? 'Poin kamu di masing-masing quiz essay. Pilih level untuk lihat peringkat semua siswa.'
                    : 'Peringkat semua siswa berdasarkan skor terbaik quiz essay.';
            }

            renderLeaderboardQuizEssay();
        }

        function renderLeaderboardQuizEssayMilikSaya(data) {
            const container = document.getElementById('quiz-leaderboard-essay-list');
            const kosongState = document.getElementById('quiz-leaderboard-essay-kosong');
            if (!container || !kosongState) return;
            container.innerHTML = '';
            kosongState.classList.add('hidden');

            const best = data.bestByLevel || { easy: 0, medium: 0, hard: 0 };
            const semuaEntriSaya = (data.leaderboard || []).filter(e => e.nama === NAMA_PEMAIN_QUIZ);

            ['easy', 'medium', 'hard'].forEach(level => {
                const cfg = QUIZ_CONFIG_ESSAY[level];
                const skorTerbaik = best[level] || 0;
                const entriTerakhir = semuaEntriSaya
                    .filter(e => e.level === level)
                    .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal))[0];

                const baris = document.createElement('div');
                baris.className = 'flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50';
                baris.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0 ${cfg.warnaBadge}">${cfg.label}</span>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-slate-800 truncate">Poin terbaik kamu</p>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">${entriTerakhir ? `${entriTerakhir.benar}/${entriTerakhir.total} benar &middot; terakhir main ${new Date(entriTerakhir.tanggal).toLocaleDateString('id-ID')}` : 'Belum pernah main quiz essay ini'}</p>
                        </div>
                    </div>
                    <span class="text-sm font-extrabold text-slate-900 flex-shrink-0">${skorTerbaik}</span>
                `;
                container.appendChild(baris);
            });
        }

        async function renderLeaderboardQuizEssay() {
            const data = getQuizEssayData();

            if (quizFilterLeaderboardEssayAktif === 'semua') {
                renderLeaderboardQuizEssayMilikSaya(data);
                return;
            }

            // Sama seperti leaderboard Pilihan Ganda: gabungan dari server,
            // bukan cuma entri lokal milik akun ini.
            let daftar = await ambilLeaderboardGabungan('essay', quizFilterLeaderboardEssayAktif, data);

            // Sama seperti leaderboard Pilihan Ganda: skor sama -> yang lebih
            // dulu mencapainya naik lebih tinggi.
            daftar.sort((a, b) => b.skor - a.skor || new Date(a.tanggal) - new Date(b.tanggal));
            daftar = daftar.slice(0, 10);

            const container = document.getElementById('quiz-leaderboard-essay-list');
            const kosongState = document.getElementById('quiz-leaderboard-essay-kosong');
            if (!container || !kosongState) return;
            container.innerHTML = '';

            if (daftar.length === 0) {
                kosongState.classList.remove('hidden');
                return;
            }
            kosongState.classList.add('hidden');

            // Sama seperti leaderboard Pilihan Ganda: ambil foto+border yang
            // BENERAN aktif sekarang untuk tiap siswa lain, dari endpoint yang
            // sama dengan "Cari Teman" -- bukan snapshot beku.
            const petaProfilLive = await ambilPetaProfilLiveLeaderboard(
                daftar.filter(e => e.nama !== NAMA_PEMAIN_QUIZ).map(e => e.nama)
            );

            daftar.forEach((entri, i) => {
                const cfg = QUIZ_CONFIG_ESSAY[entri.level];
                const namaEntri = entri.nama;
                const iniSayaSendiri = namaEntri === NAMA_PEMAIN_QUIZ;

                // Entri milik saya sendiri selalu realtime (foto/border/title/efek
                // nama terbaru), persis seperti perilaku leaderboard Pilihan Ganda.
                // Entri milik siswa lain juga realtime sekarang (lihat petaProfilLive
                // di atas), snapshot lama cuma jadi fallback kalau lookup gagal.
                const borderLiveSaya = iniSayaSendiri ? getBorderTerpakai() : null;
                const profilLiveLain = iniSayaSendiri ? null : petaProfilLive.get(namaEntri);
                const borderLiveLain = profilLiveLain
                    ? (getSemuaBorder().find(b => b.id === profilLiveLain.border) || DAFTAR_BORDER_STARTER[0])
                    : null;
                const fotoEntri = iniSayaSendiri
                    ? getFotoProfilAktifQuiz()
                    : (profilLiveLain?.foto || entri.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(namaEntri)}&background=e0e7ff&color=3730a3&size=120`);
                const borderEntri = iniSayaSendiri ? borderLiveSaya.file : (borderLiveLain?.file || entri.border || '../static/img/border_pemula.png');
                const titleEntri = iniSayaSendiri ? borderLiveSaya.rank : (borderLiveLain?.rank || entri.borderTitle || '🔰 Pemula');
                const kelasEntri = iniSayaSendiri ? getKelasAktifQuiz() : (profilLiveLain?.kelas || entri.kelas || '-');
                const efekNamaEntri = iniSayaSendiri
                    ? getEfekNamaClass(borderLiveSaya)
                    : (borderLiveLain ? getEfekNamaClass(borderLiveLain) : (entri.efekNama || ''));
                const titleBadgeClassEntri = getTitleBadgeClass(efekNamaEntri);
                const badgeDevEntri = iniSayaSendiri
                    ? getBadgeDevHtml(borderLiveSaya)
                    : (borderLiveLain ? getBadgeDevHtml(borderLiveLain) : (entri.badgeDev || ''));
                const kelasNamaEntri = `text-xs font-bold truncate ${efekNamaEntri || 'text-slate-800'}`;

                const baris = document.createElement('div');
                baris.className = `flex items-center justify-between gap-3 p-3 rounded-xl border ${i < 3 ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100 bg-slate-50'} ${iniSayaSendiri ? 'ring-1 ring-indigo-300' : ''}`;
                baris.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        ${buatBadgeMedali(i + 1)}
                        <div class="profile-wrapper w-10 h-10 flex-shrink-0">
                            <img loading="lazy" decoding="async" src="${fotoEntri}" class="user-avatar avatar-leaderboard-zoom cursor-zoom-in transition-transform hover:scale-110" title="Klik untuk perbesar foto" alt="Avatar ${namaEntri}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(namaEntri)}&background=e0e7ff&color=3730a3&size=120'">
                            <img loading="lazy" decoding="async" src="${borderEntri}" class="user-border" alt="Border ${namaEntri}">
                        </div>
                        <div class="min-w-0">
                            <p class="${kelasNamaEntri}">${namaEntri}${badgeDevEntri ? ' ' + badgeDevEntri : ''}${iniSayaSendiri ? ' <span class="text-indigo-500">(Kamu)</span>' : ''}</p>
                            <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassEntri} truncate max-w-full">${titleEntri}</span>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">Kelas ${kelasEntri} &middot; ${entri.benar}/${entri.total} benar &middot; ${new Date(entri.tanggal).toLocaleDateString('id-ID')}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${cfg.warnaBadge}">${cfg.label}</span>
                        <span class="text-sm font-extrabold text-slate-900">${entri.skor}</span>
                    </div>
                `;

                const imgAvatarLeaderboard = baris.querySelector('.avatar-leaderboard-zoom');
                if (imgAvatarLeaderboard) {
                    imgAvatarLeaderboard.addEventListener('click', (e) => {
                        e.stopPropagation();
                        bukaZoomFotoPrestasi(imgAvatarLeaderboard.src, namaEntri);
                    });
                }

                container.appendChild(baris);
            });
        }

        /* ============================================================
           NOTIFIKASI "DITIKUNG" DI LEADERBOARD ESSAY -- sama seperti
           punya Pilihan Ganda, cuma dicek terpisah dari data & seen-ids
           milik Essay sendiri (KEY_QUIZ_ESSAY_DATA / KEY_QUIZ_ESSAY_SEEN_IDS).
           ============================================================ */
        function getSeenIdsQuizEssay() {
            const raw = localStorage.getItem(KEY_QUIZ_ESSAY_SEEN_IDS);
            return raw ? JSON.parse(raw) : [];
        }

        function tandaiIdSudahDilihatQuizEssay(id) {
            const seenIds = getSeenIdsQuizEssay();
            if (!seenIds.includes(id)) {
                seenIds.push(id);
                localStorage.setItem(KEY_QUIZ_ESSAY_SEEN_IDS, JSON.stringify(seenIds));
            }
        }

        function pastikanBaselineSeenIdsQuizEssay() {
            const seenIds = getSeenIdsQuizEssay();
            if (seenIds.length > 0) return;
            const data = getQuizEssayData();
            const idAwal = (data.leaderboard || []).filter(e => e.id).map(e => e.id);
            if (idAwal.length > 0) localStorage.setItem(KEY_QUIZ_ESSAY_SEEN_IDS, JSON.stringify(idAwal));
        }

        function hitungPosisiPemainQuizEssay(level) {
            const data = getQuizEssayData();
            const daftar = (data.leaderboard || []).filter(e => e.level === level);
            const skorTerbaikPerNama = {};
            daftar.forEach(e => {
                if (!skorTerbaikPerNama[e.nama] || e.skor > skorTerbaikPerNama[e.nama]) {
                    skorTerbaikPerNama[e.nama] = e.skor;
                }
            });
            const urutan = Object.entries(skorTerbaikPerNama).sort((a, b) => b[1] - a[1]);
            const idx = urutan.findIndex(([nama]) => nama === NAMA_PEMAIN_QUIZ);
            return idx === -1 ? null : idx + 1;
        }

        function cekNotifDitikungQuizEssay() {
            const data = getQuizEssayData();
            const seenIds = getSeenIdsQuizEssay();
            const semuaEntri = data.leaderboard || [];

            const entriBelumDilihat = semuaEntri.filter(e => e.id && !seenIds.includes(e.id) && e.nama !== NAMA_PEMAIN_QUIZ);
            if (entriBelumDilihat.length === 0) return;

            entriBelumDilihat.forEach((entri, i) => {
                const skorTerbaikSaya = Math.max(
                    0,
                    ...semuaEntri.filter(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === entri.level).map(e => e.skor)
                );
                if (entri.skor > skorTerbaikSaya) {
                    setTimeout(() => tampilkanToastDitikungQuizEssay(entri), i * 400);
                }
                tandaiIdSudahDilihatQuizEssay(entri.id);
            });
        }

        function tampilkanToastDitikungQuizEssay(entri) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            const cfg = QUIZ_CONFIG_ESSAY[entri.level];
            const posisi = hitungPosisiPemainQuizEssay(entri.level);
            const idToast = `ditikung-essay-${entri.id}`;

            const fotoPenikung = entri.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(entri.nama)}&background=e0e7ff&color=3730a3&size=120`;
            const borderPenikung = entri.border || '../static/img/border_pemula.png';
            const titlePenikung = entri.borderTitle || '🔰 Pemula';
            const efekNamaPenikung = entri.efekNama || '';
            const titleBadgeClassPenikung = getTitleBadgeClass(efekNamaPenikung);
            const badgeDevPenikung = entri.badgeDev || '';
            const kelasPenikung = entri.kelas ? ` &middot; Kelas ${entri.kelas}` : '';
            const pesanRebut = PESAN_REBUT_POSISI_QUIZ[Math.floor(Math.random() * PESAN_REBUT_POSISI_QUIZ.length)];

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik notif-toast-ungu';
            toast.id = `toast-${idToast}`;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="profile-wrapper w-10 h-10 flex-shrink-0">
                        <img loading="lazy" decoding="async" src="${fotoPenikung}" class="user-avatar" alt="Avatar ${entri.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(entri.nama)}&background=e0e7ff&color=3730a3&size=120'">
                        <img loading="lazy" decoding="async" src="${borderPenikung}" class="user-border" alt="Border ${entri.nama}">
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">😱 Kamu Ditikung di Leaderboard Essay!</p>
                        <p class="text-[11px] font-bold mt-0.5"><i class="fa-solid fa-bolt mr-1 text-indigo-600"></i><span class="${efekNamaPenikung || 'text-indigo-600'}">${entri.nama}</span>${badgeDevPenikung ? ' ' + badgeDevPenikung : ''}<span class="text-indigo-600">${kelasPenikung} &middot; ${cfg.label} &middot; ${entri.skor} poin</span></p>
                        <span class="inline-block mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassPenikung}">${titlePenikung}</span>
                        <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">${entri.nama} baru saja menyalip skor terbaikmu di level Essay ${cfg.label}${posisi ? `, posisimu sekarang turun ke peringkat #${posisi}` : ''}.</p>
                        <p class="text-[11px] font-semibold text-slate-700 mt-1 leading-relaxed">${pesanRebut}</p>
                        <button onclick="switchTab('quiz'); tutupToastDitikungQuizEssay('${idToast}')" class="mt-2 text-[11px] font-bold text-indigo-600 hover:underline">Balas Sekarang &rarr;</button>
                    </div>
                    <button onclick="tutupToastDitikungQuizEssay('${idToast}')" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);

            const badge = document.getElementById('badge-quiz-ditikung');
            if (badge) badge.classList.remove('hidden');

            setTimeout(() => tutupToastDitikungQuizEssay(idToast), 8000);
        }

        function tutupToastDitikungQuizEssay(idToast) {
            const toast = document.getElementById(`toast-${idToast}`);
            if (!toast) return;
            toast.classList.add('notif-keluar');
            setTimeout(() => toast.remove(), 300);
        }

        /* ============================================================
           PANEL DUMMY LEADERBOARD (dikontrol dari sidebar)
           Akun dummy ditambahkan sebagai entri biasa di
           data.leaderboard (key sama dgn KEY_QUIZ_DATA milik kelas
           aktif) tapi diberi flag dummy:true, supaya:
           - Tetap tampil normal & bisa "ditikung"/menikung di
             renderLeaderboardQuiz() seperti entri asli.
           - Bisa difilter & dikelola (hapus) khusus lewat panel ini.
           - IKUT memicu notif "ditikung" kalau skornya melebihi skor
             terbaik siswa di level yang sama (dicek manual lewat
             cekNotifDitikungQuiz() begitu dummy selesai ditambahkan,
             karena event 'storage' bawaan browser tidak nyala di
             tab yang sama dengan yang melakukan localStorage.setItem).
           ============================================================ */

        function toggleAkunDummyPanel() {
            const panel = document.getElementById('panel-akun-dummy-profil');
            const icon = document.getElementById('icon-toggle-akun-dummy-panel');
            const trigger = document.querySelector('[aria-controls="panel-akun-dummy-profil"]');
            if (!panel) return;
            panel.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
            if (trigger) trigger.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
        }

        function toggleDummyPanel() {
            const panel = document.getElementById('panel-dummy-leaderboard');
            const icon = document.getElementById('icon-toggle-dummy-panel');
            const trigger = document.querySelector('[aria-controls="panel-dummy-leaderboard"]');
            if (!panel) return;
            panel.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
            if (trigger) trigger.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
        }

        function tambahDummyLeaderboard(event) {
            event.preventDefault();
            const nama = document.getElementById('dummy-nama').value.trim();
            const kelas = document.getElementById('dummy-kelas').value.trim() || '-';
            const level = document.getElementById('dummy-level').value;
            const skorInput = document.getElementById('dummy-skor').value;
            const skor = parseInt(skorInput, 10);
            if (!nama || isNaN(skor) || skor < 0) return;

            // PENGAMAN: dummy dengan nama PERSIS SAMA dengan akun asli yang
            // sedang login sengaja ditolak. Kalau diizinkan, dedup leaderboard
            // (yang cuma nyisain 1 entri per nama+level) bisa "menimpa" entri
            // ASLI milikmu sendiri dengan entri dummy ini -- dan karena live
            // photo-override di leaderboard dicocokkan lewat NAMA, entri dummy
            // itu bisa keliru dianggap "milikmu" (atau, kalau dummy ini dibuat
            // waktu login sebagai akun lain, malah nyangkut ke akun lain itu).
            // Itu penyebab bug foto profil "gak sinkron" yang pernah dilaporkan.
            if (nama.toLowerCase() === NAMA_PEMAIN_QUIZ.trim().toLowerCase()) {
                alert(`Nama dummy tidak boleh sama persis dengan akun yang sedang login (${NAMA_PEMAIN_QUIZ}). Pakai nama lain untuk simulasi siswa dummy.`);
                return;
            }

            // Perkiraan kasar jumlah benar dari skor, cuma buat tampilan
            // "x/5 benar" di baris leaderboard supaya wajar dilihat.
            const poinDasar = QUIZ_CONFIG[level].poinDasar;
            const benarPerkiraan = Math.max(0, Math.min(5, Math.round(skor / (poinDasar * 1.3))));

            const data = getQuizData();
            data.leaderboard = data.leaderboard || [];
            const entriDummy = {
                id: `dummy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                nama,
                kelas,
                foto: `https://ui-avatars.com/api/?name=${encodeURIComponent(nama)}&background=e0e7ff&color=3730a3&size=120`,
                border: '../static/img/border_pemula.png',
                borderTitle: '🔰 Pemula',
                efekNama: '',
                badgeDev: '',
                level,
                skor,
                benar: benarPerkiraan,
                total: 5,
                tanggal: new Date().toISOString(),
                dummy: true
            };
            data.leaderboard.push(entriDummy);
            saveQuizData(data);
            // Dummy baru SENGAJA tidak langsung ditandai "sudah dilihat" di sini —
            // biar diperlakukan sama seperti entri asli & ikut dicek oleh
            // cekNotifDitikungQuiz() di bawah (yang akan menandainya sendiri
            // setelah selesai dicek), supaya menambah dummy dengan skor lebih
            // tinggi dari skor terbaik siswa langsung memicu toast "ditikung".

            document.getElementById('dummy-nama').value = '';
            document.getElementById('dummy-kelas').value = '';
            document.getElementById('dummy-skor').value = '';

            renderPanelDummyLeaderboard();
            renderLeaderboardQuiz();
            cekNotifDitikungQuiz(); // panggil manual: event 'storage' tidak nyala di tab yang sama
        }

        function hapusDummyLeaderboard(id) {
            const data = getQuizData();
            data.leaderboard = (data.leaderboard || []).filter(e => e.id !== id);
            saveQuizData(data);
            renderPanelDummyLeaderboard();
            renderLeaderboardQuiz();
        }

        function renderPanelDummyLeaderboard() {
            const container = document.getElementById('list-dummy-leaderboard');
            if (!container) return;

            const data = getQuizData();
            const daftarDummy = (data.leaderboard || [])
                .filter(e => e.dummy)
                .sort((a, b) => b.skor - a.skor || new Date(a.tanggal) - new Date(b.tanggal));

            if (!daftarDummy.length) {
                container.innerHTML = `<p class="text-[10px] text-slate-400 text-center py-2">Belum ada akun dummy. Tambahkan lewat form di atas.</p>`;
                return;
            }

            container.innerHTML = '';
            daftarDummy.forEach(entri => {
                const cfg = QUIZ_CONFIG[entri.level];
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between gap-2 p-2 bg-white border border-slate-200 rounded-lg';
                row.innerHTML = `
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold text-slate-800 truncate">${entri.nama}</p>
                        <p class="text-[9px] text-slate-400 truncate">${entri.kelas} &middot; <span class="px-1 py-0.5 rounded ${cfg.warnaBadge} font-semibold">${cfg.label}</span> &middot; ${entri.skor} poin</p>
                    </div>
                    <button class="text-rose-500 hover:text-rose-700 flex-shrink-0 px-1.5 py-1" title="Hapus akun dummy ini">
                        <i class="fa-solid fa-trash text-[11px]"></i>
                    </button>
                `;
                row.querySelector('button').addEventListener('click', () => hapusDummyLeaderboard(entri.id));
                container.appendChild(row);
            });
        }

        /* ============================================================
           NOTIFIKASI "DITIKUNG" DI LEADERBOARD
           Terpicu saat ada entri BARU di leaderboard (nama lain, biasanya
           dari tab/perangkat lain yang berbagi localStorage yang sama —
           sama seperti cara notif "Tugas Ditarik Guru" bekerja di file
           ini) yang skornya melampaui skor terbaik kita di level tsb.
           ============================================================ */

        const KEY_QUIZ_SEEN_IDS = `quiz_seen_ids_${ID_SISWA_AKTIF}`;

        function getSeenIdsQuiz() {
            const raw = localStorage.getItem(KEY_QUIZ_SEEN_IDS);
            return raw ? JSON.parse(raw) : [];
        }

        function tandaiIdSudahDilihatQuiz(id) {
            const seenIds = getSeenIdsQuiz();
            if (!seenIds.includes(id)) {
                seenIds.push(id);
                localStorage.setItem(KEY_QUIZ_SEEN_IDS, JSON.stringify(seenIds));
            }
        }

        // Dipanggil sekali saat halaman pertama kali dibuka: entri lama yang sudah
        // ada di leaderboard ditandai "sudah dilihat" duluan, supaya tidak ikut
        // memicu notif ditikung basi begitu halaman baru saja dimuat.
        function pastikanBaselineSeenIdsQuiz() {
            const seenIds = getSeenIdsQuiz();
            if (seenIds.length > 0) return;
            const data = getQuizData();
            const idAwal = (data.leaderboard || []).filter(e => e.id).map(e => e.id);
            if (idAwal.length > 0) localStorage.setItem(KEY_QUIZ_SEEN_IDS, JSON.stringify(idAwal));
        }

        function hitungPosisiPemainQuiz(level) {
            const data = getQuizData();
            const daftar = (data.leaderboard || []).filter(e => e.level === level);
            const skorTerbaikPerNama = {};
            daftar.forEach(e => {
                if (!skorTerbaikPerNama[e.nama] || e.skor > skorTerbaikPerNama[e.nama]) {
                    skorTerbaikPerNama[e.nama] = e.skor;
                }
            });
            const urutan = Object.entries(skorTerbaikPerNama).sort((a, b) => b[1] - a[1]);
            const idx = urutan.findIndex(([nama]) => nama === NAMA_PEMAIN_QUIZ);
            return idx === -1 ? null : idx + 1;
        }

        function cekNotifDitikungQuiz() {
            const data = getQuizData();
            const seenIds = getSeenIdsQuiz();
            const semuaEntri = data.leaderboard || [];

            const entriBelumDilihat = semuaEntri.filter(e => e.id && !seenIds.includes(e.id) && e.nama !== NAMA_PEMAIN_QUIZ);
            if (entriBelumDilihat.length === 0) return;

            entriBelumDilihat.forEach((entri, i) => {
                const skorTerbaikSaya = Math.max(
                    0,
                    ...semuaEntri.filter(e => e.nama === NAMA_PEMAIN_QUIZ && e.level === entri.level).map(e => e.skor)
                );
                if (entri.skor > skorTerbaikSaya) {
                    setTimeout(() => tampilkanToastDitikungQuiz(entri), i * 400);
                }
                tandaiIdSudahDilihatQuiz(entri.id);
            });
        }

        // Kumpulan pesan "ayo rebut kembali posisimu" dengan emoji lucu — dipilih
        // acak tiap kali toast muncul biar terasa hidup, tidak monoton itu-itu saja.
        const PESAN_REBUT_POSISI_QUIZ = [
            'Ayo rebut kembali rangkingmu! Jangan cuma diem aja dong 😤🔥',
            'Gaskeun! Rebut lagi rangkingmu, jangan mau kalah gitu aja 💪😆',
            'Rangkingmu direbut nih! Waktunya comeback dan balikin lagi 🚀😎',
            'Yuk buruan main lagi, rebut kembali rangkingmu di leaderboard! 👑🏃‍♂️💨',
            'Santai tapi jangan lengah, rebut kembali rangkingmu sekarang! ⚡🤓'
        ];

        function tampilkanToastDitikungQuiz(entri) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            const cfg = QUIZ_CONFIG[entri.level];
            const posisi = hitungPosisiPemainQuiz(entri.level);
            const idToast = `ditikung-${entri.id}`;

            // Foto + border penikung disinkronkan dari data leaderboard-nya sendiri
            // (snapshot foto profil & border yang sedang dia pakai saat main quiz).
            const fotoPenikung = entri.foto || `https://ui-avatars.com/api/?name=${encodeURIComponent(entri.nama)}&background=e0e7ff&color=3730a3&size=120`;
            const borderPenikung = entri.border || '../static/img/border_pemula.png';
            const titlePenikung = entri.borderTitle || '🔰 Pemula';
            const efekNamaPenikung = entri.efekNama || '';
            const titleBadgeClassPenikung = getTitleBadgeClass(efekNamaPenikung);
            const badgeDevPenikung = entri.badgeDev || '';
            const kelasPenikung = entri.kelas ? ` &middot; Kelas ${entri.kelas}` : '';
            const pesanRebut = PESAN_REBUT_POSISI_QUIZ[Math.floor(Math.random() * PESAN_REBUT_POSISI_QUIZ.length)];

            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik notif-toast-ungu';
            toast.id = `toast-${idToast}`;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="profile-wrapper w-10 h-10 flex-shrink-0">
                        <img loading="lazy" decoding="async" src="${fotoPenikung}" class="user-avatar" alt="Avatar ${entri.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(entri.nama)}&background=e0e7ff&color=3730a3&size=120'">
                        <img loading="lazy" decoding="async" src="${borderPenikung}" class="user-border" alt="Border ${entri.nama}">
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">😱 Kamu Ditikung di Leaderboard!</p>
                        <p class="text-[11px] font-bold mt-0.5"><i class="fa-solid fa-bolt mr-1 text-purple-600"></i><span class="${efekNamaPenikung || 'text-purple-600'}">${entri.nama}</span>${badgeDevPenikung ? ' ' + badgeDevPenikung : ''}<span class="text-purple-600">${kelasPenikung} &middot; ${cfg.label} &middot; ${entri.skor} poin</span></p>
                        <span class="inline-block mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${titleBadgeClassPenikung}">${titlePenikung}</span>
                        <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">${entri.nama} baru saja menyalip skor terbaikmu di level ${cfg.label}${posisi ? `, posisimu sekarang turun ke peringkat #${posisi}` : ''}.</p>
                        <p class="text-[11px] font-semibold text-slate-700 mt-1 leading-relaxed">${pesanRebut}</p>
                        <button onclick="switchTab('quiz'); tutupToastDitikungQuiz('${idToast}')" class="mt-2 text-[11px] font-bold text-purple-600 hover:underline">Balas Sekarang &rarr;</button>
                    </div>
                    <button onclick="tutupToastDitikungQuiz('${idToast}')" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);

            const badge = document.getElementById('badge-quiz-ditikung');
            if (badge) badge.classList.remove('hidden');

            setTimeout(() => tutupToastDitikungQuiz(idToast), 8000);
        }

        function tutupToastDitikungQuiz(idToast) {
            const toast = document.getElementById(`toast-${idToast}`);
            if (!toast) return;
            toast.classList.add('notif-keluar');
            setTimeout(() => toast.remove(), 300);
        }

        /* ============================================================
           FITUR KOLEKSI BORDER AVATAR (menggantikan tab Akademik)
           Dipisah jadi 2 KATEGORI/JALUR terpisah:
           1. BORDER QUIZ    -> satu jalur border sendiri untuk TIAP tingkat
                                kesulitan (easy/medium/hard), terbuka sesuai
                                skor TERBAIK siswa di level itu (bestByLevel).
           2. BORDER PRESTASI -> terbuka dari upload sertifikat/piala yang
                                sudah DIKONFIRMASI (disetujui) oleh guru/admin.
                                Karena file ini murni front-end (belum ada
                                backend admin), status konfirmasi disimpan di
                                localStorage dan bisa diuji lewat tombol
                                "Simulasi Guru" pada tiap pengajuan yang masih
                                Menunggu — di implementasi produksi, tombol ini
                                diganti alur approve dari Dashboard Guru/Admin.
           CATATAN: nama file border di bawah masih placeholder mengikuti
           pola yang sudah dipakai (border_emas.png) — tinggal ganti isi
           `file` kalau file PNG/JPG border lain sudah tersedia di folder
           ../static/img/.
           ============================================================ */

        const KEY_BORDER_TERPAKAI = `border_terpakai_${ID_SISWA_AKTIF}`;
        // Key & skema data di bawah harus SAMA PERSIS dengan yang dipakai Dashboard
        // Guru (lihat keyPrestasiKelas() & renderKonfirmasiPrestasi() di dashboard_guru.html),
        // supaya prestasi yang diajukan siswa di sini benar2 muncul & bisa dikonfirmasi
        // oleh guru manapun di sana, dan status/nama guru penyetuju bisa kebaca balik di sini.
        const KEY_PRESTASI_SISWA = `pengajuan_prestasi_${KELAS_AKTIF_SISWA}`;

        // Border prestasi MAUPUN quiz TIDAK auto-terbuka lagi hanya karena poin
        // sudah cukup — siswa harus klik tombol "Klaim Border" secara manual dulu.
        // Key ini menyimpan daftar id semua border (prestasi & quiz) yang sudah
        // pernah diklaim.
        const KEY_BORDER_DIKLAIM = `border_diklaim_${ID_SISWA_AKTIF}`;

        // Tingkatan/tier generik yang dipakai berulang di tiap level quiz.
        // Tier "Polos" (tierRank 0) SUDAH DIPINDAH keluar dari sini — lihat
        // DAFTAR_BORDER_STARTER di bawah. Alasannya: dulu tier 0 ini dibikin
        // per-level (polos easy/medium/hard) dan minPoin-nya 0, jadi otomatis
        // ke-3 nya kebuka bareng buat siswa baru sekaligus (kelihatan kayak
        // sudah "unlock" 3 border padahal belum ngerjain apa-apa). Sekarang
        // cukup SATU border starter global yang dipakai semua siswa baru.
        const BORDER_TIER_TEMPLATE = [
            { tierId: 'perak',   nama: 'Perak',   file: '../static/img/border_silver.jpg', minPoin: 100, tierRank: 1 },
            { tierId: 'emas',    nama: 'Emas',    file: '../static/img/border_gold.jpg',   minPoin: 250, tierRank: 2 },
            { tierId: 'permata', nama: 'Permata', file: '../static/img/border_bronze.jpg', minPoin: 500, tierRank: 3 }
        ];

        const LEVEL_META_BORDER = {
            easy:   { label: 'Easy',   icon: 'fa-seedling',    warna: 'emerald' },
            medium: { label: 'Medium', icon: 'fa-bolt',        warna: 'amber'   },
            hard:   { label: 'Hard',   icon: 'fa-fire',        warna: 'rose'    }
        };

        // Border starter (bawaan): SATU-SATUNYA border yang otomatis dimiliki &
        // dipakai semua siswa sejak pertama kali masuk (mis. akun baru seperti
        // Syam) — bukan pencapaian, jadi tidak perlu diklaim & tidak terikat
        // level quiz manapun.
        const DAFTAR_BORDER_STARTER = [
            { id: 'starter_pemula', kategori: 'starter', nama: 'Pemula', file: '../static/img/border_pemula.png', minPoin: 0, tierRank: 0, rank: '🔰 Pemula' }
        ];

        // Bangun daftar border quiz: 3 tier (perak/emas/permata) x 3 level =
        // 9 border, masing2 level (easy/medium/hard) punya jalur pembukaan
        // sendiri2. Tier dasar/starter TIDAK ikut dibangun di sini lagi.
        function buatDaftarBorderQuiz() {
            const list = [];
            Object.keys(LEVEL_META_BORDER).forEach(level => {
                BORDER_TIER_TEMPLATE.forEach(tier => {
                    list.push({
                        id: `quiz_${level}_${tier.tierId}`,
                        kategori: 'quiz',
                        level,
                        nama: `${tier.nama} ${LEVEL_META_BORDER[level].label}`,
                        file: tier.file,
                        minPoin: tier.minPoin,
                        tierRank: tier.tierRank,
                        rank: tier.tierRank === 1 ? `📘 Pelajar Rajin ${LEVEL_META_BORDER[level].label}`
                            : tier.tierRank === 2 ? `🧠 Master Quiz ${LEVEL_META_BORDER[level].label}`
                            : `👑 Legenda ${LEVEL_META_BORDER[level].label}`
                    });
                });
            });
            return list;
        }
        const DAFTAR_BORDER_QUIZ = buatDaftarBorderQuiz();

        // Border khusus Admin/Developer: selalu terbuka (tidak lewat syarat quiz
        // ataupun prestasi), dipakai buat akun DEV/Admin seperti akun ini.
        // tierRank sengaja dibuat paling tinggi supaya otomatis jadi border
        // default yang dipakai selama belum pernah pilih border lain manual.
        const DAFTAR_BORDER_ADMIN = [
            { id: 'admin_dev', kategori: 'admin', nama: 'Admin', file: '../static/img/border_admin.jpg', tierRank: 99, rank: '👑 Developer Sistem' }
        ];

        // Border khusus "Kristal Imortal" (border_imortal.png): bukan lewat jalur
        // poin quiz maupun poin prestasi (sertifikat/piala) seperti border lain --
        // syaratnya "akun harus sudah pernah ikut IMO", yang sifatnya verifikasi
        // manual/khusus, bukan sesuatu yang bisa dihitung otomatis dari poin.
        // SEMENTARA cuma di-hardcode terbuka untuk 1 akun (Ahmad Fakhri Al Farisi
        // -- username 'siswa', sama seperti akunIniAdminDev(), lihat
        // isBorderTerbuka()); akun lain manapun (siswa biasa/dummy) selalu
        // terkunci sampai nanti ada mekanisme verifikasi/penandaan akun IMO yang
        // sesungguhnya di backend. tierRank dibuat di atas semua tier
        // prestasi/quiz (4) tapi di bawah admin (99), supaya kalau akun ini juga
        // punya border prestasi lain, border Kristal Imortal yang otomatis jadi
        // default dipakai.
        const DAFTAR_BORDER_KHUSUS = [
            { id: 'border_imortal', kategori: 'khusus', nama: 'Kristal Imortal', file: '../static/img/border_imortal.png', tierRank: 10, rank: '💎 IMO' }
        ];


        // Border dari jalur Prestasi (upload sertifikat/piala + konfirmasi admin/guru)
        const DAFTAR_BORDER_PRESTASI = [
            { id: 'prestasi_perunggu', kategori: 'prestasi', nama: 'Perunggu Prestasi', file: '../static/img/border_bronze.jpg', minPoin: 50,  tierRank: 1, rank: '🥉 Berprestasi' },
            { id: 'prestasi_perak',    kategori: 'prestasi', nama: 'Perak Prestasi',    file: '../static/img/border_silver.jpg', minPoin: 200, tierRank: 2, rank: '🥈 Siswa Berbakat' },
            { id: 'prestasi_emas',     kategori: 'prestasi', nama: 'Emas Prestasi',     file: '../static/img/border_gold.jpg',   minPoin: 400, tierRank: 3, rank: '🏆 Bintang Sekolah' },
            { id: 'prestasi_pink',     kategori: 'prestasi', nama: 'Kupu-kupu Prestasi', file: '../static/img/border_pink.jpg',   minPoin: 600, tierRank: 4, rank: '👑 Queen' }
        ];

        function getPrestasiData() {
            try {
                const raw = localStorage.getItem(KEY_PRESTASI_SISWA);
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }

        /* ================= JOURNEY PRESTASI (per tahun ajaran) =================
           Tahun ajaran diasumsikan berjalan Juli—Juni (kalender akademik umum di
           Indonesia). "Kelas 12 (Current)" = tahun ajaran yang sedang berjalan
           hari ini; "Kelas 11" = 1 tahun ajaran sebelumnya; "Kelas 10" = 2 tahun
           ajaran sebelumnya. Tidak ada input manual — semua dipetakan otomatis
           dari timestamp yang disisipkan di id tiap prestasi (prestasi_<ts>). */
        const OFFSET_TAHUN_KELAS_JOURNEY = { X: 2, XI: 1, XII: 0 };
        const POIN_PER_JENIS_PRESTASI = { piala: 75, sertifikat: 50 };
        const BULAN_MULAI_TAHUN_AJARAN = 6; // Juli, 0-based (Jan=0)

        function getRentangTahunAjaran(offsetTahunKeBelakang) {
            const sekarang = new Date();
            let tahunMulai = sekarang.getFullYear();
            if (sekarang.getMonth() < BULAN_MULAI_TAHUN_AJARAN) tahunMulai -= 1;
            tahunMulai -= offsetTahunKeBelakang;
            const mulai = new Date(tahunMulai, BULAN_MULAI_TAHUN_AJARAN, 1);
            const akhir = new Date(tahunMulai + 1, BULAN_MULAI_TAHUN_AJARAN, 0, 23, 59, 59, 999); // 30 Juni tahun berikutnya
            return { mulai, akhir, labelTahun: `${tahunMulai}/${tahunMulai + 1}` };
        }

        function ambilTimestampPrestasi(item) {
            // id dibuat dgn `prestasi_${Date.now()}` saat pengajuan (lihat ajukanPrestasi()),
            // jadi timestamp aslinya bisa diambil langsung dari id tanpa parsing string tanggal.
            if (!item || !item.id) return null;
            const ts = Number(String(item.id).split('_')[1]);
            return Number.isFinite(ts) ? ts : null;
        }

        function ambilPrestasiUntukKelasJourney(kodeKelas) {
            const offset = OFFSET_TAHUN_KELAS_JOURNEY[kodeKelas];
            if (offset === undefined) return { rentang: null, items: [] };
            const rentang = getRentangTahunAjaran(offset);
            const items = getPrestasiData().filter(item => {
                if (item.status !== 'disetujui') return false;
                const ts = ambilTimestampPrestasi(item);
                return ts !== null && ts >= rentang.mulai.getTime() && ts <= rentang.akhir.getTime();
            });
            return { rentang, items };
        }

        function hitungPoinPrestasi(item) {
            return POIN_PER_JENIS_PRESTASI[item.jenis] ?? 50;
        }

        // ================= SISTEM POIN BORDER (dibaca langsung dari localStorage) =================
        // Semua prestasi yang sudah disetujui guru/admin tersimpan di localStorage lewat
        // getPrestasiData(). Fungsi ini menjumlahkan poin dari prestasi yang disetujui itu
        // menjadi satu angka poin — inilah yang jadi dasar buka/tutup border prestasi
        // (0 poin = semua border prestasi masih terkunci & tampil grayscale).
        function getTotalPoinPrestasiDisetujui() {
            return getPrestasiData()
                .filter(item => item.status === 'disetujui')
                .reduce((total, item) => total + hitungPoinPrestasi(item), 0);
        }

        function tentukanStatusPencapaianJourney(totalPoin) {
            const tierCocok = DAFTAR_BORDER_PRESTASI.slice().reverse().find(t => totalPoin >= t.minPoin);
            return tierCocok ? tierCocok.rank : '🌱 Belum Ada Pencapaian';
        }

        function hitungStreakKonsistenJourney() {
            // Hitung mundur dari Kelas 12 (sekarang): berapa tahun ajaran BERTURUT-TURUT
            // yang masing-masing punya minimal 1 prestasi disetujui.
            let streak = 0;
            for (const kode of ['XII', 'XI', 'X']) {
                const { items } = ambilPrestasiUntukKelasJourney(kode);
                if (items.length > 0) streak++; else break;
            }
            return streak;
        }

        let kelasAktifJourneyPrestasi = 'XII';
        let chartJourneyPrestasi = null;

        // Lazy-load Chart.js: sama seperti pola muatTesseractJikaBelum() di bawah --
        // library-nya (±200KB) baru benar-benar di-download pas siswa pertama kali
        // buka tab "Journey Prestasi" yang butuh grafik, BUKAN otomatis di setiap
        // halaman dashboard dibuka. _janjiChartJs di-cache supaya cuma di-download
        // sekali walau tabnya dibuka-tutup berkali-kali.
        let _janjiChartJs = null;
        function muatChartJsJikaBelum() {
            if (typeof Chart !== 'undefined') return Promise.resolve();
            if (_janjiChartJs) return _janjiChartJs;
            _janjiChartJs = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js';
                s.onload = () => resolve();
                s.onerror = () => { _janjiChartJs = null; reject(new Error('Gagal memuat library grafik')); };
                document.head.appendChild(s);
            });
            return _janjiChartJs;
        }

        function setTabJourneyPrestasi(kodeKelas) {
            kelasAktifJourneyPrestasi = kodeKelas;
            document.querySelectorAll('.tab-journey-kelas').forEach(btn => {
                const aktif = btn.dataset.kelas === kodeKelas;
                btn.classList.toggle('bg-amber-500', aktif);
                btn.classList.toggle('text-white', aktif);
                btn.classList.toggle('border-amber-500', aktif);
                btn.classList.toggle('bg-white', !aktif);
                btn.classList.toggle('text-slate-600', !aktif);
                btn.classList.toggle('border-slate-200', !aktif);
            });
            renderJourneyPrestasi();
            // Leaderboard ikut disaring ke tahun ajaran kelas yang dipilih -- dirender
            // ulang di sini juga (bukan cuma pas toggleJourneyLeaderboard dibuka) supaya
            // datanya sudah sinkron kalau user pindah tab sambil leaderboard lagi tampil.
            if (typeof renderLeaderboardPrestasi === 'function') renderLeaderboardPrestasi();
        }

        function renderJourneyPrestasi() {
            const kode = kelasAktifJourneyPrestasi;
            const { rentang, items } = ambilPrestasiUntukKelasJourney(kode);
            const totalPrestasi = items.length;
            const totalPoin = items.reduce((sum, it) => sum + hitungPoinPrestasi(it), 0);

            const elTotal = document.getElementById('journey-total-prestasi');
            if (elTotal) elTotal.innerText = String(totalPrestasi);
            const elPoin = document.getElementById('journey-poin-akumulasi');
            if (elPoin) elPoin.innerText = String(totalPoin);
            const elStatus = document.getElementById('journey-status-pencapaian');
            if (elStatus) elStatus.innerText = tentukanStatusPencapaianJourney(totalPoin);
            const elLabelTahun = document.getElementById('journey-label-tahun-ajaran');
            if (elLabelTahun && rentang) elLabelTahun.innerText = `Tahun Ajaran ${rentang.labelTahun}`;

            const streak = hitungStreakKonsistenJourney();
            const elStreak = document.getElementById('journey-streak-konsisten');
            if (elStreak) {
                if (streak >= 2) {
                    elStreak.innerText = `🔥 Konsisten ${streak} Tahun Ajaran Berturut-turut`;
                    elStreak.classList.remove('hidden');
                } else {
                    elStreak.classList.add('hidden');
                }
            }

            renderChartJourneyPrestasi(items);
        }

        function renderChartJourneyPrestasi(items) {
            const canvas = document.getElementById('chart-journey-prestasi');
            if (!canvas) return;
            if (typeof Chart === 'undefined') {
                // Chart.js belum ke-download -- muat dulu, lalu render ulang begitu siap.
                muatChartJsJikaBelum()
                    .then(() => renderChartJourneyPrestasi(items))
                    .catch(() => {}); // gagal muat grafik tidak boleh menghentikan halaman
                return;
            }

            // Bucket poin per bulan, urut mulai dari bulan awal tahun ajaran (Juli) s/d Juni.
            const labelBulan = ['Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun'];
            const poinPerBulan = new Array(12).fill(0);
            items.forEach(item => {
                const ts = ambilTimestampPrestasi(item);
                if (ts === null) return;
                let bulanIndex = new Date(ts).getMonth() - BULAN_MULAI_TAHUN_AJARAN;
                if (bulanIndex < 0) bulanIndex += 12;
                poinPerBulan[bulanIndex] += hitungPoinPrestasi(item);
            });

            if (chartJourneyPrestasi) {
                chartJourneyPrestasi.data.datasets[0].data = poinPerBulan;
                chartJourneyPrestasi.update();
                return;
            }

            chartJourneyPrestasi = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: labelBulan,
                    datasets: [{
                        label: 'Poin Prestasi',
                        data: poinPerBulan,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        tension: 0.35,
                        fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: '#f59e0b'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        function savePrestasiData(list) {
            localStorage.setItem(KEY_PRESTASI_SISWA, JSON.stringify(list));
            // Dorong juga ke server (endpoint /api/prestasi/..., TERPISAH dari
            // /api/quiz/... -- lihat catatan panjang di app.py) supaya
            // pengajuan/persetujuan prestasi kelas ini ikut sinkron ke siswa
            // lain & Leaderboard Prestasi tidak lagi cuma "kebaca" di browser
            // yang sama.
            simpanPrestasiKeServer(list);
        }

        // ============================================================
        // SINKRONISASI PRESTASI KE SERVER (endpoint SENDIRI, tidak numpang
        // di quiz_store -- lihat simpanQuizKeServer utk pola aslinya yang
        // ditiru di sini: fire-and-forget + keepalive + retry 1x, supaya
        // request tetap coba jalan walau tab langsung ditinggal/pindah
        // halaman setelah kirim pengajuan prestasi).
        // ============================================================
        function simpanPrestasiKeServer(list, percobaanUlang) {
            fetch('/api/prestasi/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({ kelas: KELAS_AKTIF_SISWA, data: list, expected_username: USERNAME_SISWA_ASLI })
            })
                .then(res => res.json())
                .then(hasil => {
                    if (hasil && hasil.session_mismatch) tampilkanPeringatanSesiBerubah();
                })
                .catch(() => {
                    if (!percobaanUlang) {
                        setTimeout(() => simpanPrestasiKeServer(list, true), 1500);
                    }
                });
        }

        // Tarik daftar prestasi kelas ini dari server lalu gabung dengan yang
        // ada di localStorage (bukan saling timpa begitu saja):
        //   - Item yang di server tapi tidak ada di lokal (mis. pengajuan
        //     siswa LAIN di kelas yang sama, atau status yang sudah
        //     diubah guru dari dashboard guru) -> dipakai apa adanya, server
        //     dianggap paling baru untuk status persetujuan.
        //   - Item yang ada di lokal tapi belum sempat ke server (mis.
        //     tadi sempat offline pas ajukanPrestasi) -> tetap dipertahankan
        //     & didorong ulang ke server supaya tidak hilang/ketinggalan.
        // Sama seperti gabungkanDataQuiz(), server menang untuk status siswa
        // LAIN, tapi item baru milik lokal yang belum ada di server tidak
        // pernah dibuang.
        async function sinkronkanPrestasiDenganServer() {
            try {
                const res = await fetch(`/api/prestasi/load?kelas=${encodeURIComponent(KELAS_AKTIF_SISWA)}`);
                const hasil = await res.json();
                if (!hasil || !hasil.success) return;

                const dariServer = Array.isArray(hasil.data) ? hasil.data : [];
                const dariLokal = getPrestasiData();

                const peta = new Map();
                dariServer.forEach(item => peta.set(item.id, item));
                let adaItemBaruDariLokal = false;
                dariLokal.forEach(item => {
                    if (!peta.has(item.id)) {
                        peta.set(item.id, item);
                        adaItemBaruDariLokal = true;
                    }
                });

                const gabungan = Array.from(peta.values());
                localStorage.setItem(KEY_PRESTASI_SISWA, JSON.stringify(gabungan));

                // Kalau ada item lokal yang belum sempat nyampe server
                // (offline/gagal sebelumnya), dorong ulang sekarang.
                if (adaItemBaruDariLokal) simpanPrestasiKeServer(gabungan);

                if (typeof renderKoleksiBorder === 'function') renderKoleksiBorder();
                if (typeof renderJourneyPrestasi === 'function') renderJourneyPrestasi();
            } catch (e) { /* offline -> tetap pakai data lokal yang ada */ }
        }

        /* ================= LEADERBOARD PRESTASI (di dalam kartu Journey Prestasi) =================
           Toggle antara "progress diri sendiri" (stat 3 kartu + grafik, sudah ada dari
           awal) dengan peringkat semua siswa berdasarkan jumlah/poin prestasi yang
           statusnya "disetujui". Sumbernya tetap getPrestasiData() (localStorage per
           kelas), TAPI localStorage ini sekarang rutin digabung dengan server lewat
           sinkronkanPrestasiDenganServer() (endpoint /api/prestasi/..., terpisah dari
           /api/quiz/... -- lihat catatan di app.py) -- jadi leaderboard ini sudah
           mencakup siswa sekelas dari perangkat/browser LAIN juga, tidak cuma akun
           dummy di browser yang sama. */
        let modeJourneyLeaderboard = false;

        function toggleJourneyLeaderboard() {
            modeJourneyLeaderboard = !modeJourneyLeaderboard;
            const viewDiri = document.getElementById('journey-view-diri');
            const viewLeaderboard = document.getElementById('journey-view-leaderboard');
            const teksTombol = document.getElementById('teks-toggle-journey-leaderboard');
            if (viewDiri) viewDiri.classList.toggle('hidden', modeJourneyLeaderboard);
            if (viewLeaderboard) viewLeaderboard.classList.toggle('hidden', !modeJourneyLeaderboard);
            if (teksTombol) teksTombol.innerText = modeJourneyLeaderboard ? 'Kembali ke Progress Saya' : 'Cek Leaderboard';
            if (modeJourneyLeaderboard) renderLeaderboardPrestasi();
        }

        // Border/foto siswa LAIN (bukan akun yang lagi aktif) dicari lewat daftar akun
        // dummy yang tersimpan di browser ini (getDaftarAkunDummy) -- sama seperti
        // "Panel Dummy Leaderboard" mensimulasikan banyak siswa berbagi 1 browser.
        // Kalau namanya tidak ketemu di akun dummy manapun, fallback ke border Pemula
        // + avatar inisial (pola sama seperti entri Leaderboard Quiz punya orang lain).
        function getBorderUntukIdSiswa(idSiswa) {
            const idTersimpan = localStorage.getItem(`border_terpakai_${idSiswa}`);
            const border = getSemuaBorder().find(b => b.id === idTersimpan);
            return border || DAFTAR_BORDER_STARTER[0];
        }

        function getFotoUntukIdSiswa(idSiswa, namaFallback) {
            return localStorage.getItem(`student_profile_photo_${idSiswa}`)
                || `https://ui-avatars.com/api/?name=${encodeURIComponent(namaFallback)}&background=e0e7ff&color=3730a3&size=120`;
        }

        // Bio siswa LAIN dibaca dengan pola key localStorage yang sama dengan
        // punya akun aktif (lihat keyStudentBio -> `student_bio_${ID_SISWA_AKTIF}`),
        // hanya beda idSiswa-nya. Dipakai di modal detail Leaderboard Prestasi.
        function getBioUntukIdSiswa(idSiswa) {
            return (localStorage.getItem(`student_bio_${idSiswa}`) || '').trim();
        }

        function getProfilSiswaUntukNama(nama) {
            if (nama === NAMA_SISWA_AKTIF) {
                const border = getBorderTerpakai();
                const efekNama = getEfekNamaClass(border);
                return {
                    foto: getFotoProfilAktifQuiz(),
                    borderFile: border.file,
                    title: border.rank || '🔰 Pemula',
                    efekNamaClass: efekNama,
                    titleBadgeClass: getTitleBadgeClass(efekNama),
                    badgeDevHtml: getBadgeDevHtml(border),
                    kelas: getKelasAktifQuiz(),
                    bio: getBioUntukIdSiswa(ID_SISWA_AKTIF)
                };
            }
            const dummy = getDaftarAkunDummy().find(p => p.nama.trim().toLowerCase() === nama.trim().toLowerCase());
            const idSiswa = dummy ? dummy.id : null;
            const border = idSiswa ? getBorderUntukIdSiswa(idSiswa) : DAFTAR_BORDER_STARTER[0];
            const efekNama = getEfekNamaClass(border);
            return {
                foto: idSiswa ? getFotoUntukIdSiswa(idSiswa, nama) : `https://ui-avatars.com/api/?name=${encodeURIComponent(nama)}&background=e0e7ff&color=3730a3&size=120`,
                borderFile: border.file,
                title: border.rank || '🔰 Pemula',
                efekNamaClass: efekNama,
                titleBadgeClass: getTitleBadgeClass(efekNama),
                badgeDevHtml: getBadgeDevHtml(border),
                kelas: dummy ? dummy.kelas : '-',
                bio: idSiswa ? getBioUntukIdSiswa(idSiswa) : ''
            };
        }

        // Kelompokkan semua prestasi berstatus "disetujui" per nama siswa, lalu urut
        // dari poin akumulasi tertinggi (poin sama -> jumlah prestasi terbanyak menang).
        // kodeKelas opsional ('X'/'XI'/'XII') -- kalau diisi, prestasi disaring dulu
        // ke rentang tahun ajaran kelas itu (pakai logika yg sama dengan Journey Prestasi
        // pribadi di ambilPrestasiUntukKelasJourney), supaya tab Kelas 10/11/12 di atas
        // ikut berlaku ke leaderboard-nya juga, bukan cuma ke grafik progress sendiri.
        function bangunLeaderboardPrestasi(kodeKelas) {
            let semua = getPrestasiData().filter(item => item.status === 'disetujui');
            const offset = OFFSET_TAHUN_KELAS_JOURNEY[kodeKelas];
            if (offset !== undefined) {
                const rentang = getRentangTahunAjaran(offset);
                semua = semua.filter(item => {
                    const ts = ambilTimestampPrestasi(item);
                    return ts !== null && ts >= rentang.mulai.getTime() && ts <= rentang.akhir.getTime();
                });
            }
            const map = {};
            semua.forEach(item => {
                const nama = item.namaSiswa || 'Tanpa Nama';
                if (!map[nama]) map[nama] = { nama, items: [], totalPoin: 0 };
                map[nama].items.push(item);
                map[nama].totalPoin += hitungPoinPrestasi(item);
            });
            return Object.values(map).sort((a, b) => b.totalPoin - a.totalPoin || b.items.length - a.items.length);
        }

        function renderLeaderboardPrestasi() {
            const container = document.getElementById('journey-leaderboard-list');
            const kosongState = document.getElementById('journey-leaderboard-kosong');
            if (!container || !kosongState) return;
            container.innerHTML = '';

            const daftar = bangunLeaderboardPrestasi(kelasAktifJourneyPrestasi);
            if (!daftar.length) {
                kosongState.classList.remove('hidden');
                return;
            }
            kosongState.classList.add('hidden');

            daftar.slice(0, 10).forEach((entri, i) => {
                const profil = getProfilSiswaUntukNama(entri.nama);
                const iniSayaSendiri = entri.nama === NAMA_SISWA_AKTIF;
                const kelasNamaClass = `text-xs font-bold truncate ${profil.efekNamaClass || 'text-slate-800'}`;

                const baris = document.createElement('div');
                baris.className = `flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${i < 3 ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'} ${iniSayaSendiri ? 'ring-1 ring-purple-300' : ''}`;
                baris.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        ${buatBadgeMedali(i + 1)}
                        <div class="profile-wrapper w-10 h-10 flex-shrink-0">
                            <img loading="lazy" decoding="async" src="${profil.foto}" class="user-avatar" alt="Avatar ${entri.nama}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(entri.nama)}&background=e0e7ff&color=3730a3&size=120'">
                            <img loading="lazy" decoding="async" src="${profil.borderFile}" class="user-border" alt="Border ${entri.nama}">
                        </div>
                        <div class="min-w-0">
                            <p class="${kelasNamaClass}">${entri.nama}${profil.badgeDevHtml ? ' ' + profil.badgeDevHtml : ''}${iniSayaSendiri ? ' <span class="text-purple-500">(Kamu)</span>' : ''}</p>
                            <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${profil.titleBadgeClass} truncate max-w-full">${profil.title}</span>
                            <p class="text-[10px] text-slate-400 truncate mt-0.5">Kelas ${profil.kelas} &middot; ${entri.items.length} prestasi</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        <span class="text-sm font-extrabold text-amber-600">${entri.totalPoin}</span>
                        <span class="text-[10px] text-slate-400 font-semibold">poin</span>
                    </div>
                `;
                baris.addEventListener('click', () => bukaDetailSiswaLeaderboard(entri.nama));
                container.appendChild(baris);
            });
        }

        // Klik salah satu siswa di leaderboard -> tampilkan kartu profilnya
        // (foto+border+efek nama+title) beserta semua prestasi yang dia upload &
        // sudah disetujui, lengkap dengan thumbnail bukti (klik buat perbesar lewat
        // modal zoom yang sama dipakai Riwayat Prestasi milik sendiri).
        function bukaDetailSiswaLeaderboard(nama) {
            const profil = getProfilSiswaUntukNama(nama);
            const iniSayaSendiri = nama === NAMA_SISWA_AKTIF;

            document.getElementById('detail-siswa-foto').src = profil.foto;
            document.getElementById('detail-siswa-border').src = profil.borderFile;
            document.getElementById('detail-siswa-nama').innerHTML = `<span class="${profil.efekNamaClass}">${nama}</span>${profil.badgeDevHtml ? ' ' + profil.badgeDevHtml : ''}${iniSayaSendiri ? ' <span class="text-purple-500 text-xs font-normal">(Kamu)</span>' : ''}`;
            const elTitle = document.getElementById('detail-siswa-title');
            elTitle.innerText = profil.title;
            elTitle.className = `inline-block mt-1 px-2.5 py-1 rounded-md text-[10px] font-bold ${profil.titleBadgeClass}`;
            document.getElementById('detail-siswa-kelas').innerText = `Kelas ${profil.kelas}`;

            // Bio hanya ditampilkan (di pojok kanan-bawah kartu profil) kalau
            // siswa yang bersangkutan memang sudah pernah mengisi bio-nya.
            const bioWrapper = document.getElementById('detail-siswa-bio-wrapper');
            const bioText = (profil.bio || '').trim();
            if (bioText) {
                document.getElementById('detail-siswa-bio').innerText = bioText;
                bioWrapper.classList.remove('hidden');
            } else {
                bioWrapper.classList.add('hidden');
            }

            const items = (bangunLeaderboardPrestasi(kelasAktifJourneyPrestasi).find(e => e.nama === nama) || { items: [] }).items
                .slice().sort((a, b) => (b.id || '').localeCompare(a.id || ''));
            const listContainer = document.getElementById('detail-siswa-list-prestasi');
            listContainer.innerHTML = '';
            if (!items.length) {
                listContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Belum ada prestasi yang disetujui.</p>`;
            } else {
                items.forEach((item, i) => {
                    const row = document.createElement('div');
                    // Efek fade-up-nya sengaja SAMA seperti kartu di Daftar Guru
                    // (lihat .guru-card-reveal) -- di sini pakai class terpisah
                    // (.prestasi-siswa-card-reveal) tapi CSS-nya identik, dan
                    // delay bertahap per baris dibuat dengan pola yang sama
                    // ((i % 9) * 70ms).
                    row.className = 'prestasi-siswa-card-reveal flex items-center gap-3 p-2.5 rounded-xl border border-slate-200/80';
                    row.style.transitionDelay = `${(i % 9) * 70}ms`;
                    row.innerHTML = `
                        <img loading="lazy" decoding="async" src="${item.foto}" title="Klik untuk perbesar" class="thumb-bukti-prestasi-leaderboard w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-slate-200 cursor-zoom-in" alt="Bukti ${item.judul}">
                        <div class="flex-1 min-w-0">
                            <p class="text-xs font-bold text-slate-900 truncate">${item.judul}</p>
                            <p class="text-[10px] text-slate-400 mt-0.5">${item.jenis === 'piala' ? 'Piala' : 'Sertifikat'} &middot; +${hitungPoinPrestasi(item)} poin</p>
                        </div>
                    `;
                    row.querySelector('.thumb-bukti-prestasi-leaderboard').addEventListener('click', () => bukaZoomFotoPrestasi(item.foto, item.judul));
                    listContainer.appendChild(row);
                });
                // Modal langsung terbuka penuh (bukan discroll seperti grid guru),
                // jadi reveal-nya dipicu langsung sesaat setelah baris ditempel ke
                // DOM -- bukan lewat IntersectionObserver seperti punya guru
                // (yang memang menunggu kartu masuk viewport saat discroll).
                requestAnimationFrame(() => {
                    listContainer.querySelectorAll('.prestasi-siswa-card-reveal').forEach(el => el.classList.add('revealed'));
                });
            }

            const modal = document.getElementById('modal-detail-siswa-leaderboard');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }

        function tutupModalDetailSiswaLeaderboard() {
            const modal = document.getElementById('modal-detail-siswa-leaderboard');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }

        // Jaga-jaga tambahan: kalau gambar border/avatar gagal dimuat (mis. file
        // asetnya belum ada di server), sembunyikan elemennya biar tidak ada ikon
        // "gambar rusak" + teks alt yang nyangkut di layar. Begitu ganti ke border
        // lain yang berhasil dimuat, visibility-nya dikembalikan lagi di sini —
        // sebelumnya TIDAK ADA logika pengembalian ini, jadi sekali ada satu
        // border yang gagal load, elemen border jadi tersembunyi selamanya
        // walau border sesudahnya sebenarnya valid ("dipakai" tapi kelihatannya
        // gak berubah di avatar).
        document.addEventListener('error', (e) => {
            const el = e.target;
            if (el && el.tagName === 'IMG' && (el.classList.contains('user-border') || el.classList.contains('user-avatar'))) {
                el.style.visibility = 'hidden';
            }
        }, true);
        document.addEventListener('load', (e) => {
            const el = e.target;
            if (el && el.tagName === 'IMG' && (el.classList.contains('user-border') || el.classList.contains('user-avatar'))) {
                el.style.visibility = '';
            }
        }, true);

        /* ================= ANIMASI BERHASIL KIRIM BUKTI PRESTASI ================= */
        let _timeoutSuksesPrestasi = null;

        function tampilkanSuksesPrestasi(pesan) {
            const modal = document.getElementById('modal-sukses-prestasi');
            const pesanEl = document.getElementById('pesan-sukses-prestasi');
            if (!modal) return;
            if (pesanEl) pesanEl.innerText = pesan || 'Bukti prestasi kamu sudah dikirim & menunggu konfirmasi guru.';

            // Restart animasi checkmark tiap kali modal dibuka lagi (kalau cuma
            // classList show, animasi CSS-nya tidak akan replay dari awal).
            modal.querySelectorAll('.checkmark-circle, .checkmark-check, .confetti-sukses').forEach(el => {
                el.style.animation = 'none';
                void el.offsetWidth; // paksa reflow
                el.style.animation = '';
            });

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';

            clearTimeout(_timeoutSuksesPrestasi);
            _timeoutSuksesPrestasi = setTimeout(tutupSuksesPrestasi, 3500);
        }

        function tutupSuksesPrestasi() {
            const modal = document.getElementById('modal-sukses-prestasi');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
            clearTimeout(_timeoutSuksesPrestasi);
        }

        /* ================= ANIMASI BERHASIL KIRIM SARAN/EVALUASI GURU ================= */
        let _timeoutSuksesSaranGuru = null;

        function tampilkanSuksesSaranGuru(pesan) {
            const modal = document.getElementById('modal-sukses-saran-guru');
            const pesanEl = document.getElementById('pesan-sukses-saran-guru');
            if (!modal) return;
            if (pesanEl) pesanEl.innerText = pesan || 'Saran & evaluasi kamu sudah dikirim ke guru.';

            // Restart animasi checkmark tiap kali modal dibuka lagi (kalau cuma
            // classList show, animasi CSS-nya tidak akan replay dari awal).
            modal.querySelectorAll('.checkmark-circle, .checkmark-check, .confetti-sukses').forEach(el => {
                el.style.animation = 'none';
                void el.offsetWidth; // paksa reflow
                el.style.animation = '';
            });

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';

            clearTimeout(_timeoutSuksesSaranGuru);
            _timeoutSuksesSaranGuru = setTimeout(tutupSuksesSaranGuru, 3500);
        }

        function tutupSuksesSaranGuru() {
            const modal = document.getElementById('modal-sukses-saran-guru');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
            clearTimeout(_timeoutSuksesSaranGuru);
        }

        /* ================= ANIMASI DITOLAK OTOMATIS (file bukti duplikat) ================= */
        let _timeoutGagalPrestasi = null;

        function tampilkanGagalPrestasi(pesan) {
            const modal = document.getElementById('modal-gagal-prestasi');
            const pesanEl = document.getElementById('pesan-gagal-prestasi');
            if (!modal) return;
            if (pesanEl) pesanEl.innerText = pesan || 'File ini terdeteksi duplikat dengan bukti yang sudah pernah diupload.';

            modal.querySelectorAll('.crossmark-circle, .crossmark-x1, .crossmark-x2').forEach(el => {
                el.style.animation = 'none';
                void el.offsetWidth; // paksa reflow supaya animasi replay dari awal
                el.style.animation = '';
            });

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';

            clearTimeout(_timeoutGagalPrestasi);
            _timeoutGagalPrestasi = setTimeout(tutupGagalPrestasi, 6000);
        }

        function tutupGagalPrestasi() {
            const modal = document.getElementById('modal-gagal-prestasi');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
            clearTimeout(_timeoutGagalPrestasi);
        }

        /* ================= EKSTRAKSI TEKS OTOMATIS (OCR) UNTUK VERIFIKASI FOTO PRESTASI =================
           Begitu siswa memilih file foto sertifikat/piala, foto langsung dibaca pakai
           Tesseract.js (OCR jalan di browser, gak perlu server) supaya teks yang ada di
           foto (nama lomba, nama siswa, tanggal, penyelenggara, dsb) ikut ke-ekstrak.
           Tujuannya BUKAN buat otomatis nolak/nerima, tapi buat BANTU VERIFIKASI:
           - siswa langsung lihat apa yang "terbaca" sistem dari fotonya (transparansi),
           - kalau teks yang kebaca kosong/sangat pendek, siswa diingetin fotonya mungkin
             buram/gelap SEBELUM sempat dikirim & ditolak guru gara-gara gak jelas,
           - teks hasil OCR ikut disimpan (field teksOCR) di data pengajuan, supaya nanti
             bisa dibaca juga di Dashboard Guru sebagai bahan cross-check tambahan.
           Kalau OCR gagal/library gagal dimuat (mis. jaringan bermasalah), fitur ini
           TIDAK memblokir pengiriman -- ekstraksi teks sifatnya pelengkap, bukan syarat. */
        let teksOCRFotoPrestasiTerkini = null;
        let ocrFotoPrestasiSedangProses = false;

        // Lazy-load Tesseract.js: script <script src> baru disisipkan ke <head>
        // pas fungsi ini dipanggil pertama kali (dari jalankanOCRFotoPrestasi()),
        // BUKAN otomatis pas halaman dibuka -- ini yang bikin dashboard jadi
        // jauh lebih ringan buat siswa yang nggak lagi ngajuin prestasi.
        // _janjiTesseract di-cache supaya kalau dipanggil berkali-kali (mis. ganti
        // foto beberapa kali) library cuma benar-benar di-download sekali saja.
        let _janjiTesseract = null;
        function muatTesseractJikaBelum() {
            if (typeof Tesseract !== 'undefined') return Promise.resolve();
            if (_janjiTesseract) return _janjiTesseract;
            _janjiTesseract = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                s.onload = () => resolve();
                s.onerror = () => { _janjiTesseract = null; reject(new Error('Gagal memuat library OCR')); };
                document.head.appendChild(s);
            });
            return _janjiTesseract;
        }

        function resetPanelOCRPrestasi() {
            teksOCRFotoPrestasiTerkini = null;
            ocrFotoPrestasiSedangProses = false;
            const panel = document.getElementById('panel-ocr-prestasi');
            if (panel) panel.classList.add('hidden');
            ['ocr-prestasi-loading', 'ocr-prestasi-hasil', 'ocr-prestasi-peringatan', 'ocr-prestasi-gagal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
        }

        async function jalankanOCRFotoPrestasi(file) {
            const panel = document.getElementById('panel-ocr-prestasi');
            const elLoading = document.getElementById('ocr-prestasi-loading');
            const elHasil = document.getElementById('ocr-prestasi-hasil');
            const elTeks = document.getElementById('ocr-prestasi-teks');
            const elPeringatan = document.getElementById('ocr-prestasi-peringatan');
            const elGagal = document.getElementById('ocr-prestasi-gagal');
            if (!panel) return;

            resetPanelOCRPrestasi();
            ocrFotoPrestasiSedangProses = true;
            panel.classList.remove('hidden');
            elLoading.classList.remove('hidden');

            try {
                // Baru fetch library-nya sekarang (kalau belum pernah), jadi
                // siswa yang nggak pernah nyentuh fitur prestasi nggak pernah
                // ikut download Tesseract.js sama sekali.
                await muatTesseractJikaBelum();
                if (typeof Tesseract === 'undefined') throw new Error('Library OCR belum termuat');

                // 'ind+eng' -- sertifikat/piala di Indonesia umumnya campuran teks
                // Bahasa Indonesia (nama lomba, penyelenggara) & istilah/angka Latin.
                const { data } = await Tesseract.recognize(file, 'ind+eng');
                const teksBersih = (data && data.text ? data.text : '').replace(/\s+/g, ' ').trim();
                teksOCRFotoPrestasiTerkini = teksBersih || null;

                elLoading.classList.add('hidden');
                if (teksBersih.length >= 8) {
                    elTeks.innerText = teksBersih;
                    elHasil.classList.remove('hidden');
                } else {
                    // Teks yang kebaca terlalu sedikit/kosong -- kemungkinan foto
                    // buram, gelap, kepotong, atau bukan foto sertifikat/piala.
                    elPeringatan.classList.remove('hidden');
                }
            } catch (e) {
                elLoading.classList.add('hidden');
                elGagal.classList.remove('hidden');
                teksOCRFotoPrestasiTerkini = null;
            } finally {
                ocrFotoPrestasiSedangProses = false;
            }
        }

        /* ================= VERIFIKASI ANTI-DUPLIKAT FILE BUKTI PRESTASI =================
           Metode: FileReader membaca isi file jadi string base64 (dataURL), lalu
           string base64 itu di-hash/checksum (bukan nama filenya) jadi satu
           "sidik jari" pendek. Kalau ada file lain -- siapapun pengupload-nya,
           kapanpun diupload -- yang isinya PERSIS SAMA, hash yang dihasilkan
           akan identik juga, walau nama file sudah diganti/di-rename sebelum
           diupload ulang. Ini BUKAN hash kriptografis (bukan buat keamanan),
           cuma buat mendeteksi kesamaan isi file secara cepat & tanpa library. */
        function hitungHashKontenFile(base64String) {
            let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
            for (let i = 0; i < base64String.length; i++) {
                const ch = base64String.charCodeAt(i);
                h1 = Math.imul(h1 ^ ch, 2654435761);
                h2 = Math.imul(h2 ^ ch, 1597334677);
            }
            h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
            h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
            return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
        }

        // HANYA dianggap duplikat yang diblok sistem kalau file identik ini sebelumnya
        // sudah pernah DISETUJUI (status 'disetujui'). Kalau pengajuan sebelumnya masih
        // menunggu konfirmasi, atau malah sudah ditolak guru, file yang sama tetap boleh
        // dikirim ulang -- sistem TIDAK memblokirnya, biar tetap diteruskan & dinilai guru.
        function cariPrestasiDisetujuiDenganHashSama(hash) {
            return getPrestasiData().find(p => p.hashFile === hash && p.status === 'disetujui');
        }

        /* ================= pHASH 64-BIT — DETEKSI KEMIRIPAN GAMBAR (BUKAN CUMA IDENTIK 100%) =================
           Beda dengan hitungHashKontenFile() di atas (checksum isi file -- cuma
           mendeteksi file yang PERSIS SAMA byte-nya), pHash di sini mendeteksi
           gambar yang MIRIP walau sudah di-resize, dikompres ulang, atau ganti
           format ringan (mis. sertifikat yang sama difoto ulang/screenshot ulang
           lalu diupload lagi). Kedua mekanisme ini SENGAJA berjalan BERSAMAAN,
           bukan saling menggantikan:
             - hitungHashKontenFile()  -> tangkap duplikat identik 100%
             - hitungPHashGambar()     -> tangkap duplikat "mirip" (similarity >= 80%)

           CATATAN KEAMANAN (WAJIB DIBACA): pHash & checksum yang dihitung di sini
           HANYA pemeriksaan awal di sisi BROWSER. localStorage dan kode JavaScript
           client bisa dimanipulasi siapa saja lewat DevTools, jadi nilai `phash`
           yang tersimpan/terkirim dari sini TIDAK BOLEH dianggap sumber kebenaran
           mutlak. Backend WAJIB menghitung ulang pHash & checksum dari file yang
           benar-benar diterima server sebelum benar-benar menyetujui/menyimpan
           prestasi secara permanen. */
        const UKURAN_PHASH = 32;      // gambar dinormalisasi ke 32x32 grayscale sebelum DCT
        const UKURAN_BLOK_DCT = 8;    // blok frekuensi rendah 8x8 -> 64 bit hash
        let _tabelKosinusDCT = null;

        function _bangunTabelKosinusDCT() {
            if (_tabelKosinusDCT) return _tabelKosinusDCT;
            const n = UKURAN_PHASH;
            const tabel = new Float64Array(n * n);
            for (let u = 0; u < n; u++) {
                for (let x = 0; x < n; x++) {
                    tabel[u * n + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
                }
            }
            _tabelKosinusDCT = tabel;
            return tabel;
        }

        // DCT-II 1 dimensi, dipakai 2x (baris lalu kolom) supaya total kompleksitas
        // cuma O(n^3) -- bukan O(n^4) kalau DCT 2D dihitung langsung -- tetap ringan
        // dijalankan di browser tanpa perlu library eksternal apa pun.
        function _dct1D(vektor, tabel, n) {
            const hasil = new Float64Array(n);
            for (let u = 0; u < n; u++) {
                let jumlah = 0;
                for (let x = 0; x < n; x++) {
                    jumlah += vektor[x] * tabel[u * n + x];
                }
                const cu = u === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
                hasil[u] = cu * jumlah;
            }
            return hasil;
        }

        function _dct2D(matriks, n) {
            const tabel = _bangunTabelKosinusDCT();
            const antara = [];
            for (let y = 0; y < n; y++) antara.push(_dct1D(matriks[y], tabel, n));
            const hasil = [];
            for (let x = 0; x < n; x++) hasil.push(new Float64Array(n));
            for (let x = 0; x < n; x++) {
                const kolom = new Float64Array(n);
                for (let y = 0; y < n; y++) kolom[y] = antara[y][x];
                const dctKolom = _dct1D(kolom, tabel, n);
                for (let y = 0; y < n; y++) hasil[y][x] = dctKolom[y];
            }
            return hasil;
        }

        // Muat File/Blob gambar jadi HTMLImageElement lewat object URL lokal
        // (bukan upload ke mana-mana, cuma dibaca browser sendiri) supaya bisa
        // di-`await` di alur upload.
        function _muatGambarDariFile(file) {
            return new Promise((resolve, reject) => {
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
                img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal membaca gambar')); };
                img.src = url;
            });
        }

        // Normalisasi gambar ke grayscale UKURAN_PHASH x UKURAN_PHASH. Resize atau
        // kompresi ulang ringan tetap menghasilkan hash yang sama/nyaris sama,
        // karena pHash cuma menyimpan komponen frekuensi RENDAH (bentuk/pola besar
        // gambar), bukan detail piksel presisi.
        function _gambarKeMatriksGrayscale(img, n) {
            const canvas = document.createElement('canvas');
            canvas.width = n;
            canvas.height = n;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, n, n);
            const data = ctx.getImageData(0, 0, n, n).data;
            const matriks = [];
            for (let y = 0; y < n; y++) {
                const baris = new Float64Array(n);
                for (let x = 0; x < n; x++) {
                    const i = (y * n + x) * 4;
                    // Luminance ITU-R BT.601 -- konversi RGB ke grayscale.
                    baris[x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                }
                matriks.push(baris);
            }
            return matriks;
        }

        // Cache pHash per file (kunci dari nama+ukuran+lastModified) supaya gambar
        // yang sama tidak dihitung ulang berkali-kali kalau user gagal kirim lalu
        // coba lagi tanpa ganti file (optimasi -- lihat poin 7 di instruksi fitur).
        const _cachePHash = new Map();

        async function hitungPHashGambar(file) {
            const kunciCache = `${file.name}_${file.size}_${file.lastModified}`;
            if (_cachePHash.has(kunciCache)) return _cachePHash.get(kunciCache);

            const img = await _muatGambarDariFile(file);
            const n = UKURAN_PHASH;
            const matriks = _gambarKeMatriksGrayscale(img, n);
            const dct = _dct2D(matriks, n);

            // Blok frekuensi rendah 8x8 pojok kiri-atas, TANPA koefisien DC di [0][0]
            // saat menghitung median (praktik umum pHash) -- supaya hash mewakili
            // pola/struktur gambar, bukan sekadar kecerahan rata-rata.
            const nilaiBlok = [];
            for (let y = 0; y < UKURAN_BLOK_DCT; y++) {
                for (let x = 0; x < UKURAN_BLOK_DCT; x++) {
                    if (y === 0 && x === 0) continue;
                    nilaiBlok.push(dct[y][x]);
                }
            }
            const terurut = [...nilaiBlok].sort((a, b) => a - b);
            const median = terurut[Math.floor(terurut.length / 2)];

            let bit = 0n;
            let indeks = 0n;
            for (let y = 0; y < UKURAN_BLOK_DCT; y++) {
                for (let x = 0; x < UKURAN_BLOK_DCT; x++) {
                    if (y === 0 && x === 0) continue;
                    const nyala = dct[y][x] > median ? 1n : 0n;
                    bit |= (nyala << indeks);
                    indeks += 1n;
                }
            }
            const hashHex = bit.toString(16).padStart(16, '0');
            _cachePHash.set(kunciCache, hashHex);
            return hashHex;
        }

        // Hamming distance antar dua pHash 64-bit (format hex string 16 karakter).
        function hammingDistancePHash(hashA, hashB) {
            try {
                const a = BigInt('0x' + hashA);
                const b = BigInt('0x' + hashB);
                let xorNya = a ^ b;
                let jarak = 0;
                while (xorNya > 0n) {
                    jarak += Number(xorNya & 1n);
                    xorNya >>= 1n;
                }
                return jarak;
            } catch (e) {
                return 64; // gagal parse -> anggap paling beda, jangan sampai salah blokir
            }
        }

        // similarity = 1 - (hammingDistance / 64), persis rumus di instruksi fitur.
        function similarityPHash(hashA, hashB) {
            return 1 - (hammingDistancePHash(hashA, hashB) / 64);
        }

        // Cari prestasi berstatus 'disetujui' dengan pHash paling mirip (similarity
        // >= ambangBatas) dibanding hash baru. Data prestasi LAMA yang belum punya
        // field `phash` (dibuat sebelum fitur ini ada) otomatis DILEWATI di sini --
        // tidak menyebabkan error ataupun ke-anggap "mirip" secara keliru.
        function cariPrestasiDisetujuiMiripPHash(hashBaru, ambangBatas) {
            let ditemukan = null;
            let similarityTertinggi = 0;
            for (const p of getPrestasiData()) {
                if (p.status !== 'disetujui' || !p.phash) continue;
                const sim = similarityPHash(hashBaru, p.phash);
                if (sim >= ambangBatas && sim > similarityTertinggi) {
                    similarityTertinggi = sim;
                    ditemukan = p;
                }
            }
            return ditemukan ? { item: ditemukan, similarity: similarityTertinggi } : null;
        }

        /* ================= WATERMARK DIGITAL TAK TERLIHAT (LSB) =================
           Menyisipkan identitas internal "PRESTASI|ID_SISWA|TIMESTAMP" ke bit PALING
           RENDAH (LSB) tiap channel R, G, B piksel gambar (alpha channel SENGAJA
           tidak disentuh sama sekali). Karena cuma bit terendah yang diubah, selisih
           nilai warna maksimum cuma ±1 dari 0-255 -- tidak terlihat mata manusia
           dalam kondisi normal. Hasil watermark disimpan sebagai PNG (lossless)
           supaya bit LSB-nya tidak rusak oleh kompresi JPEG.
           CATATAN KEAMANAN: ini watermark level klien untuk jejak internal/forensik
           ringan, BUKAN pengaman anti-pemalsuan yang absah secara hukum -- backend
           tetap wajib melakukan verifikasi ulang, bukan sekadar percaya begitu saja
           kalau browser "bilang" watermark berhasil disisipkan. */
        const MAGIC_WATERMARK_LSB = 'PRESTASI';

        function _teksKeBitLSB(teks) {
            let bit = '';
            for (let i = 0; i < teks.length; i++) {
                bit += teks.charCodeAt(i).toString(2).padStart(8, '0');
            }
            return bit;
        }

        function _bitKeTeksLSB(bit) {
            let teks = '';
            for (let i = 0; i + 8 <= bit.length; i += 8) {
                const kode = parseInt(bit.substr(i, 8), 2);
                if (!kode) break;
                teks += String.fromCharCode(kode);
            }
            return teks;
        }

        // Sisipkan payload ke LSB channel R,G,B canvas. 16 bit pertama menyimpan
        // PANJANG payload, supaya proses baca-ulang tahu persis kapan berhenti
        // tanpa perlu menandai/merusak bagian lain gambar.
        function sisipkanWatermarkLSB(canvas, idSiswa, timestamp) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const { width, height } = canvas;
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;

            const payload = `${MAGIC_WATERMARK_LSB}|${idSiswa}|${timestamp}`;
            const bitPayload = _teksKeBitLSB(payload);
            const panjangBit = bitPayload.length.toString(2).padStart(16, '0');
            const bitLengkap = panjangBit + bitPayload;

            const kapasitasBit = Math.floor((data.length / 4) * 3); // 3 channel (R,G,B) per piksel
            if (bitLengkap.length > kapasitasBit) {
                // Gambar terlalu kecil untuk menampung payload -- jangan sisipkan
                // apa pun daripada merusak sebagian data secara acak/terpotong.
                return { berhasil: false, alasan: 'Ukuran gambar terlalu kecil untuk watermark' };
            }

            let posisiBit = 0;
            for (let i = 0; i < data.length && posisiBit < bitLengkap.length; i += 4) {
                for (let kanal = 0; kanal < 3 && posisiBit < bitLengkap.length; kanal++) {
                    data[i + kanal] = (data[i + kanal] & 0xFE) | Number(bitLengkap[posisiBit]);
                    posisiBit++;
                }
                // data[i+3] = alpha -> SENGAJA tidak disentuh sama sekali.
            }

            ctx.putImageData(imgData, 0, 0);
            return { berhasil: true, magic: MAGIC_WATERMARK_LSB, idSiswa, timestamp };
        }

        // Baca kembali watermark dari canvas & validasi header MAGIC-nya. Dipakai
        // untuk self-check langsung setelah menyisipkan watermark (lihat
        // ajukanPrestasi()), dan bisa dipakai ulang nanti kalau perlu verifikasi
        // dari riwayat/dashboard guru.
        function verifikasiWatermarkLSB(canvas) {
            try {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                const { width, height } = canvas;
                const data = ctx.getImageData(0, 0, width, height).data;

                // Iterator kecil yang jalan lurus SEKALI SAJA lewat data piksel
                // (channel R->G->B, alpha dilewati), supaya baca 16 bit panjang
                // payload lalu lanjut baca isi payload dari posisi yang sama --
                // bukan mengulang scan dari awal gambar.
                let indeksData = 0, kanalSaatIni = 0;
                function bacaBitBerikutnya() {
                    while (indeksData < data.length) {
                        if (kanalSaatIni < 3) {
                            const bit = data[indeksData + kanalSaatIni] & 1;
                            kanalSaatIni++;
                            return bit;
                        }
                        kanalSaatIni = 0;
                        indeksData += 4;
                    }
                    return null;
                }

                let bitPanjang = '';
                for (let i = 0; i < 16; i++) {
                    const b = bacaBitBerikutnya();
                    if (b === null) return { valid: false };
                    bitPanjang += b;
                }
                const panjangPayload = parseInt(bitPanjang, 2);
                if (!Number.isFinite(panjangPayload) || panjangPayload <= 0 || panjangPayload > 4000) {
                    return { valid: false };
                }

                let bitPayload = '';
                for (let i = 0; i < panjangPayload; i++) {
                    const b = bacaBitBerikutnya();
                    if (b === null) return { valid: false };
                    bitPayload += b;
                }

                const payload = _bitKeTeksLSB(bitPayload);
                const bagian = payload.split('|');
                if (bagian[0] !== MAGIC_WATERMARK_LSB) return { valid: false };
                return { valid: true, magic: bagian[0], idSiswa: bagian[1] || null, timestamp: bagian[2] || null };
            } catch (e) {
                return { valid: false };
            }
        }


        /* ================= NOTIFIKASI STATUS PRESTASI (disetujui/ditolak guru) =================
           Beda dengan notif tugas ditarik (yang dikirim guru lewat key notif terpisah),
           status prestasi diubah LANGSUNG di objek prestasi itu sendiri oleh Dashboard
           Guru. Jadi di sini kita simpan snapshot status yang TERAKHIR DILIHAT siswa per
           id prestasi, lalu setiap kali data prestasi berubah (event 'storage', polling,
           tab aktif lagi) kita bandingkan: kalau status barusan berubah jadi 'disetujui'
           atau 'ditolak', munculkan toast bernama guru & pesan yang diwarnai hijau/merah. */
        const KEY_STATUS_PRESTASI_TERLIHAT = `status_prestasi_terlihat_${ID_SISWA_AKTIF}`;

        function getStatusPrestasiTerlihat() {
            try {
                const raw = localStorage.getItem(KEY_STATUS_PRESTASI_TERLIHAT);
                return raw ? JSON.parse(raw) : null; // null = belum pernah ada snapshot (baru pertama kali)
            } catch (e) {
                return null;
            }
        }

        function saveStatusPrestasiTerlihat(map) {
            localStorage.setItem(KEY_STATUS_PRESTASI_TERLIHAT, JSON.stringify(map));
        }

        function tampilkanToastStatusPrestasi(item) {
            const container = document.getElementById('notif-toast-container');
            if (!container) return;

            const disetujui = item.status === 'disetujui';
            const namaAdmin = item.adminPenyetuju || 'Guru/Admin';
            const pesanDefault = disetujui
                ? `Prestasi "${item.judul}" kamu telah disetujui. Selamat! 🎉`
                : `Prestasi "${item.judul}" kamu ditolak. Coba cek lagi & ajukan ulang, ya.`;
            const pesan = item.catatanAdmin ? item.catatanAdmin : pesanDefault;

            const warnaKelas = disetujui ? 'text-emerald-600' : 'text-rose-600';
            const iconWrapClass = disetujui ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
            const iconClass = disetujui ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark';
            const judulToast = disetujui ? 'Prestasi Disetujui!' : 'Prestasi Ditolak';

            const toastId = `toast-status-prestasi-${item.id}-${Date.now()}`;
            const toast = document.createElement('div');
            toast.className = 'notif-toast-ditarik' + (disetujui ? ' notif-toast-hijau' : '');
            toast.id = toastId;
            toast.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="w-9 h-9 rounded-lg ${iconWrapClass} flex items-center justify-center flex-shrink-0">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-extrabold text-slate-900 dark:text-slate-100">${judulToast}</p>
                        <p class="text-[11px] font-bold ${warnaKelas} mt-0.5"><i class="fa-solid fa-chalkboard-user mr-1"></i>${namaAdmin}</p>
                        <p class="text-[11px] ${warnaKelas} mt-1 leading-relaxed font-semibold">${pesan}</p>
                    </div>
                    <button onclick="document.getElementById('${toastId}')?.remove()" class="text-slate-300 hover:text-slate-500 flex-shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`;

            container.appendChild(toast);
            setTimeout(() => {
                const el = document.getElementById(toastId);
                if (!el) return;
                el.classList.add('notif-keluar');
                setTimeout(() => el.remove(), 300);
            }, 8000);
        }

        function cekNotifBaruStatusPrestasi() {
            const list = getPrestasiData();
            const sebelumnya = getStatusPrestasiTerlihat();
            const sekarang = {};
            list.forEach(item => { sekarang[item.id] = item.status; });

            // Baseline pertama kali (belum ada snapshot sama sekali): cuma simpan,
            // JANGAN munculkan toast, supaya prestasi lama yang sudah lebih dulu
            // disetujui/ditolak tidak ikut "muncul lagi" seolah baru terjadi.
            if (sebelumnya !== null) {
                list.forEach(item => {
                    const statusLama = sebelumnya[item.id];
                    const jadiFinal = (item.status === 'disetujui' || item.status === 'ditolak');
                    if (jadiFinal && statusLama !== undefined && statusLama !== item.status) {
                        tampilkanToastStatusPrestasi(item);
                    }
                });
            }
            saveStatusPrestasiTerlihat(sekarang);
        }

        /* ================= POPUP FOTO PROFIL (dari kartu sapaan Beranda) =================
           Diklik dari foto/avatar di kartu sapaan Beranda (HP). Ambil src
           langsung dari #greeting-card-avatar (bukan dari {{ foto_profil }}
           statis) supaya selalu ikut foto TERBARU kalau siswa baru saja
           ganti foto profil (elemen ini disinkronkan real-time oleh
           prosesFotoProfilBaru()). */
        function bukaPopupFotoProfil() {
            const sumberFoto = document.getElementById('greeting-card-avatar');
            const popup = document.getElementById('popup-foto-profil');
            const popupAvatar = document.getElementById('popup-foto-profil-avatar');
            if (!sumberFoto || !popup || !popupAvatar) return;

            popupAvatar.src = sumberFoto.src;
            popup.classList.remove('hidden');
            popup.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }

        function tutupPopupFotoProfil() {
            const popup = document.getElementById('popup-foto-profil');
            if (!popup) return;
            popup.classList.add('hidden');
            popup.classList.remove('flex');
            document.body.style.overflow = '';
        }

        /* ================= ZOOM FOTO BUKTI PRESTASI ================= */
        let _zoomFotoState = { scale: 1, x: 0, y: 0, dragging: false, mulaiX: 0, mulaiY: 0 };

        function bukaZoomFotoPrestasi(url, judul) {
            const modal = document.getElementById('modal-zoom-foto-prestasi');
            const img = document.getElementById('img-zoom-foto-prestasi');
            const labelJudul = document.getElementById('judul-zoom-foto-prestasi');
            if (!modal || !img) return;

            img.src = url;
            if (labelJudul) labelJudul.innerText = judul || '';
            _zoomFotoState = { scale: 1, x: 0, y: 0, dragging: false, mulaiX: 0, mulaiY: 0 };
            terapkanTransformZoomPrestasi();

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }

        function tutupZoomFotoPrestasi() {
            const modal = document.getElementById('modal-zoom-foto-prestasi');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }

        function terapkanTransformZoomPrestasi() {
            const img = document.getElementById('img-zoom-foto-prestasi');
            const label = document.getElementById('label-persen-zoom-prestasi');
            if (img) img.style.transform = `translate(${_zoomFotoState.x}px, ${_zoomFotoState.y}px) scale(${_zoomFotoState.scale})`;
            if (label) label.innerText = `${Math.round(_zoomFotoState.scale * 100)}%`;
        }

        function zoomFotoPrestasi(delta) {
            const skalaBaru = Math.min(4, Math.max(1, +(_zoomFotoState.scale + delta).toFixed(2)));
            _zoomFotoState.scale = skalaBaru;
            if (skalaBaru === 1) { _zoomFotoState.x = 0; _zoomFotoState.y = 0; } // balik ke 100% -> posisi tengah lagi
            terapkanTransformZoomPrestasi();
        }

        function resetZoomFotoPrestasi() {
            _zoomFotoState = { ..._zoomFotoState, scale: 1, x: 0, y: 0 };
            terapkanTransformZoomPrestasi();
        }

        // Scroll mouse / trackpad untuk zoom in-out saat kursor ada di atas foto.
        document.addEventListener('wheel', (e) => {
            const viewport = document.getElementById('viewport-zoom-foto-prestasi');
            const modal = document.getElementById('modal-zoom-foto-prestasi');
            if (!viewport || !modal || modal.classList.contains('hidden')) return;
            if (!e.target.closest('#viewport-zoom-foto-prestasi')) return;
            e.preventDefault();
            zoomFotoPrestasi(e.deltaY < 0 ? 0.2 : -0.2);
        }, { passive: false });

        // Klik-tahan-geser (mouse) & sentuh-geser (touchscreen HP) untuk menggeser
        // foto yang sudah di-zoom, plus dobel klik untuk reset cepat ke 100%.
        document.addEventListener('DOMContentLoaded', () => {
            const viewport = document.getElementById('viewport-zoom-foto-prestasi');
            if (!viewport) return;

            const mulaiGeser = (clientX, clientY) => {
                if (_zoomFotoState.scale <= 1) return;
                _zoomFotoState.dragging = true;
                _zoomFotoState.mulaiX = clientX - _zoomFotoState.x;
                _zoomFotoState.mulaiY = clientY - _zoomFotoState.y;
                viewport.classList.add('zoom-dragging');
                document.getElementById('img-zoom-foto-prestasi')?.classList.add('zoom-tanpa-transisi');
            };
            const prosesGeser = (clientX, clientY) => {
                if (!_zoomFotoState.dragging) return;
                _zoomFotoState.x = clientX - _zoomFotoState.mulaiX;
                _zoomFotoState.y = clientY - _zoomFotoState.mulaiY;
                terapkanTransformZoomPrestasi();
            };
            const akhiriGeser = () => {
                _zoomFotoState.dragging = false;
                viewport.classList.remove('zoom-dragging');
                document.getElementById('img-zoom-foto-prestasi')?.classList.remove('zoom-tanpa-transisi');
            };

            viewport.addEventListener('mousedown', (e) => mulaiGeser(e.clientX, e.clientY));
            window.addEventListener('mousemove', (e) => prosesGeser(e.clientX, e.clientY));
            window.addEventListener('mouseup', akhiriGeser);

            viewport.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) mulaiGeser(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            viewport.addEventListener('touchmove', (e) => {
                if (e.touches.length === 1) prosesGeser(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            viewport.addEventListener('touchend', akhiriGeser);

            viewport.addEventListener('dblclick', () => {
                _zoomFotoState.scale === 1 ? zoomFotoPrestasi(1) : resetZoomFotoPrestasi();
            });
        });

        function getJumlahPrestasiDisetujui() {
            return getPrestasiData().filter(p => p.status === 'disetujui').length;
        }

        // ================= KLAIM MANUAL BORDER (PRESTASI & QUIZ) =================
        // Poin cukup SAJA tidak lagi otomatis membuka border — begitu poin cukup,
        // kartu border cuma menampilkan ceklis syarat (hijau) dan tombol "Klaim
        // Border". Border baru benar-benar dimiliki setelah tombol itu diklik,
        // dan status klaimnya disimpan di sini (berlaku sama utk kategori
        // 'prestasi' maupun 'quiz' — admin tetap selalu terbuka tanpa klaim).
        function getBorderDiklaim() {
            try {
                const raw = localStorage.getItem(KEY_BORDER_DIKLAIM);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) {
                return [];
            }
        }

        function saveBorderDiklaim(arr) {
            localStorage.setItem(KEY_BORDER_DIKLAIM, JSON.stringify(arr));
        }

        function sudahKlaimBorder(borderId) {
            return getBorderDiklaim().includes(borderId);
        }

        // ===== SAKELAR SEMENTARA: sumber poin per-border, override dari kategori asalnya =====
        // Border pink ("prestasi_pink") kategorinya tetap 'prestasi' (supaya gampang
        // dikembalikan lagi nanti), TAPI syarat poinnya untuk SEMENTARA dites dari
        // POIN QUIZ (bukan poin sertifikat/piala) sesuai permintaan. Kalau nanti mau
        // dibalik ke poin prestasi, tinggal hapus baris 'prestasi_pink' di bawah ini.
        const OVERRIDE_SUMBER_POIN_BORDER = {
            prestasi_pink: 'quiz'
        };

        function sumberPoinBorder(border) {
            return OVERRIDE_SUMBER_POIN_BORDER[border.id] || border.kategori;
        }

        // Ambil poin siswa yang jadi acuan sebuah border, sesuai sumber poinnya
        // (bisa beda dari kategori asli border itu — lihat OVERRIDE_SUMBER_POIN_BORDER).
        // Border quiz yang tidak terikat 1 level spesifik (mis. border pink saat ini)
        // pakai totalPoin keseluruhan (akumulasi semua level), bukan totalPoinByLevel.
        //
        // BUG YANG DIPERBAIKI (infinite loop / "Maximum call stack size exceeded"):
        // fungsi ini dulu manggil getQuizData() -- padahal getQuizData() PUNYA
        // langkah self-heal (sinkronkanLeaderboardDenganPoinTerbaik) yang manggil
        // getBorderTerpakai() untuk snapshot border ke entri leaderboard. Kalau
        // siswa BELUM PERNAH pilih border manual (akun baru pertama kali main,
        // mis. Syam pas login pertama di browser/incognito baru), getBorderTerpakai()
        // jatuh ke getBorderTertinggiTerbuka() yang mengecek SEMUA border --
        // termasuk border "Kupu-kupu Prestasi" yang sumber poinnya di-override ke
        // 'quiz' (lihat OVERRIDE_SUMBER_POIN_BORDER) -- yang lewat sini lagi manggil
        // getQuizData() dari awal. Hasilnya muter balik ke diri sendiri terus-terusan
        // sampai stack overflow, PERSIS pas siswa baru saja selesai main quiz (saat
        // itulah bestByLevel > 0 sehingga self-heal ini aktif). Efeknya: skor SEMPAT
        // kesimpen ke localStorage, tapi tiap kali dicoba ditampilkan ulang
        // (renderMenuQuiz -> getQuizData) fungsi itu crash duluan sebelum sempat
        // update angka di layar -- kelihatan seperti "poin ga kecatat" padahal
        // sebenarnya kesimpen, cuma ga bisa ditampilkan. Akun yang SUDAH PERNAH
        // pilih/pakai border (mis. akun dev yang sering dipakai testing) tidak
        // kena ini karena getBorderTerpakai() sudah punya jalan pintas (border
        // tersimpan valid) sebelum sempat masuk ke getBorderTertinggiTerbuka().
        // Fix: baca poin quiz langsung dari localStorage (bacaMentahDataQuiz),
        // BUKAN lewat getQuizData() -- cukup buat baca angka poin, tidak perlu
        // ikut memicu self-heal border yang jadi sumber muter baliknya.
        function bacaMentahDataQuiz() {
            try {
                const raw = localStorage.getItem(KEY_QUIZ_DATA);
                return raw ? JSON.parse(raw) : { totalPoin: 0, totalPoinByLevel: { easy: 0, medium: 0, hard: 0 } };
            } catch (e) {
                return { totalPoin: 0, totalPoinByLevel: { easy: 0, medium: 0, hard: 0 } };
            }
        }

        function getPoinAcuanBorder(border) {
            const sumber = sumberPoinBorder(border);
            if (sumber === 'prestasi') return getTotalPoinPrestasiDisetujui();
            if (sumber === 'quiz') {
                const data = bacaMentahDataQuiz();
                if (border.level) return (data.totalPoinByLevel && data.totalPoinByLevel[border.level]) || 0;
                return data.totalPoin || 0;
            }
            return 0;
        }

        // Syarat poin border (prestasi ATAU quiz) terpenuhi, lepas dari sudah
        // diklaim atau belum.
        function poinCukupUntukBorder(border) {
            if (border.kategori === 'admin') return true;
            return getPoinAcuanBorder(border) >= border.minPoin;
        }

        // Dipertahankan sebagai alias supaya pemanggilan lama (khusus prestasi)
        // tetap konsisten & mudah dibaca di tempat yang memang spesifik prestasi.
        function poinPrestasiCukup(border) {
            return poinCukupUntukBorder(border);
        }

        function klaimBorder(borderId) {
            const border = getSemuaBorder().find(b => b.id === borderId);
            if (!border || border.kategori === 'admin' || border.kategori === 'khusus') return;
            if (!poinCukupUntukBorder(border) || sudahKlaimBorder(borderId)) return;

            const daftar = getBorderDiklaim();
            daftar.push(borderId);
            saveBorderDiklaim(daftar);

            renderKoleksiBorder();
            triggerDynamicIsland(`Border ${border.nama} berhasil diklaim!`);
        }

        // Nama lama dipertahankan sebagai alias (dipakai di kartu border prestasi).
        function klaimBorderPrestasi(borderId) {
            klaimBorder(borderId);
        }

        // ================= MODAL "BUKA BORDER" (popup pengajuan prestasi) =================
        // Dipicu dari tombol "Buka Border" di kartu border prestasi yang masih terkunci.
        // Modal cuma menampilkan konteks border yang dituju (nama, syarat) — pengajuan
        // yang dikirim tetap prestasi umum (tidak terikat ke satu border tertentu),
        // sama seperti form lama, supaya prestasi yang sama bisa menyumbang ke border
        // manapun yang syaratnya terpenuhi setelah disetujui.
        document.addEventListener('DOMContentLoaded', () => {
            const inputFotoPrestasi = document.getElementById('input-file-prestasi');
            if (!inputFotoPrestasi) return;
            inputFotoPrestasi.addEventListener('change', () => {
                const file = inputFotoPrestasi.files && inputFotoPrestasi.files[0];
                if (file) {
                    jalankanOCRFotoPrestasi(file);
                } else {
                    resetPanelOCRPrestasi();
                }
            });
        });

        function bukaModalBukaBorder(borderId) {
            const border = getSemuaBorder().find(b => b.id === borderId);
            if (!border) return;

            const elNama = document.getElementById('modal-buka-border-nama');
            const elPreview = document.getElementById('modal-buka-border-preview-img');
            const elSyarat = document.getElementById('modal-buka-border-syarat');
            if (elNama) elNama.innerText = border.nama;
            if (elPreview) elPreview.src = border.file;
            if (elSyarat) {
                const sisa = Math.max(0, border.minPoin - getPoinAcuanBorder(border));
                elSyarat.innerHTML = sumberPoinBorder(border) === 'prestasi'
                    ? `<i class="fa-solid fa-circle-info mr-1"></i>Butuh ${sisa} poin lagi dari sertifikat/piala yang disetujui &mdash; minimal 1 bukti prestasi (sertifikat atau piala, jenisnya boleh beragam) untuk membuka border ini.`
                    : `<i class="fa-solid fa-circle-info mr-1"></i>Butuh ${sisa} poin lagi dari akumulasi poin main quiz untuk membuka border ini.`;
            }

            document.getElementById('form-ajukan-prestasi').reset();
            document.getElementById('input-jenis-prestasi').value = 'sertifikat';
            const radioSertifikat = document.querySelector('input[name="pilihan-jenis-prestasi"][value="sertifikat"]');
            if (radioSertifikat) radioSertifikat.checked = true;
            resetPanelOCRPrestasi();
            // Jaga-jaga: pastikan status proses pHash/watermark & tombol kirim dari
            // sesi sebelumnya (kalau modal ditutup paksa di tengah proses submit)
            // sudah ke-reset lagi setiap kali modal ini dibuka.
            _sembunyikanStatusProsesPrestasi();
            const tombolKirimReset = document.querySelector('#form-ajukan-prestasi .btn-kirim-prestasi');
            if (tombolKirimReset) tombolKirimReset.disabled = false;

            const modal = document.getElementById('modal-buka-border-prestasi');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }

        function tutupModalBukaBorder() {
            const modal = document.getElementById('modal-buka-border-prestasi');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }

        // ================= INTI SISTEM BORDER: cek terbuka/terkunci berdasarkan POIN =================
        // Poin selalu dibaca ulang dari localStorage tiap kali fungsi ini dipanggil (bukan
        // disimpan di variabel), jadi begitu poin bertambah di localStorage (prestasi baru
        // disetujui, atau skor quiz baru), pemanggilan berikutnya otomatis "melihat" poin
        // yang sudah naik dan bisa langsung membuka tier berikutnya (🥉 -> 🥈 -> 🏆) tanpa
        // perlu logika tambahan apa pun di sini.
        function isBorderTerbuka(border) {
            // Border admin/dev HANYA untuk akun dev asli (lihat akunIniAdminDev()).
            // Akun siswa biasa (mis. syam) atau akun dummy manapun TIDAK PERNAH
            // memiliki border ini, walaupun sebelumnya sempat tersimpan di
            // localStorage (mis. dari akun dev yang pernah login di browser
            // yang sama).
            if (border.kategori === 'admin') return akunIniAdminDev();
            // Border "khusus" (mis. Kristal Imortal/IMO) sama sekali tidak lewat
            // jalur poin -- untuk sementara cuma terbuka utk akun dev asli
            // (Ahmad Fakhri Al Farisi) sampai ada mekanisme verifikasi IMO yang
            // sesungguhnya. Lihat komentar di DAFTAR_BORDER_KHUSUS.
            if (border.kategori === 'khusus') return akunIniAdminDev();
            // Border starter (minPoin 0, "Pemula") itu bawaan semua siswa sejak
            // awal — bukan pencapaian yang perlu diklaim, jadi tetap auto. Ini
            // SEKARANG cuma satu border (lihat DAFTAR_BORDER_STARTER), bukan
            // 3 tier per-level lagi seperti dulu.
            if (border.minPoin === 0) return true;
            // Prestasi maupun quiz: poin cukup saja belum cukup untuk "dimiliki" —
            // border baru resmi terbuka setelah siswa klik "Klaim Border" (lihat
            // klaimBorder()), jadi status klaim ikut disyaratkan di sini.
            return poinCukupUntukBorder(border) && sudahKlaimBorder(border.id);
        }

        function getSemuaBorder() {
            return [...DAFTAR_BORDER_ADMIN, ...DAFTAR_BORDER_KHUSUS, ...DAFTAR_BORDER_STARTER, ...DAFTAR_BORDER_QUIZ, ...DAFTAR_BORDER_PRESTASI];
        }

        function getBorderTertinggiTerbuka() {
            // Border kategori "admin" sekarang aman diikutkan di sini karena
            // isBorderTerbuka() sudah menggating-nya berdasarkan identitas asli
            // (akunIniAdminDev()) — untuk akun dev, admin memang tierRank
            // tertinggi (99) & otomatis ke-auto-equip. Untuk akun lain/dummy,
            // isBorderTerbuka(admin) selalu false jadi tidak pernah ikut
            // kandidat di sini.
            const terbuka = getSemuaBorder().filter(b => isBorderTerbuka(b));
            // Fallback terakhir kalau somehow tidak ada satupun border terbuka:
            // border starter (Pemula), bukan border tier quiz lagi seperti dulu
            // (dulu DAFTAR_BORDER_QUIZ[0] itu tier "Polos" yg minPoin 0; sekarang
            // tier pertama di DAFTAR_BORDER_QUIZ sudah butuh 100 poin).
            if (!terbuka.length) return DAFTAR_BORDER_STARTER[0];
            return terbuka.reduce((tertinggi, b) => (b.tierRank > tertinggi.tierRank ? b : tertinggi), terbuka[0]);
        }

        // Kalau siswa belum pernah pilih manual, atau pilihannya (aneh/lama)
        // ternyata belum/tidak terbuka, otomatis pakaikan border tertinggi
        // yang sudah dia buka — jadi border "naik sendiri" tiap naik rank
        // selama siswa belum pernah pilih border lain secara manual.
        function getBorderTerpakai() {
            const idTersimpan = localStorage.getItem(KEY_BORDER_TERPAKAI);
            const border = getSemuaBorder().find(b => b.id === idTersimpan);
            if (border && isBorderTerbuka(border)) return border;
            return getBorderTertinggiTerbuka();
        }

        function pakaiBorder(id) {
            const border = getSemuaBorder().find(b => b.id === id);
            if (!border || !isBorderTerbuka(border)) return;
            localStorage.setItem(KEY_BORDER_TERPAKAI, id);
            terapkanBorderKeAvatar();
            renderKoleksiBorder();
            triggerDynamicIsland(`Border ${border.nama} dipakai!`);

            // BUG YANG DIPERBAIKI: sebelumnya border yang dipakai cuma tersimpan
            // di localStorage (browser sendiri) -- makanya siswa LAIN yang lihat
            // lewat "Cari Teman" / Denah Kelas Guru selalu melihat border/efek
            // nama/title default ("🔰 Pemula"), padahal siswa ini sudah beneran
            // ganti border di perangkatnya sendiri. Sekarang begitu border
            // dipakai, id-nya juga dikirim & disimpan ke server (pola sama
            // persis seperti updateProfilePhoto() -> /api/profil/foto di atas)
            // supaya siswa lain melihat border yang BENERAN sedang dipakai.
            // Best-effort: kalau gagal (mis. offline), border tetap kepakai
            // normal di browser sendiri lewat localStorage.
            fetch('/api/profil/border', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            }).catch(e => console.error('Gagal menyimpan border aktif ke server:', e));
        }

        function terapkanBorderKeAvatar() {
            const border = getBorderTerpakai();
            document.querySelectorAll('.user-border').forEach(img => {
                img.style.visibility = ''; // reset dulu, biar border baru selalu dicoba tampil lagi
                img.src = border.file;
                img.alt = `Border_${border.nama}`;
            });
            terapkanEfekNamaHeader(border);
        }

        // ===== Sinkronisasi border aktif LINTAS PERANGKAT =====
        // AKAR MASALAH "efek nama beda antara laptop & HP": getBorderTerpakai()
        // di atas cuma baca localStorage -- yaitu penyimpanan KHUSUS PER
        // PERANGKAT/BROWSER. pakaiBorder() memang sudah mengirim border yang
        // dipilih ke server (POST /api/profil/border) supaya siswa LAIN bisa
        // lihat lewat "Cari Teman", tapi nilai itu tidak pernah ditarik BALIK
        // ke localStorage perangkat lain milik siswa yang sama -- jadi kalau
        // ganti border di laptop, localStorage HP tetap pakai nilai lama/
        // default-nya sendiri, dan efek nama pun ikut beda.
        //
        // Fix: begitu halaman dibuka di perangkat mana pun, tarik dulu border
        // aktif YANG SEBENARNYA dari server lewat endpoint yang sama dipakai
        // untuk melihat profil teman (/api/teman/profil/<username>), tapi
        // dipanggil ke username akun sendiri. Kalau hasilnya beda dari yang
        // tersimpan lokal, localStorage perangkat ini diperbarui dan avatar +
        // efek nama dirender ulang supaya benar-benar sinkron dengan
        // perangkat lain. Best-effort: kalau gagal (offline/endpoint tidak
        // mengizinkan lihat profil sendiri), diam-diam dilewati saja dan
        // border hasil localStorage lokal tetap dipakai seperti sebelumnya.
        async function sinkronkanBorderAktifDariServer() {
            if (!USERNAME_SISWA_ASLI) return;
            try {
                const res = await fetch(`/api/teman/profil/${encodeURIComponent(USERNAME_SISWA_ASLI)}`);
                const json = await res.json();
                const idBorderServer = json && json.success && json.profil ? json.profil.border : null;
                if (!idBorderServer) return;

                const borderServer = getSemuaBorder().find(b => b.id === idBorderServer);
                if (!borderServer || !isBorderTerbuka(borderServer)) return;

                if (idBorderServer !== localStorage.getItem(KEY_BORDER_TERPAKAI)) {
                    localStorage.setItem(KEY_BORDER_TERPAKAI, idBorderServer);
                    terapkanBorderKeAvatar();
                    renderKoleksiBorder();
                }
            } catch (e) {
                console.error('Gagal sinkron border aktif dari server:', e);
            }
        }

        // ===== Efek Nama & Badge (ikut tier border yang sedang dipakai) =====
        // Dipakai bareng oleh header profil, entri Leaderboard Quiz, dan toast
        // notif "ditikung" — supaya efek nama SELALU sinkron dengan border/title
        // yang sedang aktif, bukan cuma warna emas yang di-hardcode di header.
        function getEfekNamaClass(border) {
            if (!border) return '';
            if (border.kategori === 'admin') return 'efek-nama-admin';
            if (border.id === 'border_imortal') return 'efek-nama-imortal';
            if (border.id === 'prestasi_pink') return 'efek-nama-pink';
            if (border.tierRank >= 3) return 'efek-nama-permata';
            if (border.tierRank === 2) return 'efek-nama-emas';
            if (border.tierRank === 1) return 'efek-nama-perak';
            return '';
        }

        // Warna badge title (di bawah nama, mis. "👑 Queen", "🥈 Siswa Berbakat")
        // SELALU ngikutin efek nama/warna border yang lagi aktif — bukan gold
        // statis buat semua orang. Dipetakan 1:1 sama family warna efek nama
        // di atas, supaya title & border/nama-nya selalu senada.
        function getTitleBadgeClass(efekNamaClass) {
            switch (efekNamaClass) {
                case 'efek-nama-imortal':
                    return 'title-badge-imortal';
                case 'efek-nama-pink':
                    return 'title-badge-pink';
                case 'efek-nama-permata':
                    return 'title-badge-permata';
                case 'efek-nama-emas':
                case 'gold-name':
                    return 'title-badge-emas';
                case 'efek-nama-perak':
                    return 'title-badge-perak';
                case 'efek-nama-admin':
                    return 'title-badge-admin';
                default:
                    return 'title-badge-default';
            }
        }

        function getBadgeDevHtml(border) {
            if (border && border.kategori === 'admin') {
                return `<span class="badge-dev px-1 py-0.5 sm:px-2 text-[8px] sm:text-[10px] font-bold bg-amber-400 text-slate-900 rounded-md shadow-sm whitespace-nowrap flex-shrink-0"><i class="fa-solid fa-crown text-[7px] sm:text-[8px] mr-0.5"></i>DEV</span>`;
            }
            // Border pink (Kupu-kupu Prestasi) otomatis bawa title "Queen" —
            // sinkron dengan border yang lagi dipakai, sama seperti badge DEV,
            // jadi tiap siswa yang pakai border ini langsung dapat badge ini
            // di semua tempat (header, leaderboard, toast) tanpa setting manual.
            if (border && border.id === 'prestasi_pink') {
                return `<span class="badge-dev badge-queen px-1 py-0.5 sm:px-2 text-[8px] sm:text-[10px] font-bold rounded-md shadow-sm whitespace-nowrap flex-shrink-0"><i class="fa-solid fa-crown text-[7px] sm:text-[8px] mr-0.5"></i>Queen</span>`;
            }
            // Border khusus "Kristal Imortal" -- SEBELUMNYA belum ditangani sama
            // sekali di fungsi ini, jadi slot badge (header-user-badge-dev, plus
            // semua .badge-dev-siswa-efektif yang disinkronkan dari slot ini)
            // selalu kosong walau border-nya lagi aktif dipakai. Dipakein class
            // title-badge-imortal yang sama dgn badge title di ID card, biar
            // satu keluarga warna dgn efek nama & badge title lainnya.
            if (border && border.id === 'border_imortal') {
                // Ikon fa-gem generik diganti logo IMO asli (achivement_imortal.png)
                // supaya badge title "IMMORTAL" beneran pakai logo IMO, bukan cuma
                // ikon permata umum. onerror tetap jaga-jaga balik ke fa-gem kalau
                // asetnya gagal dimuat di perangkat siswa (mis. path belum ada).
                return `<span class="badge-dev px-1 py-0.5 sm:px-2 text-[8px] sm:text-[10px] font-bold rounded-md shadow-sm whitespace-nowrap flex-shrink-0 title-badge-imortal"><img src="../static/img/achivement_imortal.png" class="inline-block w-[9px] h-[9px] sm:w-[11px] sm:h-[11px] rounded-full object-cover align-middle mr-0.5 -mt-0.5" alt="" onerror="this.replaceWith(Object.assign(document.createElement('i'), {className: 'fa-solid fa-gem text-[7px] sm:text-[8px] mr-0.5'}))">IMMORTAL</span>`;
            }
            return '';
        }

        // Daftar semua kemungkinan class efek nama -- dipakai buat "bersih-bersih"
        // dulu sebelum pasang yang baru, supaya ganti border/tier tidak numpuk
        // class efek lama yang sudah tidak berlaku.
        const KELAS_EFEK_NAMA_SEMUA = ['efek-nama-admin', 'efek-nama-pink', 'efek-nama-permata', 'efek-nama-emas', 'efek-nama-perak', 'efek-nama-imortal'];

        function terapkanEfekNamaHeader(border) {
            const elNama = document.getElementById('header-user-nama-efek');
            const elBadge = document.getElementById('header-user-badge-dev');
            const kelasEfek = getEfekNamaClass(border);
            // "truncate max-w-full" sengaja dipertahankan (bukan ditimpa) supaya
            // nama tetap terpotong rapi & badge (DEV/Queen) tidak pernah maksa
            // header melebar ke kanan, walau efek nama/border-nya ganti-ganti.
            if (elNama) elNama.className = `truncate max-w-full ${kelasEfek}`.trim();
            if (elBadge) elBadge.innerHTML = getBadgeDevHtml(border);

            // Teks keterangan kelas ("Siswa • XII TKJ 3/TAV") di header desktop:
            // dikasih sentuhan gold khusus SAAT border Kristal Imortal yang
            // aktif, biar gak polos abu-abu mati lagi. Border lain tidak
            // disentuh (classList.toggle dgn kondisi, bukan className penuh,
            // supaya class layout aslinya -- hidden sm:block text-xs
            // text-slate-400 -- tidak ikut hilang).
            // Sebelumnya cuma nyasar ke #header-user-kelas (versi desktop) --
            // dua versi lain ("Siswa • XII TKJ 3/TAV" di kartu sapaan HP & tab
            // Profil HP) belum kesentuh sama sekali. Sekarang ketiganya sudah
            // ditandai class bareng "kelas-siswa-efektif" di HTML, jadi cukup
            // satu querySelectorAll supaya efeknya sinkron ke HP juga.
            document.querySelectorAll('.kelas-siswa-efektif').forEach(el => {
                el.classList.toggle('efek-subtitle-imortal', border && border.id === 'border_imortal');
            });

            // Sinkronkan efek nama yang sama ke SEMUA elemen lain yang nampilin
            // nama siswa (kartu sapaan HP, banner sapaan desktop, dan halaman
            // Profil HP) -- sebelumnya cuma elemen header desktop di atas yang
            // dapat class efeknya, jadi di HP nama selalu tampil polos walau
            // di laptop sudah bergaya emas/perak/dst. classList dipakai (bukan
            // timpa className) supaya class layout lain (font-bold, truncate,
            // text-slate-900, dst) di tiap elemen tidak ikut hilang.
            document.querySelectorAll('.nama-siswa-efektif').forEach(el => {
                if (el.id === 'header-user-nama-efek') return; // sudah ditangani di atas
                KELAS_EFEK_NAMA_SEMUA.forEach(kelas => el.classList.remove(kelas));
                if (kelasEfek) el.classList.add(kelasEfek);
            });

            // Sinkronkan juga badge DEV/Queen (khusus border admin & border pink)
            // ke kartu sapaan HP & tab Profil HP -- sebelumnya badge ini CUMA ada
            // di #header-user-badge-dev, dan elemen itu ada di dalam
            // #profile-menu-trigger yang class-nya "hidden sm:flex" (sengaja
            // disembunyikan total di layar HP, diganti kartu sapaan/tab Profil).
            // Akibatnya siswa admin yang login lewat HP tidak pernah lihat badge
            // DEV-nya sendiri sama sekali, padahal di laptop muncul normal.
            // Elemen slot baru (.badge-dev-siswa-efektif) ditambahkan di HTML
            // kartu sapaan HP & tab Profil HP supaya ada tempat menampungnya.
            const htmlBadge = getBadgeDevHtml(border);
            document.querySelectorAll('.badge-dev-siswa-efektif').forEach(el => {
                el.innerHTML = htmlBadge;
            });
        }

        // Keterangan singkat "cara dapetin" yang ditampilkan di bawah tiap kartu border,
        // dipakai baik untuk border yang sudah dimiliki (jadi tahu asalnya dari mana)
        // maupun yang belum dimiliki (jadi tahu syaratnya apa).
        function deskripsiSumberBorder(border) {
            if (border.kategori === 'admin') {
                return `<i class="fa-solid fa-crown mr-1"></i>Khusus Admin/Developer`;
            }
            if (border.kategori === 'khusus') {
                return `<i class="fa-solid fa-gem mr-1"></i>Khusus &middot; akun harus sudah pernah ikut IMO`;
            }
            if (border.kategori === 'starter') {
                return `<i class="fa-solid fa-seedling mr-1"></i>Bawaan semua siswa sejak pertama kali masuk`;
            }
            if (sumberPoinBorder(border) === 'prestasi') {
                return `<i class="fa-solid fa-trophy mr-1"></i>Prestasi &middot; min. 1 sertifikat/piala beragam (&asymp;${border.minPoin} poin)`;
            }
            const meta = LEVEL_META_BORDER[border.level];
            return meta
                ? `<i class="fa-solid fa-gamepad mr-1"></i>Quiz ${meta.label} &middot; min. ${border.minPoin} poin (akumulasi total poin main quiz level ini)`
                : `<i class="fa-solid fa-gamepad mr-1"></i>Quiz &middot; min. ${border.minPoin} poin (akumulasi total poin main quiz)`;
        }

        // Render satu kartu border (dipakai bareng oleh grid Sudah Dimiliki & Belum Dimiliki)
        function buatKartuBorder(border, dipakai) {
            const terbuka = isBorderTerbuka(border);
            const sedangDipakai = dipakai.id === border.id;

            // Begitu poin sudah cukup tapi belum diklaim, kartu tampil dalam mode
            // "siap klaim" — bukan lagi mode "kurang poin". Berlaku utk prestasi
            // MAUPUN quiz (admin & border tier dasar minPoin 0 selalu auto terbuka).
            const poinCukup = (border.kategori !== 'admin' && border.kategori !== 'khusus') ? poinCukupUntukBorder(border) : false;
            const siapDiklaim = border.kategori !== 'admin' && border.kategori !== 'khusus' && !terbuka && poinCukup;

            let labelKurang = '';
            if (!terbuka && !siapDiklaim) {
                if (border.kategori === 'khusus') {
                    // Bukan syarat poin -- teks tetap sekilas tanpa membongkar detail
                    // verifikasinya (lihat komentar di DAFTAR_BORDER_KHUSUS).
                    labelKurang = 'Khusus akun yang sudah pernah ikut IMO';
                } else {
                    const sisa = Math.max(0, border.minPoin - getPoinAcuanBorder(border));
                    labelKurang = sumberPoinBorder(border) === 'prestasi'
                        ? `Butuh ${sisa} poin lagi (sertifikat/piala beragam)`
                        : `Butuh ${sisa} poin lagi`;
                }
            }

            // Ceklis kecil syarat border (poin, & khusus prestasi: sertifikat) —
            // hanya tampil selagi border belum resmi dimiliki (masih perlu diklaim).
            let ceklisSyaratHtml = '';
            if (siapDiklaim) {
                const baris = (ok, teks) => `
                    <p class="flex items-center gap-1.5 ${ok ? 'text-emerald-600' : 'text-slate-400'}">
                        <i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle'} text-[10px]"></i>${teks}
                    </p>`;
                ceklisSyaratHtml = `
                    <div class="w-full text-[10px] font-semibold text-left mb-2.5 space-y-1">
                        ${baris(true, sumberPoinBorder(border) === 'prestasi' ? 'Poin mencukupi' : 'Poin quiz mencukupi')}
                        ${sumberPoinBorder(border) === 'prestasi' ? baris(true, 'Sertifikat/piala disetujui') : ''}
                    </div>`;
            }

            const card = document.createElement('div');
            card.className = `rounded-xl sm:rounded-2xl border p-2.5 sm:p-5 flex flex-col items-stretch text-center transition-all ${sedangDipakai ? 'border-amber-400 bg-amber-50/50 shadow-md' : (siapDiklaim ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white')} ${!terbuka ? 'opacity-70' : ''}`;

            card.innerHTML = `
                <div class="profile-wrapper w-12 h-12 sm:w-20 sm:h-20 mb-2 sm:mb-3 relative mx-auto">
                    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23000'/%3E%3C/svg%3E" class="user-avatar" alt="Preview Avatar">
                    <img loading="lazy" decoding="async" src="${border.file}" class="user-border ${!terbuka ? 'grayscale' : ''}" alt="Border_${border.nama}">
                    ${!terbuka ? `<div class="absolute inset-0 flex items-center justify-center ${siapDiklaim ? 'bg-emerald-600/30' : 'bg-slate-900/40'} rounded-full"><i class="fa-solid ${siapDiklaim ? 'fa-unlock' : 'fa-lock'} text-[10px] sm:text-lg text-white"></i></div>` : ''}
                </div>
                <h4 class="font-bold text-[11px] sm:text-sm text-slate-900 leading-tight">${border.nama}</h4>
                <p class="text-[9px] sm:text-[10px] text-slate-400 mt-0.5">${border.rank}</p>
                <p class="hidden sm:block text-[10px] ${terbuka ? 'text-emerald-600' : 'text-slate-400'} mb-3 leading-snug">${deskripsiSumberBorder(border)}</p>
                ${ceklisSyaratHtml}
                ${terbuka
                    ? `<button onclick="pakaiBorder('${border.id}')" ${sedangDipakai ? 'disabled' : ''} class="w-full mt-1.5 sm:mt-0 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-xs font-bold transition-all ${sedangDipakai ? 'bg-emerald-100 text-emerald-700 cursor-default' : 'bg-slate-800 hover:bg-slate-900 text-white'}">${sedangDipakai ? '<i class="fa-solid fa-check mr-1"></i>Dipakai' : 'Pakai Border'}</button>`
                    : (siapDiklaim
                        ? `<button onclick="klaimBorder('${border.id}')" class="w-full mt-1.5 sm:mt-0 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-all"><i class="fa-solid fa-award mr-1"></i>Klaim</button>`
                        : (sumberPoinBorder(border) === 'prestasi'
                            ? `<p class="hidden sm:block text-[10px] text-amber-600 font-semibold mb-2">${labelKurang}</p>
                               <button onclick="bukaModalBukaBorder('${border.id}')" class="w-full mt-1.5 sm:mt-0 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition-all"><i class="fa-solid fa-unlock mr-1"></i>Buka</button>`
                            : `<button disabled class="w-full mt-1.5 sm:mt-0 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-xs font-bold bg-slate-100 text-slate-400 cursor-not-allowed leading-tight"><i class="fa-solid fa-lock mr-1"></i><span class="hidden sm:inline">${labelKurang}</span><span class="sm:hidden">Terkunci</span></button>`))
                }
            `;
            return card;
        }

        // Grid "Sudah Dimiliki": gabungan border quiz & prestasi yang sudah terbuka,
        // ditampilkan bareng (tidak dipisah per kategori) sesuai urutan tier-nya.
        function renderKoleksiBorderDimiliki(dipakai) {
            const grid = document.getElementById('grid-border-dimiliki');
            const teksKosong = document.getElementById('teks-kosong-border-dimiliki');
            const badge = document.getElementById('badge-jumlah-border-dimiliki');
            if (!grid) return;

            const dimiliki = getSemuaBorder().filter(isBorderTerbuka);
            grid.innerHTML = '';
            dimiliki.forEach(border => grid.appendChild(buatKartuBorder(border, dipakai)));

            grid.classList.toggle('hidden', dimiliki.length === 0);
            if (teksKosong) teksKosong.classList.toggle('hidden', dimiliki.length > 0);
            if (badge) badge.innerText = `${dimiliki.length} border`;
        }

        // Grid "Belum Dimiliki": disembunyikan secara default, baru dirender &
        // ditampilkan saat tombol toggle diklik — isinya semua border terkunci
        // dari jalur Quiz maupun Prestasi sekaligus.
        function renderKoleksiBorderBelumDimiliki(dipakai) {
            const grid = document.getElementById('grid-border-belum-dimiliki');
            const teksToggle = document.getElementById('teks-toggle-border-belum');
            if (!grid) return;

            const belumDimiliki = getSemuaBorder().filter(b => !isBorderTerbuka(b));
            grid.innerHTML = '';
            belumDimiliki.forEach(border => grid.appendChild(buatKartuBorder(border, dipakai)));

            if (teksToggle) {
                const sedangTerbuka = !grid.classList.contains('hidden');
                teksToggle.innerText = sedangTerbuka
                    ? `Sembunyikan (${belumDimiliki.length})`
                    : `Tampilkan Semua (${belumDimiliki.length})`;
            }
        }

        function toggleBorderBelumDimiliki() {
            const grid = document.getElementById('grid-border-belum-dimiliki');
            const icon = document.getElementById('icon-toggle-border-belum');
            if (!grid) return;

            grid.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
            renderKoleksiBorderBelumDimiliki(getBorderTerpakai());
        }

        function labelStatusPrestasi(status) {
            if (status === 'disetujui') return { teks: 'Disetujui', kelas: 'bg-emerald-100 text-emerald-700' };
            if (status === 'ditolak') return { teks: 'Ditolak', kelas: 'bg-rose-100 text-rose-700' };
            return { teks: 'Menunggu Konfirmasi', kelas: 'bg-amber-100 text-amber-700' };
        }

        function renderRiwayatPrestasi() {
            const container = document.getElementById('list-riwayat-prestasi');
            if (!container) return;
            // id diawali "prestasi_" + Date.now(), jadi urutan string == urutan waktu.
            const list = getPrestasiData().slice().sort((a, b) => (b.id || '').localeCompare(a.id || ''));

            if (!list.length) {
                container.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">Belum ada prestasi yang diajukan. Upload sertifikat/piala pertamamu di atas!</p>`;
                return;
            }

            container.innerHTML = '';
            list.forEach(item => {
                const status = labelStatusPrestasi(item.status);

                let ketAdmin = '';
                if (item.status === 'disetujui') {
                    ketAdmin = `<p class="text-[11px] text-emerald-600 font-semibold mt-1"><i class="fa-solid fa-user-shield mr-1"></i>Dikonfirmasi oleh ${item.adminPenyetuju || 'Admin'} &middot; ${item.tanggalKonfirmasi || ''}</p>`;
                } else if (item.status === 'ditolak') {
                    ketAdmin = `<p class="text-[11px] text-rose-600 font-semibold mt-1"><i class="fa-solid fa-user-shield mr-1"></i>Ditolak oleh ${item.adminPenyetuju || 'Admin'}${item.catatanAdmin ? ' &middot; ' + item.catatanAdmin : ''}</p>`;
                } else if (item.pembatalanTerakhir) {
                    const statusSebelum = item.pembatalanTerakhir.statusSebelum === 'disetujui' ? 'disetujui' : 'ditolak';
                    ketAdmin = `<p class="text-[11px] text-orange-500 font-semibold mt-1"><i class="fa-solid fa-rotate-left mr-1"></i>Sebelumnya ${statusSebelum}, dibatalkan oleh ${item.pembatalanTerakhir.oleh} &middot; ${item.pembatalanTerakhir.tanggal} — sedang ditinjau ulang</p>`;
                }

                // Baris "sidik jari" pHash (biner, dipotong) + badge "Terverifikasi LSB".
                // Cuma ditampilkan kalau item ini punya `phash` (data lama dari sebelum
                // fitur ini ada -- yang tidak punya field ini -- otomatis dilewati/tidak
                // menampilkan baris ini sama sekali, tidak menyebabkan error).
                const idAmanDom = String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');
                const barisFingerprint = item.phash ? `
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="font-mono text-[10px] text-slate-400 tracking-wide" id="phash-bin-${idAmanDom}">&hellip;</span>
                        <span class="hidden text-[10px] font-bold text-indigo-500 items-center gap-1" id="lsb-badge-${idAmanDom}">
                            <i class="fa-solid fa-shield-halved"></i> Terverifikasi LSB
                        </span>
                    </div>` : '';

                const row = document.createElement('div');
                row.className = 'flex gap-3 p-3.5 sm:p-4 rounded-xl border border-slate-200/80';
                row.innerHTML = `
                    <img loading="lazy" decoding="async" src="${item.foto}" title="Klik untuk perbesar" class="thumb-bukti-prestasi w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover flex-shrink-0 border border-slate-200" alt="Bukti ${item.judul}">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 flex-shrink-0">
                                <i class="fa-solid ${item.jenis === 'piala' ? 'fa-trophy' : 'fa-file-lines'}"></i> ${item.jenis === 'piala' ? 'Piala' : 'Sertifikat'}
                            </span>
                            <div class="flex items-center gap-1.5 flex-shrink-0">
                                <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${status.kelas}">${status.teks}</span>
                                <button type="button" title="Hapus pengajuan ini" class="btn-hapus-prestasi text-slate-300 hover:text-rose-500 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-rose-50 transition-all">
                                    <i class="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <p class="text-sm sm:text-base font-bold text-slate-900 leading-snug">${item.judul}</p>
                        <p class="text-[11px] text-slate-400 mt-0.5">Diajukan pada ${item.tanggalAjukan}</p>
                        ${ketAdmin}
                        ${barisFingerprint}
                    </div>
                `;
                // Pakai addEventListener + closure (bukan atribut onclick) supaya foto
                // base64 yang bisa panjang tidak perlu diduplikasi lagi ke dalam HTML string.
                const imgThumb = row.querySelector('.thumb-bukti-prestasi');
                if (imgThumb) {
                    imgThumb.addEventListener('click', () => bukaZoomFotoPrestasi(item.foto, item.judul));
                }
                const btnHapus = row.querySelector('.btn-hapus-prestasi');
                if (btnHapus) {
                    btnHapus.addEventListener('click', () => hapusPengajuanPrestasi(item.id));
                }
                container.appendChild(row);

                if (item.phash) {
                    tampilkanFingerprintPrestasi(item, idAmanDom);
                }
            });
        }

        // Cache hasil verifikasi ulang watermark LSB per id prestasi, supaya foto
        // (bisa besar) tidak perlu di-decode ulang ke canvas setiap kali daftar
        // riwayat dirender ulang (mis. abis hapus 1 item, seluruh list re-render).
        const _cacheVerifikasiLSB = new Map();

        // Tampilkan pHash dalam bentuk biner (dipotong) di baris riwayat, LALU
        // verifikasi ULANG watermark LSB langsung dari gambar yang tersimpan
        // (bukan cuma percaya begitu saja flag `watermark.tersisip` yang disimpan
        // saat upload) -- baru munculkan badge "Terverifikasi LSB" kalau memang
        // valid. Ini konsisten dengan prinsip di fitur ini: nilai dari client
        // tidak dianggap sumber kebenaran mutlak tanpa dicek ulang.
        async function tampilkanFingerprintPrestasi(item, idAmanDom) {
            const elBin = document.getElementById(`phash-bin-${idAmanDom}`);
            if (elBin) {
                // Hex 64-bit -> biner 64-bit, dipotong biar muat di 1 baris.
                const biner = BigInt('0x' + item.phash).toString(2).padStart(64, '0');
                elBin.innerText = biner.slice(0, 28) + '\u2026';
                elBin.title = biner; // hash biner lengkap kalau di-hover
            }

            const elBadge = document.getElementById(`lsb-badge-${idAmanDom}`);
            if (!elBadge || !item.watermark || !item.watermark.tersisip) return;

            try {
                let hasil = _cacheVerifikasiLSB.get(item.id);
                if (!hasil) {
                    const img = await _muatGambarDariDataUrl(item.foto);
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    hasil = verifikasiWatermarkLSB(canvas);
                    _cacheVerifikasiLSB.set(item.id, hasil);
                }
                if (hasil && hasil.valid) {
                    elBadge.classList.remove('hidden');
                    elBadge.classList.add('inline-flex');
                }
            } catch (e) {
                // Gagal verifikasi (mis. foto sudah dikompres ulang di tempat lain
                // sehingga bit LSB rusak) -- badge cukup TIDAK dimunculkan, tanpa
                // mengganggu render riwayat lainnya.
            }
        }

        // Sama seperti _muatGambarDariFile(), tapi sumbernya string data: URL
        // (base64) yang sudah tersimpan -- dipakai buat verifikasi ulang watermark
        // dari foto yang sudah ada di riwayat, bukan dari File input baru.
        function _muatGambarDariDataUrl(dataUrl) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Gagal membaca gambar tersimpan'));
                img.src = dataUrl;
            });
        }

        // Hapus satu pengajuan prestasi dari Riwayat (dipicu tombol ikon tempat sampah).
        // Kalau prestasi itu statusnya sudah 'disetujui', poin & border yang bergantung
        // padanya ikut dihitung ulang otomatis lewat renderKoleksiBorder() di akhir --
        // makanya user diberi peringatan tambahan sebelum konfirmasi.
        function hapusPengajuanPrestasi(id) {
            const list = getPrestasiData();
            const item = list.find(x => x.id === id);
            if (!item) return;

            let pesan = `Yakin mau hapus pengajuan "${item.judul}" dari riwayat? Tindakan ini tidak bisa dibatalkan.`;
            if (item.status === 'disetujui') {
                pesan += ' Prestasi ini statusnya sudah DISETUJUI -- menghapusnya bisa mengurangi poin akumulasi & menutup border yang terbuka karenanya.';
            }
            if (!confirm(pesan)) return;

            savePrestasiData(list.filter(x => x.id !== id));

            // Bersihkan juga snapshot status supaya id yang sudah dihapus gak nyangkut
            // di KEY_STATUS_PRESTASI_TERLIHAT (mencegah toast notif "nyasar" nanti).
            const snapshot = getStatusPrestasiTerlihat() || {};
            delete snapshot[id];
            saveStatusPrestasiTerlihat(snapshot);

            renderKoleksiBorder();
        }

        function _tampilkanStatusProsesPrestasi(teks) {
            const el = document.getElementById('status-proses-prestasi');
            const elTeks = document.getElementById('teks-status-proses-prestasi');
            if (elTeks) elTeks.innerText = teks;
            if (el) el.classList.remove('hidden');
        }

        function _sembunyikanStatusProsesPrestasi() {
            const el = document.getElementById('status-proses-prestasi');
            if (el) el.classList.add('hidden');
        }

        // ================= ALUR UPLOAD PRESTASI (versi async) =================
        // Urutan: pilih gambar -> validasi file -> hitung pHash -> bandingkan dgn
        // prestasi 'disetujui' -> similarity >= 80% => TOLAK -> kalau aman, buat
        // watermark LSB -> simpan hasil PNG -> hitung checksum -> simpan metadata
        // phash + watermark -> lanjut proses upload existing (localStorage + sync
        // server). Checksum exact-match existing (hitungHashKontenFile) TETAP
        // dijalankan lebih dulu & tidak diubah -- pHash cuma menambah, bukan
        // menggantikan mekanisme itu.
        async function ajukanPrestasi(event) {
            event.preventDefault();
            const judul = document.getElementById('input-judul-prestasi').value.trim();
            const jenis = document.getElementById('input-jenis-prestasi').value;
            const keterangan = document.getElementById('input-keterangan-prestasi').value.trim();
            const fileInput = document.getElementById('input-file-prestasi');
            const file = fileInput.files && fileInput.files[0];
            if (!judul || !file) return;

            const tombolKirim = document.querySelector('#form-ajukan-prestasi .btn-kirim-prestasi');
            if (tombolKirim) tombolKirim.disabled = true;

            try {
                // ===== Baca isi file asli (dipakai buat checksum exact-duplicate,
                // mekanisme lama -- TIDAK DIUBAH) =====
                const base64File = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('Gagal membaca file'));
                    reader.readAsDataURL(file);
                });

                // ===== VERIFIKASI ANTI-DUPLIKAT (checksum isi file, identik 100%) =====
                // Hash dihitung dari ISI file (base64 hasil FileReader), BUKAN dari
                // nama filenya -- jadi kalau file yang SAMA PERSIS diupload lagi
                // walau sudah di-rename, hash yang dihasilkan tetap identik &
                // otomatis kedetek + ditolak sebelum sempat tersimpan.
                const hashFileBaru = hitungHashKontenFile(base64File);
                // HANYA diblok kalau file identik ini sebelumnya sudah pernah DISETUJUI.
                // Kalau sebelumnya masih menunggu/ditolak, boleh dikirim ulang tanpa diblok.
                const duplikatDisetujui = cariPrestasiDisetujuiDenganHashSama(hashFileBaru);

                if (duplikatDisetujui) {
                    const keteranganPemilik = duplikatDisetujui.namaSiswa === NAMA_PEMAIN_QUIZ
                        ? `bukti "${duplikatDisetujui.judul}" yang sudah DISETUJUI sebelumnya`
                        : `bukti milik siswa lain yang sudah DISETUJUI sebelumnya`;
                    tampilkanGagalPrestasi(`File ini terdeteksi SAMA PERSIS dengan ${keteranganPemilik} (walau nama file sudah diganti). Silakan upload foto bukti yang benar-benar berbeda.`);
                    fileInput.value = '';
                    return;
                }

                // ===== pHASH: deteksi KEMIRIPAN (bukan cuma identik 100%) =====
                _tampilkanStatusProsesPrestasi('Memeriksa keaslian dan kemiripan gambar\u2026');
                let phashBaru = null;
                try {
                    phashBaru = await hitungPHashGambar(file);
                } catch (e) {
                    // Gagal hitung pHash (mis. format gambar tak didukung canvas) --
                    // jangan blokir upload karenanya, checksum exact-match di atas
                    // tetap jadi pengaman utama untuk kasus ini.
                    phashBaru = null;
                }

                if (phashBaru) {
                    const mirip = cariPrestasiDisetujuiMiripPHash(phashBaru, 0.8);
                    if (mirip) {
                        const persen = Math.round(mirip.similarity * 100);
                        tampilkanGagalPrestasi(`Upload ditolak: gambar terdeteksi sebagai duplikat dengan tingkat kemiripan ${persen}%.`);
                        fileInput.value = '';
                        return;
                    }
                }

                // ===== WATERMARK LSB (hanya kalau lolos semua pemeriksaan di atas) =====
                _tampilkanStatusProsesPrestasi('Menyisipkan tanda keaslian ke gambar\u2026');
                const timestampWatermark = Date.now();
                let base64Final = base64File;
                let infoWatermark = null;
                try {
                    const img = await _muatGambarDariFile(file);
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    canvas.getContext('2d').drawImage(img, 0, 0);

                    const hasilSisip = sisipkanWatermarkLSB(canvas, ID_SISWA_AKTIF, timestampWatermark);
                    if (hasilSisip.berhasil) {
                        // PNG dipakai (bukan JPEG) supaya kompresi tidak merusak bit LSB.
                        base64Final = canvas.toDataURL('image/png');
                        infoWatermark = {
                            tersisip: true,
                            idSiswa: ID_SISWA_AKTIF,
                            timestamp: timestampWatermark
                        };
                    } else {
                        infoWatermark = { tersisip: false, alasan: hasilSisip.alasan };
                    }
                } catch (e) {
                    // Watermark gagal disisipkan (mis. gambar rusak / tidak didukung
                    // Canvas) -- upload TETAP lanjut pakai file asli, watermark
                    // bukan syarat mutlak supaya siswa tidak terhambat kirim bukti.
                    infoWatermark = { tersisip: false, alasan: 'Gagal memproses watermark' };
                }

                const now = new Date();
                const bulanSingkat = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
                const tanggalAjukan = now.getDate() + ' ' + bulanSingkat[now.getMonth()] + ' ' + now.getFullYear() + ', ' +
                                       String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' WIB';

                // checksum PNG hasil watermark -- disimpan sebagai info tambahan saja
                // (BUKAN dipakai utk blokir exact-duplicate, karena tiap PNG watermark
                // pasti unik gara-gara timestamp yang disisipkan; blokir exact-duplicate
                // tetap pakai hashFileBaru dari file ASLI di atas).
                const checksumWatermark = hitungHashKontenFile(base64Final);

                // Skema field di sini SAMA dengan yang dibaca Dashboard Guru
                // (judul, jenis, keterangan, foto, namaSiswa, status, tanggalAjukan)
                // supaya pengajuan ini langsung muncul & bisa dikonfirmasi di sana.
                const list = getPrestasiData();
                list.push({
                    id: `prestasi_${Date.now()}`,
                    judul,
                    jenis,
                    keterangan: keterangan || null,
                    foto: base64Final,
                    hashFile: hashFileBaru,
                    // pHash 64-bit (hex) dari gambar ASLI (belum diberi watermark) --
                    // dipakai cariPrestasiDisetujuiMiripPHash() utk cek upload berikutnya.
                    // Data prestasi LAMA yang belum punya field ini otomatis dilewati
                    // saat dibandingkan (lihat cariPrestasiDisetujuiMiripPHash), jadi
                    // TIDAK menyebabkan error di data lama.
                    phash: phashBaru,
                    watermark: infoWatermark,
                    checksumWatermark,
                    // Teks hasil Ekstraksi Teks Otomatis (OCR) dari foto -- bahan
                    // cross-check tambahan buat guru saat menilai (mis. kalau nama
                    // lomba yang diketik siswa gak nyambung sama teks di foto).
                    // Bisa null kalau OCR gagal/belum sempat selesai saat submit.
                    teksOCR: teksOCRFotoPrestasiTerkini,
                    namaSiswa: NAMA_PEMAIN_QUIZ,
                    tanggalAjukan,
                    status: 'menunggu'
                });
                savePrestasiData(list);
                // Baseline status prestasi ini langsung disimpan sebagai 'menunggu'
                // supaya nanti saat guru approve/tolak, perubahan statusnya kebaca
                // sebagai perubahan baru dan toast notifikasinya muncul.
                const snapshotStatus = getStatusPrestasiTerlihat() || {};
                snapshotStatus[list[list.length - 1].id] = 'menunggu';
                saveStatusPrestasiTerlihat(snapshotStatus);

                document.getElementById('form-ajukan-prestasi').reset();
                resetPanelOCRPrestasi();
                tutupModalBukaBorder();
                renderKoleksiBorder();
                tampilkanSuksesPrestasi(`Bukti "${judul}" berhasil dikirim dan sedang menunggu konfirmasi dari guru/admin.`);
            } catch (e) {
                tampilkanGagalPrestasi('Terjadi kesalahan saat memproses file. Silakan coba lagi.');
            } finally {
                _sembunyikanStatusProsesPrestasi();
                if (tombolKirim) tombolKirim.disabled = false;
            }
        }

        function renderKoleksiBorder() {
            const dipakai = getBorderTerpakai();

            const elDipakai = document.getElementById('border-terpakai-display');
            if (elDipakai) elDipakai.innerText = dipakai.nama;

            // Gambar+alt border di avatar (semua tempat, bukan cuma satu elemen)
            // sudah ditangani lengkap & benar oleh terapkanBorderKeAvatar(), jadi
            // dipanggil ulang di sini supaya avatar ikut ter-refresh tiap kali
            // koleksi border dirender (mis. setelah prestasi baru disetujui).
            terapkanBorderKeAvatar();

             const elJumlahPrestasi = document.getElementById('border-jumlah-prestasi-display');
             if (elJumlahPrestasi) elJumlahPrestasi.innerText = String(getJumlahPrestasiDisetujui());

            renderKoleksiBorderDimiliki(dipakai);
            renderKoleksiBorderBelumDimiliki(dipakai);
            renderRiwayatPrestasi();
            renderJourneyPrestasi();
        }
