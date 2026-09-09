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
 * 阶段补丁的 EIP-712 域由 UVPStagePatchModule 验签，不是任务投影里的状态机地址；
 * 验签合约只认 prepare 信封声明的补丁模块地址（humanSummary.verifyingContract），
 * 未声明即拒签，对齐服务端 moduleAddressFor 的 fail-closed 语义。
 */
export function stagePatchSignExpectation(prepared: {
  readonly humanSummary?: { readonly verifyingContract?: string | undefined } | undefined;
}): { readonly expected: { readonly verifyingContract: string } } {
  const verifyingContract = cleanString(prepared.humanSummary?.verifyingContract);
  if (!verifyingContract) {
    throw new Error("prepare 响应未声明补丁验签合约（humanSummary.verifyingContract），已拒绝签名");
  }
  return { expected: { verifyingContract } };
}
