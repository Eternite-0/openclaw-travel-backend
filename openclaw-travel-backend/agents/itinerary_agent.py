from __future__ import annotations

import json
import logging
from datetime import datetime

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import FinalItinerary, TravelIntent
from core.status_store import StatusStore

logger = logging.getLogger(__name__)


class ItineraryAgent(BaseSpecialistAgent):
    agent_name = "itinerary_agent"
    display_name = "行程生成"
    output_schema = FinalItinerary

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

    def _build_system_prompt(self, context: dict) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )

        def _compact(obj) -> str:
            if obj is None:
                return "{}"
            if isinstance(obj, BaseModel):
                return obj.model_dump_json(indent=2)
            if isinstance(obj, str):
                return obj
            return json.dumps(obj, ensure_ascii=False, indent=2, default=str)

        def _compact_attractions(obj) -> str:
            if obj is None:
                return "[]"
            data = obj.model_dump() if isinstance(obj, BaseModel) else obj
            items = data.get("attractions", data) if isinstance(data, dict) else data
            if not isinstance(items, list):
                return "[]"
            slim = []
            for a in items[:5]:
                slim.append({
                    "name": a.get("name_zh", a.get("name", "")),
                    "category": a.get("category", ""),
                    "opening_hours": a.get("opening_hours", ""),
                    "entry_fee_cny": a.get("entry_fee_cny", 0),
                    "recommended_duration_hours": a.get("recommended_duration_hours", 2),
                    "must_see": a.get("must_see", False),
                    "tips": str(a.get("tips", ""))[:80],
                })
            return json.dumps(slim, ensure_ascii=False, indent=2)

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

        previous_itinerary = context.get("previous_itinerary", self._previous_itinerary)
        if isinstance(previous_itinerary, str) and len(previous_itinerary) > 3500:
            previous_itinerary = previous_itinerary[:3500] + "...(truncated)"
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            currency=_compact(context.get("currency")),
            budget=_compact(context.get("budget")),
            recommended_flight=recommended_flight,
            recommended_hotel=recommended_hotel,
            attractions=_compact_attractions(context.get("attractions")),
            weather=_compact(context.get("weather")),
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
