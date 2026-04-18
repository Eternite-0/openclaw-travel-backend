from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, time
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
from services import baidu_search_service, crawleo_service, currency_service, serpapi_service, tavily_service, weather_service
from services import search_cache
from services.amap_service import geocode_itinerary_activities
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
    user_id: str = "anonymous",
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

    # AI辅助生成：OpenClaw API，2026-04-01，用途：多Agent协同执行主流程设计与任务编排落地参考
    await memory.add_message("user", user_message, attachments=user_attachments)

    # ── Phase 0: Load previous itinerary for this session ────────────────
    prev_itinerary: Optional[FinalItinerary] = None
    previous_summary = ""
    previous_itinerary_json = ""
    previous_intent_json = ""

    prev_record = None
    if original_task_id:
        from sqlmodel import select as _sel
        prev_record = db_session.exec(
            _sel(ItineraryRecord).where(ItineraryRecord.task_id == original_task_id)
        ).first()
        if prev_record:
            logger.info("[task:%s] Found previous itinerary via original_task_id=%s", task_id, original_task_id)
    # Important: only follow-up requests are allowed to reuse previous itinerary context.
    # New planning requests (without original_task_id) must start fresh.
    if original_task_id and not prev_record:
        prev_record = get_session_last_result(session_id)
    if prev_record:
        try:
            prev_itinerary = FinalItinerary.model_validate_json(prev_record.itinerary_json)
            previous_summary = _build_previous_summary(prev_itinerary)
            previous_itinerary_json = prev_record.itinerary_json[:4000]
            previous_intent_json = prev_itinerary.intent.model_dump_json(indent=2)
            logger.info("[task:%s] Found previous itinerary for session %s", task_id, session_id)
        except Exception as exc:
            logger.warning("[task:%s] Failed to load previous itinerary: %s", task_id, exc)
            prev_itinerary = None

    # ── Memory 历史压缩（防止长对话爆上下文）────────────────────────────
    # Inspired by claude-code's autoCompact: dual trigger (token + msg count),
    # structured summary prompt, PTL retry with head truncation, circuit breaker.
    _compact_result = await memory.compress_if_needed(
        llm_config=llm_config,
        max_history_chars=12_000,
        keep_recent=5,
    )
    if _compact_result["compressed"]:
        logger.info(
            "[task:%s] Memory auto-compressed, summary ~%d tokens",
            task_id, _compact_result["summary_tokens"],
        )

    # ── Phase 1: Intent Parsing ──────────────────────────────────────
    logger.info("[task:%s] Phase 1 — Intent parsing", task_id)
    logger.info("[task:%s] user_message=%s", task_id, user_message[:200])
    # AI辅助生成：OpenClaw API，2026-04-01，用途：多阶段调度中的意图解析入口与状态推进链路设计
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
        previous_intent_json=previous_intent_json,
    )
    try:
        intent: TravelIntent = await intent_agent.run(extra_context={
            "user_message": user_message,
            "history": history_str,
            "previous_summary": previous_summary,
            "previous_intent_json": previous_intent_json,
        })  # type: ignore[assignment]
    except ValueError as exc:
        if "need_more_info" in str(exc) and prev_itinerary is not None:
            intent = prev_itinerary.intent.model_copy(deep=True)
            intent.change_hints = ["full"]
            logger.warning(
                "[task:%s] intent_parser returned need_more_info, fallback to previous intent for continuity",
                task_id,
            )
            await status_store.update_agent(
                task_id,
                "intent_parser",
                "done",
                message="信息不足，已基于上次行程继续规划",
                result_summary=f"{intent.origin_city} → {intent.dest_city}，{intent.duration_days}天",
            )
        else:
            raise
    logger.info(
        "[task:%s] Intent: %s→%s %dd change_hints=%s",
        task_id, intent.origin_city, intent.dest_city, intent.duration_days, intent.change_hints,
    )
    multi_city_guidance = _apply_multi_city_hints(intent, user_message)

    # ── Determine skip set from change_hints ─────────────────────────
    skip_set = _get_skip_set(intent.change_hints, prev_itinerary)
    if skip_set:
        logger.info("[task:%s] Follow-up mode — skipping: %s", task_id, skip_set)
        for agent_name in skip_set:
            await status_store.update_agent(task_id, agent_name, "done", message="复用上次结果")

    # ── Phase 2: Conditional External Pre-fetch + Parallel Agents ────────
    logger.info("[task:%s] Phase 2 — Pre-fetching external data", task_id)
    # AI辅助生成：OpenClaw API，2026-04-01，用途：并行Agent调度、外部数据预取与任务状态协同机制设计
    settings = get_settings()

    to_currency = _currency_for_country(intent.dest_country_code)
    coords = await weather_service.resolve_city_coordinates(
        intent.dest_city,
        intent.dest_country_code,
    )
    dep_date_str = intent.departure_date.isoformat()
    ret_date_str = intent.return_date.isoformat()

    is_same_city_trip = _norm_city(intent.origin_city) == _norm_city(intent.dest_city)
    need_flight  = ("flight_agent" not in skip_set) and (not is_same_city_trip)
    need_hotel   = "hotel_agent"    not in skip_set
    need_weather = "weather_agent"  not in skip_set
    # Currency: use intent flag (IntentParser decides based on origin/dest)
    need_currency = intent.need_currency and "currency_agent" not in skip_set
    # Visa: use intent flag (IntentParser decides based on border crossing)
    need_visa = intent.need_visa

    # Surface parallel scheduling intent to UI early
    active_agents = ["budget_agent", "hotel_agent", "attraction_agent", "weather_agent"]
    if need_flight:
        active_agents.append("flight_agent")
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
    if is_same_city_trip:
        await status_store.update_agent(
            task_id,
            "flight_agent",
            "done",
            message="同城出行，已跳过航班查询",
            result_summary="同城路线无需航班",
        )

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
    local_flight_result = _build_local_flight_result(intent) if is_same_city_trip else None

    # ── 2b: Search pre-fetch (Baidu first, fallback to SerpAPI/Tavily/Crawleo) ──
    def _format_crawleo_generic(label: str, data: dict[str, Any], max_results: int = 5) -> str:
        if not data:
            return ""
        results = data.get("results", data.get("data", []))
        if not isinstance(results, list) or not results:
            return ""
        lines = [f"【{label}】"]
        for i, r in enumerate(results[:max_results], 1):
            title = r.get("title", r.get("name", ""))
            url = r.get("url", r.get("link", ""))
            snippet = r.get("snippet", r.get("description", r.get("content", "")))
            if isinstance(snippet, str):
                snippet = snippet[:220]
            lines.append(f"  [{i}] {title}\n      {snippet}\n      来源: {url}")
        return "\n".join(lines)

    async def _fetch_flight_data() -> tuple[str, str, str]:
        """Fetch flight data: Baidu first; fallback SerpAPI -> Tavily -> Crawleo."""
        cache_kw = dict(origin=intent.origin_city, dest=intent.dest_city, dep=dep_date_str, ret=ret_date_str)
        cached_result = await search_cache.get("flights", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Flight search cache HIT", task_id)
            cached_baidu = cached_result.get("baidu", "")
            cached_serpapi = cached_result.get("serpapi", "")
            return (
                cached_serpapi or cached_baidu,
                cached_result.get("tavily", ""),
                cached_result.get("crawleo", ""),
            )

        baidu_str = await baidu_search_service.search_flights(
            origin_city=intent.origin_city,
            dest_city=intent.dest_city,
            departure_date=dep_date_str,
            return_date=ret_date_str,
            task_id=task_id,
        )
        if baidu_str:
            await search_cache.put("flights", {"baidu": baidu_str, "serpapi": baidu_str, "tavily": "", "crawleo": ""}, **cache_kw)
            return baidu_str, "", ""

        serpapi_data = await serpapi_service.search_flights(
            origin_city=intent.origin_city,
            dest_city=intent.dest_city,
            outbound_date=intent.departure_date,
            return_date=intent.return_date,
            travelers=intent.travelers,
            currency="CNY",
        )
        serpapi_summary = serpapi_service.extract_flight_summary(serpapi_data) if serpapi_data else ""
        if serpapi_summary and serpapi_summary != "（未获取到实时航班数据）":
            logger.info("[task:%s] Baidu flights empty, fallback hit SerpAPI", task_id)
            await search_cache.put("flights", {"baidu": "", "serpapi": serpapi_summary, "tavily": "", "crawleo": ""}, **cache_kw)
            return serpapi_summary, "", ""

        tavily_flights = await tavily_service.search_flights(
            origin_city=intent.origin_city,
            dest_city=intent.dest_city,
            departure_date=dep_date_str,
            return_date=ret_date_str,
        )
        if tavily_flights:
            logger.info("[task:%s] Baidu/SerpAPI flights empty, fallback hit Tavily", task_id)
            await search_cache.put("flights", {"baidu": "", "serpapi": "", "tavily": tavily_flights, "crawleo": ""}, **cache_kw)
            return "", tavily_flights, ""

        crawleo_flights = await crawleo_service.search_flights(
            origin_city=intent.origin_city,
            dest_city=intent.dest_city,
            departure_date=dep_date_str,
            return_date=ret_date_str,
        )
        await search_cache.put("flights", {"baidu": "", "serpapi": "", "tavily": "", "crawleo": crawleo_flights}, **cache_kw)
        return "", "", crawleo_flights

    async def _fetch_hotel_data() -> tuple[str, str, str, str]:
        """Fetch hotel data: Baidu first; fallback SerpAPI -> Tavily -> Crawleo."""
        cache_kw = dict(city=intent.dest_city, checkin=dep_date_str, checkout=ret_date_str)
        cached_result = await search_cache.get("hotels", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Hotel search cache HIT", task_id)
            return (
                cached_result.get("baidu", ""),
                cached_result.get("serpapi", ""),
                cached_result.get("tavily", ""),
                cached_result.get("crawleo", ""),
            )

        baidu_str = await baidu_search_service.search_hotels(
            city=intent.dest_city,
            check_in=dep_date_str,
            check_out=ret_date_str,
            task_id=task_id,
        )
        if baidu_str:
            await search_cache.put("hotels", {"baidu": baidu_str, "serpapi": "", "tavily": "", "crawleo": ""}, **cache_kw)
            return baidu_str, "", "", ""

        serpapi_data = await serpapi_service.search_hotels(
            city=intent.dest_city,
            check_in=intent.departure_date,
            check_out=intent.return_date,
            adults=intent.travelers,
            currency="CNY",
        )
        serpapi_summary = serpapi_service.extract_hotel_summary(serpapi_data) if serpapi_data else ""
        if serpapi_summary and serpapi_summary != "（未获取到实时酒店数据）":
            logger.info("[task:%s] Baidu hotels empty, fallback hit SerpAPI", task_id)
            await search_cache.put("hotels", {"baidu": "", "serpapi": serpapi_summary, "tavily": "", "crawleo": ""}, **cache_kw)
            return "", serpapi_summary, "", ""

        tavily_hotels = await tavily_service.search_hotels(
            city=intent.dest_city,
            budget_cny=intent.budget_cny,
            duration_days=intent.duration_days,
        )
        if tavily_hotels:
            logger.info("[task:%s] Baidu/SerpAPI hotels empty, fallback hit Tavily", task_id)
            await search_cache.put("hotels", {"baidu": "", "serpapi": "", "tavily": tavily_hotels, "crawleo": ""}, **cache_kw)
            return "", "", tavily_hotels, ""

        crawleo_hotels = await crawleo_service.search_hotels(
            city=intent.dest_city,
            check_in=dep_date_str,
            check_out=ret_date_str,
        )
        await search_cache.put("hotels", {"baidu": "", "serpapi": "", "tavily": "", "crawleo": crawleo_hotels}, **cache_kw)
        return "", "", "", crawleo_hotels

    async def _noop_tuple():  return ("", "", "")
    async def _noop_list():   return []
    async def _noop_str():    return ""
    async def _noop_hotel_data(): return ("", "", "", "")
    async def _noop_attraction_data(): return ("", "", "")
    async def _noop_flight_result(): return local_flight_result

    need_attraction = "attraction_agent" not in skip_set

    async def _fetch_attraction_data() -> tuple[str, str, str]:
        """Fetch attraction data: Baidu first; fallback Tavily -> Crawleo."""
        cache_kw = dict(city=intent.dest_city, country=intent.dest_country)
        cached_result = await search_cache.get("attractions", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Attraction search cache HIT", task_id)
            return (
                cached_result.get("baidu", ""),
                cached_result.get("tavily", ""),
                cached_result.get("crawleo", ""),
            )

        baidu_str = await baidu_search_service.search_attractions(
            city=intent.dest_city,
            country=intent.dest_country,
            task_id=task_id,
        )
        if baidu_str:
            await search_cache.put("attractions", {"baidu": baidu_str, "tavily": "", "crawleo": ""}, **cache_kw)
            return baidu_str, "", ""

        tavily_attractions = await tavily_service.search_attractions(
            city=intent.dest_city,
            country=intent.dest_country,
        )
        if tavily_attractions:
            logger.info("[task:%s] Baidu attractions empty, fallback hit Tavily", task_id)
            await search_cache.put("attractions", {"baidu": "", "tavily": tavily_attractions, "crawleo": ""}, **cache_kw)
            return "", tavily_attractions, ""

        crawleo_attractions = await crawleo_service.search_attractions(
            city=intent.dest_city,
            country=intent.dest_country,
        )
        await search_cache.put("attractions", {"baidu": "", "tavily": "", "crawleo": crawleo_attractions}, **cache_kw)
        return "", "", crawleo_attractions

    async def _fetch_restaurant_data() -> str:
        """Fetch restaurant data: Baidu first; fallback Tavily -> Crawleo."""
        cache_kw = dict(city=intent.dest_city, style=intent.travel_style)
        cached_result = await search_cache.get("restaurants", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Restaurant search cache HIT", task_id)
            return cached_result.get("baidu", "")
        baidu_str = await baidu_search_service.search_restaurants(
            city=intent.dest_city,
            budget_level=intent.travel_style,
            task_id=task_id,
        )
        if baidu_str:
            await search_cache.put("restaurants", {"baidu": baidu_str}, **cache_kw)
            return baidu_str

        tavily_str = await tavily_service.search_restaurants(
            city=intent.dest_city,
            budget_level=intent.travel_style,
        )
        if tavily_str:
            logger.info("[task:%s] Baidu restaurants empty, fallback hit Tavily", task_id)
            await search_cache.put("restaurants", {"baidu": tavily_str}, **cache_kw)
            return tavily_str

        crawleo_data = await crawleo_service.search(
            query=f"{intent.dest_city} 餐厅 推荐 人均 评分 地址 必吃",
            count=6,
        )
        crawleo_str = _format_crawleo_generic("Crawleo 餐厅实时搜索", crawleo_data, max_results=6)
        await search_cache.put("restaurants", {"baidu": crawleo_str}, **cache_kw)
        return crawleo_str

    async def _fetch_visa_data() -> str:
        """Fetch visa data: Baidu first; fallback Tavily -> Crawleo."""
        cache_kw = dict(origin=intent.origin_country, dest=intent.dest_country)
        cached_result = await search_cache.get("visa", **cache_kw)
        if cached_result is not None:
            logger.info("[task:%s] Visa search cache HIT", task_id)
            return cached_result.get("baidu", "")
        baidu_str = await baidu_search_service.search_visa(
            origin_country=intent.origin_country,
            dest_country=intent.dest_country,
            dest_city=intent.dest_city,
            task_id=task_id,
        )
        if baidu_str:
            await search_cache.put("visa", {"baidu": baidu_str}, **cache_kw)
            return baidu_str

        tavily_str = await tavily_service.search_visa(
            origin_country=intent.origin_country,
            dest_country=intent.dest_country,
            dest_city=intent.dest_city,
        )
        if tavily_str:
            logger.info("[task:%s] Baidu visa empty, fallback hit Tavily", task_id)
            await search_cache.put("visa", {"baidu": tavily_str}, **cache_kw)
            return tavily_str

        crawleo_data = await crawleo_service.search(
            query=f"{intent.origin_country} 去 {intent.dest_country} {intent.dest_city} 签证 入境 政策 材料 时效 费用",
            count=6,
        )
        crawleo_str = _format_crawleo_generic("Crawleo 签证实时搜索", crawleo_data, max_results=6)
        await search_cache.put("visa", {"baidu": crawleo_str}, **cache_kw)
        return crawleo_str

    # Pre-fetch external data in parallel (weather + flights + hotels + attractions + restaurants + visa)
    (
        forecast_raw,
        flight_data,
        hotel_data,
        attraction_data,
        tavily_restaurants_str,
        tavily_visa_str,
    ) = await asyncio.gather(
        weather_service.get_forecast(
            lat=coords["lat"], lon=coords["lon"],
            days=intent.duration_days, start_date=intent.departure_date,
        ) if need_weather else _noop_list(),
        _fetch_flight_data() if need_flight else _noop_tuple(),
        _fetch_hotel_data() if need_hotel else _noop_hotel_data(),
        _fetch_attraction_data() if need_attraction else _noop_attraction_data(),
        _fetch_restaurant_data(),
        _fetch_visa_data() if need_visa else _noop_str(),
    )
    serpapi_flight_summary, tavily_flights_str, crawleo_flights_str = flight_data
    baidu_hotel_str, serpapi_hotel_summary, tavily_hotels_str, crawleo_hotels_str = hotel_data
    baidu_attractions_str, tavily_attractions_str, crawleo_attractions_str = attraction_data

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
    if not baidu_hotel_str:
        baidu_hotel_str = "【百度实时搜索】\n（百度实时搜索未启用/额度已用尽/本次请求失败，已回退到其他搜索源）"
    if not baidu_attractions_str:
        baidu_attractions_str = "【百度实时搜索】\n（百度实时搜索未启用/额度已用尽/本次请求失败，已回退到其他搜索源）"
    if not tavily_attractions_str:
        tavily_attractions_str = "【Tavily 景点搜索】\n（该数据源未启用或无结果）"
    if not crawleo_attractions_str:
        crawleo_attractions_str = "【Crawleo 景点搜索】\n（该数据源未启用或无结果）"

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

    flight_agent    = FlightAgent(task_id, intent, status_store, llm_config) if need_flight else None
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
        ) if need_flight else _noop_flight_result(),
        _run_or_cache(
            "hotel_agent",
            hotel_agent.run(extra_context={
                "hotel_budget_cny": hotel_budget,
                "baidu_data": baidu_hotel_str,
                "serpapi_data": serpapi_hotel_summary,
                "tavily_data": tavily_hotels_str,
                "crawleo_data": crawleo_hotels_str,
            }),
            cached_prev.get("hotels"),
        ),
        _run_or_cache(
            "attraction_agent",
            attraction_agent.run(extra_context={
                "baidu_data": baidu_attractions_str,
                "tavily_data": tavily_attractions_str,
                "crawleo_data": crawleo_attractions_str,
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
    # AI辅助生成：OpenClaw API，2026-04-01，用途：多Agent并行执行结果汇聚与后续编排衔接

    flights    = results[0]  # type: FlightResult
    hotels     = results[1]  # type: HotelResult
    attractions = results[2]  # type: AttractionResult
    weather    = results[3]  # type: WeatherResult
    if need_visa and len(results) > 4:
        visa_result = results[4]  # type: ignore[assignment]

    logger.info("[task:%s] Phase 2 complete", task_id)

    # ── Phase 3: Itinerary Assembly ──────────────────────────────────────
    logger.info("[task:%s] Phase 3 — Itinerary assembly", task_id)
    # AI辅助生成：OpenClaw API，2026-04-01，用途：专家结果整合为最终行程输出的编排策略参考
    itinerary_agent = ItineraryAgent(
        task_id=task_id,
        intent=intent,
        status_store=status_store,
        llm_config=llm_config,
        session_id=session_id,
        previous_itinerary=previous_itinerary_json,
        user_message=user_message,
        change_hints=intent.change_hints,
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
        "multi_city_guidance": multi_city_guidance,
    })  # type: ignore[assignment]

    # Attach optional results
    if visa_result is not None:
        itinerary.visa_info = visa_result
    if currency is not None:
        itinerary.currency = currency

    logger.info("[task:%s] Itinerary assembled", task_id)

    # ── Phase 3.5: AMap Geocode — replace LLM coordinates ────────────────
    try:
        geo_ok, geo_fail = await geocode_itinerary_activities(
            itinerary, city=intent.dest_city,
        )
        logger.info(
            "[task:%s] Geocode correction: %d success, %d fail",
            task_id, geo_ok, geo_fail,
        )
    except Exception as exc:
        logger.warning("[task:%s] Geocode correction failed: %s", task_id, exc)

    # ── Phase 4: Persist + Update Memory ────────────────────────────────
    record = ItineraryRecord(
        task_id=task_id,
        session_id=session_id,
        user_id=user_id,
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
    # AI辅助生成：OpenClaw API，2026-04-01，用途：任务闭环状态更新与会话记忆写回机制设计
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


def _apply_multi_city_hints(intent: TravelIntent, user_message: str) -> str:
    """Inject multi-city guidance for province-level requests (current focus: Yunnan)."""
    msg = (user_message or "").strip()
    if not msg:
        return ""

    # Yunnan usually implies a regional route instead of single-city stay.
    if ("云南" not in msg) and ("云南" not in intent.dest_city):
        return ""

    if intent.duration_days >= 7:
        route = ["昆明", "大理", "丽江", "普洱"]
    elif intent.duration_days >= 5:
        route = ["昆明", "大理", "丽江"]
    else:
        route = ["昆明", "大理"]

    hint = (
        f"用户是云南省域游（{intent.duration_days}天），请按多城市线路规划："
        f"{' -> '.join(route)}；不同城市分配到不同天，包含城际交通安排，避免全程只在单一城市。"
    )
    if hint not in intent.special_requests:
        intent.special_requests.append(hint)
    return hint


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


def _norm_city(city: str) -> str:
    return (city or "").strip().lower().replace("市", "")


def _build_local_flight_result(intent: TravelIntent) -> FlightResult:
    dep_dt = datetime.combine(intent.departure_date, time(hour=9, minute=0))
    arr_dt = datetime.combine(intent.departure_date, time(hour=10, minute=0))
    local_option = FlightOption(
        airline="本地出行",
        flight_number="LOCAL-0",
        departure_time=dep_dt,
        arrival_time=arr_dt,
        duration_hours=1.0,
        price_cny=0.0,
        stops=0,
        booking_tip="同城行程无需航班，建议优先地铁/公交/打车。",
    )
    return FlightResult(
        outbound=[local_option],
        return_flights=[local_option],
        recommended_index=0,
    )
