# claw-trace v2 web

React + Vite + TypeScript + Zustand phase-1 frontend。

## 当前范围

- 三栏布局：session list / action history / raw debug stream
- session list 读取 `/api/v2/sessions`
- action history 读取 `/api/v2/sessions/:sessionId/actions`
- debug stream 使用 `/api/v2/stream` 的 SSE cursor replay
- 保持全局 raw stream 连接，session 选择仅影响 action history 面板

## 启动

```bash
cd /root/code/claw-trace
npm run v2:web:dev
```

默认地址：`http://127.0.0.1:5174`

开发模式下 `/api` 会代理到 `http://127.0.0.1:8790`。
