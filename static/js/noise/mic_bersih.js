/* Mic bersih (RNNoise) -- dipakai dashboard guru & siswa.
 * Lokasi: static/js/noise/mic_bersih.js
 * Butuh di folder yang sama: index.js, workletProcessor.js, rnnoise.wasm, rnnoise_simd.wasm
 *
 * Pemakaian:
 *   const mic = await window.bikinMicBersih();
 *   mic.stream   -> MediaStream bebas noise (MediaRecorder / <audio> / WebRTC)
 *   mic.stop()   -> matikan mic & bersihkan semua resource
 *
 * Opsi: { deviceId, echoCancellation:false, campur:0.35 (0 = RNNoise murni, 1 = tanpa RNNoise) }
 *
 * PERBAIKAN (suara bolong/kacau):
 *  - RNNoise dulu jalan sendirian & sering "memutus" frame yang dikira noise -> sekarang
 *    dicampur sedikit sinyal asli (dry) supaya tidak pernah ada lubang senyap.
 *  - AGC browser dinyalakan supaya level suara masuk ke RNNoise cukup (suara pelan = dianggap noise).
 *  - High-pass 100Hz buang gemuruh/dengung frekuensi rendah sebelum RNNoise.
 *  - Echo cancellation default mati (di Chrome AEC bisa menekan suara sendiri).
 *  - Compressor di akhir supaya teriak tidak pecah & suara pelan tetap kedengaran.
 */
(function () {
  'use strict';

  var BASE = '/static/js/noise/';
  var VER = '?v=20260928b';
  var modulCache = null;
  var wasmCache = null;

  async function siapkanModul() {
    if (!modulCache) modulCache = await import(BASE + 'index.js' + VER);
    if (!wasmCache) {
      wasmCache = await modulCache.loadRnnoise({
        url: BASE + 'rnnoise.wasm' + VER,
        simdUrl: BASE + 'rnnoise_simd.wasm' + VER
      });
    }
    return modulCache;
  }

  window.bikinMicBersih = async function bikinMicBersih(opsi) {
    opsi = opsi || {};
    var campur = typeof opsi.campur === 'number' ? Math.min(1, Math.max(0, opsi.campur)) : 0.35;
    var Rn = (await siapkanModul()).RnnoiseWorkletNode;

    var stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opsi.deviceId ? { exact: opsi.deviceId } : undefined,
        channelCount: 1,
        noiseSuppression: false,            // RNNoise yang bertugas
        autoGainControl: true,              // jaga level supaya tidak dianggap noise
        echoCancellation: opsi.echoCancellation === true
      }
    });

    var ctx;
    try {
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await ctx.audioWorklet.addModule(BASE + 'workletProcessor.js' + VER);

      var src = ctx.createMediaStreamSource(stream);

      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 100;
      hp.Q.value = 0.707;

      var node = new Rn(ctx, { maxChannels: 1, wasmBinary: wasmCache.slice(0) });

      var basah = ctx.createGain();   basah.gain.value = 1 - campur;   // hasil RNNoise
      var kering = ctx.createGain();  kering.gain.value = campur;      // sinyal asli (anti bolong)

      var komp = ctx.createDynamicsCompressor();
      komp.threshold.value = -24;
      komp.knee.value = 24;
      komp.ratio.value = 4;
      komp.attack.value = 0.005;
      komp.release.value = 0.15;

      var dest = ctx.createMediaStreamDestination();

      src.connect(hp);
      hp.connect(node);  node.connect(basah);  basah.connect(komp);
      hp.connect(kering);                      kering.connect(komp);
      komp.connect(dest);

      if (ctx.state === 'suspended') await ctx.resume();

      return {
        stream: dest.stream,
        stop: function () {
          try { node.destroy(); } catch (e) {}
          try { src.disconnect(); hp.disconnect(); node.disconnect(); basah.disconnect();
                kering.disconnect(); komp.disconnect(); } catch (e) {}
          stream.getTracks().forEach(function (t) { t.stop(); });
          try { ctx.close(); } catch (e) {}
        }
      };
    } catch (err) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      if (ctx) { try { ctx.close(); } catch (e) {} }
      throw err;
    }
  };
})();
