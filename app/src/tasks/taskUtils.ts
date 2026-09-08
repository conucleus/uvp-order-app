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
