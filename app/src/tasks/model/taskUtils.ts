import type { ProductSubmitTypedData } from "@uvp-eth/executor-kit/participant";

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

/** 补丁面板共用的 0x 指纹预检（履约者/清单/权限指纹，提交前表单阻断用）。 */
export function looksLikeHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/u.test(value.trim());
}

/**
 * 内容寻址引用的客户端判定（URI 组件预检/资源展示共用）。ipfs/ar 是服务端
 * 生产口径的规范前缀；cid:/bafy 是裸 CID 形态。urn: 前缀本身不代表内容
 * 寻址（urn:uuid 等都是任意 URN），不得放行。
 */
export function isContentAddressedReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("ipfs://") ||
    trimmed.startsWith("ar://") ||
    trimmed.startsWith("cid:") ||
    trimmed.startsWith("bafy");
}

// deadline 的 UTC 解析/排序/展示已迁入 @uvp-eth/order-kernel；此处保留原
// 导入路径，避免任务/通知/订单室各自改调用点。
export { deadlineSortMs, formatDeadlineUtc, parseDeadlineUtcMs } from "@uvp-eth/order-kernel/tasks/deadline";

/**
 * 签名域交叉核对的预期值独立来源：构建期部署配置注入（Vite 内联的静态
 * import.meta.env 成员），不来自被核对的同一 BFF 响应——被攻陷的 BFF 可以
 * 让 typedData.domain 与 prepare 信封/humanSummary 自洽，但改不了部署配置。
 * verifyingContract 缺配置即拒绝签名（fail-closed）；chainId 是同一独立
 * 来源的加强锚——部署配置声明了就严格比对，未声明的部署只保留信封校验
 * 里的链 ID 形状判定，不挡签名。
 */
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

/**
 * 可选部署链 ID（十进制正整数字符串）：声明了才锚定 domain.chainId。
 * 显式限定十进制——Number 会把 "0x7a69" 这类十六进制串静默解析成功，
 * 部署配置写错格式时按 fail-closed 拒签而不是宽松放行。
 */
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

/** 域预期里可随配置出现的那部分（verifyingContract 恒有、chainId 可选）。 */
type SignDomainExpected = { readonly verifyingContract: string; readonly chainId?: number | undefined };

/** 任务提交信号（UVPStateMachineSignal）的验签合约预期：状态机部署地址。 */
export function submitSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: SignDomainExpected } {
  const chainId = optionalEnvChainId(env);
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STATE_MACHINE_ADDRESS", "状态机部署地址"),
      ...(chainId !== undefined ? { chainId } : {})
    }
  };
}

/**
 * 任务提交边界共用的签名输入组装（TaskPluginHost/EvidencePanel/
 * ManifestAddOnPanel 同一闸门口径）：prepare 记录声明的提交方与部署配置
 * 注入的域预期一并进入签名——被攻陷 BFF 换其他 principal 的 prepared
 * 信封时，钱包闸门在调钱包前拒绝。
 */
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

/**
 * 阶段补丁（executor/resource patch）的 EIP-712 域由 UVPStagePatchModule 验签，
 * 不是任务投影里的状态机地址；预期值同样来自部署配置注入，不读 prepare
 * 响应里的 humanSummary.verifyingContract（与被核对对象同源会被攻陷 BFF 操纵）。
 * 部署链 ID 与提交信号同一部署（同一 VITE_UVP_CHAIN_ID）。
 */
export function stagePatchSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: SignDomainExpected } {
  const chainId = optionalEnvChainId(env);
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STAGE_PATCH_MODULE_ADDRESS", "阶段补丁模块地址"),
      ...(chainId !== undefined ? { chainId } : {})
    }
  };
}
