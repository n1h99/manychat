import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
);
const expectedPnpm = packageJson.packageManager.split('@').at(-1);
const nodeMajor = Number(process.versions.node.split('.')[0]);
const userAgent = process.env.npm_config_user_agent ?? '';
const actualPnpm = userAgent.match(/(?:^|\s)pnpm\/([^\s]+)/)?.[1];
const failures = [];

if (nodeMajor !== 24) {
  failures.push(`Node.js 24.x is required; received ${process.version}`);
}

if (actualPnpm !== expectedPnpm) {
  failures.push(
    `pnpm ${expectedPnpm} is required; received ${actualPnpm ?? 'unknown package manager'}`,
  );
}

if (!process.env.npm_execpath || !/(?:corepack|pnpm)/i.test(process.env.npm_execpath)) {
  failures.push('pnpm lifecycle metadata is missing; run through Corepack/pnpm');
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`preflight: ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    node: process.version,
    packageManager: `pnpm@${actualPnpm}`,
    status: 'passed',
  })}\n`,
);
