// artifact 入口的不变量：手填 bundle 的坏形状/坏 planId/坏 registerArgs.supplierBindings/
// root、坏 onchain.supplierBindings 必须具名拒绝（不落到通用异常）；多 trigger 按
// artifact 顺序枚举；commitPlan typed data 的 6 字段来自钱包与 registerArgs；
// 出生 trigger 是 orderId=0 的 submitSignal 直发（空签名），capability 计划带 stage
// attribution（否则链上 InvalidSignalCapability）。

import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";
import {
  buildCommitPlanTypedData,
  buildFinalizePlanCall,
  buildOrderTriggerCall,
  parseCompiledPlanArtifact,
  type CompiledPlanArtifact
} from "./plan";

const H = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as const;
const STATE_MACHINE = `0x${"ef".repeat(20)}` as const;
const SUPPLIER_UUID = "5f0b1e2a-7c9d-4e1f-9a2b-000000000021";
const SUPPLIER_ID = `0x${"0".repeat(32)}5f0b1e2a7c9d4e1f9a2b000000000021` as const;

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
      supplierBindings: [
        {
          stageIdentifier: "birth",
          stageId: H(2),
          supplierID: SUPPLIER_UUID,
          supplierId: SUPPLIER_ID,
          kind: 0
        }
      ],
      supplierBindingsRoot: H(15)
    },
    registerArgs: {
      schemaVersion: "uvp.onchainHookPlan.v1",
      sourcePlanId: H(8),
      zhixuId: "used-car/step-purchase@1.0.0",
      planHash: H(9),
      artifactHash: H(10),
      hooksHash: H(11),
      capabilitiesRoot: H(12),
      supplierBindingsRoot: H(15),
      fileWritersHash: H(17),
      fileWriters: [],
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
      supplierRoutes: [],
      supplierBindings: [{ stageId: H(2), supplierId: SUPPLIER_ID, kind: 0 }],
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

test("artifact 解析：坏 JSON/坏形状/坏 planId/坏 supplierBindings 具名拒绝；多 trigger 保序", () => {
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
  delete (noBindings["registerArgs"] as Record<string, unknown>)["supplierBindings"];
  const noBindingsResult = parseCompiledPlanArtifact(JSON.stringify(noBindings));
  assert.equal(noBindingsResult.ok, false);
  if (!noBindingsResult.ok) {
    assert.equal(noBindingsResult.code, "artifact_shape");
    assert.match(noBindingsResult.message, /supplierBindings/u);
  }

  const badBindingsRoot = cloneArtifact();
  (badBindingsRoot["registerArgs"] as Record<string, unknown>)["supplierBindingsRoot"] = "0x00";
  const badBindingsRootResult = parseCompiledPlanArtifact(JSON.stringify(badBindingsRoot));
  assert.equal(badBindingsRootResult.ok, false);
  if (!badBindingsRootResult.ok) {
    assert.equal(badBindingsRootResult.code, "artifact_invalid");
    assert.match(badBindingsRootResult.message, /supplierBindingsRoot/u);
  }

  const noOnchainBindings = cloneArtifact();
  delete (noOnchainBindings["onchain"] as Record<string, unknown>)["supplierBindings"];
  const noOnchainBindingsResult = parseCompiledPlanArtifact(JSON.stringify(noOnchainBindings));
  assert.equal(noOnchainBindingsResult.ok, false);
  if (!noOnchainBindingsResult.ok) {
    assert.equal(noOnchainBindingsResult.code, "artifact_shape");
    assert.match(noOnchainBindingsResult.message, /onchain\.supplierBindings/u);
  }

  const badSupplierBinding = cloneArtifact();
  const bindingEntries = (badSupplierBinding["onchain"] as Record<string, unknown>)[
    "supplierBindings"
  ] as Record<string, unknown>[];
  if (bindingEntries[0] === undefined) assert.fail("fixture supplier binding missing");
  bindingEntries[0]["supplierId"] = "0x12";
  const badSupplierBindingResult = parseCompiledPlanArtifact(JSON.stringify(badSupplierBinding));
  assert.equal(badSupplierBindingResult.ok, false);
  if (!badSupplierBindingResult.ok) {
    assert.equal(badSupplierBindingResult.code, "artifact_invalid");
    assert.match(badSupplierBindingResult.message, /supplierBindings\[0\]\.supplierId/u);
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
  assert.equal(multiTrigger.supplierBindings.length, 1);
  assert.equal(multiTrigger.supplierBindings[0]?.supplierID, SUPPLIER_UUID);
  assert.equal(multiTrigger.supplierBindings[0]?.supplierId, SUPPLIER_ID);

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

test("commitPlan typed data：6 字段来自钱包与 registerArgs", () => {
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
  assert.equal(typedData.value.message.publisher.toLowerCase(), WALLET);
  assert.equal(typedData.value.message.hooksHash, H(11));
  assert.equal(typedData.value.message.capabilitiesRoot, H(12));
  assert.equal(typedData.value.message.supplierBindingsRoot, H(15));
  assert.equal(typedData.value.message.deadline, "1900000000");
});

test("出生 trigger：orderId=0、submitter=钱包、空签名，capability 计划带 stage attribution", () => {
  const artifact = parseOk(cloneArtifact());
  const trigger = artifact.triggers[0];
  if (trigger === undefined) assert.fail("fixture trigger missing");

  const call = buildOrderTriggerCall({
    artifact,
    trigger,
    submitter: WALLET,
    chainId: 31_337,
    stateMachineAddress: STATE_MACHINE,
    rpcUrl: "http://127.0.0.1:8545",
    payloadHash: H(40),
    idempotencyKey: H(41),
    deadline: 1_900_000_000n
  });
  if (!call.ok) {
    assert.fail(`expected trigger call ok, got ${call.code}: ${call.message}`);
  }
  const [submission, signature] = call.value.args;
  assert.equal(submission.orderId, H(0));
  assert.equal(signature, "0x");
  assert.equal(submission.submitter.toLowerCase(), WALLET);
  assert.equal(submission.planId, H(9));
  assert.equal(submission.sourceId, trigger.sourceId);
  assert.equal(submission.signalId, trigger.signalId);
  assert.equal(submission.payloadHash, H(40));
  assert.equal(submission.idempotencyKey, H(41));
  assert.equal(submission.targetStageId, H(0));
  assert.deepEqual(submission.files, []);
  assert.equal(submission.attribution.stageId, H(2));

  const multiArtifact = parseOk(addTriggerEntries(cloneArtifact()));
  const selected = multiArtifact.triggers[1];
  if (selected === undefined) assert.fail("expected second trigger");
  const chosen = buildOrderTriggerCall({
    artifact: multiArtifact,
    trigger: selected,
    submitter: WALLET,
    chainId: 31_337,
    stateMachineAddress: STATE_MACHINE,
    rpcUrl: "http://127.0.0.1:8545",
    payloadHash: H(40),
    idempotencyKey: H(41),
    deadline: 1_900_000_000n
  });
  if (!chosen.ok) {
    assert.fail(`expected trigger call ok, got ${chosen.code}: ${chosen.message}`);
  }
  const [chosenSubmission] = chosen.value.args;
  assert.equal(chosenSubmission.sourceId, selected.sourceId);
  assert.equal(chosenSubmission.signalId, selected.signalId);
  assert.equal(chosenSubmission.attribution.stageId, H(51));
});

test("finalize-only 恢复使用 commitPlan 回执的 planId，而不是重新构造 commit", () => {
  const committedPlanId = H(0x77);
  const call = buildFinalizePlanCall({
    planId: committedPlanId,
    chainId: 31_337,
    stateMachineAddress: STATE_MACHINE
  });
  if (!call.ok) {
    assert.fail(`expected finalize call ok, got ${call.code}: ${call.message}`);
  }
  assert.equal(call.value.address.toLowerCase(), STATE_MACHINE);
  assert.equal(call.value.chainId, 31_337);
  const decoded = decodeFunctionData({
    abi: parseAbi(["function finalizePlan(bytes32 planId)"]),
    data: call.value.data
  });
  assert.equal(decoded.functionName, "finalizePlan");
  assert.deepEqual(decoded.args, [committedPlanId]);
});
