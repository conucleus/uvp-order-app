import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { filterParticipantTasksForWallet, taskWalletHint } from "../tasks/taskStatus";
import { orderAppFullModeRequiredEvents } from "./orderAppFullModeGate";

export interface StagingTaskWalletDiagnostic {
  /** Tasks received from Product API. */
  readonly apiTaskCount: number;
  /** Tasks matching the connected wallet. */
  readonly walletMatchedCount: number;
  /** Tasks filtered out because wallet didn't match. */
  readonly filteredOutCount: number;
  /** Connected wallet (undefined if none). */
  readonly connectedWallet?: string;
  /** Short hex hint for the connected wallet. */
  readonly connectedWalletHint: string;
  /** Unique assignee/participant wallets found in filtered‑out tasks. */
  readonly unmatchedWallets: readonly string[];
  /** Short hex hints for the unmatched wallets. */
  readonly unmatchedWalletHints: readonly string[];
}

export interface StagingDiagnosticReport {
  /** Human‑readable diagnosis summary. */
  readonly diagnosis: string;
  /** Required full‑mode events (always present for release‑owner visibility). */
  readonly requiredEvents: readonly string[];
  /** Wallet‑task matching details. */
  readonly walletMatch: StagingTaskWalletDiagnostic;
  /** Whether the connected wallet sees any tasks. */
  readonly walletHasTasks: boolean;
  /** Action guidance for the release owner. */
  readonly nextAction: string;
}

/**
 * Diagnose wallet‑task mismatch from Product API task data.
 *
 * Use this helper during staging to answer:
 *  - Product API returned N tasks
 *  - current wallet matched M
 *  - filtered out K
 *  - what wallet hint should be used next
 *
 * The helper never falls back to demo. It requires real Product API data
 * (or full‑mode fixture tasks) and a wallet address to produce a meaningful
 * diagnosis.
 */
export function diagnoseStagingTaskWalletMatch(
  tasks: readonly ProductTaskDTO[],
  walletAddress: string | undefined
): StagingDiagnosticReport {
  const filterResult = filterParticipantTasksForWallet(tasks, walletAddress);
  const walletHint = walletAddress ? taskWalletHint(walletAddress) : "未连接";

  const unmatchedWallets = extractUnmatchedWallets(tasks, walletAddress);

  const walletHasTasks = filterResult.tasks.length > 0;

  let diagnosis: string;
  let nextAction: string;

  if (!walletAddress) {
    diagnosis =
      `Product API 返回了 ${filterResult.totalFromApi} 个任务。当前未连接钱包，无法过滤。` +
      (filterResult.totalFromApi > 0
        ? ` 适用钱包：${unmatchedWallets.map(taskWalletHint).join("、")}。`
        : " 请确认 Product API 中是否有为该参与者创建的任务。");
    nextAction = "连接参与者钱包（环境变量 VITE_UVP_ORDER_APP_WALLET_ADDRESS 或 URL 参数 participantWallet）。";
  } else if (walletHasTasks) {
    diagnosis =
      `Product API 返回了 ${filterResult.totalFromApi} 个任务，` +
      `当前钱包 ${walletHint} 匹配了 ${filterResult.tasks.length} 个` +
      (filterResult.filteredOutCount > 0
        ? `，过滤掉 ${filterResult.filteredOutCount} 个属于其他钱包的任务`
        : "") +
      "。";
    nextAction = filterResult.filteredOutCount > 0
      ? `如需查看其他钱包的任务，可切换至：${unmatchedWallets.map(taskWalletHint).join(" 或 ")}。`
      : "一切正常，可以继续 Real Staging 验证。";
  } else if (filterResult.totalFromApi === 0) {
    diagnosis =
      `Product API 未返回任何任务。当前钱包 ${walletHint} 已连接但无可匹配数据。`;
    nextAction = "确认：1) Product API 是否运行在正确的产品环境；2) 该钱包对应的参与者是否已通过邀请绑定到订单。";
  } else {
    diagnosis =
      `Product API 返回了 ${filterResult.totalFromApi} 个任务，但当前钱包 ${walletHint} 未匹配到任何任务。` +
      ` 过滤掉的 ${filterResult.filteredOutCount} 个任务属于其他钱包。`;
    nextAction =
      `请尝试以下钱包：${unmatchedWallets.map(taskWalletHint).join("、")}。` +
      " 或在环境变量/URL 参数中切换到正确的参与者钱包地址。";
  }

  return {
    diagnosis,
    requiredEvents: [...orderAppFullModeRequiredEvents],
    walletMatch: {
      apiTaskCount: filterResult.totalFromApi,
      walletMatchedCount: filterResult.tasks.length,
      filteredOutCount: filterResult.filteredOutCount,
      connectedWallet: walletAddress,
      connectedWalletHint: walletHint,
      unmatchedWallets,
      unmatchedWalletHints: unmatchedWallets.map(taskWalletHint)
    },
    walletHasTasks,
    nextAction
  };
}

function extractUnmatchedWallets(
  tasks: readonly ProductTaskDTO[],
  walletAddress: string | undefined
): readonly string[] {
  const normalized = walletAddress?.trim().toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const task of tasks) {
    for (const wallet of [task.assigneeWallet, task.participantWallet]) {
      const w = wallet?.trim().toLowerCase();
      if (!w || (normalized && w === normalized) || seen.has(w)) {
        continue;
      }
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}
