/*
 * lily_rig.js — satu fungsi: menampilkan Lily dari layer modular (body/head/visor/face/eyes/mouth).
 *
 * BUKAN state machine, BUKAN sequence player, BUKAN scheduler prioritas. Semua itu tetap milik
 * lily_brain.js (BEHAVIORS, EVENTS, PRI, blink/idle loop). Rig hanya dipanggil oleh brain:
 *   rig.show({mood, eyes, mouth, dir})  -> set layer statis + gaze frame-by-frame
 *   rig.blink(durMs)                    -> 9 frame kedip; false bila frame belum ada (brain pakai CSS)
 *   rig.gesture(name)                   -> frame badan; false bila belum ada (brain pakai CSS)
 *   rig.stopGesture()                   -> lompat ke fase "return" gesture saat di-interrupt
 *
 * Aman tanpa asset: jika asset modular inti belum berstatus AVAILABLE di manifest, rig.layered === false,
 * tidak menyentuh DOM, dan brain memakai jalur sprite lama persis seperti sebelumnya.
 * Vanilla JS, tanpa dependency. Browser: window.LilyRig. Node: module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LilyRig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OK = 'AVAILABLE';
  var STYLE_ID = 'lily-rig-style';
  /* Head group memakai CSS var yang SUDAH diset brain (--lily-gaze-*, --lily-tilt, --lily-mood-tilt, --lily-lean-*, --lily-head-*). */
  var CSS =
    '.lily-rig{position:absolute;inset:0;pointer-events:none}' +
    '.lily-rig img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transition:opacity 120ms ease}' +
    '.lily-rig-head{position:absolute;inset:0;transform-origin:var(--lily-pivot,50% 38%);' +
    'transform:translate(calc(var(--lily-gaze-x,0px) + var(--lily-head-x,0px)),var(--lily-lean-y,0px)) ' +
    'rotate(calc(var(--lily-mood-tilt,0deg) + var(--lily-tilt,0deg) + var(--lily-head-r,0deg))) scale(var(--lily-lean-s,1));' +
    'transition:transform 260ms ease}' +
    '@media (prefers-reduced-motion:reduce){.lily-rig img,.lily-rig-head{transition:none}}';

  function create(opts) {
    opts = opts || {};
    var M = opts.manifest;
    if (!M) throw new Error('LilyRig: opts.manifest wajib');
    var base = (opts.basePath || '').replace(/\/?$/, '/');
    var dev = !!opts.dev;
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    var T = opts.timers || {
      set: function (f, ms) { return setTimeout(f, ms); },
      clear: function (id) { clearTimeout(id); }
    };
    var warn = opts.onWarn || function (m) { if (typeof console !== 'undefined') console.warn('[LilyRig]', m); };
    var fallbackMood = opts.fallbackMood || {};
    var reduced = opts.reducedMotion;
    if (reduced === undefined) reduced = !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    var L = M.layers, LM = M.labelMap || {}, warned = {}, timers = {}, tid = 0, destroyed = false;
    var el = {}, S = { eyes: 'neutral', dir: 'idle', face: null, mouth: null };
    var gz = { dir: null, p: 0, want: null, t: 0 };
    var bl = { tok: 0, t: 0 }, gs = { tok: 0, t: 0, frames: null, i: 0, ret: -1 };

    function later(fn, ms) {
      var id = ++tid;
      timers[id] = T.set(function () { delete timers[id]; if (!destroyed) fn(); }, Math.max(0, ms));
      return id;
    }
    function cancel(id) { if (id && timers[id] !== undefined) { T.clear(timers[id]); delete timers[id]; } }
    function wonce(key, msg) { if (dev && !warned[key]) { warned[key] = 1; warn(msg); } }
    function ok(a) { return !!a && a.status === OK; }
    function allOk(o) { return !!o && o.frames && o.frames.length > 0 && o.frames.every(ok); }

    var layered = ok(M.base.body) && ok(M.base.head) && ok(M.base.visor_blank) &&
      allOk(L.eyes.neutral && { frames: [L.eyes.neutral.frames[0]] }) && ok(L.mouth.neutral);
    if (!layered) wonce('mode', 'Mode LEGACY: base/eyes-neutral/mouth-neutral modular belum AVAILABLE -> brain memakai sprite lama.');

    // ---------- resolve dengan fallback ----------
    function eyeOk(n) { var e = L.eyes[n]; return !!e && ok(e.frames[0]); }
    function pickChain(kind, name, test) {
      var chain = [name].concat(((M.fallback || {})[kind] || {})[name] || []);
      for (var i = 0; i < chain.length; i++) if (test(chain[i])) {
        if (i > 0) wonce(kind + ':' + name, kind + '/' + name + ' belum tersedia -> fallback ' + chain[i]);
        return chain[i];
      }
      wonce(kind + ':' + name, 'MISSING_ASSET ' + kind + '/' + name + ' tanpa fallback tersedia -> layer dilewati/dipertahankan');
      return null;
    }
    function eyeName(label) { return pickChain('eyes', LM.eyes && LM.eyes[label] || label, eyeOk); }
    function mouthName(label) { return pickChain('mouth', LM.mouth && LM.mouth[label] || label, function (n) { return ok(L.mouth[n]); }); }
    function faceName(mood) {
      /* Rantai fallback berjalan di ruang NAMA MOOD (fallbackMood = {amazed:'surprised', ...}); moodFace hanya memetakan mood -> nama face di tiap langkah.
       * (Dulu langkah pertama langsung memakai nama face hasil remap, sehingga fallbackMood[nama face] tidak ada dan overlay wajah hilang
       *  begitu face hasil remap belum AVAILABLE.) */
      var m = mood, hops = 0;
      while (m && hops++ < 6) {
        var cand = (M.moodFace && M.moodFace[m]) || m;
        if (ok(L.face[cand])) { if (m !== mood) wonce('face:' + mood, 'face/' + mood + ' belum tersedia -> ' + cand); return cand; }
        m = fallbackMood[m];
      }
      wonce('face:' + mood, 'MISSING_ASSET face/' + mood + ' -> overlay wajah dilewati');
      return null;
    }

    // ---------- DOM ----------
    function mk(tag, cls) { var e = doc.createElement(tag); if (cls) e.className = cls; return e; }
    function put(img, path) {
      if (!img) return;
      if (!path) { img.style.opacity = '0'; return; }
      img.style.opacity = '1';
      var full = base + path;
      if (img.getAttribute('src') !== full) img.src = full;
    }
    function mount() {
      var sprite = opts.sprite;
      if (!layered || !doc || !sprite || !sprite.parentNode) return;
      var parent = sprite.parentNode;
      if (!doc.getElementById(STYLE_ID)) {
        var st = doc.createElement('style'); st.id = STYLE_ID; st.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(st);
      }
      el.sprite = sprite; el.prevVis = sprite.style.visibility; sprite.style.visibility = 'hidden';
      el.stage = mk('div', 'lily-rig');
      el.body = mk('img', 'lily-rig-body');
      el.headWrap = mk('div', 'lily-rig-head');
      el.head = mk('img', 'lily-rig-headimg'); el.visor = mk('img', 'lily-rig-visor');
      el.face = mk('img', 'lily-rig-face'); el.eyes = mk('img', 'lily-rig-eyes'); el.mouth = mk('img', 'lily-rig-mouth');
      el.body.src = base + M.base.body.path; el.head.src = base + M.base.head.path; el.visor.src = base + M.base.visor_blank.path;
      [el.head, el.visor, el.face, el.eyes, el.mouth].forEach(function (e) { el.headWrap.appendChild(e); });
      el.stage.appendChild(el.body); el.stage.appendChild(el.headWrap);
      parent.appendChild(el.stage);
      el.eyes.style.opacity = '0'; el.mouth.style.opacity = '0'; el.face.style.opacity = '0';
    }

    // ---------- mata: statis + gaze frame-by-frame + kedip ----------
    function eyeStaticPath() { var n = eyeName(S.eyes); return n ? L.eyes[n].frames[0].path : null; }
    function renderEyes() {
      var path = null;
      if (gz.dir && gz.p > 0) path = L.eyes[gz.dir].frames[gz.p].path;
      else path = eyeStaticPath();
      put(el.eyes, path);
    }
    function gazeReady(d) { return !!L.eyes[d] && allOk(L.eyes[d]); }
    function stepGaze() {
      gz.t = 0;
      if (gz.dir !== gz.want) {
        if (gz.p > 0) gz.p--; else gz.dir = gz.want;
      } else if (gz.dir && gz.p < 4) gz.p++;
      renderEyes();
      var rest = (gz.dir === gz.want) && (!gz.dir || gz.p === 4);
      if (!rest) gz.t = later(stepGaze, 35);
    }
    function setGaze(dir) {
      var want = dir && dir !== 'idle' && gazeReady(dir) ? dir : null;
      if (dir && dir !== 'idle' && !want) wonce('gaze:' + dir, 'frame gaze "' + dir + '" belum lengkap -> tanpa animasi gaze (kepala tetap ikut via CSS)');
      gz.want = want;
      if (reduced) { cancel(gz.t); gz.t = 0; gz.dir = want; gz.p = want ? 4 : 0; renderEyes(); return; }
      if (!gz.t) stepGaze();
    }

    function cancelBlink() { bl.tok++; cancel(bl.t); bl.t = 0; }
    function blink(durMs) {
      if (!layered || reduced || !el.eyes) return false;
      var e = L.eyes.blink;
      if (!allOk(e)) { wonce('blink', 'frame blink belum lengkap -> brain memakai kedip CSS'); return false; }
      if (gz.p > 0 || gz.t) return false;                   // jangan kedip di tengah pergeseran gaze
      cancelBlink();
      var tok = bl.tok, i = 0, fm = Math.max(16, (durMs || 120) / e.frames.length);
      (function step() {
        if (tok !== bl.tok) return;
        if (i >= e.frames.length) { bl.t = 0; renderEyes(); return; }
        put(el.eyes, e.frames[i++].path);
        bl.t = later(step, fm);
      })();
      return true;
    }

    // ---------- gesture badan (frame body-only) ----------
    function bodyIdle() { put(el.body, M.base.body.path); }
    function gesture(name) {
      if (!layered || reduced || !el.body) return false;
      var gname = (M.gestureMap || {})[name];
      var g = gname && L.gesture[gname];
      if (!allOk(g)) { wonce('gest:' + name, 'gesture "' + name + '" belum tersedia -> brain memakai animasi CSS'); return false; }
      cancel(gs.t); gs.tok++;
      var tok = gs.tok;
      gs.frames = g.frames; gs.i = 0;
      gs.ret = -1; g.frames.forEach(function (f, k) { if (gs.ret < 0 && /return/.test(f.id)) gs.ret = k; });
      (function step() {
        if (tok !== gs.tok) return;
        if (gs.i >= gs.frames.length) { gs.t = 0; gs.frames = null; bodyIdle(); return; }
        var f = gs.frames[gs.i++];
        put(el.body, f.path);
        gs.t = later(step, /hold|peak/.test(f.id) ? 330 : 110);
      })();
      return true;
    }
    function stopGesture() {
      if (!gs.frames) return;
      if (gs.ret >= 0 && gs.i <= gs.ret) { gs.i = gs.ret; cancel(gs.t); gs.tok++; var tok = gs.tok; var fr = gs.frames; (function step() { if (tok !== gs.tok) return; if (gs.i >= fr.length) { gs.t = 0; gs.frames = null; bodyIdle(); return; } put(el.body, fr[gs.i++].path); gs.t = later(step, 90); })(); }
      else if (gs.ret < 0) { cancel(gs.t); gs.tok++; gs.frames = null; bodyIdle(); }
    }

    // ---------- API utama ----------
    function show(st) {
      if (!layered || !el.stage || destroyed) return false;
      st = st || {};
      cancelBlink();                                            // blink dihentikan aman bila state berubah
      S.eyes = st.eyes || 'neutral';
      var fn = faceName(st.mood || 'normal'), mn = mouthName(st.mouth || 'neutral');
      put(el.face, fn ? L.face[fn].path : null);
      put(el.mouth, mn ? L.mouth[mn].path : null);
      renderEyes();
      setGaze(st.dir);
      return true;
    }

    function destroy() {
      destroyed = true;
      Object.keys(timers).forEach(function (id) { T.clear(timers[id]); delete timers[id]; });
      if (el.stage && el.stage.parentNode) el.stage.parentNode.removeChild(el.stage);
      if (el.sprite) el.sprite.style.visibility = el.prevVis || '';
    }

    mount();
    return {
      get layered() { return layered && !destroyed; },
      show: show, blink: blink, gesture: gesture, stopGesture: stopGesture, destroy: destroy,
      _pending: function () { return Object.keys(timers).length; }, _el: el
    };
  }

  return { create: create };
});
