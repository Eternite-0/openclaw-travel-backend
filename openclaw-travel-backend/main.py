from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import chat, conversations, history, itinerary, route, status
from config import get_settings
from core.schemas import HealthResponse
from database import create_db_and_tables
from services import baidu_search_service, currency_service, search_cache

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )

    create_db_and_tables()
    logger.info("SQLite tables created/verified")

    redis_client = None
    if settings.redis_enabled:
        try:
            import redis.asyncio as aioredis

            redis_client = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await redis_client.ping()
            app.state.redis = redis_client
            currency_service.set_redis_client(redis_client)
            search_cache.set_redis_client(redis_client)
            baidu_search_service.set_redis_client(redis_client)
            logger.info("Redis connected: %s", settings.redis_url)
        except Exception as exc:
            logger.warning("Redis unavailable (%s) — using in-memory fallback", exc)
            app.state.redis = None
    else:
        app.state.redis = None
        logger.info("Redis disabled — using in-memory fallback")

    yield

    if redis_client is not None:
        await redis_client.aclose()
        logger.info("Redis connection closed")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="OpenClaw Smart Travel Assistant",
        description="智慧旅行助手 — Multi-agent travel planning API powered by AutoGen",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s → %d (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc)},
        )

    app.include_router(chat.router, prefix="/api", tags=["Chat"])
    app.include_router(status.router, prefix="/api", tags=["Task Status"])
    app.include_router(itinerary.router, prefix="/api", tags=["Itinerary"])
    app.include_router(history.router, prefix="/api", tags=["Session History"])
    app.include_router(conversations.router, prefix="/api", tags=["Conversations"])
    app.include_router(route.router, prefix="/api", tags=["Route"])

    @app.get("/api/health", response_model=HealthResponse, tags=["Health"])
    async def health_check(request: Request) -> HealthResponse:
        redis_status = "disabled"
        redis_client = getattr(request.app.state, "redis", None)
        if redis_client is not None:
            try:
                await redis_client.ping()
                redis_status = "connected"
            except Exception:
                redis_status = "error"
        elif settings.redis_enabled:
            redis_status = "error"

        return HealthResponse(
            status="ok",
            redis=redis_status,
            version="1.0.0",
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
