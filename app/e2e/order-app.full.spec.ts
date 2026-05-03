import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertOrderAppFullModeGate,
  isStubProductApiUrl,
  orderAppFullModeRequiredEvents,
  type OrderAppFullModeEventName,
  type OrderAppFullModeGate
} from "../src/testing/orderAppFullModeGate";
import {
  filterProductTasksForOrder,
  findProductTaskForOrderByAction,
  productTaskActionKinds,
  selectParticipantWalletsFromFullSummary
} from "../src/testing/orderAppFullSummary";

type Hex = `0x${string}`;
type JsonRecord = Record<string, unknown>;
type EventName = OrderAppFullModeEventName;

interface TaskListResponse {
  readonly tasks: readonly ProductTaskDTO[];
}

interface OrderResponse {
  readonly order: Phase2ProductOrderDTO;
}

interface ProofResponse {
  readonly proof: unknown;
}

type Phase2ProductOrderDTO = ProductOrderDTO & {
  readonly planId?: string;
  readonly planHash?: string;
};

interface SummaryExpectations {
  readonly raw: JsonRecord;
  readonly path: string;
  readonly chainServicesUrl: string;
  readonly planId: string;
  readonly planHash: string;
  readonly orderId: string;
  readonly selectorWallet: string;
  readonly resourcePatchWallet: string;
  readonly activeExecutorWallet: string;
  readonly nonSelectedExecutorWallet: string;
  readonly executorMetadataHash: string;
  readonly executorMetadataURI: string;
  readonly resourceKey: string;
  readonly resourceManifestURI: string;
  readonly resourceManifestHash: string;
  readonly resourcePolicyHash: string;
  readonly evidenceRef: string;
  readonly eventTxHashes: Readonly<Record<EventName, string>>;
}

const requiredEvents: readonly EventName[] = orderAppFullModeRequiredEvents;
const fullModeEnabled = process.env.UVP_ORDER_APP_E2E_PROFILE === "full";
const fullModeGate = fullModeEnabled ? assertOrderAppFullModeGate(process.env) : undefined;
const summary = fullModeGate ? readSummaryExpectations(fullModeGate) : placeholderSummary();

test.describe.serial("PRD104 full Order App staging participant gate", () => {
  test.skip(
    !fullModeEnabled,
    "PRD104 full E2E requires UVP_ORDER_APP_E2E_PROFILE=full, Product API URL, and flow summary"
  );

  test.beforeAll(() => {
    assertSummaryGate(summary);
  });

  test("Product DTOs expose chain-backed Phase 2 proof data", async ({ request }) => {
    const selectorTasks = await loadParticipantTasks(request, summary.selectorWallet);
    const resourcePatchTasks = await loadParticipantTasks(request, summary.resourcePatchWallet);
    const executorTasks = await loadParticipantTasks(request, summary.activeExecutorWallet);
    const selectorTask = findTaskByAction(selectorTasks, "stage_executor_patch", "selector wallet");
    const resourcePatchTask = findTaskByAction(resourcePatchTasks, "stage_resource_patch", "resource patch wallet");
    const submitSignalTask = findTaskByAction(executorTasks, "submit_signal");
    const order = await loadOrder(request, summary.orderId);
    const proof = await loadOrderProof(request, summary.orderId);
    const dtoText = flattenStrings([order, proof, selectorTask, resourcePatchTask, submitSignalTask]).join("\n");

    expect(order.orderId).toBe(summary.orderId);
    expect(order.planId).toBe(summary.planId);
    expect(order.planHash).toBe(summary.planHash);
    expect(selectorTask.addOnManifest?.schemaVersion).toBe("participant-addon-manifest.v1");
    expect(resourcePatchTask.addOnManifest?.schemaVersion).toBe("participant-addon-manifest.v1");
    expect(submitSignalTask.addOnManifest?.schemaVersion).toBe("participant-addon-manifest.v1");

    for (const eventName of requiredEvents) {
      expect(dtoText, `Product DTO proof should include ${eventName}`).toContain(eventName);
      expect(dtoText, `Product DTO proof should include ${eventName} tx hash`).toContain(summary.eventTxHashes[eventName]);
    }
    expectAddressText(dtoText, summary.activeExecutorWallet, "active executor wallet");
    expect(dtoText).toContain(summary.resourceManifestHash);
    expect(dtoText).toContain(summary.resourcePolicyHash);
  });

  test("buyer selector session renders manifest and submits or verifies executor patch proof", async ({ page, request }) => {
    await installSigningWallet(page, [summary.selectorWallet]);
    const selectorTasks = await loadParticipantTasks(request, summary.selectorWallet);
    const selectorTask = findTaskByAction(selectorTasks, "stage_executor_patch", "selector wallet");

    const detail = await openTask(page, summary.selectorWallet, selectorTask);
    await expectNoDemoFallback(page);
    await expectTaskAddOnManifest(detail, selectorTask);
    await expect(detail.getByLabel("目标阶段").first()).toBeVisible();

    await submitSelectorPatchIfOpen(page, selectorTask);
    await assertProofSurface(page, selectorTask, await loadOrderProof(request, summary.orderId), "StageExecutorPatchApplied");
  });

  test("buyer resource patch session renders resource manifest and submits or verifies resource proof", async ({ page, request }) => {
    await installSigningWallet(page, [summary.resourcePatchWallet]);
    const resourcePatchTasks = await loadParticipantTasks(request, summary.resourcePatchWallet);
    const resourcePatchTask = findTaskByAction(resourcePatchTasks, "stage_resource_patch", "resource patch wallet");

    const detail = await openTask(page, summary.resourcePatchWallet, resourcePatchTask);
    await expectNoDemoFallback(page);
    await expectTaskAddOnManifest(detail, resourcePatchTask);
    await expect(detail.getByLabel("资源清单 URI").first()).toBeVisible();
    await expectLabeledInputValue(detail, /资源清单指纹|清单指纹/u, summary.resourceManifestHash);
    await assertTaskDtoContains(resourcePatchTask, summary.resourcePolicyHash, "resource policy hash");
    await expectOptionalLabeledInputValue(detail, /访问策略指纹|权限指纹/u, summary.resourcePolicyHash);

    await submitResourcePatchIfOpen(page, resourcePatchTask);
    await assertProofSurface(page, resourcePatchTask, await loadOrderProof(request, summary.orderId), "StageResourcePatchApplied");
  });

  test("customs executor session renders resources and submits or verifies submit signal", async ({ page, request }) => {
    await installSigningWallet(page, [summary.activeExecutorWallet]);
    const executorTasks = await loadParticipantTasks(request, summary.activeExecutorWallet);
    const submitSignalTask = findTaskByAction(executorTasks, "submit_signal");

    const detail = await openTask(page, summary.activeExecutorWallet, submitSignalTask);
    await expectNoDemoFallback(page);
    await expectTaskAddOnManifest(detail, submitSignalTask);
    await expect(detail.getByLabel(/凭证引用|凭证|材料|引用/u).first()).toBeVisible();
    await assertTaskDtoContainsAddress(submitSignalTask, summary.activeExecutorWallet, "active executor wallet");
    await expectExecutionWalletSurface(detail, summary.activeExecutorWallet);

    await submitSignalIfOpen(page, submitSignalTask);
    await assertProofSurface(page, submitSignalTask, await loadOrderProof(request, summary.orderId), "SignalSubmitted");
  });

  test("negative: wrong selector wallet is blocked before executor patch prepare", async ({ page, request }) => {
    await installSigningWallet(page, [summary.selectorWallet]);
    const selectorTask = findTaskByAction(
      await loadParticipantTasks(request, summary.selectorWallet),
      "stage_executor_patch",
      "selector wallet"
    );

    const detail = await openTask(page, summary.selectorWallet, selectorTask);
    await fillByLabel(detail, /选择方钱包|买家钱包|selector wallet/u, summary.nonSelectedExecutorWallet);
    await fillByLabel(detail, /履约者钱包|报关履约者钱包/u, summary.activeExecutorWallet);
    await fillByLabel(detail, /履约者元数据指纹|履约者指纹|executorMetadataHash/u, summary.executorMetadataHash);
    await fillOptionalByLabel(detail, /履约者元数据 URI|补充说明 URI|metadata URI/u, contentAddressedUriForForm(
      summary.executorMetadataURI,
      summary.executorMetadataHash
    ));

    await expect(detail.getByText(/钱包与授权参与方不匹配/u).first()).toBeVisible();
    await expect(detail.getByRole("button", { name: /选择报关履约者|选择履约者|准备提交/u }).first()).toBeDisabled();
  });

  test("negative: non-selected executor cannot access submit signal task", async ({ page, request }) => {
    const tasks = await loadParticipantTasks(request, summary.nonSelectedExecutorWallet);
    expect(tasks.filter((task) => actionKinds(task).includes("submit_signal"))).toHaveLength(0);

    await installSigningWallet(page, []);
    await page.goto(walletUrl(summary.nonSelectedExecutorWallet));
    await expectNoDemoFallback(page);
    await expect(page.getByRole("heading", { name: "暂无待办" })).toBeVisible();
    await expect(page.getByRole("button", { name: /使用钱包签名并提交|准备提交/u })).toHaveCount(0);
  });
});

function readSummaryExpectations(gate: OrderAppFullModeGate): SummaryExpectations {
  const path = gate.flowSummaryPath;
  const chainServicesUrl = trimTrailingSlash(
    process.env.UVP_ORDER_APP_FULL_CHAIN_SERVICES_URL ??
    process.env.UVP_ORDER_APP_BROWSER_E2E_CHAIN_SERVICES_URL ??
    gate.productApiBaseUrl
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  const participantWallets = selectParticipantWalletsFromFullSummary(raw);
  return {
    raw,
    path,
    chainServicesUrl,
    planId: requiredString(raw, ["planId", "productPlan.planId", "plan.planId"], "planId"),
    planHash: requiredString(raw, ["planHash", "productPlan.planHash", "plan.planHash"], "planHash"),
    orderId: requiredString(raw, ["orderId", "productOrder.orderId", "order.orderId"], "orderId"),
    selectorWallet: participantWallets.selectorWallet,
    resourcePatchWallet: participantWallets.resourcePatchWallet,
    activeExecutorWallet: requiredString(raw, [
      "wallets.customsExecutor",
      "wallets.executor",
      "wallets.activeExecutor",
      "activeExecutorWallet",
      "executorWallet"
    ], "active executor wallet"),
    nonSelectedExecutorWallet: optionalString(raw, [
      "wallets.nonSelectedExecutor",
      "wallets.unselectedExecutor",
      "nonSelectedExecutorWallet"
    ]) ?? "0x0000000000000000000000000000000000000bad",
    executorMetadataHash: optionalString(raw, [
      "executorMetadataHash",
      "stageExecutorPatch.executorMetadataHash",
      "transactions.StageExecutorPatchApplied.executorMetadataHash"
    ]) ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    executorMetadataURI: optionalString(raw, [
      "executorMetadataURI",
      "metadataURI",
      "stageExecutorPatch.metadataURI",
      "transactions.StageExecutorPatchApplied.metadataURI"
    ]) ?? "ipfs://phase2-customs-executor-metadata",
    resourceKey: optionalString(raw, [
      "resourceManifest.resourceKey",
      "stageResourcePatch.resourceKey",
      "resourceKey"
    ]) ?? "customs_declaration_pdf",
    resourceManifestURI: optionalString(raw, [
      "resourceManifest.manifestURI",
      "stageResourcePatch.manifestURI",
      "manifestURI"
    ]) ?? "ipfs://phase2-customs-resource-manifest",
    resourceManifestHash: requiredString(raw, [
      "resourceManifest.manifestHash",
      "resourceManifest.hash",
      "stageResourcePatch.manifestHash",
      "resourceManifestHash",
      "manifestHash"
    ], "resource manifest hash"),
    resourcePolicyHash: requiredString(raw, [
      "resourceManifest.policyHash",
      "stageResourcePatch.policyHash",
      "resourcePolicyHash",
      "policyHash"
    ], "resource policy hash"),
    evidenceRef: requiredEvidenceRef(raw),
    eventTxHashes: Object.fromEntries(requiredEvents.map((eventName) => [
      eventName,
      requiredString(raw, eventTxHashPaths(eventName), `${eventName} tx hash`)
    ])) as Readonly<Record<EventName, string>>
  };
}

function placeholderSummary(): SummaryExpectations {
  return {
    raw: {},
    path: "",
    chainServicesUrl: "",
    planId: "",
    planHash: "",
    orderId: "",
    selectorWallet: "",
    resourcePatchWallet: "",
    activeExecutorWallet: "",
    nonSelectedExecutorWallet: "",
    executorMetadataHash: "",
    executorMetadataURI: "",
    resourceKey: "",
    resourceManifestURI: "",
    resourceManifestHash: "",
    resourcePolicyHash: "",
    evidenceRef: "",
    eventTxHashes: {
      StageExecutorPatchApplied: "",
      StageExecutorActivated: "",
      StageResourcePatchApplied: "",
      SignalSubmitted: ""
    }
  };
}

function assertSummaryGate(input: SummaryExpectations): void {
  expect(booleanAtAny(input.raw, ["chainBackedFlowData", "fullChainBacked"])).toBe(true);
  expect(booleanAtAny(input.raw, ["noDemoFallback", "demoFixtureDisabled"])).toBe(true);
  const status = optionalString(input.raw, ["status"]);
  if (status) {
    expect(status).toBe("passed");
  }
  expect(
    isStubProductApiUrl(input.chainServicesUrl),
    "full-mode summary must not point at an API stub URL"
  ).toBe(false);
  for (const eventName of requiredEvents) {
    expect(booleanAtAny(input.raw, eventBooleanPaths(eventName)), `${eventName} boolean`).toBe(true);
    expect(input.eventTxHashes[eventName], `${eventName} tx hash`).toMatch(/^0x[0-9a-fA-F]{64}$/u);
    expect(input.eventTxHashes[eventName], `${eventName} tx hash must not be zero`).not.toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
  }
}

async function loadParticipantTasks(request: APIRequestContext, walletAddress: string): Promise<readonly ProductTaskDTO[]> {
  const query = new URLSearchParams({
    walletAddress,
    orderId: summary.orderId
  });
  const filteredResponse = await request.get(`${summary.chainServicesUrl}/product/me/tasks?${query}`);
  const response = filteredResponse.ok() || !shouldRetryTasksWithoutOrderId(filteredResponse.status())
    ? filteredResponse
    : await request.get(`${summary.chainServicesUrl}/product/me/tasks?${new URLSearchParams({ walletAddress })}`);
  expect(response.ok(), await response.text()).toBe(true);
  return filterProductTasksForOrder(((await response.json()) as TaskListResponse).tasks, summary.orderId);
}

function shouldRetryTasksWithoutOrderId(status: number): boolean {
  return status === 400 || status === 404;
}

async function loadOrder(request: APIRequestContext, orderId: string): Promise<Phase2ProductOrderDTO> {
  const response = await request.get(`${summary.chainServicesUrl}/product/orders/${encodeURIComponent(orderId)}`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as OrderResponse).order;
}

async function loadOrderProof(request: APIRequestContext, orderId: string): Promise<unknown> {
  const response = await request.get(`${summary.chainServicesUrl}/product/orders/${encodeURIComponent(orderId)}/proof`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as ProofResponse).proof;
}

function findTaskByAction(tasks: readonly ProductTaskDTO[], actionKind: string, participantLabel = "participant wallet"): ProductTaskDTO {
  const task = findProductTaskForOrderByAction(tasks, summary.orderId, actionKind);
  if (!task) {
    const currentOrderTasks = filterProductTasksForOrder(tasks, summary.orderId);
    const availableActions = currentOrderTasks.flatMap(productTaskActionKinds);
    const ignoredOrderIds = Array.from(new Set(tasks
      .filter((item) => item.orderId.trim().toLowerCase() !== summary.orderId.trim().toLowerCase())
      .map((item) => item.orderId)));
    throw new Error(
      [
        `no ${participantLabel} task for order ${summary.orderId} exposes add-on action ${actionKind}`,
        `available current-order actions: ${availableActions.join(", ") || "none"}`,
        ignoredOrderIds.length > 0 ? `ignored task orderIds: ${ignoredOrderIds.join(", ")}` : ""
      ].filter(Boolean).join("; ")
    );
  }
  expect(task.addOnManifest?.schemaVersion).toBe("participant-addon-manifest.v1");
  return task;
}

function actionKinds(task: ProductTaskDTO): readonly string[] {
  return productTaskActionKinds(task);
}

async function installSigningWallet(page: Page, allowedWallets: readonly string[]): Promise<void> {
  const accounts = signingAccounts().filter((account) =>
    allowedWallets.length === 0 || allowedWallets.some((wallet) => sameAddress(wallet, account.address))
  );
  const missingWallets = allowedWallets.filter((wallet) =>
    !accounts.some((account) => sameAddress(wallet, account.address))
  );
  if (missingWallets.length > 0) {
    throw new Error([
      `no PRD104 test private key configured for wallet ${missingWallets.join(", ")}`,
      "set UVP_STAGING_SELECTOR_PRIVATE_KEY for executor patch actions, UVP_PHASE2_BUYER_PRIVATE_KEY for resource patch actions, and UVP_PHASE2_CUSTOMS_EXECUTOR_PRIVATE_KEY for submit signal actions"
    ].join("; "));
  }
  await page.exposeFunction("__uvpOrderAppE2eSignTypedData", async (walletAddress: string, encodedTypedData: string) => {
    const account = accounts.find((item) => sameAddress(item.address, walletAddress));
    if (!account) {
      throw new Error(`no PRD104 test private key configured for ${walletAddress}`);
    }
    const typedData = JSON.parse(encodedTypedData) as {
      readonly domain: Record<string, unknown>;
      readonly types: Record<string, unknown>;
      readonly primaryType: string;
      readonly message: Record<string, unknown>;
    };
    const { EIP712Domain: _domain, ...types } = typedData.types;
    return await account.account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: typedData.message
    } as never);
  });
  await page.addInitScript(() => {
    const provider = {
      request: async ({ method, params }: { readonly method: string; readonly params?: readonly unknown[] }) => {
        if (method !== "eth_signTypedData_v4") {
          throw new Error(`unsupported wallet method ${method}`);
        }
        const walletAddress = String(params?.[0] ?? "");
        const typedData = typeof params?.[1] === "string" ? params[1] : JSON.stringify(params?.[1] ?? {});
        return await (window as typeof window & {
          __uvpOrderAppE2eSignTypedData(walletAddress: string, typedData: string): Promise<string>;
        }).__uvpOrderAppE2eSignTypedData(walletAddress, typedData);
      }
    };
    (window as typeof window & { ethereum?: typeof provider }).ethereum = provider;
  });
}

interface SigningAccount {
  readonly address: string;
  readonly account: ReturnType<typeof privateKeyToAccount>;
}

function signingAccounts(): SigningAccount[] {
  const keys = [
    optionalEnvPrivateKey("UVP_STAGING_SELECTOR_PRIVATE_KEY"),
    requiredEnvPrivateKey("UVP_PHASE2_BUYER_PRIVATE_KEY"),
    requiredEnvPrivateKey("UVP_PHASE2_CUSTOMS_EXECUTOR_PRIVATE_KEY")
  ].filter((key): key is Hex => Boolean(key));
  const accounts = keys.map((key) => {
    const account = privateKeyToAccount(key);
    return {
      address: account.address,
      account
    };
  });
  return accounts.filter((account, index) =>
    accounts.findIndex((candidate) => sameAddress(candidate.address, account.address)) === index
  );
}

function requiredEnvPrivateKey(name: string): Hex {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${name} must be set to a 32-byte private key for full Order App E2E signing`);
  }
  return value as Hex;
}

function optionalEnvPrivateKey(name: string): Hex | undefined {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${name} must be a 32-byte private key for full Order App E2E signing when set`);
  }
  return value as Hex;
}

async function openTask(page: Page, walletAddress: string, task: ProductTaskDTO): Promise<Locator> {
  await page.goto(walletUrl(walletAddress, task));
  await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
  await expect(page.getByRole("status").getByText("开发样例模式")).toHaveCount(0);
  await expect(page.getByText("参与者服务未配置")).toHaveCount(0);
  const detail = taskDetailPanel(page);
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: task.title, exact: true, level: 2 })).toBeVisible();
  return detail;
}

function taskDetailPanel(page: Page): Locator {
  return page.getByRole("complementary", { name: "待办详情" });
}

async function expectTaskAddOnManifest(detail: Locator, task: ProductTaskDTO): Promise<void> {
  const manifest = detail.locator(".addon-manifest-card");
  await expect(manifest).toBeVisible();
  await expect(manifest.getByText("任务附加能力", { exact: true })).toBeVisible();
  if (task.addOnManifest?.title) {
    await expect(manifest.locator("#addon-manifest-title")).toHaveText(task.addOnManifest.title);
  } else {
    await expect(manifest.locator("#addon-manifest-title")).toBeVisible();
  }
}

async function expectExecutionWalletSurface(detail: Locator, wallet: string): Promise<void> {
  const submitElements = detail.getByLabel("待办提交要素");
  if (await submitElements.count()) {
    const submitSummary = submitElements.first();
    await expect(submitSummary).toBeVisible();
    await expect(submitSummary.getByText("执行方钱包", { exact: true })).toBeVisible();
    await expect(submitSummary.getByText(addressPattern(wallet)).first()).toBeVisible();
    return;
  }
  await expect(detail.getByText("执行方钱包", { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(addressPattern(wallet)).first()).toBeVisible();
}

function walletUrl(walletAddress: string, task?: ProductTaskDTO): string {
  const search = new URLSearchParams({ uvpParticipantWallet: walletAddress });
  const hash = new URLSearchParams({ section: "tasks" });
  if (task) {
    hash.set("task", task.taskId);
    hash.set("order", task.orderId);
  }
  return `/?${search.toString()}#${hash.toString()}`;
}

async function expectNoDemoFallback(page: Page): Promise<void> {
  await expect(page.locator(".source-badge.source-real")).toHaveText("已连接");
  await expect(page.locator(".source-badge.source-demo")).toHaveCount(0);
  await expect(page.getByRole("status").getByText("开发样例模式", { exact: true })).toHaveCount(0);
  await expect(page.getByText("参与者服务未配置", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/stub|fallback|demo/i)).toHaveCount(0);
}

async function submitSelectorPatchIfOpen(page: Page, task: ProductTaskDTO): Promise<void> {
  if (taskHasProof(task)) {
    return;
  }
  if (task.status !== "open" || task.canSubmit === false) {
    return;
  }
  const detail = taskDetailPanel(page);
  await fillByLabel(detail, /选择方钱包|买家钱包|selector wallet/u, summary.selectorWallet);
  await fillByLabel(detail, /履约者钱包|报关履约者钱包/u, summary.activeExecutorWallet);
  await fillByLabel(detail, /履约者元数据指纹|履约者指纹|executorMetadataHash/u, summary.executorMetadataHash);
  await fillOptionalByLabel(detail, /履约者元数据 URI|补充说明 URI|metadata URI/u, contentAddressedUriForForm(
    summary.executorMetadataURI,
    summary.executorMetadataHash
  ));
  await clickFirstEnabled(detail, /选择报关履约者|选择履约者|准备提交/u);
  await expect(detail.getByText(/浏览器钱包只签署|准备编号/u).first()).toBeVisible();
  await detail.getByRole("button", { name: "使用钱包签名并提交" }).click();
}

async function submitResourcePatchIfOpen(page: Page, task: ProductTaskDTO): Promise<void> {
  if (taskHasProof(task)) {
    return;
  }
  if (task.status !== "open" || task.canSubmit === false) {
    return;
  }
  const detail = taskDetailPanel(page);
  await fillOptionalByLabel(detail, /请求方钱包|买家钱包/u, summary.resourcePatchWallet);
  await fillByLabel(detail, /资源键/u, summary.resourceKey);
  await fillByLabel(detail, /资源清单 URI/u, contentAddressedUriForForm(summary.resourceManifestURI, summary.resourceManifestHash));
  await fillByLabel(detail, /资源清单指纹|清单指纹/u, summary.resourceManifestHash);
  await fillByLabel(detail, /访问策略指纹|权限指纹/u, summary.resourcePolicyHash);
  await clickFirstEnabled(detail, /补充凭证要求|准备提交/u);
  await expect(detail.getByText(/浏览器钱包只签署|准备编号/u).first()).toBeVisible();
  await detail.getByRole("button", { name: "使用钱包签名并提交" }).click();
}

async function submitSignalIfOpen(page: Page, task: ProductTaskDTO): Promise<void> {
  if (taskHasProof(task)) {
    return;
  }
  if (task.status !== "open" || task.canSubmit === false) {
    return;
  }
  const detail = taskDetailPanel(page);
  await fillOptionalByLabel(detail, /报关履约者钱包|履约者钱包/u, summary.activeExecutorWallet);
  await fillByLabel(detail, /凭证|材料|引用/u, summary.evidenceRef);
  const confirmation = detail.getByRole("checkbox").first();
  if (await confirmation.count()) {
    await confirmation.check();
  }
  await clickFirstEnabled(detail, /确认|提交/u);
  await expect(detail.getByText(/浏览器钱包只签署|准备编号/u).first()).toBeVisible();
  await detail.getByRole("button", { name: "使用钱包签名并提交" }).click();
}

async function assertProofSurface(
  page: Page,
  task: ProductTaskDTO,
  proof: unknown,
  eventName: EventName
): Promise<void> {
  assertOrderProofDtoContainsEvent(proof, eventName);

  const detail = taskDetailPanel(page);
  const proofRegion = detail.getByRole("region", { name: "证明" });
  await expect(proofRegion).toBeVisible();
  await expect(proofRegion.getByRole("heading", { name: "证明", exact: true, level: 2 })).toBeVisible();
  await expect(proofRegion.getByText(/证明已返回|已有链上证明摘要|最近提交/u).first()).toBeVisible();

  const viewProofButton = proofRegion.getByRole("button", { name: "查看证明" });
  if (await viewProofButton.count()) {
    await viewProofButton.click();
  }
  const drawer = proofRegion.locator("#proof-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "证明摘要", exact: true, level: 3 })).toBeVisible();
  await expect(drawer.getByText(/交易哈希|交易编号/u).first()).toBeVisible();
  await expect(drawer.getByText(/区块高度|载荷指纹|凭证指纹|指纹|链上事件/u).first()).toBeVisible();

  const visibleValues = userVisibleTaskProofValues(task);
  if (visibleValues.length > 0) {
    await expectAnyExactTextVisible(drawer, visibleValues);
  } else {
    await expect(drawer.locator(".proof-row").first()).toBeVisible();
  }
}

function assertOrderProofDtoContainsEvent(proof: unknown, eventName: EventName): void {
  const proofText = flattenStrings(proof).join("\n");
  expect(proofText, `Product order proof DTO should include ${eventName}`).toContain(eventName);
  expect(proofText, `Product order proof DTO should include ${eventName} tx hash`).toContain(summary.eventTxHashes[eventName]);
}

function assertTaskDtoContains(task: ProductTaskDTO, expected: string, label: string): void {
  expect(flattenStrings(task).join("\n"), `Product task DTO should include ${label}`).toContain(expected);
}

function assertTaskDtoContainsAddress(task: ProductTaskDTO, expected: string, label: string): void {
  expectAddressText(flattenStrings(task).join("\n"), expected, label);
}

function expectAddressText(text: string, expected: string, label: string): void {
  expect(text.toLowerCase(), `Product DTO should include ${label}`).toContain(expected.toLowerCase());
}

function addressPattern(address: string): RegExp {
  return new RegExp(escapeRegExp(address), "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectAnyExactTextVisible(scope: Locator, values: readonly string[]): Promise<void> {
  for (const value of values) {
    const locator = scope.getByText(value, { exact: true }).first();
    if (await locator.count()) {
      await expect(locator).toBeVisible();
      return;
    }
  }
  throw new Error(`proof drawer did not expose any expected DTO proof value: ${values.join(", ")}`);
}

async function fillByLabel(scope: Page | Locator, label: RegExp, value: string): Promise<void> {
  const field = scope.getByLabel(label).first();
  await expect(field).toBeVisible();
  const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tagName === "select") {
    await field.selectOption(value);
  } else {
    await field.fill(value);
  }
}

async function expectLabeledInputValue(scope: Locator, label: RegExp, value: string): Promise<void> {
  const field = scope.getByLabel(label).first();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(value);
}

async function expectOptionalLabeledInputValue(scope: Locator, label: RegExp, value: string): Promise<void> {
  const field = scope.getByLabel(label).first();
  if (await field.count() === 0) {
    return;
  }
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(value);
}

async function fillOptionalByLabel(scope: Page | Locator, label: RegExp, value: string): Promise<void> {
  const field = scope.getByLabel(label).first();
  if (await field.count() === 0) {
    return;
  }
  await expect(field).toBeVisible();
  const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tagName === "select") {
    await field.selectOption(value);
  } else {
    await field.fill(value);
  }
}

async function clickFirstEnabled(scope: Page | Locator, name: RegExp): Promise<void> {
  const buttons = scope.getByRole("button", { name });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isEnabled()) {
      await button.click();
      return;
    }
  }
  throw new Error(`no enabled button matched ${name.toString()}`);
}

function taskHasProof(task: ProductTaskDTO): boolean {
  return Boolean(task.proofSummary?.txHash || task.proofSummary?.payloadHash || task.proofRows.length > 0);
}

function userVisibleTaskProofValues(task: ProductTaskDTO): readonly string[] {
  return [
    task.proofSummary?.txHash,
    task.proofSummary?.payloadHash,
    task.proofSummary?.blockNumber,
    ...task.proofRows
      .filter((row) => /交易|transaction|tx|hash|指纹|区块|block|payload|事件|event/iu.test(row.label))
      .map((row) => row.value)
  ].flatMap((value) => cleanProofValue(value));
}

function cleanProofValue(value: string | undefined): readonly string[] {
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : [];
}

function contentAddressedUriForForm(value: string, fallbackHash: string): string {
  const trimmed = value.trim();
  if (isContentAddressedReference(trimmed)) {
    return trimmed;
  }
  return `urn:sha256:${fallbackHash.replace(/^0x/u, "")}`;
}

function isContentAddressedReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("ipfs://") ||
    trimmed.startsWith("ar://") ||
    trimmed.startsWith("cid:") ||
    trimmed.startsWith("bafy") ||
    trimmed.startsWith("urn:");
}

function eventBooleanPaths(eventName: EventName): readonly string[] {
  const key = lowerFirst(eventName);
  return [
    `events.${eventName}`,
    `events.${key}`,
    `events.${eventName}.present`,
    `events.${key}.present`,
    `events.${eventName}.observed`,
    `events.${key}.observed`,
    `events.${eventName}.projected`,
    `events.${key}.projected`,
    `proof.${eventName}`,
    `proof.${key}`
  ];
}

function eventTxHashPaths(eventName: EventName): readonly string[] {
  const key = lowerFirst(eventName);
  return [
    `events.${eventName}.txHash`,
    `events.${eventName}.transactionHash`,
    `events.${key}.txHash`,
    `events.${key}.transactionHash`,
    `transactions.${eventName}.txHash`,
    `transactions.${eventName}.transactionHash`,
    `transactions.${key}.txHash`,
    `transactions.${key}.transactionHash`,
    ...legacyEventTxPaths(eventName)
  ];
}

function legacyEventTxPaths(eventName: EventName): readonly string[] {
  switch (eventName) {
    case "StageExecutorPatchApplied":
      return ["executorPatchTxHash", "stageExecutorPatchTxHash", "stageExecutorPatch.txHash"];
    case "StageExecutorActivated":
      return ["executorActivatedTxHash", "stageExecutorActivatedTxHash", "stageExecutorActivated.txHash", "executorPatchTxHash"];
    case "StageResourcePatchApplied":
      return ["resourcePatchTxHash", "stageResourcePatchTxHash", "stageResourcePatch.txHash"];
    case "SignalSubmitted":
      return ["targetSignalTxHash", "signalTxHash", "targetSignal.txHash", "transactions.submitSignalTxHash"];
  }
}

function requiredEvidenceRef(value: JsonRecord): string {
  const direct = optionalString(value, ["evidence.evidenceId", "evidence.id", "evidence.payloadRef", "evidenceRef", "evidenceId"]);
  if (direct) {
    return direct;
  }
  const evidence = valueAtPath(value, "evidence");
  if (Array.isArray(evidence)) {
    const first = evidence.find(isRecord);
    const found = first
      ? stringValue(first.evidenceId) ?? stringValue(first.id) ?? stringValue(first.payloadRef)
      : undefined;
    if (found) {
      return found;
    }
  }
  throw new Error("summary evidence.evidenceId or evidenceRef is required for submit signal E2E");
}

function requiredString(value: JsonRecord, paths: readonly string[], label: string): string {
  const found = optionalString(value, paths);
  if (!found) {
    throw new Error(`summary ${label} is required; checked ${paths.join(", ")}`);
  }
  return found;
}

function optionalString(value: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const candidate = stringValue(valueAtPath(value, path));
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanAtAny(value: unknown, paths: readonly string[]): boolean | null {
  for (const path of paths) {
    const candidate = valueAtPath(value, path);
    if (typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "string") {
      if (["true", "yes", "1"].includes(candidate.trim().toLowerCase())) {
        return true;
      }
      if (["false", "no", "0"].includes(candidate.trim().toLowerCase())) {
        return false;
      }
    }
  }
  return null;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[part];
  }, value);
}

function flattenStrings(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenStrings);
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap(flattenStrings);
  }
  return [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function lowerFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
