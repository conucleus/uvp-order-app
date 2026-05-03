import { expect, test } from "@playwright/test";

test.describe("PRD98 signal container evidence and proof experience", () => {
  test("blocks submit until required evidence references are supplied", async ({ page }) => {
    await page.goto("/");
    await openCustomsTask(page);

    await expect(page.getByRole("heading", { name: "交付进度更新" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "提交材料" })).toBeVisible();
    await expect(page.getByLabel("确认报关完成待完成事项").getByText("请填写：交付凭证引用")).toBeVisible();
    await expect(page.getByLabel("确认报关完成待完成事项").getByText("请完成：确认报关完成")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认报关完成", exact: true })).toBeDisabled();
  });

  test("shows signal container fingerprint language without plaintext download", async ({ page }) => {
    await page.goto("/");
    await openCustomsTask(page);

    await expect(page.getByLabel("待办提交要素").getByText("执行方钱包")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("必填输入/凭证")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("凭证指纹")).toBeVisible();
    await expect(page.getByText("下载原文")).toHaveCount(0);
  });

  test("keeps submit blocked when required inputs are present but wallet is not authorized", async ({ page }) => {
    await page.goto("/");
    await openCustomsTask(page);

    await page.getByLabel("交付凭证引用").fill("ev-customs-pdf-001");
    await page.getByRole("checkbox", { name: /确认报关完成/u }).check();

    await expect(page.getByLabel("确认报关完成待完成事项").getByText("当前钱包暂不能提交此待办。")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认报关完成", exact: true })).toBeDisabled();
  });

  test("opens proof drawer from the chain-backed proof summary", async ({ page }) => {
    await page.goto("/");
    await openCustomsTask(page);

    await page.getByRole("button", { name: "查看证明" }).last().click();

    await expect(page.getByRole("heading", { name: "证明摘要" })).toBeVisible();
    await expect(page.getByText("交易编号").first()).toBeVisible();
    await expect(page.getByText("区块高度").first()).toBeVisible();
    await expect(page.getByText("凭证指纹").first()).toBeVisible();
    await expect(page.getByText("证明摘要只显示状态、交易编号和指纹，不显示业务文件原文。")).toBeVisible();
    await expect(page.getByText("下载原文")).toHaveCount(0);
  });
});

async function openCustomsTask(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /确认出口报关完成/ }).click();
}
