import { expect, test } from "@playwright/test";

const profile = (process.env.UVP_ORDER_APP_E2E_PROFILE ?? "fail-closed").trim().toLowerCase();

test.describe("order app workbench shell", () => {
  test("fails closed when the participant service URL is missing", async ({ page }) => {
    test.skip(profile !== "fail-closed", "only for the fail-closed profile");
    await page.goto("/");

    await expect(page.getByText("参与者服务未配置", { exact: true })).toBeVisible();
    await expect(page.getByText("VITE_UVP_CHAIN_SERVICES_URL", { exact: false })).toBeVisible();
  });

  test("shows only the wallet-login gate and the two workbench views", async ({ page }) => {
    test.skip(profile === "fail-closed", "only for configured profiles");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "订单工作台" })).toBeVisible();
    await expect(page.getByText("需要钱包登录", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "开单" })).toHaveCount(0);
    await expect(page.getByText("要求", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "注册与身份" })).toHaveCount(0);
  });
});
