import { rmSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const requestedTarget = process.argv[2];

if (!requestedTarget) {
  throw new Error('A workspace dist path is required');
}

const target = resolve(repositoryRoot, requestedTarget);
const relativeTarget = relative(repositoryRoot, target);
const allowedTarget =
  basename(target) === 'dist' &&
  !relativeTarget.startsWith('..') &&
  !relativeTarget.includes(`..${sep}`) &&
  /^(?:apps|packages)[\\/][^\\/]+[\\/]dist$/.test(relativeTarget);

if (!allowedTarget) {
  throw new Error(`Refusing to clean a non-workspace output path: ${target}`);
}

rmSync(target, { force: true, recursive: true });
