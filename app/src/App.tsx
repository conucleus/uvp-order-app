// order-app 最小可用：链上直连查看/发送信号。没有 backend、账户体系、会话 token、
// 配置目录、金额/文件/任务承诺；读用公共 RPC，写用浏览器钱包 submitSignal。
// 失败与空分开：读取失败具名，空事件列表只表示链上没有这些事实。

import { useMemo, useState } from "react";
import {
  chainConfigProblemText,
  readChainConfig,
  type ChainConfig
} from "./chain/config";
import {
  connectWallet,
  createChainReader,
  submitSignal,
  type ChainFailure,
  type OrderFacts,
  type WalletConnection
} from "./chain/client";
import type { ChainEvent, SignalSubmittedFact } from "./chain/events";
import {
  buildSubmitSignalArguments,
  mapWalletError,
  parseBytes32,
  randomBytes32,
  type SignalArguments
} from "./chain/input";

type QueryState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly facts: OrderFacts }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type EventsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly events: readonly ChainEvent[] }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

type SubmitState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "success"; readonly txHash: string }
  | { readonly kind: "failed"; readonly failure: ChainFailure };

export default function App() {
  const configState = useMemo(() => readChainConfig(import.meta.env), []);
  if (!configState.ok) {
    return <ConfigProblem problem={chainConfigProblemText(configState.problem)} />;
  }
  return <ChainWorkbench config={configState.config} />;
}

function ChainWorkbench({ config }: { readonly config: ChainConfig }) {
  const reader = useMemo(() => createChainReader(config), [config]);
  const [wallet, setWallet] = useState<WalletConnection | undefined>(undefined);
  const [walletFailure, setWalletFailure] = useState<ChainFailure | undefined>(undefined);
  const [planInput, setPlanInput] = useState("");
  const [orderInput, setOrderInput] = useState("");
  const [query, setQuery] = useState<QueryState>({ kind: "idle" });
  const [events, setEvents] = useState<EventsState>({ kind: "idle" });

  const [sourceId, setSourceId] = useState("");
  const [signalId, setSignalId] = useState("");
  const [payloadHash, setPayloadHash] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => safeRandomBytes32());
  const [attribution, setAttribution] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  async function connect(): Promise<void> {
    setWalletFailure(undefined);
    const result = await connectWallet(config);
    if (!result.ok) {
      setWalletFailure(result.failure);
      return;
    }
    setWallet(result.value);
  }

  async function load(): Promise<void> {
    const planId = parseBytes32(planInput, "planId");
    if (!planId.ok) {
      setQuery({ kind: "failed", failure: { code: "invalid_input", message: planId.message } });
      setEvents({ kind: "failed", failure: { code: "invalid_input", message: planId.message } });
      return;
    }
    const orderId = parseBytes32(orderInput, "orderId");
    if (!orderId.ok) {
      setQuery({ kind: "failed", failure: { code: "invalid_input", message: orderId.message } });
      setEvents({ kind: "failed", failure: { code: "invalid_input", message: orderId.message } });
      return;
    }
    setQuery({ kind: "loading" });
    setEvents({ kind: "loading" });
    const [facts, chainEvents] = await Promise.all([
      reader.readOrder(planId.value, orderId.value),
      reader.readEvents(planId.value, orderId.value)
    ]);
    setQuery(facts.ok ? { kind: "ready", facts: facts.value } : { kind: "failed", failure: facts.failure });
    setEvents(
      chainEvents.ok ? { kind: "ready", events: chainEvents.value } : { kind: "failed", failure: chainEvents.failure }
    );
  }

  async function send(): Promise<void> {
    const built = buildSubmitSignalArguments({
      planId: planInput,
      orderId: orderInput,
      sourceId,
      signalId,
      payloadHash,
      idempotencyKey,
      attributionRaw: attribution
    });
    if (!built.ok) {
      setSubmit({ kind: "failed", failure: { code: "invalid_input", message: built.message } });
      return;
    }
    if (wallet === undefined) {
      setSubmit({ kind: "failed", failure: { code: "no_wallet", message: "先连接钱包再发送信号" } });
      return;
    }
    setSubmit({ kind: "pending" });
    const result = await submitSignal(config, wallet, built.value);
    if (!result.ok) {
      setSubmit({ kind: "failed", failure: result.failure });
      return;
    }
    setSubmit({ kind: "success", txHash: result.value.txHash });
    setIdempotencyKey(safeRandomBytes32());
    await load();
  }

  const signals = events.kind === "ready" ? events.events.filter(isSignal) : [];
  const otherEvents = events.kind === "ready" ? events.events.filter((event) => !isSignal(event)) : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div>
            <p>UVP Order App</p>
            <h1>链上信号</h1>
          </div>
        </div>
        <div className="topbar-actions">
          {wallet === undefined ? (
            <button className="primary-button" type="button" onClick={() => void connect()}>
              连接钱包
            </button>
          ) : (
            <span className="source-badge source-real" title={wallet.address}>
              钱包 {short(wallet.address)}
            </span>
          )}
        </div>
      </header>

      <SystemBanner
        tone="info"
        title="最小、链上直连"
        text="order-app 只提供链上信号/秩序查看与发送；资金、文件、配置、任务不在承诺范围；也没有 backend、账户体系或会话 token。"
      />

      {walletFailure === undefined ? null : (
        <SystemBanner tone="warn" title="钱包连接失败" text={`${walletFailure.code}：${walletFailure.message}`} />
      )}

      <section className="panel">
        <h2>订单</h2>
        <div className="grid-2">
          <label>
            planId
            <input
              value={planInput}
              onChange={(event) => setPlanInput(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
          <label>
            orderId
            <input
              value={orderInput}
              onChange={(event) => setOrderInput(event.target.value)}
              placeholder="0x + 64 hex"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={query.kind === "loading"}
            onClick={() => void load()}
          >
            {query.kind === "loading" ? "读取中…" : "读取链上事实"}
          </button>
        </div>

        {query.kind === "failed" ? (
          <FailureBlock title="订单事实读取失败" failure={query.failure} />
        ) : null}
        {query.kind === "ready" ? (
          <dl className="facts">
            <div>
              <dt>planExists</dt>
              <dd>{String(query.facts.planExists)}</dd>
            </div>
            <div>
              <dt>orderExists</dt>
              <dd>{String(query.facts.orderExists)}</dd>
            </div>
            {query.facts.orderExists ? (
              <>
                <div>
                  <dt>creator</dt>
                  <dd>{query.facts.creator ?? "未返回"}</dd>
                </div>
                <div>
                  <dt>relayer</dt>
                  <dd>{query.facts.relayer ?? "未返回"}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>说明</dt>
                <dd>链上没有这个订单（不是读取失败）。</dd>
              </div>
            )}
          </dl>
        ) : null}
      </section>

      <section className="panel">
        <h2>信号（SignalSubmitted）</h2>
        <p className="fineprint">
          SignalSubmitted 事件不含 fee/金额字段；这里的字段全部来自链上事件，不补造配置或阶段名。
        </p>
        {events.kind === "loading" ? <p className="fineprint">正在读取事件…</p> : null}
        {events.kind === "failed" ? (
          <FailureBlock title="事件读取失败" failure={events.failure} />
        ) : null}
        {events.kind === "ready" && events.events.length === 0 ? (
          <p className="fineprint">读取成功：链上没有匹配的事实事件（空不是失败）。</p>
        ) : null}
        {signals.length > 0 ? (
          <ul className="event-list">
            {signals.map((event) => (
              <li key={`${event.transactionHash}-${event.logIndex}`} className="event-card">
                <EventHead event={event} />
                <SignalFields event={event} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <h2>其他链上事实</h2>
        {otherEvents.length > 0 ? (
          <ul className="event-list">
            {otherEvents.map((event) => (
              <li key={`${event.transactionHash}-${event.logIndex}`} className="event-card">
                <EventHead event={event} />
                <OtherFields event={event} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="fineprint">没有 HookReady / StageMaterialized / StageExecutorActivated 事件。</p>
        )}
      </section>

      <section className="panel">
        <h2>发信号</h2>
        <p className="fineprint">
          钱包直接调用 UVPStateMachine.submitSignal；不经 relay/backend。attribution 可选 JSON：
          {` { "stageId": "0x…", "proof": ["0x…"] }`}（proof 语义不解析）。
        </p>
        <div className="grid-2">
          <label>
            sourceId
            <input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            signalId
            <input value={signalId} onChange={(event) => setSignalId(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            payloadHash
            <input value={payloadHash} onChange={(event) => setPayloadHash(event.target.value)} placeholder="0x + 64 hex" spellCheck={false} />
          </label>
          <label>
            idempotencyKey
            <input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="0x + 64 hex（默认随机）" spellCheck={false} />
          </label>
        </div>
        <label>
          attribution（可选 JSON）
          <textarea
            value={attribution}
            onChange={(event) => setAttribution(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={`{ "stageId": "0x…", "proof": [] }`}
          />
        </label>
        <div className="submit-actions">
          <button
            className="primary-button"
            type="button"
            disabled={submit.kind === "pending"}
            onClick={() => void send()}
          >
            {submit.kind === "pending" ? "等待钱包/回执…" : "发送信号"}
          </button>
        </div>
        {submit.kind === "success" ? (
          <p className="status-ok">已上链：{submit.txHash}</p>
        ) : null}
        {submit.kind === "failed" ? <FailureBlock title="发送失败" failure={submit.failure} /> : null}
      </section>
    </main>
  );
}

function SignalFields({ event }: { readonly event: SignalSubmittedFact }) {
  return (
    <dl className="facts">
      <div>
        <dt>sourceId / signalId</dt>
        <dd>
          {short(event.sourceId)} / {short(event.signalId)}
        </dd>
      </div>
      <div>
        <dt>submitter</dt>
        <dd>{event.submitter}</dd>
      </div>
      <div>
        <dt>payloadHash</dt>
        <dd>{event.payloadHash}</dd>
      </div>
      <div>
        <dt>idempotencyKey</dt>
        <dd>{event.idempotencyKey}</dd>
      </div>
      <div>
        <dt>factStageId</dt>
        <dd>{event.factStageId}</dd>
      </div>
    </dl>
  );
}

function OtherFields({ event }: { readonly event: ChainEvent }) {
  switch (event.kind) {
    case "hook_ready":
      return (
        <dl className="facts">
          <div><dt>hookId</dt><dd>{event.hookId}</dd></div>
          <div><dt>stageId</dt><dd>{event.stageId}</dd></div>
          <div><dt>hookName</dt><dd>{event.hookName}</dd></div>
        </dl>
      );
    case "stage_materialized":
      return (
        <dl className="facts">
          <div><dt>stageId</dt><dd>{event.stageId}</dd></div>
          <div><dt>triggerHookId</dt><dd>{event.triggerHookId}</dd></div>
          <div><dt>source / signal</dt><dd>{short(event.sourceId)} / {short(event.signalId)}</dd></div>
        </dl>
      );
    case "stage_executor_activated":
      return (
        <dl className="facts">
          <div><dt>stageId</dt><dd>{event.targetStageId}</dd></div>
          <div><dt>executor</dt><dd>{event.executor}</dd></div>
          <div><dt>role / metadataHash</dt><dd>{short(event.role)} / {short(event.metadataHash)}</dd></div>
          <div><dt>patchNonce</dt><dd>{String(event.patchNonce)}</dd></div>
          <div><dt>metadataURI</dt><dd>{event.metadataURI || "（空）"}</dd></div>
        </dl>
      );
    case "signal_submitted":
      return <SignalFields event={event} />;
    default:
      return null;
  }
}

function EventHead({ event }: { readonly event: ChainEvent }) {
  const timestamp =
    event.timestamp === undefined ? "时间未知" : new Date(Number(event.timestamp) * 1000).toLocaleString();
  return (
    <div className="event-head">
      <strong>{event.kind}</strong>
      <span className="fineprint">
        block {String(event.blockNumber)} · {timestamp} · tx {short(event.transactionHash)}
      </span>
    </div>
  );
}

function FailureBlock({ title, failure }: { readonly title: string; readonly failure: ChainFailure }) {
  return (
    <section className="system-banner system-banner-error" role="alert">
      <strong>{title}（{failure.code}）</strong>
      <span>{failure.message}</span>
      {failure.txHash === undefined ? null : <span className="fineprint">txHash：{failure.txHash}</span>}
    </section>
  );
}

function SystemBanner({ tone, title, text }: { readonly tone: "info" | "warn" | "error"; readonly title: string; readonly text: string }) {
  return (
    <section className={`system-banner system-banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <span>{text}</span>
    </section>
  );
}

function ConfigProblem({ problem }: { readonly problem: string }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div>
            <p>UVP Order App</p>
            <h1>链上信号</h1>
          </div>
        </div>
        <span className="source-badge source-missing">未配置</span>
      </header>
      <SystemBanner tone="warn" title="链配置缺失/不合法" text={problem} />
      <section className="panel">
        <p className="fineprint">
          需要 VITE_UVP_STATE_MACHINE、VITE_CHAIN_ID、VITE_RPC_URL；可选 VITE_UVP_FROM_BLOCK（默认 0）。
        </p>
      </section>
    </main>
  );
}

function isSignal(event: ChainEvent): event is SignalSubmittedFact {
  return event.kind === "signal_submitted";
}

function short(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function safeRandomBytes32(): string {
  try {
    return randomBytes32();
  } catch {
    return "";
  }
}

export type { SignalArguments };
