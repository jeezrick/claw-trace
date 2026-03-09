#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const SESSIONS_DIR = path.resolve(
  process.env.SESSIONS_DIR || '/root/.openclaw/agents/main/sessions'
);
const RAW_STREAM_FILE = path.resolve(
  process.env.RAW_STREAM_FILE || path.join(os.homedir(), '.openclaw/logs/raw-stream.jsonl')
);
const RAW_POLL_MS = Math.max(200, Number(process.env.RAW_POLL_MS || 700));
const RAW_CACHE_LIMIT = 400;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const rawClients = new Set();
const rawState = {
  started: false,
  reading: false,
  position: 0,
  inode: null,
  lineBuffer: '',
  cache: [],
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

function toJson(data) {
  return JSON.stringify(data);
}

function writeSse(res, payload, event) {
  if (event) {
    res.write(`event: ${event}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function cacheRawEntry(entry) {
  rawState.cache.push(entry);
  if (rawState.cache.length > RAW_CACHE_LIMIT) {
    rawState.cache.splice(0, rawState.cache.length - RAW_CACHE_LIMIT);
  }
}

function broadcastRawEntry(entry) {
  cacheRawEntry(entry);
  for (const client of rawClients) {
    writeSse(client, entry);
  }
}

function drainRawChunk(chunk) {
  const merged = rawState.lineBuffer + chunk;
  const lines = merged.split(/\r?\n/);
  rawState.lineBuffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      parsed = null;
    }

    broadcastRawEntry({
      ts: Date.now(),
      line: trimmed,
      parsed,
    });
  }
}

function pollRawStream() {
  if (!rawClients.size || rawState.reading) {
    return;
  }

  rawState.reading = true;

  fs.stat(RAW_STREAM_FILE, (statErr, stats) => {
    if (statErr) {
      rawState.reading = false;
      return;
    }

    const inode = stats.ino || null;
    const rotated = rawState.inode != null && inode != null && rawState.inode !== inode;
    const truncated = stats.size < rawState.position;

    if (rotated || truncated) {
      rawState.position = 0;
      rawState.lineBuffer = '';
    }

    rawState.inode = inode;

    if (!rawState.started) {
      rawState.started = true;
      rawState.position = stats.size;
      rawState.reading = false;
      return;
    }

    if (stats.size <= rawState.position) {
      rawState.reading = false;
      return;
    }

    const start = rawState.position;
    const end = stats.size - 1;
    const stream = fs.createReadStream(RAW_STREAM_FILE, {
      encoding: 'utf8',
      start,
      end,
    });

    stream.on('data', (chunk) => {
      rawState.position += Buffer.byteLength(chunk, 'utf8');
      drainRawChunk(chunk);
    });

    stream.on('error', () => {
      rawState.reading = false;
    });

    stream.on('end', () => {
      rawState.reading = false;
    });
  });
}

setInterval(pollRawStream, RAW_POLL_MS).unref();

function handleApi(req, res, parsed) {
  if (parsed.pathname === '/api/config') {
    send(
      res,
      200,
      toJson({
        sessionsDir: SESSIONS_DIR,
        rawStreamFile: RAW_STREAM_FILE,
        rawPollMs: RAW_POLL_MS,
      }),
      'application/json; charset=utf-8'
    );
    return true;
  }

  if (parsed.pathname === '/api/sessions') {
    const filePath = path.join(SESSIONS_DIR, 'sessions.json');
    fs.readFile(filePath, 'utf8', (err, text) => {
      if (err) {
        return send(
          res,
          500,
          toJson({ error: `读取 sessions.json 失败: ${err.message}` }),
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
        toJson({ error: 'file 参数无效，仅允许 *.jsonl' }),
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
          toJson({ error: `读取 ${file} 失败: ${err.message}` }),
          'application/json; charset=utf-8'
        );
      }
      send(res, 200, text, 'text/plain; charset=utf-8');
    });
    return true;
  }

  if (parsed.pathname === '/api/raw-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const replay = Math.max(0, Math.min(200, Number(parsed.query.replay || 80)));

    writeSse(
      res,
      {
        rawStreamFile: RAW_STREAM_FILE,
        replay,
        connectedAt: Date.now(),
      },
      'meta'
    );

    if (replay > 0 && rawState.cache.length) {
      const recent = rawState.cache.slice(-replay);
      for (const entry of recent) {
        writeSse(res, entry);
      }
    }

    rawClients.add(res);

    req.on('close', () => {
      rawClients.delete(res);
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
  console.log(`Raw stream file: ${RAW_STREAM_FILE}`);
});
