/**
 * 提交响应信封状态如实展示：HTTP 200 不等于提交成功。服务端把
 * failed/expired/replaced 都记录为不可重投的终态（expired 未生效、
 * replaced 以最新提交为准），按失败如实呈现并引导重新 prepare，
 * 与 zhixu-store 轮询判级（terminal_failure）同口径。
 */
export function submissionFailureText(status: string, errorCode?: string): string | undefined {
  if (status === "expired") {
    return "提交已过期未生效（终态），请重新准备提交。";
  }
  if (status === "replaced") {
    return "本次提交已被后续提交取代（终态）：请以最新提交记录为准，勿盲目重投。";
  }
  if (status !== "failed") {
    return undefined;
  }
  return `提交失败${errorCode ? `（${errorCode}）` : ""}，请核对阻断原因后重试。`;
}

export function submissionPendingText(status: string): string {
  if (status === "confirmed") {
    return "提交已确认。";
  }
  return "已提交，等待链上确认。";
}

/**
 * expired/replaced 是该 prepareId 的服务端终态：信封不可再签（EvidencePanel
 * terminal 闸同口径）。调用方据此清掉 prepared——对已消费 prepareId 的再签
 * 路径（签名框）随之消失，"重新准备"重新可用，否则死信封只剩"再签一次"的
 * 假出口。failed 信封不是该 prepareId 的终态，保留同 prepareId 重试入口。
 */
export function isTerminalSubmissionEnvelope(status: string): boolean {
  return status === "expired" || status === "replaced";
}
