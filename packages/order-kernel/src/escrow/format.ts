// 托管展示映射：base units → 6 位小数金额、费率、状态/角色文案与观察期/
// 退款窗口倒计时。REJECTION_WINDOW 与金额小数位镜像 StageEscrow.sol /
// V2 设计；这里只做显示派生，不参与动作裁决（合约仍是唯一裁决方）。

import type { EscrowTrancheDTO, EscrowTrancheState } from "./types";

export const ESCROW_TOKEN_DECIMALS = 6;
export const ESCROW_REJECTION_WINDOW_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const STATE_LABELS: Readonly<Record<EscrowTrancheState, string>> = {
  frozen: "已冻款",
  started: "已开始履约",
  approved: "观察期",
  rejected: "已拒绝",
  suspended: "已挂起",
  paid: "已付款",
  refunded: "已退款",
  settled: "已结算"
};

export function escrowStateLabel(state: EscrowTrancheState): string {
  return STATE_LABELS[state];
}

export function escrowStateTone(state: EscrowTrancheState): "neutral" | "ok" | "warn" | "danger" {
  switch (state) {
    case "frozen":
      return "neutral";
    case "started":
    case "approved":
      return "ok";
    case "rejected":
      return "danger";
    case "suspended":
      return "warn";
    case "paid":
    case "refunded":
    case "settled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function formatBaseUnits(raw: string, decimals: number = ESCROW_TOKEN_DECIMALS): string {
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) {
    return raw;
  }
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  return decimals === 0 ? groupThousands(whole) : `${groupThousands(whole)}.${fraction}`;
}

export function formatTokenAmount(raw: string, symbol: string, decimals: number = ESCROW_TOKEN_DECIMALS): string {
  return `${formatBaseUnits(raw, decimals)} ${symbol}`;
}

export function formatFeeBps(feeBps: number): string {
  if (!Number.isSafeInteger(feeBps) || feeBps < 0) {
    return `${feeBps} bps`;
  }
  if (feeBps === 0) {
    return "0%（不抽点）";
  }
  const percent = feeBps / 100;
  const percentText = percent.toFixed(2).replace(/\.?0+$/u, "");
  return `${percentText}%（${feeBps} bps）`;
}

export function formatEscrowTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return value;
  }
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface EscrowDeadlineView {
  readonly kind: "observation" | "rejection";
  readonly deadlineIso: string;
  readonly deadlineLabel: string;
  readonly remainingMs: number;
  readonly text: string;
}

export function escrowDeadlineView(tranche: EscrowTrancheDTO, nowMs: number): EscrowDeadlineView | undefined {
  if (tranche.state === "approved") {
    const approvedMs = tranche.approvedAt ? Date.parse(tranche.approvedAt) : Number.NaN;
    if (!Number.isFinite(approvedMs) || !Number.isSafeInteger(tranche.observationDays) || tranche.observationDays <= 0) {
      return undefined;
    }
    const deadlineMs = approvedMs + tranche.observationDays * DAY_MS;
    return {
      kind: "observation",
      deadlineIso: new Date(deadlineMs).toISOString(),
      deadlineLabel: "观察期截止",
      remainingMs: deadlineMs - nowMs,
      text: deadlineMs > nowMs
        ? `观察期剩余 ${formatRemaining(deadlineMs - nowMs)}`
        : "观察期已到期（无挂起时可由任何人触发放款）"
    };
  }
  if (tranche.state === "rejected") {
    const rejectedMs = tranche.rejectedAt ? Date.parse(tranche.rejectedAt) : Number.NaN;
    if (!Number.isFinite(rejectedMs)) {
      return undefined;
    }
    const deadlineMs = rejectedMs + ESCROW_REJECTION_WINDOW_MS;
    return {
      kind: "rejection",
      deadlineIso: new Date(deadlineMs).toISOString(),
      deadlineLabel: "退款窗口截止",
      remainingMs: deadlineMs - nowMs,
      text: deadlineMs > nowMs
        ? `退款窗口剩余 ${formatRemaining(deadlineMs - nowMs)}`
        : "退款窗口已到期（无挂起时可由任何人触发退款）"
    };
  }
  return undefined;
}

export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "已到期";
  }
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }
  return `${minutes} 分钟`;
}

export function shortAddress(address: string | undefined): string {
  if (!address) {
    return "—";
  }
  const value = address.trim();
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

export function shortHex(value: string | undefined, head = 10, tail = 8): string {
  if (!value) {
    return "—";
  }
  return value.length > head + tail ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}
