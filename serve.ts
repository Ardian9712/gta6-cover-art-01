import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./app/', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
};

export function createLocalServer() {
  return createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Use GET or HEAD for this static preview.');
    return;
  }
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(resolve(root) + sep)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const info = statSync(path);
    if (!info.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(path);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    }
  } catch {
    response.writeHead(404).end('Not found');
  }
  });
}

export async function smokeLocalServer() {
  const server = createLocalServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback server address.');
  const origin = `http://127.0.0.1:${address.port}`;
  const cases = [
    ['/', 'GET', 200, 'text/html'],
    ['/style.css', 'HEAD', 200, 'text/css'],
    ['/studio.min.js', 'GET', 200, 'text/javascript'],
    ['/samples/offline-photos.min.js', 'HEAD', 200, 'text/javascript'],
    ['/samples/pier.jpg', 'GET', 200, 'image/jpeg'],
    ['/not-here', 'GET', 404, ''],
    ['/%2e%2e%2fLICENSE', 'GET', 404, ''],
    ['/%ZZ', 'GET', 404, ''],
    ['/', 'POST', 405, ''],
  ] as const;
  const results = [];
  try {
    for (const [path, method, status, contentType] of cases) {
      const response = await fetch(`${origin}${path}`, { method });
      const body = new Uint8Array(await response.arrayBuffer());
      if (response.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${response.status}.`);
      if (contentType && !response.headers.get('content-type')?.startsWith(contentType)) throw new Error(`Wrong MIME for ${path}.`);
      if (status === 200) {
        const length = Number(response.headers.get('content-length'));
        if (!length || (method === 'HEAD' ? body.length !== 0 : body.length !== length)) throw new Error(`Wrong body length for ${path}.`);
        if (response.headers.get('cache-control') !== 'no-store') throw new Error('Preview caching changed.');
      }
      if (status === 405 && response.headers.get('allow') !== 'GET, HEAD') throw new Error('Wrong allowed methods.');
      results.push({ path, method, status, bodyBytes: body.length });
    }
    return { passed: results.length, loopbackOnly: true, checks: results };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--smoke')) {
  console.log(JSON.stringify(await smokeLocalServer(), null, 2));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createLocalServer();
  server.on('error', (error) => { console.error(`Local preview failed: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Viceframe is available at http://127.0.0.1:${port}`);
  });
}
