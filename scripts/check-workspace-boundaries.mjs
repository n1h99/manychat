import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const workspaceDirectories = ['apps', 'packages'].flatMap((group) => {
  const groupDirectory = resolve(repositoryRoot, group);
  return readdirSync(groupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(groupDirectory, entry.name));
});
const manifests = new Map(
  workspaceDirectories.map((directory) => {
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return [manifest.name, { directory, manifest }];
  }),
);
const graph = new Map();
const failures = [];
const ignoredDirectoryNames = new Set([
  '.git',
  '.runtime',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
]);
const sourceExtensions = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx']);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        yield* sourceFiles(file);
      }
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      yield file;
    }
  }
}

for (const [name, { manifest }] of manifests) {
  const dependencyNames = new Set(
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
      .flatMap((field) => Object.keys(manifest[field] ?? {}))
      .filter((dependency) => manifests.has(dependency)),
  );
  graph.set(name, dependencyNames);
}

const visited = new Set();
const visiting = [];

function visit(name) {
  if (visited.has(name)) {
    return;
  }
  const cycleStart = visiting.indexOf(name);
  if (cycleStart !== -1) {
    failures.push(
      `Workspace dependency cycle: ${[...visiting.slice(cycleStart), name].join(' -> ')}`,
    );
    return;
  }

  visiting.push(name);
  for (const dependency of graph.get(name) ?? []) {
    visit(dependency);
  }
  visiting.pop();
  visited.add(name);
}

for (const name of graph.keys()) {
  visit(name);
}

for (const { directory } of manifests.values()) {
  for (const file of sourceFiles(directory)) {
    const content = readFileSync(file, 'utf8');
    if (
      /@omnicus\/[^/'"]+\/src(?:\/|['"])/.test(content) ||
      /(?:\.\.\/)+packages\/[^/]+\/src(?:\/|['"])/.test(content)
    ) {
      failures.push(`Internal workspace src import: ${file}`);
    }
  }
}

const webDirectory = resolve(repositoryRoot, 'apps/web');
for (const file of sourceFiles(webDirectory)) {
  const content = readFileSync(file, 'utf8');
  if (content.includes('@omnicus/config/server')) {
    failures.push(`Web imports the server configuration entry point: ${file}`);
  }
}

const configPackage = manifests.get('@omnicus/config')?.manifest;
for (const entryPoint of ['./server', './web']) {
  if (!configPackage?.exports?.[entryPoint]) {
    failures.push(`@omnicus/config is missing the ${entryPoint} export`);
  }
}

for (const [name, { directory, manifest }] of manifests) {
  if (
    directory.startsWith(`${resolve(repositoryRoot, 'packages')}\\`) ||
    directory.startsWith(`${resolve(repositoryRoot, 'packages')}/`)
  ) {
    if (!manifest.exports?.['.']) {
      failures.push(`${name} is missing an explicit root package export`);
    }
  }
}

const viteConfig = readFileSync(resolve(webDirectory, 'vite.config.ts'), 'utf8');
if (/\balias\s*:/.test(viteConfig)) {
  failures.push('Web Vite config contains a source alias that bypasses package exports');
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    check: 'workspace-boundaries',
    cycles: 0,
    packages: manifests.size,
    status: 'passed',
  })}\n`,
);
