# claw-trace

OpenClaw Agent 执行链路可视化服务。实时展示每个 session 的完整执行过程，让你清楚地看到 Agent 当前在做什么、卡在哪一步。

## 能做什么

- **Session 列表** — 列出所有 Agent session，自动推断状态（running / stalled / failed / completed / idle）
- **Action 历史** — 展示 session 内的完整执行步骤：user 指令、think、toolCall、toolResult、reply、error
- **实时链路流** — 通过 SSE 实时推送 OpenClaw 网关产出的 raw stream 事件，无需手动刷新
- **Workspace 切换** — 支持切换不同 Agent workspace

## 快速安装

```bash
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install.sh | bash
```

安装完成后启动服务：

```bash
claw-trace start
```

打开浏览器访问 `http://<机器IP>:8787`。

> 已有旧版？直接重新执行安装命令即可，脚本会自动停掉旧进程并用新版本拉起。

## 命令行

```bash
claw-trace start       # 启动服务
claw-trace stop        # 停止服务
claw-trace restart     # 重启服务
claw-trace status      # 查看运行状态
claw-trace logs        # 查看日志
claw-trace doctor      # 一键健康检查
claw-trace update      # 更新到最新版
claw-trace update v1.0.2  # 更新到指定版本
claw-trace rollback    # 回滚到上一个版本
claw-trace version     # 查看当前版本
```

`doctor` 会检查：服务进程、session 目录可读性、raw stream 文件是否存在且持续增长、API 是否可达。

## 本地开发

```bash
npm install
npm run v2:dev        # 启动前后端双进程（127.0.0.1）
npm run v2:dev:lan    # 同上，监听 0.0.0.0（局域网可访问）
```

开发时访问地址：

- 前端：`http://<机器IP>:5174`
- 后端：`http://<机器IP>:8790/api/v2/health`

构建：

```bash
npm run v2:build
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8787` | 监听端口 |
| `DATABASE_FILE` | `apps/server/data/claw-trace-v2.sqlite` | SQLite 文件路径 |
| `SESSIONS_DIR` | `/root/.openclaw/agents/main/sessions` | session 数据目录 |
| `SESSIONS_INDEX_FILE` | `<SESSIONS_DIR>/sessions.json` | session 索引文件 |
| `RAW_STREAM_FILE` | `~/.openclaw/logs/raw-stream.jsonl` | raw stream 日志路径 |
| `INGEST_POLL_MS` | `3000` | session/raw 数据摄取轮询间隔（ms） |
| `STREAM_POLL_MS` | `1000` | SSE 对数据库的轮询间隔（ms） |
| `SESSION_STALL_MS` | `300000` | 判定 session 为 stalled 的超时阈值（ms） |
| `SSE_HEARTBEAT_MS` | `15000` | SSE heartbeat 间隔（ms） |

> 要让 raw stream 持续有数据，需在 OpenClaw 网关开启 `OPENCLAW_RAW_STREAM=1`。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v2/health` | 健康检查 |
| GET | `/api/v2/sessions` | 获取所有 session 列表 |
| GET | `/api/v2/sessions/:sessionId/actions` | 获取指定 session 的 action 历史 |
| GET | `/api/v2/stream` | SSE 实时事件流 |

## 架构

```
OpenClaw 网关
  └── raw-stream.jsonl（落盘）
        └── claw-trace server
              ├── ingest（轮询读取 → SQLite）
              ├── REST API
              ├── SSE 推送
              └── 静态托管前端
                    └── 浏览器  http://<机器IP>:8787
```

后端：Fastify + SQLite（`better-sqlite3`）+ TypeScript
前端：React + Vite + Zustand

## 发版

打 tag 后 GitHub Actions 自动构建并发布 Release：

```bash
git tag v1.1.1
git push origin main --tags
```

CI 会执行 `./build-bundle.sh`，生成 `trace-service.tgz` 并上传到 Release Assets。
