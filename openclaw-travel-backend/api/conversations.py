from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from config import get_settings
from core.memory import MemoryManager
from core.schemas import ConversationSummary, ConversationUpdate, HistoryResponse
from core.security import get_current_user
from database import ConversationRecord, UserRecord, get_session

router = APIRouter()


def _verify_conversation_owner(db: Session, conv_id: str, user_id: str) -> ConversationRecord:
    """Verify the conversation belongs to the user, raise 404 otherwise."""
    record = db.exec(
        select(ConversationRecord)
        .where(ConversationRecord.conversation_id == conv_id)
        .where(ConversationRecord.user_id == user_id)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return record


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[ConversationSummary]:
    records = db.exec(
        select(ConversationRecord)
        .where(ConversationRecord.user_id == current_user.user_id)
        .order_by(ConversationRecord.updated_at.desc())  # type: ignore[arg-type]
    ).all()
    return [
        ConversationSummary(
            conversation_id=r.conversation_id,
            title=r.title,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in records
    ]


@router.post("/conversations", response_model=ConversationSummary)
async def create_conversation(
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ConversationSummary:
    conv_id = str(uuid.uuid4())
    now = datetime.utcnow()
    record = ConversationRecord(
        conversation_id=conv_id,
        user_id=current_user.user_id,
        title="New AI chat",
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ConversationSummary(
        conversation_id=record.conversation_id,
        title=record.title,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.get("/conversations/{conv_id}/messages", response_model=HistoryResponse)
async def get_conversation_messages(
    conv_id: str,
    request: Request,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> HistoryResponse:
    _verify_conversation_owner(db, conv_id, current_user.user_id)
    redis_client = getattr(request.app.state, "redis", None)
    memory = MemoryManager(
        session_id=conv_id,
        max_short_term=get_settings().max_short_term_memory,
        redis_client=redis_client,
    )
    messages = await memory.get_full_history()
    return HistoryResponse(session_id=conv_id, messages=messages)


@router.patch("/conversations/{conv_id}", response_model=ConversationSummary)
async def update_conversation(
    conv_id: str,
    body: ConversationUpdate,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ConversationSummary:
    record = db.exec(
        select(ConversationRecord)
        .where(ConversationRecord.conversation_id == conv_id)
        .where(ConversationRecord.user_id == current_user.user_id)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    record.title = body.title
    record.updated_at = datetime.utcnow()
    db.add(record)
    db.commit()
    db.refresh(record)
    return ConversationSummary(
        conversation_id=record.conversation_id,
        title=record.title,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.delete("/conversations/{conv_id}")
async def delete_conversation(
    conv_id: str,
    request: Request,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict:
    record = db.exec(
        select(ConversationRecord)
        .where(ConversationRecord.conversation_id == conv_id)
        .where(ConversationRecord.user_id == current_user.user_id)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(record)
    db.commit()
    # Also clear Redis memory for this session
    redis_client = getattr(request.app.state, "redis", None)
    memory = MemoryManager(
        session_id=conv_id,
        max_short_term=get_settings().max_short_term_memory,
        redis_client=redis_client,
    )
    await memory.clear()
    return {"ok": True}


@router.post("/conversations/{conv_id}/touch")
async def touch_conversation(
    conv_id: str,
    current_user: UserRecord = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict:
    """Update the updated_at timestamp when a new message is sent."""
    record = db.exec(
        select(ConversationRecord)
        .where(ConversationRecord.conversation_id == conv_id)
        .where(ConversationRecord.user_id == current_user.user_id)
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    record.updated_at = datetime.utcnow()
    db.add(record)
    db.commit()
    return {"ok": True}
