import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";
import { productApiBaseUrl, participantWallet } from "./product-api-stub";

/**
 * 邀请入口 e2e（api-stub 桩）：
 * - ?invite=&inviteToken= 只在进入时读取一次，随后从地址栏清除，
 *   "返回待办"不会因 search 残留把邀请面板还原（路由只认 hash）。
 * - accept 走服务端契约：先完成 /store/auth 会话（personal_sign 证明钱包
 *   控制），再携带 x-uvp-store-session + query walletAddress + body token。
 * - 缺少 inviteToken 时如实阻断，不得发出注定失败的请求。
 */

const INVITE_ID = "invite-9";
const INVITE_TOKEN = "one-time-invite-token";

const invitePreviewBody = {
  invite: {
    inviteId: INVITE_ID,
    status: "active",
    expiresAt: "2026-12-01T00:00:00.000Z"
  },
  participant: {
    participantId: "participant-invited",
    roleLabel: "物流/报关",
    displayName: "受邀参与方",
    contact: "invite@example.com",
    status: "invited"
  },
  draft: {
    draftId: "draft-9",
    title: "邀请验收订单",
    businessType: "parallel-export",
    currency: "USDC",
    totalAmount: "10000"
  },
  role: {
    roleSlotId: "delivery",
    label: "物流/报关",
    duty: "提交物流凭证"
  },
  acceptance: {
    canAccept: true,
    status: "can_accept"
  }
};

const participantBody = {
  participant: {
    participantId: "participant-customs-agent",
    displayName: "张经理",
    walletAddress: participantWallet,
    roleLabels: ["报关行"],
    source: "wallet"
  },
  summary: {
    orderCount: 0,
    openTaskCount: 0,
    blockedTaskCount: 0,
    completedTaskCount: 0
  }
};

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}async function installInviteRoutes(page: Page): Promise<{ requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  await page.addInitScript((address) => {
    const provider = {
      request: async ({ method, params }: { readonly method: string; readonly params?: readonly unknown[] }) => {
        if (method === "eth_requestAccounts") {
          return [address];
        }
        if (method === "personal_sign") {
          return `0x${"bb".repeat(65)}`;
        }
        throw new Error(`mock wallet: unsupported method ${method}`);
      }
    };
    (window as typeof window & { ethereum?: typeof provider }).ethereum = provider;
  }, participantWallet);

  await page.route(`${productApiBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postData()
    });
    const fulfill = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (request.method() === "GET" && url.pathname === "/product/me") {
      await fulfill(participantBody);
      return;
    }
    if (url.pathname === "/product/me/orders") {
      await fulfill({ participant: participantBody.participant, orders: [] });
      return;
    }
    if (url.pathname === "/product/me/tasks") {
      await fulfill({ participant: participantBody.participant, tasks: [] });
      return;
    }
    if (request.method() === "GET" && url.pathname === `/product/invites/${INVITE_ID}`) {
      // 契约对齐：预览与 accept/reject 同一凭据口径（token 哈希比对），
      // 缺 token/错 token 一律 403，不再无条件 200 掩盖客户端断裂。
      if (url.searchParams.get("token") !== INVITE_TOKEN) {
        await fulfill({ error: "invite_token_mismatch", message: "invite token required" }, 403);
        return;
      }
      await fulfill(invitePreviewBody);
      return;
    }
    if (request.method() === "POST" && url.pathname === "/store/auth/challenge") {
      await fulfill({
        challenge: {
          nonce: "stub-nonce",
          address: participantWallet,
          message: `uvp-store login challenge for ${participantWallet}`
        }
      }, 201);
      return;
    }
    if (request.method() === "POST" && url.pathname === "/store/auth/verify") {
      await fulfill({
        token: "uvs_stub_session_token",
        session: { sessionId: "sess-stub", anchoredAddress: participantWallet }
      }, 201);
      return;
    }
    if (request.method() === "POST" && url.pathname === `/product/invites/${INVITE_ID}/accept`) {
      const body = request.postDataJSON() as { readonly token?: string };
      if (body.token !== INVITE_TOKEN) {
        await fulfill({ error: "invite_token_mismatch" }, 403);
        return;
      }
      await fulfill({ invite: { inviteId: INVITE_ID, status: "accepted" } });
      return;
    }
    await fulfill({ error: "not_found" }, 404);
  });
  return { requests };
}

test("invite entry accepts through the server contract and returns to tasks", async ({ page }) => {
  const { requests } = await installInviteRoutes(page);
  await page.goto(`/?invite=${INVITE_ID}&inviteToken=${INVITE_TOKEN}`);

  await expect(page.getByRole("heading", { name: "邀请验收订单" })).toBeVisible();
  // 邀请搜索参数在读取后被清除，不再钉住应用。
  expect(new URL(page.url()).searchParams.get("invite")).toBeNull();
  expect(new URL(page.url()).searchParams.get("inviteToken")).toBeNull();

  await page.getByLabel("绑定钱包").fill(participantWallet);
  await page.getByRole("button", { name: "接受角色" }).click();

  await expect(page.getByRole("heading", { name: "角色已绑定" })).toBeVisible();

  const accept = requests.find((request) => request.url.includes(`/product/invites/${INVITE_ID}/accept`));
  assert.ok(accept, "accept request captured");
  const acceptUrl = new URL(accept.url);
  expect(acceptUrl.searchParams.get("walletAddress")).toBe(participantWallet);
  expect(JSON.parse(accept.body ?? "{}")).toMatchObject({ token: INVITE_TOKEN, walletAddress: participantWallet });
  // 预览请求同样携带一次性令牌（服务端按 token 哈希比对，缺失 403）。
  const preview = requests.find((request) => request.method === "GET" && request.url.includes(`/product/invites/${INVITE_ID}?`));
  assert.ok(preview, "preview request captured");
  expect(new URL(preview.url).searchParams.get("token")).toBe(INVITE_TOKEN);
  // 会话证明链路确实发生过。
  expect(requests.some((request) => request.url.endsWith("/store/auth/challenge"))).toBe(true);
  expect(requests.some((request) => request.url.endsWith("/store/auth/verify"))).toBe(true);

  // 返回待办后面板卸载，不会被残留 search 复原；本地 inviteEntry
  // 同步清除，工作区（参与者信息条）真正可达。
  await page.getByRole("button", { name: "查看我的待办" }).click();
  await expect(page.getByRole("heading", { name: "邀请验收订单" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "参与者信息" })).toBeVisible();
  await expect(page.getByText("UVP Signal Console")).toBeVisible();
  await expect(page).toHaveURL(/#section=tasks/);
});

test("invite entry without a token is refused by the token-checked preview and never reaches accept", async ({ page }) => {
  const { requests } = await installInviteRoutes(page);
  await page.goto(`/?invite=${INVITE_ID}`);

  // 预览即被 403（token 哈希比对是邀请面统一凭据口径）：面板如实呈现
  // 邀请不可用，不渲染可操作的 accept/reject 表单。
  await expect(page.getByRole("heading", { name: "邀请不可用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "接受角色" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "拒绝", exact: true })).toHaveCount(0);
  expect(requests.some((request) => request.url.includes("/accept"))).toBe(false);
  expect(requests.some((request) => request.url.includes("/reject"))).toBe(false);
});
