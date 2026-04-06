from __future__ import annotations

import json
import logging
import re
import secrets
import urllib.parse
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlmodel import Session, select

from config import get_settings
from core.security import create_access_token, create_refresh_token, hash_password
from database import UserRecord, get_session

router = APIRouter()
logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"



# ── HTML helpers ──────────────────────────────────────────────────────────────

def _success_html(token_data: dict) -> str:
    payload = json.dumps(token_data)
    return f"""<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>登录成功</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fb">
<div style="text-align:center">
  <div style="font-size:48px;margin-bottom:16px">✅</div>
  <p style="color:#586065;font-size:14px">登录成功，正在返回...</p>
</div>
<script>
  (function() {{
    var data = {payload};
    if (window.opener) {{
      window.opener.postMessage(data, '*');
    }}
    setTimeout(function() {{ window.close(); }}, 800);
  }})();
</script>
</body>
</html>"""


def _error_html(error: str) -> str:
    payload = json.dumps({"type": "oauth_error", "error": error})
    safe_error = error.replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>登录失败</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fb">
<div style="text-align:center">
  <div style="font-size:48px;margin-bottom:16px">❌</div>
  <p style="color:#586065;font-size:14px">{safe_error}</p>
  <button onclick="window.close()" style="margin-top:16px;padding:8px 20px;border:none;background:#575e70;color:white;border-radius:8px;cursor:pointer;font-size:13px">关闭</button>
</div>
<script>
  (function() {{
    var data = {payload};
    if (window.opener) {{
      window.opener.postMessage(data, '*');
    }}
  }})();
</script>
</body>
</html>"""


# ── User helper ───────────────────────────────────────────────────────────────

def _get_or_create_oauth_user(
    db: Session,
    provider: str,
    provider_id: str,
    email: Optional[str],
    display_name: Optional[str],
    avatar_url: Optional[str] = None,
) -> UserRecord:
    """Find existing user by email or provider key, or create a new one."""
    # 1. Match by email (Google users may already have a password account)
    if email:
        user = db.exec(select(UserRecord).where(UserRecord.email == email)).first()
        if user:
            return user

    # 2. Match by deterministic oauth username key
    oauth_key = f"{provider}_{provider_id[:24]}"
    user = db.exec(select(UserRecord).where(UserRecord.username == oauth_key)).first()
    if user:
        return user

    # 3. Create new user
    base = display_name or oauth_key
    clean = re.sub(r"[^\w]", "_", base)[:20].strip("_") or oauth_key
    candidate = clean
    for i in range(1, 30):
        if not db.exec(select(UserRecord).where(UserRecord.username == candidate)).first():
            break
        candidate = f"{clean}_{i}"

    new_user = UserRecord(
        user_id=str(uuid.uuid4()),
        username=candidate,
        email=email,
        avatar_url=avatar_url,
        auth_provider=provider,
        password_hash=hash_password(secrets.token_hex(32)),
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    logger.info("Created OAuth user %s via %s", candidate, provider)
    return new_user


# ── Google OAuth ──────────────────────────────────────────────────────────────

@router.get("/auth/oauth/google")
async def google_login() -> RedirectResponse:
    settings = get_settings()
    if not settings.google_oauth_enabled or not settings.google_client_id:
        return HTMLResponse(_error_html("Google 登录未启用，请联系管理员配置 GOOGLE_CLIENT_ID"), status_code=400)

    redirect_uri = f"{settings.app_base_url}/api/auth/oauth/google/callback"
    params = urllib.parse.urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": secrets.token_urlsafe(16),
        "access_type": "online",
        "prompt": "select_account",
    })
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{params}")


@router.get("/auth/oauth/google/callback", response_class=HTMLResponse)
async def google_callback(
    code: Optional[str] = None,
    error: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_session),
) -> HTMLResponse:
    settings = get_settings()

    if error or not code:
        return HTMLResponse(_error_html(f"Google 授权被拒绝: {error or '未收到授权码'}"))

    redirect_uri = f"{settings.app_base_url}/api/auth/oauth/google/callback"

    async with httpx.AsyncClient(timeout=15) as client:
        # Exchange code → access_token
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        if not token_resp.is_success:
            logger.error("Google token exchange failed: %s", token_resp.text)
            return HTMLResponse(_error_html("Google token 交换失败，请重试"))

        access_token = token_resp.json().get("access_token")

        # Get user profile
        info_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not info_resp.is_success:
            return HTMLResponse(_error_html("获取 Google 用户信息失败"))
        userinfo = info_resp.json()

    email = userinfo.get("email")
    name = userinfo.get("name") or userinfo.get("given_name") or ""
    sub = userinfo.get("sub", "")
    picture = userinfo.get("picture")

    user = _get_or_create_oauth_user(db, "google", sub, email, name, picture)
    # Refresh avatar_url on every login in case Google picture changed
    if picture and user.avatar_url != picture:
        user.avatar_url = picture
        db.add(user)
        db.commit()
        db.refresh(user)

    return HTMLResponse(_success_html({
        "type": "oauth_success",
        "access_token": create_access_token(user.user_id),
        "refresh_token": create_refresh_token(user.user_id),
        "user_id": user.user_id,
        "username": user.username,
    }))


