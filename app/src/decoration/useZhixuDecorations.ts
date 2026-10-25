import { useEffect, useRef, useState } from "react";
import type { ZhixuDetailDTO } from "@uvp-eth/product-dto";
import type { ProductApiClient } from "../api/productApi";
import { planIdForZhixu } from "./decorationSupport";
import type { ZhixuDecorationSnapshot } from "./types";

/**
 * 装修数据加载（Store 读侧）：失败只影响装修内容展示，不阻断订单/任务主链路。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, idsKey, enabled]);

  return state;
}

export async function loadZhixuDecoration(
  api: ProductApiClient,
  zhixuId: string
): Promise<ZhixuDecorationSnapshot> {
  let zhixu: ZhixuDetailDTO | undefined;
  try {
    zhixu = await api.getZhixu(zhixuId);
  } catch (error) {
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
