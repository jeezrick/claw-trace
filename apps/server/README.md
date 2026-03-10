# claw-trace v2 server

Fastify + TypeScript + SQLite phase-1 backend。

## 当前范围

- 启动时 ingest `sessions.json`、session `jsonl`、`raw-stream.jsonl`
- SQLite read model：`sessions / action_events / raw_stream_entries / ingest_cursors`
- 健康检查、session 列表、action history、SSE stream
- SSE 支持 `cursor` / `Last-Event-ID` resume

## 启动

```bash
cd /root/code/claw-trace
npm run v2:server:dev
```

默认地址：`http://127.0.0.1:8790`

## 环境变量

- `HOST` 默认 `127.0.0.1`
- `PORT` 默认 `8790`
- `DATABASE_FILE` 默认 `apps/server/data/claw-trace-v2.sqlite`
- `SESSIONS_DIR` 默认 `/root/.openclaw/agents/main/sessions`
- `SESSIONS_INDEX_FILE` 默认 `<SESSIONS_DIR>/sessions.json`
- `RAW_STREAM_FILE` 默认 `~/.openclaw/logs/raw-stream.jsonl`
- `INGEST_POLL_MS` 默认 `3000`
- `STREAM_POLL_MS` 默认 `1000`
- `SESSION_STALL_MS` 默认 `300000`
- `SSE_HEARTBEAT_MS` 默认 `15000`
