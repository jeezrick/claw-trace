import Fastify from 'fastify';

import { loadConfig, type AppConfig } from './config';
import { createDatabase } from './db/sqlite';
import { createIngestService } from './ingest/service';
import { registerActionHistoryRoutes } from './routes/action-history';
import { registerHealthRoutes } from './routes/health';
import { registerSessionDetailRoutes } from './routes/session-detail';
import { registerSessionRoutes } from './routes/sessions';
import { registerStreamRoutes } from './routes/stream';
import { registerWebRoutes } from './routes/web';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { createEventStore } from './store/event-store';

export async function buildServer(config: AppConfig = loadConfig()) {
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
          },
  });

  const db = createDatabase(config);
  const store = createEventStore(db);
  const ingest = createIngestService(config, store);

  ingest.start();

  registerHealthRoutes(app, { config, store, ingest });
  registerWorkspaceRoutes(app, { config });
  registerSessionRoutes(app, { config, store, ingest });
  registerSessionDetailRoutes(app, { config });
  registerActionHistoryRoutes(app, { config });
  registerStreamRoutes(app, { config, store, ingest });
  registerWebRoutes(app);

  app.addHook('onClose', async () => {
    ingest.stop();
    db.close();
  });

  return { app, config };
}
