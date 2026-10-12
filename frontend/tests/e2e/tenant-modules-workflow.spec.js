import { test, expect } from '@playwright/test';

test.describe('Tenant 6 Modules & Navigation Workflow', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('auth:tab_session_active', '1');
      window.sessionStorage.setItem('auth_token', JSON.stringify('test-token-123'));
      window.sessionStorage.setItem('auth_user', JSON.stringify({ id: '127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f', email: 'owner@test.com', name: 'Test Owner' }));
      window.sessionStorage.setItem('role', JSON.stringify('Owner'));
      window.sessionStorage.setItem('organization_id', JSON.stringify('test-org-123'));

      window.localStorage.setItem('auth_token', JSON.stringify('test-token-123'));
      window.localStorage.setItem('auth_user', JSON.stringify({ id: '127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f', email: 'owner@test.com', name: 'Test Owner' }));
      window.localStorage.setItem('role', JSON.stringify('Owner'));
      window.localStorage.setItem('organization_id', JSON.stringify('test-org-123'));
      window.localStorage.setItem('companyProfileCompleted', JSON.stringify(true));
      window.localStorage.setItem('invoiceTemplateCompleted', JSON.stringify(true));
      window.localStorage.setItem('company_profile', JSON.stringify({ company_name: 'Test Corp', country: 'India' }));
    });
  });

  test('routing: bare /app/sales/invoice redirects to history while preserving preview/edit params', async ({ page }) => {
    // 1. Bare /app/sales/invoice should redirect to /app/sales/invoice/history (direct creation disabled)
    await page.goto('/app/sales/invoice');
    await expect(page).toHaveURL(/.*\/app\/sales\/invoice\/history/);

    // 2. /app/sales/invoice?preview=<id> must NOT be redirected to /history; must preserve preview parameter
    await page.goto('/app/sales/invoice?preview=test-preview-doc-id');
    expect(page.url()).toContain('/app/sales/invoice?preview=test-preview-doc-id');

    // 3. /app/sales/invoice?edit=<id> must reach the invoice view/preview page
    await page.goto('/app/sales/invoice?edit=test-edit-doc-id');
    expect(page.url()).toContain('test-edit-doc-id');
  });

  test('settings: exactly 3 cards (Company, Customers, Items) reachable from Settings route', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page).toHaveURL(/.*\/app\/settings/);

    // Check exactly 3 cards exist in settings grid
    const cards = page.locator('#settings-cards-grid > div');
    await expect(cards).toHaveCount(3);

    // Check each specific card
    await expect(page.locator('#settings-company-card')).toBeVisible();
    await expect(page.locator('#settings-customers-card')).toBeVisible();
    await expect(page.locator('#settings-items-card')).toBeVisible();

    // Verify navigation from cards
    await page.locator('#settings-company-card').click();
    await expect(page).toHaveURL(/.*\/app\/company-settings/);

    await page.goto('/app/settings');
    await page.locator('#settings-customers-card').click();
    await expect(page).toHaveURL(/.*\/app\/parties/);

    await page.goto('/app/settings');
    await page.locator('#settings-items-card').click();
    await expect(page).toHaveURL(/.*\/app\/items/);
  });

  test('sidebar: exactly 6 tenant modules without redundant sidebar entries', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside.app-sidebar');
    await expect(sidebar).toBeVisible();

    // Verify presence of the 6 tenant modules in sidebar navigation
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Pro Forma Invoice' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Tax Invoice' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Payment In' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();

    // Verify Customers and Items do NOT have separate sidebar entries
    await expect(sidebar.getByRole('link', { name: /^Customers$/ })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: /^Items$/ })).toHaveCount(0);
  });

  test('modules: all 6 core tenant workflows load cleanly', async ({ page }) => {
    // 1. Dashboard
    await page.goto('/dashboard');
    expect(page.url()).toContain('/dashboard');

    // 2. Pro Forma Invoices
    await page.goto('/app/sales/proformas/history');
    expect(page.url()).toContain('/app/sales/proformas/history');

    // 3. Tax Invoices
    await page.goto('/app/sales/invoice/history');
    expect(page.url()).toContain('/app/sales/invoice/history');

    // 4. Payment In
    await page.goto('/app/sales/payment-in');
    expect(page.url()).toContain('/app/sales/payment-in');

    // 5. Reports
    await page.goto('/app/reports');
    expect(page.url()).toContain('/app/reports');

    // 6. Settings
    await page.goto('/app/settings');
    expect(page.url()).toContain('/app/settings');
  });

});
