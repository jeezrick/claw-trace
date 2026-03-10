import { buildServer } from './app';

async function main() {
  const { app, config } = await buildServer();

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
