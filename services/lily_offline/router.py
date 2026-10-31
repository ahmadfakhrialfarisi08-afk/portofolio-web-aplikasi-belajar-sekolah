# -*- coding: utf-8 -*-
"""Router offline Lily. Dipakai api/scorus_ai_routes.py (endpoint /api/scorus-ai/lily) sebagai lapisan fallback.

Aktif hanya bila LILY_OFFLINE_FALLBACK=on (default: nonaktif). Env lain: LILY_OFFLINE_KB_PATH (file KB guru,
default data/kb_lokal.json). Router hanya MEMILIH jawaban dari knowledge base; format balasan JSON frontend
(mood/behavior valid, batas panjang, message_type) dijaga oleh handler pemanggil.
"""
import os
import threading

from .knowledge import KnowledgeBase

_DIR = os.path.dirname(os.path.abspath(__file__))
_kb = None
_kb_lock = threading.Lock()


def enabled():
    return os.environ.get("LILY_OFFLINE_FALLBACK", "off").strip().lower() in ("on", "1", "true", "yes")


def get_kb():
    global _kb
    with _kb_lock:
        if _kb is None:
            user = os.environ.get("LILY_OFFLINE_KB_PATH") or os.path.join(_DIR, "data", "kb_lokal.json")
            _kb = KnowledgeBase(os.path.join(_DIR, "data", "kb_default.json"), user)
        return _kb


def reset_kb():
    """Untuk test: paksa KB dibuat ulang (mis. setelah LILY_OFFLINE_KB_PATH berubah)."""
    global _kb
    with _kb_lock:
        _kb = None


def jawab(text):
    """-> {'response','intent','skor','mood','behavior'} atau None bila tidak ada entri yang cocok
    (tidak mengarang jawaban). mood/behavior boleh None."""
    if not isinstance(text, str) or not text.strip():
        return None
    entri, skor = get_kb().cari(text)
    if not entri:
        return None
    return {"response": entri["jawaban"], "intent": entri["id"], "skor": skor,
            "mood": entri.get("mood"), "behavior": entri.get("behavior")}
