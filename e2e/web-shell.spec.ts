import { expect, test } from '@playwright/test';

test('renders the Stage 0 application shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Omnicus', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  await expect(page.getByText('Infrastructure scaffold')).toBeVisible();
});
