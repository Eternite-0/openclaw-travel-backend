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

w   - "加州" → dest_city="Los Angeles"
   - "北海道" → dest_city="札幌"
   如果用户同时提到了多个城市（如"大理丽江"），选第一个城市作为 dest_city。

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
