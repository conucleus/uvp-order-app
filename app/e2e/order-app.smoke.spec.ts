import { expect, test } from "@playwright/test";
import { installProductApiStub, readinessTask } from "./product-api-stub";

test.describe("UVP Order App participant shell", () => {
  test("opens to participant tasks over the real Product API and keeps Store Console out of the first screen", async ({ page }) => {
    await installProductApiStub(page, {
      task: readinessTask({
        proofSummary: {
          label: "等待提交凭证",
          payloadHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
        }
      })
    });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await expect(page.getByText("已连接", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /确认出口报关完成/ })).toBeVisible();
    await expect(page.getByText("Store Console")).toHaveCount(0);

    await page.getByRole("button", { name: /确认出口报关完成/ }).click();
    await expect(page.getByRole("heading", { name: "交付进度更新" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "提交材料" })).toBeVisible();
    await expect(page.getByLabel("交付凭证引用")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认报关完成", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "订单", exact: true }).click();
    await expect(page.getByRole("heading", { name: "跨境出口报关订单" })).toBeVisible();

    const proofDrawer = page.locator("details[aria-label='证明抽屉']");
    await expect(proofDrawer).toHaveCount(1);
    await expect(proofDrawer).not.toHaveAttribute("open", "");
    await expect(page.getByText("Store Console")).toHaveCount(0);
  });
});
