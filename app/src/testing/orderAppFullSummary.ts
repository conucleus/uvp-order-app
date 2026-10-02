import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { isContentAddressedReference } from "../tasks/model/taskUtils";

type JsonRecord = Record<string, unknown>;

export interface OrderAppFullParticipantWallets {
  readonly selectorWallet: string;
  readonly resourcePatchWallet: string;
}

export function selectParticipantWalletsFromFullSummary(raw: JsonRecord): OrderAppFullParticipantWallets {
  return {
    selectorWallet: requiredString(raw, [
      "wallets.selector"
    ], "selector wallet"),
    resourcePatchWallet: requiredString(raw, [
      "wallets.buyer"
    ], "resource patch wallet")
  };
}

/**
 * full 门表单用的内容寻址 URI 判定：与生产预检（taskUtils.
 * isContentAddressedReference）同一函数、同一口径——urn: 不是内容寻址引用
 * （urn:uuid 等都是任意 URN），生产表单会以「需使用内容寻址引用」阻断提交。
 * summary 值不满足时直接抛错点名数据形态分叉，不再铸 urn: 兜底把真实数据
 * 洗成生产必拒的值（那会让 full 门在数据形态与生产口径分叉时，把产品按规格
 * 的阻断误报成产品故障）。
 */
export function summaryContentAddressedUri(label: string, value: string): string {
  const trimmed = value.trim();
  if (isContentAddressedReference(trimmed)) {
    return trimmed;
  }
  throw new Error(
    `summary ${label} 必须是内容寻址引用（ipfs://、ar://、cid:、bafy…），当前值为 "${trimmed}"；`
      + "生产预检明拒 urn:/https: 引用，full 门不再铸兜底 URI 掩盖该数据形态分叉，请修正 flow summary 数据。"
  );
}

export function filterProductTasksForOrder(
  tasks: readonly ProductTaskDTO[],
  orderId: string
): readonly ProductTaskDTO[] {
  return tasks.filter((task) => taskBelongsToOrder(task, orderId));
}

export function findProductTaskForOrderByAction(
  tasks: readonly ProductTaskDTO[],
  orderId: string,
  actionKind: string
): ProductTaskDTO | undefined {
  return tasks.find((task) =>
    taskBelongsToOrder(task, orderId) && productTaskActionKinds(task).includes(actionKind)
  );
}

export function productTaskActionKinds(task: ProductTaskDTO): readonly string[] {
  return task.addOnManifest?.actions.map((action) => action.actionKind) ?? [];
}

export function taskBelongsToOrder(task: ProductTaskDTO, orderId: string): boolean {
  return task.orderId.trim().toLowerCase() === orderId.trim().toLowerCase();
}

function requiredString(value: JsonRecord, paths: readonly string[], label: string): string {
  const found = optionalString(value, paths);
  if (!found) {
    throw new Error(`summary ${label} is required; checked ${paths.join(", ")}`);
  }
  return found;
}

function optionalString(value: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const candidate = stringValue(valueAtPath(value, path));
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[part];
  }, value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
