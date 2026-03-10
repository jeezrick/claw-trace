import type { FastifyInstance } from 'fastify';

import { SessionListQuerySchema } from '../domain/events';
import type { IngestService } from '../ingest/service';
import type { EventStore } from '../store/event-store';

type SessionRouteDependencies = {
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

    return {
      items: deps.store.listSessions(parsed.data.limit),
      nextCursor: null,
      ingestReady: deps.ingest.getState().initialLoadCompleted,
      meta: {
        ...deps.store.getMetrics(),
        ingest: deps.ingest.getState(),
      },
    };
  });
}
