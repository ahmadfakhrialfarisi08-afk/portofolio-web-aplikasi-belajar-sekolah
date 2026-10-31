/*
 * lily_teacher.js — lapisan KONTEKS GURU untuk Lily. Bukan priority engine, bukan cooldown baru.
 *
 * Tugasnya hanya tiga:
 *   1. normalisasiNama(): nama akun guru -> sapaan aman ("PAK JOEL" -> "Pak Joel", "Ahmad, S.T" -> "Ahmad").
 *      Gender TIDAK PERNAH ditebak: "Pak/Bu" hanya dipakai bila ada di nama akun.
 *   2. Memilih SATU event utama dari snapshot dashboard (jadwal, status tugas, tugas belum dinilai),
 *      lalu menyerahkannya ke lily.emit(). Urutan prioritas sebenarnya diputuskan brain lewat tabel PRI;
 *      wrapper hanya memakai tabel yang sama untuk memilih kandidat teratas.
 *      Jadwal 10/5 menit (tugas terbukti belum diberikan) diserahkan lewat lily.sense({type:'teaching_soon'}) bila brain
 *      mendukungnya (satu jalur per kejadian, bukan sense + emit sekaligus); tanpa lily.sense dipakai emit lama persis.
 *      Poll berkala tidak mengganggu guru yang sedang sibuk (lily._isBusy milik brain); onOpen tidak digating.
 *   3. Dedup PERSISTEN lintas reload: localStorage per guru + per tanggal + event key, hari lama dibersihkan.
 *      Cooldown/duplikat jangka pendek tetap milik brain (cd, dupWindow, habituasi). Satu-satunya state brain
 *      yang dipulihkan adalah lastEventAt.dashboard_open, supaya cooldown sapaan milik brain ikut bertahan saat reload.
 *
 * Sumber data: window.LilyTeacherSource.snapshot() (didefinisikan di dashboard_guru.js, membaca sumber yang
 * SUDAH dipakai sistem pengingat). Waktu = jam browser, sama dengan getScheduleStatus()/pengingat existing.
 * Vanilla JS. Browser: window.LilyTeacher. Node: module.exports (untuk uji).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LilyTeacher = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 1. Nama / sapaan ---------- */
  var RE_PAK = /^(pak|bapak|bpk|pk)\.?$/i;
  var RE_BU = /^(bu|ibu|ibunda|bunda)\.?$/i;
  var RE_GELAR = /^(dr|drs|dra|ir|prof|h|hj|kh|ust|ustadz|ustadzah)\.?$/i;     // gelar depan
  var RE_TOKEN_GELAR = /^[a-z]{1,4}\.([a-z]{1,5}\.?)*$/i;                       // S.T, S.Kom, M.Pd., Ir.

  function kapital(s) {
    return s.toLowerCase().replace(/(^|[\s'\-])([a-z\u00c0-\u024f])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  /* raw -> { sapaan: 'Pak'|'Bu'|null, nama: 'Joel'|'' , sapa: 'Pak Joel'|'Ahmad'|null } */
  function normalisasiNama(raw) {
    var out = { sapaan: null, nama: '', sapa: null };
    if (typeof raw !== 'string') return out;
    var s = raw.split(',')[0].replace(/\s+/g, ' ').trim();           // "Ahmad, S.T" -> "Ahmad" (gelar belakang)
    if (!s) return out;
    var tok = s.split(' '), nama = [], i;
    for (i = 0; i < tok.length; i++) {
      var t = tok[i];
      if (!t) continue;
      if (nama.length === 0 && !out.sapaan && RE_PAK.test(t)) { out.sapaan = 'Pak'; continue; }
      if (nama.length === 0 && !out.sapaan && RE_BU.test(t)) { out.sapaan = 'Bu'; continue; }
      if (RE_GELAR.test(t) || RE_TOKEN_GELAR.test(t)) continue;      // gelar depan/belakang tanpa koma
      nama.push(t);
    }
    out.nama = kapital(nama.join(' '));
    if (/^(guru|pengajar|guru pengajar|guru mapel|admin|user|pengguna|teacher)$/i.test(out.nama)) out.nama = '';   // label peran, bukan nama
    if (out.nama) out.sapa = (out.sapaan ? out.sapaan + ' ' : '') + out.nama;
    return out;                                                      // hanya sapaan tanpa nama -> sapa null (tidak dipaksakan)
  }

  /* ---------- util ---------- */
  function tgl(d) {
    var m = d.getMonth() + 1, h = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (h < 10 ? '0' : '') + h;
  }
  function huruf1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function create(opts) {
    opts = opts || {};
    var lily = opts.lily;
    if (!lily || typeof lily.emit !== 'function') throw new Error('LilyTeacher: opts.lily wajib');
    var getSource = opts.getSource || function () { return (typeof window !== 'undefined') ? window.LilyTeacherSource : null; };
    var PRI = opts.priority || {};                                   // tabel PRI milik brain (Lily.PRIORITY)
    var clock = opts.clock || function () { return new Date(); };
    var isVisible = opts.isVisible || function () { return true; };
    var cardFor = opts.cardFor || function () { return null; };
    var storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    var pollMs = opts.pollMs || 20000;
    var JEDA_ULANG_MS = opts.jedaUlangMs != null ? opts.jedaUlangMs : 300000;   // jeda 5 menit pengingat "tugas belum diberikan" setelah pelajaran dimulai
    var readyTimeout = opts.readyTimeoutMs != null ? opts.readyTimeoutMs : 4000;
    var timers = opts.timers || {
      set: function (f, ms) { return setTimeout(f, ms); },
      setInterval: function (f, ms) { return setInterval(f, ms); },
      clearInterval: function (id) { clearInterval(id); }
    };
    var prefix = 'lily_guru_' + (opts.username || 'guru') + '_';
    var mem = { tanggal: '', rec: { shown: {}, greetAt: 0 } };       // cadangan bila localStorage diblokir
    var intervalId = null, opening = false, destroyed = false;

    /* ---------- dedup persisten ---------- */
    function kunciHariIni() { return prefix + tgl(clock()); }
    function baca() {
      var k = kunciHariIni();
      try {
        var raw = storage && storage.getItem(k);
        if (raw) { var r = JSON.parse(raw); if (r && typeof r === 'object') { r.shown = r.shown || {}; return r; } }
        if (!storage) throw new Error('no storage');
        return { shown: {}, greetAt: 0 };
      } catch (e) {
        if (mem.tanggal !== k) mem = { tanggal: k, rec: { shown: {}, greetAt: 0 } };
        return mem.rec;
      }
    }
    function simpan(rec) {
      var k = kunciHariIni();
      mem = { tanggal: k, rec: rec };
      try { if (storage) storage.setItem(k, JSON.stringify(rec)); } catch (e) { /* tetap ada di memori */ }
    }
    function bersihkanHariLama() {
      try {
        if (!storage) return;
        var hariIni = kunciHariIni(), buang = [], i, k;
        for (i = 0; i < storage.length; i++) {
          k = storage.key(i);
          if (k && k !== hariIni && k.indexOf(prefix) === 0 && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(prefix.length))) buang.push(k);
        }
        buang.forEach(function (x) { storage.removeItem(x); });
      } catch (e) { /* abaikan */ }
    }
    function sudahTampil(key, ulangMs) {
      var t = baca().shown[key];
      if (!t) return false;
      return !(ulangMs > 0 && clock().getTime() - t >= ulangMs);     // pengingat berulang: lewat jeda -> dianggap belum tampil
    }
    function tandai(key) { var r = baca(); r.shown[key] = clock().getTime(); simpan(r); }
    function pulihkanCooldownBrain() {
      var r = baca();
      if (r.greetAt && lily.lastEventAt && !lily.lastEventAt.dashboard_open) lily.lastEventAt.dashboard_open = r.greetAt;
    }

    /* ---------- aksi cepat (tombol di balon) ----------
     * Hanya dibuat bila dashboard (LilyTeacherSource.aksi) menyatakan aksinya TERSEDIA; tidak ada URL/fungsi karangan.
     * Menekan tombol = persetujuan guru; tidak ada yang berjalan otomatis. */
    function aksiUntuk(nama, sesi, label) {
      var src = getSource(), a = src && src.aksi;
      if (!a || typeof a.tersedia !== 'function' || typeof a.jalankan !== 'function') return null;
      try { if (!a.tersedia(nama, sesi)) return null; } catch (e) { return null; }
      return { label: label, run: function () { a.jalankan(nama, sesi); } };
    }
    function bungkusAksi(acts) {                                      // format tombol brain.emit: {label, on}
      return acts.map(function (a) {
        return { label: a.label, on: function () { if (typeof lily._hideBubble === 'function') lily._hideBubble(); a.run(); } };
      });
    }

    /* ---------- kandidat dari snapshot ---------- */
    function snapshot() {
      var src = getSource();
      if (!src || typeof src.snapshot !== 'function') return null;
      try { return src.snapshot(); } catch (e) { return null; }
    }

    function kandidat(snap, boleh) {
      var info = normalisasiNama(snap.nama);
      var lead = info.sapa ? info.sapa + ', ' : '';
      var cands = [];
      (snap.sesi || []).forEach(function (s) {
        // Guru menutup kartu tahap ini -> hormati pilihannya, KECUALI pelajaran sudah dimulai (tahap 3) dan tugas terbukti belum diberikan:
        // itu diingatkan lagi tiap JEDA_ULANG_MS (5 menit) sampai tugas diberikan atau sesi selesai.
        if (s.sudahTugas !== true && s.ditutup && !(s.tahap === 3 && s.sudahTugas === false)) return;
        var ev, data, teks, key = s.kunci;
        if (s.tahap === 3) {
          var lalu = s.menitSejakMulai | 0;
          if (s.sudahTugas === false) {
            ev = 'sched_late_notask';
            teks = lalu < 1
              ? 'sudah masuk jadwal ' + s.kelas + '. Tugas untuk kelas ini belum diberikan.'
              : 'jadwal ' + s.kelas + ' sudah dimulai ' + lalu + ' menit lalu dan tugas belum diberikan.';
            data = { mood: 'concerned', intensity: 1.1 };
          } else {
            ev = 'sched_ongoing';
            if (s.sudahTugas === true) {
              teks = lalu < 1
                ? 'tugas untuk ' + s.kelas + ' sudah diberikan.'
                : 'jadwal ' + s.kelas + ' sudah dimulai ' + lalu + ' menit lalu. Tugas sudah diberikan.';
            } else {                                                 // status tugas belum diketahui -> jangan menebak
              teks = lalu < 1 ? 'jadwal mengajar ' + s.kelas + ' sudah dimulai.' : 'jadwal mengajar ' + s.kelas + ' sudah dimulai ' + lalu + ' menit lalu.';
            }
            data = { mood: 'warm', intensity: 0.5 };
          }
        } else if (s.sudahTugas === false) {                         // 10/5 menit: hanya bila tugas terbukti belum ada (sama dengan pengingat existing)
          var sisa = Math.max(1, s.menitMenuju | 0);
          if (s.tahap === 2) {
            ev = 'sched_5'; teks = sisa + ' menit lagi waktunya mengajar ' + s.kelas + '.';
            data = { mood: 'attentive', intensity: 1.0 };
          } else {
            ev = 'sched_10'; teks = sisa + ' menit lagi jadwal mengajar ' + s.kelas + (s.mapel ? ' \u2014 ' + s.mapel : '') + '.';
            data = { mood: 'attentive', intensity: 0.5 };
          }
        } else return;
        var prefixKey = { sched_late_notask: 'late', sched_ongoing: 'ongoing', sched_5: 's5', sched_10: 's10' }[ev];
        data.response = huruf1(lead + teks);
        data.key = prefixKey + '|' + key;
        data._kunciSesi = key;
        var cand = { event: ev, key: data.key, data: data, rank: PRI[ev] != null ? PRI[ev] : 99, mulai: s.menitMenuju | 0 };
        if (ev === 'sched_late_notask') cand.ulangMs = JEDA_ULANG_MS;   // boleh tampil lagi setelah jeda ini bila tugas masih belum ada
        if (s.sudahTugas === false) {                                // tugas terbukti belum ada -> tindakan yang menyelesaikannya
          var sesiRef = { kunci: s.kunci, kelas: s.kelas, tahap: s.tahap };
          cand.acts = [aksiUntuk('beriTugas', sesiRef, 'Kasih Tugas'), aksiUntuk('bukaKelas', sesiRef, 'Buka Kelas')].filter(Boolean);
        }
        if (ev === 'sched_5' || ev === 'sched_10') {                 // hanya fakta yang terbukti dari snapshot
          var prep = ['tugas belum diberikan'];
          if (typeof snap.perluDinilai === 'number' && snap.perluDinilai > 0) prep.push(snap.perluDinilai + ' tugas siswa belum dinilai');
          cand.sense = { type: 'teaching_soon', key: data.key, minutes: Math.max(1, s.menitMenuju | 0),
                         title: s.mapel ? s.kelas + ' \u2014 ' + s.mapel : s.kelas, prepare: prep,
                         mood: data.mood, intensity: data.intensity };
          if (cand.acts && cand.acts.length) cand.sense.actions = cand.acts;
        }
        cands.push(cand);
      });
      if (boleh.grading && typeof snap.perluDinilai === 'number' && snap.perluDinilai > 0) {
        cands.push({
          event: 'grading', key: 'grading', rank: PRI.grading != null ? PRI.grading : 99, mulai: 0,
          data: { response: huruf1(lead + 'ada ' + snap.perluDinilai + ' tugas siswa yang belum dinilai.'), intensity: 0.7, key: 'grading' },
          acts: [aksiUntuk('mulaiMenilai', null, 'Mulai Menilai'), aksiUntuk('lihatTugas', null, 'Lihat Tugas')].filter(Boolean)
        });
      }
      cands.sort(function (a, b) { return a.rank - b.rank || a.mulai - b.mulai; });
      return cands;
    }

    function pilihUtama(snap, boleh) {
      var c = kandidat(snap, boleh);
      for (var i = 0; i < c.length; i++) if (!sudahTampil(c[i].key, c[i].ulangMs)) return c[i];
      return null;
    }

    function kirim(c) {
      var d = c.data, el = d._kunciSesi ? cardFor(d._kunciSesi) : null;
      var terlihat = false;
      if (el && el.getBoundingClientRect) { var r = el.getBoundingClientRect(); terlihat = r.width > 0 && r.height > 0; }
      var payload = { response: d.response, mood: d.mood, intensity: d.intensity, key: d.key };
      if (terlihat) { payload.attention = 'notification'; payload.targetEl = el; }   // arahkan pandangan ke kartu existing, tanpa tombol baru
      else payload.attention = 'user';
      if (c.acts && c.acts.length) payload.actions = bungkusAksi(c.acts);
      var ok;
      if (c.sense && typeof lily.sense === 'function') {             // satu jalur: sense() memainkan sched_5/sched_10 lewat emit brain
        var sig = Object.assign({}, c.sense);
        if (terlihat) sig.el = el;
        ok = !!lily.sense(sig);
      } else ok = !!lily.emit(c.event, payload);
      if (ok) tandai(c.key);                                         // hanya ditandai bila benar-benar dimainkan brain
      return ok;
    }

    /* ---------- titik masuk ---------- */
    function tungguSiap(snap0, cb) {
      var t0 = clock().getTime(), snap = snap0;
      (function cek() {
        if (destroyed) return;
        snap = snapshot() || snap;
        var siap = snap && snap.tugasSiap && snap.perluDinilai !== null && snap.perluDinilai !== undefined;
        if (siap || clock().getTime() - t0 >= readyTimeout) return cb(snap);
        timers.set(cek, 250);
      })();
    }

    function sapa() { return normalisasiNama((snapshot() || {}).nama).sapa; }

    function onOpen() {
      if (destroyed) return;
      if (opening) return;
      var snap = snapshot();
      if (!snap) { lily.emit('dashboard_open'); return; }            // tanpa sumber data -> perilaku lama persis
      opening = true;
      tungguSiap(snap, function (s) {
        opening = false;
        if (destroyed) return;
        var c = pilihUtama(s, { grading: true });
        if (c && kirim(c)) return;                                   // satu event utama saja
        // Scenario G: tidak ada event penting -> sapaan biasa (brain memakai cooldown sapaannya sendiri)
        var ok = !!lily.emit('dashboard_open', { key: 'greet', pri: 'observation' });
        if (ok) { var r = baca(); r.greetAt = clock().getTime(); simpan(r); }
      });
    }

    function poll() {
      if (destroyed || opening || !isVisible()) return;
      if (typeof lily._isBusy === 'function' && lily._isBusy()) return;   // guru sedang mengetik/bekerja cepat/focusMode: coba lagi di poll berikutnya
      var snap = snapshot();
      if (!snap) return;
      var c = pilihUtama(snap, { grading: false });                  // info yang tidak berubah oleh waktu (nilai) tidak di-poll
      if (c) kirim(c);
    }

    function start() {
      bersihkanHariLama();
      pulihkanCooldownBrain();
      if (!intervalId) intervalId = timers.setInterval(poll, pollMs);
    }
    function stop() { destroyed = true; if (intervalId) timers.clearInterval(intervalId); intervalId = null; }

    return {
      start: start, stop: stop, onOpen: onOpen, poll: poll, sapa: sapa,
      _kandidat: function (snap, boleh) { return kandidat(snap, boleh || { grading: true }); },
      _sudahTampil: sudahTampil
    };
  }

  return { create: create, normalisasiNama: normalisasiNama };
});
