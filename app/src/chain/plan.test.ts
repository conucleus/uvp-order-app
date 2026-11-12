// artifact 入口的不变量：手填 bundle 的坏形状/坏 planId/坏出生 trigger 必须具名
// 拒绝（不落到通用异常）；多 trigger 按 artifact 顺序枚举；
// 出生准备使用显式选择的 trigger，并按 artifact 声明的事实键授权、去重，capability
// 计划带 stage attribution（否则链上 InvalidSignalCapability）。

import assert from "node:assert/strict";
import test from "node:test";
import { deriveTriggerOrderId } from "@uvp-eth/uvp-client/core";
import {
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
      selectorBindings: []
    },
    registerArgs: {
      schemaVersion: "uvp.hook-plan/v2",
      sourcePlanId: H(8),
      zhixuId: "used-car/step-purchase@1.0.0",
      planHash: H(9),
      artifactHash: H(10),
      hooksHash: H(11),
      capabilitiesRoot: H(12),
      executorCandidatesRoot: H(15),
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
      executorCandidates: [],
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

test("artifact 解析：坏 JSON/坏形状/坏 planId 具名拒绝；多 trigger 保序", () => {
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

test("出生准备：capability 计划带 stage attribution；授权按事实键去重", () => {
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

  assert.equal(prepared.value.authorizations.length, 1);
  const authorization = prepared.value.authorizations[0];
  if (authorization === undefined) assert.fail("expected one authorization");
  assert.equal(authorization.sourceId, H(3));
  assert.equal(authorization.signalId, H(4));
  assert.equal(authorization.submitter, WALLET);
  assert.equal(authorization.role, `0x${"0".repeat(64)}`);
  assert.equal(authorization.metadataHash, `0x${"0".repeat(64)}`);
  assert.equal(prepared.value.birthFactAttribution.stageId, H(2));
  assert.equal(prepared.value.typedData.message.submitter, WALLET);
  assert.equal(prepared.value.typedData.message.creator, CREATOR);

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
    assert.equal(
      chosen.value.orderId,
      deriveTriggerOrderId(multiArtifact.planId, selected.sourceId, selected.signalId, H(40))
    );
    assert.equal(chosen.value.birthFactAttribution.stageId, selected.stageId);
  }
});
