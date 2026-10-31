        /* ---------- Layar transisi masuk dashboard (gelap -> terang) ---------- */
        (function () {
            var layarMasuk = document.getElementById('layar-masuk-dashboard');
            if (!layarMasuk) return;
            function sembunyikanLayarMasuk() {
                layarMasuk.classList.add('selesai');
                setTimeout(function () { layarMasuk.style.display = 'none'; }, 650);
            }
            if (document.readyState === 'complete') {
                setTimeout(sembunyikanLayarMasuk, 450);
            } else {
                window.addEventListener('load', function () { setTimeout(sembunyikanLayarMasuk, 450); });
                // jaga-jaga kalau event load lambat/gagal, tetap sembunyikan
                setTimeout(sembunyikanLayarMasuk, 3000);
            }
        })();

        /* ---------- Feedback interaktif pill Tech Stack (sentuh di HP) ---------- */
        (function () {
            var pills = document.querySelectorAll('.guru-about-stack-pill');
            if (!pills.length) return;
            pills.forEach(function (pill) {
                pill.addEventListener('click', function () {
                    pill.classList.add('is-touched');
                    setTimeout(function () { pill.classList.remove('is-touched'); }, 1400);
                });
            });
        })();

        /* ---------- Alamat sekolah: merah saat diklik + buka Google Maps ---------- */
        (function () {
            var link = document.getElementById('guru-school-loc-link');
            if (!link) return;
            link.addEventListener('click', function () {
                link.classList.add('is-clicked');
                setTimeout(function () { link.classList.remove('is-clicked'); }, 1800);
            });
        })();

        /* ---------- Data akun developer ASLI (dipakai kartu "Developer" & modal profil) ----------
           Satu fetch dibagi dua: kartu di halaman Tentang dan modal profil sama-sama
           memanggil ambilProfilDeveloper(), jadi /api/teman/profil/siswa cukup
           ditembak sekali. Kalau gagal, cache di-reset supaya bisa dicoba lagi. */
        var USERNAME_DEV_ASLI = 'siswa';
        var __devProfilPromise = null;
        function ambilProfilDeveloper() {
            if (__devProfilPromise) return __devProfilPromise;
            __devProfilPromise = fetch('/api/teman/profil/' + encodeURIComponent(USERNAME_DEV_ASLI))
                .then(function (res) { return res.json(); })
                .then(function (json) {
                    if (!json || !json.success || !json.profil) throw new Error('gagal');
                    return json.profil;
                })
                .catch(function (err) { __devProfilPromise = null; throw err; });
            return __devProfilPromise;
        }

        /* Bingkai avatar akun DEV (border_admin) -- sama dengan yang dipakai akun ini
           di Dashboard Siswa: foto di BAWAH, gambar bingkai emas (PNG transparan
           500x500) menimpa di ATAS. Posisi foto dihitung dari lubang bingkai
           (dalam persen) sehingga tetap pas di ukuran berapa pun; foto sengaja
           sedikit masuk ke bawah tepi bingkai supaya tidak ada celah putih.
           Kalau file bingkai gagal dimuat (path salah/404), otomatis jatuh ke
           foto bulat + ring emas (class .frame-gagal). Ganti URL_BINGKAI_DEV kalau
           file border_admin.jpg ditaruh di folder lain. */
        var URL_BINGKAI_DEV = '../static/img/border_admin.jpg';
        function avatarBingkaiDevHTML(fotoUrl, nama, ukuranPx) {
            return '<div class="guru-frame-dev" style="--ukuran:' + ukuranPx + 'px">' +
                '<img class="guru-frame-dev-foto" src="' + escHTMLDev(fotoUrl) + '" alt="Foto ' + escHTMLDev(nama) + '" loading="lazy" decoding="async">' +
                '<img class="guru-frame-dev-bingkai" src="' + URL_BINGKAI_DEV + '" alt="" aria-hidden="true" decoding="async" onerror="this.parentNode.classList.add(\'frame-gagal\')">' +
                '</div>';
        }

        function escHTMLDev(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        /* ---------- Kartu "Developer" di halaman Tentang: isi dari akun asli ----------
           Tampilan disamakan dengan kartu profil di Dashboard Siswa: foto dengan
           border emas, nama efek emas, badge DEV, kelas, dan
           tombol sosmed. Markup statis di HTML (ikon </> + nama) tetap jadi cadangan
           kalau server belum menjawab / gagal. Dimuat LAZY saat tab Tentang dibuka,
           bukan saat halaman pertama load, supaya tidak menambah request paralel
           di refresh dashboard (rentan kena rate limit 'burst'). */
        var __kartuDevSudahDirender = false;
        var __kartuDevSudahRetry = false;
        function muatKartuDeveloper() {
            if (__kartuDevSudahDirender) return;
            var row = document.getElementById('guru-dev-row');
            if (!row) return;

            ambilProfilDeveloper().then(function (p) {
                if (__kartuDevSudahDirender) return;

                var tampilan = (typeof mapBorderIdKeTampilanGuru === 'function')
                    ? mapBorderIdKeTampilanGuru(p.border)
                    : { border: '', efek: '', title: '' };
                var nama = p.nama || 'Ahmad Fakhri Al Farisi';
                var fotoUrl = p.foto || '../static/img/foto_profil_default.jpg';
                var adalahDev = (tampilan.title === 'DEV');

                var avatarHTML = adalahDev
                    ? avatarBingkaiDevHTML(fotoUrl, nama, 96)
                    : '<img class="guru-dev-avatar-polos" src="' + escHTMLDev(fotoUrl) + '" alt="Foto ' + escHTMLDev(nama) + '" loading="lazy" decoding="async">';

                var namaHTML = (tampilan.efek === 'gold-name')
                    ? '<span class="gold-name-text">' + escHTMLDev(nama) + '</span>'
                    : '<span>' + escHTMLDev(nama) + '</span>';

                var badgeHTML = adalahDev
                    ? '<span class="badge-dev bg-amber-400 text-slate-900 guru-dev-chip-dev"><i class="fa-solid fa-crown"></i> DEV</span>'
                    : '<span class="guru-dev-chip-sistem"><i class="fa-solid fa-code"></i> Student Developer</span>';

                var metaHTML = 'Siswa' + (p.kelas ? ' &bull; ' + escHTMLDev(p.kelas) : '');

                // Tombol sosmed: urutan tetap seperti di Dashboard Siswa, hanya yang punya link.
                var sosmedHTML = '';
                if (p.sosmed && typeof p.sosmed === 'object') {
                    var peta = {};
                    Object.keys(p.sosmed).forEach(function (k) { peta[String(k).toLowerCase()] = p.sosmed[k]; });
                    var urutan = ['facebook', 'instagram', 'tiktok', 'github', 'whatsapp', 'youtube'];
                    var ikon = { facebook: 'fa-facebook-f', instagram: 'fa-instagram', tiktok: 'fa-tiktok', github: 'fa-github', whatsapp: 'fa-whatsapp', youtube: 'fa-youtube' };
                    Object.keys(peta).forEach(function (k) { if (urutan.indexOf(k) === -1) urutan.push(k); });
                    urutan.forEach(function (platform) {
                        var link = peta[platform];
                        if (!link || typeof link !== 'string') return;
                        link = link.trim();
                        if (!link || /^(javascript|data|vbscript):/i.test(link)) return;
                        if (!/^(https?:)?\/\//i.test(link)) link = 'https://' + link;
                        var kelasIkon = ikon[platform] || 'fa-link';
                        var famili = ikon[platform] ? 'fa-brands' : 'fa-solid';
                        sosmedHTML += '<a class="guru-dev-sos-btn is-' + (ikon[platform] ? platform : 'lain') + '" href="' + escHTMLDev(link) + '" target="_blank" rel="noopener noreferrer" title="' + escHTMLDev(platform) + '" aria-label="' + escHTMLDev(platform) + '"><i class="' + famili + ' ' + kelasIkon + '"></i></a>';
                    });
                }

                row.className = 'guru-dev-real';
                row.innerHTML =
                    avatarHTML +
                    '<div class="guru-dev-info">' +
                        '<button type="button" class="guru-dev-name" onclick="bukaProfilDeveloper()" title="Lihat profil lengkap">' + namaHTML + '<i class="fa-solid fa-arrow-up-right-from-square"></i></button>' +
                        '<div class="guru-dev-badges">' + badgeHTML + '</div>' +
                        '<p class="guru-dev-meta">' + metaHTML + '</p>' +
                    '</div>' +
                    (sosmedHTML ? '<div class="guru-dev-sosmed">' + sosmedHTML + '</div>' : '');
                __kartuDevSudahDirender = true;
            }).catch(function () {
                // Gagal (mis. kena rate limit / offline): biarkan tampilan statis,
                // coba SEKALI lagi beberapa detik kemudian, selebihnya saat tab dibuka lagi.
                if (!__kartuDevSudahRetry) {
                    __kartuDevSudahRetry = true;
                    setTimeout(muatKartuDeveloper, 2500);
                }
            });
        }

        (function () {
            var tabTentang = document.getElementById('tab-about-us');
            if (!tabTentang) return;
            function cekTabTentang() {
                if (!tabTentang.classList.contains('hidden')) muatKartuDeveloper();
            }
            // Pantau class "hidden" di tab Tentang (switchTab menambah/menghapusnya),
            // jadi tidak perlu membungkus/mengubah fungsi switchTab yang sudah ada.
            new MutationObserver(cekTabTentang).observe(tabTentang, { attributes: true, attributeFilter: ['class'] });
            cekTabTentang();
        })();

        /* ---------- Profil Publik Developer (klik nama di halaman Tentang) ----------
           Mirip fitur "Cari Teman" di Dashboard Siswa: klik nama -> fetch
           /api/teman/profil/<username> -> render ke modal. Username akun
           dev asli di-hardcode 'siswa' karena memang username tetap/fix
           (lihat USERNAME_ADMIN_DEV di app.py). */
        var __devProfilSudahDimuat = false;
        function bukaProfilDeveloper() {
            var modal = document.getElementById('modal-profil-developer');
            if (!modal) return;
            modal.classList.remove('hidden');

            var elLoading = document.getElementById('devprofil-loading');
            var elGagal = document.getElementById('devprofil-gagal');
            if (__devProfilSudahDimuat) return; // sudah pernah sukses dimuat, tidak perlu fetch ulang
            if (elLoading) elLoading.classList.remove('hidden');
            if (elGagal) elGagal.classList.add('hidden');

            ambilProfilDeveloper()
                .then(function (p) {

                    // Terjemahkan border_aktif mentah ('admin_dev') ke tampilan
                    // border emas + efek nama emas + badge DEV -- pakai fungsi
                    // yang SAMA dengan yang dipakai render Denah Kelas, supaya
                    // benar-benar identik dengan yang dipakai akun aslinya, bukan
                    // avatar polos.
                    var tampilan = (typeof mapBorderIdKeTampilanGuru === 'function')
                        ? mapBorderIdKeTampilanGuru(p.border)
                        : { border: '', efek: '', title: '' };
                    var fotoUrl = p.foto || '../static/img/foto_profil_default.jpg';

                    var avatarSlot = document.getElementById('devprofil-avatar-slot');
                    if (avatarSlot) {
                        avatarSlot.innerHTML = (tampilan.title === 'DEV')
                            ? avatarBingkaiDevHTML(fotoUrl, p.nama || '', 112)
                            : '<img src="' + escHTMLDev(fotoUrl) + '" alt="Foto ' + escHTMLDev(p.nama || '') + '" class="w-20 h-20 rounded-full object-cover border-4 border-white/20">';
                    }

                    var elNama = document.getElementById('devprofil-nama');
                    if (elNama) {
                        elNama.innerHTML = (tampilan.efek === 'gold-name')
                            ? '<span class="gold-name-text">' + (p.nama || 'Ahmad Fakhri Al Farisi') + '</span>'
                            : (p.nama || 'Ahmad Fakhri Al Farisi');
                    }

                    var elKelas = document.getElementById('devprofil-kelas');
                    if (elKelas) elKelas.textContent = p.kelas || '-';

                    var titleSlot = document.getElementById('devprofil-title-slot');
                    if (titleSlot) {
                        titleSlot.innerHTML = (tampilan.title === 'DEV')
                            ? '<span class="badge-dev px-2.5 py-1 text-[10px] font-extrabold bg-amber-400 text-slate-900 rounded-full shadow-sm uppercase tracking-wide"><i class="fa-solid fa-crown text-[9px] mr-1"></i>DEV</span>'
                            : '<span class="px-2.5 py-1 rounded-full bg-amber-400/90 text-slate-900 text-[10px] font-extrabold uppercase tracking-wide"><i class="fa-solid fa-code mr-1"></i>Developer</span>';
                    }

                    var elTeman = document.getElementById('devprofil-teman');
                    if (elTeman) elTeman.textContent = p.jumlah_teman || 0;

                    var elPoin = document.getElementById('devprofil-poin');
                    if (elPoin) elPoin.textContent = (p.quiz_pg_total_poin || 0);

                    var sosmedWrap = document.getElementById('devprofil-sosmed-wrap');
                    var sosmedBox = document.getElementById('devprofil-sosmed');
                    if (sosmedWrap && sosmedBox && p.sosmed && Object.keys(p.sosmed).length) {
                        sosmedBox.innerHTML = '';
                        var ikonSosmed = { instagram: 'fa-instagram', tiktok: 'fa-tiktok', github: 'fa-github', whatsapp: 'fa-whatsapp', youtube: 'fa-youtube', facebook: 'fa-facebook' };
                        Object.keys(p.sosmed).forEach(function (platform) {
                            var link = p.sosmed[platform];
                            if (!link) return;
                            var a = document.createElement('a');
                            a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
                            a.className = 'w-8 h-8 rounded-full bg-slate-100 hover:bg-blue-50 flex items-center justify-center text-slate-500 hover:text-blue-600 transition-all';
                            a.innerHTML = '<i class="fa-brands ' + (ikonSosmed[platform] || 'fa-link') + '"></i>';
                            sosmedBox.appendChild(a);
                        });
                        sosmedWrap.classList.remove('hidden');
                    }

                    if (elLoading) elLoading.classList.add('hidden');
                    __devProfilSudahDimuat = true;
                })
                .catch(function () {
                    if (elLoading) elLoading.classList.add('hidden');
                    if (elGagal) elGagal.classList.remove('hidden');
                });
        }
        function tutupProfilDeveloper() {
            var modal = document.getElementById('modal-profil-developer');
            if (modal) modal.classList.add('hidden');
        }
