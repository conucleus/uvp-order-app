import { expect, test } from "@playwright/test";
import { installProductApiStub, participantWallet } from "./product-api-stub";

const sessionStorageKey = "uvp-order-app:wallet-session";

async function seedWalletSession(page: Parameters<typeof installProductApiStub>[0]): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "e2e-wallet-session-token");
  }, sessionStorageKey);
}

test.describe("Order App registration wiring", () => {
  test("opens registration from the participant shell and keeps submit unauthenticated without a session", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/");

    const registrationEntry = page.getByTestId("open-registration-button");
    await expect(registrationEntry).toBeVisible();
    await registrationEntry.click();

    await expect(page.getByRole("heading", { name: "注册与身份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "实体注册" })).toBeVisible();
    await expect(page.getByText("实体注册可自助提交（未核验）")).toBeVisible();
    await expect(page.getByText("当前浏览器没有可用的钱包会话：登记与查询都用会话锚定账号。请先完成钱包登录。")).toBeVisible();

    await page.getByLabel("企业名称").fill("示例企业有限公司");
    await page.getByLabel("注册号").fill("91310000MA1K000000");
    await page.getByLabel("联系人").fill("张经理");
    await page.getByRole("button", { name: "提交注册" }).click();
    await expect(page.getByText("未登录：没有发送登记请求")).toBeVisible();
    await expect(page.getByText("本次没有写入任何记录；请先完成钱包登录。")).toBeVisible();

    await page.getByLabel("查询钱包地址").fill(participantWallet);
    await page.getByRole("button", { name: "查询背书" }).click();
    await expect(page.getByText("该地址当前没有身份背书。")).toBeVisible();

    await page.getByRole("button", { name: "返回待办" }).click();
    await expect(page.getByText("运行订单")).toBeVisible();
  });

  test("submits a real self-service registration and reads it back as unverified", async ({ page }) => {
    await installProductApiStub(page);
    await seedWalletSession(page);
    await page.goto("/#?section=registration");

    await expect(page.getByRole("heading", { name: "注册与身份" })).toBeVisible();
    await expect(page.getByText("当前会话账号还没有登记档案。填写下方信息并提交即可自助登记（未核验）。")).toBeVisible();

    await page.getByLabel("企业名称").fill("示例企业有限公司");
    await page.getByLabel("注册号").fill("91310000MA1K000000");
    await page.getByLabel("联系人").fill("张经理");
    await page.getByRole("button", { name: "提交注册" }).click();

    const status = page.getByTestId("entity-registration-status");
    await expect(status).toBeVisible();
    await expect(status.getByText("已登记（未核验）")).toBeVisible();
    await expect(status.getByText("registration_e2e_001")).toBeVisible();
    await expect(status.getByText("91310000MA1K000000")).toBeVisible();
    await expect(status.getByText("自助登记（未核验）")).toBeVisible();
    await expect(page.getByText("服务端事实：verified = false、chainWritten = false。人工核验与链上身份绑定均未发生。")).toBeVisible();
    await expect(page.getByText("已登记（未核验）：档案编号 registration_e2e_001。本次只写入链下登记档案，未写链、未生成身份绑定。")).toBeVisible();

    await page.getByLabel("企业名称").fill("示例企业（更名）有限公司");
    await page.getByRole("button", { name: "提交注册" }).click();
    await expect(status.getByText("示例企业（更名）有限公司")).toBeVisible();
    await expect(status.getByText("registration_e2e_001")).toBeVisible();
  });

  test("shows a server rejection distinctly and does not fake success", async ({ page }) => {
    await installProductApiStub(page, { registrationMode: "unavailable" });
    await seedWalletSession(page);
    await page.goto("/#?section=registration");

    await page.getByLabel("企业名称").fill("示例企业有限公司");
    await page.getByLabel("注册号").fill("91310000MA1K000000");
    await page.getByLabel("联系人").fill("张经理");
    await page.getByRole("button", { name: "提交注册" }).click();

    await expect(page.getByText("登记未成功：服务端拒绝或失败")).toBeVisible();
    await expect(page.getByText(/服务端拒绝（503 \/ product_storage_unavailable）/)).toBeVisible();
    await expect(page.getByText("服务端返回失败时不会伪造成功；请按错误提示核对登记信息后重试。")).toBeVisible();
    await expect(page.getByTestId("entity-registration-status")).toHaveCount(0);
  });

  test("shows a network failure distinctly from a server rejection", async ({ page }) => {
    await installProductApiStub(page, { registrationMode: "network_error" });
    await seedWalletSession(page);
    await page.goto("/#?section=registration");

    await page.getByLabel("企业名称").fill("示例企业有限公司");
    await page.getByLabel("注册号").fill("91310000MA1K000000");
    await page.getByLabel("联系人").fill("张经理");
    await page.getByRole("button", { name: "提交注册" }).click();

    await expect(page.getByText("网络错误：没有收到成功响应")).toBeVisible();
    await expect(page.getByText("请求可能已到达服务端，也可能没有；请先刷新读取当前登记，再决定是否重新提交。")).toBeVisible();
    await expect(page.getByTestId("entity-registration-status")).toHaveCount(0);
  });
});
