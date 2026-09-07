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

/** 与同仓 productApi 相同的超时口径：通知请求挂起不得让面板永久 loading。 */
const NOTIFICATION_FETCH_TIMEOUT_MS = 6000;

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
      },
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS)
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
      }),
      signal: AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS)
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
  // 写路径与读路径同样防护：该函数在调用方的 try 之外执行，禁存储/配额满
  // 时抛出会变成未处理 rejection，并让已读点击整体静默失败。
  tryWriteLocalStorage(key, JSON.stringify(next));
}

/**
 * localStorage 写入永不抛出：读路径（readNotificationIds/pendingReadEntries）
 * 已有防护，写路径保持同一口径——本地已读只是缓存，写不进去降级为
 * "本次会话内已读"，不阻断已读回执的发送。
 */
function tryWriteLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`notification read state is not persistable (${key}); continuing in-memory`, error);
  }
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
  // 该函数在失败回补路径（catch 分支）里调用：写失败不得顶替原返回值。
  tryWriteLocalStorage(pendingReadStateKey(session), JSON.stringify(next));
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
  tryWriteLocalStorage(pendingReadStateKey(session), JSON.stringify(next));
}

function pendingReadStateKey(session: ParticipantSession): string {
  return `uvp-order-app:notification-read-pending:${session.walletAddress?.toLowerCase() ?? "anonymous"}`;
}

function localNotificationId(kind: OrderAppNotificationKind, ...parts: readonly string[]): string {
  // 服务端 read 回执端点按 bytes32 校验 notificationId（uvp-chain-services
  // normalizeBytes32），非 0x+64hex 形态一律 400——本地派生 ID 若保留
  // `local:kind:task` 可读形态，接线后已读回执永远发不上去（0216 S26）。
  // 派生是同步投影（deriveOrderAppNotifications 无 await），crypto.subtle
  // 不可用，这里用内置同步 SHA-256 得到 32 字节 hex；\0 分隔避免 parts
  // 含 ":" 时产生歧义碰撞。
  const payload = new TextEncoder().encode(["local", kind, ...parts].join("\u0000"));
  return `0x${hexOf(sha256Sync(payload))}`;
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256Sync(input: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const blockCount = (input.length + 9 + 63) >> 6;
  const paddedLength = blockCount * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[paddedLength - 8] = high >>> 24;
  padded[paddedLength - 7] = (high >>> 16) & 0xff;
  padded[paddedLength - 6] = (high >>> 8) & 0xff;
  padded[paddedLength - 5] = high & 0xff;
  padded[paddedLength - 4] = low >>> 24;
  padded[paddedLength - 3] = (low >>> 16) & 0xff;
  padded[paddedLength - 2] = (low >>> 8) & 0xff;
  padded[paddedLength - 1] = low & 0xff;

  const words = new Uint32Array(64);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const fifteen = words[index - 15]!;
      const two = words[index - 2]!;
      const sigma0 = rotateRight(fifteen, 7) ^ rotateRight(fifteen, 18) ^ (fifteen >>> 3);
      const sigma1 = rotateRight(two, 17) ^ rotateRight(two, 19) ^ (two >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigma1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < 8; index += 1) {
    const word = state[index]!;
    digest[index * 4] = word >>> 24;
    digest[index * 4 + 1] = (word >>> 16) & 0xff;
    digest[index * 4 + 2] = (word >>> 8) & 0xff;
    digest[index * 4 + 3] = word & 0xff;
  }
  return digest;
}

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
