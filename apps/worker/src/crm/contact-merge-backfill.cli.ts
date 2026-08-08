import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ContactMergeBackfillModule } from './contact-merge-backfill.module';
import { ContactMergeBackfillService } from './contact-merge-backfill.service';

interface CliOptions {
  batchSize: number;
  dryRun: boolean;
  projectId?: string;
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function options(args: string[]): CliOptions {
  const execute = args.includes('--execute');
  const explicitDryRun = args.includes('--dry-run');
  if (execute && explicitDryRun) throw new Error('Use either --dry-run or --execute');
  const batchSizeValue = optionValue(args, '--batch-size');
  const batchSize = batchSizeValue ? Number(batchSizeValue) : 50;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
    throw new Error('--batch-size must be an integer from 1 to 500');
  const projectId = optionValue(args, '--project-id');
  return {
    batchSize,
    dryRun: !execute,
    ...(projectId ? { projectId } : {}),
  };
}

async function main() {
  const logger = new ConsoleLogger({ json: true, prefix: 'contact-merge-backfill' });
  const app = await NestFactory.createApplicationContext(ContactMergeBackfillModule, {
    logger,
  });
  try {
    const report = await app.get(ContactMergeBackfillService).run(options(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.conflicts.length || report.failed.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
