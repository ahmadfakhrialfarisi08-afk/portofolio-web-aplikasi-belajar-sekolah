/* PROFILE PHOTO ANALYZER -- analisis foto profil 100% di browser (tanpa server, tanpa API AI).
 *
 * Alur: foto -> canvas kecil -> [face detector lokal] + [heuristik piksel] -> klasifikasi.
 *   ProfilePhotoAnalyzer.analyze(src, {debug}) -> Promise<hasil>   (TIDAK PERNAH reject)
 *   hasil = { kategori, confidence, faceCount, faceRatio, sumber, heuristik }
 *   kategori: SCENERY | NO_FACE | PORTRAIT_CLOSE | PORTRAIT_FAR | TWO_PEOPLE | GROUP | UNKNOWN
 *
 * Lapisan deteksi wajah (berurutan, yang pertama berhasil dipakai):
 *   1. MediaPipe Face Detector (aset LOKAL, lihat static/vendor/mediapipe/README.txt)
 *   2. FaceDetector bawaan browser (hanya bila ada; dukungannya tidak konsisten)
 *   3. Tanpa detector -> hanya heuristik piksel; bila tidak yakin -> UNKNOWN
 *
 * Privasi: tidak ada fetch/XHR/upload apa pun ke endpoint server. Hasil tidak disimpan
 * (tanpa localStorage, tanpa cache hasil), tidak ada face recognition, tidak ada identitas.
 * Performa: berjalan hanya saat dipanggil (foto baru dipilih), tanpa interval/loop permanen.
 * Detector dimuat malas, di-cache, lalu ditutup otomatis bila tidak dipakai beberapa menit.
 */
(function (global) {
  'use strict';

  /* Folder script ini (mis. /static/js/), diambil saat file dieksekusi. */
  var SCRIPT_BASE = (function () {
    try {
      var s = document.currentScript;
      if (s && s.src) return s.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    } catch (e) {}
    return '/static/js/';
  })();

  var CFG = {
    /* Aset MediaPipe lokal. Bisa ditimpa: window.LILY_FACE_ASSET_BASE = '/static/vendor/mediapipe/' */
    assetBase: global.LILY_FACE_ASSET_BASE || (SCRIPT_BASE + '../vendor/mediapipe/'),
    detectSize: 320,          // sisi terpanjang canvas untuk face detector
    heurSize: 64,             // sisi terpanjang canvas untuk heuristik piksel
    minImageSide: 48,         // foto lebih kecil dari ini -> UNKNOWN
    timeoutMs: 8000,          // batas total analisis; lewat -> hasil dari yang sudah ada / UNKNOWN
    minFaceScore: 0.6,        // wajah dengan skor di bawah ini tidak dihitung
    minFaceArea: 0.004,       // bbox wajah < 0.4% area foto dianggap noise
    closeAreaRatio: 0.10,     // bbox >= 10% area foto -> PORTRAIT_CLOSE (bila 1 wajah)
    closeHeightRatio: 0.35,   // ...atau tinggi bbox >= 35% tinggi foto
    sceneryWithDetector: 0.5, // 0 wajah + skor pemandangan >= ini -> SCENERY
    sceneryNoDetector: 0.7,   // detector gagal: harus lebih yakin supaya tidak mengklaim sembarangan
    idleCloseMs: 120000       // tutup detector (bebaskan memori) setelah 2 menit tak dipakai
  };

  var _detP = null;           // promise detector MediaPipe (cache)
  var _detFailedAt = 0;       // waktu gagal muat terakhir (jangan coba lagi terus-menerus)
  var _closeTimer = 0;

  function log(debug) {
    if (debug && global.console) console.log.apply(console, ['[PhotoAnalyzer]'].concat([].slice.call(arguments, 1)));
  }

  /* ---------------------------------------------------------------- util gambar ---------------------------------------------------------------- */

  /* src: data-URL / URL string / Blob / HTMLImageElement. Resolve {img, release()}. */
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (src && src.tagName === 'IMG') {
        if (src.complete && src.naturalWidth) return resolve({ img: src, release: function () {} });
        src.addEventListener('load', function () { resolve({ img: src, release: function () {} }); }, { once: true });
        src.addEventListener('error', function () { reject(new Error('img')); }, { once: true });
        return;
      }
      var url = src, objectUrl = null;
      if (typeof Blob !== 'undefined' && src instanceof Blob) url = objectUrl = URL.createObjectURL(src);
      if (typeof url !== 'string' || !url) return reject(new Error('src'));
      var img = new Image();
      var release = function () {
        img.onload = img.onerror = null;
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) {} objectUrl = null; }
        img.removeAttribute('src');
      };
      img.onload = function () { resolve({ img: img, release: release }); };
      img.onerror = function () { release(); reject(new Error('decode')); };
      img.decoding = 'async';
      img.src = url;
    });
  }

  function drawScaled(img, maxSide) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }

  /* ---------------------------------------------------------------- LAPIS 1: heuristik piksel ---------------------------------------------------------------- */

  function rgb2hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx === 0 ? 0 : d / mx, mx / 255];
  }

  /* Murni (tanpa DOM) supaya bisa diuji. data = RGBA Uint8ClampedArray. Skor 0..1 hanya PERKIRAAN kasar. */
  function heuristicFromRGBA(data, w, h) {
    var n = w * h, i, x, y;
    var sumL = 0, sumL2 = 0, sumS = 0, edge = 0, edgeN = 0;
    var blue = 0, green = 0, skinC = 0, cN = 0, skyTop = 0, topN = 0, groundBot = 0, botN = 0;
    var cx0 = w * 0.25, cx1 = w * 0.75, cy0 = h * 0.2, cy1 = h * 0.8;
    for (y = 0; y < h; y++) {
      var prevL = -1;
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var L = 0.299 * r + 0.587 * g + 0.114 * b;
        var hsv = rgb2hsv(r, g, b), H = hsv[0], S = hsv[1], V = hsv[2];
        sumL += L; sumL2 += L * L; sumS += S;
        var isBlue = H >= 190 && H <= 260 && S > 0.2 && V > 0.3;
        var isGreen = H >= 70 && H <= 170 && S > 0.2 && V > 0.15;
        if (isBlue) blue++;
        if (isGreen) green++;
        if (prevL >= 0) { edge += Math.abs(L - prevL); edgeN++; }          // gradien horizontal (tekstur)
        prevL = L;
        if (y < h / 3) { topN++; if (isBlue || (V > 0.75 && S < 0.2)) skyTop++; }          // langit / awan
        if (y >= h * 2 / 3) { botN++; if (isGreen || (H >= 20 && H <= 50 && S > 0.25 && V < 0.65)) groundBot++; } // rumput / tanah
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {                                 // area tengah: kemungkinan kulit
          cN++;
          if (r > 95 && g > 40 && b > 20 && Math.max(r, g, b) - Math.min(r, g, b) > 15 && Math.abs(r - g) > 15 && r > g && r > b) skinC++;
        }
      }
    }
    var meanL = sumL / n, varL = Math.max(0, sumL2 / n - meanL * meanL);
    var nat = Math.min(1, (blue + green) / n / 0.5);
    var sky = topN ? Math.min(1, skyTop / topN / 0.5) : 0;
    var ground = botN ? Math.min(1, groundBot / botN / 0.4) : 0;
    var detail = Math.min(1, (edgeN ? edge / edgeN : 0) / 12);
    var skin = cN ? skinC / cN : 0;
    var score = 0.35 * nat + 0.3 * sky + 0.2 * ground + 0.15 * detail;
    score *= 1 - Math.min(0.6, skin * 1.5);          // banyak area kulit di tengah -> kecil kemungkinan pemandangan
    return {
      sceneryScore: Math.max(0, Math.min(1, score)),
      brightness: meanL / 255,
      contrast: Math.sqrt(varL) / 255,
      saturation: sumS / n,
      blueRatio: blue / n, greenRatio: green / n,
      skinCenter: skin
    };
  }

  function runHeuristic(img) {
    var c = drawScaled(img, CFG.heurSize);
    try {
      var d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      return heuristicFromRGBA(d.data, c.width, c.height);
    } finally { freeCanvas(c); }
  }

  /* ---------------------------------------------------------------- LAPIS 2: face detection lokal ---------------------------------------------------------------- */

  function getMediaPipeDetector(debug) {
    if (_detP) return _detP;
    if (_detFailedAt && Date.now() - _detFailedAt < 300000) return Promise.resolve(null);   // gagal baru-baru ini
    var base = CFG.assetBase;
    _detP = import(base + 'vision_bundle.mjs').then(function (vision) {
      return vision.FilesetResolver.forVisionTasks(base + 'wasm').then(function (fileset) {
        return vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: base + 'models/blaze_face_short_range.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5
        });
      });
    }).catch(function (e) {
      log(debug, 'MediaPipe tidak tersedia', e && e.message);
      _detP = null; _detFailedAt = Date.now();
      return null;
    });
    return _detP;
  }

  function scheduleClose() {
    clearTimeout(_closeTimer);
    _closeTimer = setTimeout(function () {
      var p = _detP; _detP = null;
      if (p) p.then(function (d) { try { d && d.close && d.close(); } catch (e) {} });
    }, CFG.idleCloseMs);
  }

  /* -> Promise<{ok, sumber, faces:[{score, areaRatio, heightRatio}]}> */
  function detectFaces(canvas, debug) {
    var W = canvas.width, H = canvas.height;
    return getMediaPipeDetector(debug).then(function (det) {
      if (det) {
        var res = det.detect(canvas);
        scheduleClose();
        var faces = (res && res.detections || []).map(function (d) {
          var bb = d.boundingBox || {};
          var sc = d.categories && d.categories[0] ? d.categories[0].score : 0;
          return { score: sc, areaRatio: (bb.width * bb.height) / (W * H), heightRatio: bb.height / H };
        });
        return { ok: true, sumber: 'mediapipe', faces: faces };
      }
      if ('FaceDetector' in global) {                      // cadangan: API bawaan browser (jarang tersedia)
        return new global.FaceDetector({ fastMode: true, maxDetectedFaces: 8 }).detect(canvas).then(function (list) {
          return {
            ok: true, sumber: 'native',
            faces: list.map(function (f) {
              var bb = f.boundingBox;
              return { score: 0.7, areaRatio: (bb.width * bb.height) / (W * H), heightRatio: bb.height / H };
            })
          };
        });
      }
      return { ok: false, sumber: 'none', faces: [] };
    }).catch(function (e) {
      log(debug, 'deteksi wajah gagal', e && e.message);
      return { ok: false, sumber: 'none', faces: [] };
    });
  }

  /* ---------------------------------------------------------------- klasifikasi (murni, bisa diuji) ---------------------------------------------------------------- */

  function classify(det, heur) {
    var sc = heur ? heur.sceneryScore : 0;
    var out = function (kategori, confidence, faces, ratio) {
      return { kategori: kategori, confidence: confidence, faceCount: faces, faceRatio: ratio || 0, sumber: det.sumber };
    };
    if (!det.ok) {                                        // detector gagal -> heuristik saja; ragu -> UNKNOWN
      return sc >= CFG.sceneryNoDetector ? out('SCENERY', sc, 0) : out('UNKNOWN', 0, 0);
    }
    var faces = det.faces.filter(function (f) { return f.score >= CFG.minFaceScore && f.areaRatio >= CFG.minFaceArea; });
    var n = faces.length;
    if (n === 0) {
      if (det.faces.some(function (f) { return f.score >= 0.4 && f.areaRatio >= CFG.minFaceArea; })) return out('UNKNOWN', 0.3, 0);   // ada kandidat lemah
      return sc >= CFG.sceneryWithDetector ? out('SCENERY', sc, 0) : out('NO_FACE', 1 - sc, 0);
    }
    var best = faces.reduce(function (a, b) { return b.areaRatio > a.areaRatio ? b : a; });
    if (n === 1) {
      var close = best.areaRatio >= CFG.closeAreaRatio || best.heightRatio >= CFG.closeHeightRatio;
      return out(close ? 'PORTRAIT_CLOSE' : 'PORTRAIT_FAR', best.score, 1, best.areaRatio);
    }
    var minScore = Math.min.apply(null, faces.map(function (f) { return f.score; }));
    return out(n === 2 ? 'TWO_PEOPLE' : 'GROUP', minScore, n, best.areaRatio);
  }

  /* ---------------------------------------------------------------- API publik ---------------------------------------------------------------- */

  var UNKNOWN = function () { return { kategori: 'UNKNOWN', confidence: 0, faceCount: 0, faceRatio: 0, sumber: 'none' }; };

  function analyze(src, opts) {
    opts = opts || {};
    var debug = !!opts.debug, timer, held = null;
    var work = loadImage(src).then(function (h) {
      held = h;
      var img = h.img, w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
      if (Math.min(w, hh) < CFG.minImageSide) return UNKNOWN();       // terlalu kecil: jangan menebak
      var heur = null;
      try { heur = runHeuristic(img); } catch (e) { log(debug, 'heuristik gagal', e && e.message); }
      var c = drawScaled(img, CFG.detectSize);
      return detectFaces(c, debug).then(function (det) {
        freeCanvas(c);
        var r = classify(det, heur);
        r.heuristik = heur;                                           // hanya untuk debug/tuning, jangan disimpan
        log(debug, r);
        return r;
      });
    });
    var limit = new Promise(function (resolve) { timer = setTimeout(function () { resolve(UNKNOWN()); }, CFG.timeoutMs); });
    return Promise.race([work, limit]).catch(function (e) {
      log(debug, 'analisis gagal', e && e.message);
      return UNKNOWN();
    }).then(function (r) {
      clearTimeout(timer);
      if (held) held.release();
      return r;
    });
  }

  global.ProfilePhotoAnalyzer = {
    analyze: analyze,
    config: CFG,
    _classify: classify,                    // diekspos untuk pengujian
    _heuristicFromRGBA: heuristicFromRGBA
  };
})(window);
