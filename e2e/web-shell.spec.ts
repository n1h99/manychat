import { expect, test } from '@playwright/test';

const browserIdentity = {
  email: 'admin@example.test',
  firstName: 'Admin',
  globalPermissions: [],
  globalRoleNames: [],
  lastName: 'User',
  status: 'ACTIVE',
  userId: 'user-a',
};

test('redirects an unauthenticated visitor from a protected route to sign in', async ({ page }) => {
  await page.goto('/projects');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Omnicus' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('restores a persisted bearer session after a full page reload', async ({ page }) => {
  const envelope = (data: unknown) => JSON.stringify({ data, meta: {} });
  let meRequests = 0;
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem('omnicus-auth', JSON.stringify({ token: 'persisted-token', user }));
    },
    { user: browserIdentity },
  );
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      meRequests += 1;
      return route.fulfill({
        body: envelope(browserIdentity),
        contentType: 'application/json',
        status: 200,
      });
    }
    if (path === '/api/v1/projects')
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

  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.reload();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  expect(meRequests).toBeGreaterThanOrEqual(2);
});

test('opens the versioned template and visual automation workspace with mocked APIs', async ({
  page,
}) => {
  const envelope = (data: unknown) => JSON.stringify({ data, meta: {} });
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem('omnicus-auth', JSON.stringify({ token: 'browser-smoke-token', user }));
    },
    { user: browserIdentity },
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me')
      return route.fulfill({
        body: envelope(browserIdentity),
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
  const breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumbs.getByRole('link', { name: 'Projects' })).toHaveAttribute(
    'href',
    '/projects',
  );
  await expect(breadcrumbs.getByRole('link', { exact: true, name: 'Project' })).toHaveAttribute(
    'href',
    '/projects/project-a',
  );
  await expect(breadcrumbs.getByRole('link', { name: 'Automation' })).toHaveAttribute(
    'href',
    '/projects/project-a/scenarios',
  );
  await page.getByRole('button', { name: /Messaging/ }).click();
  await expect(page.getByRole('button', { name: 'Send template' })).toBeVisible();
  await expect(page.getByLabel('Scenario canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Enter full screen' }).click();
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Enter full screen' })).toBeVisible();
  await expect(page.getByText('Graph validation passed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution inspector' })).toBeVisible();

  await page.goto('/projects/project-a/templates');
  await expect(page.getByRole('heading', { name: 'Message templates' })).toBeVisible();
  await expect(page.getByText('Welcome template')).toBeVisible();
  const archiveSwitcher = await page.locator('.archive-view-switch').boundingBox();
  expect(archiveSwitcher).not.toBeNull();
  expect(archiveSwitcher!.height).toBeLessThanOrEqual(42);
  const activeHeaders = await page
    .locator('.archive-state-table .ant-table-thead th')
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  await page.getByText('Archived', { exact: true }).click();
  await expect(page.locator('.archive-view-switch .ant-segmented-item-selected')).toContainText(
    'Archived',
  );
  const archivedHeaders = await page
    .locator('.archive-state-table .ant-table-thead th')
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
  expect(archivedHeaders).toEqual(activeHeaders);
  await page.getByText('Active templates', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Render preview' }).click();
  await expect(page.getByText('Hello Eldar')).toBeVisible();
});

test('shows polished account management and the complete Telegram connection layout', async ({
  page,
}) => {
  const envelope = (data: unknown) => JSON.stringify({ data, meta: {} });
  const adminIdentity = {
    ...browserIdentity,
    firstName: 'Eldar',
    globalPermissions: ['users:manage', 'users:read'],
    globalRoleNames: ['super-admin'],
    lastName: 'Pirmammadov',
  };
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem('omnicus-auth', JSON.stringify({ token: 'ui-review-token', user }));
    },
    { user: adminIdentity },
  );
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path === '/api/v1/auth/me') data = adminIdentity;
    else if (path === '/api/v1/users')
      data = [
        {
          city: 'Baku',
          country: 'Azerbaijan',
          createdAt: '2026-07-28T00:00:00.000Z',
          email: 'eldar@example.test',
          firstName: 'Eldar',
          globalRoles: [
            {
              globalRole: {
                id: 'role-a',
                name: 'Super Admin',
                normalizedName: 'super-admin',
              },
            },
          ],
          id: 'user-a',
          lastName: 'Pirmammadov',
          region: null,
          status: 'ACTIVE',
        },
      ];
    else if (path === '/api/v1/users/roles/global')
      data = [{ id: 'role-a', name: 'Super Admin', normalizedName: 'super-admin' }];
    else if (path === '/api/v1/users/me')
      data = {
        city: 'Baku',
        country: 'Azerbaijan',
        email: 'eldar@example.test',
        firstName: 'Eldar',
        lastName: 'Pirmammadov',
        region: null,
      };
    else if (path === '/api/v1/projects/project-a') data = { name: 'Omnicus Local' };
    else if (path === '/api/v1/projects/project-a/access')
      data = {
        permissions: ['channels:manage', 'channels:read', 'channels:rotate_secrets'],
        projectRoleName: 'Project Admin',
      };
    else if (path === '/api/v1/projects/project-a/channels/channel-a')
      data = {
        botUsername: 'omnicus_bot',
        createdAt: '2026-07-28T00:00:00.000Z',
        externalBotId: '10001',
        id: 'channel-a',
        lastErrorAt: null,
        lastWebhookAt: '2026-07-31T00:00:00.000Z',
        maskedToken: '123456:****************abcd',
        name: 'Omnicus Telegram',
        projectId: 'project-a',
        status: 'ACTIVE',
        type: 'TELEGRAM',
        updatedAt: '2026-07-31T00:00:00.000Z',
        webhookStatus: 'CONNECTED',
        webhookUrl: 'https://api.example.test/webhooks/telegram/channel-a',
      };
    else if (
      path.endsWith('/identities') ||
      path.endsWith('/inbound-events') ||
      path.endsWith('/outbound-events')
    )
      data = [];
    else
      return route.fulfill({
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
        contentType: 'application/json',
        status: 404,
      });
    return route.fulfill({ body: envelope(data), contentType: 'application/json', status: 200 });
  });

  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('System administrators')).toBeVisible();
  await expect(page.getByText('Eldar Pirmammadov').first()).toBeVisible();
  const appHeader = await page.locator('.app-header').boundingBox();
  const accountPill = await page.locator('.account-identity-chip').boundingBox();
  expect(appHeader).not.toBeNull();
  expect(accountPill).not.toBeNull();
  expect(accountPill!.height).toBeLessThanOrEqual(40);
  expect(accountPill!.y).toBeGreaterThanOrEqual(appHeader!.y);
  expect(accountPill!.y + accountPill!.height).toBeLessThanOrEqual(
    appHeader!.y + appHeader!.height,
  );
  await page.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Profile settings' })).toBeVisible();
  await expect(page.getByText('Lead notifications')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Location', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.setViewportSize({ height: 1000, width: 1440 });
  await page.goto('/projects/project-a/channels/channel-a');
  await expect(page.getByText('Connection overview')).toBeVisible();
  await expect(page.getByText('Replace bot token')).toBeVisible();
  await expect(page.getByText('Connection actions')).toBeVisible();
  await expect(page.getByText('Send test message')).toBeVisible();
  const overview = await page.locator('.channel-overview-card').boundingBox();
  const replaceToken = await page
    .locator('.channel-management-stack > .ant-card')
    .first()
    .boundingBox();
  const managementStack = await page.locator('.channel-management-stack').boundingBox();
  const actions = await page.locator('.channel-actions-card').boundingBox();
  const testMessage = await page.locator('.channel-test-message-card').boundingBox();
  expect(overview).not.toBeNull();
  expect(replaceToken).not.toBeNull();
  expect(managementStack).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(testMessage).not.toBeNull();
  expect(overview!.width).toBeGreaterThan(replaceToken!.width * 1.5);
  expect(actions!.y).toBeGreaterThan(replaceToken!.y);
  expect(testMessage!.x).toBeGreaterThan(replaceToken!.x);
  expect(Math.abs(managementStack!.height - testMessage!.height)).toBeLessThanOrEqual(2);
});
