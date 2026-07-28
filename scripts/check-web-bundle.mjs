import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const distDirectory = resolve(import.meta.dirname, '../apps/web/dist');
const assetDirectory = resolve(distDirectory, 'assets');
const maximumEntryBytes = 250 * 1024;
const forbiddenMarkers = [
  'APP_ENV',
  'CORS_ALLOWED_ORIGINS',
  'CHANNEL_SECRETS_KEY',
  'CRM_AUTH_TOKEN',
  'DATABASE_URL',
  'MEDIA_BUCKET_ACCESS_KEY_ID',
  'MEDIA_BUCKET_SECRET_ACCESS_KEY',
  'MEDIA_BUCKET_ENDPOINT',
  'REDIS_URL',
  'TRUST_PROXY',
  'rootEnvironmentFilePath',
  'validateApiEnvironment',
  'validateWorkerEnvironment',
  'postgresql://',
];
const failures = [];
const indexHtml = readFileSync(resolve(distDirectory, 'index.html'), 'utf8');
const entryAsset = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
let entryBytes = 0;

if (!entryAsset) {
  failures.push('Production HTML does not reference a JavaScript entry asset');
} else {
  entryBytes = statSync(resolve(assetDirectory, entryAsset)).size;
  if (entryBytes > maximumEntryBytes) {
    failures.push(
      `Production entry asset is ${entryBytes} bytes; maximum is ${maximumEntryBytes} bytes`,
    );
  }
}

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

process.stdout.write(
  `${JSON.stringify({
    check: 'web-bundle-boundary',
    entryBytes,
    maximumEntryBytes,
    status: 'passed',
  })}\n`,
);
