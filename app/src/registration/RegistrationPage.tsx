/**
 * 注册页：实体注册表单（写路径未就绪时显式不可提交）、钱包归属签名证明、
 * 身份背书事实展示。数据只来自 registration/client 的类型化通路；页面不
 * 对身份作可信度评价，也不把"读取失败"显示成"没有记录"。
 */
import { AlertCircle, FileCheck2, Fingerprint, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { entityRegistrationBlocker } from "./blockers";
import {
  createRegistrationClient,
  isRegistrationApiError,
  type RegistrationClient,
} from "./client";
import { validateEntityRegistrationDraft } from "./form";
import type {
  AccountAddressesDTO,
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  IdentityBindingDTO,
  IdentityDescriptorSnapshotDTO,
} from "./types";
import "./registration.css";

export interface RegistrationSessionTokenSource {
  currentSessionToken(): string | undefined;
}

/** 与 OrderAppActions 结构兼容：宿主可直接把 createOrderAppActions(api) 传进来。 */
export interface RegistrationWalletLogin {
  hasInjectedWallet(): boolean;
  requestWalletAddress(): Promise<string>;
  proveWalletControl(input: { readonly address: string }): Promise<{
    readonly sessionToken: string;
    readonly anchoredAddress: string;
  }>;
}

export interface RegistrationPageProps {
  /** 缺省按 VITE_UVP_CHAIN_SERVICES_URL 自建 client；宿主可注入以便测试或复用。 */
  readonly client?: RegistrationClient | undefined;
  /** 现有钱包会话 token 取值器（宿主通常传 { currentSessionToken: () => api.currentSessionToken() }）。 */
  readonly session?: RegistrationSessionTokenSource | undefined;
  /** 现有钱包登录动作（宿主通常直接传 createOrderAppActions(api)）。 */
  readonly wallet?: RegistrationWalletLogin | undefined;
  /** 初始查询地址（宿主可传参与者会话钱包）。 */
  readonly initialAddress?: string | undefined;
  readonly onBack?: (() => void) | undefined;
}

interface RegistrationClientState {
  readonly client?: RegistrationClient | undefined;
  readonly message?: string | undefined;
}

type AccountAddressesState =
  | { readonly status: "loading" }
  | { readonly status: "signed_out" }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "ready"; readonly data: AccountAddressesDTO }
  | { readonly status: "error"; readonly message: string };

type IdentityFactsState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly address: string }
  | {
      readonly status: "ready";
      readonly address: string;
      readonly bindings: readonly IdentityBindingDTO[];
      readonly loadedAt: string;
    }
  | { readonly status: "error"; readonly address: string; readonly message: string };

type DescriptorState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: IdentityDescriptorSnapshotDTO }
  | { readonly status: "error"; readonly message: string };

type EntitySubmitState = { readonly status: "idle" } | { readonly status: "blocked"; readonly at: string };

const emptyDraft: EntityRegistrationDraft = {
  entityName: "",
  registrationNumber: "",
  contactName: "",
};

export function RegistrationPage(props: RegistrationPageProps) {
  const sessionProvided = props.session !== undefined;
  const clientState = useMemo<RegistrationClientState>(() => {
    if (props.client) {
      return { client: props.client };
    }
    try {
      return {
        client: createRegistrationClient(
          sessionProvided ? { getSessionToken: () => props.session?.currentSessionToken() } : {},
        ),
      };
    } catch (error) {
      return { message: error instanceof Error ? error.message : "参与者服务地址未配置。" };
    }
  }, [props.client, sessionProvided]);

  const [draft, setDraft] = useState<EntityRegistrationDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<EntityRegistrationErrors>({});
  const [entitySubmitState, setEntitySubmitState] = useState<EntitySubmitState>({ status: "idle" });

  const [factsAddress, setFactsAddress] = useState((props.initialAddress ?? "").trim());
  const [factsState, setFactsState] = useState<IdentityFactsState>({ status: "idle" });
  const factsSequence = useRef(0);
  const [descriptorStates, setDescriptorStates] = useState<Readonly<Record<string, DescriptorState>>>({});

  const [accountState, setAccountState] = useState<AccountAddressesState>({ status: "loading" });
  const [sessionVersion, setSessionVersion] = useState(0);
  const [walletInput, setWalletInput] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | undefined>(undefined);
  const [walletNotice, setWalletNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    const client = clientState.client;
    if (!client) {
      setAccountState({ status: "unavailable", message: clientState.message ?? "参与者服务未配置。" });
      return undefined;
    }
    if (sessionProvided && !props.session?.currentSessionToken()) {
      setAccountState({ status: "signed_out" });
      return undefined;
    }
    let active = true;
    setAccountState({ status: "loading" });
    void client.loadAccountAddresses()
      .then((data) => {
        if (active) {
          setAccountState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (isRegistrationApiError(error) && (error.status === 401 || error.errorCode === "store_session_required")) {
          setAccountState({ status: "signed_out" });
          return;
        }
        setAccountState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [clientState.client, clientState.message, sessionProvided, sessionVersion]);

  useEffect(() => {
    const address = (props.initialAddress ?? "").trim();
    if (!clientState.client || !isEvmWalletAddress(address)) {
      return;
    }
    runFactsQuery(address);
    // runFactsQuery 是事件与初始查询共用的入口，序列号在函数内防旧响应覆盖。
  }, [clientState.client, props.initialAddress]);

  function runFactsQuery(rawAddress: string): void {
    const address = rawAddress.trim();
    setFactsAddress(address);
    const client = clientState.client;
    const sequence = factsSequence.current + 1;
    factsSequence.current = sequence;
    if (!client) {
      setFactsState({ status: "error", address, message: clientState.message ?? "参与者服务未配置。" });
      return;
    }
    if (!isEvmWalletAddress(address)) {
      setFactsState({ status: "error", address, message: "请填写 0x 开头的 42 位钱包地址后再查询。" });
      return;
    }
    setFactsState({ status: "loading", address });
    void client.loadIdentityBindings({ account: address, activeOnly: false })
      .then((bindings) => {
        if (factsSequence.current !== sequence) {
          return;
        }
        setFactsState({ status: "ready", address, bindings, loadedAt: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        if (factsSequence.current !== sequence) {
          return;
        }
        setFactsState({ status: "error", address, message: errorMessage(error) });
      });
  }

  function loadDescriptor(binding: IdentityBindingDTO): void {
    const client = clientState.client;
    if (!client) {
      return;
    }
    setDescriptorStates((current) => ({ ...current, [binding.bindingId]: { status: "loading" } }));
    void client.loadIdentityDescriptor(binding.subjectId, binding.descriptorHash)
      .then((snapshot) => {
        setDescriptorStates((current) => ({ ...current, [binding.bindingId]: { status: "ready", snapshot } }));
      })
      .catch((error: unknown) => {
        setDescriptorStates((current) => ({
          ...current,
          [binding.bindingId]: { status: "error", message: descriptorFailureCopy(error) },
        }));
      });
  }

  function handleEntitySubmit(): void {
    const validation = validateEntityRegistrationDraft(draft);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setEntitySubmitState({ status: "idle" });
      return;
    }
    setFieldErrors({});
    setEntitySubmitState({ status: "blocked", at: new Date().toISOString() });
  }

  async function handleWalletLogin(): Promise<void> {
    const wallet = props.wallet;
    if (walletBusy) {
      return;
    }
    if (!wallet) {
      setWalletError("当前页面未注入钱包登录接线：请先在待办页完成钱包登录。");
      return;
    }
    setWalletBusy(true);
    setWalletError(undefined);
    setWalletNotice(undefined);
    try {
      const address = await wallet.requestWalletAddress();
      await wallet.proveWalletControl({ address });
      setWalletInput((current) => current || address);
      setFactsAddress((current) => current || address);
      setSessionVersion((version) => version + 1);
      setWalletNotice(`钱包会话已建立：${address}。`);
      runFactsQuery(address);
    } catch (error) {
      setWalletError(walletFailureCopy(error));
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleWalletAddressFromBrowser(): Promise<void> {
    const wallet = props.wallet;
    if (!wallet || walletBusy) {
      return;
    }
    setWalletBusy(true);
    setWalletError(undefined);
    try {
      setWalletInput((await wallet.requestWalletAddress()).trim());
    } catch (error) {
      setWalletError(walletFailureCopy(error));
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleBindWallet(): Promise<void> {
    const client = clientState.client;
    if (!client || walletBusy) {
      return;
    }
    setWalletBusy(true);
    setWalletError(undefined);
    setWalletNotice(undefined);
    try {
      let address = walletInput.trim();
      if (!isEvmWalletAddress(address) && props.wallet?.hasInjectedWallet()) {
        address = (await props.wallet.requestWalletAddress()).trim();
        setWalletInput(address);
      }
      if (!isEvmWalletAddress(address)) {
        throw new Error("请填写 0x 开头的 42 位钱包地址，或先从浏览器钱包读取当前地址。");
      }
      const result = await client.bindWalletAddress({ address });
      setWalletNotice(`地址 ${result.anchoredAddress} 已记入会话账号 ${result.accountId} 的地址清单。`);
      setAccountState({ status: "ready", data: { accountId: result.accountId, addresses: result.addresses } });
      setSessionVersion((version) => version + 1);
    } catch (error) {
      setWalletError(walletFailureCopy(error));
    } finally {
      setWalletBusy(false);
    }
  }

  const entityCard = (
    <section className="registration-card" aria-labelledby="entity-registration-title">
      <div className="registration-card-heading">
        <FileCheck2 aria-hidden="true" />
        <div>
          <h3 id="entity-registration-title">实体注册</h3>
          <p>企业名称、注册号、联系人。</p>
        </div>
      </div>
      <section className="system-banner system-banner-warn" role="status">
        <strong>{entityRegistrationBlocker.headline}</strong>
        <span>{entityRegistrationBlocker.summary}</span>
      </section>
      <div className="registration-fields">
        <label className="registration-field">
          <span>企业名称</span>
          <input
            value={draft.entityName}
            onChange={(event) => setDraft((current) => ({ ...current, entityName: event.target.value }))}
            aria-invalid={fieldErrors.entityName ? "true" : undefined}
            autoComplete="organization"
          />
          {fieldErrors.entityName ? <small className="registration-field-error" role="alert">{fieldErrors.entityName}</small> : null}
        </label>
        <label className="registration-field">
          <span>注册号</span>
          <input
            value={draft.registrationNumber}
            onChange={(event) => setDraft((current) => ({ ...current, registrationNumber: event.target.value }))}
            aria-invalid={fieldErrors.registrationNumber ? "true" : undefined}
          />
          {fieldErrors.registrationNumber ? (
            <small className="registration-field-error" role="alert">{fieldErrors.registrationNumber}</small>
          ) : (
            <small className="registration-field-hint">服务端尚无注册号格式契约，本页不预设格式规则。</small>
          )}
        </label>
        <label className="registration-field">
          <span>联系人</span>
          <input
            value={draft.contactName}
            onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))}
            aria-invalid={fieldErrors.contactName ? "true" : undefined}
            autoComplete="name"
          />
          {fieldErrors.contactName ? <small className="registration-field-error" role="alert">{fieldErrors.contactName}</small> : null}
        </label>
      </div>
      <div className="registration-actions">
        <button className="primary-button" type="button" onClick={handleEntitySubmit}>提交注册</button>
      </div>
      {entitySubmitState.status === "blocked" ? (
        <div className="blocked-copy" role="alert">
          <strong>未提交：本次没有发送任何请求。</strong>
          <p>{entityRegistrationBlocker.summary}</p>
          <details className="registration-technical">
            <summary>已核对的写路径（为什么不可提交）</summary>
            <ul>
              {entityRegistrationBlocker.checkedPaths.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            <p>{entityRegistrationBlocker.unblockCondition}</p>
          </details>
          <p className="registration-hint">表单内容只保留在本页内存中，刷新即丢弃。</p>
        </div>
      ) : null}
    </section>
  );

  const walletCard = (
    <section className="registration-card" aria-labelledby="wallet-binding-title">
      <div className="registration-card-heading">
        <WalletCards aria-hidden="true" />
        <div>
          <h3 id="wallet-binding-title">钱包归属签名证明</h3>
          <p>用钱包签名证明地址归本人控制，并把地址记入当前钱包会话账号。</p>
        </div>
      </div>

      {accountState.status === "loading" ? <p className="muted-copy" aria-busy="true">正在读取当前会话的地址清单…</p> : null}
      {accountState.status === "signed_out" ? (
        <div className="registration-session">
          <p className="muted-copy">当前浏览器没有可用的钱包会话。</p>
          {props.wallet ? (
            <button className="primary-button" type="button" disabled={walletBusy} onClick={() => void handleWalletLogin()}>
              {walletBusy ? "等待钱包签名…" : "连接钱包并登录会话"}
            </button>
          ) : (
            <p className="muted-copy">宿主未注入钱包登录接线：请先在待办页完成钱包登录。</p>
          )}
        </div>
      ) : null}
      {accountState.status === "unavailable" ? <p className="muted-copy">{accountState.message}</p> : null}
      {accountState.status === "error" ? (
        <p className="blocked-copy" role="alert">{accountState.message}</p>
      ) : null}
      {accountState.status === "ready" ? (
        <>
          <dl className="registration-facts">
            <Fact label="会话账号" value={accountState.data.accountId} mono />
            <Fact label="地址数" value={String(accountState.data.addresses.length)} />
          </dl>
          {accountState.data.addresses.length === 0 ? (
            <p className="muted-copy">该会话账号还没有记录地址。</p>
          ) : (
            <ul className="registration-address-list">
              {accountState.data.addresses.map((entry) => (
                <li key={entry.address}>
                  <code>{entry.address}</code>
                  <span className={entry.status === "active" ? "registration-chip registration-chip-active" : "registration-chip"}>
                    {entry.status === "active" ? "在册" : "已撤销"}
                  </span>
                  <small>{formatTimestamp(entry.anchoredAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <div className="registration-fields">
        <label className="registration-field">
          <span>要绑定的钱包地址</span>
          <input
            value={walletInput}
            onChange={(event) => setWalletInput(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
          <small className="registration-field-hint">
            签名只证明该地址的控制权；服务端把地址记入会话账号的地址清单，不评价身份可信度。
          </small>
        </label>
      </div>
      <div className="registration-actions">
        {props.wallet?.hasInjectedWallet() ? (
          <button className="quiet-button" type="button" disabled={walletBusy} onClick={() => void handleWalletAddressFromBrowser()}>
            读取浏览器钱包地址
          </button>
        ) : null}
        <button className="primary-button" type="button" disabled={walletBusy} onClick={() => void handleBindWallet()}>
          {walletBusy ? "等待钱包签名…" : "签名并绑定该地址"}
        </button>
      </div>
      {walletNotice ? <p className="notice-line" role="status">{walletNotice}</p> : null}
      {walletError ? <p className="blocked-copy" role="alert">{walletError}</p> : null}
    </section>
  );

  const identityCard = (
    <section className="registration-card" aria-labelledby="identity-facts-title">
      <div className="registration-card-heading">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h3 id="identity-facts-title">身份背书事实</h3>
          <p>只读展示链上身份背书记录与登记档案原文；页面不做可信度评价，也不推断缺失。</p>
        </div>
      </div>
      <form
        className="registration-query"
        onSubmit={(event) => {
          event.preventDefault();
          runFactsQuery(factsAddress);
        }}
      >
        <label className="registration-field">
          <span>查询钱包地址</span>
          <input
            value={factsAddress}
            onChange={(event) => setFactsAddress(event.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="primary-button" type="submit" disabled={factsState.status === "loading"}>
          {factsState.status === "loading" ? "正在读取…" : "查询背书"}
        </button>
      </form>

      {factsState.status === "idle" ? <p className="muted-copy">输入钱包地址后查询该地址的身份背书事实。</p> : null}

      {factsState.status === "loading" ? <p className="muted-copy" aria-busy="true">正在读取身份背书事实…</p> : null}

      {factsState.status === "error" ? (
        <div className="blocked-copy" role="alert">
          <strong>身份背书事实读取失败</strong>
          <p>{factsState.message}</p>
          <p>读取失败不等于没有背书记录；请核对服务后重试。</p>
          <button className="quiet-button" type="button" onClick={() => runFactsQuery(factsState.address)}>
            <RefreshCw aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}

      {factsState.status === "ready" ? (
        <>
          <p className="registration-hint">
            查询地址 {shortValue(factsState.address)} · 查询时间 {formatTimestamp(factsState.loadedAt)} · 记录 {factsState.bindings.length} 条
          </p>
          {factsState.bindings.length === 0 ? (
            <p className="notice-line">该地址当前没有身份背书。</p>
          ) : (
            <ul className="registration-bindings">
              {factsState.bindings.map((binding) => {
                const descriptorEntry = descriptorStates[binding.bindingId];
                return (
                  <li className="registration-binding" key={binding.bindingId}>
                    <div className="registration-binding-head">
                      <span
                        className={
                          binding.status === "active"
                            ? "registration-chip registration-chip-active"
                            : "registration-chip"
                        }
                      >
                        {bindingStatusLabel(binding.status)}
                      </span>
                      <code>{shortValue(binding.bindingId)}</code>
                    </div>
                    <dl className="registration-facts">
                      <Fact label="身份主体" value={binding.subjectId} mono />
                      <Fact label="背书钱包" value={binding.account} mono />
                      <Fact label="登记方" value={binding.registrar} mono />
                    </dl>
                    <details className="registration-technical">
                      <summary>链上来源与证明字段</summary>
                      <dl className="registration-facts">
                        <Fact label="登记合约" value={binding.registryAddress} mono />
                        <Fact label="背书编号" value={binding.bindingId} mono />
                        <Fact label="档案哈希" value={binding.descriptorHash} mono />
                        <Fact label="档案 URI" value={binding.descriptorURI || "(无)"} mono />
                        <Fact label="登记交易" value={binding.registeredAt.transactionHash} mono />
                        <Fact label="登记指针" value={pointerSummary(binding.registeredAt)} />
                        <Fact label="更新时间" value={pointerSummary(binding.updatedAt)} />
                        {binding.revokedAt ? <Fact label="撤销时间" value={pointerSummary(binding.revokedAt)} /> : null}
                        {binding.revokeReasonHash ? <Fact label="撤销原因哈希" value={binding.revokeReasonHash} mono /> : null}
                        {binding.revokeReasonURI ? <Fact label="撤销原因 URI" value={binding.revokeReasonURI} mono /> : null}
                      </dl>
                    </details>
                    <div className="registration-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={descriptorEntry?.status === "loading"}
                        onClick={() => loadDescriptor(binding)}
                      >
                        {descriptorEntry?.status === "loading" ? "正在读取登记档案…" : "查看登记档案"}
                      </button>
                    </div>
                    {descriptorEntry ? (
                      descriptorEntry.status === "loading" ? (
                        <p className="muted-copy">正在读取登记档案…</p>
                      ) : descriptorEntry.status === "error" ? (
                        <p className="blocked-copy" role="alert">登记档案读取失败：{descriptorEntry.message}</p>
                      ) : (
                        <div className="registration-descriptor">
                          <dl className="registration-facts">
                            <Fact
                              label="档案哈希校验"
                              value={
                                descriptorEntry.snapshot.verification.matches
                                  ? "重算哈希与登记哈希一致"
                                  : "重算哈希与登记哈希不一致"
                              }
                            />
                            <Fact label="档案来源" value={descriptorEntry.snapshot.source || "(未标注)"} />
                            <Fact label="档案录入时间" value={formatTimestamp(descriptorEntry.snapshot.createdAt)} />
                          </dl>
                          <details className="registration-technical">
                            <summary>登记档案原文</summary>
                            <pre>{prettyJson(descriptorEntry.snapshot.descriptorJson)}</pre>
                          </details>
                        </div>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );

  return (
    <section className="registration-page" aria-labelledby="registration-title">
      <div className="registration-heading">
        <div className="registration-heading-title">
          <Fingerprint aria-hidden="true" />
          <div>
            <h2 id="registration-title">注册与身份</h2>
            <p>登记实体信息、用钱包签名证明地址归属，并查看身份背书事实。</p>
          </div>
        </div>
        {props.onBack ? (
          <button className="quiet-button" type="button" onClick={props.onBack}>返回待办</button>
        ) : null}
      </div>

      {clientState.message ? (
        <section className="system-banner system-banner-error" role="alert">
          <AlertCircle aria-hidden="true" />
          <strong>参与者服务未配置</strong>
          <span>{clientState.message}</span>
        </section>
      ) : null}

      <div className="registration-grid">
        <div className="registration-column">
          {entityCard}
          {walletCard}
        </div>
        <div className="registration-column">{identityCard}</div>
      </div>
    </section>
  );
}

function Fact({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "registration-mono" : undefined}>{value}</dd>
    </div>
  );
}

function bindingStatusLabel(status: IdentityBindingDTO["status"]): string {
  return status === "active" ? "背书有效" : "背书已撤销";
}

function pointerSummary(pointer: { readonly chainId: number; readonly blockNumber: string; readonly logIndex: number }): string {
  return `链 ${pointer.chainId} · 区块 ${pointer.blockNumber} · 序号 ${pointer.logIndex}`;
}

function isEvmWalletAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/u.test(value.trim());
}

function shortValue(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json) as unknown, null, 2);
  } catch {
    return json;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "请求失败，未获得服务端响应。";
}

function descriptorFailureCopy(error: unknown): string {
  if (isRegistrationApiError(error) && error.errorCode === "descriptor_snapshot_not_found") {
    return "服务端没有该登记哈希对应的档案快照：这不等于档案为空，只表示快照不在托管存储里。";
  }
  return errorMessage(error);
}

function walletFailureCopy(error: unknown): string {
  if (isRegistrationApiError(error)) {
    switch (error.errorCode) {
      case "store_session_required":
        return "需要钱包会话：请先完成钱包登录，再绑定地址。";
      case "store_challenge_rate_limited":
        return "挑战签发过于频繁，请稍后再试。";
      case "store_address_already_anchored":
        return "该地址已记入另一个会话账号的地址清单，不能重复绑定。";
      case "store_account_mismatch":
        return "钱包会话与挑战账号不一致，请重新登录后再试。";
      case "store_challenge_signature_invalid":
        return "签名未通过服务端校验：地址归属未绑定，本次没有落任何记录。";
      case "store_session_unavailable":
        return `钱包会话服务暂不可用：${error.message}`;
      default:
        return error.message;
    }
  }
  return errorMessage(error);
}
