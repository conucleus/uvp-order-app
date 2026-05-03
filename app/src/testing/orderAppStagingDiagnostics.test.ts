import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { diagnoseStagingTaskWalletMatch } from "./orderAppStagingDiagnostics";

const WALLET_A = "0x9d8A62f656a8d1615C1294FD71E9cfB3e4855A4F";
const WALLET_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const WALLET_C = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function taskFixture(overrides: Partial<ProductTaskDTO> = {}): ProductTaskDTO {
  return {
    taskId: overrides.taskId ?? "task-diag-001",
    orderId: overrides.orderId ?? "order-001",
    orderTitle: overrides.orderTitle ?? "跨境贸易订单",
    zhixuId: overrides.zhixuId ?? "zhixu-001",
    title: overrides.title ?? "履约提交",
    subtitle: overrides.subtitle ?? "",
    assigneeRole: overrides.assigneeRole ?? "报关行",
    stageId: overrides.stageId ?? "customs-complete",
    stageName: overrides.stageName ?? "出口报关",
    deadline: overrides.deadline ?? "2026-05-15 18:00",
    fundingImpact: overrides.fundingImpact ?? "无资金变动",
    requiredEvidence: overrides.requiredEvidence ?? [],
    status: overrides.status ?? "open",
    proofRows: overrides.proofRows ?? [],
    proofSummary: overrides.proofSummary ?? { label: "等待提交" },
    responsibilityStatements: overrides.responsibilityStatements ?? [],
    ...overrides
  };
}

describe("Staging diagnostics: wallet/task mismatch", () => {
  it("reports Product API tasks, matched count, and filtered-out count", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", participantWallet: WALLET_B }),
      taskFixture({ taskId: "t-3", participantWallet: WALLET_B }),
      taskFixture({ taskId: "t-4", assigneeWallet: WALLET_A }),
      taskFixture({ taskId: "t-5" }) // no wallet — matches any
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, WALLET_A);

    assert.equal(report.walletMatch.apiTaskCount, 5);
    assert.equal(report.walletMatch.walletMatchedCount, 3); // t-1, t-4, t-5
    assert.equal(report.walletMatch.filteredOutCount, 2); // t-2, t-3
    assert.equal(report.walletHasTasks, true);
    assert.ok(report.diagnosis.includes("Product API 返回了 5 个任务"));
    assert.ok(report.diagnosis.includes("匹配了 3 个"));
    assert.ok(report.diagnosis.includes("过滤掉 2 个"));
    assert.ok(report.nextAction.includes("切换至"));
  });

  it("provides unmatched wallet hints for staging release owner", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", participantWallet: WALLET_B }),
      taskFixture({ taskId: "t-3", assigneeWallet: WALLET_C })
    ];

    // Wallet B has 1 matching task (t-2), 2 filtered out — goes to "has tasks" branch
    const reportB = diagnoseStagingTaskWalletMatch(tasks, WALLET_B);

    assert.equal(reportB.walletHasTasks, true);
    assert.deepEqual(reportB.walletMatch.unmatchedWallets, [WALLET_A.toLowerCase(), WALLET_C.toLowerCase()]);
    assert.equal(reportB.walletMatch.unmatchedWalletHints.length, 2);
    assert.equal(reportB.walletMatch.filteredOutCount, 2);
    assert.ok(reportB.nextAction.includes("切换至"));
    // nextAction hints at the unmatched wallets
    assert.ok(reportB.nextAction.includes("0x9d8a...5a4f") || reportB.nextAction.includes("9d8a"));
    assert.ok(reportB.nextAction.includes("0x7099...79c8") || reportB.nextAction.includes("7099"));
  });

  it("detects when no wallet is connected", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", participantWallet: WALLET_B })
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, undefined);

    assert.equal(report.walletMatch.apiTaskCount, 2);
    assert.equal(report.walletMatch.walletMatchedCount, 2); // no wallet = no filter
    assert.equal(report.walletMatch.filteredOutCount, 0);
    assert.equal(report.walletHasTasks, true);
    assert.equal(report.walletMatch.connectedWalletHint, "未连接");
    assert.ok(report.diagnosis.includes("未连接钱包"));
    assert.ok(report.nextAction.includes("连接参与者钱包"));
  });

  it("detects empty Product API response", () => {
    const report = diagnoseStagingTaskWalletMatch([], WALLET_A);

    assert.equal(report.walletMatch.apiTaskCount, 0);
    assert.equal(report.walletMatch.walletMatchedCount, 0);
    assert.equal(report.walletMatch.filteredOutCount, 0);
    assert.equal(report.walletHasTasks, false);
    assert.ok(report.diagnosis.includes("未返回任何任务"));
    assert.ok(report.nextAction.includes("Product API"));
  });

  it("detects all tasks filtered out (wrong wallet for staging)", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", assigneeWallet: WALLET_A })
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, WALLET_B);

    assert.equal(report.walletMatch.apiTaskCount, 2);
    assert.equal(report.walletMatch.walletMatchedCount, 0);
    assert.equal(report.walletMatch.filteredOutCount, 2);
    assert.equal(report.walletHasTasks, false);
    assert.ok(report.diagnosis.includes("未匹配到任何任务"));
    assert.ok(report.nextAction.includes("请尝试以下钱包"));
    // Should hint at WALLET_A
    assert.ok(report.walletMatch.unmatchedWallets.includes(WALLET_A.toLowerCase()));
  });

  it("includes required full-mode events in every report", () => {
    const report = diagnoseStagingTaskWalletMatch([], undefined);
    assert.ok(report.requiredEvents.length >= 4);
    assert.ok(report.requiredEvents.includes("StageExecutorPatchApplied"));
    assert.ok(report.requiredEvents.includes("SignalSubmitted"));
  });

  it("produces clean report when all tasks match the wallet", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", assigneeWallet: WALLET_A })
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, WALLET_A);

    assert.equal(report.walletMatch.apiTaskCount, 2);
    assert.equal(report.walletMatch.walletMatchedCount, 2);
    assert.equal(report.walletMatch.filteredOutCount, 0);
    assert.equal(report.walletHasTasks, true);
    assert.ok(report.diagnosis.includes("一切正常") || report.nextAction.includes("一切正常"));
    assert.equal(report.walletMatch.unmatchedWallets.length, 0);
  });

  it("deduplicates unmatched wallets from multiple tasks", () => {
    const tasks: readonly ProductTaskDTO[] = [
      taskFixture({ taskId: "t-1", participantWallet: WALLET_A }),
      taskFixture({ taskId: "t-2", assigneeWallet: WALLET_A }), // same wallet, different field
      taskFixture({ taskId: "t-3", participantWallet: WALLET_B })
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, WALLET_C);

    assert.equal(report.walletMatch.unmatchedWallets.length, 2);
    assert.deepEqual(
      [...report.walletMatch.unmatchedWallets].sort(),
      [WALLET_A.toLowerCase(), WALLET_B.toLowerCase()].sort()
    );
  });

  it("never falls back to demo — works with real fixture shape", () => {
    const tasks: readonly ProductTaskDTO[] = [
      {
        taskId: "real-task-001",
        orderId: "order-real-001",
        orderTitle: "Real Order",
        zhixuId: "zhixu-real-001",
        title: "Real Task",
        subtitle: "",
        assigneeRole: "supplier",
        assigneeWallet: WALLET_A,
        stageId: "stage-1",
        stageName: "Stage 1",
        deadline: "2026-06-01",
        fundingImpact: "none",
        requiredEvidence: [],
        status: "open",
        proofRows: [],
        proofSummary: { label: "已确认", txHash: "0xabc123" },
        responsibilityStatements: []
      }
    ];

    const report = diagnoseStagingTaskWalletMatch(tasks, WALLET_A);

    assert.equal(report.walletMatch.apiTaskCount, 1);
    assert.equal(report.walletMatch.walletMatchedCount, 1);
    assert.equal(report.walletHasTasks, true);
    assert.ok(report.diagnosis.includes("Product API"));
  });
});
