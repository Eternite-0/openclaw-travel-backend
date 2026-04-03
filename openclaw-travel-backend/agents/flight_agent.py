from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import FlightResult


class FlightAgent(BaseSpecialistAgent):
    agent_name = "flight_agent"
    display_name = "✈️ 航班查询"
    output_schema = FlightResult

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的航班查询专家（FlightAgent）。

【你的唯一职责】
基于下方提供的实时航班搜索数据，为旅行者整理出3个真实可信的航班选项（经济/标准/商务三档）。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. 必须生成 outbound（去程）和 return_flights（回程）各3个选项。
5. 优先使用下方【实时数据】中的真实航班信息；若数据不足，以市场常见航班补全。
6. 航班号格式：航空公司代码 + 数字，如 "CA837"、"MU588"。
7. datetime 格式必须是 ISO 8601：YYYY-MM-DDTHH:MM:SS。
8. 价格单位为人民币（CNY），必须以实时数据为准，无数据时参考市场水平。
9. booking_tip 必须包含免责声明："价格仅供参考，实际以购票平台为准"。
10. recommended_index 为 0-2 之间的整数，指向性价比最高的选项。

【旅行意图】
{intent}

【预算参考（机票部分）】
航班预算: ¥{flight_budget_cny}

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
            indent=2,
        )
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            flight_budget_cny=context.get("flight_budget_cny", self.intent.budget_cny * 0.35),
            serpapi_data=context.get("serpapi_data", "（SerpAPI 航班数据：未启用）"),
            tavily_data=context.get("tavily_data", "（Tavily 搜索数据：未启用）"),
            crawleo_data=context.get("crawleo_data", "（Crawleo 搜索数据：未启用）"),
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: FlightResult = result  # type: ignore[assignment]
        if r.outbound:
            rec = r.outbound[r.recommended_index] if r.recommended_index < len(r.outbound) else r.outbound[0]
            return f"推荐 {rec.airline} {rec.flight_number}，¥{rec.price_cny:.0f}，{rec.duration_hours:.1f}h"
        return "已生成航班选项"
