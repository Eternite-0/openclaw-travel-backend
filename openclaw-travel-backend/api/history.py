from __future__ import annotations

from fastapi import APIRouter, Request

from core.memory import MemoryManager
from core.schemas import ClearResponse, HistoryResponse
from config import get_settings

router = APIRouter()


@router.get("/sessions/{session_id}/history", response_model=HistoryResponse)
async def get_session_history(session_id: str, request: Request) -> HistoryResponse:
    redis_client = getattr(request.app.state, "redis", None)
    memory = MemoryManager(
        session_id=session_id,
        max_short_term=get_settings().max_short_term_memory,
        redis_client=redis_client,
    )
    messages = await memory.get_full_history()
    return HistoryResponse(session_id=session_id, messages=messages)


@router.post("/sessions/{session_id}/clear", response_model=ClearResponse)
async def clear_session_history(session_id: str, request: Request) -> ClearResponse:
    redis_client = getattr(request.app.state, "redis", None)
    memory = MemoryManager(
        session_id=session_id,
        max_short_term=get_settings().max_short_term_memory,
        redis_client=redis_client,
    )
    await memory.clear()
    return ClearResponse(cleared=True)
