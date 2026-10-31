/* Transkrip penuh + timestamp, teks mengikuti audio saat diputar.
 * Lokasi: static/js/noise/transkrip_audio.js  (muat SETELAH mic_bersih.js)
 *
 *  rekamSuaraBersih()                    -> { stop(): Promise<Blob> }  (rekam lewat RNNoise)
 *  transkripAudio(blob)                  -> Promise<segmen[]>          (WAV 16k -> /api/transkrip)
 *  pasangCaptionAudio(audioEl, wadah, segmen) -> { destroy() }        (caption ikut pemutar)
 *  transkripDanPasang(audioEl, wadah, blob)   -> Promise<segmen[]>    (semua langkah + status)
 */
(function () {
  'use strict';

  var API = '/api/transkrip';
  var MAKS_DETIK = 480; // 8 menit -> WAV 16kHz mono ~15MB, masih muat batas server

  // ---------- Rekam lewat RNNoise ----------
  window.rekamSuaraBersih = async function () {
    var mic = await window.bikinMicBersih();
    var potongan = [];
    var pilihan = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
    var rec = new MediaRecorder(mic.stream, pilihan);
    rec.ondataavailable = function (e) { if (e.data && e.data.size) potongan.push(e.data); };
    rec.start(1000);
    return {
      stop: function () {
        return new Promise(function (selesai) {
          rec.onstop = function () {
            mic.stop();
            selesai(new Blob(potongan, { type: rec.mimeType || 'audio/webm' }));
          };
          rec.stop();
        });
      }
    };
  };

  // ---------- Audio apa pun -> WAV 16kHz mono 16-bit ----------
  function tulis(view, pos, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  }

  async function blobKeWav16k(blob) {
    var mentah = await blob.arrayBuffer();
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var audio;
    try { audio = await ctx.decodeAudioData(mentah); } finally { ctx.close(); }
    if (audio.duration > MAKS_DETIK) {
      throw new Error('Audio terlalu panjang (maks ' + (MAKS_DETIK / 60) + ' menit per transkrip).');
    }
    var SR = 16000;
    var off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * SR)), SR);
    var sumber = off.createBufferSource();
    sumber.buffer = audio;
    sumber.connect(off.destination);
    sumber.start();
    var pcm = (await off.startRendering()).getChannelData(0);

    var buf = new ArrayBuffer(44 + pcm.length * 2);
    var v = new DataView(buf);
    tulis(v, 0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); tulis(v, 8, 'WAVE');
    tulis(v, 12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tulis(v, 36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (var i = 0; i < pcm.length; i++) {
      var s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- Kirim ke server ----------
  window.transkripAudio = async function (blob) {
    var wav = await blobKeWav16k(blob);
    var fd = new FormData();
    fd.append('audio', wav, 'rekaman.wav');
    var r = await fetch(API, { method: 'POST', body: fd, credentials: 'same-origin' });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || !data.ok) throw new Error(data.pesan || ('Transkrip gagal (' + r.status + ').'));
    return data.segmen;
  };

  // ---------- Caption yang mengikuti audio ----------
  function gayaSekali() {
    if (document.getElementById('gaya-transkrip-audio')) return;
    var st = document.createElement('style');
    st.id = 'gaya-transkrip-audio';
    st.textContent =
      '.trk-wadah{max-height:11rem;overflow-y:auto;margin-top:.5rem;padding:.5rem;border-radius:.75rem;' +
      'background:rgba(148,163,184,.12);font-size:.875rem;line-height:1.45}' +
      '.trk-baris{display:flex;gap:.5rem;padding:.25rem .4rem;border-radius:.5rem;cursor:pointer;opacity:.6;transition:opacity .15s,background .15s}' +
      '.trk-baris:hover{opacity:.9}' +
      '.trk-baris.trk-aktif{opacity:1;background:rgba(59,130,246,.16);font-weight:600}' +
      '.trk-waktu{flex:none;font-variant-numeric:tabular-nums;opacity:.7;font-size:.75rem;padding-top:.1rem}' +
      '.trk-info{opacity:.7;font-size:.8rem;padding:.25rem .4rem}';
    document.head.appendChild(st);
  }

  function fmt(d) {
    d = Math.max(0, Math.floor(d));
    return ('0' + Math.floor(d / 60)).slice(-2) + ':' + ('0' + (d % 60)).slice(-2);
  }

  window.pasangCaptionAudio = function (audioEl, wadah, segmen) {
    gayaSekali();
    wadah.innerHTML = '';
    wadah.classList.add('trk-wadah');
    var baris = segmen.map(function (sg) {
      var el = document.createElement('div');
      el.className = 'trk-baris';
      var w = document.createElement('span');
      w.className = 'trk-waktu';
      w.textContent = fmt(sg.mulai);
      var t = document.createElement('span');
      t.textContent = sg.teks;           // textContent: aman dari HTML/script di dalam teks
      el.appendChild(w); el.appendChild(t);
      el.addEventListener('click', function () {
        audioEl.currentTime = sg.mulai;
        if (audioEl.paused) audioEl.play().catch(function () {});
      });
      wadah.appendChild(el);
      return el;
    });

    var aktif = -1;
    function cari(t) {
      for (var i = segmen.length - 1; i >= 0; i--) if (t >= segmen[i].mulai) return t <= segmen[i].selesai + 0.6 ? i : -1;
      return -1;
    }
    function perbarui() {
      var i = cari(audioEl.currentTime);
      if (i === aktif) return;
      if (aktif >= 0 && baris[aktif]) baris[aktif].classList.remove('trk-aktif');
      aktif = i;
      if (i >= 0) {
        baris[i].classList.add('trk-aktif');
        var el = baris[i];
        if (el.offsetTop < wadah.scrollTop || el.offsetTop + el.offsetHeight > wadah.scrollTop + wadah.clientHeight) {
          wadah.scrollTop = el.offsetTop - wadah.clientHeight / 2 + el.offsetHeight / 2;
        }
      }
    }
    audioEl.addEventListener('timeupdate', perbarui);
    audioEl.addEventListener('seeked', perbarui);
    return {
      destroy: function () {
        audioEl.removeEventListener('timeupdate', perbarui);
        audioEl.removeEventListener('seeked', perbarui);
        wadah.innerHTML = '';
      }
    };
  };

  function info(wadah, teks) {
    gayaSekali();
    wadah.classList.add('trk-wadah');
    wadah.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'trk-info';
    d.textContent = teks;
    wadah.appendChild(d);
  }

  window.transkripDanPasang = async function (audioEl, wadah, blob) {
    info(wadah, 'Membuat transkrip...');
    try {
      var segmen = await window.transkripAudio(blob);
      if (!segmen.length) { info(wadah, 'Tidak ada ucapan yang terdeteksi.'); return []; }
      window.pasangCaptionAudio(audioEl, wadah, segmen);
      return segmen;
    } catch (e) {
      info(wadah, e.message || 'Transkrip gagal.');
      throw e;
    }
  };
})();
