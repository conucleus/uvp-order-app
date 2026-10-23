import { expect, test } from "@playwright/test";
import { installProductApiStub, participantWallet } from "./product-api-stub";

/**
 * 注册模块接线：路由入口、实体注册 blocker 的显式呈现、身份事实只读。
 * 实体注册写路径本身不存在（见 src/registration/README.md §3），本用例
 * 验证"不发送请求、不伪造成功"这一事实在页面上可见。
 */
test.describe("Order App registration wiring", () => {
  test("opens registration from the participant shell and shows the entity-registration blocker", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/");

    // 参与者主壳入口。
    const registrationEntry = page.getByTestId("open-registration-button");
    await expect(registrationEntry).toBeVisible();
    await registrationEntry.click();

    await expect(page.getByRole("heading", { name: "注册与身份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "实体注册" })).toBeVisible();
    await expect(page.getByText("实体注册暂不可提交")).toBeVisible();

    // 表单校验通过后提交：只显示 blocker，没有任何注册写请求。
    await page.getByLabel("企业名称").fill("中亚二手车出口有限公司");
    await page.getByLabel("注册号").fill("91310000MA1K000000");
    await page.getByLabel("联系人").fill("张经理");
    await page.getByRole("button", { name: "提交注册" }).click();
    await expect(page.getByText("未提交：本次没有发送任何请求。")).toBeVisible();
    await expect(page.getByText("表单内容只保留在本页内存中，刷新即丢弃。")).toBeVisible();

    // 身份背书事实：公开只读；空集如实显示"没有记录"。
    await page.getByLabel("查询钱包地址").fill(participantWallet);
    await page.getByRole("button", { name: "查询背书" }).click();
    await expect(page.getByText("该地址当前没有身份背书。")).toBeVisible();

    // 返回待办恢复主壳（订单概览只在主壳渲染）。
    await page.getByRole("button", { name: "返回待办" }).click();
    await expect(page.getByText("运行订单")).toBeVisible();
  });

  test("opens registration directly from a hash route without a participant session", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/#?section=registration");

    await expect(page.getByRole("heading", { name: "注册与身份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "钱包归属签名证明" })).toBeVisible();
    // 无会话 token：地址清单显示需要登录，不发写请求。
    await expect(page.getByText("当前浏览器没有可用的钱包会话。")).toBeVisible();
    // 未登录也不渲染参与者主壳的订单概览。
    await expect(page.getByText("运行订单")).toHaveCount(0);
  });
});
