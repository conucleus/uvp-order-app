import type { TaskSignalContainerSummary } from "../model/signalContainer";

export function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function TaskContainerSummary({ summary }: { readonly summary: TaskSignalContainerSummary }) {
  return (
    <div className="signal-container-summary" aria-label="待办提交要素">
      <div className="signal-container-item">
        <strong>执行方钱包</strong>
        <span>{summary.executingWalletLabel}</span>
        <small>{summary.executingWalletSourceLabel}</small>
      </div>
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
