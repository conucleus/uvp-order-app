import {
  AlertTriangle,
  CheckCircle2,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { ProductApiSource } from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import type { TaskSubmissionProof } from "../task-model";
import { addOnManifestForTask, selectableTargetsForTask } from "./model/addOnTypes";
import {
  createInitialTaskPluginState,
  pluginForTask,
  pluginPresentationForTask,
  type PrepareSubmitInput,
  type TaskPluginState
} from "./plugins/pluginRuntime";
import { useTaskScopeGuard } from "./model/taskScope";
import { signalContainerForTask } from "./model/signalContainer";
import { formatDeadlineUtc, submitSignExpectation } from "./model/taskUtils";
import { taskExecutorDisplay } from "./model/taskPresentation";
import { taskDisplay } from "./model/taskStatus";
import {
  isTerminalSubmissionEnvelope,
  submissionFailureText,
  submissionPendingText
} from "./submission/submissionEnvelope";
import type {
  PreparedTaskSubmit,
  ProductSubmission,
  RuntimePhase,
  SubmitPreparedInput
} from "./submission/types";
import { Detail, TaskContainerSummary } from "./components/TaskDetailBlocks";
import { ProofRow } from "./components/ProofRow";
import { ManifestAddOnPanel } from "./components/ManifestAddOnPanel";
import { ExecutorPatchPanel } from "./components/ExecutorPatchPanel";
import { ResourcePatchPanel } from "./components/ResourcePatchPanel";
import "./components/taskRuntime.css";

export interface TaskPluginHostProps {
  readonly actions: OrderAppActions;
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO | undefined;
  readonly participantWallet?: string | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly standardEvidencePanel?: ReactNode | undefined;
  /**
   * 凭证面板持有提交边界（任务有 evidenceSpec/资源文件槽位，由调用方用
   * planTaskEvidence 同一单源判定——tasks/ 不得反向 import evidence/，
   * 导入边界由 importBoundaries.test 强制）。为真时本组件不渲染自带的
   * "提交确认"边界：两个独立 prepareId/phase 同屏互不知情，且插件边界
   * 校验不含槽位，会放出直出服务端 400 的第二提交入口。
   */
  readonly evidenceSubmissionOwned?: boolean | undefined;
  readonly onPrepareSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: (() => void) | undefined;
  readonly onSubmitPrepared: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
}

export function TaskPluginHost({
  actions,
  task,
  order,
  participantWallet,
  source,
  standardEvidencePanel,
  evidenceSubmissionOwned,
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
  const { scopeKey: taskScopeKey, taskScopeRef } = useTaskScopeGuard(task);
  const [state, setState] = useState<TaskPluginState>(() => createInitialTaskPluginState(task, participantWallet));
  const [phase, setPhase] = useState<RuntimePhase>("idle");
  const [prepared, setPrepared] = useState<PreparedTaskSubmit | undefined>();
  const [submission, setSubmission] = useState<ProductSubmission | undefined>();
  const [submittedNotice, setSubmittedNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  // 同步互斥（EvidencePanel submitInflightRef 同款）：签名+提交是长链路，
  // 按钮 pending 禁用要等状态落盘重渲染才生效，ref 同步挡住重渲染前的
  // 第二次点击；ref 在请求收尾即释放，终态后的重投由 submitted 相位闸承担。
  const submitInflightRef = useRef(false);

  useEffect(() => {
    setState(createInitialTaskPluginState(task, participantWallet));
    setPhase("idle");
    setPrepared(undefined);
    setSubmission(undefined);
    setSubmittedNotice(undefined);
    setError(undefined);
    // 重置按稳定标识（任务作用域）触发：投影刷新每次产生新 task 对象，
    // 按引用重置会在刷新时清掉用户编辑中的输入（EvidencePanel 同口径）。
  }, [participantWallet, taskScopeKey]);

  const runtimeState = useMemo<TaskPluginState>(() => ({
    ...state,
    task,
    walletAddress: participantWallet
  }), [participantWallet, state, task]);
  const validation = plugin.validate(runtimeState);
  const display = taskDisplay(task);
  const patchTargets = useMemo(() => selectableTargetsForTask(task), [task]);
  const usesManifestFlow = Boolean(addOnManifest);
  const usesExecutorPatchFlow = !usesManifestFlow && plugin.kind === "stage_executor_patch" && patchTargets.length > 0;
  const usesResourcePatchFlow = !usesManifestFlow && plugin.kind === "stage_resource_patch" && patchTargets.length > 0;
  const usesPatchFlow = usesExecutorPatchFlow || usesResourcePatchFlow;
  // 凭证槽位（evidenceSpec 或资源要求）存在时，EvidencePanel 自带完整的
  // 准备→签名→提交边界且校验槽位；与插件"提交确认"边界互斥渲染（判定由
  // 调用方以 planTaskEvidence 同一单源传入）。
  const usesEvidenceFlow = !usesPatchFlow && !usesManifestFlow && evidenceSubmissionOwned === true;

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
    const requestScopeKey = taskScopeRef.current;
    setPhase("preparing");
    setError(undefined);
    try {
      const result = await onPrepareSubmit(task.taskId, plugin.buildPrepareSubmit(runtimeState));
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setPrepared(result);
      setPhase("prepared");
    } catch (caught) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "提交准备失败");
      setPhase("error");
    }
  }

  async function submitPrepared() {
    if (!prepared || phase === "submitted" || submitInflightRef.current) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    submitInflightRef.current = true;
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await actions.signProductSubmit({
        typedData: prepared.typedData,
        walletAddress: participantWallet ?? "",
        // 域校验预期来自部署配置注入（独立来源），缺配置即拒签，不读同一
        // BFF 响应里的地址，防被攻陷 BFF 换域让钱包照签。
        ...submitSignExpectation()
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      const result = await onSubmitPrepared(task.taskId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: participantWallet ?? ""
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
        actionLabel: pluginPresentation.primaryActionLabel,
        status: result.status as TaskSubmissionProof["status"],
        txHash: result.txHash as TaskSubmissionProof["txHash"],
        signerWallet: participantWallet ?? "",
        payloadHash: prepared.payloadHash as TaskSubmissionProof["payloadHash"],
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
          <Detail label="截止时间" value={formatDeadlineUtc(task.deadline)} />
          <Detail label="影响" value={task.fundingImpact} />
          <Detail label="订单" value={order?.title ?? task.orderTitle} />
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
          actions={actions}
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
          onConfirmationChange: updateConfirmation,
          submissionOwnedByEvidenceFlow: usesEvidenceFlow
        })}

      {usesExecutorPatchFlow ? (
        <ExecutorPatchPanel
          actions={actions}
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
          actions={actions}
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

      {usesEvidenceFlow ? standardEvidencePanel : null}

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

      {!usesPatchFlow && !usesManifestFlow && !usesEvidenceFlow ? (
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
                disabled={phase === "submitting" || phase === "submitted" || !participantWallet}
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
              <span>{submittedNotice ?? "已提交，等待链上确认。"}</span>
            </p>
          ) : null}
          {error ? (
            <p className="blocked-copy" role="alert">{error}</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
