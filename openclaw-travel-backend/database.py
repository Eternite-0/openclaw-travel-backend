from datetime import datetime
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine, select

from config import get_settings


class UserRecord(SQLModel, table=True):
    __tablename__ = "user"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, unique=True)
    username: str = Field(index=True, unique=True)
    email: Optional[str] = Field(default=None, index=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class ItineraryRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: str = Field(index=True, unique=True)
    session_id: str = Field(index=True)
    user_id: str = Field(default="anonymous", index=True)
    created_at: datetime
    itinerary_json: str
    origin_city: str
    dest_city: str
    duration_days: int
    budget_cny: float
    status: str = "done"


class ConversationRecord(SQLModel, table=True):
    __tablename__ = "conversation"
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: str = Field(index=True, unique=True)
    user_id: str = Field(default="anonymous", index=True)
    title: str = "New AI chat"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        connect_args = {}
        if settings.database_url.startswith("sqlite"):
            connect_args = {"check_same_thread": False}
        _engine = create_engine(
            settings.database_url,
            connect_args=connect_args,
            echo=False,
        )
    return _engine


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(get_engine())


def get_session():
    with Session(get_engine()) as session:
        yield session


def get_session_last_result(session_id: str) -> Optional[ItineraryRecord]:
    """Return the most recent completed ItineraryRecord for the given session, or None."""
    with Session(get_engine()) as session:
        statement = (
            select(ItineraryRecord)
            .where(ItineraryRecord.session_id == session_id)
            .where(ItineraryRecord.status == "done")
            .order_by(ItineraryRecord.created_at.desc())  # type: ignore[arg-type]
        )
        return session.exec(statement).first()
