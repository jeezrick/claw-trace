import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';
import type { IngestService } from '../ingest/service';
import type { EventStore } from '../store/event-store';

type HealthDependencies = {
  config: AppConfig;
  store: EventStore;
  ingest: IngestService;
};

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDependencies) {
  const handler = async () => {
    const ingest = deps.ingest.getState();

    return {
      status: ingest.sessionSyncError || ingest.rawSyncError ? 'degraded' : 'ok',
      service: 'claw-trace-v2',
      now: Date.now(),
      databaseFile: deps.config.databaseFile,
      sources: {
        sessionsIndexFile: deps.config.sessionsIndexFile,
        rawStreamFile: deps.config.rawStreamFile,
      },
      ingest,
      metrics: deps.store.getMetrics(),
    };
  };

  app.get('/health', handler);
  app.get('/api/v2/health', handler);
}
