import { expect, test, type Page, type Route } from "@playwright/test";
import { buildTriggerOrderFromOutsideTypedData } from "@uvp-eth/protocol-bindings";
import { installProductApiStub, participantWallet, productApiBaseUrl } from "./product-api-stub";


const zhixuId = "zhixu-used-car-export-v0";
const draftId = "draft-create-001";
const stateMachineAddress = "0x8888888888888888888888888888888888888888";
const chainOrderId = `0x${"99".repeat(32)}`;

const usedCarSummary = {
  zhixuId,
  title: "二手车出口秩序",
  subtitle: "九个阶段逐段确认",
  reviewStatus: "approved",
  reviewLabel: "已审核",
  riskLevel: "中",
  applicableBusiness: ["二手车出口"],
  excludedBusiness: [],
  stageCount: 3,
  roleSlotCount: 2,
  supportedPaymentMethods: ["USDC"],
  maintainer: "运营方",
  updatedAt: "2026-10-23T00:00:00.000Z",
  planPublication: {
    status: "published",
    label: "已发布",
    stateMachineLabel: "UVPStateMachine",
    planId: `0x${"ab".repeat(32)}`,
    planHash: "0xhash-used-car"
  }
} as const;

interface StubDraft {
  draftId: string;
  zhixuId: string;
  planId: string;
  planHash: string;
  title: string;
  businessType: string;
  goods?: readonly string[];
  totalAmount: string;
  currency: string;
  notes?: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  triggeredOrderId?: string;
}

interface StubParticipant {
  participantId: string;
  draftId: string;
  roleSlotId: string;
  roleLabel: string;
  displayName: string;
  walletAddress?: string;
  contact: string;
  status: string;
  required: boolean;
}

function buildDraft(overrides: Partial<StubDraft> = {}): StubDraft {
  return {
    draftId,
    zhixuId,
    planId: usedCarSummary.planPublication.planId,
    planHash: usedCarSummary.planPublication.planHash,
    title: "中亚二手车出口订单",
    businessType: "二手车出口",
    goods: ["2021 款 SUV，4.2 万公里", "出口报关单与检测报告随车"],
    totalAmount: "128000",
    currency: "USDC",
    status: "ready_to_trigger",
    createdBy: participantWallet,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    ...overrides
  };
}

function buildParticipants(requiredAccepted: boolean): StubParticipant[] {
  return [
    {
      participantId: "participant-buyer",
      draftId,
      roleSlotId: "buyer",
      roleLabel: "采购方",
      displayName: "买方",
      walletAddress: participantWallet,
      contact: "buyer@example.test",
      status: "accepted",
      required: true
    },
    {
      participantId: "participant-inspector",
      draftId,
      roleSlotId: "inspector",
      roleLabel: "检测方",
      displayName: "检测方",
      ...(requiredAccepted ? { walletAddress: "0x3333333333333333333333333333333333333333" } : {}),
      contact: "",
      status: requiredAccepted ? "accepted" : "missing",
      required: false
    }
  ];
}

interface CreateOrderStubOptions {
  readonly zhixus?: readonly unknown[];
  readonly zhixusStatus?: number;
  readonly draftCreateStatus?: number;
  readonly prepareError?: { readonly status: number; readonly error: string; readonly message: string };
  readonly triggerStatus?: number;
  readonly triggerPending?: boolean;
}

interface CreateOrderStubState {
  readonly counters: {
    draftCreates: number;
    prepares: number;
    triggers: number;
  };
  readonly requestPaths: string[];
}

async function installCreateOrderApi(
  page: Page,
  options: CreateOrderStubOptions = {}
): Promise<CreateOrderStubState> {
  const state: CreateOrderStubState = {
    counters: { draftCreates: 0, prepares: 0, triggers: 0 },
    requestPaths: []
  };
  let draft = buildDraft();
  let participants = buildParticipants(false);

  await page.route(`${productApiBaseUrl}/**`, async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    state.requestPaths.push(`${method} ${pathname}`);

    if (method === "GET" && pathname === "/product/zhixus") {
      if (options.zhixusStatus !== undefined) {
        await fulfillJson(route, { error: "catalog_unavailable", message: "秩序目录暂时不可用" }, options.zhixusStatus);
        return;
      }
      await fulfillJson(route, { zhixus: options.zhixus ?? [usedCarSummary] });
      return;
    }

    if (method === "POST" && pathname === "/product/order-drafts") {
      state.counters.draftCreates += 1;
      if (options.draftCreateStatus !== undefined) {
        await fulfillJson(route, { error: "draft_unavailable", message: "订单服务暂时不可用" }, options.draftCreateStatus);
        return;
      }
      const body = JSON.parse(request.postData() ?? "{}") as Partial<StubDraft>;
      if (!body.title || !body.businessType || !body.totalAmount || !body.currency) {
        await fulfillJson(route, { error: "invalid_body", message: "missing order fields" }, 400);
        return;
      }
      draft = buildDraft({
        title: body.title,
        businessType: body.businessType,
        ...(body.goods ? { goods: body.goods } : {}),
        totalAmount: body.totalAmount,
        currency: body.currency,
        ...(body.notes ? { notes: body.notes } : {})
      });
      participants = buildParticipants(false);
      await fulfillJson(route, { draft, participants }, 201);
      return;
    }

    if (pathname === `/product/order-drafts/${draftId}`) {
      if (method === "GET") {
        await fulfillJson(route, { draft, participants });
        return;
      }
      if (method === "PATCH") {
        const body = JSON.parse(request.postData() ?? "{}") as Partial<StubDraft>;
        draft = { ...draft, ...body, updatedAt: "2026-10-23T00:01:00.000Z" };
        await fulfillJson(route, { draft });
        return;
      }
    }

    if (method === "GET" && pathname === `/product/orders/${draftId}/participants`) {
      await fulfillJson(route, { participants });
      return;
    }

    if (method === "POST" && pathname === `/product/orders/${draftId}/invites`) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        readonly roleSlotId?: string;
        readonly contact?: string;
      };
      const target = participants.find((participant) => participant.roleSlotId === body.roleSlotId);
      if (!target || !body.contact) {
        await fulfillJson(route, { error: "invalid_body", message: "missing invite fields" }, 400);
        return;
      }
      participants = participants.map((participant) =>
        participant.participantId === target.participantId
          ? { ...participant, contact: body.contact ?? "", status: "invited" }
          : participant
      );
      await fulfillJson(route, {
        invite: {
          inviteId: "invite-create-001",
          draftId,
          participantId: target.participantId,
          roleSlotId: target.roleSlotId,
          status: "active",
          expiresAt: "2026-10-30T00:00:00.000Z",
          createdAt: "2026-10-23T00:01:00.000Z"
        },
        participant: participants.find((participant) => participant.participantId === target.participantId),
        draft,
        inviteToken: "invite-token-create-001"
      }, 201);
      return;
    }

    if (method === "POST" && pathname === `/product/order-drafts/${draftId}/prepare-trigger`) {
      state.counters.prepares += 1;
      if (options.prepareError) {
        await fulfillJson(route, { error: options.prepareError.error, message: options.prepareError.message }, options.prepareError.status);
        return;
      }
      await fulfillJson(route, {
        draft,
        participants,
        permissions: [],
        trigger: {
          triggerId: "trigger-create-001",
          draftId,
          orderId: chainOrderId,
          status: "prepared",
          stateMachineAddress
        },
        prepared: {
          prepareId: "prepare-create-001",
          triggerId: "trigger-create-001",
          draftId,
          orderId: chainOrderId,
          expiresAt: "2026-10-23T01:00:00.000Z",
          submitter: participantWallet,
          typedData: buildTriggerOrderFromOutsideTypedData({
            chainId: 31337,
            verifyingContract: stateMachineAddress,
            planId: draft.planId,
            creator: participantWallet,
            triggerHookId: hex32("11"),
            triggerStageId: hex32("22"),
            sourceId: hex32("33"),
            signalId: hex32("44"),
            payloadHash: hex32("55"),
            idempotencyKey: hex32("66"),
            submitter: participantWallet,
            deadline: "1777777777",
            authorizations: [
              {
                sourceId: hex32("33"),
                signalId: hex32("44"),
                submitter: participantWallet,
                role: hex32("77"),
                metadataHash: hex32("88")
              }
            ]
          }),
          summary: { orderTitle: draft.title }
        }
      });
      return;
    }

    if (method === "POST" && pathname === `/product/order-drafts/${draftId}/trigger`) {
      state.counters.triggers += 1;
      if (options.triggerStatus !== undefined) {
        await fulfillJson(route, { error: "trigger_failed", message: "订单创建失败，请稍后重试" }, options.triggerStatus);
        return;
      }
      if (options.triggerPending === true) {
        draft = { ...draft, status: "triggering" };
        await fulfillJson(route, {
          draft,
          participants,
          permissions: [],
          trigger: { triggerId: "trigger-create-001", status: "submitted" }
        });
        return;
      }
      draft = { ...draft, status: "triggered", triggeredOrderId: chainOrderId };
      await fulfillJson(route, {
        draft,
        participants,
        permissions: [],
        trigger: { triggerId: "trigger-create-001", status: "submitted", orderId: chainOrderId }
      });
      return;
    }

    await route.fallback();
  });

  return state;
}

async function installCreateOrderWallet(page: Page, options: { readonly reject?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ address, reject }: { readonly address: string; readonly reject: boolean }) => {
    const provider = {
      request: async ({ method }: { readonly method: string }) => {
        if (method === "eth_chainId") {
          return "0x7a69";
        }
        if (method === "eth_requestAccounts" || method === "eth_accounts") {
          return [address];
        }
        if (method === "eth_signTypedData_v4") {
          if (reject) {
            throw { code: 4001, message: "User rejected the request" };
          }
          return `0x${"aa".repeat(65)}`;
        }
        if (method === "personal_sign") {
          return `0x${"bb".repeat(65)}`;
        }
        throw new Error(`unsupported wallet method ${method}`);
      }
    };
    (window as typeof window & { ethereum?: typeof provider }).ethereum = provider;
  }, { address: participantWallet, reject: options.reject === true });
}

const emptyFormLabels = {
  title: "订单名称",
  businessType: "业务类型",
  goods: "车辆与单证摘要",
  amount: "成交总额",
  currency: "币种"
} as const;

async function fillOrderForm(page: Page, overrides: Partial<Record<keyof typeof emptyFormLabels, string>> = {}): Promise<void> {
  await page.getByLabel(emptyFormLabels.title).fill(overrides.title ?? "中亚二手车出口订单");
  await page.getByLabel(emptyFormLabels.businessType).fill(overrides.businessType ?? "二手车出口");
  await page.getByLabel(emptyFormLabels.goods).fill(
    overrides.goods ?? "2021 款 SUV，4.2 万公里\n出口报关单与检测报告随车"
  );
  await page.getByLabel(emptyFormLabels.amount).fill(overrides.amount ?? "128000");
  await page.getByLabel(emptyFormLabels.currency).fill(overrides.currency ?? "USDC");
}

test.describe("Order App participant create-order entry", () => {
  test("opens the create-order entry, reads decoration, blocks invalid submit, then registers with an invite", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await installCreateOrderWallet(page);
    const stub = await installCreateOrderApi(page);

    await page.goto("/");
    await page.getByRole("button", { name: "开单", exact: true }).click();
    await expect(page.getByRole("heading", { name: "创建订单", level: 2 })).toBeVisible();
    await expect(page.getByTestId("create-order-page")).toBeVisible();

    const card = page.getByTestId(`create-order-zhixu-${zhixuId}`);
    await expect(card).toContainText("二手车出口秩序");
    await expect(card).toContainText("已发布");
    await card.click();

    const decoration = page.getByTestId("create-order-decoration");
    await expect(decoration).toContainText("中国—中亚二手车出口");
    await expect(decoration).toContainText("意向车型与年份");
    await expect(decoration).toContainText("需求确认");
    await expect(page.getByTestId("create-order-executors")).toContainText("订单内选定");
    await expect(page.getByText(/静态执行者|动态执行者/u)).toHaveCount(0);

    await page.getByTestId("create-order-save-draft").click();
    await expect(page.getByTestId("create-order-draft-status")).toContainText("请先填写");
    expect(stub.counters.draftCreates).toBe(0);

    await fillOrderForm(page);
    await page.getByTestId("create-order-save-draft").click();
    await expect(page.getByTestId("create-order-participants")).toBeVisible();
    await expect(page.getByTestId("create-order-participant-buyer")).toContainText("已确认");
    await expect(page.getByTestId("create-order-participant-inspector")).toContainText("未邀请");

    await page.getByLabel("给「检测方」的联系方式").fill("inspector@example.test");
    await page.getByTestId("create-order-invite-inspector").click();
    const inviteLink = page.getByTestId("create-order-invite-link-inspector");
    await expect(inviteLink).toBeVisible();
    const linkValue = await page.getByLabel("邀请链接").inputValue();
    expect(linkValue).toContain("invite=invite-create-001");
    expect(linkValue).toContain("inviteToken=invite-token-create-001");

    await page.getByTestId("create-order-register").click();
    await expect(page.getByText("订单已创建", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/section=orders/u);
    await expect(page.getByText(/正在同步订单与任务/u)).toBeVisible();
    expect(stub.counters.draftCreates).toBe(1);
    expect(stub.counters.prepares).toBe(1);
    expect(stub.counters.triggers).toBe(1);
  });

  test("shows an honest empty state when no order is published", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await installCreateOrderWallet(page);
    await installCreateOrderApi(page, { zhixus: [] });

    await page.goto("/#?section=create");
    await expect(page.getByTestId("create-order-empty-zhixus")).toContainText("暂无可开单的秩序");
    await expect(page.getByTestId("create-order-empty-zhixus")).toContainText("没有已发布的秩序");
    await expect(page.getByTestId("create-order-save-draft")).toHaveCount(0);
    await expect(page.getByTestId("create-order-register")).toHaveCount(0);
  });

  test("shows the catalog error instead of an empty catalog when the directory request fails", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await installCreateOrderWallet(page);
    await installCreateOrderApi(page, { zhixusStatus: 503 });

    await page.goto("/#?section=create");
    await expect(page.getByTestId("create-order-catalog-error")).toContainText("秩序目录加载失败");
    await expect(page.getByTestId("create-order-empty-zhixus")).toHaveCount(0);
  });

  test("shows the server reason when participants are not accepted, and never submits the order", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await installCreateOrderWallet(page);
    const stub = await installCreateOrderApi(page, {
      prepareError: {
        status: 409,
        error: "required_participant_missing",
        message: "all required participants must accept before submit"
      }
    });

    await page.goto("/#?section=create");
    await page.getByTestId(`create-order-zhixu-${zhixuId}`).click();
    await fillOrderForm(page);
    await page.getByTestId("create-order-save-draft").click();
    await expect(page.getByTestId("create-order-participants")).toBeVisible();
    await page.getByTestId("create-order-register").click();

    await expect(page.getByTestId("create-order-register-status")).toContainText("必填参与方没有完成确认");
    await expect(page.getByText("订单已创建", { exact: true })).toHaveCount(0);
    expect(stub.counters.prepares).toBe(1);
    expect(stub.counters.triggers).toBe(0);
  });

  test("keeps a registration failure visible after signing and never reports a created order", async ({ page }) => {
    await installProductApiStub(page, { walletMode: "missing" });
    await installCreateOrderWallet(page);
    const stub = await installCreateOrderApi(page, { triggerStatus: 500 });

    await page.goto("/#?section=create");
    await page.getByTestId(`create-order-zhixu-${zhixuId}`).click();
    await fillOrderForm(page);
    await page.getByTestId("create-order-save-draft").click();
    await expect(page.getByTestId("create-order-participants")).toBeVisible();
    await page.getByTestId("create-order-register").click();

    await expect(page.getByTestId("create-order-register-status")).toContainText("订单创建失败，请稍后重试");
    await expect(page.getByText("订单已创建", { exact: true })).toHaveCount(0);
    expect(stub.counters.prepares).toBe(1);
    expect(stub.counters.triggers).toBe(1);
  });

  test("does not report a created order when the trigger is only submitted", async ({ page }) => {
    await installProductApiStub(page);
    await installCreateOrderWallet(page);
    const stub = await installCreateOrderApi(page, { triggerPending: true });

    await page.goto("/#?section=create");
    await page.getByTestId(`create-order-zhixu-${zhixuId}`).click();
    await fillOrderForm(page);
    await page.getByTestId("create-order-save-draft").click();
    await expect(page.getByTestId("create-order-participants")).toBeVisible();
    await page.getByTestId("create-order-register").click();

    await expect(page.getByTestId("create-order-register-status")).toContainText("等待链上确认");
    await expect(page.getByText("订单已创建", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("create-order-page")).toBeVisible();
    expect(stub.counters.triggers).toBe(1);
  });
});

function hex32(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
