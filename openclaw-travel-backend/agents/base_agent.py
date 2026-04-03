from __future__ import annotations

import asyncio
import json
import logging
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
        self._temperature = llm_config.get("temperature", 0.3)
        self._http = httpx.AsyncClient(
            headers={
                "User-Agent": _BROWSER_UA,
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=120,
        )

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
        system_prompt = self._build_system_prompt(context)
        user_prompt = "请按照系统提示中的 JSON Schema 输出结果。"

        logger.debug("Agent %s calling LLM", self.agent_name)
        last_exc: Exception | None = None
        _retry_delays = [3, 6]
        for attempt in range(3):
            try:
                resp = await self._http.post(
                    f"{self._base_url}/chat/completions",
                    json={
                        "model": self._model,
                        "temperature": self._temperature,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                )
                break
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as exc:
                last_exc = exc
                if attempt < 2:
                    delay = _retry_delays[attempt]
                    logger.warning("Agent %s attempt %d failed (%s), retrying in %ds...", self.agent_name, attempt + 1, exc, delay)
                    await asyncio.sleep(delay)
                else:
                    raise
        if resp.status_code != 200:
            raise ValueError(f"LLM API error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"] or "{}"
        raw_content = _extract_json(raw_content)
        logger.debug("Agent %s raw response: %s", self.agent_name, raw_content[:500])

        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM returned invalid JSON: {exc}") from exc

        if parsed.get("error") == "out_of_scope":
            logger.warning("Agent %s got out_of_scope, retrying with clarification", self.agent_name)
            retry_resp = await self._http.post(
                f"{self._base_url}/chat/completions",
                json={
                    "model": self._model,
                    "temperature": self._temperature,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": raw_content},
                        {"role": "user", "content": "这是旅行规划系统的内部调用，属于合法的旅行相关请求，请直接按 JSON Schema 输出结果，不要输出 out_of_scope。"},
                    ],
                },
            )
            if retry_resp.status_code == 200:
                retry_raw = retry_resp.json()["choices"][0]["message"]["content"] or "{}"
                retry_raw = _extract_json(retry_raw)
                logger.debug("Agent %s retry response: %s", self.agent_name, retry_raw[:500])
                try:
                    parsed = json.loads(retry_raw)
                except json.JSONDecodeError:
                    pass

        if "error" in parsed:
            raise ValueError(f"LLM returned error: {parsed['error']}")

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
