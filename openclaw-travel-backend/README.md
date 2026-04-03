# OpenClaw 智慧旅行助手 · Smart Travel Assistant

> **中文** | A multi-agent AI travel planning system powered by AutoGen + FastAPI  
> **English** | 基于 AutoGen 多智能体架构的智能旅行规划后端

---

## 项目简介 · Overview

用户只需用自然语言发送旅行需求（如 *"从广州出发去纽约旅游7天，预算2万人民币"*），
系统即自动编排8个专项智能体并行工作，在数十秒内生成一份完整的逐日旅行行程。

The user sends a single natural-language travel request. A Chief Orchestrator Agent
parses the intent and spawns 8 specialist sub-agents in optimised parallel/sequential
phases, then assembles a rich day-by-day itinerary with live progress tracking.

---

## 架构图 · Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FastAPI Application                          │
│  POST /api/chat ──► asyncio.create_task ──► Background Pipeline    │
│  GET  /api/task/{id}/status  (frontend polls every 1.5s)           │
│  GET  /api/task/{id}/result  (fetched when status == "done")       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                ┌──────────▼──────────┐
                │  ChiefOrchestrator  │
                └──────────┬──────────┘
                           │
           ╔═══════════════╪════════════════╗
           ║           PHASE 1              ║
           ║    ┌──────────▼───────────┐    ║
           ║    │  IntentParserAgent   │    ║
           ║    │  🧠 意图解析          │    ║
           ║    └──────────┬───────────┘    ║
           ╚═══════════════╪════════════════╝
                           │
           ╔═══════════════╪════════════════╗
           ║           PHASE 2 (parallel)   ║
           ║   ┌───────┬───┴───┬───────┐   ║
           ║   │       │       │       │   ║
           ║  💱      💰      ✈️      🏨   ║
           ║ Currency Budget Flight Hotel  ║
           ║   │       │       │       │   ║
           ║  🗺️      🌤️      │       │   ║
           ║ Attract Weather   │       │   ║
           ║   └───────┴───────┘       │   ║
           ╚═══════════════════════════╪═══╝
                           │
           ╔═══════════════╪════════════════╗
           ║           PHASE 3              ║
           ║    ┌──────────▼───────────┐    ║
           ║    │   ItineraryAgent     │    ║
           ║    │   📋 行程生成         │    ║
           ║    └──────────┬───────────┘    ║
           ╚═══════════════╪════════════════╝
                           │
             ┌─────────────▼──────────────┐
             │   SQLite + Redis Storage   │
             │   FinalItinerary JSON      │
             └────────────────────────────┘
```

### 前端轮询流程 · Frontend Polling Flow

```
Client                              Server
  │                                   │
  ├──POST /api/chat ─────────────────►│
  │◄── {task_id, status_poll_url} ────┤  (immediate, < 50ms)
  │                                   │
  │    ┌── poll every 1500ms ──┐      │
  │    │                       │      │
  ├────┤ GET /task/{id}/status ├─────►│
  │◄───┤  {progress_pct, agents}├─────┤  (running: 0-99%)
  │    │                       │      │
  │    └───────────────────────┘      │
  │                                   │
  │  (overall_status == "done")       │
  │                                   │
  ├──GET /api/task/{id}/result───────►│
  │◄── FinalItinerary JSON ───────────┤
```

---

## 快速启动 · Quick Start

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 OPENAI_API_KEY
```

### 3. 启动服务

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API 文档自动生成：http://localhost:8000/docs

---

## API 使用示例 · API Examples

### 发起旅行规划请求

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "从广州出发去纽约旅游7天，预算2万人民币",
    "session_id": "my-session-uuid-001"
  }'
```

响应：
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "my-session-uuid-001",
  "message": "收到！正在为您规划行程，请稍候...",
  "status_poll_url": "/api/task/550e8400.../status",
  "result_url": "/api/task/550e8400.../result"
}
```

### 轮询任务状态

```bash
curl http://localhost:8000/api/task/550e8400-e29b-41d4-a716-446655440000/status
```

响应（进行中）：
```json
{
  "task_id": "550e8400...",
  "overall_status": "running",
  "progress_pct": 62,
  "agents": [
    {"agent_name": "intent_parser", "display_name": "🧠 意图解析", "status": "done"},
    {"agent_name": "currency_agent", "display_name": "💱 汇率分析", "status": "done"},
    {"agent_name": "flight_agent",   "display_name": "✈️ 航班查询", "status": "running"},
    {"agent_name": "itinerary_agent","display_name": "📋 行程生成", "status": "pending"}
  ]
}
```

### 获取最终行程

```bash
curl http://localhost:8000/api/task/550e8400-e29b-41d4-a716-446655440000/result
```

### 查看会话历史

```bash
curl http://localhost:8000/api/sessions/my-session-uuid-001/history
```

### 清除会话历史

```bash
curl -X POST http://localhost:8000/api/sessions/my-session-uuid-001/clear
```

### 健康检查

```bash
curl http://localhost:8000/api/health
# {"status":"ok","redis":"connected","version":"1.0.0"}
```

---

## 运行测试 · Running Tests

```bash
pytest tests/ -v
```

---

## 项目结构 · Project Structure

```
openclaw-travel-backend/
├── .env.example               # 环境变量模板
├── requirements.txt
├── main.py                    # FastAPI 入口
├── config.py                  # pydantic-settings 配置
├── database.py                # SQLModel + SQLite
│
├── core/
│   ├── schemas.py             # 所有 Pydantic v2 数据模型
│   ├── memory.py              # Redis 双层记忆系统
│   └── status_store.py        # 智能体实时状态追踪
│
├── agents/
│   ├── base_agent.py          # BaseSpecialistAgent 基类
│   ├── orchestrator.py        # 编排器（3阶段执行计划）
│   ├── intent_parser.py       # 意图解析
│   ├── currency_agent.py      # 汇率分析
│   ├── budget_agent.py        # 预算规划
│   ├── flight_agent.py        # 航班查询
│   ├── hotel_agent.py         # 酒店推荐
│   ├── attraction_agent.py    # 景点规划
│   ├── weather_agent.py       # 天气预报
│   └── itinerary_agent.py     # 行程生成（最终汇总）
│
├── services/
│   ├── weather_service.py     # Open-Meteo 免费 API
│   └── currency_service.py    # exchangerate.host + Redis 缓存
│
├── api/
│   ├── chat.py                # POST /api/chat
│   ├── status.py              # GET  /api/task/{id}/status
│   ├── itinerary.py           # GET  /api/task/{id}/result
│   └── history.py             # GET/POST /api/sessions/{id}/...
│
└── tests/
    ├── test_chat_api.py
    ├── test_agents.py
    └── test_schemas.py
```

---

## 环境变量说明 · Environment Variables

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | *(必填)* |
| `OPENAI_BASE_URL` | API Base URL（支持代理） | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称 | `gpt-4o-mini` |
| `REDIS_URL` | Redis 连接 URL | `redis://localhost:6379/0` |
| `REDIS_ENABLED` | 是否启用 Redis | `true` |
| `DATABASE_URL` | SQLite 路径 | `sqlite:///./openclaw.db` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `MAX_SHORT_TERM_MEMORY` | 短期记忆消息数 | `10` |

> **注意**：Redis 不可用时系统自动降级为内存存储，无需手动配置。

---

## 技术亮点 · Technical Highlights

- **三阶段并行编排**：意图解析 → 6路并行分析 → 最终汇总，最大化利用 asyncio
- **双层记忆**：Redis 持久化长期对话历史 + 短期上下文窗口注入
- **实时状态仪表盘**：每个智能体独立上报状态，前端 1.5s 轮询展示进度
- **结构化输出强制**：JSON Schema 注入每个 Agent 的系统提示，强制 LLM 输出合法结构
- **外部 API 集成**：Open-Meteo（真实天气）+ exchangerate.host（实时汇率）
- **优雅降级**：Redis 不可用 → 内存回退；外部 API 失败 → 硬编码备用数据

---

## 致谢 · Attribution

本项目架构参考了以下开源项目：

1. **[amr-autogen-travel-agent](https://github.com/amr-autogen-travel-agent)** — AutoGen 旅行智能体双层记忆设计
2. **[LangGraph-Travel-Agent](https://github.com/LangGraph-Travel-Agent)** — 多智能体路由编排模式
3. **[open-meteo](https://open-meteo.com/)** — 免费开放天气预报 API
4. **[exchangerate.host](https://exchangerate.host/)** — 免费汇率转换 API

---

*OpenClaw Smart Travel Assistant — Competition Demo v1.0.0*
