/* LILY PHOTO REACTIONS -- pemetaan hasil ProfilePhotoAnalyzer ke sistem Lily yang sudah ada.
 *
 *   kategori -> moods (DAFTAR ekspresi berurutan, paling cocok dulu) -> behavior (animasi, dari BEHAVIORS di lily_brain.js) -> kalimat
 *   build() TIDAK memilih mood secara acak: ia mengembalikan daftar berurutan; lily_brain._photoMood yang memilih berdasarkan konteks
 *   (riwayat foto, data terukur, kalimat terpilih) dan memutarnya agar tidak sama dua kali berturut-turut.
 *
 * Tidak membuat Lily baru: hanya memilih mood/behavior yang SUDAH ada (photoReact, photoNotice) dan kalimat.
 * Kalimat memakai 'Pak/Bu' yang nanti diganti sapaan nyata oleh Lily._sapa().
 * Aturan isi: tidak menebak usia/identitas/hubungan antarorang; kalimat hanya menyatakan hal yang
 * memang diketahui detector (jumlah wajah, ukuran relatif) dan dihedge bila hanya perkiraan heuristik.
 */
(function (global) {
  'use strict';

  var REAKSI = {
    SCENERY: {
      moods: ['calm', 'amazed', 'happy'], behavior: 'photoReact',
      lines: ['Wah, pemandangan! Lily jadi ikut tenang melihatnya, Pak/Bu.',
              'Fotonya luas dan lega ya, Pak/Bu. Lily kagum!',
              'Kelihatannya seperti pemandangan. Enak sekali dipandang, Pak/Bu.',
              'Suasananya bikin Lily seperti ikut liburan sebentar, Pak/Bu.',
              'Fotonya bernuansa alam, ya? Lily jadi tenang, Pak/Bu.']
    },
    PORTRAIT_CLOSE: {
      moods: ['happy', 'warm', 'proud'], behavior: 'photoReact',
      lines: ['Fotonya dekat dan jelas, Pak/Bu. Profilnya jadi terasa lebih personal!',
              'Wah, foto profil yang jelas sekali, Pak/Bu. Lily senang melihatnya.',
              'Foto barunya jelas dan enak dilihat, Pak/Bu. Cocok untuk profil!',
              'Lily suka fotonya, Pak/Bu. Profilnya jadi lebih hidup!',
              'Fotonya pas untuk profil, Pak/Bu. Lily senang!']
    },
    PORTRAIT_FAR: {
      moods: ['warm', 'curious', 'calm'], behavior: 'photoReact',
      lines: ['Fotonya diambil dari agak jauh ya, Pak/Bu. Lily jadi penasaran suasananya.',
              'Ada seseorang di foto, tapi agak jauh. Latarnya ikut terlihat, Pak/Bu.',
              'Foto barunya sudah terpasang, Pak/Bu. Kalau mau lebih dekat, bisa diatur lewat zoom ya.',
              'Komposisinya luas, Pak/Bu. Lily suka melihat suasananya.']
    },
    TWO_PEOPLE: {
      moods: ['happy', 'warm', 'curious'], behavior: 'photoReact',
      lines: ['Ada dua orang di foto ini ya, Pak/Bu. Kelihatannya seru!',
              'Fotonya berdua nih, Pak/Bu. Lily ikut senang melihatnya.',
              'Dua orang dalam satu foto, ya. Komposisinya rapi, Pak/Bu.',
              'Kali ini bukan foto sendirian, Pak/Bu. Lily jadi penasaran ceritanya.']
    },
    GROUP: {
      moods: ['amazed', 'excited', 'happy'], behavior: 'photoNotice',
      lines: ['Wah, ramai sekali fotonya, Pak/Bu! Lily jadi ikut semangat.',
              'Banyak orang dalam satu foto. Kelihatannya meriah, Pak/Bu!',
              'Foto ramai-ramai ya, Pak/Bu. Lily langsung penasaran acaranya.',
              'Lily lihat ada banyak orang di foto ini, Pak/Bu. Seru!']
    },
    NO_FACE: {
      moods: ['curious', 'playful', 'warm'], behavior: 'photoNotice',
      lines: ['Sepertinya fotonya bukan potret wajah ya, Pak/Bu. Unik, Lily suka!',
              'Fotonya sederhana dan rapi, Pak/Bu. Lily suka.',
              'Lily tidak melihat wajah di foto ini, tapi tampilannya tetap menarik, Pak/Bu.',
              'Wah, foto profil yang tidak biasa, Pak/Bu. Lily jadi penasaran maksudnya.']
    },
    UNKNOWN: {                                    // isi foto tidak diketahui: penasaran/memperhatikan (bukan datar), tanpa klaim spesifik tentang isi foto
      moods: ['curious', 'attentive'], behavior: 'photoNotice',
      lines: ['Eh, ada yang baru di profil, Pak/Bu. Lily jadi penasaran!',
              'Fotonya sudah diganti ya, Pak/Bu. Lily langsung sadar lho.',
              'Lily perhatikan fotonya baru, Pak/Bu. Menarik, ya!',
              'Ada yang berubah di profilnya, Pak/Bu. Lily lihat-lihat dulu ya.']
    }
  };

  var _lastLine = {};

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function moodValid(m) {
    var list = global.Lily && global.Lily.MOODS;
    return !list || list.indexOf(m) >= 0;
  }

  /* hasil = keluaran ProfilePhotoAnalyzer.analyze(). Mengembalikan {kategori, mood, moods, behavior, response}.
   * moods = daftar mood valid berurutan (paling cocok dulu); mood = moods[0] (deterministik). Tidak pernah throw. */
  function build(hasil) {
    var kat = hasil && REAKSI[hasil.kategori] ? hasil.kategori : 'UNKNOWN';
    var r = REAKSI[kat], line, tries = 0;
    do { line = pick(r.lines); tries++; } while (line === _lastLine[kat] && r.lines.length > 1 && tries < 5);
    _lastLine[kat] = line;
    var moods = r.moods.filter(moodValid);
    if (!moods.length) moods = ['warm'];
    return { kategori: kat, mood: moods[0], moods: moods, behavior: r.behavior, response: line };
  }

  global.LilyPhotoReaction = { build: build, _table: REAKSI };
})(window);
