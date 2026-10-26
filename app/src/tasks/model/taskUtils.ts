import type { ProductSubmitTypedData } from "@uvp-eth/protocol-bindings";

export function cleanString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseEvidenceIds(value: string): readonly string[] {
  return value
    .split(/[\s,，;；]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function looksLikeHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/u.test(value.trim());
}

export function isContentAddressedReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("ipfs://") ||
    trimmed.startsWith("ar://") ||
    trimmed.startsWith("cid:") ||
    trimmed.startsWith("bafy");
}

export { deadlineSortMs, formatDeadlineUtc, parseDeadlineUtcMs } from "@uvp-eth/uvp-client/browser";

export interface SignDomainEnv {
  readonly VITE_UVP_STATE_MACHINE_ADDRESS?: string | undefined;
  readonly VITE_UVP_STAGE_PATCH_MODULE_ADDRESS?: string | undefined;
  readonly VITE_UVP_CHAIN_ID?: string | undefined;
}

function requiredEnvAddress(env: SignDomainEnv, key: keyof SignDomainEnv, label: string): string {
  const address = cleanString(env[key]);
  if (!address || !/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    throw new Error(`${label} 未配置（构建期环境变量 ${key}），无法交叉核对签名域，已拒绝签名`);
  }
  return address;
}

function optionalEnvChainId(env: SignDomainEnv): number | undefined {
  const raw = cleanString(env.VITE_UVP_CHAIN_ID);
  if (!raw) {
    return undefined;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`部署链 ID 不是十进制正整数（构建期环境变量 VITE_UVP_CHAIN_ID="${raw}"），已拒绝签名`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`部署链 ID 不是有效的十进制正整数（构建期环境变量 VITE_UVP_CHAIN_ID="${raw}"），已拒绝签名`);
  }
  return parsed;
}

function buildTimeSignDomainEnv(): SignDomainEnv {
  return {
    VITE_UVP_STATE_MACHINE_ADDRESS: import.meta.env?.VITE_UVP_STATE_MACHINE_ADDRESS,
    VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: import.meta.env?.VITE_UVP_STAGE_PATCH_MODULE_ADDRESS,
    VITE_UVP_CHAIN_ID: import.meta.env?.VITE_UVP_CHAIN_ID
  };
}

type SignDomainExpected = { readonly verifyingContract: string; readonly chainId?: number | undefined };

export function submitSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: SignDomainExpected } {
  const chainId = optionalEnvChainId(env);
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STATE_MACHINE_ADDRESS", "状态机部署地址"),
      ...(chainId !== undefined ? { chainId } : {})
    }
  };
}

export function taskSubmitSignInput(
  prepared: {
    readonly typedData: ProductSubmitTypedData;
    readonly submitter?: string | undefined;
  },
  walletAddress: string,
  env: SignDomainEnv = buildTimeSignDomainEnv()
): {
  readonly typedData: ProductSubmitTypedData;
  readonly walletAddress: string;
  readonly preparedSubmitters: readonly (string | undefined)[];
  readonly expected: SignDomainExpected;
} {
  return {
    typedData: prepared.typedData,
    walletAddress,
    preparedSubmitters: [prepared.submitter],
    ...submitSignExpectation(env)
  };
}

export function stagePatchSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: SignDomainExpected } {
  const chainId = optionalEnvChainId(env);
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STAGE_PATCH_MODULE_ADDRESS", "阶段补丁模块地址"),
      ...(chainId !== undefined ? { chainId } : {})
    }
  };
}
