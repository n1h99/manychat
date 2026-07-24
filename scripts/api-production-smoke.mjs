import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to reserve an API smoke-test port');
  }
  const { port } = address;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return port;
}

const port = await reservePort();
const serviceIntegration = process.env.RUN_SERVICE_INTEGRATION === 'true';
const child = spawn(process.execPath, [resolve(repositoryRoot, '.runtime/api/dist/main.js')], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    API_HOST: '127.0.0.1',
    APP_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://stage-zero.example',
    DATABASE_URL: serviceIntegration
      ? process.env.DATABASE_URL
      : 'postgresql://unavailable:unavailable@127.0.0.1:1/omnicus_smoke',
    NODE_ENV: 'production',
    PORT: String(port),
    REDIS_URL: serviceIntegration ? process.env.REDIS_URL : 'redis://127.0.0.1:1/0',
    SWAGGER_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

let checkError;
try {
  const deadline = Date.now() + 20_000;
  let liveResponse;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      liveResponse = await fetch(`http://127.0.0.1:${port}/health/live`, {
        headers: { 'x-correlation-id': 'api-production-smoke' },
      });
      if (liveResponse.status === 200) {
        break;
      }
    } catch {
      // The production process has not opened its HTTP socket yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }

  if (!liveResponse || liveResponse.status !== 200) {
    throw new Error(`API production liveness smoke failed:\n${output}`);
  }
  if (liveResponse.headers.get('x-correlation-id') !== 'api-production-smoke') {
    throw new Error('API production response lost its correlation ID');
  }
  if (liveResponse.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('API production response is missing baseline security headers');
  }

  const swaggerResponse = await fetch(`http://127.0.0.1:${port}/docs`);
  if (swaggerResponse.status !== 404) {
    throw new Error(`Swagger must be disabled in production; received ${swaggerResponse.status}`);
  }

  const readyResponse = await fetch(`http://127.0.0.1:${port}/health/ready`);
  const expectedReadyStatus = serviceIntegration ? 200 : 503;
  if (readyResponse.status !== expectedReadyStatus) {
    throw new Error(
      `API readiness expected ${expectedReadyStatus}, received ${readyResponse.status}:\n${output}`,
    );
  }
  if (!serviceIntegration) {
    const readyBody = await readyResponse.json();
    if (
      readyBody?.error?.code !== 'DEPENDENCY_UNAVAILABLE' ||
      readyBody?.error?.details !== null ||
      JSON.stringify(readyBody).includes('unavailable:unavailable')
    ) {
      throw new Error('API production readiness leaked dependency details');
    }
  }
} catch (error) {
  checkError = error;
}

const exitPromise =
  child.exitCode === null
    ? new Promise((resolveExit) => child.once('exit', resolveExit))
    : Promise.resolve(child.exitCode);
if (child.exitCode === null) {
  child.kill('SIGTERM');
}
const exitResult = await Promise.race([
  exitPromise,
  new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 15_000)),
]);

if (exitResult === 'timeout') {
  child.kill('SIGKILL');
  throw new Error('API production process exceeded its graceful shutdown deadline');
}
if (checkError) {
  throw checkError;
}

process.stdout.write(
  `${JSON.stringify({
    check: 'api-production-runtime',
    dependencyReadiness: serviceIntegration ? 'up' : 'safe-503',
    portBinding: true,
    status: 'passed',
  })}\n`,
);
