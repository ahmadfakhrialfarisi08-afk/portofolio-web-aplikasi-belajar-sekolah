        /* ---------- Layar transisi masuk dashboard (gelap -> terang) ---------- */
        (function () {
            var layarMasuk = document.getElementById('layar-masuk-dashboard');
            if (!layarMasuk) return;
            // Guard supaya fungsi ini cuma benar-benar jalan SEKALI. Sebelumnya
            // tidak ada penjagaan ini -- kalau event "load" sempat lambat/telat
            // dikit saja, timer fallback 3000ms di bawah TETAP jalan juga,
            // jadi sembunyikanLayarMasuk() (dan animasi di dalamnya) kepanggil
            // DUA KALI beruntun. Ini yang bikin animasinya kelihatan "muncul 2x"
            // tiap kali login/buka dashboard.
            var sudahDijalankan = false;
            function sembunyikanLayarMasuk() {
                if (sudahDijalankan) return;
                sudahDijalankan = true;

                // CATATAN: efek "gelombang sapuan warna" (gelombang + garis tepi +
                // kupu-kupu) DULU otomatis dimainkan di sini setiap kali dashboard
                // dibuka/login, memakai tema yang sudah aktif dari localStorage.
                // Sekarang efek itu SENGAJA TIDAK dipanggil lagi di sini -- animasi
                // sapuan warna ini sekarang HANYA boleh main saat siswa BENAR-BENAR
                // memilih warna baru lewat panel "Warna Aksen" (klik salah satu
                // swatch, lihat pilihAksenTema di bawah), bukan otomatis tiap login.
                // Warna tema tetap diterapkan seperti biasa tanpa animasi lewat
                // loadAksenTemaPreference() (dipanggil terpisah di DOMContentLoaded
                // lain), jadi dashboard tetap langsung tampil dengan warna yang
                // benar -- cuma tanpa efek "reveal" sapuannya lagi.
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
