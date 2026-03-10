import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DATABASE_FILE: z.string().min(1).optional(),
  SESSIONS_DIR: z.string().min(1).optional(),
  SESSIONS_INDEX_FILE: z.string().min(1).optional(),
  RAW_STREAM_FILE: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  INGEST_POLL_MS: z.coerce.number().int().min(500).max(120_000).optional(),
  STREAM_POLL_MS: z.coerce.number().int().min(250).max(30_000).optional(),
  SESSION_STALL_MS: z.coerce.number().int().min(30_000).max(86_400_000).optional(),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseFile: string;
  sessionsDir: string;
  sessionsIndexFile: string;
  rawStreamFile: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  ingestPollMs: number;
  streamPollMs: number;
  sessionStallMs: number;
  sseHeartbeatMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const sessionsDir = path.resolve(
    parsed.SESSIONS_DIR ?? '/root/.openclaw/agents/main/sessions'
  );
  const defaultDatabaseFile = path.resolve(__dirname, '../data/claw-trace-v2.sqlite');

  return {
    nodeEnv: parsed.NODE_ENV ?? 'development',
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8790,
    databaseFile: parsed.DATABASE_FILE
      ? path.resolve(parsed.DATABASE_FILE)
      : defaultDatabaseFile,
    sessionsDir,
    sessionsIndexFile: path.resolve(
      parsed.SESSIONS_INDEX_FILE ?? path.join(sessionsDir, 'sessions.json')
    ),
    rawStreamFile: path.resolve(
      parsed.RAW_STREAM_FILE ?? path.join(os.homedir(), '.openclaw/logs/raw-stream.jsonl')
    ),
    logLevel: parsed.LOG_LEVEL ?? 'info',
    ingestPollMs: parsed.INGEST_POLL_MS ?? 3_000,
    streamPollMs: parsed.STREAM_POLL_MS ?? 1_000,
    sessionStallMs: parsed.SESSION_STALL_MS ?? 5 * 60_000,
    sseHeartbeatMs: parsed.SSE_HEARTBEAT_MS ?? 15_000,
  };
}
