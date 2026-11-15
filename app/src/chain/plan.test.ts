// artifact 入口的不变量：手填 bundle 的坏形状/坏 planId/坏 registerArgs.bindings/root
// 必须具名拒绝（不落到通用异常）；多 trigger 按 artifact 顺序枚举；commitPlan typed
// data 的 executorBindingsRoot 来自 registerArgs；出生准备使用显式选择的 trigger，
// capability 计划带 stage attribution（否则链上 InvalidSignalCapability），出生不再
// 携带 SignalAuthorization 行。

import assert from "node:assert/strict";
import test from "node:test";
import { deriveTriggerOrderId } from "@uvp-eth/uvp-client/core";
import {
  buildCommitPlanTypedData,
  parseCompiledPlanArtifact,
  prepareOrderBirth,
  type CompiledPlanArtifact
} from "./plan";

const H = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as const;
const CREATOR = `0x${"cd".repeat(20)}` as const;
const STATE_MACHINE = `0x${"ef".repeat(20)}` as const;

const TRIGGER_FACT = {
  kind: "positive",
  source: "platform",
  signalName: "birth_intake.order_requested",
  sourceId: H(3),
  signalId: H(4),
  signalKey: H(5)
};

const SECOND_TRIGGER = {
  hookId: H(50),
  stageIdentifier: "renew",
  stageId: H(51),
  hookName: "renew",
  orderTriggerKind: "trigger",
  source: "seller",
  signalName: "renew.renew",
  sourceId: H(52),
  signalId: H(53)
};

function baseArtifact(): Record<string, unknown> {
  return {
    definition: {
      apiVersion: "uvp/zhixu/v1",
      kind: "Zhixu",
      metadata: {},
      spec: { stages: [] }
    },
    onchain: {
      zhixuId: "used-car/step-purchase@1.0.0",
      zhixuName: "purchase",
      compiledHooks: [
        {
          hookId: H(1),
          stageId: H(2),
          stageIdentifier: "birth",
          hookName: "order_requested",
          kind: "receive",
          orderTriggerKind: "trigger",
          emitReady: true,
          dynamicExecutor: false,
          instructions: [],
          dependencies: [TRIGGER_FACT]
        },
        {
          hookId: H(6),
          stageId: H(2),
          stageIdentifier: "birth",
          hookName: "BIRTH_READY",
          kind: "receive",
          orderTriggerKind: "none",
          emitReady: true,
          dynamicExecutor: false,
          instructions: [],
          dependencies: [TRIGGER_FACT]
        }
      ],
      triggers: [
        {
          hookId: H(1),
          stageIdentifier: "birth",
          stageId: H(2),
          hookName: "order_requested",
          orderTriggerKind: "trigger",
          source: "platform",
          signalName: "birth_intake.order_requested",
          sourceId: H(3),
          signalId: H(4)
        }
      ],
      signalCapabilities: [
        {
          stageIdentifier: "birth",
          stageId: H(2),
          source: "platform",
          declaredSignal: "order_requested",
          targetSource: "platform",
          targetSourceId: H(3),
          targetSignalName: "birth_intake.order_requested",
          signalId: H(4),
          targetOrderRelation: "current",
          capabilityHash: H(7)
        }
      ],
      selectorBindings: [],
      executorBindings: [{ stageId: H(2), supplierId: H(18), kind: 0 }],
      executorBindingsRoot: H(15)
    },
    registerArgs: {
      schemaVersion: "uvp.onchainHookPlan.v8",
      sourcePlanId: H(8),
      zhixuId: "used-car/step-purchase@1.0.0",
      planHash: H(9),
      artifactHash: H(10),
      hooksHash: H(11),
      capabilitiesRoot: H(12),
      executorBindingsRoot: H(15),
      hooks: [
        {
          hookId: H(1),
          stageId: H(2),
          hookName: H(16),
          kind: "receive",
          flags: 4,
          instructions: [{ op: "SIGNAL", sourceId: H(3), signalId: H(4), signalKey: H(5) }],
          dependencyKeys: [H(5)]
        }
      ],
      dependencyIndex: [],
      executorRoutes: [],
      executorBindings: [{ stageId: H(2), supplierId: H(18), kind: 0 }],
      selectorBindings: [],
      signalCapabilities: []
    },
    planId: H(17)
  };
}

function cloneArtifact(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(baseArtifact())) as Record<string, unknown>;
}

function addTriggerEntries(raw: Record<string, unknown>): Record<string, unknown> {
  const onchain = raw["onchain"] as Record<string, unknown>;
  (onchain["compiledHooks"] as Record<string, unknown>[]).push(
    {
      hookId: SECOND_TRIGGER.hookId,
      stageId: SECOND_TRIGGER.stageId,
      stageIdentifier: SECOND_TRIGGER.stageIdentifier,
      hookName: SECOND_TRIGGER.hookName,
      kind: "receive",
      orderTriggerKind: "trigger",
      emitReady: true,
      dynamicExecutor: false,
      instructions: [],
      dependencies: [
        {
          kind: "positive",
          source: SECOND_TRIGGER.source,
          signalName: SECOND_TRIGGER.signalName,
          sourceId: SECOND_TRIGGER.sourceId,
          signalId: SECOND_TRIGGER.signalId,
          signalKey: H(54)
        }
      ]
    }
  );
  (onchain["triggers"] as Record<string, unknown>[]).push(SECOND_TRIGGER);
  (onchain["signalCapabilities"] as Record<string, unknown>[]).push({
    stageIdentifier: SECOND_TRIGGER.stageIdentifier,
    stageId: SECOND_TRIGGER.stageId,
    source: SECOND_TRIGGER.source,
    declaredSignal: "renew",
    targetSource: SECOND_TRIGGER.source,
    targetSourceId: SECOND_TRIGGER.sourceId,
    targetSignalName: SECOND_TRIGGER.signalName,
    signalId: SECOND_TRIGGER.signalId,
    targetOrderRelation: "current",
    capabilityHash: H(70)
  });
  return raw;
}

function parseOk(raw: Record<string, unknown>): CompiledPlanArtifact {
  const parsed = parseCompiledPlanArtifact(JSON.stringify(raw));
  if (!parsed.ok) {
    assert.fail(`expected parse ok, got ${parsed.code}: ${parsed.message}`);
  }
  return parsed.value;
}

test("artifact 解析：坏 JSON/坏形状/坏 planId/坏 bindings 具名拒绝；多 trigger 保序", () => {
  const empty = parseCompiledPlanArtifact(" ");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "artifact_empty");

  const badJson = parseCompiledPlanArtifact("{");
  assert.equal(badJson.ok, false);
  if (!badJson.ok) assert.equal(badJson.code, "artifact_json");

  const notObject = parseCompiledPlanArtifact("[]");
  assert.equal(notObject.ok, false);
  if (!notObject.ok) assert.equal(notObject.code, "artifact_shape");

  const noRegisterArgs = cloneArtifact();
  delete noRegisterArgs["registerArgs"];
  const missing = parseCompiledPlanArtifact(JSON.stringify(noRegisterArgs));
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "artifact_shape");
    assert.match(missing.message, /registerArgs/u);
  }

  const badPlanId = cloneArtifact();
  badPlanId["planId"] = "0x1234";
  const planId = parseCompiledPlanArtifact(JSON.stringify(badPlanId));
  assert.equal(planId.ok, false);
  if (!planId.ok) assert.equal(planId.code, "artifact_plan_id");

  const noBindings = cloneArtifact();
  delete (noBindings["registerArgs"] as Record<string, unknown>)["executorBindings"];
  const noBindingsResult = parseCompiledPlanArtifact(JSON.stringify(noBindings));
  assert.equal(noBindingsResult.ok, false);
  if (!noBindingsResult.ok) {
    assert.equal(noBindingsResult.code, "artifact_shape");
    assert.match(noBindingsResult.message, /executorBindings/u);
  }

  const badBindingsRoot = cloneArtifact();
  (badBindingsRoot["registerArgs"] as Record<string, unknown>)["executorBindingsRoot"] = "0x00";
  const badBindingsRootResult = parseCompiledPlanArtifact(JSON.stringify(badBindingsRoot));
  assert.equal(badBindingsRootResult.ok, false);
  if (!badBindingsRootResult.ok) {
    assert.equal(badBindingsRootResult.code, "artifact_invalid");
    assert.match(badBindingsRootResult.message, /executorBindingsRoot/u);
  }

  const badRelation = cloneArtifact();
  const onchain = badRelation["onchain"] as Record<string, unknown>;
  const capabilities = onchain["signalCapabilities"] as Record<string, unknown>[];
  if (capabilities[0] === undefined) assert.fail("fixture capability missing");
  capabilities[0]["targetOrderRelation"] = "trigger-origin";
  const relation = parseCompiledPlanArtifact(JSON.stringify(badRelation));
  assert.equal(relation.ok, false);
  if (!relation.ok) {
    assert.equal(relation.code, "artifact_invalid");
    assert.match(relation.message, /targetOrderRelation/u);
  }

  const multiTrigger = parseOk(addTriggerEntries(cloneArtifact()));
  assert.equal(multiTrigger.triggers.length, 2);
  assert.equal(multiTrigger.triggers[0]?.hookId, H(1));
  assert.equal(multiTrigger.triggers[1]?.hookId, SECOND_TRIGGER.hookId);

  const noTriggers = cloneArtifact();
  (noTriggers["onchain"] as Record<string, unknown>)["triggers"] = [];
  const noTriggersResult = parseCompiledPlanArtifact(JSON.stringify(noTriggers));
  assert.equal(noTriggersResult.ok, false);
  if (!noTriggersResult.ok) assert.equal(noTriggersResult.code, "artifact_missing_trigger");

  const noTriggerField = cloneArtifact();
  delete (noTriggerField["onchain"] as Record<string, unknown>)["triggers"];
  const noTriggerFieldResult = parseCompiledPlanArtifact(JSON.stringify(noTriggerField));
  assert.equal(noTriggerFieldResult.ok, false);
  if (!noTriggerFieldResult.ok) assert.equal(noTriggerFieldResult.code, "artifact_shape");
});

test("commitPlan typed data：executorBindingsRoot 来自 registerArgs，publisher=birthAuthorizer=钱包", () => {
  const artifact = parseOk(cloneArtifact());
  const typedData = buildCommitPlanTypedData({
    artifact,
    publisher: WALLET,
    chainId: 31_337,
    stateMachineAddress: STATE_MACHINE,
    deadline: 1_900_000_000n
  });
  if (!typedData.ok) {
    assert.fail(`expected commit typed data ok, got ${typedData.code}: ${typedData.message}`);
  }
  assert.equal(typedData.value.message.executorBindingsRoot, H(15));
  assert.equal(typedData.value.message.publisher.toLowerCase(), WALLET);
  assert.equal(typedData.value.message.birthAuthorizer.toLowerCase(), WALLET);
  assert.equal(typedData.value.message.deadline, "1900000000");
});

test("出生准备：capability 计划带 stage attribution，typed data 只带 birth 字段", () => {
  const artifact = parseOk(cloneArtifact());
  assert.equal(artifact.facts.length, 1);
  const trigger = artifact.triggers[0];
  if (trigger === undefined) assert.fail("fixture trigger missing");

  const prepared = prepareOrderBirth({
    artifact,
    trigger,
    creator: CREATOR,
    submitter: WALLET,
    chainId: 31_337,
    stateMachineAddress: STATE_MACHINE,
    payloadHash: H(40),
    idempotencyKey: H(41),
    deadline: 1_900_000_000n
  });
  if (!prepared.ok) {
    assert.fail(`expected birth preparation ok, got ${prepared.code}: ${prepared.message}`);
  }

  assert.equal(prepared.value.birthFactAttribution.stageId, H(2));
  assert.equal(prepared.value.typedData.message.submitter.toLowerCase(), WALLET);
  assert.equal(prepared.value.typedData.message.creator.toLowerCase(), CREATOR);
  assert.equal(prepared.value.typedData.message.triggerHookId, trigger.hookId);
  assert.equal(prepared.value.typedData.message.sourceId, trigger.sourceId);
  assert.equal(
    prepared.value.orderId,
    deriveTriggerOrderId(artifact.planId, trigger.sourceId, trigger.signalId, H(40))
  );

  const multiArtifact = parseOk(addTriggerEntries(cloneArtifact()));
  const triggerA = multiArtifact.triggers[0];
  const triggerB = multiArtifact.triggers[1];
  if (triggerA === undefined || triggerB === undefined) assert.fail("expected two triggers");

  for (const selected of [triggerA, triggerB]) {
    const chosen = prepareOrderBirth({
      artifact: multiArtifact,
      trigger: selected,
      creator: CREATOR,
      submitter: WALLET,
      chainId: 31_337,
      stateMachineAddress: STATE_MACHINE,
      payloadHash: H(40),
      idempotencyKey: H(41),
      deadline: 1_900_000_000n
    });
    if (!chosen.ok) {
      assert.fail(`expected birth preparation ok, got ${chosen.code}: ${chosen.message}`);
    }
    assert.equal(chosen.value.typedData.message.triggerHookId, selected.hookId);
    assert.equal(chosen.value.typedData.message.triggerStageId, selected.stageId);
    assert.equal(chosen.value.typedData.message.sourceId, selected.sourceId);
    assert.equal(chosen.value.typedData.message.signalId, selected.signalId);
  }
});
