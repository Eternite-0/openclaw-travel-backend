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

_QUICK_CLASSIFIER_PROMPT = """\
你是一个旅行规划助手的意图分类器。
用户正在查看一份已生成的旅行行程，发来了一条新消息。

你需要判断这条消息属于哪种类型：
- "quick"：用户只是在问关于现有行程的问题、寻求解释、想了解更多细节，或进行简单的闲聊。这类问题可以直接回答，不需要重新规划行程。例如："第二天去哪里？"、"需要带什么衣服？"、"这个酒店怎么样？"、"帮我总结一下行程"、"谢谢"
- "pipeline"：用户想要修改行程、更换目的地、调整预算、更换酒店/航班，或者开始一个全新的行程规划。这类请求需要重新运行规划系统。例如："帮我换一个便宜的酒店"、"把行程改成7天"、"我想去上海"、"预算增加到20000"

已有行程摘要（可能为空）：
{context}

用户消息：{message}

请用以下JSON格式回复（不加Markdown代码块）：
{{"type": "quick", "reply": "直接回答用户问题的内容（仅当type为quick时填写，否则留空字符串）"}}
或
{{"type": "pipeline", "reply": ""}}
"""


async def _quick_classify_and_reply(
    message: str,
    session_id: str,
    llm_config: dict,
    redis_client,
) -> Optional[str]:
    """
    Returns a direct reply string if the message is conversational/informational.
    Returns None if the message requires the full planning pipeline.
    """
    settings = get_settings()
    config_list = llm_config.get("config_list", [{}])
    cfg = config_list[0] if config_list else {}
    api_key = cfg.get("api_key", settings.openai_api_key)
    base_url = cfg.get("base_url", settings.openai_base_url).rstrip("/")
    model = cfg.get("model", settings.openai_model)

    prev_record = get_session_last_result(session_id)
    if not prev_record:
        return None

    context = ""
    if prev_record:
        try:
            import json as _json
            data = _json.loads(prev_record.itinerary_json)
            intent = data.get("intent", {})
            highlights = "、".join(data.get("highlights", [])[:3])
            context = (
                f"目的地: {intent.get('dest_city', '')} | "
                f"天数: {intent.get('duration_days', '')}天 | "
                f"预算: ¥{intent.get('budget_cny', '')} | "
                f"亮点: {highlights}"
            )
        except Exception:
            context = ""

    prompt = _QUICK_CLASSIFIER_PROMPT.format(context=context or "无", message=message)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "temperature": 0.1,
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        if resp.status_code != 200:
            logger.warning("Quick classifier LLM error %s", resp.status_code)
            return None

        import json as _json
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            lines = content.splitlines()
            content = "\n".join(lines[1:-1]).strip()
        parsed = _json.loads(content)
        if parsed.get("type") == "quick" and parsed.get("reply"):
            return parsed["reply"]
        return None
    except Exception as exc:
        logger.warning("Quick classifier failed (%s), falling back to pipeline", exc)
        return None


async def _background_pipeline(
    user_message: str,
    session_id: str,
    task_id: str,
    status_store: StatusStore,
    llm_config: dict,
    redis_client,
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
