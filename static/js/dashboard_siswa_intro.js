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

        /* ---------- Animasi masuk Sidebar (dari kiri) & Main Content (dari bawah) ---------- */
        // Ditulis sebagai blok TERPISAH & mandiri dari IIFE layar masuk di
        // atas (tidak bergantung pada elemen #layar-masuk-dashboard ada/
        // tidaknya) -- supaya animasi masuk sidebar/konten ini tetap jalan
        // normal walau overlay loading itu somehow tidak ada di halaman.
        // Timing (delay 450ms setelah load, fallback 3 detik kalau event
        // load lambat/gagal) SENGAJA disamakan dengan sembunyikanLayarMasuk()
        // di atas supaya sidebar & konten utama kelihatan "muncul" kurang
        // lebih bersamaan waktu overlay layar masuk mulai memudar. Lihat
        // CSS terkait (.entrance-siap, #sidebar-utama, #main-content) di
        // dashboard_siswa.css.
        (function () {
            var sidebarUtama = document.getElementById('sidebar-utama');
            var kontenUtama = document.getElementById('main-content');
            if (!sidebarUtama && !kontenUtama) return;

            function tampilkanEntranceDashboard() {
                if (sidebarUtama) sidebarUtama.classList.add('entrance-siap');
                if (kontenUtama) kontenUtama.classList.add('entrance-siap');
            }

            if (document.readyState === 'complete') {
                setTimeout(tampilkanEntranceDashboard, 450);
            } else {
                window.addEventListener('load', function () { setTimeout(tampilkanEntranceDashboard, 450); });
                setTimeout(tampilkanEntranceDashboard, 3000);
            }
        })();
