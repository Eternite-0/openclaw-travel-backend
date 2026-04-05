from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import UserRecord, get_session

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request / Response schemas ───────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    email: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    username: str


class UserProfile(BaseModel):
    user_id: str
    username: str
    email: Optional[str]
    created_at: str
    is_active: bool


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.post("/auth/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest,
    db: Session = Depends(get_session),
) -> TokenResponse:
    """注册新用户，成功后直接返回 token。"""
    existing = db.exec(
        select(UserRecord).where(UserRecord.username == body.username)
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名已被注册",
        )

    if body.email:
        email_exists = db.exec(
            select(UserRecord).where(UserRecord.email == body.email)
        ).first()
        if email_exists is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该邮箱已被注册",
            )

    user_id = str(uuid.uuid4())
    user = UserRecord(
        user_id=user_id,
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info("New user registered: %s (%s)", body.username, user_id)

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
        user_id=user_id,
        username=user.username,
    )


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: Session = Depends(get_session),
) -> TokenResponse:
    """用户名 + 密码登录。"""
    user = db.exec(
        select(UserRecord).where(UserRecord.username == body.username)
    ).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用",
        )

    logger.info("User logged in: %s", user.username)

    return TokenResponse(
        access_token=create_access_token(user.user_id),
        refresh_token=create_refresh_token(user.user_id),
        user_id=user.user_id,
        username=user.username,
    )


@router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_token(
    body: RefreshRequest,
    db: Session = Depends(get_session),
) -> TokenResponse:
    """使用 refresh_token 获取新的 access_token + refresh_token。"""
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="refresh_token 无效或已过期",
        )

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌类型错误，请使用 refresh_token",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌中缺少用户标识",
        )

    user = db.exec(
        select(UserRecord).where(UserRecord.user_id == user_id)
    ).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被禁用",
        )

    return TokenResponse(
        access_token=create_access_token(user.user_id),
        refresh_token=create_refresh_token(user.user_id),
        user_id=user.user_id,
        username=user.username,
    )


@router.get("/auth/me", response_model=UserProfile)
async def get_me(
    current_user: UserRecord = Depends(get_current_user),
) -> UserProfile:
    """获取当前登录用户信息。"""
    return UserProfile(
        user_id=current_user.user_id,
        username=current_user.username,
        email=current_user.email,
        created_at=current_user.created_at.isoformat(),
        is_active=current_user.is_active,
    )
