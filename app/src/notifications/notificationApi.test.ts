import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import { demoOrder, demoTask } from "@uvp-eth/product-dto/fixtures";
import { deriveOrderAppNotifications } from "./notificationApi.js";

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
