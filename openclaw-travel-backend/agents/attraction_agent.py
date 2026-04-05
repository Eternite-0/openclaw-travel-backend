from __future__ import annotations

import json

from pydantic import BaseModel

from agents.base_agent import BaseSpecialistAgent
from core.schemas import AttractionResult


class AttractionAgent(BaseSpecialistAgent):
    agent_name = "attraction_agent"
    display_name = "景点规划"
    output_schema = AttractionResult
    default_temperature = 0.5

    SYSTEM_PROMPT_TEMPLATE = """你是"智慧旅行助手"系统中的景点规划专家（AttractionAgent）。

【你的唯一职责】
为旅行者列出目的地城市的10个顶级景点，覆盖多种类别（地标/博物馆/自然/娱乐/美食）。

【约束规则 — 必须严格遵守】
1. 你只能输出一个合法的 JSON 对象，格式必须完全符合下方 JSON Schema。
2. 禁止输出任何 markdown 标记、解释文字或额外内容。
3. attractions 列表必须恰好包含10个景点。
4. 必须标注至少3个 must_see=true 的必游景点。
5. category 必须是以下之一: "landmark", "museum", "nature", "entertainment", "food"。
6. entry_fee_cny 为人民币等值金额（0表示免费）。
7. opening_hours 格式示例："09:00-17:00（周一闭馆）"。
8. name 为英文名，name_zh 为中文名。
9. tips 字段提供该景点的实用参观建议（1-2句话）。
10. address 字段必须填写景点的真实地址，优先使用下方实时搜索数据中的地址。
11. lat/lng 字段必须填写景点的 GCJ-02 坐标（高德/国测局坐标系，小数格式，如 lat=25.0397, lng=102.7193）。注意：GCJ-02 与 GPS(WGS-84) 有微小偏移，你必须输出 GCJ-02 坐标而非 WGS-84，否则地图上会有偏差。坐标必须合理准确，不可随意编造。
12. 优先参考下方【实时搜索数据】中提到的景点信息，与你的知识融合后生成推荐。

【旅行意图】
{intent}

【实时搜索数据（百度优先）】
{baidu_data}

【补充搜索数据（来自 Tavily）】
{tavily_data}

【补充搜索数据（来自 Crawleo）】
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
        baidu_data = context.get("baidu_data", "")
        tavily_data = context.get("tavily_data", "")
        crawleo_data = context.get("crawleo_data", "")
        if not baidu_data:
            baidu_data = "（未获取到百度实时景点数据）"
        if not tavily_data:
            tavily_data = "（未获取到 Tavily 实时景点数据）"
        if not crawleo_data:
            crawleo_data = "（未获取到 Crawleo 实时景点数据）"
        return self.SYSTEM_PROMPT_TEMPLATE.format(
            intent=self.intent.model_dump_json(indent=2),
            baidu_data=baidu_data,
            tavily_data=tavily_data,
            crawleo_data=crawleo_data,
            schema=schema_json,
        )

    def _summarize(self, result: BaseModel) -> str:
        r: AttractionResult = result  # type: ignore[assignment]
        must_see = [a.name_zh for a in r.attractions if a.must_see]
        count = len(r.attractions)
        return f"共{count}个景点，必游：{'、'.join(must_see[:3])}"
