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
    throw new Error('Unable to reserve a worker smoke-test port');
  }
  const { port } = address;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return port;
}

const port = await reservePort();
const child = spawn(process.execPath, [resolve(repositoryRoot, '.runtime/worker/dist/main.js')], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    APP_ENV: 'test',
    CHANNEL_SECRETS_KEY: process.env.CHANNEL_SECRETS_KEY ?? Buffer.alloc(32, 13).toString('base64'),
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://omnicus:omnicus@127.0.0.1:5432/omnicus_test',
    DEMO_JOB_ENABLED: 'false',
    NODE_ENV: 'test',
    PORT: String(port),
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0',
    WORKER_HOST: '127.0.0.1',
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

const deadline = Date.now() + 20_000;
let ready = false;
while (Date.now() < deadline && child.exitCode === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    if (response.status === 200) {
      ready = true;
      break;
    }
  } catch {
    // The HTTP server opens only after the BullMQ consumer is ready.
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
}

if (!ready) {
  child.kill('SIGTERM');
  throw new Error(`Worker production readiness smoke failed:\n${output}`);
}

const exitPromise =
  child.exitCode === null
    ? new Promise((resolveExit) => child.once('exit', resolveExit))
    : Promise.resolve(child.exitCode);
if (child.exitCode === null) {
  child.kill('SIGTERM');
}
const exitCode = await Promise.race([
  exitPromise,
  new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 15_000)),
]);

if (exitCode === 'timeout') {
  child.kill('SIGKILL');
  throw new Error('Worker production process exceeded its graceful shutdown deadline');
}

process.stdout.write(
  `${JSON.stringify({
    check: 'worker-production-readiness',
    portBinding: true,
    status: 'passed',
  })}\n`,
);
