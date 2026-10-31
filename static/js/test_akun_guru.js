/* Tes halaman Akun Guru (jsdom). Memakai KODE ASLI: tab-akun + style + script dari dashboard_guru.html, serta fungsi asli
 * dashboard_guru.js (preferensi siswa, simpanBioGuru/loadBioGuru). switchTab & modal konfirmasi di-stub (aslinya bergantung pada seluruh dashboard).
 * Jalankan: NODE_PATH=<node_modules> node test_akun_guru.js ../dashboard_guru.html ../../dashboard_guru.js   (js asli: /mnt/user-data/uploads/dashboard_guru.js) */
const fs = require('fs'); const { JSDOM } = require('jsdom');
const H = fs.readFileSync(process.argv[2] || '../dashboard_guru.html', 'utf8').replace(/\r/g, '');
const J = fs.readFileSync(process.argv[3] || '/mnt/user-data/uploads/dashboard_guru.js', 'utf8').replace(/\r/g, '');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', m); };
const tick = () => new Promise(r => setTimeout(r, 15));
const between = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker tidak ketemu: ' + a); return s.slice(i, j); };

const sec = H.match(/<section id="tab-akun"[\s\S]*?\n            <\/section>\n\n            <section id="tab-about-us"/)[0].replace(/\n            <section id="tab-about-us"$/, '');
const style = H.match(/<style id="gaya-guru-akun">([\s\S]*?)<\/style>/)[1];
const akunJs = H.match(/<script id="guru-akun">([\s\S]*?)<\/script>/)[1];
const sidebarBtn = H.match(/<button type="button" onclick="switchTab\('akun'\)"[\s\S]*?<\/button>/)[0];
const panelBtn = H.match(/<button type="button" onclick="guruBukaAkun\(\)"[\s\S]*?<\/button>/)[0];
const temaJs = between(H, 'function guruSinkronTombolTema()', "document.addEventListener('DOMContentLoaded', guruSinkronTombolTema);");
const navJs = between(H, 'function guruSetBottomNavAktif(', 'function guruBottomNavGoTab(');
const prefJs = between(J, 'function kunciTampilanDefaultGuru()', 'function mapBorderIdKeTampilanGuru');
const bioJs = between(J, 'function simpanBioGuru()', '/* ============================================================\n           FITUR KONFIRMASI PRESTASI');
const fotoJs = between(J, 'function toggleProfileDropdownGuru(event)', 'window.addEventListener(\'click\'') + between(J, 'function openExpandedPhotoGuru(event)', 'function closeExpandedPhotoGuru()');
const R = s => s.replace(/\{\{ username \}\}/g, 'Budi Santoso').replace(/\{\{ login_username \}\}/g, 'budi.s').replace(/\{\{ url_for\('logout'\) \}\}/g, '/logout');

function boot(o) {
  o = o || {};
  const html = `<!doctype html><html><head></head><body data-login-username="budi.s" data-nama-guru-login="Budi Santoso">
   <aside><div id="sidebar-menu"><button class="nav-btn" id="btn-beranda" onclick="switchTab('beranda')"></button>${R(sidebarBtn)}</div></aside>
   <div id="profile-dropdown-guru" class="hidden"><img id="dropdown-user-avatar-guru" src="https://x.test/default.jpg"><input type="file" id="input-ganti-foto-guru"><textarea id="input-bio-guru"></textarea>${panelBtn}</div>
   <div id="modal-expanded-foto-guru" class="hidden"><img id="expanded-foto-guru-img"></div>
   <main><section id="tab-beranda" class="tab-content"></section>${R(sec)}<section id="tab-about-us" class="tab-content hidden"></section></main>
   <nav><button id="bottomnav-btn-profil" class="guru-bottom-nav-item"></button><button class="guru-bottom-nav-item" data-tab="beranda"></button></nav>
   <button id="btn-dark-mode-toggle"></button>
   <button data-toggle-default-siswa><i></i><span class="label-toggle-default-siswa"></span></button>
   <style>${style}</style></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dashboard/guru' });
  const w = dom.window, d = w.document; w.__alerts = []; w.alert = m => w.__alerts.push(m);
  if (o.beforeLoad) o.beforeLoad(w);
  w.eval(`
    function switchTab(id){ document.querySelectorAll('.tab-content').forEach(function(e){e.classList.add('hidden')}); document.getElementById('tab-'+id).classList.remove('hidden'); window.__tab=id; }
    window.__modal=null; function bukaModalKonfirmasiGenerik(o){ window.__modal=o; }
    ${temaJs}\n${navJs}\n${prefJs}\n${bioJs}\n${fotoJs}
    window.toggleDarkMode=toggleDarkMode; window.simpanBioGuru=simpanBioGuru; window.loadBioGuru=loadBioGuru;
    window.guruSinkronTombolTema=guruSinkronTombolTema; window.guruSetBottomNavAktif=guruSetBottomNavAktif;
    window.toggleTampilanDefaultSiswaGuru=toggleTampilanDefaultSiswaGuru; window.tampilanDefaultGuruAktif=tampilanDefaultGuruAktif;
    window.kunciTampilanDefaultGuru=kunciTampilanDefaultGuru; window.perbaruiTombolTampilanDefaultGuru=perbaruiTombolTampilanDefaultGuru;
    window.toggleProfileDropdownGuru=toggleProfileDropdownGuru; window.openExpandedPhotoGuru=openExpandedPhotoGuru;
    window.switchTab=switchTab; window.bukaModalKonfirmasiGenerik=bukaModalKonfirmasiGenerik;
  `);
  const logs = []; w.console.error = m => logs.push(String(m)); w.addEventListener('error', e => logs.push(e.message));
  w.document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href*="/logout"]'); if (a) w.__riwayatDihapus = (w.__riwayatDihapus || 0) + 1; });   // meniru handler hapus riwayat chat (html asli)
  w.eval(akunJs);
  return { w, d, logs, $: id => d.getElementById(id) };
}
const klik = (t, el) => el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));
const ketik = (t, v) => { const b = t.$('akun-bio'); b.value = v; b.dispatchEvent(new t.w.Event('input', { bubbles: true })); };

(async () => {
  console.log('1. Struktur & CSS');
  { const t = boot();
    ok(t.$('tab-akun').classList.contains('hidden') && t.$('tab-akun').classList.contains('tab-content'), 'tab-akun tersembunyi bawaan & dikenali sebagai tab-content');
    ok(!/\.akun-page\s*\{[^}]*display\s*:/.test(style), 'CSS .akun-page tidak menimpa display (kelas hidden tetap bekerja)');
    ok(/\.akun-page \[hidden\]/.test(style) && /html\.dark \.akun-page/.test(style), 'ada aturan [hidden] & varian mode gelap');
    ok(t.$('btn-akun') && /switchTab\('akun'\)/.test(t.$('btn-akun').getAttribute('onclick')), 'tombol sidebar Akun Saya memanggil switchTab(\'akun\')');
    ok(t.$('akun-keluar').getAttribute('href') === '/logout', 'Keluar memakai rute /logout (terverifikasi di app.py)');
    ok(!/password|kata sandi/i.test(sec) && !/<form/i.test(sec), 'tidak ada fitur ganti password / form buatan');
    ok(t.d.querySelector('.akun-nama').textContent === 'Budi Santoso' && t.d.querySelector('.akun-user').textContent === '@budi.s', 'nama & username dari data yang tersedia'); }

  console.log('2. Buka halaman: sinkron avatar, bio dimuat, tab lain tersembunyi');
  { const t = boot({ beforeLoad: w => w.localStorage.setItem('guru_bio', 'Guru TKJ') });
    t.w.switchTab('akun'); await tick();
    ok(!t.$('tab-akun').classList.contains('hidden') && t.$('tab-beranda').classList.contains('hidden'), 'tab Akun tampil, Beranda tersembunyi');
    ok(t.$('akun-avatar-img').src === 'https://x.test/default.jpg', 'foto mengikuti avatar existing');
    ok(t.$('akun-bio').value === 'Guru TKJ' && t.$('akun-bio-simpan').disabled && t.$('akun-bio-batal').hidden, 'bio dimuat dari kunci guru_bio; Simpan nonaktif karena belum ada perubahan');
    t.w.switchTab('about-us'); ok(t.$('tab-akun').classList.contains('hidden'), 'pindah ke tab lain menyembunyikan Akun'); }

  console.log('3. Bio: ubah, simpan, batal, kompatibel dengan handler lama');
  { const t = boot(); t.w.switchTab('akun'); await tick();
    ketik(t, 'Guru Produktif TKR'); ok(!t.$('akun-bio-simpan').disabled && !t.$('akun-bio-batal').hidden && !t.$('akun-bio-belum').hidden && t.$('akun-bio-hitung').textContent === '18/120', 'perubahan terdeteksi: Simpan aktif, Batal & "belum disimpan" muncul, penghitung benar');
    klik(t, t.$('akun-bio-simpan'));
    ok(t.w.localStorage.getItem('guru_bio') === 'Guru Produktif TKR', 'tersimpan di kunci guru_bio');
    ok(t.$('input-bio-guru').value === 'Guru Produktif TKR', 'textarea panel profil lama ikut sinkron');
    t.$('input-bio-guru').value = ''; t.w.loadBioGuru(); ok(t.$('input-bio-guru').value === 'Guru Produktif TKR', 'loadBioGuru() ASLI membaca bio yang disimpan halaman Akun');
    ok(/berhasil disimpan/i.test(t.$('akun-bio-status').textContent) && t.$('akun-bio-status').classList.contains('ok'), 'umpan balik sukses tampil');
    ok(t.$('akun-bio-simpan').disabled && t.$('akun-bio-batal').hidden, 'setelah simpan: tombol kembali nonaktif');
    ketik(t, 'abc'); klik(t, t.$('akun-bio-batal')); ok(t.$('akun-bio').value === 'Guru Produktif TKR' && t.$('akun-bio-simpan').disabled, 'Batal mengembalikan nilai tersimpan');
    t.$('input-bio-guru').value = 'Dari panel lama'; t.w.simpanBioGuru(); t.w.switchTab('beranda'); t.w.switchTab('akun'); await tick();
    ok(t.$('akun-bio').value === 'Dari panel lama', 'bio yang disimpan lewat handler lama muncul saat halaman Akun dibuka'); }

  console.log('4. Bio: penyimpanan gagal & storage tidak tersedia');
  { const t = boot(); t.w.switchTab('akun'); await tick(); ketik(t, 'baru');
    const asli = t.w.Storage.prototype.setItem; t.w.Storage.prototype.setItem = function () { throw new Error('QuotaExceeded'); };
    klik(t, t.$('akun-bio-simpan')); t.w.Storage.prototype.setItem = asli;
    ok(/gagal disimpan/i.test(t.$('akun-bio-status').textContent) && t.$('akun-bio-status').classList.contains('err'), 'error ditampilkan jelas (bukan alert)');
    ok(!t.$('akun-bio-simpan').disabled && t.$('akun-bio-belum').hidden === false, 'perubahan tidak hilang; tetap bisa dicoba lagi');
    const u = boot({ beforeLoad: w => { w.Storage.prototype.getItem = function () { throw new Error('SecurityError'); }; } }); u.w.switchTab('akun'); await tick();
    ok(u.$('akun-bio').disabled && /tidak tersedia/i.test(u.$('akun-bio-status').textContent), 'storage diblokir: textarea nonaktif + penjelasan'); }

  console.log('5. Peringatan perubahan belum disimpan');
  { const t = boot(); t.w.switchTab('akun'); await tick(); ketik(t, 'draft');
    const e = new t.w.Event('beforeunload', { cancelable: true }); t.w.dispatchEvent(e); ok(e.defaultPrevented, 'beforeunload memperingatkan saat ada draft');
    klik(t, t.$('akun-bio-simpan')); const e2 = new t.w.Event('beforeunload', { cancelable: true }); t.w.dispatchEvent(e2); ok(!e2.defaultPrevented, 'tanpa peringatan setelah disimpan'); }

  console.log('6. Mode gelap memakai toggleDarkMode() asli');
  { const t = boot(); t.w.switchTab('akun'); await tick(); const sk = t.$('akun-gelap');
    ok(sk.getAttribute('aria-checked') === 'false', 'awal: terang'); klik(t, sk);
    ok(t.d.documentElement.classList.contains('dark') && sk.getAttribute('aria-checked') === 'true' && t.w.localStorage.getItem('guru-tema') === 'gelap', 'klik: class dark + tersimpan guru-tema=gelap + saklar aktif');
    ok(/Mode gelap aktif/i.test(t.$('akun-pref-status').textContent), 'umpan balik tampil');
    t.w.toggleDarkMode(); await tick(); ok(sk.getAttribute('aria-checked') === 'false', 'saklar ikut sinkron saat tombol tema HEADER dipakai'); }

  console.log('7. Preferensi tampilan siswa memakai fungsi asli');
  { const t = boot(); t.w.switchTab('akun'); await tick(); const b = t.d.querySelector('#tab-akun [data-toggle-default-siswa]');
    klik(t, b); await tick();
    ok(t.w.localStorage.getItem('guru_tampilan_default_siswa_budi.s') === '1', 'tersimpan per-username (kunci asli)');
    ok(b.querySelector('.label-toggle-default-siswa').textContent === 'Kembalikan Efek Siswa' && b.getAttribute('aria-pressed') === 'true' && b.classList.contains('aktif'), 'label/aria/kelas aktif diperbarui oleh fungsi asli');
    ok(/Tersimpan di browser ini/.test(t.$('akun-pref-status').textContent), 'umpan balik sukses');
    klik(t, b); ok(t.w.localStorage.getItem('guru_tampilan_default_siswa_budi.s') === '0' && /dikembalikan/i.test(t.$('akun-pref-status').textContent), 'klik lagi mengembalikan');
    const asli = t.w.Storage.prototype.setItem; t.w.Storage.prototype.setItem = function () { throw new Error('x'); }; klik(t, b); t.w.Storage.prototype.setItem = asli;
    ok(t.$('akun-pref-status').classList.contains('err'), 'gagal simpan: pesan error jujur'); }

  console.log('8. Foto memakai input & handler lama');
  { const t = boot(); t.w.switchTab('akun'); await tick(); let n = 0; t.$('input-ganti-foto-guru').addEventListener('click', () => n++);
    klik(t, t.$('akun-ganti-foto')); ok(n === 1, 'Ganti Foto memicu #input-ganti-foto-guru (jalur crop/zoom/Lily lama)');
    t.$('dropdown-user-avatar-guru').src = 'data:image/png;base64,AAAA'; await tick();
    ok(t.$('akun-avatar-img').src.startsWith('data:image/png'), 'foto baru langsung tampil di halaman Akun');
    klik(t, t.d.querySelector('.akun-avatar')); ok(!t.$('modal-expanded-foto-guru').classList.contains('hidden') && t.$('expanded-foto-guru-img').src.startsWith('data:'), 'klik foto memakai openExpandedPhotoGuru() asli'); }

  console.log('9. Keluar: konfirmasi dulu, riwayat chat dihapus HANYA setelah setuju');
  { const t = boot(); const a = t.$('akun-keluar'); const e = new t.w.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(e);
    ok(e.defaultPrevented && t.w.__modal && /Keluar/.test(t.w.__modal.judul), 'klik pertama: dicegat, modal konfirmasi tampil');
    ok(!t.w.__riwayatDihapus, 'batal/belum setuju: riwayat chat tidak dihapus');
    const e2 = new t.w.MouseEvent('click', { bubbles: true, cancelable: true }); let nav = false; t.w.addEventListener('beforeunload', () => {}); t.w.__modal.onKonfirmasi();
    ok(t.w.__riwayatDihapus === 1, 'setelah setuju: handler hapus-riwayat existing ikut jalan tepat sekali'); }

  console.log('10. Masuk dari panel profil lama & navigasi bawah');
  { const t = boot(); t.$('profile-dropdown-guru').classList.remove('hidden'); klik(t, t.d.querySelector('#profile-dropdown-guru button')); await tick();
    ok(t.w.__tab === 'akun' && t.$('profile-dropdown-guru').classList.contains('hidden'), 'tombol di panel: tutup panel + buka tab Akun');
    ok(t.$('bottomnav-btn-profil').classList.contains('is-active'), 'tombol Profil di navigasi bawah ditandai aktif');
    ok(t.$('input-ganti-foto-guru') && t.$('input-bio-guru') && t.$('dropdown-user-avatar-guru'), 'elemen & ID panel lama tetap ada'); }

  console.log('11. Tanpa error konsol');
  { const t = boot(); t.w.switchTab('akun'); await tick(); ketik(t, 'x'); klik(t, t.$('akun-bio-simpan')); klik(t, t.$('akun-gelap')); ok(t.logs.length === 0, 'tidak ada error: ' + JSON.stringify(t.logs)); }

  console.log('\nHASIL: ' + pass + ' lulus, ' + fail + ' gagal'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
