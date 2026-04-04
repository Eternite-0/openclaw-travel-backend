from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from core.schemas import AgentStatus, TaskStatus

logger = logging.getLogger(__name__)

_AGENT_DISPLAY_NAMES: dict[str, str] = {
    "intent_parser": "意图解析",
    "currency_agent": "汇率分析",
    "budget_agent": "预算规划",
    "visa_agent": "签证/入境信息",
    "flight_agent": "航班查询",
    "hotel_agent": "酒店推荐",
    "attraction_agent": "景点规划",
    "weather_agent": "天气预报",
    "itinerary_agent": "行程生成",
}

_FALLBACK_STORE: dict[str, dict] = {}


class StatusStore:
    """
    Agents call update_agent() to push live status into Redis.
    Frontend polls GET /api/task/{task_id}/status every 1-2 seconds.
    """

    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client
        self._ttl = 7200  # 2 hours

    def _task_key(self, task_id: str) -> str:
        return f"task:{task_id}"

    async def _load(self, task_id: str) -> dict | None:
        key = self._task_key(task_id)
        if self._redis is not None:
            try:
                raw = await self._redis.get(key)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                logger.warning("Redis _load failed: %s", exc)
        return _FALLBACK_STORE.get(key)

    async def _save(self, task_id: str, data: dict) -> None:
        key = self._task_key(task_id)
        payload = json.dumps(data, ensure_ascii=False, default=str)
        # Keep a local shadow copy even when Redis is healthy, so transient
        # Redis read failures do not make us lose in-flight status updates.
        _FALLBACK_STORE[key] = data
        if self._redis is not None:
            try:
                await self._redis.set(key, payload, ex=self._ttl)
                return
            except Exception as exc:
                logger.warning("Redis _save failed: %s", exc)
        _FALLBACK_STORE[key] = data

    async def init_task(
        self,
        task_id: str,
        session_id: str,
        agent_names: list[str],
    ) -> None:
        now = datetime.utcnow().isoformat()
        agents = [
            {
                "agent_name": name,
                "display_name": _AGENT_DISPLAY_NAMES.get(name, name),
                "status": "pending",
                "started_at": None,
                "finished_at": None,
                "message": "等待中...",
                "result_summary": "",
            }
            for name in agent_names
        ]
        data = {
            "task_id": task_id,
            "session_id": session_id,
            # Mark as running immediately so frontend can render active state
            # before the first specialist agent heartbeat arrives.
            "overall_status": "running",
            "progress_pct": 0,
            "agents": agents,
            "created_at": now,
            "updated_at": now,
        }
        await self._save(task_id, data)

    async def remove_agent(self, task_id: str, agent_name: str) -> None:
        """Remove an agent from the task status so it won't be shown in frontend."""
        data = await self._load(task_id)
        if data is None:
            return
        data["agents"] = [a for a in data["agents"] if a["agent_name"] != agent_name]
        # Recalculate progress
        total = len(data["agents"])
        done_count = sum(1 for a in data["agents"] if a["status"] == "done")
        data["progress_pct"] = int((done_count / total) * 100) if total else 0
        data["updated_at"] = datetime.utcnow().isoformat()
        await self._save(task_id, data)

    async def update_agent(
        self,
        task_id: str,
        agent_name: str,
        status: str,
        message: str = "",
        result_summary: str = "",
    ) -> None:
        data = await self._load(task_id)
        if data is None:
            logger.error("update_agent: task %s not found", task_id)
            return

        now = datetime.utcnow().isoformat()
        for agent in data["agents"]:
            if agent["agent_name"] == agent_name:
                agent["status"] = status
                agent["message"] = message
                agent["result_summary"] = result_summary
                if status == "running" and agent["started_at"] is None:
                    agent["started_at"] = now
                if status in ("done", "error"):
                    agent["finished_at"] = now
                break

        total = len(data["agents"])
        done_count = sum(1 for a in data["agents"] if a["status"] == "done")
        data["progress_pct"] = int((done_count / total) * 100) if total else 0
        data["updated_at"] = now

        if data["overall_status"] == "pending":
            data["overall_status"] = "running"

        await self._save(task_id, data)

    async def get_task(self, task_id: str) -> TaskStatus | None:
        data = await self._load(task_id)
        if data is None:
            return None
        agents = [AgentStatus(**a) for a in data["agents"]]
        return TaskStatus(
            task_id=data["task_id"],
            session_id=data["session_id"],
            overall_status=data["overall_status"],
            progress_pct=data["progress_pct"],
            agents=agents,
            created_at=data["created_at"],
            updated_at=data["updated_at"],
        )

    async def set_overall_status(self, task_id: str, status: str) -> None:
        data = await self._load(task_id)
        if data is None:
            return
        data["overall_status"] = status
        data["updated_at"] = datetime.utcnow().isoformat()
        if status == "done":
            data["progress_pct"] = 100
        await self._save(task_id, data)
