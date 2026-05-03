import { expect, test } from "@playwright/test";

test.describe("UVP Order App production-like fail closed", () => {
  test("missing Product API does not enable demo orders or mock controls", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await expect(page.getByText("参与者服务未配置")).toBeVisible();
    await expect(page.getByText("未连接", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "暂无待办" })).toBeVisible();
    await expect(page.getByText("开发样例模式")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /确认出口报关完成/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "准备提交" })).toHaveCount(0);
  });
});
