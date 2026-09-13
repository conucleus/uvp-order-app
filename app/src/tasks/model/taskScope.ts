import { useLayoutEffect, useRef } from "react";
import type { ProductTaskDTO } from "@uvp-eth/product-dto";

/**
 * 任务作用域守卫（与 zhixu-store useTaskSubmissionFlow 同款）：
 * 慢网下切换任务后，在途请求的续作不得把 A 任务的 prepareId/提交结果
 * 写进 B 任务的界面，更不得以 B 的 taskId 提交 A 的 prepareId。
 *
 * 作用域值携带单调递增的代数：语义键（orderId:taskId:stageId）在
 * A→B→A 回切时会复用，按裸键比较的守卫在回切后"键又对上了"——A 的
 * 在途请求通过检查，把旧结果写回当前界面。代数只在键变化时推进，同键
 * 重渲染（投影刷新）保持不变，不会误伤正常刷新。
 */
export function useTaskScopeGuard(task: ProductTaskDTO): {
  readonly scopeKey: string;
  readonly taskScopeRef: Readonly<{ readonly current: string }>;
} {
  const semanticKey = `${task.orderId}:${task.taskId}:${task.stageId}`;
  const generationRef = useRef({ key: semanticKey, generation: 1 });
  if (generationRef.current.key !== semanticKey) {
    generationRef.current = { key: semanticKey, generation: generationRef.current.generation + 1 };
  }
  const scopeKey = `${generationRef.current.key}#${generationRef.current.generation}`;
  const taskScopeRef = useRef(scopeKey);
  useLayoutEffect(() => {
    taskScopeRef.current = scopeKey;
  }, [scopeKey]);
  return { scopeKey, taskScopeRef };
}
