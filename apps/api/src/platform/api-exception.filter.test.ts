import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SAFE_API_CODE_MESSAGES } from './api-exception.filter';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (extname(entry.name) !== '.ts' || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

function codeOnlyApiErrors(): string[] {
  const sourceRoot = join(process.cwd(), 'src');
  const codes = new Set<string>();
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/throw\s+new\s+\w+Exception\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const body = match[1] ?? '';
      const code = body.match(/code:\s*'([A-Z0-9_]+)'/)?.[1];
      if (code && !/message\s*:/.test(body)) codes.add(code);
    }
  }
  return [...codes].sort();
}

describe('safe API error messages', () => {
  it('covers every code-only API exception with a human-readable explanation', () => {
    const uncovered = codeOnlyApiErrors().filter(
      (code) => !/[a-z]/i.test(SAFE_API_CODE_MESSAGES[code] ?? ''),
    );
    expect(uncovered).toEqual([]);
  });
});
