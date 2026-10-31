/* Tes lily_poses.js + hook di lily_brain.js (jsdom, tanpa browser sungguhan; fetch & gambar di-mock).
 * Jalankan: cd lily_ekspresi_baru && npm i jsdom && node test/test_lily_poses.js */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const BRAIN = fs.readFileSync(path.join(ROOT, 'lily_brain.js'), 'utf8');
const POSES = fs.readFileSync(path.join(ROOT, 'lily_poses.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

function boot(o) {
  o = o || {};
  const dom = new JSDOM('<!doctype html><body><div class="lily" id="l"><div class="lily-body"><img class="lily-sprite" src="n.png"></div><div class="lily-bubble"></div></div></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  const missing = o.missing || [];
  w.Image = function () { const im = this; Object.defineProperty(im, 'src', { set(v) { im._s = v; setTimeout(() => (missing.some(m => v.includes(m)) ? im.onerror : im.onload) && (missing.some(m => v.includes(m)) ? im.onerror : im.onload)(), 5); }, get() { return im._s; } }); };
  w.fetch = o.fetch || (() => Promise.reject(new Error('no fetch')));
  w.AbortController = AbortController;
  if (o.poses !== false) w.eval(POSES);
  w.eval(BRAIN);
  const seq = [];
  const root = w.document.getElementById('l');
  new w.MutationObserver(() => { const p = root.getAttribute('data-pose'); if (seq[seq.length - 1] !== (p || null)) seq.push(p || null); })
    .observe(root, { attributes: true, attributeFilter: ['data-pose'] });
  const lily = new w.Lily({ root, sprites: { normal: 'a.png', happy: 'b.png', thinking: 'c.png', concerned: 'd.png', blink: 'e.png' } });
  return { w, lily, root, seq };
}
const json = (d, st) => () => new Promise(r => setTimeout(() => r({ ok: st === undefined || st < 400, status: st || 200, json: () => Promise.resolve(d) }), 1800));
const OKR = { success: true, mood: 'happy', behavior: 'observe', attention: 'user', response: 'GPON adalah teknologi fiber.', message_type: 'assistant_ai' };

(async () => {
  console.log('1. Tanpa lily_poses.js -> perilaku lama utuh');
  { const t = boot({ poses: false, fetch: json(OKR) });
    await t.lily.reactToText('apa itu GPON?'); await sleep(300);
    ok(!t.root.querySelector('.lily-pose-layer') && t.seq.length === 0, 'tidak ada layer/atribut pose'); ok(t.lily.poses === null, 'lily.poses null'); }

  console.log('2. Lima aset dimuat & file ada');
  { const t = boot({ fetch: json(OKR) }); await sleep(1700);
    const names = ['confused','searching','lost','menemukan_jawaban','curious'];
    ok(names.every(n => t.lily.poses._ready[n]), 'kelima pose preload OK');
    ok(names.every(n => fs.existsSync(path.join(ROOT, 'lily_poses', 'pose_' + n + '.png'))), 'kelima file PNG ada di folder'); }

  console.log('3. Jawaban sukses: searching -> menemukan_jawaban -> kembali');
  { const t = boot({ fetch: json(OKR) }); await sleep(1700);
    await t.lily.reactToText('apa itu GPON?'); await sleep(2200);
    console.log('   urutan:', JSON.stringify(t.seq));
    ok(t.seq[0] === 'searching' && !t.seq.includes('curious'), 'mulai langsung searching (curious tidak dipakai di awal)');
    ok(t.seq.indexOf('menemukan_jawaban') > t.seq.indexOf('searching'), 'menemukan_jawaban baru muncul SETELAH jawaban diterima');
    ok(!t.seq.slice(0, t.seq.indexOf('menemukan_jawaban')).includes('menemukan_jawaban') && !t.seq.includes('thinking') && t.seq.filter(x => x === 'searching').length === 1, 'searching stabil, tidak berkedip');
    ok(t.root.getAttribute('data-pose') === null, 'pose dilepas setelah selesai (tidak terkunci)'); }

  console.log('4. Error jaringan: lost, tidak pernah menemukan_jawaban');
  { const t = boot({ fetch: () => new Promise((_, r) => setTimeout(() => r(new Error('net')), 1800)) }); await sleep(1700);
    await t.lily.reactToText('apa itu GPON?'); await sleep(2300);
    console.log('   urutan:', JSON.stringify(t.seq));
    ok(t.seq.includes('lost') && !t.seq.includes('menemukan_jawaban') && !t.seq.includes('curious'), 'lost, bukan menemukan_jawaban'); ok(t.root.getAttribute('data-pose') === null, 'pose dilepas'); }

  console.log('5. Fallback server (success:false/assistant_local): lost');
  { const t = boot({ fetch: json({ success: false, mood: 'concerned', behavior: 'apologize', response: 'Maaf.', message_type: 'assistant_local' }) }); await sleep(1700);
    await t.lily.reactToText('apa itu GPON?'); await sleep(2300);
    ok(t.seq.includes('lost') && !t.seq.includes('menemukan_jawaban'), 'fallback server -> lost, bukan menemukan_jawaban'); }

  console.log('6. Jawaban empatik (concerned/assistant_ai): tanpa menemukan_jawaban');
  { const t = boot({ fetch: json({ success: true, mood: 'empathetic', behavior: 'observe', response: 'Semangat ya.', message_type: 'assistant_ai' }) }); await sleep(1700);
    await t.lily.reactToText('saya capek sekali'); await sleep(2300);
    ok(!t.seq.includes('menemukan_jawaban') && !t.seq.includes('lost'), 'tidak ada menemukan_jawaban/lost'); }

  console.log('6b. Data tidak ditemukan (AI sukses tapi mood uncertain): curious');
  { const t = boot({ fetch: json({ success: true, mood: 'uncertain', behavior: 'observe', response: 'Lily belum menemukan datanya.', message_type: 'assistant_ai' }) }); await sleep(1700);
    await t.lily.reactToText('siapa kepala bengkel tahun 2031?'); await sleep(2300);
    console.log('   urutan:', JSON.stringify(t.seq));
    ok(t.seq.includes('curious') && !t.seq.includes('menemukan_jawaban'), 'curious, bukan menemukan_jawaban'); }

  console.log('7. Token habis (exhausted): tidak menemukan_jawaban/lost');
  { const t = boot({ fetch: json({ success: false, code: 'api_exhausted', message_type: 'api_exhausted', mood: 'concerned', response: 'habis' }) }); await sleep(1700);
    await t.lily.reactToText('apa itu GPON?'); await sleep(2300);
    ok(!t.seq.includes('menemukan_jawaban') && !t.seq.includes('lost'), 'tidak ada menemukan_jawaban/lost'); }

  console.log('8. Sapaan lokal & cache (tanpa ai_start): tanpa pose');
  { const t = boot({ fetch: json(OKR) }); await sleep(1700);
    await t.lily.reactToText('halo'); await sleep(500);
    ok(t.seq.length === 0, 'halo -> tidak ada pose'); }

  console.log('9. ai_confused -> confused');
  { const t = boot({}); await sleep(1700); t.lily.emit('ai_confused'); await sleep(1200);
    ok(t.seq.includes('confused'), 'pose confused tampil'); await sleep(9500); ok(t.root.getAttribute('data-pose') === null, 'pose dilepas setelah balon & perilaku selesai'); }

  console.log('10. Aset menemukan_jawaban hilang: fallback ke sprite lama, tanpa error');
  { const t = boot({ missing: ['pose_menemukan_jawaban'], fetch: json(OKR) }); await sleep(1700);
    let err = null; try { await t.lily.reactToText('apa itu GPON?'); await sleep(2200); } catch (e) { err = e; }
    ok(!err && !t.seq.includes('menemukan_jawaban') && t.seq.includes('searching'), 'tanpa menemukan_jawaban, alur lain tetap jalan'); }

  console.log('11. Pertanyaan berurutan 3x + beruntun 4x: tidak macet');
  { const t = boot({ fetch: json(OKR) }); await sleep(1700);
    for (let i = 0; i < 3; i++) { await t.lily.reactToText('pertanyaan berurutan ' + i + ' tentang GPON'); await sleep(2500); }   // berurutan (jawaban sudah diterima)
    for (let i = 0; i < 4; i++) { t.lily.reactToText('pertanyaan beruntun ' + i + ' tentang GPON'); await sleep(900); }   // beruntun cepat (tumpang tindih)
    await sleep(5000);
    console.log('   urutan:', JSON.stringify(t.seq));
    ok(t.seq.filter(x => x === 'searching').length >= 3, 'tiap pertanyaan memulai alur lagi (searching >= 3x)'); ok(t.root.getAttribute('data-pose') === null, 'pose akhir bersih'); ok(t.lily.cur.name === 'idle' || t.lily.cur.name, 'state hidup (' + t.lily.cur.name + ')'); }

  console.log('12. Ekspresi/mood lama tetap bisa dipanggil');
  { const t = boot({}); 
    const moods = t.w.Lily.MOODS; let e = null; try { moods.forEach(m => t.lily._render(m, 'user')); } catch (x) { e = x; }
    ok(!e && moods.length >= 28, 'semua ' + moods.length + ' mood lama render tanpa error'); ok(t.root.getAttribute('data-pose') === null, '_render lama tidak menyentuh pose'); }

  console.log('\nHASIL: ' + pass + ' lulus, ' + fail + ' gagal'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
