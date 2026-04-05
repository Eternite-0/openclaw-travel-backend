"""
路线导航 API
提供步行路径查询，用于前端地图渲染真实路线。
"""

from fastapi import APIRouter
from pydantic import BaseModel

from services.amap_service import get_walking_route_multi

router = APIRouter()


class Waypoint(BaseModel):
    lat: float
    lng: float
    name: str = ""
    location: str = ""
    city: str = ""


class WalkingRouteRequest(BaseModel):
    waypoints: list[Waypoint]


class WalkingRouteResponse(BaseModel):
    segments: list[list[list[float]]]
    ok: bool


@router.post("/route/walking", response_model=WalkingRouteResponse)
async def walking_route(body: WalkingRouteRequest) -> WalkingRouteResponse:
    """
    获取多个路径点之间的步行路线。

    - waypoints: 按顺序排列的坐标点 (GCJ-02)
    - 返回 segments: 每段路径的折线坐标 [[lat, lng], ...]
    """
    if len(body.waypoints) < 2:
        return WalkingRouteResponse(segments=[], ok=False)

    wp_dicts = [
        {
            "lat": w.lat,
            "lng": w.lng,
            "name": w.name,
            "location": w.location,
            "city": w.city,
        }
        for w in body.waypoints
    ]
    segments = await get_walking_route_multi(wp_dicts)

    return WalkingRouteResponse(segments=segments, ok=bool(segments))
