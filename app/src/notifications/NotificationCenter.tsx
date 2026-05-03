import { AlertTriangle, Bell, CheckCircle2, Clock3, ExternalLink, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ParticipantSession } from "../auth/participant";
import type { ProductHomeData } from "../api/productApi";
import {
  loadOrderAppNotifications,
  markOrderAppNotificationRead
} from "./notificationApi";
import type { OrderAppNotificationDTO, OrderAppNotificationList } from "./types";

type NotificationLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: OrderAppNotificationList }
  | { readonly status: "error"; readonly message: string; readonly data: OrderAppNotificationList };

export function useOrderAppNotifications(
  data: ProductHomeData | undefined,
  session: ParticipantSession
): {
  readonly loadState: NotificationLoadState;
  readonly unreadCount: number;
  readonly markRead: (notification: OrderAppNotificationDTO) => Promise<void>;
} {
  const [loadState, setLoadState] = useState<NotificationLoadState>({ status: "idle" });

  useEffect(() => {
    if (!data) {
      setLoadState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadOrderAppNotifications(data, session)
      .then((nextData) => {
        if (cancelled) {
          return;
        }
        if (nextData.error) {
          setLoadState({ status: "error", message: nextData.error, data: nextData });
          return;
        }
        setLoadState({ status: "ready", data: nextData });
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "通知加载失败",
            data: {
              notifications: [],
              unreadCount: 0,
              source: "derived",
              sourceOfTruth: "local-product-projection"
            }
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data, session]);

  async function markRead(notification: OrderAppNotificationDTO): Promise<void> {
    if (!data) {
      return;
    }
    const nextNotification = await markOrderAppNotificationRead(notification, data, session);
    setLoadState((current) => {
      if (current.status !== "ready" && current.status !== "error") {
        return current;
      }
      const notifications = current.data.notifications.map((item) =>
        item.notificationId === nextNotification.notificationId ? nextNotification : item
      );
      const nextData = {
        ...current.data,
        notifications,
        unreadCount: notifications.filter((item) => item.readStatus === "unread").length
      };
      return current.status === "error"
        ? { status: "error", message: current.message, data: nextData }
        : { status: "ready", data: nextData };
    });
  }

  const unreadCount = loadState.status === "ready" || loadState.status === "error"
    ? loadState.data.unreadCount
    : 0;

  return { loadState, unreadCount, markRead };
}

export function NotificationCenter({
  loadState,
  onMarkRead,
  onOpenNotification
}: {
  readonly loadState: NotificationLoadState;
  readonly onMarkRead: (notification: OrderAppNotificationDTO) => void;
  readonly onOpenNotification: (notification: OrderAppNotificationDTO) => void;
}) {
  const data = loadState.status === "ready" || loadState.status === "error" ? loadState.data : undefined;
  const notifications = useMemo(() => data?.notifications ?? [], [data?.notifications]);

  return (
    <section className="notification-center" aria-label="通知中心">
      <div className="notification-header">
        <div>
          <span className="overline">通知中心</span>
          <h2>协作提醒</h2>
        </div>
        <span className={`notification-source source-${data?.source ?? "loading"}`}>
          {data?.source === "api" ? "参与者服务" : "本地投影"}
        </span>
      </div>

      {loadState.status === "loading" ? (
        <div className="notification-empty">
          <Clock3 aria-hidden="true" />
          <span>正在加载通知</span>
        </div>
      ) : null}

      {loadState.status === "error" ? (
        <p className="notification-service-warning">{loadState.message}；下方仅展示从当前订单和待办派生的本地提醒。</p>
      ) : null}

      {loadState.status !== "loading" && notifications.length === 0 ? (
        <div className="notification-empty">
          <Bell aria-hidden="true" />
          <span>暂无与你的钱包匹配的提醒</span>
        </div>
      ) : null}

      {notifications.length > 0 ? (
        <div className="notification-list">
          {notifications.map((notification) => (
            <article
              className={`notification-card notification-${notification.severity} ${notification.readStatus === "read" ? "is-read" : ""}`}
              key={notification.notificationId}
            >
              <span className="notification-icon" aria-hidden="true">
                {notificationIcon(notification)}
              </span>
              <div className="notification-copy">
                <div className="notification-title-line">
                  <strong>{notification.eventLabel}</strong>
                  <span>{notification.readStatus === "read" ? "已读" : "未读"}</span>
                </div>
                <p>{notification.message}</p>
                <div className="notification-meta">
                  <span>{notification.orderTitle}</span>
                  {notification.stageLabel ? <span>{notification.stageLabel}</span> : null}
                  <span>{notification.privacy === "participant_only" ? "仅参与方可见" : ""}</span>
                </div>
              </div>
              <div className="notification-actions">
                <button className="quiet-button" type="button" onClick={() => onOpenNotification(notification)}>
                  <ExternalLink aria-hidden="true" />
                  打开
                </button>
                {notification.readStatus === "unread" ? (
                  <button className="quiet-button" type="button" onClick={() => onMarkRead(notification)}>
                    <CheckCircle2 aria-hidden="true" />
                    已读
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function notificationIcon(notification: OrderAppNotificationDTO) {
  if (notification.severity === "critical") {
    return <ShieldAlert />;
  }
  if (notification.severity === "warning") {
    return <AlertTriangle />;
  }
  if (notification.severity === "success") {
    return <CheckCircle2 />;
  }
  return <Bell />;
}
