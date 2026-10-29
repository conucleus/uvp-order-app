// artifact 入口的不变量：手填 bundle 的坏形状/坏 planId/坏出生 trigger 必须具名
// 拒绝（不落到通用异常）；出生准备按 artifact 声明的事实键授权并去重，capability
// 计划带 stage attribution（否则链上 InvalidSignalCapability）。

import assert from "node:assert/strict";
import test from "node:test";
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
          hookName: "BIRTH",
          kind: "receive",
          orderTriggerKind: "mint",
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
      dockRoutesRoot: H(13),
      dockInterfaceRoot: H(14),
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

function parseOk(raw: Record<string, unknown>): CompiledPlanArtifact {
  const parsed = parseCompiledPlanArtifact(JSON.stringify(raw));
  if (!parsed.ok) {
    assert.fail(`expected parse ok, got ${parsed.code}: ${parsed.message}`);
  }
  return parsed.value;
}

test("artifact 解析：空/坏 JSON/坏形状/坏 planId 具名拒绝", () => {
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
});

test("出生 trigger 选择：唯一 mint 取 positive 依赖；多 mint 优先 bootstrap；缺失/多义具名", () => {
  const artifact = parseOk(cloneArtifact());
  assert.equal(artifact.trigger.hookId, H(1));
  assert.equal(artifact.trigger.stageId, H(2));
  assert.equal(artifact.trigger.sourceId, H(3));
  assert.equal(artifact.trigger.signalId, H(4));
  assert.equal(artifact.trigger.source, "platform");
  assert.equal(artifact.trigger.signalName, "birth_intake.order_requested");

  const bootstrapPreferred = cloneArtifact();
  const hooks = (bootstrapPreferred["onchain"] as Record<string, unknown>)["compiledHooks"] as Record<string, unknown>[];
  hooks.push({
    hookId: H(20),
    stageId: H(21),
    kind: "receive",
    orderTriggerKind: "mint",
    dependencies: [
      {
        kind: "positive",
        source: "bootstrap",
        signalName: "update.init.trigger",
        sourceId: H(22),
        signalId: H(23),
        signalKey: H(24)
      }
    ]
  });
  const preferred = parseOk(bootstrapPreferred);
  assert.equal(preferred.trigger.hookId, H(20));
  assert.equal(preferred.trigger.sourceId, H(22));
  assert.equal(preferred.trigger.source, "bootstrap");

  const ambiguous = cloneArtifact();
  const ambiguousHooks = (ambiguous["onchain"] as Record<string, unknown>)["compiledHooks"] as Record<string, unknown>[];
  ambiguousHooks.push({
    hookId: H(25),
    stageId: H(26),
    kind: "receive",
    orderTriggerKind: "mint",
    dependencies: [
      { kind: "positive", source: "other", signalName: "other.trigger", sourceId: H(27), signalId: H(28), signalKey: H(29) }
    ]
  });
  const ambiguousResult = parseCompiledPlanArtifact(JSON.stringify(ambiguous));
  assert.equal(ambiguousResult.ok, false);
  if (!ambiguousResult.ok) assert.equal(ambiguousResult.code, "artifact_ambiguous_trigger");

  const missing = cloneArtifact();
  const missingOnchain = missing["onchain"] as Record<string, unknown>;
  missingOnchain["compiledHooks"] = (missingOnchain["compiledHooks"] as Record<string, unknown>[]).filter(
    (hook) => hook["orderTriggerKind"] !== "mint"
  );
  const missingResult = parseCompiledPlanArtifact(JSON.stringify(missing));
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.code, "artifact_missing_trigger");

  const doublePositive = cloneArtifact();
  const doubleHooks = (doublePositive["onchain"] as Record<string, unknown>)["compiledHooks"] as Record<string, unknown>[];
  const mint = doubleHooks[0];
  if (mint === undefined) assert.fail("fixture mint hook missing");
  (mint["dependencies"] as Record<string, unknown>[]).push({
    kind: "positive",
    source: "second",
    signalName: "second.trigger",
    sourceId: H(30),
    signalId: H(31),
    signalKey: H(32)
  });
  const doubleResult = parseCompiledPlanArtifact(JSON.stringify(doublePositive));
  assert.equal(doubleResult.ok, false);
  if (!doubleResult.ok) assert.equal(doubleResult.code, "artifact_ambiguous_trigger");
});

test("出生准备：capability 计划带 stage attribution；授权按事实键去重", () => {
  const artifact = parseOk(cloneArtifact());
  assert.equal(artifact.facts.length, 1);

  const prepared = prepareOrderBirth({
    artifact,
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
});
