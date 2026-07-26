import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jestBin = require.resolve('jest/bin/jest');
const requiredFlag = '--experimental-vm-modules';
const existingOptions = process.env.NODE_OPTIONS?.trim();
const nodeOptions = existingOptions?.includes(requiredFlag)
  ? existingOptions
  : [existingOptions, requiredFlag].filter(Boolean).join(' ');

const result = spawnSync(process.execPath, [jestBin, ...process.argv.slice(2)], {
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
