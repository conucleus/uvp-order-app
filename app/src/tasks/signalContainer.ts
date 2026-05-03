import type { ChainAttestationStatus, ChainProofRowDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { executorOverlayForTask, resourceRequirementDisplays } from "./addOnTypes";
import { taskRequiredInputsFromCapability } from "./taskPresentation";

export type SupplierTrustTone = "ok" | "danger" | "neutral";

export interface TaskSignalContainerSummary {
  readonly executingWallet?: string;
  readonly executingWalletLabel: string;
  readonly executingWalletSourceLabel: string;
  readonly supplierTrustLabel?: string;
  readonly supplierTrustTone: SupplierTrustTone;
  readonly requiredInputLabels: readonly string[];
  readonly evidenceLabels: readonly string[];
  readonly requiredSummary: string;
  readonly evidenceSummary: string;
  readonly proofFingerprint?: string;
  readonly proofSummaryLabel: string;
  readonly proofAvailable: boolean;
}

export function signalContainerForTask(task: ProductTaskDTO): TaskSignalContainerSummary {
  const executingWallet = executingWalletForTask(task);
  const requiredInputLabels = requiredInputsForTask(task);
  const evidenceLabels = evidenceRequirementsForTask(task);
  const proofFingerprint = proofFingerprintForTask(task);
  return {
    ...(executingWallet.wallet ? { executingWallet: executingWallet.wallet } : {}),
    executingWalletLabel: executingWallet.wallet ?? "等待分配",
    executingWalletSourceLabel: executingWallet.sourceLabel,
    ...(task.supplierTrustStatus || task.supplierSubjectId
      ? { supplierTrustLabel: supplierTrustLabel(task.supplierTrustStatus) }
      : {}),
    supplierTrustTone: supplierTrustTone(task.supplierTrustStatus),
    requiredInputLabels,
    evidenceLabels,
    requiredSummary: compactLabels(requiredInputLabels, "暂无必填输入"),
    evidenceSummary: compactLabels(evidenceLabels, "暂无必填凭证"),
    ...(proofFingerprint ? { proofFingerprint } : {}),
    proofSummaryLabel: proofSummaryLabel(task),
    proofAvailable: Boolean(task.proofSummary?.txHash || task.proofSummary?.payloadHash || task.proofRows.length > 0)
  };
}

export function supplierTrustBlocker(task: ProductTaskDTO): string | undefined {
  if (task.supplierTrustStatus === "revoked") {
    return "供应商背书已撤销，不能继续提交。";
  }
  if (task.supplierTrustStatus === "not_found") {
    return "未发现供应商背书，不能继续提交。";
  }
  if (task.supplierSubjectId && !task.supplierTrustStatus) {
    return "供应商背书待同步，不能继续提交。";
  }
  return undefined;
}

export function supplierTrustLabel(status: ChainAttestationStatus | undefined): string {
  switch (status) {
    case "attested":
      return "已背书";
    case "revoked":
      return "背书已撤销";
    case "not_found":
      return "未发现背书";
    case undefined:
      return "背书待同步";
  }
}

export function supplierTrustTone(status: ChainAttestationStatus | undefined): SupplierTrustTone {
  switch (status) {
    case "attested":
      return "ok";
    case "revoked":
      return "danger";
    case "not_found":
    case undefined:
      return "neutral";
  }
}

export function compactLabels(labels: readonly string[], emptyLabel: string, limit = 3): string {
  if (labels.length === 0) {
    return emptyLabel;
  }
  const visible = labels.slice(0, limit).join("、");
  const hiddenCount = labels.length - limit;
  return hiddenCount > 0 ? `${visible} 等 ${labels.length} 项` : visible;
}

export function proofSummaryRowsForTask(task: ProductTaskDTO | undefined): readonly ChainProofRowDTO[] {
  if (!task?.proofSummary) {
    return [];
  }
  const rows: ChainProofRowDTO[] = [];
  if (task.proofSummary.txHash) {
    rows.push({ label: "交易哈希", value: task.proofSummary.txHash });
  }
  if (task.proofSummary.blockNumber) {
    rows.push({ label: "区块高度", value: task.proofSummary.blockNumber });
  }
  if (task.proofSummary.payloadHash) {
    rows.push({ label: "载荷指纹", value: task.proofSummary.payloadHash });
  }
  return rows;
}

function executingWalletForTask(task: ProductTaskDTO): {
  readonly wallet?: string;
  readonly sourceLabel: string;
} {
  const overlay = executorOverlayForTask(task);
  const activeExecutorWallet = cleanString(overlay?.activeExecutorWallet);
  if (activeExecutorWallet) {
    return {
      wallet: activeExecutorWallet,
      sourceLabel: overlay?.sourceLabel ?? "来自履约者选择"
    };
  }
  const participantWallet = cleanString(task.participantWallet);
  if (participantWallet) {
    return {
      wallet: participantWallet,
      sourceLabel: "参与者钱包"
    };
  }
  const assigneeWallet = cleanString(task.assigneeWallet);
  if (assigneeWallet) {
    return {
      wallet: assigneeWallet,
      sourceLabel: "任务授权钱包"
    };
  }
  return {
    sourceLabel: "等待参与者服务返回"
  };
}

function requiredInputsForTask(task: ProductTaskDTO): readonly string[] {
  const resources = resourceRequirementDisplays(task)
    .filter((resource) => resource.required)
    .map((resource) => resource.label);
  const policyInputs = (taskRequiredInputsFromCapability(task) ?? [])
    .filter((input) => input.required && !input.completed)
    .map((input) => input.label);
  return uniqueLabels([
    ...resources,
    ...policyInputs,
    ...task.requiredEvidence
  ]);
}

function evidenceRequirementsForTask(task: ProductTaskDTO): readonly string[] {
  const resources = resourceRequirementDisplays(task)
    .filter((resource) => resource.required)
    .map((resource) => resource.label);
  const evidenceInputs = (taskRequiredInputsFromCapability(task) ?? [])
    .filter((input) => input.required && !input.completed && input.inputType === "evidence")
    .map((input) => input.label);
  return uniqueLabels([
    ...resources,
    ...evidenceInputs,
    ...task.requiredEvidence
  ]);
}

function proofFingerprintForTask(task: ProductTaskDTO): string | undefined {
  const summaryHash = cleanString(task.proofSummary?.payloadHash);
  if (summaryHash) {
    return summaryHash;
  }
  const row = task.proofRows.find((item) => proofRowLooksLikeFingerprint(item));
  return cleanString(row?.value);
}

function proofSummaryLabel(task: ProductTaskDTO): string {
  if (task.proofSummary?.txHash) {
    return "证明已返回";
  }
  if (task.status === "submitted" && !task.proofSummary?.txHash) {
    return "等待索引确认";
  }
  if (task.proofSummary?.label) {
    return task.proofSummary.label;
  }
  return task.proofRows.length > 0 ? "已有证明摘要" : "等待提交后生成";
}

function proofRowLooksLikeFingerprint(row: ChainProofRowDTO): boolean {
  const label = row.label.toLowerCase();
  return label.includes("指纹") ||
    label.includes("payload hash") ||
    label.includes("evidence hash") ||
    label.includes("fingerprint");
}

function uniqueLabels(labels: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    const cleaned = cleanString(label);
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function cleanString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}
