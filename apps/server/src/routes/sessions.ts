import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { SessionListQuerySchema } from '../domain/events';
import type { IngestService } from '../ingest/service';
import type { EventStore } from '../store/event-store';
import { getDefaultWorkspaceId, listSessionsForWorkspace } from '../workspaces';

type SessionRouteDependencies = {
  config: AppConfig;
  store: EventStore;
  ingest: IngestService;
};

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDependencies) {
  app.get('/api/v2/sessions', async (request, reply) => {
    const parsed = SessionListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid session list query',
        issues: parsed.error.flatten(),
      };
    }

    const workspaceId = parsed.data.workspace ?? getDefaultWorkspaceId(deps.config);

    try {
      return {
        items: listSessionsForWorkspace(deps.config, workspaceId, parsed.data.limit),
        nextCursor: null,
        ingestReady: deps.ingest.getState().initialLoadCompleted,
        meta: {
          ...deps.store.getMetrics(),
          workspaceId,
          ingest: deps.ingest.getState(),
        },
      };
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : 'Unknown workspace error',
      };
    }
  });
}
