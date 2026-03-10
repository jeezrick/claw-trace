import path from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DATABASE_FILE: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseFile: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  sseHeartbeatMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV ?? 'development',
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8790,
    databaseFile: path.resolve(process.cwd(), parsed.DATABASE_FILE ?? 'data/claw-trace-v2.sqlite'),
    logLevel: parsed.LOG_LEVEL ?? 'info',
    sseHeartbeatMs: parsed.SSE_HEARTBEAT_MS ?? 15_000,
  };
}
