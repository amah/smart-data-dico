import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the diagram view-mode tabs (#181/#182) and each view rendering
 * (#184–#188) against the live dev app (samples/eshop, order-service — which
 * carries orm.* / physical.* / constraints[]).
 *
 * Cytoscape draws to a <canvas>, so node/edge labels aren't in the DOM; these
 * specs assert the DOM-observable surface — the tabs, the ?view= URL state and
 * the per-mode legend — plus that each view renders a canvas without error.
 * The element/label/payload logic is covered exhaustively by the Vitest builder
 * tests.
 */

const DIAGRAM = '/visualization/order-service';

const tab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true });

/** Wait for the Cytoscape canvas to mount (the graph has rendered). */
async function expectCanvas(page: Page) {
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
}

test.describe('diagram view-mode tabs', () => {
  test('defaults to Structural with no ?view param', async ({ page }) => {
    await page.goto(DIAGRAM);
    await expect(tab(page, 'Structural')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Logical (ORM)')).toBeVisible();
    await expect(tab(page, 'Physical')).toBeVisible();
    await expectCanvas(page);
    expect(new URL(page.url()).searchParams.get('view')).toBeNull();
  });

  test('switching to Logical updates ?view= and shows the ORM edge legend', async ({ page }) => {
    await page.goto(DIAGRAM);
    await tab(page, 'Logical (ORM)').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('logical');
    await expect(tab(page, 'Logical (ORM)')).toHaveAttribute('aria-selected', 'true');
    await expectCanvas(page);
    // Logical legend: Edges section with the inheritance entry.
    await expect(page.getByText('Inheritance (is-a)')).toBeVisible();
  });

  test('switching to Physical updates ?view= and shows the drift legend', async ({ page }) => {
    await page.goto(DIAGRAM);
    await tab(page, 'Physical').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('physical');
    await expect(tab(page, 'Physical')).toHaveAttribute('aria-selected', 'true');
    await expectCanvas(page);
    // Physical legend: Drift section flags both directions.
    await expect(page.getByText(/Not enforced in DB/)).toBeVisible();
    await expect(page.getByText(/In DB, missing from model/)).toBeVisible();
  });

  test('deep-linking ?view=physical restores the Physical tab', async ({ page }) => {
    await page.goto(`${DIAGRAM}?view=physical`);
    await expect(tab(page, 'Physical')).toHaveAttribute('aria-selected', 'true');
    await expectCanvas(page);
  });

  test('an unknown ?view= falls back to Structural', async ({ page }) => {
    await page.goto(`${DIAGRAM}?view=bogus`);
    await expect(tab(page, 'Structural')).toHaveAttribute('aria-selected', 'true');
    await expectCanvas(page);
  });
});
