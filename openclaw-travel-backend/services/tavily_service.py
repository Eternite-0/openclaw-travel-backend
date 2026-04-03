from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"


async def search(
    query: str,
    search_depth: str = "basic",
    max_results: int = 5,
    include_domains: list[str] | None = None,
) -> dict[str, Any]:
    """
    Tavily AI-powered web search.
    Returns structured results with title, url, content snippet, and score.
    """
    settings = get_settings()
    if not settings.tavily_enabled or not settings.tavily_api_key:
        logger.info("Tavily disabled or no key — skipping search for: %s", query)
        return {}

    payload: dict[str, Any] = {
        "api_key": settings.tavily_api_key,
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "include_answer": True,
        "include_raw_content": False,
    }
    if include_domains:
        payload["include_domains"] = include_domains

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(TAVILY_SEARCH_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            logger.info(
                "Tavily search '%s' — %d results, answer: %s",
                query[:60],
                len(data.get("results", [])),
                bool(data.get("answer")),
            )
            return data
    except Exception as exc:
        logger.warning("Tavily search failed for '%s': %s", query, exc)
        return {}


async def search_hotels(city: str, budget_cny: float, duration_days: int) -> str:
    """Search for hotel information and return a formatted summary for LLM context."""
    per_night = budget_cny * 0.25 / max(duration_days, 1)
    query = (
        f"best hotels in {city} price range budget mid-range luxury "
        f"recommendations reviews {int(per_night)} CNY per night"
    )
    data = await search(query, search_depth="basic", max_results=5)
    return _format_results(data, label="Tavily 酒店搜索")


async def search_flights(
    origin_city: str,
    dest_city: str,
    departure_date: str,
    return_date: str,
) -> str:
    """Search for flight information and return a formatted summary for LLM context."""
    query = (
        f"flights from {origin_city} to {dest_city} "
        f"{departure_date} return {return_date} price airlines duration"
    )
    data = await search(query, search_depth="basic", max_results=5)
    return _format_results(data, label="Tavily 航班搜索")


def _format_results(data: dict[str, Any], label: str) -> str:
    """Convert Tavily results to a compact text block for LLM prompt injection."""
    if not data:
        return f"（{label}：未获取到数据）"

    lines: list[str] = [f"【{label}结果】"]

    answer = data.get("answer")
    if answer:
        lines.append(f"AI摘要: {answer[:300]}")

    results = data.get("results", [])
    for i, r in enumerate(results[:4], 1):
        title = r.get("title", "")
        content = r.get("content", "")[:200]
        url = r.get("url", "")
        score = r.get("score", 0)
        lines.append(f"  [{i}] {title} (相关度:{score:.2f})\n      {content}\n      来源: {url}")

    return "\n".join(lines)
