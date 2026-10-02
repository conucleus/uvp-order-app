import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParticipantAddOnManifestActionKind, ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  filterProductTasksForOrder,
  findProductTaskForOrderByAction,
  productTaskActionKinds,
  selectParticipantWalletsFromFullSummary,
  summaryContentAddressedUri
} from "./orderAppFullSummary.js";

const resourcePatchWallet = "0x1111111111111111111111111111111111111111";
const selectorWallet = "0x2222222222222222222222222222222222222222";
const patchDerivedWallet = "0x3333333333333333333333333333333333333333";
const currentOrderId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherOrderId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("Order App full summary participant wallets", () => {
  it("prefers the explicit summary wallets over stage patch wallets", () => {
    const wallets = selectParticipantWalletsFromFullSummary({
      wallets: {
        buyer: resourcePatchWallet,
        selector: selectorWallet
      },
      stageExecutorPatch: {
        selectorWallet: patchDerivedWallet
      },
      stageResourcePatch: {
        selectorWallet: patchDerivedWallet
      }
    });

    assert.equal(wallets.selectorWallet, selectorWallet);
    assert.equal(wallets.resourcePatchWallet, resourcePatchWallet);
  });

});

describe("Order App full summary task filtering", () => {
  it("filters participant tasks to the current order", () => {
    const tasks = [
      task("other-selector", otherOrderId, "stage_executor_patch"),
      task("current-selector", currentOrderId.toUpperCase(), "stage_executor_patch"),
      task("current-resource", currentOrderId, "stage_resource_patch")
    ];

    const currentTasks = filterProductTasksForOrder(tasks, currentOrderId);

    assert.deepEqual(currentTasks.map((item) => item.taskId), ["current-selector", "current-resource"]);
    assert.deepEqual(currentTasks.flatMap(productTaskActionKinds), ["stage_executor_patch", "stage_resource_patch"]);
  });

  it("finds an action only on the current order", () => {
    const tasks = [
      task("other-selector", otherOrderId, "stage_executor_patch"),
      task("current-resource", currentOrderId, "stage_resource_patch")
    ];

    assert.equal(findProductTaskForOrderByAction(tasks, currentOrderId, "stage_executor_patch"), undefined);
    assert.equal(findProductTaskForOrderByAction(tasks, currentOrderId, "stage_resource_patch")?.taskId, "current-resource");
  });
});

describe("Order App full summary content-addressed URIs", () => {
  it("passes through the same reference shapes the production precheck accepts", () => {
    assert.equal(summaryContentAddressedUri("executorMetadataURI", "ipfs://bafyabc"), "ipfs://bafyabc");
    assert.equal(summaryContentAddressedUri("resourceManifestURI", "  AR://xyz "), "AR://xyz");
    assert.equal(summaryContentAddressedUri("manifestURI", "cid:bafyabc"), "cid:bafyabc");
    assert.equal(summaryContentAddressedUri("manifestURI", "bafybeig..."), "bafybeig...");
  });

  it("rejects urn: references like the production precheck instead of minting an urn fallback", () => {
    // 生产预检明拒 urn:（taskUtils 有测试钉死）；full 门旧本地副本放行 urn:
    // 并对非内容寻址值铸 urn:sha256 兜底，把真实数据形态洗成生产必拒的值，
    // 让门把产品按规格的阻断误报成产品故障。对齐后：不兜底、直接抛错点名。
    assert.throws(
      () => summaryContentAddressedUri("executorMetadataURI", "urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9eacsd0"),
      /executorMetadataURI.*内容寻址/u
    );
    assert.throws(
      () => summaryContentAddressedUri("resourceManifestURI", "urn:sha256:abcdef"),
      /resourceManifestURI.*内容寻址/u
    );
    assert.throws(
      () => summaryContentAddressedUri("manifestURI", "https://cos.example.com/manifest.json"),
      /manifestURI.*内容寻址/u
    );
    assert.throws(
      () => summaryContentAddressedUri("manifestURI", "  "),
      /manifestURI.*内容寻址/u
    );
  });
});

function task(taskId: string, orderId: string, actionKind: ParticipantAddOnManifestActionKind): ProductTaskDTO {
  return {
    taskId,
    orderId,
    orderTitle: "Order",
    zhixuId: "zhixu",
    title: taskId,
    subtitle: "",
    assigneeRole: "buyer",
    stageId: "stage",
    stageName: "Stage",
    deadline: "2026-05-02T00:00:00.000Z",
    fundingImpact: "",
    status: "open",
    addOnManifest: {
      schemaVersion: "participant-addon-manifest.v1",
      manifestId: `${taskId}-manifest`,
      roleSlotId: "buyer",
      addOnKind: actionKind,
      title: taskId,
      summary: "",
      stageBindings: ["stage"],
      pages: [],
      actions: [{
        actionId: `${taskId}-action`,
        actionKind,
        label: actionKind,
        inputBindings: {}
      }]
    },
    responsibilityStatements: [],
    proofRows: []
  };
}
