import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { StreamQuerySchema, type RawDebugEvent } from '../domain/events';
import type { EventStore } from '../store/event-store';
import { getDefaultWorkspaceId, listWorkspaceSessionIds, resolveWorkspaceConfig } from '../workspaces';

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

function filterWorkspaceEvents(events: RawDebugEvent[], workspaceSessionIds: Set<string> | null) {
  if (!workspaceSessionIds) {
    return events;
  }

  return events.filter((event) => Boolean(event.sessionId && workspaceSessionIds.has(event.sessionId)));
}

function readWorkspaceEvents(
  store: EventStore,
  cursor: number,
  limit: number,
  sessionId?: string,
  workspaceSessionIds: Set<string> | null = null
) {
  const fetchLimit = workspaceSessionIds ? Math.max(limit * 6, limit, 300) : limit;
  const events = store.listRawStreamEntriesAfter(cursor, fetchLimit, sessionId);
  return filterWorkspaceEvents(events, workspaceSessionIds).slice(0, limit);
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

    const workspaceId = parsed.data.workspace ?? getDefaultWorkspaceId(deps.config);
    let workspaceSessionIds: Set<string> | null = null;

    if (!parsed.data.sessionId) {
      try {
        resolveWorkspaceConfig(deps.config, workspaceId);
        workspaceSessionIds = new Set(listWorkspaceSessionIds(deps.config, workspaceId));
      } catch (error) {
        reply.code(400);
        return {
          error: error instanceof Error ? error.message : 'Unknown workspace error',
        };
      }
    }

    const lastEventId = resolveResumeCursor(request.headers['last-event-id']);
    const resumeCursor = parsed.data.cursor ?? lastEventId ?? 0;
    const backfill = readWorkspaceEvents(
      deps.store,
      resumeCursor,
      parsed.data.limit,
      parsed.data.sessionId,
      workspaceSessionIds
    );
    let lastCursor = resumeCursor;
    let pollTimer: NodeJS.Timeout | null = null;

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
      liveTailReady: true,
      sessionId: parsed.data.sessionId ?? null,
      resumeCursor: lastCursor,
      latestCursor: deps.store.getLatestRawStreamCursor(parsed.data.sessionId),
      workspace: workspaceId,
    });

    const heartbeat = setInterval(() => {
      writeSseEvent(reply.raw, 'heartbeat', {
        ts: Date.now(),
        cursor: lastCursor,
      });
    }, deps.config.sseHeartbeatMs);

    pollTimer = setInterval(() => {
      const events = readWorkspaceEvents(
        deps.store,
        lastCursor,
        parsed.data.limit,
        parsed.data.sessionId,
        workspaceSessionIds
      );

      if (events.length === 0) {
        return;
      }

      lastCursor = sendBackfill(reply.raw, events);
    }, deps.config.streamPollMs);
    pollTimer.unref();

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });
}
