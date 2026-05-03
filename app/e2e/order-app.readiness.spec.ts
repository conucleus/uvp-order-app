import { expect, test } from "@playwright/test";
import {
  installProductApiStub,
  executorMetadataHash,
  handoffSelectorTask,
  manifestTask,
  participantWallet,
  previousExecutorWallet,
  readinessTask,
  replacementSelectorTask,
  resourcePatchTask,
  selectorTask,
  unauthorizedWallet,
  uploadCustomsPdf,
  executorManifestTask
} from "./product-api-stub";

test.describe("UVP Order App production readiness negatives", () => {
  test("shows signal container wallet, trust, requirements, and proof context", async ({ page }) => {
    await installProductApiStub(page, {
      task: readinessTask({
        supplierSubjectId: "supplier-customs-1",
        supplierTrustStatus: "attested",
        proofSummary: {
          label: "等待提交凭证",
          payloadHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
        }
      })
    });
    await page.goto("/");

    await expect(page.getByText("UVP Signal Console")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("执行方钱包")).toBeVisible();
    await expect(page.getByText("供应商背书：已背书")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("必填输入/凭证")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("凭证指纹")).toBeVisible();

    await page.getByRole("button", { name: "证明", exact: true }).click();
    await expect(page.getByLabel("待办证明要素").getByText("已背书")).toBeVisible();
    await expect(page.getByLabel("待办证明要素").getByText("0x1111111111111111111111111111111111111111111111111111111111111111")).toBeVisible();
  });

  test("negative: missing evidence blocks submission", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/");

    await expect(page.getByText("已连接")).toBeVisible();
    await expect(page.getByRole("heading", { name: "凭证提交" })).toBeVisible();
    await expect(page.getByText("缺少必填凭证：报关单 PDF")).toBeVisible();
    await expect(page.getByRole("button", { name: "准备提交" })).toBeDisabled();
  });

  test("negative: unauthorized wallet is rejected", async ({ page }) => {
    await installProductApiStub(page);
    await page.goto("/");

    await page.getByLabel("签名钱包").fill(unauthorizedWallet);

    await expect(page.getByText("钱包与授权参与方不匹配。")).toBeVisible();
    await expect(page.getByRole("button", { name: "准备提交" })).toBeDisabled();
  });

  test("negative: wallet rejected can be retried", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "reject" });
    await page.goto("/");

    await page.getByLabel("签名钱包").fill(participantWallet);
    await uploadCustomsPdf(page);
    await expect(page.getByText("上传完成，可用于提交")).toBeVisible();
    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("预检编号")).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await expect(page.getByRole("alert").getByText("钱包签名被拒绝，未创建提交。")).toBeVisible();
    await expect(page.getByText("提交已确认")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "使用钱包签名并提交" })).toBeEnabled();
  });

  test("negative: missing injected wallet fails closed", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await page.goto("/");

    await page.getByLabel("签名钱包").fill(participantWallet);
    await uploadCustomsPdf(page);

    await expect(page.getByText("未检测到浏览器钱包，不能创建业务签名。")).toBeVisible();
    await expect(page.getByRole("button", { name: "准备提交" })).toBeDisabled();
  });

  test("negative: indexer syncing state remains visible", async ({ page }) => {
    await installProductApiStub(page, { submitStatus: "indexing" });
    await page.goto("/");

    await page.getByLabel("签名钱包").fill(participantWallet);
    await uploadCustomsPdf(page);
    await page.getByRole("button", { name: "准备提交" }).click();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await expect(page.getByText("提交已收到，等待索引确认")).toBeVisible();
    await expect(page.getByText("提交已确认")).toHaveCount(0);
  });

  test("negative: revoked plan warning remains visible", async ({ page }) => {
    await installProductApiStub(page, {
      task: readinessTask({
        supplierTrustStatus: "revoked",
        canSubmit: false
      })
    });
    await page.goto("/");

    await expect(page.getByText("当前供应商链上背书已撤销，请暂停提交并联系订单负责人。")).toBeVisible();
    await expect(page.getByLabel("待办提交要素").getByText("背书已撤销")).toBeVisible();
    await expect(page.getByLabel("提交阻断原因").getByText("当前钱包暂不能提交此待办。")).toBeVisible();
    await expect(page.getByLabel("提交阻断原因").getByText("供应商背书已撤销，不能继续提交。")).toBeVisible();
  });

  test("submit_signal add-on renders resource requirements and access status", async ({ page }) => {
    await installProductApiStub(page, {
      task: readinessTask({
        addOnKind: "submit_signal",
        requiredEvidence: [],
        requiredInputs: [],
        resourceRequirements: {
          inspection_report: {
            label: "第三方检验证明",
            documentType: "inspection_report",
            required: true,
            sourceLabel: "来自资源补充",
            visibility: "protected",
            manifestURI: "ipfs://bafyuvp-inspection-manifest",
            ciphertextHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
            accessStatus: {
              state: "request_required",
              label: "需要授权后查看加密文件",
              canRead: false
            }
          }
        },
        executorOverlay: {
          targetStageId: "inspection",
          activeExecutorWallet: participantWallet,
          patchHash: "0x6666666666666666666666666666666666666666666666666666666666666666",
          proofRows: [{ label: "StageExecutorPatchApplied", value: "confirmed" }]
        }
      })
    });
    await page.goto("/");

    await expect(page.getByLabel("有效凭证要求").getByText("第三方检验证明")).toBeVisible();
    await expect(page.getByLabel("资源权限").getByText("需要授权后查看加密文件")).toBeVisible();
    await expect(page.getByLabel("履约者证明").getByText(participantWallet)).toBeVisible();
    await expect(page.getByLabel("选择第三方检验证明")).toBeVisible();
  });

  test("manifest executor patch action prepares, signs, and submits an executor patch", async ({ page }) => {
    await installProductApiStub(page, { task: manifestTask("task-selector-customs-001") });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "选择履约者" })).toBeVisible();
    await expect(page.getByText("为目标阶段选择、交接或替换后续履约者。")).toBeVisible();
    await expect(page.getByLabel("目标阶段")).toBeVisible();

    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者元数据指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://manifest/executor-patch");
    await page.getByRole("button", { name: "选择履约者", exact: true }).click();

    await expect(page.getByText("浏览器钱包只签署当前附加能力动作")).toBeVisible();
    await expect(page.locator(".signature-box").getByText("动作", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await expect(page.getByText("最近提交：选择履约者，包含交易哈希和凭证指纹摘要。")).toBeVisible();
    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("StageExecutorPatchApplied")).toBeVisible();
  });

  test("manifest resource patch add-on prepares a resource patch", async ({ page }) => {
    await installProductApiStub(page, { task: manifestTask("task-resource-controller-001") });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "补充凭证要求" })).toBeVisible();
    await expect(page.getByLabel("资源清单 URI")).toBeVisible();
    await expect(page.getByLabel("有效凭证要求").getByText("报关单 PDF")).toBeVisible();

    await page.getByLabel("资源键").fill("inspection_report");
    await page.getByLabel("资源清单 URI").fill("ipfs://manifest/resource-patch");
    await page.getByLabel("清单指纹").fill("0x5555555555555555555555555555555555555555555555555555555555555555");
    await page.getByLabel("权限指纹").fill("0x8888888888888888888888888888888888888888888888888888888888888888");
    await page.getByRole("button", { name: "补充凭证要求", exact: true }).click();

    await expect(page.getByText("浏览器钱包只签署当前附加能力动作")).toBeVisible();
    await expect(page.locator(".signature-box").getByText("动作", { exact: true })).toBeVisible();
    await expect(page.locator(".signature-box").getByText("补充凭证要求", { exact: true })).toBeVisible();
  });

  test("manifest submit_signal add-on prepares and submits a signal", async ({ page }) => {
    await installProductApiStub(page, { task: manifestTask("task-customs-complete-001") });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "交付进度更新" })).toBeVisible();
    await page.getByLabel("交付凭证引用").fill("ev-customs-pdf-001");
    await page.getByRole("checkbox", { name: /确认报关完成/u }).check();
    await page.getByRole("button", { name: "确认报关完成", exact: true }).click();

    await expect(page.getByText("浏览器钱包只签署当前附加能力动作")).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await expect(page.getByText("最近提交：确认报关完成，包含交易哈希和凭证指纹摘要。")).toBeVisible();
    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("提交状态")).toBeVisible();
  });

  test("manifest submit_signal add-on renders a signal submit shell", async ({ page }) => {
    await installProductApiStub(page, { task: executorManifestTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "检验验收确认" })).toBeVisible();
    await expect(page.getByLabel("验收凭证引用")).toBeVisible();
    await page.getByLabel("验收凭证引用").fill("ev-inspection-report-001");
    await page.getByRole("checkbox", { name: /确认验收结果/u }).check();

    await expect(page.getByRole("button", { name: "确认验收结果", exact: true })).toBeEnabled();
  });

  test("executor patch action prepares, signs, and submits an executor patch", async ({ page }) => {
    await installProductApiStub(page, { task: selectorTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "选择检验履约者" })).toBeVisible();
    await expect(page.getByLabel("可管理阶段").getByText("检验阶段")).toBeVisible();
    await expect(page.getByLabel("补充凭证要求")).toHaveCount(0);

    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://executor-patch/inspection");
    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("准备编号 prep-executor-patch-001")).toBeVisible();
    await expect(page.getByText("选择指纹")).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("StageExecutorPatchApplied")).toBeVisible();
    await expect(page.getByText("处理方式").first()).toBeVisible();
    await expect(page.getByText("选择履约者", { exact: true }).first()).toBeVisible();
  });

  test("executor patch action requires old executor signature for voluntary handoff", async ({ page }) => {
    await installProductApiStub(page, { task: handoffSelectorTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "交接履约者" })).toBeVisible();
    await expect(page.getByLabel("履约权限说明").getByText("已完成部分不变")).toBeVisible();
    await expect(page.getByLabel("原履约者钱包")).toHaveValue(previousExecutorWallet);
    await expect(page.getByLabel("替换证明来源")).toHaveCount(0);

    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://executor-patch/handoff");
    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("准备编号 prep-executor-patch-001")).toBeVisible();
    await expect(page.getByLabel("原履约者签名")).toBeVisible();
    await expect(page.getByRole("button", { name: "使用钱包签名并提交" })).toBeDisabled();

    await page.getByLabel("原履约者签名").fill(`0x${"cc".repeat(65)}`);
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("StageExecutorPatchApplied")).toBeVisible();
    await expect(page.getByText("原履约者", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(previousExecutorWallet).first()).toBeVisible();
  });

  test("executor patch action requires approval proof for post-start replacement", async ({ page }) => {
    await installProductApiStub(page, { task: replacementSelectorTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "申请替换履约者" })).toBeVisible();
    await expect(page.getByLabel("履约权限说明").getByText("已完成部分不变")).toBeVisible();
    await expect(page.getByLabel("履约权限说明").getByText("需要替换证明")).toBeVisible();
    await expect(page.getByLabel("替换证明来源")).toBeVisible();
    await expect(page.getByLabel("原履约者签名")).toHaveCount(0);

    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://executor-patch/replacement");
    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("准备编号 prep-executor-patch-001")).toBeVisible();
    await expect(page.getByText("替换证明", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("StageExecutorPatchApplied")).toBeVisible();
    await expect(page.getByText("替换证明").first()).toBeVisible();
  });

  test("resource patch add-on prepares, signs, and submits a resource patch", async ({ page }) => {
    await installProductApiStub(page, { task: resourcePatchTask() });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "补充检验凭证要求" })).toBeVisible();
    await expect(page.getByLabel("资源清单 URI")).toHaveValue("ipfs://bafyuvp-inspection-manifest");
    await expect(page.getByLabel("资源键")).toContainText("第三方检验证明");

    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("准备编号 prep-resource-patch-001")).toBeVisible();
    await expect(page.getByText("权限指纹", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await page.getByRole("button", { name: "查看证明" }).last().click();
    await expect(page.getByText("StageResourcePatchApplied")).toBeVisible();
  });

  test("executor patch action blocks wrong wallet before executor patch prepare", async ({ page }) => {
    await installProductApiStub(page, { task: selectorTask() });
    await page.goto("/");

    await page.getByLabel("选择方钱包").fill(unauthorizedWallet);
    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://executor-patch/inspection");

    await expect(page.getByLabel("履约者选择阻断原因").getByText("钱包与授权参与方不匹配。")).toBeVisible();
    await expect(page.getByRole("button", { name: "准备提交" })).toBeDisabled();
  });

  test("executor patch action keeps rejected signature retryable", async ({ page }) => {
    await installProductApiStub(page, { task: selectorTask(), walletMode: "reject" });
    await page.goto("/");

    await page.getByRole("textbox", { name: "履约者钱包", exact: true }).fill("0x0000000000000000000000000000000000000002");
    await page.getByLabel("履约者指纹").fill(executorMetadataHash);
    await page.getByLabel("补充说明 URI").fill("ipfs://executor-patch/inspection");
    await page.getByRole("button", { name: "准备提交" }).click();
    await expect(page.getByText("准备编号 prep-executor-patch-001")).toBeVisible();
    await page.getByRole("button", { name: "使用钱包签名并提交" }).click();

    await expect(page.getByRole("alert").getByText("钱包签名被拒绝，未创建提交。")).toBeVisible();
    await expect(page.getByText("选择履约者已确认。")).toHaveCount(0);
  });
});
