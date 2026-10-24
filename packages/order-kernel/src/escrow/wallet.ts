// 托管钱包边界：EIP-1193 提供方上的链/账户核对、eth_call 读取与
// eth_sendTransaction 发送，错误统一收敛成 EscrowActionError（钱包拒绝、
// 错链、账户不一致、合约 revert 各自具名）。签名/广播都由浏览器钱包完成，
// 本模块不接触私钥。

import {
  createWalletClient,
  custom,
  decodeErrorResult,
  defineChain,
  type Chain,
  type Hex
} from "viem";
import type { Eip1193Provider } from "../wallet/provider";
import { getBrowserEthereumProvider } from "../wallet/provider";
import { STAGE_ESCROW_ABI } from "./abi";
import type { EscrowContractConfig } from "./config";
import { formatBaseUnits, formatEscrowTime, shortAddress } from "./format";

export type EscrowActionErrorCode =
  | "unconfigured"
  | "missing_wallet"
  | "wallet_rejected"
  | "chain_mismatch"
  | "account_mismatch"
  | "invalid_input"
  | "contract_revert"
  | "send_failed"
  | "read_failed";

export class EscrowActionError extends Error {
  override readonly name = "EscrowActionError";

  constructor(
    readonly code: EscrowActionErrorCode,
    message: string
  ) {
    super(message);
  }
}

const CHAIN_NAME = "StageEscrow";
const chainCache = new Map<number, Chain>();

export function escrowChain(chainId: number): Chain {
  const cached = chainCache.get(chainId);
  if (cached) {
    return cached;
  }
  const chain = defineChain({
    id: chainId,
    name: `${CHAIN_NAME} ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } }
  });
  chainCache.set(chainId, chain);
  return chain;
}

export function injectedEscrowProvider(): Eip1193Provider | undefined {
  return getBrowserEthereumProvider();
}

export async function requireEscrowChain(provider: Eip1193Provider, config: EscrowContractConfig): Promise<number> {
  const raw = await provider.request({ method: "eth_chainId" }).catch((error: unknown) => {
    throw new EscrowActionError("send_failed", `读取钱包当前链失败：${errorMessage(error)}`);
  });
  const actual = typeof raw === "string" && /^0x[0-9a-fA-F]+$/u.test(raw)
    ? Number.parseInt(raw, 16)
    : Number.NaN;
  if (!Number.isSafeInteger(actual) || actual <= 0) {
    throw new EscrowActionError("send_failed", "钱包没有返回可识别的链 ID。");
  }
  if (actual !== config.chainId) {
    throw new EscrowActionError(
      "chain_mismatch",
      `钱包当前链 id ${actual} 与托管合约链 id ${config.chainId} 不一致，请先在钱包切换网络。`
    );
  }
  return actual;
}

export async function requireEscrowWallet(provider: Eip1193Provider, expected: string | undefined): Promise<`0x${string}`> {
  const accounts = await requestAccounts(provider).catch((error: unknown) => {
    if (isUserRejection(error)) {
      throw new EscrowActionError("wallet_rejected", "钱包取消了账户授权，未发送交易。");
    }
    throw new EscrowActionError("send_failed", `读取钱包账户失败：${errorMessage(error)}`);
  });
  const account = accounts.find((item) => /^0x[0-9a-fA-F]{40}$/u.test(item));
  if (!account) {
    throw new EscrowActionError("missing_wallet", "未检测到可用的钱包账户，无法签署托管交易。");
  }
  const normalized = account.toLowerCase();
  if (expected?.trim() && expected.trim().toLowerCase() !== normalized) {
    throw new EscrowActionError(
      "account_mismatch",
      `钱包当前账户 ${shortAddress(account)} 与页面登录钱包 ${shortAddress(expected)} 不一致，请切换账户。`
    );
  }
  return normalized as `0x${string}`;
}

export async function sendEscrowTransaction(input: {
  readonly provider: Eip1193Provider;
  readonly config: EscrowContractConfig;
  readonly from: `0x${string}`;
  readonly data: Hex;
}): Promise<Hex> {
  const client = createWalletClient({
    account: input.from,
    chain: escrowChain(input.config.chainId),
    transport: custom(input.provider)
  });
  try {
    const hash = await client.sendTransaction({
      account: input.from,
      chain: escrowChain(input.config.chainId),
      to: input.config.address,
      data: input.data
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(hash)) {
      throw new EscrowActionError("send_failed", "钱包没有返回有效的交易哈希。");
    }
    return hash;
  } catch (error) {
    if (error instanceof EscrowActionError) {
      throw error;
    }
    if (isUserRejection(error)) {
      throw new EscrowActionError("wallet_rejected", "钱包取消了本次签名，未发送交易。");
    }
    const decoded = findDecodedRevert(error) ??
      await callDecodedRevert(input.provider, input.from, input.config.address, input.data);
    if (decoded) {
      throw new EscrowActionError("contract_revert", escrowRevertMessage(decoded.name, decoded.args));
    }
    throw new EscrowActionError("send_failed", `托管交易未发送成功：${errorMessage(error)}`);
  }
}

export async function readEscrowCall(input: {
  readonly provider: Eip1193Provider;
  readonly config: EscrowContractConfig;
  readonly data: Hex;
}): Promise<Hex> {
  try {
    const result = await input.provider.request({
      method: "eth_call",
      params: [{ to: input.config.address, data: input.data }, "latest"]
    });
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/u.test(result)) {
      throw new EscrowActionError("read_failed", "合约读取没有返回可识别的十六进制结果。");
    }
    return result as Hex;
  } catch (error) {
    if (error instanceof EscrowActionError) {
      throw error;
    }
    const decoded = findDecodedRevert(error);
    if (decoded) {
      throw new EscrowActionError("contract_revert", escrowRevertMessage(decoded.name, decoded.args));
    }
    throw new EscrowActionError("read_failed", `链上读取失败：${errorMessage(error)}`);
  }
}

export function isUserRejection(error: unknown): boolean {
  return walkError(error, (candidate) => {
    const record = candidate as { readonly code?: unknown; readonly name?: unknown };
    return record.code === 4001
      || record.code === "4001"
      || (typeof record.name === "string" && record.name.includes("UserRejected"));
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function findDecodedRevert(
  error: unknown
): { readonly name: string; readonly args: readonly unknown[] } | undefined {
  for (const candidate of collectHexCandidates(error)) {
    const decoded = decodeEscrowRevert(candidate);
    if (decoded) {
      return decoded;
    }
  }
  return undefined;
}

export function decodeEscrowRevert(data: Hex): { readonly name: string; readonly args: readonly unknown[] } | undefined {
  try {
    const decoded = decodeErrorResult({ abi: STAGE_ESCROW_ABI, data });
    return { name: decoded.errorName, args: decoded.args ?? [] };
  } catch {
    return undefined;
  }
}

export function escrowRevertMessage(name: string, args: readonly unknown[]): string {
  switch (name) {
    case "NotVerifier":
      return `合约拒绝：当前钱包不是本阶段验收者（合约记录的验收者 ${shortAddress(addressArg(args[1]))}）。`;
    case "NotPayer":
      return `合约拒绝：当前钱包不是本阶段付款方（合约记录的付款方 ${shortAddress(addressArg(args[1]))}）。`;
    case "NotPayee":
      return `合约拒绝：当前钱包不是本阶段履约方（合约记录的履约方 ${shortAddress(addressArg(args[1]))}）。`;
    case "NotPayerOrPayee":
      return "合约拒绝：只有本阶段付款方或履约方可以执行该操作。";
    case "InvalidTrancheState":
      return `合约拒绝：当前状态不允许该操作（链上状态：${chainStateLabel(args[1])}）。`;
    case "TrancheNotFound":
      return "合约拒绝：该阶段还没有冻款记录。";
    case "TrancheAlreadyExists":
      return "合约拒绝：该阶段已有冻款记录。";
    case "ReleaseNotYetAvailable":
      return `合约拒绝：观察期未到期（放款时间 ${formatEscrowTime(unixTime(args[1]))}）。`;
    case "RejectionWindowClosed":
      return `合约拒绝：拒绝后的 48 小时退款窗口已关闭（窗口截止 ${formatEscrowTime(unixTime(args[1]))}）。`;
    case "RefundWindowNotElapsed":
      return `合约拒绝：拒绝后的 48 小时退款窗口尚未到期（窗口截止 ${formatEscrowTime(unixTime(args[1]))}）。`;
    case "InvalidSettlement":
      return `合约拒绝：分配金额不合法（付款方 ${formatBaseUnits(uintArg(args[0]))} + 履约方 ${formatBaseUnits(uintArg(args[1]))} 必须等于冻款金额 ${formatBaseUnits(uintArg(args[2]))}）。`;
    case "TokenTransferFailed":
      return "合约拒绝：代币转账失败（合约或代币余额/授权不足）。";
    case "Reentrancy":
      return "合约拒绝：重入保护拒绝。";
    default:
      return `合约拒绝：${name}。`;
  }
}

export function escrowActionFailureCopy(error: unknown): string {
  if (error instanceof EscrowActionError) {
    return error.message;
  }
  if (isUserRejection(error)) {
    return "钱包取消了本次签名，未发送交易。";
  }
  return `托管交易失败：${errorMessage(error)}`;
}

async function requestAccounts(provider: Eip1193Provider): Promise<readonly string[]> {
  const read = await provider.request({ method: "eth_accounts" });
  const accounts = normalizeAccounts(read);
  if (accounts.length > 0) {
    return accounts;
  }
  return normalizeAccounts(await provider.request({ method: "eth_requestAccounts" }));
}

function normalizeAccounts(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function callDecodedRevert(
  provider: Eip1193Provider,
  from: `0x${string}`,
  to: `0x${string}`,
  data: Hex
): Promise<{ readonly name: string; readonly args: readonly unknown[] } | undefined> {
  try {
    await provider.request({
      method: "eth_call",
      params: [{ from, to, data }, "latest"]
    });
    return undefined;
  } catch (error) {
    return findDecodedRevert(error);
  }
}

function collectHexCandidates(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
  out: Hex[] = []
): readonly Hex[] {
  if (depth > 6 || out.length >= 24) {
    return out;
  }
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{8,}$/u.test(value)) {
      out.push(value as Hex);
    }
    return out;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return out;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHexCandidates(item, depth + 1, seen, out);
    }
    return out;
  }
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.getOwnPropertyNames(record)) {
    collectHexCandidates(record[key], depth + 1, seen, out);
  }
  return out;
}

function walkError(error: unknown, predicate: (value: unknown) => boolean): boolean {
  if (predicate(error)) {
    return true;
  }
  const nested = nestedErrors(error);
  return nested.some((item) => walkError(item, predicate));
}

function nestedErrors(error: unknown): readonly unknown[] {
  const record = error as { readonly cause?: unknown; readonly info?: unknown } | undefined;
  if (!record || typeof record !== "object") {
    return [];
  }
  return [record.cause, record.info].filter((item) => item !== undefined && item !== null);
}

function addressArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function uintArg(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value ?? "0");
}

function unixTime(value: unknown): string {
  const seconds = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : "";
}

function chainStateLabel(value: unknown): string {
  const index = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : Number.NaN;
  const labels = ["未创建", "已冻款", "已开始履约", "观察期", "已拒绝", "已挂起", "已付款", "已退款", "已结算"];
  return labels[index] ?? `未知状态 ${String(value)}`;
}
