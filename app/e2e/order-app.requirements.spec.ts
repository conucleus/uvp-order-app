/* V1 订单要求包 e2e（api-stub）：句柄元数据/解析状态、相对方合意按错误码
 * 失败后成功、验收显式选 signalName 走 prepare-submit/submit。桩只模拟
 * 服务端契约，界面行为与真实错误码是断言对象。
 */
import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { buildProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import { orderRequirementsConsentMessage } from "@uvp-eth/product-dto";
import { participantWallet, productApiBaseUrl } from "./product-api-stub";

const declarerWallet = "0x1111111111111111111111111111111111111111";
const draftId = "draft-requirements-001";
const taskId = "task-acceptance-001";
const orderId = "order-requirements-001";
const zhixuId = "zhixu-used-car-export-v0";
const planId = `0x${"ee".repeat(32)}`;
const requirementsHash = `0x${"ab".repeat(32)}`;
const consentMessage = orderRequirementsConsentMessage(draftId, requirementsHash);
const presetHash = `0x${"cd".repeat(32)}`;
const payloadHash = `0x${"22".repeat(32)}`;
const stateMachineAddress = "0x8888888888888888888888888888888888888888";
const signedMessagesKey = "__uvpRequirementsSignedMessages";

const invoiceBody = "invoice body";
const invoiceHash = sha256Hex(invoiceBody);
const privateNote = "counterparty private note";
const preset = {
  name: "常规检测清单",
  version: "1.0.0",
  hash: presetHash,
  ref: "app://presets/inspection-v1"
} as const;

const bundle = {
  schemaVersion: "uvp.order-requirements.v1",
  declaredBy: declarerWallet,
  requirementsHash,
  requirements: [
    {
      key: "vehicle-documents",
      label: "随车单证",
      stageId: "inspection",
      dueAt: "2026-11-01T00:00:00.000Z",
      presetRef: preset,
      handles: [
        {
          key: "invoice",
          fileType: "plain_text",
          locator: { plainText: { ref: Buffer.from(invoiceBody, "utf8").toString("base64") } },
          contentHash: invoiceHash,
          visibility: "public"
        },
        {
          key: "inspection-report",
          fileType: "http",
          locator: { httpFile: { url: "http://files.test/inspection-report.pdf" } },
          visibility: "public"
        },
        {
          key: "private-note",
          fileType: "plain_text",
          locator: { plainText: { ref: Buffer.from(privateNote, "utf8").toString("base64") } },
          contentHash: sha256Hex(privateNote),
          visibility: "private",
          cipher: { alg: "AES-GCM", keyRef: "keyref-should-not-render" }
        },
        {
          key: "stale-hash",
          fileType: "plain_text",
          locator: { plainText: { ref: Buffer.from("actual body", "utf8").toString("base64") } },
          contentHash: sha256Hex("declared body"),
          visibility: "public"
        }
      ]
    }
  ],
  presets: [preset]
};

const draft = {
  draftId,
  zhixuId,
  planId,
  planHash: "0xhash-used-car",
  title: "中亚二手车出口订单",
  businessType: "二手车出口",
  totalAmount: "128000",
  currency: "USDC",
  status: "awaiting_participants",
  createdBy: declarerWallet,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z"
};

const participants = [
  {
    participantId: "participant-counterparty",
    draftId,
    roleSlotId: "seller",
    roleLabel: "卖方",
    displayName: "卖方",
    walletAddress: participantWallet,
    contact: "",
    status: "accepted",
    required: true
  }
];

const task = {
  taskId,
  orderId,
  zhixuId,
  orderTitle: draft.title,
  title: "验收检验报告",
  subtitle: "读要求包文件后选择本次验收信号。",
  assigneeRole: "验收方",
  participantRoleLabel: "验收方",
  participantWallet,
  stageId: "inspection",
  stageName: "独立检测",
  deadline: "2026-11-02 18:00",
  fundingImpact: "验收后推进交付",
  status: "open",
  canSubmit: true,
  submitSignals: [
    {
      signalName: "inspection.passed",
      sourceId: `0x${"0a".repeat(32)}`,
      signalId: `0x${"0b".repeat(32)}`
    },
    {
      signalName: "inspection.failed",
      sourceId: `0x${"0a".repeat(32)}`,
      signalId: `0x${"0c".repeat(32)}`
    }
  ],
  responsibilityStatements: [],
  proofRows: []
};

const order = {
  orderId,
  zhixuId,
  title: draft.title,
  status: "registered",
  statusLabel: "履约中",
  totalAmount: { amount: "1", currency: "USDC", display: "1 USDC" },
  fundingStatus: "funds_protected",
  currentStageId: task.stageId,
  currentStageName: task.stageName,
  currentTaskId: taskId,
  currentTaskTitle: task.title,
  currentTaskSummary: task.subtitle,
  stages: [],
  participants: [],
  recentEvents: [],
  proofRows: []
};

interface RequirementsStubOptions {
  /** 首次合意按 hash mismatch 拒绝，第二次成功：验证按错误码分流。 */
  readonly consentFailure?: "once_hash_mismatch" | undefined;
}

interface RequirementsStubState {
  readonly prepareBodies: Record<string, unknown>[];
  readonly consentBodies: Record<string, unknown>[];
  readonly submitBodies: Record<string, unknown>[];
  consentRequests: number;
}

async function installRequirementsApi(
  page: Page,
  options: RequirementsStubOptions = {}
): Promise<RequirementsStubState> {
  const state: RequirementsStubState = {
    prepareBodies: [],
    consentBodies: [],
    submitBodies: [],
    consentRequests: 0
  };

  await page.addInitScript(({ wallet, messagesKey }) => {
    const target = window as unknown as Record<string, unknown>;
    target[messagesKey] = [];
    target.ethereum = {
      request: async ({ method, params }: { readonly method: string; readonly params?: readonly unknown[] }) => {
        switch (method) {
          case "eth_chainId":
            return "0x7a69";
          case "eth_accounts":
          case "eth_requestAccounts":
            return [wallet];
          case "personal_sign": {
            const message = Array.isArray(params) ? params[0] : undefined;
            (target[messagesKey] as unknown[]).push(typeof message === "string" ? message : "");
            return `0x${"aa".repeat(65)}`;
          }
          case "eth_signTypedData_v4":
            return `0x${"aa".repeat(65)}`;
          default:
            throw new Error(`unsupported wallet method ${method}`);
        }
      }
    };
  }, { wallet: participantWallet, messagesKey: signedMessagesKey });

  await page.route("http://files.test/**", (route) => route.abort("failed"));

  await page.route(`${productApiBaseUrl}/**`, async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (method === "GET" && pathname === "/product/me") {
      await fulfillJson(route, {
        participant: {
          participantId: "participant-counterparty",
          displayName: "卖方",
          walletAddress: participantWallet,
          roleLabels: ["卖方"],
          source: "wallet"
        }
      });
      return;
    }
    if (method === "GET" && pathname === "/product/me/orders") {
      await fulfillJson(route, { orders: [order] });
      return;
    }
    if (method === "GET" && pathname === "/product/me/tasks") {
      await fulfillJson(route, { tasks: [task] });
      return;
    }
    if (method === "GET" && pathname === `/product/me/tasks/${taskId}`) {
      await fulfillJson(route, { task });
      return;
    }
    if (method === "GET" && pathname.startsWith("/product/zhixus/")) {
      const requestedZhixuId = decodeURIComponent(pathname.slice("/product/zhixus/".length));
      await fulfillJson(route, {
        zhixu: {
          zhixuId: requestedZhixuId,
          title: "二手车出口秩序",
          subtitle: "九个阶段逐段确认",
          planPublication: {
            status: "published",
            label: "已发布",
            stateMachineLabel: "UVPStateMachine",
            planId,
            planHash: "0xhash-used-car"
          }
        }
      });
      return;
    }
    if (method === "GET" && pathname.startsWith("/store/decoration/")) {
      await fulfillJson(route, {
        planId: decodeURIComponent(pathname.slice("/store/decoration/".length)),
        versions: []
      });
      return;
    }
    if (method === "GET" && pathname === `/product/order-drafts/${draftId}`) {
      await fulfillJson(route, { draft, participants });
      return;
    }
    if (method === "GET" && pathname === `/product/order-drafts/${draftId}/requirements`) {
      await fulfillJson(route, {
        draft,
        bundle,
        consentMessage,
        editable: true,
        triggerAnchor: {
          draftId,
          schemaVersion: bundle.schemaVersion,
          requirementsHash,
          declaredBy: declarerWallet,
          consentedWallets: []
        }
      });
      return;
    }
    if (method === "POST" && pathname === `/product/order-drafts/${draftId}/requirements/consents`) {
      state.consentRequests += 1;
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.consentBodies.push(body);
      if (options.consentFailure === "once_hash_mismatch" && state.consentRequests === 1) {
        await fulfillJson(route, {
          error: "requirements_hash_mismatch",
          message: "the consent was signed for a different requirement bundle hash"
        }, 409);
        return;
      }
      const consent = {
        walletAddress: participantWallet,
        requirementsHash: body.requirementsHash,
        signature: body.signature,
        signedAt: "2026-10-24T00:00:00.000Z"
      };
      await fulfillJson(route, {
        consent,
        consents: [consent],
        triggerAnchor: {
          draftId,
          schemaVersion: bundle.schemaVersion,
          requirementsHash,
          declaredBy: declarerWallet,
          consentedWallets: [participantWallet]
        }
      });
      return;
    }
    if (method === "POST" && pathname === `/product/tasks/${taskId}/prepare-submit`) {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.prepareBodies.push(body);
      if (typeof body.signalName !== "string" || body.signalName.length === 0) {
        await fulfillJson(route, {
          error: "signal_selection_required",
          message: "this task can submit more than one signal; choose signalName explicitly"
        }, 409);
        return;
      }
      await fulfillJson(route, {
        prepareId: "prep-acceptance-001",
        taskId,
        orderId,
        intent: body.intent,
        payloadHash,
        submitter: participantWallet,
        expiresAt: "2026-10-25T00:00:00.000Z",
        typedData: buildProductSubmitTypedData({
          chainId: 31337,
          verifyingContract: stateMachineAddress,
          planId,
          orderId: `0x${"99".repeat(32)}`,
          sourceId: task.submitSignals[0]?.sourceId ?? `0x${"0a".repeat(32)}`,
          signalId: task.submitSignals[1]?.signalId ?? `0x${"0c".repeat(32)}`,
          payloadHash,
          idempotencyKey: `0x${"55".repeat(32)}`,
          submitter: participantWallet,
          deadline: "1777777777"
        }),
        evidence: []
      });
      return;
    }
    if (method === "POST" && pathname === `/product/tasks/${taskId}/submit`) {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.submitBodies.push(body);
      await fulfillJson(route, {
        submissionId: "sub-acceptance-001",
        prepareId: body.prepareId,
        taskId,
        orderId,
        onchainOrderId: `0x${"99".repeat(32)}`,
        planId,
        stageIdentifier: task.stageId,
        signalName: "inspection.failed",
        sourceId: task.submitSignals[1]?.sourceId ?? `0x${"0a".repeat(32)}`,
        signalId: task.submitSignals[1]?.signalId ?? `0x${"0c".repeat(32)}`,
        intent: "confirm_stage",
        payloadHash,
        payloadRef: `stub-proof://${payloadHash.slice(2)}`,
        idempotencyKey: `0x${"55".repeat(32)}`,
        submitter: participantWallet,
        nonce: "1",
        deadline: "1777777777",
        status: "confirmed",
        statusLabel: "已确认",
        signatureStatus: "signature_verified",
        broadcastStatus: "confirmed",
        txHash: `0x${"44".repeat(32)}`,
        blockNumber: "18,735,020",
        retryable: false,
        retryState: "not_applicable",
        deadLetter: false,
        attempts: [],
        attemptCount: 1,
        proofRows: [],
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z"
      });
      return;
    }

    await fulfillJson(route, { message: `unhandled stub route ${method} ${pathname}` }, 404);
  });

  return state;
}

test.describe("V1 order requirements", () => {
  test("shows requirement handle metadata and distinct failures", async ({ page }) => {
    await installRequirementsApi(page);
    await page.goto(entryUrl({ draftId }));

    await expect(page.getByTestId("requirements-page")).toBeVisible();
    await expect(page.getByTestId("requirements-hash")).toHaveText(requirementsHash);
    await expect(page.getByText("随车单证")).toBeVisible();
    await expect(page.getByText(/常规检测清单@1\.0\.0/)).toBeVisible();
    await expect(page.getByText("2026-11-01T00:00:00.000Z")).toBeVisible();

    const invoiceRow = page.getByTestId("handle-row-invoice");
    await expect(invoiceRow).toContainText("plain_text");
    await expect(invoiceRow).toContainText("public");
    await expect(invoiceRow).toContainText(invoiceHash);
    await expect(page.getByTestId("handle-status-invoice")).toHaveText("已解析");
    await invoiceRow.getByText("查看已解析内容").click();
    await expect(invoiceRow.locator("pre")).toContainText(invoiceBody);

    await expect(page.getByTestId("handle-status-inspection-report")).toHaveText("不可达 / 读取失败");
    await expect(page.getByTestId("handle-status-private-note")).toHaveText("无权读取");
    await expect(page.getByTestId("handle-status-stale-hash")).toHaveText("摘要不符");

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("keyref-should-not-render");
    expect(bodyText).not.toContain("该要求未声明句柄（没有文件）。");
  });

  test("refuses a stale-hash consent by code, then records the counterparty consent", async ({ page }) => {
    const state = await installRequirementsApi(page, { consentFailure: "once_hash_mismatch" });
    await page.goto(entryUrl({ draftId }));

    const consentButton = page.getByTestId("consent-button");
    await expect(consentButton).toBeEnabled();
    await consentButton.click();
    await expect(page.getByTestId("consent-error")).toContainText("requirements_hash_mismatch");
    expect(state.consentBodies).toHaveLength(1);

    await consentButton.click();
    await expect(page.getByTestId("consent-status")).toHaveText("已合意");
    expect(state.consentBodies).toHaveLength(2);
    expect(state.consentBodies[1]?.requirementsHash).toBe(requirementsHash);

    const signedMessages = await readSignedMessages(page);
    expect(signedMessages[1]).toBe(consentMessage);
  });

  test("lets the acceptor explicitly pick a submit signal before prepare/submit", async ({ page }) => {
    const state = await installRequirementsApi(page);
    await page.goto(entryUrl({ draftId, taskId }));

    await expect(page.getByTestId("acceptance-panel")).toBeVisible();
    await expect(page.getByRole("radio", { name: "inspection.passed" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "inspection.failed" })).toBeVisible();
    const prepareButton = page.getByRole("button", { name: "准备验收提交" });
    await expect(prepareButton).toBeDisabled();

    await page.getByRole("radio", { name: "inspection.failed" }).check();
    await prepareButton.click();
    await expect(page.getByText("已选信号")).toBeVisible();

    expect(state.prepareBodies).toHaveLength(1);
    expect(state.prepareBodies[0]?.signalName).toBe("inspection.failed");
    expect(state.prepareBodies[0]?.evidenceIds).toEqual([]);

    await page.getByRole("button", { name: "签名并提交" }).click();
    await expect(page.getByTestId("acceptance-submission-status")).toContainText("已确认");
    expect(state.submitBodies).toHaveLength(1);
    expect(state.submitBodies[0]?.prepareId).toBe("prep-acceptance-001");
  });
});

function entryUrl(input: { readonly draftId?: string; readonly taskId?: string }): string {
  const params = new URLSearchParams({ section: "requirements" });
  if (input.draftId) {
    params.set("draftId", input.draftId);
  }
  if (input.taskId) {
    params.set("task", input.taskId);
  }
  return `/#?${params.toString()}`;
}

async function readSignedMessages(page: Page): Promise<readonly string[]> {
  return await page.evaluate((key) => {
    const target = window as unknown as Record<string, unknown>;
    const value = target[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }, signedMessagesKey);
}

function sha256Hex(value: string): string {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
