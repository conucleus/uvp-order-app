// 客户端工厂：baseUrl 只来自构建期 env；会话 token 复用既有 ProductApiClient
// （proveWalletControl 之后持有），不在本模块另建第二套会话。

import {
  createProductClient,
  type ProductClient
} from "@uvp-eth/uvp-client/browser";

export function createClient(getSessionToken: () => string | undefined): ProductClient {
  const baseUrl = import.meta.env?.VITE_UVP_CHAIN_SERVICES_URL;
  if (!baseUrl || baseUrl.trim().length === 0) {
    throw new Error(
      "订单服务地址未配置：请设置 VITE_UVP_CHAIN_SERVICES_URL。Order App 只连接真实参与者服务，没有样例数据回退。"
    );
  }
  return createProductClient({ baseUrl, getSessionToken });
}
