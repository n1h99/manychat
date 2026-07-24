import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.url === '/health/live' || request.url === '/health/ready') {
    sendJson(response, 200, { data: { service: 'web', status: 'live' }, meta: {} });
    return;
  }

  const requestPath = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  const normalizedPath = normalize(requestPath).replace(/^([/\\])+/, '');
  const candidate = join(distDirectory, normalizedPath);
  const safeCandidate = candidate.startsWith(distDirectory)
    ? candidate
    : join(distDirectory, 'index.html');

  let filePath = safeCandidate;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
  } catch {
    filePath = join(distDirectory, 'index.html');
  }

  if (!existsSync(filePath)) {
    sendJson(response, 503, {
      error: {
        code: 'WEB_BUILD_MISSING',
        message: 'Web build is not available',
      },
    });
    return;
  }

  response.writeHead(200, {
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000',
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ level: 'log', message: 'Web server started', host, port, service: 'web' })}\n`,
  );
});

function shutdown(signal) {
  process.stdout.write(
    `${JSON.stringify({ level: 'log', message: 'Web server shutting down', service: 'web', signal })}\n`,
  );
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
