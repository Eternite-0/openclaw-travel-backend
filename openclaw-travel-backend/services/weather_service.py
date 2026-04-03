from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client

CITY_COORDINATES: dict[str, dict[str, float]] = {
    "纽约": {"lat": 40.7128, "lon": -74.0060},
    "New York": {"lat": 40.7128, "lon": -74.0060},
    "洛杉矶": {"lat": 34.0522, "lon": -118.2437},
    "Los Angeles": {"lat": 34.0522, "lon": -118.2437},
    "东京": {"lat": 35.6762, "lon": 139.6503},
    "Tokyo": {"lat": 35.6762, "lon": 139.6503},
    "伦敦": {"lat": 51.5074, "lon": -0.1278},
    "London": {"lat": 51.5074, "lon": -0.1278},
    "巴黎": {"lat": 48.8566, "lon": 2.3522},
    "Paris": {"lat": 48.8566, "lon": 2.3522},
    "悉尼": {"lat": -33.8688, "lon": 151.2093},
    "Sydney": {"lat": -33.8688, "lon": 151.2093},
    "新加坡": {"lat": 1.3521, "lon": 103.8198},
    "Singapore": {"lat": 1.3521, "lon": 103.8198},
    "首尔": {"lat": 37.5665, "lon": 126.9780},
    "Seoul": {"lat": 37.5665, "lon": 126.9780},
    "曼谷": {"lat": 13.7563, "lon": 100.5018},
    "Bangkok": {"lat": 13.7563, "lon": 100.5018},
    "迪拜": {"lat": 25.2048, "lon": 55.2708},
    "Dubai": {"lat": 25.2048, "lon": 55.2708},
    "罗马": {"lat": 41.9028, "lon": 12.4964},
    "Rome": {"lat": 41.9028, "lon": 12.4964},
    "巴塞罗那": {"lat": 41.3851, "lon": 2.1734},
    "Barcelona": {"lat": 41.3851, "lon": 2.1734},
    "多伦多": {"lat": 43.6532, "lon": -79.3832},
    "Toronto": {"lat": 43.6532, "lon": -79.3832},
    "温哥华": {"lat": 49.2827, "lon": -123.1207},
    "Vancouver": {"lat": 49.2827, "lon": -123.1207},
    "上海": {"lat": 31.2304, "lon": 121.4737},
    "Shanghai": {"lat": 31.2304, "lon": 121.4737},
    "北京": {"lat": 39.9042, "lon": 116.4074},
    "Beijing": {"lat": 39.9042, "lon": 116.4074},
    "广州": {"lat": 23.1291, "lon": 113.2644},
    "Guangzhou": {"lat": 23.1291, "lon": 113.2644},
    "香港": {"lat": 22.3193, "lon": 114.1694},
    "Hong Kong": {"lat": 22.3193, "lon": 114.1694},
    "台北": {"lat": 25.0330, "lon": 121.5654},
    "Taipei": {"lat": 25.0330, "lon": 121.5654},
    "吉隆坡": {"lat": 3.1390, "lon": 101.6869},
    "Kuala Lumpur": {"lat": 3.1390, "lon": 101.6869},
    "雅加达": {"lat": -6.2088, "lon": 106.8456},
    "Jakarta": {"lat": -6.2088, "lon": 106.8456},
    "胡志明市": {"lat": 10.8231, "lon": 106.6297},
    "Ho Chi Minh City": {"lat": 10.8231, "lon": 106.6297},
    "孟买": {"lat": 19.0760, "lon": 72.8777},
    "Mumbai": {"lat": 19.0760, "lon": 72.8777},
    "开罗": {"lat": 30.0444, "lon": 31.2357},
    "Cairo": {"lat": 30.0444, "lon": 31.2357},
    "伊斯坦布尔": {"lat": 41.0082, "lon": 28.9784},
    "Istanbul": {"lat": 41.0082, "lon": 28.9784},
    "阿姆斯特丹": {"lat": 52.3676, "lon": 4.9041},
    "Amsterdam": {"lat": 52.3676, "lon": 4.9041},
    "柏林": {"lat": 52.5200, "lon": 13.4050},
    "Berlin": {"lat": 52.5200, "lon": 13.4050},
    "马德里": {"lat": 40.4168, "lon": -3.7038},
    "Madrid": {"lat": 40.4168, "lon": -3.7038},
    "迈阿密": {"lat": 25.7617, "lon": -80.1918},
    "Miami": {"lat": 25.7617, "lon": -80.1918},
    "芝加哥": {"lat": 41.8781, "lon": -87.6298},
    "Chicago": {"lat": 41.8781, "lon": -87.6298},
    "旧金山": {"lat": 37.7749, "lon": -122.4194},
    "San Francisco": {"lat": 37.7749, "lon": -122.4194},
    "拉斯维加斯": {"lat": 36.1699, "lon": -115.1398},
    "Las Vegas": {"lat": 36.1699, "lon": -115.1398},
}

_DEFAULT_COORDS = {"lat": 40.7128, "lon": -74.0060}

_WMO_CODE_MAP: dict[int, str] = {
    0: "晴天",
    1: "晴间多云",
    2: "多云",
    3: "阴天",
    45: "雾",
    48: "冻雾",
    51: "小毛毛雨",
    53: "中毛毛雨",
    55: "大毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    81: "中阵雨",
    82: "强阵雨",
    95: "雷阵雨",
    96: "雷暴夹小冰雹",
    99: "雷暴夹大冰雹",
}


def get_city_coordinates(city_name: str) -> dict[str, float]:
    for key, coords in CITY_COORDINATES.items():
        if key.lower() in city_name.lower() or city_name.lower() in key.lower():
            return coords
    logger.warning("No coordinates found for city '%s', using default (New York)", city_name)
    return _DEFAULT_COORDS


async def get_forecast(
    lat: float,
    lon: float,
    days: int,
    start_date: date | None = None,
) -> list[dict[str, Any]]:
    days = min(max(days, 1), 16)
    url = "https://api.open-meteo.com/v1/forecast"
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
        "timezone": "auto",
        "forecast_days": days,
    }
    if start_date:
        params["start_date"] = start_date.isoformat()
        params["end_date"] = (start_date + timedelta(days=days - 1)).isoformat()

    try:
        client = _get_client()
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Open-Meteo API failed: %s — using mock data", exc)
        return _mock_forecast(days, start_date)

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temp_max = daily.get("temperature_2m_max", [])
    temp_min = daily.get("temperature_2m_min", [])
    precip = daily.get("precipitation_sum", [])
    weather_codes = daily.get("weathercode", [])

    results: list[dict[str, Any]] = []
    for i, d in enumerate(dates):
        code = int(weather_codes[i]) if i < len(weather_codes) else 0
        results.append({
            "date": d,
            "condition_code": code,
            "condition": _WMO_CODE_MAP.get(code, "未知"),
            "temp_high_c": float(temp_max[i]) if i < len(temp_max) and temp_max[i] is not None else 20.0,
            "temp_low_c": float(temp_min[i]) if i < len(temp_min) and temp_min[i] is not None else 12.0,
            "precipitation_mm": float(precip[i]) if i < len(precip) and precip[i] is not None else 0.0,
        })
    return results


def _mock_forecast(days: int, start_date: date | None) -> list[dict[str, Any]]:
    base = start_date or date.today()
    return [
        {
            "date": (base + timedelta(days=i)).isoformat(),
            "condition_code": 1,
            "condition": "晴间多云",
            "temp_high_c": 22.0 + i * 0.5,
            "temp_low_c": 14.0 + i * 0.3,
            "precipitation_mm": 0.0,
        }
        for i in range(days)
    ]
