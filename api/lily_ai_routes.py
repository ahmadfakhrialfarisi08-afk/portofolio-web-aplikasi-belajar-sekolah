# -*- coding: utf-8 -*-
"""
api/lily_ai_routes.py -- Route chat maskot LILY (SCORUS AI, dashboard guru).

Endpoint : POST /api/scorus-ai/lily      body JSON: {"text": "..."}
Kontrak  : sama persis dengan yang dipanggil lily_brain.js (this.endpoint). Balasan SELALU JSON valid.
Logika   : service/lily_ai_service.py (API eksternal, fallback, breaker, rate limit, redaksi key).

Pemasangan di app.py (2 baris, setelah `app = Flask(...)`):
    from api.lily_ai_routes import register_lily_ai
    register_lily_ai(app)        # opsional: get_username=fungsi_login_anda, is_allowed=cek_role_guru
"""
import logging
import time

from flask import Blueprint, jsonify, request, session

try:  # ikuti cara import project: paket `service`, atau modul datar bila belum jadi paket
    from service import lily_ai_service as svc
except ImportError:  # pragma: no cover
    import lily_ai_service as svc

try:  # fallback offline (opsional, aktif hanya bila LILY_OFFLINE_FALLBACK=on); modul tak ada -> perilaku lama
    from services.lily_offline import router as offline
except ImportError:  # pragma: no cover
    offline = None

log = logging.getLogger("lily_ai")
lily_ai_bp = Blueprint("lily_ai", __name__)
ENDPOINT_PATH = "/api/scorus-ai/lily"


def _default_get_username():
    for k in ("username", "user", "user_id", "nama"):
        v = session.get(k)
        if v:
            return str(v)
    return None


def _fallback(kind, text):
    """svc.fallback(...) lama + (bila LILY_OFFLINE_FALLBACK=on) teks jawaban dari KB lokal. Bentuk JSON tidak berubah."""
    payload = svc.fallback(kind, text)
    if offline is None:
        return payload
    try:
        return offline.terapkan(payload, text)
    except Exception as e:  # offline tidak boleh merusak fallback lama
        svc.log_throttled("offline", logging.WARNING, "lily_offline gagal: %s: %s" % (type(e).__name__, e))
        return payload


_get_username = _default_get_username
_is_allowed = None  # opsional: fungsi(username) -> bool, mis. cek role guru


def _handle():
    body = request.get_json(silent=True)
    text = str(body.get("text", "")).strip() if isinstance(body, dict) else ""
    if not text:
        return jsonify({"success": False, "code": "empty", "message": "Pesan kosong."}), 400
    text = text[:svc.env_num("LILY_MAX_INPUT_CHARS", 500, int)]

    username = _get_username()
    if not username:
        return jsonify({"success": False, "code": "login_required", "message": "Silakan login dulu."}), 401
    if _is_allowed is not None and not _is_allowed(username):
        return jsonify({"success": False, "code": "forbidden", "message": "Fitur ini khusus guru."}), 403
    if not svc.rate_ok(username):
        return jsonify({"success": False, "code": "rate_limited",
                        "message": "Terlalu cepat, coba lagi sebentar."}), 429

    ex_active, ex_code = svc.get_exhausted()
    if ex_active:                                  # kuota/key bermasalah: jangan ganggu API lagi
        return jsonify(svc.exhausted_payload(ex_code)), 200
    if svc.breaker_is_open():                      # API sedang terus gagal: jawab lokal, tanpa menunggu
        return jsonify(_fallback("offline", text)), 200

    started = time.time()
    try:
        provider, reply = svc.ask_ai(text)
    except svc.AIError as e:
        ms = int((time.time() - started) * 1000)
        log.warning("[lily_ai] gagal provider=%s kind=%s status=%s code=%s ms=%d",
                    svc.provider_name(), e.kind, e.status or "-", svc.redact(e.code or "-"), ms)
        if e.kind == "exhausted":
            return jsonify(svc.exhausted_payload(svc.set_exhausted(e.code))), 200
        if e.kind in ("timeout", "offline", "server_error"):
            svc.record_failure()
        if e.kind == "no_key":
            svc.log_throttled("no_key", logging.ERROR,
                              "API key belum diset (OPENAI_API_KEY / GEMINI_API_KEY) -> Lily pakai fallback lokal")
            return jsonify(_fallback("unavailable", text)), 200
        kind = e.kind if e.kind in ("timeout", "offline", "server_error", "rate_limited") else "bad_reply"
        return jsonify(_fallback(kind, text)), 200

    svc.record_success()
    log.info("[lily_ai] ok provider=%s ms=%d", provider, int((time.time() - started) * 1000))
    return jsonify({
        "success": True, "mood": reply["mood"], "behavior": reply["behavior"], "attention": "user",
        "response": reply["response"], "message_type": "assistant_ai", "cached": False,
    }), 200


@lily_ai_bp.route(ENDPOINT_PATH, methods=["POST"])
def lily_chat():
    try:
        return _handle()
    except Exception as e:  # jaring terakhir: apa pun yang lolos tetap JSON 200, bukan 500
        svc.log_throttled("handler", logging.ERROR,
                          "error tak terduga di handler: %s: %s" % (type(e).__name__, e), every=10)
        return jsonify(svc.fallback("bad_reply", "")), 200


def register_lily_ai(app, get_username=None, is_allowed=None):
    """Pasang endpoint ke app. Mengembalikan False (dan tidak memasang) bila route yang sama sudah ada."""
    global _get_username, _is_allowed
    if any(r.rule == ENDPOINT_PATH and "POST" in (r.methods or ()) for r in app.url_map.iter_rules()):
        app.logger.warning("[lily_ai] %s sudah terdaftar di app -> modul ini TIDAK dipasang (hindari duplikat)",
                           ENDPOINT_PATH)
        return False
    if get_username:
        _get_username = get_username
    if is_allowed:
        _is_allowed = is_allowed
    if lily_ai_bp.name not in app.blueprints:
        app.register_blueprint(lily_ai_bp)
    return True
