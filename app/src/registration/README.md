# registration 模块（rough）

order app 的注册模块：实体自助登记（链下档案、明确未核验）、钱包归属签名
证明、身份背书事实展示。本目录之外的文件（含 `App.tsx`）由 Lead 接线时
修改；本模块只导出 `RegistrationPage` 与类型化 client。

## 1. 交付物

| 文件 | 内容 |
| --- | --- |
| `RegistrationPage.tsx` | `RegistrationPage`：实体自助登记表单（真实提交、成功/未登录/服务端失败/网络失败四态）、钱包归属签名证明、身份背书事实展示 |
| `client.ts` | `RegistrationClient` / `createRegistrationClient`：身份背书与登记档案只读 + 钱包会话地址锚定写 + 实体自助登记读写；`RegistrationApiError` 错误分类 |
| `types.ts` | 服务端响应 DTO 的只读镜像（形态单源在 chain-services，见 §2） |
| `blockers.ts` | 实体注册写路径现状（`entityRegistrationReadiness`）：可自助提交、未核验、A 层边界；页面与本文共用 |
| `form.ts` | 表单本地校验（必填与长度上限，与服务端同口径；无注册号格式契约可依） |
| `registration.css` | 本页样式（复用 app 的 CSS token 与通用按钮/横幅类） |
| `index.ts` | 对外导出 |

## 2. 已接的数据通路（复用现有 API）

服务端真身全部在 `uvp-chain-services/service/src/`：

### 2.1 身份背书 / 登记档案（公开只读，无需会话）

| 调用 | 路由 | 服务端单源 |
| --- | --- | --- |
| `client.loadIdentityBindings({ account, activeOnly:false })` | `GET /identity/bindings?account=<0x…>&activeOnly=false` | `api/routes/governance.ts:117-163`（投影类型 `indexer/identity-projections.ts:20-55`，过滤 `:103-128`） |
| `client.loadIdentityDescriptor(subjectId, descriptorHash)` | `GET /identity/descriptors/:subjectId/:descriptorHash` | `api/routes/governance.ts:122-150`；DTO/哈希重算 `governance/descriptors.ts:188-214` |

注意：`activeOnly=false` 是必需的——字符串 `"false"` 在路由层已收敛为 boolean，
撤销记录才会返回（`api/routes/governance.ts:168-196`）。

### 2.2 钱包会话与地址锚定（写；复用 order app 现有 SIWE 会话）

钱包登录本身不重写：`ProductApiClient.proveWalletControl`（`app/src/api/productApi.ts:551-581`，
challenge → personal_sign → `/store/auth/verify`，并把 token 持久化到
`uvp-order-app:wallet-session`，`:395-415`）。页面通过 `wallet` prop 注入现有
`OrderAppActions`（`proveWalletControl/requestWalletAddress/hasInjectedWallet`），通过
`session` prop 注入 `currentSessionToken` 取值器。

地址归属绑定（把地址记入当前会话账号，支持多地址）走同一会话：

| 调用 | 路由 | 服务端单源 |
| --- | --- | --- |
| `client.loadAccountAddresses()` | `GET /store/auth/addresses`（`x-uvp-store-session`） | `api/routes/store-auth.ts:66-77`；`store/sessions/service.ts:331-334` |
| `client.bindWalletAddress({ address })` | `POST /store/auth/challenge` `{address,intent:"anchor_address"}` → personal_sign → `POST /store/auth/verify` `{nonce,signature}`（两次均带 `x-uvp-store-session`） | `api/routes/store-auth.ts:28-55`；intent 校验与账号一致性 `store/sessions/service.ts:104-111, 223-281` |

`bindWalletAddress` 不持久化 verify 新签发的 session token：账号级锚定已落在
服务端，order app 继续用原有参与者会话（新会话行按 TTL 自然过期）。撤销地址的
接口 `POST /store/auth/addresses/revoke`（`store-auth.ts:79-90`）存在，本 rough
版本未做 UI。

CORS 侧 `x-uvp-store-session` 在服务端 allow-headers 白名单内
（`service/src/api/server.ts:636`）；跨源部署仍需 `UVP_API_CORS_ALLOWED_ORIGINS`
精确配置（`:618-626`）。

### 2.3 实体自助登记（链下档案，写路径已就绪）

2026-10-23 起 Chain Services 提供参与者可用的实体登记写/读接口。页面提交走
真实接口，不再有"不可提交"分支。

| 调用 | 路由 | 服务端单源 |
| --- | --- | --- |
| `client.registerEntity({ legalName, registrationNumber, contactName })` | `POST /product/registration`（`x-uvp-store-session`）→ `201 { registration }` | `api/routes/product-registration.ts`；`store/registration/service.ts`；表 `store_entity_registration`（迁移 `0028_store_entity_registration.sql` / `migrations/postgres/0028_…`） |
| `client.loadMyEntityRegistration()` | `GET /product/registration/me`（`x-uvp-store-session`）→ `200 { registration }`；未登记为 `{ registration: null }` | 同上 |

服务端契约：

- **账号地址只从会话锚定地址派生**（钱包会话 `x-uvp-store-session`，local 可显式
  dev 锚定头）；请求体里的 `account/accountAddress/walletAddress/status/verified`
  一律 `400 immutable_field`。未登录 `401 wallet_identity_required`。
- 落库字段：`registration_id`、`account_address`、`account_id`(可选)、
  `legal_name`、`registration_number`、`contact_name`、`status`、`created_at`、
  `updated_at`。`status` 词表：`self_declared | pending_review`。
- **单账号单活跃记录**：`account_address` 唯一索引；重复提交更新同一行（保留
  首次 `registrationId`/`createdAt`，刷新 `updatedAt`），不追加历史。
- 响应恒为 `verified: false`、`chainWritten: false`。写路径**不写链、不调用
  governance register-identity、不创建 supplier**。

## 3. 口径：自助登记，不是身份核验

**写路径已就绪（自助登记，未核验）；不存在"实体注册暂不可提交"的 blocker。**
`blockers.ts` 的旧 blocker 解除条件（"Chain Services 提供参与者可用的实体注册
写接口"）已满足，本模块改为 `entityRegistrationReadiness`，只保留未核验/A 层边界：

1. 实名/资质核验仍待人工或 A 机构（KYB）：登记状态恒为未核验，接口返回
   `verified: false`。
2. 链上 `UVPIdentityRegistry` 身份绑定仍由治理服务登记
   （`registerIdentityBinding` 为 `onlyOwner`），自助登记不写链、不冒充身份注册表。
3. 不创建 Store 供应商档案，也不授予任何 Store 运营能力。
4. 注册号不做格式校验：服务端只校验必填与长度上限，不预设统一社会信用代码等
   格式规则。

页面因此只显示"已登记（未核验）/ 自助登记（未核验）"，不会出现"已验证/可信/
已认证"之类评价，也不会把登记成功写成链上身份绑定成功。

## 4. 身份事实展示口径

- 只展示服务端返回的事实：背书状态（`背书有效` / `背书已撤销`）、身份主体
  （subjectId）、背书钱包、登记方、登记指针、链上来源与证明字段、登记档案原文
  与哈希重算结果。页面不给"可信/已认证/风险低"之类评价。
- "没有记录"与"读取失败"分开：只有请求成功且 `bindings` 为空才显示"该地址当前
  没有身份背书"；失败显示错误与重试，并明确"读取失败不等于没有记录"。
- 链语言（交易哈希/区块/合约地址/档案 URI）收在每条的 `链上来源与证明字段`
  折叠层；页面主视野用产品语言（背书有效/已撤销、登记方、身份主体）。
- 登记档案快照只在用户展开时按 `descriptorHash` 拉取，并原样展示档案原文；
  哈希重算一致/不一致是机械事实，不是可信评价。

## 5. 接线（Lead）

```tsx
import { RegistrationPage } from "./registration";

// api 来自 createProductApiClient（现有 ProductApiClient）
// actions 来自 createOrderAppActions(api)（现有 OrderAppActions，结构兼容）
<RegistrationPage
  session={{ currentSessionToken: () => api.currentSessionToken() }}
  wallet={actions}
  initialAddress={session.walletAddress}
  onBack={() => { /* 回到待办 */ }}
/>
```

- `client` prop 可整体替换（测试或复用宿主 client）。
- `session` 未注入时，页面仍可查询公开身份背书事实；钱包地址清单与地址绑定会
  显式显示"需要钱包会话"。
- 环境变量：`VITE_UVP_CHAIN_SERVICES_URL`（与 app 其余部分同一变量；缺失时
  `createRegistrationClient` 抛错，页面显示"参与者服务未配置"，不回退假数据）。

## 6. 验证（2026-10-23，本模块交付时实测）

命令均在 `/Users/uyhendu/project/uvp-eth/uvp-order-app/app` 下执行（未跑 git）：

```bash
cd /Users/uyhendu/project/uvp-eth/uvp-order-app/app

# 1) 全仓 typecheck（包含本模块全部 .ts/.tsx 与 e2e 类型）
pnpm typecheck
# => exit 0

# 2) 现有单测回归
pnpm test
# => 165 tests / 33 suites，pass 165，fail 0

# 3) 注册 spec（成功 / 未登录 / 服务端失败 / 网络失败四条）
pnpm exec playwright test e2e/order-app.registration.spec.ts --project=chromium
# => 4 passed
```

服务端侧（`/Users/uyhendu/project/uvp-eth/uvp-chain-services/service`）：

```bash
pnpm typecheck
# => exit 0

./node_modules/.bin/vitest run tests/entity-registration.test.ts
# => 5 tests passed（401 门、账号锚定、immutable_field、upsert 单行、sqlite 重开读回）
```

真实请求验证（sqlite local）见交付报告；POST 落库后 GET 读回同一
`registrationId`，重复 POST 更新同一行。

## 7. Rough 边界（已知，不假称完成）

- **核验未做**：自助登记只产生 `self_declared`（未核验）档案；人工核验与
  A 机构实名/KYB 接通后，核验结果需要新接口/新状态承载，本模块不预先伪造。
- **链上身份绑定未做**：钱包绑定只到会话账号地址清单，不是链上
  `UVPIdentityRegistry` 绑定；链上绑定仍需治理服务登记（`registerIdentity`）。
- **不创建 supplier**：实体登记与 Store 供应商档案是两套记录，前者不授予后者
  的运营能力或审核状态。
- **撤销地址/档案快照列表未做 UI**：`POST /store/auth/addresses/revoke` 与
  `GET /identity/descriptors/:subjectId` 已存在，需要时可接。
- **注册号无格式规则**：服务端和页面都只校验必填与长度上限；格式契约待产品/
  A 层给出后再单源。
- **HTTP transport 局部实现**：`client.ts` 自带 fetch/超时/错误解析（与
  `productApi` 的私有 transport 同口径但未共享），因为 `productApi` 在本次
  写入范围之外。后续可抽公共 client 收敛，当前不宣称单源。
- 身份事实接口公开可读是服务端现状（`/identity/bindings`、`/identity/descriptors`），
  本模块不额外加鉴权，也不把公开读当成身份证明。
