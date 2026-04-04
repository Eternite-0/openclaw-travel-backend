from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Request
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI

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
    prompt: Optional[str],
    llm_config: dict,
    max_tokens: int = 800,
    temperature: float = 0.3,
    messages: Optional[list[dict[str, Any]]] = None,
) -> Optional[str]:
    """Call the LLM and return the raw content string, or None on failure."""
    settings = get_settings()
    config_list = llm_config.get("config_list", [{}])
    cfg = config_list[0] if config_list else {}
    api_key = cfg.get("api_key", settings.openai_api_key)
    base_url = cfg.get("base_url", settings.openai_base_url).rstrip("/")
    model = cfg.get("model", settings.openai_model)

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=30.0,
        max_retries=0,
    )
    try:
        payload_messages = messages or [{"role": "user", "content": prompt or ""}]
        for attempt in range(2):
            try:
                completion = await client.chat.completions.create(
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    messages=payload_messages,  # type: ignore[arg-type]
                )
                content = completion.choices[0].message.content
                if isinstance(content, str):
                    return content.strip()
                if isinstance(content, list):
                    chunks = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            chunks.append(part.get("text", ""))
                    return "\n".join([c for c in chunks if c]).strip()
                return str(content).strip()
            except APIStatusError as exc:
                status_code = exc.status_code or 0
                if status_code in {429, 502, 503, 504} and attempt == 0:
                    await asyncio.sleep(1.5)
                    continue
                logger.warning("LLM returned status %s", status_code)
                return None
            except (APIConnectionError, APITimeoutError) as exc:
                if attempt == 0:
                    await asyncio.sleep(1.5)
                    continue
                logger.warning("LLM call failed: %s", exc)
                return None
        return None
    except Exception as exc:
        logger.warning("LLM call failed: %s", exc)
        return None
    finally:
        await client.close()


def _format_history(messages: list[dict]) -> str:
    """Format short-term history into a compact conversation block."""
    if not messages:
        return ""
    lines = []
    for m in messages:
        role = "用户" if m.get("role") == "user" else "助手"
        lines.append(f"{role}：{m.get('content', '')}")
    return "\n".join(lines)


def _strip_data_url_prefix(data_base64: str) -> str:
    if data_base64.startswith("data:") and "," in data_base64:
        return data_base64.split(",", 1)[1]
    return data_base64


def _decode_attachment_text(data_base64: str) -> Optional[str]:
    try:
        raw = base64.b64decode(_strip_data_url_prefix(data_base64), validate=False)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def _build_user_message_with_attachments(
    message: str,
    context: str,
    history_section: str,
    attachments: list[Any],
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": (
            "你是一个友好的旅行规划助手。用户正在查看行程，请结合文本与附件内容回答。\n\n"
            f"行程概要：\n{context}{history_section}\n\n"
            f"用户：{message}\n\n"
            "请直接回答，简洁友好，不超过200字。"
        ),
    }]

    for att in attachments[:4]:
        mime_type = (getattr(att, "mime_type", "") or "").lower()
        name = getattr(att, "name", "attachment")
        data_base64 = getattr(att, "data_base64", "") or ""
        if not data_base64:
            continue

        if mime_type.startswith("image/"):
            b64 = _strip_data_url_prefix(data_base64)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{b64}"},
            })
            continue

        decoded = _decode_attachment_text(data_base64)
        if decoded:
            snippet = decoded.strip()[:6000]
            if snippet:
                content.append({
                    "type": "text",
                    "text": f"附件文本（{name}）:\n{snippet}",
                })
            continue

        content.append({
            "type": "text",
            "text": f"收到附件：{name}（{mime_type or 'unknown'}），该文件不是可直接解析的文本。",
        })

    return [{"role": "user", "content": content}]


def _serialize_attachments_for_history(attachments: Optional[list[Any]]) -> list[dict[str, Any]]:
    if not attachments:
        return []
    serialized: list[dict[str, Any]] = []
    for att in attachments[:6]:
        mime_type = getattr(att, "mime_type", "") or "application/octet-stream"
        serialized.append({
            "name": getattr(att, "name", "attachment"),
            "mime_type": mime_type,
            "kind": "image" if mime_type.startswith("image/") else "file",
            "data_base64": _strip_data_url_prefix(getattr(att, "data_base64", "") or ""),
            "size_bytes": getattr(att, "size_bytes", None),
        })
    return serialized


async def _quick_classify_and_reply(
    message: str,
    session_id: str,
    llm_config: dict,
    redis_client,
    task_id: Optional[str] = None,
    frontend_context: Optional[str] = None,
    attachments: Optional[list[Any]] = None,
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
    history_attachments = _serialize_attachments_for_history(attachments)
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
        if attachments:
            messages = _build_user_message_with_attachments(msg, context, history_section, attachments)
            reply = await _call_llm(
                prompt=None,
                llm_config=llm_config,
                max_tokens=500,
                temperature=0.5,
                messages=messages,
            )
        else:
            prompt = (
                "你是一个友好的旅行规划助手。用户正在查看行程，请直接回答他的问题。\n\n"
                "行程概要：\n%s%s\n\n"
                "用户：%s\n\n"
                "请直接回答，简洁友好，不超过200字。"
            ) % (context, history_section, msg)
            reply = await _call_llm(prompt, llm_config, max_tokens=400, temperature=0.5)
        if reply:
            await memory.add_message("user", msg, attachments=history_attachments)
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
            await memory.add_message("user", msg, attachments=history_attachments)
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
    user_attachments: Optional[list[dict[str, Any]]] = None,
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
                user_attachments=user_attachments,
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

    # New chat (no existing task context) should always start full pipeline.
    # Quick/pipeline classification only applies to follow-up messages.
    if body.task_id:
        # ── Quick-reply path: skip pipeline for conversational follow-ups ─────
        quick_reply = await _quick_classify_and_reply(
            message=body.message,
            session_id=session_id,
            llm_config=llm_config,
            redis_client=redis_client,
            task_id=body.task_id,
            frontend_context=body.itinerary_context,
            attachments=body.attachments,
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
    history_attachments = _serialize_attachments_for_history(body.attachments)
    task_id = str(uuid4())
    status_store = StatusStore(redis_client=redis_client)
    await status_store.init_task(task_id, session_id, ALL_AGENT_NAMES)

    asyncio.create_task(
        _background_pipeline(
            user_message=body.message + (
                ("\n\n附件: " + ", ".join(a.name for a in body.attachments[:6]))
                if body.attachments else ""
            ),
            session_id=session_id,
            task_id=task_id,
            status_store=status_store,
            llm_config=llm_config,
            redis_client=redis_client,
            original_task_id=body.task_id,
            user_attachments=history_attachments,
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
