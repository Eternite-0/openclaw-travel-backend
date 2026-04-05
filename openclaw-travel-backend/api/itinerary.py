from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from core.schemas import FinalItinerary, ItinerarySummary
from core.security import get_current_user
from database import ItineraryRecord, UserRecord, get_session

router = APIRouter()


@router.get("/tasks", response_model=list[ItinerarySummary])
async def list_tasks(
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
    limit: int = 50,
) -> list[ItinerarySummary]:
    statement = (
        select(ItineraryRecord)
        .where(ItineraryRecord.user_id == current_user.user_id)
        .order_by(ItineraryRecord.created_at.desc())  # type: ignore[arg-type]
        .limit(limit)
    )
    records = db.exec(statement).all()
    return [
        ItinerarySummary(
            task_id=r.task_id,
            session_id=r.session_id,
            created_at=r.created_at,
            origin_city=r.origin_city,
            dest_city=r.dest_city,
            duration_days=r.duration_days,
            budget_cny=r.budget_cny,
            status=r.status,
        )
        for r in records
    ]


@router.delete("/task/{task_id}")
async def delete_task(
    task_id: str,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict:
    statement = (
        select(ItineraryRecord)
        .where(ItineraryRecord.task_id == task_id)
        .where(ItineraryRecord.user_id == current_user.user_id)
    )
    record = db.exec(statement).first()
    if record is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")
    db.delete(record)
    db.commit()
    return {"detail": "deleted"}


@router.get("/task/{task_id}/result", response_model=FinalItinerary)
async def get_task_result(
    task_id: str,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> FinalItinerary:
    statement = (
        select(ItineraryRecord)
        .where(ItineraryRecord.task_id == task_id)
        .where(ItineraryRecord.user_id == current_user.user_id)
    )
    record = db.exec(statement).first()
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"Result for task '{task_id}' not found. The task may still be running.",
        )
    try:
        data = json.loads(record.itinerary_json)
        return FinalItinerary.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deserialize itinerary: {exc}",
        ) from exc
