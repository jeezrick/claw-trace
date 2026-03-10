import type { FastifyInstance } from 'fastify';

import {
  ActionHistoryParamsSchema,
  ActionHistoryQuerySchema,
} from '../domain/events';
import type { EventStore } from '../store/event-store';

type ActionHistoryDependencies = {
  store: EventStore;
};

export function registerActionHistoryRoutes(
  app: FastifyInstance,
  deps: ActionHistoryDependencies
) {
  app.get('/api/v2/sessions/:sessionId/actions', async (request, reply) => {
    const params = ActionHistoryParamsSchema.safeParse(request.params);
    const query = ActionHistoryQuerySchema.safeParse(request.query);

    if (!params.success || !query.success) {
      reply.code(400);
      return {
        error: 'Invalid action history request',
        issues: {
          params: params.success ? null : params.error.flatten(),
          query: query.success ? null : query.error.flatten(),
        },
      };
    }

    const session = deps.store.getSession(params.data.sessionId);

    return {
      sessionId: params.data.sessionId,
      session,
      items: deps.store.listActionHistory(params.data.sessionId, query.data.limit),
      placeholder: true,
      ingestReady: false,
    };
  });
}
