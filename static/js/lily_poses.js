/*
 * lily_poses.js -- lapisan "pose" tambahan untuk Lily (ekspresi baru: pencarian & penjelasan; 07_FRAME_05_BERPIKIR_SEJENAK sengaja tidak dipakai).
 *
 * TAMBAHAN MURNI. Tidak mengganti sprite lama, tidak menyentuh lily_rig.js, tidak punya state machine.
 * lily_brain.js yang memutuskan KAPAN pose tampil (berdasarkan status AI yang sebenarnya);
 * modul ini hanya tahu CARA menampilkannya: satu lapisan <img> bertumpuk di atas sprite lama,
 * crossfade lembut, ukuran container tidak berubah (position:absolute, object-fit:contain).
 *
 * Aman tanpa modul ini / tanpa gambar: bila file ini tidak dimuat, gambar gagal dimuat, atau pose belum
 * selesai diunduh, brain tetap memakai sprite lama persis seperti sebelumnya (show() mengembalikan false).
 *
 * Satu-satunya tempat path gambar: FILES di bawah. Folder gambar = <folder script ini>/lily_poses/
 * (ubah dengan window.LILY_POSES_BASE = '/static/img/lily_poses/' sebelum script ini dimuat).
 * Vanilla JS, tanpa dependency. Browser: window.LilyPoses. Node: module.exports (untuk tes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.LilyPoses = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';
 
  /* ---- peta terpusat: nama pose -> file. Kategori logis -> aset nyata di ZIP folder 07_EKSPRESI_PENCARIAN_PENJELASAN ---- */
  var FILES = {
    confused:  'pose_confused.png',    // 07_FRAME_01_BINGUNG_MENERIMA_PERTANYAAN  -> pertanyaan belum jelas
    searching: 'pose_searching.png',   // 07_FRAME_02_MEMBACA_MENCARI_INFORMASI    -> membaca buku / mencari informasi
    lost:      'pose_lost.png',        // 07_FRAME_03_BINGUNG_MENCARI_JAWABAN      -> gagal menemukan jawaban
    menemukan_jawaban: 'pose_menemukan_jawaban.png',   // 07_FRAME_04_IDE_MENEMUKAN_JAWABAN -> jawaban ditemukan
    curious:   'pose_curious.png'      // 07_FRAME_06_PENASARAN_BERTANYA           -> data/jawaban tidak ditemukan
  };
 
  var SCRIPT_BASE = (function () {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
        return document.currentScript.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    } catch (e) {}
    return '/static/js/';
  })();
  var DEFAULT_BASE = (win && win.LILY_POSES_BASE) || (SCRIPT_BASE + 'lily_poses/');
 
  var STYLE_ID = 'lily-pose-style';
  /* Sprite lama & rig disembunyikan (opacity, bukan display) selama pose aktif -> layout & ukuran container tidak berubah.
   * animation:none pada sprite: efek .lily-swap tidak boleh "menyala" di bawah pose saat mood tetap diperbarui brain. */
  var CSS =
    '.lily-pose-layer{position:absolute;inset:0;pointer-events:none;overflow:visible}' +
    '.lily-pose-layer img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
    'object-position:var(--lily-pose-x,50%) var(--lily-pose-y,50%);transform:scale(var(--lily-pose-scale,1));' +
    'transform-origin:50% 100%;opacity:0;transition:opacity var(--lily-pose-fade,380ms) ease;user-select:none}' +
    '.lily-pose-layer img.on{opacity:1}' +
        '.lily[data-pose="curious"] .lily-pose-layer::after,.lily[data-pose="lost"] .lily-pose-layer::after{' +
    'content:"?";position:absolute;top:-4px;right:2px;color:#f472b6;' +
    'font:800 24px/1 "Plus Jakarta Sans",sans-serif;' +
    'text-shadow:0 0 0 #fff,1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;' +
    'transform-origin:50% 100%;animation:lily-q-float 2.4s ease-in-out infinite}' +
    '@keyframes lily-q-float{0%{opacity:0;transform:translateY(6px) rotate(8deg) scale(.5)}' +
    '25%{opacity:1;transform:translateY(0) rotate(12deg) scale(1)}' +
    '60%{opacity:1;transform:translateY(-3px) rotate(8deg) scale(1)}' +
    '100%{opacity:1;transform:translateY(0) rotate(12deg) scale(1)}}' +
    '.lily[data-pose] .lily-sprite,.lily[data-pose] .lily-rig{opacity:0!important;animation:none!important;transition:opacity var(--lily-pose-fade,380ms) ease}' +
    '@media (prefers-reduced-motion:reduce){.lily-pose-layer img,.lily[data-pose] .lily-sprite,.lily[data-pose] .lily-rig{transition:none}}';
 
  function create(opts) {
    opts = opts || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    var root = opts.root, sprite = opts.sprite;
    if (!doc || !root || !sprite || !sprite.parentNode) return null;
    var base = (opts.basePath || DEFAULT_BASE).replace(/\/?$/, '/');
    var files = opts.files || FILES;
    var T = opts.timers || { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (id) { clearTimeout(id); } };
    var ImageCtor = opts.Image || (typeof Image !== 'undefined' ? Image : null);
    var warn = opts.onWarn || function (m) { if (opts.dev && typeof console !== 'undefined') console.warn('[LilyPoses]', m); };
 
    var ready = {}, failed = {}, loading = {};
    var cur = null, seq = 0, offT = 0, holdT = 0, flip = 0, destroyed = false;
 
    /* ---- DOM: dua <img> untuk crossfade; parent sprite jadi containing block tanpa mengubah layout ---- */
    var parent = sprite.parentNode;
    var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(parent) : null;
    if (cs && cs.position === 'static') parent.style.position = 'relative';
    if (!doc.getElementById(STYLE_ID)) {
      var st = doc.createElement('style'); st.id = STYLE_ID; st.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }
    var layer = doc.createElement('div'); layer.className = 'lily-pose-layer'; layer.setAttribute('aria-hidden', 'true');
    var imgs = [doc.createElement('img'), doc.createElement('img')];
    imgs.forEach(function (im) { im.alt = ''; im.draggable = false; layer.appendChild(im); });
    parent.appendChild(layer);
 
    function url(name) { return base + files[name]; }
    function has(name) { return !!files[name]; }
 
    function load(name) {
      if (!has(name) || ready[name] || failed[name] || loading[name] || !ImageCtor) return;
      loading[name] = 1;
      var im = new ImageCtor();
      im.onload = function () { ready[name] = 1; delete loading[name]; };
      im.onerror = function () { failed[name] = 1; delete loading[name]; warn('pose "' + name + '" gagal dimuat (' + url(name) + ') -> sprite lama dipakai'); };
      im.src = url(name);
    }
    function preload() { Object.keys(files).forEach(load); }
 
    function cancel(id) { if (id) T.clear(id); }
 
    /* Durasi crossfade = CSS var --lily-pose-fade (default 380ms, rentang yang disarankan 300-450ms).
     * Tampilkan pose. holdMs (opsional) = lepas otomatis setelah jeda. false bila pose tidak tersedia -> brain tetap memakai sprite lama. */
    function show(name, holdMs) {
      if (destroyed) return false;
      if (!has(name) || failed[name]) return false;
      if (!ready[name]) { load(name); return false; }   // belum selesai diunduh: jangan tahan UI, pakai sprite lama
      seq++; cancel(offT); offT = 0; cancel(holdT); holdT = 0;
      if (cur !== name) {
        var next = imgs[flip ^ 1], prev = imgs[flip];
        next.src = url(name);
        next.className = 'on';
        if (cur) prev.className = ''; 
        flip ^= 1; cur = name;
      }
      root.setAttribute('data-pose', name);
      if (holdMs > 0) { var my = seq; holdT = T.set(function () { holdT = 0; if (my === seq) hide(0); }, holdMs); }
      return true;
    }
 
    /* Lepas pose. delayMs kecil dipakai saat pergantian perilaku berurutan (mis. think -> eureka) supaya tidak ada
     * kedip ke sprite lama di antaranya: bila show() dipanggil dalam jeda itu, pelepasan dibatalkan. */
    function hide(delayMs) {
      if (destroyed || !cur) return;
      cancel(offT); offT = 0;
      var my = seq;
      var run = function () {
        offT = 0;
        if (my !== seq || !cur) return;
        imgs.forEach(function (im) { im.className = ''; });
        cur = null; root.removeAttribute('data-pose');
      };
      if (delayMs > 0) offT = T.set(run, delayMs); else run();
    }
 
    function destroy() {
      destroyed = true; cancel(offT); cancel(holdT);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      root.removeAttribute('data-pose');
    }
 
    return { show: show, hide: hide, preload: preload, has: has, destroy: destroy,
             get active() { return cur; }, get holding() { return !!holdT; }, _layer: layer, _imgs: imgs, _ready: ready, _failed: failed };
  }
 
  return { create: create, FILES: FILES, DEFAULT_BASE: DEFAULT_BASE };
});
 