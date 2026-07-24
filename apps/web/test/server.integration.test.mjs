import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createWebServer } from '../server.mjs';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
let baseUrl;
let server;

function rawRequest(path) {
  return new Promise((resolve, reject) => {
    const target = new URL(baseUrl);
    const outgoing = request(
      {
        host: target.hostname,
        method: 'GET',
        path,
        port: target.port,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode,
          });
        });
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

before(async () => {
  server = createWebServer({
    distDirectory,
    logger: () => undefined,
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
});

test('returns 400 for malformed percent encoding and keeps serving requests', async () => {
  const malformed = await rawRequest('/%E0%A4%A');
  assert.equal(malformed.status, 400);
  assert.equal(JSON.parse(malformed.body).error.code, 'MALFORMED_URL');

  const health = await fetch(`${baseUrl}/health/live`);
  assert.equal(health.status, 200);
});

test('serves the SPA fallback for an extensionless route', async () => {
  const response = await fetch(`${baseUrl}/contacts/deep-link`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root"><\/div>/);
});

test('returns 404 instead of the SPA for a missing asset', async () => {
  const response = await fetch(`${baseUrl}/assets/missing-stage-zero.js`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'ASSET_NOT_FOUND');
});

test('exposes live and ready health endpoints', async () => {
  const live = await fetch(`${baseUrl}/health/live`);
  const ready = await fetch(`${baseUrl}/health/ready`);

  assert.equal(live.status, 200);
  assert.equal(ready.status, 200);
  assert.equal((await live.json()).data.status, 'live');
  assert.equal((await ready.json()).data.status, 'ready');
});

test('serves a hashed production static asset', async () => {
  const indexResponse = await fetch(`${baseUrl}/`);
  const index = await indexResponse.text();
  const assetPath = index.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];

  assert(assetPath, 'The production index must reference a hashed asset');
  const assetResponse = await fetch(`${baseUrl}${assetPath}`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get('cache-control') ?? '', /immutable/);
  assert.notEqual((await assetResponse.arrayBuffer()).byteLength, 0);
});

test('contains file-open failures without terminating the request server', async () => {
  const index = await (await fetch(`${baseUrl}/`)).text();
  const assetPath = index.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert(assetPath);

  const failingServer = createWebServer({
    distDirectory,
    fileOpener: async () => {
      const error = new Error('simulated read failure');
      error.code = 'EIO';
      throw error;
    },
    logger: () => undefined,
  });
  await new Promise((resolveListen) => failingServer.listen(0, '127.0.0.1', resolveListen));
  const address = failingServer.address();
  assert(address && typeof address === 'object');

  const response = await fetch(`http://127.0.0.1:${address.port}${assetPath}`);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'WEB_INTERNAL_ERROR');

  const liveAfterFailure = await fetch(`http://127.0.0.1:${address.port}/health/live`);
  assert.equal(liveAfterFailure.status, 200);

  await new Promise((resolveClose, rejectClose) => {
    failingServer.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
});
