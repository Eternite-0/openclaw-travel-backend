from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent, _extract_json
from core.schemas import (
    FinalItinerary,
    ItineraryActivity,
    ItineraryDay,
    TravelIntent,
)
from core.status_store import StatusStore
from config import get_settings

logger = logging.getLogger(__name__)


# ── Internal schemas for two-phase generation ─────────────────────────

class _DaySkeleton(BaseModel):
    """Lightweight per-day plan from Phase 3a."""
    day_number: int
    theme: str
    weather_summary: str
    key_attractions: list[str]


class _ItinerarySkeleton(BaseModel):
    """Phase 3a output: metadata + per-day skeleton."""
    highlights: list[str]
    travel_tips: list[str]
    emergency_contacts: dict[str, str]
    total_estimated_cost_cny: float
    day_skeletons: list[_DaySkeleton]


class _DayBatchResult(BaseModel):
    """Phase 3b output: one or more fully-detailed days."""
    days: list[ItineraryDay]


# ── Agent ─────────────────────────────────────────────────────────────

class ItineraryAgent(BaseSpecialistAgent):
    agent_name = "itinerary_agent"
    display_name = "行程生成"
    output_schema = FinalItinerary
    default_temperature = 0.6

    # Phase 3a: generate metadata skeleton (~200 token output)
    _SKELETON_PROMPT = """你是"智慧旅行助手"系统中最核心的行程生成专家（ItineraryAgent）。

【本次任务 — 第一阶段：生成行程元数据骨架】
请仅生成以下内容，不要生成每天的详细活动：
1. highlights：5个精炼的行程亮点
2. travel_tips：5-8条实用旅行建议
3. emergency_contacts：目的地国家的紧急联系方式（警察/救援/大使馆等）
4. total_estimated_cost_cny：所有活动费用 + 推荐航班 + 推荐酒店的总估算
5. day_skeletons：每天的骨架信息（day_number, theme主题, weather_summary天气摘要, key_attractions该天主要景点名称列表）

【约束规则】
1. 只输出合法 JSON，格式符合下方 Schema。禁止 markdown、解释文字。
2. day_skeletons 必须包含恰好 {duration_days} 天。
3. 每天的 key_attractions 从景点列表中选取 2-3 个，合理分配避免重复。
4. 行程安排须考虑：景点地理位置（同区域景点安排在同一天）、天气状况。

【旅行意图】
{intent}

【汇率信息】
{currency}

【预算明细】
{budget}

【推荐航班（去程）】
{recommended_flight}

【推荐酒店】
{recommended_hotel}

【景点列表】
{attractions}

【天气预报】
{weather}

【上一版行程（如有修改请求时参考）】
{previous_itinerary}

【输出 JSON Schema】
{skeleton_schema}

现在请输出骨架 JSON："""

    # Phase 3b: generate detailed days for a batch
    _DAY_BATCH_PROMPT = """你是"智慧旅行助手"系统中的行程生成专家。

【本次任务 — 生成第 {day_range} 天的详细行程】
请根据下方骨架信息，生成指定天数的完整 ItineraryDay 对象。

【约束规则】
1. 只输出合法 JSON，格式符合下方 Schema。禁止 markdown、解释文字。
2. 每天必须包含 4-6 个 activities，合理分配上午/下午/晚上。
3. 每天必须包含 meals 字典，键为 "breakfast"/"lunch"/"dinner"，值为具体餐厅名称+推荐菜品+人均价格（如"XXX餐厅，推荐招牌菜，人均¥80"）。优先使用下方【餐厅推荐数据】中的真实餐厅。
4. 行程安排须考虑：景点开放时间、交通距离、天气状况、预算限制。
5. transport_notes 提供当天景点间的交通建议。
6. daily_budget_cny 为当天所有活动+餐饮+交通的估算费用。
7. date 格式为 YYYY-MM-DD，从出发日 {departure_date} 开始计算。
8. 每个 activity 必须包含 lat 和 lng 字段（GCJ-02 高德/国测局坐标系，小数格式）。优先从【景点列表】中复制坐标；如景点列表中无坐标，则根据地址推断合理的 GCJ-02 坐标。坐标用于前端高德地图渲染每日路线，务必准确。

【旅行意图】
{intent}

【景点列表】
{attractions}

【天气预报】
{weather}

【餐厅推荐数据（来自实时搜索）】
{restaurants}

【该批次的骨架信息】
{batch_skeletons}

【输出 JSON Schema】
{day_batch_schema}

现在请输出 JSON："""

    # Keep the legacy single-call prompt as fallback
    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中最核心的行程生成专家（ItineraryAgent）。

【你的唯一职责】
综合所有专项分析结果，生成一份完整、详细、可执行的逐日旅行行程。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. days 列表必须包含与 duration_days 相同数量的天数对象（每天一个）。
5. 每天必须包含 4-6 个 activities（活动），合理分配上午/下午/晚上。
6. 每天必须包含 meals 字典，键为 "breakfast"/"lunch"/"dinner"，值为餐厅或美食推荐。
7. 行程安排须考虑：景点开放时间、交通距离、天气状况、预算限制。
8. highlights 须包含5个精炼的行程亮点（用于执行摘要展示）。
9. travel_tips 须包含 5-8 条实用旅行建议。
10. emergency_contacts 须包含目的地国家的紧急联系方式（警察/救援/大使馆等）。
11. task_id, session_id, created_at 使用下方提供的值。
12. recommended_flight 和 recommended_hotel 使用下方推荐的选项数据。
13. total_estimated_cost_cny 为所有活动费用 + 推荐航班 + 推荐酒店的总估算。

【旅行意图】
{intent}

【汇率信息】
{currency}

【预算明细】
{budget}

【推荐航班（去程）】
{recommended_flight}

【推荐酒店】
{recommended_hotel}

【景点列表】
{attractions}

【天气预报】
{weather}

【上一版行程（如有修改请求时参考）】
{previous_itinerary}

【元数据】
task_id: {task_id}
session_id: {session_id}
created_at: {created_at}

【输出 JSON Schema】
{schema}

现在请生成完整的旅行行程 JSON："""

    def __init__(
        self,
        task_id: str,
        intent: TravelIntent,
        status_store: StatusStore,
        llm_config: dict,
        session_id: str = "",
        previous_itinerary: str = "",
    ) -> None:
        super().__init__(task_id, intent, status_store, llm_config)
        self._session_id = session_id
        self._previous_itinerary = previous_itinerary

    # ── Helper: compact object to string ──────────────────────────────

    @staticmethod
    def _compact(obj) -> str:
        if obj is None:
            return "{}"
        if isinstance(obj, BaseModel):
            return obj.model_dump_json(indent=2)
        if isinstance(obj, str):
            return obj
        return json.dumps(obj, ensure_ascii=False, indent=2, default=str)

    @staticmethod
    def _compact_attractions(obj) -> str:
        """Pass up to 10 attractions with description/address fields for richer context."""
        if obj is None:
            return "[]"
        data = obj.model_dump() if isinstance(obj, BaseModel) else obj
        items = data.get("attractions", data) if isinstance(data, dict) else data
        if not isinstance(items, list):
            return "[]"
        slim = []
        for a in items[:10]:
            slim.append({
                "name": a.get("name_zh", a.get("name", "")),
                "name_en": a.get("name", ""),
                "category": a.get("category", ""),
                "address": a.get("address", ""),
                "opening_hours": a.get("opening_hours", ""),
                "entry_fee_cny": a.get("entry_fee_cny", 0),
                "recommended_duration_hours": a.get("recommended_duration_hours", 2),
                "must_see": a.get("must_see", False),
                "tips": str(a.get("tips", ""))[:120],
            })
        return json.dumps(slim, ensure_ascii=False, indent=2)

    # ── Helper: extract recommended flight/hotel from context ─────────

    @staticmethod
    def _extract_recommended(context: dict) -> tuple[str, str]:
        flights_data = context.get("flights")
        recommended_flight = "{}"
        if flights_data is not None:
            if hasattr(flights_data, "outbound") and flights_data.outbound:
                idx = min(flights_data.recommended_index, len(flights_data.outbound) - 1)
                recommended_flight = flights_data.outbound[idx].model_dump_json()

        hotels_data = context.get("hotels")
        recommended_hotel = "{}"
        if hotels_data is not None:
            if hasattr(hotels_data, "options") and hotels_data.options:
                idx = min(hotels_data.recommended_index, len(hotels_data.options) - 1)
                recommended_hotel = hotels_data.options[idx].model_dump_json()

        return recommended_flight, recommended_hotel

    # ── LLM call helper (reuses client from base) ─────────────────────

    async def _llm_call(self, system_prompt: str, user_prompt: str = "请按照系统提示中的 JSON Schema 输出结果。") -> dict:
        """Single LLM call with retry, returns parsed dict."""
        last_exc: Exception | None = None
        _retry_delays = [3, 6]
        for attempt in range(3):
            try:
                completion = await self._client.chat.completions.create(
                    model=self._model,
                    temperature=self._temperature,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                )
                raw = completion.choices[0].message.content or "{}"
                raw = _extract_json(raw)
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"LLM returned invalid JSON: {exc}") from exc
            except Exception as exc:
                last_exc = exc
                if attempt < 2:
                    await asyncio.sleep(_retry_delays[attempt])
                else:
                    raise
        raise ValueError(f"LLM request failed: {last_exc}")

    # ── Override _execute for parallel generation ─────────────────────

    async def _execute(self, context: dict[str, Any]) -> BaseModel:
        settings = get_settings()
        duration = self.intent.duration_days

        # Prepare shared context strings
        attractions_str = self._compact_attractions(context.get("attractions"))
        weather_str = self._compact(context.get("weather"))
        restaurants_str = context.get("restaurants", "")
        if not restaurants_str:
            restaurants_str = "（未获取到实时餐厅数据，请基于目的地知名餐厅推荐）"
        recommended_flight, recommended_hotel = self._extract_recommended(context)

        previous_itinerary = context.get("previous_itinerary", self._previous_itinerary)
        if isinstance(previous_itinerary, str) and len(previous_itinerary) > 3500:
            previous_itinerary = previous_itinerary[:3500] + "...(truncated)"

        skeleton_schema = json.dumps(
            _ItinerarySkeleton.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )

        # ── Phase 3a: Metadata skeleton ──────────────────────────────
        logger.info("[task:%s] Phase 3a — generating itinerary skeleton", self.task_id)
        await self.status_store.update_agent(
            self.task_id, self.agent_name, "running",
            message="正在规划行程骨架...",
        )

        skeleton_prompt = self._SKELETON_PROMPT.format(
            duration_days=duration,
            intent=self.intent.model_dump_json(indent=2),
            currency=self._compact(context.get("currency")),
            budget=self._compact(context.get("budget")),
            recommended_flight=recommended_flight,
            recommended_hotel=recommended_hotel,
            attractions=attractions_str,
            weather=weather_str,
            previous_itinerary=previous_itinerary or "（无上一版行程）",
            skeleton_schema=skeleton_schema,
        )

        skeleton_data = await self._llm_call(skeleton_prompt)
        skeleton = _ItinerarySkeleton.model_validate(skeleton_data)
        logger.info(
            "[task:%s] Skeleton generated: %d day_skeletons, %d highlights",
            self.task_id, len(skeleton.day_skeletons), len(skeleton.highlights),
        )

        # ── Phase 3b: Parallel day batch generation ──────────────────
        logger.info("[task:%s] Phase 3b — generating days in parallel", self.task_id)
        await self.status_store.update_agent(
            self.task_id, self.agent_name, "running",
            message="正在并行生成每日行程...",
        )

        day_batch_schema = json.dumps(
            _DayBatchResult.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )

        # Split days into batches of 2
        batch_size = 2
        batches: list[list[_DaySkeleton]] = []
        skeletons_list = skeleton.day_skeletons[:duration]
        for i in range(0, len(skeletons_list), batch_size):
            batches.append(skeletons_list[i : i + batch_size])

        sem = asyncio.Semaphore(settings.agent_concurrency)

        async def _gen_day_batch(batch: list[_DaySkeleton]) -> list[ItineraryDay]:
            day_nums = [s.day_number for s in batch]
            day_range = f"{day_nums[0]}-{day_nums[-1]}" if len(day_nums) > 1 else str(day_nums[0])
            batch_json = json.dumps(
                [s.model_dump() for s in batch],
                ensure_ascii=False, indent=2,
            )
            prompt = self._DAY_BATCH_PROMPT.format(
                day_range=day_range,
                departure_date=self.intent.departure_date.isoformat(),
                intent=self.intent.model_dump_json(indent=2),
                attractions=attractions_str,
                weather=weather_str,
                restaurants=restaurants_str,
                batch_skeletons=batch_json,
                day_batch_schema=day_batch_schema,
            )
            async with sem:
                data = await self._llm_call(prompt)
            result = _DayBatchResult.model_validate(data)
            return result.days

        tasks = [_gen_day_batch(batch) for batch in batches]
        batch_results = await asyncio.gather(*tasks)
        all_days: list[ItineraryDay] = []
        for days in batch_results:
            all_days.extend(days)

        # Sort by day_number to ensure order
        all_days.sort(key=lambda d: d.day_number)

        # ── Consistency fix: ensure correct number of days ────────────
        if len(all_days) != duration:
            logger.warning(
                "[task:%s] Day count mismatch: got %d, expected %d — attempting fix",
                self.task_id, len(all_days), duration,
            )
            all_days = await self._fix_day_count(all_days, duration, attractions_str, weather_str, restaurants_str, day_batch_schema)

        # ── Assemble FinalItinerary ──────────────────────────────────
        recommended_flight_obj, recommended_hotel_obj = self._extract_recommended_objects(context)

        itinerary = FinalItinerary(
            task_id=self.task_id,
            session_id=self._session_id,
            created_at=datetime.utcnow(),
            intent=self.intent,
            currency=context.get("currency"),
            budget=context.get("budget"),
            recommended_flight=recommended_flight_obj,
            recommended_hotel=recommended_hotel_obj,
            weather=context.get("weather"),
            highlights=skeleton.highlights,
            days=all_days,
            total_estimated_cost_cny=skeleton.total_estimated_cost_cny,
            travel_tips=skeleton.travel_tips,
            emergency_contacts=skeleton.emergency_contacts,
        )
        return itinerary

    # ── Day count consistency fix ─────────────────────────────────────

    async def _fix_day_count(
        self,
        days: list[ItineraryDay],
        expected: int,
        attractions_str: str,
        weather_str: str,
        restaurants_str: str,
        day_batch_schema: str,
    ) -> list[ItineraryDay]:
        """If day count doesn't match, generate missing days or trim excess."""
        if len(days) > expected:
            return days[:expected]

        # Generate missing days
        existing_nums = {d.day_number for d in days}
        missing_nums = [n for n in range(1, expected + 1) if n not in existing_nums]
        if not missing_nums:
            # day_numbers are present but count is off — just trim/extend
            return days[:expected]

        missing_skeletons = [
            _DaySkeleton(
                day_number=n,
                theme=f"第{n}天自由探索",
                weather_summary="参考天气预报",
                key_attractions=[],
            )
            for n in missing_nums
        ]
        batch_json = json.dumps(
            [s.model_dump() for s in missing_skeletons],
            ensure_ascii=False, indent=2,
        )
        prompt = self._DAY_BATCH_PROMPT.format(
            day_range=f"{missing_nums[0]}-{missing_nums[-1]}" if len(missing_nums) > 1 else str(missing_nums[0]),
            departure_date=self.intent.departure_date.isoformat(),
            intent=self.intent.model_dump_json(indent=2),
            attractions=attractions_str,
            weather=weather_str,
            restaurants=restaurants_str,
            batch_skeletons=batch_json,
            day_batch_schema=day_batch_schema,
        )
        try:
            data = await self._llm_call(prompt)
            result = _DayBatchResult.model_validate(data)
            days.extend(result.days)
            days.sort(key=lambda d: d.day_number)
            logger.info("[task:%s] Fixed day count: now %d days", self.task_id, len(days))
        except Exception as exc:
            logger.warning("[task:%s] Day count fix failed: %s", self.task_id, exc)
        return days[:expected]

    # ── Extract recommended objects (not JSON strings) ────────────────

    @staticmethod
    def _extract_recommended_objects(context: dict):
        from core.schemas import FlightOption, HotelOption

        flights_data = context.get("flights")
        recommended_flight = None
        if flights_data is not None and hasattr(flights_data, "outbound") and flights_data.outbound:
            idx = min(flights_data.recommended_index, len(flights_data.outbound) - 1)
            recommended_flight = flights_data.outbound[idx]

        hotels_data = context.get("hotels")
        recommended_hotel = None
        if hotels_data is not None and hasattr(hotels_data, "options") and hotels_data.options:
            idx = min(hotels_data.recommended_index, len(hotels_data.options) - 1)
            recommended_hotel = hotels_data.options[idx]

        return recommended_flight, recommended_hotel

    # ── Legacy _build_system_prompt (kept for fallback compatibility) ──

    def _build_system_prompt(self, context: dict) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        recommended_flight, recommended_hotel = self._extract_recommended(context)

        previous_itinerary = context.get("previous_itinerary", self._previous_itinerary)
        if isinstance(previous_itinerary, str) and len(previous_itinerary) > 3500:
            previous_itinerary = previous_itinerary[:3500] + "...(truncated)"
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            currency=self._compact(context.get("currency")),
            budget=self._compact(context.get("budget")),
            recommended_flight=recommended_flight,
            recommended_hotel=recommended_hotel,
            attractions=self._compact_attractions(context.get("attractions")),
            weather=self._compact(context.get("weather")),
            previous_itinerary=previous_itinerary or "（无上一版行程）",
            task_id=self.task_id,
            session_id=self._session_id,
            created_at=datetime.utcnow().isoformat(),
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: FinalItinerary = result  # type: ignore[assignment]
        highlights_preview = r.highlights[0] if r.highlights else "行程已生成"
        return f"{len(r.days)}天行程完成，{highlights_preview[:40]}"
