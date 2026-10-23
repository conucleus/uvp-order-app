import { expect, test } from "@playwright/test";
import { decorationEvidenceTask, installProductApiStub } from "./product-api-stub";

/**
 * Rough v0 装修接线：reader 装修页（theme + 阶段/角色/证据要求）与任务
 * evidenceSpec 的装修补位。测试数据由 page.route 桩提供（不替代真实投影）。
 */
test.describe("Order App reader decoration + decoration evidence", () => {
  test("opens the used-car decoration page from a share link", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/?decoration=zhixu-used-car-export-v0");

    await expect(page.getByTestId("decoration-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "中国—中亚二手车出口 · 九步逐段确认" })).toBeVisible();
    await expect(page.getByTestId("decoration-tag").first()).toHaveText("二手车出口");
    await expect(page.getByTestId("decoration-highlights")).toContainText("每阶段先交材料");
    await expect(page.getByTestId("decoration-role").first()).toContainText("买方");

    // 阶段名 + 装修数据里的材料要求（文件/填写类型可辨）。
    await expect(page.getByTestId("decoration-stage").first()).toContainText("需求确认");
    await expect(page.getByText("意向车型与年份", { exact: true })).toBeVisible();
    await expect(page.getByText("装修材料：出口报关单", { exact: true })).toBeVisible();

    // selectedStages：执行者在订单内选定，不引入静态/动态执行者的产品概念。
    await expect(page.getByTestId("decoration-executor-note").first()).toContainText("订单内选定");
    await expect(page.getByText(/静态执行者|动态执行者/)).toHaveCount(0);

    // reader 面不暴露链语言（哈希/地址）。
    await expect(page.getByText(/0x[0-9a-f]{8}/i)).toHaveCount(0);
  });

  test("shows decoration evidenceSpec and order-time executor choice on a task carrying none", async ({ page }) => {
    await installProductApiStub(page, { task: decorationEvidenceTask() });
    await page.goto("/");

    // 任务详情：装修补位的证据要求 + 来源标注。
    await expect(page.getByRole("heading", { name: "确认需求并提交材料" })).toBeVisible();
    await expect(page.getByTestId("task-evidence-source-note")).toContainText("秩序装修数据");
    await expect(page.getByRole("heading", { name: "凭证提交" })).toBeVisible();
    await expect(page.getByLabel("意向车型与年份")).toBeVisible();

    // 秩序阶段声明 selectedStageTargets（DSL selectedStages）→ 订单内选择执行者入口。
    await expect(page.getByRole("heading", { name: "选择履约者" })).toBeVisible();
    await expect(page.getByText(/静态执行者|动态执行者/)).toHaveCount(0);
  });
});
