import { describe, expect, it } from 'vitest';

import { externalHttpRequestConfigSchema } from '@omnicus/automation-core';

import { assertSafeExternalHttpUrl, executeExternalHttpRequest, ExternalHttpError } from './index';

describe('external HTTP target validation', () => {
  it.each([
    'http://example.com/hook',
    'https://user:password@example.com/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
  ])('rejects unsafe target %s', async (url) => {
    await expect(assertSafeExternalHttpUrl(url)).rejects.toBeInstanceOf(ExternalHttpError);
  });
});

describe('external HTTP request compilation', () => {
  const request = (overrides: Record<string, unknown>) =>
    executeExternalHttpRequest({
      config: externalHttpRequestConfigSchema.parse({
        method: 'GET',
        url: 'https://127.0.0.1/hook',
        ...overrides,
      }),
      idempotencyKey: 'operation-a',
      secretFor: async () => 'secret',
      variables: {},
    });

  it('requires secret references for authentication headers', async () => {
    await expect(
      request({ headers: [{ name: 'Authorization', value: 'Bearer visible' }] }),
    ).rejects.toMatchObject({ safeCode: 'external_http_secret_reference_required' });
  });

  it('rejects forwarding headers before opening a connection', async () => {
    await expect(
      request({ headers: [{ name: 'X-Forwarded-For', value: '203.0.113.1' }] }),
    ).rejects.toMatchObject({ safeCode: 'external_http_header_forbidden' });
  });

  it('rejects a missing template variable before opening a connection', async () => {
    await expect(request({ url: 'https://127.0.0.1/{{variables.missing}}' })).rejects.toMatchObject(
      {
        safeCode: 'external_http_variable_missing',
      },
    );
  });

  it('rejects prototype and reserved runtime response mapping paths', () => {
    expect(
      externalHttpRequestConfigSchema.safeParse({
        mappings: [
          { sourcePath: 'response.data.id', targetPath: '__proto__.polluted', type: 'string' },
        ],
        url: 'https://example.test',
      }).success,
    ).toBe(false);
    expect(
      externalHttpRequestConfigSchema.safeParse({
        mappings: [
          { sourcePath: 'response.status', targetPath: 'nodes.http.status', type: 'number' },
        ],
        url: 'https://example.test',
      }).success,
    ).toBe(false);
    expect(
      externalHttpRequestConfigSchema.safeParse({
        mappings: [{ sourcePath: 'response.data.id', targetPath: 'contact.id', type: 'string' }],
        url: 'https://example.test',
      }).success,
    ).toBe(false);
  });
});
