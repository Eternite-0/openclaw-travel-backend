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

    # ── Context compression (inspired by claude-code compact system) ────

    # Rough chars-per-token ratio for mixed Chinese/English text.
    # Chinese ≈ 1.5 chars/token, English ≈ 4 chars/token; weighted average.
    _CHARS_PER_TOKEN = 2.0
    # Default context window budget (in chars) for the *conversation history*
    # portion. Conservative: leaves room for system prompt + search results.
    _MAX_HISTORY_CHARS = 12_000
    # Message-count hard floor: never compress if fewer than this.
    _MIN_MSGS_TO_COMPRESS = 8
    # Max chars we allow the summarize prompt itself to be (prevent the
    # compress call from hitting *its own* context limit). If exceeded we
    # truncate the oldest messages before summarizing (PTL retry pattern).
    _MAX_SUMMARIZE_INPUT_CHARS = 10_000
    # Circuit breaker: stop retrying after N consecutive failures per session.
    _MAX_CONSECUTIVE_FAILURES = 3
    # Max PTL (Prompt-Too-Long) retry attempts with progressive head truncation.
    _MAX_PTL_RETRIES = 2

    _COMPACT_PROMPT_TEMPLATE = """\
你的任务是为旅行规划助手创建一份结构化对话摘要。这份摘要将替代原始历史，因此必须保留所有关键信息。

请先在 <analysis> 标签中梳理要点，再在 <summary> 标签中输出最终摘要。

<analysis>
逐条检查以下要点是否覆盖完整：
1. 出发地 / 目的地 / 国家代码
2. 出发日期 / 返回日期 / 天数
3. 预算（总额和币种）
4. 旅行人数和同行者关系
5. 旅行风格偏好（休闲/探险/文化/美食等）
6. 用户明确提出的修改要求（change_hints）
7. 已确认的航班/酒店/景点决策
8. 用户对上一版行程的不满或肯定反馈
</analysis>

<summary>
请按以下格式输出（缺失的项写"未提及"）：

## 旅行基本信息
- 出发地:
- 目的地:
- 出发日期:
- 返回日期:
- 天数:
- 人数:
- 预算:

## 用户偏好与风格
[列举用户提到的偏好]

## 关键决策记录
[已确认的航班/酒店/景点选择]

## 用户反馈与修改要求
[用户的不满、修改要求、正面确认]

## 待处理事项
[尚未完成的用户请求]
</summary>

以下是需要摘要的对话历史：

{context}"""

    def _estimate_token_count(self, messages: list[dict]) -> int:
        """Rough token estimate from total character count."""
        total_chars = sum(len(msg.get("content", "")) for msg in messages)
        return int(total_chars / self._CHARS_PER_TOKEN)

    @staticmethod
    def _extract_summary_block(raw: str) -> str:
        """Extract content between <summary> tags; fallback to full text."""
        import re
        m = re.search(r"<summary>(.*?)</summary>", raw, re.DOTALL)
        return m.group(1).strip() if m else raw.strip()

    async def compress_if_needed(
        self,
        client: Any,
        model: str,
        *,
        max_history_chars: int = _MAX_HISTORY_CHARS,
        min_msgs: int = _MIN_MSGS_TO_COMPRESS,
        keep_recent: int = 5,
        consecutive_failures: int = 0,
    ) -> dict[str, Any]:
        """
        Auto-compress history when it exceeds token/size limits.

        Trigger: fires when EITHER condition is met:
          - total history chars > max_history_chars  (token-aware)
          - message count > min_msgs AND oldest messages are compressible

        Returns dict with keys:
          - compressed (bool): whether compression was performed
          - consecutive_failures (int): updated failure counter for circuit breaker
          - summary_tokens (int): estimated tokens in the summary (0 if not compressed)

        Inspired by claude-code's autoCompact + compactConversation + PTL retry.
        """
        result: dict[str, Any] = {
            "compressed": False,
            "consecutive_failures": consecutive_failures,
            "summary_tokens": 0,
        }

        # ── Circuit breaker ──────────────────────────────────────────
        if consecutive_failures >= self._MAX_CONSECUTIVE_FAILURES:
            logger.warning(
                "Memory compress circuit breaker tripped (%d failures), skipping (session=%s)",
                consecutive_failures, self.session_id,
            )
            return result

        msgs = await self.get_full_history()

        # ── Dual trigger: token estimate + message count ─────────────
        total_chars = sum(len(m.get("content", "")) for m in msgs)
        over_char_limit = total_chars > max_history_chars
        over_msg_limit = len(msgs) > min_msgs

        if not over_char_limit and not over_msg_limit:
            return result

        # Need at least keep_recent+1 messages to have something to summarize
        if len(msgs) <= keep_recent:
            return result

        to_summarize = msgs[:-keep_recent]
        recent = msgs[-keep_recent:]

        logger.info(
            "Memory compress triggered: %d msgs, ~%d chars (limit=%d), session=%s",
            len(msgs), total_chars, max_history_chars, self.session_id,
        )

        # ── Build context text with PTL-safe truncation ──────────────
        context_text = self.build_context_string(to_summarize)

        # If context_text itself is too large for the compress call,
        # progressively drop oldest messages (claude-code's truncateHeadForPTLRetry).
        ptl_attempts = 0
        truncated_msgs = to_summarize
        while len(context_text) > self._MAX_SUMMARIZE_INPUT_CHARS:
            ptl_attempts += 1
            if ptl_attempts > self._MAX_PTL_RETRIES:
                logger.warning(
                    "Memory compress: context still too large after %d PTL retries "
                    "(%d chars), dropping oldest 20%% (session=%s)",
                    ptl_attempts, len(context_text), self.session_id,
                )
                break
            # Drop oldest ~20% of messages each retry
            drop_count = max(1, len(truncated_msgs) // 5)
            truncated_msgs = truncated_msgs[drop_count:]
            if not truncated_msgs:
                logger.warning("Memory compress: nothing left to summarize after truncation")
                return result
            context_text = self.build_context_string(truncated_msgs)
            logger.info(
                "Memory compress PTL retry #%d: dropped %d oldest msgs, %d chars remaining",
                ptl_attempts, drop_count, len(context_text),
            )

        # Final safety cap (hard truncate if still oversized)
        if len(context_text) > self._MAX_SUMMARIZE_INPUT_CHARS:
            context_text = context_text[-self._MAX_SUMMARIZE_INPUT_CHARS:]

        # ── Call LLM with structured prompt ──────────────────────────
        prompt = self._COMPACT_PROMPT_TEMPLATE.format(context=context_text)
        try:
            completion = await client.chat.completions.create(
                model=model,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_response = completion.choices[0].message.content or ""
        except Exception as exc:
            logger.warning(
                "Memory compress LLM call failed (attempt will count toward circuit breaker): %s",
                exc,
            )
            result["consecutive_failures"] = consecutive_failures + 1
            return result

        if not raw_response.strip():
            logger.warning("Memory compress: LLM returned empty response")
            result["consecutive_failures"] = consecutive_failures + 1
            return result

        # Extract structured summary (strip <analysis> scratchpad)
        summary_text = self._extract_summary_block(raw_response)

        # ── Build compressed message list ────────────────────────────
        # Boundary marker: records that compression happened (for debugging/audit)
        boundary_msg: dict[str, Any] = {
            "role": "system",
            "content": "[compact_boundary] 以下是自动压缩后的对话历史。",
            "timestamp": datetime.utcnow().isoformat(),
            "is_compact_boundary": True,
            "compact_metadata": {
                "original_msg_count": len(msgs),
                "summarized_msg_count": len(to_summarize),
                "kept_recent_count": len(recent),
                "ptl_retries": ptl_attempts,
            },
        }

        summary_msg: dict[str, Any] = {
            "role": "system",
            "content": f"[历史对话摘要]\n{summary_text}",
            "timestamp": datetime.utcnow().isoformat(),
            "is_summary": True,
        }

        compressed = [boundary_msg, summary_msg] + recent

        # ── Write back to storage ────────────────────────────────────
        await self.clear()
        for msg in compressed:
            entry = json.dumps(msg, ensure_ascii=False)
            if self._redis is not None:
                try:
                    await self._redis.rpush(self._key, entry)
                    await self._redis.expire(self._key, self._ttl)
                    continue
                except Exception as exc:
                    logger.warning("Redis rpush failed during compression: %s", exc)
            _FALLBACK_STORE.setdefault(self._key, []).append(json.loads(entry))

        summary_tokens = self._estimate_token_count([summary_msg])
        logger.info(
            "Memory compressed: %d msgs → boundary + summary (~%d tok) + %d recent (session=%s)",
            len(to_summarize), summary_tokens, len(recent), self.session_id,
        )

        result["compressed"] = True
        result["consecutive_failures"] = 0  # Reset on success
        result["summary_tokens"] = summary_tokens
        return result
