# OpenClaw Travel Planner · 智慧旅行规划系统

<div align="center">
  <h1>OpenClaw Travel Planner</h1>
  <p><strong>多智能体 AI 驱动的智慧旅行规划平台</strong></p>
  <p>A Multi-Agent AI Powered Smart Travel Planning Platform</p>

  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss" alt="TailwindCSS">
  <img src="https://img.shields.io/badge/FastAPI-0.104+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/AutoGen-0.4+-FF6B35?logo=openai" alt="AutoGen">
</div>

---

## 系统概览 · Overview

OpenClaw 是一个基于 **AutoGen 多智能体架构** 的智慧旅行规划系统，包含完整后端服务与现代化 Web 前端。

用户只需输入自然语言需求（如“从广州出发去东京旅游 5 天，预算 1.5 万人民币”），系统会自动编排多个专项智能体协作，生成完整逐日行程。

### 核心特性

- 多智能体协作：意图解析、汇率分析、预算规划、航班推荐、酒店推荐、景点规划、天气分析、签证信息、行程合成
- 会话化聊天：支持多会话创建、重命名、删除、历史消息追溯
- 快速问答 + 重规划双模式：普通咨询走快速回复，明确修改意图触发全链路重规划
- 地图能力增强：景点地图展示、步行路线生成（支持多点路径）
- 路线纠偏与搜索缓存：结合地理编码纠偏和 Redis 缓存优化搜索性能
- 响应式前端：React 19 + TailwindCSS v4 + Motion 动画

---

## 最近更新 · Recent Updates

基于仓库最近提交记录整理：

- 增加多轮对话和历史窗口
- 完善 Agent 执行链路
- 前端页面重构与 Markdown 渲染优化
- 增加自动化部署脚本（`deploy-server.sh`）
- 新增消息会话接口（Conversations）
- 兼容 OpenAI SDK，优化重试处理
- 新增签证 Agent（`visa_agent.py`）
- 完善地图显示、增加徒步路线、路线纠偏
- 搜索额度与结果缓存写入 Redis

---

## 技术栈 · Tech Stack

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| Vite | 6.x | 构建工具 |
| TailwindCSS | v4 | 原子化样式 |
| motion | 12.x | 动画效果 |
| react-markdown + remark-gfm | 10.x / 4.x | Markdown 渲染 |
| Leaflet + React-Leaflet | 1.9+ / 5.x | 地图与路径渲染 |

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.111+ | Web 框架 |
| AutoGen (pyautogen) | 0.2+ | 多智能体编排 |
| OpenAI SDK | 1.30+ | LLM 调用 |
| SQLModel | 0.0.18+ | ORM 与数据模型 |
| SQLite / Redis | - | 持久化与缓存 |
| Pydantic v2 + pydantic-settings | 2.7+ / 2.2+ | 数据模型与配置 |

---

## 快速开始 · Quick Start

### 前提条件

- Node.js 18+
- Python 3.9+
- (可选) Redis

### 1. 获取代码

```bash
git clone <your-repo-url>
cd Project
```

### 2. 启动后端

```bash
cd openclaw-travel-backend

python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux

pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，填入 API Key

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

后端文档：`http://localhost:8000/docs`

### 3. 启动前端

```bash
cd fronted

npm install
cp .env.example .env.local
npm run dev
```

前端地址：`http://localhost:3000`

---

## Docker 一键部署（Ubuntu）

```bash
git clone <your-repo-url>
cd Project
chmod +x deploy-server.sh
./deploy-server.sh
```

说明：

- 首次执行会自动安装 Docker（若未安装）
- 若缺少 `openclaw-travel-backend/.env`，脚本会自动创建并提示补充配置
- 默认启动前后端服务，前端映射到 `80` 端口

---

## 项目结构 · Project Structure

```text
Project/
├── fronted/                          # 前端 (React 19 + Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── DayRouteMap.tsx      # 地图与路线展示
│   │   │   ├── HistoryView.tsx      # 历史记录页
│   │   │   └── ItineraryView.tsx    # 行程展示页
│   │   ├── api.ts                   # 前端 API 封装
│   │   ├── App.tsx                  # 主应用
│   │   └── types.ts                 # 类型定义
│
├── openclaw-travel-backend/          # 后端 (FastAPI + AutoGen)
│   ├── agents/
│   │   ├── orchestrator.py          # Agent 编排器
│   │   ├── intent_parser.py         # 意图解析
│   │   ├── currency_agent.py        # 汇率分析
│   │   ├── budget_agent.py          # 预算规划
│   │   ├── flight_agent.py          # 航班推荐
│   │   ├── hotel_agent.py           # 酒店推荐
│   │   ├── attraction_agent.py      # 景点规划
│   │   ├── weather_agent.py         # 天气分析
│   │   ├── visa_agent.py            # 签证信息
│   │   └── itinerary_agent.py       # 行程合成
│   ├── api/
│   │   ├── chat.py                  # 聊天与任务触发
│   │   ├── status.py                # 任务状态
│   │   ├── itinerary.py             # 行程结果
│   │   ├── history.py               # 会话历史
│   │   ├── conversations.py         # 会话管理
│   │   └── route.py                 # 路线导航
│   ├── services/
│   │   ├── amap_service.py          # 高德路线服务
│   │   ├── search_cache.py          # 搜索缓存
│   │   ├── serpapi_service.py       # SerpAPI 搜索
│   │   ├── tavily_service.py        # Tavily 搜索
│   │   ├── crawleo_service.py       # Crawleo 搜索
│   │   └── weather_service.py       # 天气服务
│   ├── core/                        # schema/memory/status 等核心模块
│   ├── database.py                  # SQLite 模型与会话
│   ├── config.py                    # 环境配置
│   └── main.py                      # FastAPI 入口
│
├── docker-compose.yml
├── deploy-server.sh
└── README.md
```

---

## API 端点 · API Endpoints

### 规划与任务

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息（快速回复或触发重规划） |
| GET | `/api/task/{task_id}/status` | 查询任务状态 |
| GET | `/api/task/{task_id}/result` | 获取完整行程 |
| GET | `/api/tasks` | 获取历史任务列表 |

### 会话与历史

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 获取会话列表 |
| POST | `/api/conversations` | 新建会话 |
| GET | `/api/conversations/{conv_id}/messages` | 获取会话消息 |
| PATCH | `/api/conversations/{conv_id}` | 重命名会话 |
| DELETE | `/api/conversations/{conv_id}` | 删除会话 |
| POST | `/api/conversations/{conv_id}/touch` | 更新会话活跃时间 |
| GET | `/api/sessions/{session_id}/history` | 获取会话历史 |
| POST | `/api/sessions/{session_id}/clear` | 清空会话历史 |

### 地图与健康检查

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/route/walking` | 多点步行路线查询 |
| GET | `/api/health` | 服务健康检查 |

---

## 环境变量 · Environment Variables

后端 `openclaw-travel-backend/.env` 常用项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | `sk-placeholder` |
| `OPENAI_BASE_URL` | OpenAI 兼容 Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名 | `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | 兼容备用 Key | `sk-ant-placeholder` |
| `ANTHROPIC_MODEL` | 备用模型名 | `claude-3-5-haiku-20241022` |
| `REDIS_URL` | Redis 地址 | `redis://localhost:6379/0` |
| `REDIS_ENABLED` | 是否启用 Redis | `true` |
| `DATABASE_URL` | SQLite 地址 | `sqlite:///./openclaw.db` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `MAX_SHORT_TERM_MEMORY` | 短期记忆条数 | `10` |
| `SERPAPI_KEY` | SerpAPI Key | 空 |
| `TAVILY_API_KEY` | Tavily Key | 空 |
| `CRAWLEO_API_KEY` | Crawleo Key | 空 |
| `BAIDU_AI_SEARCH_API_KEY` | 百度搜索 Key | 空 |
| `AMAP_API_KEY` | 高德地图 Key | 空 |
| `SEARCH_STRATEGY` | 搜索策略 | `serpapi_first` |
| `AGENT_CONCURRENCY` | Agent 并发数 | `1` |
| `ITINERARY_DAY_CONCURRENCY` | 行程日程并发数 | `2` |

---

## 测试与构建 · Development

### 后端测试

```bash
cd openclaw-travel-backend
pytest tests/ -v
```

### 前端构建

```bash
cd fronted
npm run build
```

---

## 致谢 · Attribution

- [AutoGen](https://github.com/microsoft/autogen)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Open-Meteo](https://open-meteo.com/)
- [Pixabay](https://pixabay.com/)
- [Amap Web Service API](https://lbs.amap.com/api/webservice/guide/api/newroute)

---

<div align="center">
  <p><strong>OpenClaw Travel Planner</strong> - 让 AI 为你规划更完整的旅程</p>
</div>
