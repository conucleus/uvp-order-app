import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Layers,
  ListChecks,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ChainProofRowDTO,
  ParticipantAddOnManifestComponentDTO,
  ParticipantAddOnManifestDTO,
  ProductExecutorPatchMode,
  ProductOrderDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";
import type {
  PreparedStageExecutorPatchDTO,
  PreparedStageResourcePatchDTO,
  ProductApiClient,
  ProductApiSource,
  StageExecutorPatchSubmissionDTO,
  StageResourcePatchSubmissionDTO
} from "../api/productApi";
import { EvidencePanel } from "../evidence/EvidencePanel";
import type { TaskSubmissionProof } from "../evidence/types";
import { ProofPanel } from "../proof/ProofPanel";
import { getInjectedWalletProvider, signProductSubmitWithInjectedWallet, signTypedDataWithInjectedWallet } from "../wallet/injectedWallet";
import {
  addOnManifestForTask,
  executorPatchModeGuidance,
  executorPatchModeLabel,
  executorPatchModeOptionsForTarget,
  executorPatchWorkStarted,
  selectableTargetsForTask,
  resourceRequirementDisplays,
  targetStageId as selectableTargetStageId,
  targetStageLabel,
  type ExecutorPatchModeOptionDTO,
  type FileResourceHandleDTO,
  type SelectableTargetStageDTO
} from "./addOnTypes";
import {
  buildAddOnManifestPrepareInput,
  createInitialAddOnManifestState,
  manifestIntentLabel,
  validateAddOnManifestAction,
  type AddOnManifestRuntimeState,
  type AddOnManifestPrepareInput
} from "./addOnManifestRuntime";
import {
  createInitialTaskPluginState,
  pluginPresentationForTask,
  pluginForTask,
  type PrepareSubmitInput,
  type TaskPluginState
} from "./pluginRuntime";
import { shortWallet } from "../auth/participant";
import {
  signalContainerForTask,
  supplierTrustBlocker,
  type TaskSignalContainerSummary
} from "./signalContainer";
import { taskExecutorDisplay } from "./taskPresentation";
import { taskDisplay } from "./taskStatus";
import "./taskRuntime.css";

export interface PreparedTaskSubmit {
  readonly prepareId: string;
  readonly taskId: string;
  readonly orderId: string;
  readonly payloadHash: string;
  readonly expiresAt: string;
  readonly typedData: ProductSubmitTypedData;
  readonly humanSummary?: {
    readonly purpose: string;
    readonly action: string;
    readonly validUntil: string;
  };
}

export interface ProductSubmission {
  readonly submissionId: string;
  readonly status: string;
  readonly txHash?: string;
  readonly blockNumber?: string;
  readonly proofRows: readonly ChainProofRowDTO[];
}

export interface SubmitPreparedInput {
  readonly prepareId: string;
  readonly signature: string;
  readonly walletAddress: string;
}

export interface TaskPluginHostProps {
  readonly api: ProductApiClient;
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
  readonly submissionProof?: TaskSubmissionProof;
  readonly onPrepareSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: () => void;
  readonly onSubmitPrepared: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
}

type RuntimePhase = "idle" | "preparing" | "prepared" | "submitting" | "submitted" | "error";
type PatchPhase = "idle" | "preparing" | "prepared" | "submitting" | "submitted" | "error";

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

interface ResourcePatchDraftState {
  readonly selectorWallet: string;
  readonly targetStageId: string;
  readonly resourceKey: string;
  readonly manifestURI: string;
  readonly manifestHash: string;
  readonly policyHash: string;
  readonly visibility: "public" | "protected" | "private";
}

type ManifestPreparedState =
  | {
      readonly actionKind: "submit_signal";
      readonly actionId: string;
      readonly actionLabel: string;
      readonly input: PrepareSubmitInput;
      readonly prepared: PreparedTaskSubmit;
    }
  | {
      readonly actionKind: "stage_executor_patch";
      readonly actionId: string;
      readonly actionLabel: string;
      readonly input: Extract<AddOnManifestPrepareInput, { readonly actionKind: "stage_executor_patch" }>["input"];
      readonly prepared: PreparedStageExecutorPatchDTO;
    }
  | {
      readonly actionKind: "stage_resource_patch";
      readonly actionId: string;
      readonly actionLabel: string;
      readonly input: Extract<AddOnManifestPrepareInput, { readonly actionKind: "stage_resource_patch" }>["input"];
      readonly prepared: PreparedStageResourcePatchDTO;
    };

export function TaskPluginHost({
  api,
  task,
  order,
  participantWallet,
  source,
  submissionProof,
  onPrepareSubmit,
  onProofReady,
  onSubmitted,
  onSubmitPrepared
}: TaskPluginHostProps) {
  const plugin = pluginForTask(task);
  const pluginPresentation = pluginPresentationForTask(task, plugin);
  const addOnManifest = addOnManifestForTask(task);
  const executorDisplay = taskExecutorDisplay(task);
  const signalContainer = signalContainerForTask(task);
  const [state, setState] = useState<TaskPluginState>(() => createInitialTaskPluginState(task, participantWallet));
  const [phase, setPhase] = useState<RuntimePhase>("idle");
  const [prepared, setPrepared] = useState<PreparedTaskSubmit | undefined>();
  const [submission, setSubmission] = useState<ProductSubmission | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setState(createInitialTaskPluginState(task, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
  }, [participantWallet, task]);

  const runtimeState = useMemo<TaskPluginState>(() => ({
    ...state,
    task,
    walletAddress: participantWallet
  }), [participantWallet, state, task]);
  const evidenceTask = useMemo(
    () => source?.kind === "demo" ? { ...task, canSubmit: undefined } : task,
    [source?.kind, task]
  );
  const validation = plugin.validate(runtimeState);
  const display = taskDisplay(task);
  const patchTargets = useMemo(() => selectableTargetsForTask(task), [task]);
  const usesManifestFlow = Boolean(addOnManifest);
  const usesExecutorPatchFlow = !usesManifestFlow && plugin.kind === "stage_executor_patch" && patchTargets.length > 0;
  const usesResourcePatchFlow = !usesManifestFlow && plugin.kind === "stage_resource_patch" && patchTargets.length > 0;
  const usesPatchFlow = usesExecutorPatchFlow || usesResourcePatchFlow;

  function updateValue(inputId: string, value: string) {
    setPrepared(undefined);
    setSubmission(undefined);
    setPhase("idle");
    setError(undefined);
    setState((current) => ({
      ...current,
      values: {
        ...current.values,
        [inputId]: value
      }
    }));
  }

  function updateConfirmation(inputId: string, checked: boolean) {
    setPrepared(undefined);
    setSubmission(undefined);
    setPhase("idle");
    setError(undefined);
    setState((current) => ({
      ...current,
      confirmations: {
        ...current.confirmations,
        [inputId]: checked
      }
    }));
  }

  async function prepareSubmit() {
    setPhase("preparing");
    setError(undefined);
    try {
      const result = await onPrepareSubmit(task.taskId, plugin.buildPrepareSubmit(runtimeState));
      setPrepared(result);
      setPhase("prepared");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交准备失败");
      setPhase("error");
    }
  }

  async function submitPrepared() {
    if (!prepared) {
      return;
    }
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await signProductSubmitWithInjectedWallet({
        typedData: prepared.typedData,
        walletAddress: participantWallet ?? ""
      });
      const result = await onSubmitPrepared(task.taskId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: participantWallet ?? ""
      });
      setSubmission(result);
      onProofReady({
        taskId: task.taskId,
        orderId: task.orderId,
        orderTitle: order?.title ?? task.orderTitle,
        taskTitle: task.title,
        actionLabel: pluginPresentation.primaryActionLabel,
        status: result.status as TaskSubmissionProof["status"],
        txHash: result.txHash as TaskSubmissionProof["txHash"],
        signerWallet: participantWallet ?? "",
        payloadHash: prepared.payloadHash as TaskSubmissionProof["payloadHash"],
        stateMachineAddress: task.stateMachineAddress ?? order?.stateMachineAddress,
        evidence: [],
        proofRows: result.proofRows
      });
      setPhase("submitted");
      onSubmitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "签名提交失败");
      setPhase("error");
    }
  }

  return (
    <>
      <section className="workspace-block task-runtime" aria-labelledby="task-detail-title">
        <div className="section-heading">
          <UserRound aria-hidden="true" />
          <div>
            <h2 id="task-detail-title">{task.title}</h2>
            <p>{task.subtitle}</p>
          </div>
        </div>
        <div className="detail-grid">
          <Detail label="履约插槽" value={executorDisplay.performanceSlotLabel} />
          {executorDisplay.personaLabel ? <Detail label="业务身份标签" value={executorDisplay.personaLabel} /> : null}
          {executorDisplay.assigneeRoleLabel !== executorDisplay.performanceSlotLabel ? (
            <Detail label="任务角色" value={executorDisplay.assigneeRoleLabel} />
          ) : null}
          <Detail label="权限来源" value={executorDisplay.authorizationLabel} />
          <Detail label="执行方钱包" value={signalContainer.executingWalletLabel} />
          <Detail label="阶段" value={task.stageName} />
          <Detail label="截止时间" value={task.deadline} />
          <Detail label="影响" value={task.fundingImpact} />
          <Detail label="订单" value={order?.title ?? task.orderTitle} />
          {signalContainer.supplierTrustLabel ? (
            <Detail label="供应商背书" value={signalContainer.supplierTrustLabel} />
          ) : null}
          <Detail label="必填项" value={signalContainer.requiredSummary} />
          <Detail label="状态" value={display.label} />
        </div>
        <TaskContainerSummary summary={signalContainer} />
        {task.blockedReason ? (
          <p className="blocked-copy">{task.blockedReason}</p>
        ) : null}
        <div className={`task-runtime-status task-runtime-status-${display.state}`}>
          {display.state === "blocked" || display.state === "failed"
            ? <AlertTriangle aria-hidden="true" />
            : <CheckCircle2 aria-hidden="true" />}
          <span>{display.bucketLabel}</span>
        </div>
      </section>

      {addOnManifest ? (
        <ManifestAddOnPanel
          api={api}
          manifest={addOnManifest}
          order={order}
          participantWallet={participantWallet}
          source={source}
          task={task}
          onPrepareSubmit={onPrepareSubmit}
          onProofReady={onProofReady}
          onSubmitted={onSubmitted}
          onSubmitPrepared={onSubmitPrepared}
        />
      ) : plugin.render({
          task,
          state: runtimeState,
          onValueChange: updateValue,
          onConfirmationChange: updateConfirmation
        })}

      {usesExecutorPatchFlow ? (
        <ExecutorPatchPanel
          api={api}
          actionLabel={pluginPresentation.primaryActionLabel}
          order={order}
          participantWallet={participantWallet}
          source={source}
          task={task}
          targets={patchTargets}
          onProofReady={onProofReady}
          onSubmitted={onSubmitted}
        />
      ) : null}

      {usesResourcePatchFlow ? (
        <ResourcePatchPanel
          api={api}
          actionLabel={pluginPresentation.primaryActionLabel}
          order={order}
          participantWallet={participantWallet}
          source={source}
          task={task}
          targets={patchTargets}
          onProofReady={onProofReady}
          onSubmitted={onSubmitted}
        />
      ) : null}

      {!usesPatchFlow && !usesManifestFlow ? (
        <EvidencePanel
          api={api}
          order={order}
          participantWallet={participantWallet}
          source={source}
          task={evidenceTask}
          onProofReady={onProofReady}
        />
      ) : null}

      <section className="workspace-block" aria-labelledby="responsibility-title">
        <div className="section-heading compact">
          <ShieldCheck aria-hidden="true" />
          <h3 id="responsibility-title">履约责任确认</h3>
        </div>
        <ul className="responsibility-list">
          {task.responsibilityStatements.map((statement) => (
            <li key={statement.title}>
              <strong>{statement.title}</strong>
              <span>{statement.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {!usesPatchFlow && !usesManifestFlow ? (
        <section className="workspace-block submit-boundary" aria-labelledby="submit-boundary-title">
          <div className="section-heading">
            <Send aria-hidden="true" />
            <div>
              <h2 id="submit-boundary-title">提交确认</h2>
              <p>提交只通过参与者服务的预检和提交边界；本页面不直接发送链上交易。</p>
            </div>
          </div>

          {!validation.ok ? (
            <ul className="validation-list" aria-label="待完成事项">
              {validation.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <div className="submit-actions">
            <button
              className="primary-button"
              disabled={!validation.ok || phase === "preparing" || Boolean(prepared)}
              onClick={prepareSubmit}
              type="button"
            >
              {phase === "preparing" ? "正在准备" : "提交确认"}
            </button>
            <span>{prepared ? `准备编号 ${prepared.prepareId}` : "准备后需使用授权钱包签名"}</span>
          </div>

          {prepared ? (
            <div className="signature-box">
              <div>
                <WalletCards aria-hidden="true" />
                <span>将调用授权浏览器钱包签名参与者服务准备的签名请求；中继服务只广播签名，不代签业务动作。</span>
              </div>
              <dl className="proof-grid compact-proof">
                <ProofRow label="凭证指纹" value={prepared.payloadHash} />
                <ProofRow label="有效期" value={prepared.humanSummary?.validUntil ?? prepared.expiresAt} />
              </dl>
              <button
                className="primary-button"
                disabled={phase === "submitting" || !participantWallet}
                onClick={submitPrepared}
                type="button"
              >
                {phase === "submitting" ? "正在签名并提交" : "使用钱包签名并提交"}
              </button>
            </div>
          ) : null}

          {phase === "submitted" ? (
            <p className="notice-line">
              <CheckCircle2 aria-hidden="true" />
              <span>已提交，等待链上确认。</span>
            </p>
          ) : null}
          {error ? (
            <p className="blocked-copy">{error}</p>
          ) : null}
        </section>
      ) : null}

      <ProofPanel order={order} task={task} submissionProof={submissionProof} />
    </>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskContainerSummary({ summary }: { readonly summary: TaskSignalContainerSummary }) {
  return (
    <div className="signal-container-summary" aria-label="待办提交要素">
      <div className="signal-container-item">
        <strong>执行方钱包</strong>
        <span>{summary.executingWalletLabel}</span>
        <small>{summary.executingWalletSourceLabel}</small>
      </div>
      {summary.supplierTrustLabel ? (
        <div className={`signal-container-item signal-container-trust-${summary.supplierTrustTone}`}>
          <strong>供应商背书</strong>
          <span>{summary.supplierTrustLabel}</span>
          <small>{summary.supplierTrustTone === "danger" ? "暂停提交并联系订单负责人" : "提交前核对背书状态"}</small>
        </div>
      ) : null}
      <div className="signal-container-item">
        <strong>必填输入/凭证</strong>
        <span>{summary.requiredSummary}</span>
        <small>{summary.evidenceSummary}</small>
      </div>
      <div className="signal-container-item">
        <strong>证明</strong>
        <span>{summary.proofSummaryLabel}</span>
        <small>{summary.proofFingerprint ? `凭证指纹 ${summary.proofFingerprint}` : "提交后显示交易编号和指纹"}</small>
      </div>
    </div>
  );
}

function ManifestAddOnPanel({
  api,
  manifest,
  order,
  participantWallet,
  source,
  task,
  onPrepareSubmit,
  onProofReady,
  onSubmitted,
  onSubmitPrepared
}: {
  readonly api: ProductApiClient;
  readonly manifest: ParticipantAddOnManifestDTO;
  readonly order?: ProductOrderDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly onPrepareSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: () => void;
  readonly onSubmitPrepared: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
}) {
  const [state, setState] = useState<AddOnManifestRuntimeState>(() => createInitialAddOnManifestState(task, participantWallet));
  const [phase, setPhase] = useState<RuntimePhase>("idle");
  const [prepared, setPrepared] = useState<ManifestPreparedState | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setState(createInitialAddOnManifestState(task, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setError(undefined);
  }, [manifest, participantWallet, task]);

  function updateValue(inputId: string, value: string) {
    setPrepared(undefined);
    setError(undefined);
    setPhase("idle");
    setState((current) => ({
      ...current,
      values: {
        ...current.values,
        [inputId]: value
      }
    }));
  }

  function updateConfirmation(inputId: string, checked: boolean) {
    setPrepared(undefined);
    setError(undefined);
    setPhase("idle");
    setState((current) => ({
      ...current,
      confirmations: {
        ...current.confirmations,
        [inputId]: checked
      }
    }));
  }

  async function prepareAction(actionId: string) {
    const action = manifest.actions.find((item) => item.actionId === actionId);
    if (!action) {
      return;
    }
    const blockers = manifestActionBlockers({
      action,
      manifest,
      source,
      state,
      hasInjectedWallet: Boolean(getInjectedWalletProvider())
    });
    if (blockers.length > 0) {
      setError(blockers.join("；"));
      setPhase("error");
      return;
    }
    setPhase("preparing");
    setError(undefined);
    try {
      const prepare = buildAddOnManifestPrepareInput(action, state);
      if (prepare.actionKind === "submit_signal") {
        const nextPrepared = await onPrepareSubmit(task.taskId, prepare.input);
        setPrepared({ actionKind: "submit_signal", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      } else if (prepare.actionKind === "stage_executor_patch") {
        const nextPrepared = await api.prepareStageExecutorPatch(task.taskId, prepare.input);
        setPrepared({ actionKind: "stage_executor_patch", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      } else {
        const nextPrepared = await api.prepareStageResourcePatch(task.taskId, prepare.input);
        setPrepared({ actionKind: "stage_resource_patch", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      }
      setPhase("prepared");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "附加能力准备失败");
      setPhase("error");
    }
  }

  async function submitPreparedAction() {
    if (!prepared) {
      return;
    }
    setPhase("submitting");
    setError(undefined);
    try {
      if (prepared.actionKind === "submit_signal") {
        const signature = await signProductSubmitWithInjectedWallet({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.walletAddress
        });
        const result = await onSubmitPrepared(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          signature,
          walletAddress: prepared.input.walletAddress
        });
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.walletAddress,
          payloadHash: prepared.prepared.payloadHash,
          result
        }));
      } else if (prepared.actionKind === "stage_executor_patch") {
        const signature = await signTypedDataWithInjectedWallet({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.selectorWallet
        });
        const result = await api.submitStageExecutorPatch(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          selectorWallet: prepared.input.selectorWallet,
          typedData: prepared.prepared.typedData,
          signature,
          patch: prepared.prepared,
          ...(prepared.input.mode ? { mode: prepared.input.mode } : {}),
          ...(prepared.input.previousExecutorWallet ? { previousExecutorWallet: prepared.input.previousExecutorWallet } : {})
        });
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.selectorWallet,
          payloadHash: prepared.prepared.patchHash,
          result
        }));
      } else {
        const signature = await signTypedDataWithInjectedWallet({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.selectorWallet
        });
        const result = await api.submitStageResourcePatch(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          selectorWallet: prepared.input.selectorWallet,
          typedData: prepared.prepared.typedData,
          signature,
          patch: prepared.prepared
        });
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.selectorWallet,
          payloadHash: prepared.prepared.patchHash,
          result
        }));
      }
      setPhase("submitted");
      onSubmitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "签名提交失败");
      setPhase("error");
    }
  }

  return (
    <section className="workspace-block plugin-card addon-manifest-card" aria-labelledby="addon-manifest-title">
      <div className="plugin-heading">
        <div>
          <span className="overline">任务附加能力</span>
          <h3 id="addon-manifest-title">{manifest.title}</h3>
          <p>{manifest.summary}</p>
        </div>
        <span className="plugin-kind">{pluginPresentationForTask(task).kind}</span>
      </div>

      {manifest.pages.map((page) => (
        <div className="addon-manifest-page" key={page.pageId}>
          {page.summary ? <p className="notice-line"><ListChecks aria-hidden="true" /><span>{page.summary}</span></p> : null}
          {page.sections.map((section) => (
            <div className="plugin-inputs" key={section.sectionId}>
              <div className="plugin-heading compact">
                <div>
                  <h3>{section.title}</h3>
                  {section.summary ? <p>{section.summary}</p> : null}
                </div>
              </div>
              {section.components.map((component) => (
                <ManifestComponent
                  component={component}
                  key={component.componentId}
                  manifest={manifest}
                  state={state}
                  task={task}
                  onConfirmationChange={updateConfirmation}
                  onValueChange={updateValue}
                />
              ))}
            </div>
          ))}
        </div>
      ))}

      {manifest.actions.map((action) => {
        const validation = validateAddOnManifestAction(manifest, action, state);
        const blockers = manifestActionBlockers({
          action,
          manifest,
          source,
          state,
          hasInjectedWallet: Boolean(getInjectedWalletProvider())
        });
        const isPrepared = prepared?.actionId === action.actionId;
        return (
          <div className="addon-manifest-action" key={action.actionId}>
            {(!validation.ok || blockers.length > 0) && !isPrepared ? (
              <ul className="validation-list" aria-label={`${action.label}待完成事项`}>
                {[...validation.errors, ...blockers].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            <div className="submit-actions">
              <button
                className={action.primary === false ? "secondary-button" : "primary-button"}
                disabled={!validation.ok || blockers.length > 0 || phase === "preparing" || Boolean(prepared)}
                onClick={() => void prepareAction(action.actionId)}
                type="button"
              >
                {phase === "preparing" ? <RefreshCw className="spin" aria-hidden="true" /> : <WalletCards aria-hidden="true" />}
                {action.label}
              </button>
              <span>{action.actionKind === "submit_signal" ? manifestIntentLabel(action.intent) : "准备后需使用授权钱包签名"}</span>
            </div>
          </div>
        );
      })}

      {prepared ? (
        <div className="signature-box">
          <div>
            <WalletCards aria-hidden="true" />
            <span>浏览器钱包只签署当前附加能力动作；中继服务只广播签名，不代签业务动作。</span>
          </div>
          <dl className="proof-grid compact-proof">
            <ProofRow label="动作" value={prepared.actionLabel} />
            <ProofRow label="指纹" value={manifestPreparedHash(prepared)} />
          </dl>
          <button
            className="primary-button"
            disabled={phase === "submitting"}
            onClick={() => void submitPreparedAction()}
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
          <span>已提交，等待链上确认。</span>
        </p>
      ) : null}
      {error ? <p className="blocked-copy" role="alert">{error}</p> : null}
    </section>
  );
}

function ManifestComponent({
  component,
  manifest,
  state,
  task,
  onConfirmationChange,
  onValueChange
}: {
  readonly component: ParticipantAddOnManifestComponentDTO;
  readonly manifest: ParticipantAddOnManifestDTO;
  readonly state: AddOnManifestRuntimeState;
  readonly task: ProductTaskDTO;
  readonly onConfirmationChange: (inputId: string, checked: boolean) => void;
  readonly onValueChange: (inputId: string, value: string) => void;
}) {
  if (component.componentKind === "resource_requirements") {
    const resources = resourceRequirementDisplays(task);
    return resources.length > 0 ? (
      <div className="resource-requirement-list" aria-label={component.label}>
        <strong>{component.label}</strong>
        {resources.map((resource) => (
          <div className="resource-requirement" key={resource.resourceId}>
            <span>
              {resource.label}
              <small>{resource.required ? "必填" : "可选"}</small>
            </span>
            <p>{resource.description ?? resource.handleSummary}</p>
          </div>
        ))}
      </div>
    ) : null;
  }
  if (component.componentKind === "proof_rows") {
    return task.proofRows.length > 0 ? (
      <dl className="proof-grid compact-proof" aria-label={component.label}>
        {task.proofRows.map((row) => <ProofRow key={`${row.label}:${row.value}`} label={row.label} value={row.value} />)}
      </dl>
    ) : null;
  }
  if (!component.inputId) {
    return null;
  }
  const value = state.values[component.inputId] ?? "";
  const requiredLabel = component.required ? "必填" : "可选";
  if (component.componentKind === "confirmation") {
    return (
      <label className="plugin-check">
        <input
          checked={Boolean(state.confirmations[component.inputId])}
          onChange={(event) => onConfirmationChange(component.inputId!, event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          <strong>{component.label}</strong>
          <small>{requiredLabel}</small>
        </span>
      </label>
    );
  }
  if (component.componentKind === "textarea" || component.componentKind === "evidence_refs") {
    return (
      <label className="plugin-field">
        <span>
          {component.label}
          <small>{requiredLabel}</small>
        </span>
        <textarea
          aria-label={component.label}
          onChange={(event) => onValueChange(component.inputId!, event.currentTarget.value)}
          placeholder={component.placeholder ?? "输入链下引用、CID 或凭证指纹；多个值可换行"}
          rows={3}
          value={value}
        />
      </label>
    );
  }
  if (component.componentKind === "stage_select") {
    const targets = selectableTargetsForTask(task);
    const options = targets.length > 0
      ? targets.map((target) => ({ value: selectableTargetStageId(target), label: targetStageLabel(target), disabled: target.allowed === false }))
      : manifest.stageBindings.map((stageId) => ({ value: stageId, label: stageId }));
    return (
      <ManifestSelectField
        component={component}
        options={options}
        value={value}
        onValueChange={onValueChange}
      />
    );
  }
  if (component.componentKind === "select") {
    return (
      <ManifestSelectField
        component={component}
        options={component.options ?? []}
        value={value}
        onValueChange={onValueChange}
      />
    );
  }
  return (
    <label className="plugin-field">
      <span>
        {component.label}
        <small>{requiredLabel}</small>
      </span>
      <input
        aria-label={component.label}
        onChange={(event) => onValueChange(component.inputId!, event.currentTarget.value)}
        placeholder={component.placeholder ?? manifestInputPlaceholder(component.componentKind)}
        type={component.componentKind === "uri" || component.componentKind === "hash" || component.componentKind === "wallet" ? "text" : "text"}
        value={value}
      />
    </label>
  );
}

function ManifestSelectField({
  component,
  options,
  value,
  onValueChange
}: {
  readonly component: ParticipantAddOnManifestComponentDTO;
  readonly options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[];
  readonly value: string;
  readonly onValueChange: (inputId: string, value: string) => void;
}) {
  if (!component.inputId) {
    return null;
  }
  return (
    <label className="plugin-field">
      <span>
        {component.label}
        <small>{component.required ? "必填" : "可选"}</small>
      </span>
      <select
        aria-label={component.label}
        onChange={(event) => onValueChange(component.inputId!, event.currentTarget.value)}
        value={value}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function manifestActionBlockers(input: {
  readonly action: ParticipantAddOnManifestDTO["actions"][number];
  readonly manifest: ParticipantAddOnManifestDTO;
  readonly source?: ProductApiSource;
  readonly state: AddOnManifestRuntimeState;
  readonly hasInjectedWallet: boolean;
}): readonly string[] {
  const blockers: string[] = [];
  const trustBlocker = supplierTrustBlocker(input.state.task);
  if (trustBlocker) {
    blockers.push(trustBlocker);
  }
  if (input.action.actionKind === "stage_executor_patch" || input.action.actionKind === "stage_resource_patch") {
    if (input.source?.kind !== "real") {
      blockers.push(input.action.actionKind === "stage_executor_patch"
        ? "参与者服务未连接，不能提交履约者选择。"
        : "参与者服务未连接，不能提交资源补充。");
    }
    if (input.source?.kind === "real" && !input.hasInjectedWallet) {
      blockers.push("未检测到浏览器钱包，不能创建业务签名。");
    }
  }
  return blockers;
}

function manifestPreparedHash(prepared: ManifestPreparedState): string {
  if (prepared.actionKind === "submit_signal") {
    return prepared.prepared.payloadHash;
  }
  return prepared.prepared.patchHash;
}

function manifestSubmissionProof(input: {
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO;
  readonly actionLabel: string;
  readonly signerWallet: string;
  readonly payloadHash: string;
  readonly result: ProductSubmission | StageExecutorPatchSubmissionDTO | StageResourcePatchSubmissionDTO;
}): TaskSubmissionProof {
  return {
    taskId: input.task.taskId,
    orderId: input.task.orderId,
    orderTitle: input.order?.title ?? input.task.orderTitle,
    taskTitle: input.task.title,
    actionLabel: input.actionLabel,
    status: input.result.status as TaskSubmissionProof["status"],
    txHash: input.result.txHash as TaskSubmissionProof["txHash"],
    blockNumber: input.result.blockNumber,
    signerWallet: input.signerWallet,
    payloadHash: input.payloadHash as TaskSubmissionProof["payloadHash"],
    stateMachineAddress: input.task.stateMachineAddress ?? input.order?.stateMachineAddress,
    evidence: [],
    proofRows: input.result.proofRows
  };
}

function manifestInputPlaceholder(kind: ParticipantAddOnManifestComponentDTO["componentKind"]): string {
  switch (kind) {
    case "wallet":
      return "0x...";
    case "uri":
      return "ipfs://... / ar://... / cid:...";
    case "hash":
      return "0x...";
    case "text":
    default:
      return "填写链下业务摘要或凭证引用";
  }
}

function ExecutorPatchPanel({
  api,
  actionLabel,
  order,
  participantWallet,
  source,
  task,
  targets,
  onProofReady,
  onSubmitted
}: {
  readonly api: ProductApiClient;
  readonly actionLabel: string;
  readonly order?: ProductOrderDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly targets: readonly SelectableTargetStageDTO[];
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: () => void;
}) {
  const [draft, setDraft] = useState<ExecutorPatchDraftState>(() => initialExecutorPatchDraft(task, targets, participantWallet));
  const [phase, setPhase] = useState<PatchPhase>("idle");
  const [prepared, setPrepared] = useState<PreparedStageExecutorPatchDTO | undefined>();
  const [submission, setSubmission] = useState<StageExecutorPatchSubmissionDTO | undefined>();
  const [error, setError] = useState<string | undefined>();
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
    hasInjectedWallet: Boolean(getInjectedWalletProvider())
  });
  const canPrepare = blockers.length === 0 && phase !== "preparing" && phase !== "submitting" && !prepared;

  useEffect(() => {
    setDraft(initialExecutorPatchDraft(task, targets, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
  }, [participantWallet, targets, task]);

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
    setPhase("preparing");
    setError(undefined);
    try {
      const nextPrepared = await api.prepareStageExecutorPatch(task.taskId, {
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
      setPrepared(nextPrepared);
      setPhase("prepared");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "履约者选择准备失败");
      setPhase("error");
    }
  }

  async function submitExecutorPatch() {
    if (!prepared) {
      return;
    }
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await signTypedDataWithInjectedWallet({
        typedData: prepared.typedData,
        walletAddress: draft.selectorWallet.trim()
      });
      const result = await api.submitStageExecutorPatch(task.taskId, {
        prepareId: prepared.prepareId,
        selectorWallet: draft.selectorWallet.trim(),
        typedData: prepared.typedData,
        signature,
        patch: prepared,
        mode: draft.mode,
        ...(draft.previousExecutor.trim() ? { previousExecutorWallet: draft.previousExecutor.trim() } : {}),
        ...(draft.previousExecutorSignature.trim() ? { previousExecutorSignature: draft.previousExecutorSignature.trim() } : {})
      });
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
      setPhase("submitted");
      onSubmitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "签名提交失败");
      setPhase("error");
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
            disabled={phase === "submitting" || !draft.selectorWallet.trim() || (selectedMode?.requiresPreviousExecutorSignature === true && !draft.previousExecutorSignature.trim())}
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

function ResourcePatchPanel({
  api,
  actionLabel,
  order,
  participantWallet,
  source,
  task,
  targets,
  onProofReady,
  onSubmitted
}: {
  readonly api: ProductApiClient;
  readonly actionLabel: string;
  readonly order?: ProductOrderDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly targets: readonly SelectableTargetStageDTO[];
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: () => void;
}) {
  const [draft, setDraft] = useState<ResourcePatchDraftState>(() => initialResourcePatchDraft(task, targets, participantWallet));
  const [phase, setPhase] = useState<PatchPhase>("idle");
  const [prepared, setPrepared] = useState<PreparedStageResourcePatchDTO | undefined>();
  const [submission, setSubmission] = useState<StageResourcePatchSubmissionDTO | undefined>();
  const [error, setError] = useState<string | undefined>();
  const selectedTarget = targets.find((target) => selectableTargetStageId(target) === draft.targetStageId) ?? targets[0];
  const resourceOptions = targetResourceOptions(task, selectedTarget);
  const blockers = resourcePatchBlockers({
    draft,
    selectedTarget,
    source,
    task,
    participantWallet,
    hasInjectedWallet: Boolean(getInjectedWalletProvider())
  });
  const canPrepare = blockers.length === 0 && phase !== "preparing" && phase !== "submitting" && !prepared;

  useEffect(() => {
    setDraft(initialResourcePatchDraft(task, targets, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setError(undefined);
  }, [participantWallet, targets, task]);

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
      policyHash: next.policyHash,
      visibility: next.visibility
    });
  }

  function updateResourceKey(resourceKey: string) {
    const option = resourceOptions.find((resource) => resource.resourceKey === resourceKey);
    updateDraft({
      resourceKey,
      ...(option?.manifestURI ? { manifestURI: option.manifestURI } : {}),
      ...(option?.manifestHash ? { manifestHash: option.manifestHash } : {}),
      ...(option?.policyHash ? { policyHash: option.policyHash } : {}),
      ...(option?.visibility ? { visibility: option.visibility } : {})
    });
  }

  async function prepareResourcePatch() {
    if (!canPrepare) {
      return;
    }
    setPhase("preparing");
    setError(undefined);
    try {
      const nextPrepared = await api.prepareStageResourcePatch(task.taskId, {
        selectorWallet: draft.selectorWallet.trim(),
        targetStageId: draft.targetStageId,
        resourceKey: draft.resourceKey.trim(),
        manifestURI: draft.manifestURI.trim(),
        manifestHash: draft.manifestHash.trim(),
        policyHash: draft.policyHash.trim()
      });
      setPrepared(nextPrepared);
      setPhase("prepared");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "资源补充准备失败");
      setPhase("error");
    }
  }

  async function submitResourcePatch() {
    if (!prepared) {
      return;
    }
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await signTypedDataWithInjectedWallet({
        typedData: prepared.typedData,
        walletAddress: draft.selectorWallet.trim()
      });
      const result = await api.submitStageResourcePatch(task.taskId, {
        prepareId: prepared.prepareId,
        selectorWallet: draft.selectorWallet.trim(),
        typedData: prepared.typedData,
        signature,
        patch: prepared
      });
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
      setPhase("submitted");
      onSubmitted?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "签名提交失败");
      setPhase("error");
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

        <label className="plugin-field">
          <span>
            可见性
            <small>资源权限</small>
          </span>
          <select
            aria-label="可见性"
            onChange={(event) => updateDraft({ visibility: event.currentTarget.value as ResourcePatchDraftState["visibility"] })}
            value={draft.visibility}
          >
            <option value="protected">受保护</option>
            <option value="private">私密</option>
            <option value="public">公开</option>
          </select>
        </label>
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
            disabled={phase === "submitting" || !draft.selectorWallet.trim()}
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

function ProofRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="proof-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
    resourceKey: resource?.resourceKey ?? "resource_1",
    manifestURI: resource?.manifestURI ?? "",
    manifestHash: resource?.manifestHash ?? "",
    policyHash: resource?.policyHash ?? "",
    visibility: resource?.visibility ?? "protected"
  };
}

interface TargetResourceOption {
  readonly resourceKey: string;
  readonly label: string;
  readonly manifestURI?: string;
  readonly manifestHash?: string;
  readonly policyHash?: string;
  readonly visibility?: "public" | "protected" | "private";
}

function targetResourceOptions(task: ProductTaskDTO, target: SelectableTargetStageDTO | undefined): readonly TargetResourceOption[] {
  const resources = target?.resourceRequirements ??
    target?.effectiveResourceRequirements ??
    target?.effectiveFileResources ??
    target?.fileResources;
  const entries = resourceEntries(resources);
  if (entries.length > 0) {
    return entries.map(([resourceKey, value]) => {
      const objectValue = typeof value === "object" && value !== null ? value : undefined;
      const key = cleanString(objectValue?.resourceKey) ?? cleanString(objectValue?.resourceId) ?? resourceKey;
      return {
        resourceKey: key,
        label: cleanString(objectValue?.label) ?? cleanString(objectValue?.title) ?? cleanString(objectValue?.name) ?? key,
        ...(cleanString(objectValue?.manifestURI) ? { manifestURI: cleanString(objectValue?.manifestURI) } : {}),
        ...(cleanString(objectValue?.manifestHash) ? { manifestHash: cleanString(objectValue?.manifestHash) } : {}),
        ...(cleanString(objectValue?.accessPolicy?.policyHash) ? { policyHash: cleanString(objectValue?.accessPolicy?.policyHash) } : {}),
        ...(normalizeVisibility(objectValue?.visibility) ? { visibility: normalizeVisibility(objectValue?.visibility) } : {})
      };
    });
  }
  const taskResources = resourceRequirementDisplays(task);
  if (taskResources.length > 0) {
    return taskResources.map((resource) => ({
      resourceKey: resource.resourceId,
      label: resource.label,
      visibility: resource.visibility === "unknown" ? "protected" : resource.visibility
    }));
  }
  return task.requiredEvidence.map((label, index) => ({
    resourceKey: `resource_${index + 1}`,
    label,
    visibility: "protected"
  }));
}

function resourceEntries(
  resources: SelectableTargetStageDTO["resourceRequirements"] |
    SelectableTargetStageDTO["effectiveResourceRequirements"] |
    SelectableTargetStageDTO["effectiveFileResources"] |
    SelectableTargetStageDTO["fileResources"] |
    undefined
): readonly (readonly [string, FileResourceHandleDTO | null | undefined])[] {
  if (!resources) {
    return [];
  }
  if (Array.isArray(resources)) {
    return resources.map((resource, index) => [
      typeof resource.resourceKey === "string" && resource.resourceKey.trim()
        ? resource.resourceKey
        : typeof resource.resourceId === "string" && resource.resourceId.trim()
          ? resource.resourceId
          : `resource_${index + 1}`,
      resource
    ] as const);
  }
  return Object.entries(resources);
}

function executorPatchPreviousExecutor(
  mode: ExecutorPatchModeOptionDTO | undefined,
  target: SelectableTargetStageDTO | undefined
): string {
  return cleanString(mode?.previousExecutor) ??
    cleanString(mode?.previousExecutorWallet) ??
    cleanString(target?.previousExecutor) ??
    cleanString(target?.previousExecutorWallet) ??
    cleanString(target?.currentExecutorWallet) ??
    cleanString(target?.executorOverlay?.previousExecutor) ??
    cleanString(target?.executorOverlay?.previousExecutorWallet) ??
    cleanString(target?.executorOverlay?.activeExecutorWallet) ??
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
  readonly selectedMode?: ExecutorPatchModeOptionDTO;
  readonly selectedTarget?: SelectableTargetStageDTO;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly participantWallet?: string;
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
  const trustBlocker = supplierTrustBlocker(input.task);
  if (trustBlocker) {
    blockers.push(trustBlocker);
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

function resourcePatchBlockers(input: {
  readonly draft: ResourcePatchDraftState;
  readonly selectedTarget?: SelectableTargetStageDTO;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly participantWallet?: string;
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
  const trustBlocker = supplierTrustBlocker(input.task);
  if (trustBlocker) {
    blockers.push(trustBlocker);
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

function executorPatchStatusText(
  submission: StageExecutorPatchSubmissionDTO | undefined,
  fallbackMode: ProductExecutorPatchMode
): string {
  const label = executorPatchModeLabel(submission?.mode ?? fallbackMode);
  if (submission?.status === "confirmed") {
    return `${label}已确认。`;
  }
  if (submission?.status === "indexing") {
    return "已提交，等待链上确认。";
  }
  return "已提交，等待链上确认。";
}

function resourcePatchStatusText(submission: StageResourcePatchSubmissionDTO | undefined): string {
  if (submission?.status === "confirmed") {
    return "资源补充已确认。";
  }
  if (submission?.status === "indexing") {
    return "已提交，等待链上确认。";
  }
  return "已提交，等待链上确认。";
}

function looksLikeHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/u.test(value.trim());
}

function isContentAddressedReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("ipfs://") ||
    trimmed.startsWith("ar://") ||
    trimmed.startsWith("cid:") ||
    trimmed.startsWith("bafy") ||
    trimmed.startsWith("urn:");
}

function normalizeVisibility(value: unknown): "public" | "protected" | "private" | undefined {
  return value === "public" || value === "protected" || value === "private" ? value : undefined;
}

function cleanString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
