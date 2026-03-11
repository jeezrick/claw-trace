# claw-trace v2 web

React + Vite + TypeScript + Zustand phase-1 frontend。

## 当前范围

- 三栏布局：session list / action history / raw debug stream
- session list 读取 `/api/v2/sessions`
- action history 读取 `/api/v2/sessions/:sessionId/actions`
- debug stream 使用 `/api/v2/stream` 的 SSE cursor replay
- debug stream 支持 `全部 session / 当前选中 session` 显式切换
- 选中 session 在轮询刷新时会尽量保持稳定，不因列表重排而抖动
- action history 背景刷新保持增量感：保留可见内容、短暂高亮新项、尽量稳住滚动位置

## 启动

```bash
cd /root/code/claw-trace
npm run v2:web:dev
```

默认地址：`http://127.0.0.1:5174`

开发模式下 `/api` 会代理到 `http://127.0.0.1:8790`。
