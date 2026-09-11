export type OrderAppNotificationKind =
  | "task_ready"
  | "task_near_deadline"
  | "task_overdue"
  | "signal_submitted"
  | "submission_confirmed"
  | "submission_failed"
  | "task_revoked"
  // 服务端 reorg 回滚联动失效的投递：内容不可信，message 附操作指引。
  | "notification_invalidated";

export type OrderAppNotificationSeverity = "info" | "action" | "warning" | "critical" | "success";
export type OrderAppNotificationReadStatus = "read" | "unread";
export type OrderAppNotificationSource = "api" | "local_projection" | "notification_delivery";

export interface OrderAppNotificationDTO {
  readonly notificationId: string;
  readonly kind: OrderAppNotificationKind;
  readonly severity: OrderAppNotificationSeverity;
  readonly readStatus: OrderAppNotificationReadStatus;
  readonly orderId: string;
  readonly orderTitle: string;
  readonly taskId?: string;
  readonly taskTitle?: string;
  readonly stageId?: string;
  readonly stageLabel?: string;
  readonly participantRole?: string;
  readonly eventLabel: string;
  readonly message: string;
  readonly actionHref: string;
  readonly proofHref?: string;
  /** kind=notification_invalidated 时的结构化失效状态：按状态呈现指引，不解析文案。 */
  readonly invalidation?: {
    readonly status: "invalidated";
    readonly reason?: string;
  };
  readonly createdAt: string;
  readonly readAt?: string;
  /** True when the local read is kept but the server read receipt is still unsynced. */
  readonly syncPending?: boolean;
  readonly source: OrderAppNotificationSource;
  readonly privacy: "participant_only";
}

export interface OrderAppNotificationList {
  readonly notifications: readonly OrderAppNotificationDTO[];
  readonly unreadCount: number;
  readonly source: "api" | "derived";
  readonly sourceOfTruth: "product-projection-and-notification-read-state" | "local-product-projection";
  readonly error?: string;
}
