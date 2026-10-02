import type {
  ChainProofRowDTO,
  FulfillmentRequiredInputDTO,
  ProductExecutorPatchMode,
  ProductExecutorPatchRequirementDTO,
  ProductResourceAccessState,
  ProductResourceRequirementDTO,
  ProductResourceVisibility,
  StageExecutorActionKind,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import { cleanString, isContentAddressedReference } from "./taskUtils";

export type ParticipantAddOnKind = StageExecutorActionKind;

export interface SelectableTargetStageDTO {
  readonly targetStageId?: string;
  readonly targetStageName?: string;
  readonly description?: string;
  readonly allowed?: boolean;
  readonly disabledReason?: string;
  readonly workStarted?: boolean;
  readonly stageSignalCount?: number;
  readonly currentExecutorWallet?: string;
  readonly currentExecutorLabel?: string;
  readonly previousExecutor?: string;
  readonly previousExecutorLabel?: string;
  readonly executorPatchMode?: ProductExecutorPatchMode;
  readonly executorPatchModes?: readonly ExecutorPatchModeOptionDTO[];
  readonly priorAuthorityLabel?: string;
  readonly futureAuthorityLabel?: string;
  readonly selected?: boolean;
  readonly executorOverlay?: ExecutorOverlayProjectionDTO;
  readonly resourceRequirements?: readonly ProductResourceRequirementDTO[];
  readonly resourceOverlays?: readonly ResourceOverlayProjectionDTO[];
  readonly requiredInputs?: readonly FulfillmentRequiredInputDTO[];
  readonly proofRows?: readonly ChainProofRowDTO[];
}

export interface ExecutorOverlayProjectionDTO {
  readonly orderId?: string;
  readonly selectorStageId?: string;
  readonly targetStageId?: string;
  readonly mode?: ProductExecutorPatchMode;
  readonly modeLabel?: string;
  readonly selectorWallet?: string;
  readonly previousExecutor?: string;
  readonly previousExecutorLabel?: string;
  readonly activeExecutorWallet?: string;
  readonly activeExecutorLabel?: string;
  readonly newExecutorWallet?: string;
  readonly newExecutorLabel?: string;
  readonly roleHash?: string;
  readonly executorMetadataHash?: string;
  readonly priorAuthorityLabel?: string;
  readonly futureAuthorityLabel?: string;
  readonly authorityNotice?: string;
  readonly patchHash?: string;
  readonly patchNonce?: string;
  readonly metadataURI?: string;
  readonly sourceLabel?: string;
  readonly proofRows?: readonly ChainProofRowDTO[];
}

export interface ExecutorPatchModeOptionDTO extends Omit<
  ProductExecutorPatchRequirementDTO,
  | "stageSignalCount"
  | "targetStageId"
  | "previousExecutor"
  | "previousExecutorLabel"
  | "approvalSourceId"
  | "approvalSignalId"
  | "approvalSignalLabel"
  | "approvalSignal"
  | "priorAuthorityLabel"
  | "futureAuthorityLabel"
  | "guidanceLabel"
  | "disabledReason"
  | "proofRows"
> {
  readonly mode: ProductExecutorPatchMode;
  readonly targetStageId?: string | undefined;
  readonly previousExecutor?: string | undefined;
  readonly previousExecutorLabel?: string | undefined;
  readonly priorAuthorityLabel?: string | undefined;
  readonly futureAuthorityLabel?: string | undefined;
  readonly guidanceLabel?: string | undefined;
  readonly disabledReason?: string | undefined;
  readonly proofRows?: readonly ChainProofRowDTO[] | undefined;
}

export interface ResourceOverlayProjectionDTO {
  readonly orderId?: string;
  readonly selectorStageId?: string;
  readonly targetStageId?: string;
  readonly resourceKey?: string;
  readonly writerWallet?: string;
  readonly manifestURI?: string;
  readonly manifestHash?: string;
  readonly policyHash?: string;
  readonly patchHash?: string;
  readonly patchNonce?: string;
  readonly visibility?: ProductResourceVisibility | string;
  readonly proofRows?: readonly ChainProofRowDTO[];
}

export type ProductTaskWithAddOns = Omit<
  ProductTaskDTO,
  | "addOnKind"
  | "selectableTargets"
  | "executorPatchModes"
  | "executorOverlay"
  | "resourceOverlays"
  | "capabilityPlugin"
  | "addOnManifest"
> & {
  readonly addOnKind?: ParticipantAddOnKind | undefined;
  readonly selectableTargets?: readonly SelectableTargetStageDTO[] | undefined;
  readonly executorPatchModes?: readonly ExecutorPatchModeOptionDTO[] | undefined;
  readonly executorOverlay?: ExecutorOverlayProjectionDTO | undefined;
  readonly resourceOverlays?: readonly ResourceOverlayProjectionDTO[] | undefined;
  readonly capabilityPlugin?: (ProductTaskDTO["capabilityPlugin"] & {
    readonly addOnKind?: ParticipantAddOnKind | undefined;
  }) | undefined;
  readonly addOnManifest?: ProductTaskDTO["addOnManifest"] | undefined;
};

export interface EffectiveFileResourceDisplay {
  readonly resourceId: string;
  readonly label: string;
  readonly documentType: string;
  readonly required: boolean;
  readonly description?: string | undefined;
  readonly sourceLabel?: string | undefined;
  readonly handleSummary: string;
  readonly visibility: ProductResourceVisibility | "unknown";
  readonly accessLabel: string;
  readonly accessState: ProductResourceAccessState | "unknown";
  readonly canRead: boolean;
}

const participantAddOnKinds = new Set<ParticipantAddOnKind>([
  "submit_signal",
  "stage_executor_patch",
  "stage_resource_patch"
]);

export function taskWithAddOns(task: ProductTaskDTO): ProductTaskWithAddOns {
  return task as ProductTaskWithAddOns;
}

export function isParticipantAddOnKind(value: unknown): value is ParticipantAddOnKind {
  return typeof value === "string" && participantAddOnKinds.has(value as ParticipantAddOnKind);
}

export function addOnManifestForTask(task: ProductTaskDTO): ProductTaskDTO["addOnManifest"] | undefined {
  return taskWithAddOns(task).addOnManifest;
}

export function targetStageId(target: SelectableTargetStageDTO): string {
  return target.targetStageId ?? "";
}

export function targetStageLabel(target: SelectableTargetStageDTO): string {
  return target.targetStageName ?? targetStageId(target);
}

export function selectableTargetsForTask(task: ProductTaskDTO): readonly SelectableTargetStageDTO[] {
  const candidate = taskWithAddOns(task);
  return candidate.selectableTargets?.filter((target) => targetStageId(target).length > 0) ?? [];
}

export function executorPatchModeOptionsForTarget(target: SelectableTargetStageDTO | undefined): readonly ExecutorPatchModeOptionDTO[] {
  if (!target) {
    return [];
  }
  // replacement 已随合约批退役（原履约者不配合的换人走治理分叉车道，尚未
  // 开放）：服务端投影若仍携带 replacement 选项，一律过滤，不向前端暴露
  // 已退役入口；assign=开工前选择履约者，handoff=开工后原履约者会签交接。
  const projected = (target.executorPatchModes ?? [])
    .filter((mode) => mode.mode === "assign" || mode.mode === "handoff");
  if (projected.length > 0) {
    return projected.map((mode) => normalizeExecutorPatchModeOption(target, mode));
  }
  const started = executorPatchWorkStarted(target);
  const fallbackMode: ProductExecutorPatchMode = started ? "handoff" : "assign";
  return [normalizeExecutorPatchModeOption(target, {
    mode: fallbackMode,
    modeLabel: executorPatchModeLabel(fallbackMode),
    allowed: target.allowed !== false,
    workStarted: started,
    requiresSelectorSignature: true,
    requiresPreviousExecutorSignature: started,
    requiresApprovalSignal: false
  })];
}

export function executorPatchModeLabel(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "选择履约者";
    case "handoff":
      return "交接履约者";
    default:
      // replacement 已退役：仅为历史投影/提交记录提供只读展示，不构成入口。
      return "履约者调整（通道已退役）";
  }
}

export function executorPatchModeGuidance(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "阶段开始前选择后续履约者。";
    case "handoff":
      return "已开始阶段需原履约者签名，同意交接剩余工作。";
    default:
      return "该处理方式已退役；原履约者不配合时请等待治理分叉承接。";
  }
}

export function executorPatchWorkStarted(target: SelectableTargetStageDTO | undefined): boolean {
  if (!target) {
    return false;
  }
  if (typeof target.workStarted === "boolean") {
    return target.workStarted;
  }
  return typeof target.stageSignalCount === "number" && target.stageSignalCount > 0;
}

function normalizeExecutorPatchModeOption(
  target: SelectableTargetStageDTO,
  mode: ExecutorPatchModeOptionDTO
): ExecutorPatchModeOptionDTO {
  const previousExecutor = cleanString(mode.previousExecutor) ??
    cleanString(target.previousExecutor);
  return {
    ...mode,
    modeLabel: cleanString(mode.modeLabel) ?? executorPatchModeLabel(mode.mode),
    workStarted: mode.workStarted || executorPatchWorkStarted(target),
    allowed: mode.allowed && target.allowed !== false,
    ...(previousExecutor ? { previousExecutor } : {}),
    previousExecutorLabel: cleanString(mode.previousExecutorLabel) ?? cleanString(target.previousExecutorLabel),
    priorAuthorityLabel: cleanString(mode.priorAuthorityLabel) ??
      cleanString(target.priorAuthorityLabel) ??
      (mode.workStarted || executorPatchWorkStarted(target) ? "已完成部分不变" : "阶段尚未开始"),
    futureAuthorityLabel: cleanString(mode.futureAuthorityLabel) ??
      cleanString(target.futureAuthorityLabel) ??
      "确认后只变更后续履约权限",
    guidanceLabel: cleanString(mode.guidanceLabel) ?? executorPatchModeGuidance(mode.mode),
    disabledReason: cleanString(mode.disabledReason) ?? target.disabledReason
  };
}

export function executorOverlayForTask(task: ProductTaskDTO): ExecutorOverlayProjectionDTO | undefined {
  const taskWithOverlays = taskWithAddOns(task);
  return taskWithOverlays.executorOverlay;
}

export function resourceOverlaysForTask(task: ProductTaskDTO): readonly ResourceOverlayProjectionDTO[] {
  return taskWithAddOns(task).resourceOverlays ?? [];
}

export function resourceRequirementsForTask(task: ProductTaskDTO): readonly ProductResourceRequirementDTO[] {
  return taskWithAddOns(task).resourceRequirements ?? [];
}

export function resourceRequirementDisplays(task: ProductTaskDTO): readonly EffectiveFileResourceDisplay[] {
  return resourceRequirementsForTask(task).map((resource) => {
    const access = resourceAccessDisplay(resource);
    return {
      resourceId: resource.resourceId,
      label: cleanString(resource.label) ?? resource.resourceId,
      documentType: cleanString(resource.resourceType) ?? resource.resourceId,
      required: resource.required,
      ...(cleanString(resource.description) ? { description: cleanString(resource.description) } : {}),
      sourceLabel: sourceLabel(resource.source),
      handleSummary: resourceHandleSummary(resource),
      visibility: access.visibility,
      accessLabel: access.label,
      accessState: access.state,
      canRead: access.canRead
    };
  });
}

function resourceHandleSummary(resource: ProductResourceRequirementDTO): string {
  const hash = cleanString(resource.manifestHash) ?? cleanString(resource.contentHash);
  if (hash) {
    return `指纹 ${compactReference(hash)}`;
  }
  const encryptedHash = cleanString(resource.ciphertextHash);
  if (encryptedHash) {
    return `加密内容 ${compactReference(encryptedHash)}`;
  }
  const reference = cleanString(resource.manifestURI) ??
    cleanString(resource.storageCID) ??
    cleanString(resource.metadataURI);
  if (reference) {
    // 判定用内容寻址谓词（协议语义），不枚举云厂商子串：框架代码特判
    // 特定供应商既不完整也不中立，且换一家云就漏判。
    return isContentAddressedReference(reference)
      ? `资源清单 ${compactReference(reference)}`
      : "需使用加密内容寻址清单";
  }
  const resourceType = cleanString(resource.resourceType);
  return resourceType ? `资源类型 ${resourceType}` : "资源清单已配置";
}

function compactReference(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 34) {
    return trimmed;
  }
  return `${trimmed.slice(0, 18)}...${trimmed.slice(-10)}`;
}

const requirementSourceLabels: Readonly<Record<ProductResourceRequirementDTO["source"], string>> = {
  plan_default: "来自默认要求",
  resource_patch: "来自资源补充",
  participant_input: "来自参与方提交"
};

function sourceLabel(source: ProductResourceRequirementDTO["source"]): string {
  return requirementSourceLabels[source];
}

function resourceAccessDisplay(resource: ProductResourceRequirementDTO): {
  readonly visibility: ProductResourceVisibility | "unknown";
  readonly state: ProductResourceAccessState | "unknown";
  readonly label: string;
  readonly canRead: boolean;
} {
  const visibility = normalizedVisibility(resource.visibility ?? resource.accessPolicy?.visibility);
  const status = resource.accessStatus;
  const state = normalizedAccessState(status?.state);
  const label = cleanString(status?.label) ?? defaultAccessLabel(visibility, state, status?.canRead);
  return {
    visibility,
    state,
    label,
    canRead: status?.canRead ?? (visibility === "public" || state === "available")
  };
}

function normalizedVisibility(value: unknown): ProductResourceVisibility | "unknown" {
  return value === "public" || value === "protected" || value === "private" ? value : "unknown";
}

function normalizedAccessState(value: unknown): ProductResourceAccessState | "unknown" {
  return value === "available" ||
    value === "locked" ||
    value === "request_required" ||
    value === "not_authorized" ||
    value === "unknown"
    ? value
    : "unknown";
}

function defaultAccessLabel(
  visibility: ProductResourceVisibility | "unknown",
  state: ProductResourceAccessState | "unknown",
  canRead: boolean | undefined
): string {
  if (canRead || state === "available" || visibility === "public") {
    return visibility === "public" ? "公开可核对" : "当前参与方可查看";
  }
  if (state === "not_authorized") {
    return "当前钱包不可查看";
  }
  if (visibility === "private") {
    return "仅授权钱包可查看";
  }
  if (visibility === "protected") {
    return "需要授权后查看加密文件";
  }
  return "访问状态待同步";
}

