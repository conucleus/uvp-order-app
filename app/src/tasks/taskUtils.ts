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

const HAS_ZONE_DESIGNATOR = /[Zz]$|[+-]\d{2}:?\d{2}$/;

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

/**
 * 任务 deadline 是 UTC 时刻；服务端下发的朴素字符串（无时区符）按浏览器
 * 本地时区解析会让逾期分桶/排序随时区漂移（与 doctor 的 UTC 口径矛盾）。
 * 无时区符一律补 Z 按 UTC 解析；解析不了返回 undefined，由调用方决定兜底。
 */
export function parseDeadlineUtcMs(value: string): number | undefined {
  const normalized = value.trim().replace(" ", "T");
  if (!normalized) {
    return undefined;
  }
  const withZone = HAS_ZONE_DESIGNATOR.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 签名域交叉核对的预期值独立来源：构建期部署配置注入（Vite 内联的静态
 * import.meta.env 成员），不来自被核对的同一 BFF 响应——被攻陷的 BFF 可以
 * 让 typedData.domain 与 prepare 信封/humanSummary 自洽，但改不了部署配置。
 * 缺预期值即拒绝签名（fail-closed），不再条件性跳过比对。
 */
export interface SignDomainEnv {
  readonly VITE_UVP_STATE_MACHINE_ADDRESS?: string | undefined;
  readonly VITE_UVP_STAGE_PATCH_MODULE_ADDRESS?: string | undefined;
}

function requiredEnvAddress(env: SignDomainEnv, key: keyof SignDomainEnv, label: string): string {
  const address = cleanString(env[key]);
  if (!address || !/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    throw new Error(`${label} 未配置（构建期环境变量 ${key}），无法交叉核对签名域，已拒绝签名`);
  }
  return address;
}

function buildTimeSignDomainEnv(): SignDomainEnv {
  return {
    VITE_UVP_STATE_MACHINE_ADDRESS: import.meta.env?.VITE_UVP_STATE_MACHINE_ADDRESS,
    VITE_UVP_STAGE_PATCH_MODULE_ADDRESS: import.meta.env?.VITE_UVP_STAGE_PATCH_MODULE_ADDRESS
  };
}

/** 任务提交信号（UVPStateMachineSignal）的验签合约预期：状态机部署地址。 */
export function submitSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: { readonly verifyingContract: string } } {
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STATE_MACHINE_ADDRESS", "状态机部署地址")
    }
  };
}

/**
 * 阶段补丁（executor/resource patch）的 EIP-712 域由 UVPStagePatchModule 验签，
 * 不是任务投影里的状态机地址；预期值同样来自部署配置注入，不读 prepare
 * 响应里的 humanSummary.verifyingContract（与被核对对象同源会被攻陷 BFF 操纵）。
 */
export function stagePatchSignExpectation(env: SignDomainEnv = buildTimeSignDomainEnv()): { readonly expected: { readonly verifyingContract: string } } {
  return {
    expected: {
      verifyingContract: requiredEnvAddress(env, "VITE_UVP_STAGE_PATCH_MODULE_ADDRESS", "阶段补丁模块地址")
    }
  };
}
