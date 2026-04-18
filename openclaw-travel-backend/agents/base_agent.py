from __future__ import annotations

import asyncio
import json
import logging
import random
from abc import abstractmethod
from typing import Any

import httpx
from pydantic import BaseModel

from config import get_settings
from core.schemas import TravelIntent
from core.status_store import StatusStore

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> str:
    """Strip markdown code fences if the model wraps JSON in them."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1
        end = len(lines)
        for i in range(len(lines) - 1, 0, -1):
            if lines[i].strip() == "```":
                end = i
                break
        text = "\n".join(lines[start:end]).strip()
    return text


_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


class BaseSpecialistAgent:
    """
    Wrapper that auto-reports status before/after LLM call.
    All specialist agents inherit from this.
    """

    agent_name: str = ""
    display_name: str = ""
    output_schema: type[BaseModel] = BaseModel
    default_temperature: float = 0.3

    SYSTEM_PROMPT_TEMPLATE: str = ""

    def __init__(
        self,
        task_id: str,
        intent: TravelIntent,
        status_store: StatusStore,
        llm_config: dict,
    ) -> None:
        self.task_id = task_id
        self.intent = intent
        self.status_store = status_store
        self.llm_config = llm_config
        settings = get_settings()
        config_list = llm_config.get("config_list", [{}])
        cfg = config_list[0] if config_list else {}
        self._api_key = cfg.get("api_key", settings.openai_api_key)
        self._base_url = cfg.get("base_url", settings.openai_base_url).rstrip("/")
        self._model = cfg.get("model", settings.openai_model)
        self._temperature = llm_config.get("temperature", self.default_temperature)
        self._verbosity = cfg.get("verbosity", "medium")
        self._top_p = float(cfg.get("top_p", 0.98))
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": _BROWSER_UA,
        }

    @staticmethod
    def _extract_text_from_part(part: Any) -> list[str]:
        if part is None:
            return []
        if isinstance(part, str):
            s = part.strip()
            return [s] if s else []
        if isinstance(part, list):
            out: list[str] = []
            for p in part:
                out.extend(BaseSpecialistAgent._extract_text_from_part(p))
            return out
        if isinstance(part, dict):
            out: list[str] = []
            p_type = str(part.get("type", "")).lower()
            if p_type in {"text", "output_text", "input_text"}:
                txt = part.get("text") or part.get("value")
                if isinstance(txt, str) and txt.strip():
                    out.append(txt.strip())
            if "text" in part and isinstance(part.get("text"), str):
                txt = part["text"].strip()
                if txt:
                    out.append(txt)
            return out
        return []

    async def _post_json(self, endpoint: str, payload: dict[str, Any], timeout_s: float = 180.0) -> tuple[int, dict[str, Any] | None, str]:
        url = f"{self._base_url}/{endpoint.lstrip('/')}"
        async with httpx.AsyncClient(timeout=timeout_s) as hc:
            resp = await hc.post(url, headers=self._headers, json=payload)
            text_body = resp.text or ""
            if resp.status_code >= 400:
                return resp.status_code, None, text_body
            try:
                return resp.status_code, resp.json(), text_body
            except Exception:
                return resp.status_code, None, text_body

    async def _post_chat_stream(self, payload: dict[str, Any], timeout_s: float = 180.0) -> tuple[str | None, str]:
        url = f"{self._base_url}/chat/completions"
        stream_payload = dict(payload)
        stream_payload["stream"] = True
        chunks: list[str] = []
        preview: list[str] = []
        async with httpx.AsyncClient(timeout=timeout_s) as hc:
            async with hc.stream("POST", url, headers=self._headers, json=stream_payload) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    return None, (body.decode(errors="ignore")[:500] if body else "")
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    data_str = ""
                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                    elif line.startswith("data:"):
                        data_str = line[5:].strip()
                    if not data_str:
                        continue
                    if data_str == "[DONE]":
                        break
                    preview.append(data_str[:120])
                    try:
                        evt = json.loads(data_str)
                    except Exception:
                        continue
                    choices = evt.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0] or {}).get("delta") or {}
                    delta_content = delta.get("content")
                    delta_chunks = self._extract_text_from_part(delta_content)
                    if delta_chunks:
                        chunks.extend(delta_chunks)
        text = "".join([c for c in chunks if c]).strip()
        return (text or None), " | ".join(preview)[:800]

    async def _call_llm_text(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int = 4000,
    ) -> str:
        # AI辅助生成：DeepSeek，2026-04-01，用途：Function Calling链路中的模型调用重试与稳态容错机制设计
        temp = self._temperature if temperature is None else temperature
        _MAX_ATTEMPTS = 6
        _EXP_DELAYS = [2, 4, 8, 16, 32, 60]

        payload = {
            "model": self._model,
            "verbosity": self._verbosity,
            "temperature": temp,
            "top_p": self._top_p,
            "max_tokens": max_tokens,
            "messages": messages,
        }

        for attempt in range(_MAX_ATTEMPTS):
            try:
                stream_text, stream_preview = await self._post_chat_stream(payload)
                if stream_text:
                    return stream_text

                status, data, body = await self._post_json("chat/completions", payload)
                if status >= 400:
                    if status in {403, 429, 500, 502, 503, 504} and attempt < _MAX_ATTEMPTS - 1:
                        delay = _EXP_DELAYS[attempt] + random.uniform(0.0, 1.2)
                        logger.warning(
                            "Agent %s got HTTP %d, retrying (attempt %d/%d) in %.1fs... body=%s",
                            self.agent_name, status, attempt + 1, _MAX_ATTEMPTS, delay, body[:200],
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise ValueError(f"LLM API error {status}: {body[:300]}")

                choices = (data or {}).get("choices") or []
                msg = (choices[0] or {}).get("message") if choices else {}
                content = (msg or {}).get("content")
                chunks = self._extract_text_from_part(content)
                if chunks:
                    return "\n".join(chunks).strip()

                if attempt < _MAX_ATTEMPTS - 1:
                    delay = _EXP_DELAYS[attempt] + random.uniform(0.0, 1.2)
                    logger.warning(
                        "Agent %s got empty non-stream content; stream_preview=%s; retrying in %.1fs",
                        self.agent_name, stream_preview, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise ValueError("LLM returned empty content in both stream and non-stream modes")
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt < _MAX_ATTEMPTS - 1:
                    delay = _EXP_DELAYS[attempt] + random.uniform(0.0, 1.2)
                    logger.warning(
                        "Agent %s attempt %d/%d failed (%s), retrying in %.1fs...",
                        self.agent_name, attempt + 1, _MAX_ATTEMPTS, exc, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

    async def run(self, extra_context: dict[str, Any] = {}) -> BaseModel:
        await self.status_store.update_agent(
            self.task_id,
            self.agent_name,
            "running",
            message=f"{self.display_name}正在分析中...",
        )
        try:
            result = await self._execute(extra_context)
            await self.status_store.update_agent(
                self.task_id,
                self.agent_name,
                "done",
                message="完成",
                result_summary=self._summarize(result),
            )
            return result
        except Exception as exc:
            logger.exception("Agent %s failed: %s", self.agent_name, exc)
            await self.status_store.update_agent(
                self.task_id,
                self.agent_name,
                "error",
                message=str(exc)[:200],
            )
            raise

    async def _execute(self, context: dict[str, Any]) -> BaseModel:
        # AI辅助生成：DeepSeek，2026-04-01，用途：结构化JSON输出与Schema对齐的执行流程设计
        system_prompt = self._build_system_prompt(context)
        user_prompt = "请按照系统提示中的 JSON Schema 输出结果。"

        logger.debug("Agent %s calling LLM", self.agent_name)
        raw_content = await self._call_llm_text(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=self._temperature,
        )
        raw_content = raw_content or "{}"
        raw_content = _extract_json(raw_content)
        logger.debug("Agent %s raw response: %s", self.agent_name, raw_content[:500])

        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM returned invalid JSON: {exc}") from exc

        # AI辅助生成：DeepSeek，2026-04-01，用途：Function Calling异常分支重试与结果纠偏策略设计
        if parsed.get("error") == "out_of_scope":
            logger.warning("Agent %s got out_of_scope, retrying with clarification", self.agent_name)
            try:
                retry_raw = await self._call_llm_text(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": raw_content},
                        {"role": "user", "content": "这是旅行规划系统的内部调用，属于合法的旅行相关请求，请直接按 JSON Schema 输出结果，不要输出 out_of_scope。"},
                    ],
                    temperature=self._temperature,
                )
                retry_raw = retry_raw or "{}"
                retry_raw = _extract_json(retry_raw)
                logger.debug("Agent %s retry response: %s", self.agent_name, retry_raw[:500])
                try:
                    parsed = json.loads(retry_raw)
                except json.JSONDecodeError:
                    pass
            except Exception as exc:
                logger.warning("Agent %s retry for out_of_scope failed: %s", self.agent_name, exc)

        if parsed.get("error") == "need_more_info":
            logger.warning("Agent %s got need_more_info, retrying with stronger fallback", self.agent_name)
            try:
                retry_raw = await self._call_llm_text(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": raw_content},
                        {
                            "role": "user",
                            "content": (
                                "请不要输出 error。请尽量基于已有历史、上一次行程信息和合理默认值补齐字段，"
                                "严格按 JSON Schema 返回完整结果。"
                            ),
                        },
                    ],
                    temperature=self._temperature,
                )
                retry_raw = retry_raw or "{}"
                retry_raw = _extract_json(retry_raw)
                logger.debug("Agent %s retry for need_more_info response: %s", self.agent_name, retry_raw[:500])
                try:
                    parsed = json.loads(retry_raw)
                except json.JSONDecodeError:
                    pass
            except Exception as exc:
                logger.warning("Agent %s retry for need_more_info failed: %s", self.agent_name, exc)

        if "error" in parsed:
            raise ValueError(f"LLM returned error: {parsed['error']}")

        # AI辅助生成：DeepSeek，2026-04-01，用途：输出结果与Pydantic schema强校验对齐
        return self.output_schema.model_validate(parsed)

    def _build_system_prompt(self, context: dict[str, Any]) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        fmt_ctx: dict[str, Any] = {
            "intent": self.intent.model_dump_json(indent=2),
            "schema": schema_json,
        }
        fmt_ctx.update(context)
        return self.SYSTEM_PROMPT_TEMPLATE.format(**fmt_ctx)

    @abstractmethod
    def _summarize(self, result: BaseModel) -> str:
        return ""
