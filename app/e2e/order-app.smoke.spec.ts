import { expect, test } from "@playwright/test";

test.describe("UVP Order App participant shell", () => {
  test("opens to participant tasks and keeps Store Console out of the first screen", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await expect(page.getByRole("status").getByText("开发样例模式", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /确认出口报关完成/ })).toBeVisible();
    await expect(page.getByText("Store Console")).toHaveCount(0);
    await expect(page.getByText("旧 escrow demo")).toHaveCount(0);

    await page.getByRole("button", { name: "订单", exact: true }).click();
    await expect(page.getByRole("heading", { name: "A 公司采购 10 台车辆" })).toBeVisible();

    await page.getByRole("button", { name: "证明", exact: true }).click();
    await expect(page.getByRole("heading", { name: "证明" })).toBeVisible();
    await expect(page.getByText("凭证指纹").first()).toBeVisible();
  });

  test("renders PRD65 task plugin runtime and keeps proof drawer collapsed", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await page.getByRole("button", { name: /确认出口报关完成/ }).click();
    await expect(page.getByRole("heading", { name: "交付进度更新" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "提交材料" })).toBeVisible();
    await expect(page.getByLabel("交付凭证引用")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认报关完成", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: /确认资金条件证明/ }).click();
    await expect(page.getByRole("heading", { name: "资金条件记录" })).toBeVisible();
    await expect(page.getByText("记录付款条件和资金凭证；当前不处理任何资金动作。").first()).toBeVisible();
    await expect(page.getByText("本阶段只确认付款条件和凭证，真实付款、担保或稳定币适配器需后续接入。")).toBeVisible();
    await expect(page.getByText(/escrow released|funds held/)).toHaveCount(0);

    await page.getByRole("button", { name: "订单", exact: true }).click();
    const proofDrawer = page.locator("details[aria-label='证明抽屉']");
    await expect(proofDrawer).toHaveCount(1);
    await expect(proofDrawer).not.toHaveAttribute("open", "");
    await expect(page.getByText("Store Console")).toHaveCount(0);
  });
});
