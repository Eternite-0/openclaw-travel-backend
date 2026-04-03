from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

CRAWLEO_SEARCH_URL = "https://api.crawleo.dev/search"
CRAWLEO_CRAWL_URL = "https://api.crawleo.dev/crawl"

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client


def _auth_headers() -> dict[str, str]:
    settings = get_settings()
    return {"Authorization": f"Bearer {settings.crawleo_api_key}"}


async def search(query: str, count: int = 5) -> dict[str, Any]:
    """
    Crawleo real-time web search.
    Returns list of results with title, url, and content.
    """
    settings = get_settings()
    if not settings.crawleo_enabled or not settings.crawleo_api_key:
        logger.info("Crawleo disabled or no key — skipping search: %s", query)
        return {}

    params = {"query": query, "count": count}
    try:
        client = _get_client()
        resp = await client.get(
            CRAWLEO_SEARCH_URL,
            params=params,
            headers=_auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", data.get("data", []))
        logger.info("Crawleo search '%s' — %d results", query[:60], len(results))
        return data
    except Exception as exc:
        logger.warning("Crawleo search failed for '%s': %s", query, exc)
        return {}


async def crawl(url: str, markdown: bool = True) -> dict[str, Any]:
    """
    Crawleo URL crawl — returns clean structured content.
    """
    settings = get_settings()
    if not settings.crawleo_enabled or not settings.crawleo_api_key:
        logger.info("Crawleo disabled or no key — skipping crawl: %s", url)
        return {}

    params: dict[str, Any] = {"urls": url, "markdown": str(markdown).lower()}
    try:
        client = _get_client()
        resp = await client.get(
            CRAWLEO_CRAWL_URL,
            params=params,
            headers=_auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info("Crawleo crawl '%s' — success", url[:80])
        return data
    except Exception as exc:
        logger.warning("Crawleo crawl failed for '%s': %s", url, exc)
        return {}


async def search_flights(
    origin_city: str,
    dest_city: str,
    departure_date: str,
    return_date: str,
) -> str:
    """Search for real-time flight info and return formatted text for LLM prompt."""
    query = (
        f"{origin_city} to {dest_city} flights {departure_date} "
        f"return {return_date} airline price booking"
    )
    data = await search(query, count=5)
    return _format_results(data, label="Crawleo 航班实时搜索")


async def search_hotels(city: str, check_in: str, check_out: str) -> str:
    """Search for real-time hotel info and return formatted text for LLM prompt."""
    query = f"hotels in {city} {check_in} to {check_out} price rating reviews booking"
    data = await search(query, count=5)
    return _format_results(data, label="Crawleo 酒店实时搜索")


def _format_results(data: dict[str, Any], label: str) -> str:
    """Convert Crawleo search results to compact text for LLM prompt injection."""
    if not data:
        return f"（{label}：未获取到数据）"

    results = data.get("results", data.get("data", []))
    if not isinstance(results, list):
        results = []
    if not results:
        return f"（{label}：无搜索结果）"

    lines = [f"【{label}结果】"]
    for i, r in enumerate(results[:5], 1):
        title = r.get("title", r.get("name", ""))
        url = r.get("url", r.get("link", ""))
        snippet = r.get("snippet", r.get("description", r.get("content", "")))
        if isinstance(snippet, str):
            snippet = snippet[:250]
        lines.append(f"  [{i}] {title}\n      {snippet}\n      来源: {url}")

    return "\n".join(lines)
