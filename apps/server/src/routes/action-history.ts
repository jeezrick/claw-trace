import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { ActionHistoryParamsSchema, ActionHistoryQuerySchema } from '../domain/events';
import { getDefaultWorkspaceId, getSessionBundleForWorkspace } from '../workspaces';

type ActionHistoryDependencies = {
  config: AppConfig;
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

    const workspaceId = query.data.workspace ?? getDefaultWorkspaceId(deps.config);

    try {
      const bundle = getSessionBundleForWorkspace(deps.config, workspaceId, params.data.sessionId);

      return {
        sessionId: params.data.sessionId,
        session: bundle.session,
        items: bundle.actions.slice(-query.data.limit),
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
