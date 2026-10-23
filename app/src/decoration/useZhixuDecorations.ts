import { useEffect, useRef, useState } from "react";
import type { ZhixuDetailDTO } from "@uvp-eth/product-dto";
import type { ProductApiClient } from "../api/productApi";
import { planIdForZhixu } from "./decorationSupport";
import type { ZhixuDecorationSnapshot } from "./types";

/**
 * 装修数据加载（Store 读侧）：按 zhixuId 拉秩序详情 → planId → 装修版本。
 *
 * 装修是展示投影：加载失败只影响装修内容展示（快照里带 decorationError 由
 * 界面如实说明"取不到"），不阻断订单/任务/证据/签名主链路；"没有装修数据"
 * 与"取不到装修数据"必须可区分。
 */
export function useOrderAppDecorations(
  api: ProductApiClient,
  zhixuIds: readonly string[],
  enabled = true
): {
  readonly status: "loading" | "ready" | "partial";
  readonly byZhixuId: Readonly<Record<string, ZhixuDecorationSnapshot>>;
} {
  const [state, setState] = useState<{
    readonly status: "loading" | "ready" | "partial";
    readonly byZhixuId: Readonly<Record<string, ZhixuDecorationSnapshot>>;
  }>({ status: "loading", byZhixuId: {} });
  // 慢网下旧响应不得覆盖新响应（与 App 的 home 加载同口径）。
  const loadSequenceRef = useRef(0);
  const uniqueIds = [...new Set(zhixuIds.filter((id) => id.trim().length > 0))].sort();
  const idsKey = uniqueIds.join(",");

  useEffect(() => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (!enabled || uniqueIds.length === 0) {
      setState({ status: "ready", byZhixuId: {} });
      return;
    }
    setState((current) => ({ status: "loading", byZhixuId: current.byZhixuId }));
    void Promise.all(
      uniqueIds.map((zhixuId) =>
        loadZhixuDecoration(api, zhixuId).catch((error: unknown): ZhixuDecorationSnapshot => ({
          zhixuId,
          decorationError: error instanceof Error ? error.message : "秩序详情加载失败"
        }))
      )
    ).then((snapshots) => {
      if (loadSequenceRef.current !== sequence) {
        return;
      }
      const byZhixuId: Record<string, ZhixuDecorationSnapshot> = {};
      for (const snapshot of snapshots) {
        byZhixuId[snapshot.zhixuId] = snapshot;
      }
      const partial = snapshots.some((snapshot) => snapshot.decorationError !== undefined);
      setState({ status: partial ? "partial" : "ready", byZhixuId });
    });
    // idsKey 是唯一变化的依赖（api 视为稳定客户端）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, idsKey, enabled]);

  return state;
}

/** 单条 zhixu 的秩序详情 + 装修数据；装修失败不抛错，写入 decorationError。 */
export async function loadZhixuDecoration(
  api: ProductApiClient,
  zhixuId: string
): Promise<ZhixuDecorationSnapshot> {
  let zhixu: ZhixuDetailDTO | undefined;
  try {
    zhixu = await api.getZhixu(zhixuId);
  } catch (error) {
    // 秩序详情是阶段/角色/证据名称的唯一来源：取不到就没有可展示的装修内容，
    // 错误上抛给页面（页面按"加载失败"呈现，不冒充"没有装修数据"）。
    throw error;
  }
  const planId = planIdForZhixu(zhixu);
  if (!planId) {
    return { zhixuId, zhixu };
  }
  try {
    const decoration = await api.getDecoration(planId);
    return { zhixuId, zhixu, decoration };
  } catch (error) {
    return {
      zhixuId,
      zhixu,
      decorationError: error instanceof Error ? error.message : "装修数据加载失败"
    };
  }
}
