// static/js/poin_keamanan_siswa.js
//
// Widget "Poin Keamanan" di dashboard siswa. Fetch /api/keamanan/poin/status
// lalu render ke dalam <div id="widget-poin-keamanan">. Kalau div itu gak
// ada di halaman, script ini diam saja (skip, tanpa error).

(function () {
    'use strict';

    var ENDPOINT = '/api/keamanan/poin/status';
    var TARGET_ID = 'widget-poin-keamanan';

    var KONFIG_STATUS = {
        aman: { label: 'Aman', warna: '#059669', warnaLembut: '#ecfdf5' },
        waspada: { label: 'Waspada', warna: '#d97706', warnaLembut: '#fffbeb' },
        kritis: { label: 'Kritis', warna: '#dc2626', warnaLembut: '#fef2f2' }
    };

    document.addEventListener('DOMContentLoaded', inisialisasi);

    function inisialisasi() {
        var kontainer = document.getElementById(TARGET_ID);

        if (!kontainer) {
            return;
        }

        renderLoading(kontainer);
        muatDanRender(kontainer);
    }

    function muatDanRender(kontainer) {
        fetch(ENDPOINT, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Gagal ambil status poin keamanan (' + response.status + ')');
                }
                return response.json();
            })
            .then(function (data) {
                if (!data || !data.success) {
                    throw new Error('Response poin keamanan tidak sukses');
                }
                renderWidget(kontainer, data);
            })
            .catch(function (err) {
                renderError(kontainer);
            });
    }

    function tentukanStatusKey(saldo, statusDariServer) {
        // Kalau server sudah kasih field status yang cocok, pakai itu.
        if (statusDariServer) {
            var key = String(statusDariServer).toLowerCase();
            if (KONFIG_STATUS[key]) {
                return key;
            }
        }

        // Fallback: tentukan dari nilai saldo.
        if (saldo >= 70) return 'aman';
        if (saldo >= 40) return 'waspada';
        return 'kritis';
    }

    function renderLoading(kontainer) {
        kontainer.innerHTML =
            '<div style="' + gayaKartu() + '">' +
                '<div style="font-size:12px;color:#94a3b8;">Memuat poin keamanan...</div>' +
            '</div>';
    }

    function renderError(kontainer) {
        kontainer.innerHTML =
            '<div style="' + gayaKartu() + '">' +
                '<div style="font-size:12px;color:#94a3b8;">Poin keamanan belum bisa dimuat saat ini.</div>' +
            '</div>';
    }

    function renderWidget(kontainer, data) {
        var saldo = Number(data.saldo) || 0;
        var maksimal = Number(data.maksimal) || 100;
        var persen = data.progress_persen !== undefined && data.progress_persen !== null
            ? Number(data.progress_persen)
            : Math.round((saldo / maksimal) * 100);

        persen = Math.max(0, Math.min(100, persen));

        var statusKey = tentukanStatusKey(saldo, data.status);
        var statusCfg = KONFIG_STATUS[statusKey];
        var riwayat = Array.isArray(data.riwayat_30_hari) ? data.riwayat_30_hari : [];

        var html = '';
        html += '<div style="' + gayaKartu() + '">';

        // Header: title + badge status
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">';
        html += '<h3 style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">Poin Keamanan</h3>';
        html += '<span style="' + gayaBadge(statusCfg) + '">' + escapeHtml(statusCfg.label) + '</span>';
        html += '</div>';

        // Angka besar
        html += '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:8px;">';
        html += '<span style="font-size:26px;font-weight:800;color:#0f172a;line-height:1;">' + saldo + '</span>';
        html += '<span style="font-size:13px;color:#94a3b8;font-weight:600;">/ ' + maksimal + '</span>';
        html += '</div>';

        // Progress bar
        html += '<div style="width:100%;height:8px;border-radius:999px;background:#f1f5f9;overflow:hidden;margin-bottom:14px;">';
        html += '<div style="width:' + persen + '%;height:100%;border-radius:999px;background:' + statusCfg.warna + ';transition:width .3s ease;"></div>';
        html += '</div>';

        // Riwayat 30 hari
        html += '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px;">Riwayat 30 Hari Terakhir</div>';

        if (riwayat.length === 0) {
            html += '<div style="font-size:12px;color:#94a3b8;padding:6px 0;">Belum ada catatan poin dalam 30 hari terakhir.</div>';
        } else {
            html += '<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">';

            for (var i = 0; i < riwayat.length; i++) {
                html += renderItemRiwayat(riwayat[i]);
            }

            html += '</ul>';
        }

        html += '</div>';

        kontainer.innerHTML = html;
    }

    function renderItemRiwayat(item) {
        var delta = Number(item && item.delta) || 0;
        var positif = delta > 0;
        var deltaText = (positif ? '+' : '') + delta;
        var warnaDelta = delta === 0 ? '#64748b' : (positif ? '#059669' : '#dc2626');
        var alasan = item && item.alasan ? String(item.alasan) : '-';
        var tanggal = item && item.tanggal ? String(item.tanggal) : '';
        var saldoSesudah = item && item.saldo_sesudah !== undefined && item.saldo_sesudah !== null
            ? item.saldo_sesudah
            : null;

        var html = '';
        html += '<li style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;background:#f8fafc;border-radius:10px;">';

        html += '<div style="min-width:0;flex:1;">';
        html += '<div style="font-size:12px;color:#0f172a;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(alasan) + '</div>';
        html += '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">' + escapeHtml(tanggal) + '</div>';
        html += '</div>';

        html += '<div style="text-align:right;flex-shrink:0;">';
        html += '<div style="font-size:12.5px;font-weight:700;color:' + warnaDelta + ';">' + escapeHtml(deltaText) + '</div>';
        if (saldoSesudah !== null) {
            html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">saldo: ' + escapeHtml(String(saldoSesudah)) + '</div>';
        }
        html += '</div>';

        html += '</li>';
        return html;
    }

    function gayaKartu() {
        return 'background:#ffffff;border-radius:16px;padding:18px 18px 16px;' +
            'box-shadow:0 1px 2px rgba(0,0,0,0.04), 0 1px 8px rgba(15,23,42,0.05);' +
            'border:1px solid #f1f5f9;';
    }

    function gayaBadge(statusCfg) {
        return 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;' +
            'background:' + statusCfg.warnaLembut + ';color:' + statusCfg.warna + ';white-space:nowrap;';
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
