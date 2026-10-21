import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { deadlineSortMs } from "./taskUtils";

export type ParticipantTaskDisplayState =
  | "ready"
  | "blocked"
  | "submitted"
  | "confirmed"
  | "cancelled";

export interface ParticipantTaskDisplay {
  readonly state: ParticipantTaskDisplayState;
  readonly label: string;
  readonly bucketLabel: string;
  readonly rank: number;
  readonly isOverdue: boolean;
}

// BFF 在任务行上附加的链上状态（值域 ready/submitted/cancelled/unknown），
// 是链侧状态的唯一来源。
interface TaskStatusExtensions {
  readonly chainStatus?: string;
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
      deadlineSortMs(left.deadline) - deadlineSortMs(right.deadline) ||
      left.orderTitle.localeCompare(right.orderTitle) ||
      left.taskId.localeCompare(right.taskId);
  });
}

export function taskDisplay(task: ProductTaskDTO, now: Date = new Date()): ParticipantTaskDisplay {
  const extension = task as ProductTaskDTO & TaskStatusExtensions;
  const chainStatus = extension.chainStatus;
  const isOverdue = task.status === "open" && isDeadlineOverdue(task.deadline, now);

  // 链上 cancelled 是终态事实：即使任务行同时携带受阻原因，也如实展示已取消。
  if (chainStatus === "cancelled") {
    return {
      state: "cancelled",
      label: "已取消",
      bucketLabel: "已取消",
      rank: 4,
      isOverdue: false
    };
  }

  // blocked 是服务端权威受阻态：不可提交的任务不改写成待办或等待确认。
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
    // chainStatus=submitted 即链上已确认：值域内没有更深的确认信号。
    // unknown/缺省仍在等索引，显示等待链上确认。
    if (chainStatus === "submitted") {
      return {
        state: "confirmed",
        label: "已确认",
        bucketLabel: "最近完成",
        rank: 5,
        isOverdue: false
      };
    }
    return {
      state: "submitted",
      label: "等待链上确认",
      bucketLabel: "等待链上确认",
      rank: 3,
      isOverdue
    };
  }

  // open（链上 ready）：可提交的待办，逾期时置顶提醒。
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
  const timestamp = deadlineSortMs(deadline);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

function normalizeWallet(walletAddress: string | undefined): string | undefined {
  const trimmed = walletAddress?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}
