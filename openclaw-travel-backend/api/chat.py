from __future__ import annotations

import asyncio
import logging
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Request

from agents.orchestrator import ALL_AGENT_NAMES, run_travel_pipeline
from config import get_settings
from core.memory import MemoryManager
from core.schemas import ChatRequest, ChatResponse
from core.status_store import StatusStore
from database import get_session_last_result

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Pipeline keyword detection ───────────────────────────────────────────────
# Only messages containing these keywords can EVER trigger the pipeline.
# Everything else is guaranteed quick-reply.
_PIPELINE_KEYWORDS = [
    "修改", "更换", "调整", "重新规划", "换一个", "改成", "增加到", "改去",
    "换成", "替换", "取消", "删掉", "去掉", "加上", "添加", "新增",
    "改为", "改到", "延长", "缩短", "改天", "换个", "换家", "换酒店",
    "换航班", "换飞机", "重新", "重做", "再规划", "规划一个", "帮我规划",
]


def _has_pipeline_intent(message: str) -> bool:
    """Check if message contains any modification keywords."""
    return any(kw in message for kw in _PIPELINE_KEYWORDS)


def _build_classifier_context(itinerary_json: str) -> str:
    """Parse raw itinerary JSON into a compact structured summary for the classifier."""
    import json as _json
    try:
        data = _json.loads(itinerary_json)
    except Exception:
        return itinerary_json[:3000]

    intent = data.get("intent", {})
    lines = [
        "目的地: %s(%s)" % (intent.get("dest_city", "?"), intent.get("dest_country", "?")),
        "出发地: %s" % intent.get("origin_city", "?"),
        "日期: %s ~ %s，共%s天" % (intent.get("departure_date", "?"), intent.get("return_date", "?"), intent.get("duration_days", "?")),
        "预算: ¥%s | 风格: %s" % (intent.get("budget_cny", "?"), intent.get("travel_style", "?")),
        "人数: %s" % intent.get("travelers", 1),
    ]

    flight = data.get("recommended_flight", {})
    if flight:
        lines.append("推荐航班: %s %s, ¥%s" % (flight.get("airline", ""), flight.get("flight_number", ""), flight.get("price_cny", "?")))

    hotel = data.get("recommended_hotel", {})
    if hotel:
        lines.append("推荐酒店: %s, %s, ¥%s/晚" % (hotel.get("name", ""), hotel.get("area", ""), hotel.get("price_per_night_cny", "?")))

    weather = data.get("weather", {})
    if weather.get("overall_summary"):
        lines.append("天气概况: %s" % weather["overall_summary"])
    for dw in weather.get("daily", []):
        lines.append("  %s: %s, %s~%s°C, %s" % (
            dw.get("date", "?"), dw.get("condition", "?"),
            dw.get("temp_low_c", "?"), dw.get("temp_high_c", "?"),
            dw.get("clothing_advice", ""),
        ))

    for day in data.get("days", []):
        acts = ", ".join(a.get("activity", "") for a in day.get("activities", [])[:5])
        meals = day.get("meals", {})
        meal_parts = ["%s:%s" % (k, v) for k, v in meals.items()] if meals else []
        meal_str = " | ".join(meal_parts)
        line = "第%s天 [%s]: %s" % (day.get("day_number", "?"), day.get("theme", ""), acts)
        if meal_str:
            line += " (餐: %s)" % meal_str
        lines.append(line)
        if day.get("transport_notes"):
            lines.append("  交通: %s" % day["transport_notes"])

    highlights = data.get("highlights", [])
    if highlights:
        lines.append("亮点: %s" % "、".join(highlights[:5]))
    tips = data.get("travel_tips", [])
    if tips:
        lines.append("贴士: %s" % "、".join(tips[:5]))

    budget = data.get("budget", {})
    if budget:
        lines.append("预算分配: 机票¥%s, 住宿¥%s, 餐饮¥%s, 交通¥%s, 景点¥%s" % (
            budget.get("flight_cny", "?"), budget.get("accommodation_cny", "?"),
            budget.get("food_cny", "?"), budget.get("transport_cny", "?"),
            budget.get("attractions_cny", "?"),
        ))

    return "\n".join(lines)


def _load_itinerary_context(
    task_id: Optional[str],
    session_id: str,
    frontend_context: Optional[str] = None,
) -> str:
    """Best-effort load of itinerary context.
    Priority: DB by task_id → DB by session_id → frontend_context → '无'
    """
    prev_record = None
    try:
        if task_id:
            from database import get_engine, ItineraryRecord
            from sqlmodel import Session as DBSession, select
            with DBSession(get_engine()) as db:
                prev_record = db.exec(
                    select(ItineraryRecord).where(ItineraryRecord.task_id == task_id)
                ).first()
        if not prev_record:
            prev_record = get_session_last_result(session_id)
    except Exception as exc:
        logger.warning("Failed to load itinerary context: %s", exc)

    if prev_record and prev_record.itinerary_json:
        return _build_classifier_context(prev_record.itinerary_json)

    # Fallback: use context sent from the frontend (for demo / no-DB scenarios)
    if frontend_context:
        logger.info("[context] Using frontend-provided itinerary context")
        return frontend_context
    return "无"


_CLASSIFIER_PROMPT = """\
你是一个旅行规划助手。用户正在查看一份已生成的旅行行程，发来了一条新消息。

**规则**：
1. 绝大多数消息都应该直接回答（type=quick），包括：问好、闲聊、提问、查询细节、要求解释、天气相关、求建议等。
2. 只有当用户**明确要求修改行程内容**时才返回 type=pipeline，比如："帮我换酒店"、"改成7天"、"第二天改去故宫"、"预算改为2万"。
3. 如果不确定，一律返回 quick。

已有行程概要：
{context}

用户消息：{message}

以JSON格式回复（不要Markdown代码块）：
{{"type": "quick", "reply": "你的回答内容"}}
或
{{"type": "pipeline", "reply": ""}}
"""


async def _call_llm(
    prompt: str,
    llm_config: dict,
    max_tokens: int = 800,
    temperature: float = 0.3,
) -> Optional[str]:
    """Call the LLM and return the raw content string, or None on failure."""
    settings = get_settings()
    config_list = llm_config.get("config_list", [{}])
    cfg = config_list[0] if config_list else {}
    api_key = cfg.get("api_key", settings.openai_api_key)
    base_url = cfg.get("base_url", settings.openai_base_url).rstrip("/")
    model = cfg.get("model", settings.openai_model)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "%s/chat/completions" % base_url,
                headers={
                    "Authorization": "Bearer %s" % api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        if resp.status_code != 200:
            logger.warning("LLM returned status %s", resp.status_code)
            return None
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("LLM call failed: %s", exc)
        return None


def _format_history(messages: list[dict]) -> str:
    """Format short-term history into a compact conversation block."""
    if not messages:
        return ""
    lines = []
    for m in messages:
        role = "用户" if m.get("role") == "user" else "助手"
        lines.append(f"{role}：{m.get('content', '')}")
    return "\n".join(lines)


async def _quick_classify_and_reply(
    message: str,
    session_id: str,
    llm_config: dict,
    redis_client,
    task_id: Optional[str] = None,
    frontend_context: Optional[str] = None,
) -> Optional[str]:
    """
    Redesigned chain:
      1. Keyword pre-filter: if NO pipeline keywords → guaranteed quick (call LLM for reply only)
      2. If HAS pipeline keywords → call LLM classifier to decide
      3. Only return None (pipeline) when LLM explicitly says "pipeline"
      4. Any failure at any step → safe quick reply (NEVER pipeline)
    """
    import json as _json

    msg = message.strip()
    context = _load_itinerary_context(task_id, session_id, frontend_context=frontend_context)

    # ── Load short-term conversation history ────────────────────────────
    memory = MemoryManager(
        session_id=session_id,
        max_short_term=get_settings().max_short_term_memory,
        redis_client=redis_client,
    )
    history = await memory.get_short_term()
    history_block = _format_history(history)
    history_section = (
        f"\n\n近期对话记录：\n{history_block}" if history_block else ""
    )

    # ── Step 1: Keyword pre-filter ──────────────────────────────────────
    if not _has_pipeline_intent(msg):
        # No modification keywords → guaranteed quick reply.
        # Call LLM just to generate a helpful answer (no classification needed).
        logger.info("[classify] No pipeline keywords in '%s' – quick path", msg[:60])
        prompt = (
            "你是一个友好的旅行规划助手。用户正在查看行程，请直接回答他的问题。\n\n"
            "行程概要：\n%s%s\n\n"
            "用户：%s\n\n"
            "请直接回答，简洁友好，不超过200字。"
        ) % (context, history_section, msg)
        reply = await _call_llm(prompt, llm_config, max_tokens=400, temperature=0.5)
        if reply:
            await memory.add_message("user", msg)
            await memory.add_message("assistant", reply)
            return reply
        return "你好！有什么关于行程的问题可以问我哦 😊"

    # ── Step 2: Has pipeline keywords → use classifier ──────────────────
    logger.info("[classify] Pipeline keywords detected in '%s' – running classifier", msg[:60])
    prompt = _CLASSIFIER_PROMPT.format(context=context + history_section, message=msg)
    raw = await _call_llm(prompt, llm_config, max_tokens=800, temperature=0.1)

    if not raw:
        logger.warning("[classify] LLM failed – defaulting to quick reply")
        return "抱歉，我暂时无法处理这个请求，请稍后再试。"

    logger.info("[classify] Raw LLM response: %s", raw[:300])

    # Parse response
    try:
        content = raw
        if content.startswith("```"):
            lines = content.splitlines()
            content = "\n".join(lines[1:-1]).strip()
        parsed = _json.loads(content)

        if parsed.get("type") == "pipeline":
            logger.info("[classify] → pipeline for: %s", msg[:80])
            return None  # Only place we return None

        if parsed.get("reply"):
            reply = parsed["reply"]
            await memory.add_message("user", msg)
            await memory.add_message("assistant", reply)
            return reply
        return "好的，让我看看能怎么帮你。"
    except Exception as exc:
        logger.warning("[classify] Parse failed (%s) – defaulting to quick", exc)
        return "抱歉，我没太理解您的意思，能再说清楚一点吗？"


async def _background_pipeline(
    user_message: str,
    session_id: str,
    task_id: str,
    status_store: StatusStore,
    llm_config: dict,
    redis_client,
    original_task_id: Optional[str] = None,
) -> None:
    try:
        memory = MemoryManager(
            session_id=session_id,
            max_short_term=get_settings().max_short_term_memory,
            redis_client=redis_client,
        )
        from database import get_engine
        from sqlmodel import Session as DBSession

        with DBSession(get_engine()) as db_session:
            await run_travel_pipeline(
                user_message=user_message,
                session_id=session_id,
                task_id=task_id,
                memory=memory,
                status_store=status_store,
                llm_config=llm_config,
                db_session=db_session,
                original_task_id=original_task_id,
            )
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("[task:%s] Pipeline failed: %s", task_id, exc)
        await status_store.update_agent(task_id, "intent_parser", "error", message=err_msg[:300])
        await status_store.set_overall_status(task_id, "error")


@router.post("/chat", response_model=ChatResponse)
async def post_chat(
    body: ChatRequest,
    request: Request,
) -> ChatResponse:
    session_id = body.session_id or str(uuid4())
    redis_client = getattr(request.app.state, "redis", None)
    settings = get_settings()
    llm_config = settings.llm_config

    # ── Quick-reply path: skip pipeline for conversational messages ──────
    quick_reply = await _quick_classify_and_reply(
        message=body.message,
        session_id=session_id,
        llm_config=llm_config,
        redis_client=redis_client,
        task_id=body.task_id,
        frontend_context=body.itinerary_context,
    )
    if quick_reply is not None:
        logger.info("[session:%s] Quick reply returned (no pipeline)", session_id)
        return ChatResponse(
            session_id=session_id,
            message=quick_reply,
            response_type="quick",
            quick_reply=quick_reply,
        )

    # ── Pipeline path: full multi-agent planning ─────────────────────────
    task_id = str(uuid4())
    status_store = StatusStore(redis_client=redis_client)
    await status_store.init_task(task_id, session_id, ALL_AGENT_NAMES)

    asyncio.create_task(
        _background_pipeline(
            user_message=body.message,
            session_id=session_id,
            task_id=task_id,
            status_store=status_store,
            llm_config=llm_config,
            redis_client=redis_client,
            original_task_id=body.task_id,
        )
    )

    return ChatResponse(
        task_id=task_id,
        session_id=session_id,
        message="收到！正在为您规划行程，请稍候...",
        status_poll_url=f"/api/task/{task_id}/status",
        result_url=f"/api/task/{task_id}/result",
        response_type="pipeline",
    )
