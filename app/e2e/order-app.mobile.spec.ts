import { expect, test } from "@playwright/test";
import { installProductApiStub, selectorTask } from "./product-api-stub";

test.describe("UVP Order App mobile readiness smoke", () => {
  test("mobile viewport keeps task and proof surfaces usable", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await expect(page.getByRole("button", { name: /确认出口报关完成/ })).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("执行方钱包")).toBeVisible();

    await page.getByRole("button", { name: "订单" }).click();
    await expect(page.getByLabel("证明抽屉")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("mobile viewport keeps executor patch action form within the screen", async ({ page }) => {
    await installProductApiStub(page, { task: selectorTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "选择检验履约者" })).toBeVisible();
    await expect(page.getByLabel("履约者钱包")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  });
});
