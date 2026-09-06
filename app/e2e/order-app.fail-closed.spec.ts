import { expect, test } from "@playwright/test";

test.describe("UVP Order App production-like fail closed", () => {
  // 与 order-app.full.spec.ts 同款 profile 守卫：fail-closed 断言依赖
  // UVP_ORDER_APP_E2E_PROFILE=fail-closed 运行时（无 VITE_UVP_CHAIN_SERVICES_URL，
  // 应用必须显示未配置外壳）；在其他 profile 的全量跑中跳过，避免结构性误报。
  test.skip(
    process.env.UVP_ORDER_APP_E2E_PROFILE !== "fail-closed",
    "fail-closed E2E requires UVP_ORDER_APP_E2E_PROFILE=fail-closed (pnpm test:e2e:fail-closed)"
  );

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
