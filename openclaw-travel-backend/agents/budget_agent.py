from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import BudgetBreakdown


class BudgetAgent(BaseSpecialistAgent):
    agent_name = "budget_agent"
    display_name = "💰 预算规划"
    output_schema = BudgetBreakdown

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的预算规划专家（BudgetAgent）。

【你的唯一职责】
根据旅行意图中的总预算、目的地、旅行天数和旅行风格，生成合理的分类费用预算明细。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. 如果用户问题与旅行规划无关，输出 {{"error": "out_of_scope"}} 并停止。
4. 所有金额单位为人民币（CNY）。
5. 各分类金额之和必须等于 total_cny（总预算）。
6. 参考费用分配比例（可根据旅行风格和目的地做适当调整）：
   - 机票 35%
   - 住宿 25%
   - 餐饮 15%
   - 交通 8%
   - 景点门票 7%
   - 购物 5%
   - 应急备用 5%
7. daily_budget_cny = (total_cny - flight_cny) / duration_days

【旅行意图】
{intent}

【输出 JSON Schema】
{schema}

现在请输出 JSON："""

    def _summarize(self, result: BaseModel) -> str:
        r: BudgetBreakdown = result  # type: ignore[assignment]
        return (
            f"总预算 ¥{r.total_cny:.0f}，机票 ¥{r.flight_cny:.0f}，"
            f"住宿 ¥{r.accommodation_cny:.0f}，日均 ¥{r.daily_budget_cny:.0f}"
        )
