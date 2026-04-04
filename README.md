# OpenClaw Travel Planner · 智慧旅行规划系统（修改文件测试)
这一行也添加了文本
<div align="center">
  <h1>🌍 OpenClaw Travel Planner</h1>
  <p><strong>多智能体 AI 驱动的智慧旅行规划平台</strong></p>
  <p>A Multi-Agent AI Powered Smart Travel Planning Platform</p>
  
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss" alt="TailwindCSS">
  <img src="https://img.shields.io/badge/FastAPI-0.104-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/AutoGen-0.4-FF6B35?logo=openai" alt="AutoGen">
</div>

---

## 系统概览 · Overview

OpenClaw 是一个基于 **AutoGen 多智能体架构** 的智慧旅行规划系统，包含完整的后端服务与现代化 Web 前端。

用户只需用自然语言发送旅行需求（如 *"从广州出发去东京旅游5天，预算1万5人民币"*），系统即自动编排 **8 个专项智能体** 并行工作，在数十秒内生成一份完整的逐日旅行行程。

### 核心特性

- 🤖 **多智能体协作** — 意图解析、汇率分析、预算规划、航班查询、酒店推荐、景点规划、天气预报、行程生成
- ⚡ **实时进度追踪** — 前端轮询展示每个智能体的执行状态与进度
- 🎨 **现代化 UI** — React 19 + TailwindCSS v4 + Motion 动画，支持深色/浅色主题
- 📱 **响应式设计** — 适配桌面与移动设备
- 🔄 **历史规划** — 支持查看过往行程记录
- 🖼️ **智能配图** — 根据活动内容自动获取相关图片

---

## 技术栈 · Tech Stack

### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| Vite | 5.x | 构建工具 |
| TailwindCSS | v4 | 原子化 CSS |
| motion/react | 12.x | 动画效果 |
| Lucide React | - | 图标库 |

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.104+ | Web 框架 |
| AutoGen | 0.4+ | 多智能体编排 |
| SQLModel | - | ORM 与数据模型 |
| SQLite / Redis | - | 数据持久化 |
| Pydantic v2 | - | 数据验证 |

---

## 快速开始 · Quick Start

### 前提条件
- Node.js 18+
- Python 3.9+
- (可选) Redis

### 1. 克隆仓库

```bash
git clone https://github.com/Eternite-0/openclaw-travel-backend.git
cd openclaw-travel-backend
```

### 2. 启动后端

```bash
cd openclaw-travel-backend

# 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 OPENAI_API_KEY

# 启动服务
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

后端 API 文档：http://localhost:8000/docs

### 3. 启动前端

```bash
cd fronted

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 可选：配置 VITE_PIXABAY_KEY 获取更好的图片

# 启动开发服务器
npm run dev
```

前端访问：http://localhost:3000

---

## 项目结构 · Project Structure

```
Project/
├── fronted/                          # 前端 (React 19 + Vite)
│   ├── src/
│   │   ├── App.tsx                  # 主应用组件
│   │   ├── index.css                # Tailwind 主题配置
│   │   └── main.tsx                 # 入口文件
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts               # Vite 配置 (含代理)
│
├── openclaw-travel-backend/        # 后端 (FastAPI + AutoGen)
│   ├── agents/                      # 智能体模块
│   │   ├── base_agent.py            # 智能体基类
│   │   ├── orchestrator.py          # 编排器 (3阶段执行)
│   │   ├── intent_parser.py         # 意图解析
│   │   ├── currency_agent.py        # 汇率分析
│   │   ├── budget_agent.py          # 预算规划
│   │   ├── flight_agent.py          # 航班查询
│   │   ├── hotel_agent.py           # 酒店推荐
│   │   ├── attraction_agent.py      # 景点规划
│   │   ├── weather_agent.py         # 天气预报
│   │   └── itinerary_agent.py       # 行程生成
│   ├── api/                         # API 路由
│   │   ├── chat.py                  # POST /api/chat
│   │   ├── status.py                # GET /api/task/{id}/status
│   │   ├── itinerary.py             # GET /api/task/{id}/result
│   │   └── history.py               # GET /api/tasks (历史规划)
│   ├── core/                        # 核心模块
│   │   ├── schemas.py               # Pydantic 数据模型
│   │   ├── memory.py                # 双层记忆系统
│   │   └── status_store.py          # 状态存储
│   ├── services/                  # 外部服务
│   │   ├── weather_service.py       # Open-Meteo 天气 API
│   │   └── currency_service.py      # 汇率 API
│   ├── main.py                      # FastAPI 入口
│   ├── database.py                  # SQLite 数据库
│   └── requirements.txt
│
├── .gitignore                       # Git 忽略配置
└── README.md                        # 本文件
```

---

## 架构设计 · Architecture

### 多智能体编排流程

```
Phase 1: 意图解析
┌──────────────────┐
│ IntentParser     │ → 提取出发地、目的地、日期、预算...
└────────┬─────────┘
         │
Phase 2: 并行分析 (asyncio.gather)
┌────────┴─────────┬─────────────┬─────────────┬─────────────┐
│ 💱 Currency      │ 💰 Budget   │ ✈️ Flight   │ 🏨 Hotel    │
│    汇率分析       │   预算规划   │   航班查询   │   酒店推荐   │
├──────────────────┼─────────────┼─────────────┼─────────────┤
│ 🗺️ Attraction    │ 🌤️ Weather │             │             │
│    景点规划       │   天气预报   │             │             │
└────────┬─────────┴─────────────┴─────────────┴─────────────┘
         │
Phase 3: 行程生成
┌──────────────────┐
│ ItineraryAgent   │ → 汇总所有分析结果，生成完整行程
└──────────────────┘
```

### 前端轮询流程

```
Client                              Server
  │                                   │
  ├── POST /api/chat ────────────────►│ 发起规划请求
  │◄── {task_id, ...} ───────────────┤ 返回任务 ID
  │                                   │
  │◄── poll every 2s ────────────────►│
  │    GET /api/task/{id}/status     │ 查询状态
  │    {progress_pct, agents[]}        │
  │                                   │
  │  (status == "done")               │
  │                                   │
  ├── GET /api/task/{id}/result ─────►│ 获取行程
  │◄── FinalItinerary JSON ──────────┤
```

---

## API 端点 · API Endpoints

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发起旅行规划请求 |
| GET | `/api/task/{task_id}/status` | 查询任务状态 |
| GET | `/api/task/{task_id}/result` | 获取完整行程结果 |
| GET | `/api/tasks` | 获取历史规划列表 |
| GET | `/api/sessions/{session_id}/history` | 获取会话历史 |
| POST | `/api/sessions/{session_id}/clear` | 清除会话历史 |
| GET | `/api/health` | 健康检查 |

---

## 环境变量 · Environment Variables

### 后端 (.env)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | **必填** |
| `OPENAI_BASE_URL` | API Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称 | `gpt-4o-mini` |
| `REDIS_URL` | Redis 连接 URL | `redis://localhost:6379/0` |
| `REDIS_ENABLED` | 是否启用 Redis | `true` |
| `DATABASE_URL` | SQLite 路径 | `sqlite:///./openclaw.db` |

### 前端 (.env.local)

| 变量 | 说明 |
|------|------|
| `VITE_PIXABAY_KEY` | Pixabay API Key（用于图片搜索） |

---

## 开发指南 · Development

## 服务器一键部署（git clone 后直接执行）

在 Ubuntu 服务器上：

```bash
git clone <你的仓库地址>
cd Project
chmod +x deploy-server.sh
./deploy-server.sh
```

说明：
- 首次执行会自动安装 Docker（如果未安装）
- 若缺少 `openclaw-travel-backend/.env`，脚本会自动创建并提示你先填入真实 API Key
- 填好后再次执行 `./deploy-server.sh` 即可完成构建和启动
- 默认会启动 `docker-compose.yml` 中的前后端服务，前端映射到 `80` 端口

### 运行测试

```bash
# 后端测试
cd openclaw-travel-backend
pytest tests/ -v
```

### 构建生产版本

```bash
# 前端构建
cd fronted
npm run build
# 输出到 dist/ 目录
```

---

## 致谢 · Attribution

- [AutoGen](https://github.com/microsoft/autogen) — 微软多智能体框架
- [FastAPI](https://fastapi.tiangolo.com/) — 现代 Python Web 框架
- [Open-Meteo](https://open-meteo.com/) — 免费天气 API
- [Pixabay](https://pixabay.com/) — 免费图片 API

---

<div align="center">
  <p><strong>OpenClaw Travel Planner</strong> — 让 AI 为你规划完美旅程</p>
  <p>Made with ❤️ by OpenClaw Team</p>
</div>
