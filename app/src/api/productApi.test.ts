import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  ProductApiError,
  createProductApiClient,
  isWalletIdentityRequired,
  persistWalletSessionToken,
  readPersistedWalletSessionToken,
  type ProductApiClientOptions
} from "./productApi.js";

const stubOrders: readonly ProductOrderDTO[] = [
  {
    orderId: "order-1",
    zhixuId: "zhixu-1",
    title: "订单 A",
    status: "registered",
    statusLabel: "已登记",
    totalAmount: { amount: "10000", currency: "USDC", display: "10,000 USDC" },
    fundingStatus: "funded",
    currentStageId: "customs",
    currentStageName: "报关",
    currentTaskId: "task-1",
    currentTaskTitle: "提交报关单",
    currentTaskSummary: "上传并确认报关凭证。",
    stages: [],
    participants: [],
    recentEvents: [],
    proofRows: []
  }
];

const stubTasks: readonly ProductTaskDTO[] = [
  {
    taskId: "task-1",
    orderId: "order-1",
    zhixuId: "zhixu-1",
    orderTitle: "订单 A",
    title: "提交报关单",
    subtitle: "上传报关单 PDF 并确认。",
    assigneeRole: "报关行",
    stageId: "customs",
    stageName: "报关",
    deadline: "2026-05-01 18:00",
    fundingImpact: "不影响资金",
    status: "open",
    responsibilityStatements: [],
    proofRows: []
  }
];

describe("order app Product API boundary", () => {
  it("fails closed when no participant service base URL is configured", () => {
    assert.throws(
      () => createProductApiClient({ baseUrl: undefined }),
      /VITE_UVP_CHAIN_SERVICES_URL/u
    );
  });

  it("times out hanging requests instead of loading forever", async () => {
    // 注入的 fetcher 永不 settle：超时必须独立于 fetcher 是否消费 signal。
    const hangingFetcher: ProductApiClientOptions["fetcher"] = () => new Promise<Response>(() => {});
    const client = createProductApiClient({
      baseUrl: "http://service.local",
      fetcher: hangingFetcher,
      timeoutMs: 25
    });

    await assert.rejects(
      client.getTask("task-1"),
      (error) => error instanceof ProductApiError && error.status === 0 && /请求超时/u.test(error.message)
    );
  });

  it("loads the participant home from /product/me routes", async () => {
    const requested: string[] = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/product/me/orders")) {
        return jsonResponse({ orders: stubOrders });
      }
      if (url.includes("/product/me/tasks")) {
        return jsonResponse({ tasks: stubTasks });
      }
      if (url.includes("/product/me")) {
        return jsonResponse({
          participant: {
            participantId: "participant-1",
            displayName: "参与者",
            walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
            roleLabels: ["报关行"],
            source: "wallet"
          },
          summary: {
            orderCount: 1,
            openTaskCount: 1,
            blockedTaskCount: 0,
            completedTaskCount: 1
          }
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const client = createProductApiClient({
      baseUrl: "http://service.local/",
      fetcher
    });

    const home = await client.loadParticipantHome({
      walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F"
    });

    assert.equal(home.source.kind, "real");
    assert.equal(home.summary.openTaskCount, 1);
    assert.ok(requested.some((url) => url.includes("/product/me?walletAddress=")));
    assert.ok(requested.some((url) => url.includes("/product/me/orders?walletAddress=")));
    assert.ok(requested.some((url) => url.includes("/product/me/tasks?walletAddress=")));
  });

  it("previews and accepts invite onboarding through Product API routes", async () => {
    const requested: Array<{ readonly url: string; readonly method: string; readonly body?: string; readonly headers?: Record<string, string> }> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const body = init?.body as string | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requested.push({ url, method: init?.method ?? "GET", ...(body ? { body } : {}), headers });
      if (url.includes("/product/invites/invite-1?walletAddress=")) {
        return jsonResponse({
          invite: {
            inviteId: "invite-1",
            status: "active",
            expiresAt: "2026-05-01T00:00:00.000Z"
          },
          participant: {
            participantId: "participant-1",
            roleLabel: "物流/报关",
            displayName: "交付方",
            contact: "delivery@example.com",
            status: "invited"
          },
          draft: {
            draftId: "draft-1",
            title: "订单 A",
            businessType: "parallel-export",
            currency: "USDC",
            totalAmount: "10000"
          },
          role: {
            roleSlotId: "delivery",
            label: "物流/报关",
            duty: "提交物流凭证",
            evidenceSpec: [{ key: "customs_declaration", label: "报关单" }]
          },
          acceptance: {
            canAccept: true,
            status: "can_accept"
          }
        });
      }
      if (url.includes("/product/invites/invite-1/accept")) {
        return jsonResponse({ invite: { inviteId: "invite-1", status: "accepted" } });
      }
      if (url.includes("/product/invites/invite-1/reject")) {
        return jsonResponse({ invite: { inviteId: "invite-1", status: "rejected" } });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const client = createProductApiClient({
      baseUrl: "http://service.local/",
      fetcher
    });

    const preview = await client.previewInvite("invite-1", {
      walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F"
    });
    const accepted = await client.acceptInvite("invite-1", {
      displayName: "交付方",
      walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      contact: "delivery@example.com",
      token: "invite-token-plaintext"
    }, { sessionToken: "uvs_session_token" });
    await client.rejectInvite("invite-1", { token: "invite-token-plaintext" });

    assert.equal(preview.acceptance?.status, "can_accept");
    assert.equal(accepted.invite && (accepted.invite as { readonly status: string }).status, "accepted");
    assert.ok(requested.some((request) => request.method === "GET" && request.url.includes("walletAddress=")));
    // 服务端契约：accept 必须带一次性 token、query 声明钱包和会话头；reject 也必须带 token。
    const acceptRequest = requested.find((request) => request.method === "POST" && request.url.includes("/accept"));
    assert.ok(acceptRequest);
    assert.ok(acceptRequest.url.includes("walletAddress="));
    assert.equal(acceptRequest.headers?.["x-uvp-store-session"], "uvs_session_token");
    assert.deepEqual(JSON.parse(acceptRequest.body ?? "{}"), {
      displayName: "交付方",
      walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      contact: "delivery@example.com",
      token: "invite-token-plaintext"
    });
    const rejectRequest = requested.find((request) => request.method === "POST" && request.url.includes("/reject"));
    assert.ok(rejectRequest);
    assert.deepEqual(JSON.parse(rejectRequest.body ?? "{}"), { token: "invite-token-plaintext" });
  });

  it("proves wallet control through the server session flow before accept", async () => {
    const requested: Array<{ readonly url: string; readonly method: string; readonly body?: string }> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const body = init?.body as string | undefined;
      requested.push({ url, method: init?.method ?? "GET", ...(body ? { body } : {}) });
      if (url.endsWith("/store/auth/challenge")) {
        return jsonResponse({
          challenge: {
            nonce: "nonce-1",
            address: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
            message: "uvp store wants you to sign in with your EVM account"
          }
        });
      }
      if (url.endsWith("/store/auth/verify")) {
        return jsonResponse({
          token: "uvs_issued",
          session: { sessionId: "sess-1", anchoredAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F" }
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const signedMessages: string[] = [];
    const client = createProductApiClient({
      baseUrl: "http://service.local/",
      fetcher,
      personalSign: async (address, message) => {
        assert.equal(address, "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F");
        signedMessages.push(message);
        return "0xsignature";
      }
    });

    const proof = await client.proveWalletControl({ address: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F" });

    assert.equal(proof.sessionToken, "uvs_issued");
    assert.equal(proof.anchoredAddress, "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F");
    assert.deepEqual(signedMessages, ["uvp store wants you to sign in with your EVM account"]);
    assert.deepEqual(
      JSON.parse(requested.find((request) => request.url.endsWith("/store/auth/verify"))?.body ?? "{}"),
      { nonce: "nonce-1", signature: "0xsignature" }
    );
  });

  it("carries the invite token on preview requests (server token-hash gate)", async () => {
    const requested: string[] = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/product/invites/invite-9")) {
        return jsonResponse({
          invite: { inviteId: "invite-9", status: "active", expiresAt: "2026-05-01T00:00:00.000Z" },
          participant: {
            participantId: "participant-9",
            roleLabel: "物流/报关",
            displayName: "受邀方",
            contact: "invite@example.com",
            status: "invited"
          },
          draft: { draftId: "draft-9", title: "订单", businessType: "b", currency: "USDC", totalAmount: "1" }
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const client = createProductApiClient({ baseUrl: "http://service.local/", fetcher });

    await client.previewInvite("invite-9", { token: "one-time-token" });

    const previewUrl = requested.find((url) => url.includes("/product/invites/invite-9?"));
    assert.ok(previewUrl, "preview request captured");
    assert.ok(previewUrl.includes("token=one-time-token"));
  });

  it("keeps the proven wallet session on subsequent participant-scoped requests", async () => {
    // 非 local 运行时服务端强制会话锚定：proveWalletControl 成功后，
    // me/tasks/prepare-submit 等请求统一携带 x-uvp-store-session。
    const requested: Array<{ readonly url: string; readonly headers?: Record<string, string> }> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requested.push({ url, headers });
      if (url.endsWith("/store/auth/challenge")) {
        return jsonResponse({
          challenge: { nonce: "nonce-1", address: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F", message: "challenge" }
        });
      }
      if (url.endsWith("/store/auth/verify")) {
        return jsonResponse({
          token: "uvs_issued",
          session: { anchoredAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F" }
        });
      }
      if (url.endsWith("/product/tasks/task-1/prepare-submit")) {
        return jsonResponse({
          prepareId: "prep-1",
          taskId: "task-1",
          orderId: "order-1",
          intent: "confirm_stage",
          payloadHash: `0x${"11".repeat(32)}`,
          submitter: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
          expiresAt: "2026-05-01T00:00:00.000Z",
          typedData: {},
          evidence: []
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const client = createProductApiClient({
      baseUrl: "http://service.local/",
      fetcher,
      personalSign: async () => "0xsignature"
    });

    await client.proveWalletControl({ address: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F" });
    assert.equal(client.currentSessionToken(), "uvs_issued");
    await client.prepareTaskSubmit("task-1", {
      evidenceIds: [],
      walletAddress: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      intent: "confirm_stage"
    });

    const prepare = requested.find((request) => request.url.endsWith("/prepare-submit"));
    assert.ok(prepare, "prepare request captured");
    assert.equal(prepare.headers?.["x-uvp-store-session"], "uvs_issued");
  });

  it("refuses redirects so the session header is never replayed", async () => {
    const fetcher: ProductApiClientOptions["fetcher"] = async () =>
      new Response(null, { status: 302, headers: { location: "https://attacker.test/" } });
    const client = createProductApiClient({ baseUrl: "http://service.local/", fetcher });

    await assert.rejects(
      client.getTask("task-1"),
      (error: unknown) => {
        assert.ok(error instanceof ProductApiError);
        assert.match(error.message, /redirect_refused:302/u);
        return true;
      }
    );
  });

  it("prepares and submits executor and resource patches through Product API routes", async () => {
    const requested: Array<{ readonly url: string; readonly method: string; readonly body?: string }> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const body = init?.body as string | undefined;
      requested.push({ url, method: init?.method ?? "GET", ...(body ? { body } : {}) });
      if (url.endsWith("/product/tasks/task-selector/prepare-stage-executor-patch")) {
        return jsonResponse({
          prepareId: "prep-executor-1",
          orderId: "order-1",
          selectorTaskId: "task-selector",
          targetStageId: "inspection",
          mode: "handoff",
          previousExecutor: "0x0000000000000000000000000000000000000003",
          patchHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          typedData: {
            domain: { name: "UVPStagePatchModule", version: "0.1", chainId: 31337 },
            types: {
              UVPStagePatchModuleStageExecutorPatch: [
                { name: "selector", type: "address" },
                { name: "mode", type: "string" },
                { name: "previousExecutor", type: "address" }
              ]
            },
            primaryType: "UVPStagePatchModuleStageExecutorPatch",
            message: {
              selector: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
              mode: "handoff",
              previousExecutor: "0x0000000000000000000000000000000000000003"
            }
          }
        });
      }
      if (url.endsWith("/product/tasks/task-selector/submit-stage-executor-patch")) {
        return jsonResponse({
          prepareId: "prep-executor-1",
          orderId: "order-1",
          selectorTaskId: "task-selector",
          targetStageId: "inspection",
          mode: "handoff",
          previousExecutor: "0x0000000000000000000000000000000000000003",
          status: "confirmed",
          retryable: false,
          proofRows: [{ label: "阶段补充", value: "confirmed" }]
        });
      }
      if (url.endsWith("/product/tasks/task-resource-controller/prepare-stage-resource-patch")) {
        return jsonResponse({
          prepareId: "prep-resource-1",
          orderId: "order-1",
          taskId: "task-resource-controller",
          targetStageId: "inspection",
          resourceKey: "inspection_report",
          manifestHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          policyHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
          patchHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          typedData: {
            domain: { name: "UVPStagePatchModule", version: "0.1", chainId: 31337 },
            types: { UVPStagePatchModuleStageResourcePatch: [{ name: "selector", type: "address" }] },
            primaryType: "UVPStagePatchModuleStageResourcePatch",
            message: { selector: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F" }
          }
        });
      }
      if (url.endsWith("/product/tasks/task-resource-controller/submit-stage-resource-patch")) {
        return jsonResponse({
          prepareId: "prep-resource-1",
          orderId: "order-1",
          taskId: "task-resource-controller",
          targetStageId: "inspection",
          resourceKey: "inspection_report",
          status: "confirmed",
          retryable: false,
          proofRows: [{ label: "资源补充", value: "confirmed" }]
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const client = createProductApiClient({
      baseUrl: "http://service.local",
      fetcher
    });

    const prepared = await client.prepareStageExecutorPatch("task-selector", {
      selectorWallet: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      targetStageId: "inspection",
      mode: "handoff",
      previousExecutorWallet: "0x0000000000000000000000000000000000000003",
      executorWallet: "0x0000000000000000000000000000000000000002",
      executorMetadataHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      metadataURI: "ipfs://executor-patch/inspection"
    });
    const submitted = await client.submitStageExecutorPatch("task-selector", {
      prepareId: prepared.prepareId,
      selectorWallet: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      typedData: prepared.typedData,
      signature: `0x${"aa".repeat(65)}`,
      mode: "handoff",
      previousExecutorWallet: "0x0000000000000000000000000000000000000003",
      patch: prepared,
      previousExecutorSignature: `0x${"cc".repeat(65)}`
    });
    const preparedResource = await client.prepareStageResourcePatch("task-resource-controller", {
      selectorWallet: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      targetStageId: "inspection",
      resourceKey: "inspection_report",
      manifestURI: "ipfs://resource-manifest/inspection",
      manifestHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      policyHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
    });
    const submittedResource = await client.submitStageResourcePatch("task-resource-controller", {
      prepareId: preparedResource.prepareId,
      selectorWallet: "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F",
      typedData: preparedResource.typedData,
      signature: `0x${"bb".repeat(65)}`,
      patch: preparedResource
    });

    assert.equal(prepared.targetStageId, "inspection");
    assert.equal(prepared.mode, "handoff");
    assert.equal(prepared.previousExecutor, "0x0000000000000000000000000000000000000003");
    assert.equal(submitted.status, "confirmed");
    assert.equal(preparedResource.resourceKey, "inspection_report");
    assert.equal(submittedResource.status, "confirmed");
    assert.ok(requested.some((request) => request.method === "POST" && request.url.endsWith("/prepare-stage-executor-patch")));
    assert.ok(requested.some((request) => request.method === "POST" && request.url.endsWith("/submit-stage-executor-patch")));
    assert.ok(requested.some((request) => request.method === "POST" && request.url.endsWith("/prepare-stage-resource-patch")));
    assert.ok(requested.some((request) => request.method === "POST" && request.url.endsWith("/submit-stage-resource-patch")));
    assert.ok(requested.some((request) => request.body?.includes("resource-manifest/inspection")));
    assert.ok(requested.some((request) => request.body?.includes("\"mode\":\"handoff\"")));
    assert.ok(requested.some((request) => request.body?.includes("\"executorMetadataHash\"")));
    assert.ok(requested.some((request) => request.body?.includes("\"selectorWallet\"")));
    assert.ok(requested.some((request) => request.body?.includes("\"previousExecutorSignature\"")));
    assert.equal(requested.some((request) => request.body?.includes("\"writerWallet\"")), false);
    assert.equal(requested.some((request) => request.body?.includes("\"visibility\"")), false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("2xx non-JSON responses", () => {
  it("surfaces a ProductApiError instead of a bare SyntaxError", async () => {
    // 网关/代理返回 200 + HTML（如维护页）时，裸 SyntaxError 会把解析细节
    // 直接抛给界面；必须归入统一错误链。
    const fetcher: ProductApiClientOptions["fetcher"] = async () =>
      new Response("<html>maintenance</html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    const client = createProductApiClient({ baseUrl: "http://service.local", fetcher });

    await assert.rejects(
      client.getTask("task-1"),
      (error) => error instanceof ProductApiError && error.status === 200 && error.endpoint === "/product/me/tasks/task-1"
    );
  });
});

describe("wallet session recovery (non-local entry)", () => {
  it("surfaces wallet_identity_required 401s with the error code the UI branches on", async () => {
    const fetcher: ProductApiClientOptions["fetcher"] = async () =>
      new Response(JSON.stringify({ error: "wallet_identity_required", message: "anchored wallet session required" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    const client = createProductApiClient({ baseUrl: "http://service.local/", fetcher });

    await assert.rejects(
      client.loadParticipantHome(),
      (error: unknown) => isWalletIdentityRequired(error)
    );
  });

  it("persists the proven token and restores it into a fresh client (page reload)", async () => {
    // node 环境没有 sessionStorage：安装最小桩，测试后卸载。
    const store = new Map<string, string>();
    const previousSessionStorage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    (globalThis as { sessionStorage?: Storage }).sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      }
    } as Storage;
    const requested: Array<Record<string, string>> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/product/me") || url.endsWith("/product/me/orders") || url.endsWith("/product/me/tasks")) {
        requested.push(headers);
        return jsonResponse({
          participant: {
            participantId: "p1",
            walletAddress: "0x9d8A62f656a8d1615C1294fd71e9cfB3e4855A4F",
            roleLabels: ["物流/报关"],
            displayName: "参与方",
            status: "active"
          },
          orders: [],
          tasks: []
        });
      }
      if (url.endsWith("/store/auth/challenge")) {
        return jsonResponse({
          challenge: { nonce: "n", address: "0x9d8A62f656a8d1615C1294fd71e9cfB3e4855A4F", message: "m" }
        });
      }
      if (url.endsWith("/store/auth/verify")) {
        return jsonResponse({
          token: "uvs_reload",
          session: { anchoredAddress: "0x9d8A62f656a8d1615C1294fd71e9cfB3e4855A4F" }
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    try {
      const client = createProductApiClient({
        baseUrl: "http://service.local/",
        fetcher,
        personalSign: async () => "0xsignature"
      });
      await client.proveWalletControl({ address: "0x9d8A62f656a8d1615C1294fd71e9cfB3e4855A4F" });
      assert.equal(readPersistedWalletSessionToken(), "uvs_reload");

      // 模拟页面重载：新客户端实例从持久化恢复 token，参与者请求带会话头。
      const reloaded = createProductApiClient({
        baseUrl: "http://service.local/",
        fetcher,
        personalSign: async () => "0xsignature"
      });
      assert.equal(reloaded.restoreSessionToken(readPersistedWalletSessionToken()), true);
      await reloaded.loadParticipantHome();
      assert.ok(
        requested.length > 0 && requested.every((headers) => headers["x-uvp-store-session"] === "uvs_reload"),
        "restored session token must ride every participant request"
      );
    } finally {
      const globalsWithStorage = globalThis as { sessionStorage?: Storage };
      delete globalsWithStorage.sessionStorage;
      if (previousSessionStorage !== undefined) {
        globalsWithStorage.sessionStorage = previousSessionStorage;
      }
      persistWalletSessionToken(undefined);
    }
  });
});
