import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const distDirectory = resolve(import.meta.dirname, '../apps/web/dist');
const assetDirectory = resolve(distDirectory, 'assets');
const forbiddenMarkers = [
  'APP_ENV',
  'CORS_ALLOWED_ORIGINS',
  'DATABASE_URL',
  'REDIS_URL',
  'TRUST_PROXY',
  'rootEnvironmentFilePath',
  'validateApiEnvironment',
  'validateWorkerEnvironment',
  'postgresql://',
];
const failures = [];

for (const entry of readdirSync(distDirectory, { recursive: true })) {
  if (extname(entry) === '.map') {
    failures.push(`Production source map exists: ${entry}`);
  }
}

for (const asset of readdirSync(assetDirectory)) {
  if (extname(asset) !== '.js') {
    continue;
  }

  const content = readFileSync(resolve(assetDirectory, asset), 'utf8');
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      failures.push(`Server-only marker ${marker} leaked into ${asset}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ check: 'web-bundle-boundary', status: 'passed' })}\n`);
