import { ClipboardList } from "lucide-react";
import type { ProductOrderDTO, ProductTaskDTO, ZhixuDetailDTO } from "@uvp-eth/product-dto";
import type { ProductApiSource, ProductHomeData } from "../api/productApi";
import { selectableTargetsFromZhixuStage } from "../decoration/decorationSupport";
import type { OrderAppActions } from "../actions/orderAppActions";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { planTaskEvidence } from "../evidence/evidenceSpec";
import { OrderRoom } from "../order-room/OrderRoom";
import { ProofPanel } from "../proof/ProofPanel";
import type { OrderAppRoute } from "../routes/appRoutes";
import type { TaskSubmissionProof } from "../task-model";
import { TaskInbox, TaskPluginHost, type PreparedTaskSubmit, type ProductSubmission, type SubmitPreparedInput } from "../tasks";
import type { PrepareSubmitInput } from "../tasks";

interface TaskWorkspaceProps {
  readonly actions: OrderAppActions;
  readonly data: ProductHomeData | undefined;
  /** 证据要求由装修声明补位的任务：界面如实标注来源，不冒充任务自带配置。 */
  readonly decorationEvidenceTaskIds?: ReadonlySet<string> | undefined;
  /** 任务所属秩序详情：为 DSL selectedStages 派生订单内执行者选择目标。 */
  readonly zhixuById?: Readonly<Record<string, ZhixuDetailDTO>> | undefined;
  readonly route: OrderAppRoute;
  readonly selectedOrder?: ProductOrderDTO | undefined;
  readonly selectedTask?: ProductTaskDTO | undefined;
  readonly participantWallet?: string | undefined;
  readonly source?: ProductApiSource | undefined;
  readonly submissionProof?: TaskSubmissionProof | undefined;
  readonly onSelectTask: (taskId: string) => void;
  readonly onPrepareTaskSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onSubmitTask: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  /** 写路径 401（钱包会话失效）时由 App 清会话切登录面；返回是否已接管。 */
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
  readonly onSubmitted?: () => void;
}

export function TaskWorkspace({
  actions,
  data,
  decorationEvidenceTaskIds,
  zhixuById,
  route,
  selectedOrder,
  selectedTask,
  participantWallet,
  source,
  submissionProof,
  onSelectTask,
  onPrepareTaskSubmit,
  onSubmitTask,
  onProofReady,
  onSessionExpired,
  onSubmitted
}: TaskWorkspaceProps) {
  if (route.section === "orders") {
    return <OrderRoom order={selectedOrder} task={selectedTask} tasks={data?.tasks ?? []} />;
  }
  if (route.section === "proof") {
    return <ProofPanel order={selectedOrder} task={selectedTask} submissionProof={submissionProof} />;
  }
  // 凭证槽位判定与 EvidencePanel 内部同一单源（planTaskEvidence）：
  // 有槽位时凭证面板持有提交边界，TaskPluginHost 互斥隐藏自带边界。
  const evidenceSubmissionOwned = Boolean(selectedTask && planTaskEvidence(selectedTask).slots.length > 0);
  const evidenceFromDecoration = Boolean(selectedTask && decorationEvidenceTaskIds?.has(selectedTask.taskId));
  // DSL selectedStages 的执行者选择目标：投影自带 selectableTargets 时由插件
  // 流程消费，这里只做"阶段声明了订单内选择目标"时的补位。
  const derivedExecutorTargets = selectedTask
    ? selectableTargetsFromZhixuStage(
        selectedTask.zhixuId ? zhixuById?.[selectedTask.zhixuId] : undefined,
        selectedTask
      )
    : [];
  return (
    <div className="task-workspace">
      <TaskInbox
        tasks={data?.tasks ?? []}
        participantWallet={participantWallet}
        selectedTaskId={selectedTask?.taskId}
        onSelectTask={onSelectTask}
      />
      <aside className="task-detail" aria-label="待办详情">
        {selectedTask && evidenceFromDecoration ? (
          <p className="notice-line" data-testid="task-evidence-source-note">
            <ClipboardList aria-hidden="true" />
            <span>该待办的材料要求来自秩序装修数据（发布方随秩序提供）。</span>
          </p>
        ) : null}
        {selectedTask ? (
          <TaskPluginHost
            actions={actions}
            task={selectedTask}
            order={selectedOrder}
            participantWallet={participantWallet}
            source={source}
            extraExecutorTargets={derivedExecutorTargets}
            standardEvidencePanel={(
              <EvidencePanel
                actions={actions}
                order={selectedOrder}
                participantWallet={participantWallet}
                source={source}
                task={selectedTask}
                onProofReady={onProofReady}
                onSessionExpired={onSessionExpired}
                onSubmitted={onSubmitted}
              />
            )}
            evidenceSubmissionOwned={evidenceSubmissionOwned}
            onPrepareSubmit={onPrepareTaskSubmit}
            onProofReady={onProofReady}
            onSessionExpired={onSessionExpired}
            onSubmitted={onSubmitted}
            onSubmitPrepared={onSubmitTask}
          />
        ) : (
          <section className="empty-state">
            <ClipboardList aria-hidden="true" />
            <h2>选择一个待办</h2>
            <p>待办详情会显示职责、凭证要求和可核对证明。</p>
          </section>
        )}
        {selectedTask ? <ProofPanel order={selectedOrder} task={selectedTask} submissionProof={submissionProof} /> : null}
      </aside>
    </div>
  );
}
