import { expect, test } from "@playwright/test";

test("owner can register, complete setup, logout, and log back in", async ({ page }) => {
  const uniqueEmail = `owner-${Date.now()}@demo.test`;
  const password = "owner123";

  await page.goto("/login");
  await expect(
    page.getByText("Supabase env keys are not configured. App is running in local demo mode.")
  ).toBeVisible();

  await page.getByPlaceholder("Enter your registered email").fill("owner@demo.com");
  await page.getByPlaceholder("Enter your password").fill("wrong-pass");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();

  await page.getByRole("button", { name: "Register" }).click();
  await page.getByPlaceholder("Email address").fill(uniqueEmail);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByPlaceholder("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/company-setup$/);

  await page.getByLabel("Company Name").fill("Playwright Traders");
  await page.getByLabel("Company Phone").fill("+91 9876543210");
  await page.getByLabel("Company Email").fill("accounts@playwright.test");
  await page.getByLabel("Address Line 1").fill("7 Test Street");
  await page.getByLabel("City").fill("Chennai");
  await page.getByLabel("State / Province").fill("Tamil Nadu");
  await page.getByRole("button", { name: "Save & Continue" }).first().click();

  await expect(page).toHaveURL(/\/invoice-template-setup$/);
  await page.getByRole("button", { name: "Save & Proceed" }).click();

  await expect(page).toHaveURL(/\/(dashboard|organization-select)$/);
  if ((await page.url()).endsWith("/organization-select")) {
    await page.getByRole("button", { name: "Open" }).click();
  }

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main")).toContainText(/dashboard/i);

  await page.getByRole("button", { name: /Owner$/ }).click();
  await page.getByRole("button", { name: /logout/i }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder("Enter your registered email").fill(uniqueEmail);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/(dashboard|organization-select)$/);
  if ((await page.url()).endsWith("/organization-select")) {
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});

