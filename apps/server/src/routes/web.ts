import fs from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

async function fileExists(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (_error) {
    return false;
  }
}

function resolveContentType(filePath: string) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

export function registerWebRoutes(app: FastifyInstance) {
  const webRoot = path.resolve(__dirname, '../../../web/dist');
  const indexFile = path.join(webRoot, 'index.html');

  app.get('/*', async (request, reply) => {
    const wildcard =
      typeof (request.params as { '*': string })['*'] === 'string'
        ? (request.params as { '*': string })['*']
        : '';
    const relativePath = wildcard.replace(/^\/+/, '');
    const candidatePath = relativePath ? path.resolve(webRoot, relativePath) : indexFile;

    if (!candidatePath.startsWith(webRoot)) {
      reply.code(403);
      return { error: 'Forbidden' };
    }

    const hasFileExtension = path.extname(relativePath).length > 0;
    const assetPath = hasFileExtension ? candidatePath : indexFile;
    const fallbackToIndex = !hasFileExtension || !(await fileExists(assetPath));
    const filePath = fallbackToIndex ? indexFile : assetPath;

    if (!(await fileExists(filePath))) {
      reply.code(503);
      return {
        error: 'Web assets not found',
        expectedRoot: webRoot,
      };
    }

    reply.header('Cache-Control', fallbackToIndex ? 'no-store' : 'public, max-age=31536000, immutable');
    reply.type(resolveContentType(filePath));
    return reply.send(await fs.readFile(filePath));
  });
}
