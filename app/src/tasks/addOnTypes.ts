import type {
  ChainProofRowDTO,
  FulfillmentRequiredInputDTO,
  ProductExecutorPatchApprovalSignalDTO,
  ProductExecutorPatchMode,
  ProductExecutorPatchRequirementDTO,
  ProductResourceAccessState,
  ProductResourceVisibility,
  StageExecutorActionKind,
  ProductTaskDTO
} from "@uvp-eth/product-dto";
import { cleanString } from "./taskUtils";

export type ParticipantAddOnKind = StageExecutorActionKind;

export type FileResourceHandleDTO =
  | string
  | {
      readonly resourceId?: string;
      readonly resourceKey?: string;
      readonly label?: string;
      readonly title?: string;
      readonly name?: string;
      readonly documentType?: string;
      readonly description?: string;
      readonly required?: boolean;
      readonly source?: string;
      readonly sourceLabel?: string;
      readonly resourceType?: string;
      readonly fileType?: string;
      readonly handle?: string;
      readonly handleType?: string;
      readonly visibility?: ProductResourceVisibility | string;
      readonly metadataURI?: string;
      readonly manifestURI?: string;
      readonly manifestHash?: string;
      readonly uri?: string;
      readonly cid?: string;
      readonly storageCID?: string;
      readonly payloadRef?: string;
      readonly contentHash?: string;
      readonly ciphertextHash?: string;
      readonly metadataHash?: string;
      readonly payloadHash?: string;
      readonly accessPolicy?: {
        readonly policyHash?: string;
      };
      readonly accessStatus?: {
        readonly state?: ProductResourceAccessState | string;
        readonly label?: string;
        readonly canRead?: boolean;
        readonly canWrite?: boolean;
        readonly reason?: string;
      };
    };

export type FileResourcesBundleDTO =
  | Readonly<Record<string, FileResourceHandleDTO | null | undefined>>
  | readonly Exclude<FileResourceHandleDTO, string>[];

export interface SelectableTargetStageDTO {
  readonly targetStageId?: string;
  readonly stageId?: string;
  readonly targetStageName?: string;
  readonly stageName?: string;
  readonly label?: string;
  readonly name?: string;
  readonly description?: string;
  readonly allowed?: boolean;
  readonly disabledReason?: string;
  readonly workStarted?: boolean;
  readonly stageSignalCount?: number | string;
  readonly currentExecutorWallet?: string;
  readonly currentExecutorLabel?: string;
  readonly previousExecutor?: string;
  readonly previousExecutorWallet?: string;
  readonly previousExecutorLabel?: string;
  readonly executorPatchMode?: ProductExecutorPatchMode;
  readonly executorPatchModes?: readonly ExecutorPatchModeOptionDTO[];
  readonly approvalSourceId?: string;
  readonly approvalSignalId?: string;
  readonly approvalSignalLabel?: string;
  readonly approvalSignal?: ProductExecutorPatchApprovalSignalDTO;
  readonly priorAuthorityLabel?: string;
  readonly futureAuthorityLabel?: string;
  readonly selected?: boolean;
  readonly executorOverlay?: ExecutorOverlayProjectionDTO;
  readonly resourceRequirements?: FileResourcesBundleDTO;
  readonly resourceOverlays?: readonly ResourceOverlayProjectionDTO[];
  readonly effectiveResourceRequirements?: FileResourcesBundleDTO;
  readonly effectiveFileResources?: FileResourcesBundleDTO;
  readonly fileResources?: FileResourcesBundleDTO;
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
  readonly previousExecutorWallet?: string;
  readonly previousExecutorLabel?: string;
  readonly activeExecutorWallet?: string;
  readonly activeExecutorLabel?: string;
  readonly newExecutorWallet?: string;
  readonly newExecutorLabel?: string;
  readonly roleHash?: string;
  readonly executorMetadataHash?: string;
  readonly approvalSourceId?: string;
  readonly approvalSignalId?: string;
  readonly approvalSignalLabel?: string;
  readonly approvalSignal?: ProductExecutorPatchApprovalSignalDTO;
  readonly priorAuthorityLabel?: string;
  readonly futureAuthorityLabel?: string;
  readonly authorityNotice?: string;
  readonly patchHash?: string;
  readonly patchNonce?: string | number;
  readonly metadataURI?: string;
  readonly sourceLabel?: string;
  readonly proof?: readonly ChainProofRowDTO[];
  readonly proofRows?: readonly ChainProofRowDTO[];
}

export interface ExecutorPatchModeOptionDTO extends Omit<ProductExecutorPatchRequirementDTO, "stageSignalCount"> {
  readonly mode: ProductExecutorPatchMode;
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
  readonly patchNonce?: string | number;
  readonly visibility?: ProductResourceVisibility | string;
  readonly proof?: readonly ChainProofRowDTO[];
  readonly proofRows?: readonly ChainProofRowDTO[];
}

export type ProductTaskWithAddOns = Omit<
  ProductTaskDTO,
  | "addOnKind"
  | "selectableTargets"
  | "selectedStages"
  | "executorPatchModes"
  | "executorOverlay"
  | "resourceOverlays"
  | "resourceRequirements"
  | "effectiveResourceRequirements"
  | "effectiveFileResources"
  | "capabilityPlugin"
  | "addOnManifest"
> & {
  readonly addOnKind?: ParticipantAddOnKind;
  readonly selectableTargets?: readonly SelectableTargetStageDTO[];
  readonly selectedStages?: readonly string[];
  readonly executorPatchModes?: readonly ExecutorPatchModeOptionDTO[];
  readonly executorOverlay?: ExecutorOverlayProjectionDTO;
  readonly resourceOverlays?: readonly ResourceOverlayProjectionDTO[];
  readonly resourceRequirements?: FileResourcesBundleDTO;
  readonly effectiveResourceRequirements?: FileResourcesBundleDTO;
  readonly effectiveFileResources?: FileResourcesBundleDTO;
  readonly capabilityPlugin?: ProductTaskDTO["capabilityPlugin"] & {
    readonly addOnKind?: ParticipantAddOnKind;
    readonly selectedStages?: readonly string[];
  };
  readonly addOnManifest?: ProductTaskDTO["addOnManifest"];
};

export interface EffectiveFileResourceDisplay {
  readonly resourceId: string;
  readonly label: string;
  readonly documentType: string;
  readonly required: boolean;
  readonly description?: string;
  readonly sourceLabel?: string;
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
  return target.targetStageId ?? target.stageId ?? "";
}

export function targetStageLabel(target: SelectableTargetStageDTO): string {
  return target.label ?? target.targetStageName ?? target.stageName ?? target.name ?? targetStageId(target);
}

export function selectableTargetsForTask(task: ProductTaskDTO): readonly SelectableTargetStageDTO[] {
  const candidate = taskWithAddOns(task);
  if (candidate.selectableTargets && candidate.selectableTargets.length > 0) {
    return candidate.selectableTargets.filter((target) => targetStageId(target).length > 0);
  }
  const selectedStages = candidate.selectedStages ?? candidate.capabilityPlugin?.selectedStages ?? [];
  return selectedStages.map((stageId) => ({
    targetStageId: stageId,
    label: stageId
  }));
}

export function executorPatchModeOptionsForTarget(target: SelectableTargetStageDTO | undefined): readonly ExecutorPatchModeOptionDTO[] {
  if (!target) {
    return [];
  }
  if (target.executorPatchModes && target.executorPatchModes.length > 0) {
    return target.executorPatchModes.map((mode) => normalizeExecutorPatchModeOption(target, mode));
  }
  const started = executorPatchWorkStarted(target);
  if (!started) {
    return [normalizeExecutorPatchModeOption(target, {
      mode: target.executorPatchMode ?? "assign",
      modeLabel: executorPatchModeLabel(target.executorPatchMode ?? "assign"),
      allowed: target.allowed !== false,
      workStarted: false,
      requiresSelectorSignature: true,
      requiresPreviousExecutorSignature: false,
      requiresApprovalSignal: false
    })];
  }
  return [
    normalizeExecutorPatchModeOption(target, {
      mode: "handoff",
      modeLabel: executorPatchModeLabel("handoff"),
      allowed: target.allowed !== false,
      workStarted: true,
      requiresSelectorSignature: true,
      requiresPreviousExecutorSignature: true,
      requiresApprovalSignal: false
    }),
    normalizeExecutorPatchModeOption(target, {
      mode: "replacement",
      modeLabel: executorPatchModeLabel("replacement"),
      allowed: target.allowed !== false,
      workStarted: true,
      requiresSelectorSignature: true,
      requiresPreviousExecutorSignature: false,
      requiresApprovalSignal: true
    })
  ];
}

export function executorPatchModeLabel(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "选择履约者";
    case "handoff":
      return "交接履约者";
    case "replacement":
      return "申请替换履约者";
  }
}

export function executorPatchModeGuidance(mode: ProductExecutorPatchMode): string {
  switch (mode) {
    case "assign":
      return "阶段开始前选择后续履约者。";
    case "handoff":
      return "已开始阶段需原履约者签名，同意交接剩余工作。";
    case "replacement":
      return "需要替换证明，确认后只接续后续工作。";
  }
}

export function executorPatchWorkStarted(target: SelectableTargetStageDTO | undefined): boolean {
  if (!target) {
    return false;
  }
  if (typeof target.workStarted === "boolean") {
    return target.workStarted;
  }
  const signalCount = typeof target.stageSignalCount === "number"
    ? target.stageSignalCount
    : Number.parseInt(String(target.stageSignalCount ?? "0"), 10);
  return Number.isFinite(signalCount) && signalCount > 0;
}

function normalizeExecutorPatchModeOption(
  target: SelectableTargetStageDTO,
  mode: ExecutorPatchModeOptionDTO
): ExecutorPatchModeOptionDTO {
  const previousExecutor = cleanString(mode.previousExecutor) ??
    cleanString(mode.previousExecutorWallet) ??
    cleanString(target.previousExecutor) ??
    cleanString(target.previousExecutorWallet) ??
    cleanString(target.currentExecutorWallet) ??
    cleanString(target.executorOverlay?.previousExecutor) ??
    cleanString(target.executorOverlay?.previousExecutorWallet) ??
    cleanString(target.executorOverlay?.activeExecutorWallet);
  const approvalSourceId = cleanString(mode.approvalSourceId) ??
    cleanString(mode.approvalSignal?.approvalSourceId) ??
    cleanString(target.approvalSourceId) ??
    cleanString(target.approvalSignal?.approvalSourceId);
  const approvalSignalId = cleanString(mode.approvalSignalId) ??
    cleanString(mode.approvalSignal?.approvalSignalId) ??
    cleanString(target.approvalSignalId) ??
    cleanString(target.approvalSignal?.approvalSignalId);
  return {
    ...mode,
    modeLabel: cleanString(mode.modeLabel) ?? executorPatchModeLabel(mode.mode),
    workStarted: mode.workStarted || executorPatchWorkStarted(target),
    allowed: mode.allowed && target.allowed !== false,
    previousExecutor,
    previousExecutorWallet: previousExecutor,
    previousExecutorLabel: cleanString(mode.previousExecutorLabel) ??
      cleanString(target.previousExecutorLabel) ??
      cleanString(target.currentExecutorLabel),
    approvalSourceId,
    approvalSignalId,
    approvalSignalLabel: cleanString(mode.approvalSignalLabel) ??
      cleanString(mode.approvalSignal?.label) ??
      cleanString(target.approvalSignalLabel) ??
      cleanString(target.approvalSignal?.label),
    approvalSignal: mode.approvalSignal ?? target.approvalSignal,
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

export function resourceRequirementsForTask(task: ProductTaskDTO): FileResourcesBundleDTO | undefined {
  const taskWithResources = taskWithAddOns(task);
  return taskWithResources.resourceRequirements ??
    taskWithResources.effectiveResourceRequirements ??
    taskWithResources.effectiveFileResources;
}

export function resourceRequirementDisplays(task: ProductTaskDTO): readonly EffectiveFileResourceDisplay[] {
  const resources = resourceRequirementsForTask(task);
  if (!resources) {
    return [];
  }

  return fileResourceEntries(resources)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([resourceId, value]) => {
      const objectValue = value && typeof value === "object" ? value : undefined;
      const label = cleanString(objectValue?.label) ??
        cleanString(objectValue?.title) ??
        cleanString(objectValue?.name) ??
        resourceId;
      const documentType = cleanString(objectValue?.documentType) ??
        cleanString(objectValue?.resourceType) ??
        cleanString(objectValue?.fileType) ??
        resourceId;
      const access = resourceAccessDisplay(objectValue);
      return {
        resourceId: cleanString(objectValue?.resourceId) ?? resourceId,
        label,
        documentType,
        required: objectValue?.required !== false,
        ...(cleanString(objectValue?.description) ? { description: cleanString(objectValue?.description) } : {}),
        ...(cleanString(objectValue?.sourceLabel) || cleanString(objectValue?.source)
          ? { sourceLabel: cleanString(objectValue?.sourceLabel) ?? sourceLabel(cleanString(objectValue?.source)) }
          : {}),
        handleSummary: resourceHandleSummary(value),
        visibility: access.visibility,
        accessLabel: access.label,
        accessState: access.state,
        canRead: access.canRead
      };
    });
}

export function resourceHandleSummary(value: FileResourceHandleDTO | null | undefined): string {
  if (typeof value === "string") {
    if (isDisallowedProductionReference(value)) {
      return "需使用加密内容寻址清单";
    }
    return compactReference(value);
  }
  if (!value || typeof value !== "object") {
    return "资源清单待补充";
  }
  const hash = cleanString(value.payloadHash) ?? cleanString(value.contentHash) ?? cleanString(value.metadataHash);
  if (hash) {
    return `指纹 ${compactReference(hash)}`;
  }
  const encryptedHash = cleanString(value.ciphertextHash);
  if (encryptedHash) {
    return `加密内容 ${compactReference(encryptedHash)}`;
  }
  const reference = cleanString(value.manifestURI) ??
    cleanString(value.storageCID) ??
    cleanString(value.cid) ??
    cleanString(value.metadataURI) ??
    cleanString(value.payloadRef) ??
    cleanString(value.handle) ??
    cleanString(value.uri);
  if (reference) {
    return isDisallowedProductionReference(reference) || isDisallowedHandleType(value)
      ? "需使用加密内容寻址清单"
      : `资源清单 ${compactReference(reference)}`;
  }
  const fileType = cleanString(value.fileType);
  return fileType ? `资源类型 ${fileType}` : "资源清单已配置";
}

function fileResourceEntries(
  resources: FileResourcesBundleDTO
): readonly (readonly [string, FileResourceHandleDTO | null | undefined])[] {
  if (Array.isArray(resources)) {
    return resources.map((resource, index) => [
      cleanString(resource.resourceId) ?? `resource_${index + 1}`,
      resource
    ] as const);
  }
  return Object.entries(resources);
}

function compactReference(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 34) {
    return trimmed;
  }
  return `${trimmed.slice(0, 18)}...${trimmed.slice(-10)}`;
}

function sourceLabel(source: string | undefined): string | undefined {
  switch (source) {
    case "plan_default":
      return "来自默认要求";
    case "resource_patch":
    case "stage_patch":
      return "来自资源补充";
    case "participant_input":
      return "来自参与方提交";
    default:
      return source;
  }
}

function resourceAccessDisplay(value: Exclude<FileResourceHandleDTO, string> | undefined): {
  readonly visibility: ProductResourceVisibility | "unknown";
  readonly state: ProductResourceAccessState | "unknown";
  readonly label: string;
  readonly canRead: boolean;
} {
  const visibility = normalizedVisibility(value?.visibility);
  const status = value?.accessStatus;
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

function isDisallowedHandleType(value: Exclude<FileResourceHandleDTO, string>): boolean {
  const tokens = [
    cleanString(value.handleType),
    cleanString(value.source),
    cleanString(value.resourceType),
    cleanString(value.fileType)
  ].filter((token): token is string => Boolean(token)).map((token) => token.toLowerCase());
  return tokens.some((token) => token.includes("plain_text") || token.includes("txcloud"));
}

function isDisallowedProductionReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return /^https?:\/\//u.test(trimmed) ||
    trimmed.includes("txcloud") ||
    trimmed.includes("plain_text") ||
    trimmed.includes("tencentcloud");
}
