/**
 * 参与者路由的 query 拼装只收钱包声明值：一次性邀请令牌与 accept/reject
 * 同形态走请求 body（query 会随 URL/Referer/代理日志留痕），按参数形态
 * 杜绝 token 进入路径。productApi 与 notificationApi 共用本单源。
 */
export function participantPath(pathname: string, walletAddress?: string | undefined): string {
  if (!walletAddress) {
    return pathname;
  }
  const query = new URLSearchParams({ walletAddress });
  return `${pathname}?${query.toString()}`;
}
