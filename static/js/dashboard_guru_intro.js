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
