import { AlertTriangle, CheckCircle2, Clock3, FileCheck2, PackageCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import { shortWallet } from "../auth/participant";
import {
  filterParticipantTasksForWallet,
  groupParticipantTasksByOrder,
  taskDisplay,
  taskWalletHint,
  type ParticipantTaskDisplayState,
  type TaskFilterResult
} from "./taskStatus";
import { taskAddOnKind, taskAddOnLabel, taskExecutorDisplay } from "./taskPresentation";
import { signalContainerForTask } from "./signalContainer";
import "./taskRuntime.css";

interface TaskInboxProps {
  readonly tasks: readonly ProductTaskDTO[];
  readonly participantWallet?: string;
  readonly selectedTaskId?: string;
  readonly onSelectTask: (taskId: string) => void;
}

export function TaskInbox({ tasks, participantWallet, selectedTaskId, onSelectTask }: TaskInboxProps) {
  const filterResult = filterParticipantTasksForWallet(tasks, participantWallet);
  const groups = groupParticipantTasksByOrder(filterResult.tasks);

  if (filterResult.tasks.length === 0) {
    return (
      <section className="empty-state" aria-label="我的待办">
        <FileCheck2 aria-hidden="true" />
        <h2>暂无待办</h2>
        {emptyStateGuidance(filterResult, participantWallet)}
      </section>
    );
  }

  return (
    <section className="task-list" aria-label="我的待办">
      {groups.map((group) => (
        <div className="task-group" key={group.orderId}>
          <div className="task-group-heading">
            <PackageCheck aria-hidden="true" />
            <div>
              <strong>{group.orderTitle}</strong>
              <span>{group.tasks.length} 个待办</span>
            </div>
          </div>
          {group.tasks.map((task) => {
            const display = taskDisplay(task);
            const executorDisplay = taskExecutorDisplay(task);
            const signalContainer = signalContainerForTask(task);
            return (
              <button
                className={`task-card ${task.taskId === selectedTaskId ? "is-selected" : ""}`}
                key={task.taskId}
                onClick={() => onSelectTask(task.taskId)}
                type="button"
              >
                <span className={`status-dot status-${display.state}`} aria-hidden="true" />
                <span className="task-card-main">
                  <span className="task-card-title">{task.title}</span>
                  <span className="task-card-subtitle">{executorDisplay.performanceSlotLabel}</span>
                  <span className="task-card-persona">附加能力：{taskAddOnLabel(taskAddOnKind(task))}</span>
                  {executorDisplay.personaLabel ? (
                    <span className="task-card-persona">身份标签：{executorDisplay.personaLabel}</span>
                  ) : null}
                  {executorDisplay.assigneeRoleLabel !== executorDisplay.performanceSlotLabel ? (
                    <span className="task-card-assignee">任务角色：{executorDisplay.assigneeRoleLabel}</span>
                  ) : null}
                  <span className="task-card-authority">{executorDisplay.authorizationLabel}</span>
                  <span className="task-card-authority">
                    执行方钱包：{signalContainer.executingWallet ? shortWallet(signalContainer.executingWallet) : signalContainer.executingWalletLabel}
                  </span>
                  <span className="task-card-persona">必填项：{signalContainer.requiredSummary}</span>
                  {signalContainer.supplierTrustLabel ? (
                    <span className={`signal-chip signal-chip-${signalContainer.supplierTrustTone}`}>
                      供应商背书：{signalContainer.supplierTrustLabel}
                    </span>
                  ) : null}
                  {signalContainer.proofFingerprint ? (
                    <span className="task-card-proof">凭证指纹：{signalContainer.proofFingerprint}</span>
                  ) : null}
                  <span className="task-card-meta">
                    <Clock3 aria-hidden="true" />
                    {task.deadline}
                  </span>
                  {task.blockedReason ? (
                    <span className="task-card-blocked">{task.blockedReason}</span>
                  ) : null}
                </span>
                <span className={`task-status task-status-${display.state}`}>
                  {statusIcon(display.state)}
                  {display.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function statusIcon(status: ParticipantTaskDisplayState) {
  if (status === "blocked") {
    return <AlertTriangle aria-hidden="true" />;
  }
  if (status === "confirmed" || status === "submitted" || status === "indexing") {
    return <CheckCircle2 aria-hidden="true" />;
  }
  return <Clock3 aria-hidden="true" />;
}

function emptyStateGuidance(filterResult: TaskFilterResult, participantWallet?: string): ReactNode {
  if (filterResult.filtered && filterResult.filteredOutCount > 0 && participantWallet) {
    return (
      <>
        <p>
          当前钱包 <code>{taskWalletHint(participantWallet)}</code> 暂无匹配的待办任务。
        </p>
        <p>
          参与者服务返回了 {filterResult.totalFromApi} 个任务，但其中
          {filterResult.filteredOutCount} 个不属于当前钱包。
        </p>
        <p>
          请确认你使用的钱包地址是否与订单邀请中登记的钱包一致；如需切换，请在支持的钱包环境中使用
          <code>?participantWallet=0x...</code> 参数或在环境变量中设置
          <code>VITE_UVP_ORDER_APP_WALLET_ADDRESS</code>。
        </p>
      </>
    );
  }

  if (filterResult.filtered && participantWallet) {
    return (
      <>
        <p>
          当前钱包 <code>{taskWalletHint(participantWallet)}</code> 已连接，
          但参与者服务未返回任何待办任务。
        </p>
        <p>
          可能原因：该钱包尚未通过邀请绑定到运行中的订单，或所有任务已完成。
        </p>
        <p>
          请检查是否有待接受的邀请链接，或联系订单负责人确认你的钱包已登记到对应订单阶段。
        </p>
      </>
    );
  }

  return (
    <p>连接参与者服务后，这里会显示与你的钱包或邀请身份匹配的订单任务。</p>
  );
}
