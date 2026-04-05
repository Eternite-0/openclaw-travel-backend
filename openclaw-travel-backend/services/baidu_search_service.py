from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

BAIDU_AI_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/chat/completions"
BAIDU_WEB_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/web_search"

_http_client: httpx.AsyncClient | None = None
_state_lock = asyncio.Lock()

_SMART_DAILY_LIMIT = 100
_WEB_DAILY_LIMIT = 50
_TOTAL_DAILY_LIMIT = _SMART_DAILY_LIMIT + _WEB_DAILY_LIMIT

_quota_state: dict[str, dict[str, Any]] = {}
_task_key_map: dict[str, str] = {}
_rr_index = 0


def _cn_today() -> str:
    return (datetime.utcnow() + timedelta(hours=8)).date().isoformat()


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=40.0)
    return _http_client


def _auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _alt_auth_headers(api_key: str) -> dict[str, str]:
    return {"X-Appbuilder-Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _get_api_keys() -> list[str]:
    settings = get_settings()
    keys: list[str] = []
    if settings.baidu_ai_search_api_keys:
        keys.extend([k.strip() for k in settings.baidu_ai_search_api_keys.split(",") if k.strip()])
    if settings.baidu_ai_search_api_key:
        single = settings.baidu_ai_search_api_key.strip()
        if single and single not in keys:
            keys.append(single)
    return keys


def _ensure_key_state(api_key: str) -> None:
    today = _cn_today()
    state = _quota_state.get(api_key)
    if state is None or state.get("date") != today:
        _quota_state[api_key] = {"date": today, "smart_used": 0, "web_used": 0}


async def _select_key_for_task(task_id: str = "") -> Optional[str]:
    global _rr_index
    keys = _get_api_keys()
    if not keys:
        return None

    async with _state_lock:
        if task_id and task_id in _task_key_map and _task_key_map[task_id] in keys:
            return _task_key_map[task_id]

        idx = _rr_index % len(keys)
        chosen = keys[idx]
        _rr_index = (_rr_index + 1) % len(keys)
        if task_id:
            _task_key_map[task_id] = chosen
        return chosen


def _quota_snapshot(api_key: str) -> tuple[int, int, int]:
    _ensure_key_state(api_key)
    state = _quota_state[api_key]
    smart_left = _SMART_DAILY_LIMIT - int(state["smart_used"])
    web_left = _WEB_DAILY_LIMIT - int(state["web_used"])
    total_left = _TOTAL_DAILY_LIMIT - int(state["smart_used"]) - int(state["web_used"])
    return max(smart_left, 0), max(web_left, 0), max(total_left, 0)


async def _pick_slot(api_key: str, prefer_web: bool = True) -> Optional[str]:
    async with _state_lock:
        _ensure_key_state(api_key)
        state = _quota_state[api_key]
        total_used = int(state["smart_used"]) + int(state["web_used"])
        if total_used >= _TOTAL_DAILY_LIMIT:
            return None

        if prefer_web:
            if int(state["web_used"]) < _WEB_DAILY_LIMIT:
                return "web"
            if int(state["smart_used"]) < _SMART_DAILY_LIMIT:
                return "smart"
            return None

        if int(state["smart_used"]) < _SMART_DAILY_LIMIT:
            return "smart"
        if int(state["web_used"]) < _WEB_DAILY_LIMIT:
            return "web"
        return None


async def _can_use_slot(api_key: str, slot: str) -> bool:
    async with _state_lock:
        _ensure_key_state(api_key)
        state = _quota_state[api_key]
        total_used = int(state["smart_used"]) + int(state["web_used"])
        if total_used >= _TOTAL_DAILY_LIMIT:
            return False
        if slot == "web":
            if int(state["web_used"]) >= _WEB_DAILY_LIMIT:
                return False
            return True
        if slot == "smart":
            if int(state["smart_used"]) >= _SMART_DAILY_LIMIT:
                return False
            return True
        return False


async def _consume_slot_on_success(api_key: str, slot: str) -> None:
    async with _state_lock:
        _ensure_key_state(api_key)
        state = _quota_state[api_key]
        if slot == "web":
            if int(state["web_used"]) < _WEB_DAILY_LIMIT:
                state["web_used"] += 1
            return
        if slot == "smart":
            if int(state["smart_used"]) < _SMART_DAILY_LIMIT:
                state["smart_used"] += 1
            return


async def _post_with_auth_variants(url: str, payload: dict[str, Any], api_key: str) -> httpx.Response:
    client = _get_client()
    resp = await client.post(url, headers=_auth_headers(api_key), json=payload)
    if resp.status_code in {401, 403}:
        resp = await client.post(url, headers=_alt_auth_headers(api_key), json=payload)
    return resp


async def _call_smart_search(api_key: str, query: str) -> dict[str, Any]:
    settings = get_settings()
    payload: dict[str, Any] = {
        "messages": [{"role": "user", "content": query}],
        "stream": False,
        "model": settings.baidu_ai_search_model,
        "instruction": "##",
        "enable_corner_markers": True,
        "enable_deep_search": False,
    }
    resp = await _post_with_auth_variants(BAIDU_AI_SEARCH_URL, payload, api_key)
    resp.raise_for_status()
    return resp.json()


async def _call_web_search(api_key: str, query: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "messages": [{"role": "user", "content": query}],
        "search_source": "baidu_search_v2",
        "resource_type_filter": [{"type": "web", "top_k": 20}],
        "search_recency_filter": "year",
    }
    resp = await _post_with_auth_variants(BAIDU_WEB_SEARCH_URL, payload, api_key)
    resp.raise_for_status()
    return resp.json()


def _extract_ai_answer(data: dict[str, Any]) -> str:
    choices = data.get("choices", [])
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message", {}) if isinstance(first, dict) else {}
    content = message.get("content", "") if isinstance(message, dict) else ""
    return content if isinstance(content, str) else ""


def _format_references_block(data: dict[str, Any], label: str, ai_answer: str = "") -> str:
    refs = data.get("references", [])
    if not isinstance(refs, list):
        refs = []
    refs = refs[:6]
    if not refs and not ai_answer:
        return ""

    lines = [f"【{label}】"]
    if ai_answer:
        lines.append(f"AI摘要: {ai_answer[:350]}")
    for i, item in enumerate(refs, 1):
        title = item.get("title", "")
        content = item.get("content", item.get("snippet", ""))
        url = item.get("url", "")
        if isinstance(content, str):
            content = content[:220]
        lines.append(f"  [{i}] {title}\n      {content}\n      来源: {url}")
    return "\n".join(lines)


async def search_with_fallback(
    query: str,
    label_prefix: str,
    task_id: str = "",
    prefer_web: bool = True,
) -> str:
    settings = get_settings()
    if not settings.baidu_ai_search_enabled:
        return ""

    api_key = await _select_key_for_task(task_id=task_id)
    if not api_key:
        return ""

    slot = await _pick_slot(api_key, prefer_web=prefer_web)
    if slot is None:
        smart_left, web_left, total_left = _quota_snapshot(api_key)
        logger.info(
            "Baidu key quota exhausted. key_tail=%s smart_left=%d web_left=%d total_left=%d",
            api_key[-8:], smart_left, web_left, total_left,
        )
        return ""

    async def _run_once(current_slot: str) -> str:
        if current_slot == "web":
            data = await _call_web_search(api_key, query)
            return _format_references_block(data, f"{label_prefix}（百度搜索）")
        data = await _call_smart_search(api_key, query)
        return _format_references_block(
            data,
            f"{label_prefix}（百度智能搜索生成）",
            ai_answer=_extract_ai_answer(data),
        )

    try:
        result = await _run_once(slot)
        await _consume_slot_on_success(api_key, slot)
        return result
    except httpx.HTTPStatusError as exc:
        body = ""
        try:
            body = (exc.response.text or "")[:500]
        except Exception:
            body = ""
        logger.warning(
            "Baidu %s failed key_tail=%s query='%s' status=%s body=%s",
            slot, api_key[-8:], query[:70], exc.response.status_code if exc.response is not None else "unknown", body,
        )
    except Exception as exc:
        logger.warning("Baidu %s failed key_tail=%s query='%s': %r", slot, api_key[-8:], query[:70], exc)

    alt_slot = "smart" if slot == "web" else "web"
    if await _can_use_slot(api_key, alt_slot):
        try:
            result = await _run_once(alt_slot)
            await _consume_slot_on_success(api_key, alt_slot)
            return result
        except Exception as exc:
            logger.warning("Baidu %s fallback failed key_tail=%s query='%s': %r", alt_slot, api_key[-8:], query[:70], exc)
    return ""


async def search_hotels(city: str, check_in: str, check_out: str, task_id: str = "") -> str:
    if not city or not city.strip():
        return ""
    query = f"{city} 酒店 推荐 {check_in} 到 {check_out} 价格 评分 地址 交通"
    return await search_with_fallback(query, "酒店实时搜索", task_id=task_id, prefer_web=True)


async def search_attractions(city: str, country: str = "", task_id: str = "") -> str:
    if not city or not city.strip():
        return ""
    location = f"{city} {country}".strip()
    query = f"{location} 旅游景点 推荐 门票 开放时间 地址 游玩攻略"
    return await search_with_fallback(query, "景点实时搜索", task_id=task_id, prefer_web=True)


async def search_flights(
    origin_city: str,
    dest_city: str,
    departure_date: str,
    return_date: str,
    task_id: str = "",
) -> str:
    query = f"{origin_city} 到 {dest_city} 机票 {departure_date} 往返 {return_date} 航司 价格 时长"
    return await search_with_fallback(query, "航班实时搜索", task_id=task_id, prefer_web=True)


async def search_restaurants(city: str, budget_level: str = "standard", task_id: str = "") -> str:
    query = f"{city} 餐厅 推荐 {budget_level} 人均 特色菜 地址 评分"
    return await search_with_fallback(query, "餐厅实时搜索", task_id=task_id, prefer_web=True)


async def search_visa(origin_country: str, dest_country: str, dest_city: str = "", task_id: str = "") -> str:
    query = f"{origin_country} 去 {dest_country} {dest_city} 签证 入境 政策 材料 时效 费用"
    return await search_with_fallback(query, "签证实时搜索", task_id=task_id, prefer_web=True)
