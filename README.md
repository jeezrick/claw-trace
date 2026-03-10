# Trace Service

把 OpenClaw session 链路网页做成可访问服务。

## 目录

- `public/` 前端页面（index.html / styles.css / app.js）
- `server.js` 轻量 HTTP 服务 + API

## 新增能力（v1.0.14）

- 在页面顶部新增 **Raw Stream 实时链路面板**（Live）
- 支持 SSE 实时推送、关键词过滤、暂停/继续、清空
- 与原有 Session/Terminal/Agentic timeline 同页融合
- 实时面板默认仅展示“有价值事件”，过滤高频噪音：
  - 隐藏 `assistant_text_stream`
  - `assistant_thinking_stream` 仅保留 `thinking_end`
- 新增按 `runId + sessionId` 聚合显示，避免所有 session 混在一起
- 新增范围切换：`当前选中 session` / `全部 session`
- 新增事件类型快速开关（assistant_end / thinking_end / toolCall / toolResult / error）
- 修复滚动行为：用户滚动查看历史时不再被强制跳到底部

## 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/jeezrick/claw-trace/main/install.sh | bash
```

安装后：

```bash
claw-trace start
claw-trace status
```

访问：`http://<对方机器IP>:8787`

## 命令行用法（支持 update）

```bash
claw-trace start
claw-trace stop
claw-trace restart
claw-trace status
claw-trace logs
claw-trace doctor           # 一键健康检查（进程/文件/API/raw-stream）
claw-trace version
claw-trace update           # 更新到 latest
claw-trace update v1.0.2    # 更新到指定版本
claw-trace rollback
```

## 发布到 GitHub（方案 A）

1. 在 GitHub 新建仓库（建议：`trace-service`）
2. 推送代码到 `main`
3. 打 tag 并推送：

```bash
git tag v1.0.0
git push origin main --tags
```

4. 本项目内置了 GitHub Actions（`.github/workflows/release.yml`），会自动：
   - 运行 `./build-bundle.sh`
   - 生成 `trace-service.tgz`
   - 创建 Release 并上传该资产

之后你只需把安装命令里的版本号改成新 tag 即可（如 `v1.0.1`）。

## 本机启动

```bash
cd /root/code/claw-trace
node server.js
```

默认监听：`0.0.0.0:8787`

## 环境变量

- `PORT`：端口（默认 `8787`）
- `HOST`：监听地址（默认 `0.0.0.0`）
- `SESSIONS_DIR`：session 数据目录（默认 `/root/.openclaw/agents/main/sessions`）
- `RAW_STREAM_FILE`：raw stream 日志路径（默认 `~/.openclaw/logs/raw-stream.jsonl`）
- `RAW_POLL_MS`：轮询间隔毫秒（默认 `700`）

示例：

```bash
HOST=0.0.0.0 \
PORT=8787 \
SESSIONS_DIR=/root/.openclaw/agents/main/sessions \
RAW_STREAM_FILE=/root/.openclaw/logs/raw-stream.jsonl \
node server.js
```

> 提示：要让 raw stream 文件持续有内容，OpenClaw 网关需启用 raw stream（如 `OPENCLAW_RAW_STREAM=1`）。

## API

- `GET /api/config` -> 读取服务配置（含 raw stream 文件路径）
- `GET /api/sessions` -> 读取 `sessions.json`
- `GET /api/session-file?file=<session.jsonl>` -> 读取指定 `jsonl`
- `GET /api/raw-stream?replay=2000` -> SSE 实时流（先回放历史文件/缓存，再持续推送）

> 安全限制：仅允许读取 `sessions.json` 和形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jsonl` 的文件名。

## 设计原理（实时链路）

### 1) 为什么单看 session jsonl 不够

`sessions/*.jsonl` 是会话历史持久化，写入通常以“消息级/阶段性”落盘为主。
在一次执行尚未结束时，常会先看到 user message，看不到完整未完成链路。

### 2) 方案：Raw Stream + SSE

- 网关侧开启 raw stream 落盘（`OPENCLAW_RAW_STREAM=1`）
- claw-trace 后端轮询 `RAW_STREAM_FILE` 增量读取（类似 tail）
- 后端通过 SSE (`/api/raw-stream`) 推送给前端
- 前端实时渲染并提供过滤/暂停/清空

这样可以在执行未完成前，就看到中间 chunk/event。

### 3) 后端实现要点

- `RAW_STREAM_FILE` 默认：`~/.openclaw/logs/raw-stream.jsonl`
- `RAW_POLL_MS` 默认：`700ms`
- 首次连接时：
  - 返回 `meta`（当前 raw 文件路径）
  - 可回放最近 N 条（`replay` 参数）
- 增量读取策略：
  - 维护读取偏移 `position`
  - 处理日志轮转/截断（inode 或 size 回退）
  - 行缓冲（避免半行 JSON）

### 4) 前端实现要点

- 新增 Live 面板（与原有 3-step 视图同页）
- EventSource 连接 `/api/raw-stream`
- `meta` 事件用于显示当前 raw 文件来源
- `message` 事件先做“价值过滤”再显示：
  - 默认隐藏 `assistant_text_stream`
  - `assistant_thinking_stream` 仅显示 `thinking_end`
- 展示聚合：按 `runId + sessionId` 分组（group card）
- 范围筛选：
  - `当前选中 session`（默认）
  - `全部 session`
- 选中 session/终端消息后，增加“时间窗兜底过滤”：
  - 当 raw 事件缺失 `sessionId` 时，按当前终端消息区间匹配
  - 避免看不到原本存在于 raw-stream 文件中的历史链路
- 展示层支持：
  - 关键词过滤（kind/runId/sessionId）
  - 事件类型快速开关（assistant_end / thinking_end / toolCall / toolResult / error）
  - 暂停/继续渲染
  - 清空窗口
- 滚动策略：仅当视图接近底部时自动跟随；用户向上翻历史时保持当前位置

### 5) 运维排障（doctor）

新增 `claw-trace doctor`，自动检查：

- 服务进程是否在运行
- `SESSIONS_DIR` / `sessions.json` 可读性
- `RAW_STREAM_FILE` 是否存在、可读、是否增长
- `http://127.0.0.1:$PORT/api/config` 是否可访问

用于快速判断“为什么实时面板没数据”。
