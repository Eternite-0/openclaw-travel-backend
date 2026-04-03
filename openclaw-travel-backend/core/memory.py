from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

_FALLBACK_STORE: dict[str, list[dict]] = {}

try:
    import redis.asyncio as aioredis
    _REDIS_AVAILABLE = True
except ImportError:
    _REDIS_AVAILABLE = False


class MemoryManager:
    """
    Dual-layer memory.
    Short-term : last N messages for current turn context window.
    Long-term  : full conversation history serialized in Redis / fallback dict.
    """

    def __init__(
        self,
        session_id: str,
        max_short_term: int = 10,
        redis_client: Any | None = None,
    ) -> None:
        self.session_id = session_id
        self.max_short_term = max_short_term
        self._redis = redis_client
        self._key = f"session:{session_id}:history"
        self._ttl = 86400  # 24 hours

    async def add_message(
        self,
        role: str,
        content: str,
        attachments: list[dict[str, Any]] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow().isoformat(),
        }
        if attachments:
            payload["attachments"] = attachments
        entry = json.dumps(payload, ensure_ascii=False)
        if self._redis is not None:
            try:
                await self._redis.rpush(self._key, entry)
                await self._redis.expire(self._key, self._ttl)
                return
            except Exception as exc:
                logger.warning("Redis add_message failed, using fallback: %s", exc)

        store = _FALLBACK_STORE.setdefault(self._key, [])
        store.append(json.loads(entry))

    async def get_short_term(self) -> list[dict]:
        all_msgs = await self.get_full_history()
        return all_msgs[-self.max_short_term:]

    async def get_full_history(self) -> list[dict]:
        if self._redis is not None:
            try:
                raw_list = await self._redis.lrange(self._key, 0, -1)
                return [json.loads(item) for item in raw_list]
            except Exception as exc:
                logger.warning("Redis get_full_history failed, using fallback: %s", exc)

        return list(_FALLBACK_STORE.get(self._key, []))

    async def clear(self) -> None:
        if self._redis is not None:
            try:
                await self._redis.delete(self._key)
                return
            except Exception as exc:
                logger.warning("Redis clear failed, using fallback: %s", exc)

        _FALLBACK_STORE.pop(self._key, None)

    def build_context_string(self, messages: list[dict]) -> str:
        lines: list[str] = []
        for msg in messages:
            role = msg.get("role", "unknown").capitalize()
            content = msg.get("content", "")
            lines.append(f"{role}: {content}")
        return "\n".join(lines)
