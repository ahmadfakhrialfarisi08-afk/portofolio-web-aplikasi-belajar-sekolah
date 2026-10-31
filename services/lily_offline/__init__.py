# -*- coding: utf-8 -*-
"""services/lily_offline -- jawaban lokal Lily saat AI online tidak tersedia.

Aktif hanya bila env LILY_OFFLINE_FALLBACK=on (default: nonaktif).
"""
from .knowledge import KnowledgeBase, KBError
from .router import enabled, jawab, get_kb, reset_kb

__all__ = ["KnowledgeBase", "KBError", "enabled", "jawab", "get_kb", "reset_kb"]
