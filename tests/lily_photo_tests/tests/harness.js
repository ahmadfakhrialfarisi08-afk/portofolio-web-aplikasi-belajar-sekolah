/* Harness uji: lily_brain.js ASLI + lily_photo_reactions.js ASLI, jam virtual, rig palsu yang MEREKAM setiap rig.show().
 * ProfilePhotoAnalyzer = test double (file aslinya tidak ada di upload): kategori dibaca dari prefiks 'cat:' pada string foto. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { createCanvas } = require('canvas');

function makeSprite(opts) {            // gambar "maskot" sintetis: robot putih + hati pink (hanya untuk uji deteksi piksel)
  opts = opts || {};
  const c = createCanvas(256, 256), x = c.getContext('2d');
  if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(0, 0, 256, 256); }
  x.fillStyle = '#ffffff'; x.fillRect(70, 60, 116, 90); x.fillRect(90, 150, 76, 70);
  x.fillStyle = '#ff4fa3'; x.beginPath(); x.arc(128, 190, 18, 0, 7); x.fill();
  x.fillStyle = '#ff7ac0'; x.fillRect(95, 85, 66, 30);
  x.fillStyle = '#222'; x.fillRect(105, 95, 12, 12); x.fillRect(139, 95, 12, 12);
  return c.toDataURL('image/png');
}
function makeOther(kind) {
  const c = createCanvas(256, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  if (kind === 'sky') { g.addColorStop(0, '#2a7de1'); g.addColorStop(1, '#3fae49'); }
  else { g.addColorStop(0, '#8a5a2b'); g.addColorStop(1, '#e0b070'); }
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#222'; x.fillRect(100, 80, 60, 120);
  return c.toDataURL('image/png');
}

async function boot(brainPath, o) {
  o = o || {};
  const dom = new JSDOM('<!doctype html><body><div id="lily"><img class="lily-sprite" src=""><div class="lily-bubble"></div></div><img id="av"></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true, resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  // jam virtual
  let vnow = 1.7e12, seq = 0; const T = new Map();
  w.Date.now = () => vnow;
  w.setTimeout = (f, ms) => { const id = ++seq; T.set(id, { at: vnow + Math.max(0, ms || 0), f, iv: 0 }); return id; };
  w.setInterval = (f, ms) => { const id = ++seq; T.set(id, { at: vnow + ms, f, iv: ms }); return id; };
  w.clearTimeout = w.clearInterval = (id) => { T.delete(id); };
  let rs = o.seed || 1; w.Math.random = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  w.matchMedia = () => ({ matches: false });
  w.localStorage.clear();
  const rec = { show: [], say: [] };
  w.eval(fs.readFileSync(require('path').join(__dirname, 'stub_analyzer.js'), 'utf8'));
  w.eval(fs.readFileSync(o.reactionsPath, 'utf8'));
  w.eval(fs.readFileSync(brainPath, 'utf8'));
  const spriteUrl = makeSprite({ bg: 'rgba(0,0,0,0)' });
  const rig = {
    layered: true, _el: {}, show(st) { rec.show.push(Object.assign({ t: vnow }, st)); return true; },
    blink() { return false; }, gesture() { return false; }, stopGesture() {}, destroy() {}
  };
  const lily = new w.Lily({ root: '#lily', rig, sprites: { normal: spriteUrl, happy: spriteUrl }, debug: false, sapaan: 'Pak Joel' });
  const _say = lily._say; lily._say = function (plan, key) { if (plan.text) rec.say.push({ t: vnow, text: plan.text, mood: this.mood }); return _say.apply(this, arguments); };

  let slow = false;
  async function flush() { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); if (slow) await new Promise(r => setTimeout(r, 25)); }   // slow: beri waktu muat gambar NYATA (jam virtual tidak boleh melompati batas 2,5 dtk)
  async function run(ms) {
    const end = vnow + ms;
    for (;;) {
      await flush();
      let best = null, bid = 0;
      T.forEach((v, id) => { if (v.at <= end && (!best || v.at < best.at)) { best = v; bid = id; } });
      if (!best) break;
      vnow = Math.max(vnow, best.at);
      if (best.iv) best.at = vnow + best.iv; else T.delete(bid);
      try { best.f(); } catch (e) { rec.err = (rec.err || []).concat(String(e && e.stack || e)); }
    }
    vnow = end; await flush();
  }
  return { w, lily, rec, run, spriteUrl, slow: (v) => { slow = v; }, now: () => vnow, advanceClock: (ms) => { vnow += ms; } };
}
module.exports = { boot, makeSprite, makeOther };
