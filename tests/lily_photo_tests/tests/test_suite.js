const { boot, makeSprite, makeOther } = require('./harness');
const path = require('path');
if (!process.argv[2] || !process.argv[3]) { console.log('Pakai: node test_suite.js <lily_brain.js> <lily_photo_reactions.js>'); process.exit(1); }
const BRAIN = path.resolve(process.argv[2]), REACT = path.resolve(process.argv[3]);
let pass = 0, fail = 0; const fails = [];
function ok(c, msg) { if (c) pass++; else { fail++; fails.push(msg); } console.log((c ? '  PASS ' : '  FAIL ') + msg); }
const IMG = (s) => 'data:image/png;base64,' + Buffer.from('x' + s).toString('base64');
let uid = 0;

/* satu foto: (opsional lifecycle) -> reactToPhoto; kembalikan {emit(photo_done|__foto), shows, says, moodAt(t)} */
async function foto(L, cat, o, opt) {
  opt = opt || {}; o = o || {};
  L.w.__stubCat = cat; L.w.__stubConf = opt.conf;
  L.rec.show.length = 0; L.rec.say.length = 0;
  let ev = null; const emit0 = L.lily.emit;
  L.lily.emit = function (n, d, op) { if (n === 'photo_done' || /^__foto_/.test(n)) ev = { n: n, t: L.now(), mood: d && d.mood, beh: d && d.behavior, text: d && d.response }; return emit0.apply(this, arguments); };
  if (opt.flow !== false) { L.lily.photoFlow('selected', {}); await L.run(2000); L.lily.photoFlow('saving', {}); await L.run(1800); }
  const p = L.lily.reactToPhoto(opt.img || IMG(cat + (++uid)), Object.assign({ targetEl: L.w.document.getElementById('av') }, o));
  await L.run(opt.wait || 9000); await p; L.lily.emit = emit0;
  const moodAt = (t) => { let m = null; L.rec.show.forEach(s => { if (s.t <= t) m = s.mood; }); return m; };
  const r = { ev, shows: L.rec.show.slice(), says: L.rec.say.slice(), moodAt };
  await L.run(25000); L.advanceClock(700000);
  return r;
}
const sprites = new Set(); 

(async () => {
  console.log('\n[1] Mood konteks ikut sampai ke rig, dan BERTAHAN (tidak dipaksa jadi warm)');
  const L = await boot(BRAIN, { reactionsPath: REACT, seed: 7 });
  const cats = ['SCENERY', 'PORTRAIT_CLOSE', 'PORTRAIT_FAR', 'TWO_PEOPLE', 'GROUP', 'NO_FACE'];
  const finals = {};
  for (const c of cats) {
    const r = await foto(L, c);
    const m = r.ev && r.ev.mood;
    ok(!!r.ev && !!m, c + ': payload mood terkirim (' + m + ')');
    ok(r.shows.some(s => s.mood === m), c + ': mood "' + m + '" benar-benar masuk ke rig.show');
    ok(r.ev && r.moodAt(r.ev.t + 3600) === m, c + ': mood masih "' + m + '" di rig 3,6 dtk setelah reaksi mulai (aktual: ' + (r.ev && r.moodAt(r.ev.t + 3600)) + ')');
    ok(r.says.length === 1 && r.says[0].text.length > 8, c + ': ada kalimat -> "' + (r.says[0] || {}).text + '"');
    finals[c] = m;
  }
  ok(new Set(Object.values(finals)).size >= 4, 'ekspresi akhir berbeda antar kategori: ' + JSON.stringify(finals));
  ok(['amazed', 'excited', 'happy', 'surprised'].indexOf(finals.GROUP) >= 0, 'GROUP -> mood ramai/takjub (' + finals.GROUP + ')');
  ok(['calm', 'amazed', 'happy'].indexOf(finals.SCENERY) >= 0, 'SCENERY -> tenang/takjub/senang (' + finals.SCENERY + ')');

  console.log('\n[2] Foto tak dikenali / analyzer gagal -> curious/attentive, bukan datar');
  const UNK = [['UNKNOWN', {}], ['__null', {}], ['__throw', {}], ['GROUP', { conf: 0.2 }], ['__hang', { wait: 9000 }]];
  for (const [c, x] of UNK) {
    for (let k = 0; k < 3; k++) {
      const r = await foto(L, c, {}, { conf: x.conf, wait: x.wait });
      const m = r.ev && r.ev.mood;
      ok(['curious', 'attentive'].indexOf(m) >= 0 && r.says.length === 1, c + (x.conf ? '(conf rendah)' : '') + ' #' + (k + 1) + ': mood=' + m + ', kalimat="' + (r.says[0] || {}).text + '"');
    }
  }

  console.log('\n[3] Tidak selalu sama & tidak acak (6 foto GROUP berurutan, seed sama dua kali)');
  async function seri(seed) { const M = await boot(BRAIN, { reactionsPath: REACT, seed }); const a = []; for (let i = 0; i < 6; i++) a.push((await foto(M, 'GROUP')).ev.mood); return a; }
  const s1 = await seri(11), s2 = await seri(11), s3 = await seri(99);
  console.log('    seri seed11:', s1.join(','), '| ulang:', s2.join(','), '| seed99:', s3.join(','));
  ok(s1.every((m, i) => i === 0 || m !== s1[i - 1]), 'tidak ada mood sama dua kali berturut-turut');
  ok(new Set(s1).size >= 3, 'ekspresi bervariasi lewat seluruh mood yang cocok (' + new Set(s1).size + ' jenis)');
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'deterministik: input sama -> urutan mood sama');

  console.log('\n[4] Kalimat & wajah tidak bertentangan (coherentMood tidak mengubah mood terpilih), ~240 foto acak');
  const M4 = await boot(BRAIN, { reactionsPath: REACT, seed: 3 });
  const all = ['SCENERY', 'PORTRAIT_CLOSE', 'PORTRAIT_FAR', 'TWO_PEOPLE', 'GROUP', 'NO_FACE', 'UNKNOWN'];
  let bad = [], offtopic = [], n = 0;
  for (let i = 0; i < 240; i++) {
    const c = all[i % all.length];
    const r = await foto(M4, c, {}, { flow: i % 2 === 0, wait: 8000, img: IMG('v' + (i % 40)) });
    if (!r.ev || !r.says.length) { bad.push(c + ' tanpa reaksi/kalimat'); continue; }
    n++;
    const rawMood = r.ev.mood, t = r.says[0].text;
    if (M4.w.Lily.coherentMood(t, rawMood) !== rawMood) bad.push(c + ': "' + t + '" x ' + rawMood);
    if (/minum|lelah|harinya lancar|satu per satu|pelan-pelan saja hari ini/i.test(t)) offtopic.push(t);
  }
  ok(bad.length === 0, n + ' reaksi: setiap foto menghasilkan kalimat + mood yang koheren' + (bad.length ? ' | contoh: ' + bad.slice(0, 3).join(' ; ') : ''));
  ok(offtopic.length === 0, 'tidak ada kalimat "booster" di luar konteks foto' + (offtopic.length ? ': ' + offtopic[0] : ''));
  ok(!M4.rec.err, 'tidak ada exception di timer brain' + (M4.rec.err ? ': ' + M4.rec.err[0].split('\n')[0] : ''));

  console.log('\n[5] Maskot Lily dikenali dari PIKSEL (tanpa petunjuk UI) dan direspons khusus');
  const M5 = await boot(BRAIN, { reactionsPath: REACT, seed: 5 });
  const mascotPhoto = makeSprite({ bg: '#cfe8cf' }), otherPhoto = makeOther('sky'), otherPhoto2 = makeOther('brown');
  M5.slow(true);
  const r1 = await M5.lily._isLilyPhoto(mascotPhoto, {}), r2 = await M5.lily._isLilyPhoto(otherPhoto, {}), r3 = await M5.lily._isLilyPhoto(otherPhoto2, {});
  ok(r1 === true, 'gambar maskot (latar lain) dikenali');
  ok(r2 === false && r3 === false, 'foto lain TIDAK salah dikenali sebagai maskot');
  const { createCanvas } = require('canvas');
  const deco = (fn) => { const c = createCanvas(256, 256), x = c.getContext('2d'); fn(x); return c.toDataURL('image/png'); };
  const decoys = {
    'bunga pink di latar krem': deco(x => { x.fillStyle = '#f5ead0'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#ff4fa3'; x.beginPath(); x.arc(128, 128, 70, 0, 7); x.fill(); x.fillStyle = '#2e7d32'; x.fillRect(120, 190, 16, 66); }),
    'latar pink polos': deco(x => { x.fillStyle = '#ff7ac0'; x.fillRect(0, 0, 256, 256); }),
    'dua blok putih + pink acak': deco(x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#ff4fa3'; x.fillRect(10, 10, 60, 200); x.fillStyle = '#ccc'; x.fillRect(150, 20, 90, 60); }),
    'noise warna': deco(x => { for (let i = 0; i < 2000; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,50%)'; x.fillRect((i * 53) % 256, (i * 97) % 256, 12, 12); } })
  };
  for (const k of Object.keys(decoys)) ok(await M5.lily._isLilyPhoto(decoys[k], {}) === false, 'decoy "' + k + '" tidak dianggap maskot');
  for (const bg of ['#ffe0b2', '#b3e5fc', '#fff59d', '#222222']) ok(await M5.lily._isLilyPhoto(makeSprite({ bg }), {}) === true, 'maskot di latar polos ' + bg + ' dikenali');
  for (let k = 0; k < 3; k++) {
    const r = await foto(M5, 'PORTRAIT_CLOSE', {}, { img: makeSprite({ bg: ['#cfe8cf', '#ffe0b2', '#d1c4e9'][k] }) });
    ok(r.ev && r.ev.beh === 'photoMascot' && ['excited', 'happy', 'grateful'].indexOf(r.ev.mood) >= 0, 'maskot #' + (k + 1) + ': perilaku=' + (r.ev && r.ev.beh) + ', mood=' + (r.ev && r.ev.mood) + ', "' + (r.says[0] || {}).text + '"');
    ok(r.ev && r.moodAt(r.ev.t + 3600) === r.ev.mood, 'maskot #' + (k + 1) + ': ekspresi bertahan di rig (' + (r.ev && r.moodAt(r.ev.t + 3600)) + ')');
  }
  M5.slow(false);
  const rm = await foto(M5, 'PORTRAIT_CLOSE', { maskot: true }, { flow: false });
  ok(rm.ev && rm.ev.beh === 'photoMascot' && /Lily/.test(rm.ev.text || ''), 'jalur langsung (tanpa lifecycle) + petunjuk UI: photoMascot "' + (rm.ev && rm.ev.text) + '"');

  console.log('\n[6] Foto sama dipasang berulang tetap bereaksi & mood mengikuti nada kalimat riwayat');
  const M6 = await boot(BRAIN, { reactionsPath: REACT, seed: 21 });
  const same = IMG('fotoSama'); const out6 = [];
  for (let i = 0; i < 4; i++) { const r = await foto(M6, 'PORTRAIT_CLOSE', {}, { img: i % 2 ? same : IMG('lain' + i), flow: false }); out6.push((r.ev || {}).mood + ':' + ((r.says[0] || {}).text || 'TANPA KALIMAT')); }
  console.log('    ' + out6.join('\n    '));
  ok(out6.every(x => !/TANPA KALIMAT|^undefined/.test(x)), 'setiap pemasangan menghasilkan mood + kalimat');

  console.log('\n=== HASIL: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fail) console.log('GAGAL:\n - ' + fails.slice(0, 12).join('\n - '));
  process.exit(0);
})();
