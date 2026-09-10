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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type {
  EvidenceProofDTO,
  PreparedTaskSubmitDTO,
  ProductApiSource,
  ProductSubmissionDTO
} from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import { bytesToBase64 } from "./hashing";
import {
  FRAMEWORK_FILE_NAME_FIELD_KEY,
  FRAMEWORK_FILE_SIZE_FIELD_KEY,
  FRAMEWORK_PUBLIC_LABEL_FIELD_KEY,
  acceptAttribute,
  acceptHint,
  evidenceMetadataFields,
  evidenceMetadataSignature,
  fieldSlots,
  fileSlots,
  frameworkEvidenceMetadataFields,
  missingEvidenceSlotLabels,
  planTaskEvidence,
  validateEvidenceFileForSlot
} from "./evidenceSpec";
import type { CapturedEvidence, EvidenceRequirement, TaskSubmissionProof } from "../task-model";
import {
  sameAddress,
  signalContainerForTask,
  taskPrimaryActionLabel,
  taskSubmitIntent,
  submitSignExpectation
} from "../task-model";
import { shortWallet } from "../auth/participant";
import "./evidence.css";

interface EvidencePanelProps {
  readonly actions: OrderAppActions;
  readonly source?: ProductApiSource | undefined;
  readonly order?: ProductOrderDTO | undefined;
  readonly task?: ProductTaskDTO | undefined;
  readonly participantWallet?: string | undefined;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  /** 提交成功（非终态失败）后回调一次，触发上层刷新任务投影。 */
  readonly onSubmitted?: (() => void) | undefined;
}

type PrepareState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | { readonly status: "prepared"; readonly prepared: PreparedSubmitView }
  | { readonly status: "submitting"; readonly prepared: PreparedSubmitView }
  | { readonly status: "confirmed"; readonly proof: TaskSubmissionProof; readonly unverifiedProofs: number }
  | { readonly status: "failed"; readonly message: string; readonly prepared?: PreparedSubmitView | undefined };

interface PreparedSubmitView {
  readonly prepareId: string;
  readonly payloadHash: `0x${string}`;
  readonly expiresAt: string;
  readonly evidenceIds: readonly string[];
  readonly raw?: PreparedTaskSubmitDTO | undefined;
}

export function EvidencePanel({
  actions,
  source,
  order,
  task,
  participantWallet,
  onProofReady,
  onSubmitted
}: EvidencePanelProps) {
  const [captures, setCaptures] = useState<Readonly<Record<string, CapturedEvidence>>>({});
  const [fieldValues, setFieldValues] = useState<Readonly<Record<string, string>>>({});
  // 上传时刻的字段快照：字段参与元数据指纹，变更后指纹不再代表当前内容。
  const [fieldSnapshots, setFieldSnapshots] = useState<Readonly<Record<string, string>>>({});
  const [signingWallet, setSigningWallet] = useState("");
  const [prepareState, setPrepareState] = useState<PrepareState>({ status: "idle" });
  // 任务作用域守卫（zhixu-store 同款）：慢网切任务后，在途上传/提交不得写入新任务。
  const taskScopeKey = task ? `${task.orderId}:${task.taskId}:${task.stageId}` : "none";
  const taskScopeRef = useRef(taskScopeKey);
  useLayoutEffect(() => {
    taskScopeRef.current = taskScopeKey;
  }, [taskScopeKey]);
  // 同步互斥（zhixu-store submitInflightRef 同款）：prepare→签名→提交是长
  // 链路，按钮的 pending 禁用要等状态落盘+重渲染才生效，同步 ref 挡住
  // 重渲染前的第二次点击；ref 在单次请求收尾即释放，防重复提交的终态
  // 闸由 confirmed 任务状态门（:235/:264 的准入检查）承担。
  const submitInflightRef = useRef(false);

  useEffect(() => {
    setCaptures({});
    setFieldValues({});
    setFieldSnapshots({});
    setPrepareState({ status: "idle" });
    setSigningWallet(task?.assigneeWallet ?? task?.participantWallet ?? participantWallet ?? "");
  }, [participantWallet, task?.assigneeWallet, task?.participantWallet, task?.taskId, taskScopeKey]);

  const plan = useMemo(() => task ? planTaskEvidence(task) : undefined, [task]);
  const signalContainer = useMemo(() => task ? signalContainerForTask(task) : undefined, [task]);
  const fileSlotList = useMemo(() => (plan ? fileSlots(plan) : []), [plan]);
  const fieldSlotList = useMemo(() => (plan ? fieldSlots(plan) : []), [plan]);
  const capturedEvidence = fileSlotList.map((requirement) => captures[requirement.slotId] ?? emptyCapture(requirement));
  const uploadedEvidence = capturedEvidence.filter((item) => item.status === "uploaded");
  const currentFieldSignature = useMemo(() => evidenceMetadataSignature(fieldValues), [fieldValues]);
  const staleSlotLabels = uploadedEvidence
    .filter((item) => fieldSnapshots[item.requirement.slotId] !== undefined &&
      fieldSnapshots[item.requirement.slotId] !== currentFieldSignature)
    .map((item) => item.requirement.label);
  const actionLabel = task ? taskPrimaryActionLabel(task, "确认任务完成") : "确认任务完成";
  const authorizedWallet = task?.assigneeWallet ?? task?.participantWallet ?? participantWallet;
  const hasInjectedWallet = actions.hasInjectedWallet();
  const blockers = task && plan
    ? preflightBlockers({
        capturedEvidence,
        plan,
        fieldValues,
        staleSlotLabels,
        signingWallet,
        authorizedWallet,
        source,
        task,
        hasInjectedWallet
      })
    : [];
  const canPrepare = blockers.length === 0 &&
    prepareState.status !== "preparing" &&
    prepareState.status !== "submitting" &&
    // 终态闸：本次会话已成功提交后不再开放重投，重复提交只能经由刷新后的
    // 任务投影状态改判（submitted/done 时 preflightBlockers 会关闭入口）。
    prepareState.status !== "confirmed";
  const canSubmitSignature =
    (prepareState.status === "prepared" || prepareState.status === "failed") &&
    canPrepare;
  const preparedForSummary =
    prepareState.status === "prepared" || prepareState.status === "submitting" || prepareState.status === "failed"
      ? prepareState.prepared
      : undefined;

  if (!task || !plan) {
    return null;
  }

  function updateFieldValue(slotId: string, value: string) {
    // 字段进入上传元数据指纹：变更后已有准备记录作废。
    setPrepareState({ status: "idle" });
    setFieldValues((current) => ({
      ...current,
      [slotId]: value
    }));
  }

  async function handleFileSelected(requirement: EvidenceRequirement, file: File | undefined) {
    if (!file || !task || !plan) {
      return;
    }
    // 同槽串行化：上传进行中禁止再选新文件，旧凭证也不会成为孤儿。
    if (captures[requirement.slotId]?.status === "uploading") {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
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

    const localValidation = await validateEvidenceFile(requirement, file);
    if (taskScopeRef.current !== requestScopeKey) {
      return;
    }
    if (localValidation) {
      setCaptures((current) => ({
        ...current,
        [requirement.slotId]: failedCapture(requirement, file, localValidation)
      }));
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      const nextCapture = await uploadEvidenceCapture({
        actions,
        bytes,
        file,
        requirement,
        task,
        metadataFields: evidenceMetadataFields(fieldValues)
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setFieldSnapshots((current) => ({
        ...current,
        [requirement.slotId]: currentFieldSignature
      }));
      setCaptures((current) => ({ ...current, [requirement.slotId]: nextCapture }));
    } catch (error) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
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
    if (!task || blockers.length > 0 || submitInflightRef.current) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    setPrepareState({ status: "preparing" });
    try {
      const prepared = await prepareApiSubmit({
        actions,
        task,
        evidence: uploadedEvidence,
        signingWallet,
        intent: taskSubmitIntent(task)
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setPrepareState({ status: "prepared", prepared });
    } catch (error) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setPrepareState({
        status: "failed",
        message: error instanceof Error ? error.message : "提交预检失败"
      });
    }
  }

  async function handleSubmitSignature(prepared: PreparedSubmitView) {
    if (!task || !canSubmitSignature || submitInflightRef.current) {
      return;
    }
    const requestScopeKey = taskScopeRef.current;
    submitInflightRef.current = true;
    setPrepareState({ status: "submitting", prepared });
    try {
      if (!prepared.raw) {
        throw new Error("参与者服务未返回可签名内容。");
      }
      const signature = await actions.signProductSubmit({
        typedData: prepared.raw.typedData,
        walletAddress: signingWallet.trim(),
        // 域校验预期来自部署配置注入（独立来源），缺配置即拒签，不读同一
        // BFF 响应里的地址，防被攻陷 BFF 换域让钱包照签。
        ...submitSignExpectation()
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      const submission = await actions.submitTask(task.taskId, {
        prepareId: prepared.prepareId,
        signature,
        walletAddress: signingWallet.trim()
      });
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      const refreshed = await refreshEvidenceProofs(actions, uploadedEvidence);
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setCaptures((current) => mergeProofCaptures(current, refreshed.evidence));
      const proof = submissionProofFromApi({
        submission,
        task,
        order,
        actionLabel,
        signingWallet,
        prepared,
        evidence: refreshed.evidence
      });
      // 提交信封如实展示：failed/expired/replaced 都是服务端记录的终态，
      // 按失败呈现并引导重新准备（submissionHandoff 同口径）。
      if (submission.status === "failed" || submission.status === "expired" || submission.status === "replaced") {
        onProofReady(proof);
        setPrepareState({
          status: "failed",
          message: submission.status === "failed"
            ? `提交失败${submission.errorCode ? `（${submission.errorCode}）` : ""}，请核对后重试。`
            : submission.status === "expired"
              ? "提交已过期未生效（终态），请重新准备提交。"
              : "本次提交已被后续提交取代（终态），请以最新提交记录为准，勿盲目重投。",
          prepared
        });
        return;
      }
      setPrepareState({ status: "confirmed", proof, unverifiedProofs: refreshed.failedChecks });
      onProofReady(proof);
      // 刷新任务投影：confirmed 后由服务端状态（submitted/done）关闭提交
      // 入口，面板内终态闸只是刷新落地前的过渡防线。
      onSubmitted?.();
    } catch (error) {
      if (taskScopeRef.current !== requestScopeKey) {
        return;
      }
      setPrepareState({
        status: "failed",
        message: error instanceof Error ? error.message : "提交失败",
        prepared
      });
    } finally {
      submitInflightRef.current = false;
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
        <span>单个文件不超过 10 MB；支持格式以任务配置为准。同一凭证上传完成前不能重复选择或清除。</span>
      </div>

      {fieldSlotList.length > 0 ? (
        <section className="evidence-preflight" aria-labelledby="evidence-fields-title">
          <h3 id="evidence-fields-title">必填字段</h3>
          <div className="plugin-inputs">
            {fieldSlotList.map((slot) => (
              <label className="plugin-field" key={slot.slotId}>
                <span>
                  {slot.label}
                  <small>{slot.required ? "必填" : "可选"}</small>
                </span>
                <input
                  aria-label={slot.label}
                  onChange={(event) => updateFieldValue(slot.slotId, event.currentTarget.value)}
                  placeholder={slot.inputKind === "date" ? "选择日期" : "填写后随凭证指纹一同提交"}
                  type={slot.inputKind === "date" ? "date" : "text"}
                  value={fieldValues[slot.slotId] ?? ""}
                />
                {slot.description ? <small>{slot.description}</small> : null}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <div className="evidence-capture-list" aria-label="必填凭证">
        {capturedEvidence.length > 0 ? (
          capturedEvidence.map((capture) => (
            <EvidenceCaptureCard
              capture={capture}
              key={capture.requirement.slotId}
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
          <div
            className={`evidence-proof-handoff evidence-proof-handoff-${submissionHandoff(prepareState.proof).tone}`}
            role={submissionHandoff(prepareState.proof).tone === "failed" ? "alert" : "status"}
          >
            <div className="evidence-proof-handoff-title">
              {submissionHandoff(prepareState.proof).tone === "confirmed"
                ? <CheckCircle2 aria-hidden="true" />
                : submissionHandoff(prepareState.proof).tone === "failed"
                  ? <AlertTriangle aria-hidden="true" />
                  : <RefreshCw className="spin" aria-hidden="true" />}
              {submissionHandoff(prepareState.proof).title}
            </div>
            <p>{submissionHandoff(prepareState.proof).text}</p>
            {prepareState.unverifiedProofs > 0 ? (
              <p className="blocked-copy" role="alert">
                证明核对未完成（{prepareState.unverifiedProofs} 条）：部分凭证的最新核验状态获取失败，下方可能仍显示旧核验结果，请稍后重新核对。
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function EvidenceCaptureCard({
  capture,
  onClear,
  onFileSelected
}: {
  readonly capture: CapturedEvidence;
  readonly onClear: () => void;
  readonly onFileSelected: (file: File | undefined) => void;
}) {
  const statusLabel = evidenceStatusLabel(capture);
  const uploading = capture.status === "uploading";
  const slot = capture.requirement;

  return (
    <article className="evidence-card">
      <div className="evidence-card-header">
        <div>
          <h3>{slot.label}</h3>
          <p>文档类型：{slot.documentType}</p>
        </div>
        <span className={`evidence-badge ${slot.required ? "evidence-badge-required" : ""}`}>
          {slot.required ? "必填" : "可选"}
        </span>
      </div>

      {slot.description ? <p className="muted-copy">{slot.description}</p> : null}
      <p className="muted-copy">{acceptHint(slot.accept ?? [])}，单个文件不超过 10 MB。</p>

      <label className="evidence-file-control">
        <span className="evidence-secondary-button">
          <FileText aria-hidden="true" />
          {uploading ? "上传中" : capture.status === "empty" ? "选择文件" : "替换文件"}
        </span>
        <input
          accept={acceptAttribute(slot.accept ?? [])}
          aria-label={`选择${slot.label}`}
          disabled={uploading}
          onChange={(event) => onFileSelected(event.currentTarget.files?.[0])}
          type="file"
        />
      </label>

      <div className={`evidence-status-line evidence-status-${capture.status}`}>
        {statusIcon(capture)}
        <strong>{statusLabel}</strong>
      </div>

      {capture.fileName ? (
        <p>{capture.fileName} · {formatBytes(capture.size)} · 业务标签：{capture.businessLabel ?? slot.label}</p>
      ) : (
        <p>上传后会显示文件名、大小、业务标签和凭证指纹。</p>
      )}

      {capture.error ? <p className="blocked-copy">{capture.error}</p> : null}

      {capture.status === "uploaded" ? (
        <dl className="evidence-fingerprint-list" aria-label={`${slot.label} 指纹摘要`}>
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
          <button className="evidence-action-button" disabled={uploading} onClick={onClear} type="button">
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
  readonly prepared?: PreparedSubmitView | undefined;
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
      <button className="evidence-primary-button" disabled={!canSubmitSignature || submitting} onClick={onSubmitSignature} type="button">
        {submitting ? <RefreshCw className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
        使用钱包签名并提交
      </button>
    </div>
  );
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

async function validateEvidenceFile(requirement: EvidenceRequirement, file: File): Promise<string | undefined> {
  return await validateEvidenceFileForSlot(file, requirement);
}

async function uploadEvidenceCapture(input: {
  readonly actions: OrderAppActions;
  readonly bytes: Uint8Array;
  readonly file: File;
  readonly requirement: EvidenceRequirement;
  readonly task: ProductTaskDTO;
  readonly metadataFields: Readonly<Record<string, string>>;
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
      fields: frameworkEvidenceMetadataFields(input.metadataFields, {
        label: input.requirement.label,
        fileName: input.file.name,
        size: input.file.size
      }),
      redactionPolicy: {
        public: ["businessLabel", "documentType", FRAMEWORK_PUBLIC_LABEL_FIELD_KEY],
        internalOnly: [FRAMEWORK_FILE_NAME_FIELD_KEY, FRAMEWORK_FILE_SIZE_FIELD_KEY]
      }
    }
  });
  const evidence = response.evidence;
  const usable = evidence.status === "uploaded" || evidence.status === "bound";
  return {
    requirement: input.requirement,
    status: usable ? "uploaded" : "quarantined",
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

async function prepareApiSubmit(input: {
  readonly actions: OrderAppActions;
  readonly task: ProductTaskDTO;
  readonly evidence: readonly CapturedEvidence[];
  readonly signingWallet: string;
  readonly intent: ReturnType<typeof taskSubmitIntent>;
}): Promise<PreparedSubmitView> {
  const prepared = await input.actions.prepareTaskSubmit(input.task.taskId, {
    evidenceIds: input.evidence.map((item) => item.evidenceId).filter((id): id is string => Boolean(id)),
    walletAddress: input.signingWallet.trim(),
    // 提交意图按能力插件类型推导（dispute_material → raise_dispute），
    // 不再硬编码 confirm_stage，争议任务不会以确认口径提交。
    intent: input.intent
  });
  return {
    prepareId: prepared.prepareId,
    payloadHash: prepared.payloadHash,
    expiresAt: prepared.expiresAt,
    evidenceIds: input.evidence.map((item) => item.evidenceId).filter((id): id is string => Boolean(id)),
    raw: prepared
  };
}

function submissionProofFromApi(input: {
  readonly submission: ProductSubmissionDTO;
  readonly task: ProductTaskDTO;
  readonly order?: ProductOrderDTO | undefined;
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
): Promise<{ readonly evidence: readonly CapturedEvidence[]; readonly failedChecks: number }> {
  const results = await Promise.all(evidence.map(async (item): Promise<{ readonly item: CapturedEvidence; readonly failed: boolean }> => {
    if (!item.evidenceId) {
      return { item, failed: false };
    }
    try {
      const proof = await actions.getEvidenceProof(item.evidenceId);
      return { item: evidenceFromProof(item, proof), failed: false };
    } catch {
      // The old verificationStatus must not pass silently: count the failure so
      // the confirmation area can flag the incomplete proof check.
      return { item, failed: true };
    }
  }));
  return {
    evidence: results.map((result) => result.item),
    failedChecks: results.filter((result) => result.failed).length
  };
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
  readonly plan: ReturnType<typeof planTaskEvidence>;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly staleSlotLabels: readonly string[];
  readonly signingWallet: string;
  readonly authorizedWallet?: string | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly task: ProductTaskDTO;
  readonly hasInjectedWallet: boolean;
}): readonly string[] {
  const blockers: string[] = [];
  const handledSlotIds = input.capturedEvidence
    .filter((item) => item.status !== "empty")
    .map((item) => item.requirement.slotId);
  const missing = missingEvidenceSlotLabels(input.plan.slots, input.fieldValues, handledSlotIds);
  if (missing.length > 0) {
    blockers.push(`缺少必填项：${missing.join("、")}`);
  }
  const failed = input.capturedEvidence.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    blockers.push(`凭证上传失败：${failed.map((item) => item.requirement.label).join("、")}`);
  }
  const uploading = input.capturedEvidence.filter((item) => item.status === "uploading");
  if (uploading.length > 0) {
    blockers.push(`凭证上传中：${uploading.map((item) => item.requirement.label).join("、")}`);
  }
  const quarantined = input.capturedEvidence.filter((item) => item.status === "quarantined");
  if (quarantined.length > 0) {
    blockers.push(`凭证被隔离或证明不匹配：${quarantined.map((item) => item.requirement.label).join("、")}`);
  }
  if (input.staleSlotLabels.length > 0) {
    blockers.push(`字段已变更，请重新上传以更新指纹：${input.staleSlotLabels.join("、")}`);
  }
  if (input.task.status !== "open") {
    blockers.push("任务已关闭，不能继续提交。");
  }
  if (input.task.canSubmit === false) {
    blockers.push("当前钱包暂不能提交此待办。请确认你使用的钱包与订单登记的一致。");
  }
  if (!input.signingWallet.trim()) {
    blockers.push("缺少签名钱包。");
  } else if (input.authorizedWallet && !sameAddress(input.signingWallet, input.authorizedWallet)) {
    blockers.push(`钱包与授权参与方不匹配。授权钱包为 ${shortWallet(input.authorizedWallet)}，请切换到对应钱包后重试。`);
  }
  if (!input.source) {
    blockers.push("参与者服务未连接，不能提交真实业务动作。");
  }
  if (!input.hasInjectedWallet) {
    blockers.push("未检测到浏览器钱包，不能创建业务签名。");
  }
  return blockers;
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
  readonly tone: "confirmed" | "pending" | "failed";
  readonly title: string;
  readonly text: string;
} {
  if (proof.status === "confirmed") {
    return {
      tone: "confirmed",
      title: "提交已确认",
      text: "证明抽屉已可查看交易哈希、区块高度、签名钱包和凭证指纹摘要。"
    };
  }
  if (proof.status === "expired") {
    // 服务端终态：expired 未生效且不可重投，不会进入索引——
    // 如实按失败呈现并引导重新准备提交，不显示"仍在核对"。
    return {
      tone: "failed",
      title: "提交已过期未生效（终态）",
      text: "本次提交没有进入索引；请重新准备提交。"
    };
  }
  if (proof.status === "replaced") {
    return {
      tone: "failed",
      title: "本次提交已被后续提交取代（终态）",
      text: "该提交不再进入索引；请以最新提交记录为准，勿盲目重投。"
    };
  }
  if (proof.status === "failed") {
    return {
      tone: "failed",
      title: "提交失败（终态）",
      text: "本次提交没有生效；请核对阻断原因后重新准备提交。"
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
