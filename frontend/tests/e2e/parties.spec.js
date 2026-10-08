import { expect, test } from "@playwright/test";
import { openApp, seedAuthenticatedState } from "./helpers/app.js";

test("customer create, edit, and archive works from Parties", async ({ page }) => {
  await seedAuthenticatedState(page, {
    parties: []
  });
  await openApp(page, "/app/parties");

  await page.getByRole("button", { name: "Add Customer" }).click();
  await page.getByLabel("Name").fill("Northwind Traders");
  await page.getByPlaceholder("Enter mobile number").fill("9876543210");
  await page.getByLabel("Email(Optional)").fill("northwind@test.local");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Notes(Optional)").fill("Priority customer for automation coverage.");
  await page.getByRole("button", { name: "Create Customer" }).click();

  await expect(page.getByText("Northwind Traders")).toBeVisible();

  const row = page.locator("tr", { hasText: "Northwind Traders" });
  await row.getByRole("button", { name: "Open actions" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name").fill("Northwind Stores");
  await page.getByLabel("Notes(Optional)").fill("Updated note after edit flow.");
  await page.getByRole("button", { name: "Update Customer" }).click();

  await expect(page.getByText("Northwind Stores")).toBeVisible();

  let confirmMessage = "";
  page.once("dialog", async (dialog) => {
    confirmMessage = dialog.message();
    await dialog.accept();
  });

  const updatedRow = page.locator("tr", { hasText: "Northwind Stores" });
  await updatedRow.getByRole("button", { name: "Open actions" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();

  await expect.poll(() => confirmMessage).toContain("Archive Northwind Stores");
  await expect(page.getByText("Northwind Stores")).toHaveCount(0);
});
