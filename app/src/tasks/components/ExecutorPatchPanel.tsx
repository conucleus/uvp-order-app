import { CheckCircle2, Layers, ListChecks, RefreshCw, Send, WalletCards } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  ProductExecutorPatchMode,
  ProductOrderDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import type {
  PreparedStageExecutorPatchDTO,
  ProductApiSource,
  StageExecutorPatchSubmissionDTO
} from "../../api/productApi";
import type { OrderAppActions } from "../../actions/orderAppActions";
import type { TaskSubmissionProof } from "../../task-model";
import { shortWallet } from "../../auth/participant";
import {
  executorPatchModeGuidance,
  executorPatchModeLabel,
  executorPatchModeOptionsForTarget,
  executorPatchWorkStarted,
  targetStageId as selectableTargetStageId,
  targetStageLabel,
  type ExecutorPatchModeOptionDTO,
  type SelectableTargetStageDTO
} from "../model/addOnTypes";
import { useTaskScopeGuard } from "../model/taskScope";
import { cleanString, isContentAddressedReference, looksLikeHash, sameAddress, stagePatchSignExpectation } from "../model/taskUtils";
import { isTerminalSubmissionEnvelope, submissionFailureText } from "../submission/submissionEnvelope";
import type { PatchPhase } from "../submission/types";
import { ProofRow } from "./ProofRow";
import { createInflightGuard } from "../../shared/chain/submission/inflight";

interface ExecutorPatchDraftState {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly mode: ProductExecutorPatchMode;
  readonly previousExecutor: string;
  readonly executorWallet: string;
  readonly executorMetadataHash: string;
  readonly executorReference: string;
  readonly approvalSourceId: string;
  readonly approvalSignalId: string;
  readonly metadataURI: string;
  readonly previousExecutorSignature: string;
}

export function ExecutorPatchPanel({
  actions,
  actionLabel,
  order,
  participantWallet,
  source,
  task,
  targets,
  onProofReady,
  onSubmitted
}: {
  readonly actions: OrderAppActions;
  readonly actionLabel: string;
  readonly order?: ProductOrderDTO | undefined;
  readonly participantWallet?: string | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly task: ProductTaskDTO;
  readonly targets: readonly SelectableTargetStageDTO[];
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState<ExecutorPatchDraftState>(() => initialExecutorPatchDraft(task, targets, participantWallet));
  const { scopeKey: taskScopeKey, taskScopeRef } = useTaskScopeGuard(task);
  const [phase, setPhase] = useState<PatchPhase>("idle");
  const [prepared, setPrepared] = useState<PreparedStageExecutorPatchDTO | undefined>();
  const [submission, setSubmission] = useState<StageExecutorPatchSubmissionDTO | undefined>();
  const [error, setError] = useState<string | undefined>();
  // 同步互斥（EvidencePanel submitInflightRef 同款）：重渲染前的第二次点击
  // 由 ref 挡住；终态后的重投由 submitted 相位闸承担。
  const submitInflightRef = useRef(createInflightGuard());
  const selectedTarget = targets.find((target) => selectableTargetStageId(target) === draft.targetStageId) ?? targets[0];
  const modeOptions = executorPatchModeOptionsForTarget(selectedTarget);
  const selectedMode = modeOptions.find((mode) => mode.mode === draft.mode) ?? modeOptions[0];
  const modeLabel = selectedMode?.modeLabel ?? executorPatchModeLabel(draft.mode);
  const blockers = executorPatchBlockers({
    draft,
    selectedMode,
    selectedTarget,
    source,
    task,
    participantWallet,
    hasInjectedWallet: actions.hasInjectedWallet()
  });
  const canPrepare = blockers.length === 0 && phase !== "preparing" && phase !== "submitting" && !prepared;

  useEffect(() => {
    setDraft(initialExecutorPatchDraft(task, targets, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
    // 重置按稳定标识（任务作用域）触发：投影刷新每次产生新 task/targets
    // 对象，按引用重置会清掉用户编辑中的输入（EvidencePanel 同口径）。
  }, [participantWallet, taskScopeKey]);

  function updateDraft(patch: Partial<ExecutorPatchDraftState>) {
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
    setPhase("idle");
    setDraft((current) => ({
      ...current,
      ...patch
    }));
  }

  function updatePreviousExecutorSignature(previousExecutorSignature: string) {
    setSubmission(undefined);
    setError(undefined);
    setDraft((current) => ({
      ...current,
      previousExecutorSignature
    }));
  }

  function updateTarget(nextTargetStageId: string) {
    const nextTarget = targets.find((target) => selectableTargetStageId(target) === nextTargetStageId);
    const nextMode = executorPatchModeOptionsForTarget(nextTarget)[0];
    updateDraft({
      targetStageId: nextTargetStageId,
      mode: nextMode?.mode ?? "assign",
      previousExecutor: executorPatchPreviousExecutor(nextMode, nextTarget),
      approvalSourceId: nextMode?.approvalSourceId ?? "",
      approvalSignalId: nextMode?.approvalSignalId ?? "",
      previousExecutorSignature: ""
    });
  }

  function updateMode(nextModeValue: ProductExecutorPatchMode) {
    const nextMode = modeOptions.find((mode) => mode.mode === nextModeValue);
    updateDraft({
      mode: nextModeValue,
      previousExecutor: executorPatchPreviousExecutor(nextMode, selectedTarget),
      approvalSourceId: nextMode?.approvalSourceId ?? "",
      approvalSignalId: nextMode?.approvalSignalId ?? "",
      previousExecutorSignature: ""
    });
  }

  async function prepareExecutorPatch() {
    if (!canPrepare) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    setPhase("preparing");
    setError(undefined);
    try {
      const nextPrepared = await actions.prepareStageExecutorPatch(task.taskId, {
        selectorWallet: draft.selectorWallet.trim(),
        targetStageId: draft.targetStageId,
        mode: draft.mode,
        ...(draft.previousExecutor.trim() ? { previousExecutorWallet: draft.previousExecutor.trim() } : {}),
        ...(draft.approvalSourceId.trim() && draft.approvalSignalId.trim()
          ? { approval: { sourceId: draft.approvalSourceId.trim(), signalId: draft.approvalSignalId.trim() } }
          : {}),
        executorWallet: draft.executorWallet.trim(),
        executorMetadataHash: draft.executorMetadataHash.trim(),
        ...(draft.executorReference.trim() ? { executorReference: draft.executorReference.trim() } : {}),
        metadataURI: draft.metadataURI.trim()
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setPrepared(nextPrepared);
      setPhase("prepared");
    } catch (caught) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "履约者选择准备失败");
      setPhase("error");
    }
  }

  async function submitExecutorPatch() {
    if (!prepared || phase === "submitted" || submitInflightRef.current.locked) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    submitInflightRef.current.tryAcquire();
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await actions.signTypedData({
        typedData: prepared.typedData,
        walletAddress: draft.selectorWallet.trim(),
        ...stagePatchSignExpectation()
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      const result = await actions.submitStageExecutorPatch(task.taskId, {
        prepareId: prepared.prepareId,
        selectorWallet: draft.selectorWallet.trim(),
        typedData: prepared.typedData,
        signature,
        patch: prepared,
        mode: draft.mode,
        ...(draft.previousExecutor.trim() ? { previousExecutorWallet: draft.previousExecutor.trim() } : {}),
        ...(draft.previousExecutorSignature.trim() ? { previousExecutorSignature: draft.previousExecutorSignature.trim() } : {})
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setSubmission(result);
      onProofReady({
        taskId: task.taskId,
        orderId: task.orderId,
        orderTitle: order?.title ?? task.orderTitle,
        taskTitle: task.title,
        actionLabel,
        status: result.status,
        txHash: result.txHash as TaskSubmissionProof["txHash"],
        blockNumber: result.blockNumber,
        signerWallet: draft.selectorWallet.trim(),
        payloadHash: prepared.patchHash as TaskSubmissionProof["payloadHash"],
        stateMachineAddress: task.stateMachineAddress ?? order?.stateMachineAddress,
        evidence: [],
        proofRows: result.proofRows
      });
      const failure = submissionFailureText(result.status, result.errorCode);
      if (failure) {
        if (isTerminalSubmissionEnvelope(result.status)) {
          // 终态清 prepared 连带清 handoff 加签：旧签名只对已消费的补丁
          // typedData 有效，残留会在重新准备后被原样提交到新补丁上。
          setPrepared(undefined);
          setDraft((current) => ({ ...current, previousExecutorSignature: "" }));
        }
        setError(failure);
        setPhase("error");
        return;
      }
      setPhase("submitted");
      onSubmitted?.();
    } catch (caught) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "签名提交失败");
      setPhase("error");
    } finally {
      submitInflightRef.current.release();
    }
  }

  return (
    <section className="workspace-block patch-panel" aria-labelledby="executor-patch-title">
      <div className="section-heading">
        <Layers aria-hidden="true" />
        <div>
          <h2 id="executor-patch-title">{modeLabel}</h2>
          <p>{executorPatchModeIntro(draft.mode)}</p>
        </div>
      </div>

      {modeOptions.length > 1 ? (
        <fieldset className="patch-mode-options">
          <legend>处理方式</legend>
          {modeOptions.map((mode) => (
            <label className={`patch-mode-option patch-mode-${mode.mode}`} key={mode.mode}>
              <input
                checked={draft.mode === mode.mode}
                disabled={mode.allowed === false}
                name="executor-patch-mode"
                onChange={() => updateMode(mode.mode)}
                type="radio"
                value={mode.mode}
              />
              <span>
                <strong>{mode.modeLabel}</strong>
                <small>{mode.guidanceLabel ?? executorPatchModeGuidance(mode.mode)}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {selectedMode ? (
        <div className="executor-authority-note" aria-label="履约权限说明">
          <strong>{selectedMode.priorAuthorityLabel ?? (executorPatchWorkStarted(selectedTarget) ? "已完成部分不变" : "阶段尚未开始")}</strong>
          <span>{selectedMode.futureAuthorityLabel ?? "确认后只变更后续履约权限"}</span>
          {selectedMode.requiresApprovalSignal ? <em>需要替换证明</em> : null}
        </div>
      ) : null}

      <div className="patch-grid">
        <label className="plugin-field">
          <span>
            目标阶段
            <small>{draft.mode === "assign" ? "允许选择" : "后续权限"}</small>
          </span>
          <select
            aria-label="目标阶段"
            onChange={(event) => updateTarget(event.currentTarget.value)}
            value={draft.targetStageId}
          >
            {targets.map((target) => (
              <option
                disabled={target.allowed === false}
                key={selectableTargetStageId(target)}
                value={selectableTargetStageId(target)}
              >
                {targetStageLabel(target)}
              </option>
            ))}
          </select>
        </label>

        <label className="plugin-field">
          <span>
            选择方钱包
            <small>授权签名</small>
          </span>
          <input
            aria-label="选择方钱包"
            onChange={(event) => updateDraft({ selectorWallet: event.currentTarget.value })}
            value={draft.selectorWallet}
          />
        </label>

        <label className="plugin-field">
          <span>
            履约者钱包
            <small>{draft.mode === "assign" ? "可直接指定" : "新履约者"}</small>
          </span>
          <input
            aria-label="履约者钱包"
            onChange={(event) => updateDraft({ executorWallet: event.currentTarget.value })}
            placeholder="0x..."
            value={draft.executorWallet}
          />
        </label>

        {draft.mode !== "assign" ? (
          <label className="plugin-field">
            <span>
              原履约者钱包
              <small>{draft.mode === "handoff" ? "需签名" : "已完成部分不变"}</small>
            </span>
            <input
              aria-label="原履约者钱包"
              onChange={(event) => updateDraft({ previousExecutor: event.currentTarget.value })}
              placeholder="0x..."
              value={draft.previousExecutor}
            />
          </label>
        ) : null}

        <label className="plugin-field">
          <span>
            履约者参考
            <small>可选展示</small>
          </span>
          <input
            aria-label="履约者参考"
            onChange={(event) => updateDraft({ executorReference: event.currentTarget.value })}
            placeholder="供应商引用或链下索引"
            value={draft.executorReference}
          />
        </label>

        <label className="plugin-field">
          <span>
            履约者指纹
            <small>必填</small>
          </span>
          <input
            aria-label="履约者指纹"
            onChange={(event) => updateDraft({ executorMetadataHash: event.currentTarget.value })}
            placeholder="0x..."
            value={draft.executorMetadataHash}
          />
        </label>
      </div>

      {draft.mode === "replacement" ? (
        <div className="patch-grid">
          <label className="plugin-field">
            <span>
              替换证明来源
              <small>需要替换证明</small>
            </span>
            <input
              aria-label="替换证明来源"
              onChange={(event) => updateDraft({ approvalSourceId: event.currentTarget.value })}
              placeholder="0x..."
              value={draft.approvalSourceId}
            />
          </label>
          <label className="plugin-field">
            <span>
              替换证明编号
              <small>链上可核对</small>
            </span>
            <input
              aria-label="替换证明编号"
              onChange={(event) => updateDraft({ approvalSignalId: event.currentTarget.value })}
              placeholder="0x..."
              value={draft.approvalSignalId}
            />
          </label>
        </div>
      ) : null}

      <label className="plugin-field">
        <span>
          补充说明 URI
          <small>必填</small>
        </span>
        <input
          aria-label="补充说明 URI"
          onChange={(event) => updateDraft({ metadataURI: event.currentTarget.value })}
          placeholder="ipfs://... / ar://... / cid:..."
          value={draft.metadataURI}
        />
      </label>

      {selectedTarget?.description ? (
        <p className="notice-line">
          <ListChecks aria-hidden="true" />
          <span>{selectedTarget.description}</span>
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="validation-list" aria-label="履约者选择阻断原因">
          {blockers.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        <p className="notice-line">
          <CheckCircle2 aria-hidden="true" />
          <span>{executorPatchReadyCopy(draft.mode)}</span>
        </p>
      )}

      <div className="submit-actions">
        <button
          className="primary-button"
          disabled={!canPrepare}
          onClick={() => void prepareExecutorPatch()}
          type="button"
        >
          {phase === "preparing" ? <RefreshCw className="spin" aria-hidden="true" /> : <WalletCards aria-hidden="true" />}
          准备提交
        </button>
        <span>{prepared ? `准备编号 ${prepared.prepareId}` : "准备后需使用授权钱包签名"}</span>
      </div>

      {prepared ? (
        <div className="signature-box">
          <div>
            <WalletCards aria-hidden="true" />
            <span>浏览器钱包只签署本次履约者选择；中继服务只广播签名，不代签业务动作。</span>
          </div>
          <dl className="proof-grid compact-proof">
            <ProofRow label="选择指纹" value={prepared.patchHash} />
            <ProofRow label="处理方式" value={modeLabel} />
            <ProofRow label="目标阶段" value={prepared.humanSummary?.targetStage ?? targetStageLabel(selectedTarget ?? targets[0]!)} />
            {draft.previousExecutor.trim() ? <ProofRow label="原履约者" value={draft.previousExecutor.trim()} /> : null}
            {draft.approvalSourceId.trim() && draft.approvalSignalId.trim() ? (
              <ProofRow label="替换证明" value={`${draft.approvalSourceId.trim()} / ${draft.approvalSignalId.trim()}`} />
            ) : null}
            <ProofRow label="有效期" value={prepared.humanSummary?.validUntil ?? prepared.expiresAt ?? "等待 API 返回"} />
          </dl>
          {selectedMode?.requiresPreviousExecutorSignature ? (
            <label className="plugin-field">
              <span>
                原履约者签名
                <small>交接履约者</small>
              </span>
              <input
                aria-label="原履约者签名"
                onChange={(event) => updatePreviousExecutorSignature(event.currentTarget.value)}
                placeholder="0x..."
                value={draft.previousExecutorSignature}
              />
            </label>
          ) : null}
          <button
            className="primary-button"
            disabled={phase === "submitting" || phase === "submitted" || !draft.selectorWallet.trim() || (selectedMode?.requiresPreviousExecutorSignature === true && !draft.previousExecutorSignature.trim())}
            onClick={() => void submitExecutorPatch()}
            type="button"
          >
            {phase === "submitting" ? <RefreshCw className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            使用钱包签名并提交
          </button>
        </div>
      ) : null}

      {phase === "submitted" ? (
        <p className="notice-line">
          <CheckCircle2 aria-hidden="true" />
          <span>{executorPatchStatusText(submission, draft.mode)}</span>
        </p>
      ) : null}
      {error ? <p className="blocked-copy" role="alert">{error}</p> : null}
    </section>
  );
}

function initialExecutorPatchDraft(
  task: ProductTaskDTO,
  targets: readonly SelectableTargetStageDTO[],
  participantWallet: string | undefined
): ExecutorPatchDraftState {
  const firstTarget = targets[0];
  const firstMode = executorPatchModeOptionsForTarget(firstTarget)[0];
  const selectorWallet = task.participantWallet ?? task.assigneeWallet ?? participantWallet ?? "";
  return {
    selectorWallet,
    targetStageId: firstTarget ? selectableTargetStageId(firstTarget) : "",
    mode: firstMode?.mode ?? "assign",
    previousExecutor: executorPatchPreviousExecutor(firstMode, firstTarget),
    executorWallet: "",
    executorMetadataHash: "",
    executorReference: "",
    approvalSourceId: firstMode?.approvalSourceId ?? "",
    approvalSignalId: firstMode?.approvalSignalId ?? "",
    metadataURI: "",
    previousExecutorSignature: ""
  };
}

function executorPatchPreviousExecutor(
  mode: ExecutorPatchModeOptionDTO | undefined,
  target: SelectableTargetStageDTO | undefined
): string {
  return cleanString(mode?.previousExecutor) ??
    cleanString(target?.previousExecutor) ??
    "";
}

function executorPatchModeIntro(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "阶段开始前选择履约者；提交后等待链上确认。";
    case "handoff":
      return "已开始阶段需原履约者签名；已完成部分不变。";
    case "replacement":
      return "申请替换履约者需要替换证明；已完成部分不变。";
  }
}

function executorPatchReadyCopy(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "可准备签名：将提交履约者引用和指纹，不提交文件原文。";
    case "handoff":
      return "可准备签名：交接履约者需要原履约者签名，已完成部分不变。";
    case "replacement":
      return "可准备签名：需要替换证明，确认后只变更后续履约权限。";
  }
}

function executorPatchBlockers(input: {
  readonly draft: ExecutorPatchDraftState;
  readonly selectedMode?: ExecutorPatchModeOptionDTO | undefined;
  readonly selectedTarget?: SelectableTargetStageDTO | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly task: ProductTaskDTO;
  readonly participantWallet?: string | undefined;
  readonly hasInjectedWallet: boolean;
}): readonly string[] {
  const blockers: string[] = [];
  const authorizedWallet = input.task.participantWallet ?? input.task.assigneeWallet ?? input.participantWallet;
  if (input.task.status !== "open") {
    blockers.push("任务已关闭，不能继续提交。");
  }
  if (input.task.canSubmit === false) {
    blockers.push("当前钱包暂不能提交此待办。请确认你使用的钱包与订单登记的一致。");
  }
  if (!input.selectedTarget || !input.draft.targetStageId.trim()) {
    blockers.push("请选择目标阶段。");
  } else if (input.selectedTarget.allowed === false) {
    blockers.push(input.selectedTarget.disabledReason ?? "该目标阶段当前不可选择。");
  }
  if (!input.selectedMode) {
    blockers.push("请选择处理方式。");
  } else if (input.selectedMode.allowed === false) {
    blockers.push(input.selectedMode.disabledReason ?? "该处理方式当前不可使用。");
  }
  if (input.draft.mode === "assign" && executorPatchWorkStarted(input.selectedTarget)) {
    blockers.push("阶段已开始，不能直接选择履约者。");
  }
  if (!input.draft.selectorWallet.trim()) {
    blockers.push("缺少选择方钱包。");
  } else if (authorizedWallet && !sameAddress(input.draft.selectorWallet, authorizedWallet)) {
    blockers.push(`钱包与授权参与方不匹配。授权钱包为 ${shortWallet(authorizedWallet)}，请切换到对应钱包后重试。`);
  }
  if (!input.draft.executorWallet.trim()) {
    blockers.push("请填写履约者钱包。");
  }
  if (!looksLikeHash(input.draft.executorMetadataHash)) {
    blockers.push("请填写 0x 开头的履约者指纹。");
  }
  if ((input.draft.mode === "handoff" || input.draft.mode === "replacement") && !input.draft.previousExecutor.trim()) {
    blockers.push("请填写原履约者钱包。");
  }
  if (input.draft.mode === "replacement") {
    if (!input.draft.approvalSourceId.trim() || !input.draft.approvalSignalId.trim()) {
      blockers.push("需要替换证明。");
    }
  }
  if (!input.draft.metadataURI.trim()) {
    blockers.push("请填写补充说明 URI。");
  } else if (!isContentAddressedReference(input.draft.metadataURI)) {
    blockers.push("补充说明 URI 需使用内容寻址引用。");
  }
  if (input.source?.kind !== "real") {
    blockers.push("参与者服务未连接，不能提交履约者选择。");
  }
  if (input.source?.kind === "real" && !input.hasInjectedWallet) {
    blockers.push("未检测到浏览器钱包，不能创建业务签名。");
  }
  return blockers;
}

function executorPatchStatusText(
  submission: StageExecutorPatchSubmissionDTO | undefined,
  fallbackMode: ProductExecutorPatchMode
): string {
  const label = executorPatchModeLabel(submission?.mode ?? fallbackMode);
  if (submission?.status === "confirmed") {
    return `${label}已确认。`;
  }
  // expired/replaced 是服务端记录的终态（未生效/被取代，不进索引）：
  // 如实宣判并引导重新准备，不用"仍在索引核对中"的假等待话术。
  if (submission?.status === "expired") {
    return `${label}提交已过期未生效（终态）；请重新准备提交。`;
  }
  if (submission?.status === "replaced") {
    return `${label}提交已被后续提交取代（终态）；请以最新提交记录为准，勿盲目重投。`;
  }
  return "已提交，等待链上确认。";
}
