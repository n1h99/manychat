import { expect, test } from '@playwright/test';

test('redirects an unauthenticated visitor from a protected route to sign in', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }),
    });
  });

  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }),
    });
  });

  await page.goto('/projects');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Omnicus' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('opens the versioned template and visual automation workspace with mocked APIs', async ({
  page,
}) => {
  const envelope = (data: unknown) => JSON.stringify({ data, meta: {} });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/refresh')
      return route.fulfill({
        body: envelope({
          accessToken: 'browser-smoke-token',
          user: {
            email: 'admin@example.test',
            firstName: 'Admin',
            globalPermissions: [],
            globalRoleNames: [],
            lastName: 'User',
            status: 'ACTIVE',
            userId: 'user-a',
          },
        }),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/access')
      return route.fulfill({
        body: envelope({
          permissions: [
            'automation:read',
            'automation:manage',
            'templates:read',
            'templates:manage',
            'media:read',
          ],
          projectRoleName: 'Project Admin',
        }),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/scenarios/scenario-a/executions')
      return route.fulfill({
        body: envelope([
          {
            completedAt: '2026-07-27T00:00:02.000Z',
            createdAt: '2026-07-27T00:00:00.000Z',
            currentNodeId: null,
            id: 'execution-a',
            nodeExecutions: [
              {
                attempt: 1,
                nodeId: 'incoming',
                nodeType: 'INCOMING_MESSAGE',
                status: 'SUCCEEDED',
              },
            ],
            status: 'COMPLETED',
          },
        ]),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/scenarios/scenario-a')
      return route.fulfill({
        body: envelope({
          activeVersion: {
            graph: {
              edges: [{ from: 'incoming', output: 'default', to: 'stop' }],
              nodes: [
                {
                  config: {},
                  id: 'incoming',
                  position: { x: 0, y: 100 },
                  type: 'INCOMING_MESSAGE',
                },
                {
                  config: {},
                  id: 'stop',
                  position: { x: 280, y: 100 },
                  type: 'STOP',
                },
              ],
            },
            id: 'scenario-version-a',
          },
          activeVersionId: 'scenario-version-a',
          createdAt: '2026-07-27T00:00:00.000Z',
          description: 'Browser smoke',
          draftVersion: null,
          id: 'scenario-a',
          name: 'Welcome flow',
          status: 'PUBLISHED',
          updatedAt: '2026-07-27T00:00:00.000Z',
          versions: [
            {
              id: 'scenario-version-a',
              publishedAt: '2026-07-27T00:00:00.000Z',
              status: 'PUBLISHED',
              version: 1,
            },
          ],
        }),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/scenarios')
      return route.fulfill({
        body: envelope([
          {
            activeVersionId: 'scenario-version-a',
            createdAt: '2026-07-27T00:00:00.000Z',
            description: 'Browser smoke',
            id: 'scenario-a',
            name: 'Welcome flow',
            status: 'PUBLISHED',
            updatedAt: '2026-07-27T00:00:00.000Z',
          },
        ]),
        contentType: 'application/json',
        status: 200,
      });
    if (
      path === '/api/v1/projects/project-a/templates/template-a/preview' &&
      request.method() === 'POST'
    )
      return route.fulfill({
        body: envelope({
          kind: 'TEXT',
          mediaAssetId: null,
          missing: [],
          output: 'Hello Eldar',
        }),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/templates')
      return route.fulfill({
        body: envelope([
          {
            activeVersion: {
              content: { text: 'Hello {{contact.firstName}}' },
              id: 'template-version-a',
              kind: 'TEXT',
              mediaAssetId: null,
              status: 'PUBLISHED',
              variables: ['contact.firstName'],
              version: 1,
            },
            activeVersionId: 'template-version-a',
            description: 'Browser smoke',
            draftVersion: null,
            id: 'template-a',
            name: 'Welcome template',
            status: 'PUBLISHED',
          },
        ]),
        contentType: 'application/json',
        status: 200,
      });
    if (path === '/api/v1/projects/project-a/media-assets')
      return route.fulfill({
        body: envelope([]),
        contentType: 'application/json',
        status: 200,
      });
    return route.fulfill({
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
      contentType: 'application/json',
      status: 404,
    });
  });

  await page.goto('/projects/project-a/scenarios/scenario-a');
  await expect(page.getByRole('heading', { name: 'Welcome flow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send template' })).toBeVisible();
  await expect(page.getByLabel('Scenario canvas')).toBeVisible();
  await expect(page.getByText('Graph validation passed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution inspector' })).toBeVisible();

  await page.goto('/projects/project-a/templates');
  await expect(page.getByRole('heading', { name: 'Message templates' })).toBeVisible();
  await expect(page.getByText('Welcome template')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Render preview' }).click();
  await expect(page.getByText('Hello Eldar')).toBeVisible();
});
