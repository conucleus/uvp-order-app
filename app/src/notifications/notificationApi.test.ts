import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { demoOrder, demoTask } from "@uvp-eth/product-dto/fixtures";
import {
  deriveOrderAppNotifications,
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

function installMemoryWindow(): void {
  const backing = new Map<string, string>();
  const storage = {
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

  it("represents confirmed, failed, and revoked states as non-authoritative notifications", () => {
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
      tasks: [submittedTask, failedTask, revokedTask],
      now: new Date("2026-04-29T12:00:00.000Z")
    });
    const kinds = notifications.map((notification) => notification.kind);

    assert.ok(kinds.includes("submission_confirmed"));
    assert.ok(kinds.includes("submission_failed"));
    assert.ok(kinds.includes("task_revoked"));
    assert.equal(notifications.every((notification) => notification.source === "local_projection"), true);
  });
});
