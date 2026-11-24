// order-app 链直连 demo B：连接钱包 → 解析手填编译 artifact（definition/onchain/
// registerArgs/planId）→ 钱包签 commitPlan + finalizePlan 注册计划 → 钱包直发
// submitSignal(orderId=0) 出生订单（合约生成 orderId，从回执事件读取）→ 读链上
// 事实/事件 → 发信号。没有 backend、会话 token、草稿或邀请；浏览器不编译 DSL
// （compiler 非浏览器安全）。读取失败与空事实分开：读取失败具名，空事件只表示
// 链上没有这些事实。

import { useMemo, useState, type ChangeEvent } from "react";
import type { Address } from "viem";
import {
  chainConfigProblemText,
  readChainConfig,
  type ChainConfig
} from "./chain/config";
import {
  connectWallet,
  createChainReader,
  sendWalletCall,
  signTypedDataWithWallet,
  submitCommitPlan,
  submitOrderTrigger,
  submitSignal,
  type ChainFailure,
  type OrderFacts,
  type WalletConnection
} from "./chain/client";
import type { ChainEvent, SignalSubmittedFact } from "./chain/events";
import { buildSignalCall, parseBytes32, randomBytes32, type Bytes32 } from "./chain/input";
import {
  buildCommitPlanCalls,
  buildCommitPlanTypedData,
  buildFinalizePlanCall,
  buildOrderTriggerCall,
  parseCompiledPlanArtifact,
  planRegistrationHashesOf,
  resolveRegistrationPlanId,
  signalAttributionFor,
  type CompiledPlanArtifact
} from "./chain/plan";
import {
  birthIdempotencyScope,
  clearPendingPlanFinalize,
  readBirthIdempotencyKey,
  readPendingPlanFinalize,
  writeBirthIdempotencyKey,
  writePendingPlanFinalize,
  type PendingPlanFinalize
} from "./app/localRecovery";

const ARTIFACT_SIZE_LIMIT = 5_000_000;
const CALL_DEADLINE_SECONDS = 3_600n;

type QueryState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly facts: OrderFacts }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type EventsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly events: readonly ChainEvent[] }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type SubmitState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "success"; readonly txHash: string }
  | { readonly kind: "unknown"; readonly txHash: string; readonly failure: ChainFailure }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type ArtifactState =
  | { readonly kind: "idle" }
  | { readonly kind: "ready"; readonly artifact: CompiledPlanArtifact }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type RegisterState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly step: string }
  | {
      readonly kind: "success";
      readonly commitTx?: string | undefined;
      readonly finalizeTx?: string | undefined;
      readonly planId: string;
    }
  | {
      readonly kind: "finalize_pending";
      readonly pending: PendingPlanFinalize;
      readonly failure?: ChainFailure | undefined;
    }
  | {
      readonly kind: "unknown";
      readonly txHash: string;
      readonly step: string;
      readonly failure: ChainFailure;
      readonly pending?: PendingPlanFinalize | undefined;
    }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type BirthState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly step: string }
  | { readonly kind: "success"; readonly txHash: string; readonly orderId: string }
  | { readonly kind: "duplicate"; readonly orderId: string }
  | { readonly kind: "unknown"; readonly txHash: string; readonly failure: ChainFailure }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

export default function App() {
  const configState = useMemo(() => readChainConfig(import.meta.env), []);
  if (!configState.ok) {
    return <ConfigProblem problem={chainConfigProblemText(configState.problem)} />;
  }
  return <ChainWorkbench config={configState.config} />;
}

function ChainWorkbench({ config }: { readonly config: ChainConfig }) {
  const reader = useMemo(() => createChainReader(config), [config]);
  const [wallet, setWallet] = useState<WalletConnection | undefined>(undefined);
  const [walletFailure, setWalletFailure] = useState<ChainFailure | undefined>(undefined);

  const [artifactText, setArtifactText] = useState("");
  const [artifactName, setArtifactName] = useState("");
  const [artifactState, setArtifactState] = useState<ArtifactState>({ kind: "idle" });
  const artifact = artifactState.kind === "ready" ? artifactState.artifact : undefined;

  const [planInput, setPlanInput] = useState("");
  const [orderInput, setOrderInput] = useState("");
  const [query, setQuery] = useState<QueryState>({ kind: "idle" });
  const [events, setEvents] = useState<EventsState>({ kind: "idle" });

  const [selectedTriggerHookId, setSelectedTriggerHookId] = useState("");
  const [birthPayloadHash, setBirthPayloadHash] = useState(() => safeRandomBytes32());
  const [birthKey, setBirthKey] = useState<{ readonly scope: string; readonly key: string }>(() => ({
    scope: "",
    key: safeRandomBytes32()
  }));
  const birthIdempotencyKey = birthKey.key;
  const [signalIdempotencyKey, setSignalIdempotencyKey] = useState(() => safeRandomBytes32());
  const [registerState, setRegisterState] = useState<RegisterState>({ kind: "idle" });
  const [birthState, setBirthState] = useState<BirthState>({ kind: "idle" });
  const [unknownBirthScopes, setUnknownBirthScopes] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingFinalize, setPendingFinalize] = useState<PendingPlanFinalize | undefined>(
    () => readPendingPlanFinalize()
  );

  const [sourceId, setSourceId] = useState("");
  const [signalId, setSignalId] = useState("");
  const [signalPayloadHash, setSignalPayloadHash] = useState("");
  const [attribution, setAttribution] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const selectedTrigger = artifact?.triggers.find((trigger) => trigger.hookId === selectedTriggerHookId);

  async function connect(): Promise<void> {
    setWalletFailure(undefined);
    const result = await connectWallet(config);
    if (!result.ok) {
      setWalletFailure(result.failure);
      return;
    }
    setWallet(result.value);
  }

  function rememberPendingFinalize(pending: PendingPlanFinalize): void {
    setPendingFinalize(pending);
    writePendingPlanFinalize(pending);
  }

  function forgetPendingFinalize(): void {
    setPendingFinalize(undefined);
    clearPendingPlanFinalize();
  }

  function currentBirthScope(): string | undefined {
    if (artifact === undefined) {
      return undefined;
    }
    return birthIdempotencyScope({
      chainId: config.chainId,
      stateMachine: config.stateMachine,
      planId: artifact.planId
    });
  }

  function updateBirthIdempotencyKey(value: string): void {
    const scope = currentBirthScope();
    setBirthKey({ scope: scope ?? "", key: value });
    const parsed = parseBytes32(value, "idempotencyKey");
    if (parsed.ok && scope !== undefined) {
      writeBirthIdempotencyKey(scope, parsed.value);
    }
  }

  function markBirthUnknown(scope: string | undefined): void {
    if (scope === undefined || scope === "") {
      return;
    }
    setUnknownBirthScopes((current) => new Set(current).add(scope));
  }

  function clearBirthUnknown(scope: string | undefined): void {
    if (scope === undefined || scope === "") {
      return;
    }
    setUnknownBirthScopes((current) => {
      if (!current.has(scope)) {
        return current;
      }
      const next = new Set(current);
      next.delete(scope);
      return next;
    });
  }

  function birthUnknownForScope(scope: string | undefined): boolean {
    return scope !== undefined && scope !== "" && unknownBirthScopes.has(scope);
  }

  function resetBirthIdempotencyKey(): void {
    if (birthState.kind === "unknown" || birthUnknownForScope(currentBirthScope())) {
      return;
    }
    const next = safeRandomBytes32();
    const scope = currentBirthScope() ?? "";
    setBirthPayloadHash(safeRandomBytes32());
    setBirthKey({ scope, key: next });
    const parsed = parseBytes32(next, "idempotencyKey");
    if (parsed.ok && scope !== "") {
      writeBirthIdempotencyKey(scope, parsed.value);
    }
  }

  function adoptBirthScope(planId: string, preserveCurrentKey = false): void {
    const scope = birthIdempotencyScope({
      chainId: config.chainId,
      stateMachine: config.stateMachine,
      planId
    });
    if (birthKey.scope === scope) {
      return;
    }
    const stored = readBirthIdempotencyKey(scope);
    const key = stored ?? (
      preserveCurrentKey || (birthKey.scope === "" && birthKey.key !== "")
        ? birthKey.key
        : safeRandomBytes32()
    );
    setBirthKey({ scope, key });
    const parsed = parseBytes32(key, "idempotencyKey");
    if (parsed.ok) {
      writeBirthIdempotencyKey(scope, parsed.value);
    }
  }

  function applyArtifact(text: string, label: string): void {
    const parsed = parseCompiledPlanArtifact(text);
    if (!parsed.ok) {
      setArtifactState({ kind: "failed", failure: { code: parsed.code, message: parsed.message } });
      return;
    }
    setArtifactState({ kind: "ready", artifact: parsed.value });
    setArtifactName(label);
    setSelectedTriggerHookId(parsed.value.triggers.length === 1 ? parsed.value.triggers[0]?.hookId ?? "" : "");
    setPlanInput(parsed.value.planId);
    setRegisterState({ kind: "idle" });
    setBirthState({ kind: "idle" });
    adoptBirthScope(parsed.value.planId);
  }

  async function loadArtifactFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    if (file.size > ARTIFACT_SIZE_LIMIT) {
      setArtifactState({
        kind: "failed",
        failure: {
          code: "artifact_too_large",
          message: `artifact 文件 ${String(file.size)} 字节超过上限 ${String(ARTIFACT_SIZE_LIMIT)} 字节。`
        }
      });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      setArtifactState({
        kind: "failed",
        failure: {
          code: "artifact_read_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      });
      return;
    }
    setArtifactText(text);
    applyArtifact(text, file.name);
  }

  type ArtifactIdentityResolution =
    | { readonly ok: true; readonly artifact: CompiledPlanArtifact; readonly planId: Bytes32 }
    | { readonly ok: false; readonly failure: ChainFailure };

  async function resolveArtifactIdentity(
    current: CompiledPlanArtifact,
    publisher: Address
  ): Promise<ArtifactIdentityResolution> {
    const hashes = planRegistrationHashesOf(current);
    if (!hashes.ok) {
      return { ok: false, failure: { code: hashes.code, message: hashes.message } };
    }
    const derived = await reader.derivePlanRegistration(publisher, hashes.value);
    if (!derived.ok) {
      return { ok: false, failure: derived.failure };
    }
    const resolved = resolveRegistrationPlanId({
      artifactPlanId: current.planId,
      sourcePlanId: current.sourcePlanId,
      ...(current.onchainPlanId === undefined ? {} : { onchainPlanId: current.onchainPlanId }),
      declaredRuntimePlanHash: hashes.value.planHash,
      derivedRuntimePlanHash: derived.value.runtimePlanHash,
      derivedRegistrationPlanId: derived.value.planId
    });
    if (!resolved.ok) {
      return { ok: false, failure: { code: resolved.code, message: resolved.message } };
    }
    return {
      ok: true,
      artifact: current.planId === resolved.value ? current : { ...current, planId: resolved.value },
      planId: resolved.value
    };
  }

  async function registerPlan(): Promise<void> {
    if (artifact === undefined) {
      setRegisterState({
        kind: "failed",
        failure: { code: "artifact_missing", message: "先解析 artifact 再注册计划。" }
      });
      return;
    }
    if (wallet === undefined) {
      setRegisterState({
        kind: "failed",
        failure: { code: "no_wallet", message: "先连接钱包再注册计划。" }
      });
      return;
    }
    setRegisterState({ kind: "pending", step: "校验 artifact plan 身份（链上派生 planId）" });
    const resolved = await resolveArtifactIdentity(artifact, wallet.address);
    if (!resolved.ok) {
      setRegisterState({ kind: "failed", failure: resolved.failure });
      return;
    }
    const resolvedArtifact = resolved.artifact;
    if (resolvedArtifact !== artifact) {
      setArtifactState({ kind: "ready", artifact: resolvedArtifact });
      setPlanInput(resolved.planId);
    }
    adoptBirthScope(resolved.planId, true);
    setRegisterState({ kind: "pending", step: "读取链上时间" });
    const timestamp = await reader.latestTimestamp();
    if (!timestamp.ok) {
      setRegisterState({ kind: "failed", failure: timestamp.failure });
      return;
    }
    const input = {
      artifact: resolvedArtifact,
      publisher: wallet.address,
      chainId: config.chainId,
      stateMachineAddress: config.stateMachine,
      deadline: timestamp.value + CALL_DEADLINE_SECONDS
    };
    const typedData = buildCommitPlanTypedData(input);
    if (!typedData.ok) {
      setRegisterState({ kind: "failed", failure: { code: typedData.code, message: typedData.message } });
      return;
    }
    setRegisterState({ kind: "pending", step: "等待钱包签名 commitPlan typed data" });
    const signature = await signTypedDataWithWallet(wallet, typedData.value);
    if (!signature.ok) {
      setRegisterState({ kind: "failed", failure: signature.failure });
      return;
    }
    const calls = buildCommitPlanCalls({ ...input, signature: signature.value });
    if (!calls.ok) {
      setRegisterState({ kind: "failed", failure: { code: calls.code, message: calls.message } });
      return;
    }
    setRegisterState({ kind: "pending", step: "发送 commitPlan" });
    const commit = await submitCommitPlan(config, wallet, calls.value.commit);
    if (!commit.ok) {
      if (commit.failure.outcomeUnknown === true && commit.failure.txHash !== undefined) {
        const pending: PendingPlanFinalize = {
          planId: resolved.planId,
          commitTx: commit.failure.txHash,
          publisher: wallet.address
        };
        rememberPendingFinalize(pending);
        setRegisterState({
          kind: "unknown",
          txHash: commit.failure.txHash,
          step: "commitPlan",
          failure: commit.failure,
          pending
        });
        return;
      }
      if (commit.failure.revert?.errorName === "PlanAlreadyRegistered") {
        const pending: PendingPlanFinalize = {
          planId: resolved.planId,
          publisher: wallet.address
        };
        rememberPendingFinalize(pending);
        await finalizeCommittedPlan(pending, resolved.planId);
        return;
      }
      setRegisterState({ kind: "failed", failure: commit.failure });
      return;
    }
    const pending: PendingPlanFinalize = {
      planId: commit.value.planId,
      commitTx: commit.value.txHash,
      publisher: wallet.address
    };
    rememberPendingFinalize(pending);
    await finalizeCommittedPlan(pending, resolved.planId);
  }

  async function finalizeCommittedPlan(
    initial: PendingPlanFinalize,
    expectedPlanId?: string
  ): Promise<void> {
    if (wallet === undefined) {
      setRegisterState({
        kind: "finalize_pending",
        pending: initial,
        failure: { code: "no_wallet", message: "先连接钱包再重试 finalizePlan。" }
      });
      return;
    }
    let pending = initial;
    setRegisterState({ kind: "pending", step: "检查已 commitPlan 的 planId 状态" });
    const status = await reader.readPlanStatus(pending.planId);
    if (!status.ok) {
      setRegisterState({ kind: "finalize_pending", pending, failure: status.failure });
      return;
    }
    if (status.value.finalized) {
      completeRegistration(pending, undefined, expectedPlanId);
      return;
    }
    if (!status.value.committed) {
      if (pending.commitTx === undefined) {
        setRegisterState({
          kind: "finalize_pending",
          pending,
          failure: {
            code: "commit_not_found",
            message:
              `链上 planHash(${pending.planId}) 为空：没有找到该 plan 的 commitPlan 事实，也没有可核实的 ` +
              "commitTx。先按原 txHash/区块浏览器确认 commitPlan 是否已上链，再恢复 finalize；不要重新签名 commitPlan。"
          }
        });
        return;
      }
      setRegisterState({ kind: "pending", step: `按 commitTx 回读 commitPlan 回执（${pending.commitTx}）` });
      const receipt = await reader.readCommitReceipt(pending.commitTx);
      if (!receipt.ok) {
        setRegisterState({ kind: "finalize_pending", pending, failure: receipt.failure });
        return;
      }
      if (receipt.value.status === "missing") {
        setRegisterState({
          kind: "finalize_pending",
          pending,
          failure: {
            code: "commit_not_confirmed",
            message:
              `commitTx ${pending.commitTx} 在 RPC 上还没有回执：commitPlan 结果仍未知。` +
              "稍后重试本恢复（不会重新签名或重新发送 commitPlan）；如长时间无回执，按 txHash 在链上核实。"
          }
        });
        return;
      }
      if (receipt.value.status === "reverted") {
        setRegisterState({
          kind: "finalize_pending",
          pending,
          failure: {
            code: "commit_reverted",
            message:
              `commitTx ${pending.commitTx} 已上链但回执是 reverted：该计划没有 commit 成功，` +
              "不能 finalize。重新注册前先确认失败原因。"
          }
        });
        return;
      }
      if (receipt.value.planId === undefined) {
        setRegisterState({
          kind: "finalize_pending",
          pending,
          failure: {
            code: "plan_id_missing",
            message: `commitTx ${pending.commitTx} 回执成功，但没有 PlanCommitted 事件：链上 planId 无法确认。`
          }
        });
        return;
      }
      pending = { ...pending, planId: receipt.value.planId };
      rememberPendingFinalize(pending);
    }
    const finalizeCall = buildFinalizePlanCall({
      planId: pending.planId,
      chainId: config.chainId,
      stateMachineAddress: config.stateMachine
    });
    if (!finalizeCall.ok) {
      setRegisterState({
        kind: "finalize_pending",
        pending,
        failure: { code: finalizeCall.code, message: finalizeCall.message }
      });
      return;
    }
    setRegisterState({ kind: "pending", step: "发送 finalizePlan（仅重试 finalize）" });
    const finalize = await sendWalletCall(config, wallet, finalizeCall.value, "finalizePlan");
    if (!finalize.ok) {
      if (finalize.failure.outcomeUnknown === true && finalize.failure.txHash !== undefined) {
        setRegisterState({
          kind: "unknown",
          txHash: finalize.failure.txHash,
          step: "finalizePlan",
          failure: finalize.failure,
          pending
        });
        return;
      }
      if (finalize.failure.revert?.errorName === "PlanAlreadyFinalized") {
        const recheck = await reader.readPlanExists(pending.planId);
        if (recheck.ok && recheck.value) {
          completeRegistration(pending, undefined, expectedPlanId);
          return;
        }
      }
      setRegisterState({ kind: "finalize_pending", pending, failure: finalize.failure });
      return;
    }
    setRegisterState({ kind: "pending", step: "校验 planExists(已 commit 的 planId)" });
    const verify = await reader.readPlanExists(pending.planId);
    if (!verify.ok) {
      setRegisterState({ kind: "finalize_pending", pending, failure: verify.failure });
      return;
    }
    if (!verify.value) {
      setRegisterState({
        kind: "finalize_pending",
        pending,
        failure: {
          code: "plan_not_finalized",
          message:
            "finalizePlan 回执成功，但 planExists(已 commit 的 planId) 仍为 false；" +
            "重试前先核对链上状态，不要重复发送 commitPlan。"
        }
      });
      return;
    }
    completeRegistration(pending, finalize.value.txHash, expectedPlanId);
  }

  function completeRegistration(
    pending: PendingPlanFinalize,
    finalizeTx?: string,
    expectedPlanId?: string
  ): void {
    forgetPendingFinalize();
    setPlanInput(pending.planId);
    if (
      expectedPlanId !== undefined &&
      expectedPlanId.toLowerCase() !== pending.planId.toLowerCase()
    ) {
      setRegisterState({
        kind: "failed",
        failure: {
          code: "plan_id_mismatch",
          message:
            `commitPlan 链上生成的 planId=${pending.planId} 与按当前 publisher（钱包）派生的注册 ` +
            `planId=${expectedPlanId} 不一致：不能用当前 artifact 继续出生或发信号；请改用匹配此钱包的 artifact。`
        }
      });
      return;
    }
    setRegisterState({
      kind: "success",
      planId: pending.planId,
      commitTx: pending.commitTx,
      ...(finalizeTx === undefined ? {} : { finalizeTx })
    });
  }

  async function resumeFinalize(): Promise<void> {
    if (pendingFinalize === undefined) {
      setRegisterState({
        kind: "failed",
        failure: { code: "pending_finalize_missing", message: "没有可恢复的 finalizePlan 记录。" }
      });
      return;
    }
    let expectedPlanId: string | undefined;
    if (artifact !== undefined && wallet !== undefined) {
      const resolved = await resolveArtifactIdentity(artifact, wallet.address);
      if (resolved.ok) {
        expectedPlanId = resolved.planId;
      }
    }
    await finalizeCommittedPlan(pendingFinalize, expectedPlanId);
  }

  async function createOrder(): Promise<void> {
    if (artifact === undefined) {
      setBirthState({
        kind: "failed",
        failure: { code: "artifact_missing", message: "先解析 artifact 再出生订单。" }
      });
      return;
    }
    if (wallet === undefined) {
      setBirthState({
        kind: "failed",
        failure: { code: "no_wallet", message: "先连接钱包再出生订单。" }
      });
      return;
    }
    setBirthState({ kind: "pending", step: "校验 artifact plan 身份（链上派生 planId）" });
    const resolved = await resolveArtifactIdentity(artifact, wallet.address);
    if (!resolved.ok) {
      setBirthState({ kind: "failed", failure: resolved.failure });
      return;
    }
    const resolvedArtifact = resolved.artifact;
    if (resolvedArtifact !== artifact) {
      setArtifactState({ kind: "ready", artifact: resolvedArtifact });
      setPlanInput(resolved.planId);
    }
    adoptBirthScope(resolved.planId, true);
    const birthScope = birthIdempotencyScope({
      chainId: config.chainId,
      stateMachine: config.stateMachine,
      planId: resolved.planId
    });
    if (selectedTrigger === undefined) {
      setBirthState({
        kind: "failed",
        failure: {
          code: "artifact_trigger_not_selected",
          message: `artifact 声明了 ${String(artifact.triggers.length)} 个出生 trigger，先按 stage/signal 选择本次出生入口。`
        }
      });
      return;
    }
    const payload = parseBytes32(birthPayloadHash, "payloadHash");
    if (!payload.ok) {
      setBirthState({
        kind: "failed",
        failure: { code: "birth_payload_hash", message: payload.message }
      });
      return;
    }
    const idempotency = parseBytes32(birthIdempotencyKey, "idempotencyKey");
    if (!idempotency.ok) {
      setBirthState({
        kind: "failed",
        failure: { code: "birth_idempotency_key", message: idempotency.message }
      });
      return;
    }
    setBirthState({ kind: "pending", step: "读取链上时间" });
    const timestamp = await reader.latestTimestamp();
    if (!timestamp.ok) {
      setBirthState({ kind: "failed", failure: timestamp.failure });
      return;
    }
    const call = buildOrderTriggerCall({
      artifact: resolvedArtifact,
      trigger: selectedTrigger,
      submitter: wallet.address,
      chainId: config.chainId,
      stateMachineAddress: config.stateMachine,
      rpcUrl: config.rpcUrl,
      payloadHash: payload.value,
      idempotencyKey: idempotency.value,
      deadline: timestamp.value + CALL_DEADLINE_SECONDS
    });
    if (!call.ok) {
      setBirthState({ kind: "failed", failure: { code: call.code, message: call.message } });
      return;
    }
    setBirthState({ kind: "pending", step: "钱包发送 submitSignal（orderId=0）" });
    const sent = await submitOrderTrigger(config, wallet, call.value);
    if (!sent.ok) {
      const duplicateOrderId = duplicateTriggerOrderId(sent.failure);
      if (duplicateOrderId !== undefined) {
        clearBirthUnknown(birthScope);
        setBirthState({ kind: "duplicate", orderId: duplicateOrderId });
        setPlanInput(resolvedArtifact.planId);
        setOrderInput(duplicateOrderId);
        await load(resolvedArtifact.planId, duplicateOrderId);
        return;
      }
      if (sent.failure.outcomeUnknown === true && sent.failure.txHash !== undefined) {
        markBirthUnknown(birthScope);
        setBirthState({ kind: "unknown", txHash: sent.failure.txHash, failure: sent.failure });
        return;
      }
      clearBirthUnknown(birthScope);
      setBirthState({ kind: "failed", failure: sent.failure });
      return;
    }
    const orderId = sent.value.orderId;
    clearBirthUnknown(birthScope);
    setBirthState({ kind: "success", txHash: sent.value.txHash, orderId });
    setPlanInput(resolvedArtifact.planId);
    setOrderInput(orderId);
    await load(resolvedArtifact.planId, orderId);
  }

  async function load(planArg?: string, orderArg?: string): Promise<void> {
    const planRaw = planArg ?? planInput;
    const orderRaw = orderArg ?? orderInput;
    const planId = parseBytes32(planRaw, "planId");
    if (!planId.ok) {
      setQuery({ kind: "failed", failure: { code: "invalid_input", message: planId.message } });
      setEvents({ kind: "failed", failure: { code: "invalid_input", message: planId.message } });
      return;
    }
    const orderId = parseBytes32(orderRaw, "orderId");
    if (!orderId.ok) {
      setQuery({ kind: "failed", failure: { code: "invalid_input", message: orderId.message } });
      setEvents({ kind: "failed", failure: { code: "invalid_input", message: orderId.message } });
      return;
    }
    setQuery({ kind: "loading" });
    setEvents({ kind: "loading" });
    const [facts, chainEvents] = await Promise.all([
      reader.readOrder(planId.value, orderId.value),
      reader.readEvents(planId.value, orderId.value)
    ]);
    setQuery(facts.ok ? { kind: "ready", facts: facts.value } : { kind: "failed", failure: facts.failure });
    setEvents(
      chainEvents.ok
        ? { kind: "ready", events: chainEvents.value }
        : { kind: "failed", failure: chainEvents.failure }
    );
  }

  function autoSignalAttribution(): string {
    if (artifact === undefined || planInput.trim().toLowerCase() !== artifact.planId.toLowerCase()) {
      return "";
    }
    const source = parseBytes32(sourceId, "sourceId");
    const signal = parseBytes32(signalId, "signalId");
    const payload = parseBytes32(signalPayloadHash, "payloadHash");
    const order = parseBytes32(orderInput, "orderId");
    const key = parseBytes32(signalIdempotencyKey, "idempotencyKey");
    if (!source.ok || !signal.ok || !payload.ok || !order.ok || !key.ok) {
      return "";
    }
    const derived = signalAttributionFor(
      artifact,
      order.value,
      source.value,
      signal.value,
      payload.value,
      key.value
    );
    return JSON.stringify({ stageId: derived.stageId, proof: derived.capabilityProof });
  }

  async function send(): Promise<void> {
    if (wallet === undefined) {
      setSubmit({ kind: "failed", failure: { code: "no_wallet", message: "先连接钱包再发送信号。" } });
      return;
    }
    const built = buildSignalCall(
      {
        stateMachine: config.stateMachine,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        submitter: wallet.address
      },
      {
        planId: planInput,
        orderId: orderInput,
        sourceId,
        signalId,
        payloadHash: signalPayloadHash,
        idempotencyKey: signalIdempotencyKey,
        attributionRaw: attribution.trim() === "" ? autoSignalAttribution() : attribution
      }
    );
    if (!built.ok) {
      setSubmit({ kind: "failed", failure: { code: "invalid_input", message: built.message } });
      return;
    }
    setSubmit({ kind: "pending" });
    const result = await submitSignal(config, wallet, built.value);
    if (!result.ok) {
      if (result.failure.outcomeUnknown === true && result.failure.txHash !== undefined) {
        setSubmit({ kind: "unknown", txHash: result.failure.txHash, failure: result.failure });
        return;
      }
      setSubmit({ kind: "failed", failure: result.failure });
      return;
    }
    setSubmit({ kind: "success", txHash: result.value.txHash });
    setSignalIdempotencyKey(safeRandomBytes32());
    await load();
  }

  const signals = events.kind === "ready" ? events.events.filter(isSignal) : [];
  const otherEvents = events.kind === "ready" ? events.events.filter((event) => !isSignal(event)) : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div>
            <p>UVP Order App</p>
            <h1>链上直连 demo B</h1>
          </div>
        </div>
        <div className="topbar-actions">
          {wallet === undefined ? (
            <button className="primary-button" type="button" onClick={() => void connect()}>
              连接钱包
            </button>
          ) : (
            <span className="source-badge source-real" title={wallet.address}>
              钱包 {short(wallet.address)}
            </span>
          )}
        </div>
      </header>

      <SystemBanner
        tone="info"
        title="artifact → commitPlan → 出生，钱包直发"
        text="浏览器不编译 DSL；artifact 由 used-car 编译器/发布脚本产出后手填。注册由当前钱包签 commitPlan/finalizePlan，出生由当前钱包直发 submitSignal，没有 backend、会话、草稿或邀请。"
      />

      {walletFailure === undefined ? null : (
        <SystemBanner tone="warn" title="钱包连接失败" text={`${walletFailure.code}：${walletFailure.message}`} />
      )}

      <section className="panel">
        <h2>1 · 计划 artifact（手填编译产物）</h2>
        <p className="fineprint">
          粘贴 used-car 编译器 bundle{` {definition, onchain, registerArgs, planId}`}，或从 JSON
          文件载入。浏览器只解析 bundle 与选择出生 trigger；commitPlan/finalizePlan 与出生
          trigger 的 submitSignal calldata 全部由 @uvp-eth/uvp-client/core 构造。
        </p>
        <label>
          artifact JSON
          <textarea
            value={artifactText}
            onChange={(event) => {
              setArtifactText(event.target.value);
              setArtifactState({ kind: "idle" });
              setSelectedTriggerHookId("");
              setRegisterState({ kind: "idle" });
              setBirthState({ kind: "idle" });
            }}
            rows={10}
            spellCheck={false}
            placeholder='{"definition":{…},"onchain":{…},"registerArgs":{…},"planId":"0x…"}'
          />
        </label>
        <label>
          从文件载入 JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void loadArtifactFile(event)}
          />
        </label>
        {artifactName === "" ? null : <p className="fineprint">已载入：{artifactName}</p>}
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={artifactText.trim() === ""}
            onClick={() => applyArtifact(artifactText, "粘贴内容")}
          >
            解析 artifact
          </button>
        </div>
        {artifactState.kind === "failed" ? (
          <FailureBlock title="artifact 解析失败" failure={artifactState.failure} />
        ) : null}
        {artifact === undefined ? null : <ArtifactFacts artifact={artifact} />}
      </section>

      <section className="panel">
        <h2>2 · 注册计划（commitPlan → finalizePlan）</h2>
        <p className="fineprint">
          签名人 = publisher = 当前钱包；deadline = 链上时间 + 1 小时。
          commitPlan 写入 hooks、roots 与 fileWritersHash（PlanCommit 6 字段），finalizePlan 后计划才可出生。
          注册成功后链上 planId 必须等于 artifact.planId，否则说明 artifact 不是按当前钱包发布的。
        </p>
        <dl className="facts">
          <div>
            <dt>publisher</dt>
            <dd>{wallet?.address ?? "未连接钱包"}</dd>
          </div>
          <div>
            <dt>planId</dt>
            <dd>{artifact?.planId ?? "未解析 artifact"}</dd>
          </div>
          <div>
            <dt>hooksHash</dt>
            <dd>{artifact === undefined ? "—" : short(artifact.registerArgs.hooksHash)}</dd>
          </div>
          <div>
            <dt>capabilitiesRoot</dt>
            <dd>{artifact === undefined ? "—" : short(artifact.registerArgs.capabilitiesRoot)}</dd>
          </div>
          <div>
            <dt>supplierBindingsRoot</dt>
            <dd>{artifact === undefined ? "—" : short(artifact.registerArgs.supplierBindingsRoot)}</dd>
          </div>
          <div>
            <dt>fileWritersHash</dt>
            <dd>{artifact === undefined ? "—" : short(artifact.registerArgs.fileWritersHash)}</dd>
          </div>
          <div>
            <dt>deadline</dt>
            <dd>链上时间 + 1 小时</dd>
          </div>
        </dl>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={
              registerState.kind === "pending" ||
              pendingFinalize !== undefined ||
              artifact === undefined ||
              wallet === undefined
            }
            onClick={() => void registerPlan()}
          >
            {registerState.kind === "pending" ? registerState.step : "钱包签名并注册计划"}
          </button>
        </div>
        {registerState.kind === "success" ? (
          <p className="status-ok">
            已注册：commitPlan {registerState.commitTx ?? "未知（PlanAlreadyRegistered 恢复）"} · finalizePlan{" "}
            {registerState.finalizeTx ?? "（此前已确认）"} · planId {registerState.planId} · planExists=true
          </p>
        ) : null}
        {registerState.kind === "finalize_pending" ? (
          <section className="system-banner system-banner-warn" role="status">
            <strong>commitPlan 已上链，finalizePlan 尚未完成</strong>
            <span>
              只需重试 finalizePlan，不会重新发送 commitPlan。planId {registerState.pending.planId} · publisher{" "}
              {registerState.pending.publisher} · commitTx{" "}
              {registerState.pending.commitTx ?? "未知（PlanAlreadyRegistered 恢复，按 planId 查链上状态）"}
            </span>
            {registerState.failure === undefined ? null : (
              <span>
                {registerState.failure.code}：{registerState.failure.message}
              </span>
            )}
            <div className="submit-actions">
              <button
                className="primary-button"
                type="button"
                disabled={wallet === undefined}
                onClick={() => void finalizeCommittedPlan(registerState.pending)}
              >
                按记录恢复（查回执 / 仅重试 finalizePlan）
              </button>
              <button type="button" onClick={forgetPendingFinalize}>
                忽略恢复记录
              </button>
            </div>
          </section>
        ) : null}
        {registerState.kind === "unknown" ? (
          <UnknownBlock
            title={`${registerState.step} 结果未知（UNKNOWN）`}
            failure={registerState.failure}
          />
        ) : null}
        {registerState.kind === "failed" ? (
          <FailureBlock title="注册计划失败" failure={registerState.failure} />
        ) : null}
        {pendingFinalize !== undefined &&
        registerState.kind !== "pending" &&
        registerState.kind !== "finalize_pending" ? (
          <section className="system-banner system-banner-warn" role="status">
            <strong>发现待恢复的 commitPlan 记录</strong>
            <span>
              planId {pendingFinalize.planId} · publisher {pendingFinalize.publisher} · commitTx{" "}
              {pendingFinalize.commitTx ?? "未知"}
              （记录来自 commitPlan 结果未知或 finalizePlan 未确认的运行；恢复只查回执/只发 finalizePlan）。
            </span>
            <div className="submit-actions">
              <button
                className="primary-button"
                type="button"
                disabled={wallet === undefined}
                onClick={() => void resumeFinalize()}
              >
                按记录恢复（查回执 / 仅重试 finalizePlan）
              </button>
              <button type="button" onClick={forgetPendingFinalize}>
                忽略恢复记录
              </button>
            </div>
          </section>
        ) : null}
      </section>

      <section className="panel">
        <h2>3 · 出生订单（submitSignal，orderId=0）</h2>
        <p className="fineprint">
          出生提交人（submitter）= 出生 trigger 阶段的 assigned supplier account，即当前钱包直发
          （空签名，submitter = msg.sender）；orderId 由合约随机生成，从回执的 SignalSubmitted
          事件读取。计划可声明多个出生 trigger，本次入口按 stage/signal 显式选择。
          同一 submitter + idempotencyKey 重复提交会被链上 DuplicateTriggerKey 拒绝；app 会解码该错误并显示
          链上已有订单的 orderId，而不是把重试当失败或换键重复出生。
          payloadHash/idempotencyKey 是本次出生的承诺，缺省随机；idempotencyKey 会跨重试、失败与刷新保留。
        </p>
        <label>
          出生 trigger（stage / signal）
          <select
            value={selectedTriggerHookId}
            onChange={(event) => setSelectedTriggerHookId(event.target.value)}
            disabled={artifact === undefined || artifact.triggers.length === 1}
          >
            <option value="" disabled>
              {artifact === undefined ? "先解析 artifact" : "选择出生 trigger"}
            </option>
            {(artifact?.triggers ?? []).map((trigger) => (
              <option key={trigger.hookId} value={trigger.hookId}>
                {trigger.stageIdentifier} / {trigger.signalName}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-2">
          <label>
            payloadHash
            <input
              value={birthPayloadHash}
              onChange={(event) => setBirthPayloadHash(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
          <label>
            idempotencyKey
            <input
              value={birthIdempotencyKey}
              onChange={(event) => updateBirthIdempotencyKey(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
        </div>
        <dl className="facts">
          <div>
            <dt>出生提交人 / submitter</dt>
            <dd>
              {wallet?.address ?? "未连接钱包"}（trigger 阶段 assigned supplier account，直发空签名）
            </dd>
          </div>
          <div>
            <dt>planId</dt>
            <dd>{artifact?.planId ?? "未解析 artifact"}</dd>
          </div>
          <div>
            <dt>已选 trigger hook / stage</dt>
            <dd>
              {selectedTrigger === undefined
                ? artifact === undefined
                  ? "—"
                  : "未选择"
                : `${short(selectedTrigger.hookId)} / ${short(selectedTrigger.stageId)}`}
            </dd>
          </div>
          <div>
            <dt>出生 source / signal</dt>
            <dd>
              {selectedTrigger === undefined
                ? "—"
                : `${selectedTrigger.source} / ${selectedTrigger.signalName}`}
            </dd>
          </div>
          <div>
            <dt>stageIdentifier / hookName</dt>
            <dd>
              {selectedTrigger === undefined
                ? "—"
                : `${selectedTrigger.stageIdentifier} / ${selectedTrigger.hookName}`}
            </dd>
          </div>
          <div>
            <dt>sourceId / signalId</dt>
            <dd>
              {selectedTrigger === undefined
                ? "—"
                : `${short(selectedTrigger.sourceId)} / ${short(selectedTrigger.signalId)}`}
            </dd>
          </div>
          <div>
            <dt>出生 trigger / 声明事实键</dt>
            <dd>
              {artifact === undefined
                ? "—"
                : `${String(artifact.triggers.length)} 个 trigger / ${String(artifact.facts.length)} 个事实键`}
            </dd>
          </div>
        </dl>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={birthState.kind === "pending" || artifact === undefined || wallet === undefined}
            onClick={() => void createOrder()}
          >
            {birthState.kind === "pending" ? birthState.step : "钱包发送出生 trigger（submitSignal）"}
          </button>
          <button
            type="button"
            disabled={
              birthState.kind === "pending" ||
              birthState.kind === "unknown" ||
              birthUnknownForScope(currentBirthScope())
            }
            onClick={resetBirthIdempotencyKey}
          >
            换新出生承诺（payloadHash + idempotencyKey）
          </button>
        </div>
        {birthState.kind === "success" ? (
          <p className="status-ok">
            已出生：orderId {birthState.orderId} · tx {birthState.txHash}（已自动读取事实）。
            当前 idempotencyKey 已保留：再次点击会由链上 DuplicateTriggerKey 返回同一订单，不会重复出生；
            要创建新订单先换新 key。
          </p>
        ) : null}
        {birthState.kind === "duplicate" ? (
          <p className="status-ok">
            链上已有该 (submitter, idempotencyKey) 的订单：orderId {birthState.orderId}。
            本次没有创建新订单，已自动读取该订单事实。
          </p>
        ) : null}
        {birthState.kind === "unknown" ? (
          <p className="hint" role="status">
            出生结果未知：idempotencyKey 已锁定，不能在此状态下换新承诺。先按 txHash 核实；重试同一 key 不会重复建单
            （链上 DuplicateTriggerKey 会返回原订单）。
          </p>
        ) : null}
        {birthState.kind !== "unknown" && birthUnknownForScope(currentBirthScope()) ? (
          <p className="hint" role="status">
            该计划在本会话里还有一次出生结果未知：idempotencyKey 已锁定，不能换新承诺。
            先按上次 txHash 核实；重试同一 key 撞 DuplicateTriggerKey 会返回原订单。
          </p>
        ) : null}
        {birthState.kind === "unknown" ? (
          <UnknownBlock title="出生结果未知（UNKNOWN）" failure={birthState.failure} />
        ) : null}
        {birthState.kind === "failed" ? (
          <FailureBlock title="出生失败" failure={birthState.failure} />
        ) : null}
      </section>

      <section className="panel">
        <h2>4 · 订单事实</h2>
        <div className="grid-2">
          <label>
            planId
            <input
              value={planInput}
              onChange={(event) => setPlanInput(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
          <label>
            orderId
            <input
              value={orderInput}
              onChange={(event) => setOrderInput(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={query.kind === "loading"}
            onClick={() => void load()}
          >
            {query.kind === "loading" ? "读取中…" : "读取链上事实"}
          </button>
        </div>

        {query.kind === "failed" ? (
          <FailureBlock title="订单事实读取失败" failure={query.failure} />
        ) : null}
        {query.kind === "ready" ? (
          <dl className="facts">
            <div>
              <dt>planExists</dt>
              <dd>{String(query.facts.planExists)}</dd>
            </div>
            <div>
              <dt>orderExists</dt>
              <dd>{String(query.facts.orderExists)}</dd>
            </div>
            {query.facts.orderExists ? (
              <div>
                <dt>relayer</dt>
                <dd>{query.facts.relayer ?? "未返回"}</dd>
              </div>
            ) : (
              <div>
                <dt>说明</dt>
                <dd>链上没有这个订单（不是读取失败）。</dd>
              </div>
            )}
          </dl>
        ) : null}
      </section>

      <section className="panel">
        <h2>5 · 链上事实事件</h2>
        <p className="fineprint">
          SignalSubmitted 事件不含 fee/金额字段；这里的字段全部来自链上事件，不补造配置或阶段名。
        </p>
        {events.kind === "idle" ? (
          <p className="fineprint">尚未读取事件：填写 planId/orderId 后点击“读取链上事实”。</p>
        ) : null}
        {events.kind === "loading" ? <p className="fineprint">正在读取事件…</p> : null}
        {events.kind === "failed" ? (
          <FailureBlock title="事件读取失败" failure={events.failure} />
        ) : null}
        {events.kind === "ready" && events.events.length === 0 ? (
          <p className="fineprint">
            读取成功：当前扫描窗口（fromBlock {String(config.fromBlock)} → latest）内没有匹配的事实事件。
            这不代表链上从未发生过；窗口起点由 VITE_UVP_FROM_BLOCK 控制，调低后可重试。
          </p>
        ) : null}
        {signals.length > 0 ? (
          <ul className="event-list">
            {signals.map((event) => (
              <li key={`${event.transactionHash}-${event.logIndex}`} className="event-card">
                <EventHead event={event} />
                <SignalFields event={event} />
              </li>
            ))}
          </ul>
        ) : null}
        {otherEvents.length > 0 ? (
          <ul className="event-list">
            {otherEvents.map((event) => (
              <li key={`${event.transactionHash}-${event.logIndex}`} className="event-card">
                <EventHead event={event} />
                <OtherFields event={event} />
              </li>
            ))}
          </ul>
        ) : events.kind === "ready" && events.events.length > 0 ? (
          <p className="fineprint">
            本次窗口只匹配到 SignalSubmitted，没有 HookReady / StageMaterialized / StageSupplierAssigned /
            StageSupplierPatchApplied 事件。
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>6 · 发信号（submitSignal）</h2>
        <p className="fineprint">
          钱包直接调用 UVPStateMachine.submitSignal（空签名直发，submitter = msg.sender）；不经
          relay/backend。提交信封携带 filesHash（无文件时为 0，由 uvp-client 按 files
          计算），本 app 不复制参数编码。链上按本次 source 阶段解析 assigned supplier
          （stage → supplierId → supplier account），要求提交人是该 SID 当前绑定的 supplier account
          且 SID active；未指派/未激活/非该 account 分别回滚 StageSupplierNotAssigned /
          SupplierNotActive / UnauthorizedStageSupplierAccount。
          attribution 可选 JSON：{` { "stageId": "0x…", "proof": ["0x…"] }`}
          （proof 语义不解析；留空且 planId 等于已解析 artifact 时按 artifact 能力表自动补 proof）。
        </p>
        <div className="grid-2">
          <label>
            sourceId
            <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            signalId
            <input value={signalId} onChange={(event) => setSignalId(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            payloadHash
            <input value={signalPayloadHash} onChange={(event) => setSignalPayloadHash(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            idempotencyKey
            <input value={signalIdempotencyKey} onChange={(event) => setSignalIdempotencyKey(event.target.value)} placeholder="0x + 64 hex（默认随机）" spellCheck={false} />
          </label>
        </div>
        <label>
          attribution（可选 JSON）
          <textarea
            value={attribution}
            onChange={(event) => setAttribution(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={`{ "stageId": "0x…", "proof": [] }`}
          />
        </label>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={submit.kind === "pending"}
            onClick={() => void send()}
          >
            {submit.kind === "pending" ? "等待钱包/回执…" : "发送信号"}
          </button>
        </div>
        {submit.kind === "success" ? (
          <p className="status-ok">已上链：{submit.txHash}</p>
        ) : null}
        {submit.kind === "unknown" ? (
          <UnknownBlock title="发送结果未知（UNKNOWN）" failure={submit.failure} />
        ) : null}
        {submit.kind === "failed" ? <FailureBlock title="发送失败" failure={submit.failure} /> : null}
      </section>
    </main>
  );
}

function ArtifactFacts({ artifact }: { readonly artifact: CompiledPlanArtifact }) {
  return (
    <dl className="facts">
      <div>
        <dt>planId</dt>
        <dd>{artifact.planId}</dd>
      </div>
      <div>
        <dt>zhixu</dt>
        <dd>{artifact.zhixuId ?? artifact.zhixuName ?? "未标注"}</dd>
      </div>
      <div>
        <dt>hooks / 声明事实</dt>
        <dd>
          {String(artifact.hookCount)} / {String(artifact.facts.length)}
        </dd>
      </div>
      <div>
        <dt>supplier 绑定</dt>
        <dd>{String(artifact.supplierBindings.length)} 条（default/candidate）</dd>
      </div>
      <div>
        <dt>出生 trigger</dt>
        <dd>{String(artifact.triggers.length)} 个（按 stage/signal 选择）</dd>
      </div>
      {artifact.triggers.map((trigger) => (
        <div key={trigger.hookId}>
          <dt>{trigger.stageIdentifier} / {trigger.signalName}</dt>
          <dd>
            hook {short(trigger.hookId)} · stage {short(trigger.stageId)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SignalFields({ event }: { readonly event: SignalSubmittedFact }) {
  return (
    <dl className="facts">
      <div>
        <dt>sourceId / signalId</dt>
        <dd>
          {short(event.sourceId)} / {short(event.signalId)}
        </dd>
      </div>
      <div>
        <dt>submitter</dt>
        <dd>{event.submitter}</dd>
      </div>
      <div>
        <dt>relayer</dt>
        <dd>{event.relayer}</dd>
      </div>
      <div>
        <dt>payloadHash</dt>
        <dd>{event.payloadHash}</dd>
      </div>
      <div>
        <dt>idempotencyKey</dt>
        <dd>{event.idempotencyKey}</dd>
      </div>
      <div>
        <dt>factStageId</dt>
        <dd>{event.factStageId}</dd>
      </div>
    </dl>
  );
}

function OtherFields({ event }: { readonly event: ChainEvent }) {
  switch (event.kind) {
    case "hook_ready":
      return (
        <dl className="facts">
          <div><dt>hookId</dt><dd>{event.hookId}</dd></div>
          <div><dt>stageId</dt><dd>{event.stageId}</dd></div>
          <div><dt>hookName</dt><dd>{event.hookName}</dd></div>
        </dl>
      );
    case "stage_materialized":
      return (
        <dl className="facts">
          <div><dt>stageId</dt><dd>{event.stageId}</dd></div>
          <div><dt>triggerHookId</dt><dd>{event.triggerHookId}</dd></div>
          <div><dt>source / signal</dt><dd>{short(event.sourceId)} / {short(event.signalId)}</dd></div>
        </dl>
      );
    case "stage_supplier_assigned":
      return (
        <dl className="facts">
          <div><dt>stageId</dt><dd>{event.targetStageId}</dd></div>
          <div><dt>supplierId</dt><dd>{event.supplierId}</dd></div>
          <div><dt>patchNonce</dt><dd>{String(event.patchNonce)}</dd></div>
        </dl>
      );
    case "stage_supplier_patch_applied":
      return (
        <dl className="facts">
          <div><dt>selector / target stage</dt><dd>{short(event.selectorStageId)} / {short(event.targetStageId)}</dd></div>
          <div><dt>selector</dt><dd>{event.selector}</dd></div>
          <div><dt>supplier / previousSupplier</dt><dd>{short(event.supplierId)} / {short(event.previousSupplierId)}</dd></div>
          <div><dt>patchNonce</dt><dd>{String(event.patchNonce)}</dd></div>
        </dl>
      );
    case "signal_submitted":
      return <SignalFields event={event} />;
    default:
      return null;
  }
}

function EventHead({ event }: { readonly event: ChainEvent }) {
  const timestamp =
    event.timestamp === undefined ? "时间未知" : new Date(Number(event.timestamp) * 1000).toLocaleString();
  return (
    <div className="event-head">
      <strong>{event.kind}</strong>
      <span className="fineprint">
        block {String(event.blockNumber)} · {timestamp} · tx {short(event.transactionHash)}
      </span>
    </div>
  );
}

function FailureBlock({ title, failure }: { readonly title: string; readonly failure: ChainFailure }) {
  return (
    <section className="system-banner system-banner-error" role="alert">
      <strong>{title}（{failure.code}）</strong>
      <span>{failure.message}</span>
      {failure.txHash === undefined ? null : <span className="fineprint">txHash：{failure.txHash}</span>}
    </section>
  );
}

function UnknownBlock({ title, failure }: { readonly title: string; readonly failure: ChainFailure }) {
  return (
    <section className="system-banner system-banner-warn" role="status">
      <strong>{title}</strong>
      <span>{failure.message}</span>
      {failure.txHash === undefined ? null : <span className="fineprint">txHash：{failure.txHash}</span>}
      <span className="fineprint">
        交易已经交给钱包/节点，但没有拿到确认回执；不要按“发送失败”重试。请先在链上按 txHash 核实，
        确认未上链后再重试（出生/发信号会复用当前 idempotencyKey）。
      </span>
    </section>
  );
}

function duplicateTriggerOrderId(failure: ChainFailure): string | undefined {
  if (failure.revert?.errorName !== "DuplicateTriggerKey") {
    return undefined;
  }
  const raw = failure.revert.args?.[2];
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = parseBytes32(raw, "existingOrderId");
  return parsed.ok ? parsed.value : undefined;
}

function SystemBanner({ tone, title, text }: { readonly tone: "info" | "warn" | "error"; readonly title: string; readonly text: string }) {
  return (
    <section className={`system-banner system-banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <span>{text}</span>
    </section>
  );
}

function ConfigProblem({ problem }: { readonly problem: string }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div>
            <p>UVP Order App</p>
            <h1>链上直连 demo B</h1>
          </div>
        </div>
        <span className="source-badge source-missing">未配置</span>
      </header>
      <SystemBanner tone="warn" title="链配置缺失/不合法" text={problem} />
      <section className="panel">
        <p className="fineprint">
          需要 VITE_UVP_STATE_MACHINE、VITE_CHAIN_ID、VITE_RPC_URL；可选 VITE_UVP_FROM_BLOCK（默认 0）。
        </p>
      </section>
    </main>
  );
}

function isSignal(event: ChainEvent): event is SignalSubmittedFact {
  return event.kind === "signal_submitted";
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function safeRandomBytes32(): string {
  try {
    return randomBytes32();
  } catch {
    return "";
  }
}
