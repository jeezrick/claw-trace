import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { ActionHistoryParamsSchema, WorkspaceSelectionQuerySchema } from '../domain/events';
import type { EventStore } from '../store/event-store';
import { getDefaultWorkspaceId, getSessionBundleForWorkspace } from '../workspaces';

type SessionDetailDependencies = {
  config: AppConfig;
  store: EventStore;
};

export function registerSessionDetailRoutes(
  app: FastifyInstance,
  deps: SessionDetailDependencies
) {
  app.get('/api/v2/sessions/:sessionId/detail', async (request, reply) => {
    const params = ActionHistoryParamsSchema.safeParse(request.params);
    const query = WorkspaceSelectionQuerySchema.safeParse(request.query);

    if (!params.success || !query.success) {
      reply.code(400);
      return {
        error: 'Invalid session detail request',
        issues: {
          params: params.success ? null : params.error.flatten(),
          query: query.success ? null : query.error.flatten(),
        },
      };
    }

    const workspaceId = query.data.workspace ?? getDefaultWorkspaceId(deps.config);

    try {
      const bundle = getSessionBundleForWorkspace(deps.config, workspaceId, params.data.sessionId);

      return {
        sessionId: params.data.sessionId,
        session: bundle.session,
        terminalMessages: bundle.terminalMessages,
        ingestReady: true,
      };
    } catch (error) {
      reply.code(400);
      return {
        error: error instanceof Error ? error.message : 'Unknown workspace error',
      };
    }
  });
}
