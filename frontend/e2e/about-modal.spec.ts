import { test, expect } from '@playwright/test';

test.describe('about dialog', () => {
  test('opens from the admin menu and closes from the icon button', async ({ page }) => {
    await page.goto('/');

    const adminMenu = page.locator('.dropdown', { has: page.getByTitle('Admin') });
    await adminMenu.getByTitle('Admin').click();
    await adminMenu.getByRole('button', { name: 'About' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'About Smart Data Dictionary' })).toBeVisible();
    await expect(dialog.getByText('Collaborative data dictionary management for YAML-backed projects.')).toBeVisible();
    await expect(dialog.getByText('Version', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Mode', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Profile', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Authentication', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Project', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Project path', { exact: true })).toBeVisible();
    await expect(dialog.getByText('/api/status')).toBeVisible();

    await dialog.getByRole('button', { name: 'Close About dialog' }).click();
    await expect(page.getByRole('heading', { name: 'About Smart Data Dictionary' })).toHaveCount(0);
  });

  test('closes from the primary close button', async ({ page }) => {
    await page.goto('/');

    const adminMenu = page.locator('.dropdown', { has: page.getByTitle('Admin') });
    await adminMenu.getByTitle('Admin').click();
    await adminMenu.getByRole('button', { name: 'About' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'About Smart Data Dictionary' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'About Smart Data Dictionary' })).toHaveCount(0);
  });
});
