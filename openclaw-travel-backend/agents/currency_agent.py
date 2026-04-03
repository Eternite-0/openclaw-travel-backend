from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import CurrencyInfo, TravelIntent


class CurrencyAgent(BaseSpecialistAgent):
    agent_name = "currency_agent"
    display_name = "汇率分析"
    output_schema = CurrencyInfo

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的汇率分析专家（CurrencyAgent）。

【你的唯一职责】
根据提供的实时汇率数据，生成货币兑换信息和实用的金钱使用建议。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. tips 列表必须包含 3 条针对目的地国家的实用货币使用建议。

【旅行意图】
{intent}

【实时汇率数据】
- 来源货币: {from_currency}
- 目标货币: {to_currency}
- 汇率: 1 {from_currency} = {rate} {to_currency}
- 总预算 CNY: {budget_cny}
- 目标货币预算: {budget_in_dest}

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
            from_currency="CNY",
            to_currency=context.get("to_currency", "USD"),
            rate=context.get("rate", 0.14),
            budget_cny=self.intent.budget_cny,
            budget_in_dest=context.get("budget_in_dest", self.intent.budget_cny * 0.14),
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: CurrencyInfo = result  # type: ignore[assignment]
        return (
            f"1 CNY ≈ {r.rate:.4f} {r.to_currency}，"
            f"预算约 {r.budget_in_dest_currency:.0f} {r.to_currency}"
        )
