/* 通用阶段托管面板：读取 GET /product/orders/:orderId/escrow[/:stageId] 的
 * tranche 投影，按当前钱包角色给出 StageEscrow 动作（verifier approve/reject；
 * payer payNow/refundByPayer/suspend；payee refundByPayee/suspend；双方
 * consentSettlement），错误按合约 revert/自定义错误显示。托管地址/链来自
 * config.ts，合约是唯一裁决方；本页不做平台裁决、不自动退款、不展示密钥。
 */
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  HandCoins,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProductOrderDTO } from "@uvp-eth/product-dto";
import { ProductApiError, type ProductApiClient } from "../api/productApi";
import { readEscrowAllocations, type EscrowAllocationsView } from "./allocations";
import { escrowActionFailureCopy, submitStageEscrowAction, type EscrowActionName } from "./actions";
import { readRuntimeEscrowConfig } from "./config";
import {
  escrowDeadlineView,
  escrowStateLabel,
  escrowStateTone,
  formatBaseUnits,
  formatEscrowTime,
  formatFeeBps,
  formatTokenAmount,
  shortAddress,
  shortHex
} from "./format";
import {
  escrowActorRoles,
  type EscrowActorRole,
  type EscrowTrancheDTO,
  type OrderEscrowReadResult
} from "./types";
import { injectedEscrowProvider } from "./wallet";
import "./escrow.css";

export interface EscrowPageProps {
  readonly api: ProductApiClient;
  readonly orders: readonly ProductOrderDTO[];
  readonly orderId?: string | undefined;
  readonly stageId?: string | undefined;
  readonly walletAddress?: string | undefined;
  readonly onBack: () => void;
  readonly onSelect: (selection: {
    readonly orderId?: string | undefined;
    readonly stageId?: string | undefined;
  }) => void;
  readonly onSessionExpired?: ((error: unknown) => boolean) | undefined;
}

type EscrowReadState =
  | { readonly status: "missing_order" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly result: OrderEscrowReadResult;
      readonly detail?: EscrowTrancheDTO;
      readonly detailError?: string;
    }
  | { readonly status: "error"; readonly message: string };

type ActionNotice =
  | { readonly tone: "ok"; readonly text: string; readonly txHash?: string | undefined }
  | { readonly tone: "error"; readonly text: string };

type AllocationState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: EscrowAllocationsView }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export function EscrowPage({
  api,
  orders,
  orderId,
  stageId,
  walletAddress,
  onBack,
  onSelect,
  onSessionExpired
}: EscrowPageProps) {
  const configResolution = useMemo(() => readRuntimeEscrowConfig(), []);
  const normalizedOrderId = orderId?.trim() ?? "";
  const normalizedWallet = walletAddress?.trim();
  const normalizedStageId = stageId?.trim() ?? "";
  const [readState, setReadState] = useState<EscrowReadState>({ status: "missing_order" });
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<EscrowActionName | undefined>(undefined);
  const [actionNotice, setActionNotice] = useState<ActionNotice | undefined>(undefined);
  const [settlePayerAmount, setSettlePayerAmount] = useState("");
  const [settlePayeeAmount, setSettlePayeeAmount] = useState("");
  const [allocationState, setAllocationState] = useState<AllocationState>({ status: "idle" });
  const [allocationReloadKey, setAllocationReloadKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const walletQuery = useMemo(
    () => (normalizedWallet ? { walletAddress: normalizedWallet } : {}),
    [normalizedWallet]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!normalizedOrderId) {
      setReadState({ status: "missing_order" });
      return undefined;
    }
    let active = true;
    setReadState({ status: "loading" });
    void (async () => {
      try {
        const result = await api.getOrderEscrow(normalizedOrderId, undefined, walletQuery);
        let detail: EscrowTrancheDTO | undefined;
        let detailError: string | undefined;
        if (normalizedStageId) {
          try {
            const single = await api.getOrderEscrow(normalizedOrderId, normalizedStageId, walletQuery);
            detail = single.tranches[0];
          } catch (error) {
            if (!active) {
              return;
            }
            if (onSessionExpired?.(error)) {
              return;
            }
            detailError = escrowReadFailureCopy(error);
          }
        }
        if (!active) {
          return;
        }
        setReadState({
          status: "ready",
          result,
          ...(detail ? { detail } : {}),
          ...(detailError ? { detailError } : {})
        });
      } catch (error) {
        if (!active) {
          return;
        }
        if (onSessionExpired?.(error)) {
          return;
        }
        setReadState({ status: "error", message: escrowReadFailureCopy(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, normalizedOrderId, normalizedStageId, reloadKey, walletQuery]);

  const list = readState.status === "ready" ? readState.result.tranches : [];
  const selected = readState.status === "ready"
    ? normalizedStageId
      ? readState.detail
      : list[0]
    : undefined;
  const selectedReadError = readState.status === "ready" && normalizedStageId ? readState.detailError : undefined;
  const selectedOrder = useMemo(
    () => orders.find((order) => order.orderId.toLowerCase() === normalizedOrderId.toLowerCase()),
    [orders, normalizedOrderId]
  );
  const stageNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const order of orders) {
      for (const stage of order.stages ?? []) {
        names.set(stage.stageId.toLowerCase(), stage.name);
      }
    }
    return names;
  }, [orders]);
  const tokenSymbol = configResolution.ok ? configResolution.config.tokenSymbol : "USDT";
  const roles: ReadonlySet<EscrowActorRole> = selected
    ? escrowActorRoles(selected, walletAddress)
    : new Set<EscrowActorRole>();
  const deadline = selected ? escrowDeadlineView(selected, nowMs) : undefined;

  useEffect(() => {
    setActionNotice(undefined);
    setSettlePayerAmount("");
    setSettlePayeeAmount("");
  }, [selected?.trancheId]);

  useEffect(() => {
    if (!selected || selected.state !== "suspended") {
      setAllocationState({ status: "idle" });
      return undefined;
    }
    if (!configResolution.ok) {
      setAllocationState({ status: "unavailable", message: "托管合约未配置，无法读取链上分配提交状态。" });
      return undefined;
    }
    const provider = injectedEscrowProvider();
    if (!provider) {
      setAllocationState({
        status: "unavailable",
        message: "未连接浏览器钱包，无法读取链上分配提交状态（托管 API 不返回双方各自提交的分配）。"
      });
      return undefined;
    }
    let active = true;
    setAllocationState({ status: "loading" });
    void readEscrowAllocations({
      config: configResolution.config,
      trancheId: selected.trancheId,
      provider
    })
      .then((view) => {
        if (active) {
          setAllocationState({ status: "ready", view });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAllocationState({ status: "error", message: escrowActionFailureCopy(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [selected?.trancheId, selected?.state, configResolution, allocationReloadKey]);

  function stageName(stageIdValue: string): string {
    return stageNames.get(stageIdValue.toLowerCase()) ?? `阶段 ${shortHex(stageIdValue)}`;
  }

  async function runAction(action: EscrowActionName, input?: { readonly payerAmount?: string; readonly payeeAmount?: string }): Promise<void> {
    if (!selected) {
      return;
    }
    if (!configResolution.ok) {
      setActionNotice({ tone: "error", text: configResolution.message });
      return;
    }
    setPendingAction(action);
    setActionNotice(undefined);
    const trancheId = selected.trancheId;
    try {
      const result = await submitStageEscrowAction({
        config: configResolution.config,
        action,
        trancheId,
        ...(input ? { input } : {}),
        ...(walletAddress ? { walletAddress } : {})
      });
      setActionNotice({
        tone: "ok",
        text: "交易已提交，等待链上索引后刷新本页状态。",
        txHash: result.txHash
      });
      if (action === "consentSettlement") {
        setAllocationReloadKey((key) => key + 1);
      }
    } catch (error) {
      setActionNotice({ tone: "error", text: escrowActionFailureCopy(error) });
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <section className="escrow-page" aria-label="阶段托管" data-testid="escrow-page">
      <header className="escrow-topbar">
        <button className="quiet-button" type="button" onClick={onBack} data-testid="escrow-back">
          <ArrowLeft aria-hidden="true" />
          返回待办
        </button>
        <div className="escrow-title">
          <span className="overline">按阶段冻款</span>
          <h2>阶段托管</h2>
          <p>每个阶段一笔独立冻款；资金动作与双方合意以链上托管为准。</p>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={!normalizedOrderId}
          data-testid="escrow-refresh"
        >
          <RefreshCw aria-hidden="true" />
          刷新
        </button>
      </header>

      {!configResolution.ok ? (
        <div className="escrow-banner escrow-banner-warn" role="status" data-testid="escrow-config-warning">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>托管动作未配置</strong>
            <span>{configResolution.message} 读取仍可用；配置前不会发送任何交易。</span>
          </div>
        </div>
      ) : null}

      {!normalizedOrderId ? (
        <section className="escrow-empty" aria-label="选择订单">
          <Wallet aria-hidden="true" />
          <h3>选择订单查看阶段托管</h3>
          <p>托管以订单的阶段为单位，每个阶段有独立的金额、履约方与验收者。</p>
          {orders.length > 0 ? (
            <div className="escrow-order-picker">
              {orders.map((order) => (
                <button
                  key={order.orderId}
                  className="escrow-order-button"
                  type="button"
                  onClick={() => onSelect({ orderId: order.orderId })}
                >
                  <strong>{order.title}</strong>
                  <span className="escrow-mono">{shortHex(order.orderId)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="escrow-muted">当前没有可见订单；订单投影同步后再试。</p>
          )}
        </section>
      ) : readState.status === "error" ? (
        <section className="escrow-empty" aria-label="托管读取失败">
          <XCircle aria-hidden="true" />
          <h3>托管记录读取失败</h3>
          <p>{readState.message}</p>
          <button className="quiet-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw aria-hidden="true" />
            重试
          </button>
        </section>
      ) : readState.status === "loading" || readState.status === "missing_order" ? (
        <section className="escrow-empty" aria-label="正在读取托管记录" aria-busy="true">
          <RefreshCw className="spin" aria-hidden="true" />
          <h3>正在读取托管记录</h3>
          <p>读取订单的阶段冻款、状态与双方信息。</p>
        </section>
      ) : list.length === 0 ? (
        <section className="escrow-empty" aria-label="暂无阶段冻款">
          <HandCoins aria-hidden="true" />
          <h3>该订单暂无阶段冻款</h3>
          <p>没有链上冻款记录；这不等于读取失败。冻款后各阶段会出现在这里。</p>
          <button className="quiet-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw aria-hidden="true" />
            刷新
          </button>
        </section>
      ) : (
        <>
          <div className="escrow-order-strip">
            <div>
              <span className="overline">订单</span>
              <strong>{selectedOrder?.title ?? "订单"}</strong>
              <small className="escrow-mono">{shortHex(normalizedOrderId)}</small>
            </div>
            <div>
              <span className="overline">当前钱包</span>
              <strong>{shortAddress(walletAddress)}</strong>
              <small>{selected ? roleSummary(roles) : "选择阶段查看你可执行的动作"}</small>
            </div>
            <div>
              <span className="overline">冻款阶段</span>
              <strong>{list.length}</strong>
              <small>{tokenSymbol} 结算 · 金额按 6 位小数展示</small>
            </div>
          </div>

          <div className="escrow-layout">
            <aside className="escrow-list" aria-label="阶段冻款列表" data-testid="escrow-tranche-list">
              <h3>冻款阶段</h3>
              {list.map((tranche, index) => (
                <button
                  key={tranche.trancheId}
                  type="button"
                  className={`escrow-tranche ${selected?.trancheId === tranche.trancheId ? "is-active" : ""}`}
                  onClick={() => onSelect({ orderId: normalizedOrderId, stageId: tranche.stageId })}
                  disabled={pendingAction !== undefined}
                  data-testid={`escrow-tranche-${index}`}
                >
                  <span className="escrow-tranche-head">
                    <strong>{stageName(tranche.stageId)}</strong>
                    <span className={`escrow-chip escrow-chip-${escrowStateTone(tranche.state)}`}>
                      {escrowStateLabel(tranche.state)}
                    </span>
                  </span>
                  <span className="escrow-tranche-amount">{formatTokenAmount(tranche.amount, tokenSymbol)}</span>
                  <span className="escrow-tranche-meta">
                    观察 {tranche.observationDays} 天 · 服务费 {formatFeeBps(tranche.feeBps)}
                  </span>
                </button>
              ))}
            </aside>

            <section className="escrow-detail" aria-label="阶段托管详情" data-testid="escrow-detail">
              {selectedReadError ? (
                <div className="escrow-empty escrow-empty-compact">
                  <XCircle aria-hidden="true" />
                  <h3>该阶段托管读取失败</h3>
                  <p>{selectedReadError}</p>
                  <button className="quiet-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
                    重试
                  </button>
                </div>
              ) : selected === undefined ? (
                <div className="escrow-empty escrow-empty-compact">
                  <ShieldCheck aria-hidden="true" />
                  <h3>选择左侧阶段</h3>
                  <p>查看该阶段的金额、状态、时间戳与你可执行的动作。</p>
                </div>
              ) : (
                <TrancheDetail
                  tranche={selected}
                  stageName={stageName(selected.stageId)}
                  tokenSymbol={tokenSymbol}
                  walletAddress={walletAddress}
                  roles={roles}
                  deadline={deadline}
                  actionNotice={actionNotice}
                  pendingAction={pendingAction}
                  allocationState={allocationState}
                  settlePayerAmount={settlePayerAmount}
                  settlePayeeAmount={settlePayeeAmount}
                  onSettlePayerChange={setSettlePayerAmount}
                  onSettlePayeeChange={setSettlePayeeAmount}
                  onAction={(action, input) => {
                    void runAction(action, input);
                  }}
                  onReloadAllocations={() => setAllocationReloadKey((key) => key + 1)}
                />
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

interface TrancheDetailProps {
  readonly tranche: EscrowTrancheDTO;
  readonly stageName: string;
  readonly tokenSymbol: string;
  readonly walletAddress?: string | undefined;
  readonly roles: ReadonlySet<EscrowActorRole>;
  readonly deadline: ReturnType<typeof escrowDeadlineView>;
  readonly actionNotice: ActionNotice | undefined;
  readonly pendingAction: EscrowActionName | undefined;
  readonly allocationState: AllocationState;
  readonly settlePayerAmount: string;
  readonly settlePayeeAmount: string;
  readonly onSettlePayerChange: (value: string) => void;
  readonly onSettlePayeeChange: (value: string) => void;
  readonly onAction: (action: EscrowActionName, input?: { readonly payerAmount?: string; readonly payeeAmount?: string }) => void;
  readonly onReloadAllocations: () => void;
}

function TrancheDetail({
  tranche,
  stageName,
  tokenSymbol,
  walletAddress,
  roles,
  deadline,
  actionNotice,
  pendingAction,
  allocationState,
  settlePayerAmount,
  settlePayeeAmount,
  onSettlePayerChange,
  onSettlePayeeChange,
  onAction,
  onReloadAllocations
}: TrancheDetailProps) {
  const busy = pendingAction !== undefined;
  const isPayer = roles.has("payer");
  const isPayee = roles.has("payee");
  const isVerifier = roles.has("verifier");
  const isParty = isPayer || isPayee;
  return (
    <>
      <header className="escrow-detail-head">
        <div>
          <span className="overline">阶段</span>
          <h3>{stageName}</h3>
          <span className="escrow-mono">{shortHex(tranche.trancheId)}</span>
        </div>
        <div className="escrow-detail-badges">
          <span className={`escrow-chip escrow-chip-${escrowStateTone(tranche.state)}`}>
            {escrowStateLabel(tranche.state)}
          </span>
          {isPayer ? <span className="escrow-role-chip">你是付款方</span> : null}
          {isPayee ? <span className="escrow-role-chip">你是履约方</span> : null}
          {isVerifier ? <span className="escrow-role-chip">你是验收者</span> : null}
        </div>
      </header>

      {deadline ? (
        <div className="escrow-deadline" role="status">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>{deadline.text}</strong>
            <span>
              {deadline.deadlineLabel}：{formatEscrowTime(deadline.deadlineIso)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="escrow-facts">
        <Fact label="冻款金额" value={formatTokenAmount(tranche.amount, tokenSymbol)} strong />
        <Fact label="担保服务费" value={`${formatFeeBps(tranche.feeBps)} · 从履约方成功付款扣`} />
        <Fact label="服务费接收方" value={shortAddress(tranche.feeRecipient)} title={tranche.feeRecipient} />
        <Fact label="观察期" value={`${tranche.observationDays} 天`} />
        <Fact label="付款方" value={shortAddress(tranche.payer)} title={tranche.payer} />
        <Fact label="履约方" value={shortAddress(tranche.payee)} title={tranche.payee} />
        <Fact label="验收者" value={shortAddress(tranche.verifier)} title={tranche.verifier} />
        <Fact label="区块 / 日志" value={`${tranche.blockNumber} / ${tranche.logIndex}`} />
      </div>

      <div className="escrow-times">
        <TimeFact label="验收通过" value={tranche.approvedAt} />
        <TimeFact label="验收拒绝" value={tranche.rejectedAt} />
        <TimeFact label="挂起" value={tranche.suspendedAt} />
        <TimeFact label="放款到账" value={tranche.releaseAt} />
        <TimeFact label="退款到账" value={tranche.refundAt} />
        <TimeFact label="最后更新" value={tranche.updatedAt} />
      </div>

      <div className="escrow-settlement-facts">
        <Fact label="付款方保留（终态）" value={formatOptionalAmount(tranche.payerAmount, tokenSymbol)} />
        <Fact label="履约方获得（终态）" value={formatOptionalAmount(tranche.payeeAmount, tokenSymbol)} />
        <Fact label="实际服务费（终态）" value={formatOptionalAmount(tranche.feeAmount, tokenSymbol)} />
      </div>

      <section className="escrow-actions" aria-label="托管动作">
        <h4>可执行动作</h4>
        {isPayer || isPayee || isVerifier ? null : (
          <p className="escrow-muted">
            {walletAddress
              ? `当前钱包 ${shortAddress(walletAddress)} 不是该阶段付款方/履约方/验收者，仅可查看。`
              : "未连接钱包，仅可查看；连接后按角色显示动作。"}
          </p>
        )}

        {isVerifier ? (
          <div className="escrow-action-group">
            <span className="escrow-action-label">验收者</span>
            <button
              type="button"
              className="escrow-button escrow-button-primary"
              disabled={busy}
              onClick={() => onAction("approve")}
              data-testid="escrow-action-approve"
            >
              <CheckCircle2 aria-hidden="true" />
              验收通过（进入观察期）
            </button>
            <button
              type="button"
              className="escrow-button escrow-button-danger"
              disabled={busy}
              onClick={() => onAction("reject")}
              data-testid="escrow-action-reject"
            >
              <XCircle aria-hidden="true" />
              验收不通过（进入退款窗口）
            </button>
          </div>
        ) : null}

        {isPayer ? (
          <div className="escrow-action-group">
            <span className="escrow-action-label">付款方</span>
            <button
              type="button"
              className="escrow-button escrow-button-primary"
              disabled={busy}
              onClick={() => onAction("payNow")}
              data-testid="escrow-action-payNow"
            >
              <HandCoins aria-hidden="true" />
              提前确认付款（不可撤销）
            </button>
            <button
              type="button"
              className="escrow-button"
              disabled={busy}
              onClick={() => onAction("refundByPayer")}
              data-testid="escrow-action-refundByPayer"
            >
              取消冻款并全额退款
            </button>
            <button
              type="button"
              className="escrow-button escrow-button-warn"
              disabled={busy}
              onClick={() => onAction("suspend")}
              data-testid="escrow-action-suspend"
            >
              挂起（争议）
            </button>
          </div>
        ) : null}

        {isPayee ? (
          <div className="escrow-action-group">
            <span className="escrow-action-label">履约方</span>
            <button
              type="button"
              className="escrow-button"
              disabled={busy}
              onClick={() => onAction("refundByPayee")}
              data-testid="escrow-action-refundByPayee"
            >
              全额退款给买方（放弃主张）
            </button>
            <button
              type="button"
              className="escrow-button escrow-button-warn"
              disabled={busy}
              onClick={() => onAction("suspend")}
              data-testid="escrow-action-suspend"
            >
              挂起（争议）
            </button>
          </div>
        ) : null}

        {isParty ? (
          <div className="escrow-action-group escrow-settle">
            <span className="escrow-action-label">双方合意结算</span>
            {tranche.state === "suspended" ? (
              <>
                <p className="escrow-muted">
                  挂起后双方分别提交同一分配；两笔一致后由合约执行。合约校验分配之和等于冻款金额，本页不做平台裁决。
                </p>
                <div className="escrow-settle-inputs">
                  <label>
                    付款方保留（payerAmount，{tokenSymbol}）
                    <input
                      inputMode="decimal"
                      value={settlePayerAmount}
                      onChange={(event) => onSettlePayerChange(event.target.value)}
                      placeholder="例如 0.2"
                      disabled={busy}
                      data-testid="escrow-settle-payer"
                    />
                  </label>
                  <label>
                    履约方获得（payeeAmount，{tokenSymbol}）
                    <input
                      inputMode="decimal"
                      value={settlePayeeAmount}
                      onChange={(event) => onSettlePayeeChange(event.target.value)}
                      placeholder="例如 0.8"
                      disabled={busy}
                      data-testid="escrow-settle-payee"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="escrow-button escrow-button-primary"
                  disabled={busy}
                  onClick={() =>
                    onAction("consentSettlement", {
                      payerAmount: settlePayerAmount,
                      payeeAmount: settlePayeeAmount
                    })
                  }
                  data-testid="escrow-action-consentSettlement"
                >
                  提交我的分配
                </button>
                <AllocationPanel
                  state={allocationState}
                  tokenSymbol={tokenSymbol}
                  onReload={onReloadAllocations}
                />
              </>
            ) : (
              <p className="escrow-muted">
                合意结算仅在资金挂起后可用（当前状态：{escrowStateLabel(tranche.state)}）。
              </p>
            )}
          </div>
        ) : null}

        {pendingAction ? <p className="escrow-muted">正在等待钱包签名并发送交易…</p> : null}
        {actionNotice ? (
          <div
            className={`escrow-notice escrow-notice-${actionNotice.tone}`}
            role={actionNotice.tone === "error" ? "alert" : "status"}
            data-testid="escrow-action-notice"
          >
            <strong>{actionNotice.tone === "ok" ? "交易已提交" : "动作未完成"}</strong>
            <span>{actionNotice.text}</span>
            {actionNotice.tone === "ok" && actionNotice.txHash ? (
              <code className="escrow-mono">{actionNotice.txHash}</code>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function AllocationPanel({
  state,
  tokenSymbol,
  onReload
}: {
  readonly state: AllocationState;
  readonly tokenSymbol: string;
  readonly onReload: () => void;
}) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return <p className="escrow-muted">正在读取链上双方分配提交状态…</p>;
  }
  if (state.status === "unavailable" || state.status === "error") {
    return (
      <div className="escrow-allocation escrow-allocation-warn">
        <strong>链上分配状态不可读</strong>
        <span>{state.message}</span>
        {state.status === "error" ? (
          <button className="quiet-button" type="button" onClick={onReload}>
            <RefreshCw aria-hidden="true" />
            重试读取
          </button>
        ) : null}
      </div>
    );
  }
  const bothSubmitted = state.view.payer.submitted && state.view.payee.submitted;
  const sameAllocation = bothSubmitted
    && state.view.payer.payerAmount === state.view.payee.payerAmount
    && state.view.payer.payeeAmount === state.view.payee.payeeAmount;
  return (
    <div className="escrow-allocation" data-testid="escrow-allocation">
      <strong>双方分配提交（链上读取）</strong>
      <span>
        付款方：{state.view.payer.submitted
          ? `已提交，保留 ${formatBaseUnits(state.view.payer.payerAmount)} ${tokenSymbol}，履约方获得 ${formatBaseUnits(state.view.payer.payeeAmount)} ${tokenSymbol}`
          : "未提交"}
      </span>
      <span>
        履约方：{state.view.payee.submitted
          ? `已提交，保留 ${formatBaseUnits(state.view.payee.payerAmount)} ${tokenSymbol}，履约方获得 ${formatBaseUnits(state.view.payee.payeeAmount)} ${tokenSymbol}`
          : "未提交"}
      </span>
      <span>
        {!bothSubmitted
          ? "等待另一方提交相同分配。"
          : sameAllocation
            ? "双方分配一致，合约已可执行结算。"
            : "双方提交的分配不一致，合约不会结算；请重新提交一致的分配。"}
      </span>
    </div>
  );
}

function Fact({ label, value, title, strong }: { readonly label: string; readonly value: string; readonly title?: string | undefined; readonly strong?: boolean | undefined }) {
  return (
    <div className={strong ? "escrow-fact is-strong" : "escrow-fact"}>
      <span>{label}</span>
      <strong title={title}>{value}</strong>
    </div>
  );
}

function TimeFact({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="escrow-time">
      <span>{label}</span>
      <strong>{formatEscrowTime(value)}</strong>
    </div>
  );
}

function roleSummary(roles: ReadonlySet<EscrowActorRole>): string {
  if (roles.size === 0) {
    return "当前钱包不是该阶段参与方";
  }
  const labels: Readonly<Record<EscrowActorRole, string>> = { payer: "付款方", payee: "履约方", verifier: "验收者" };
  return [...roles].map((role) => labels[role]).join(" / ");
}

function formatOptionalAmount(value: string | null, tokenSymbol: string): string {
  return value === null ? "—" : formatTokenAmount(value, tokenSymbol);
}

function escrowReadFailureCopy(error: unknown): string {
  if (error instanceof ProductApiError) {
    switch (error.errorCode) {
      case "escrow_not_configured":
        return "服务端未配置托管合约，无法读取该订单的冻款记录。";
      case "escrow_tranche_not_found":
        return "该订单下没有这个阶段的冻款记录。";
      case "product_order_not_found":
        return "订单不存在，或当前钱包无权查看该订单。";
      case "wallet_identity_required":
        return "需要先完成钱包会话登录，才能读取托管记录。";
      case "product_storage_unavailable":
        return "托管投影存储暂不可用，请稍后重试。";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "托管记录读取失败。";
}
