import type { FastifyInstance } from 'fastify';

import { ActionHistoryParamsSchema } from '../domain/events';
import { buildSessionDetail } from '../domain/session-detail';
import type { EventStore } from '../store/event-store';

type SessionDetailDependencies = {
  store: EventStore;
};

export function registerSessionDetailRoutes(
  app: FastifyInstance,
  deps: SessionDetailDependencies
) {
  app.get('/api/v2/sessions/:sessionId/detail', async (request, reply) => {
    const params = ActionHistoryParamsSchema.safeParse(request.params);

    if (!params.success) {
      reply.code(400);
      return {
        error: 'Invalid session detail request',
        issues: params.error.flatten(),
      };
    }

    const session = deps.store.getSession(params.data.sessionId);
    const actions = deps.store.listAllActionHistory(params.data.sessionId);
    const detail = buildSessionDetail(session, actions);

    return {
      sessionId: params.data.sessionId,
      session: detail.session,
      terminalMessages: detail.terminalMessages,
      ingestReady: true,
    };
  });
}
