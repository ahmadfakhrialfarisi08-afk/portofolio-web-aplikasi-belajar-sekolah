# -*- coding: utf-8 -*-
"""Knowledge base lokal Lily: bawaan (baca-saja) + milik guru (tambah/ubah/hapus, tersimpan di file JSON).

Tidak mengarang fakta: jawaban hanya berasal dari entri yang ada. Tidak ada entri cocok -> None.
"""
import json
import os
import re
import tempfile
import threading
import unicodedata

_ID_RE = re.compile(r"^[a-z0-9_\-]{1,48}$")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_ISTILAH_RE = re.compile(r"^[a-z]{2,20}$")   # mood/behavior Lily (nilai valid dicek di handler)
MAX_JAWABAN = 800
MAX_KATA_KUNCI = 20
MAX_PANJANG_KUNCI = 60
MAX_ENTRI_GURU = 500


class KBError(ValueError):
    """Data knowledge base tidak valid."""


def normalisasi(teks):
    """huruf kecil, tanpa aksen/tanda baca, spasi tunggal."""
    teks = unicodedata.normalize("NFKD", str(teks or "")).lower()
    teks = "".join(c for c in teks if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", teks).split())


def _bersih_entri(e, wajib_isi=True):
    if not isinstance(e, dict):
        raise KBError("entri harus objek")
    eid = e.get("id")
    if not isinstance(eid, str) or not _ID_RE.match(eid):
        raise KBError("id tidak valid (a-z, 0-9, _ atau -, maks 48)")
    out = {"id": eid}
    if e.get("aktif") is False:
        out["aktif"] = False
        return out
    kk = e.get("kata_kunci")
    if not isinstance(kk, list) or not 1 <= len(kk) <= MAX_KATA_KUNCI:
        raise KBError("kata_kunci harus daftar berisi 1-%d kata/frasa" % MAX_KATA_KUNCI)
    bersih = []
    for k in kk:
        if not isinstance(k, str):
            raise KBError("kata kunci harus teks")
        n = normalisasi(k)
        if not n or len(n) > MAX_PANJANG_KUNCI:
            raise KBError("kata kunci kosong atau terlalu panjang")
        if n not in bersih:
            bersih.append(n)
    j = e.get("jawaban")
    if not isinstance(j, str) or _CTRL_RE.search(j):
        raise KBError("jawaban harus teks tanpa karakter kontrol")
    j = j.strip()
    if not 1 <= len(j) <= MAX_JAWABAN:
        raise KBError("jawaban 1-%d karakter" % MAX_JAWABAN)
    out["kata_kunci"], out["jawaban"] = bersih, j
    for f in ("mood", "behavior"):
        v = e.get(f)
        if v is not None:
            if not isinstance(v, str) or not _ISTILAH_RE.match(v):
                raise KBError("%s harus kata huruf kecil 2-20 huruf" % f)
            out[f] = v
    mk = e.get("maks_kata")
    if mk is not None:
        if isinstance(mk, bool) or not isinstance(mk, int) or not 1 <= mk <= 50:
            raise KBError("maks_kata harus bilangan 1-50")
        out["maks_kata"] = mk
    return out


def _baca_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    if not isinstance(data, list):
        raise KBError("file knowledge base harus berisi daftar")
    return data


class KnowledgeBase:
    def __init__(self, path_bawaan, path_guru):
        self.path_bawaan = path_bawaan
        self.path_guru = path_guru
        self._lock = threading.RLock()
        self._mtime = None
        self._bawaan = [_bersih_entri(e) for e in _baca_json(path_bawaan)]
        self._guru = []
        self._muat_guru()

    # ---- penyimpanan
    def _mtime_guru(self):
        try:
            return os.stat(self.path_guru).st_mtime_ns
        except OSError:
            return None

    def _muat_guru(self):
        try:
            self._guru = [_bersih_entri(e) for e in _baca_json(self.path_guru)]
        except (KBError, ValueError):   # file guru rusak: abaikan, bawaan tetap jalan
            self._guru = []
        self._mtime = self._mtime_guru()

    def _segarkan(self):
        if self._mtime_guru() != self._mtime:   # proses/worker lain mungkin mengubah file
            self._muat_guru()

    def _simpan(self):
        d = os.path.dirname(os.path.abspath(self.path_guru))
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._guru, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path_guru)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self._mtime = self._mtime_guru()

    # ---- baca
    def semua(self):
        """Entri aktif gabungan; entri guru dengan id sama menimpa bawaan."""
        with self._lock:
            self._segarkan()
            peta = {e["id"]: e for e in self._bawaan}
            for e in self._guru:
                peta[e["id"]] = e
            return [e for e in peta.values() if e.get("aktif", True) and "jawaban" in e]

    def cari(self, teks):
        """-> (entri, skor) terbaik, atau (None, 0)."""
        n = normalisasi(teks)
        if not n:
            return None, 0
        padded, jml_kata = " %s " % n, len(n.split())
        terbaik, skor_t, kunci_t = None, 0, 0
        for e in self.semua():
            if jml_kata > e.get("maks_kata", 10 ** 6):
                continue
            skor = kunci = 0
            for k in e["kata_kunci"]:
                if " %s " % k in padded:
                    w = len(k.split())
                    skor += w
                    kunci = max(kunci, w)
            if (skor, kunci) > (skor_t, kunci_t) or (
                    skor and (skor, kunci) == (skor_t, kunci_t) and e["id"] < terbaik["id"]):
                terbaik, skor_t, kunci_t = e, skor, kunci
        return (terbaik, skor_t) if terbaik else (None, 0)

    # ---- ubah (hanya data guru; file bawaan tidak pernah ditulis)
    def tambah(self, id, kata_kunci, jawaban, maks_kata=None, mood=None, behavior=None):
        with self._lock:
            self._segarkan()
            if any(e["id"] == id for e in self.semua()):
                raise KBError("id sudah ada: %s" % id)
            if len(self._guru) >= MAX_ENTRI_GURU:
                raise KBError("batas entri tercapai")
            e = _bersih_entri({"id": id, "kata_kunci": kata_kunci, "jawaban": jawaban, "maks_kata": maks_kata,
                               "mood": mood, "behavior": behavior})
            self._guru.append(e)
            self._simpan()
            return e

    def ubah(self, id, kata_kunci=None, jawaban=None, maks_kata=None, mood=None, behavior=None):
        """Ubah entri guru, atau timpa entri bawaan (versi bawaan tidak berubah di file)."""
        with self._lock:
            self._segarkan()
            lama = next((e for e in self.semua() if e["id"] == id), None)
            if lama is None:
                raise KBError("id tidak ditemukan: %s" % id)
            baru = _bersih_entri({
                "id": id,
                "kata_kunci": lama["kata_kunci"] if kata_kunci is None else kata_kunci,
                "jawaban": lama["jawaban"] if jawaban is None else jawaban,
                "maks_kata": lama.get("maks_kata") if maks_kata is None else maks_kata,
                "mood": lama.get("mood") if mood is None else mood,
                "behavior": lama.get("behavior") if behavior is None else behavior})
            self._guru = [e for e in self._guru if e["id"] != id] + [baru]
            self._simpan()
            return baru

    def hapus(self, id):
        """Hapus entri guru; entri bawaan dinonaktifkan lewat catatan di file guru."""
        with self._lock:
            self._segarkan()
            if not any(e["id"] == id for e in self.semua()):
                raise KBError("id tidak ditemukan: %s" % id)
            self._guru = [e for e in self._guru if e["id"] != id]
            if any(e["id"] == id for e in self._bawaan):
                self._guru.append({"id": id, "aktif": False})
            self._simpan()
