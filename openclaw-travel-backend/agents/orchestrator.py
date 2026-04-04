from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session

from agents.attraction_agent import AttractionAgent
from agents.flight_agent import FlightAgent
from agents.hotel_agent import HotelAgent
from agents.intent_parser import IntentParserAgent
from agents.itinerary_agent import ItineraryAgent
from agents.visa_agent import VisaAgent
from agents.weather_agent import WeatherAgent
from config import get_settings
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
    VisaResult,
    WeatherResult,
)
from core.status_store import StatusStore
from database import ItineraryRecord, get_session_last_result
from services import crawleo_service, currency_service, serpapi_service, tavily_service, weather_service
from services import search_cache
from services.budget_builder import build_budget
from services.currency_builder import build_currency_info

logger = logging.getLogger(__name__)

ALL_AGENT_NAMES = [
    "intent_parser",
    "currency_agent",
    "budget_agent",
    "visa_agent",
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
    user_attachments: Optional[list[dict[str, Any]]] = None,
) -> FinalItinerary:
    """
    Chief Orchestrator — smart follow-up aware execution plan.

    Phase 0 (prep):       Load previous itinerary for session (if any)
    Phase 1 (sequential): Intent parsing (receives previous context + change_hints)
    Phase 2 (parallel):   Conditional specialist agents (skips unchanged aspects)
    Phase 3 (sequential): Itinerary assembly (receives previous itinerary for refinement)
    Phase 4:              Persist to SQLite + update memory
    """

    await memory.add_message("user", user_message, attachments=user_attachments)

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
    logger.info("[task:%s] user_message=%s", task_id, user_message[:200])
    history_messages = await memory.get_short_term()
    history_str = memory.build_context_string(history_messages[:-1])
    logger.info("[task:%s] history_str=%s", task_id, history_str[:300] if history_str else "(empty)")

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
    settings = get_settings()

    to_currency = _currency_for_country(intent.dest_country_code)
    coords = weather_service.get_city_coordinates(intent.dest_city)
    dep_date_str = intent.departure_date.isoformat()
    ret_date_str = intent.return_date.isoformat()

    need_flight  = "flight_agent"   not in skip_set
    need_hotel   = "hotel_agent"    not in skip_set
    need_weather = "weather_agent"  not in skip_set
    # Currency: use intent flag (IntentParser decides based on origin/dest)
    need_currency = intent.need_currency and "currency_agent" not in skip_set
    # Visa: use intent flag (IntentParser decides based on border crossing)
    need_visa = intent.need_visa

    # Surface parallel scheduling intent to UI early
    active_agents = ["budget_agent", "flight_agent", "hotel_agent", "attraction_agent", "weather_agent"]
    if need_currency:
        active_agents.append("currency_agent")
    if need_visa:
        active_agents.append("visa_agent")
    for agent_name in active_agents:
        if agent_name not in skip_set:
            await status_store.update_agent(
                task_id,
                agent_name,
                "running",
                message="等待外部数据与任务调度...",
            )
    # Remove unneeded agents from status (so frontend won't show them at all)
    if not need_currency:
        await status_store.remove_agent(task_id, "currency_agent")
    if not need_visa:
        await status_store.remove_agent(task_id, "visa_agent")

    # ── 2a: Deterministic currency + budget (instant, no LLM) ─────────
    rate = 1.0
    currency = None
    if need_currency:
        rate = await currency_service.get_rate("CNY", to_currency)
        currency = build_currency_info(intent, rate, to_currency)
        await status_store.update_agent(task_id, "currency_agent", "done",
                                        message="完成",
                                        result_summary=f"1 CNY ≈ {rate:.4f} {to_currency}")

    budget = build_budget(intent)
    await status_store.update_agent(task_id, "budget_agent", "done",
                                    message="完成",
                                    result_summary=f"总预算 ¥{budget.total_cny:.0f}，日均 ¥{budget.daily_budget_cny:.0f}")

    flight_budget = budget.flight_cny
    hotel_budget = budget.accommodation_cny

    # ── 2b: Smart external data pre-fetch (search fallback strategy) ──
    search_strategy = settings.search_strategy

    async def _fetch_flight_data() -> tuple[str, str, str]:
        """Fetch flight data with fallback: SerpAPI → Tavily → Crawleo."""
        cache_kw = dict(origin=intent.origin_city, dest=intent.dest_city,
                        dep=dep_date_str, ret=ret_date_str)
        cached_result = await search_cache.get("flights", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Flight search cache HIT", task_id)
            return cached_result.get("serpapi", ""), cached_result.get("tavily", ""), cached_result.get("crawleo", "")

        serpapi_summary, tavily_str, crawleo_str = "", "", ""

        if search_strategy == "all":
            # Legacy mode: call all three sources in parallel
            raw, tav, craw = await asyncio.gather(
                serpapi_service.search_flights(
                    origin_city=intent.origin_city, dest_city=intent.dest_city,
                    outbound_date=intent.departure_date, return_date=intent.return_date,
                    travelers=intent.travelers),
                tavily_service.search_flights(
                    origin_city=intent.origin_city, dest_city=intent.dest_city,
                    departure_date=dep_date_str, return_date=ret_date_str),
                crawleo_service.search_flights(
                    origin_city=intent.origin_city, dest_city=intent.dest_city,
                    departure_date=dep_date_str, return_date=ret_date_str),
            )
            serpapi_summary = serpapi_service.extract_flight_summary(raw)
            tavily_str, crawleo_str = tav, craw
        else:
            # Smart fallback: try primary source, fallback on failure
            primary_is_serpapi = search_strategy == "serpapi_first"
            if primary_is_serpapi and settings.serpapi_enabled and settings.serpapi_key:
                raw = await serpapi_service.search_flights(
                    origin_city=intent.origin_city, dest_city=intent.dest_city,
                    outbound_date=intent.departure_date, return_date=intent.return_date,
                    travelers=intent.travelers)
                serpapi_summary = serpapi_service.extract_flight_summary(raw)
                if not raw:
                    logger.info("[task:%s] SerpAPI flights empty, falling back to Tavily", task_id)
                    tavily_str = await tavily_service.search_flights(
                        origin_city=intent.origin_city, dest_city=intent.dest_city,
                        departure_date=dep_date_str, return_date=ret_date_str)
            else:
                tavily_str = await tavily_service.search_flights(
                    origin_city=intent.origin_city, dest_city=intent.dest_city,
                    departure_date=dep_date_str, return_date=ret_date_str)
                if not tavily_str or "未获取" in tavily_str:
                    crawleo_str = await crawleo_service.search_flights(
                        origin_city=intent.origin_city, dest_city=intent.dest_city,
                        departure_date=dep_date_str, return_date=ret_date_str)

        await search_cache.put("flights", {"serpapi": serpapi_summary, "tavily": tavily_str, "crawleo": crawleo_str}, **cache_kw)
        return serpapi_summary, tavily_str, crawleo_str

    async def _fetch_hotel_data() -> tuple[str, str, str]:
        """Fetch hotel data with fallback: SerpAPI → Tavily → Crawleo."""
        cache_kw = dict(city=intent.dest_city, checkin=dep_date_str, checkout=ret_date_str)
        cached_result = await search_cache.get("hotels", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Hotel search cache HIT", task_id)
            return cached_result.get("serpapi", ""), cached_result.get("tavily", ""), cached_result.get("crawleo", "")

        serpapi_summary, tavily_str, crawleo_str = "", "", ""

        if search_strategy == "all":
            raw, tav, craw = await asyncio.gather(
                serpapi_service.search_hotels(
                    city=intent.dest_city, check_in=intent.departure_date,
                    check_out=intent.return_date, adults=intent.travelers),
                tavily_service.search_hotels(
                    city=intent.dest_city, budget_cny=intent.budget_cny,
                    duration_days=intent.duration_days),
                crawleo_service.search_hotels(
                    city=intent.dest_city, check_in=dep_date_str, check_out=ret_date_str),
            )
            serpapi_summary = serpapi_service.extract_hotel_summary(raw)
            tavily_str, crawleo_str = tav, craw
        else:
            primary_is_serpapi = search_strategy == "serpapi_first"
            if primary_is_serpapi and settings.serpapi_enabled and settings.serpapi_key:
                raw = await serpapi_service.search_hotels(
                    city=intent.dest_city, check_in=intent.departure_date,
                    check_out=intent.return_date, adults=intent.travelers)
                serpapi_summary = serpapi_service.extract_hotel_summary(raw)
                if not raw:
                    logger.info("[task:%s] SerpAPI hotels empty, falling back to Tavily", task_id)
                    tavily_str = await tavily_service.search_hotels(
                        city=intent.dest_city, budget_cny=intent.budget_cny,
                        duration_days=intent.duration_days)
            else:
                tavily_str = await tavily_service.search_hotels(
                    city=intent.dest_city, budget_cny=intent.budget_cny,
                    duration_days=intent.duration_days)
                if not tavily_str or "未获取" in tavily_str:
                    crawleo_str = await crawleo_service.search_hotels(
                        city=intent.dest_city, check_in=dep_date_str, check_out=ret_date_str)

        await search_cache.put("hotels", {"serpapi": serpapi_summary, "tavily": tavily_str, "crawleo": crawleo_str}, **cache_kw)
        return serpapi_summary, tavily_str, crawleo_str

    async def _noop_tuple():  return ("", "", "")
    async def _noop_list():   return []
    async def _noop_str():    return ""

    need_attraction = "attraction_agent" not in skip_set

    async def _fetch_attraction_data() -> str:
        """Fetch real-time attraction data via Tavily with city-based cache (1h TTL)."""
        cache_kw = dict(city=intent.dest_city, country=intent.dest_country)
        cached_result = await search_cache.get("attractions", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Attraction search cache HIT", task_id)
            return cached_result.get("tavily", "")
        tavily_str = await tavily_service.search_attractions(
            city=intent.dest_city, country=intent.dest_country,
        )
        await search_cache.put("attractions", {"tavily": tavily_str}, **cache_kw)
        return tavily_str

    async def _fetch_restaurant_data() -> str:
        """Fetch real-time restaurant data via Tavily with city-based cache."""
        cache_kw = dict(city=intent.dest_city, style=intent.travel_style)
        cached_result = await search_cache.get("restaurants", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Restaurant search cache HIT", task_id)
            return cached_result.get("tavily", "")
        tavily_str = await tavily_service.search_restaurants(
            city=intent.dest_city, budget_level=intent.travel_style,
        )
        await search_cache.put("restaurants", {"tavily": tavily_str}, **cache_kw)
        return tavily_str

    async def _fetch_visa_data() -> str:
        """Fetch real-time visa/entry policy data via Tavily."""
        cache_kw = dict(origin=intent.origin_country, dest=intent.dest_country)
        cached_result = await search_cache.get("visa", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Visa search cache HIT", task_id)
            return cached_result.get("tavily", "")
        tavily_str = await tavily_service.search_visa(
            origin_country=intent.origin_country,
            dest_country=intent.dest_country,
            dest_city=intent.dest_city,
        )
        await search_cache.put("visa", {"tavily": tavily_str}, **cache_kw)
        return tavily_str

    # Pre-fetch external data in parallel (weather + flights + hotels + attractions + restaurants + visa)
    (
        forecast_raw,
        flight_data,
        hotel_data,
        tavily_attractions_str,
        tavily_restaurants_str,
        tavily_visa_str,
    ) = await asyncio.gather(
        weather_service.get_forecast(
            lat=coords["lat"], lon=coords["lon"],
            days=intent.duration_days, start_date=intent.departure_date,
        ) if need_weather else _noop_list(),
        _fetch_flight_data() if need_flight else _noop_tuple(),
        _fetch_hotel_data() if need_hotel else _noop_tuple(),
        _fetch_attraction_data() if need_attraction else _noop_str(),
        _fetch_restaurant_data(),
        _fetch_visa_data() if need_visa else _noop_str(),
    )
    serpapi_flight_summary, tavily_flights_str, crawleo_flights_str = flight_data
    serpapi_hotel_summary, tavily_hotels_str, crawleo_hotels_str = hotel_data

    # Fill empty search fields with descriptive notes so LLM prompts don't have blank sections
    _FLIGHT_NO_DATA = "（该数据源未启用或无结果，请基于已有数据源和市场常见航班信息生成完整推荐）"
    _HOTEL_NO_DATA = "（该数据源未启用或无结果，请基于已有数据源和目的地知名酒店信息生成完整推荐）"
    if not serpapi_flight_summary or serpapi_flight_summary == "（未获取到实时航班数据）":
        serpapi_flight_summary = f"【SerpAPI 航班数据】\n{_FLIGHT_NO_DATA}"
    if not tavily_flights_str:
        tavily_flights_str = f"【Tavily 航班搜索】\n{_FLIGHT_NO_DATA}"
    if not crawleo_flights_str:
        crawleo_flights_str = f"【Crawleo 航班搜索】\n{_FLIGHT_NO_DATA}"
    if not serpapi_hotel_summary or serpapi_hotel_summary == "（未获取到实时酒店数据）":
        serpapi_hotel_summary = f"【SerpAPI 酒店数据】\n{_HOTEL_NO_DATA}"
    if not tavily_hotels_str:
        tavily_hotels_str = f"【Tavily 酒店搜索】\n{_HOTEL_NO_DATA}"
    if not crawleo_hotels_str:
        crawleo_hotels_str = f"【Crawleo 酒店搜索】\n{_HOTEL_NO_DATA}"

    # ── 2c: Parallel LLM agent execution ─────────────────────────────
    cached_prev = _extract_cached_results(prev_itinerary) if prev_itinerary else {}
    sem = asyncio.Semaphore(settings.agent_concurrency)

    async def _run_with_sem(coro):
        async with sem:
            return await coro

    async def _run_or_cache(agent_name: str, coro, cached_value):
        if agent_name in skip_set and cached_value is not None:
            return cached_value
        return await _run_with_sem(coro)

    flight_agent    = FlightAgent(task_id, intent, status_store, llm_config)
    hotel_agent     = HotelAgent(task_id, intent, status_store, llm_config)
    attraction_agent = AttractionAgent(task_id, intent, status_store, llm_config)
    weather_agent   = WeatherAgent(task_id, intent, status_store, llm_config)

    # Build parallel tasks list (4 core + optional visa)
    agent_tasks = [
        _run_or_cache(
            "flight_agent",
            flight_agent.run(extra_context={
                "flight_budget_cny": flight_budget,
                "serpapi_data": serpapi_flight_summary,
                "tavily_data": tavily_flights_str,
                "crawleo_data": crawleo_flights_str,
            }),
            cached_prev.get("flights"),
        ),
        _run_or_cache(
            "hotel_agent",
            hotel_agent.run(extra_context={
                "hotel_budget_cny": hotel_budget,
                "serpapi_data": serpapi_hotel_summary,
                "tavily_data": tavily_hotels_str,
                "crawleo_data": crawleo_hotels_str,
            }),
            cached_prev.get("hotels"),
        ),
        _run_or_cache(
            "attraction_agent",
            attraction_agent.run(extra_context={
                "tavily_data": tavily_attractions_str,
            }),
            cached_prev.get("attractions"),
        ),
        _run_or_cache(
            "weather_agent",
            weather_agent.run(extra_context={"weather_data": forecast_raw}),
            cached_prev.get("weather"),
        ),
    ]

    # Conditionally add VisaAgent
    visa_result: Optional[VisaResult] = None
    if need_visa:
        visa_agent = VisaAgent(task_id, intent, status_store, llm_config)
        agent_tasks.append(
            _run_with_sem(visa_agent.run(extra_context={
                "tavily_data": tavily_visa_str,
            }))
        )

    results = await asyncio.gather(*agent_tasks)

    flights    = results[0]  # type: FlightResult
    hotels     = results[1]  # type: HotelResult
    attractions = results[2]  # type: AttractionResult
    weather    = results[3]  # type: WeatherResult
    if need_visa and len(results) > 4:
        visa_result = results[4]  # type: ignore[assignment]

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
        "restaurants": tavily_restaurants_str,
        "previous_itinerary": previous_itinerary_json,
    })  # type: ignore[assignment]

    # Attach optional results
    if visa_result is not None:
        itinerary.visa_info = visa_result
    if currency is not None:
        itinerary.currency = currency

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
