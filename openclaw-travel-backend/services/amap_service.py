"""
高德地图步行导航服务
调用高德 Web API 获取两点之间的步行路径折线，用于前端地图渲染真实路线。

API 文档: https://lbs.amap.com/api/webservice/guide/api/newroute#t6
"""

import logging
from typing import Optional
import httpx
import asyncio
import math

from config import get_settings

logger = logging.getLogger(__name__)

AMAP_WALKING_URL = "https://restapi.amap.com/v5/direction/walking"
AMAP_DRIVING_URL = "https://restapi.amap.com/v5/direction/driving"
AMAP_RIDING_URL = "https://restapi.amap.com/v5/direction/bicycling"
AMAP_GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _geocode_text(address: str, city: str = "") -> Optional[tuple[float, float]]:
    settings = get_settings()
    if not settings.amap_enabled or not settings.amap_api_key:
        return None
    if not address or not address.strip():
        return None

    params = {
        "key": settings.amap_api_key,
        "address": address.strip(),
        "city": city.strip() if city else "",
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(AMAP_GEOCODE_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        if data.get("status") != "1" or data.get("infocode") != "10000":
            return None
        geocodes = data.get("geocodes", [])
        if not isinstance(geocodes, list) or not geocodes:
            return None
        loc = geocodes[0].get("location", "")
        if not isinstance(loc, str) or "," not in loc:
            return None
        lng_s, lat_s = loc.split(",", 1)
        return float(lat_s), float(lng_s)
    except Exception:
        return None


async def _normalize_waypoint(point: dict) -> dict:
    """
    使用高德地理编码对坐标做纠偏：
    - 仅在提供了 name/location/city 且解析成功时尝试替换
    - 为避免误纠偏，若与原坐标距离 > 30km 则放弃替换
    """
    lat = float(point.get("lat", 0.0))
    lng = float(point.get("lng", 0.0))
    name = str(point.get("name", "") or "").strip()
    location = str(point.get("location", "") or "").strip()
    city = str(point.get("city", "") or "").strip()

    text_candidates: list[str] = []
    if location:
        text_candidates.append(location)
        if city:
            text_candidates.append(f"{city}{location}")
    if name:
        text_candidates.append(name)
        if city:
            text_candidates.append(f"{city}{name}")
    # 去重保持顺序
    dedup: list[str] = []
    for t in text_candidates:
        if t and t not in dedup:
            dedup.append(t)
    if not dedup:
        return point

    best: Optional[tuple[float, float]] = None
    best_dist = float("inf")

    for text in dedup[:4]:
        geo = await _geocode_text(text, city=city)
        if not geo:
            continue
        g_lat, g_lng = geo
        d = _distance_m(lat, lng, g_lat, g_lng)
        if d < best_dist:
            best_dist = d
            best = (g_lat, g_lng)

    if not best:
        return point

    # 高德主导坐标：命中即覆盖。保留距离日志，便于回归评估。
    if best_dist > 5000:
        logger.warning(
            "AMap waypoint corrected with large shift: %.0fm, name=%s, location=%s",
            best_dist, name[:30], location[:30],
        )
    elif best_dist > 120:
        logger.info(
            "AMap waypoint corrected: %.0fm shift, name=%s, location=%s",
            best_dist, name[:30], location[:30],
        )

    corrected = dict(point)
    corrected["lat"] = best[0]
    corrected["lng"] = best[1]
    return corrected


async def get_walking_route(
    origin_lng: float,
    origin_lat: float,
    dest_lng: float,
    dest_lat: float,
) -> Optional[list[list[float]]]:
    """
    获取两点之间的步行路径。

    Args:
        origin_lng, origin_lat: 起点经纬度 (GCJ-02)
        dest_lng, dest_lat: 终点经纬度 (GCJ-02)

    Returns:
        路径点列表 [[lat, lng], [lat, lng], ...] 供 Leaflet 直接使用，
        失败返回 None。
    """
    settings = get_settings()
    if not settings.amap_enabled or not settings.amap_api_key:
        logger.warning("AMap service disabled or API key not set")
        return None

    def _parse_polyline(data: dict) -> list[list[float]]:
        route = data.get("route", {})
        paths = route.get("paths", [])
        if not paths:
            return []
        path0 = paths[0]

        points: list[list[float]] = []
        steps = path0.get("steps", [])
        if isinstance(steps, list) and steps:
            for step in steps:
                polyline_str = step.get("polyline", "")
                if not polyline_str:
                    continue
                for pair in polyline_str.split(";"):
                    parts = pair.split(",")
                    if len(parts) == 2:
                        lng, lat = float(parts[0]), float(parts[1])
                        points.append([lat, lng])

        # 部分模式可能直接返回 path polyline
        if not points:
            polyline_str = path0.get("polyline", "")
            if isinstance(polyline_str, str) and polyline_str:
                for pair in polyline_str.split(";"):
                    parts = pair.split(",")
                    if len(parts) == 2:
                        lng, lat = float(parts[0]), float(parts[1])
                        points.append([lat, lng])
        return points

    async def _request_route(url: str, params: dict, mode: str) -> Optional[list[list[float]]]:
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=12) as client:
                    resp = await client.get(url, params=params)
                    resp.raise_for_status()
                    data = resp.json()

                if data.get("status") != "1" or data.get("infocode") != "10000":
                    logger.warning(
                        "AMap %s API error: status=%s info=%s infocode=%s",
                        mode, data.get("status"), data.get("info"), data.get("infocode"),
                    )
                    continue

                points = _parse_polyline(data)
                if points:
                    logger.info(
                        "AMap %s route: %s points, %.6f,%.6f → %.6f,%.6f",
                        mode, len(points), origin_lat, origin_lng, dest_lat, dest_lng,
                    )
                    return points
                logger.warning("AMap %s API returned empty polyline", mode)
            except httpx.HTTPError as exc:
                logger.warning("AMap %s API HTTP error (attempt %d): %s: %s", mode, attempt + 1, type(exc).__name__, exc)
            except Exception as exc:
                logger.warning("AMap %s API error (attempt %d): %s: %s", mode, attempt + 1, type(exc).__name__, exc)
            await asyncio.sleep(0.25)
        return None

    # 1) 优先步行
    walk_params = {
        "key": settings.amap_api_key,
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
        "isindoor": "0",
        "show_fields": "polyline",
    }
    points = await _request_route(AMAP_WALKING_URL, walk_params, "walking")
    if points:
        return points

    # 2) 步行失败回退驾车（仍然是道路折线）
    driving_params = {
        "key": settings.amap_api_key,
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
        "strategy": "0",
        "show_fields": "polyline",
    }
    points = await _request_route(AMAP_DRIVING_URL, driving_params, "driving")
    if points:
        return points

    # 3) 再回退骑行（道路折线）
    riding_params = {
        "key": settings.amap_api_key,
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
        "show_fields": "polyline",
    }
    points = await _request_route(AMAP_RIDING_URL, riding_params, "riding")
    return points


async def get_walking_route_multi(
    waypoints: list[dict],
) -> list[list[list[float]]]:
    """
    获取多个连续路径点之间的步行路径。

    Args:
        waypoints: [{"lat": float, "lng": float}, ...] 按顺序排列的路径点

    Returns:
        每段路径的折线点列表: [segment1_points, segment2_points, ...]
        若部分分段失败，会保留成功分段，避免全量退化为直线。
    """
    if len(waypoints) < 2:
        return []

    # 先做坐标纠偏，减少 LLM 坐标偏差与真实道路冲突
    normalized_waypoints: list[dict] = []
    for idx, wp in enumerate(waypoints):
        if idx > 0:
            await asyncio.sleep(0.05)
        try:
            normalized_waypoints.append(await _normalize_waypoint(wp))
        except Exception as exc:
            logger.warning("AMap waypoint normalize failed at %d: %s", idx, exc)
            normalized_waypoints.append(wp)

    segments: list[list[list[float]]] = []
    failed_segments = 0
    for i in range(len(normalized_waypoints) - 1):
        origin = normalized_waypoints[i]
        dest = normalized_waypoints[i + 1]

        if i > 0:
            await asyncio.sleep(0.25)

        route = await get_walking_route(
            origin_lng=origin["lng"],
            origin_lat=origin["lat"],
            dest_lng=dest["lng"],
            dest_lat=dest["lat"],
        )
        if route:
            segments.append(route)
        else:
            # 单段失败不再让整条路线退化为直线，保留其它成功道路段
            failed_segments += 1
            logger.warning("AMap segment %d failed, keeping other road segments", i)
            segments.append([])

    if failed_segments > 0:
        logger.warning("AMap multi-segment finished with %d failed segments", failed_segments)
    # 至少有一段成功才返回，否则返回空让前端按自身策略处理
    if not any(seg for seg in segments):
        return []

    return segments
