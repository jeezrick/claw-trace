import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import type { EventStore } from '../store/event-store';

type HealthDependencies = {
  config: AppConfig;
  store: EventStore;
};

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDependencies) {
  const handler = async () => ({
    status: 'ok',
    service: 'claw-trace-v2',
    now: Date.now(),
    databaseFile: deps.config.databaseFile,
    metrics: deps.store.getMetrics(),
  });

  app.get('/health', handler);
  app.get('/api/v2/health', handler);
}
