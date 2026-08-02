import { describe, expect, it, vi } from 'vitest';

import { AutomationRuntimeService } from './automation-runtime.service';

describe('AutomationRuntimeService Wait for Reply criteria', () => {
  it('resolves only waits whose bounded criteria match the inbound event', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = {
      normalizedEvent: {
        findUnique: vi.fn().mockResolvedValue({
          payload: { content: { text: 'Yes, continue' }, type: 'MESSAGE' },
        }),
      },
      waitState: {
        findMany: vi.fn().mockResolvedValue([
          {
            criteria: { caseSensitive: false, kind: 'TEXT', operator: 'contains', value: 'yes' },
            id: 'matching',
            projectId: 'project-a',
            scenarioExecutionId: 'execution-a',
            successNodeId: 'send-a',
          },
          {
            criteria: { kind: 'MEDIA', mediaTypes: ['PHOTO'] },
            id: 'not-matching',
            projectId: 'project-a',
            scenarioExecutionId: 'execution-b',
            successNodeId: 'send-b',
          },
        ]),
        updateMany,
      },
    };
    const service = new AutomationRuntimeService({} as never);

    await service.resolveWaitsInTransaction(transaction as never, {
      connectionId: 'connection-a',
      contactId: 'contact-a',
      conversationId: 'conversation-a',
      normalizedEventId: 'event-a',
      projectId: 'project-a',
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'matching' }) }),
    );
  });

  it('keeps typed custom-field projections synchronized with the contact JSON', async () => {
    const contactUpdate = vi.fn();
    const projectionUpsert = vi.fn();
    const service = new AutomationRuntimeService({} as never) as unknown as {
      applyNode(
        transaction: unknown,
        node: unknown,
        edges: unknown[],
        context: unknown,
        executionId: string,
      ): Promise<unknown>;
    };
    await service.applyNode(
      {
        contact: { update: contactUpdate },
        contactCustomFieldValue: { upsert: projectionUpsert },
        customFieldDefinition: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'field-a',
            key: 'score',
            options: null,
            type: 'NUMBER',
          }),
        },
      },
      { config: { key: 'score', value: 42 }, id: 'set-score', type: 'SET_CUSTOM_FIELD' },
      [],
      {
        connectionId: 'connection-a',
        contactId: 'contact-a',
        contactVariables: {},
        conversationId: 'conversation-a',
        customFields: {},
        eventPayload: { type: 'MESSAGE' },
        normalizedEventId: 'event-a',
        projectId: 'project-a',
        subflowDepth: 0,
      },
      'execution-a',
    );

    expect(contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customFields: { score: 42 } } }),
    );
    expect(projectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ definitionId: 'field-a', valueJson: 42 }),
        where: {
          projectId_contactId_definitionId: {
            contactId: 'contact-a',
            definitionId: 'field-a',
            projectId: 'project-a',
          },
        },
      }),
    );
  });

  it('selects an AND branch deterministically and exposes a safe branch reason', async () => {
    const service = new AutomationRuntimeService({} as never) as unknown as {
      applyNode(
        transaction: unknown,
        node: unknown,
        edges: unknown[],
        context: unknown,
        executionId: string,
      ): Promise<{ next?: { output: string }; reasonCode?: string }>;
    };

    const result = await service.applyNode(
      {},
      { config: {}, id: 'condition', type: 'CONDITION' },
      [
        {
          conditionGroup: {
            combinator: 'AND',
            rules: [
              { field: 'message.text', operator: 'contains', value: 'yes' },
              { field: 'contact.customFields.score', operator: 'greater_than', value: 5 },
            ],
          },
          from: 'condition',
          output: 'qualified',
          priority: 0,
          to: 'send',
        },
        { from: 'condition', output: 'fallback', priority: 1, to: 'stop' },
      ],
      {
        connectionId: 'connection-a',
        contactId: 'contact-a',
        contactVariables: {},
        conversationId: 'conversation-a',
        customFields: { score: 9 },
        eventPayload: { content: { text: 'yes please' }, type: 'MESSAGE' },
        normalizedEventId: 'event-a',
        projectId: 'project-a',
        subflowDepth: 0,
      },
      'execution-a',
    );

    expect(result).toMatchObject({
      next: { output: 'qualified' },
      reasonCode: 'CONDITION_MATCHED',
    });
  });
});
