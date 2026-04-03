from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from agents.orchestrator import ALL_AGENT_NAMES, run_travel_pipeline
from config import get_settings
from core.memory import MemoryManager
from core.schemas import ChatRequest, ChatResponse
from core.status_store import StatusStore
from database import get_session

router = APIRouter()
logger = logging.getLogger(__name__)


async def _background_pipeline(
    user_message: str,
    session_id: str,
    task_id: str,
    status_store: StatusStore,
    llm_config: dict,
    redis_client,
) -> None:
    import traceback
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
        tb = traceback.format_exc()
        err_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("[task:%s] Pipeline failed: %s", task_id, exc)
        await status_store.update_agent(task_id, "intent_parser", "error", message=err_msg[:300])
        await status_store.set_overall_status(task_id, "error")


@router.post("/chat", response_model=ChatResponse)
async def post_chat(
    body: ChatRequest,
    request: Request,
) -> ChatResponse:
    task_id = str(uuid4())
    session_id = body.session_id or str(uuid4())

    redis_client = getattr(request.app.state, "redis", None)
    status_store = StatusStore(redis_client=redis_client)

    await status_store.init_task(task_id, session_id, ALL_AGENT_NAMES)

    settings = get_settings()
    llm_config = settings.llm_config

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
    )
