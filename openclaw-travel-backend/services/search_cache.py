"""Short-term search result cache (Redis or in-memory fallback, TTL=30min)."""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CACHE_TTL = 1800  # 30 minutes
_MEM_CACHE: dict[str, tuple[Any, float]] = {}
_redis_client: Any | None = None


def set_redis_client(client: Any) -> None:
    global _redis_client
    _redis_client = client


def _make_key(prefix: str, **kwargs) -> str:
    """Build a deterministic cache key from prefix + sorted kwargs."""
    raw = json.dumps(kwargs, sort_keys=True, default=str)
    h = hashlib.md5(raw.encode()).hexdigest()[:12]
    return f"search_cache:{prefix}:{h}"


async def get(prefix: str, **kwargs) -> Optional[Any]:
    """Retrieve cached search result, or None if miss/expired."""
    key = _make_key(prefix, **kwargs)

    if _redis_client is not None:
        try:
            raw = await _redis_client.get(key)
            if raw:
                logger.debug("Search cache HIT (redis): %s", key)
                return json.loads(raw)
        except Exception as exc:
            logger.warning("Search cache redis read failed: %s", exc)

    if key in _MEM_CACHE:
        value, cached_at = _MEM_CACHE[key]
        if time.time() - cached_at < _CACHE_TTL:
            logger.debug("Search cache HIT (mem): %s", key)
            return value
        else:
            del _MEM_CACHE[key]

    return None


async def put(prefix: str, value: Any, **kwargs) -> None:
    """Store search result in cache."""
    key = _make_key(prefix, **kwargs)
    serialized = json.dumps(value, default=str)

    if _redis_client is not None:
        try:
            await _redis_client.set(key, serialized, ex=_CACHE_TTL)
            return
        except Exception as exc:
            logger.warning("Search cache redis write failed: %s", exc)

    _MEM_CACHE[key] = (value, time.time())
