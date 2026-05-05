import { ClipboardList } from "lucide-react";
import type { ProductOrderDTO, ProductTaskDTO } from "@uvp-eth/product-dto";
import type { ProductApiSource, ProductHomeData } from "../api/productApi";
import type { OrderAppActions } from "../actions/orderAppActions";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { OrderRoom } from "../order-room/OrderRoom";
import { ProofPanel } from "../proof/ProofPanel";
import type { OrderAppRoute } from "../routes/appRoutes";
import type { TaskSubmissionProof } from "../task-model";
import { TaskInbox, TaskPluginHost, type PreparedTaskSubmit, type ProductSubmission, type SubmitPreparedInput } from "../tasks";
import type { PrepareSubmitInput } from "../tasks";

interface TaskWorkspaceProps {
  readonly actions: OrderAppActions;
  readonly data: ProductHomeData | undefined;
  readonly route: OrderAppRoute;
  readonly selectedOrder?: ProductOrderDTO;
  readonly selectedTask?: ProductTaskDTO;
  readonly participantWallet?: string;
  readonly source?: ProductApiSource;
  readonly submissionProof?: TaskSubmissionProof;
  readonly onSelectTask: (taskId: string) => void;
  readonly onPrepareTaskSubmit: (taskId: string, input: PrepareSubmitInput) => Promise<PreparedTaskSubmit>;
  readonly onSubmitTask: (taskId: string, input: SubmitPreparedInput) => Promise<ProductSubmission>;
  readonly onProofReady: (proof: TaskSubmissionProof) => void;
  readonly onSubmitted?: () => void;
}

export function TaskWorkspace({
  actions,
  data,
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
  onSubmitted
}: TaskWorkspaceProps) {
  if (route.section === "orders") {
    return <OrderRoom order={selectedOrder} task={selectedTask} tasks={data?.tasks ?? []} />;
  }
  if (route.section === "proof") {
    return <ProofPanel order={selectedOrder} task={selectedTask} submissionProof={submissionProof} />;
  }
  return (
    <div className="task-workspace">
      <TaskInbox
        tasks={data?.tasks ?? []}
        participantWallet={participantWallet}
        selectedTaskId={selectedTask?.taskId}
        onSelectTask={onSelectTask}
      />
      <aside className="task-detail" aria-label="待办详情">
        {selectedTask ? (
          <TaskPluginHost
            actions={actions}
            task={selectedTask}
            order={selectedOrder}
            participantWallet={participantWallet}
            source={source}
            standardEvidencePanel={(
              <EvidencePanel
                actions={actions}
                order={selectedOrder}
                participantWallet={participantWallet}
                source={source}
                task={source?.kind === "demo" ? { ...selectedTask, canSubmit: undefined } : selectedTask}
                onProofReady={onProofReady}
              />
            )}
            onPrepareSubmit={onPrepareTaskSubmit}
            onProofReady={onProofReady}
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
