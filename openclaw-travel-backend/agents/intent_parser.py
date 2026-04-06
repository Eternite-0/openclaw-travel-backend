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

   - "加州" → dest_city="Los Angeles"
   - "北海道" → dest_city="札幌"
   如果用户同时提到了多个城市（如"大理丽江"），选第一个城市作为 dest_city。

【关键规则 — 必须严格遵守】
1. 所有日期字段（departure_date, return_date）必须使用 ISO 格式 YYYY-MM-DD，**禁止输出空字符串**。
2. **如果是修改已有行程**：必须从【上一次规划的行程摘要】中继承 departure_date 和 return_date，保持原日期不变，不要重新猜测。
3. **如果有【上一次意图结构化JSON】**：优先完整继承该 JSON 的所有字段，只覆盖用户明确提到要修改的字段。
4. 对于字段未提及的情况，优先沿用上一次意图；只有全新规划且没有历史时，才做合理默认推断。
5. 只有在既没有历史也无法识别目的地/日期等关键意图时，才允许输出 need_more_info。
6. 如果用户表达的是省域/区域旅行（例如“云南玩7天”），不要把行程锁死在单一城市；在 special_requests 里明确写入“多城市线路”要求（例如“云南多城市：昆明-大理-丽江/普洱”）。

【上一次意图结构化JSON（若有）】
{previous_intent_json}

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
                 previous_summary: str = "", previous_intent_json: str = "") -> None:
        super().__init__(task_id, intent, status_store, llm_config)
        self._user_message = user_message
        self._history = history
        self._previous_summary = previous_summary
        self._previous_intent_json = previous_intent_json

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
        previous_intent_json = context.get("previous_intent_json", self._previous_intent_json)
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            history=history or "（无历史记录）",
            user_message=user_message,
            previous_intent_json=previous_intent_json or "（无）",
            previous_summary=previous_summary or "（无，这是第一次规划）",
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: TravelIntent = result  # type: ignore[assignment]
        return f"{r.origin_city} → {r.dest_city}，{r.duration_days}天，预算¥{r.budget_cny:.0f}"
