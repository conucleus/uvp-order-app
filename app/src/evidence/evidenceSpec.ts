import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { validateTaskEvidenceSpec } from "@uvp-eth/product-dto";
import { resourceRequirementDisplays } from "../task-model";
import type { EvidenceRequirement } from "../task-model";
import {
  EVIDENCE_MAX_FILE_BYTES,
  FRAMEWORK_METADATA_PREFIX,
  acceptAllowsFile,
  acceptAttribute,
  acceptHint,
  acceptIncludesPdf,
  evidenceMetadataFields,
  evidenceMetadataSignature,
  frameworkMetadataKey,
  missingEvidenceSlotLabels as sharedMissingEvidenceSlotLabels,
  normalizeEvidenceSlotKind,
  planTaskEvidenceSpecOrFallback,
  validateEvidenceFileForSlot as sharedValidateEvidenceFileForSlot
} from "../shared/chain/evidence/planner";
import type {
  EvidenceFileLike,
  EvidencePlanSlot,
  EvidenceValidationTexts
} from "../shared/chain/evidence/planner";

/**
 * 证据规则单轨（本端策略 = chain 轨 planTaskEvidenceSpecOrFallback）：
 * spec 槽位只来自 BFF 下发的 evidenceSpec（含 text/date 必填字段），不从
 * 声明文本臆造通用槽位，也不维护行业关键词→documentType 匹配表或硬编码
 * 格式白名单。spec 缺失或非法时不渲染任何 spec 条目（防止重复 key 渲染
 * 出双份必填槽位），保留服务端结构化资源要求的上传槽位（metadata 型
 * 除外）。zhixu-store 用的是另一策略（spec 与资源要求合并去重视图）——
 * 有意分叉，勿对齐（见 shared/chain/evidence/planner.ts 头注）。
 *
 * 槽位机（accept 约束/文件校验/指纹签名/10MB 上限）已上收 chain 轨
 * 单源；本文件保留 EvidenceRequirement 宿主形状（slotId/可选 inputKind）
 * 与本端校验文案（"。"/"10 MB" 微差），对内映射共享 EvidencePlanSlot。
 */
export interface TaskEvidencePlan {
  readonly mode: "spec" | "none";
  readonly slots: readonly EvidenceRequirement[];
}

/** 与后端证据服务一致的解码上限（HTTP body 上限 16MB）。chain 轨单源。 */
export { EVIDENCE_MAX_FILE_BYTES, FRAMEWORK_METADATA_PREFIX, acceptAllowsFile, acceptIncludesPdf };

export { acceptAttribute, acceptHint, evidenceMetadataFields, evidenceMetadataSignature };

function planSlotToRequirement(slot: EvidencePlanSlot): EvidenceRequirement {
  return {
    slotId: slot.key,
    label: slot.label,
    documentType: slot.documentType,
    required: slot.required,
    inputKind: slot.inputKind,
    accept: slot.accept,
    ...(slot.description !== undefined ? { description: slot.description } : {})
  };
}

function requirementToPlanSlot(requirement: EvidenceRequirement): EvidencePlanSlot {
  return {
    key: requirement.slotId,
    label: requirement.label,
    documentType: requirement.documentType,
    required: requirement.required,
    inputKind: normalizeEvidenceSlotKind(requirement.inputKind),
    accept: requirement.accept ?? [],
    ...(requirement.description !== undefined ? { description: requirement.description } : {})
  };
}

export function planTaskEvidence(task: ProductTaskDTO): TaskEvidencePlan {
  const plan = planTaskEvidenceSpecOrFallback({
    spec: task.evidenceSpec,
    // 资源槽位来源走本端资源投影（含访问可见性口径的 label/documentType）。
    resources: resourceRequirementDisplays(task).map((resource) => ({
      resourceId: resource.resourceId,
      documentType: resource.documentType,
      label: resource.label,
      required: resource.required
    })),
    validateSpec: validateTaskEvidenceSpec
  });
  return { mode: plan.mode, slots: plan.slots.map(planSlotToRequirement) };
}

export function fileSlots(plan: TaskEvidencePlan): readonly EvidenceRequirement[] {
  return plan.slots.filter((slot) => normalizeEvidenceSlotKind(slot.inputKind) === "file");
}

export function fieldSlots(plan: TaskEvidencePlan): readonly EvidenceRequirement[] {
  return plan.slots.filter((slot) => slot.inputKind === "text" || slot.inputKind === "date");
}

/** 必填检查（chain 轨单源）：文件槽位看上传结果，文本/日期槽位看字段值。 */
export function missingEvidenceSlotLabels(
  slots: readonly EvidenceRequirement[],
  fieldValues: Readonly<Record<string, string>>,
  uploadedSlotIds: readonly string[]
): readonly string[] {
  return sharedMissingEvidenceSlotLabels(
    slots.map(requirementToPlanSlot),
    fieldValues,
    uploadedSlotIds
  );
}

/** 本端上传前校验文案（与 zhixu 的微差："。"句尾与 "10 MB" 空格）。 */
const orderAppValidationTexts: EvidenceValidationTexts = {
  emptyFile: "凭证文件内容为空，请重新选择。",
  oversizeFile: "凭证文件超过 10 MB，请压缩或拆分后再上传。",
  formatRejected: (hint) => `${hint}的凭证文件。`,
  notPdf: "文件内容不是有效的 PDF（缺少 %PDF- 标识），请重新导出后上传。"
};

export { type EvidenceFileLike };

/** 上传前校验：大小 + accept 约束 + accept 要求 PDF 时的首字节快检（chain 轨控制流）。 */
export function validateEvidenceFileForSlot(
  file: EvidenceFileLike,
  slot: Pick<EvidenceRequirement, "accept">
): Promise<string | undefined> {
  return sharedValidateEvidenceFileForSlot(file, { accept: slot.accept ?? [] }, orderAppValidationTexts);
}

/**
 * 框架保留键命名空间已上收 chain 轨（FRAMEWORK_METADATA_PREFIX）；本端
 * 注入键（公开标签/文件名/大小）从该前缀派生，后写覆盖不到 spec 同名
 * 字段，否则 spec 字段值会被顶掉并进入签名指纹。
 */
export const FRAMEWORK_PUBLIC_LABEL_FIELD_KEY = frameworkMetadataKey("publicLabel");
export const FRAMEWORK_FILE_NAME_FIELD_KEY = frameworkMetadataKey("fileName");
export const FRAMEWORK_FILE_SIZE_FIELD_KEY = frameworkMetadataKey("fileSize");

/**
 * 上传元数据 fields：spec 字段在前，框架注入键带命名空间前缀在后。
 */
export function frameworkEvidenceMetadataFields(
  metadataFields: Readonly<Record<string, string>>,
  framework: { readonly label: string; readonly fileName: string; readonly size: number }
): Readonly<Record<string, string>> {
  return {
    ...metadataFields,
    [FRAMEWORK_PUBLIC_LABEL_FIELD_KEY]: framework.label,
    [FRAMEWORK_FILE_NAME_FIELD_KEY]: framework.fileName,
    [FRAMEWORK_FILE_SIZE_FIELD_KEY]: String(framework.size)
  };
}
