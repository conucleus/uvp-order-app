import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParticipantAddOnManifestActionKind, ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  filterProductTasksForOrder,
  findProductTaskForOrderByAction,
  productTaskActionKinds,
  selectParticipantWalletsFromFullSummary
} from "./orderAppFullSummary.js";

const resourcePatchWallet = "0x1111111111111111111111111111111111111111";
const selectorWallet = "0x2222222222222222222222222222222222222222";
const currentOrderId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const oldOrderId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("Order App full summary participant wallets", () => {
  it("prefers PRD92 selector wallet over buyer/resource patch wallet", () => {
    const wallets = selectParticipantWalletsFromFullSummary({
      wallets: {
        buyer: resourcePatchWallet,
        selector: selectorWallet
      },
      stageExecutorPatch: {
        selectorWallet
      },
      stageResourcePatch: {
        selectorWallet: resourcePatchWallet
      }
    });

    assert.equal(wallets.selectorWallet, selectorWallet);
    assert.equal(wallets.resourcePatchWallet, resourcePatchWallet);
  });

  it("uses stage patch wallets when the wallets block is incomplete", () => {
    const wallets = selectParticipantWalletsFromFullSummary({
      stageExecutorPatch: {
        selectorWallet
      },
      stageResourcePatch: {
        selectorWallet: resourcePatchWallet
      }
    });

    assert.equal(wallets.selectorWallet, selectorWallet);
    assert.equal(wallets.resourcePatchWallet, resourcePatchWallet);
  });

  it("keeps legacy single-buyer summaries working as a fallback", () => {
    const wallets = selectParticipantWalletsFromFullSummary({
      wallets: {
        buyer: resourcePatchWallet
      }
    });

    assert.equal(wallets.selectorWallet, resourcePatchWallet);
    assert.equal(wallets.resourcePatchWallet, resourcePatchWallet);
  });
});

describe("Order App full summary task filtering", () => {
  it("filters participant tasks to the current PRD92 order", () => {
    const tasks = [
      task("old-selector", oldOrderId, "stage_executor_patch"),
      task("current-selector", currentOrderId.toUpperCase(), "stage_executor_patch"),
      task("current-resource", currentOrderId, "stage_resource_patch")
    ];

    const currentTasks = filterProductTasksForOrder(tasks, currentOrderId);

    assert.deepEqual(currentTasks.map((item) => item.taskId), ["current-selector", "current-resource"]);
    assert.deepEqual(currentTasks.flatMap(productTaskActionKinds), ["stage_executor_patch", "stage_resource_patch"]);
  });

  it("finds an action only on the current order", () => {
    const tasks = [
      task("old-selector", oldOrderId, "stage_executor_patch"),
      task("current-resource", currentOrderId, "stage_resource_patch")
    ];

    assert.equal(findProductTaskForOrderByAction(tasks, currentOrderId, "stage_executor_patch"), undefined);
    assert.equal(findProductTaskForOrderByAction(tasks, currentOrderId, "stage_resource_patch")?.taskId, "current-resource");
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
    requiredEvidence: [],
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
