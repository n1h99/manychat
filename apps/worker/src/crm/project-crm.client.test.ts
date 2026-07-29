import { ChannelSecretsService } from '@omnicus/channel-secrets';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectCrmClient } from './project-crm.client';

describe('ProjectCrmClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a CRM call with the credential belonging to the Omnicus project', async () => {
    const key = Buffer.alloc(32, 4).toString('base64');
    const envelope = new ChannelSecretsService(key).encryptSecret({
      channelConnectionId: 'config-a',
      channelType: 'crm',
      field: 'authToken',
      plaintext: 'project-a-crm-token',
      projectId: 'project-a',
    });
    const database = {
      client: {
        crmProjectConfig: {
          findUnique: vi.fn().mockResolvedValue({
            baseUrl: 'https://crm-a.example',
            credentialsEncrypted: envelope,
            enabled: true,
            id: 'config-a',
            projectId: 'project-a',
            status: 'ACTIVE',
          }),
        },
      },
    };
    const config = {
      get: vi.fn((name: string) => {
        const values: Record<string, unknown> = {
          CHANNEL_SECRETS_KEY: key,
          CRM_REQUEST_TIMEOUT_MS: 10_000,
        };
        return values[name];
      }),
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          operationId: 'operation-a',
          status: 'SUCCEEDED',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    const client = new ProjectCrmClient(config as never, database as never);

    await expect(
      client.reconcile({
        correlationId: 'correlation-a',
        crmProjectId: 'crm-a',
        idempotencyKey: 'operation-a',
        projectId: 'project-a',
      }),
    ).resolves.toMatchObject({ operationId: 'operation-a', status: 'SUCCEEDED' });
    expect(database.client.crmProjectConfig.findUnique).toHaveBeenCalledWith({
      where: { projectId: 'project-a' },
    });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('https://crm-a.example/integrations/v1/omnicus/operations');
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer project-a-crm-token',
    });
  });
});
