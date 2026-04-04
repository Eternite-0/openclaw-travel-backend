"""
高德地图步行导航服务
调用高德 Web API 获取两点之间的步行路径折线，用于前端地图渲染真实路线。

API 文档: https://lbs.amap.com/api/webservice/guide/api/newroute#t6
"""

import logging
from typing import Optional
import httpx

from config import get_settings

logger = logging.getLogger(__name__)

AMAP_WALKING_URL = "https://restapi.amap.com/v5/direction/walking"


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

    params = {
        "key": settings.amap_api_key,
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
        "isindoor": "0",
        "show_fields": "polyline",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(AMAP_WALKING_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        if data.get("status") != "1" or data.get("infocode") != "10000":
            logger.warning(
                "AMap walking API error: status=%s info=%s infocode=%s",
                data.get("status"), data.get("info"), data.get("infocode"),
            )
            return None

        route = data.get("route", {})
        paths = route.get("paths", [])
        if not paths:
            logger.warning("AMap walking API returned no paths")
            return None

        polyline_points: list[list[float]] = []
        for step in paths[0].get("steps", []):
            polyline_str = step.get("polyline", "")
            if not polyline_str:
                continue
            for pair in polyline_str.split(";"):
                parts = pair.split(",")
                if len(parts) == 2:
                    lng, lat = float(parts[0]), float(parts[1])
                    polyline_points.append([lat, lng])

        if not polyline_points:
            logger.warning("AMap walking API returned empty polyline")
            return None

        logger.info(
            "AMap walking route: %s points, %.6f,%.6f → %.6f,%.6f",
            len(polyline_points), origin_lat, origin_lng, dest_lat, dest_lng,
        )
        return polyline_points

    except httpx.HTTPError as exc:
        logger.warning("AMap walking API HTTP error: %s: %s", type(exc).__name__, exc)
        return None
    except Exception as exc:
        logger.warning("AMap walking API error: %s: %s", type(exc).__name__, exc)
        return None


async def get_walking_route_multi(
    waypoints: list[dict],
) -> list[list[list[float]]]:
    """
    获取多个连续路径点之间的步行路径。

    Args:
        waypoints: [{"lat": float, "lng": float}, ...] 按顺序排列的路径点

    Returns:
        每段路径的折线点列表: [segment1_points, segment2_points, ...]
        任何一段失败则返回空列表（前端整体回退直线，避免混合渲染）
    """
    import asyncio

    if len(waypoints) < 2:
        return []

    segments: list[list[list[float]]] = []
    for i in range(len(waypoints) - 1):
        origin = waypoints[i]
        dest = waypoints[i + 1]

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
            logger.warning(
                "AMap segment %d failed, falling back to straight lines for all segments", i,
            )
            return []

    return segments
