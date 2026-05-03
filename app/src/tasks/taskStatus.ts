import type { ProductTaskDTO } from "@uvp-eth/product-dto";

export type ParticipantTaskDisplayState =
  | "ready"
  | "blocked"
  | "submitted"
  | "indexing"
  | "confirmed"
  | "failed";

export interface ParticipantTaskDisplay {
  readonly state: ParticipantTaskDisplayState;
  readonly label: string;
  readonly bucketLabel: string;
  readonly rank: number;
  readonly isOverdue: boolean;
}

interface TaskStatusExtensions {
  readonly chainStatus?: string;
  readonly submissionStatus?: string;
  readonly errorCode?: string;
}

export interface TaskFilterResult {
  readonly tasks: readonly ProductTaskDTO[];
  readonly totalFromApi: number;
  readonly filtered: boolean;
  readonly filteredOutCount: number;
}

export function filterParticipantTasksForWallet(
  tasks: readonly ProductTaskDTO[],
  walletAddress: string | undefined
): TaskFilterResult {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) {
    return { tasks, totalFromApi: tasks.length, filtered: false, filteredOutCount: 0 };
  }

  const matching = tasks.filter((task) => {
    const assigneeWallet = normalizeWallet(task.assigneeWallet);
    const participantWallet = normalizeWallet(task.participantWallet);
    return (!assigneeWallet && !participantWallet) ||
      assigneeWallet === normalizedWallet ||
      participantWallet === normalizedWallet;
  });

  return {
    tasks: matching,
    totalFromApi: tasks.length,
    filtered: true,
    filteredOutCount: tasks.length - matching.length
  };
}

export function taskWalletHint(walletAddress: string): string {
  const normalized = walletAddress.trim().toLowerCase();
  return `0x${normalized.slice(2, 6)}...${normalized.slice(-4)}`;
}

export function groupParticipantTasksByOrder(
  tasks: readonly ProductTaskDTO[],
  now: Date = new Date()
): readonly { readonly orderId: string; readonly orderTitle: string; readonly tasks: readonly ProductTaskDTO[] }[] {
  const groups = new Map<string, { orderTitle: string; tasks: ProductTaskDTO[] }>();
  for (const task of sortParticipantTasks(tasks, now)) {
    const group = groups.get(task.orderId);
    if (group) {
      group.tasks.push(task);
    } else {
      groups.set(task.orderId, {
        orderTitle: task.orderTitle,
        tasks: [task]
      });
    }
  }

  return [...groups.entries()].map(([orderId, group]) => ({
    orderId,
    orderTitle: group.orderTitle,
    tasks: group.tasks
  }));
}

export function sortParticipantTasks(
  tasks: readonly ProductTaskDTO[],
  now: Date = new Date()
): readonly ProductTaskDTO[] {
  return [...tasks].sort((left, right) => {
    const leftDisplay = taskDisplay(left, now);
    const rightDisplay = taskDisplay(right, now);
    return leftDisplay.rank - rightDisplay.rank ||
      deadlineTime(left.deadline) - deadlineTime(right.deadline) ||
      left.orderTitle.localeCompare(right.orderTitle) ||
      left.taskId.localeCompare(right.taskId);
  });
}

export function taskDisplay(task: ProductTaskDTO, now: Date = new Date()): ParticipantTaskDisplay {
  const extension = task as ProductTaskDTO & TaskStatusExtensions;
  const rawStatus = extension.submissionStatus ?? extension.chainStatus;
  const isOverdue = task.status === "open" && isDeadlineOverdue(task.deadline, now);

  if (rawStatus === "failed" || extension.errorCode) {
    return {
      state: "failed",
      label: "提交失败",
      bucketLabel: "提交失败",
      rank: 4,
      isOverdue
    };
  }

  if (task.status === "blocked") {
    return {
      state: "blocked",
      label: "受阻",
      bucketLabel: "受阻待办",
      rank: 2,
      isOverdue
    };
  }

  if (task.status === "submitted") {
    return {
      state: rawStatus === "indexing" ? "indexing" : "submitted",
      label: "等待链上确认",
      bucketLabel: "等待链上确认",
      rank: 3,
      isOverdue
    };
  }

  if (task.status === "done" || rawStatus === "confirmed") {
    return {
      state: "confirmed",
      label: "已确认",
      bucketLabel: "最近完成",
      rank: 5,
      isOverdue: false
    };
  }

  if (isOverdue) {
    return {
      state: "ready",
      label: "逾期待办",
      bucketLabel: "逾期待办",
      rank: 0,
      isOverdue: true
    };
  }

  return {
    state: "ready",
    label: "待办",
    bucketLabel: "可处理待办",
    rank: 1,
    isOverdue: false
  };
}

function isDeadlineOverdue(deadline: string, now: Date): boolean {
  const timestamp = deadlineTime(deadline);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

function deadlineTime(deadline: string): number {
  const normalized = deadline.trim().replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function normalizeWallet(walletAddress: string | undefined): string | undefined {
  const trimmed = walletAddress?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}
