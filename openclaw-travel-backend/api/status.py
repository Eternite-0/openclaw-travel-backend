from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from core.schemas import TaskStatus
from core.status_store import StatusStore

router = APIRouter()


@router.get("/task/{task_id}/status", response_model=TaskStatus)
async def get_task_status(task_id: str, request: Request) -> TaskStatus:
    redis_client = getattr(request.app.state, "redis", None)
    store = StatusStore(redis_client=redis_client)
    task = await store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")
    return task
