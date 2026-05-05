export type OrderAppNotificationKind =
  | "task_ready"
  | "task_near_deadline"
  | "task_overdue"
  | "signal_submitted"
  | "submission_confirmed"
  | "submission_failed"
  | "task_revoked"
  | "plan_revoked"
  | "supplier_revoked";

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
  readonly createdAt: string;
  readonly readAt?: string;
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
