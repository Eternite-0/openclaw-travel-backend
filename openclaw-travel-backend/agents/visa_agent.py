from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import VisaResult


class VisaAgent(BaseSpecialistAgent):
    agent_name = "visa_agent"
    display_name = "签证/入境信息"
    output_schema = VisaResult
    default_temperature = 0.2

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的签证与入境政策专家（VisaAgent）。

【你的唯一职责】
根据旅行者的出发地和目的地，提供准确的签证/入境政策信息。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 根据出发国和目的地的实际关系判断签证类型：
   - 中国大陆 → 香港/澳门：需要港澳通行证，required=true，visa_type="港澳通行证"
   - 中国大陆 → 台湾：需要大陆居民往来台湾通行证，required=true，visa_type="台湾通行证+入台证"
   - 中国大陆 → 免签国家（如泰国、新加坡等）：required=false，visa_type="免签"，但仍需填写入境政策
   - 中国大陆 → 需要签证的国家（如美国、日本等）：required=true，visa_type 填写具体签证类型
4. documents 列表必须包含所有所需材料（护照/通行证、照片、申请表、财力证明等）。
5. processing_days 为正常办理工作日天数。
6. fees_cny 为签证/通行证办理费用（人民币）。
7. notes 提供 1-2 条实用提醒（如提前办理时间、注意事项等）。
8. entry_policy_summary 用 2-3 句话概括入境政策要点（停留天数、入境条件等）。
9. 优先参考下方【实时搜索数据】中的最新政策信息。

【旅行意图】
{intent}

【实时搜索数据（来自 Tavily）】
{tavily_data}

【输出 JSON Schema】
{schema}

现在请输出 JSON："""

    def _build_system_prompt(self, context: dict) -> str:
        schema_json = json.dumps(
            self.output_schema.model_json_schema(),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        tavily_data = context.get("tavily_data", "")
        if not tavily_data:
            tavily_data = "（未获取到实时签证数据，请基于你的知识回答）"
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            tavily_data=tavily_data,
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: VisaResult = result  # type: ignore[assignment]
        if r.required:
            return f"需要{r.visa_type}，办理约{r.processing_days}个工作日，费用¥{r.fees_cny:.0f}"
        return f"免签入境，{r.entry_policy_summary[:40]}"
