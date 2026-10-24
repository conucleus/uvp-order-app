import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOrderEscrowList } from "./read.js";
import { escrowAvailableActions, isEscrowActionAvailable } from "./actions.js";
import {
  escrowDeadlineView,
  escrowStateLabel,
  formatBaseUnits,
  formatFeeBps
} from "./format.js";
import { escrowActorRoles, type EscrowTrancheDTO } from "./types.js";

const orderId = `0x${"11".repeat(32)}`;
const trancheId = `0x${"22".repeat(32)}`;
const stageId = `0x${"33".repeat(32)}`;
const wallet = "0x1111111111111111111111111111111111111111";
const payee = "0x2222222222222222222222222222222222222222";
const verifier = "0x3333333333333333333333333333333333333333";
const feeRecipient = "0x4444444444444444444444444444444444444444";
const DAY_MS = 24 * 60 * 60 * 1000;

function tranche(overrides: Partial<EscrowTrancheDTO> = {}): EscrowTrancheDTO {
  return {
    orderId,
    stageId,
    trancheId,
    payer: wallet,
    payee,
    verifier,
    amount: "1000000",
    observationDays: 14,
    feeBps: 100,
    feeRecipient,
    state: "frozen",
    approvedAt: null,
    rejectedAt: null,
    suspendedAt: null,
    releaseAt: null,
    refundAt: null,
    payerAmount: null,
    payeeAmount: null,
    feeAmount: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    blockNumber: "18735000",
    logIndex: 3,
    ...overrides
  };
}

describe("escrow read model", () => {
  it("parses the tranche projection and formats base units, state and fee", () => {
    const frozen = tranche();
    const approved = tranche({
      trancheId: `0x${"44".repeat(32)}`,
      stageId: `0x${"55".repeat(32)}`,
      state: "approved",
      amount: "1234567890",
      approvedAt: "2026-10-01T00:00:00.000Z",
      payerAmount: "0",
      payeeAmount: "999000000",
      feeAmount: "1000000"
    });

    const parsed = parseOrderEscrowList(orderId, { orderId, tranches: [frozen, approved] });

    assert.deepEqual(parsed, { orderId, tranches: [frozen, approved] });
    assert.equal(formatBaseUnits("1000000"), "1.000000");
    assert.equal(formatBaseUnits("1234567890"), "1,234.567890");
    assert.equal(formatBaseUnits("7"), "0.000007");
    assert.equal(escrowStateLabel("frozen"), "已冻款");
    assert.equal(escrowStateLabel("suspended"), "已挂起");
    assert.equal(formatFeeBps(100), "1%（100 bps）");
    assert.equal(formatFeeBps(0), "0%（不抽点）");
  });

  it("derives the observation and rejection countdowns from chain timestamps", () => {
    const approved = tranche({
      state: "approved",
      approvedAt: "2026-10-01T00:00:00.000Z"
    });
    const observation = escrowDeadlineView(approved, Date.parse("2026-10-10T00:00:00.000Z"));
    assert.ok(observation);
    assert.equal(observation.kind, "observation");
    assert.equal(observation.deadlineIso, "2026-10-15T00:00:00.000Z");
    assert.equal(observation.remainingMs, 5 * DAY_MS);
    assert.equal(observation.text, "观察期剩余 5 天 0 小时");

    const rejected = tranche({
      state: "rejected",
      rejectedAt: "2026-10-01T00:00:00.000Z"
    });
    const rejection = escrowDeadlineView(rejected, Date.parse("2026-10-02T12:00:00.000Z"));
    assert.ok(rejection);
    assert.equal(rejection.kind, "rejection");
    assert.equal(rejection.deadlineIso, "2026-10-03T00:00:00.000Z");
    assert.equal(rejection.text, "退款窗口剩余 12 小时 0 分");

    const elapsed = escrowDeadlineView(rejected, Date.parse("2026-10-04T00:00:00.000Z"));
    assert.equal(elapsed?.text, "退款窗口已到期（无挂起时可由任何人触发退款）");
  });

  it("rejects a state outside the escrow vocabulary", () => {
    assert.throws(
      () => parseOrderEscrowList(orderId, { orderId, tranches: [tranche({ state: "locked" as EscrowTrancheDTO["state"] })] }),
      (error: unknown) => error instanceof Error && /state 不在托管状态词表内：locked/u.test(error.message)
    );
  });

  it("parses started and gates each action by both role and state", () => {
    const started = tranche({ state: "started" });
    assert.deepEqual(
      parseOrderEscrowList(orderId, { orderId, tranches: [started] }).tranches[0]?.state,
      "started"
    );
    assert.equal(escrowStateLabel("started"), "已开始履约");

    const frozen = tranche();
    const approved = tranche({ state: "approved" });
    const rejected = tranche({ state: "rejected" });
    const suspended = tranche({ state: "suspended" });
    const payerRoles = escrowActorRoles(frozen, wallet);
    const payeeRoles = escrowActorRoles(frozen, payee);
    const verifierRoles = escrowActorRoles(frozen, verifier);

    assert.deepEqual([...escrowAvailableActions(frozen, payeeRoles)].sort(), ["markStarted", "refundByPayee", "suspend"]);
    assert.deepEqual([...escrowAvailableActions(started, payeeRoles)].sort(), ["refundByPayee", "suspend"]);
    assert.deepEqual([...escrowAvailableActions(frozen, verifierRoles)], []);
    assert.deepEqual([...escrowAvailableActions(started, verifierRoles)].sort(), ["approve", "reject"]);
    assert.equal(isEscrowActionAvailable("approve", frozen, verifierRoles), false);
    assert.deepEqual([...escrowAvailableActions(frozen, payerRoles)].sort(), ["refundByPayer", "suspend"]);
    assert.deepEqual([...escrowAvailableActions(started, payerRoles)].sort(), ["payNow", "suspend"]);
    assert.deepEqual([...escrowAvailableActions(approved, payerRoles)].sort(), ["payNow", "suspend"]);
    assert.equal(isEscrowActionAvailable("refundByPayer", approved, payerRoles), false);
    assert.equal(isEscrowActionAvailable("refundByPayee", approved, payeeRoles), false);
    assert.deepEqual([...escrowAvailableActions(rejected, payeeRoles)].sort(), ["refundByPayee", "suspend"]);
    assert.deepEqual([...escrowAvailableActions(rejected, payerRoles)].sort(), ["suspend"]);
    assert.deepEqual([...escrowAvailableActions(suspended, payerRoles)].sort(), ["consentSettlement"]);
  });
});
