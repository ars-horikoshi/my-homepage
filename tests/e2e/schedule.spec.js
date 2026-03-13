import { test, expect } from "@playwright/test";

test.describe("Schedule App", () => {
  test("shows weekly view by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#weekly-view")).toBeVisible();
    await expect(page.locator("#monthly-view")).toBeHidden();
  });

  test("switches to monthly view", async ({ page }) => {
    await page.goto("/");
    await page.click("#btn-monthly");
    await expect(page.locator("#monthly-view")).toBeVisible();
    await expect(page.locator("#weekly-view")).toBeHidden();
  });

  test("nav label updates on view switch", async ({ page }) => {
    await page.goto("/");
    const weeklyLabel = await page.locator("#nav-label").textContent();
    expect(weeklyLabel).toMatch(/年.*月.*日/);
    await page.click("#btn-monthly");
    const monthlyLabel = await page.locator("#nav-label").textContent();
    expect(monthlyLabel).toMatch(/年.*月/);
  });

  test("prev/next navigation in weekly view", async ({ page }) => {
    await page.goto("/");
    const before = await page.locator("#nav-label").textContent();
    await page.click("#btn-next");
    const after = await page.locator("#nav-label").textContent();
    expect(after).not.toBe(before);
    await page.click("#btn-today");
    const back = await page.locator("#nav-label").textContent();
    expect(back).toBe(before);
  });

  test("today button returns to current week", async ({ page }) => {
    await page.goto("/");
    const original = await page.locator("#nav-label").textContent();
    await page.click("#btn-prev");
    await page.click("#btn-today");
    await expect(page.locator("#nav-label")).toHaveText(original);
  });

  test("dark mode toggle changes theme", async ({ page }) => {
    await page.goto("/");
    await page.click("#btn-theme");
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("dark");
    await page.click("#btn-theme");
    const theme2 = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme2).toBe("light");
  });

  test("add event modal opens and closes", async ({ page }) => {
    await page.goto("/");
    await page.click("#btn-add");
    await expect(page.locator("#edit-modal-overlay")).not.toHaveClass(/hidden/);
    await page.click("#edit-cancel");
    await expect(page.locator("#edit-modal-overlay")).toHaveClass(/hidden/);
  });
});
