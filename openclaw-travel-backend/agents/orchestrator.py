from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlmodel import Session

from agents.attraction_agent import AttractionAgent
from agents.budget_agent import BudgetAgent
from agents.currency_agent import CurrencyAgent
from agents.flight_agent import FlightAgent
from agents.hotel_agent import HotelAgent
from agents.intent_parser import IntentParserAgent
from agents.itinerary_agent import ItineraryAgent
from agents.weather_agent import WeatherAgent
from core.memory import MemoryManager
from core.schemas import (
    AttractionResult,
    BudgetBreakdown,
    CurrencyInfo,
    FinalItinerary,
    FlightOption,
    FlightResult,
    HotelOption,
    HotelResult,
    TravelIntent,
    WeatherResult,
)
from core.status_store import StatusStore
from database import ItineraryRecord, get_session_last_result
from services import crawleo_service, currency_service, serpapi_service, tavily_service, weather_service

logger = logging.getLogger(__name__)

ALL_AGENT_NAMES = [
    "intent_parser",
    "currency_agent",
    "budget_agent",
    "flight_agent",
    "hotel_agent",
    "attraction_agent",
    "weather_agent",
    "itinerary_agent",
]


async def run_travel_pipeline(
    user_message: str,
    session_id: str,
    task_id: str,
    memory: MemoryManager,
    status_store: StatusStore,
    llm_config: dict,
    db_session: Session,
    original_task_id: Optional[str] = None,
) -> FinalItinerary:
    """
    Chief Orchestrator — smart follow-up aware execution plan.

    Phase 0 (prep):       Load previous itinerary for session (if any)
    Phase 1 (sequential): Intent parsing (receives previous context + change_hints)
    Phase 2 (parallel):   Conditional specialist agents (skips unchanged aspects)
    Phase 3 (sequential): Itinerary assembly (receives previous itinerary for refinement)
    Phase 4:              Persist to SQLite + update memory
    """

    await memory.add_message("user", user_message)

    # ── Phase 0: Load previous itinerary for this session ────────────────
    prev_itinerary: Optional[FinalItinerary] = None
    previous_summary = ""
    previous_itinerary_json = ""

    prev_record = None
    if original_task_id:
        from sqlmodel import select as _sel
        prev_record = db_session.exec(
            _sel(ItineraryRecord).where(ItineraryRecord.task_id == original_task_id)
        ).first()
        if prev_record:
            logger.info("[task:%s] Found previous itinerary via original_task_id=%s", task_id, original_task_id)
    if not prev_record:
        prev_record = get_session_last_result(session_id)
    if prev_record:
        try:
            prev_itinerary = FinalItinerary.model_validate_json(prev_record.itinerary_json)
            previous_summary = _build_previous_summary(prev_itinerary)
            previous_itinerary_json = prev_record.itinerary_json[:4000]
            logger.info("[task:%s] Found previous itinerary for session %s", task_id, session_id)
        except Exception as exc:
            logger.warning("[task:%s] Failed to load previous itinerary: %s", task_id, exc)
            prev_itinerary = None

    # ── Phase 1: Intent Parsing ──────────────────────────────────────
    logger.info("[task:%s] Phase 1 — Intent parsing", task_id)
    history_messages = await memory.get_short_term()
    history_str = memory.build_context_string(history_messages[:-1])

    dummy_intent = TravelIntent(
        origin_city="广州",
        origin_country="中国",
        dest_city="纽约",
        dest_country="美国",
        dest_country_code="US",
        departure_date=datetime.utcnow().date().replace(day=1),
        return_date=datetime.utcnow().date().replace(day=1),
        duration_days=7,
        budget_cny=20000.0,
    )

    intent_agent = IntentParserAgent(
        task_id=task_id,
        intent=dummy_intent,
        status_store=status_store,
        llm_config=llm_config,
        user_message=user_message,
        history=history_str,
        previous_summary=previous_summary,
    )
    intent: TravelIntent = await intent_agent.run(extra_context={
        "user_message": user_message,
        "history": history_str,
        "previous_summary": previous_summary,
    })  # type: ignore[assignment]
    logger.info(
        "[task:%s] Intent: %s→%s %dd change_hints=%s",
        task_id, intent.origin_city, intent.dest_city, intent.duration_days, intent.change_hints,
    )

    # ── Determine skip set from change_hints ─────────────────────────
    skip_set = _get_skip_set(intent.change_hints, prev_itinerary)
    if skip_set:
        logger.info("[task:%s] Follow-up mode — skipping: %s", task_id, skip_set)
        for agent_name in skip_set:
            await status_store.update_agent(task_id, agent_name, "done", message="复用上次结果")

    # ── Phase 2: Conditional External Pre-fetch + Parallel Agents ────────
    logger.info("[task:%s] Phase 2 — Pre-fetching external data", task_id)

    to_currency = _currency_for_country(intent.dest_country_code)
    coords = weather_service.get_city_coordinates(intent.dest_city)
    dep_date_str = intent.departure_date.isoformat()
    ret_date_str = intent.return_date.isoformat()
    flight_budget = intent.budget_cny * 0.35
    hotel_budget = intent.budget_cny * 0.25

    need_flight  = "flight_agent"   not in skip_set
    need_hotel   = "hotel_agent"    not in skip_set
    need_weather = "weather_agent"  not in skip_set
    need_currency = "currency_agent" not in skip_set

    # Surface parallel scheduling intent to UI early, so frontend can show
    # multiple agents as running during pre-fetch and avoid "sudden done only".
    for agent_name in ("currency_agent", "budget_agent", "flight_agent", "hotel_agent", "attraction_agent", "weather_agent"):
        if agent_name not in skip_set:
            await status_store.update_agent(
                task_id,
                agent_name,
                "running",
                message="等待外部数据与任务调度...",
            )

    async def _noop_dict():  return {}
    async def _noop_str():   return ""
    async def _noop_float(): return 1.0

    (
        rate,
        forecast_raw,
        serpapi_flights_raw,
        serpapi_hotels_raw,
        tavily_flights_str,
        tavily_hotels_str,
        crawleo_flights_str,
        crawleo_hotels_str,
    ) = await asyncio.gather(
        currency_service.get_rate("CNY", to_currency) if need_currency else _noop_float(),
        weather_service.get_forecast(
            lat=coords["lat"], lon=coords["lon"],
            days=intent.duration_days, start_date=intent.departure_date,
        ) if need_weather else _noop_dict(),
        serpapi_service.search_flights(
            origin_city=intent.origin_city, dest_city=intent.dest_city,
            outbound_date=intent.departure_date, return_date=intent.return_date,
            travelers=intent.travelers,
        ) if need_flight else _noop_dict(),
        serpapi_service.search_hotels(
            city=intent.dest_city, check_in=intent.departure_date,
            check_out=intent.return_date, adults=intent.travelers,
        ) if need_hotel else _noop_dict(),
        tavily_service.search_flights(
            origin_city=intent.origin_city, dest_city=intent.dest_city,
            departure_date=dep_date_str, return_date=ret_date_str,
        ) if need_flight else _noop_str(),
        tavily_service.search_hotels(
            city=intent.dest_city, budget_cny=intent.budget_cny,
            duration_days=intent.duration_days,
        ) if need_hotel else _noop_str(),
        crawleo_service.search_flights(
            origin_city=intent.origin_city, dest_city=intent.dest_city,
            departure_date=dep_date_str, return_date=ret_date_str,
        ) if need_flight else _noop_str(),
        crawleo_service.search_hotels(
            city=intent.dest_city, check_in=dep_date_str, check_out=ret_date_str,
        ) if need_hotel else _noop_str(),
    )

    budget_in_dest = intent.budget_cny * (rate if isinstance(rate, float) else 1.0)
    serpapi_flight_summary = serpapi_service.extract_flight_summary(serpapi_flights_raw)
    serpapi_hotel_summary  = serpapi_service.extract_hotel_summary(serpapi_hotels_raw)

    cached = _extract_cached_results(prev_itinerary) if prev_itinerary else {}

    async def _run_or_cache(agent_name: str, coro, cached_value):
        if agent_name in skip_set and cached_value is not None:
            return cached_value
        return await coro

    currency_agent  = CurrencyAgent(task_id, intent, status_store, llm_config)
    budget_agent    = BudgetAgent(task_id, intent, status_store, llm_config)
    flight_agent    = FlightAgent(task_id, intent, status_store, llm_config)
    hotel_agent     = HotelAgent(task_id, intent, status_store, llm_config)
    attraction_agent = AttractionAgent(task_id, intent, status_store, llm_config)
    weather_agent   = WeatherAgent(task_id, intent, status_store, llm_config)

    # Run LLM-heavy specialists in low-concurrency mode to avoid provider
    # concurrency-limit 429 errors. Currency is prioritized first.
    currency = await _run_or_cache(
        "currency_agent",
        currency_agent.run(extra_context={
            "to_currency": to_currency,
            "rate": rate,
            "budget_in_dest": budget_in_dest,
        }),
        cached.get("currency"),
    )
    budget = await _run_or_cache(
        "budget_agent",
        budget_agent.run(),
        cached.get("budget"),
    )
    flights = await _run_or_cache(
        "flight_agent",
        flight_agent.run(extra_context={
            "flight_budget_cny": flight_budget,
            "serpapi_data": serpapi_flight_summary,
            "tavily_data": tavily_flights_str,
            "crawleo_data": crawleo_flights_str,
        }),
        cached.get("flights"),
    )
    hotels = await _run_or_cache(
        "hotel_agent",
        hotel_agent.run(extra_context={
            "hotel_budget_cny": hotel_budget,
            "serpapi_data": serpapi_hotel_summary,
            "tavily_data": tavily_hotels_str,
            "crawleo_data": crawleo_hotels_str,
        }),
        cached.get("hotels"),
    )
    attractions = await _run_or_cache(
        "attraction_agent",
        attraction_agent.run(),
        cached.get("attractions"),
    )
    weather = await _run_or_cache(
        "weather_agent",
        weather_agent.run(extra_context={"weather_data": forecast_raw}),
        cached.get("weather"),
    )

    currency:   CurrencyInfo    # type: ignore[assignment]
    budget:     BudgetBreakdown  # type: ignore[assignment]
    flights:    FlightResult    # type: ignore[assignment]
    hotels:     HotelResult     # type: ignore[assignment]
    attractions: AttractionResult  # type: ignore[assignment]
    weather:    WeatherResult   # type: ignore[assignment]

    logger.info("[task:%s] Phase 2 complete", task_id)

    # ── Phase 3: Itinerary Assembly ──────────────────────────────────────
    logger.info("[task:%s] Phase 3 — Itinerary assembly", task_id)
    itinerary_agent = ItineraryAgent(
        task_id=task_id,
        intent=intent,
        status_store=status_store,
        llm_config=llm_config,
        session_id=session_id,
        previous_itinerary=previous_itinerary_json,
    )
    itinerary: FinalItinerary = await itinerary_agent.run(extra_context={
        "intent": intent,
        "currency": currency,
        "budget": budget,
        "flights": flights,
        "hotels": hotels,
        "attractions": attractions,
        "weather": weather,
        "previous_itinerary": previous_itinerary_json,
    })  # type: ignore[assignment]
    logger.info("[task:%s] Itinerary assembled", task_id)

    # ── Phase 4: Persist + Update Memory ────────────────────────────────
    record = ItineraryRecord(
        task_id=task_id,
        session_id=session_id,
        created_at=datetime.utcnow(),
        itinerary_json=itinerary.model_dump_json(),
        origin_city=intent.origin_city,
        dest_city=intent.dest_city,
        duration_days=intent.duration_days,
        budget_cny=intent.budget_cny,
        status="done",
    )
    db_session.add(record)
    db_session.commit()
    logger.info("[task:%s] Saved to database", task_id)

    summary = "、".join(itinerary.highlights[:3]) if itinerary.highlights else "行程规划完成"
    await memory.add_message("assistant", f"行程规划完成！亮点：{summary}")
    await status_store.set_overall_status(task_id, "done")
    return itinerary


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _build_previous_summary(itinerary: FinalItinerary) -> str:
    """Compact human-readable summary of a previous itinerary for prompt injection."""
    i = itinerary.intent
    highlights = "、".join(itinerary.highlights[:3]) if itinerary.highlights else "无"
    flight_info = f"{itinerary.recommended_flight.airline} {itinerary.recommended_flight.flight_number}, ¥{itinerary.recommended_flight.price_cny:.0f}"
    hotel_info = f"{itinerary.recommended_hotel.name}, ¥{itinerary.recommended_hotel.price_per_night_cny:.0f}/晚"
    return (
        f"目的地: {i.dest_city}({i.dest_country}) | 出发日: {i.departure_date} | 天数: {i.duration_days}天 "
        f"| 预算: ¥{i.budget_cny:.0f} | 风格: {i.travel_style}\n"
        f"推荐航班: {flight_info}\n"
        f"推荐酒店: {hotel_info}\n"
        f"亮点: {highlights}"
    )


def _get_skip_set(change_hints: list[str], prev: Optional[FinalItinerary]) -> set[str]:
    """
    Return the set of agent names that can be skipped by reusing cached results.
    Only applies when there is a previous itinerary AND change_hints is specific.
    """
    if not prev or not change_hints:
        return set()

    hints = set(change_hints)

    # Single-aspect changes — skip all other specialist agents
    if hints == {"hotel"}:
        return {"currency_agent", "budget_agent", "flight_agent", "weather_agent"}
    if hints == {"flight"}:
        return {"currency_agent", "budget_agent", "hotel_agent", "weather_agent"}
    if hints == {"budget"}:
        return {"currency_agent", "flight_agent", "hotel_agent", "attraction_agent", "weather_agent"}
    if hints == {"itinerary"}:
        # Only re-run ItineraryAgent; all specialists reuse cached data
        return {"currency_agent", "budget_agent", "flight_agent", "hotel_agent", "attraction_agent", "weather_agent"}

    # dates / destination / full / multiple hints — re-run everything
    return set()


def _extract_cached_results(prev: FinalItinerary) -> dict:
    """Reconstruct minimal agent result objects from a previous FinalItinerary."""
    cached: dict = {}
    cached["currency"] = prev.currency
    cached["budget"] = prev.budget
    cached["weather"] = prev.weather
    cached["flights"] = FlightResult(
        outbound=[prev.recommended_flight],
        return_flights=[],
        recommended_index=0,
    )
    cached["hotels"] = HotelResult(
        options=[prev.recommended_hotel],
        recommended_index=0,
    )
    # AttractionResult is not stored in FinalItinerary — always re-run when needed
    cached["attractions"] = None
    return cached


def _currency_for_country(country_code: str) -> str:
    """Map ISO country code to primary currency code."""
    mapping: dict[str, str] = {
        "US": "USD", "GB": "GBP", "JP": "JPY", "EU": "EUR",
        "DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR",
        "AU": "AUD", "CA": "CAD", "KR": "KRW", "SG": "SGD",
        "TH": "THB", "MY": "MYR", "ID": "IDR", "VN": "VND",
        "IN": "INR", "AE": "AED", "CH": "CHF", "HK": "HKD",
        "NZ": "NZD", "MX": "MXN", "BR": "BRL", "ZA": "ZAR",
        "RU": "RUB", "TR": "TRY", "EG": "EGP", "NG": "NGN",
        "CN": "CNY",
    }
    return mapping.get(country_code.upper(), "USD")
