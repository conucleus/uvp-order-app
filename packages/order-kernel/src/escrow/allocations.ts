// 挂起后的双签分配读面：product API 的 tranche 投影不返回双方各自提交的
// 分配（SettlementProposed 未落字段），这里用 StageEscrow.getTranche 的
// eth_call 读取 payerAllocation/payeeAllocation。读取失败与“双方都未提交”
// 分开呈现，不把读不到显示成没提交。

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import type { Eip1193Provider } from "../wallet/provider";
import { STAGE_ESCROW_ABI } from "./abi";
import type { EscrowContractConfig } from "./config";
import {
  EscrowActionError,
  errorMessage,
  injectedEscrowProvider,
  readEscrowCall,
  requireEscrowChain
} from "./wallet";

export interface EscrowAllocationSubmission {
  readonly submitted: boolean;
  readonly payerAmount: string;
  readonly payeeAmount: string;
}

export interface EscrowAllocationsView {
  readonly payer: EscrowAllocationSubmission;
  readonly payee: EscrowAllocationSubmission;
}

const TRANCHE_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export async function readEscrowAllocations(input: {
  readonly config: EscrowContractConfig;
  readonly trancheId: string;
  readonly provider?: Eip1193Provider | undefined;
}): Promise<EscrowAllocationsView> {
  if (!TRANCHE_ID_PATTERN.test(input.trancheId)) {
    throw new EscrowActionError("invalid_input", "阶段托管编号不是合法的 bytes32，无法读取链上分配。");
  }
  const provider = input.provider ?? injectedEscrowProvider();
  if (!provider) {
    throw new EscrowActionError("missing_wallet", "未连接浏览器钱包，无法读取链上分配提交状态。");
  }
  await requireEscrowChain(provider, input.config);
  const data = encodeFunctionData({
    abi: STAGE_ESCROW_ABI,
    functionName: "getTranche",
    args: [input.trancheId as Hex]
  });
  const result = await readEscrowCall({ provider, config: input.config, data });
  let decoded: ReturnType<typeof decodeEscrowTranche>;
  try {
    decoded = decodeEscrowTranche(result);
  } catch (error) {
    throw new EscrowActionError("read_failed", `链上 tranche 读取结果无法解码：${errorMessage(error)}`);
  }
  return {
    payer: allocationView(decoded.payerAllocation, "付款方"),
    payee: allocationView(decoded.payeeAllocation, "履约方")
  };
}

type DecodedTranche = ReturnType<typeof decodeEscrowTranche>;

function decodeEscrowTranche(data: Hex) {
  return decodeFunctionResult({ abi: STAGE_ESCROW_ABI, functionName: "getTranche", data });
}

function allocationView(value: unknown, label: string): EscrowAllocationSubmission {
  if (typeof value !== "object" || value === null) {
    throw new EscrowActionError("read_failed", `链上 tranche 缺少${label}分配字段。`);
  }
  const record = value as {
    readonly submitted?: unknown;
    readonly payerAmount?: unknown;
    readonly payeeAmount?: unknown;
  };
  if (typeof record.submitted !== "boolean") {
    throw new EscrowActionError("read_failed", `链上 tranche 的${label}分配缺少 submitted 标记。`);
  }
  return {
    submitted: record.submitted,
    payerAmount: baseUnits(record.payerAmount, label),
    payeeAmount: baseUnits(record.payeeAmount, label)
  };
}

function baseUnits(value: unknown, label: string): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new EscrowActionError("read_failed", `链上 tranche 的${label}分配金额形状不合法。`);
}
