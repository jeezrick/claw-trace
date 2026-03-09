#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const SESSIONS_DIR = path.resolve(
  process.env.SESSIONS_DIR || '/root/.openclaw/agents/main/sessions'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safeSessionFile(name = '') {
  const base = path.basename(name);
  if (!base) return null;
  if (base === 'sessions.json') return base;
  if (/^[a-f0-9-]+\.jsonl$/.test(base)) return base;
  return null;
}

function handleApi(req, res, parsed) {
  if (parsed.pathname === '/api/sessions') {
    const filePath = path.join(SESSIONS_DIR, 'sessions.json');
    fs.readFile(filePath, 'utf8', (err, text) => {
      if (err) {
        return send(
          res,
          500,
          JSON.stringify({ error: `读取 sessions.json 失败: ${err.message}` }),
          'application/json; charset=utf-8'
        );
      }
      send(res, 200, text, 'application/json; charset=utf-8');
    });
    return true;
  }

  if (parsed.pathname === '/api/session-file') {
    const file = safeSessionFile(parsed.query.file);
    if (!file || file === 'sessions.json') {
      send(
        res,
        400,
        JSON.stringify({ error: 'file 参数无效，仅允许 *.jsonl' }),
        'application/json; charset=utf-8'
      );
      return true;
    }

    const filePath = path.join(SESSIONS_DIR, file);
    fs.readFile(filePath, 'utf8', (err, text) => {
      if (err) {
        return send(
          res,
          404,
          JSON.stringify({ error: `读取 ${file} 失败: ${err.message}` }),
          'application/json; charset=utf-8'
        );
      }
      send(res, 200, text, 'text/plain; charset=utf-8');
    });
    return true;
  }

  return false;
}

function serveStatic(req, res, parsed) {
  const reqPath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, 'Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'GET' && handleApi(req, res, parsed)) {
    return;
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, parsed);
  }

  send(res, 405, 'Method Not Allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`Trace service running at http://${HOST}:${PORT}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Sessions dir: ${SESSIONS_DIR}`);
});
