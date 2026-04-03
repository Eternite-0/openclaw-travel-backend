"""Deterministic budget builder — replaces BudgetAgent LLM call."""
from __future__ import annotations

from core.schemas import BudgetBreakdown, TravelIntent

# Budget allocation ratios by travel style
_RATIOS: dict[str, dict[str, float]] = {
    "budget": {
        "flight": 0.30,
        "accommodation": 0.20,
        "food": 0.18,
        "transport": 0.10,
        "attractions": 0.08,
        "shopping": 0.07,
        "emergency": 0.07,
    },
    "standard": {
        "flight": 0.35,
        "accommodation": 0.25,
        "food": 0.15,
        "transport": 0.08,
        "attractions": 0.07,
        "shopping": 0.05,
        "emergency": 0.05,
    },
    "luxury": {
        "flight": 0.30,
        "accommodation": 0.30,
        "food": 0.15,
        "transport": 0.07,
        "attractions": 0.06,
        "shopping": 0.07,
        "emergency": 0.05,
    },
}

_NOTES_BY_STYLE: dict[str, str] = {
    "budget": (
        "经济型预算分配：优先保障交通和餐饮，住宿选择青旅或经济酒店，景点以免费/低价为主。"
        "建议提前预订特价机票，利用公共交通出行，选择当地小吃和街边美食节省餐饮开支。"
        "购物预算较低，建议集中在当地特色纪念品上。"
    ),
    "standard": (
        "标准型预算分配：各项均衡分配，住宿选择中档酒店或精品民宿，兼顾舒适与性价比。"
        "餐饮建议搭配当地特色餐厅和人气美食，交通以地铁/公交为主，偶尔打车。"
        "预留一定购物和应急资金，确保旅途灵活性。"
    ),
    "luxury": (
        "豪华型预算分配：住宿和餐饮占比较高，优先保障旅行体验和舒适度。"
        "建议选择五星级酒店或特色高端民宿，餐饮以米其林/当地顶级餐厅为主。"
        "交通可考虑包车或头等舱，留充足购物预算。"
    ),
}


def build_budget(intent: TravelIntent) -> BudgetBreakdown:
    """Build BudgetBreakdown deterministically without LLM."""
    total = intent.budget_cny
    style = intent.travel_style or "standard"
    ratios = _RATIOS.get(style, _RATIOS["standard"])

    flight = round(total * ratios["flight"], 2)
    accommodation = round(total * ratios["accommodation"], 2)
    food = round(total * ratios["food"], 2)
    transport = round(total * ratios["transport"], 2)
    attractions = round(total * ratios["attractions"], 2)
    shopping = round(total * ratios["shopping"], 2)
    emergency = round(total * ratios["emergency"], 2)

    daily = round((total - flight) / max(intent.duration_days, 1), 2)

    return BudgetBreakdown(
        total_cny=total,
        flight_cny=flight,
        accommodation_cny=accommodation,
        food_cny=food,
        transport_cny=transport,
        attractions_cny=attractions,
        shopping_cny=shopping,
        emergency_cny=emergency,
        daily_budget_cny=daily,
        notes=_NOTES_BY_STYLE.get(style, _NOTES_BY_STYLE["standard"]),
    )
