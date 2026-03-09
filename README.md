# Trace Service

把 OpenClaw session 链路网页做成可访问服务。

## 目录

- `public/` 前端页面（index.html / styles.css / app.js）
- `server.js` 轻量 HTTP 服务 + API

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

示例：

```bash
HOST=0.0.0.0 PORT=8787 SESSIONS_DIR=/root/.openclaw/agents/main/sessions node server.js
```

## API

- `GET /api/sessions` -> 读取 `sessions.json`
- `GET /api/session-file?file=<session.jsonl>` -> 读取指定 `jsonl`

> 安全限制：仅允许读取 `sessions.json` 和形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jsonl` 的文件名。
