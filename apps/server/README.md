# claw-trace v2 server

Fastify + TypeScript + SQLite 基础骨架。

## 当前范围

- 健康检查路由
- session 列表占位路由
- action history 占位路由
- SSE stream 占位路由（支持 `cursor` / `Last-Event-ID` resume）
- SQLite 初始化与规范化表结构

## 启动

```bash
cd /root/code/claw-trace
npm run v2:server:dev
```

默认地址：`http://127.0.0.1:8790`

## 环境变量

- `HOST` 默认 `127.0.0.1`
- `PORT` 默认 `8790`
- `DATABASE_FILE` 默认 `data/claw-trace-v2.sqlite`
- `SSE_HEARTBEAT_MS` 默认 `15000`
