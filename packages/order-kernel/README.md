# @uvp-eth/order-kernel

通用 headless 订单内核（public 包）。只放可跨宿主复用的能力：

- Product API transport 与传输 DTO 类型（订单、任务、证据、要求包、邀请、开单草稿、装修读面）；
- 参与者会话的纯读模型；
- 装修/截止时间等纯展示派生；
- EIP-1193 provider / EIP-712 签名类型与钱包错误类型。

不含 React 组件、CSS、路由、页面，也不含行业/宿主专用文案。构建期 env 与
浏览器 `localStorage` 由宿主通过参数注入；kernel 本身不读 `import.meta.env`。

## 出口

```ts
import {
  createProductApiClient,
  type ProductApiClient,
  type ProductApiClientOptions
} from "@uvp-eth/order-kernel/product";


import { readParticipantSession } from "@uvp-eth/order-kernel/session/participant";
import type { Eip1193Provider } from "@uvp-eth/order-kernel/wallet/provider";
```

`exports` 同时提供根入口 `@uvp-eth/order-kernel` 和上述子路径。

## Product V3（订单域客户端）

`@uvp-eth/order-kernel/product/v3` 对齐 chain-services 的 `/product/v3` 路由（配置注册、
订单草稿、slot 邀请、EIP-712 接受、finalize、订单/阶段读）。身份只经
`x-uvp-store-session` 传递；DTO 单源是 `@uvp-eth/product-dto`，签名类型单源是
`@uvp-eth/protocol-bindings`。

**订单复用同一已发布 plan**：UVP plan 在配置版本发布时编译/注册（`planId`/`planHash`），
同一配置版本的所有订单都用它。时间窗口只归凝结核配置（plan 生成时的字面量），订单不提交窗口字段。

```ts
import {
  createProductV3Client,
  flattenConfigVersion,
  buildCreateOrderDraftInput,
  verifyInviteAcceptTypedData,
  summarizeInviteAcceptTypedData
} from "@uvp-eth/order-kernel/product/v3";

const client = createProductV3Client({
  baseUrl: "/product",              // 同源反代；或服务绝对地址
  getSessionToken: () => session.currentSessionToken()
});
```

### API surface

| 函数 | 服务端端点 |
| --- | --- |
| `publishConfig({config, status?, configHash?, planId?, planHash?})` | `POST /product/v3/configs`（planId/planHash 成对登记） |
| `publishConfigVersion` / `deprecateConfig` | `POST /configs/:configId/:version/{publish,deprecate}` |
| `getConfig(configId, version, {viaVersionsAlias})` | `GET /configs/:configId/:version` 或 `.../versions/:version` |
| `createOrderDraft` / `getOrderDraft` / `updateOrderDraft` | `POST|GET|PATCH /order-drafts[/:draftId]`（写请求支持 `Idempotency-Key`） |
| `createInvite` | `POST /order-drafts/:draftId/invites`（响应含一次性 `inviteToken`） |
| `previewInvite` / `acceptInvite` / `rejectInvite` / `revokeInvite` | `POST /invites/:inviteId/{preview,accept,reject,revoke}` |
| `prepareFinalize` / `finalizeWithSignature` | `POST /order-drafts/:draftId/finalize/prepare` → `POST .../finalize`（buyer 的 UVPOrderFinalize 签名） |
| `getOrder` / `getOrderStage` | `GET /orders/:orderId[/stages/:stageKey]` |

错误统一为 `ProductV3Error`：`status` + `kind`（`unauthorized/forbidden/not_found/conflict/
gone/invalid_terms/unavailable/timeout/invalid_response/transport/...`）+ 服务端短码
`errorCode`/`details`。`isWalletIdentityRequiredV3` 用于 401 切会话登录；超时是「结果未知」，
不得自动重发。finalize 的计划绑定失败会原样透出：409 `published_plan_missing`
（配置版本没登记 plan，`kind:"conflict"`，重试无用）、503 `published_plan_unavailable`
（plan 查询失败，`kind:"unavailable"`，可重试）、503 `published_plan_invalid`（返回的
planId/planHash 非 canonical）。

### 配置摊平（`flattenConfigVersion`）

服务端只返回 `ConfigVersionV3.bundle`；kernel 按服务端 `canonical.ts` 同口径派生：

- `slots`/`requiredSlotKeys`：从配置 `stage.slots`（slotKey → 展示标签）派生；
  订单按该集合邀请，没有 payer/payee/verifier 默认或特例。
- `standards`：stage `fileResources` 句柄 + `bundle.fileResources`/`bundle.hashes` 解析，
  `resolvable` 只认 `0x<32B>` 或 `sha256:<64hex>`（服务端 `normalizeFinalStandardHash` 同口径）。
- `tokenDecimals`：按 `currency` 查内置表（USDT/USDC=6、DAI/WETH/ETH=18）或显式覆写；
  **未知币种返回 `tokenDecimalsSource:"unknown"` + `tokenDecimalsProblem`，不猜 6 位**。
- `stageId`：只能通过 `options.stageIds`（来自草稿/订单读面）带入；kernel 不自算 keccak。
- `planId`/`planHash`：配置版本发布时登记的 UVP plan，原样带出；缺失即表示该版本不能
  用于 finalize（服务端会 409 `published_plan_missing`）。

### 开单草稿映射（`buildCreateOrderDraftInput`）

宿主形状 `StageSelectionV3 {stageKey, amountBaseUnits, inviteDeadline, workDeadline,
standardRef?, slots?}` 映射到服务端 `StageTermsInputV3`：

| 宿主字段 | 服务端字段 | 说明 |
| --- | --- | --- |
| `amountBaseUnits` | `amount` | 服务端 `normalizeAmount` 同口径：`0` 或非零开头十进制，≤78 位 |
| `inviteDeadline` / `workDeadline` | 同名 | 服务端必填；kernel 不替买家默认；`work > invite` |
| `standardRef` | `standard` | 缺省用配置可解析默认标准；配置无 hash 时要求显式提供 |
| `slots` | `slots` | 可选透传本段 slot 值 |
| `stageSubset` | `stageSubset` | 缺省按 stages 顺序派生；显式给出必须一一对应 |

失败返回 `{ok:false, problem:{code,message,detail?}}`（`missing_invite_deadline`、
`standard_hash_missing`、`stage_subset_mismatch`…），
不做「尽力而为」的强制转换。

**窗口不是订单权利**：`StageSelectionV3` 没有窗口字段；订单只提交金额/验收方式/期限/标准。

### 邀请接受 EIP-712

域 `UVPOrderBook/1`、`verifyingContract` = 草稿的 UVPStateMachine 锚、
`primaryType` = `UVPStageInviteAccept`；字段/type hash 全部来自
`@uvp-eth/protocol-bindings`（kernel 不重复定义）。

- `verifyInviteAcceptTypedData(typedData, {chainId, verifyingContract}, facts?)`
  ——结构由 protocol-bindings 校验，kernel 补「域四要素对得上本次订单」与
  「message 里的条款与已知值一致」；错误码 `domain_chain_id /
  domain_verifying_contract / fact_mismatch / invalid_typed_data`。
- `summarizeInviteAcceptTypedData(typedData, {tokenDecimals?})` —— 供宿主渲染：
  金额（给 decimals 才格式化）、
  `termsHash`/`finalStandardHash`、期限 ISO、`signerField:"invitee"`。
- `buildInviteAcceptTypedDataFromPreview(preview, invitee)` —— 从服务端预览重建并核对
  自洽（服务端 `preview.typedData` 仍是权威来源）。

### 与服务端的已知差异

- 服务端**没有** `GET /product/v3/configs` 目录列表；宿主只能按 `configId+version` 读。
- `finalize` 只绑定配置版本已登记的 plan（不再按订单生成 plan、不再接收订单窗口值）；
  缺 plan / 查询失败 / plan 非 canonical 分别 409 `published_plan_missing`、503
  `published_plan_unavailable`、503 `published_plan_invalid`，kernel 原样透出。
- 发布配置时 `planId`/`planHash` 必须成对出现（服务端 422 `invalid_request`）。
- 配置发布/草稿/邀请都需要已锚定的钱包会话（含 `previewInvite`）；kernel 只传
  `x-uvp-store-session`，会话建立仍由现有 `proveWalletControl` 负责。
