import type { ProductTaskDTO } from "@uvp-eth/product-dto";

type JsonRecord = Record<string, unknown>;

export interface OrderAppFullParticipantWallets {
  readonly selectorWallet: string;
  readonly resourcePatchWallet: string;
}

export function selectParticipantWalletsFromFullSummary(raw: JsonRecord): OrderAppFullParticipantWallets {
  return {
    selectorWallet: requiredString(raw, [
      "wallets.selector",
      "stageExecutorPatch.selectorWallet",
      "selectorWallet",
      "selector.wallet",
      "wallets.buyer",
      "buyerWallet"
    ], "selector wallet"),
    resourcePatchWallet: requiredString(raw, [
      "wallets.buyer",
      "stageResourcePatch.selectorWallet",
      "wallets.resourcePatch",
      "resourcePatchWallet",
      "buyerWallet",
      "wallets.selector",
      "selectorWallet"
    ], "resource patch wallet")
  };
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
