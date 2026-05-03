import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Fingerprint,
  PackageCheck,
  ShieldAlert
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChainProofRowDTO, ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { CapturedEvidence, TaskSubmissionProof } from "../evidence/types";
import { proofSummaryRowsForTask, signalContainerForTask } from "../tasks/signalContainer";
import "./proof.css";

interface ProofPanelProps {
  readonly order?: ProductOrderDTO;
  readonly task?: ProductTaskDTO;
  readonly submissionProof?: TaskSubmissionProof;
}

type ProofMatchStatus = "matched" | "unbound" | "missing" | "mismatched";

export function ProofPanel({ order, task, submissionProof }: ProofPanelProps) {
  const [open, setOpen] = useState(false);
  const taskIsIndexing = task?.status === "submitted" && !task.proofSummary?.txHash;
  const taskFailed = (task as (ProductTaskDTO & { readonly errorCode?: string }) | undefined)?.errorCode;
  const signalContainer = useMemo(() => task ? signalContainerForTask(task) : undefined, [task]);
  const fallbackRows = useMemo(() => uniqueRows([
    ...proofSummaryRowsForTask(task),
    ...(task?.proofRows ?? []),
    ...(order?.proofRows ?? [])
  ]), [order?.proofRows, task]);
  const detailRows = useMemo(
    () => proofRowsForDrawer({ order, task, submissionProof, fallbackRows }),
    [fallbackRows, order, submissionProof, task]
  );
  const hasProof = detailRows.length > 0 || Boolean(submissionProof);
  const status = proofStatus(submissionProof?.evidence ?? []);

  useEffect(() => {
    setOpen(false);
  }, [task?.taskId, order?.orderId]);

  if (!order && !task && !submissionProof) {
    return (
      <section className="empty-state" aria-label="证明">
        <Fingerprint aria-hidden="true" />
        <h2>暂无证明</h2>
        <p>参与者服务返回订单或待办后，这里会显示可核对记录。</p>
      </section>
    );
  }

  return (
    <section className="workspace-block proof-panel" aria-labelledby="proof-panel-title">
      <div className="section-heading">
        <Fingerprint aria-hidden="true" />
        <div>
          <h2 id="proof-panel-title">证明</h2>
          <p>{submissionProof ? "本次提交生成的证明摘要" : task?.proofSummary?.label ?? "订单和待办的可核对记录"}</p>
        </div>
      </div>

      {task?.supplierTrustStatus === "revoked" ? (
        <div className="blocked-copy" role="alert">
          <ShieldAlert aria-hidden="true" />
          当前供应商链上背书已撤销，请暂停提交并联系订单负责人。
        </div>
      ) : null}

      {signalContainer ? (
        <div className="proof-context-grid" aria-label="待办证明要素">
          <ProofContextItem label="执行方钱包" value={signalContainer.executingWalletLabel} />
          {signalContainer.supplierTrustLabel ? (
            <ProofContextItem
              label="供应商背书"
              tone={signalContainer.supplierTrustTone}
              value={signalContainer.supplierTrustLabel}
            />
          ) : null}
          <ProofContextItem label="必填输入/凭证" value={signalContainer.requiredSummary} />
          <ProofContextItem
            label="凭证指纹"
            value={submissionProof?.payloadHash ?? signalContainer.proofFingerprint ?? "提交后显示"}
          />
        </div>
      ) : null}

      {taskIsIndexing ? (
        <div className="notice-line proof-indexing" role="status">
          <Clock3 aria-hidden="true" />
          <span>提交已收到，正在等待索引确认；此处不会提前显示成功。</span>
        </div>
      ) : null}

      {taskFailed ? (
        <div className="blocked-copy" role="alert">
          <AlertTriangle aria-hidden="true" />
          提交失败：{taskFailed}
        </div>
      ) : null}

      <div className="proof-toolbar">
        <p>
          {submissionProof
            ? `最近提交：${submissionProof.actionLabel}，包含交易哈希和凭证指纹摘要。`
            : fallbackRows.length > 0
              ? "已有链上证明摘要，包含凭证指纹；详情需手动打开。"
              : "暂无可显示的证明记录。"}
        </p>
        <button
          aria-controls="proof-drawer"
          aria-expanded={open}
          className="proof-drawer-button"
          disabled={!hasProof}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {open ? "收起证明" : "查看证明"}
        </button>
      </div>

      <div className="proof-drawer" hidden={!open} id="proof-drawer">
        <div className="proof-drawer-header">
          <h3>证明摘要</h3>
          <ProofStatusPill status={status} />
        </div>
        {detailRows.length > 0 ? (
          <dl className="proof-grid">
            {detailRows.map((row) => (
              <ProofRow key={`${row.label}:${row.value}`} row={row} />
            ))}
          </dl>
        ) : (
          <p className="muted-copy">等待索引器返回证明记录。</p>
        )}

        {submissionProof?.evidence.length ? (
          <div className="proof-evidence-list" aria-label="凭证明细">
            <div className="section-heading compact">
              <PackageCheck aria-hidden="true" />
              <h3>凭证</h3>
            </div>
            {submissionProof.evidence.map((evidence) => (
              <EvidenceProofCard evidence={evidence} key={evidence.evidenceId ?? evidence.requirement.slotId} />
            ))}
          </div>
        ) : null}

        <p className="notice-line">
          <CheckCircle2 aria-hidden="true" />
          <span>证明摘要只显示状态、交易编号和指纹，不显示业务文件原文。</span>
        </p>
      </div>
    </section>
  );
}

function ProofRow({ row }: { readonly row: ChainProofRowDTO }) {
  return (
    <div className="proof-row">
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  );
}

function ProofContextItem({
  label,
  value,
  tone
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "ok" | "danger" | "neutral";
}) {
  return (
    <div className={`proof-context-item ${tone ? `proof-context-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceProofCard({ evidence }: { readonly evidence: CapturedEvidence }) {
  const status = evidenceStatus(evidence);
  return (
    <article className="proof-evidence-card">
      <header>
        <h4>{evidence.businessLabel ?? evidence.requirement.label}</h4>
        <ProofStatusPill status={status} />
      </header>
      <dl>
        <div>
          <dt>内容指纹</dt>
          <dd>{evidence.contentHash ?? "未返回"}</dd>
        </div>
        <div>
          <dt>元数据指纹</dt>
          <dd>{evidence.metadataHash ?? "未返回"}</dd>
        </div>
        <div>
          <dt>载荷指纹</dt>
          <dd>{evidence.payloadHash ?? "未返回"}</dd>
        </div>
      </dl>
    </article>
  );
}

function ProofStatusPill({ status }: { readonly status: ProofMatchStatus }) {
  const icon = status === "matched" ? <CheckCircle2 aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />;
  return (
    <span className={`proof-status-pill proof-status-${status}`}>
      {icon}
      {proofStatusLabel(status)}
    </span>
  );
}

function proofRowsForDrawer(input: {
  readonly order?: ProductOrderDTO;
  readonly task?: ProductTaskDTO;
  readonly submissionProof?: TaskSubmissionProof;
  readonly fallbackRows: readonly ChainProofRowDTO[];
}): readonly ChainProofRowDTO[] {
  if (!input.submissionProof) {
    return input.fallbackRows;
  }

  const proof = input.submissionProof;
  return uniqueRows([
    { label: "交易哈希", value: proof.txHash ?? "等待索引" },
    { label: "区块高度", value: proof.blockNumber ?? "等待索引" },
    { label: "签名钱包", value: proof.signerWallet },
    { label: "状态机地址", value: proof.stateMachineAddress ?? input.task?.stateMachineAddress ?? input.order?.stateMachineAddress ?? "未返回" },
    { label: "订单 ID", value: proof.orderId },
    { label: "任务 ID", value: proof.taskId },
    { label: "载荷指纹", value: proof.payloadHash ?? "未返回" },
    ...proof.proofRows.map((row) => localizeProofRow(row))
  ]);
}

function localizeProofRow(row: ChainProofRowDTO): ChainProofRowDTO {
  switch (row.label) {
    case "Transaction":
      return { label: "交易哈希", value: row.value };
    case "Block":
      return { label: "区块高度", value: row.value };
    case "Signature submitter":
      return { label: "签名钱包", value: row.value };
    case "Payload hash":
      return { label: "载荷指纹", value: row.value };
    case "Submission status":
      return { label: "提交状态", value: row.value };
    default:
      return row;
  }
}

function uniqueRows(rows: readonly ChainProofRowDTO[]): readonly ChainProofRowDTO[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}:${row.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function proofStatus(evidence: readonly CapturedEvidence[]): ProofMatchStatus {
  if (evidence.some((item) => item.verificationStatus === "mismatch")) {
    return "mismatched";
  }
  if (evidence.some((item) => item.verificationStatus === "missing_file")) {
    return "missing";
  }
  if (evidence.length === 0 || evidence.some((item) => item.verificationStatus === "unbound" || !item.verificationStatus)) {
    return "unbound";
  }
  return "matched";
}

function evidenceStatus(evidence: CapturedEvidence): ProofMatchStatus {
  if (evidence.verificationStatus === "mismatch") {
    return "mismatched";
  }
  if (evidence.verificationStatus === "missing_file") {
    return "missing";
  }
  if (evidence.verificationStatus === "matched") {
    return "matched";
  }
  return "unbound";
}

function proofStatusLabel(status: ProofMatchStatus): string {
  switch (status) {
    case "matched":
      return "已匹配";
    case "missing":
      return "缺失";
    case "mismatched":
      return "不匹配";
    case "unbound":
      return "未绑定";
  }
}
