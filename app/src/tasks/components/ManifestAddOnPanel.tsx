import { CheckCircle2, ListChecks, RefreshCw, Send, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ParticipantAddOnManifestComponentDTO,
  ParticipantAddOnManifestDTO,
  ProductOrderDTO,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import type {
  PreparedStageExecutorPatchDTO,
  PreparedStageResourcePatchDTO,
  ProductApiSource,
  StageExecutorPatchSubmissionDTO,
  StageResourcePatchSubmissionDTO
} from "../../api/productApi";
import type { OrderAppActions } from "../../actions/orderAppActions";
import type { TaskSubmissionProof } from "../../task-model";
import { stableStringify } from "../../shared/canonical";
import {
  resourceRequirementDisplays,
  selectableTargetsForTask,
  targetStageId as selectableTargetStageId,
  targetStageLabel
} from "../model/addOnTypes";
import {
  buildAddOnManifestPrepareInput,
  createInitialAddOnManifestState,
  manifestBoundValue,
  manifestIntentLabel,
  validateAddOnManifestAction,
  type AddOnManifestRuntimeState,
  type AddOnManifestPrepareInput
} from "../plugins/addOnManifestRuntime";
import { pluginPresentationForTask, type PrepareSubmitInput } from "../plugins/pluginRuntime";
import { useTaskScopeGuard } from "../model/taskScope";
import { stagePatchSignExpectation, submitSignExpectation } from "../model/taskUtils";
import { isTerminalSubmissionEnvelope, submissionFailureText, submissionPendingText } from "../submission/submissionEnvelope";
import type { PreparedTaskSubmit, ProductSubmission, RuntimePhase, SubmitPreparedInput } from "../submission/types";
import { ProofRow } from "./ProofRow";

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

export function ManifestAddOnPanel({
  actions,
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
  readonly actions: OrderAppActions;
  readonly manifest: ParticipantAddOnManifestDTO;
  readonly order?: ProductOrderDTO | undefined;
  readonly participantWallet?: string | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly task: ProductTaskDTO;
  readonly onPrepareSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: (() => void) | undefined;
  readonly onSubmitPrepared: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
}) {
  const [state, setState] = useState<AddOnManifestRuntimeState>(() => createInitialAddOnManifestState(task, participantWallet));
  const { scopeKey: taskScopeKey, taskScopeRef } = useTaskScopeGuard(task);
  const [phase, setPhase] = useState<RuntimePhase>("idle");
  const [prepared, setPrepared] = useState<ManifestPreparedState | undefined>();
  const [submittedNotice, setSubmittedNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  // 交接（handoff）模式的原履约者加签：签名对象是 prepare 返回的补丁
  // typedData，只能在 prepare 之后填写，提交前与服务端强制口径对齐。
  const [previousExecutorSignature, setPreviousExecutorSignature] = useState("");
  // 同步互斥（EvidencePanel submitInflightRef 同款）：重渲染前的第二次点击
  // 由 ref 挡住；终态后的重投由 submitted 相位闸承担。
  const submitInflightRef = useRef(false);
  // manifest 每次投影刷新都是新对象：按内容身份（稳定序列化）做重置依据，
  // 同内容的刷新不重置；内容真正变化（动作/组件集变了）才重置表单。
  const manifestKey = useMemo(() => stableStringify(manifest), [manifest]);

  useEffect(() => {
    setState(createInitialAddOnManifestState(task, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmittedNotice(undefined);
    setError(undefined);
    setPreviousExecutorSignature("");
    // 重置依赖稳定标识（任务作用域 + manifest 内容身份）而不是对象引用：
    // 投影刷新每次产生新对象，按引用重置会清掉用户编辑中的输入。
  }, [manifestKey, participantWallet, taskScopeKey]);

  // prepared 的 handoff 加签可能由 manifest 声明的输入绑定携带（签名
  // 粘贴进表单），否则用本地签名框的值；两者都空时提交按钮保持禁用。
  const preparedAction = prepared ? manifest.actions.find((item) => item.actionId === prepared.actionId) : undefined;
  const handoffSignatureRequired = prepared?.actionKind === "stage_executor_patch" && prepared.input.mode === "handoff";
  const effectivePreviousExecutorSignature = handoffSignatureRequired && preparedAction
    ? manifestBoundValue(preparedAction, state, "previousExecutorSignature") || previousExecutorSignature.trim()
    : handoffSignatureRequired
      ? previousExecutorSignature.trim()
      : "";

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
      hasInjectedWallet: actions.hasInjectedWallet()
    });
    if (blockers.length > 0) {
      setError(blockers.join("；"));
      setPhase("error");
      return;
    }
    setPhase("preparing");
    setError(undefined);
    const requestScopeKey = taskScopeRef.current;
    try {
      const prepare = buildAddOnManifestPrepareInput(action, state);
      if (prepare.actionKind === "submit_signal") {
        const nextPrepared = await onPrepareSubmit(task.taskId, prepare.input);
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        setPrepared({ actionKind: "submit_signal", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      } else if (prepare.actionKind === "stage_executor_patch") {
        const nextPrepared = await actions.prepareStageExecutorPatch(task.taskId, prepare.input);
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        setPrepared({ actionKind: "stage_executor_patch", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      } else {
        const nextPrepared = await actions.prepareStageResourcePatch(task.taskId, prepare.input);
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        setPrepared({ actionKind: "stage_resource_patch", actionId, actionLabel: action.label, input: prepare.input, prepared: nextPrepared });
      }
      setPhase("prepared");
    } catch (caught) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "附加能力准备失败");
      setPhase("error");
    }
  }

  async function submitPreparedAction() {
    if (!prepared || phase === "submitted" || submitInflightRef.current) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    submitInflightRef.current = true;
    setPhase("submitting");
    setError(undefined);
    try {
      let result: ProductSubmission | StageExecutorPatchSubmissionDTO | StageResourcePatchSubmissionDTO;
      if (prepared.actionKind === "submit_signal") {
        const signature = await actions.signProductSubmit({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.walletAddress,
          // prepared 记录声明的提交方参与签名前交叉核对（同 EvidencePanel
          // submit 边界）：换签名对象在调钱包前拒绝。
          preparedSubmitters: [prepared.prepared.submitter],
          // 预期值来自部署配置注入（独立来源），缺配置即拒签（同 submit 边界）。
          ...submitSignExpectation()
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        result = await onSubmitPrepared(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          signature,
          walletAddress: prepared.input.walletAddress
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.walletAddress,
          payloadHash: prepared.prepared.payloadHash,
          result
        }));
      } else if (prepared.actionKind === "stage_executor_patch") {
        const signature = await actions.signTypedData({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.selectorWallet,
          ...stagePatchSignExpectation()
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        result = await actions.submitStageExecutorPatch(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          selectorWallet: prepared.input.selectorWallet,
          typedData: prepared.prepared.typedData,
          signature,
          patch: prepared.prepared,
          ...(prepared.input.mode ? { mode: prepared.input.mode } : {}),
          ...(prepared.input.previousExecutorWallet ? { previousExecutorWallet: prepared.input.previousExecutorWallet } : {}),
          // handoff 必须回呈原履约者对同一补丁 typedData 的加签（服务端
          // signatureForPreviousExecutor 强制），与内置 ExecutorPatchPanel
          // 同一边界；缺失时按钮已禁用，这里再 fail-closed 一次。
          ...(prepared.input.mode === "handoff" && effectivePreviousExecutorSignature
            ? { previousExecutorSignature: effectivePreviousExecutorSignature }
            : {})
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.selectorWallet,
          payloadHash: prepared.prepared.patchHash,
          result
        }));
      } else {
        const signature = await actions.signTypedData({
          typedData: prepared.prepared.typedData,
          walletAddress: prepared.input.selectorWallet,
          ...stagePatchSignExpectation()
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        result = await actions.submitStageResourcePatch(task.taskId, {
          prepareId: prepared.prepared.prepareId,
          selectorWallet: prepared.input.selectorWallet,
          typedData: prepared.prepared.typedData,
          signature,
          patch: prepared.prepared
        });
        if (taskScopeRef.current !== requestScopeKey) {
          return;
        }
        onProofReady(manifestSubmissionProof({
          task,
          order,
          actionLabel: prepared.actionLabel,
          signerWallet: prepared.input.selectorWallet,
          payloadHash: prepared.prepared.patchHash,
          result
        }));
      }
      const failure = submissionFailureText(result.status, result.errorCode);
      if (failure) {
        if (isTerminalSubmissionEnvelope(result.status)) {
          // 终态清 prepared 连带清 handoff 本地加签：旧签名只对已消费的
          // typedData 有效，残留会在重新准备后被原样提交到新补丁上。
          setPrepared(undefined);
          setPreviousExecutorSignature("");
        }
        setError(failure);
        setPhase("error");
        return;
      }
      setSubmittedNotice(submissionPendingText(result.status));
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
          hasInjectedWallet: actions.hasInjectedWallet()
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
          {handoffSignatureRequired ? (
            <label className="plugin-field">
              <span>
                原履约者签名
                <small>交接履约者</small>
              </span>
              <input
                aria-label="原履约者签名"
                onChange={(event) => setPreviousExecutorSignature(event.currentTarget.value)}
                placeholder="0x..."
                value={previousExecutorSignature}
              />
            </label>
          ) : null}
          <button
            className="primary-button"
            disabled={phase === "submitting" || phase === "submitted" || (handoffSignatureRequired && !effectivePreviousExecutorSignature.trim())}
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
          <span>{submittedNotice ?? "已提交，等待链上确认。"}</span>
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
  readonly source?: ProductApiSource | undefined;
  readonly state: AddOnManifestRuntimeState;
  readonly hasInjectedWallet: boolean;
}): readonly string[] {
  const blockers: string[] = [];
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
  readonly order?: ProductOrderDTO | undefined;
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
