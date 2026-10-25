import { useLayoutEffect, useRef } from "react";
import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { advanceScopeGeneration, scopeGenerationValue } from "../../shared/chain/submission/scope-guard";
import type { ScopeGeneration } from "../../shared/chain/submission/scope-guard";

/**
 * 任务作用域守卫（chain 轨作用域代数的宿主钩子）：慢网下切换任务后，
 * 在途请求的续作不得跨任务写入界面。
 */
export function useTaskScopeGuard(task: ProductTaskDTO | undefined): {
  readonly scopeKey: string;
  readonly taskScopeRef: Readonly<{ readonly current: string }>;
} {
  const semanticKey = task ? `${task.orderId}:${task.taskId}:${task.stageId}` : "none";
  const generationRef = useRef<ScopeGeneration<string | undefined>>({ key: semanticKey, generation: 1 });
  generationRef.current = advanceScopeGeneration(generationRef.current, semanticKey);
  const scopeKey = scopeGenerationValue(generationRef.current);
  const taskScopeRef = useRef(scopeKey);
  useLayoutEffect(() => {
    taskScopeRef.current = scopeKey;
  }, [scopeKey]);
  return { scopeKey, taskScopeRef };
}
