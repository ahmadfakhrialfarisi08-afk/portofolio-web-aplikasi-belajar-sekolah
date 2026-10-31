const { boot } = require('./harness');
(async () => {
  for (const [label, brain, react] of [['UJI', require('path').resolve(process.argv[2]), require('path').resolve(process.argv[3])]]) {
    const L = await boot(brain, { reactionsPath: react, seed: 4 });
    const seq = [];
    const step = async (f, ms) => { f(); await L.run(ms); };
    L.w.__stubCat = 'SCENERY';
    await step(() => L.lily.photoFlow('open', {}), 1600); await step(() => L.lily.photoFlow('selected', {}), 2000);
    await step(() => L.lily.photoFlow('preview', {}), 2000); await step(() => L.lily.photoFlow('saving', {}), 1800);
    await step(() => L.lily.reactToPhoto('data:image/png;base64,QUJD', {}), 9000); await L.run(15000); L.advanceClock(700000);
    await step(() => L.lily.photoFlow('open', {}), 1600); await step(() => L.lily.photoFlow('cancel', {}), 4000);
    await step(() => L.lily.photoFlow('open', {}), 1600); await step(() => L.lily.photoFlow('error', { text: 'Ukuran foto terlalu besar.' }), 6000);
    await L.run(20000);
    await step(() => L.lily.emit('photo_changed', { pertama: true, ukur: { terang: 'cerah', warna: 'biru', nuansa: 'sejuk' } }), 8000);
    await L.run(20000);
    await step(() => L.lily.emit('greet'), 5000); await step(() => L.lily.emit('task_completed', {}), 6000);
    const says = L.rec.say.map(x => x.text);
    console.log(label.padEnd(6), 'exception timer:', L.rec.err ? L.rec.err[0].split('\n')[0] : 'tidak ada', '| kalimat terucap:', says.length, '| show() total:', L.rec.show.length);
  }
})();
