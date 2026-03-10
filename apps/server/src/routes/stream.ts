import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { StreamQuerySchema, type RawDebugEvent } from '../domain/events';
import type { EventStore } from '../store/event-store';

type StreamDependencies = {
  config: AppConfig;
  store: EventStore;
};

function writeSseEvent(
  response: NodeJS.WritableStream,
  event: string,
  data: unknown,
  id?: string
) {
  if (id) {
    response.write(`id: ${id}\n`);
  }

  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function resolveResumeCursor(rawValue: string | string[] | undefined): number | undefined {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function sendBackfill(response: NodeJS.WritableStream, events: RawDebugEvent[]): number {
  let lastCursor = 0;

  for (const event of events) {
    lastCursor = event.streamCursor;
    writeSseEvent(response, 'raw', event, String(event.streamCursor));
  }

  return lastCursor;
}

export function registerStreamRoutes(app: FastifyInstance, deps: StreamDependencies) {
  app.get('/api/v2/stream', async (request, reply) => {
    const parsed = StreamQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid stream request',
        issues: parsed.error.flatten(),
      };
    }

    const lastEventId = resolveResumeCursor(request.headers['last-event-id']);
    const resumeCursor = parsed.data.cursor ?? lastEventId ?? 0;
    const backfill = deps.store.listRawStreamEntriesAfter(
      resumeCursor,
      parsed.data.limit,
      parsed.data.sessionId
    );
    let lastCursor = resumeCursor;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders?.();
    reply.raw.write('retry: 3000\n\n');

    if (backfill.length) {
      lastCursor = sendBackfill(reply.raw, backfill);
    }

    writeSseEvent(reply.raw, 'ready', {
      placeholder: true,
      liveTailReady: false,
      sessionId: parsed.data.sessionId ?? null,
      resumeCursor: lastCursor,
    });

    const heartbeat = setInterval(() => {
      writeSseEvent(reply.raw, 'heartbeat', {
        ts: Date.now(),
        cursor: lastCursor,
      });
    }, deps.config.sseHeartbeatMs);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });
}
