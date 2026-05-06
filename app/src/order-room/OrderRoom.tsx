import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  Fingerprint,
  PackageCheck,
  ReceiptText,
  UsersRound,
  XCircle
} from "lucide-react";
import type {
  ChainAttestationStatus,
  ParticipantStatus,
  ProductOrderDTO,
  ProductTaskDTO,
  StageStatus
} from "@uvp-eth/product-dto";
import { taskExecutorDisplay } from "../tasks/taskPresentation";
import { taskDisplay } from "../tasks/taskStatus";
import "./orderRoom.css";

interface OrderRoomProps {
  readonly order?: ProductOrderDTO;
  readonly task?: ProductTaskDTO;
  readonly tasks?: readonly ProductTaskDTO[];
}

const stageLabel: Readonly<Record<StageStatus, string>> = {
  done: "已完成",
  active: "进行中",
  pending: "未开始"
};

const participantStatusLabel: Readonly<Record<ParticipantStatus, string>> = {
  joined: "已加入",
  invited: "已邀请",
  pending_confirmation: "等待确认",
  assigned: "已分配",
  not_started: "未开始"
};

type OrderRoomOrder = ProductOrderDTO & {
  readonly timeline?: readonly OrderTimelineEvent[];
  readonly tasks?: readonly ProductTaskDTO[];
  readonly paymentConditionSummary?: string;
};

interface OrderTimelineEvent {
  readonly eventId: string;
  readonly text: string;
  readonly time: string;
  readonly eventName?: string;
  readonly proofKind?: string;
  readonly blockNumber?: string;
  readonly transactionHash?: string;
}

interface SlaRow {
  readonly task: ProductTaskDTO;
  readonly status: "ready" | "near_deadline" | "overdue" | "blocked" | "confirmed";
  readonly label: string;
  readonly tone: "info" | "warn" | "danger" | "ok";
  readonly blockedBy: string;
  readonly escalation: string;
}

export function OrderRoom({ order, task, tasks = [] }: OrderRoomProps) {
  if (!order) {
    return (
      <section className="empty-state" aria-label="订单">
        <PackageCheck aria-hidden="true" />
        <h2>暂无订单</h2>
        <p>参与者服务返回订单后，这里会显示当前阶段、参与方和最近进展。</p>
      </section>
    );
  }

  const roomOrder = order as OrderRoomOrder;
  const orderTasks = mergeOrderTasks(roomOrder, tasks, task);
  const currentTasks = orderTasks.length > 0 ? orderTasks : task ? [task] : [];
  const settlementPreview = currentTasks.find((item) => item.settlementPreview)?.settlementPreview;
  const slaRows = buildSlaRows(currentTasks);
  const timeline = orderTimeline(roomOrder);

  return (
    <section className="workspace-block order-room" aria-labelledby="order-room-title">
      <div className="section-heading">
        <PackageCheck aria-hidden="true" />
        <div>
          <h2 id="order-room-title">{order.title}</h2>
          <p>{order.currentTaskSummary}</p>
        </div>
      </div>

      <div className="order-room-summary">
        <div>
          <span>当前阶段</span>
          <strong>{order.currentStageName}</strong>
        </div>
        <div>
          <span>订单状态</span>
          <strong>{order.statusLabel}</strong>
        </div>
        <div>
          <span>金额</span>
          <strong>{order.totalAmount.display}</strong>
        </div>
        <div>
          <span>协作状态</span>
          <strong>{roomOrder.paymentConditionSummary ?? order.fundingStatus}</strong>
        </div>
      </div>

      {settlementPreview ? (
        <section className="settlement-placeholder order-settlement" aria-label="付款条件占位">
          <span className="overline">{settlementPreview.label}</span>
          <strong>{settlementPreview.statusLabel}</strong>
          <p>{settlementPreview.disclaimer}</p>
        </section>
      ) : null}

      {task ? (
        <div className="current-task-strip">
          {(() => {
            const executorDisplay = taskExecutorDisplay(task);
            return (
              <>
                <span>当前待办</span>
                <strong>{task.title}</strong>
                <small>{executorDisplay.performanceSlotLabel}</small>
                {executorDisplay.personaLabel ? <small>身份标签：{executorDisplay.personaLabel}</small> : null}
              </>
            );
          })()}
        </div>
      ) : null}

      {currentTasks.length > 0 ? (
        <section className="current-tasks" aria-labelledby="current-tasks-title">
          <div className="section-heading compact">
            <ReceiptText aria-hidden="true" />
            <h3 id="current-tasks-title">当前任务</h3>
          </div>
          <div className="current-task-grid">
            {currentTasks.map((item) => {
              const display = taskDisplay(item);
              const executorDisplay = taskExecutorDisplay(item);
              return (
                <article className={`current-task-card current-task-${display.state}`} key={item.taskId}>
                  <span>{display.label}</span>
                  <strong>{item.title}</strong>
                  <small>{executorDisplay.performanceSlotLabel}</small>
                  {executorDisplay.personaLabel ? <small>身份标签：{executorDisplay.personaLabel}</small> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="sla-panel" aria-labelledby="sla-title">
        <div className="section-heading compact">
          <CalendarClock aria-hidden="true" />
          <h3 id="sla-title">期限 / 服务要求</h3>
        </div>
        {slaRows.length > 0 ? (
          <div className="sla-grid">
            {slaRows.map((row) => (
              <article className={`sla-card sla-${row.tone}`} key={row.task.taskId}>
                <div className="sla-card-heading">
                  {slaIcon(row.status)}
                  <div>
                    <strong>{row.task.title}</strong>
                    <span>{row.label}</span>
                  </div>
                </div>
                <dl className="sla-facts">
                  <div>
                    <dt>履约插槽</dt>
                    <dd>{taskExecutorDisplay(row.task).performanceSlotLabel}</dd>
                  </div>
                  <div>
                    <dt>业务身份标签</dt>
                    <dd>{taskExecutorDisplay(row.task).personaLabel ?? "未声明"}</dd>
                  </div>
                  <div>
                    <dt>授权说明</dt>
                    <dd>{taskExecutorDisplay(row.task).authorizationLabel}</dd>
                  </div>
                  <div>
                    <dt>截止时间</dt>
                    <dd>{row.task.deadline}</dd>
                  </div>
                  <div>
                    <dt>依赖</dt>
                    <dd>{row.blockedBy}</dd>
                  </div>
                  <div>
                    <dt>升级提示</dt>
                    <dd>{row.escalation}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">当前订单没有与你的钱包匹配的期限待办。</p>
        )}
      </section>

      <div className="stage-track" aria-label="订单阶段">
        {order.stages.map((stage) => (
          <div className={`stage-step stage-${stage.status}`} key={stage.stageId}>
            {stage.status === "done" ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
            <span>{stage.name}</span>
            <small>{stageLabel[stage.status]}</small>
          </div>
        ))}
      </div>

      <section className="participants" aria-labelledby="participants-title">
        <div className="section-heading compact">
          <UsersRound aria-hidden="true" />
          <h3 id="participants-title">参与方</h3>
        </div>
        <div className="participant-grid">
          {order.participants.map((participant) => {
            const participantTask = findParticipantTask(participant.role, currentTasks);
            const executorDisplay = participantTask ? taskExecutorDisplay(participantTask) : undefined;
            return (
              <div className={`participant participant-${participant.tone}`} key={participant.participantId}>
                <div className="participant-title-line">
                  <strong>{executorDisplay?.performanceSlotLabel ?? participant.role}</strong>
                  <span>{participantStatusLabel[participant.status]}</span>
                </div>
                <span>
                  {executorDisplay?.personaLabel
                    ? `身份标签：${executorDisplay.personaLabel}`
                    : participant.duty}
                </span>
                <div className="participant-responsibility">
                  <small>当前责任</small>
                  <b>{participantTask ? participantTask.title : nextResponsibilityForParticipant(participant.role, order)}</b>
                </div>
                <div className="participant-badges">
                  {participantTask?.status === "open" ? <span className="mini-badge mini-action">待处理</span> : null}
                  {participantTask?.supplierTrustStatus ? (
                    <span className={`mini-badge mini-${trustTone(participantTask.supplierTrustStatus)}`}>
                      {trustLabel(participantTask.supplierTrustStatus)}
                    </span>
                  ) : null}
                  <span className="mini-badge mini-neutral">权限以订单权限表为准</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="recent-events order-timeline" aria-labelledby="recent-events-title">
        <div className="section-heading compact">
          <Clock3 aria-hidden="true" />
          <h3 id="recent-events-title">时间线</h3>
        </div>
        {timeline.length > 0 ? (
          <div className="timeline-list">
            {timeline.map((event) => (
              <article className={`timeline-row timeline-${timelineTone(event)}`} key={event.eventId}>
                <span className="timeline-marker" aria-hidden="true" />
                <div>
                  <div className="timeline-title-line">
                    <strong>{event.text}</strong>
                    <span>{event.eventName || event.proofKind ? "链上证明" : "工作流记录"}</span>
                  </div>
                  <small>
                    {event.time}
                    {event.blockNumber ? ` · block ${event.blockNumber}` : ""}
                    {event.transactionHash ? ` · ${shortHash(event.transactionHash)}` : ""}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">暂无订单进展。</p>
        )}
      </section>

      <details className="order-proof-drawer" aria-label="证明抽屉">
        <summary>
          <Fingerprint aria-hidden="true" />
          <span>文件与证明回执</span>
        </summary>
        {order.proofRows.length > 0 ? (
          <dl className="proof-grid">
            {order.proofRows.map((row) => (
              <div className="proof-row" key={`${row.label}:${row.value}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted-copy">暂无可显示的证明记录。</p>
        )}
      </details>
    </section>
  );
}

function mergeOrderTasks(
  order: OrderRoomOrder,
  tasks: readonly ProductTaskDTO[],
  selectedTask?: ProductTaskDTO
): readonly ProductTaskDTO[] {
  const merged = new Map<string, ProductTaskDTO>();
  for (const item of order.tasks ?? []) {
    merged.set(item.taskId, item);
  }
  for (const item of tasks) {
    if (item.orderId === order.orderId) {
      merged.set(item.taskId, item);
    }
  }
  if (selectedTask?.orderId === order.orderId) {
    merged.set(selectedTask.taskId, selectedTask);
  }
  return [...merged.values()].sort(compareTasks);
}

function buildSlaRows(tasks: readonly ProductTaskDTO[]): readonly SlaRow[] {
  return tasks.map((item) => {
    const status = slaStatus(item);
    return {
      task: item,
      status,
      label: slaLabel(status),
      tone: slaTone(status),
      blockedBy: item.blockedReason ?? (item.status === "blocked" ? "等待前置条件或补证" : "无阻塞依赖"),
      escalation: escalationHint(status)
    };
  });
}

function slaStatus(task: ProductTaskDTO): SlaRow["status"] {
  if (task.status === "done" || task.status === "submitted") {
    return "confirmed";
  }
  if (task.status === "blocked") {
    return "blocked";
  }
  const deadline = parseDeadline(task.deadline);
  if (deadline && deadline.getTime() < Date.now()) {
    return "overdue";
  }
  if (deadline && deadline.getTime() - Date.now() <= 24 * 60 * 60 * 1000) {
    return "near_deadline";
  }
  return "ready";
}

function slaLabel(status: SlaRow["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "near_deadline":
      return "Near deadline";
    case "overdue":
      return "Overdue";
    case "blocked":
      return "Blocked";
    case "confirmed":
      return "Confirmed";
  }
}

function slaTone(status: SlaRow["status"]): SlaRow["tone"] {
  switch (status) {
    case "overdue":
    case "blocked":
      return "danger";
    case "near_deadline":
      return "warn";
    case "confirmed":
      return "ok";
    case "ready":
      return "info";
  }
}

function escalationHint(status: SlaRow["status"]): string {
  switch (status) {
    case "overdue":
      return "提醒责任方并补充逾期说明；状态仍以链上确认为准";
    case "blocked":
      return "先处理依赖或失败原因，不能用通知代替提交";
    case "near_deadline":
      return "优先完成当前责任，必要时联系订单运营";
    case "confirmed":
      return "等待后续阶段或链上索引更新";
    case "ready":
      return "由责任方使用授权钱包提交";
  }
}

function slaIcon(status: SlaRow["status"]) {
  switch (status) {
    case "confirmed":
      return <CheckCircle2 aria-hidden="true" />;
    case "blocked":
    case "overdue":
      return <XCircle aria-hidden="true" />;
    case "near_deadline":
      return <AlertTriangle aria-hidden="true" />;
    case "ready":
      return <Clock3 aria-hidden="true" />;
  }
}

function parseDeadline(value: string): Date | undefined {
  const parsed = Date.parse(value.trim().replace(" ", "T"));
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function findParticipantTask(role: string, tasks: readonly ProductTaskDTO[]): ProductTaskDTO | undefined {
  return tasks.find((task) => {
    const executorDisplay = taskExecutorDisplay(task);
    const labels = [
      executorDisplay.performanceSlotLabel,
      executorDisplay.assigneeRoleLabel,
      ...executorDisplay.personaLabels,
      task.assigneeRole,
      task.participantRoleLabel
    ].filter((label): label is string => Boolean(label));
    return labels.some((label) => role.includes(label) || label.includes(role));
  });
}

function nextResponsibilityForParticipant(role: string, order: ProductOrderDTO): string {
  const stage = order.stages.find((item) => item.ownerRole && (role.includes(item.ownerRole) || item.ownerRole.includes(role)));
  return stage ? `${stage.name}：${stageLabel[stage.status]}` : "暂无当前待办";
}

function trustLabel(status: ChainAttestationStatus): string {
  switch (status) {
    case "attested":
      return "已背书";
    case "revoked":
      return "背书撤销";
    case "not_found":
      return "未发现背书";
  }
}

function trustTone(status: ChainAttestationStatus): "ok" | "danger" | "neutral" {
  switch (status) {
    case "attested":
      return "ok";
    case "revoked":
      return "danger";
    case "not_found":
      return "neutral";
  }
}

function orderTimeline(order: OrderRoomOrder): readonly OrderTimelineEvent[] {
  const timeline = order.timeline && order.timeline.length > 0 ? order.timeline : order.recentEvents;
  return [...timeline].slice(-8).reverse();
}

function timelineTone(event: OrderTimelineEvent): "ok" | "warn" | "danger" | "info" {
  const text = `${event.eventName ?? ""} ${event.text}`.toLowerCase();
  if (/revoked|cancel|failed|撤销|失败|取消/u.test(text)) {
    return "danger";
  }
  if (/ready|submitted|confirmed|hookready|待办|就绪|完成|确认/u.test(text)) {
    return "ok";
  }
  if (/blocked|dispute|争议|受阻/u.test(text)) {
    return "warn";
  }
  return "info";
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function compareTasks(left: ProductTaskDTO, right: ProductTaskDTO): number {
  const rank: Readonly<Record<ProductTaskDTO["status"], number>> = {
    open: 0,
    blocked: 1,
    submitted: 2,
    done: 3
  };
  return rank[left.status] - rank[right.status] ||
    left.deadline.localeCompare(right.deadline) ||
    left.taskId.localeCompare(right.taskId);
}
