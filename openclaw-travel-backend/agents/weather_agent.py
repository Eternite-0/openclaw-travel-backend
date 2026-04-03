from __future__ import annotations

import json
import logging

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import TravelIntent, WeatherResult
from core.status_store import StatusStore

logger = logging.getLogger(__name__)


class WeatherAgent(BaseSpecialistAgent):
    agent_name = "weather_agent"
    display_name = "🌤️ 天气预报"
    output_schema = WeatherResult

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的天气预报专家（WeatherAgent）。

【你的唯一职责】
基于已获取的真实天气预报数据，为每天添加穿衣建议，并生成整体天气摘要和打包建议。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. daily 列表的日期和温度/降水数据必须使用下方提供的真实预报数据，不得捏造。
5. clothing_advice 须根据当天温度和天气状况给出实用穿衣建议（1句话）。
6. packing_suggestions 列表须包含5-8条针对该目的地和天气的打包建议。
7. overall_summary 为整体天气情况的1-2句中文描述。
8. condition 字段为中文天气状况描述，如"晴天"、"多云"、"小雨"等。

【旅行意图】
{intent}

【真实天气预报数据（来自 Open-Meteo API）】
{weather_data}

【输出 JSON Schema】
{schema}

现在请输出 JSON："""

    def __init__(
        self,
        task_id: str,
        intent: TravelIntent,
        status_store: StatusStore,
        llm_config: dict,
    ) -> None:
        super().__init__(task_id, intent, status_store, llm_config)

    def _build_system_prompt(self, context: dict) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            indent=2,
        )
        weather_data = context.get("weather_data", "[]")
        if not isinstance(weather_data, str):
            weather_data = json.dumps(weather_data, ensure_ascii=False, indent=2)
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            weather_data=weather_data,
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: WeatherResult = result  # type: ignore[assignment]
        if r.daily:
            temps = [d.temp_high_c for d in r.daily]
            avg_high = sum(temps) / len(temps)
            return f"{r.overall_summary[:30]}，平均最高气温 {avg_high:.1f}°C"
        return r.overall_summary[:50]
