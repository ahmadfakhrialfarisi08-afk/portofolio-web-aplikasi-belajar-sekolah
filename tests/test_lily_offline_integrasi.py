# -*- coding: utf-8 -*-
"""Tes integrasi terhadap handler ASLI api/scorus_ai_routes.py (endpoint /api/scorus-ai/lily).
Tidak ada stub untuk handler: yang dipalsukan hanya requests.post (OpenAI) dan lokasi file data (folder sementara),
supaya tes tidak menyentuh data/ project. Jalankan dari folder utama:  python tests/test_lily_offline_integrasi.py
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import requests  # noqa: E402
from flask import Flask  # noqa: E402
from api import scorus_ai_routes as S  # noqa: E402
from services.lily_offline import router as offline  # noqa: E402

URL = "/api/scorus-ai/lily"


class Resp:
    def __init__(self, status=200, body=None, text=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("bukan json")
        return self._body


def ok_ai(mood="happy", response="jawaban AI"):
    isi = json.dumps({"mood": mood, "attention": "user", "behavior": "observe", "response": response})
    return Resp(200, {"choices": [{"message": {"content": isi}}], "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10}})


class Dasar(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        os.environ["LILY_OFFLINE_KB_PATH"] = os.path.join(d, "kb.json")
        os.environ.pop("LILY_OFFLINE_FALLBACK", None)
        os.environ.pop("OPENAI_API_KEY", None)
        offline.reset_kb()
        self.patches = [
            mock.patch.object(S, "STATUS_FILE", os.path.join(d, "status.json")),
            mock.patch.object(S, "USAGE_DIR", os.path.join(d, "usage")),
            mock.patch.object(S, "QUOTA_FILE", os.path.join(d, "quota.json")),
            mock.patch.object(S, "CACHE_FILE", os.path.join(d, "cache.json")),
        ]
        for p in self.patches:
            p.start()
        S._status_mem["mtime"], S._status_mem["data"] = None, {}
        S._lily_cache.clear(); S._lily_rate_log.clear(); S._lily_harian.clear()
        S._lily_json_ditolak["sejak"] = 0.0
        app = Flask(__name__); app.secret_key = "x"
        app.register_blueprint(S.scorus_ai_bp)
        self.c = app.test_client()
        self.login("guru1", "guru")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        os.environ.clear(); os.environ.update(self._env)
        offline.reset_kb()
        self.tmp.cleanup()

    def login(self, username, role):
        with self.c.session_transaction() as s:
            s["user"] = {"username": username, "role": role}

    def post(self, text, post_mock=None):
        if post_mock is None:
            return self.c.post(URL, json={"text": text})
        with mock.patch.object(S.requests, "post", post_mock):
            return self.c.post(URL, json={"text": text})

    def usage_records(self):
        d = os.path.join(self.tmp.name, "usage")
        out = []
        if os.path.isdir(d):
            for f in os.listdir(d):
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    out += [json.loads(x) for x in fh if x.strip()]
        return out

    def on(self):
        os.environ["LILY_OFFLINE_FALLBACK"] = "on"

    def key(self):
        os.environ["OPENAI_API_KEY"] = "sk-test"


TIMEOUT = mock.Mock(side_effect=requests.Timeout("lambat"))
SAPA = "halo lily apa kabar"          # bukan sapaan "murni" (regex lokal lama tidak cocok) -> baru dijawab KB offline


class TestTerhubung(Dasar):
    def test_handler_asli_memuat_modul_offline(self):
        self.assertIsNotNone(S._lily_offline)
        self.assertIs(S._lily_offline, offline)


class TestOffTidakBerpengaruh(Dasar):
    def test_default_token_kosong_perilaku_lama(self):
        r = self.post(SAPA)
        self.assertEqual(r.status_code, 200); self.assertEqual(r.get_json(), S._LILY_KOSONG)

    def test_off_eksplisit_timeout_perilaku_lama(self):
        os.environ["LILY_OFFLINE_FALLBACK"] = "off"; self.key()
        self.assertEqual(self.post(SAPA, TIMEOUT).get_json(), S._LILY_KOSONG)

    def test_modul_offline_tidak_ada_perilaku_lama(self):
        self.on()
        with mock.patch.object(S, "_lily_offline", None):
            self.assertEqual(self.post(SAPA).get_json(), S._LILY_KOSONG)


class TestOnFallback(Dasar):
    def test_token_kosong(self):
        self.on()
        j = self.post(SAPA).get_json()
        self.assertTrue(j["offline"]); self.assertEqual(j["message_type"], "assistant_local")
        self.assertIn(j["mood"], S.LILY_MOOD); self.assertIn(j["behavior"], S.LILY_BEHAVIOR)
        self.assertEqual(j["attention"], "user"); self.assertTrue(j["no_cache"])
        self.assertTrue(0 < len(j["response"]) <= S.LILY_MAKS_RESPON)
        self.assertEqual((j["mood"], j["behavior"]), ("warm", "greet"))

    def test_token_kosong_tercatat_lokal_bukan_api(self):
        self.on(); self.post(SAPA)
        rec = self.usage_records()
        self.assertEqual([(r["endpoint"], r["sumber"]) for r in rec], [("lily", "lokal")])
        self.assertNotIn("token_total", rec[0])

    def test_kontrak_kunci_sama_dengan_balasan_lily_biasa(self):
        self.on()
        j = self.post(SAPA).get_json()
        for k in ("mood", "attention", "behavior", "intensity", "response", "message_type"):
            self.assertIn(k, j)

    def test_timeout(self):
        self.on(); self.key()
        j = self.post(SAPA, mock.Mock(side_effect=requests.Timeout("x"))).get_json()
        self.assertTrue(j["offline"])

    def test_koneksi_gagal(self):
        self.on(); self.key()
        self.assertTrue(self.post(SAPA, mock.Mock(side_effect=requests.ConnectionError("x"))).get_json()["offline"])

    def test_http_500_dan_429_sementara(self):
        self.on(); self.key()
        for st, body in ((500, {"error": {"message": "x"}}), (429, {"error": {"code": "rate_limit_exceeded"}})):
            S._lily_cache.clear(); S._lily_harian.clear(); S._lily_rate_log.clear()
            self.assertTrue(self.post(SAPA, mock.Mock(return_value=Resp(st, body))).get_json()["offline"], st)

    def test_balasan_api_tak_terbaca(self):
        self.on(); self.key()
        rusak = Resp(200, {"choices": [{"message": {"content": "bukan json"}}]})
        self.assertTrue(self.post(SAPA, mock.Mock(return_value=rusak)).get_json()["offline"])

    def test_tanpa_kecocokan_tetap_perilaku_lama(self):
        self.on()
        self.assertEqual(self.post("berapa hasil 17 kali 23 ya").get_json(), S._LILY_KOSONG)
        self.key()
        self.assertEqual(self.post("berapa hasil 17 kali 23 ya", TIMEOUT).get_json(), S._LILY_KOSONG)

    def test_balasan_offline_tidak_masuk_cache_lily(self):
        self.on(); self.key()
        self.post(SAPA, TIMEOUT)
        self.assertEqual(len(S._lily_cache), 0)

    def test_pulih_setelah_offline_pakai_api(self):
        self.on(); self.key()
        self.post(SAPA, TIMEOUT)
        j = self.post(SAPA, mock.Mock(return_value=ok_ai("happy", "jawaban AI"))).get_json()
        self.assertEqual(j["response"], "jawaban AI"); self.assertNotIn("offline", j)

    def test_kb_guru_dipakai(self):
        self.on()
        offline.get_kb().tambah("piket", ["jadwal piket"], "Jadwal piket diisi guru.", mood="calm", behavior="observe")
        j = self.post("jadwal piket hari ini?").get_json()
        self.assertEqual((j["response"], j["mood"]), ("Jadwal piket diisi guru.", "calm"))

    def test_mood_behavior_tidak_valid_dikoreksi(self):
        self.on()
        offline.get_kb().tambah("aneh", ["kata aneh"], "ok", mood="gembira", behavior="menari")
        j = self.post("kata aneh").get_json()
        self.assertEqual((j["mood"], j["behavior"]), ("normal", "observe"))

    def test_jawaban_panjang_dipotong_di_akhir_kalimat(self):
        self.on()
        panjang = "Kalimat pertama yang cukup panjang untuk dites. " * 8
        offline.get_kb().tambah("pjg", ["kata pjg"], panjang)
        j = self.post("kata pjg").get_json()
        self.assertLessEqual(len(j["response"]), S.LILY_MAKS_RESPON)
        self.assertTrue(j["response"].endswith("."))

    def test_error_di_modul_offline_tidak_merusak(self):
        self.on()
        with mock.patch.object(offline, "jawab", side_effect=RuntimeError("boom")):
            self.assertEqual(self.post(SAPA).get_json(), S._LILY_KOSONG)


class TestPerilakuLamaTetap(Dasar):
    """Dengan LILY_OFFLINE_FALLBACK=on, hal-hal ini TIDAK boleh berubah."""

    def test_kuota_habis_saat_panggilan(self):
        self.on(); self.key()
        r = self.post(SAPA, mock.Mock(return_value=Resp(429, {"error": {"code": "insufficient_quota"}})))
        j = r.get_json()
        self.assertEqual(j["message_type"], "api_exhausted"); self.assertEqual(j["api_status"], "exhausted")
        self.assertNotIn("offline", j)
        self.assertEqual(S._api_habis(), "quota")

    def test_kunci_tidak_valid(self):
        self.on(); self.key()
        j = self.post(SAPA, mock.Mock(return_value=Resp(401, {"error": {"code": "invalid_api_key"}}))).get_json()
        self.assertEqual(j["message_type"], "api_exhausted"); self.assertNotIn("offline", j)

    def test_flag_api_habis_aktif_tidak_memanggil_openai(self):
        self.on(); self.key()
        S._tandai_api_habis("quota")
        m = mock.Mock()
        j = self.post(SAPA, m).get_json()
        self.assertEqual(j["message_type"], "api_exhausted"); self.assertNotIn("offline", j)
        m.assert_not_called()

    def test_batas_harian_lily_tetap(self):
        self.on(); self.key()
        with mock.patch.object(S, "LILY_BATAS_HARIAN", 0):
            j = self.post(SAPA, TIMEOUT).get_json()
        self.assertEqual(j, S._LILY_KOSONG)

    def test_lily_dimatikan_scorus_lily_aktif_0(self):
        self.on()
        with mock.patch.object(S, "LILY_AKTIF", False):
            self.assertEqual(self.post(SAPA).get_json(), S._LILY_KOSONG)

    def test_api_sukses_tidak_tersentuh(self):
        self.on(); self.key()
        j = self.post("tolong beri semangat untuk saya", mock.Mock(return_value=ok_ai("encouraging", "Semangat!"))).get_json()
        self.assertEqual(j["response"], "Semangat!"); self.assertNotIn("offline", j)

    def test_cache_lama_tetap_didahulukan(self):
        self.on(); self.key()
        self.post("tolong beri semangat untuk saya", mock.Mock(return_value=ok_ai("encouraging", "Semangat!")))
        m = mock.Mock()
        j = self.post("tolong beri semangat untuk saya", m).get_json()
        self.assertTrue(j.get("cached")); self.assertEqual(j["response"], "Semangat!")
        m.assert_not_called()

    def test_sapaan_murni_tetap_intent_lokal_lama(self):
        self.on()
        j = self.post("halo").get_json()
        self.assertEqual(j["message_type"], "assistant_local"); self.assertNotIn("offline", j)

    def test_pertanyaan_pembuat_tetap_netral(self):
        self.on()
        self.assertEqual(self.post("siapa yang membuat web ini").get_json(), S._LILY_NETRAL)

    def test_autentikasi(self):
        self.on()
        with self.c.session_transaction() as s:
            s.clear()
        self.assertEqual(self.post(SAPA).status_code, 401)
        self.login("siswa1", "siswa")
        self.assertEqual(self.post(SAPA).status_code, 403)
        self.login("guru1", "guru")
        self.assertEqual(self.post("   ").status_code, 400)

    def test_chat_utama_tidak_diubah(self):
        self.on()
        r = self.c.post("/api/scorus-ai/chat", json={"messages": [{"role": "user", "content": "buatkan modul ajar matematika"}]})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.get_json(), {"error": "SCORUS AI belum dikonfigurasi di server."})


if __name__ == "__main__":
    unittest.main()
