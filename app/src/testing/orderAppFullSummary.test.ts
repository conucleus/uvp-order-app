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
