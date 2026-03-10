import Fastify from 'fastify';

import { loadConfig, type AppConfig } from './config';
import { createDatabase } from './db/sqlite';
import { registerActionHistoryRoutes } from './routes/action-history';
import { registerHealthRoutes } from './routes/health';
import { registerSessionRoutes } from './routes/sessions';
import { registerStreamRoutes } from './routes/stream';
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

  registerHealthRoutes(app, { config, store });
  registerSessionRoutes(app, { store });
  registerActionHistoryRoutes(app, { store });
  registerStreamRoutes(app, { config, store });

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, config };
}
