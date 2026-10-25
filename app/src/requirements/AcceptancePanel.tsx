/* 验收提交：只把 ProductTaskDTO.submitSignals 当作候选信号来源，验收者读
 * 要求包句柄后显式选一个 signalName，再走现有 prepare-submit/submit 与钱包
 * 签名闸门；迁移契约的 intent 仍按 confirm_stage 传输（V1 不用它裁决成败，
 * 裁决只在 signalName），evidenceIds 传空数组由服务端按必填槽位裁决。本模块
 * 只读 V1 要求包/句柄与验收信号，不读 v0 产品 schema 字段，
 * 也不猜 accepted/rejected。
 */
import { FileSearch, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductSubmissionDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { OrderAppActions } from "../actions/orderAppActions";
import {
  ProductApiError,
  type PreparedTaskSubmitDTO,
  type ProductApiClient
} from "../api/productApi";
import { shortWallet } from "../auth/participant";
import { taskSubmitSignInput } from "../task-model";
import {
  isTerminalSubmissionEnvelope,
  submissionFailureText,
  submissionPendingText
} from "../tasks/submission/submissionEnvelope";

const PREPARE_SUBMIT_INTENT = "confirm_stage" as const;

export interface AcceptancePanelProps {
  readonly api: ProductApiClient;
  readonly actions: OrderAppActions;
  readonly taskId?: string | undefined;
  readonly walletAddress?: string | undefined;
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
  readonly onSubmitted?: (() => void) | undefined;
}

type TaskState =
  | { readonly status: "no_task" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly task: ProductTaskDTO };

type PreparePhase = "idle" | "preparing" | "prepared" | "submitting" | "done";

export function AcceptancePanel({
  api,
  actions,
  taskId,
  walletAddress,
  onSessionExpired,
  onSubmitted
}: AcceptancePanelProps) {
  const [taskState, setTaskState] = useState<TaskState>({ status: taskId ? "loading" : "no_task" });
  const [selectedSignal, setSelectedSignal] = useState<string | undefined>(undefined);
  const [prepared, setPrepared] = useState<PreparedTaskSubmitDTO | undefined>(undefined);
  const [phase, setPhase] = useState<PreparePhase>("idle");
  const [submission, setSubmission] = useState<ProductSubmissionDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!taskId) {
      setTaskState({ status: "no_task" });
      return undefined;
    }
    let active = true;
    setTaskState({ status: "loading" });
    setSelectedSignal(undefined);
    setPrepared(undefined);
    setPhase("idle");
    setSubmission(undefined);
    setError(undefined);
    void api
      .getTask(taskId, walletAddress ? { walletAddress } : {})
      .then((task) => {
        if (active) {
          setTaskState({ status: "ready", task });
        }
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        if (onSessionExpired?.(loadError)) {
          return;
        }
        setTaskState({ status: "error", message: taskFailureCopy(loadError) });
      });
    return () => {
      active = false;
    };
  }, [api, taskId, walletAddress]);

  const task = taskState.status === "ready" ? taskState.task : undefined;
  const signals = task?.submitSignals ?? [];
  const busy = phase === "preparing" || phase === "submitting";
  const wallet = walletAddress?.trim();

  function resetPrepared() {
    setPrepared(undefined);
    setPhase("idle");
    setSubmission(undefined);
    setError(undefined);
  }

  function handleSelectSignal(signalName: string) {
    resetPrepared();
    setSelectedSignal(signalName);
  }

  async function handlePrepare() {
    if (!task || !selectedSignal || !wallet || busy) {
      return;
    }
    setPhase("preparing");
    setError(undefined);
    setSubmission(undefined);
    try {
      const next = await actions.prepareTaskSubmit(task.taskId, {
        evidenceIds: [],
        walletAddress: wallet,
        intent: PREPARE_SUBMIT_INTENT,
        signalName: selectedSignal
      });
      setPrepared(next);
      setPhase("prepared");
    } catch (prepareError) {
      if (onSessionExpired?.(prepareError)) {
        return;
      }
      setPhase("idle");
      setError(submitFailureCopy(prepareError));
    }
  }

  async function handleSignAndSubmit() {
    if (!task || !prepared || !wallet || busy) {
      return;
    }
    setPhase("submitting");
    setError(undefined);
    try {
      const signature = await actions.signProductSubmit(taskSubmitSignInput(prepared, wallet));
      const next = await actions.submitTask(task.taskId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: wallet
      });
      setSubmission(next);
      const failure = submissionFailureText(next.status, next.errorCode);
      if (failure) {
        setPhase(isTerminalSubmissionEnvelope(next.status) ? "done" : "prepared");
        setError(failure);
        return;
      }
      setPhase("done");
      onSubmitted?.();
    } catch (submitError) {
      if (onSessionExpired?.(submitError)) {
        return;
      }
      setPhase("prepared");
      setError(submitFailureCopy(submitError));
    }
  }

  return (
    <section className="workspace-block requirements-panel" data-testid="acceptance-panel">
      <div className="section-heading">
        <FileSearch aria-hidden="true" />
        <div>
          <h2>验收提交</h2>
          <p>读要求包里的文件后，由你在任务的候选信号中显式选择本次要提交的信号；界面不替你判定通过或拒绝。</p>
        </div>
      </div>

      {taskState.status === "no_task" ? (
        <p className="requirements-note">
          链接未携带验收任务。请在入口里追加 <code>task=&lt;taskId&gt;</code> 后打开本页。
        </p>
      ) : taskState.status === "loading" ? (
        <p className="requirements-note" role="status">
          <RefreshCw className="spin" aria-hidden="true" /> 正在读取验收任务…
        </p>
      ) : taskState.status === "error" ? (
        <p className="requirements-error" role="alert">
          {taskState.message}
        </p>
      ) : taskState.status === "ready" ? (
        <>
          <div className="detail-grid">
            <div className="detail-item">
              <span>任务</span>
              <strong>{taskState.task.title}</strong>
            </div>
            <div className="detail-item">
              <span>环节</span>
              <strong>{taskState.task.stageName}</strong>
            </div>
          </div>

          {signals.length === 0 ? (
            <p className="requirements-note">
              任务没有下发候选提交信号（submitSignals）；界面不伪造信号。
            </p>
          ) : (
            <fieldset className="signal-fieldset" disabled={busy || phase === "done"}>
              <legend>候选信号（必须显式选择）</legend>
              {signals.map((signal, index) => (
                <label
                  className={`signal-option ${selectedSignal === signal.signalName ? "is-selected" : ""}`}
                  key={`${signal.sourceId}:${signal.signalId}:${index}`}
                >
                  <input
                    type="radio"
                    name="requirements-submit-signal"
                    value={signal.signalName}
                    checked={selectedSignal === signal.signalName}
                    onChange={() => handleSelectSignal(signal.signalName)}
                  />
                  <span>{signal.signalName}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="requirements-actions">
            <button
              className="quiet-button"
              type="button"
              disabled={!selectedSignal || !wallet || busy || phase === "done"}
              onClick={() => void handlePrepare()}
            >
              <ShieldCheck aria-hidden="true" />
              {phase === "preparing" ? "准备中…" : "准备验收提交"}
            </button>
            {prepared ? (
              <button
                className="primary-button"
                type="button"
                disabled={busy || phase === "done"}
                onClick={() => void handleSignAndSubmit()}
              >
                <Send aria-hidden="true" />
                {phase === "submitting" ? "等待钱包签名…" : "签名并提交"}
              </button>
            ) : null}
          </div>

          {!wallet ? <p className="requirements-note">需要钱包登录后才能签名提交。</p> : null}

          {prepared ? (
            <div className="detail-grid">
              <div className="detail-item">
                <span>已选信号</span>
                <strong>{selectedSignal}</strong>
              </div>
              <div className="detail-item">
                <span>提交钱包</span>
                <strong>{shortWallet(prepared.submitter)}</strong>
              </div>
              <div className="detail-item">
                <span>载荷指纹</span>
                <strong className="requirements-mono">{prepared.payloadHash}</strong>
              </div>
              <div className="detail-item">
                <span>签名有效期至</span>
                <strong>{prepared.expiresAt}</strong>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="requirements-error" role="alert">
              {error}
            </p>
          ) : null}

          {phase === "done" && submission && !error ? (
            <p className="requirements-success" role="status" data-testid="acceptance-submission-status">
              {submissionPendingText(submission.status)}
              {submission.txHash ? ` 交易 ${submission.txHash}` : ""}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function taskFailureCopy(error: unknown): string {
  if (error instanceof ProductApiError) {
    switch (error.errorCode) {
      case "product_task_not_found":
        return "任务不存在或已不可见（product_task_not_found）。";
      case "wallet_identity_required":
        return "需要钱包登录后才能读取任务。";
      case "wrong_wallet":
        return "钱包会话地址与当前钱包不一致，请重新登录。";
      default:
        return error.errorCode ? `${error.message}（${error.errorCode}）` : error.message;
    }
  }
  return error instanceof Error ? error.message : "任务读取失败。";
}

function submitFailureCopy(error: unknown): string {
  if (!(error instanceof ProductApiError)) {
    return error instanceof Error ? error.message : "提交失败，请重试。";
  }
  switch (error.errorCode) {
    case "signal_selection_required":
      return "任务有多个候选信号，必须显式选择 signalName（signal_selection_required）。";
    case "signal_not_available":
      return "所选信号不在本任务的候选内（signal_not_available），请刷新任务后重选。";
    case "evidence_required":
      return "任务声明了必填凭证槽位，需要先提交对应凭证（evidence_required）。";
    case "task_not_submittable":
      return "任务当前不可提交（task_not_submittable）。";
    case "submitter_not_authorized":
      return "当前钱包未被授权提交该信号（submitter_not_authorized）。";
    case "invalid_signature":
      return "签名校验失败（invalid_signature）。";
    default:
      return error.errorCode ? `${error.message}（${error.errorCode}）` : error.message;
  }
}
