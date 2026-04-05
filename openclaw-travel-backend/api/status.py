from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from core.schemas import TaskStatus
from core.security import get_current_user
from core.status_store import StatusStore
from database import UserRecord

router = APIRouter()


@router.get("/task/{task_id}/status", response_model=TaskStatus)
async def get_task_status(
    task_id: str,
    request: Request,
    current_user: UserRecord = Depends(get_current_user),
) -> TaskStatus:
    redis_client = getattr(request.app.state, "redis", None)
    store = StatusStore(redis_client=redis_client)
    task = await store.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")
    return task
