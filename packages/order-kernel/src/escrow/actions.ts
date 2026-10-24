// 托管动作构造与提交：动作参数（trancheId / settle 分配额）先本地编码，
// 再经钱包边界发送到 StageEscrow。动作允许集合镜像合约：payee 先
// markStarted（Frozen→Started），之后 verifier 才能 approve/reject；payNow
// 仅 Started/Approved，refundByPayer 仅 Frozen，refundByPayee 为
// Frozen/Started/Rejected，suspend 覆盖四个活状态，合意结算仅 Suspended。
// 这里只给出展示用的可用动作矩阵（角色 + 状态），是否最终允许仍由合约
// revert 裁决，本模块只做金额格式与编号形状的入口边界。

import { encodeFunctionData, parseUnits, type Hex } from "viem";
import type { Eip1193Provider } from "../wallet/provider";
import { STAGE_ESCROW_ABI } from "./abi";
import type { EscrowContractConfig } from "./config";
import { ESCROW_TOKEN_DECIMALS } from "./format";
import type { EscrowActorRole, EscrowTrancheDTO, EscrowTrancheState } from "./types";
import {
  EscrowActionError,
  escrowActionFailureCopy,
  injectedEscrowProvider,
  requireEscrowChain,
  requireEscrowWallet,
  sendEscrowTransaction
} from "./wallet";

export const ESCROW_ACTION_NAMES = [
  "markStarted",
  "approve",
  "reject",
  "payNow",
  "refundByPayer",
  "refundByPayee",
  "suspend",
  "consentSettlement"
] as const;

export type EscrowActionName = (typeof ESCROW_ACTION_NAMES)[number];

export const ESCROW_ACTION_STATES: Readonly<Record<EscrowActionName, readonly EscrowTrancheState[]>> = {
  markStarted: ["frozen"],
  approve: ["started"],
  reject: ["started"],
  payNow: ["started", "approved"],
  refundByPayer: ["frozen"],
  refundByPayee: ["frozen", "started", "rejected"],
  suspend: ["frozen", "started", "approved", "rejected"],
  consentSettlement: ["suspended"]
};

export const ESCROW_ACTION_ROLES: Readonly<Record<EscrowActionName, readonly EscrowActorRole[]>> = {
  markStarted: ["payee"],
  approve: ["verifier"],
  reject: ["verifier"],
  payNow: ["payer"],
  refundByPayer: ["payer"],
  refundByPayee: ["payee"],
  suspend: ["payer", "payee"],
  consentSettlement: ["payer", "payee"]
};

export type StageEscrowCall =
  | { readonly functionName: "markStarted" | "approve" | "reject" | "payNow" | "refundByPayer" | "refundByPayee" | "suspend"; readonly args: readonly [Hex] }
  | { readonly functionName: "consentSettlement"; readonly args: readonly [Hex, bigint, bigint] };

export interface EscrowActionInput {
  readonly payerAmount?: string | undefined;
  readonly payeeAmount?: string | undefined;
}

const TRANCHE_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d{1,6})?$/u;

export function isEscrowActionAvailable(
  action: EscrowActionName,
  tranche: Pick<EscrowTrancheDTO, "state">,
  roles: ReadonlySet<EscrowActorRole>
): boolean {
  const roleAllowed = ESCROW_ACTION_ROLES[action].some((role) => roles.has(role));
  return roleAllowed && ESCROW_ACTION_STATES[action].includes(tranche.state);
}

export function escrowAvailableActions(
  tranche: Pick<EscrowTrancheDTO, "state">,
  roles: ReadonlySet<EscrowActorRole>
): ReadonlySet<EscrowActionName> {
  const available = new Set<EscrowActionName>();
  for (const action of ESCROW_ACTION_NAMES) {
    if (isEscrowActionAvailable(action, tranche, roles)) {
      available.add(action);
    }
  }
  return available;
}

export function buildStageEscrowCall(
  action: EscrowActionName,
  trancheId: string,
  input: EscrowActionInput = {}
): StageEscrowCall {
  if (!TRANCHE_ID_PATTERN.test(trancheId)) {
    throw new EscrowActionError("invalid_input", "阶段托管编号不是合法的 bytes32，无法发送交易。");
  }
  const id = trancheId as Hex;
  if (action === "consentSettlement") {
    return {
      functionName: "consentSettlement",
      args: [
        id,
        parseEscrowAmount(input.payerAmount, "付款方保留金额（payerAmount）"),
        parseEscrowAmount(input.payeeAmount, "履约方获得金额（payeeAmount）")
      ]
    };
  }
  return { functionName: action, args: [id] };
}

export function encodeStageEscrowCall(call: StageEscrowCall): Hex {
  switch (call.functionName) {
    case "markStarted":
    case "approve":
    case "reject":
    case "payNow":
    case "refundByPayer":
    case "refundByPayee":
    case "suspend":
      return encodeFunctionData({ abi: STAGE_ESCROW_ABI, functionName: call.functionName, args: call.args });
    case "consentSettlement":
      return encodeFunctionData({ abi: STAGE_ESCROW_ABI, functionName: call.functionName, args: call.args });
  }
}

export interface SubmitEscrowActionRequest {
  readonly config: EscrowContractConfig;
  readonly action: EscrowActionName;
  readonly trancheId: string;
  readonly input?: EscrowActionInput | undefined;
  readonly walletAddress?: string | undefined;
  readonly provider?: Eip1193Provider | undefined;
}

export interface SubmitEscrowActionResult {
  readonly txHash: Hex;
  readonly from: string;
}

export async function submitStageEscrowAction(request: SubmitEscrowActionRequest): Promise<SubmitEscrowActionResult> {
  const call = buildStageEscrowCall(request.action, request.trancheId, request.input);
  const data = encodeStageEscrowCall(call);
  const provider = request.provider ?? injectedEscrowProvider();
  if (!provider) {
    throw new EscrowActionError("missing_wallet", "未检测到浏览器钱包，无法签署托管交易。");
  }
  await requireEscrowChain(provider, request.config);
  const from = await requireEscrowWallet(provider, request.walletAddress);
  const txHash = await sendEscrowTransaction({
    provider,
    config: request.config,
    from,
    data
  });
  return { txHash, from };
}

export { EscrowActionError, escrowActionFailureCopy };

function parseEscrowAmount(raw: string | undefined, label: string): bigint {
  const value = raw?.trim() ?? "";
  if (!value) {
    throw new EscrowActionError("invalid_input", `请填写${label}。`);
  }
  if (!DECIMAL_AMOUNT_PATTERN.test(value)) {
    throw new EscrowActionError("invalid_input", `${label}必须是 0 以上的十进制金额，最多 6 位小数。`);
  }
  try {
    return parseUnits(value, ESCROW_TOKEN_DECIMALS);
  } catch {
    throw new EscrowActionError("invalid_input", `${label}超出可表示的金额范围。`);
  }
}
