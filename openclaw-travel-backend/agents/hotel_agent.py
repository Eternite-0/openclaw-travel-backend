from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import HotelResult


class HotelAgent(BaseSpecialistAgent):
    agent_name = "hotel_agent"
    display_name = "酒店推荐"
    output_schema = HotelResult

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的酒店推荐专家（HotelAgent）。

【你的唯一职责】
基于下方提供的实时酒店搜索数据，为旅行者整理出3个不同档次（经济/标准/豪华）的真实酒店选项。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. options 列表必须恰好包含3个酒店选项，分别对应经济/标准/豪华三个档次。
5. 优先使用下方【实时数据】中的真实酒店；若数据不足，以目的地知名酒店补全。
6. 价格单位为人民币（CNY），以实时数据为准，无数据时参考市场水平。
7. total_price_cny = price_per_night_cny × duration_days。
8. highlights 列表须包含3-5个该酒店的主要特色（可从实时数据中提取评价/设施）。
9. recommended_index 为 0-2 之间的整数，指向与旅行风格和预算最匹配的选项。
10. area 字段填写酒店所在区域，便于旅行者了解地理位置。

【旅行意图】
{intent}

【预算参考（住宿部分）】
住宿总预算: ¥{hotel_budget_cny}
每晚参考预算: ¥{per_night_budget_cny}

{serpapi_data}

{tavily_data}

{crawleo_data}

【输出 JSON Schema】
{schema}

现在请输出 JSON："""

    def _build_system_prompt(self, context: dict) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        hotel_budget = context.get("hotel_budget_cny", self.intent.budget_cny * 0.25)
        per_night = hotel_budget / max(self.intent.duration_days, 1)
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            hotel_budget_cny=f"{hotel_budget:.0f}",
            per_night_budget_cny=f"{per_night:.0f}",
            serpapi_data=context.get("serpapi_data", "（SerpAPI 酒店数据：未启用）"),
            tavily_data=context.get("tavily_data", "（Tavily 搜索数据：未启用）"),
            crawleo_data=context.get("crawleo_data", "（Crawleo 搜索数据：未启用）"),
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: HotelResult = result  # type: ignore[assignment]
        if r.options:
            rec = r.options[r.recommended_index] if r.recommended_index < len(r.options) else r.options[0]
            return f"推荐 {rec.name}（{rec.stars}星），¥{rec.price_per_night_cny:.0f}/晚"
        return "已生成酒店选项"
