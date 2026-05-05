import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileUp,
  Fingerprint,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type {
  EvidenceProofDTO,
  PreparedTaskSubmitDTO,
  ProductApiSource,
  ProductSubmissionDTO
} from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import { bytesToBase64, sha256Hex, stableStringify } from "./hashing";
import type { CapturedEvidence, EvidenceRequirement, TaskSubmissionProof } from "../task-model";
import { shortWallet } from "../auth/participant";
import {
  resourceRequirementDisplays,
  sameAddress,
  signalContainerForTask,
  supplierTrustBlocker,
  taskPrimaryActionLabel,
  taskRequiredInputsFromCapability
} from "../task-model";
import "./evidence.css";

interface EvidencePanelProps {
  readonly actions: OrderAppActions;
  readonly source?: ProductApiSource;
  readonly order?: ProductOrderDTO;
  readonly task?: ProductTaskDTO;
  readonly participantWallet?: string;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
}

type PrepareState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | { readonly status: "prepared"; readonly prepared: PreparedSubmitView }
  | { readonly status: "submitting"; readonly prepared: PreparedSubmitView }
  | { readonly status: "confirmed"; readonly proof: TaskSubmissionProof }
  | { readonly status: "failed"; readonly message: string; readonly prepared?: PreparedSubmitView };

interface PreparedSubmitView {
  readonly prepareId: string;
  readonly payloadHash: `0x${string}`;
  readonly expiresAt: string;
  readonly evidenceIds: readonly string[];
  readonly source: "api" | "demo";
  readonly raw?: PreparedTaskSubmitDTO;
}

const acceptedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".txt", ".json"];
const acceptedMimePrefixes = ["image/"];
const acceptedMimeTypes = new Set(["application/pdf", "text/plain", "application/json"]);
const maxFileSizeBytes = 10 * 1024 * 1024;
const demoBlockNumber = "18,734,899";

export function EvidencePanel({
  actions,
  source,
  order,
  task,
  participantWallet,
  onProofReady
}: EvidencePanelProps) {
  const [captures, setCaptures] = useState<Readonly<Record<string, CapturedEvidence>>>({});
  const [signingWallet, setSigningWallet] = useState("");
  const [prepareState, setPrepareState] = useState<PrepareState>({ status: "idle" });

  useEffect(() => {
    if (!task) {
      return;
    }
    setCaptures({});
    setPrepareState({ status: "idle" });
    setSigningWallet(task.assigneeWallet ?? task.participantWallet ?? participantWallet ?? "");
  }, [participantWallet, task?.assigneeWallet, task?.participantWallet, task?.taskId]);

  const requirements = useMemo(() => evidenceRequirementsForTask(task), [task]);
  const signalContainer = useMemo(() => task ? signalContainerForTask(task) : undefined, [task]);
  const capturedEvidence = requirements.map((requirement) => captures[requirement.slotId] ?? emptyCapture(requirement));
  const uploadedEvidence = capturedEvidence.filter((item) => item.status === "uploaded");
  const actionLabel = task ? taskPrimaryActionLabel(task, "确认任务完成") : "确认任务完成";
  const authorizedWallet = task?.assigneeWallet ?? task?.participantWallet ?? participantWallet;
  const hasInjectedWallet = source?.kind === "demo" || actions.hasInjectedWallet();
  const blockers = task
    ? preflightBlockers({
        capturedEvidence,
        signingWallet,
        authorizedWallet,
        source,
        task,
        hasInjectedWallet
      })
    : [];
  const canPrepare = blockers.length === 0 && prepareState.status !== "preparing" && prepareState.status !== "submitting";
  const canSubmitSignature =
    (prepareState.status === "prepared" || prepareState.status === "failed") &&
    prepareState.prepared?.source === "api" &&
    canPrepare;
  const preparedForSummary =
    prepareState.status === "prepared" || prepareState.status === "submitting" || prepareState.status === "failed"
      ? prepareState.prepared
      : undefined;

  if (!task) {
    return null;
  }

  async function handleFileSelected(requirement: EvidenceRequirement, file: File | undefined) {
    if (!file || !task) {
      return;
    }

    setPrepareState({ status: "idle" });
    setCaptures((current) => ({
      ...current,
      [requirement.slotId]: {
        ...emptyCapture(requirement),
        status: "uploading",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        businessLabel: requirement.label
      }
    }));

    const localValidation = validateFile(file);
    if (localValidation) {
      setCaptures((current) => ({
        ...current,
        [requirement.slotId]: failedCapture(requirement, file, localValidation)
      }));
      return;
    }

    if (source?.kind === "demo" && /quarantine|virus|malware/iu.test(file.name)) {
      setCaptures((current) => ({
        ...current,
        [requirement.slotId]: {
          ...failedCapture(requirement, file, "安全扫描隔离：该凭证不能绑定到业务提交。"),
          status: "quarantined",
          source: "demo"
        }
      }));
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const nextCapture = source?.kind === "demo"
        ? await demoEvidenceCapture({ bytes, file, requirement, task })
        : await uploadEvidenceCapture({ actions, bytes, file, requirement, task });
      setCaptures((current) => ({ ...current, [requirement.slotId]: nextCapture }));
    } catch (error) {
      setCaptures((current) => ({
        ...current,
        [requirement.slotId]: failedCapture(
          requirement,
          file,
          error instanceof Error ? error.message : "凭证上传失败，请重试。"
        )
      }));
    }
  }

  async function handlePrepareSubmit() {
    if (!task || blockers.length > 0) {
      return;
    }
    setPrepareState({ status: "preparing" });
    try {
      const prepared = source?.kind === "demo"
        ? await prepareDemoSubmit({ task, evidence: uploadedEvidence, signingWallet })
        : await prepareApiSubmit({ actions, task, evidence: uploadedEvidence, signingWallet });
      setPrepareState({ status: "prepared", prepared });
    } catch (error) {
      setPrepareState({
        status: "failed",
        message: error instanceof Error ? error.message : "提交预检失败"
      });
    }
  }

  async function handleDemoSubmit(prepared: PreparedSubmitView) {
    if (!task) {
      return;
    }
    setPrepareState({ status: "submitting", prepared });
    const proof = await demoSubmissionProof({
      prepared,
      task,
      order,
      actionLabel,
      signingWallet,
      evidence: uploadedEvidence
    });
    setPrepareState({ status: "confirmed", proof });
    onProofReady(proof);
  }

  async function handleSubmitSignature(prepared: PreparedSubmitView) {
    if (!task || !canSubmitSignature) {
      return;
    }
      setPrepareState({ status: "submitting", prepared });
    try {
      if (!prepared.raw) {
        throw new Error("参与者服务未返回可签名内容。");
      }
      const signature = await actions.signProductSubmit({
        typedData: prepared.raw.typedData,
        walletAddress: signingWallet.trim()
      });
      const submission = await actions.submitTask(task.taskId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: signingWallet.trim()
      });
      const evidenceWithProof = await refreshEvidenceProofs(actions, uploadedEvidence);
      setCaptures((current) => mergeProofCaptures(current, evidenceWithProof));
      const proof = submissionProofFromApi({
        submission,
        task,
        order,
        actionLabel,
        signingWallet,
        prepared,
        evidence: evidenceWithProof
      });
      setPrepareState({ status: "confirmed", proof });
      onProofReady(proof);
    } catch (error) {
      setPrepareState({
        status: "failed",
        message: error instanceof Error ? error.message : "提交失败",
        prepared
      });
    }
  }

  return (
    <section className="workspace-block" aria-labelledby="evidence-title">
      <div className="section-heading">
        <FileUp aria-hidden="true" />
        <div>
          <h2 id="evidence-title">凭证提交</h2>
          <p>原文只进入链下凭证服务；链上提交只绑定内容指纹、元数据指纹和载荷指纹。</p>
        </div>
      </div>

      <div className="notice-line">
        <ShieldCheck aria-hidden="true" />
        <span>支持 PDF、图片、TXT、JSON，单个文件不超过 10 MB。提交前可重试或替换。</span>
      </div>

      <div className="evidence-capture-list" aria-label="必填凭证">
        {capturedEvidence.length > 0 ? (
          capturedEvidence.map((capture) => (
            <EvidenceCaptureCard
              capture={capture}
              key={capture.requirement.slotId}
              source={source}
              onClear={() => {
                setPrepareState({ status: "idle" });
                setCaptures((current) => {
                  const { [capture.requirement.slotId]: _removed, ...rest } = current;
                  return rest;
                });
              }}
              onFileSelected={(file) => void handleFileSelected(capture.requirement, file)}
            />
          ))
        ) : (
          <p className="muted-copy">本任务没有配置需要上传的文件凭证。</p>
        )}
      </div>

      <section className="evidence-preflight" aria-labelledby="evidence-preflight-title">
        <h3 id="evidence-preflight-title">提交预检</h3>
        <div className="evidence-preflight-grid">
          <div className="evidence-preflight-row">
            <span>订单</span>
            <strong>{order?.title ?? task.orderTitle}</strong>
          </div>
          <div className="evidence-preflight-row">
            <span>任务</span>
            <strong>{task.title}</strong>
          </div>
          <div className="evidence-preflight-row">
            <span>提交动作</span>
            <strong>{actionLabel}</strong>
          </div>
          <div className="evidence-preflight-row">
            <span>执行方钱包</span>
            <strong>{signalContainer?.executingWalletLabel ?? authorizedWallet ?? "等待分配"}</strong>
          </div>
          {signalContainer?.supplierTrustLabel ? (
            <div className="evidence-preflight-row">
              <span>供应商背书</span>
              <strong>{signalContainer.supplierTrustLabel}</strong>
            </div>
          ) : null}
          <label className="evidence-preflight-row">
            <span>签名钱包</span>
            <input
              aria-label="签名钱包"
              className="evidence-wallet-input"
              onChange={(event) => setSigningWallet(event.target.value)}
              value={signingWallet}
            />
          </label>
        </div>

        <h3>已选择凭证</h3>
        {uploadedEvidence.length > 0 ? (
          <ul className="evidence-selected-list">
            {uploadedEvidence.map((evidence) => (
              <li key={evidence.requirement.slotId}>
                <strong>{evidence.businessLabel ?? evidence.requirement.label}</strong>
                <span>{evidence.fileName} · {formatBytes(evidence.size)}</span>
                <code>内容指纹 {evidence.contentHash}</code>
                <code>载荷指纹 {evidence.payloadHash}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-copy">尚未选择可提交的凭证。</p>
        )}

        {blockers.length > 0 ? (
          <ul className="evidence-blockers" aria-label="提交阻断原因">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        ) : (
          <div className="notice-line">
            <CheckCircle2 aria-hidden="true" />
            <span>预检通过：将提交凭证 ID 和指纹，不提交文件原文。</span>
          </div>
        )}

        {prepareState.status === "failed" ? (
          <div className="blocked-copy" role="alert">{prepareState.message}</div>
        ) : null}

        <div className="evidence-preflight-actions">
          <button className="evidence-primary-button" disabled={!canPrepare} onClick={() => void handlePrepareSubmit()} type="button">
            {prepareState.status === "preparing" ? <RefreshCw className="spin" aria-hidden="true" /> : <WalletCards aria-hidden="true" />}
            准备提交
          </button>
          {prepareState.status === "prepared" && prepareState.prepared.source === "demo" ? (
            <button className="evidence-secondary-button" onClick={() => void handleDemoSubmit(prepareState.prepared)} type="button">
              <Send aria-hidden="true" />
              确认提交样例签名
            </button>
          ) : null}
        </div>

        {preparedForSummary ? (
            <PreparedSummary
            onSubmitSignature={() => {
              void handleSubmitSignature(preparedForSummary);
            }}
            prepared={preparedForSummary}
            submitting={prepareState.status === "submitting"}
            canSubmitSignature={canSubmitSignature}
          />
        ) : null}

        {prepareState.status === "confirmed" ? (
          <div className={`evidence-proof-handoff evidence-proof-handoff-${submissionHandoff(prepareState.proof).tone}`} role="status">
            <div className="evidence-proof-handoff-title">
              {submissionHandoff(prepareState.proof).tone === "confirmed"
                ? <CheckCircle2 aria-hidden="true" />
                : <RefreshCw className="spin" aria-hidden="true" />}
              {submissionHandoff(prepareState.proof).title}
            </div>
            <p>{submissionHandoff(prepareState.proof).text}</p>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function EvidenceCaptureCard({
  capture,
  source,
  onClear,
  onFileSelected
}: {
  readonly capture: CapturedEvidence;
  readonly source?: ProductApiSource;
  readonly onClear: () => void;
  readonly onFileSelected: (file: File | undefined) => void;
}) {
  const statusLabel = evidenceStatusLabel(capture);

  return (
    <article className="evidence-card">
      <div className="evidence-card-header">
        <div>
          <h3>{capture.requirement.label}</h3>
          <p>文档类型：{capture.requirement.documentType}</p>
        </div>
        <span className={`evidence-badge ${capture.requirement.required ? "evidence-badge-required" : ""}`}>
          {capture.requirement.required ? "必填" : "可选"}
        </span>
      </div>

      <label className="evidence-file-control">
        <span className="evidence-secondary-button">
          <FileText aria-hidden="true" />
          {capture.status === "empty" ? "选择文件" : "替换文件"}
        </span>
        <input
          accept={acceptedExtensions.join(",")}
          aria-label={`选择${capture.requirement.label}`}
          onChange={(event) => onFileSelected(event.currentTarget.files?.[0])}
          type="file"
        />
      </label>

      <div className={`evidence-status-line evidence-status-${capture.status}`}>
        {statusIcon(capture)}
        <strong>{statusLabel}</strong>
        {source?.kind === "demo" && capture.status === "uploaded" ? (
          <span className="evidence-badge evidence-badge-demo">Demo 凭证，仅本地验证</span>
        ) : null}
      </div>

      {capture.fileName ? (
        <p>{capture.fileName} · {formatBytes(capture.size)} · 业务标签：{capture.businessLabel ?? capture.requirement.label}</p>
      ) : (
        <p>上传后会显示文件名、大小、业务标签和凭证指纹。</p>
      )}

      {capture.error ? <p className="blocked-copy">{capture.error}</p> : null}

      {capture.status === "uploaded" ? (
        <dl className="evidence-fingerprint-list" aria-label={`${capture.requirement.label} 指纹摘要`}>
          <div>
            <dt>内容指纹</dt>
            <dd><code>{capture.contentHash}</code></dd>
          </div>
          <div>
            <dt>元数据指纹</dt>
            <dd><code>{capture.metadataHash}</code></dd>
          </div>
          <div>
            <dt>载荷指纹</dt>
            <dd><code>{capture.payloadHash}</code></dd>
          </div>
        </dl>
      ) : null}

      {capture.status !== "empty" ? (
        <div className="evidence-actions">
          <button className="evidence-action-button" onClick={onClear} type="button">
            <XCircle aria-hidden="true" />
            清除
          </button>
        </div>
      ) : null}
    </article>
  );
}

function PreparedSummary({
  prepared,
  submitting,
  canSubmitSignature,
  onSubmitSignature
}: {
  readonly prepared?: PreparedSubmitView;
  readonly submitting: boolean;
  readonly canSubmitSignature: boolean;
  readonly onSubmitSignature: () => void;
}) {
  if (!prepared) {
    return null;
  }

  return (
    <div className="evidence-signature-box">
      <div className="evidence-preflight-row">
        <span>预检编号</span>
        <strong>{prepared.prepareId}</strong>
      </div>
      <div className="evidence-preflight-row">
        <span>本次载荷指纹</span>
        <code>{prepared.payloadHash}</code>
      </div>
      <div className="evidence-preflight-row">
        <span>有效期</span>
        <strong>{prepared.expiresAt}</strong>
      </div>
      {prepared.source === "api" ? (
        <>
          <button className="evidence-primary-button" disabled={!canSubmitSignature || submitting} onClick={onSubmitSignature} type="button">
            {submitting ? <RefreshCw className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            使用钱包签名并提交
          </button>
        </>
      ) : null}
    </div>
  );
}

function evidenceRequirementsForTask(task: ProductTaskDTO | undefined): readonly EvidenceRequirement[] {
  if (!task) {
    return [];
  }

  const resourceInputs = resourceRequirementDisplays(task).map((resource) => ({
    slotId: `resource-requirement:${resource.resourceId}`,
    label: resource.label,
    documentType: resource.documentType,
    required: resource.required
  })).filter((resource) => resource.documentType !== "metadata");
  const evidenceInputs = (taskRequiredInputsFromCapability(task) ?? [])
    .filter((input) => input.inputType === "evidence")
    .map((input) => ({
      slotId: input.inputId,
      label: input.label,
      documentType: documentTypeForLabel(input.label),
      required: input.required
    }));

  if (resourceInputs.length > 0 || evidenceInputs.length > 0) {
    return mergeEvidenceRequirements(resourceInputs, evidenceInputs);
  }

  return task.requiredEvidence.map((label, index) => ({
    slotId: `required-evidence-${index}`,
    label,
    documentType: documentTypeForLabel(label),
    required: true
  }));
}

function mergeEvidenceRequirements(
  primary: readonly EvidenceRequirement[],
  secondary: readonly EvidenceRequirement[]
): readonly EvidenceRequirement[] {
  const seen = new Set<string>();
  const merged: EvidenceRequirement[] = [];
  for (const requirement of [...primary, ...secondary]) {
    const key = `${requirement.slotId}:${requirement.label.trim().toLowerCase()}`;
    const labelKey = `label:${requirement.label.trim().toLowerCase()}`;
    if (seen.has(key) || seen.has(labelKey)) {
      continue;
    }
    seen.add(key);
    seen.add(labelKey);
    merged.push(requirement);
  }
  return merged;
}

function emptyCapture(requirement: EvidenceRequirement): CapturedEvidence {
  return {
    requirement,
    status: "empty"
  };
}

function failedCapture(requirement: EvidenceRequirement, file: File, error: string): CapturedEvidence {
  return {
    requirement,
    status: "failed",
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    businessLabel: requirement.label,
    error
  };
}

async function uploadEvidenceCapture(input: {
  readonly actions: OrderAppActions;
  readonly bytes: Uint8Array;
  readonly file: File;
  readonly requirement: EvidenceRequirement;
  readonly task: ProductTaskDTO;
}): Promise<CapturedEvidence> {
  const response = await input.actions.uploadEvidence({
    orderId: input.task.orderId,
    taskId: input.task.taskId,
    stageIdentifier: input.task.stageId,
    documentType: input.requirement.documentType,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    base64Payload: bytesToBase64(input.bytes),
    metadata: {
      businessLabel: input.requirement.label,
      documentType: input.requirement.documentType,
      fields: {
        publicLabel: input.requirement.label,
        fileName: input.file.name,
        fileSize: input.file.size
      },
      redactionPolicy: {
        public: ["businessLabel", "documentType", "publicLabel"],
        internalOnly: ["fileName", "fileSize"]
      }
    }
  });
  const evidence = response.evidence;
  const usable = evidence.status === "uploaded" || evidence.status === "bound";
  return {
    requirement: input.requirement,
    status: usable ? "uploaded" : "quarantined",
    source: "api",
    evidenceId: evidence.evidenceId,
    fileName: evidence.fileName ?? input.file.name,
    mimeType: evidence.mimeType ?? input.file.type,
    size: evidence.size ?? input.file.size,
    storageURI: evidence.storageURI,
    contentHash: evidence.contentHash,
    metadataHash: evidence.metadataHash,
    payloadHash: evidence.payloadHash,
    payloadRef: evidence.payloadRef,
    createdAt: evidence.createdAt,
    businessLabel: input.requirement.label,
    verificationStatus: evidence.status === "bound" ? "matched" : "unbound",
    error: usable ? undefined : `凭证状态为 ${evidence.status}，不能绑定到业务提交。`
  };
}

async function demoEvidenceCapture(input: {
  readonly bytes: Uint8Array;
  readonly file: File;
  readonly requirement: EvidenceRequirement;
  readonly task: ProductTaskDTO;
}): Promise<CapturedEvidence> {
  const contentHash = await sha256Hex(input.bytes);
  const metadata = {
    businessLabel: input.requirement.label,
    documentType: input.requirement.documentType,
    fileName: input.file.name,
    fileSize: input.file.size,
    stageIdentifier: input.task.stageId,
    redaction: "public proof shows hashes and labels only"
  };
  const metadataHash = await sha256Hex(stableStringify(metadata));
  const payloadHash = await sha256Hex(stableStringify({
    kind: "uvp.order-app.demo-evidence.v1",
    orderId: input.task.orderId,
    taskId: input.task.taskId,
    contentHash,
    metadataHash
  }));
  const evidenceId = `demo-${input.task.taskId}-${input.requirement.slotId}-${contentHash.slice(2, 10)}`;

  return {
    requirement: input.requirement,
    status: "uploaded",
    source: "demo",
    evidenceId,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    size: input.file.size,
    storageURI: `demo-offchain://${evidenceId}`,
    contentHash,
    metadataHash,
    payloadHash,
    payloadRef: `uvp-demo-evidence://product/${payloadHash.slice(2)}`,
    createdAt: new Date().toISOString(),
    businessLabel: input.requirement.label,
    verificationStatus: "unbound"
  };
}

async function prepareDemoSubmit(input: {
  readonly task: ProductTaskDTO;
  readonly evidence: readonly CapturedEvidence[];
  readonly signingWallet: string;
}): Promise<PreparedSubmitView> {
  const payloadHash = await sha256Hex(stableStringify({
    kind: "uvp.order-app.demo-submit.v1",
    orderId: input.task.orderId,
    taskId: input.task.taskId,
    stageIdentifier: input.task.stageId,
    signer: input.signingWallet,
    evidence: input.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      payloadHash: item.payloadHash
    }))
  }));
  return {
    prepareId: `demo-prepare-${payloadHash.slice(2, 12)}`,
    payloadHash,
    expiresAt: "demo session",
    evidenceIds: input.evidence.map((item) => item.evidenceId ?? item.requirement.slotId),
    source: "demo"
  };
}

async function prepareApiSubmit(input: {
  readonly actions: OrderAppActions;
  readonly task: ProductTaskDTO;
  readonly evidence: readonly CapturedEvidence[];
  readonly signingWallet: string;
}): Promise<PreparedSubmitView> {
  const prepared = await input.actions.prepareTaskSubmit(input.task.taskId, {
    evidenceIds: input.evidence.map((item) => item.evidenceId).filter((id): id is string => Boolean(id)),
    walletAddress: input.signingWallet.trim(),
    intent: "confirm_stage"
  });
  return {
    prepareId: prepared.prepareId,
    payloadHash: prepared.payloadHash,
    expiresAt: prepared.expiresAt,
    evidenceIds: input.evidence.map((item) => item.evidenceId).filter((id): id is string => Boolean(id)),
    source: "api",
    raw: prepared
  };
}

async function demoSubmissionProof(input: {
  readonly prepared: PreparedSubmitView;
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO;
  readonly actionLabel: string;
  readonly signingWallet: string;
  readonly evidence: readonly CapturedEvidence[];
}): Promise<TaskSubmissionProof> {
  const txHash = await sha256Hex(stableStringify({
    kind: "uvp.order-app.demo-tx.v1",
    prepareId: input.prepared.prepareId,
    payloadHash: input.prepared.payloadHash
  }));
  const matchedEvidence = input.evidence.map((item): CapturedEvidence => ({
    ...item,
    verificationStatus: "matched"
  }));

  return {
    taskId: input.task.taskId,
    orderId: input.task.orderId,
    orderTitle: input.order?.title ?? input.task.orderTitle,
    taskTitle: input.task.title,
    actionLabel: input.actionLabel,
    status: "demo_confirmed",
    txHash,
    blockNumber: demoBlockNumber,
    signerWallet: input.signingWallet,
    payloadHash: input.prepared.payloadHash,
    stateMachineAddress: input.task.stateMachineAddress ?? input.order?.stateMachineAddress,
    evidence: matchedEvidence,
    proofRows: [
      { label: "Submission status", value: "confirmed-demo" },
      { label: "Signature submitter", value: input.signingWallet },
      { label: "Payload hash", value: input.prepared.payloadHash },
      { label: "Transaction", value: txHash }
    ]
  };
}

function submissionProofFromApi(input: {
  readonly submission: ProductSubmissionDTO;
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO;
  readonly actionLabel: string;
  readonly signingWallet: string;
  readonly prepared: PreparedSubmitView;
  readonly evidence: readonly CapturedEvidence[];
}): TaskSubmissionProof {
  return {
    taskId: input.task.taskId,
    orderId: input.task.orderId,
    orderTitle: input.order?.title ?? input.task.orderTitle,
    taskTitle: input.task.title,
    actionLabel: input.actionLabel,
    status: input.submission.status,
    txHash: input.submission.txHash,
    blockNumber: input.submission.blockNumber,
    signerWallet: input.signingWallet,
    payloadHash: input.prepared.payloadHash,
    stateMachineAddress: input.task.stateMachineAddress ?? input.order?.stateMachineAddress,
    evidence: input.evidence,
    proofRows: input.submission.proofRows
  };
}

async function refreshEvidenceProofs(
  actions: OrderAppActions,
  evidence: readonly CapturedEvidence[]
): Promise<readonly CapturedEvidence[]> {
  return await Promise.all(evidence.map(async (item) => {
    if (!item.evidenceId) {
      return item;
    }
    try {
      const proof = await actions.getEvidenceProof(item.evidenceId);
      return evidenceFromProof(item, proof);
    } catch {
      return item;
    }
  }));
}

function evidenceFromProof(item: CapturedEvidence, proof: EvidenceProofDTO): CapturedEvidence {
  return {
    ...item,
    contentHash: proof.contentHash,
    metadataHash: proof.metadataHash,
    payloadHash: proof.payloadHash,
    payloadRef: proof.payloadRef ?? item.payloadRef,
    verificationStatus: proof.verificationStatus,
    storageURI: item.storageURI,
    status: proof.verificationStatus === "mismatch" || proof.verificationStatus === "missing_file" ? "quarantined" : item.status,
    error: proof.verificationStatus === "mismatch" || proof.verificationStatus === "missing_file"
      ? "凭证证明未匹配，不能继续作为有效业务凭证。"
      : item.error
  };
}

function mergeProofCaptures(
  current: Readonly<Record<string, CapturedEvidence>>,
  evidence: readonly CapturedEvidence[]
): Readonly<Record<string, CapturedEvidence>> {
  return evidence.reduce<Readonly<Record<string, CapturedEvidence>>>((next, item) => ({
    ...next,
    [item.requirement.slotId]: item
  }), current);
}

function preflightBlockers(input: {
  readonly capturedEvidence: readonly CapturedEvidence[];
  readonly signingWallet: string;
  readonly authorizedWallet?: string;
  readonly source?: ProductApiSource;
  readonly task: ProductTaskDTO;
  readonly hasInjectedWallet: boolean;
}): readonly string[] {
  const blockers: string[] = [];
  const missing = input.capturedEvidence
    .filter((item) => item.requirement.required && item.status === "empty")
    .map((item) => item.requirement.label);
  if (missing.length > 0) {
    blockers.push(`缺少必填凭证：${missing.join("、")}`);
  }
  const failed = input.capturedEvidence.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    blockers.push(`凭证上传失败：${failed.map((item) => item.requirement.label).join("、")}`);
  }
  const quarantined = input.capturedEvidence.filter((item) => item.status === "quarantined");
  if (quarantined.length > 0) {
    blockers.push(`凭证被隔离或证明不匹配：${quarantined.map((item) => item.requirement.label).join("、")}`);
  }
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
  if (!input.signingWallet.trim()) {
    blockers.push("缺少签名钱包。");
  } else if (input.authorizedWallet && !sameAddress(input.signingWallet, input.authorizedWallet)) {
    blockers.push(`钱包与授权参与方不匹配。授权钱包为 ${shortWallet(input.authorizedWallet)}，请切换到对应钱包后重试。`);
  }
  if (!input.source || input.source.kind === "missing") {
    blockers.push("参与者服务未连接，不能提交真实业务动作。");
  }
  if (input.source?.kind === "real" && !input.hasInjectedWallet) {
    blockers.push("未检测到浏览器钱包，不能创建业务签名。");
  }
  return blockers;
}

function validateFile(file: File): string | undefined {
  if (file.size > maxFileSizeBytes) {
    return "文件超过 10 MB，请替换后重试。";
  }
  const lowerName = file.name.toLowerCase();
  const extensionAccepted = acceptedExtensions.some((extension) => lowerName.endsWith(extension));
  const mimeAccepted = acceptedMimeTypes.has(file.type) || acceptedMimePrefixes.some((prefix) => file.type.startsWith(prefix));
  if (!extensionAccepted && !mimeAccepted) {
    return "文件类型不支持，请上传 PDF、图片、TXT 或 JSON。";
  }
  return undefined;
}

function documentTypeForLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("pdf") || normalized.includes("报关")) {
    return "customs_declaration";
  }
  if (normalized.includes("发票") || normalized.includes("invoice")) {
    return "invoice";
  }
  if (normalized.includes("物流") || normalized.includes("shipping")) {
    return "logistics_document";
  }
  return normalized.replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, "_") || "business_evidence";
}

function evidenceStatusLabel(capture: CapturedEvidence): string {
  switch (capture.status) {
    case "uploading":
      return "上传中";
    case "uploaded":
      return "上传完成，可用于提交";
    case "failed":
      return "上传失败";
    case "quarantined":
      return "已隔离，禁止提交";
    case "empty":
      return "等待上传";
  }
}

function statusIcon(capture: CapturedEvidence) {
  switch (capture.status) {
    case "uploading":
      return <RefreshCw className="spin" aria-hidden="true" />;
    case "uploaded":
      return <CheckCircle2 aria-hidden="true" />;
    case "failed":
      return <AlertTriangle aria-hidden="true" />;
    case "quarantined":
      return <XCircle aria-hidden="true" />;
    case "empty":
      return <Fingerprint aria-hidden="true" />;
  }
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) {
    return "大小待确认";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function submissionHandoff(proof: TaskSubmissionProof): {
  readonly tone: "confirmed" | "pending";
  readonly title: string;
  readonly text: string;
} {
  if (proof.status === "confirmed" || proof.status === "demo_confirmed") {
    return {
      tone: "confirmed",
      title: "提交已确认",
      text: "证明抽屉已可查看交易哈希、区块高度、签名钱包和凭证指纹摘要。"
    };
  }
  if (proof.status === "indexing") {
    return {
      tone: "pending",
      title: "提交已收到，等待索引确认",
      text: "交易或提交已进入处理流程，索引服务确认前不会显示最终成功。"
    };
  }
  return {
    tone: "pending",
    title: "提交已发送，等待确认",
    text: "请等待广播、链上确认和索引完成；当前状态仍可在证明区核对。"
  };
}
