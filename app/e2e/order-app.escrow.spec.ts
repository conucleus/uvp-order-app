/* 阶段托管 e2e（api-stub，单条聚焦）：订单三个阶段的 tranche 列表渲染
 * state/金额，切换阶段后按钱包角色显示 StageEscrow 动作按钮（不实际发
 * 交易）。桩只模拟 chain-services product-escrow 的读路由与订单投影。
 * 运行需注入托管配置（playwright config 的 api-stub 命令不含这些变量）：
 * VITE_UVP_ESCROW_ADDRESS=0x55..55 VITE_UVP_ESCROW_CHAIN_ID=31337 \
 * UVP_ORDER_APP_E2E_PROFILE=api-stub UVP_ORDER_APP_E2E_PORT=4187 \
 * pnpm exec playwright test e2e/order-app.escrow.spec.ts
 */
import { expect, test, type Route } from "@playwright/test";
import { participantWallet, productApiBaseUrl } from "./product-api-stub";

const orderId = `0x${"11".repeat(32)}`;
const stage = {
  purchase: `0x${"a1".repeat(32)}`,
  inspection: `0x${"a2".repeat(32)}`,
  logistics: `0x${"a3".repeat(32)}`
} as const;
const otherParty = "0x2222222222222222222222222222222222222222";
const verifierWallet = "0x3333333333333333333333333333333333333333";
const feeRecipient = "0x4444444444444444444444444444444444444444";
const zhixuId = "zhixu-used-car-export-v0";
const planId = `0x${"ee".repeat(32)}`;

interface StubTranche {
  readonly orderId: string;
  readonly stageId: string;
  readonly trancheId: string;
  readonly payer: string;
  readonly payee: string;
  readonly verifier: string;
  readonly amount: string;
  readonly observationDays: number;
  readonly feeBps: number;
  readonly feeRecipient: string;
  readonly state: string;
  readonly approvedAt: string | null;
  readonly rejectedAt: string | null;
  readonly suspendedAt: string | null;
  readonly releaseAt: string | null;
  readonly refundAt: string | null;
  readonly payerAmount: string | null;
  readonly payeeAmount: string | null;
  readonly feeAmount: string | null;
  readonly updatedAt: string;
  readonly blockNumber: string;
  readonly logIndex: number;
}

function tranche(overrides: Partial<StubTranche> & Pick<StubTranche, "stageId" | "trancheId" | "payer" | "payee" | "verifier" | "amount" | "state">): StubTranche {
  return {
    orderId,
    observationDays: 14,
    feeBps: 100,
    feeRecipient,
    approvedAt: null,
    rejectedAt: null,
    suspendedAt: null,
    releaseAt: null,
    refundAt: null,
    payerAmount: null,
    payeeAmount: null,
    feeAmount: null,
    updatedAt: "2026-10-20T08:00:00.000Z",
    blockNumber: "18735000",
    logIndex: 0,
    ...overrides
  };
}

const tranches: readonly StubTranche[] = [
  tranche({
    stageId: stage.purchase,
    trancheId: `0x${"b1".repeat(32)}`,
    payer: participantWallet,
    payee: otherParty,
    verifier: verifierWallet,
    amount: "1000000",
    state: "frozen"
  }),
  tranche({
    stageId: stage.inspection,
    trancheId: `0x${"b2".repeat(32)}`,
    payer: otherParty,
    payee: verifierWallet,
    verifier: participantWallet,
    amount: "2000000",
    state: "approved",
    approvedAt: "2026-10-20T08:00:00.000Z"
  }),
  tranche({
    stageId: stage.logistics,
    trancheId: `0x${"b3".repeat(32)}`,
    payer: otherParty,
    payee: participantWallet,
    verifier: verifierWallet,
    amount: "3000000",
    state: "suspended",
    suspendedAt: "2026-10-21T08:00:00.000Z"
  })
];

const orderStages = [
  { stageId: stage.purchase, index: 0, name: "采购阶段", evidence: [], ownerRole: "采购", status: "active" },
  { stageId: stage.inspection, index: 1, name: "验车阶段", evidence: [], ownerRole: "验收", status: "pending" },
  { stageId: stage.logistics, index: 2, name: "物流阶段", evidence: [], ownerRole: "物流", status: "pending" }
];

const order = {
  orderId,
  zhixuId,
  title: "中亚二手车出口订单",
  status: "registered",
  statusLabel: "履约中",
  totalAmount: { amount: "60000", currency: "USDT", display: "60,000 USDT" },
  fundingStatus: "funds_protected",
  currentStageId: stage.purchase,
  currentStageName: "采购阶段",
  currentTaskTitle: "确认采购冻款",
  currentTaskSummary: "每阶段独立冻款。",
  stages: orderStages,
  participants: [],
  recentEvents: [],
  proofRows: []
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

test("renders tranche states and role-scoped escrow actions", async ({ page }) => {
  await page.addInitScript(({ wallet }) => {
    const target = window as unknown as {
      ethereum?: { request: (args: { readonly method: string; readonly params?: readonly unknown[] }) => Promise<unknown> };
    };
    target.ethereum = {
      request: async ({ method }) => {
        switch (method) {
          case "eth_chainId":
            return "0x7a69";
          case "eth_accounts":
          case "eth_requestAccounts":
            return [wallet];
          default:
            throw new Error(`unsupported wallet method ${method}`);
        }
      }
    };
  }, { wallet: participantWallet });

  await page.route(`${productApiBaseUrl}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      await fulfillJson(route, { error: "unexpected_method" }, 405);
      return;
    }
    if (pathname === "/product/me") {
      await fulfillJson(route, {
        participant: {
          participantId: "participant-escrow",
          displayName: "买方",
          walletAddress: participantWallet,
          roleLabels: ["买方"],
          source: "wallet"
        }
      });
      return;
    }
    if (pathname === "/product/me/orders") {
      await fulfillJson(route, { orders: [order] });
      return;
    }
    if (pathname === "/product/me/tasks") {
      await fulfillJson(route, { tasks: [] });
      return;
    }
    if (pathname === `/product/zhixus/${zhixuId}`) {
      await fulfillJson(route, {
        zhixu: {
          zhixuId,
          title: "二手车出口秩序",
          planPublication: { status: "published", label: "已发布", planId }
        }
      });
      return;
    }
    if (pathname === `/store/decoration/${planId}`) {
      await fulfillJson(route, { planId, versions: [] });
      return;
    }
    const escrowMatch = /^\/product\/orders\/([^/]+)\/escrow(?:\/([^/]+))?$/u.exec(pathname);
    if (escrowMatch) {
      const requestedStageId = escrowMatch[2] ? decodeURIComponent(escrowMatch[2]) : undefined;
      if (requestedStageId === undefined) {
        await fulfillJson(route, { orderId, tranches });
        return;
      }
      const selected = tranches.find((item) => item.stageId === requestedStageId);
      if (!selected) {
        await fulfillJson(route, { error: "escrow_tranche_not_found" }, 404);
        return;
      }
      await fulfillJson(route, selected);
      return;
    }
    await fulfillJson(route, { error: "unhandled_stub_route", pathname }, 404);
  });

  await page.goto(`/#?section=escrow&orderId=${orderId}`);

  await expect(page.getByTestId("escrow-page")).toBeVisible();
  // 动作可用前提：构建期已注入托管地址/链（e2e 运行命令带 VITE_UVP_ESCROW_*）。
  await expect(page.getByTestId("escrow-config-warning")).toHaveCount(0);
  await expect(page.getByTestId("escrow-tranche-list")).toBeVisible();
  await expect(page.getByTestId("escrow-tranche-0")).toContainText("采购阶段");
  await expect(page.getByTestId("escrow-tranche-0")).toContainText("已冻款");
  await expect(page.getByTestId("escrow-tranche-1")).toContainText("观察期");
  await expect(page.getByTestId("escrow-tranche-2")).toContainText("已挂起");
  await expect(page.getByTestId("escrow-tranche-1")).toContainText("2.000000 USDT");

  await expect(page.getByTestId("escrow-action-payNow")).toBeVisible();
  await expect(page.getByTestId("escrow-action-refundByPayer")).toBeVisible();
  await expect(page.getByTestId("escrow-action-suspend")).toBeVisible();
  await expect(page.getByTestId("escrow-action-approve")).toHaveCount(0);

  await page.getByTestId("escrow-tranche-1").click();
  await expect(page.getByTestId("escrow-action-approve")).toBeVisible();
  await expect(page.getByTestId("escrow-action-reject")).toBeVisible();
  await expect(page.getByTestId("escrow-action-payNow")).toHaveCount(0);

  await page.getByTestId("escrow-tranche-2").click();
  await expect(page.getByTestId("escrow-action-refundByPayee")).toBeVisible();
  await expect(page.getByTestId("escrow-settle-payer")).toBeVisible();
  await expect(page.getByTestId("escrow-settle-payee")).toBeVisible();
  await expect(page.getByTestId("escrow-action-consentSettlement")).toBeVisible();
  await expect(page.getByTestId("escrow-action-refundByPayer")).toHaveCount(0);
});
