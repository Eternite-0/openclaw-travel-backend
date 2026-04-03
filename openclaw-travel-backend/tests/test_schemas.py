from __future__ import annotations

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from core.schemas import (
    AgentStatus,
    AttractionResult,
    BudgetBreakdown,
    CurrencyInfo,
    FinalItinerary,
    FlightOption,
    FlightResult,
    HotelOption,
    HotelResult,
    ItineraryActivity,
    ItineraryDay,
    TaskStatus,
    TravelIntent,
    WeatherResult,
    DayWeather,
    Attraction,
)


def _base_intent() -> dict:
    return {
        "origin_city": "广州",
        "origin_country": "中国",
        "dest_city": "纽约",
        "dest_country": "美国",
        "dest_country_code": "US",
        "departure_date": "2025-08-01",
        "return_date": "2025-08-08",
        "duration_days": 7,
        "budget_cny": 20000.0,
        "travelers": 1,
        "travel_style": "standard",
        "special_requests": [],
    }


class TestTravelIntent:
    def test_valid_intent_parses_correctly(self):
        intent = TravelIntent(**_base_intent())
        assert intent.origin_city == "广州"
        assert intent.dest_country_code == "US"
        assert intent.duration_days == 7
        assert intent.budget_cny == 20000.0

    def test_default_travel_style_is_standard(self):
        data = _base_intent()
        del data["travel_style"]
        intent = TravelIntent(**data)
        assert intent.travel_style == "standard"

    def test_invalid_travel_style_raises(self):
        data = _base_intent()
        data["travel_style"] = "ultra-luxury"
        with pytest.raises(ValidationError):
            TravelIntent(**data)

    def test_default_travelers_is_one(self):
        data = _base_intent()
        del data["travelers"]
        intent = TravelIntent(**data)
        assert intent.travelers == 1

    def test_special_requests_defaults_to_empty_list(self):
        data = _base_intent()
        del data["special_requests"]
        intent = TravelIntent(**data)
        assert intent.special_requests == []


class TestTaskStatus:
    def _make_agent_status(self, name: str, status: str) -> AgentStatus:
        return AgentStatus(
            agent_name=name,
            display_name=f"Agent {name}",
            status=status,
            message="",
            result_summary="",
        )

    def test_task_status_valid(self):
        ts = TaskStatus(
            task_id="task-001",
            session_id="sess-001",
            overall_status="running",
            progress_pct=50,
            agents=[
                self._make_agent_status("intent_parser", "done"),
                self._make_agent_status("currency_agent", "running"),
            ],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        assert ts.progress_pct == 50
        assert len(ts.agents) == 2

    def test_progress_pct_cannot_exceed_100(self):
        with pytest.raises(ValidationError):
            TaskStatus(
                task_id="task-002",
                session_id="sess-002",
                overall_status="done",
                progress_pct=101,
                agents=[],
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )

    def test_progress_pct_cannot_be_negative(self):
        with pytest.raises(ValidationError):
            TaskStatus(
                task_id="task-003",
                session_id="sess-003",
                overall_status="pending",
                progress_pct=-1,
                agents=[],
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )

    def test_agent_status_optional_timestamps(self):
        agent = AgentStatus(
            agent_name="flight_agent",
            display_name="✈️ 航班查询",
            status="pending",
        )
        assert agent.started_at is None
        assert agent.finished_at is None


class TestStatusStoreProgressCalc:
    """Test StatusStore.update_agent() progress_pct recalculation logic."""

    @pytest.mark.asyncio
    async def test_progress_pct_updates_correctly(self):
        from core.status_store import StatusStore

        store = StatusStore(redis_client=None)
        task_id = "test-progress-task"
        session_id = "test-session"
        agent_names = [
            "intent_parser",
            "currency_agent",
            "budget_agent",
            "flight_agent",
        ]

        await store.init_task(task_id, session_id, agent_names)

        task = await store.get_task(task_id)
        assert task is not None
        assert task.progress_pct == 0
        assert task.overall_status == "pending"

        await store.update_agent(task_id, "intent_parser", "done", "完成")
        task = await store.get_task(task_id)
        assert task.progress_pct == 25

        await store.update_agent(task_id, "currency_agent", "done", "完成")
        task = await store.get_task(task_id)
        assert task.progress_pct == 50

        await store.update_agent(task_id, "budget_agent", "done", "完成")
        await store.update_agent(task_id, "flight_agent", "done", "完成")
        task = await store.get_task(task_id)
        assert task.progress_pct == 100

    @pytest.mark.asyncio
    async def test_overall_status_switches_to_running(self):
        from core.status_store import StatusStore

        store = StatusStore(redis_client=None)
        task_id = "test-status-switch"
        await store.init_task(task_id, "sess", ["intent_parser"])

        task = await store.get_task(task_id)
        assert task.overall_status == "pending"

        await store.update_agent(task_id, "intent_parser", "running", "分析中")
        task = await store.get_task(task_id)
        assert task.overall_status == "running"

    @pytest.mark.asyncio
    async def test_set_overall_status_done_sets_100(self):
        from core.status_store import StatusStore

        store = StatusStore(redis_client=None)
        task_id = "test-done-task"
        await store.init_task(task_id, "sess", ["intent_parser"])
        await store.set_overall_status(task_id, "done")

        task = await store.get_task(task_id)
        assert task.overall_status == "done"
        assert task.progress_pct == 100


class TestMemoryManager:
    @pytest.mark.asyncio
    async def test_add_and_retrieve_messages(self):
        from core.memory import MemoryManager, _FALLBACK_STORE

        session_id = "test-memory-session-001"
        key = f"session:{session_id}:history"
        _FALLBACK_STORE.pop(key, None)

        mem = MemoryManager(session_id=session_id, max_short_term=10, redis_client=None)
        await mem.add_message("user", "我想去东京")
        await mem.add_message("assistant", "好的，我来为您规划东京行程")

        history = await mem.get_full_history()
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "我想去东京"
        assert history[1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_short_term_returns_last_n(self):
        from core.memory import MemoryManager, _FALLBACK_STORE

        session_id = "test-memory-session-002"
        key = f"session:{session_id}:history"
        _FALLBACK_STORE.pop(key, None)

        mem = MemoryManager(session_id=session_id, max_short_term=3, redis_client=None)
        for i in range(5):
            await mem.add_message("user", f"消息 {i}")

        short = await mem.get_short_term()
        assert len(short) == 3
        assert short[-1]["content"] == "消息 4"

    @pytest.mark.asyncio
    async def test_clear_removes_all_messages(self):
        from core.memory import MemoryManager, _FALLBACK_STORE

        session_id = "test-memory-session-003"
        key = f"session:{session_id}:history"
        _FALLBACK_STORE.pop(key, None)

        mem = MemoryManager(session_id=session_id, max_short_term=10, redis_client=None)
        await mem.add_message("user", "test message")
        await mem.clear()

        history = await mem.get_full_history()
        assert history == []

    def test_build_context_string_formats_correctly(self):
        from core.memory import MemoryManager

        mem = MemoryManager(session_id="x", redis_client=None)
        messages = [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "您好！"},
        ]
        result = mem.build_context_string(messages)
        assert "User: 你好" in result
        assert "Assistant: 您好！" in result


class TestCurrencyInfo:
    def test_valid_currency_info(self):
        info = CurrencyInfo(
            from_currency="CNY",
            to_currency="USD",
            rate=0.1382,
            budget_in_dest_currency=2764.0,
            tips=["使用信用卡", "避免机场换汇", "携带少量现金"],
        )
        assert info.from_currency == "CNY"
        assert info.rate == 0.1382


class TestBudgetBreakdown:
    def test_valid_budget_breakdown(self):
        bd = BudgetBreakdown(
            total_cny=20000.0,
            flight_cny=7000.0,
            accommodation_cny=5000.0,
            food_cny=3000.0,
            transport_cny=1600.0,
            attractions_cny=1400.0,
            shopping_cny=1000.0,
            emergency_cny=1000.0,
            daily_budget_cny=1857.14,
            notes="标准旅行风格预算分配",
        )
        assert bd.total_cny == 20000.0
