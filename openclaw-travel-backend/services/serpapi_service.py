from __future__ import annotations

import logging
from datetime import date
from typing import Any

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

SERPAPI_BASE = "https://serpapi.com/search"

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client

CITY_TO_IATA: dict[str, str] = {
    "广州": "CAN", "Guangzhou": "CAN",
    "北京": "PEK", "Beijing": "PEK",
    "上海": "PVG", "Shanghai": "PVG",
    "深圳": "SZX", "Shenzhen": "SZX",
    "成都": "CTU", "Chengdu": "CTU",
    "重庆": "CKG", "Chongqing": "CKG",
    "武汉": "WUH", "Wuhan": "WUH",
    "西安": "XIY", "Xian": "XIY",
    "杭州": "HGH", "Hangzhou": "HGH",
    "南京": "NKG", "Nanjing": "NKG",
    "纽约": "JFK", "New York": "JFK",
    "洛杉矶": "LAX", "Los Angeles": "LAX",
    "旧金山": "SFO", "San Francisco": "SFO",
    "芝加哥": "ORD", "Chicago": "ORD",
    "迈阿密": "MIA", "Miami": "MIA",
    "拉斯维加斯": "LAS", "Las Vegas": "LAS",
    "西雅图": "SEA", "Seattle": "SEA",
    "波士顿": "BOS", "Boston": "BOS",
    "东京": "NRT", "Tokyo": "NRT",
    "大阪": "KIX", "Osaka": "KIX",
    "首尔": "ICN", "Seoul": "ICN",
    "伦敦": "LHR", "London": "LHR",
    "巴黎": "CDG", "Paris": "CDG",
    "法兰克福": "FRA", "Frankfurt": "FRA",
    "阿姆斯特丹": "AMS", "Amsterdam": "AMS",
    "罗马": "FCO", "Rome": "FCO",
    "巴塞罗那": "BCN", "Barcelona": "BCN",
    "马德里": "MAD", "Madrid": "MAD",
    "悉尼": "SYD", "Sydney": "SYD",
    "墨尔本": "MEL", "Melbourne": "MEL",
    "新加坡": "SIN", "Singapore": "SIN",
    "曼谷": "BKK", "Bangkok": "BKK",
    "吉隆坡": "KUL", "Kuala Lumpur": "KUL",
    "迪拜": "DXB", "Dubai": "DXB",
    "香港": "HKG", "Hong Kong": "HKG",
    "台北": "TPE", "Taipei": "TPE",
    "多伦多": "YYZ", "Toronto": "YYZ",
    "温哥华": "YVR", "Vancouver": "YVR",
}


def get_iata(city: str) -> str:
    for key, code in CITY_TO_IATA.items():
        if key.lower() in city.lower() or city.lower() in key.lower():
            return code
    logger.warning("No IATA code for '%s', using default CAN", city)
    return "CAN"


async def search_flights(
    origin_city: str,
    dest_city: str,
    outbound_date: date,
    return_date: date,
    travelers: int = 1,
    currency: str = "CNY",
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.serpapi_enabled or not settings.serpapi_key:
        logger.info("SerpAPI disabled or no key — skipping flight search")
        return {}

    dep_iata = get_iata(origin_city)
    arr_iata = get_iata(dest_city)

    params: dict[str, Any] = {
        "engine": "google_flights",
        "departure_id": dep_iata,
        "arrival_id": arr_iata,
        "outbound_date": outbound_date.isoformat(),
        "return_date": return_date.isoformat(),
        "adults": travelers,
        "currency": currency,
        "hl": "zh-cn",
        "gl": "cn",
        "api_key": settings.serpapi_key,
    }

    try:
        client = _get_client()
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "SerpAPI flights: %s→%s on %s — %d results",
            dep_iata, arr_iata, outbound_date,
            len(data.get("best_flights", []) or data.get("other_flights", [])),
        )
        return data
    except Exception as exc:
        logger.warning("SerpAPI flight search failed [%s]: %s", type(exc).__name__, exc)
        return {}


async def search_hotels(
    city: str,
    check_in: date,
    check_out: date,
    adults: int = 1,
    currency: str = "CNY",
) -> dict[str, Any]:
    if not city or not city.strip():
        logger.warning("SerpAPI search_hotels skipped: empty city")
        return {}
    settings = get_settings()
    if not settings.serpapi_enabled or not settings.serpapi_key:
        logger.info("SerpAPI disabled or no key — skipping hotel search")
        return {}

    params: dict[str, Any] = {
        "engine": "google_hotels",
        "q": f"hotels in {city}",
        "check_in_date": check_in.isoformat(),
        "check_out_date": check_out.isoformat(),
        "adults": adults,
        "currency": currency,
        "hl": "zh-cn",
        "gl": "cn",
        "api_key": settings.serpapi_key,
    }

    try:
        client = _get_client()
        resp = await client.get(SERPAPI_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "SerpAPI hotels: %s %s→%s — %d results",
            city, check_in, check_out,
            len(data.get("properties", [])),
        )
        return data
    except Exception as exc:
        logger.warning("SerpAPI hotel search failed [%s]: %s", type(exc).__name__, exc)
        return {}


def extract_flight_summary(serpapi_data: dict[str, Any], max_results: int = 5) -> str:
    """Convert SerpAPI flights response to a compact text summary for LLM prompts."""
    if not serpapi_data:
        return "（未获取到实时航班数据）"

    lines: list[str] = []
    best = serpapi_data.get("best_flights", [])
    other = serpapi_data.get("other_flights", [])
    flights = (best + other)[:max_results]

    for i, flight in enumerate(flights, 1):
        price = flight.get("price", "N/A")
        duration = flight.get("total_duration", "N/A")
        legs = flight.get("flights", [])
        stops = len(legs) - 1 if legs else 0
        airline = legs[0].get("airline", "Unknown") if legs else "Unknown"
        dep_token = legs[0].get("departure_airport", {}).get("time", "") if legs else ""
        arr_token = legs[-1].get("arrival_airport", {}).get("time", "") if legs else ""
        lines.append(
            f"  [{i}] {airline} | 价格: {price} CNY | 时长: {duration}分钟 | "
            f"经停: {stops}次 | 出发: {dep_token} | 到达: {arr_token}"
        )

    return "【SerpAPI 实时航班数据】\n" + "\n".join(lines) if lines else "（暂无航班搜索结果）"


def extract_hotel_summary(serpapi_data: dict[str, Any], max_results: int = 6) -> str:
    """Convert SerpAPI hotels response to a compact text summary for LLM prompts."""
    if not serpapi_data:
        return "（未获取到实时酒店数据）"

    lines: list[str] = []
    properties = serpapi_data.get("properties", [])[:max_results]

    for i, prop in enumerate(properties, 1):
        name = prop.get("name", "Unknown")
        stars = prop.get("hotel_class", "N/A")
        rating = prop.get("overall_rating", "N/A")
        reviews = prop.get("reviews", "N/A")
        price = prop.get("rate_per_night", {}).get("lowest", "N/A")
        amenities = ", ".join(prop.get("amenities", [])[:4])
        lines.append(
            f"  [{i}] {name} | {stars}星 | 评分: {rating}/5 ({reviews}条评价) | "
            f"约: {price}/晚 | 设施: {amenities}"
        )

    return "【SerpAPI 实时酒店数据】\n" + "\n".join(lines) if lines else "（暂无酒店搜索结果）"
