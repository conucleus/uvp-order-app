// V3 开单草稿映射：宿主选择 → 服务端 CreateOrderDraftV3Input。服务端没有
// performerSlotId/verifierSlotId 入参，映射不上的字段显式报错而不是静默丢弃。

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCreateOrderDraftInput,
  flattenConfigVersion,
  flatStageByKey,
  mapStageSelection,
  type StageSelectionV3
} from "../src/product/v3/index";
import { STANDARD_HASH, configVersionFixture } from "./fixtures";

const INVITE_DEADLINE = "2026-11-01T00:00:00.000Z";
const WORK_DEADLINE = "2026-11-20T00:00:00.000Z";

function selection(overrides: Partial<StageSelectionV3> = {}): StageSelectionV3 {
  return {
    stageKey: "sourcing",
    amountBaseUnits: "1200000000",
    acceptance: "self",
    performerSlotId: "performer",
    inviteDeadline: INVITE_DEADLINE,
    workDeadline: WORK_DEADLINE,
    ...overrides
  };
}

function sourcingStage() {
  const flat = flattenConfigVersion(configVersionFixture());
  const stage = flatStageByKey(flat, "sourcing");
  assert.ok(stage);
  return stage;
}

describe("mapStageSelection", () => {
  it("maps a funded stage to the server term shape without invented fields", () => {
    const result = mapStageSelection(selection(), sourcingStage());
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.value, {
      stageKey: "sourcing",
      amount: "1200000000",
      inviteDeadline: INVITE_DEADLINE,
      workDeadline: WORK_DEADLINE,
      acceptanceMode: "self"
    });
    assert.equal("performerSlotId" in result.value, false);
    assert.equal("stageId" in result.value, false);
  });

  it("passes an explicit standard handle through and requires its hash", () => {
    const stage = sourcingStage();
    const mapped = mapStageSelection(
      selection({ standardRef: { name: "std/custom", version: "1", hash: STANDARD_HASH, ref: "standards/custom.md" } }),
      stage
    );
    assert.equal(mapped.ok, true);
    if (mapped.ok) {
      assert.deepEqual(mapped.value.standard, {
        name: "std/custom",
        version: "1",
        hash: STANDARD_HASH,
        ref: "standards/custom.md"
      });
    }

    const missingHash = mapStageSelection(
      selection({ standardRef: { name: "std/custom", hash: "not-a-hash" } }),
      stage
    );
    assert.equal(missingHash.ok, false);
    if (!missingHash.ok) {
      assert.equal(missingHash.problem.code, "standard_hash_missing");
    }
  });

  it("refuses a performer slot the config does not declare", () => {
    const result = mapStageSelection(selection({ performerSlotId: "someone_else" }), sourcingStage());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.problem.code, "performer_slot_not_configurable");
      assert.deepEqual(result.problem.detail, { requested: "someone_else", derived: ["performer"] });
    }
  });

  it("refuses a verifier slot that differs from the configured one", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const inspection = flatStageByKey(flat, "inspection");
    assert.ok(inspection);
    const result = mapStageSelection(
      selection({ stageKey: "inspection", verifierSlotId: "someone_else" }),
      inspection
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.problem.code, "verifier_slot_not_configurable");
    }
  });

  it("requires both deadlines and their order", () => {
    const stage = sourcingStage();
    const missingInvite = mapStageSelection(selection({ inviteDeadline: undefined }), stage);
    assert.equal(missingInvite.ok, false);
    if (!missingInvite.ok) {
      assert.equal(missingInvite.problem.code, "missing_invite_deadline");
    }
    const missingWork = mapStageSelection(selection({ workDeadline: undefined }), stage);
    assert.equal(missingWork.ok, false);
    if (!missingWork.ok) {
      assert.equal(missingWork.problem.code, "missing_work_deadline");
    }
    const inverted = mapStageSelection(
      selection({ inviteDeadline: WORK_DEADLINE, workDeadline: INVITE_DEADLINE }),
      stage
    );
    assert.equal(inverted.ok, false);
    if (!inverted.ok) {
      assert.equal(inverted.problem.code, "deadline_order");
    }
  });

  it("requires a standard handle when the config has no resolvable hash", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const requirements = flatStageByKey(flat, "requirements");
    assert.ok(requirements);
    const result = mapStageSelection(
      selection({ stageKey: "requirements", performerSlotId: undefined, acceptance: "none" }),
      requirements
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.problem.code, "standard_hash_missing");
    }
  });
});

describe("buildCreateOrderDraftInput", () => {
  it("derives the stage subset from the selected stages in order", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const result = buildCreateOrderDraftInput({
      config: flat,
      title: "  代买一台车  ",
      stages: [selection(), selection({ stageKey: "inspection", acceptance: "third_party", verifierSlotId: "verifier" })]
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.value.title, "代买一台车");
    assert.equal(result.value.currency, "USDT");
    assert.equal(result.value.configId, "used-car/proxy_buy");
    assert.equal(result.value.configVersion, "3.0.0");
    assert.deepEqual(result.value.stageSubset, ["sourcing", "inspection"]);
    assert.deepEqual(result.value.stageTerms.map((term) => term.stageKey), ["sourcing", "inspection"]);
  });

  it("rejects duplicate and unknown stages", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const duplicate = buildCreateOrderDraftInput({
      config: flat,
      title: "t",
      stages: [selection(), selection()]
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.equal(duplicate.problem.code, "duplicate_stage");
    }

    const unknown = buildCreateOrderDraftInput({
      config: flat,
      title: "t",
      stages: [selection({ stageKey: "not_a_stage" })]
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.equal(unknown.problem.code, "unknown_stage");
    }
  });

  it("rejects a stageSubset that does not match the terms one-to-one", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const result = buildCreateOrderDraftInput({
      config: flat,
      title: "t",
      stages: [selection()],
      stageSubset: ["sourcing", "inspection"]
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.problem.code, "stage_subset_mismatch");
    }
  });

  it("surfaces the first stage mapping problem with its code", () => {
    const flat = flattenConfigVersion(configVersionFixture());
    const result = buildCreateOrderDraftInput({
      config: flat,
      title: "t",
      stages: [selection({ amountBaseUnits: "abc" })]
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.problem.code, "invalid_amount");
    }
  });
});
