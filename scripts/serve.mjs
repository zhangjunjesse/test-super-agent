import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Tiny static file server for local play and browser tests.
 * @param {string} [rootDir] directory to serve, defaults to the project root
 */
export function createStaticServer(rootDir = PROJECT_ROOT) {
  const root = resolve(rootDir);

  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = normalize(pathname).replace(/^[/\\]+/, '');
      const requested = resolve(join(root, relative));
      const isRootRequest = requested === root;

      if (!isRootRequest && !requested.startsWith(root + sep)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
      }

      const target = isRootRequest || pathname.endsWith('/') ? join(requested, 'index.html') : requested;
      const contents = await readFile(target);
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(contents);
    } catch (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  const port = Number(process.env.PORT) || 4173;
  const server = createStaticServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`霓虹贪吃蛇已启动：http://127.0.0.1:${port}`);
  });
}
