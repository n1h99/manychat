const entrypoint = new URL('../dist/esm/web.js', import.meta.url);
const module = await import(entrypoint.href);

if (typeof module.validateWebEnvironment !== 'function') {
  throw new Error('@omnicus/config/web must export validateWebEnvironment');
}

process.stdout.write(`${JSON.stringify({ check: 'config-web-export', status: 'passed' })}\n`);
