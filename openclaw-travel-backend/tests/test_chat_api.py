from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


@pytest.mark.asyncio
async def test_post_chat_returns_task_id_immediately():
    """POST /api/chat must return task_id immediately without waiting for pipeline."""

    async def _fake_pipeline(*args, **kwargs):
        await asyncio.sleep(0.01)

    with (
        patch("api.chat.run_travel_pipeline", new=_fake_pipeline),
        patch("api.chat.StatusStore") as MockStore,
    ):
        mock_store_instance = AsyncMock()
        MockStore.return_value = mock_store_instance
        mock_store_instance.init_task = AsyncMock()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            session_id = str(uuid4())
            response = await client.post(
                "/api/chat",
                json={"message": "从广州出发去纽约旅游7天，预算2万人民币", "session_id": session_id},
            )

    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert "session_id" in data
    assert "status_poll_url" in data
    assert "result_url" in data
    assert data["session_id"] == session_id
    assert data["status_poll_url"].startswith("/api/task/")
    assert data["result_url"].startswith("/api/task/")
    assert "result" in data["result_url"]


@pytest.mark.asyncio
async def test_post_chat_generates_unique_task_ids():
    """Each POST /api/chat must return a unique task_id."""
    task_ids: list[str] = []

    async def _fake_pipeline(*args, **kwargs):
        pass

    with (
        patch("api.chat.run_travel_pipeline", new=_fake_pipeline),
        patch("api.chat.StatusStore") as MockStore,
    ):
        mock_store_instance = AsyncMock()
        MockStore.return_value = mock_store_instance
        mock_store_instance.init_task = AsyncMock()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            session_id = str(uuid4())
            for _ in range(3):
                response = await client.post(
                    "/api/chat",
                    json={"message": "旅游请求", "session_id": session_id},
                )
                assert response.status_code == 200
                task_ids.append(response.json()["task_id"])

    assert len(set(task_ids)) == 3, "Each request must get a unique task_id"


@pytest.mark.asyncio
async def test_health_endpoint():
    """GET /api/health must return status ok."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "redis" in data
    assert "version" in data


@pytest.mark.asyncio
async def test_get_task_status_not_found():
    """GET /api/task/{id}/status must return 404 for unknown task."""
    with patch("api.status.StatusStore") as MockStore:
        mock_instance = AsyncMock()
        MockStore.return_value = mock_instance
        mock_instance.get_task = AsyncMock(return_value=None)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/task/nonexistent-task-id/status")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_task_result_not_found():
    """GET /api/task/{id}/result must return 404 when not in DB."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/task/{uuid4()}/result")

    assert response.status_code == 404
