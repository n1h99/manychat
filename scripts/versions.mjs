const userAgent = process.env.npm_config_user_agent ?? '';
const pnpmVersion = userAgent.match(/(?:^|\s)pnpm\/([^\s]+)/)?.[1] ?? 'unknown';

process.stdout.write(
  `${JSON.stringify({
    node: process.version,
    nodeExecutable: process.execPath,
    packageManagerEntrypoint: process.env.npm_execpath ?? 'unknown',
    platform: `${process.platform}-${process.arch}`,
    pnpm: pnpmVersion,
  })}\n`,
);
