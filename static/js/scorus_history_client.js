/* SCORUS AI -- klien API riwayat chat (memanggil api/scorus_history_routes.py).
   Semua request memakai cookie sesi guru; server yang menentukan pemilik chat. */
(function () {
    'use strict';

    function panggil(metode, url, body) {
        var opsi = { method: metode, credentials: 'same-origin', headers: {} };
        if (body !== undefined) {
            opsi.headers['Content-Type'] = 'application/json';
            opsi.body = JSON.stringify(body);
        }
        return fetch(url, opsi).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) {
                    var pesan = (data && data.error) ||
                        (res.status === 429 ? 'Terlalu cepat, tunggu sebentar lalu coba lagi.'
                            : res.status === 401 || res.status === 403 ? 'Sesi login berakhir. Muat ulang halaman lalu login lagi.'
                                : 'Terjadi kesalahan (' + res.status + ').');
                    var err = new Error(pesan);
                    err.status = res.status;
                    throw err;
                }
                return data;
            });
        });
    }

    window.ScorusHistoryClient = {
        daftar: function () {
            return panggil('GET', '/api/scorus/conversations').then(function (d) { return d.conversations || []; });
        },
        buka: function (id) {
            return panggil('GET', '/api/scorus/conversations/' + encodeURIComponent(id));
        },
        hapus: function (id) {
            return panggil('DELETE', '/api/scorus/conversations/' + encodeURIComponent(id));
        },
        kirim: function (conversationId, pesan) {
            var body = { message: pesan };
            if (conversationId) body.conversation_id = conversationId;
            return panggil('POST', '/api/scorus/chat', body);
        }
    };
})();
