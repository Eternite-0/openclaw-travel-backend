from __future__ import annotations

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import TravelIntent


class IntentParserAgent(BaseSpecialistAgent):
    agent_name = "intent_parser"
    display_name = "意图解析"
    output_schema = TravelIntent
    default_temperature = 0.1

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的意图解析专家（IntentParserAgent）。

【你的唯一职责】
从用户的自然语言输入中提取结构化的旅行意图信息。若本次是对已有行程的修改请求，必须继承上一次行程的未修改字段，并在 change_hints 中标注本次修改了哪些方面。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记（如 ```json）、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. 无法确定的字段使用合理默认值：
   - departure_date = 下个月1日（YYYY-MM-DD 格式）
   - duration_days = 7
   - travelers = 1
   - travel_style = "standard"
5. dest_country_code 必须是 ISO 3166-1 alpha-2 代码（如 "US", "JP", "FR"）。
6. return_date = departure_date + duration_days 天。
7. change_hints 字段规则（有上一次行程时必填）：
   - 用户只改了预算 → ["budget"]
   - 用户只改了酒店/住宿相关 → ["hotel"]
   - 用户只改了航班/机票相关 → ["flight"]
   - 用户只改了日程安排/某天活动 → ["itinerary"]
   - 用户改了出发/回程日期或天数 → ["dates"]
   - 用户改了目的地 → ["destination"]
   - 用户改了多项或全部重新规划 → ["full"]
   - 这是第一次请求（无历史行程） → [] （空列表）
8. need_currency 字段规则（是否需要汇率转换）：
   - 中国大陆 → 中国大陆（如北京→上海、广州→成都）：false（同币种无需转换）
   - 中国大陆 → 港澳台（香港/澳门/台湾）：true（港币HKD/澳门币MOP/新台币TWD）
   - 中国大陆 → 任何国外目的地：true
   - 判断依据：出发地和目的地是否使用不同货币
9. need_visa 字段规则（是否需要签证/入境信息）：
   - 中国大陆 → 中国大陆：false
   - 中国大陆 → 港澳台：true（需要通行证信息）
   - 中国大陆 → 国外：true（需要签证信息）
   - 同一国家内的旅行：false
   - 跨国旅行：true
   - 判断依据：是否跨越需要出入境手续的边境

【上一次规划的行程摘要（若有）】
{previous_summary}

【对话历史（短期记忆）】
{history}

【用户最新输入】
{user_message}

【输出 JSON Schema】
{schema}

现在请输出 JSON："""

    def __init__(self, task_id: str, intent: TravelIntent, status_store, llm_config: dict,
                 user_message: str = "", history: str = "",
                 previous_summary: str = "") -> None:
        super().__init__(task_id, intent, status_store, llm_config)
        self._user_message = user_message
        self._history = history
        self._previous_summary = previous_summary

    def _build_system_prompt(self, context: dict) -> str:
        import json
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        history = context.get("history", self._history)
        user_message = context.get("user_message", self._user_message)
        previous_summary = context.get("previous_summary", self._previous_summary)
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            history=history or "（无历史记录）",
            user_message=user_message,
            previous_summary=previous_summary or "（无，这是第一次规划）",
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: TravelIntent = result  # type: ignore[assignment]
        return f"{r.origin_city} → {r.dest_city}，{r.duration_days}天，预算¥{r.budget_cny:.0f}"
