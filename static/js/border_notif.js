// static/js/border_notif.js
//
// Notif SEKALI ke siswa bahwa border aktif berlaku di semua perangkat
// (server simpan 1 nilai per user, bukan per device).
//
// Cara kerja: bungkus window.fetch supaya bisa nangkep semua panggilan
// ke /api/profil/border tanpa perlu utak-atik file JS lain. Harus
// ditaruh SEBELUM dashboard_siswa_2.js di <script> supaya wrap ini
// aktif duluan sebelum dashboard_siswa_2 (atau file lain) manggil fetch.

(function () {
    'use strict';

    var FLAG_KEY = 'border_notif_semua_device_dilihat';
    var TARGET_PATH = '/api/profil/border';
    var PESAN_TOAST = 'Border aktif ini dipakai di semua perangkat kamu -- kalau login di HP/laptop lain, border yang sama otomatis ikut tampil.';

    var fetchAsli = window.fetch;

    if (typeof fetchAsli !== 'function') {
        // Tidak ada fetch (browser sangat lawas) -- tidak ada yang bisa
        // dibungkus, keluar diam-diam.
        return;
    }

    window.fetch = function () {
        var args = arguments;
        var urlArg = args[0];

        return fetchAsli.apply(this, args).then(function (response) {
            try {
                var urlString = ambilUrlString(urlArg);

                if (urlString && urlString.indexOf(TARGET_PATH) !== -1 && response && response.ok) {
                    // Clone supaya body response tetap bisa dibaca ulang
                    // oleh kode pemanggil aslinya (fetch response body
                    // cuma bisa dibaca sekali).
                    response
                        .clone()
                        .json()
                        .then(function (json) {
                            if (json && json.success) {
                                prosesNotifSekaliJalan();
                            }
                        })
                        .catch(function () {
                            // Response bukan JSON valid / body kosong -- abaikan,
                            // jangan sampai bikin fetch pemanggil asli error.
                        });
                }
            } catch (err) {
                // Jaga-jaga: apapun yang meleset di sini gak boleh
                // mengganggu response fetch asli.
            }

            return response;
        });
    };

    function ambilUrlString(urlArg) {
        if (typeof urlArg === 'string') {
            return urlArg;
        }
        if (urlArg && typeof urlArg.url === 'string') {
            // Request object
            return urlArg.url;
        }
        if (urlArg && typeof urlArg.toString === 'function') {
            return urlArg.toString();
        }
        return '';
    }

    function prosesNotifSekaliJalan() {
        var sudahDilihat;

        try {
            sudahDilihat = window.localStorage.getItem(FLAG_KEY);
        } catch (err) {
            // localStorage bisa gagal (mode privat ketat dll) -- anggap
            // belum dilihat, tapi jangan sampai lempar error ke atas.
            sudahDilihat = null;
        }

        if (sudahDilihat) {
            return;
        }

        tampilkanNotifBorder();

        try {
            window.localStorage.setItem(FLAG_KEY, '1');
        } catch (err) {
            // Kalau gagal disimpan, notif berisiko muncul lagi lain kali --
            // tapi itu lebih aman daripada bikin fitur ini error.
        }
    }

    function tampilkanNotifBorder() {
        if (typeof window.tampilkanToast === 'function') {
            window.tampilkanToast(PESAN_TOAST);
            return;
        }

        tampilkanToastFallback(PESAN_TOAST);
    }

    function tampilkanToastFallback(pesan) {
        var toast = document.createElement('div');
        toast.textContent = pesan;
        toast.setAttribute('role', 'status');

        toast.style.position = 'fixed';
        toast.style.left = '50%';
        toast.style.bottom = '24px';
        toast.style.transform = 'translateX(-50%) translateY(12px)';
        toast.style.maxWidth = '90vw';
        toast.style.width = '360px';
        toast.style.background = 'rgba(17, 24, 39, 0.94)';
        toast.style.color = '#ffffff';
        toast.style.fontSize = '13px';
        toast.style.lineHeight = '1.4';
        toast.style.padding = '12px 16px';
        toast.style.borderRadius = '12px';
        toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)';
        toast.style.zIndex = '99999';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toast.style.pointerEvents = 'none';

        document.body.appendChild(toast);

        // Trigger fade-in di frame berikutnya biar transition kepakai.
        window.requestAnimationFrame(function () {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        window.setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(12px)';

            window.setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 4000);
    }
})();
