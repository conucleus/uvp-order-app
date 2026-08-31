import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  createProductApiClient,
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
    requiredEvidence: ["报关单"],
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
    const requested: Array<{ readonly url: string; readonly method: string; readonly body?: string }> = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input, init) => {
      const url = String(input);
      const body = init?.body as string | undefined;
      requested.push({ url, method: init?.method ?? "GET", ...(body ? { body } : {}) });
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
            requiredEvidence: ["报关单"]
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
      contact: "delivery@example.com"
    });

    assert.equal(preview.acceptance?.status, "can_accept");
    assert.equal(accepted.invite && (accepted.invite as { readonly status: string }).status, "accepted");
    assert.ok(requested.some((request) => request.method === "GET" && request.url.includes("walletAddress=")));
    assert.ok(requested.some((request) => request.method === "POST" && request.url.includes("/accept")));
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
