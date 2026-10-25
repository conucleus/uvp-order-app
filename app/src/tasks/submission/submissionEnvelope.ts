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

export function isTerminalSubmissionEnvelope(status: string): boolean {
  return status === "expired" || status === "replaced";
}
