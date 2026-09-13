import { CheckCircle2, Fingerprint, RefreshCw, Send, WalletCards } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type {
  PreparedStageResourcePatchDTO,
  ProductApiSource,
  StageResourcePatchSubmissionDTO
} from "../../api/productApi";
import type { OrderAppActions } from "../../actions/orderAppActions";
import type { TaskSubmissionProof } from "../../task-model";
import { shortWallet } from "../../auth/participant";
import {
  resourceRequirementDisplays,
  resourceRequirementsForTask,
  targetStageId as selectableTargetStageId,
  targetStageLabel,
  type SelectableTargetStageDTO
} from "../model/addOnTypes";
import { useTaskScopeGuard } from "../model/taskScope";
import { cleanString, isContentAddressedReference, looksLikeHash, sameAddress, stagePatchSignExpectation } from "../model/taskUtils";
import { isTerminalSubmissionEnvelope, submissionFailureText } from "../submission/submissionEnvelope";
import type { PatchPhase } from "../submission/types";
import { ProofRow } from "./ProofRow";

interface ResourcePatchDraftState {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly resourceKey: string;
  readonly manifestURI: string;
  readonly manifestHash: string;
  readonly policyHash: string;
}

export function ResourcePatchPanel({
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
  const [draft, setDraft] = useState<ResourcePatchDraftState>(() => initialResourcePatchDraft(task, targets, participantWallet));
  const { scopeKey: taskScopeKey, taskScopeRef } = useTaskScopeGuard(task);
  const [phase, setPhase] = useState<PatchPhase>("idle");
  const [prepared, setPrepared] = useState<PreparedStageResourcePatchDTO | undefined>();
  const [submission, setSubmission] = useState<StageResourcePatchSubmissionDTO | undefined>();
  const [error, setError] = useState<string | undefined>();
  // 同步互斥（EvidencePanel submitInflightRef 同款）：重渲染前的第二次点击
  // 由 ref 挡住；终态后的重投由 submitted 相位闸承担。
  const submitInflightRef = useRef(false);
  const selectedTarget = targets.find((target) => selectableTargetStageId(target) === draft.targetStageId) ?? targets[0];
  const resourceOptions = targetResourceOptions(task, selectedTarget);
  const blockers = resourcePatchBlockers({
    draft,
    selectedTarget,
    source,
    task,
    participantWallet,
    hasInjectedWallet: actions.hasInjectedWallet()
  });
  const canPrepare = blockers.length === 0 && phase !== "preparing" && phase !== "submitting" && !prepared;

  useEffect(() => {
    setDraft(initialResourcePatchDraft(task, targets, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
    // 重置按稳定标识（任务作用域）触发（ExecutorPatchPanel 同口径）。
  }, [participantWallet, taskScopeKey]);

  function updateDraft(patch: Partial<ResourcePatchDraftState>) {
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
    setPhase("idle");
    setDraft((current) => ({
      ...current,
      ...patch
    }));
  }

  function updateTarget(nextTargetStageId: string) {
    const nextTarget = targets.find((target) => selectableTargetStageId(target) === nextTargetStageId);
    const next = initialResourcePatchDraft(task, nextTarget ? [nextTarget] : targets, participantWallet);
    updateDraft({
      targetStageId: nextTargetStageId,
      resourceKey: next.resourceKey,
      manifestURI: next.manifestURI,
      manifestHash: next.manifestHash,
      policyHash: next.policyHash
    });
  }

  function updateResourceKey(resourceKey: string) {
    const option = resourceOptions.find((resource) => resource.resourceKey === resourceKey);
    // 与 updateTarget/updateMode 同口径显式清空：条件展开会在新资源未声明
    // 某个字段时残留上一资源的清单三元组，提交两份资源混合的指纹。
    updateDraft({
      resourceKey,
      manifestURI: option?.manifestURI ?? "",
      manifestHash: option?.manifestHash ?? "",
      policyHash: option?.policyHash ?? ""
    });
  }

  async function prepareResourcePatch() {
    if (!canPrepare) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    setPhase("preparing");
    setError(undefined);
    try {
      const nextPrepared = await actions.prepareStageResourcePatch(task.taskId, {
        selectorWallet: draft.selectorWallet.trim(),
        targetStageId: draft.targetStageId,
        resourceKey: draft.resourceKey.trim(),
        manifestURI: draft.manifestURI.trim(),
        manifestHash: draft.manifestHash.trim(),
        policyHash: draft.policyHash.trim()
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
      setError(caught instanceof Error ? caught.message : "资源补充准备失败");
      setPhase("error");
    }
  }

  async function submitResourcePatch() {
    if (!prepared || phase === "submitted" || submitInflightRef.current) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    submitInflightRef.current = true;
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
      const result = await actions.submitStageResourcePatch(task.taskId, {
        prepareId: prepared.prepareId,
        selectorWallet: draft.selectorWallet.trim(),
        typedData: prepared.typedData,
        signature,
        patch: prepared
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
          setPrepared(undefined);
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
      submitInflightRef.current = false;
    }
  }

  return (
    <section className="workspace-block patch-panel" aria-labelledby="resource-patch-title">
      <div className="section-heading">
        <Fingerprint aria-hidden="true" />
        <div>
          <h2 id="resource-patch-title">补充凭证要求</h2>
          <p>发布加密内容寻址资源清单和访问策略；提交后等待链上确认。</p>
        </div>
      </div>

      <div className="patch-grid">
        <label className="plugin-field">
          <span>
            目标阶段
            <small>允许管理</small>
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
            请求方钱包
            <small>授权签名</small>
          </span>
          <input
            aria-label="请求方钱包"
            onChange={(event) => updateDraft({ selectorWallet: event.currentTarget.value })}
            value={draft.selectorWallet}
          />
        </label>

        {resourceOptions.length > 0 ? (
          <label className="plugin-field">
            <span>
              资源键
              <small>选择清单</small>
            </span>
            <select
              aria-label="资源键"
              onChange={(event) => updateResourceKey(event.currentTarget.value)}
              value={draft.resourceKey}
            >
              {resourceOptions.map((resource) => (
                <option key={resource.resourceKey} value={resource.resourceKey}>
                  {resource.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="plugin-field">
            <span>
              资源键
              <small>必填</small>
            </span>
            <input
              aria-label="资源键"
              onChange={(event) => updateDraft({ resourceKey: event.currentTarget.value })}
              value={draft.resourceKey}
            />
          </label>
        )}

      </div>

      <label className="plugin-field">
        <span>
          资源清单 URI
          <small>内容寻址</small>
        </span>
        <input
          aria-label="资源清单 URI"
          onChange={(event) => updateDraft({ manifestURI: event.currentTarget.value })}
          placeholder="ipfs://... / ar://... / cid:..."
          value={draft.manifestURI}
        />
      </label>

      <div className="patch-grid">
        <label className="plugin-field">
          <span>
            清单指纹
            <small>必填</small>
          </span>
          <input
            aria-label="清单指纹"
            onChange={(event) => updateDraft({ manifestHash: event.currentTarget.value })}
            placeholder="0x..."
            value={draft.manifestHash}
          />
        </label>

        <label className="plugin-field">
          <span>
            权限指纹
            <small>必填</small>
          </span>
          <input
            aria-label="权限指纹"
            onChange={(event) => updateDraft({ policyHash: event.currentTarget.value })}
            placeholder="0x..."
            value={draft.policyHash}
          />
        </label>
      </div>

      {blockers.length > 0 ? (
        <ul className="validation-list" aria-label="资源补充阻断原因">
          {blockers.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        <p className="notice-line">
          <CheckCircle2 aria-hidden="true" />
          <span>可准备签名：将提交资源清单、权限和补充指纹，不提交文件原文。</span>
        </p>
      )}

      <div className="submit-actions">
        <button
          className="primary-button"
          disabled={!canPrepare}
          onClick={() => void prepareResourcePatch()}
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
            <span>浏览器钱包只签署本次资源补充；中继服务只广播签名，不代签业务动作。</span>
          </div>
          <dl className="proof-grid compact-proof">
            <ProofRow label="资源补充指纹" value={prepared.patchHash} />
            <ProofRow label="清单指纹" value={prepared.manifestHash} />
            <ProofRow label="权限指纹" value={prepared.policyHash} />
            <ProofRow label="有效期" value={prepared.humanSummary?.validUntil ?? prepared.expiresAt ?? "等待 API 返回"} />
          </dl>
          <button
            className="primary-button"
            disabled={phase === "submitting" || phase === "submitted" || !draft.selectorWallet.trim()}
            onClick={() => void submitResourcePatch()}
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
          <span>{resourcePatchStatusText(submission)}</span>
        </p>
      ) : null}
      {error ? <p className="blocked-copy" role="alert">{error}</p> : null}
    </section>
  );
}

function initialResourcePatchDraft(
  task: ProductTaskDTO,
  targets: readonly SelectableTargetStageDTO[],
  participantWallet: string | undefined
): ResourcePatchDraftState {
  const firstTarget = targets[0];
  const resource = targetResourceOptions(task, firstTarget)[0];
  return {
    selectorWallet: task.participantWallet ?? task.assigneeWallet ?? participantWallet ?? "",
    targetStageId: firstTarget ? selectableTargetStageId(firstTarget) : "",
    resourceKey: resource?.resourceKey ?? "",
    manifestURI: resource?.manifestURI ?? "",
    manifestHash: resource?.manifestHash ?? "",
    policyHash: resource?.policyHash ?? ""
  };
}

interface TargetResourceOption {
  readonly resourceKey: string;
  readonly label: string;
  readonly manifestURI?: string | undefined;
  readonly manifestHash?: string | undefined;
  readonly policyHash?: string | undefined;
}

function targetResourceOptions(task: ProductTaskDTO, target: SelectableTargetStageDTO | undefined): readonly TargetResourceOption[] {
  const resources = target?.resourceRequirements ?? resourceRequirementsForTask(task);
  if (resources.length > 0) {
    return resources.map((resource) => ({
      resourceKey: cleanString(resource.resourceKey) ?? resource.resourceId,
      label: cleanString(resource.label) ?? resource.resourceId,
      ...(cleanString(resource.manifestURI) ? { manifestURI: cleanString(resource.manifestURI) } : {}),
      ...(cleanString(resource.manifestHash) ? { manifestHash: cleanString(resource.manifestHash) } : {}),
      ...(cleanString(resource.accessPolicy?.policyHash)
        ? { policyHash: cleanString(resource.accessPolicy?.policyHash) }
        : {})
    }));
  }
  // 可见性属于链下资源清单（addOnManifestRuntime 同口径），不进 prepare 请求，
  // 也不在补丁表单里提供会误导的"可见性"选择。
  return resourceRequirementDisplays(task).map((resource) => ({
    resourceKey: resource.resourceId,
    label: resource.label
  }));
}

function resourcePatchBlockers(input: {
  readonly draft: ResourcePatchDraftState;
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
    blockers.push(input.selectedTarget.disabledReason ?? "该目标阶段当前不可管理。");
  }
  if (!input.draft.selectorWallet.trim()) {
    blockers.push("缺少请求方钱包。");
  } else if (authorizedWallet && !sameAddress(input.draft.selectorWallet, authorizedWallet)) {
    blockers.push(`钱包与授权参与方不匹配。授权钱包为 ${shortWallet(authorizedWallet)}，请切换到对应钱包后重试。`);
  }
  if (!input.draft.resourceKey.trim()) {
    blockers.push("请填写资源键。");
  }
  if (!input.draft.manifestURI.trim()) {
    blockers.push("请填写资源清单 URI。");
  } else if (!isContentAddressedReference(input.draft.manifestURI)) {
    blockers.push("资源清单 URI 需使用内容寻址引用。");
  }
  if (!looksLikeHash(input.draft.manifestHash)) {
    blockers.push("请填写 0x 开头的清单指纹。");
  }
  if (!looksLikeHash(input.draft.policyHash)) {
    blockers.push("请填写 0x 开头的权限指纹。");
  }
  if (input.source?.kind !== "real") {
    blockers.push("参与者服务未连接，不能提交资源补充。");
  }
  if (input.source?.kind === "real" && !input.hasInjectedWallet) {
    blockers.push("未检测到浏览器钱包，不能创建业务签名。");
  }
  return blockers;
}

function resourcePatchStatusText(submission: StageResourcePatchSubmissionDTO | undefined): string {
  if (submission?.status === "confirmed") {
    return "资源补充已确认。";
  }
  if (submission?.status === "expired") {
    return "资源补充提交已过期未生效（终态）；请重新准备提交。";
  }
  if (submission?.status === "replaced") {
    return "资源补充提交已被后续提交取代（终态）；请以最新提交记录为准，勿盲目重投。";
  }
  return "已提交，等待链上确认。";
}
