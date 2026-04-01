# claw-trace

OpenClaw Agent 执行链路可视化服务。实时展示每个 session 的完整执行过程，让你清楚地看到 Agent 当前在做什么、卡在哪一步。

## 能做什么

- **Session 列表** — 列出所有 Agent session，自动推断状态（running / stalled / failed / completed / idle）
- **Action 历史** — 展示 session 内的完整执行步骤：user 指令、think、toolCall、toolResult、reply、error
- **实时链路流** — 通过 SSE 实时推送 OpenClaw 网关产出的 raw stream 事件，无需手动刷新
- **Workspace 切换** — 支持切换不同 Agent workspace

## 安装方案

### GitHub 完整方案

- 代码托管：GitHub
- 预构建产物：GitHub Release 里的 `trace-service.tgz`
- 安装入口：[install-github.sh](./install-github.sh)
- 安装后 `claw-trace update` / `rollback` 会继续沿用 GitHub

安装命令：

```bash
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install-github.sh | bash
```

### GitLab 完整方案

- 代码托管：GitLab
- 预构建产物：GitLab Generic Package Registry 里的 `trace-service.tgz`
- 安装入口：[install-gitlab.sh](./install-gitlab.sh)
- 安装后 `claw-trace update` / `rollback` 会继续沿用 GitLab

安装命令：

```bash
curl -fsSL http://192.168.16.6/wonderful/claw-trace/-/raw/main/install-gitlab.sh | bash
```

### 底层安装脚本

如果你要自定义安装源、仓库或 base URL，也可以直接调用底层 [install.sh](./install.sh)：

```bash
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install.sh | CLAW_TRACE_INSTALL_SOURCE=github bash
```

说明：
- 两套方案都会下载预构建的 `trace-service.tgz`，不会在目标机器上重新构建前后端。
- 目标机器仍需要 `node` 和 `npm`，因为安装过程中会执行 `npm ci --omit=dev` 安装 server 运行时依赖。

安装完成后可立刻启动服务：

```bash
$HOME/claw-trace/claw-trace start
```

安装脚本会自动把 `~/.local/bin` 写入常见 shell 启动文件；新开一个终端后，也可以直接使用：

```bash
claw-trace start
```

如果机器支持 systemd，安装时会自动注册并启用 `claw-trace.service`：
- 服务异常退出后自动重启
- 机器重启后自动拉起
- `claw-trace logs` 会自动走 `journalctl`

如果当前环境没有可用的 systemd，则自动回退到原来的 nohup 模式。

打开浏览器访问 `http://<机器IP>:8787`。

> 已有旧版？直接重新执行安装命令即可，脚本会自动停掉旧进程并用新版本拉起。

## 发给 OpenClaw 的安装文案

### GitHub 版本

```text
详细文档
Claw Trace 服务开发总结与使用指南（GitHub 版）

安装：
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install-github.sh | bash

安装后：
claw-trace start
claw-trace status
访问：http://<服务器机器IP>:8787/

请在服务器上执行 ifconfig，找到可访问的内网 IP（例如 192.168.16.xx），然后用：
http://<实际服务器IP>:8787/
```

### GitLab 版本

```text
详细文档
Claw Trace 服务开发总结与使用指南（GitLab 版）

安装：
curl -fsSL http://192.168.16.6/wonderful/claw-trace/-/raw/main/install-gitlab.sh | bash

安装后：
claw-trace start
claw-trace status
访问：http://<服务器机器IP>:8787/

请在服务器上执行 ifconfig，找到可访问的内网 IP（例如 192.168.16.xx），然后用：
http://<实际服务器IP>:8787/
```

## 命令行

```bash
claw-trace start       # 启动服务
claw-trace stop        # 停止服务
claw-trace restart     # 重启服务
claw-trace status      # 查看运行状态
claw-trace logs        # 查看日志
claw-trace doctor      # 一键健康检查
claw-trace diagnosis   # 汇总 session 状态并输出诊断；若配置模型则附带 AI 总结
claw-trace setup-service   # 手动重装/启用 systemd 托管
claw-trace service-mode    # 查看当前托管模式（systemd/nohup）
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

### GitHub 发布

GitHub 侧打 tag 后，GitHub Actions 自动构建并发布 Release：

```bash
git push origin main
git tag v1.1.20
git push origin v1.1.20
```

CI 会执行 `./build-bundle.sh`，生成 `trace-service.tgz` 并上传到 GitHub Release Assets。

### GitLab 发布

GitLab 侧打同版本 tag 后，GitLab CI 会执行同样的 `./build-bundle.sh`，并把 `trace-service.tgz` 上传到 Generic Package Registry。

GitLab CI 配置见 [.gitlab-ci.yml](./.gitlab-ci.yml)。

说明：
- GitHub 和 GitLab 两边可以同时存在同版本号。
- 如果两边历史不是同一个 commit 哈希，需要分别在各自仓库的 `main` 头上创建同版本 tag。
