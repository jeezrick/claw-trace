# Claw Trace 服务开发总结与使用指南（v1.1.6）

![截图示例](docs/screenshot.png)

## 为什么

当你觉得某条消息回复不满意时，可以用 Claw Trace 查看这次回复背后的完整 agentic 行为链路：

- 是 skill prompt 不够清晰
- 还是 skill 流程太长
- 或者某个工具反复报错

它把 **Session → Terminal Message → Agentic Chain** 可视化出来，便于调试和复盘。

---

## 一、项目目标

将 OpenClaw 的 session 链路分析网页做成可独立运行、可公开分发、可一条命令安装并支持后续升级的服务。

核心诉求：

- 与 OpenClaw 主 workspace 解耦
- 支持在其他机器快速运行
- 默认自动读取 `/root/.openclaw/agents/main/sessions`
- 支持 GitHub Release 公开下载
- 支持 `claw-trace update` 更新

---

## 二、最终交付

- **仓库地址**：`git@github.com:jeezrick/claw-trace.git`
- **当前版本**：v1.1.6
- **代码目录**：`~/claw-trace`（安装后）/ `/root/code/claw-trace`（开发机）

### 关键文件

| 文件 | 说明 |
|------|------|
| `server.js` | 服务入口（加载编译后的后端） |
| `apps/server/` | Fastify + SQLite 后端（TypeScript） |
| `apps/web/` | React + Vite 前端 |
| `claw-trace` | CLI 命令脚本（start/stop/update 等） |
| `install.sh` | 一键安装脚本 |
| `run.sh` | 服务启动脚本 |
| `build-bundle.sh` | 打包脚本（生成 `trace-service.tgz`） |
| `.github/workflows/release.yml` | tag 自动发布 Release 资产 |
| `VERSION` | 当前版本号 |

---

## 三、架构（v2，当前）

v1.1.x 已完成从旧版单文件（`server.js` + `public/`）到 v2 全栈架构的迁移。

```
OpenClaw sessions/*.jsonl
      ↓  每 3s 轮询（IngestService）
    SQLite（claw-trace-v2.sqlite）
      ↓  diff 检测变化
    EventEmitter（IngestNotifications）
      ↓  推送
    SSE /api/v2/stream
      ↓
    前端（React + Zustand）
```

### 后端技术栈

- **框架**：Fastify
- **数据库**：SQLite（better-sqlite3）
- **语言**：TypeScript
- **路径**：`apps/server/`

### 前端技术栈

- **框架**：React 18 + Vite
- **状态**：Zustand
- **路径**：`apps/web/`

### SSE 事件类型

| 事件 | 说明 |
|------|------|
| `ready` | 连接就绪，含 `resumeCursor` |
| `heartbeat` | 心跳保活 |
| `session_updated` | session 新增 / 更新 / 删除 |
| `action_history_updated` | action 列表变化（按 `watchSessionId` 过滤） |
| `raw` | 原始 debug 事件（来自 raw_stream_entries 表） |

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v2/health` | 就绪检查（ingest 状态、上次同步时间、错误） |
| GET | `/api/v2/sessions` | Session 列表（workspace 感知） |
| GET | `/api/v2/sessions/:id/actions` | 指定 session 的 action 历史 |
| GET | `/api/v2/sessions/:id/detail` | Terminal messages + chain 详情 |
| GET | `/api/v2/workspaces` | 可用 workspace 列表 |
| GET | `/api/v2/stream` | SSE 实时推送流 |
| GET | `/` | React SPA 静态资源 |

### SSE 流参数

| 参数 | 说明 |
|------|------|
| `sessionId` | raw stream 的 session 过滤 |
| `watchSessionId` | action history 推送的 session 过滤 |
| `workspace` | workspace 过滤 |
| `cursor` | 断线重连游标 |

---

## 四、给最终用户的使用方式

### 1）一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install.sh | bash -s -- latest
```

如果提示 `claw-trace: command not found`，执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 2）启动并访问

```bash
claw-trace start
claw-trace status
```

访问地址：`http://<机器IP>:8787`

### 3）常用命令

```bash
claw-trace start
claw-trace stop
claw-trace restart
claw-trace status
claw-trace logs
claw-trace version
claw-trace doctor             # 健康诊断
claw-trace update             # 更新到 latest
claw-trace update v1.1.6      # 更新到指定版本
claw-trace rollback
```

---

## 五、默认读取路径与自定义

**默认读取：**

```
/root/.openclaw/agents/main/sessions
```

**自定义路径或端口：**

```bash
SESSIONS_DIR=/your/path PORT=8787 HOST=0.0.0.0 claw-trace restart
```

### 完整环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8787` | HTTP 端口 |
| `DATABASE_FILE` | `apps/server/data/claw-trace-v2.sqlite` | SQLite 数据库路径 |
| `SESSIONS_DIR` | `/root/.openclaw/agents/main/sessions` | Session JSONL 目录 |
| `SESSIONS_INDEX_FILE` | `<SESSIONS_DIR>/sessions.json` | Session 索引文件 |
| `RAW_STREAM_FILE` | `~/.openclaw/logs/raw-stream.jsonl` | 原始事件流文件 |
| `INGEST_POLL_MS` | `3000` | 数据同步间隔（ms） |
| `SESSION_STALL_MS` | `300000` | Session 判定为 stalled 的超时（ms） |
| `SSE_HEARTBEAT_MS` | `15000` | SSE 心跳间隔（ms） |

---

## 六、前端能力（当前 v1.1.x）

### 主工作流（Main workflow）

三栏布局，均支持独立 100vh 滚动：

- **Session 列表**：显示所有 session，带状态徽章（`running` / `stalled` / `failed` / `completed` / `idle`）
- **Terminal Messages**：展示该 session 的用户/助手消息列表，含"待回复"醒目徽章
- **Agentic Chain**：选中 terminal message 后展示完整 agentic 行为链路，包括：
  - user / think / toolCall / toolResult / reply / error 各步骤
  - 步骤摘要 pill（含工具调用名称）
  - 长内容自动折叠 + 展开全部按钮
  - 每步"查看源码"弹窗（完整原始 JSON，支持 Esc / 遮罩关闭）

### Action History（行为历史）

- 可切换到 Action History tab
- 展示选中 session 完整的 action 序列：`user → think → toolCall → toolResult → reply`
- SSE 实时推送，无需手动刷新

### Realtime Debug（实时链路）

- Live 实时面板，展示 raw stream 事件（需要网关开启 `OPENCLAW_RAW_STREAM=1`）
- 默认降噪：隐藏 `assistant_text_stream`，`thinking_stream` 只保留 `thinking_end`
- 事件类型快速开关（`assistant_end` / `thinking_end` / `toolCall` / `toolResult` / `error`）
- 按 runId + sessionId 分组展示
- 范围筛选：当前选中 session / 全部 session
- 滚动行为：接近底部时自动追踪，向上翻看历史时保持当前位置

### 通用能力

- **多 Workspace 切换**：下拉选择不同 agent workspace，session 列表随之更新
- **SSE 自动重连**：断线后自动重连，并重新同步最新数据
- **Zustand 持久化**：选中 session / terminal / workspace 刷新后保留
- **健康诊断**：`claw-trace doctor` 可检查进程、目录权限、raw stream 文件增长、API 可达性

---

## 七、发布与更新流程（维护者）

### 发布新版本

1. 提交并推送 `main`
2. 更新 `VERSION` 文件（如 `v1.1.7`）
3. 打 tag 并推送：

```bash
git tag v1.1.7
git push origin v1.1.7
```

GitHub Actions 自动执行：

- 运行 `./build-bundle.sh`
- 生成 `trace-service.tgz`（含编译后前后端 + node_modules）
- 创建 Release 并上传资产

### 用户侧更新

```bash
claw-trace update          # 更新到 latest
claw-trace update v1.1.7   # 更新到指定版本
claw-trace restart
claw-trace status
```

---

## 八、开发命令

```bash
npm install             # 安装所有依赖（workspaces）
npm run v2:dev          # 启动 server（:8790）+ web（:5174）开发模式
npm run v2:dev:lan      # 同上，监听 0.0.0.0（局域网可访问）
npm run v2:build        # 编译前后端
npm run v2:server:dev   # 仅启动后端
npm run v2:web:dev      # 仅启动前端
```

---

## 九、注意事项

- 服务能否显示数据，取决于目标机器是否存在 `sessions.json` 和对应 `*.jsonl`
- Live 实时面板需要网关开启 `OPENCLAW_RAW_STREAM=1` 才有数据
- 对公网开放建议加认证层（Nginx Basic Auth / Zero Trust）
- 若防火墙未放行 `8787` 端口，需额外开放

---

## 十、版本历史摘要

| 版本 | 主要更新 |
|------|----------|
| v1.0.10 | "待回复"醒目徽章 |
| v1.0.11 | Raw Stream 实时链路融合（Live 面板）+ `claw-trace doctor` |
| v1.0.12 | 实时链路降噪（隐藏 text stream，只保留关键事件） |
| v1.0.13 | 实时链路按 runId+sessionId 聚合 + 范围筛选 + 历史滚动修复 |
| v1.0.14 | 事件类型快速开关 |
| v1.1.0 | v2 全栈架构（Fastify + SQLite + React/Vite + Zustand + SSE） |
| v1.1.1 | SSE 推送模式（session_updated / action_history_updated） |
| v1.1.5 | 多 Workspace 切换器 |
| v1.1.6 | 修复 Agentic Chain 面板无法滚动问题 |
