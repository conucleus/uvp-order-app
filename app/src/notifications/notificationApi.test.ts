import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { demoOrder, demoTask } from "@uvp-eth/product-dto/fixtures";
import {
  deriveOrderAppNotifications,
  loadOrderAppNotifications,
  markOrderAppNotificationRead,
  syncPendingNotificationReads
} from "./notificationApi.js";
import type { ParticipantSession } from "../auth/participant";
import type { ProductHomeData } from "../api/productApi";
import type { OrderAppNotificationDTO } from "./types.js";

const readReceiptTarget: OrderAppNotificationDTO = {
  notificationId: "notification-1",
  kind: "task_ready",
  severity: "action",
  readStatus: "unread",
  orderId: demoOrder.orderId,
  orderTitle: demoOrder.title,
  eventLabel: "任务已就绪",
  message: "需要处理当前阶段。",
  actionHref: "#section=tasks",
  createdAt: "2026-04-28 12:00",
  source: "local_projection",
  privacy: "participant_only"
};

const session: ParticipantSession = { walletAddress: "0xabc0000000000000000000000000000000000009" };

const realSourceData = {
  participant: {},
  summary: {},
  orders: [],
  tasks: [],
  source: { kind: "real", baseUrl: "https://product-api.example" }
} as unknown as ProductHomeData;

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function installMemoryWindow(): MemoryStorage {
  const backing = new Map<string, string>();
  const storage: MemoryStorage = {
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
    clear: () => {
      backing.clear();
    }
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return storage;
}

function uninstallMemoryWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

describe("order app notification read receipts", () => {
  it("keeps the local read but flags syncPending when the server rejects the receipt", async () => {
    installMemoryWindow();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const failingFetcher = async () => new Response("storage unavailable", { status: 503 });
      const result = await markOrderAppNotificationRead(readReceiptTarget, realSourceData, session, failingFetcher);

      assert.equal(result.readStatus, "read");
      assert.equal(result.syncPending, true);
      assert.notEqual(result.readAt, undefined);

      // The queued receipt replays verbatim on the next successful sync pass.
      const postedUrls: string[] = [];
      const succeedingFetcher = async (input: RequestInfo | URL) => {
        postedUrls.push(String(input));
        return new Response("{}", { status: 200 });
      };
      const sync = await syncPendingNotificationReads(realSourceData, session, succeedingFetcher);
      assert.deepEqual(sync, { synced: 1, remaining: 0 });
      assert.match(postedUrls[0] ?? "", /\/product\/me\/activity-feed\/notification-1\/read$/);
    } finally {
      console.warn = originalWarn;
      uninstallMemoryWindow();
    }
  });

  it("stops reporting syncPending once a retry has been acknowledged", async () => {
    installMemoryWindow();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await markOrderAppNotificationRead(
        readReceiptTarget,
        realSourceData,
        session,
        async () => new Response("boom", { status: 500 })
      );

      let attempts = 0;
      const flakyFetcher = async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("{}", { status: 200 });
        }
        throw new Error("network gone");
      };
      const acknowledged = await markOrderAppNotificationRead(
        readReceiptTarget,
        realSourceData,
        session,
        flakyFetcher
      );
      assert.equal(acknowledged.syncPending, undefined);
      assert.equal(attempts, 1);

      const drained = await syncPendingNotificationReads(
        realSourceData,
        session,
        async () => new Response("{}", { status: 200 })
      );
      assert.deepEqual(drained, { synced: 0, remaining: 0 });
    } finally {
      console.warn = originalWarn;
      uninstallMemoryWindow();
    }
  });

  it("never queues receipts outside real API mode", async () => {
    installMemoryWindow();
    try {
      const derivedData = { ...realSourceData, source: { kind: "demo", reason: "demo-mode" } } as unknown as ProductHomeData;
      const result = await markOrderAppNotificationRead(
        readReceiptTarget,
        derivedData,
        session,
        async () => new Response("{}", { status: 200 })
      );
      assert.equal(result.syncPending, undefined);
      const sync = await syncPendingNotificationReads(
        derivedData,
        session,
        async () => new Response("{}", { status: 200 })
      );
      assert.deepEqual(sync, { synced: 0, remaining: 0 });
    } finally {
      uninstallMemoryWindow();
    }
  });
});

describe("order app notification loading", () => {
  it("fails fast when the activity feed is unreachable instead of deriving local reminders", async () => {
    const failingFetcher = async () => new Response("feed down", { status: 503 });
    await assert.rejects(
      loadOrderAppNotifications(realSourceData, session, failingFetcher),
      /feed down/
    );
  });

  it("rejects notification loads for sources other than the real participant API", async () => {
    const demoData = { ...realSourceData, source: { kind: "demo", reason: "demo-mode" } } as unknown as ProductHomeData;
    await assert.rejects(loadOrderAppNotifications(demoData, session), /参与者服务/);
  });

  it("skips notifications without server-provided required fields and warns with the count", async () => {
    const validEntry = {
      notificationId: "notification-9",
      kind: "signal_submitted",
      severity: "success",
      readStatus: "unread",
      orderId: "order-7",
      orderTitle: "真实订单标题",
      eventLabel: "链上信号已提交",
      message: "服务端下发的通知正文。",
      actionHref: "#section=orders&order=order-7",
      createdAt: "2026-08-01T00:00:00.000Z",
      source: "notification_delivery"
    };
    const fetcher = async () => new Response(JSON.stringify({
      notifications: [
        validEntry,
        { ...validEntry, notificationId: "notification-no-order-id", orderId: undefined },
        { ...validEntry, notificationId: "notification-unknown-kind", kind: "mystery_kind" }
      ]
    }), { status: 200 });
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const result = await loadOrderAppNotifications(realSourceData, session, fetcher);

      assert.equal(result.notifications.length, 1);
      assert.deepEqual(result.notifications[0], {
        notificationId: "notification-9",
        kind: "signal_submitted",
        severity: "success",
        readStatus: "unread",
        orderId: "order-7",
        orderTitle: "真实订单标题",
        eventLabel: "链上信号已提交",
        message: "服务端下发的通知正文。",
        actionHref: "#section=orders&order=order-7",
        createdAt: "2026-08-01T00:00:00.000Z",
        source: "notification_delivery",
        privacy: "participant_only"
      });
      assert.equal(result.unreadCount, 1);
      const serialized = JSON.stringify(result.notifications);
      assert.equal(serialized.includes("链上订单"), false);
      assert.equal(serialized.includes("unknown"), false);
      assert.equal(warnings.filter((message) => /2 invalid notification entries/.test(message)).length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("clears corrupted local read state instead of silently discarding it", async () => {
    const storage = installMemoryWindow();
    const readKey = "uvp-order-app:notification-read:0xabc0000000000000000000000000000000000009";
    storage.setItem(readKey, "{corrupted");
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await markOrderAppNotificationRead(
        readReceiptTarget,
        { ...realSourceData, source: { kind: "demo", reason: "demo-mode" } } as unknown as ProductHomeData,
        session,
        async () => new Response("{}", { status: 200 })
      );

      assert.equal(errors.some((args) => String(args[0]).includes(readKey)), true);
      const stored = storage.getItem(readKey);
      assert.notEqual(stored, null);
      assert.doesNotThrow(() => JSON.parse(stored!));
    } finally {
      console.error = originalError;
      uninstallMemoryWindow();
    }
  });

  it("clears a corrupted pending read queue before syncing", async () => {
    const storage = installMemoryWindow();
    const pendingKey = "uvp-order-app:notification-read-pending:0xabc0000000000000000000000000000000000009";
    storage.setItem(pendingKey, "not-json");
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const sync = await syncPendingNotificationReads(realSourceData, session, async () => new Response("{}", { status: 200 }));

      assert.deepEqual(sync, { synced: 0, remaining: 0 });
      assert.equal(errors.some((args) => String(args[0]).includes(pendingKey)), true);
      assert.equal(storage.getItem(pendingKey), null);
    } finally {
      console.error = originalError;
      uninstallMemoryWindow();
    }
  });
});

describe("order app notification projection", () => {
  it("derives ready and overdue reminders without leaking participant contact details", () => {
    const privateOrder = {
      ...demoOrder,
      participants: [
        {
          ...demoOrder.participants[0],
          contact: "private-buyer@example.com"
        }
      ]
    } as unknown as ProductOrderDTO;
    const overdueTask = {
      ...demoTask,
      deadline: "2026-04-28 12:00",
      status: "open"
    } satisfies ProductTaskDTO;

    const notifications = deriveOrderAppNotifications({
      orders: [privateOrder],
      tasks: [overdueTask],
      now: new Date("2026-04-29T12:00:00.000Z")
    });

    assert.equal(notifications[0]?.kind, "task_overdue");
    assert.equal(notifications[0]?.privacy, "participant_only");
    assert.equal(JSON.stringify(notifications).includes("private-buyer@example.com"), false);
  });

  it("represents confirmed, waiting-indexing, failed, and revoked states as non-authoritative notifications", () => {
    const doneTask = {
      ...demoTask,
      taskId: "done-task",
      status: "done"
    } satisfies ProductTaskDTO;
    const submittedTask = {
      ...demoTask,
      taskId: "submitted-task",
      status: "submitted"
    } satisfies ProductTaskDTO;
    const failedTask = {
      ...demoTask,
      taskId: "failed-task",
      status: "blocked",
      blockedReason: "提交失败，等待重新准备签名"
    } satisfies ProductTaskDTO;
    const revokedTask = {
      ...demoTask,
      taskId: "revoked-task",
      status: "blocked",
      blockedReason: "链上条件已撤销"
    } satisfies ProductTaskDTO;

    const notifications = deriveOrderAppNotifications({
      orders: [demoOrder],
      tasks: [doneTask, submittedTask, failedTask, revokedTask],
      now: new Date("2026-04-29T12:00:00.000Z")
    });
    const kinds = notifications.map((notification) => notification.kind);

    assert.ok(kinds.includes("submission_confirmed"));
    // submitted 只能产生等待索引的中间态通知，不得提前宣布"提交已确认"。
    const submittedNotification = notifications.find((notification) => notification.notificationId.includes("submitted-task"));
    assert.equal(submittedNotification?.kind, "signal_submitted");
    assert.equal(submittedNotification?.severity, "info");
    assert.equal(submittedNotification?.eventLabel, "等待索引确认");
    assert.equal(kinds.filter((kind) => kind === "submission_confirmed").length, 1);
    assert.ok(kinds.includes("submission_failed"));
    assert.ok(kinds.includes("task_revoked"));
    assert.equal(notifications.every((notification) => notification.source === "local_projection"), true);
  });
});
