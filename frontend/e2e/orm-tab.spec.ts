import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the entity ORM tab — the dedicated ORM tab, the typed ORM mapping
 * form, the Physical (physical.*) editor and its save round-trip.
 *
 * Runs against the live dev app (samples/eshop). Read-only assertions plus one
 * non-destructive save round-trip that restores the original value at the end.
 */

const ORDER = '/packages/order-service/entities/Order';
const USER = '/packages/user-service/entities/User';
const STATUS_ATTR = '/packages/order-service/entities/Order/attributes/status';
const ORDER_ITEM_REL = '/packages/order-service/entities/Order/relationships/rel-order-item-001';

/** The ORM MAPPING section (scoped so its Edit/Save don't clash with Physical's). */
const ormSection = (page: Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'ORM MAPPING' }) });

async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click();
}

test.describe('entity ORM tab', () => {
  test('Order has a dedicated ORM tab between Metadata and Lineage', async ({ page }) => {
    await page.goto(ORDER);
    const tabs = page.getByRole('tab');
    await expect(page.getByRole('tab', { name: 'ORM', exact: true })).toBeVisible();
    // ordering: Metadata then ORM then Lineage
    const names = await tabs.allInnerTexts();
    const idx = (t: string) => names.findIndex(n => n.trim() === t);
    expect(idx('Metadata')).toBeLessThan(idx('ORM'));
    expect(idx('ORM')).toBeLessThan(idx('Lineage'));
  });

  test('ORM tab shows the Physical section and the full ORM mapping form', async ({ page }) => {
    await page.goto(ORDER);
    await openTab(page, 'ORM');

    // Physical section (read view) — table name from physical.tableName
    await expect(page.getByRole('heading', { name: 'PHYSICAL' })).toBeVisible();
    await expect(page.getByText('orders', { exact: true })).toBeVisible();

    // ORM mapping form rendered up-front with all entity-scope inputs prefilled
    await expect(page.getByRole('heading', { name: 'ORM MAPPING' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Java package' })).toHaveValue('com.eshop.order');
    await expect(page.getByRole('textbox', { name: 'Class name' })).toHaveValue('Order');
    await expect(page.getByText('Extends (supertype)', { exact: true })).toBeVisible();
    await expect(page.getByText('Inheritance strategy', { exact: true })).toBeVisible();
    await expect(page.getByText('Discriminator column', { exact: true })).toBeVisible();
    // the inheritance-strategy select offers the JPA strategies
    await expect(page.locator('option', { hasText: 'SINGLE_TABLE' })).toHaveCount(1);
  });

  test('entity without orm.* shows the enable affordance, not the form', async ({ page }) => {
    await page.goto(USER);
    await openTab(page, 'ORM');
    await expect(page.getByRole('button', { name: 'Enable ORM mapping' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ORM MAPPING' })).toHaveCount(0);
  });

  test('Physical editor saves and reloads (round-trip, restored)', async ({ page }) => {
    await page.goto(ORDER);
    await openTab(page, 'ORM');

    const physical = page.locator('section', { has: page.getByRole('heading', { name: 'PHYSICAL' }) });
    const original = (await physical.getByText('orders', { exact: true }).textContent()) ?? 'orders';

    // Edit → change schema → Save
    await physical.getByRole('button', { name: 'Edit' }).click();
    const schema = physical.getByRole('textbox', { name: 'public' }); // placeholder-named input
    await schema.fill('e2e_probe');
    await physical.getByRole('button', { name: 'Save' }).click();

    // Reload from disk and confirm it persisted
    await page.reload();
    await openTab(page, 'ORM');
    await expect(physical.getByText('e2e_probe', { exact: true })).toBeVisible();

    // Restore original schema (commerce) so the sample is unchanged
    await physical.getByRole('button', { name: 'Edit' }).click();
    await physical.getByRole('textbox', { name: 'public' }).fill('commerce');
    await physical.getByRole('button', { name: 'Save' }).click();
    await page.reload();
    await openTab(page, 'ORM');
    await expect(physical.getByText('commerce', { exact: true })).toBeVisible();
    expect(original).toBe('orders');
  });
});

test.describe('attribute & relationship ORM sections', () => {
  test('attribute ORM section opens as the full form, prefilled', async ({ page }) => {
    await page.goto(STATUS_ATTR);
    const orm = ormSection(page);
    // default-editing → Save/Cancel present (not behind an Edit button)
    await expect(orm.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(orm.getByText('Enumerated', { exact: true })).toBeVisible();
    // string field exposes its label as the input's accessible name (placeholder)
    await expect(orm.getByRole('textbox', { name: 'Enum type' })).toHaveValue('OrderStatus');
  });

  test('relationship ORM section opens as the full form, prefilled', async ({ page }) => {
    await page.goto(ORDER_ITEM_REL);
    const orm = ormSection(page);
    await expect(orm.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(orm.getByText('Fetch', { exact: true })).toBeVisible();
    await expect(orm.getByText('Cascade', { exact: true })).toBeVisible();
    await expect(orm.getByRole('textbox', { name: 'Mapped by' })).toHaveValue('order');
  });
});
