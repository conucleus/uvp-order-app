import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { validateTaskEvidenceSpec } from "@uvp-eth/product-dto";
import { compareByCodePoint } from "./hashing";
import { resourceRequirementDisplays } from "../task-model";
import type { EvidenceRequirement } from "../task-model";

/**
 * 证据规则单轨：spec 槽位只来自 BFF 下发的 evidenceSpec（含 text/date 必填字段），
 * 不从声明文本臆造通用槽位，也不维护行业关键词→documentType 匹配表或硬编码
 * 格式白名单。spec 缺失或非法时不渲染任何 spec 条目（防止重复 key 渲染出
 * 双份必填槽位），保留服务端结构化资源要求的上传槽位（metadata 型除外）。
 * 与 zhixu-store planTaskEvidence 同口径。
 */
export interface TaskEvidencePlan {
  readonly mode: "spec" | "none";
  readonly slots: readonly EvidenceRequirement[];
}

/** 与后端证据服务一致的解码上限（HTTP body 上限 16MB）。 */
export const EVIDENCE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * 框架保留键命名空间：上传元数据 fields 与下发 spec 字段共用一层 Record，
 * spec 可声明任意 key（包括 fileName 这类通用词）。框架自带的注入键必须加
 * 前缀且后写覆盖不到 spec 同名字段，否则 spec 字段值会被顶掉并进入签名指纹。
 * 与 zhixu-store 的 FRAMEWORK_METADATA_PREFIX 同口径。
 */
export const FRAMEWORK_METADATA_PREFIX = "uvp_framework_";
export const FRAMEWORK_PUBLIC_LABEL_FIELD_KEY = `${FRAMEWORK_METADATA_PREFIX}publicLabel`;
export const FRAMEWORK_FILE_NAME_FIELD_KEY = `${FRAMEWORK_METADATA_PREFIX}fileName`;
export const FRAMEWORK_FILE_SIZE_FIELD_KEY = `${FRAMEWORK_METADATA_PREFIX}fileSize`;

/**
 * 上传元数据 fields：spec 字段在前，框架注入键带命名空间前缀在后。
 * 若框架键不带前缀，spec 声明的同名键（如 fileName）会被后写覆盖，
 * 顶掉的值和真实文件信息一起进入签名指纹。
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

export function planTaskEvidence(task: ProductTaskDTO): TaskEvidencePlan {
  const spec = task.evidenceSpec;
  if (spec && spec.length > 0 && validateTaskEvidenceSpec(spec).length === 0) {
    return {
      mode: "spec",
      slots: spec.map((entry): EvidenceRequirement => ({
        slotId: entry.key,
        label: entry.label,
        // product-dto 约定：spec key 即上传 documentType。
        documentType: entry.key,
        required: entry.required ?? true,
        inputKind: entry.inputKind ?? "file",
        accept: entry.inputKind === undefined || entry.inputKind === "file"
          ? [...(entry.accept ?? [])]
          : [],
        ...(entry.description ? { description: entry.description } : {})
      }))
    };
  }
  const resourceSlots: EvidenceRequirement[] = resourceRequirementDisplays(task)
    .filter((resource) => resource.documentType !== "metadata")
    .map((resource) => ({
      slotId: `resource-requirement:${resource.resourceId}`,
      label: resource.label,
      documentType: resource.documentType,
      required: resource.required,
      inputKind: "file" as const,
      accept: []
    }));
  return { mode: "none", slots: resourceSlots };
}

export function fileSlots(plan: TaskEvidencePlan): readonly EvidenceRequirement[] {
  return plan.slots.filter((slot) => (slot.inputKind ?? "file") === "file");
}

export function fieldSlots(plan: TaskEvidencePlan): readonly EvidenceRequirement[] {
  return plan.slots.filter((slot) => slot.inputKind === "text" || slot.inputKind === "date");
}

/** 必填检查：文件槽位看上传结果，文本/日期槽位看字段值；标签来自下发配置。 */
export function missingEvidenceSlotLabels(
  slots: readonly EvidenceRequirement[],
  fieldValues: Readonly<Record<string, string>>,
  uploadedSlotIds: readonly string[]
): readonly string[] {
  const uploaded = new Set(uploadedSlotIds);
  const missing: string[] = [];
  for (const slot of slots) {
    if (!slot.required) {
      continue;
    }
    if ((slot.inputKind ?? "file") === "file") {
      if (!uploaded.has(slot.slotId)) {
        missing.push(slot.label);
      }
      continue;
    }
    if (!(fieldValues[slot.slotId] ?? "").trim()) {
      missing.push(slot.label);
    }
  }
  return missing;
}

function normalizeAcceptEntry(entry: string): string {
  const trimmed = entry.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.startsWith(".") || trimmed.includes("/")) {
    return trimmed;
  }
  // 裸扩展名（如 "pdf"）补点归一，否则既匹配不到扩展名也绕过 %PDF- 快检。
  return `.${trimmed}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export interface EvidenceFileMetadata {
  readonly size: number;
  readonly name: string;
  readonly type: string;
}

/** accept 列表是否放行该文件（任一条目命中 MIME 或扩展名即放行；空列表不限）。 */
export function acceptAllowsFile(accept: readonly string[], file: EvidenceFileMetadata): boolean {
  if (accept.length === 0) {
    return true;
  }
  const rules = accept.map(normalizeAcceptEntry);
  const mime = file.type.trim().toLowerCase();
  const extension = extensionOf(file.name);
  return rules.some((rule) =>
    ruleAcceptsMime(rule, mime) || (extension.length > 0 && rule === extension)
  );
}

/**
 * MIME 条目按全等或 <type>/* 通配命中。协议校验器放行通配 MIME（如 image/*），
 * 若前端只做全等匹配，该槽位任何文件都匹配不上，永远无法上传。
 */
function ruleAcceptsMime(rule: string, mime: string): boolean {
  if (mime.length === 0) {
    return false;
  }
  if (rule === mime) {
    return true;
  }
  if (!rule.endsWith("/*")) {
    return false;
  }
  const typePrefix = rule.slice(0, -1);
  return typePrefix === "*/" || mime.startsWith(typePrefix);
}

const PDF_MIME = "application/pdf";
const PDF_EXTENSION = ".pdf";
const PDF_MAGIC = "%PDF-";

/** accept=pdf 时需要 %PDF- 首字节快检，防止伪造 MIME/扩展名绕过（服务端魔数校验仍是权威）。 */
export function acceptIncludesPdf(accept: readonly string[]): boolean {
  return accept.map(normalizeAcceptEntry).some((rule) => rule === PDF_MIME || rule === PDF_EXTENSION);
}

/** <input accept> 属性值；空 accept 返回 undefined 表示不限制。 */
export function acceptAttribute(accept: readonly string[]): string | undefined {
  if (accept.length === 0) {
    return undefined;
  }
  return accept.map(normalizeAcceptEntry).join(",");
}

const FORMAT_LABELS: Readonly<Record<string, string>> = {
  [PDF_MIME]: "PDF",
  [PDF_EXTENSION]: "PDF",
  "image/png": "PNG",
  ".png": "PNG",
  "image/jpeg": "JPG",
  ".jpg": "JPG",
  ".jpeg": "JPG"
};

function formatAcceptLabel(accept: readonly string[]): string {
  return [...new Set(accept.map(normalizeAcceptEntry).map((rule) => FORMAT_LABELS[rule] ?? rule))].join("、");
}

export function acceptHint(accept: readonly string[]): string {
  if (accept.length === 0) {
    return "不限格式";
  }
  return `仅支持 ${formatAcceptLabel(accept)} 格式`;
}

export interface EvidenceFileLike extends EvidenceFileMetadata {
  readonly slice?: (start: number, end: number) => { readonly arrayBuffer: () => Promise<ArrayBuffer> } | undefined;
}

/** 上传前校验：大小 + accept 约束 + accept 要求 PDF 时的首字节快检。 */
export async function validateEvidenceFileForSlot(
  file: EvidenceFileLike,
  slot: Pick<EvidenceRequirement, "accept">
): Promise<string | undefined> {
  if (file.size <= 0) {
    return "凭证文件内容为空，请重新选择。";
  }
  if (file.size > EVIDENCE_MAX_FILE_BYTES) {
    return "凭证文件超过 10 MB，请压缩或拆分后再上传。";
  }
  if (!acceptAllowsFile(slot.accept ?? [], file)) {
    return `${acceptHint(slot.accept ?? [])}的凭证文件。`;
  }
  if (acceptIncludesPdf(slot.accept ?? [])) {
    const head = await readHead(file, PDF_MAGIC.length);
    if (head !== PDF_MAGIC) {
      return "文件内容不是有效的 PDF（缺少 %PDF- 标识），请重新导出后上传。";
    }
  }
  return undefined;
}

async function readHead(file: EvidenceFileLike, length: number): Promise<string> {
  if (typeof file.slice !== "function") {
    return "";
  }
  try {
    const sliced = file.slice(0, length);
    if (!sliced) {
      return "";
    }
    const bytes = new Uint8Array(await sliced.arrayBuffer());
    let head = "";
    for (const byte of bytes) {
      head += String.fromCharCode(byte);
    }
    return head;
  } catch {
    return "";
  }
}

/** 随上传进入元数据的字段值：key 全部来自下发 spec，框架不造业务键。 */
export function evidenceMetadataFields(
  fieldValues: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    const trimmed = value.trim();
    if (trimmed) {
      fields[key] = trimmed;
    }
  }
  return fields;
}

/**
 * 上传时进入指纹的元数据字段签名（trim 后非空、按 key 排序）。
 * 上传成功时快照；之后实时签名与快照不一致即代表指纹不再代表当前表单，
 * 对应上传必须重新生成后才能提交。
 */
export function evidenceMetadataSignature(fields: Readonly<Record<string, string>>): string {
  const entries: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim();
    if (trimmed) {
      entries.push([key, trimmed]);
    }
  }
  // 键序用码点序，与同仓 stableStringify/manifest 的 canonical 口径一致；
  // UTF-16 码元序会让增补平面字符的键排错位，跨端指纹对不上。
  entries.sort(([left], [right]) => compareByCodePoint(left, right));
  return JSON.stringify(entries);
}
