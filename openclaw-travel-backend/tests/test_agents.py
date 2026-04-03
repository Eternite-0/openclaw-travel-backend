from __future__ import annotations

import json
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.intent_parser import IntentParserAgent
from core.schemas import TravelIntent
from core.status_store import StatusStore


def _make_intent() -> TravelIntent:
    return TravelIntent(
        origin_city="广州",
        origin_country="中国",
        dest_city="纽约",
        dest_country="美国",
        dest_country_code="US",
        departure_date=date(2025, 8, 1),
        return_date=date(2025, 8, 8),
        duration_days=7,
        budget_cny=20000.0,
    )


def _make_status_store() -> StatusStore:
    store = StatusStore(redis_client=None)
    return store


def _make_llm_config() -> dict:
    return {
        "config_list": [
            {
                "model": "gpt-4o-mini",
                "api_key": "sk-test",
                "base_url": "https://api.openai.com/v1",
            }
        ],
        "temperature": 0.3,
    }


class TestIntentParserAgentPrompt:
    def test_build_system_prompt_contains_schema(self):
        """_build_system_prompt() must embed the JSON Schema string."""
        intent = _make_intent()
        store = _make_status_store()
        agent = IntentParserAgent(
            task_id="test-task-001",
            intent=intent,
            status_store=store,
            llm_config=_make_llm_config(),
            user_message="我想从广州去纽约旅游7天",
            history="",
        )
        prompt = agent._build_system_prompt(
            {"user_message": "我想从广州去纽约旅游7天", "history": ""}
        )
        schema = TravelIntent.model_json_schema()
        assert "origin_city" in prompt
        assert "dest_city" in prompt
        assert "budget_cny" in prompt
        assert "JSON Schema" in prompt or "schema" in prompt.lower()

    def test_build_system_prompt_contains_refusal_clause(self):
        """System prompt must contain out_of_scope refusal instruction."""
        intent = _make_intent()
        store = _make_status_store()
        agent = IntentParserAgent(
            task_id="test-task-002",
            intent=intent,
            status_store=store,
            llm_config=_make_llm_config(),
            user_message="test",
            history="",
        )
        prompt = agent._build_system_prompt({"user_message": "test", "history": ""})
        assert "out_of_scope" in prompt

    def test_build_system_prompt_injects_user_message(self):
        """_build_system_prompt() must include the user message."""
        intent = _make_intent()
        store = _make_status_store()
        user_msg = "从北京去巴黎旅游10天"
        agent = IntentParserAgent(
            task_id="test-task-003",
            intent=intent,
            status_store=store,
            llm_config=_make_llm_config(),
            user_message=user_msg,
            history="",
        )
        prompt = agent._build_system_prompt({"user_message": user_msg, "history": ""})
        assert user_msg in prompt

    def test_summarize_returns_non_empty_string(self):
        """_summarize() must return a non-empty string."""
        intent = _make_intent()
        store = _make_status_store()
        agent = IntentParserAgent(
            task_id="test-task-004",
            intent=intent,
            status_store=store,
            llm_config=_make_llm_config(),
        )
        summary = agent._summarize(intent)
        assert isinstance(summary, str)
        assert len(summary) > 0
        assert "广州" in summary or "纽约" in summary


@pytest.mark.asyncio
async def test_agent_run_reports_running_then_done():
    """agent.run() must call update_agent with 'running' then 'done'."""
    intent = _make_intent()
    store = StatusStore(redis_client=None)
    store.update_agent = AsyncMock()

    mock_result = _make_intent()

    agent = IntentParserAgent(
        task_id="test-task-005",
        intent=intent,
        status_store=store,
        llm_config=_make_llm_config(),
        user_message="从广州去纽约7天",
        history="",
    )
    agent._execute = AsyncMock(return_value=mock_result)

    result = await agent.run(extra_context={"user_message": "从广州去纽约7天", "history": ""})

    assert result == mock_result
    calls = store.update_agent.call_args_list
    statuses = [c.args[2] if c.args else c.kwargs.get("status") for c in calls]
    assert "running" in statuses
    assert "done" in statuses


@pytest.mark.asyncio
async def test_agent_run_reports_error_on_exception():
    """agent.run() must call update_agent with 'error' when _execute raises."""
    intent = _make_intent()
    store = StatusStore(redis_client=None)
    store.update_agent = AsyncMock()

    agent = IntentParserAgent(
        task_id="test-task-006",
        intent=intent,
        status_store=store,
        llm_config=_make_llm_config(),
        user_message="test",
        history="",
    )
    agent._execute = AsyncMock(side_effect=ValueError("LLM error"))

    with pytest.raises(ValueError):
        await agent.run()

    calls = store.update_agent.call_args_list
    statuses = [c.args[2] if len(c.args) > 2 else c.kwargs.get("status") for c in calls]
    assert "error" in statuses
