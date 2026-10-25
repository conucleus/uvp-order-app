// 结构页（开单 / 邀请接受 / 订单房间）：只消费 kernel 端口结果；未就绪的读面
// 显示 not_available + TODO，缺字段/空/无权限/结果未知分开呈现，不伪造成功。

import { useEffect, useMemo, useState } from "react";
import type {
  FinalizeOrderDraftPreparation,
  FinalizeOrderDraftResult,
  OrderView,
  StageInvitePreview,
  StageViewResponse,
  TaskListView
} from "@uvp-eth/order-kernel/product/kernel";
import {
  summarizeInviteAcceptTypedData,
  summarizeOrderFinalizeTypedData,
  verifyInviteAcceptTypedData,
  verifyOrderFinalizeTypedData
} from "@uvp-eth/order-kernel/product/kernel";
import type { Ports } from "./ports";
import { requestWalletAddressKernel, signTypedDataKernel, SigningError } from "./signing";
import {
  TODOS,
  type CreateOrderResult,
  type FlatConfig,
  type FlatStage,
  type InviteSelection,
  type StageSelection,
  type Failure,
  type Result
} from "./types";

function FailureView({ failure }: { readonly failure: Failure }) {
  return (
    <section className="system-banner system-banner-error" role="alert">
      <strong>操作未完成（{failure.kind}）</strong>
      <span>{failure.message}</span>
      {failure.code ? <span className="fineprint">错误码：{failure.code}</span> : null}
      {failure.todo ? <span className="fineprint">TODO：{failure.todo}</span> : null}
    </section>
  );
}

function unwrap<T>(result: Result<T>, setFailure: (failure: Failure | undefined) => void): T | undefined {
  if (result.kind === "ready") {
    setFailure(undefined);
    return result.value;
  }
  setFailure(result);
  return undefined;
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function stageRoleLabel(stage: FlatStage, slotKey: string): string {
  const slot = stage.slots.find((candidate) => candidate.slotKey === slotKey);
  return slot?.label ?? slotKey;
}

export function CreateOrderPage(props: {
  readonly ports: Ports;
  readonly defaultConfigId?: string | undefined;
  readonly defaultConfigVersion?: string | undefined;
  readonly onCreated: (result: CreateOrderResult) => void;
  readonly onBack: () => void;
}) {
  const [configId, setConfigId] = useState(props.defaultConfigId ?? "");
  const [version, setVersion] = useState(props.defaultConfigVersion ?? "");
  const [config, setConfig] = useState<FlatConfig | undefined>(undefined);
  const [profile, setProfile] = useState<string>("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Readonly<Record<string, boolean>>>({});
  const [terms, setTerms] = useState<Readonly<Record<string, StageSelection>>>({});
  const [invites, setInvites] = useState<Readonly<Record<string, InviteSelection>>>({});
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [created, setCreated] = useState<CreateOrderResult | undefined>(undefined);
  const [prepared, setPrepared] = useState<FinalizeOrderDraftPreparation | undefined>(undefined);
  const [finalized, setFinalized] = useState<FinalizeOrderDraftResult | undefined>(undefined);

  async function loadConfig(): Promise<void> {
    setBusy(true);
    const loaded = unwrap(await props.ports.getConfig(configId.trim(), version.trim()), setFailure);
    setBusy(false);
    if (!loaded) {
      setConfig(undefined);
      return;
    }
    setConfig(loaded);
    const defaultProfile = loaded.defaultProfile ?? Object.keys(loaded.profiles)[0];
    if (defaultProfile !== undefined) {
      applyProfile(loaded, defaultProfile);
    }
  }

  function applyProfile(target: FlatConfig, profileName: string): void {
    const stageKeys = target.profiles[profileName];
    setProfile(profileName);
    if (stageKeys === undefined) {
      return;
    }
    const nextSelected: Record<string, boolean> = {};
    for (const stage of target.stages) {
      nextSelected[stage.stageKey] = stageKeys.includes(stage.stageKey);
    }
    setSelected(nextSelected);
  }

  const stages = useMemo(() => config?.stages ?? [], [config]);
  const selectedStages = stages.filter((stage) => selected[stage.stageKey] === true);

  function termFor(stage: FlatStage): StageSelection {
    return terms[stage.stageKey] ?? {
      stageKey: stage.stageKey,
      amountBaseUnits: "",
      inviteDeadline: isoInDays(7),
      workDeadline: isoInDays(30)
    };
  }

  function inviteRows(): readonly { readonly stage: FlatStage; readonly slotKey: string; readonly role: string }[] {
    const rows: { stage: FlatStage; slotKey: string; role: string }[] = [];
    for (const stage of selectedStages) {
      for (const slot of stage.slots) {
        rows.push({ stage, slotKey: slot.slotKey, role: slot.label ?? slot.slotKey });
      }
    }
    return rows;
  }

  async function createDraft(): Promise<void> {
    if (!config) {
      setFailure({ kind: "invalid", message: "请先加载配置版本。" });
      return;
    }
    if (title.trim().length === 0) {
      setFailure({ kind: "invalid", message: "请填写订单标题。" });
      return;
    }
    if (selectedStages.length === 0) {
      setFailure({ kind: "invalid", message: "至少选择一个阶段。" });
      return;
    }
    const rows = inviteRows();
    const missingInvite = rows.find((row) => (invites[`${row.stage.stageKey}/${row.slotKey}`]?.subjectLabel ?? "").trim().length === 0);
    if (missingInvite) {
      setFailure({ kind: "invalid", message: `请为 ${missingInvite.stage.stageKey}/${missingInvite.slotKey} 填写受邀方名称。` });
      return;
    }
    setBusy(true);
    const result = unwrap(await props.ports.createOrder({
      config,
      title: title.trim(),
      stages: selectedStages.map((stage) => termFor(stage)),
      invites: rows.map((row) => invites[`${row.stage.stageKey}/${row.slotKey}`]!)
    }), setFailure);
    setBusy(false);
    if (!result) {
      return;
    }
    setCreated(result);
    setDraftId(result.draftId);
    props.onCreated(result);
  }

  async function prepareFinalize(): Promise<void> {
    if (!draftId) {
      return;
    }
    setBusy(true);
    const value = unwrap(await props.ports.prepareFinalize(draftId), setFailure);
    setBusy(false);
    if (value) {
      setPrepared(value);
    }
  }

  async function signAndFinalize(): Promise<void> {
    if (!prepared || !draftId) {
      return;
    }
    setBusy(true);
    try {
      const address = await requestWalletAddressKernel();
      verifyOrderFinalizeTypedData(
        prepared.typedData,
        { chainId: prepared.typedData.domain.chainId, verifyingContract: prepared.typedData.domain.verifyingContract },
        { draftId, planId: prepared.planId, termsHash: prepared.termsHash, nonce: prepared.nonce, buyer: address }
      );
      const signature = await signTypedDataKernel(prepared.typedData, address);
      const result = unwrap(await props.ports.finalizeWithSignature(draftId, signature), setFailure);
      if (result) {
        setFinalized(result);
      }
    } catch (error) {
      setFailure({
        kind: "invalid",
        message: error instanceof SigningError ? error.message : error instanceof Error ? error.message : String(error),
        ...(error instanceof SigningError ? { code: error.code } : {})
      });
    } finally {
      setBusy(false);
    }
  }

  const finalizeSummary = prepared ? summarizeOrderFinalizeTypedData(prepared.typedData) : undefined;

  return (
    <section className="panel" aria-label="开单">
      <header className="section-head">
        <h2>开单</h2>
        <button className="quiet-button" type="button" onClick={props.onBack}>返回</button>
      </header>
      <p className="fineprint">
        订单复用配置版本已发布的 plan；时间窗口只归凝结核配置，订单不覆写。缺的读面会显示 not_available + TODO。
      </p>

      <fieldset>
        <legend>配置版本</legend>
        {configId.trim().length === 0 || version.trim().length === 0 ? (
          <p className="fineprint">未配置默认配置版本：请填写 configId/version（或由宿主注入 VITE_UVP_V3_CONFIG_ID/VERSION）。</p>
        ) : null}
        <label>configId <input value={configId} placeholder="例如 example/order-config" onChange={(event) => setConfigId(event.target.value)} /></label>
        <label>version <input value={version} placeholder="例如 1.0.0" onChange={(event) => setVersion(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy || configId.trim().length === 0 || version.trim().length === 0} onClick={() => void loadConfig()}>加载配置</button>
        <button className="quiet-button" type="button" disabled title="服务端无配置目录接口">配置目录（未就绪）</button>
      </fieldset>

      {config ? (
        <>
          <p className="fineprint">
            已加载 {config.configId}@{config.version}（{config.status}）
            {config.planId ? `，plan ${config.planId}` : "，未登记 plan（finalize 会 409 published_plan_missing）"}
            {config.tokenDecimals !== undefined ? `，token 小数位 ${config.tokenDecimals}` : "，token 小数位未知"}
          </p>
          <fieldset>
            <legend>订单内容</legend>
            <label>标题 <input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            {Object.keys(config.profiles).length > 0 ? (
              <label>阶段档
                <select value={profile} onChange={(event) => applyProfile(config, event.target.value)}>
                  {Object.keys(config.profiles).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>阶段与条款</legend>
            {stages.map((stage) => {
              const checked = selected[stage.stageKey] === true;
              const term = termFor(stage);
              return (
                <div key={stage.stageKey} className="panel">
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setSelected((current) => ({ ...current, [stage.stageKey]: event.target.checked }))}
                    />
                    {stage.name}（{stage.stageKey}{stage.funded ? "，冻款" : ""}）
                  </label>
                  {checked ? (
                    <div>
                      <label>金额（base units）<input value={term.amountBaseUnits} onChange={(event) => setTerms((current) => ({ ...current, [stage.stageKey]: { ...term, amountBaseUnits: event.target.value } }))} /></label>
                      <label>邀请截止<input value={term.inviteDeadline} onChange={(event) => setTerms((current) => ({ ...current, [stage.stageKey]: { ...term, inviteDeadline: event.target.value } }))} /></label>
                      <label>履约截止<input value={term.workDeadline} onChange={(event) => setTerms((current) => ({ ...current, [stage.stageKey]: { ...term, workDeadline: event.target.value } }))} /></label>
                      <p className="fineprint">
                        标准：{stage.defaultStandard?.name ?? "配置无默认标准"} {stage.defaultStandard?.hash ?? ""}
                        （用 fileResources 句柄 + 显式确认信号）
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          <fieldset>
            <legend>邀请（发起方熟悉的履约者/确认者，无撮合）</legend>
            {inviteRows().map((row) => {
              const key = `${row.stage.stageKey}/${row.slotKey}`;
              const value = invites[key] ?? { stageKey: row.stage.stageKey, slotKey: row.slotKey, subjectLabel: "" };
              return (
                <div key={key} className="panel">
                  <strong>{row.stage.stageKey} / {row.slotKey}（{stageRoleLabel(row.stage, row.slotKey)}）</strong>
                  <label>受邀方名称<input value={value.subjectLabel} onChange={(event) => setInvites((current) => ({ ...current, [key]: { ...value, subjectLabel: event.target.value } }))} /></label>
                  <label>联系方式引用<input value={value.contactRef ?? ""} onChange={(event) => setInvites((current) => ({ ...current, [key]: { ...value, contactRef: event.target.value } }))} /></label>
                  <label>绑定钱包（可选）<input value={value.wallet ?? ""} onChange={(event) => setInvites((current) => ({ ...current, [key]: { ...value, wallet: event.target.value } }))} /></label>
                </div>
              );
            })}
          </fieldset>

          <div className="submit-actions">
            <button className="primary-button" type="button" disabled={busy || draftId !== undefined} onClick={() => void createDraft()}>
              {draftId ? `草稿已创建：${draftId}` : "创建草稿并生成邀请"}
            </button>
          </div>

          {created ? (
            <section className="panel">
              <h3>邀请链接（一次性 token，仅本次显示）</h3>
              {created.invites.length === 0 ? <p>本单没有需要邀请的 slot。</p> : null}
              {created.invites.map((invite) => (
                <p key={invite.inviteId} className="fineprint">
                  {invite.stageKey}/{invite.slotKey}：<code>{invite.inviteUrl}</code>
                </p>
              ))}
            </section>
          ) : null}

          <section className="panel">
            <h3>本人确认（EIP-712）</h3>
            <button className="quiet-button" type="button" disabled={busy || draftId === undefined} onClick={() => void prepareFinalize()}>
              准备建单确认
            </button>
            {prepared && finalizeSummary ? (
              <div>
                <p className="fineprint">
                  plan {prepared.planId} / terms {prepared.termsHash}；冻款段 {prepared.fundedStageKeys.join(", ") || "无"}；
                  跳过段 {prepared.skippedStageKeys.join(", ") || "无"}；有效期至 {finalizeSummary.deadlineIso ?? prepared.deadline}
                </p>
                <p className="fineprint">签名者必须是发起方钱包 {finalizeSummary.buyer}；签名内容不可盲签，请在钱包内核对。</p>
                <button className="primary-button" type="button" disabled={busy} onClick={() => void signAndFinalize()}>
                  连接钱包并签名创建订单
                </button>
              </div>
            ) : null}
            {finalized ? (
              <section className="system-banner system-banner-info" role="status">
                <strong>建单结果：{finalized.status}</strong>
                <span>orderId {finalized.orderId}；planHash {finalized.planHash}</span>
                {finalized.status !== "confirmed"
                  ? <span>结果未确认：不要重复提交，稍后按 orderId 查询。</span>
                  : null}
              </section>
            ) : null}
          </section>
        </>
      ) : null}

      {failure ? <FailureView failure={failure} /> : null}
    </section>
  );
}

export function InvitePage(props: {
  readonly ports: Ports;
  readonly inviteId: string;
  readonly inviteToken?: string | undefined;
  readonly onAccepted: () => void;
  readonly onRejected: () => void;
  readonly onDismiss: () => void;
}) {
  const [preview, setPreview] = useState<StageInvitePreview | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (props.inviteToken === undefined) {
      setFailure({ kind: "invalid", message: "邀请链接缺少一次性令牌（inviteToken）。" });
      return;
    }
    void props.ports.previewInvite(props.inviteId, props.inviteToken).then((result) => {
      if (cancelled) {
        return;
      }
      const value = unwrap(result, setFailure);
      if (value) {
        setPreview(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.inviteId, props.inviteToken, props.ports]);

  const summary = preview ? summarizeInviteAcceptTypedData(preview.typedData) : undefined;

  async function accept(): Promise<void> {
    if (!preview || !summary || props.inviteToken === undefined) {
      return;
    }
    setBusy(true);
    try {
      const address = await requestWalletAddressKernel();
      verifyInviteAcceptTypedData(
        preview.typedData,
        { chainId: preview.chainId, verifyingContract: preview.stateMachineAddress },
        {
          inviteId: preview.invite.inviteId,
          invitee: address,
          termsHash: preview.termsHash,
          nonce: preview.signNonce,
          amount: preview.terms.amount,
          finalStandardHash: preview.terms.finalStandardHash
        }
      );
      if (summary.invitee.toLowerCase() !== address.toLowerCase()) {
        throw new SigningError("invalid_signature", `服务端预览的受邀钱包是 ${summary.invitee}，与当前钱包 ${address} 不一致。`);
      }
      const signature = await signTypedDataKernel(preview.typedData, address);
      const result = unwrap(await props.ports.acceptInvite(props.inviteId, {
        token: props.inviteToken,
        signature,
        termsHash: preview.termsHash,
        nonce: preview.signNonce
      }), setFailure);
      if (result) {
        setAccepted(true);
        props.onAccepted();
      }
    } catch (error) {
      setFailure({
        kind: "invalid",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof SigningError ? { code: error.code } : {})
      });
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (props.inviteToken === undefined) {
      return;
    }
    setBusy(true);
    const result = unwrap(await props.ports.rejectInvite(props.inviteId, props.inviteToken), setFailure);
    setBusy(false);
    if (result) {
      props.onRejected();
    }
  }

  return (
    <section className="panel" aria-label="邀请">
      <header className="section-head">
        <h2>邀请：{preview?.title ?? props.inviteId}</h2>
        <button className="quiet-button" type="button" onClick={props.onDismiss}>返回</button>
      </header>
      {accepted ? (
        <section className="system-banner system-banner-info" role="status">
          <strong>已接受邀请</strong>
          <span>本段 slot 绑定已落档；后续按订单阶段执行。</span>
        </section>
      ) : null}
      {preview && summary ? (
        <>
          <p className="fineprint">
            阶段 {preview.terms.stageKey}；金额 {preview.terms.amount}（base units）；
            履约截止 {preview.terms.workDeadline}；标准 {preview.terms.standard?.name ?? "未声明"}
          </p>
          <section className="panel">
            <h3>你即将签名的内容（EIP-712 UVPOrderBook/1）</h3>
            <ul>
              <li>draftId：{summary.draftId}</li>
              <li>inviteId：{summary.inviteId}；slot：{summary.slotKey}</li>
              <li>termsHash：{summary.termsHash}</li>
              <li>签名者（invitee）：{summary.invitee}</li>
              <li>期限：{summary.deadlineIso ?? summary.deadlineUnix}</li>
            </ul>
            <p className="fineprint">签名只绑定本阶段条款；不接受可在下方拒绝。</p>
            <div className="submit-actions">
              <button className="primary-button" type="button" disabled={busy} onClick={() => void accept()}>
                连接钱包并签名接受
              </button>
              <button className="quiet-button" type="button" disabled={busy} onClick={() => void reject()}>
                拒绝邀请
              </button>
            </div>
          </section>
        </>
      ) : null}
      {failure ? <FailureView failure={failure} /> : null}
    </section>
  );
}

export function OrderRoomPage(props: {
  readonly ports: Ports;
  readonly orderId?: string | undefined;
  readonly onBack: () => void;
}) {
  const [orderId, setOrderId] = useState(props.orderId ?? "");
  const [order, setOrder] = useState<OrderView | undefined>(undefined);
  const [stageKey, setStageKey] = useState<string | undefined>(undefined);
  const [stage, setStage] = useState<StageViewResponse | undefined>(undefined);
  const [tasks, setTasks] = useState<TaskListView | undefined>(undefined);
  const [resources, setResources] = useState<readonly string[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function loadOrder(id: string): Promise<void> {
    setBusy(true);
    const value = unwrap(await props.ports.getOrder(id), setFailure);
    setBusy(false);
    if (!value) {
      setOrder(undefined);
      return;
    }
    setOrder(value);
    const firstStage = value.stages[0]?.stageKey;
    if (firstStage !== undefined) {
      await selectStage(id, firstStage);
    }
  }

  async function selectStage(id: string, key: string): Promise<void> {
    setStageKey(key);
    const detail = unwrap(await props.ports.getStage(id, key), setFailure);
    setStage(detail ?? undefined);
    const taskList = unwrap(await props.ports.listTasks(id), setFailure);
    setTasks(taskList ?? undefined);
    const handleList = unwrap(await props.ports.listStageResources(id, key), setFailure);
    setResources(handleList?.items.map((item) => `${item.handleKey}${item.version ? `@${item.version}` : ""}${item.hash ? ` ${item.hash.slice(0, 10)}…` : ""}`) ?? undefined);
  }

  return (
    <section className="panel" aria-label="订单房间">
      <header className="section-head">
        <h2>订单房间</h2>
        <button className="quiet-button" type="button" onClick={props.onBack}>返回</button>
      </header>
      <fieldset>
        <legend>订单</legend>
        <label>orderId <input value={orderId} onChange={(event) => setOrderId(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy || orderId.trim().length === 0} onClick={() => void loadOrder(orderId.trim())}>
          读取订单
        </button>
        <p className="fineprint">服务端没有订单目录接口；从开单结果/邀请记录里拿 orderId。可见性由服务端按 scope 裁剪。</p>
      </fieldset>

      {order ? (
        <>
          <p className="fineprint">
            {order.title ?? "（标题按 scope 裁剪）"}；status {order.status ?? "未返回"}；planId {order.planId ?? "未返回"}；
            可见阶段 {order.stages.length} 个
          </p>
          <nav className="section-tabs">
            {order.stages.map((item) => (
              <button
                key={item.stageKey}
                type="button"
                className={`section-tab ${stageKey === item.stageKey ? "is-active" : ""}`}
                onClick={() => void selectStage(order.orderId, item.stageKey)}
              >
                {item.stageKey}
              </button>
            ))}
          </nav>
          {stage ? (
            <section className="panel">
              <h3>阶段 {stage.stage.stageKey}</h3>
              <p className="fineprint">
                status {stage.stage.status}；金额 {stage.stage.amount ?? "按 scope 不可见"}；
                标准 {stage.stage.standard?.name ?? "未返回"}
              </p>
              <p className="fineprint">dataState：{stage.dataState}</p>
            </section>
          ) : null}
          <section className="panel">
            <h3>本单任务（服务端投影）</h3>
            {tasks === undefined ? <p>未读取。</p> : null}
            {tasks?.dataState === "none" ? <p>没有任务。</p> : null}
            {tasks?.dataState === "pending" ? <p>投影未就绪（pending），不是“没有任务”。</p> : null}
            <ul>
              {tasks?.items.map((task) => (
                <li key={task.taskId}>
                  {task.stageKey}/{task.slotKey} · {task.kind} · {task.status} · {task.nextAction}
                  {task.dueAt ? `（截止 ${task.dueAt}）` : ""}
                </li>
              ))}
            </ul>
            <p className="fineprint">TODO：{TODOS.taskSubmit}</p>
          </section>
          <section className="panel">
            <h3>阶段标准句柄（fileResources）</h3>
            {resources === undefined ? <p>未读取。</p> : resources.length === 0 ? <p>该阶段没有声明句柄。</p> : (
              <ul>{resources.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
            <p className="fineprint">TODO：{TODOS.evidenceSubmit}</p>
          </section>
        </>
      ) : null}
      {failure ? <FailureView failure={failure} /> : null}
    </section>
  );
}
