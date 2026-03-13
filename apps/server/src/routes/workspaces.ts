import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import { getDefaultWorkspaceId, listAgentWorkspaces } from '../workspaces';

type WorkspaceRouteDependencies = {
  config: AppConfig;
};

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRouteDependencies) {
  app.get('/api/v2/workspaces', async () => {
    return {
      items: listAgentWorkspaces(deps.config),
      defaultWorkspaceId: getDefaultWorkspaceId(deps.config),
    };
  });
}
