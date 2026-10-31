const { JSDOM } = require('jsdom');
function run(rigPath, label) {
  const Rig = require(rigPath);
  const dom = new JSDOM('<body><div id="s"><img class="sp"></div></body>');
  const A = (p) => ({ status: 'AVAILABLE', path: p }), N = (p) => ({ status: 'MISSING', path: p });
  const M = {
    base: { body: A('b.png'), head: A('h.png'), visor_blank: A('v.png') },
    layers: {
      eyes: { neutral: { frames: [A('e_n.png')] } }, mouth: { neutral: A('m_n.png') },
      face: { normal: A('f_normal.png'), happy: A('f_happy.png'), surprised: A('f_surprised.png'), face_amazed_v2: N('f_amazed_v2.png'), face_curious_v2: A('f_curious_v2.png'), warm: N('f_warm.png') },
      gesture: {}
    },
    // moodFace: remap nama mood -> nama face (aset ber-versi). amazed -> face_amazed_v2 (BELUM tersedia), curious -> face_curious_v2 (ada)
    moodFace: { amazed: 'face_amazed_v2', curious: 'face_curious_v2' },
    fallback: {}, labelMap: {}
  };
  const FB = { amazed: 'surprised', warm: 'happy', happy: 'normal', surprised: 'normal', curious: 'normal' };
  const rig = Rig.create({ manifest: M, document: dom.window.document, sprite: dom.window.document.querySelector('.sp'), fallbackMood: FB, reducedMotion: true, timers: { set: () => 0, clear: () => {} } });
  const faceSrc = (mood) => { rig.show({ mood, eyes: 'neutral', mouth: 'neutral', dir: 'idle' }); const f = rig._el.face; return f.style.opacity === '0' ? '(OVERLAY WAJAH HILANG)' : f.getAttribute('src'); };
  console.log(label);
  console.log('  layered:', rig.layered);
  [['happy', 'f_happy.png'], ['curious', 'f_curious_v2.png'], ['amazed', 'f_surprised.png'], ['warm', 'f_happy.png']].forEach(([m, want]) => {
    const got = faceSrc(m); console.log('  ' + (got === '/' + want ? 'PASS' : 'FAIL'), m.padEnd(8), '->', got, '(harap ' + want + ')');
  });
}
const path = require('path');
run(path.resolve(process.argv[2] || '../../static/js/lily_rig.js'), 'RIG: ' + (process.argv[2] || '../../static/js/lily_rig.js'));
