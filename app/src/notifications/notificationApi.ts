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
    return derivedNotificationList(data, session);
  }

  try {
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
    const notifications = (body.notifications ?? []).map(normalizeApiNotification);
    return {
      notifications,
      unreadCount: body.unreadCount ?? notifications.filter((notification) => notification.readStatus === "unread").length,
      source: "api",
      sourceOfTruth: body.sourceOfTruth ?? "product-projection-and-notification-read-state"
    };
  } catch (error) {
    return {
      ...derivedNotificationList(data, session),
      error: error instanceof Error ? error.message : "通知服务暂不可用"
    };
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
    const response = await fetcher(
      joinUrl(data.source.baseUrl, `/product/me/activity-feed/${encodeURIComponent(notification.notificationId)}/read`),
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
    if (!response.ok) {
      throw new Error(await responseText(response));
    }
    const body = await response.json() as ApiNotificationReadResponse;
    return body.notification
      ? normalizeApiNotification(body.notification)
      : { ...notification, readStatus: "read", readAt };
  } catch {
    return { ...notification, readStatus: "read", readAt };
  }
}

export function derivedNotificationList(data: ProductHomeData, session: ParticipantSession): OrderAppNotificationList {
  const readIds = readNotificationIds(session);
  const notifications = deriveOrderAppNotifications({
    orders: data.orders,
    tasks: data.tasks,
    now: new Date()
  }).map((notification) => applyLocalReadState(notification, readIds));
  return {
    notifications,
    unreadCount: notifications.filter((notification) => notification.readStatus === "unread").length,
    source: "derived",
    sourceOfTruth: "local-product-projection"
  };
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

    if (task.status === "done" || task.status === "submitted") {
      notifications.push({
        ...base,
        notificationId: localNotificationId("submission_confirmed", task.taskId),
        kind: "submission_confirmed",
        severity: "success",
        eventLabel: "提交已确认",
        message: `${task.stageName} 已完成或已提交，继续关注后续订单状态。`
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

  for (const order of input.orders) {
    if (revokedOrderText(order)) {
      notifications.push({
        notificationId: localNotificationId("plan_revoked", order.orderId),
        kind: "plan_revoked",
        severity: "critical",
        readStatus: "unread",
        orderId: order.orderId,
        orderTitle: order.title,
        eventLabel: "订单存在撤销风险",
        message: revokedOrderText(order) ?? "订单关联的背书或参与方状态已撤销，请核对证明。",
        actionHref: routeHash("orders", order.orderId),
        proofHref: routeHash("proof", order.orderId),
        createdAt: latestOrderEventTime(order),
        source: "local_projection",
        privacy: "participant_only"
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

function normalizeApiNotification(input: Partial<OrderAppNotificationDTO>): OrderAppNotificationDTO {
  const kind = notificationKind(input.kind);
  return {
    notificationId: typeof input.notificationId === "string" ? input.notificationId : localNotificationId(kind, input.orderId ?? "unknown"),
    kind,
    severity: notificationSeverity(input.severity),
    readStatus: input.readStatus === "read" ? "read" : "unread",
    orderId: input.orderId ?? "unknown",
    orderTitle: input.orderTitle ?? "链上订单",
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    ...(typeof input.taskTitle === "string" ? { taskTitle: input.taskTitle } : {}),
    ...(typeof input.stageId === "string" ? { stageId: input.stageId } : {}),
    ...(typeof input.stageLabel === "string" ? { stageLabel: input.stageLabel } : {}),
    ...(typeof input.participantRole === "string" ? { participantRole: input.participantRole } : {}),
    eventLabel: input.eventLabel ?? labelForKind(kind),
    message: input.message ?? "通知来自 Product projection；不会改变任务或链上状态。",
    actionHref: input.actionHref ?? routeHash("orders", input.orderId ?? "unknown"),
    ...(typeof input.proofHref === "string" ? { proofHref: input.proofHref } : {}),
    createdAt: input.createdAt ?? "",
    ...(typeof input.readAt === "string" ? { readAt: input.readAt } : {}),
    source: input.source === "notification_delivery" ? "notification_delivery" : "api",
    privacy: "participant_only"
  };
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

function revokedOrderText(order: ProductOrderDTO): string | undefined {
  const text = `${order.statusLabel} ${order.currentTaskSummary} ${order.recentEvents.map((event) => event.text).join(" ")}`;
  return /撤销|revoked|revoke|背书已撤销/u.test(text) ? "订单时间线出现撤销或背书风险，请核对证明后再继续处理。" : undefined;
}

function latestOrderEventTime(order: ProductOrderDTO): string {
  return order.recentEvents[0]?.time ?? "";
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

function notificationKind(value: unknown): OrderAppNotificationKind {
  switch (value) {
    case "task_ready":
    case "task_near_deadline":
    case "task_overdue":
    case "signal_submitted":
    case "submission_confirmed":
    case "submission_failed":
    case "task_revoked":
    case "plan_revoked":
    case "supplier_revoked":
      return value;
    default:
      return "task_ready";
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

function labelForKind(kind: OrderAppNotificationKind): string {
  switch (kind) {
    case "task_ready":
      return "任务已就绪";
    case "task_near_deadline":
      return "即将到期";
    case "task_overdue":
      return "任务已逾期";
    case "signal_submitted":
      return "链上信号已提交";
    case "submission_confirmed":
      return "提交已确认";
    case "submission_failed":
      return "处理失败";
    case "task_revoked":
      return "任务已撤销";
    case "plan_revoked":
      return "秩序背书已撤销";
    case "supplier_revoked":
      return "参与方背书已撤销";
  }
}

function applyLocalReadState(
  notification: OrderAppNotificationDTO,
  readIds: ReadonlyMap<string, string>
): OrderAppNotificationDTO {
  const readAt = readIds.get(notification.notificationId);
  return readAt ? { ...notification, readStatus: "read", readAt } : notification;
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
  try {
    const raw = window.localStorage.getItem(localReadStateKey(session));
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return new Map();
  }
}

function localReadStateKey(session: ParticipantSession): string {
  return `uvp-order-app:notification-read:${session.walletAddress?.toLowerCase() ?? "anonymous"}`;
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
