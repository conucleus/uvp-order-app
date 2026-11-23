// 手填编译产物（used-car 编译器 bundle：definition/onchain/registerArgs/planId）
// 的浏览器侧入口：解析 artifact（onchain 的 StageSupplierBinding supplierID UUID/
// supplierId bytes32、registerArgs 的 hooks 与 supplierBindings/root，onchain.triggers
// 枚举，多 trigger 合法）、按 stage/signal 选本次出生 trigger，把 commitPlan/
// finalizePlan 与出生 trigger 的 submitSignal calldata 交给 uvp-client core 构造。
// 浏览器不编译 DSL、不重算协议 hash；失败按具体字段/原因具名。

import type { Address, Hex } from "viem";
import {
  ZERO_BYTES32,
  buildPlanCommitTypedDataFor,
  buildPlanFinalizeCall,
  buildPlanRegistration,
  buildSubmitStateMachineSignalCall,
  planRegistrationArgs,
  withCapabilityProofs,
  type SubmitStateMachineSignalCall
} from "@uvp-eth/uvp-client/core";
import { parseBytes32, type Bytes32 } from "./input";

export type PlanFailure = { readonly ok: false; readonly code: string; readonly message: string };
export type PlanResult<T> = { readonly ok: true; readonly value: T } | PlanFailure;

export type PlanCommitTypedData = ReturnType<typeof buildPlanCommitTypedDataFor>;
type PlanRegistrationArgs = ReturnType<typeof planRegistrationArgs>;
type PlanRegistrationSource = Parameters<typeof planRegistrationArgs>[0];
type PlanTransactionCall = ReturnType<typeof buildPlanRegistration>["commitCall"];

interface PlanDependency {
  readonly kind: string;
  readonly source: string;
  readonly signalName: string;
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
}

interface PlanHook {
  readonly hookId: Bytes32;
  readonly stageId: Bytes32;
  readonly orderTriggerKind: string;
  readonly kind: string;
  readonly dependencies: readonly PlanDependency[];
}

export interface PlanCapability {
  readonly stageId: Bytes32;
  readonly targetSourceId: Bytes32;
  readonly signalId: Bytes32;
  readonly relation: 0;
  readonly source: string;
  readonly signalName: string;
}

export interface DeclaredFact {
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
  readonly source: string;
  readonly signalName: string;
}

export interface PlanSupplierBinding {
  readonly stageId: Bytes32;
  readonly supplierID: string;
  readonly supplierId: Bytes32;
  readonly kind: 0 | 1;
}

export interface PlanTrigger {
  readonly hookId: Bytes32;
  readonly stageIdentifier: string;
  readonly stageId: Bytes32;
  readonly hookName: string;
  readonly source: string;
  readonly signalName: string;
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
}

export interface CompiledPlanArtifact {
  readonly planId: Bytes32;
  readonly hookCount: number;
  readonly zhixuId?: string | undefined;
  readonly zhixuName?: string | undefined;
  readonly capabilities: readonly PlanCapability[];
  readonly selectorBindings: readonly { readonly selectorStageId: Bytes32; readonly targetStageId: Bytes32 }[];
  readonly supplierBindings: readonly PlanSupplierBinding[];
  readonly facts: readonly DeclaredFact[];
  readonly triggers: readonly PlanTrigger[];
  readonly registerArgs: PlanRegistrationSource;
}

export interface FactAttribution {
  readonly sourceId: Bytes32;
  readonly signalId: Bytes32;
  readonly stageId: Bytes32;
  readonly capabilityProof: readonly Bytes32[];
}

export interface CommitPlanInput {
  readonly artifact: CompiledPlanArtifact;
  readonly publisher: Address;
  readonly chainId: number;
  readonly stateMachineAddress: Address;
  readonly deadline: bigint;
}

export interface OrderTriggerInput {
  readonly artifact: CompiledPlanArtifact;
  readonly trigger: PlanTrigger;
  readonly submitter: Address;
  readonly chainId: number;
  readonly stateMachineAddress: Address;
  readonly rpcUrl: string;
  readonly payloadHash: Bytes32;
  readonly idempotencyKey: Bytes32;
  readonly deadline: bigint;
}

export function parseCompiledPlanArtifact(text: string): PlanResult<CompiledPlanArtifact> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return fail("artifact_empty", "artifact 为空：先粘贴或载入 used-car 编译器产出的 JSON。");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (error) {
    return fail("artifact_json", `artifact 不是合法 JSON：${errorMessage(error)}`);
  }
  if (!isRecord(raw)) {
    return fail("artifact_shape", "artifact 必须是 JSON 对象。");
  }
  if (!isRecord(raw["definition"])) {
    return fail("artifact_shape", "artifact.definition 必须是对象（浏览器不编译它，只校验 bundle 形状）。");
  }
  if (!isRecord(raw["onchain"])) {
    return fail("artifact_shape", "artifact.onchain 必须是对象。");
  }
  if (!isRecord(raw["registerArgs"])) {
    return fail("artifact_shape", "artifact.registerArgs 必须是对象。");
  }
  if (typeof raw["planId"] !== "string") {
    return fail("artifact_plan_id", "artifact.planId 必须是 0x + 64 hex。");
  }
  const planId = parseBytes32(raw["planId"], "artifact.planId");
  if (!planId.ok) {
    return fail("artifact_plan_id", planId.message);
  }
  if (planId.value.toLowerCase() === ZERO_BYTES32) {
    return fail("artifact_plan_id", "artifact.planId 不能是零值。");
  }
  const onchain = raw["onchain"];
  const registerArgs = raw["registerArgs"];
  if (!Array.isArray(registerArgs["hooks"]) || registerArgs["hooks"].length === 0) {
    return fail("artifact_shape", "artifact.registerArgs.hooks 必须是非空数组。");
  }
  if (!Array.isArray(registerArgs["supplierBindings"])) {
    return fail("artifact_shape", "artifact.registerArgs.supplierBindings 必须是数组。");
  }
  if (!Array.isArray(registerArgs["fileWriters"])) {
    return fail("artifact_shape", "artifact.registerArgs.fileWriters 必须是数组。");
  }
  if (typeof registerArgs["fileWritersHash"] !== "string") {
    return fail("artifact_shape", "artifact.registerArgs.fileWritersHash 必须是 0x + 64 hex。");
  }
  if (typeof registerArgs["supplierBindingsRoot"] !== "string") {
    return fail("artifact_shape", "artifact.registerArgs.supplierBindingsRoot 必须是 0x + 64 hex。");
  }
  const supplierBindingsRoot = nonZeroBytes32(
    registerArgs["supplierBindingsRoot"],
    "artifact.registerArgs.supplierBindingsRoot"
  );
  if (!supplierBindingsRoot.ok) {
    return supplierBindingsRoot;
  }
  const hooks = readHooks(onchain["compiledHooks"]);
  if (!hooks.ok) {
    return hooks;
  }
  const triggers = readTriggers(onchain["triggers"]);
  if (!triggers.ok) {
    return triggers;
  }
  const capabilities = readCapabilities(onchain["signalCapabilities"]);
  if (!capabilities.ok) {
    return capabilities;
  }
  const selectorBindings = readSelectorBindings(onchain["selectorBindings"]);
  if (!selectorBindings.ok) {
    return selectorBindings;
  }
  const supplierBindings = readSupplierBindings(onchain["supplierBindings"]);
  if (!supplierBindings.ok) {
    return supplierBindings;
  }
  return {
    ok: true,
    value: {
      planId: planId.value,
      hookCount: registerArgs["hooks"].length,
      ...(typeof onchain["zhixuId"] === "string" ? { zhixuId: onchain["zhixuId"] } : {}),
      ...(typeof onchain["zhixuName"] === "string" ? { zhixuName: onchain["zhixuName"] } : {}),
      capabilities: capabilities.value,
      selectorBindings: selectorBindings.value,
      supplierBindings: supplierBindings.value,
      facts: declaredFacts(capabilities.value, hooks.value),
      triggers: triggers.value,
      registerArgs: registerArgs as unknown as PlanRegistrationSource
    }
  };
}

export function buildCommitPlanTypedData(input: CommitPlanInput): PlanResult<PlanCommitTypedData> {
  const registration = registrationFor(input.artifact);
  if (!registration.ok) {
    return registration;
  }
  try {
    return {
      ok: true,
      value: buildPlanCommitTypedDataFor(
        { stateMachineAddress: input.stateMachineAddress, chainId: input.chainId },
        {
          publisher: input.publisher,
          deadline: input.deadline,
          registration: registration.value
        }
      )
    };
  } catch (error) {
    return fail("artifact_invalid", `commitPlan typed data 构造失败：${errorMessage(error)}`);
  }
}

export function buildCommitPlanCalls(
  input: CommitPlanInput & { readonly signature: Hex }
): PlanResult<{ readonly commit: PlanTransactionCall; readonly finalize: PlanTransactionCall }> {
  const registration = registrationFor(input.artifact);
  if (!registration.ok) {
    return registration;
  }
  try {
    const built = buildPlanRegistration(
      { stateMachineAddress: input.stateMachineAddress, chainId: input.chainId },
      {
        publisher: input.publisher,
        deadline: input.deadline,
        registration: registration.value,
        signature: input.signature
      }
    );
    return { ok: true, value: { commit: built.commitCall, finalize: built.finalizeCall } };
  } catch (error) {
    return fail("artifact_invalid", `commitPlan/finalizePlan calldata 构造失败：${errorMessage(error)}`);
  }
}

export function buildFinalizePlanCall(input: {
  readonly planId: Bytes32;
  readonly chainId: number;
  readonly stateMachineAddress: Address;
}): PlanResult<PlanTransactionCall> {
  try {
    return {
      ok: true,
      value: buildPlanFinalizeCall(
        { stateMachineAddress: input.stateMachineAddress, chainId: input.chainId },
        input.planId
      )
    };
  } catch (error) {
    return fail("artifact_invalid", `finalizePlan calldata 构造失败：${errorMessage(error)}`);
  }
}

export function buildOrderTriggerCall(input: OrderTriggerInput): PlanResult<SubmitStateMachineSignalCall> {
  const trigger = input.trigger;
  const attribution = attributionFor(
    input.artifact,
    ZERO_BYTES32,
    trigger.sourceId,
    trigger.signalId,
    input.payloadHash,
    input.idempotencyKey
  );
  try {
    return {
      ok: true,
      value: buildSubmitStateMachineSignalCall(
        {
          stateMachineAddress: input.stateMachineAddress,
          chainId: input.chainId,
          rpcUrl: input.rpcUrl
        },
        {
          planId: input.artifact.planId,
          sourceId: trigger.sourceId,
          signalId: trigger.signalId,
          payloadHash: input.payloadHash,
          idempotencyKey: input.idempotencyKey,
          ...(attribution.stageId === ZERO_BYTES32
            ? {}
            : {
                attribution: {
                  sourceId: attribution.sourceId,
                  signalId: attribution.signalId,
                  stageId: attribution.stageId,
                  capabilityProof: attribution.capabilityProof
                }
              })
        },
        input.submitter
      )
    };
  } catch (error) {
    return fail("trigger_invalid", `出生 trigger calldata 构造失败：${errorMessage(error)}`);
  }
}

function registrationFor(artifact: CompiledPlanArtifact): PlanResult<PlanRegistrationArgs> {
  try {
    return { ok: true, value: planRegistrationArgs(artifact.registerArgs, artifact.planId) };
  } catch (error) {
    return fail("artifact_invalid", `artifact.registerArgs 无法用于 commitPlan：${errorMessage(error)}`);
  }
}

export function signalAttributionFor(
  artifact: CompiledPlanArtifact,
  orderId: Bytes32,
  sourceId: Bytes32,
  signalId: Bytes32,
  payloadHash: Bytes32,
  idempotencyKey: Bytes32
): FactAttribution {
  return attributionFor(artifact, orderId, sourceId, signalId, payloadHash, idempotencyKey);
}

function attributionFor(
  artifact: CompiledPlanArtifact,
  orderId: Bytes32,
  sourceId: Bytes32,
  signalId: Bytes32,
  payloadHash: Bytes32,
  idempotencyKey: Bytes32
): FactAttribution {
  const fallback: FactAttribution = {
    sourceId,
    signalId,
    stageId: ZERO_BYTES32,
    capabilityProof: []
  };
  if (artifact.capabilities.length === 0 && artifact.selectorBindings.length === 0) {
    return fallback;
  }
  const signal = withCapabilityProofs(
    {
      planId: artifact.planId,
      orderId,
      sourceId,
      signalId,
      payloadHash,
      idempotencyKey
    },
    { selectorBindings: artifact.selectorBindings, signalCapabilities: artifact.capabilities }
  );
  const attribution = signal.attribution;
  if (attribution === undefined) {
    return fallback;
  }
  return {
    sourceId: attribution.sourceId as Bytes32,
    signalId: attribution.signalId as Bytes32,
    stageId: attribution.stageId as Bytes32,
    capabilityProof: attribution.capabilityProof as readonly Bytes32[]
  };
}

function declaredFacts(
  capabilities: readonly PlanCapability[],
  hooks: readonly PlanHook[]
): readonly DeclaredFact[] {
  const byKey = new Map<string, DeclaredFact>();
  const add = (fact: DeclaredFact): void => {
    const key = `${fact.sourceId.toLowerCase()}:${fact.signalId.toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, fact);
    }
  };
  for (const capability of capabilities) {
    add({
      sourceId: capability.targetSourceId,
      signalId: capability.signalId,
      source: capability.source,
      signalName: capability.signalName
    });
  }
  for (const hook of hooks) {
    for (const dependency of hook.dependencies) {
      add({
        sourceId: dependency.sourceId,
        signalId: dependency.signalId,
        source: dependency.source,
        signalName: dependency.signalName
      });
    }
  }
  return [...byKey.values()];
}

function readHooks(value: unknown): PlanResult<readonly PlanHook[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return fail("artifact_shape", "artifact.onchain.compiledHooks 必须是非空数组。");
  }
  const hooks: PlanHook[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return fail("artifact_invalid", `artifact.onchain.compiledHooks[${index}] 必须是对象。`);
    }
    const hookId = nonZeroBytes32(entry["hookId"], `compiledHooks[${index}].hookId`);
    if (!hookId.ok) {
      return hookId;
    }
    const stageId = nonZeroBytes32(entry["stageId"], `compiledHooks[${index}].stageId`);
    if (!stageId.ok) {
      return stageId;
    }
    const dependenciesRaw = entry["dependencies"];
    if (!Array.isArray(dependenciesRaw)) {
      return fail("artifact_invalid", `compiledHooks[${index}].dependencies 必须是数组。`);
    }
    const dependencies: PlanDependency[] = [];
    for (let depIndex = 0; depIndex < dependenciesRaw.length; depIndex += 1) {
      const dependency = dependenciesRaw[depIndex];
      if (!isRecord(dependency)) {
        return fail(
          "artifact_invalid",
          `compiledHooks[${index}].dependencies[${depIndex}] 必须是对象。`
        );
      }
      const kind = dependency["kind"];
      const source = dependency["source"];
      const signalName = dependency["signalName"];
      if (typeof kind !== "string" || typeof source !== "string" || typeof signalName !== "string") {
        return fail(
          "artifact_invalid",
          `compiledHooks[${index}].dependencies[${depIndex}] 缺 kind/source/signalName。`
        );
      }
      const sourceId = nonZeroBytes32(
        dependency["sourceId"],
        `compiledHooks[${index}].dependencies[${depIndex}].sourceId`
      );
      if (!sourceId.ok) {
        return sourceId;
      }
      const signalId = nonZeroBytes32(
        dependency["signalId"],
        `compiledHooks[${index}].dependencies[${depIndex}].signalId`
      );
      if (!signalId.ok) {
        return signalId;
      }
      dependencies.push({ kind, source, signalName, sourceId: sourceId.value, signalId: signalId.value });
    }
    const orderTriggerKind = entry["orderTriggerKind"];
    const kind = entry["kind"];
    hooks.push({
      hookId: hookId.value,
      stageId: stageId.value,
      orderTriggerKind: typeof orderTriggerKind === "string" ? orderTriggerKind : "",
      kind: typeof kind === "string" ? kind : "",
      dependencies
    });
  }
  return { ok: true, value: hooks };
}

function readTriggers(value: unknown): PlanResult<readonly PlanTrigger[]> {
  if (!Array.isArray(value)) {
    return fail("artifact_shape", "artifact.onchain.triggers 必须是数组（无出生入口时为 []）。");
  }
  const triggers: PlanTrigger[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return fail("artifact_invalid", `artifact.onchain.triggers[${index}] 必须是对象。`);
    }
    if (entry["orderTriggerKind"] !== "trigger") {
      return fail(
        "artifact_invalid",
        `artifact.onchain.triggers[${index}].orderTriggerKind 只能是 "trigger"（诊断值：${String(
          entry["orderTriggerKind"]
        )}）。`
      );
    }
    const hookId = nonZeroBytes32(entry["hookId"], `triggers[${index}].hookId`);
    if (!hookId.ok) {
      return hookId;
    }
    const stageId = nonZeroBytes32(entry["stageId"], `triggers[${index}].stageId`);
    if (!stageId.ok) {
      return stageId;
    }
    const sourceId = nonZeroBytes32(entry["sourceId"], `triggers[${index}].sourceId`);
    if (!sourceId.ok) {
      return sourceId;
    }
    const signalId = nonZeroBytes32(entry["signalId"], `triggers[${index}].signalId`);
    if (!signalId.ok) {
      return signalId;
    }
    const stageIdentifier = nonEmptyString(entry["stageIdentifier"], `triggers[${index}].stageIdentifier`);
    if (!stageIdentifier.ok) {
      return stageIdentifier;
    }
    const hookName = nonEmptyString(entry["hookName"], `triggers[${index}].hookName`);
    if (!hookName.ok) {
      return hookName;
    }
    const source = nonEmptyString(entry["source"], `triggers[${index}].source`);
    if (!source.ok) {
      return source;
    }
    const signalName = nonEmptyString(entry["signalName"], `triggers[${index}].signalName`);
    if (!signalName.ok) {
      return signalName;
    }
    triggers.push({
      hookId: hookId.value,
      stageIdentifier: stageIdentifier.value,
      stageId: stageId.value,
      hookName: hookName.value,
      source: source.value,
      signalName: signalName.value,
      sourceId: sourceId.value,
      signalId: signalId.value
    });
  }
  if (triggers.length === 0) {
    return fail(
      "artifact_missing_trigger",
      "artifact.onchain.triggers 里没有 orderTriggerKind=trigger 的出生入口。"
    );
  }
  return { ok: true, value: triggers };
}

function readCapabilities(value: unknown): PlanResult<readonly PlanCapability[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return fail("artifact_invalid", "artifact.onchain.signalCapabilities 必须是数组。");
  }
  const capabilities: PlanCapability[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return fail("artifact_invalid", `artifact.onchain.signalCapabilities[${index}] 必须是对象。`);
    }
    const stageId = nonZeroBytes32(entry["stageId"], `signalCapabilities[${index}].stageId`);
    if (!stageId.ok) {
      return stageId;
    }
    const targetSourceId = nonZeroBytes32(
      entry["targetSourceId"],
      `signalCapabilities[${index}].targetSourceId`
    );
    if (!targetSourceId.ok) {
      return targetSourceId;
    }
    const signalId = nonZeroBytes32(entry["signalId"], `signalCapabilities[${index}].signalId`);
    if (!signalId.ok) {
      return signalId;
    }
    if (entry["targetOrderRelation"] !== "current") {
      return fail(
        "artifact_invalid",
        `signalCapabilities[${index}].targetOrderRelation 只支持 "current"（诊断值：${String(
          entry["targetOrderRelation"]
        )}）。`
      );
    }
    const source = entry["targetSource"];
    const signalName = entry["targetSignalName"];
    if (typeof source !== "string" || typeof signalName !== "string") {
      return fail(
        "artifact_invalid",
        `signalCapabilities[${index}] 缺 targetSource/targetSignalName。`
      );
    }
    capabilities.push({
      stageId: stageId.value,
      targetSourceId: targetSourceId.value,
      signalId: signalId.value,
      relation: 0,
      source,
      signalName
    });
  }
  return { ok: true, value: capabilities };
}

function readSelectorBindings(
  value: unknown
): PlanResult<readonly { readonly selectorStageId: Bytes32; readonly targetStageId: Bytes32 }[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return fail("artifact_invalid", "artifact.onchain.selectorBindings 必须是数组。");
  }
  const bindings: { selectorStageId: Bytes32; targetStageId: Bytes32 }[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return fail("artifact_invalid", `artifact.onchain.selectorBindings[${index}] 必须是对象。`);
    }
    const selectorStageId = nonZeroBytes32(
      entry["selectorStageId"],
      `selectorBindings[${index}].selectorStageId`
    );
    if (!selectorStageId.ok) {
      return selectorStageId;
    }
    const targetStageId = nonZeroBytes32(entry["targetStageId"], `selectorBindings[${index}].targetStageId`);
    if (!targetStageId.ok) {
      return targetStageId;
    }
    bindings.push({ selectorStageId: selectorStageId.value, targetStageId: targetStageId.value });
  }
  return { ok: true, value: bindings };
}

function readSupplierBindings(value: unknown): PlanResult<readonly PlanSupplierBinding[]> {
  if (!Array.isArray(value)) {
    return fail("artifact_shape", "artifact.onchain.supplierBindings 必须是数组。");
  }
  const bindings: PlanSupplierBinding[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return fail("artifact_invalid", `artifact.onchain.supplierBindings[${index}] 必须是对象。`);
    }
    const stageId = nonZeroBytes32(entry["stageId"], `supplierBindings[${index}].stageId`);
    if (!stageId.ok) {
      return stageId;
    }
    const supplierID = nonEmptyString(entry["supplierID"], `supplierBindings[${index}].supplierID`);
    if (!supplierID.ok) {
      return supplierID;
    }
    const supplierId = nonZeroBytes32(entry["supplierId"], `supplierBindings[${index}].supplierId`);
    if (!supplierId.ok) {
      return supplierId;
    }
    const kind = entry["kind"];
    if (kind !== 0 && kind !== 1) {
      return fail(
        "artifact_invalid",
        `supplierBindings[${index}].kind 只能是 0（default）或 1（candidate）。`
      );
    }
    bindings.push({
      stageId: stageId.value,
      supplierID: supplierID.value,
      supplierId: supplierId.value,
      kind
    });
  }
  return { ok: true, value: bindings };
}

function nonZeroBytes32(value: unknown, field: string): PlanResult<Bytes32> {
  if (typeof value !== "string") {
    return fail("artifact_invalid", `${field} 必须是 0x + 64 hex。`);
  }
  const parsed = parseBytes32(value, field);
  if (!parsed.ok) {
    return fail("artifact_invalid", parsed.message);
  }
  if (parsed.value.toLowerCase() === ZERO_BYTES32) {
    return fail("artifact_invalid", `${field} 不能是零值。`);
  }
  return { ok: true, value: parsed.value };
}

function nonEmptyString(value: unknown, field: string): PlanResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail("artifact_invalid", `${field} 必须是非空字符串。`);
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(code: string, message: string): PlanFailure {
  return { ok: false, code, message };
}
