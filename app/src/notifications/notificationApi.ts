import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { ParticipantSession } from "../auth/participant";
import type { ProductApiSource, ProductHomeData } from "../api/productApi";
import type {
  OrderAppNotificationDTO,
  OrderAppNotificationKind,
  OrderAppNotificationList,
  OrderAppNotificationReadStatus,
  OrderAppNotificationSeverity
} from "./types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ApiNotificationResponse {
  readonly notifications?: readonly Partial<OrderAppNotificationDTO>[];
  readonly unreadCount?: number;
  readonly sourceOfTruth?: OrderAppNotificationList["sourceOfTruth"];
}

interface ApiNotificationReadResponse {
  readonly notification?: Partial<OrderAppNotificationDTO>;
}

export async function loadOrderAppNotifications(
  data: ProductHomeData,
  session: ParticipantSession,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis)
): Promise<OrderAppNotificationList> {
  if (data.source.kind !== "real") {
    throw new Error("通知中心仅在参与者服务连接后可用。");
  }

  try {
    await syncPendingNotificationReads(data, session, fetcher);
    const response = await fetcher(joinUrl(data.source.baseUrl, participantPath("/product/me/activity-feed", session)), {
      method: "GET",
      headers: {
        "content-type": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(await responseText(response));
    }
    const body = await response.json() as ApiNotificationResponse;
    const notifications: OrderAppNotificationDTO[] = [];
    let skippedNotificationCount = 0;
    for (const entry of body.notifications ?? []) {
      const normalized = normalizeApiNotification(entry);
      if (normalized) {
        notifications.push(normalized);
      } else {
        skippedNotificationCount += 1;
      }
    }
    if (skippedNotificationCount > 0) {
      console.warn(`activity-feed returned ${skippedNotificationCount} invalid notification entries; skipped`);
    }
    return {
      notifications,
      unreadCount: body.unreadCount ?? notifications.filter((notification) => notification.readStatus === "unread").length,
      source: "api",
      sourceOfTruth: body.sourceOfTruth ?? "product-projection-and-notification-read-state"
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "通知服务暂不可用");
  }
}

export async function markOrderAppNotificationRead(
  notification: OrderAppNotificationDTO,
  data: ProductHomeData,
  session: ParticipantSession,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis)
): Promise<OrderAppNotificationDTO> {
  const readAt = new Date().toISOString();
  rememberReadNotification(session, notification.notificationId, readAt);

  if (data.source.kind !== "real") {
    return { ...notification, readStatus: "read", readAt };
  }

  try {
    const response = await postReadReceipt(data.source.baseUrl, session, notification.notificationId, fetcher);
    if (!response.ok) {
      throw new Error(await responseText(response));
    }
    clearPendingRead(session, notification.notificationId);
    const body = await response.json() as ApiNotificationReadResponse;
    const acknowledged = body.notification ? normalizeApiNotification(body.notification) : undefined;
    return acknowledged ?? { ...notification, readStatus: "read", readAt };
  } catch (error) {
    enqueuePendingRead(session, notification.notificationId, readAt);
    console.warn(`read receipt not persisted; queued for retry: ${notification.notificationId}`, error);
    return { ...notification, readStatus: "read", readAt, syncPending: true };
  }
}

/**
 * Replays read receipts that failed to reach the server earlier. Kept
 * entries stay queued until a POST succeeds; the local read state is never
 * rolled back.
 */
export async function syncPendingNotificationReads(
  data: ProductHomeData,
  session: ParticipantSession,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis)
): Promise<{ readonly synced: number; readonly remaining: number }> {
  const pending = pendingReadEntries(session);
  if (data.source.kind !== "real" || pending.length === 0) {
    return { synced: 0, remaining: pending.length };
  }

  let synced = 0;
  for (const [notificationId] of pending) {
    try {
      const response = await postReadReceipt(data.source.baseUrl, session, notificationId, fetcher);
      if (!response.ok) {
        continue;
      }
      clearPendingRead(session, notificationId);
      synced += 1;
    } catch {
      // keep queued for the next sync pass
    }
  }
  return { synced, remaining: pending.length - synced };
}

function postReadReceipt(
  baseUrl: string,
  session: ParticipantSession,
  notificationId: string,
  fetcher: Fetcher
): Promise<Response> {
  return fetcher(
    joinUrl(baseUrl, `/product/me/activity-feed/${encodeURIComponent(notificationId)}/read`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...(session.walletAddress ? { walletAddress: session.walletAddress } : {})
      })
    }
  );
}

export function deriveOrderAppNotifications(input: {
  readonly orders: readonly ProductOrderDTO[];
  readonly tasks: readonly ProductTaskDTO[];
  readonly now: Date;
}): readonly OrderAppNotificationDTO[] {
  const ordersById = new Map(input.orders.map((order) => [order.orderId, order]));
  const notifications: OrderAppNotificationDTO[] = [];

  for (const task of input.tasks) {
    const order = ordersById.get(task.orderId);
    const sla = slaStateForTask(task, input.now);
    const base = baseNotification(task, order);

    // done 才是链上确认的完成态；submitted 仍是等待索引的中间态，
    // 通知口径与 taskStatus/ProofPanel 一致，不提前宣布"提交已确认"。
    if (task.status === "done") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("submission_confirmed", task.taskId),
        kind: "submission_confirmed",
        severity: "success",
        eventLabel: "提交已确认",
        message: `${task.stageName} 已确认完成，继续关注后续订单状态。`
      });
      continue;
    }

    if (task.status === "submitted") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("signal_submitted", task.taskId),
        kind: "signal_submitted",
        severity: "info",
        eventLabel: "等待索引确认",
        message: `${task.stageName} 已提交，等待链上索引确认；确认前不会显示为完成。`
      });
      continue;
    }

    if (task.status === "blocked") {
      notifications.push({
        ...base,
        notificationId: localNotificationId(blockedNotificationKind(task), task.taskId),
        kind: blockedNotificationKind(task),
        severity: blockedNotificationKind(task) === "task_revoked" ? "critical" : "warning",
        eventLabel: blockedNotificationKind(task) === "task_revoked" ? "任务已撤销" : "处理失败或受阻",
        message: task.blockedReason ?? "当前待办受阻，请在订单证明和时间线中核对原因。"
      });
      continue;
    }

    if (task.status === "open" && sla.status === "overdue") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("task_overdue", task.taskId, task.deadline),
        kind: "task_overdue",
        severity: "critical",
        eventLabel: "任务已逾期",
        message: `${task.participantRoleLabel ?? task.assigneeRole} 负责的 ${task.stageName} 已超过截止时间。`
      });
      continue;
    }

    if (task.status === "open" && sla.status === "near_deadline") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("task_near_deadline", task.taskId, task.deadline),
        kind: "task_near_deadline",
        severity: "warning",
        eventLabel: "即将到期",
        message: `${task.participantRoleLabel ?? task.assigneeRole} 负责的 ${task.stageName} 接近截止时间。`
      });
      continue;
    }

    if (task.status === "open") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("task_ready", task.taskId),
        kind: "task_ready",
        severity: "action",
        eventLabel: "任务已就绪",
        message: `${task.participantRoleLabel ?? task.assigneeRole} 需要处理 ${task.stageName}。`
      });
    }
  }

  return [...dedupeNotifications(notifications)].sort(compareNotifications);
}

function baseNotification(
  task: ProductTaskDTO,
  order: ProductOrderDTO | undefined
): Omit<OrderAppNotificationDTO, "notificationId" | "kind" | "severity" | "eventLabel" | "message"> {
  return {
    readStatus: "unread",
    orderId: task.orderId,
    orderTitle: order?.title ?? task.orderTitle,
    taskId: task.taskId,
    taskTitle: task.title,
    stageId: task.stageId,
    stageLabel: task.stageName,
    participantRole: task.participantRoleLabel ?? task.assigneeRole,
    actionHref: routeHash("tasks", task.orderId, task.taskId),
    proofHref: routeHash("proof", task.orderId, task.taskId),
    createdAt: task.deadline,
    source: "local_projection",
    privacy: "participant_only"
  };
}

function normalizeApiNotification(input: Partial<OrderAppNotificationDTO>): OrderAppNotificationDTO | undefined {
  const kind = notificationKind(input.kind);
  if (
    !kind ||
    !isNonEmptyString(input.notificationId) ||
    !isNonEmptyString(input.orderId) ||
    !isNonEmptyString(input.orderTitle) ||
    !isNonEmptyString(input.eventLabel) ||
    !isNonEmptyString(input.message) ||
    !isNonEmptyString(input.actionHref) ||
    !isNonEmptyString(input.createdAt)
  ) {
    return undefined;
  }
  return {
    notificationId: input.notificationId,
    kind,
    severity: notificationSeverity(input.severity),
    readStatus: input.readStatus === "read" ? "read" : "unread",
    orderId: input.orderId,
    orderTitle: input.orderTitle,
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    ...(typeof input.taskTitle === "string" ? { taskTitle: input.taskTitle } : {}),
    ...(typeof input.stageId === "string" ? { stageId: input.stageId } : {}),
    ...(typeof input.stageLabel === "string" ? { stageLabel: input.stageLabel } : {}),
    ...(typeof input.participantRole === "string" ? { participantRole: input.participantRole } : {}),
    eventLabel: input.eventLabel,
    message: input.message,
    actionHref: input.actionHref,
    ...(typeof input.proofHref === "string" ? { proofHref: input.proofHref } : {}),
    createdAt: input.createdAt,
    ...(typeof input.readAt === "string" ? { readAt: input.readAt } : {}),
    source: input.source === "notification_delivery" ? "notification_delivery" : "api",
    privacy: "participant_only"
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function slaStateForTask(task: ProductTaskDTO, now: Date): { readonly status: "none" | "ready" | "near_deadline" | "overdue" } {
  const dueAt = parseDeadline(task.deadline);
  if (!dueAt) {
    return { status: task.status === "open" ? "ready" : "none" };
  }
  if (dueAt.getTime() < now.getTime()) {
    return { status: "overdue" };
  }
  if (dueAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) {
    return { status: "near_deadline" };
  }
  return { status: task.status === "open" ? "ready" : "none" };
}

function parseDeadline(value: string): Date | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "以业务约定为准") {
    return undefined;
  }
  const parsed = Date.parse(normalized.replace(" ", "T"));
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function blockedNotificationKind(task: ProductTaskDTO): Extract<OrderAppNotificationKind, "submission_failed" | "task_revoked"> {
  const text = `${task.blockedReason ?? ""} ${task.status} ${task.proofSummary?.label ?? ""}`;
  return /撤销|revoked|cancel|取消/u.test(text) ? "task_revoked" : "submission_failed";
}

function dedupeNotifications(notifications: readonly OrderAppNotificationDTO[]): readonly OrderAppNotificationDTO[] {
  return [...new Map(notifications.map((notification) => [notification.notificationId, notification])).values()];
}

function compareNotifications(left: OrderAppNotificationDTO, right: OrderAppNotificationDTO): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) {
    return severity;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }
  return left.notificationId.localeCompare(right.notificationId);
}

function severityRank(severity: OrderAppNotificationSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "warning":
      return 3;
    case "action":
      return 2;
    case "success":
      return 1;
    case "info":
      return 0;
  }
}

function notificationKind(value: unknown): OrderAppNotificationKind | undefined {
  switch (value) {
    case "task_ready":
    case "task_near_deadline":
    case "task_overdue":
    case "signal_submitted":
    case "submission_confirmed":
    case "submission_failed":
    case "task_revoked":
      return value;
    default:
      return undefined;
  }
}

function notificationSeverity(value: unknown): OrderAppNotificationSeverity {
  switch (value) {
    case "info":
    case "action":
    case "warning":
    case "critical":
    case "success":
      return value;
    default:
      return "info";
  }
}

function rememberReadNotification(session: ParticipantSession, notificationId: string, readAt: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = localReadStateKey(session);
  const next = Object.fromEntries(readNotificationIds(session));
  next[notificationId] = readAt;
  window.localStorage.setItem(key, JSON.stringify(next));
}

function readNotificationIds(session: ParticipantSession): ReadonlyMap<string, string> {
  if (typeof window === "undefined") {
    return new Map();
  }
  const key = localReadStateKey(session);
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (error) {
    console.error(`notification read state is corrupted; clearing ${key}`, error);
    window.localStorage.removeItem(key);
    return new Map();
  }
}

function localReadStateKey(session: ParticipantSession): string {
  return `uvp-order-app:notification-read:${session.walletAddress?.toLowerCase() ?? "anonymous"}`;
}

function pendingReadEntries(session: ParticipantSession): readonly (readonly [string, string])[] {
  if (typeof window === "undefined") {
    return [];
  }
  const key = pendingReadStateKey(session);
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  } catch (error) {
    console.error(`pending notification read queue is corrupted; clearing ${key}`, error);
    window.localStorage.removeItem(key);
    return [];
  }
}

function enqueuePendingRead(session: ParticipantSession, notificationId: string, readAt: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const next = Object.fromEntries(pendingReadEntries(session));
  next[notificationId] = readAt;
  window.localStorage.setItem(pendingReadStateKey(session), JSON.stringify(next));
}

function clearPendingRead(session: ParticipantSession, notificationId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const entries = pendingReadEntries(session);
  if (!entries.some(([id]) => id === notificationId)) {
    return;
  }
  const next = Object.fromEntries(entries.filter(([id]) => id !== notificationId));
  window.localStorage.setItem(pendingReadStateKey(session), JSON.stringify(next));
}

function pendingReadStateKey(session: ParticipantSession): string {
  return `uvp-order-app:notification-read-pending:${session.walletAddress?.toLowerCase() ?? "anonymous"}`;
}

function localNotificationId(kind: OrderAppNotificationKind, ...parts: readonly string[]): string {
  return ["local", kind, ...parts].map((part) => encodeURIComponent(part)).join(":");
}

function routeHash(section: "tasks" | "orders" | "proof", orderId: string, taskId?: string): string {
  const params = new URLSearchParams({ section, order: orderId });
  if (taskId) {
    params.set("task", taskId);
  }
  return `#${params.toString()}`;
}

function participantPath(pathname: string, session: ParticipantSession): string {
  if (!session.walletAddress) {
    return pathname;
  }
  const query = new URLSearchParams({ walletAddress: session.walletAddress });
  return `${pathname}?${query.toString()}`;
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 0 ? text : `${response.status} ${response.statusText}`;
}
