import type { FastifyInstance } from 'fastify';

import { SessionListQuerySchema } from '../domain/events';
import type { EventStore } from '../store/event-store';

type SessionRouteDependencies = {
  store: EventStore;
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
      placeholder: true,
      ingestReady: false,
      meta: deps.store.getMetrics(),
    };
  });
}
